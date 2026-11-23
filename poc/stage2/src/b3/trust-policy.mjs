/** Trust-root approval policy (TRUSTED TOOLCHAIN, B3b). Plan v0.3 §4.2–§4.5, §7.2.
 *  The approval record docs/stage2/S2B2-TRUST-POLICY.json lists owner approvals of
 *   - kind "toolchain":      a commit whose Runner / sandbox / Verifier / Observer may produce evidence;
 *   - kind "signing-policy": the Git blob SHA of .github/workflows/attest.yml that may sign.
 *  The current pointers are owner-set repository variables (CMN_S2_TRUSTED_TOOLCHAIN_SHA,
 *  CMN_S2_SIGNING_POLICY_BLOB); each must name an ACTIVE record, and the signing-policy pointer must equal the
 *  blob of attest.yml in the commit that actually ran. Being an ancestor of main is NOT approval (§4.1).
 *  Pure function: no I/O. Anything malformed → not configured (fail closed). */
import { parseStrictJson } from './package.mjs';

export const TRUST_POLICY_VERSION = 's2-trust-policy-v1';
export const SIGTEST_POLICY_VERSION = 's2-sigtest-policy-v1';
const SHA40 = /^[0-9a-f]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const RECORD_KEYS = new Set(['approvalId', 'kind', 'sha', 'approvedAt', 'approvedBy', 'reviewRef', 'status', 'validFrom', 'validTo', 'invalidateIssued']);

/** @param opts.version  expected policyVersion (default: the official trust policy). C-2: the sigtest identity policy
 *                       (docs/stage2/S2B2-SIGTEST-POLICY.json) uses SIGTEST_POLICY_VERSION;
 *  @param opts.kinds    record kinds allowed (the sigtest policy only has 'signing-policy')
 *  @returns {policy} or throws Error('TRUST_POLICY_INVALID: …') */
export function parseTrustPolicy(text, { version = TRUST_POLICY_VERSION, kinds = ['toolchain', 'signing-policy'] } = {}) {
  let p; try { p = parseStrictJson(text); } catch (e) { throw new Error(`TRUST_POLICY_INVALID: ${e.code || 'json'}`); }
  const bad = (m) => { throw new Error(`TRUST_POLICY_INVALID: ${m}`); };
  if (!isObj(p) || p.policyVersion !== version || !Array.isArray(p.records)) bad('shape');
  if (!Number.isSafeInteger(p.freshnessHours) || p.freshnessHours < 1 || p.freshnessHours > 168) bad('freshnessHours');
  const ids = new Set();
  for (const r of p.records) {
    if (!isObj(r) || Object.keys(r).some((k) => !RECORD_KEYS.has(k))) bad('record shape');
    if (typeof r.approvalId !== 'string' || !/^[A-Z0-9-]{3,40}$/.test(r.approvalId) || ids.has(r.approvalId)) bad('approvalId'); ids.add(r.approvalId);
    if (!kinds.includes(r.kind) || !SHA40.test(r.sha)) bad(`kind/sha ${r.approvalId}`);
    if (!['active', 'revoked'].includes(r.status) || !UTC.test(r.approvedAt) || !UTC.test(r.validFrom)) bad(`status/time ${r.approvalId}`);
    if (typeof r.approvedBy !== 'string' || !r.approvedBy || typeof r.reviewRef !== 'string' || !r.reviewRef) bad(`approvedBy/reviewRef ${r.approvalId}`);
    if (r.status === 'revoked' ? !UTC.test(r.validTo ?? '') : (r.validTo !== null && r.validTo !== undefined)) bad(`validTo ${r.approvalId}`);
    if (r.invalidateIssued !== undefined && typeof r.invalidateIssued !== 'boolean') bad(`invalidateIssued ${r.approvalId}`);
    // C-2 (plan v0.2 §2.3-5): a closed interval must be non-empty — validTo strictly after validFrom
    if (r.validTo !== null && r.validTo !== undefined && !(Date.parse(r.validTo) > Date.parse(r.validFrom))) bad(`interval ${r.approvalId}`);
  }
  return p;
}

const activeAt = (r, nowMs) => r.status === 'active' && Date.parse(r.validFrom) <= nowMs;

/** C-2 (attack plan v0.4 §5.1 step 4a; C-2 plan v0.2 §2.3-5): was this record valid at the trusted time tMs?
 *  For THIRD-PARTY verification of a historical attestation (the Runner's gate keeps evaluateTrust: currently active).
 *   - invalidateIssued: true → never (whatever the time);
 *   - status active, or revoked (normal retirement) — anything else never;
 *   - validFrom ≤ t, and t < validTo when validTo is set;
 *   - malformed (unparsable times, revoked without validTo, empty interval, t not a finite number) → never.
 *  Expects a record from parseTrustPolicy(); re-checks the fields it relies on (fail closed). */
export function validAt(r, tMs) {
  if (!isObj(r) || !Number.isFinite(tMs)) return false;
  if (r.invalidateIssued === true) return false;
  if (r.status !== 'active' && r.status !== 'revoked') return false;
  if (!UTC.test(r.validFrom ?? '')) return false;
  const from = Date.parse(r.validFrom);
  const hasTo = r.validTo !== null && r.validTo !== undefined;
  if (r.status === 'revoked' && !hasTo) return false;
  if (hasTo && !UTC.test(r.validTo)) return false;
  const to = hasTo ? Date.parse(r.validTo) : Infinity;
  if (!(to > from)) return false;
  return from <= tMs && tMs < to;
}

/** @param o.policyText       the record file's text (from the trusted checkout, never from the artifact)
 *  @param o.toolchainVar     CMN_S2_TRUSTED_TOOLCHAIN_SHA ('' when unset)
 *  @param o.signingPolicyVar CMN_S2_SIGNING_POLICY_BLOB ('' when unset)
 *  @param o.toolchainCommit  the commit the jobs actually checked out and ran
 *  @param o.workflowBlob     blob SHA of .github/workflows/attest.yml in the commit whose workflow ran
 *  @returns { configured, reasons[], toolchainApproval, signingPolicyApproval, policyVersion } */
export function evaluateTrust({ policyText, toolchainVar, signingPolicyVar, toolchainCommit, workflowBlob, nowMs = Date.now() }) {
  const reasons = [];
  let policy = null;
  try { policy = parseTrustPolicy(policyText); } catch (e) { reasons.push(String(e.message).split(':')[0]); }
  const tv = String(toolchainVar || '').trim().toLowerCase(); const sv = String(signingPolicyVar || '').trim().toLowerCase();
  if (!tv) reasons.push('TRUSTED_TOOLCHAIN_NOT_SET'); else if (!SHA40.test(tv)) reasons.push('TRUSTED_TOOLCHAIN_INVALID');
  if (!sv) reasons.push('SIGNING_POLICY_NOT_SET'); else if (!SHA40.test(sv)) reasons.push('SIGNING_POLICY_INVALID');
  if (tv && toolchainCommit !== tv) reasons.push('TOOLCHAIN_COMMIT_MISMATCH');
  if (sv && workflowBlob !== sv) reasons.push('SIGNING_POLICY_BLOB_MISMATCH');
  let t = null; let s = null;
  if (policy) {
    t = policy.records.find((r) => r.kind === 'toolchain' && r.sha === tv && activeAt(r, nowMs)) || null;
    s = policy.records.find((r) => r.kind === 'signing-policy' && r.sha === sv && activeAt(r, nowMs)) || null;
    if (tv && !t) reasons.push('TOOLCHAIN_NOT_APPROVED');
    if (sv && !s) reasons.push('SIGNING_POLICY_NOT_APPROVED');
  }
  return { configured: reasons.length === 0, reasons, toolchainApproval: t?.approvalId ?? null, signingPolicyApproval: s?.approvalId ?? null, policyVersion: policy?.policyVersion ?? null };
}
