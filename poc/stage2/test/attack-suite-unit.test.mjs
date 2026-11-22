/** A14 / A4 verify-suite unit tests (pure; fixture-based; no root, no emulator). Attack plan v0.4 §3, §4.1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as rf } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath as f2p } from 'node:url';
import { writePackage, readPackageSafe } from '../src/b3/package.mjs';
import { runAttackVerify } from '../src/b3/attack-suite.mjs';

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
const io = (o = {}) => ({
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
  assert.equal(sc(r, 'A14-2').platformOutcome, 'UPLOAD_REJECTED'); assert.equal(sc(r, 'A14-2').verifierOutcome, 'NOT_REACHED');
  assert.equal(sc(r, 'A14-3a').platformOutcome, 'DOWNLOAD_NOT_FOUND');
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
