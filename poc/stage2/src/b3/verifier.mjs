/** Verifier (TRUSTED TOOLCHAIN, B3a prototype). Pure function: package bytes + TRUSTED inputs → statement.
 *  Plan v0.3 §3.4, §3.3(c), §6.3, §7.2, §7.4, §7.5. Nothing inside the package is believed: every value
 *  that matters is compared with a trusted input or recomputed with this toolchain.
 *
 *  PASS needs ALL of: a GitHub-hosted runner, a configured trust root (approved toolchain + signing policy, see
 *  trust-policy.mjs) and PASS_ENABLED. PASS_ENABLED stays false in B3b (owner decision 2026-11-21): it is
 *  turned on in a separate PR only after hosted runs have shown the sandbox and self-check hold. The best
 *  local result is UNATTESTED [LOCAL_UNTRUSTED_RUNNER, TRUST_ROOT_NOT_CONFIGURED]. */
import { createHash } from 'node:crypto';
import { readPackageSafe, parseStrictJson, PackageError } from './package.mjs';
import { CHECK_IDS, POSITIVE_CONTROL_REQUIRED, POLICY_VERSION, USR_BINARIES, configDigest, sandboxConfig, pathMapDigest } from './isolation-policy.mjs';
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isPlainObj(o) && Object.hasOwn(o, k);
import { reconcile } from './reconcile.mjs';
import { observe } from '../observer.mjs';
import { verdict as contractVerdict, BLOCKED_FIELDS } from '../verdict.mjs';
import { stableJson } from '../stable.mjs';

export const PASS_ENABLED = false;
export const VERIFIER_VERSION = 's2-verifier-b3b-0';   // b3a-0 = 211e114; b3a-1 = R1 + F1; b3a-2 = PR-1; b3b-0 = PR-2 (trust-gated decision)
/** Trusted case → actor table (from the locked matrix preconditions); not taken from Adapter code. */
export const CASE_ACTORS = Object.freeze({ 'POC-001': 'ACTOR-TEACHER', 'POC-002': 'ACTOR-OTHER', 'POC-008': 'ACTOR-TEACHER', 'POC-009': 'ACTOR-SC01-TEACHER' });
export const PAYLOAD = Object.freeze(['adapter-claim.json', 'isolation.json', 'run.json', 'runner-log.jsonl', 'state-post.json', 'state-pre.json', 'trace-back.jsonl', 'trace-front.jsonl']);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const jsonl = (b) => b.toString('utf8').split('\n').filter(Boolean).map((l) => parseStrictJson(l));

/** @param trusted {packageSha256, manifestSha256, runId, runAttempt, attestationNonce, testId,
 *   trustedToolchainCommit, adapterCommit, caseSpec, runnerKind} — all from trusted channels. */
/** Error classes the Verifier may name in a reason; anything else is reported as 'Error'. The message is never
 *  copied into the result, because it may quote package content (B3A-R1-N1). */
const ERROR_CLASSES = new Map([[TypeError, 'TypeError'], [RangeError, 'RangeError'], [SyntaxError, 'SyntaxError'], [ReferenceError, 'ReferenceError']]);
const errorClass = (e) => { for (const [C, n] of ERROR_CLASSES) if (e instanceof C) return n; return e instanceof Error ? 'Error' : 'NonError'; };
const emptyResult = () => ({ verifierVersion: VERIFIER_VERSION, result: 'BLOCKED', reasons: [], reconciliation: null, observedCanonical: null, isolation: null });

/** Never throws (B3A-R1-N1): an unexpected error is BLOCKED VERIFIER_INTERNAL_ERROR:<error class>. */
export function verifyPackage(packageBytes, trusted) {
  try { return verifyPackageUnguarded(packageBytes, trusted); } catch (e) {
    const out = emptyResult(); out.reasons.push(`VERIFIER_INTERNAL_ERROR:${errorClass(e)}`); return out;
  }
}

function verifyPackageUnguarded(packageBytes, trusted) {
  const out = emptyResult(); const { reasons } = out; const blocked = (r) => reasons.push(r);
  // NOTE ⑨: a missing trusted record is reported, never dereferenced
  if (!isPlainObj(trusted)) { blocked('TRUSTED_INPUT_MISSING'); return out; }
  // B3A-N4: platformSupported is a TRUSTED input (Runner memory, like job outputs), never read back from the package
  const REQUIRED = ['packageSha256', 'manifestSha256', 'runId', 'runAttempt', 'attestationNonce', 'testId', 'trustedToolchainCommit', 'adapterCommit', 'caseSpec', 'runnerKind', 'platformSupported'];
  const missingTrusted = REQUIRED.filter((k) => trusted?.[k] === undefined || trusted?.[k] === null);
  // 1. content binding (§3.4)
  if (sha(packageBytes) !== trusted.packageSha256) { blocked('PACKAGE_DIGEST_MISMATCH'); return out; }
  // 2. safe parsing (§7.4)
  let pkg; try { pkg = readPackageSafe(packageBytes); } catch (e) { blocked(e instanceof PackageError ? e.code : 'ARTIFACT_FORMAT'); return out; }
  if (pkg.manifestSha256 !== trusted.manifestSha256) { blocked('MANIFEST_DIGEST_MISMATCH'); return out; }
  const names = [...pkg.files.keys()].filter((n) => n !== 'manifest.json').sort();
  if (stableJson(names) !== stableJson([...PAYLOAD])) { blocked('PAYLOAD_SET_MISMATCH'); return out; }
  let run, iso, claim, pre, post, front, back, rlog;
  try {
    const f = (n) => pkg.files.get(n);
    run = parseStrictJson(f('run.json').toString('utf8')); iso = parseStrictJson(f('isolation.json').toString('utf8'));
    claim = parseStrictJson(f('adapter-claim.json').toString('utf8'));
    pre = parseStrictJson(f('state-pre.json').toString('utf8')); post = parseStrictJson(f('state-post.json').toString('utf8'));
    front = jsonl(f('trace-front.jsonl')); back = jsonl(f('trace-back.jsonl')); rlog = jsonl(f('runner-log.jsonl'));
  } catch (e) { blocked(e instanceof PackageError ? e.code : 'ARTIFACT_JSON_INVALID'); return out; }
  // B3A-R1-N1: top-level shapes are checked before any field is read. adapter-claim.json may be null by design
  // (the Adapter never returned an output); every JSONL line must be a plain object.
  const shapeErrors = [
    ['run.json', isPlainObj(run)], ['adapter-claim.json', claim === null || isPlainObj(claim)],
    ['state-pre.json', isPlainObj(pre)], ['state-post.json', isPlainObj(post)],
    ['trace-front.jsonl', front.every(isPlainObj)], ['trace-back.jsonl', back.every(isPlainObj)], ['runner-log.jsonl', rlog.every(isPlainObj)],
  ].filter(([, ok]) => !ok).map(([n]) => n);
  if (!isPlainObj(iso)) blocked('ISOLATION_EVIDENCE_INVALID');
  if (shapeErrors.length) blocked(`ARTIFACT_JSON_INVALID:${shapeErrors.join('|')}`);
  if (reasons.length) return out;
  if (missingTrusted.length || typeof trusted.platformSupported !== 'boolean' || trusted.caseSpec.testId !== trusted.testId || !own(CASE_ACTORS, trusted.testId)) { blocked(`TRUSTED_INPUT_MISSING:${missingTrusted.join('|') || 'caseSpec/testId'}`); return out; }
  // 3. run binding (§7.2)
  for (const k of ['runId', 'runAttempt', 'attestationNonce', 'testId', 'trustedToolchainCommit', 'adapterCommit']) if (run[k] !== trusted[k]) blocked(`RUN_BINDING_MISMATCH:${k}`);
  // 4. isolation policy (§3.3(c))
  const expectedDigest = configDigest(sandboxConfig());
  out.isolation = { platformSupported: trusted.platformSupported, sandboxPolicyDigest: iso.sandboxPolicyDigest };   // iso checked above
  const unverifiable = trusted.platformSupported === false;
  if (iso.isolationPolicyVersion !== POLICY_VERSION) blocked('ISOLATION_POLICY_UNKNOWN');
  if (iso.platformSupported !== trusted.platformSupported) blocked('ISOLATION_PLATFORM_MISMATCH');
  // checked in BOTH branches (B3A-N4): config digests, control protocol, READY, termination
  if (iso.sandboxPolicyDigest !== expectedDigest || run.adapterSandboxPolicyDigest !== expectedDigest) blocked('SANDBOX_CONFIG_MISMATCH');
  const t = isPlainObj(iso.adapterTermination) ? iso.adapterTermination : {};
  if (t.namespaceTerminated !== true || t.remainingAdapterProcesses !== 0 || t.exportAfterTermination !== true) blocked('ADAPTER_TERMINATION_UNVERIFIED');
  if (!Array.isArray(iso.controlViolations) || iso.controlViolations.length) blocked('CONTROL_PROTOCOL_VIOLATION');
  if (iso.adapterReady !== true) blocked('ADAPTER_NOT_READY');
  // B3A-N7: the launch's host path map is recorded with a digest; on a supported platform it must be present,
  // self-consistent, and /usr must hold only well-formed /usr entries that include every USR_BINARIES file
  const pm = iso.pathMap;
  if (!unverifiable) {
    const files = isPlainObj(pm) && Array.isArray(pm.usrFiles) ? pm.usrFiles : null;
    const filesOk = !!files && files.every((f) => isPlainObj(f) && typeof f.inside === 'string' && f.inside.startsWith('/usr/') && !f.inside.includes('/../') && typeof f.source === 'string' && /^[0-9a-f]{64}$/.test(f.sha256))
      && new Set(files.map((f) => f.inside)).size === files.length && USR_BINARIES.every((b) => files.some((f) => f.inside === b));
    if (!filesOk || typeof iso.pathMapDigest !== 'string' || !/^[0-9a-f]{64}$/.test(iso.pathMapDigest) || pathMapDigest(pm) !== iso.pathMapDigest
      || typeof pm.nodeBinary !== 'string' || !/^[0-9a-f]{64}$/.test(pm.nodeBinarySha256 ?? '')) blocked('PATH_MAP_INVALID');
  }
  if (!unverifiable) {
    // B3A-N1: every required ID must be an OWN key holding a plain object with ok === true
    const sc = iso.selfCheck;
    if (!isPlainObj(sc)) blocked('ISOLATION_CHECK_MISSING');
    else {
      if (CHECK_IDS.some((id) => !Object.hasOwn(sc, id))) blocked('ISOLATION_CHECK_MISSING');
      if (Object.keys(sc).some((k) => !CHECK_IDS.includes(k))) blocked('ISOLATION_CHECK_UNKNOWN');
      for (const id of CHECK_IDS) {
        if (!Object.hasOwn(sc, id)) continue;
        const c = sc[id];
        // B3A-N3: required positive controls must be exactly true; all others exactly null
        const posOk = POSITIVE_CONTROL_REQUIRED.includes(id) ? (isPlainObj(c) && c.positiveControlOk === true) : (isPlainObj(c) && Object.hasOwn(c, 'positiveControlOk') && c.positiveControlOk === null);
        if (!isPlainObj(c) || c.ok !== true || !posOk) { blocked('ISOLATION_CHECK_FAILED'); break; }
      }
    }
  }
  // 5. reconciliation (§6.3)
  const markerPath = `_attestationRuns/${trusted.runId}`;
  const expectedMarker = { nonce: trusted.attestationNonce, runAttempt: trusted.runAttempt, runId: trusted.runId, writtenAt: run.nonceWrittenAt };
  const rec = reconcile({ front, back, pre, post, runnerLog: rlog, caseWindow: { start: Date.parse(run.caseStartedAt), end: Date.parse(run.caseEndedAt) }, markerPath, expectedMarker, ownershipMarkerPath: run.ownershipMarkerPath });
  out.reconciliation = rec.counts; rec.problems.forEach(blocked);
  // 6. Observer with THIS toolchain + Stage 1 comparator
  const obs = observe({ testId: trusted.testId, actor: own(CASE_ACTORS, trusted.testId) ? CASE_ACTORS[trusted.testId] : null, front, back, pre, post });
  const v = contractVerdict({ caseSpec: trusted.caseSpec, observation: obs, adapterOutput: claim, stage1Result: null, inputDigestsVerified: true });
  out.observedCanonical = obs.canonical; out.contract = { contractMatch: v.contractMatch, oracleFailures: v.oracleFailures, blockedFields: v.blockedFields, problems: v.problems, adapterClaimAgreesWithObserver: v.adapterClaimAgreesWithObserver };
  // 7. decision
  const integrity = reasons.length > 0;
  if (integrity) out.result = 'BLOCKED';
  else if (unverifiable) { out.result = 'UNATTESTED'; reasons.push('ISOLATION_UNVERIFIABLE'); }
  else if (own(BLOCKED_FIELDS, trusted.testId)) { out.result = 'BLOCKED'; reasons.push('BLOCKED_FIELDS_G1_G4'); }
  // an observation that cannot be attributed unambiguously is not a contract failure → BLOCKED
  else if (v.contractMatch === 'MISMATCH_OR_UNOBSERVABLE') { out.result = 'BLOCKED'; reasons.push('OBSERVATION_AMBIGUOUS'); }
  else if (v.contractMatch !== 'MATCH') { out.result = 'FAIL'; reasons.push('CONTRACT_MISMATCH'); }
  else {
    // B3b: PASS needs a GitHub-hosted runner (trusted input from the verify job's own environment) AND a
    // configured trust root (trusted.trustRoot from evaluateTrust: approved toolchain + signing policy)
    // AND PASS_ENABLED. Every missing condition is named; a local run keeps [LOCAL_UNTRUSTED_RUNNER, TRUST_ROOT_NOT_CONFIGURED].
    const hosted = trusted.runnerKind === 'github-hosted';
    const trustRoot = isPlainObj(trusted.trustRoot) && trusted.trustRoot.configured === true;
    if (!hosted) reasons.push('LOCAL_UNTRUSTED_RUNNER');
    if (!trustRoot) reasons.push('TRUST_ROOT_NOT_CONFIGURED');
    if (hosted && trustRoot && !PASS_ENABLED) reasons.push('PASS_NOT_ENABLED');
    out.result = hosted && trustRoot && PASS_ENABLED ? 'PASS' : 'UNATTESTED';
  }
  if (out.result === 'PASS' && !PASS_ENABLED) { out.result = 'UNATTESTED'; reasons.push('TRUST_ROOT_NOT_CONFIGURED'); }
  out.statement = buildStatement({ trusted, run, iso, pkg, out, claim });
  return out;
}

function buildStatement({ trusted, run, iso, pkg, out, claim }) {
  const fd = (n) => { const b = pkg.files.get(n); return { path: n, sha256: sha(b), bytes: b.length }; };
  return {
    schemaVersion: 's2-attestation-v1', testId: trusted.testId, backend: 'firebase',
    toolchain: { trustedToolchainCommit: trusted.trustedToolchainCommit, adapterCommit: trusted.adapterCommit, verifierCommit: trusted.trustedToolchainCommit, observerCommit: trusted.trustedToolchainCommit, signingPolicyBlob: '0'.repeat(40), isolationPolicyVersion: POLICY_VERSION, sandboxLauncherSha256: run.sandboxLauncherSha256, sandboxPolicyDigest: iso.sandboxPolicyDigest },
    targets: run.targets,
    run: { runId: trusted.runId, runAttempt: trusted.runAttempt, attestationNonce: trusted.attestationNonce, ownershipNonceSha256: run.ownershipNonceSha256, nonceWrittenAt: run.nonceWrittenAt, startedAt: run.startedAt, finishedAt: run.finishedAt },
    package: { artifactId: run.artifactId, packageSha256: trusted.packageSha256, manifestSha256: trusted.manifestSha256, producerJob: 'local-b3a' },
    environment: run.environment,
    isolation: { platformSupported: iso.platformSupported === true, selfCheck: iso.selfCheck, termination: iso.adapterTermination, pathMapDigest: typeof iso.pathMapDigest === 'string' ? iso.pathMapDigest : null },
    artifacts: { traceFront: fd('trace-front.jsonl'), traceBack: fd('trace-back.jsonl'), statePre: fd('state-pre.json'), statePost: fd('state-post.json'), runnerLog: fd('runner-log.jsonl'), evidenceFiles: [fd('adapter-claim.json'), fd('isolation.json'), fd('run.json')] },
    reconciliation: out.reconciliation,
    observed: { canonical: out.observedCanonical, canonicalDigest: out.observedCanonical ? sha(stableJson(out.observedCanonical)) : null, blockedFields: out.contract?.blockedFields?.fields || [] },
    adapterClaimedCanonical: claim?.canonical ?? null,
    verdict: { result: out.result, reasons: out.reasons.map((r) => r.split(':')[0]).filter((r, i, a) => a.indexOf(r) === i), verifiedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
  };
}
