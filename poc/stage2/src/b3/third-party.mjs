/** Third-party attestation verification core (TRUSTED TOOLCHAIN, C-2; attack plan v0.4 §5.1; C-2 plan v0.2 §2).
 *  Used by an INDEPENDENT verifier (scripts/verify-attestation.mjs), never inside a workflow. Pure function: every
 *  external fact (the `gh attestation verify --format json` output, blobs at the signer commit, the policy fetched
 *  from main, the toolchain targets) is injected, so the policy layer is unit-testable without network.
 *  Synthetic inputs in unit tests are NOT a cryptographic verification: only gh (>= 2.102.0) verifies signatures.
 *
 *  Two fixed profiles (paths, policy file and version are constants — no parameter can mix them):
 *   - official: signer .github/workflows/attest.yml, policy docs/stage2/S2B2-TRUST-POLICY.json, subject statement.json
 *               (PASS, honest, provenance, toolchain record, recomputed targets) → ACCEPTED
 *   - sigtest : signer .github/workflows/attest-sigtest.yml, policy docs/stage2/S2B2-SIGTEST-POLICY.json, subject the
 *               fixed SIGTEST.txt (digest pinned below; no business-statement checks) → SIGTEST_IDENTITY_ACCEPTED
 *  Results: <accept label> | REJECTED | REVOCATION_STATUS_UNKNOWN (policy older than freshnessHours; never accepted).
 *  Identity comes ONLY from the certificate and the verified timestamps — never from the predicate. */
import { createHash } from 'node:crypto';
import { parseTrustPolicy, validAt, TRUST_POLICY_VERSION, SIGTEST_POLICY_VERSION } from './trust-policy.mjs';
import { parseStrictJson } from './package.mjs';
import { stableJson } from '../stable.mjs';
import { createFixtureHash } from '../../../stage1/src/common.mjs';

export const THIRD_PARTY_VERSION = 's2-third-party-v1';
export const REPO = 'hsuanyu9503/class-management-next';
export const SOURCE_REF = 'refs/heads/main';
export const SIGTEST_SHA256 = '63515e7c0a94b6e13d0f9ed2525b4e43b5da5221a8442a611dcc2c6d79ffb318';
export const MIN_GH = [2, 102, 0];
export const PROFILES = Object.freeze({
  official: Object.freeze({ workflowPath: '.github/workflows/attest.yml', policyFile: 'docs/stage2/S2B2-TRUST-POLICY.json', policyVersion: TRUST_POLICY_VERSION, kinds: ['toolchain', 'signing-policy'], accept: 'ACCEPTED' }),
  sigtest: Object.freeze({ workflowPath: '.github/workflows/attest-sigtest.yml', policyFile: 'docs/stage2/S2B2-SIGTEST-POLICY.json', policyVersion: SIGTEST_POLICY_VERSION, kinds: ['signing-policy'], accept: 'SIGTEST_IDENTITY_ACCEPTED', subjectSha256: SIGTEST_SHA256 }),
});
const SHA40 = /^[0-9a-f]{40}$/; const SHA64 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** statement.targets recomputed from the files of a toolchain commit (same formulas as test/b3-run.mjs):
 *  the Stage 1 oracle and fixture files at that commit, and that commit's anchor digest. null on any problem. */
export function computeTargets({ oracleBytes, fixtureBytes, testId, anchorDigest }) {
  try {
    if (!Buffer.isBuffer(oracleBytes) || !Buffer.isBuffer(fixtureBytes) || !SHA64.test(String(anchorDigest ?? ''))) return null;
    const cases = parseStrictJson(oracleBytes.toString('utf8')).cases;
    const caseSpec = Array.isArray(cases) ? cases.filter((c) => isObj(c) && c.testId === testId) : [];
    if (caseSpec.length !== 1) return null;
    return { caseSpecDigest: sha(stableJson(caseSpec[0])), oracleFileSha256: sha(oracleBytes), fixtureFileSha256: sha(fixtureBytes),
      fixtureHash: createFixtureHash(parseStrictJson(fixtureBytes.toString('utf8'))), anchorDigest };
  } catch { return null; }
}
/** "gh version 2.102.0 (2026-…)" → [2,102,0] | null */
export function parseGhVersion(text) {
  const m = /^gh version (\d+)\.(\d+)\.(\d+)\b/m.exec(String(text || ''));
  return m ? m.slice(1, 4).map(Number) : null;
}
export function ghVersionOk(v) {
  if (!Array.isArray(v) || v.length !== 3) return false;
  for (let i = 0; i < 3; i++) { if (v[i] > MIN_GH[i]) return true; if (v[i] < MIN_GH[i]) return false; }
  return true;
}
/** exact identity parse of buildSignerURI: https://github.com/<owner>/<repo>/<path>@<ref> (case-sensitive) */
export function parseSignerUri(uri) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/(\.github\/workflows\/[^@\s]+)@(refs\/[^\s]+)$/.exec(String(uri || ''));
  return m ? { repo: m[1], path: m[2], ref: m[3] } : null;
}
/** a trusted time: an ISO-8601 string with an explicit zone that parses to a finite instant */
const timeOf = (s) => (typeof s === 'string' && UTC.test(s) && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null);

/** @param o.profile     'official' | 'sigtest'
 *  @param o.verified    the parsed JSON array gh printed AFTER a successful verification; null when gh failed
 *  @param o.subjectBytes the exact file gh verified (statement.json / SIGTEST.txt)
 *  @param o.policy      { text, sourceCommit, fetchedAt (ISO, the time main was actually fetched), anchorDigest (recomputed
 *                         from the fetched main), anchorExpected (--anchor, from the owner's public record), anchorSource }
 *                       TEST INTERFACE: unit tests inject policy copies here; the CLI only ever reads the fixed file.
 *  @param o.blobAt(commit, path) → blob SHA of the file at that commit | null
 *  @param o.targetsAt(commit, testId) → recomputed targets | null (official only). PR16-REV001: called only after EVERY
 *                       other check of EVERY attestation passed; at most once per (commit, testId). It must not run code
 *                       from the commit (the CLI reads its files with the verifier's own code).
 *  @param o.nowMs       the verifier's clock */
export function judgeAttestation({ profile, verified, subjectBytes, policy, blobAt, targetsAt, nowMs }) {
  const P = Object.hasOwn(PROFILES, profile) ? PROFILES[profile] : null;
  if (!P) throw new Error(`unknown profile: ${profile}`);
  const reasons = []; const items = []; const pending = [];
  const rej = (code, i = null) => reasons.push(i === null ? code : `${code}#${i}`);
  const subjectSha = Buffer.isBuffer(subjectBytes) ? sha(subjectBytes) : null;
  const ev = { version: THIRD_PARTY_VERSION, profile, unsigned: true, now: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null, subjectSha256: subjectSha, items,
    policy: { file: P.policyFile, sha256: typeof policy?.text === 'string' ? sha(policy.text) : null, sourceCommit: policy?.sourceCommit ?? null, fetchedAt: policy?.fetchedAt ?? null,
      anchorExpected: policy?.anchorExpected ?? null, anchorSource: policy?.anchorSource ?? null, anchorDigest: policy?.anchorDigest ?? null } };
  if (!Number.isFinite(nowMs)) rej('CLOCK_INVALID');
  if (!subjectSha) rej('SUBJECT_MISSING');
  if (P.subjectSha256 && subjectSha !== P.subjectSha256) rej('SIGTEST_SUBJECT_NOT_APPROVED');
  // §2.3-6: the approved anchor comes from OUTSIDE (Q2) and must match main as fetched
  const anchorExpected = String(policy?.anchorExpected ?? '');
  if (!SHA64.test(anchorExpected)) rej('ANCHOR_NOT_PROVIDED');
  else if (policy?.anchorDigest !== anchorExpected) rej('ANCHOR_MISMATCH');
  if (!SHA40.test(String(policy?.sourceCommit ?? ''))) rej('POLICY_SOURCE_UNKNOWN');
  let pol = null;
  try { pol = parseTrustPolicy(policy?.text, { version: P.policyVersion, kinds: P.kinds }); } catch { rej('POLICY_INVALID'); }
  const fetched = timeOf(policy?.fetchedAt);
  let stale = false;
  if (fetched === null) rej('POLICY_FETCH_TIME_INVALID');
  else if (pol && Number.isFinite(nowMs)) { if (fetched > nowMs) rej('POLICY_FETCH_TIME_IN_FUTURE'); else if (nowMs - fetched > pol.freshnessHours * 3600e3) stale = true; }
  // §2.3-1: every verified attestation gh returned must pass; at least one
  if (!Array.isArray(verified)) rej('GH_VERIFY_FAILED');
  else if (verified.length === 0) rej('NO_ATTESTATIONS');
  else verified.forEach((it, i) => {
    const e = { index: i }; items.push(e);
    const vr = isObj(it) ? it.verificationResult : null; const cert = isObj(vr) && isObj(vr.signature) ? vr.signature.certificate : null;
    if (!isObj(cert)) { rej('CERTIFICATE_MISSING', i); return; }
    const id = parseSignerUri(cert.buildSignerURI); e.signer = id;
    if (!id) rej('SIGNER_URI_INVALID', i);
    else { if (id.repo !== REPO) rej('SIGNER_REPO_MISMATCH', i); if (id.path !== P.workflowPath) rej('SIGNER_WORKFLOW_MISMATCH', i); if (id.ref !== SOURCE_REF) rej('SIGNER_REF_MISMATCH', i); }
    if (cert.sourceRepositoryRef !== SOURCE_REF) rej('SOURCE_REF_MISMATCH', i);
    if (cert.sourceRepositoryURI !== `https://github.com/${REPO}`) rej('SOURCE_REPO_MISMATCH', i);
    const signerCommit = SHA40.test(String(cert.buildSignerDigest ?? '')) ? cert.buildSignerDigest : null; e.signerCommit = signerCommit;
    if (!signerCommit) rej('SIGNER_DIGEST_INVALID', i);
    // §2.3-5 (v0.2, Q4): trusted times — non-empty, every one parseable, every one inside the interval
    const ts = Array.isArray(vr.verifiedTimestamps) ? vr.verifiedTimestamps : null;
    const times = ts ? ts.map((t) => ({ type: isObj(t) && typeof t.type === 'string' ? t.type.slice(0, 40) : null, timestamp: isObj(t) ? t.timestamp ?? null : null, ms: isObj(t) ? timeOf(t.timestamp) : null })) : [];
    e.timestamps = times.map(({ type, timestamp }) => ({ type, timestamp }));
    if (!ts || ts.length === 0) rej('NO_TRUSTED_TIME', i);
    else if (times.some((t) => t.ms === null)) rej('TRUSTED_TIME_INVALID', i);
    const timesOk = !!ts && ts.length > 0 && times.every((t) => t.ms !== null);
    // subject binding (both profiles): the verified statement names the exact bytes
    const subj = isObj(vr.statement) && Array.isArray(vr.statement.subject) ? vr.statement.subject : null;
    if (!subj || !subjectSha || !subj.some((s) => isObj(s) && isObj(s.digest) && s.digest.sha256 === subjectSha)) rej('SUBJECT_DIGEST_MISMATCH', i);
    // signing policy: the blob of the signer workflow at the signer commit must be a record valid at EVERY trusted time
    const blob = signerCommit ? blobAt(signerCommit, P.workflowPath) : null; e.signingPolicyBlob = SHA40.test(String(blob ?? '')) ? blob : null;
    const recOk = (kind, shaV) => { const rs = pol ? pol.records.filter((r) => r.kind === kind && r.sha === shaV) : [];
      if (rs.some((r) => r.invalidateIssued === true)) return { ok: false, ids: rs.map((r) => r.approvalId), invalidated: true };
      const ok = timesOk && rs.length > 0 && times.every((t) => rs.some((r) => validAt(r, t.ms)));
      return { ok, ids: rs.filter((r) => times.every((t) => validAt(r, t.ms))).map((r) => r.approvalId), invalidated: false }; };
    if (!e.signingPolicyBlob) rej('SIGNING_POLICY_BLOB_UNAVAILABLE', i);
    else { const r = recOk('signing-policy', e.signingPolicyBlob); e.signingPolicyApprovals = r.ids;
      if (r.invalidated) rej('SIGNING_POLICY_INVALIDATED', i); else if (!r.ok) rej('SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME', i); }
    if (profile !== 'official') return;
    // §2.3-4: the business statement (official profile only)
    let st = null; try { st = parseStrictJson(subjectBytes.toString('utf8')); } catch { st = null; }
    if (!isObj(st)) { rej('STATEMENT_INVALID', i); return; }
    if (st.schemaVersion !== 's2-attestation-v1') rej('STATEMENT_SCHEMA_MISMATCH', i);
    if (!isObj(st.verdict) || st.verdict.result !== 'PASS') rej('STATEMENT_NOT_PASS', i);
    if (st.scenario !== 'honest') rej('SCENARIO_NOT_HONEST', i);
    const tc = isObj(st.toolchain) ? st.toolchain : {};
    if (!SHA40.test(String(tc.signingPolicyBlob ?? ''))) rej('STATEMENT_SIGNING_POLICY_NULL', i);
    else if (tc.signingPolicyBlob !== e.signingPolicyBlob) rej('STATEMENT_SIGNING_POLICY_MISMATCH', i);
    if (!isObj(st.package) || !/^[0-9]{1,20}$/.test(String(st.package.artifactId ?? ''))) rej('STATEMENT_ARTIFACT_ID_NULL', i);
    const tcc = SHA40.test(String(tc.trustedToolchainCommit ?? '')) ? tc.trustedToolchainCommit : null; e.toolchainCommit = tcc;
    if (!tcc) { rej('STATEMENT_TOOLCHAIN_INVALID', i); return; }
    const r = recOk('toolchain', tcc); e.toolchainApprovals = r.ids;
    if (r.invalidated) { rej('TOOLCHAIN_INVALIDATED', i); return; }
    if (!r.ok) { rej('TOOLCHAIN_NOT_VALID_AT_SIGNING_TIME', i); return; }
    // PR16-REV001: targets are NOT computed here — only queued (phase 2 below)
    pending.push({ i, commit: tcc, testId: st.testId, targets: st.targets, e });
  });
  // Phase 2 (PR16-REV001): targetsAt reads files of a candidate commit. It runs only when EVERY side-effect-free
  // check of EVERY attestation passed (external anchor, policy source and freshness, identity, times, subject, signing
  // policy, statement fields, toolchain record) — a rejection must happen before, never after, that access.
  // PR16-REV002: memoised by full commit + testId, so attestations sharing a toolchain are computed once.
  if (!reasons.length && !stale) {
    const memo = new Map();
    for (const { i, commit, testId, targets, e } of pending) {
      const key = `${commit}\0${testId}`;
      if (!memo.has(key)) memo.set(key, typeof testId === 'string' ? targetsAt(commit, testId) : null);
      const tg = memo.get(key); e.targetsChecked = true;
      if (!isObj(tg)) rej('TARGETS_UNAVAILABLE', i);
      else if (!isObj(targets) || stableJson(targets) !== stableJson(tg)) rej('TARGETS_MISMATCH', i);
    }
  } else for (const { e } of pending) e.targetsChecked = false;
  const result = reasons.length ? 'REJECTED' : stale ? 'REVOCATION_STATUS_UNKNOWN' : P.accept;
  return { result, reasons: [...new Set(reasons)], accepted: result === P.accept, stalePolicy: stale, evidence: ev };
}
