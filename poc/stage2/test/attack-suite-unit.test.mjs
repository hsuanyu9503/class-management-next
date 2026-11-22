/** A14 / A4 verify-suite unit tests (pure; fixture-based; no root, no emulator). Attack plan v0.4 §3, §4.1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as rf } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath as f2p } from 'node:url';
import { writePackage, readPackageSafe } from '../src/b3/package.mjs';
import { runAttackVerify, errorLines, saysConflict, foreignEvidenceFrom } from '../src/b3/attack-suite.mjs';

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
const platformOk = (o = {}) => ({ artifactsOk: true, artifacts: [{ id: '1001', name: 'package-POC-001.tar' }, { id: '1002', name: 'decoy-POC-001.tar' }, { id: '1003', name: 'package-POC-002.tar' }], sameNameErrorLines: CONFLICT, sameNameControlOutcome: 'success', foreign: { artifactId: '777', status: 200, expired: false, runId: '999999' }, ...o });
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
    assert.equal(sc(r, 'A14-3a').testOutcome, 'INCONCLUSIVE', n);
    assert.equal(sc(r, 'A14-3a').platformOutcome, n === 'no evidence' ? 'FOREIGN_ARTIFACT_UNVERIFIED' : 'DOWNLOAD_FAILED_REASON_UNVERIFIED', n);
  }
  assert.deepEqual(sc(runAttackVerify(io()), 'A14-3a').evidence.idInThisRun, false);
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

// ------------------------------------------------------------------ C1-REV001 R2: A14-3a needs a VALID artifact of another run
test('C1-REV001 R2: an arbitrary / missing / expired / same-run / wrong-run foreign ID is never a cross-run DEFENDED', () => {
  const with3a = (foreignEvidence, foreignIn = {}) => sc(runAttackVerify(io({ platform: platformOk({ foreign: foreignEvidence }), a14: { foreign: { artifactId: '99999999999999999999', downloadOutcome: 'failure', ...foreignIn }, previous: { bytes: null, reason: 'no valid previous artifact' } } })), 'A14-3a');
  // the reviewer's reproduction: an ID that is merely absent from this run, with no lookup evidence
  assert.deepEqual([with3a(null).testOutcome, with3a(null).platformOutcome], ['INCONCLUSIVE', 'FOREIGN_ARTIFACT_UNVERIFIED']);
  // lookup evidence for ANOTHER id does not count
  assert.equal(with3a({ artifactId: '777', status: 200, expired: false, runId: '1' }).testOutcome, 'INCONCLUSIVE');
  const F = (o) => ({ artifactId: '99999999999999999999', status: 200, expired: false, runId: '555', ...o });
  assert.deepEqual([with3a(F({ status: 404 })).testOutcome, with3a(F({ status: 404 })).platformOutcome], ['NOT_RUN', 'FOREIGN_ARTIFACT_INVALID']);
  assert.match(with3a(F({ status: 404 })).notRunReason, /does not exist/);
  assert.deepEqual([with3a(F({ expired: true })).testOutcome, with3a(F({ expired: true })).platformOutcome], ['NOT_RUN', 'FOREIGN_ARTIFACT_INVALID']);
  assert.match(with3a(F({ expired: true })).notRunReason, /expired/);
  for (const st of [null, 401, 403, 500]) assert.deepEqual([with3a(F({ status: st })).testOutcome, with3a(F({ status: st })).platformOutcome], ['INCONCLUSIVE', 'FOREIGN_ARTIFACT_UNVERIFIED'], String(st));
  assert.deepEqual([with3a(F({ runId: run0.runId })).testOutcome, with3a(F({ runId: run0.runId })).platformOutcome], ['INCONCLUSIVE', 'FOREIGN_ARTIFACT_IS_THIS_RUN']);
  assert.deepEqual([with3a(F({ runId: '555' }), { previousRunId: '556' }).testOutcome, with3a(F({ runId: '555' }), { previousRunId: '556' }).platformOutcome], ['NOT_RUN', 'FOREIGN_ARTIFACT_RUN_MISMATCH']);
  // a valid artifact of the given other run, absent from this run's listing, download failed → DEFENDED
  const ok = with3a(F({ runId: '555' }), { previousRunId: '555', crossRunDownload: 'success' });
  assert.deepEqual([ok.testOutcome, ok.platformOutcome], ['DEFENDED', 'DOWNLOAD_NOT_FOUND_IN_RUN']);
  assert.deepEqual(ok.evidence.lookup, { status: 200, expired: false, ownerRunId: '555' }); assert.equal(ok.evidence.crossRunDownload, 'success');
  // valid artifact but this run's listing unavailable → still not DEFENDED
  const nl = sc(runAttackVerify(io({ platform: platformOk({ artifactsOk: false, foreign: F({}) }), a14: { foreign: { artifactId: '99999999999999999999', downloadOutcome: 'failure' } } })), 'A14-3a');
  assert.equal(nl.testOutcome, 'INCONCLUSIVE');
});

// ------------------------------------------------------------------ C1-REV001 R3: missing / malformed identity fields
test('C1-REV001 R3: an owner run that is missing or malformed is never "another run" (reviewer reproduction)', () => {
  const run3a = (foreign) => sc(runAttackVerify(io({ platform: platformOk({ foreign: { artifactId: '777', status: 200, expired: false, ...foreign } }), a14: { foreign: { artifactId: '777', downloadOutcome: 'failure' } } })), 'A14-3a');
  for (const runId of [null, undefined, '', 'not-a-run', '0', '-5', '12a', 12.5, {}, []]) {
    const r = run3a({ runId });
    assert.deepEqual([r.testOutcome, r.platformOutcome], ['INCONCLUSIVE', 'FOREIGN_ARTIFACT_UNVERIFIED'], JSON.stringify(runId));
  }
  for (const expired of [null, undefined, 'false', 0, 'no']) {
    const r = run3a({ runId: '555', expired });
    assert.deepEqual([r.testOutcome, r.platformOutcome], ['INCONCLUSIVE', 'FOREIGN_ARTIFACT_UNVERIFIED'], JSON.stringify(expired));
  }
  // the existing outcomes are unchanged
  assert.equal(run3a({ runId: '555' }).testOutcome, 'DEFENDED');
  assert.equal(run3a({ runId: '555', expired: true }).platformOutcome, 'FOREIGN_ARTIFACT_INVALID');
  assert.equal(run3a({ runId: run0.runId }).platformOutcome, 'FOREIGN_ARTIFACT_IS_THIS_RUN');
});

test('C1-REV001 R3: API response → platform evidence keeps unknown fields unknown, end to end', () => {
  const cases = [
    [{ id: 777, name: 'package-POC-001.tar', expired: false, workflow_run: { id: 555 } }, { expired: false, runId: '555' }, 'DEFENDED'],
    [{ id: 777, expired: false }, { expired: false, runId: null }, 'INCONCLUSIVE'],                                   // no workflow_run
    [{ id: 777, expired: false, workflow_run: {} }, { expired: false, runId: null }, 'INCONCLUSIVE'],                 // no id
    [{ id: 777, expired: false, workflow_run: { id: null } }, { expired: false, runId: null }, 'INCONCLUSIVE'],
    [{ id: 777, expired: false, workflow_run: { id: 'abc' } }, { expired: false, runId: null }, 'INCONCLUSIVE'],
    [{ id: 777, workflow_run: { id: 555 } }, { expired: null, runId: '555' }, 'INCONCLUSIVE'],                        // expired missing
    [{ id: 777, expired: 'false', workflow_run: { id: 555 } }, { expired: null, runId: '555' }, 'INCONCLUSIVE'],      // expired wrong type
    [{ id: 777, expired: true, workflow_run: { id: 555 } }, { expired: true, runId: '555' }, 'NOT_RUN'],
  ];
  for (const [body, want, outcome] of cases) {
    const ev = foreignEvidenceFrom('777', 200, body);
    assert.equal(ev.expired, want.expired, JSON.stringify(body)); assert.equal(ev.runId, want.runId, JSON.stringify(body));
    const r = sc(runAttackVerify(io({ platform: platformOk({ foreign: ev }), a14: { foreign: { artifactId: '777', downloadOutcome: 'failure' } } })), 'A14-3a');
    assert.equal(r.testOutcome, outcome, JSON.stringify(body));
  }
  // non-200 / unparsable bodies carry no identity at all
  assert.deepEqual(foreignEvidenceFrom('777', 404, null), { artifactId: '777', status: 404, expired: null, runId: null, name: null });
  assert.deepEqual(foreignEvidenceFrom('777', 200, null), { artifactId: '777', status: 200, expired: null, runId: null, name: null });
  assert.equal(foreignEvidenceFrom('777', undefined, {}).status, null);
  // the collector uses exactly this conversion
  const src = rf(f2p(new URL('../scripts/attack-platform-evidence.mjs', import.meta.url)), 'utf8');
  assert.match(src, /out\.foreign = foreignEvidenceFrom\(foreignId, r\.status, j\);/); assert.doesNotMatch(src, /j\.expired === true/);
});

