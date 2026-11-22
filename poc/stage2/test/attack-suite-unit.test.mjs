/** A14 / A4 verify-suite unit tests (pure; fixture-based; no root, no emulator). Attack plan v0.4 §3, §4.1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as rf } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath as f2p } from 'node:url';
import { writePackage, readPackageSafe } from '../src/b3/package.mjs';
import { runAttackVerify, errorLines, saysConflict } from '../src/b3/attack-suite.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const FIX = f2p(new URL('./fixtures/b3a-honest-poc001/', import.meta.url));
const fixFiles = Object.fromEntries([...readPackageSafe(rf(`${FIX}package.tar`)).files].filter(([n]) => n !== 'manifest.json').map(([n, b]) => [n, b.toString('utf8')]));
const run0 = JSON.parse(fixFiles['run.json']);
const caseSpec001 = JSON.parse(rf(f2p(new URL('../../stage1/contracts/canonical-oracles-v1.0.json', import.meta.url)), 'utf8')).cases.find((c) => c.testId === 'POC-001');
/** the fixture, relabelled as an attack-scenario package (as the attack workflow's execute job would seal it) */
const asScenario = (scenario, runMods = {}, claimMods = null) => {
  const files = { ...fixFiles, 'run.json': JSON.stringify({ ...run0, scenario, ...runMods }) };
  if (claimMods) files['adapter-claim.json'] = JSON.stringify({ ...JSON.parse(fixFiles['adapter-claim.json']), ...claimMods });
  return writePackage(files);
};
const outputsOf = (p, o = {}) => ({ testId: 'POC-001', artifactId: '1001', packageSha256: p.packageSha256, manifestSha256: p.manifestSha256, attestationNonce: run0.attestationNonce, platformSupported: true, toolchainCommit: run0.trustedToolchainCommit, ...o });
const pkgA14 = asScenario('attack-a14');
const pkgA4 = asScenario('attack-a4-tamper', {}, { canonical: { workspaceId: 'WS-A17', returnedCount: 0, crossWorkspaceDisclosure: true }, verifierVersion: 's2-verifier-FAKE-9' });
const prevPkg = asScenario('honest', { runId: '999999', attestationNonce: 'f'.repeat(64) });
const one = (name) => () => [{ name, isFile: true }];
const CONFLICT = ['##[error]Failed to CreateArtifact: Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run'];
const platformOk = (o = {}) => ({ artifactsOk: true, artifacts: [{ id: '1001', name: 'package-POC-001.tar' }, { id: '1002', name: 'decoy-POC-001.tar' }, { id: '1003', name: 'package-POC-002.tar' }], sameNameErrorLines: CONFLICT, sameNameControlOutcome: 'success', ...o });
const io = (o = {}) => ({
  platform: o.platform === undefined ? platformOk() : o.platform,
  env: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_RUN_ID: run0.runId, GITHUB_RUN_ATTEMPT: String(run0.runAttempt), CMN_STAGE1_ANCHOR_SHA256: 'a'.repeat(64) },
  head: run0.trustedToolchainCommit, workflowBlob: 'b'.repeat(40), policy: null, caseSpecs: { 'POC-001': caseSpec001 }, now: () => new Date('2026-11-22T00:00:00Z'),
  a14: { outputs: outputsOf(pkgA14), scenario: 'attack-a14', pkg: one('package-POC-001.tar'), read: () => pkgA14.packageBytes,
    decoy: { artifactId: '1002', list: one('decoy-POC-001.tar'), read: () => Buffer.from('decoy') },
    sameName: { uploadOutcome: 'failure' }, foreign: { artifactId: '777', downloadOutcome: 'failure' }, previous: { bytes: prevPkg.packageBytes }, ...o.a14 },
  a4: o.a4 === null ? null : { outputs: outputsOf(pkgA4, { artifactId: '1003', trustedTreesUnchanged: true }), scenario: 'attack-a4-tamper', pkg: one('package-POC-001.tar'), read: () => pkgA4.packageBytes, ...o.a4 },
});
const sc = (r, id) => r.scenarios.find((s) => s.id === id);

test('attack suite: expected defences on the fixture (positive control, A14-1/2/3a/3b, A4-1/2/3)', () => {
  const r = runAttackVerify(io());
  assert.equal(sc(r, 'A14-positive').testOutcome, 'CONTROL_OK', sc(r, 'A14-positive').verifierOutcome);
  for (const id of ['A14-1', 'A14-2', 'A14-3a', 'A14-3b-i', 'A14-3b-ii', 'A4-1', 'A4-2-i', 'A4-2-ii', 'A4-3']) assert.equal(sc(r, id).testOutcome, 'DEFENDED', `${id}: ${sc(r, id).verifierOutcome}`);
  assert.equal(r.overall, 'DEFENDED_WHERE_RUN'); assert.deepEqual(r.notRun, []);
  assert.match(sc(r, 'A14-1').verifierOutcome, /ARTIFACT_SELECTION_MISMATCH/);
  assert.equal(sc(r, 'A14-2').platformOutcome, 'UPLOAD_REJECTED_CONFLICT'); assert.equal(sc(r, 'A14-2').verifierOutcome, 'NOT_REACHED');
  assert.equal(sc(r, 'A14-3a').platformOutcome, 'DOWNLOAD_NOT_FOUND_IN_RUN');
  assert.match(sc(r, 'A14-3b-i').verifierOutcome, /PACKAGE_DIGEST_MISMATCH/); assert.match(sc(r, 'A14-3b-ii').verifierOutcome, /RUN_BINDING_MISMATCH/);
  assert.match(sc(r, 'A4-2-i').verifierOutcome, /PACKAGE_DIGEST_MISMATCH/); assert.match(sc(r, 'A4-2-ii').verifierOutcome, /PAYLOAD_SET_MISMATCH/);
  assert.ok(!JSON.stringify(r).includes('"statement'));                                          // no statements in the summary
});

test('attack suite: the platform accepting a same-name upload is recorded, and A14-1b still blocks it', () => {
  const decoy = Buffer.from('not the sealed package');
  const r = runAttackVerify(io({ a14: { sameName: { uploadOutcome: 'success', artifactId: '1004', list: one('package-POC-001.tar'), read: () => decoy } } }));
  assert.deepEqual([sc(r, 'A14-2').testOutcome, sc(r, 'A14-2').platformOutcome], ['INCONCLUSIVE', 'UPLOAD_ACCEPTED']);
  assert.equal(sc(r, 'A14-1b').testOutcome, 'DEFENDED'); assert.match(sc(r, 'A14-1b').verifierOutcome, /PACKAGE_DIGEST_MISMATCH/);
  assert.equal(r.overall, 'INCONCLUSIVE');
});

test('attack suite: missing inputs are NOT_RUN with a reason, never DEFENDED', () => {
  const r = runAttackVerify(io({ a14: { decoy: null, sameName: { uploadOutcome: 'skipped' }, foreign: { artifactId: '' }, previous: { bytes: null, reason: 'expired' } }, a4: null }));
  for (const id of ['A14-1', 'A14-2', 'A14-3a', 'A14-3b-i', 'A14-3b-ii', 'A4-1']) { assert.equal(sc(r, id).testOutcome, 'NOT_RUN', id); assert.ok(sc(r, id).notRunReason, id); }
  assert.equal(sc(r, 'A14-3b-i').notRunReason, 'expired');
  assert.deepEqual(r.notRun.sort(), ['A14-1', 'A14-2', 'A14-3a', 'A14-3b-i', 'A14-3b-ii', 'A4-1'].sort());
});

test('attack suite: a failed positive control makes the whole suite INCONCLUSIVE', () => {
  const r = runAttackVerify(io({ a14: { scenario: 'honest' } }));      // trusted scenario no longer matches the package
  assert.equal(sc(r, 'A14-positive').testOutcome, 'CONTROL_FAILED'); assert.equal(r.overall, 'INCONCLUSIVE');
});

test('attack suite: A4-1 is BREACHED if the trusted trees changed, A4-3 if the verify job ran another commit', () => {
  const t = runAttackVerify(io({ a4: { outputs: outputsOf(pkgA4, { artifactId: '1003', trustedTreesUnchanged: false }) } }));
  assert.equal(sc(t, 'A4-1').testOutcome, 'BREACHED'); assert.equal(t.overall, 'BREACHED');
  const h = runAttackVerify({ ...io(), head: 'c'.repeat(40) });
  assert.equal(sc(h, 'A4-3').testOutcome, 'BREACHED');
  // a foreign artifact that WAS downloadable must still be blocked by the Verifier
  const f = runAttackVerify(io({ a14: { foreign: { artifactId: '777', downloadOutcome: 'success', list: one('package-POC-001.tar'), read: () => prevPkg.packageBytes } } }));
  assert.equal(sc(f, 'A14-3a').testOutcome, 'DEFENDED'); assert.equal(sc(f, 'A14-3a').platformOutcome, 'DOWNLOADED_FOREIGN');
  assert.equal(sha(prevPkg.packageBytes), sc(runAttackVerify(io()), 'A14-3b-i').previousPackageSha256);
});

// ------------------------------------------------------------------ C1-REV001: an action failure alone is not a defence
test('C1-REV001: a failed same-name upload is DEFENDED only with conflict evidence; any other failure is INCONCLUSIVE', () => {
  const variants = {
    'network error': platformOk({ sameNameErrorLines: ['##[error]Failed to CreateArtifact: Unable to make request: ECONNRESET'] }),
    'service error': platformOk({ sameNameErrorLines: ['##[error]Failed request: (503) Service Unavailable'] }),
    'permission': platformOk({ sameNameErrorLines: ['##[error]Failed request: (403) Forbidden: Resource not accessible by integration'] }),
    'no log': platformOk({ sameNameErrorLines: [] }),
    'control upload failed too': platformOk({ sameNameControlOutcome: 'failure' }),
    'listing unavailable': platformOk({ artifactsOk: false }),
    'two artifacts of that name': platformOk({ artifacts: [{ id: '1001', name: 'package-POC-001.tar' }, { id: '1099', name: 'package-POC-001.tar' }] }),
    'the one of that name is not the sealed package': platformOk({ artifacts: [{ id: '1099', name: 'package-POC-001.tar' }] }),
    'no platform evidence at all': null,
  };
  for (const [n, platform] of Object.entries(variants)) {
    const r = runAttackVerify(io({ platform }));
    assert.deepEqual([sc(r, 'A14-2').testOutcome, sc(r, 'A14-2').platformOutcome], ['INCONCLUSIVE', 'UPLOAD_FAILED_REASON_UNVERIFIED'], n);
    assert.ok(sc(r, 'A14-2').manualReview, n); assert.equal(r.overall, 'INCONCLUSIVE', n);
  }
  assert.equal(sc(runAttackVerify(io()), 'A14-2').testOutcome, 'DEFENDED');
});

test('C1-REV001: a failed foreign download is DEFENDED only if the listing of THIS run confirms the ID is absent', () => {
  for (const [n, platform] of Object.entries({ 'listing unavailable': platformOk({ artifactsOk: false }), 'no evidence': null, 'ID is in this run': platformOk({ artifacts: [...platformOk().artifacts, { id: '777', name: 'x' }] }) })) {
    const r = runAttackVerify(io({ platform }));
    assert.deepEqual([sc(r, 'A14-3a').testOutcome, sc(r, 'A14-3a').platformOutcome], ['INCONCLUSIVE', 'DOWNLOAD_FAILED_REASON_UNVERIFIED'], n);
  }
  assert.deepEqual(sc(runAttackVerify(io()), 'A14-3a').evidence, { artifactsListed: true, idInThisRun: false });
});

test('C1-REV001: error-line extraction is bounded and keeps only platform error lines', () => {
  const log = ['2026-11-22T03:00:00.0000000Z ##[group]Run actions/upload-artifact', `2026-11-22T03:00:01.0000000Z ${CONFLICT[0]}`, 'plain line', ...Array.from({ length: 20 }, (_, i) => `2026-11-22T03:00:02.0000000Z ##[error]${'e'.repeat(400)}${i}`)].join('\n');
  const l = errorLines(log);
  assert.equal(l.length, 10); assert.equal(l[0], CONFLICT[0]); assert.ok(l.every((x) => x.length <= 300 && x.includes('##[error]')));
  assert.equal(saysConflict(l), true); assert.equal(saysConflict(['##[error](409) Something else']), false); assert.equal(saysConflict(['##[error]Conflict without a status']), false);
  assert.deepEqual(errorLines(undefined), []);
});


test('C1 review: the verify CLI exits non-zero unless the summary is DEFENDED_WHERE_RUN (a green job is still not acceptance)', () => {
  const src = rf(f2p(new URL('../scripts/attack-verify.mjs', import.meta.url)), 'utf8');
  assert.match(src, /process\.exit\(summary\.overall === 'DEFENDED_WHERE_RUN' \? 0 : 1\);\s*$/);
  assert.ok(src.indexOf("writeFileSync(path.join(env.OUT_DIR, 'attack-summary.json')") < src.indexOf('process.exit(summary.overall'));   // summary first
});
