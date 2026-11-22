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

export const SUITE_VERSION = 's2-attack-suite-v1';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const codesOf = (r) => [...new Set((r.report?.reasons || []).map((x) => String(x).split(':')[0]))];
const vOut = (r) => `${r.result} [${codesOf(r).join(',')}]`;

/** @param io {
 *   env,                    // GITHUB_* of the verify job
 *   head, workflowBlob, policy, caseSpecs, now,
 *   a14: { outputs: {testId, artifactId, packageSha256, manifestSha256, attestationNonce, platformSupported, toolchainCommit}, scenario,
 *          pkg: () => [{name,isFile}], read: (name) => Buffer,
 *          decoy: { artifactId, list, read } | null,
 *          sameName: { uploadOutcome, artifactId, list, read },
 *          foreign: { artifactId, downloadOutcome, list, read },
 *          previous: { bytes: Buffer | null, reason } },
 *   a4: { outputs: {...same keys..., trustedTreesUnchanged}, scenario, pkg, read } | null } */
export function runAttackVerify(io) {
  const base = { GITHUB_ACTIONS: io.env.GITHUB_ACTIONS, RUNNER_ENVIRONMENT: io.env.RUNNER_ENVIRONMENT, GITHUB_RUN_ID: io.env.GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT: io.env.GITHUB_RUN_ATTEMPT,
    CMN_STAGE1_ANCHOR_SHA256: io.env.CMN_STAGE1_ANCHOR_SHA256, CMN_S2_TRUSTED_TOOLCHAIN_SHA: io.env.CMN_S2_TRUSTED_TOOLCHAIN_SHA, CMN_S2_SIGNING_POLICY_BLOB: io.env.CMN_S2_SIGNING_POLICY_BLOB };
  const expEnv = (o, scenario, over = {}) => ({ ...base, EXP_TEST_ID: o.testId, EXP_ARTIFACT_ID: o.artifactId, EXP_PACKAGE_SHA256: o.packageSha256, EXP_MANIFEST_SHA256: o.manifestSha256,
    EXP_ATTESTATION_NONCE: o.attestationNonce, EXP_PLATFORM_SUPPORTED: String(o.platformSupported), EXP_TOOLCHAIN_COMMIT: o.toolchainCommit, EXP_SCENARIO: scenario, ...over });
  const verify = (env, list, read, producerJob = 'attack-execute-a14') => runVerifyJob({ env, head: io.head, workflowBlob: io.workflowBlob, policy: io.policy, caseSpecs: io.caseSpecs, now: io.now, listDownload: list, readDownload: read, producerJob });
  const one = (name) => () => [{ name, isFile: true }];
  const S = [];
  const add = (id, o) => S.push({ id, ...o });
  const blockedWith = (r, code) => r.result === 'BLOCKED' && codesOf(r).includes(code);

  // ---------------------------------------------------------------- A14 positive control (correct ID)
  const a = io.a14; const expName = `package-${a.outputs.testId}.tar`;
  const pos = verify(expEnv(a.outputs, a.scenario), a.pkg, a.read);
  const posOk = pos.result === 'UNATTESTED' && codesOf(pos).includes('SCENARIO_NOT_HONEST') && codesOf(pos).includes('TRUST_ROOT_NOT_CONFIGURED');
  add('A14-positive', { testOutcome: posOk ? 'CONTROL_OK' : 'CONTROL_FAILED', platformOutcome: 'DOWNLOADED', verifierOutcome: vOut(pos), expected: 'UNATTESTED incl. TRUST_ROOT_NOT_CONFIGURED, SCENARIO_NOT_HONEST' });

  // ---------------------------------------------------------------- A14-1 decoy in the same run (other file name)
  if (!a.decoy) add('A14-1', { testOutcome: 'NOT_RUN', platformOutcome: 'DECOY_NOT_UPLOADED', verifierOutcome: 'NOT_REACHED', notRunReason: 'decoy upload failed or not given' });
  else { const r = verify(expEnv(a.outputs, a.scenario, { EXP_ARTIFACT_ID: a.decoy.artifactId }), a.decoy.list, a.decoy.read);
    add('A14-1', { testOutcome: blockedWith(r, 'ARTIFACT_SELECTION_MISMATCH') ? 'DEFENDED' : 'BREACHED', platformOutcome: 'DOWNLOADED', verifierOutcome: vOut(r), expected: 'BLOCKED ARTIFACT_SELECTION_MISMATCH' }); }

  // ---------------------------------------------------------------- A14-2 same-name upload (→ A14-1b if the platform accepted it)
  const sn = a.sameName || {};
  if (sn.uploadOutcome === 'failure') add('A14-2', { testOutcome: 'DEFENDED', platformOutcome: 'UPLOAD_REJECTED', verifierOutcome: 'NOT_REACHED', expected: 'platform rejects a second artifact with the same name (overwrite: false)' });
  else if (sn.uploadOutcome === 'success' && /^[0-9]{1,20}$/.test(sn.artifactId || '') && sn.list) {
    const r = verify(expEnv(a.outputs, a.scenario, { EXP_ARTIFACT_ID: sn.artifactId }), sn.list, sn.read);
    add('A14-2', { testOutcome: 'INCONCLUSIVE', platformOutcome: 'UPLOAD_ACCEPTED', verifierOutcome: 'NOT_REACHED', note: 'platform accepted the same name; see A14-1b' });
    add('A14-1b', { testOutcome: blockedWith(r, 'PACKAGE_DIGEST_MISMATCH') ? 'DEFENDED' : 'BREACHED', platformOutcome: 'UPLOAD_ACCEPTED', verifierOutcome: vOut(r), expected: 'BLOCKED PACKAGE_DIGEST_MISMATCH' });
  } else add('A14-2', { testOutcome: 'NOT_RUN', platformOutcome: `UPLOAD_${String(sn.uploadOutcome || 'unknown').toUpperCase()}`, verifierOutcome: 'NOT_REACHED', notRunReason: 'same-name upload step did not run' });

  // ---------------------------------------------------------------- A14-3a another run's artifact ID, downloaded in THIS run
  const f = a.foreign || {};
  if (!/^[0-9]{1,20}$/.test(f.artifactId || '')) add('A14-3a', { testOutcome: 'NOT_RUN', platformOutcome: 'NOT_ATTEMPTED', verifierOutcome: 'NOT_REACHED', notRunReason: 'previous artifact ID not given' });
  else if (f.downloadOutcome === 'failure') add('A14-3a', { testOutcome: 'DEFENDED', platformOutcome: 'DOWNLOAD_NOT_FOUND', verifierOutcome: 'NOT_REACHED', expected: 'download-artifact finds no such artifact in this run' });
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

  const control = S.find((s) => s.id === 'A14-positive').testOutcome === 'CONTROL_OK';
  const judged = S.filter((s) => !['A14-positive'].includes(s.id));
  const overall = !control ? 'INCONCLUSIVE' : judged.some((s) => s.testOutcome === 'BREACHED') ? 'BREACHED' : judged.some((s) => s.testOutcome === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'DEFENDED_WHERE_RUN';
  return { suiteVersion: SUITE_VERSION, overall, notRun: judged.filter((s) => s.testOutcome === 'NOT_RUN').map((s) => s.id), scenarios: S, unsigned: true, notice: 'UNSIGNED DIAGNOSTIC — attack acceptance, never an attestation.' };
}
