#!/usr/bin/env node
/** S2-B2 batch 3a: sandboxed Adapter runs + local attack tests on the REAL emulators. Runs only inside
 *  `firebase emulators:exec` (scripts/run-b3.mjs), as root on Linux. Everything here is a LOCAL, UNTRUSTED
 *  prototype: no signing, no trust root, no hosted runner → the best possible result is UNATTESTED. */
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, chmodSync, existsSync, appendFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalConfig } from '../src/local-guard.mjs';
import { firestoreClient, authClient, EMULATOR_OWNER } from '../src/emu-client.mjs';
import { MARKER_COLLECTION, assertNonce, assertFreshEmulator, assertStillOwned } from '../src/ownership.mjs';
import { loadFixtures, STAGE1_ROOT } from '../src/seed.mjs';
import { makeMasker, findLeaks } from '../src/mask.mjs';
import { fixtureNames } from '../src/world.mjs';
import { createHarness } from '../src/harness.mjs';
import { sandboxConfig, configDigest, POLICY_VERSION, pathMapDigest } from '../src/b3/isolation-policy.mjs';
import { launchSandbox, cleanupSandboxDirs, resolvePathMap } from '../src/b3/sandbox.mjs';
import { runSelfCheck } from '../src/b3/selfcheck-host.mjs';
import { writePackage } from '../src/b3/package.mjs';
import { buildCaseInput } from '../src/b3/case-input.mjs';
import { verifyPackage, PAYLOAD, CASE_ACTORS } from '../src/b3/verifier.mjs';
import { stableJson, sha256Hex } from '../src/stable.mjs';
import { executeCase } from '../../stage1/src/runner.mjs';
import { createFixtureHash } from '../../stage1/src/common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPO = path.resolve(ROOT, '../..');
// B3b: single-case mode for the attest.yml execute job (one honest case, sealed package, no attack scenarios)
const SINGLE = process.env.B3_SINGLE_CASE || null;
const OUT_DIR = process.env.B3_OUT_DIR || null;
if (SINGLE && !['POC-001', 'POC-002', 'POC-008', 'POC-009'].includes(SINGLE)) throw new Error(`B3_SINGLE_CASE: unsupported ${SINGLE}`);
if (SINGLE && !OUT_DIR) throw new Error('B3_SINGLE_CASE needs B3_OUT_DIR');
/** Reported runner kind (evidence only; the Verifier's trusted runnerKind comes from the VERIFY job's own environment). */
const RUNNER_KIND = process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' ? 'github-hosted' : 'local-untrusted';
const cfgE = assertLocalConfig(process.env, { firebaseJsonPath: path.join(ROOT, 'firebase.json') });
const ownNonce = assertNonce(process.env.RUN_NONCE);
const fsc = firestoreClient(cfgE); const au = authClient(cfgE);
const rc = await fsc.listRootCollections(EMULATOR_OWNER); const ac0 = await au.countAccounts();
assertFreshEmulator({ rootCollections: rc.status === 200 ? (rc.json?.collectionIds || []) : null, authAccounts: ac0.status === 200 ? Number(ac0.json?.recordsCount ?? 0) : null });
if ((await fsc.set(`${MARKER_COLLECTION}/${ownNonce}`, { nonce: ownNonce, createdAt: new Date().toISOString() }, EMULATOR_OWNER)).status !== 200) throw new Error('marker');

const { fixtures, fileSha256 } = loadFixtures();
const oracleBytes = readFileSync(path.join(STAGE1_ROOT, 'contracts/canonical-oracles-v1.0.json'));
const caseSpecs = Object.fromEntries(JSON.parse(oracleBytes).cases.map((c) => [c.testId, c]));
const names = fixtureNames(fixtures);
const masker = makeMasker(names);
const h = createHarness({ cfg: cfgE, nonce: ownNonce, fixtures, masker });
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };
const HEAD = git('rev-parse', 'HEAD'); const gitDirty = (git('status', '--porcelain', '--', '.', '../../docs') || '').length > 0;
const anchorDigest = (execFileSync(process.execPath, [path.join(REPO, 'scripts/verify-anchor.mjs'), '--print'], { cwd: REPO, encoding: 'utf8' }).match(/CMN_STAGE1_ANCHOR_SHA256=([0-9a-f]{64})/) || [])[1];
const md5 = (p) => { try { return createHash('md5').update(readFileSync(p)).digest('hex'); } catch { return null; } };
const environment = {
  osImage: (readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/) || [])[1] || 'unknown', node: process.version,
  java: (() => { try { return execFileSync('java', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || ''; } catch (e) { return String(e.stderr || ''); } })().match(/openjdk version "([^"]+)"/)?.[1] || 'unknown',
  firebaseTools: JSON.parse(readFileSync(path.join(ROOT, 'node_modules/firebase-tools/package.json'), 'utf8')).version,
  firestoreJarMd5: md5(path.join(process.env.HOME || '/root', '.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar')) || '0'.repeat(32),
  stage2LockfileSha256: sha256Hex(readFileSync(path.join(ROOT, 'package-lock.json'))), runnerKind: RUNNER_KIND,
};
const launcherSha = sha256Hex(readFileSync(path.join(ROOT, 'src/b3/sandbox.mjs')) + '\n' + readFileSync(path.join(ROOT, 'src/b3/isolation-policy.mjs')));
const runTag = `S2B2B3A-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}-${ownNonce.slice(0, 8)}`;
const runDir = path.join(ROOT, 'evidence', 'runs', 's2b2-b3a', runTag);
mkdirSync(runDir, { recursive: true });
const entryDir = mkdtempSync('/tmp/cmn-e-'); chmodSync(entryDir, 0o755);
const workDir = mkdtempSync('/tmp/cmn-r-');
const outputChannel = path.join(workDir, 'GITHUB_OUTPUT'); writeFileSync(outputChannel, 'runner-private\n');
// B3A-N7 (stronger FS hiding): every one of these must exist on the host and be invisible inside
const nodeInstallDir = path.dirname(path.dirname(realpathSync(process.execPath)));
const hostPaths = {
  evidence: [runDir, path.dirname(runDir)],
  toolchain: [path.join(ROOT, 'src'), path.join(ROOT, 'sandbox-check'), path.join(ROOT, 'test'), path.join(ROOT, 'scripts'), path.join(ROOT, 'node_modules'), path.join(REPO, 'poc/stage1'), path.join(nodeInstallDir, 'lib'), '/etc'],
  git: [path.join(REPO, '.git'), path.join(REPO, '.github')],
};
// every GitHub Actions command file the Runner can see must be invisible inside the sandbox (A10 / OUTPUT_CHANNELS_HIDDEN)
const outputChannels = [outputChannel, ...['GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY', 'GITHUB_STATE'].map((k) => process.env[k]).filter((p) => p && existsSync(p))];
// B3A-N7: node binary only; /usr = USR_BINARIES + ldd closure (copied); digest recorded in isolation.json + statement
const pathMap = process.platform === 'linux' ? resolvePathMap({ nodeBinary: process.execPath, adapterDir: path.join(ROOT, 'adapter-b3'), checkDir: path.join(ROOT, 'sandbox-check'), entryDir }) : null;
let runCounter = Number(BigInt('0x' + ownNonce.slice(0, 8)) % 100000n) * 1000;
const isoSec = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** One attested-style case run (plan §5 T0–T5, §6, §3.4). Options are attack variants (test only). */
async function attestedRun(label, { testId, entry = '/adapter/main.mjs', cfg = sandboxConfig(), startSentinel = true, skipKill = false, duringCase = null, simulateUnsupported = false, attackHints = null } = {}) {
  // hosted single-case runs are bound to the workflow run (the verify job's trusted runId / runAttempt)
  const runId = SINGLE && process.env.GITHUB_RUN_ID ? process.env.GITHUB_RUN_ID : String(++runCounter);
  const runAttempt = SINGLE && process.env.GITHUB_RUN_ATTEMPT ? Number(process.env.GITHUB_RUN_ATTEMPT) : 1;
  const attestationNonce = randomBytes(32).toString('hex');                                     // T0
  const dir = path.join(runDir, label); mkdirSync(dir, { recursive: true });
  const runnerLog = []; const rl = (phase, op) => runnerLog.push({ at: new Date().toISOString(), phase, channel: 'runner', op });
  const startedAt = isoSec();
  rl('setup', 'nonce-generated');
  const users = await h.seedWorld(); rl('setup', 'seed-world');                                 // T1
  const sock = path.join(entryDir, 'front.sock'); rmSync(sock, { force: true });
  const frontFile = path.join(dir, 'trace-front.jsonl'), backFile = path.join(dir, 'trace-back.jsonl');
  const stack = await h.startStack({ frontFile, backFile, frontSocketPath: sock });
  const iso = simulateUnsupported ? { platformSupported: false, reason: 'simulated (A9)', selfCheck: null, sandboxPolicyDigest: configDigest(cfg) }
    : await runSelfCheck({ cfg, pathMap, hostPaths, outputChannels, workDir, startSentinel });
  rl('setup', 'isolation-self-check');
  const inputDir = path.join(workDir, `input-${runId}`); mkdirSync(inputDir, { recursive: true }); chmodSync(inputDir, 0o755);
  // B3A-N8: the Adapter receives ONLY the token of this case's actor (trusted CASE_ACTORS table), never the others
  writeFileSync(path.join(inputDir, 'case.json'), JSON.stringify(buildCaseInput({ testId, fixtures, users, attackHints, caseActors: CASE_ACTORS })));
  chmodSync(path.join(inputDir, 'case.json'), 0o644);
  const caseTokenActors = Object.keys(JSON.parse(readFileSync(path.join(inputDir, 'case.json'), 'utf8')).tokens);   // as written (N8)
  let sbx = null; let ready = false; let doneOk = false; let term = null; let nonceWrittenAt = null; let pre = null; let caseStartedAt = null; let caseEndedAt = null;
  const caseSpec = caseSpecs[testId];
  const sandboxAdapter = { mode: 'BACKEND_REAL', backend: 'firebase', execute: async () => {
    sbx = launchSandbox({ cfg, pathMap: { ...pathMap, inputDir }, entry });                     // T2
    ready = await sbx.waitFor('READY', cfg.limits.readyTimeoutMs);
    nonceWrittenAt = isoSec();
    await h.putDoc(`_attestationRuns/${runId}`, { nonce: attestationNonce, runAttempt, runId, writtenAt: nonceWrittenAt }); rl('setup', 'nonce-marker-written');   // T3
    pre = await h.exportState(); rl('setup', 'export-state-pre');                                 // T4
    await new Promise((r) => setTimeout(r, 5));
    caseStartedAt = new Date().toISOString(); runnerLog.push({ at: caseStartedAt, phase: 'case-control', channel: 'runner', op: 'GO' });
    if (ready) sbx.send('GO');
    if (duringCase) { await new Promise((r) => setTimeout(r, 50)); await duringCase({ runId }); rl('case', 'simulated-compromise'); }
    doneOk = await sbx.waitFor('DONE', cfg.limits.caseTimeoutMs);                                 // T5
    term = await sbx.terminate({ skipKill });
    await stack.stop(); caseEndedAt = new Date().toISOString();
    let claim = null; try { claim = JSON.parse(sbx.output().stdout); } catch { /* */ }
    return claim || { canonical: {}, evidence: {} };
  } };
  let adapterOutput = null;
  const stage1 = await executeCase(caseSpec, { ...sandboxAdapter, execute: async (...a) => (adapterOutput = await sandboxAdapter.execute(...a)) }, fixtures);
  await new Promise((r) => setTimeout(r, 5));
  const post = await h.exportState(); rl('teardown', 'export-state-post');
  if (skipKill) { const t2 = await sbx.terminate(); term = { ...term, cleanupAfterExport: t2 }; }
  cleanupSandboxDirs(); rmSync(inputDir, { recursive: true, force: true });
  const finishedAt = isoSec();
  const run = {
    runId, runAttempt, attestationNonce, testId, trustedToolchainCommit: HEAD, adapterCommit: HEAD, adapterEntry: entry,
    adapterSandboxPolicyDigest: configDigest(cfg), sandboxLauncherSha256: launcherSha, nonceWrittenAt, caseStartedAt, caseEndedAt, startedAt, finishedAt,
    ownershipMarkerPath: `${MARKER_COLLECTION}/${ownNonce}`, ownershipNonceSha256: sha256Hex(ownNonce), artifactId: '0',
    targets: { caseSpecDigest: sha256Hex(stableJson(caseSpec)), oracleFileSha256: sha256Hex(oracleBytes), fixtureFileSha256: fileSha256, fixtureHash: createFixtureHash(fixtures), anchorDigest },
    environment, gitDirty,
  };
  const { pathMapDigest: pmd = null, ...pathMapRecord } = pathMap || {};
  const isolation = { isolationPolicyVersion: POLICY_VERSION, platformSupported: iso.platformSupported, platformReason: iso.reason ?? null, sandboxPolicyDigest: iso.sandboxPolicyDigest,
    pathMap: pathMap ? pathMapRecord : null, pathMapDigest: pmd, selfCheck: iso.selfCheck, selfCheckTermination: iso.termination ?? null,
    adapterTermination: term ? { namespaceTerminated: term.namespaceTerminated, remainingAdapterProcesses: term.remainingAdapterProcesses, exportAfterTermination: true } : null,
    adapterReady: ready, adapterDone: doneOk, controlViolations: sbx ? sbx.output().violations : [] };
  const files = {
    'adapter-claim.json': JSON.stringify(adapterOutput), 'isolation.json': JSON.stringify(isolation), 'run.json': JSON.stringify(run),
    'runner-log.jsonl': runnerLog.map((x) => JSON.stringify(x)).join('\n') + '\n',
    'state-pre.json': JSON.stringify(pre?.docs ?? {}), 'state-post.json': JSON.stringify(post.docs),
    'trace-front.jsonl': readFileSync(frontFile), 'trace-back.jsonl': readFileSync(backFile),
  };
  const pkg = writePackage(files);
  // "job outputs": the trusted channel (here: Runner memory), never read back from the package
  const trusted = { packageSha256: pkg.packageSha256, manifestSha256: pkg.manifestSha256, runId, runAttempt, attestationNonce, testId, trustedToolchainCommit: HEAD, adapterCommit: HEAD, caseSpec, runnerKind: 'local-untrusted', platformSupported: iso.platformSupported === true };   // in-run check is always local; the verify job re-verifies with its own trusted inputs   // B3A-N4: from Runner memory
  const result = verifyPackage(pkg.packageBytes, trusted);
  writeFileSync(path.join(dir, 'package.tar'), pkg.packageBytes);
  writeFileSync(path.join(dir, 'job-outputs.json'), JSON.stringify({ runId, runAttempt, packageSha256: pkg.packageSha256, manifestSha256: pkg.manifestSha256, attestationNonce }, null, 1));
  writeFileSync(path.join(dir, 'statement.json'), stableJson(result.statement));
  writeFileSync(path.join(dir, 'verify.json'), JSON.stringify({ ...result, statement: undefined, stage1Runner: { status: stage1.status, attested: stage1.attested } }, null, 1));
  return { label, testId, result, pkg, files, trusted, claim: adapterOutput, term, iso, stage1, caseTokenActors };
}

const results = []; const log = (ok, name, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const R = (x) => `${x.result.result} [${x.result.reasons.join(',')}]`;
const has = (x, ...codes) => codes.every((c) => x.result.reasons.some((r) => r.split(':')[0] === c));
const LOCAL = ['LOCAL_UNTRUSTED_RUNNER', 'TRUST_ROOT_NOT_CONFIGURED'];
const isLocalOnly = (x) => x.result.result === 'UNATTESTED' && stableJson([...x.result.reasons].sort()) === stableJson([...LOCAL].sort());

// ---------------- B3b single-case mode: seal ONE honest case for the attest.yml verify job, then stop
if (SINGLE) {
  const x = await attestedRun(`case-${SINGLE}`, { testId: SINGLE });
  const secrets = h.issuedSecrets();
  const { readdirSync, statSync } = await import('node:fs');
  const files = []; const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } }; walk(runDir);
  const leaks = files.map((f) => ({ f: path.relative(runDir, f), l: findLeaks(readFileSync(f, 'latin1') + readFileSync(f, 'utf8'), { names, secrets }) })).filter((r) => r.l.length);
  assertStillOwned(await h.markerIds(), ownNonce);
  await fsc.clearAll(); await au.clearAll();
  rmSync(entryDir, { recursive: true, force: true }); rmSync(workDir, { recursive: true, force: true }); cleanupSandboxDirs();
  // R1-N7: any hit → nothing is handed over (no package, no outputs) → the job fails, nothing is uploaded
  if (leaks.length) { console.log(`FAIL MASKING ${leaks.length} files with leaks`); process.exit(1); }
  mkdirSync(OUT_DIR, { recursive: true });
  const packageFile = path.join(OUT_DIR, `package-${SINGLE}.tar`);
  writeFileSync(packageFile, x.pkg.packageBytes);
  // values for the job outputs — written by THIS process after the Adapter's namespace was terminated
  const outputs = { testId: SINGLE, runId: x.trusted.runId, runAttempt: x.trusted.runAttempt, attestationNonce: x.trusted.attestationNonce,
    packageSha256: x.pkg.packageSha256, manifestSha256: x.pkg.manifestSha256, platformSupported: x.trusted.platformSupported,
    toolchainCommit: HEAD, packageFile: path.basename(packageFile), localDiagnostic: { result: x.result.result, reasons: x.result.reasons } };
  writeFileSync(path.join(OUT_DIR, 'execute-outputs.json'), JSON.stringify(outputs, null, 1));
  console.log(`S2B2_B3B_EXECUTE ${SINGLE} runId=${outputs.runId} attempt=${outputs.runAttempt} package=${outputs.packageSha256} local=${x.result.result}`);
  process.exit(0);
}

// ---------------- positive controls: honest sandboxed Adapter, four cases
const honest = {};
for (const t of ['POC-001', 'POC-002', 'POC-008', 'POC-009']) {
  const x = await attestedRun(`honest-${t}`, { testId: t }); honest[t] = x;
  const ok = t === 'POC-009' ? (x.result.result === 'BLOCKED' && stableJson(x.result.reasons) === stableJson(['BLOCKED_FIELDS_G1_G4'])) : isLocalOnly(x);
  log(ok, `HONEST ${t}`, `${R(x)} contract=${x.result.contract?.contractMatch} stage1=${x.stage1.status} selfCheck=${Object.values(x.iso.selfCheck || {}).filter((c) => c.ok && c.positiveControlOk !== false).length}/22`);
}

// B3A-N8: every case input held exactly one token — the case actor's (trusted CASE_ACTORS table)
log(Object.values(honest).every((v) => stableJson(v.caseTokenActors) === stableJson([CASE_ACTORS[v.testId]])), 'N8 case.json holds only the case actor\'s token', Object.values(honest).map((v) => `${v.testId}:${v.caseTokenActors.join('+')}`).join(' '));

// ---------------- sandboxed attacks (real sandbox, real emulator)
const hostFile = path.join(ROOT, 'src/b3/verifier.mjs'); const hostFileSha = sha256Hex(readFileSync(hostFile));
let x;
x = await attestedRun('A1A2-bypass-owner-write', { testId: 'POC-001', entry: '/adapter/attackers/bypass-owner-write.mjs' });
log(isLocalOnly(x) && Object.values(x.claim?.attack?.attempts || { a: 'CONNECTED_AND_WROTE' }).every((v) => v !== 'CONNECTED_AND_WROTE'), 'A1/A2 bypass + owner write from the sandbox: every attempt fails, result unaffected', `${R(x)} attempts=${JSON.stringify(x.claim?.attack?.attempts)}`);
x = await attestedRun('A1A2-weakened-sandbox-no-netns', { testId: 'POC-001', entry: '/adapter/attackers/bypass-owner-write.mjs', cfg: sandboxConfig({ namespaces: ['ipc', 'mnt', 'pid', 'uts'] }) });
log(x.result.result === 'BLOCKED' && has(x, 'SANDBOX_CONFIG_MISMATCH', 'ISOLATION_CHECK_FAILED'), 'A1/A2/A15 changed launch parameter (no network namespace) lets the bypass through → BLOCKED', `${R(x)} attempts=${JSON.stringify(x.claim?.attack?.attempts)} stateChangeDetected=${has(x, 'STATE_CHANGE_UNEXPLAINED')}`);
x = await attestedRun('A3-evidence-tamper', { testId: 'POC-001', entry: '/adapter/attackers/evidence-tamper.mjs', attackHints: { paths: [path.join(runDir, 'TAMPER'), hostFile, outputChannel] } });
log(isLocalOnly(x) && !existsSync(path.join(runDir, 'TAMPER')) && sha256Hex(readFileSync(hostFile)) === hostFileSha && readFileSync(outputChannel, 'utf8') === 'runner-private\n' && Object.values(x.claim?.attack?.results || {}).every((v) => v !== 'WROTE'), 'A3 write evidence / toolchain / output channel from the sandbox: all fail, files unchanged', `${R(x)} ${JSON.stringify(x.claim?.attack?.results)}`);
x = await attestedRun('A5-background', { testId: 'POC-001', entry: '/adapter/attackers/background.mjs' });
log(isLocalOnly(x) && x.term.remainingAdapterProcesses === 0, 'A5 detached background process is killed with the PID namespace before export', `${R(x)} remaining=${x.term.remainingAdapterProcesses}`);
x = await attestedRun('A5-termination-skipped', { testId: 'POC-001', entry: '/adapter/attackers/background.mjs', skipKill: true });
log(x.result.result === 'BLOCKED' && has(x, 'ADAPTER_TERMINATION_UNVERIFIED'), 'A5 control: if termination is skipped, the leftover process is detected → BLOCKED', `${R(x)} remaining=${x.term.remainingAdapterProcesses} cleanup=${JSON.stringify(x.term.cleanupAfterExport)}`);
x = await attestedRun('A7-nonce-probe', { testId: 'POC-001', entry: '/adapter/attackers/nonce-probe.mjs' });
log(isLocalOnly(x) && x.claim?.attack?.tcpBeforeReady !== 'CONNECTED' && x.claim?.attack?.apiCode === 'FORBIDDEN', 'A7 read the attestation marker before READY (TCP) or via the API: both fail', `${R(x)} ${JSON.stringify(x.claim?.attack)}`);
x = await attestedRun('A7-marker-changed-during-case', { testId: 'POC-001', duringCase: async ({ runId }) => h.patchDoc(`_attestationRuns/${runId}`, { nonce: '0'.repeat(64) }) });
log(x.result.result === 'BLOCKED' && has(x, 'NONCE_MISMATCH', 'PHASE_VIOLATION'), 'A7 control: marker changed during the case (simulated compromise) → BLOCKED', R(x));
x = await attestedRun('A8A12-forge-evidence-lie', { testId: 'POC-001', entry: '/adapter/attackers/forge-evidence.mjs' });
log(isLocalOnly(x) && x.result.contract.adapterClaimAgreesWithObserver === false && x.result.observedCanonical?.returnedCount === 15, 'A8/A12 forged evidence references and a lying claim do not change the Observer result', `${R(x)} observed=${JSON.stringify(x.result.observedCanonical)}`);
x = await attestedRun('A9-platform-unsupported', { testId: 'POC-001', simulateUnsupported: true });
log(x.result.result === 'UNATTESTED' && has(x, 'ISOLATION_UNVERIFIABLE'), 'A9 isolation unverifiable → UNATTESTED', R(x));
x = await attestedRun('A11-entry-abuse', { testId: 'POC-001', entry: '/adapter/attackers/entry-abuse.mjs' });
log(x.result.result === 'BLOCKED' && stableJson(x.result.reasons) === stableJson(['OBSERVATION_AMBIGUOUS']) && (x.claim?.attack?.statuses || []).every((s) => s === 403) && x.result.reconciliation.auditMatched === x.result.reconciliation.frontRequests, 'A11 malformed / oversized / prototype-name / credential-field requests: all 403 and reconciled; the extra session read makes the case ambiguous → BLOCKED, never a false match', `${R(x)} statuses=${JSON.stringify(x.claim?.attack?.statuses)} audits=${x.result.reconciliation.auditMatched}/${x.result.reconciliation.frontRequests}`);
x = await attestedRun('A16-sentinel-absent', { testId: 'POC-001', startSentinel: false });
log(x.result.result === 'BLOCKED' && has(x, 'ISOLATION_CHECK_FAILED'), 'A16 positive control: sentinel not started → "unreachable" is not accepted → BLOCKED', R(x));

// ---------------- package-level attacks on the honest POC-001 package
const H1 = honest['POC-001'];
const flip = Buffer.from(H1.pkg.packageBytes); flip[flip.length - 2000] ^= 1;
x = { result: verifyPackage(flip, H1.trusted) };
log(x.result.result === 'BLOCKED' && has(x, 'PACKAGE_DIGEST_MISMATCH'), 'A3 transport tamper (one bit) → BLOCKED', R(x));
const forged = JSON.parse(H1.files['state-post.json']); for (const k of Object.keys(forged)) if (k.endsWith('/entries/AE-EN-A17-1151-0007')) forged[k].status = 'P';
const rebuilt = writePackage({ ...H1.files, 'state-post.json': JSON.stringify(forged) });
x = { result: verifyPackage(rebuilt.packageBytes, H1.trusted) };
log(x.result.result === 'BLOCKED' && has(x, 'PACKAGE_DIGEST_MISMATCH'), 'A13 whole-package replacement with all internal hashes recomputed and the same nonce → BLOCKED', R(x));
const H2 = honest['POC-002'];
x = { result: verifyPackage(H1.pkg.packageBytes, { ...H2.trusted, packageSha256: H1.pkg.packageSha256, manifestSha256: H1.pkg.manifestSha256, testId: 'POC-001', caseSpec: H1.trusted.caseSpec }) };
log(x.result.result === 'BLOCKED' && has(x, 'RUN_BINDING_MISMATCH'), 'A6 replay of another run\'s package (digests even supplied consistently) → BLOCKED (runId / nonce)', R(x));
const isoV = JSON.parse(H1.files['isolation.json']);
const variants = {
  'missing check': (() => { const v = structuredClone(isoV); delete v.selfCheck.NO_CAPS; return JSON.stringify(v); })(),
  'only one check': (() => { const v = structuredClone(isoV); v.selfCheck = { NO_CAPS: v.selfCheck.NO_CAPS }; return JSON.stringify(v); })(),
  'unknown check': (() => { const v = structuredClone(isoV); v.selfCheck.EXTRA = { ok: true, observed: 'x', positiveControlOk: null }; return JSON.stringify(v); })(),
  'duplicate check key': JSON.stringify(isoV).replace('"NO_CAPS":', '"NO_CAPS":{"ok":false,"observed":"x","positiveControlOk":null},"NO_CAPS":'),
  'one check ok=false': (() => { const v = structuredClone(isoV); v.selfCheck.NO_SUDO.ok = false; return JSON.stringify(v); })(),
  'claimed digest of other params': (() => { const v = structuredClone(isoV); v.sandboxPolicyDigest = configDigest(sandboxConfig({ uid: 0 })); return JSON.stringify(v); })(),
  'N7 path map altered (digest not recomputed)': (() => { const v = structuredClone(isoV); v.pathMap.usrFiles.push({ inside: '/usr/bin/sudo', source: '/usr/bin/sudo', sha256: '0'.repeat(64) }); return JSON.stringify(v); })(),
  'N7 path map without a required binary (digest recomputed)': (() => { const v = structuredClone(isoV); v.pathMap.usrFiles = v.pathMap.usrFiles.filter((f) => f.inside !== '/usr/bin/setpriv'); v.pathMapDigest = pathMapDigest(v.pathMap); return JSON.stringify(v); })(),
};
const expectCode = { 'N7 path map altered (digest not recomputed)': 'PATH_MAP_INVALID', 'N7 path map without a required binary (digest recomputed)': 'PATH_MAP_INVALID', 'missing check': 'ISOLATION_CHECK_MISSING', 'only one check': 'ISOLATION_CHECK_MISSING', 'unknown check': 'ISOLATION_CHECK_UNKNOWN', 'duplicate check key': 'ARTIFACT_JSON_INVALID', 'one check ok=false': 'ISOLATION_CHECK_FAILED', 'claimed digest of other params': 'SANDBOX_CONFIG_MISMATCH' };
for (const [n, text] of Object.entries(variants)) {
  const p2 = writePackage({ ...H1.files, 'isolation.json': text });
  x = { result: verifyPackage(p2.packageBytes, { ...H1.trusted, packageSha256: p2.packageSha256, manifestSha256: p2.manifestSha256 }) };
  log(x.result.result === 'BLOCKED' && has(x, expectCode[n]), `A15 isolation evidence "${n}" (even with consistent digests) → BLOCKED ${expectCode[n]}`, R(x));
}

// PR1-REV001: the sealed evidence contradicts itself — the audit PATCH body says something else than the
// exported audit record (package rebuilt and digests supplied consistently; tests the Verifier's own
// reconciliation, NOT an untrusted Adapter changing the trusted Runner's digests)
{ const lines = H1.files['trace-back.jsonl'].toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const pi = lines.findIndex((e) => e.method === 'PATCH' && /\/auditLog\//.test(e.path));
  lines[pi].requestBody = { fields: { decision: { stringValue: 'deny' }, reasonCode: { stringValue: 'FAKE_REASON' } } };
  const p3 = writePackage({ ...H1.files, 'trace-back.jsonl': lines.map((e) => JSON.stringify(e)).join('\n') + '\n' });
  x = { result: verifyPackage(p3.packageBytes, { ...H1.trusted, packageSha256: p3.packageSha256, manifestSha256: p3.manifestSha256 }) };
  log(x.result.result === 'BLOCKED' && has(x, 'AUDIT_UNRECONCILED'), 'PR1-REV001 audit PATCH content contradicts the exported audit record (consistent digests) → BLOCKED AUDIT_UNRECONCILED', R(x)); }

// B3A-N5: the honest package plus bytes after the end-of-archive marker (digests supplied consistently)
{ const tail = Buffer.concat([H1.pkg.packageBytes, Buffer.from('appended')]);
  x = { result: verifyPackage(tail, { ...H1.trusted, packageSha256: sha256Hex(tail) }) };
  log(x.result.result === 'BLOCKED' && has(x, 'ARTIFACT_NONCANONICAL'), 'N5 bytes appended after the end-of-archive marker (consistent digest) → BLOCKED ARTIFACT_NONCANONICAL', R(x)); }

// ---------------- masking scan of every artifact with every issued secret (R1-N7)
const secrets = h.issuedSecrets();
const { readdirSync, statSync } = await import('node:fs');
const files = []; const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } }; walk(runDir);
const leaks = files.map((f) => ({ f: path.relative(runDir, f), l: findLeaks(readFileSync(f, 'latin1') + readFileSync(f, 'utf8'), { names, secrets }) })).filter((r) => r.l.length);
log(leaks.length === 0, `MASKING ${files.length} artifact files scanned with ${secrets.length} issued secrets`, leaks.length ? JSON.stringify(leaks.slice(0, 3)) : '0 leaks');

// ---------------- owned cleanup
assertStillOwned(await h.markerIds(), ownNonce);
await fsc.clearAll(); await au.clearAll();
const left = await fsc.listRootCollections(EMULATOR_OWNER); const leftAcc = await au.countAccounts();
log((left.json?.collectionIds || []).length === 0 && Number(leftAcc.json?.recordsCount ?? 0) === 0, 'CLEANUP owned emulator cleared');
rmSync(entryDir, { recursive: true, force: true }); rmSync(workDir, { recursive: true, force: true }); cleanupSandboxDirs();

const summary = { kind: 'S2B2_B3A_RUN', runTag, attestation: 'UNATTESTED', notAPocPass: true, passPossible: false, gitCommit: HEAD, gitDirty, environment, anchorDigest,
  honest: Object.fromEntries(Object.entries(honest).map(([t, v]) => [t, { result: v.result.result, reasons: v.result.reasons, contract: v.result.contract?.contractMatch, observed: v.result.observedCanonical, reconciliation: v.result.reconciliation, stage1Runner: v.stage1.status, packageSha256: v.pkg.packageSha256 }])),
  checks: results, ok: results.every((r) => r.ok) };
writeFileSync(path.join(runDir, 'run-summary.json'), JSON.stringify(summary, null, 1));
{ const all = []; const w2 = (d) => { for (const n of readdirSync(d).sort()) { const p = path.join(d, n); if (statSync(p).isDirectory()) w2(p); else if (n !== 'artifact-manifest.json') all.push({ path: path.relative(runDir, p), bytes: statSync(p).size, sha256: sha256Hex(readFileSync(p)) }); } }; w2(runDir);
  writeFileSync(path.join(runDir, 'artifact-manifest.json'), JSON.stringify({ runTag, gitCommit: HEAD, gitDirty, files: all }, null, 1)); }
writeFileSync(path.join(ROOT, 'evidence', 'runs', 's2b2-b3a-latest.json'), JSON.stringify({ runDir: path.relative(ROOT, runDir), ...summary }, null, 1));
console.log(`S2B2_B3A_RUN ${runTag} ok=${summary.ok} checks=${results.filter((r) => r.ok).length}/${results.length}`);
process.exit(summary.ok ? 0 : 1);
