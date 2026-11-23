/** A14 / A4 hosted acceptance — verify side (TRUSTED TOOLCHAIN, C-1). Attack-acceptance plan v0.4 §1.9, §3, §4.1.
 *  Pure function over injected I/O (scripts/attack-verify.mjs is the thin CLI in attest-attack.yml's
 *  verify-attack job, which has NO id-token / attestations permission). Every Verifier call goes through
 *  runVerifyJob() — the same code path as attest.yml — with the trusted inputs of the scenario.
 *  Each scenario records three layers:
 *   testOutcome      DEFENDED | BREACHED | INCONCLUSIVE | NOT_RUN | CONTROL_OK | CONTROL_FAILED
 *   platformOutcome  e.g. DOWNLOADED, UPLOAD_REJECTED, UPLOAD_ACCEPTED, DOWNLOAD_NOT_FOUND, HARNESS
 *   verifierOutcome  "<result> [<reason codes>]" or NOT_REACHED
 *  Only safe diagnostics are returned (codes, digests, IDs) — never statements or package content. */
import { createHash } from 'node:crypto';
import { runVerifyJob } from './attest-verify.mjs';
import { readPackageSafe, writePackage } from './package.mjs';

export const SUITE_VERSION = 's2-attack-suite-v4';   // v4: PR14-REV001 — a failed original-ID download is attributed to shadowing only with evidence   // v3: same-name stage AFTER the main verification (hosted run 45088076830: the platform accepted the
                                                   // same-name upload and the newer artifact shadowed the original ID for download-artifact)   // v2: C1-REV001 — a failed platform step is never DEFENDED by itself

/** Platform error lines of a job log ("##[error]" lines only), bounded — kept for the reviewer and for the
 *  conflict check. Never contains secrets: the same-name job has no token and handles only random bytes. */
export function errorLines(logText) {
  if (typeof logText !== 'string') return [];
  return logText.split('\n').filter((l) => l.includes('##[error]')).map((l) => l.replace(/^\S+Z\s+/, '').slice(0, 300)).slice(0, 10);
}
/** Conflict evidence for A14-2: the platform said so (HTTP 409 / conflict) — the action outcome alone is not enough. */
/** R3 (C1-REV001): converts the repository-scoped artifact lookup into platform evidence. Every identity field
 *  keeps an explicit UNKNOWN (null) unless the API returned it with the right type: `expired` only as a real
 *  boolean, the owning run only as a decimal ID. A 200 alone is never "belongs to another run". */
export function foreignEvidenceFrom(artifactId, status, body) {
  const ok = status === 200 && body !== null && typeof body === 'object';
  const rid = ok && body.workflow_run && typeof body.workflow_run === 'object' ? body.workflow_run.id : undefined;
  return { artifactId: String(artifactId), status: Number.isInteger(status) ? status : null,
    expired: ok && typeof body.expired === 'boolean' ? body.expired : null,
    runId: (typeof rid === 'number' && Number.isSafeInteger(rid) && rid > 0) || (typeof rid === 'string' && /^[1-9][0-9]{0,19}$/.test(rid)) ? String(rid) : null,
    name: ok && typeof body.name === 'string' ? body.name : null };
}
const RUN_ID_RE = /^[1-9][0-9]{0,19}$/;
/** PR14-REV001: the download-artifact error that identifies the shadowing seen in hosted run 45088076830 (the ID is
 *  absent from the run's de-duplicated list). Any other failure (timeout, 5xx, 401/403, unknown) is NOT shadowing. */
export const saysIdNotFound = (lines) => Array.isArray(lines) && lines.some((l) => typeof l === 'string' && /None of the provided artifact IDs were found/.test(l));
export const saysConflict = (lines) => lines.some((l) => /\b409\b/.test(l) && /conflict/i.test(l));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const codesOf = (r) => [...new Set((r.report?.reasons || []).map((x) => String(x).split(':')[0]))];
const vOut = (r) => `${r.result} [${codesOf(r).join(',')}]`;

/** C1-REV001 platform evidence (from a trusted step of the verify job, via the GitHub API):
 *   io.platform = { artifactsOk: bool, artifacts: [{ id, name }] (this run), sameNameErrorLines: string[], sameNameControlOutcome,
 *                   foreign: { artifactId, status (HTTP; 200 / 404 / other), expired, runId (owning workflow run) } | null }
 *  @param io {
 *   env,                    // GITHUB_* of the verify job
 *   head, workflowBlob, policy, caseSpecs, now,
 *   a14: { outputs: {testId, artifactId, packageSha256, manifestSha256, attestationNonce, platformSupported, toolchainCommit}, scenario,
 *          pkg: () => [{name,isFile}], read: (name) => Buffer,
 *          decoy: { artifactId, list, read } | null,
 *          sameName: { uploadOutcome, artifactId, list, read },
 *          foreign: { artifactId, downloadOutcome, list, read },
 *          previous: { bytes: Buffer | null, reason } },
 *   a4: { outputs: {...same keys..., trustedTreesUnchanged}, scenario, pkg, read } | null } */
function makeVerifier(io) {
  const base = { GITHUB_ACTIONS: io.env.GITHUB_ACTIONS, RUNNER_ENVIRONMENT: io.env.RUNNER_ENVIRONMENT, GITHUB_RUN_ID: io.env.GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT: io.env.GITHUB_RUN_ATTEMPT,
    CMN_STAGE1_ANCHOR_SHA256: io.env.CMN_STAGE1_ANCHOR_SHA256, CMN_S2_TRUSTED_TOOLCHAIN_SHA: io.env.CMN_S2_TRUSTED_TOOLCHAIN_SHA, CMN_S2_SIGNING_POLICY_BLOB: io.env.CMN_S2_SIGNING_POLICY_BLOB };
  const expEnv = (o, scenario, over = {}) => ({ ...base, EXP_TEST_ID: o.testId, EXP_ARTIFACT_ID: o.artifactId, EXP_PACKAGE_SHA256: o.packageSha256, EXP_MANIFEST_SHA256: o.manifestSha256,
    EXP_ATTESTATION_NONCE: o.attestationNonce, EXP_PLATFORM_SUPPORTED: String(o.platformSupported), EXP_TOOLCHAIN_COMMIT: o.toolchainCommit, EXP_SCENARIO: scenario, ...over });
  const verify = (env, list, read, producerJob = 'attack-execute-a14') => runVerifyJob({ env, head: io.head, workflowBlob: io.workflowBlob, policy: io.policy, caseSpecs: io.caseSpecs, now: io.now, listDownload: list, readDownload: read, producerJob });
  return { expEnv, verify };
}
const one = (name) => () => [{ name, isFile: true }];
const blockedWith = (r, code) => r.result === 'BLOCKED' && codesOf(r).includes(code);
const summarize = (S, stage, controlId) => {
  const control = !controlId || S.find((s) => s.id === controlId)?.testOutcome === 'CONTROL_OK';
  const judged = S.filter((s) => s.id !== controlId);
  const overall = !control ? 'INCONCLUSIVE' : judged.some((s) => s.testOutcome === 'BREACHED') ? 'BREACHED' : judged.some((s) => s.testOutcome === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'DEFENDED_WHERE_RUN';
  return { suiteVersion: SUITE_VERSION, stage, overall, notRun: judged.filter((s) => s.testOutcome === 'NOT_RUN').map((s) => s.id), findings: S.filter((s) => s.finding).map((s) => ({ id: s.id, finding: s.finding })), scenarios: S, unsigned: true, notice: 'UNSIGNED DIAGNOSTIC — attack acceptance, never an attestation.' };
};

/** MAIN stage — runs BEFORE the same-name upload exists (verify-attack job): positive control, A14-1, A14-3a/3b,
 *  A4-1/2/3. A14-2 / A14-1b / A14-2s are judged later by runSameNameVerify(). */
export function runAttackVerify(io) {
  const { expEnv, verify } = makeVerifier(io);
  const S = [];
  const add = (id, o) => S.push({ id, ...o });

  // ---------------------------------------------------------------- A14 positive control (correct ID)
  const a = io.a14; const expName = `package-${a.outputs.testId}.tar`;
  const pos = verify(expEnv(a.outputs, a.scenario), a.pkg, a.read);
  const posOk = pos.result === 'UNATTESTED' && codesOf(pos).includes('SCENARIO_NOT_HONEST') && codesOf(pos).includes('TRUST_ROOT_NOT_CONFIGURED');
  add('A14-positive', { testOutcome: posOk ? 'CONTROL_OK' : 'CONTROL_FAILED', platformOutcome: 'DOWNLOADED', verifierOutcome: vOut(pos), expected: 'UNATTESTED incl. TRUST_ROOT_NOT_CONFIGURED, SCENARIO_NOT_HONEST' });

  // ---------------------------------------------------------------- A14-1 decoy in the same run (other file name)
  if (!a.decoy) add('A14-1', { testOutcome: 'NOT_RUN', platformOutcome: 'DECOY_NOT_UPLOADED', verifierOutcome: 'NOT_REACHED', notRunReason: 'decoy upload failed or not given' });
  else { const r = verify(expEnv(a.outputs, a.scenario, { EXP_ARTIFACT_ID: a.decoy.artifactId }), a.decoy.list, a.decoy.read);
    add('A14-1', { testOutcome: blockedWith(r, 'ARTIFACT_SELECTION_MISMATCH') ? 'DEFENDED' : 'BREACHED', platformOutcome: 'DOWNLOADED', verifierOutcome: vOut(r), expected: 'BLOCKED ARTIFACT_SELECTION_MISMATCH' }); }

  const pf = io.platform || {};
  const listed = pf.artifactsOk === true && Array.isArray(pf.artifacts) ? pf.artifacts : null;

  // ---------------------------------------------------------------- A14-3a another run's artifact ID, downloaded in THIS run
  const f = a.foreign || {};
  if (!/^[0-9]{1,20}$/.test(f.artifactId || '')) add('A14-3a', { testOutcome: 'NOT_RUN', platformOutcome: 'NOT_ATTEMPTED', verifierOutcome: 'NOT_REACHED', notRunReason: 'previous artifact ID not given' });
  else if (f.downloadOutcome === 'failure') {
    // R2 (C1-REV001): the input must first be shown to BE a valid artifact of ANOTHER run of this repository
    // (API lookup by ID on this repository: exists, not expired, owning run ≠ this run, = the given previous run).
    // Only then does "this run's listing (read successfully) does not contain it" + the failed download count.
    const fa = pf.foreign && String(pf.foreign.artifactId) === String(f.artifactId) ? pf.foreign : null;
    const inRun = listed ? listed.some((x) => String(x.id) === String(f.artifactId)) : null;
    const evidence = { artifactsListed: !!listed, idInThisRun: inRun, lookup: fa ? { status: fa.status, expired: fa.expired ?? null, ownerRunId: fa.runId ?? null } : null, givenPreviousRunId: f.previousRunId || null, crossRunDownload: f.crossRunDownload ?? null };
    const thisRun = String(io.env.GITHUB_RUN_ID);
    if (!fa || ![200, 404].includes(fa.status)) add('A14-3a', { testOutcome: 'INCONCLUSIVE', platformOutcome: 'FOREIGN_ARTIFACT_UNVERIFIED', verifierOutcome: 'NOT_REACHED', manualReview: 'the foreign artifact could not be looked up: it is unknown whether a valid cross-run artifact was tested', evidence });
    else if (fa.status === 404 || fa.expired === true) add('A14-3a', { testOutcome: 'NOT_RUN', platformOutcome: 'FOREIGN_ARTIFACT_INVALID', verifierOutcome: 'NOT_REACHED', notRunReason: fa.status === 404 ? 'the given artifact ID does not exist in this repository (or was deleted)' : 'the given artifact has expired', evidence });
    // R3: required identity fields must be PRESENT and well-formed — unknown is never "valid, other run"
    else if (fa.expired !== false || typeof fa.runId !== 'string' || !RUN_ID_RE.test(fa.runId)) add('A14-3a', { testOutcome: 'INCONCLUSIVE', platformOutcome: 'FOREIGN_ARTIFACT_UNVERIFIED', verifierOutcome: 'NOT_REACHED', manualReview: 'the lookup did not establish the artifact\'s expiry and owning run (missing or malformed fields)', evidence });
    else if (String(fa.runId) === thisRun) add('A14-3a', { testOutcome: 'INCONCLUSIVE', platformOutcome: 'FOREIGN_ARTIFACT_IS_THIS_RUN', verifierOutcome: 'NOT_REACHED', manualReview: 'the given artifact belongs to THIS run — not a cross-run test', evidence });
    else if (f.previousRunId && String(fa.runId) !== String(f.previousRunId)) add('A14-3a', { testOutcome: 'NOT_RUN', platformOutcome: 'FOREIGN_ARTIFACT_RUN_MISMATCH', verifierOutcome: 'NOT_REACHED', notRunReason: 'the artifact does not belong to the given previousRunId', evidence });
    else if (listed && inRun === false) add('A14-3a', { testOutcome: 'DEFENDED', platformOutcome: 'DOWNLOAD_NOT_FOUND_IN_RUN', verifierOutcome: 'NOT_REACHED', expected: 'a valid artifact of another run is not downloadable in this run', evidence });
    else add('A14-3a', { testOutcome: 'INCONCLUSIVE', platformOutcome: 'DOWNLOAD_FAILED_REASON_UNVERIFIED', verifierOutcome: 'NOT_REACHED', manualReview: 'the run artifact listing was unavailable, or the ID IS in this run: the failure reason is not established', evidence });
  }
  else if (f.downloadOutcome === 'success' && f.list) {
    const r = verify(expEnv(a.outputs, a.scenario, { EXP_ARTIFACT_ID: f.artifactId }), f.list, f.read);
    add('A14-3a', { testOutcome: r.result === 'BLOCKED' ? 'DEFENDED' : 'BREACHED', platformOutcome: 'DOWNLOADED_FOREIGN', verifierOutcome: vOut(r), expected: 'BLOCKED (selection / digest)' });
  } else add('A14-3a', { testOutcome: 'NOT_RUN', platformOutcome: `DOWNLOAD_${String(f.downloadOutcome || 'unknown').toUpperCase()}`, verifierOutcome: 'NOT_REACHED', notRunReason: 'download step did not run' });

  // ---------------------------------------------------------------- A14-3b another run's package bytes (controlled harness)
  const prev = a.previous || {};
  if (!Buffer.isBuffer(prev.bytes)) {
    for (const id of ['A14-3b-i', 'A14-3b-ii']) add(id, { testOutcome: 'NOT_RUN', platformOutcome: 'HARNESS', verifierOutcome: 'NOT_REACHED', notRunReason: prev.reason || 'previous package not available (not given or expired)' });
  } else {
    const r1 = verify(expEnv(a.outputs, a.scenario), one(expName), () => prev.bytes);
    add('A14-3b-i', { testOutcome: blockedWith(r1, 'PACKAGE_DIGEST_MISMATCH') ? 'DEFENDED' : 'BREACHED', platformOutcome: 'HARNESS', verifierOutcome: vOut(r1), expected: 'outer digests unchanged → BLOCKED PACKAGE_DIGEST_MISMATCH', previousPackageSha256: sha(prev.bytes) });
    let man = null; try { man = readPackageSafe(prev.bytes).manifestSha256; } catch { /* */ }
    if (!man) add('A14-3b-ii', { testOutcome: 'NOT_RUN', platformOutcome: 'HARNESS', verifierOutcome: 'NOT_REACHED', notRunReason: 'previous package does not parse; outer digests cannot be synchronised' });
    else { const r2 = verify(expEnv(a.outputs, a.scenario, { EXP_PACKAGE_SHA256: sha(prev.bytes), EXP_MANIFEST_SHA256: man }), one(expName), () => prev.bytes);
      add('A14-3b-ii', { testOutcome: blockedWith(r2, 'RUN_BINDING_MISMATCH') ? 'DEFENDED' : 'BREACHED', platformOutcome: 'HARNESS', verifierOutcome: vOut(r2), expected: 'outer digests synchronised to the old package → BLOCKED RUN_BINDING_MISMATCH' }); }
  }

  // ---------------------------------------------------------------- A4-2 package-level injection of verifier.mjs (controlled harness)
  const own = a.read(expName);
  const files = Object.fromEntries([...readPackageSafe(own).files].filter(([n]) => n !== 'manifest.json'));
  const inj = writePackage({ ...files, 'verifier.mjs': Buffer.from('export const PASS_ENABLED = true;\n') });
  const i1 = verify(expEnv(a.outputs, a.scenario), one(expName), () => inj.packageBytes);
  add('A4-2-i', { testOutcome: blockedWith(i1, 'PACKAGE_DIGEST_MISMATCH') ? 'DEFENDED' : 'BREACHED', platformOutcome: 'HARNESS', verifierOutcome: vOut(i1), expected: 'outer digests unchanged → BLOCKED PACKAGE_DIGEST_MISMATCH' });
  const i2 = verify(expEnv(a.outputs, a.scenario, { EXP_PACKAGE_SHA256: inj.packageSha256, EXP_MANIFEST_SHA256: inj.manifestSha256 }), one(expName), () => inj.packageBytes);
  add('A4-2-ii', { testOutcome: blockedWith(i2, 'PAYLOAD_SET_MISMATCH') ? 'DEFENDED' : 'BREACHED', platformOutcome: 'HARNESS', verifierOutcome: vOut(i2), expected: 'outer digests synchronised → BLOCKED PAYLOAD_SET_MISMATCH (the injected file is never executed)' });

  // ---------------------------------------------------------------- A4-1 toolchain tamper from inside the sandbox (hosted package)
  if (!io.a4) add('A4-1', { testOutcome: 'NOT_RUN', platformOutcome: 'NOT_ATTEMPTED', verifierOutcome: 'NOT_REACHED', notRunReason: 'A4-1 execute job produced no package' });
  else { const r = verify(expEnv(io.a4.outputs, io.a4.scenario), io.a4.pkg, io.a4.read, 'attack-execute-a4');
    const okV = r.result === 'UNATTESTED' && codesOf(r).includes('SCENARIO_NOT_HONEST') && r.report?.contract?.adapterClaimAgreesWithObserver === false && r.report?.verifierVersion !== 's2-verifier-FAKE-9';
    const trees = io.a4.outputs.trustedTreesUnchanged === true;
    add('A4-1', { testOutcome: okV && trees ? 'DEFENDED' : (!trees || r.result === 'PASS' || r.report?.verifierVersion === 's2-verifier-FAKE-9') ? 'BREACHED' : 'INCONCLUSIVE', platformOutcome: `TRUSTED_TREES_${trees ? 'UNCHANGED' : 'CHANGED'}`, verifierOutcome: vOut(r), expected: 'UNATTESTED (attack scenario), claim disagrees with the Observer, real Verifier version, trees unchanged' }); }

  // ---------------------------------------------------------------- A4-3 the verify job runs the trusted toolchain only
  const a43 = io.head === a.outputs.toolchainCommit && (!io.a4 || io.head === io.a4.outputs.toolchainCommit);
  add('A4-3', { testOutcome: a43 ? 'DEFENDED' : 'BREACHED', platformOutcome: 'CHECKOUT', verifierOutcome: 'NOT_REACHED', expected: 'verify-job checkout SHA = trusted toolchain commit of the execute jobs (structure: tests/repo_policy.test.mjs)', verifyHead: io.head });

  return summarize(S, 'main', 'A14-positive');
}

/** SAME-NAME stage — runs AFTER the main stage has downloaded and judged everything (verify-same-name job).
 *  io = { env, head, workflowBlob, policy, caseSpecs, now,
 *         a14: { outputs, scenario },
 *         sameName: { uploadOutcome, artifactId, list, read },            // the second artifact of the same name
 *         original: { downloadOutcome, list, read },                       // the ORIGINAL ID downloaded again, now
 *         platform: { artifactsOk, artifacts (this run, from the API), sameNameErrorLines, sameNameControlOutcome,
 *                     probeOriginalOutcome, probeOriginalErrorLines } }   // PR14-REV001: probe-original job (same download, own log)
 *  Three questions, three scenarios:
 *   A14-2  platform layer: is a second artifact of the same name rejected? (rejection needs checkable conflict
 *          evidence; an ACCEPTED upload is recorded as a finding, not as a Verifier breach)
 *   A14-1b Verifier layer: the same-named substitute, fetched by ITS ID, must be BLOCKED (PACKAGE_DIGEST_MISMATCH)
 *   A14-2s availability / integrity of the ORIGINAL ID after shadowing: re-downloading it must either return the
 *          sealed bytes (digest = packageSha256) or fail (fail closed) while the API still lists the original —
 *          it must NEVER return other bytes. */
export function runSameNameVerify(io) {
  const { expEnv, verify } = makeVerifier(io);
  const S = []; const add = (id, o) => S.push({ id, ...o });
  const a = io.a14; const expName = `package-${a.outputs.testId}.tar`;
  const sn = io.sameName || {}; const pf = io.platform || {}; const og = io.original || {};
  const listed = pf.artifactsOk === true && Array.isArray(pf.artifacts) ? pf.artifacts : null;
  const sameNamed = listed ? listed.filter((x) => x.name === expName).map((x) => String(x.id)) : null;
  const evidence = { controlUpload: pf.sameNameControlOutcome ?? null, platformErrorLines: pf.sameNameErrorLines || [], artifactsListed: !!listed, sameNamedArtifactIds: sameNamed };
  const accepted = sn.uploadOutcome === 'success' && /^[0-9]{1,20}$/.test(sn.artifactId || '');
  if (sn.uploadOutcome === 'failure') {
    const ok = pf.sameNameControlOutcome === 'success' && saysConflict(pf.sameNameErrorLines || []) && !!sameNamed && sameNamed.length === 1 && sameNamed[0] === String(a.outputs.artifactId);
    add('A14-2', ok
      ? { testOutcome: 'DEFENDED', platformOutcome: 'UPLOAD_REJECTED_CONFLICT', verifierOutcome: 'NOT_REACHED', expected: 'platform rejects a second artifact with the same name (overwrite: false)', evidence }
      : { testOutcome: 'INCONCLUSIVE', platformOutcome: 'UPLOAD_FAILED_REASON_UNVERIFIED', verifierOutcome: 'NOT_REACHED', manualReview: 'check the same-name job log: the failure must be the name conflict, not a network / service / permission error', evidence });
  } else if (accepted) {
    // the platform accepted it: a recorded platform FINDING (the plan expected a rejection); the Verifier layer is
    // judged by A14-1b and the original ID by A14-2s. Accepted only counts as "accepted" with the API listing both.
    const both = !!sameNamed && sameNamed.includes(String(a.outputs.artifactId)) && sameNamed.includes(String(sn.artifactId));
    add('A14-2', both
      ? { testOutcome: 'PLATFORM_ACCEPTED', platformOutcome: 'UPLOAD_ACCEPTED_SAME_NAME', verifierOutcome: 'NOT_REACHED', finding: 'the platform accepts a second artifact with the same name in one run (overwrite: false did not reject it)', evidence }
      : { testOutcome: 'INCONCLUSIVE', platformOutcome: 'UPLOAD_ACCEPTED_UNVERIFIED', verifierOutcome: 'NOT_REACHED', manualReview: 'the upload step succeeded but the run listing does not show both artifacts', evidence });
  } else add('A14-2', { testOutcome: 'NOT_RUN', platformOutcome: `UPLOAD_${String(sn.uploadOutcome || 'unknown').toUpperCase()}`, verifierOutcome: 'NOT_REACHED', notRunReason: 'same-name upload step did not run' });

  // A14-1b: the substitute by its own ID
  if (!accepted) add('A14-1b', { testOutcome: 'NOT_RUN', platformOutcome: 'NO_SECOND_ARTIFACT', verifierOutcome: 'NOT_REACHED', notRunReason: 'the platform did not accept a same-named artifact' });
  else if (!sn.list) add('A14-1b', { testOutcome: 'INCONCLUSIVE', platformOutcome: 'SUBSTITUTE_NOT_DOWNLOADED', verifierOutcome: 'NOT_REACHED', manualReview: 'the accepted same-named artifact could not be downloaded by its ID' });
  else { const r = verify(expEnv(a.outputs, a.scenario, { EXP_ARTIFACT_ID: sn.artifactId }), sn.list, sn.read);
    add('A14-1b', { testOutcome: blockedWith(r, 'PACKAGE_DIGEST_MISMATCH') ? 'DEFENDED' : 'BREACHED', platformOutcome: 'SUBSTITUTE_DOWNLOADED_BY_ITS_ID', verifierOutcome: vOut(r), expected: 'BLOCKED PACKAGE_DIGEST_MISMATCH' }); }

  // A14-2s: the ORIGINAL ID after shadowing
  if (!accepted) add('A14-2s', { testOutcome: 'NOT_RUN', platformOutcome: 'NO_SHADOWING', verifierOutcome: 'NOT_REACHED', notRunReason: 'no same-named artifact exists' });
  else if (og.downloadOutcome === 'success' && og.list) {
    const files = og.list().filter((e) => e.isFile);
    const bytes = files.length === 1 ? og.read(files[0].name) : null;
    const same = !!bytes && sha(bytes) === a.outputs.packageSha256;
    add('A14-2s', same
      ? { testOutcome: 'DEFENDED', platformOutcome: 'ORIGINAL_STILL_DOWNLOADABLE', verifierOutcome: 'NOT_REACHED', expected: 'the original ID returns the sealed bytes or fails — never other bytes' }
      : { testOutcome: 'BREACHED', platformOutcome: 'ORIGINAL_ID_RETURNED_OTHER_BYTES', verifierOutcome: 'NOT_REACHED', expected: 'the original ID returns the sealed bytes or fails — never other bytes', evidence: { files: files.length, sha256: bytes ? sha(bytes) : null } });
  } else if (og.downloadOutcome === 'failure') {
    // The judged proposition is LIMITED: the original ID returned the sealed bytes or NO bytes (never other bytes).
    // A failure says nothing about its cause. PR14-REV001: shadowing is recorded only when the probe-original job's own
    // log shows the ID-not-found error, that job also failed, and the listing shows BOTH same-named IDs.
    const stillListed = !!sameNamed && sameNamed.includes(String(a.outputs.artifactId));
    const probeLines = Array.isArray(pf.probeOriginalErrorLines) ? pf.probeOriginalErrorLines : [];
    const attributed = stillListed && sameNamed.includes(String(sn.artifactId)) && pf.probeOriginalOutcome === 'failure' && saysIdNotFound(probeLines);
    const evidence = { artifactsListed: !!listed, originalStillListed: listed ? stillListed : null, probeOriginalOutcome: pf.probeOriginalOutcome ?? null, probeOriginalErrorLines: probeLines, causeVerified: attributed };
    const expected = 'the original ID returns the sealed bytes or fails — never other bytes';
    if (!stillListed) add('A14-2s', { testOutcome: 'INCONCLUSIVE', platformOutcome: 'ORIGINAL_DOWNLOAD_FAILED_UNVERIFIED', verifierOutcome: 'NOT_REACHED', manualReview: 'the original ID failed to download and the listing does not confirm it still exists', evidence });
    else if (attributed) add('A14-2s', { testOutcome: 'DEFENDED', platformOutcome: 'ORIGINAL_ID_SHADOWED_FAIL_CLOSED', verifierOutcome: 'NOT_REACHED', expected, finding: 'a newer same-named artifact makes the original ID undownloadable for download-artifact (availability impact; fails closed) — attributed by the probe-original log', evidence });
    else add('A14-2s', { testOutcome: 'DEFENDED', platformOutcome: 'ORIGINAL_DOWNLOAD_FAILED_CAUSE_UNVERIFIED', verifierOutcome: 'NOT_REACHED', expected, note: 'no bytes were returned (the limited proposition holds); the CAUSE of the failure is not established — not recorded as shadowing', evidence });
  } else add('A14-2s', { testOutcome: 'NOT_RUN', platformOutcome: `ORIGINAL_DOWNLOAD_${String(og.downloadOutcome || 'unknown').toUpperCase()}`, verifierOutcome: 'NOT_REACHED', notRunReason: 'original re-download step did not run' });

  return summarize(S, 'same-name', null);
}
