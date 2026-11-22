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
const SHA40 = /^[0-9a-f]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const RECORD_KEYS = new Set(['approvalId', 'kind', 'sha', 'approvedAt', 'approvedBy', 'reviewRef', 'status', 'validFrom', 'validTo', 'invalidateIssued']);

/** @returns {policy} or throws Error('TRUST_POLICY_INVALID: …') */
export function parseTrustPolicy(text) {
  let p; try { p = parseStrictJson(text); } catch (e) { throw new Error(`TRUST_POLICY_INVALID: ${e.code || 'json'}`); }
  const bad = (m) => { throw new Error(`TRUST_POLICY_INVALID: ${m}`); };
  if (!isObj(p) || p.policyVersion !== TRUST_POLICY_VERSION || !Array.isArray(p.records)) bad('shape');
  if (!Number.isSafeInteger(p.freshnessHours) || p.freshnessHours < 1 || p.freshnessHours > 168) bad('freshnessHours');
  const ids = new Set();
  for (const r of p.records) {
    if (!isObj(r) || Object.keys(r).some((k) => !RECORD_KEYS.has(k))) bad('record shape');
    if (typeof r.approvalId !== 'string' || !/^[A-Z0-9-]{3,40}$/.test(r.approvalId) || ids.has(r.approvalId)) bad('approvalId'); ids.add(r.approvalId);
    if (!['toolchain', 'signing-policy'].includes(r.kind) || !SHA40.test(r.sha)) bad(`kind/sha ${r.approvalId}`);
    if (!['active', 'revoked'].includes(r.status) || !UTC.test(r.approvedAt) || !UTC.test(r.validFrom)) bad(`status/time ${r.approvalId}`);
    if (typeof r.approvedBy !== 'string' || !r.approvedBy || typeof r.reviewRef !== 'string' || !r.reviewRef) bad(`approvedBy/reviewRef ${r.approvalId}`);
    if (r.status === 'revoked' ? !UTC.test(r.validTo ?? '') : (r.validTo !== null && r.validTo !== undefined)) bad(`validTo ${r.approvalId}`);
    if (r.invalidateIssued !== undefined && typeof r.invalidateIssued !== 'boolean') bad(`invalidateIssued ${r.approvalId}`);
  }
  return p;
}

const activeAt = (r, nowMs) => r.status === 'active' && Date.parse(r.validFrom) <= nowMs;

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
