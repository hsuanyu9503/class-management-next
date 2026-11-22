/** C-1 unit tests (no emulator, no root, no network): scenario binding, full self-check observations,
 *  the observation masker contract and the Java version parser. Attack-acceptance plan v0.4 §1.2, §6. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as rf } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath as f2p } from 'node:url';
import { writePackage, readPackageSafe } from '../src/b3/package.mjs';
import { verifyPackage, SCENARIO_RE } from '../src/b3/verifier.mjs';
import { CHECK_IDS } from '../src/b3/isolation-policy.mjs';
import { maskObservation, fullObservation, finalizeSelfCheck, checkSelfCheckFull, summaryOf, utf8Cut, OBS_MAX_BYTES, MASK_SECRET } from '../src/b3/observation.mjs';
import { findLeaks, MASK } from '../src/mask.mjs';
import { stableJson } from '../src/stable.mjs';
import { parseJavaVersion } from '../src/b3/env-info.mjs';
import { runVerifyJob } from '../src/b3/attest-verify.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const FIX = f2p(new URL('./fixtures/b3a-honest-poc001/', import.meta.url));
const fixBytes = rf(`${FIX}package.tar`);
const fixFiles = Object.fromEntries([...readPackageSafe(fixBytes).files].filter(([n]) => n !== 'manifest.json').map(([n, b]) => [n, b.toString('utf8')]));
const fixRun = JSON.parse(fixFiles['run.json']);
const caseSpec001 = JSON.parse(rf(f2p(new URL('../../stage1/contracts/canonical-oracles-v1.0.json', import.meta.url)), 'utf8')).cases.find((c) => c.testId === 'POC-001');
const trustedBase = { runId: fixRun.runId, runAttempt: fixRun.runAttempt, attestationNonce: fixRun.attestationNonce, testId: 'POC-001', scenario: 'honest', trustedToolchainCommit: fixRun.trustedToolchainCommit, adapterCommit: fixRun.adapterCommit, caseSpec: caseSpec001, runnerKind: 'local-untrusted', platformSupported: true };
const verifyMod = (mods = {}, trustedMods = {}) => { const p = writePackage({ ...fixFiles, ...mods }); return verifyPackage(p.packageBytes, { ...trustedBase, packageSha256: p.packageSha256, manifestSha256: p.manifestSha256, ...trustedMods }); };
const jsonMod = (name, fn) => { const v = JSON.parse(fixFiles[name]); fn(v); return { [name]: JSON.stringify(v) }; };
const codes = (r) => r.reasons.map((x) => x.split(':')[0]);
const LOCAL_ONLY = ['LOCAL_UNTRUSTED_RUNNER', 'TRUST_ROOT_NOT_CONFIGURED'];

// ----------------------------------------------------------------------------------------------- §1.2 scenario
test('C-1 §1.2: the regenerated honest fixture records scenario=honest and verifies as before', () => {
  assert.equal(fixRun.scenario, 'honest');
  const r = verifyMod();
  assert.equal(r.result, 'UNATTESTED'); assert.deepEqual(r.reasons, LOCAL_ONLY);
  assert.equal(r.statement.scenario, 'honest');
});

test('C-1 §1.2: a missing or malformed TRUSTED scenario is BLOCKED, never defaulted to honest', () => {
  for (const s of [undefined, null, '', 'HONEST', 'attack', 'attack-', 'attack-UPPER', 'honest ', 1, {}, 'attack-' + 'a'.repeat(41)]) {
    const r = verifyMod({}, { scenario: s });
    assert.equal(r.result, 'BLOCKED', String(s)); assert.deepEqual(codes(r), ['SCENARIO_MISSING'], String(s));
  }
  for (const ok of ['honest', 'attack-a10', 'attack-a14-decoy', 'attack-' + 'a'.repeat(40)]) assert.ok(SCENARIO_RE.test(ok), ok);
});

test('C-1 §1.2: the package\'s own scenario is never believed — any difference is SCENARIO_MISMATCH', () => {
  for (const pkgScenario of ['attack-a10', undefined, null, 'honest ']) {
    const r = verifyMod(jsonMod('run.json', (v) => { if (pkgScenario === undefined) delete v.scenario; else v.scenario = pkgScenario; }));
    assert.equal(r.result, 'BLOCKED', String(pkgScenario)); assert.ok(codes(r).includes('SCENARIO_MISMATCH'), String(pkgScenario));
  }
  // honest package, trusted says attack → mismatch too (an attack run cannot be relabelled honest, or vice versa)
  const r = verifyMod({}, { scenario: 'attack-a10' });
  assert.equal(r.result, 'BLOCKED'); assert.ok(codes(r).includes('SCENARIO_MISMATCH'));
});

test('C-1 §1.2: a consistent attack scenario is at most UNATTESTED with SCENARIO_NOT_HONEST (never PASS)', () => {
  const r = verifyMod(jsonMod('run.json', (v) => { v.scenario = 'attack-a10'; }), { scenario: 'attack-a10' });
  assert.equal(r.result, 'UNATTESTED'); assert.deepEqual(r.reasons, [...LOCAL_ONLY, 'SCENARIO_NOT_HONEST']);
  assert.equal(r.statement.scenario, 'attack-a10');
  // even with a hosted runner and a configured trust root (PASS_ENABLED is false anyway): still not honest
  const h = verifyMod(jsonMod('run.json', (v) => { v.scenario = 'attack-a10'; }), { scenario: 'attack-a10', runnerKind: 'github-hosted', trustRoot: { configured: true }, provenance: { artifactId: '1', producerJob: 'attest-execute', signingPolicyBlob: 'a'.repeat(40) } });
  assert.equal(h.result, 'UNATTESTED'); assert.ok(h.reasons.includes('SCENARIO_NOT_HONEST')); assert.ok(h.reasons.includes('PASS_NOT_ENABLED'));
});

test('C-1 §1.2: the verify job takes the scenario only from EXP_SCENARIO (workflow), missing → BLOCKED', () => {
  const p = writePackage(fixFiles);
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_RUN_ID: fixRun.runId, GITHUB_RUN_ATTEMPT: String(fixRun.runAttempt), EXP_TEST_ID: 'POC-001', EXP_ARTIFACT_ID: '123',
    EXP_PACKAGE_SHA256: p.packageSha256, EXP_MANIFEST_SHA256: p.manifestSha256, EXP_ATTESTATION_NONCE: fixRun.attestationNonce, EXP_PLATFORM_SUPPORTED: 'true', EXP_TOOLCHAIN_COMMIT: fixRun.trustedToolchainCommit, CMN_STAGE1_ANCHOR_SHA256: 'a'.repeat(64) };
  const io = (e) => ({ env: e, head: fixRun.trustedToolchainCommit, workflowBlob: 'b'.repeat(40), policy: null, caseSpecs: { 'POC-001': caseSpec001 }, listDownload: () => [{ name: 'package-POC-001.tar', isFile: true }], readDownload: () => p.packageBytes, now: () => new Date('2026-11-22T00:00:00Z') });
  const missing = runVerifyJob(io(env));
  assert.equal(missing.result, 'BLOCKED'); assert.deepEqual(missing.report.reasons, ['SCENARIO_MISSING']);
  const honest = runVerifyJob(io({ ...env, EXP_SCENARIO: 'honest' }));
  assert.equal(honest.result, 'UNATTESTED'); assert.equal(honest.report.scenario, 'honest');
  assert.equal(JSON.parse(honest.statementText).scenario, 'honest');
});

// ------------------------------------------------------------------------------------- §6.2 full observations
const SECRETS = ['tok-AAAA-0001-opaque', 'tok-BBBB-0002-rotated-old'];
test('C-1 §6.2 masker: secret values are masked wherever they appear (neutral keys, nested arrays, embedded, rotated, keys)', () => {
  const v = { observed: SECRETS[0], nested: { list: [['x', SECRETS[1]], { deeper: [SECRETS[0]] }] }, embedded: `x=${SECRETS[0]};y`, [SECRETS[1]]: 'value-under-secret-key', plain: 'nothing here' };
  const m = maskObservation(v, { secretValues: SECRETS });
  assert.equal(m.observed, MASK_SECRET);
  assert.equal(m.nested.list[0][1], MASK_SECRET); assert.equal(m.nested.list[1].deeper[0], MASK_SECRET);
  assert.equal(m.embedded, MASK_SECRET);
  assert.ok(!Object.keys(m).includes(SECRETS[1])); assert.ok(Object.keys(m).some((k) => k.startsWith(MASK_SECRET)));
  assert.equal(m.plain, 'nothing here');
  // the reviewer's probe: without the list a neutral key keeps the value; with it, it is masked
  const probe = { token: 'synthetic-opaque-value', nested: { observed: 'synthetic-opaque-value' } };
  const without = maskObservation(probe, { secretValues: [] });
  assert.equal(without.token, MASK); assert.equal(without.nested.observed, 'synthetic-opaque-value');
  assert.equal(maskObservation(probe, { secretValues: ['synthetic-opaque-value'] }).nested.observed, MASK_SECRET);
  // a missing list is an error, never "no secrets"
  assert.throws(() => maskObservation(probe, {}), TypeError); assert.throws(() => maskObservation(probe), TypeError);
  // empty strings are ignored (they would mask everything)
  assert.equal(maskObservation({ a: 'keep' }, { secretValues: [''] }).a, 'keep');
});

test('C-1 §6.2 masker: masking happens BEFORE serialisation and hashing; the serialised text has no leak', () => {
  const v = { observed: SECRETS[0], arr: [SECRETS[1]], s: `a${SECRETS[0]}b` };
  const f = fullObservation(v, { secretValues: SECRETS });
  assert.deepEqual(findLeaks(f.observedFull, { secrets: SECRETS }), []);
  assert.equal(f.observedSha256, sha(Buffer.from(f.observedFull, 'utf8')));
  assert.equal(f.observedFull, stableJson(maskObservation(v, { secretValues: SECRETS })));
});

test('C-1 §6.2 size and boundaries: 65,536 bytes kept; 65,537 truncated; multi-byte never split; summaries by code point', () => {
  const exact = 'a'.repeat(OBS_MAX_BYTES - 2);               // stableJson adds two quotes → exactly 65,536 bytes
  const e = fullObservation(exact, { secretValues: [] });
  assert.equal(e.byteLength, OBS_MAX_BYTES); assert.equal(e.truncated, false); assert.equal(e.originalByteLength, OBS_MAX_BYTES);
  const over = fullObservation('a'.repeat(OBS_MAX_BYTES - 1), { secretValues: [] });
  assert.equal(over.truncated, true); assert.equal(over.byteLength, OBS_MAX_BYTES); assert.equal(over.originalByteLength, OBS_MAX_BYTES + 1);
  // a 3-byte character straddling the limit is dropped whole
  const mb = fullObservation('a'.repeat(OBS_MAX_BYTES - 2) + '漢', { secretValues: [] });
  assert.equal(mb.truncated, true); assert.ok(mb.byteLength <= OBS_MAX_BYTES); assert.ok(!mb.observedFull.includes('�'));
  assert.equal(mb.observedSha256, sha(Buffer.from(mb.observedFull, 'utf8')));
  assert.equal(utf8Cut(Buffer.from('ab漢', 'utf8'), 3), 2); assert.equal(utf8Cut(Buffer.from('ab漢', 'utf8'), 5), 5);
  // the 200th code point is a non-BMP character: the summary keeps it whole (no lone surrogate)
  const s = 'x'.repeat(199) + '😀' + 'tail';
  assert.equal(Array.from(summaryOf(s)).length, 200); assert.ok(summaryOf(s).endsWith('😀'));
  assert.notEqual(s.slice(0, 200), summaryOf(s));               // the old UTF-16 slice would cut the surrogate pair
});

const rawChecks = () => Object.fromEntries(CHECK_IDS.map((id) => [id, { ok: true, observedRaw: { id, detail: 'x' }, positiveControlOk: null }]));
const fin = () => finalizeSelfCheck(rawChecks(), { secretValues: [] });
test('C-1 §6.2 Verifier rules: exact trusted ID set, types, lengths, digests and summaries; truncation → INCOMPLETE', () => {
  const ok = fin();
  assert.deepEqual(checkSelfCheckFull({ ...ok, maskSecretCount: 0 }, CHECK_IDS), []);
  const cases = {
    'missing ID': [(f) => { delete f.selfCheckFull.NO_CAPS; }, 'ISOLATION_EVIDENCE_INVALID'],
    'extra ID': [(f) => { f.selfCheckFull.EXTRA = f.selfCheckFull.NO_CAPS; }, 'ISOLATION_EVIDENCE_INVALID'],
    'wrong type': [(f) => { f.selfCheckFull.NO_CAPS.byteLength = '12'; }, 'ISOLATION_EVIDENCE_INVALID'],
    'extra field': [(f) => { f.selfCheckFull.NO_CAPS.note = 'x'; }, 'ISOLATION_EVIDENCE_INVALID'],
    'byteLength lies (not truncated)': [(f) => { f.selfCheckFull.NO_CAPS.byteLength += 1; f.selfCheckFull.NO_CAPS.originalByteLength += 1; }, 'ISOLATION_EVIDENCE_INVALID'],
    'originalByteLength ≠ byteLength while truncated=false': [(f) => { f.selfCheckFull.NO_CAPS.originalByteLength += 5; }, 'ISOLATION_EVIDENCE_INVALID'],
    'digest mismatch': [(f) => { f.selfCheckFull.NO_CAPS.observedSha256 = '0'.repeat(64); }, 'ISOLATION_EVIDENCE_INVALID'],
    'summary mismatch': [(f) => { f.selfCheck.NO_CAPS.observed = 'something else'; }, 'ISOLATION_EVIDENCE_INVALID'],
    'over the size limit': [(f) => { const t = 'a'.repeat(OBS_MAX_BYTES + 1); Object.assign(f.selfCheckFull.NO_CAPS, { observedFull: t, observedSha256: sha(t), byteLength: t.length, originalByteLength: t.length }); f.selfCheck.NO_CAPS.observed = summaryOf(t); }, 'ISOLATION_EVIDENCE_INVALID'],
  };
  for (const [n, [fn, want]] of Object.entries(cases)) { const f = structuredClone(ok); fn(f); assert.ok(checkSelfCheckFull({ ...f, maskSecretCount: 0 }, CHECK_IDS).includes(want), n); }
  // truncation consistent in every other respect → INCOMPLETE only
  const big = finalizeSelfCheck({ ...rawChecks(), NO_CAPS: { ok: true, observedRaw: 'z'.repeat(OBS_MAX_BYTES + 10), positiveControlOk: null } }, { secretValues: [] });
  assert.deepEqual(checkSelfCheckFull({ ...big, maskSecretCount: 0 }, CHECK_IDS), ['ISOLATION_EVIDENCE_INCOMPLETE']);
  // a truncated flag on short data, or an original length that is not over the limit → INVALID
  const lie = structuredClone(ok); lie.selfCheckFull.NO_CAPS.truncated = true;
  assert.ok(checkSelfCheckFull({ ...lie, maskSecretCount: 0 }, CHECK_IDS).includes('ISOLATION_EVIDENCE_INVALID'));
  // the secret list's size must be recorded (the list could not be obtained otherwise)
  for (const n of [undefined, null, -1, 1.5, '3']) assert.ok(checkSelfCheckFull({ ...ok, maskSecretCount: n }, CHECK_IDS).includes('ISOLATION_EVIDENCE_INVALID'), String(n));
});

test('C-1 §6.2 in the Verifier: fixture variants with consistent package digests', () => {
  const iso = (fn) => jsonMod('isolation.json', fn);
  const t = (fn) => verifyMod(iso(fn));
  const want = (r, c) => { assert.equal(r.result, 'BLOCKED'); assert.ok(codes(r).includes(c), `${c} in ${r.reasons}`); };
  want(t((i) => { delete i.selfCheckFull; }), 'ISOLATION_EVIDENCE_INVALID');
  want(t((i) => { delete i.selfCheckFull.FD_ALLOWLIST; }), 'ISOLATION_EVIDENCE_INVALID');
  want(t((i) => { i.selfCheckFull.FD_ALLOWLIST.observedSha256 = '1'.repeat(64); }), 'ISOLATION_EVIDENCE_INVALID');
  want(t((i) => { i.selfCheck.FD_ALLOWLIST.observed = 'forged summary'; }), 'ISOLATION_EVIDENCE_INVALID');
  want(t((i) => { delete i.maskSecretCount; }), 'ISOLATION_EVIDENCE_INVALID');
  want(t((i) => { const s = 'q'.repeat(OBS_MAX_BYTES); Object.assign(i.selfCheckFull.FD_ALLOWLIST, { observedFull: s, observedSha256: sha(s), byteLength: s.length, truncated: true, originalByteLength: s.length + 100 }); i.selfCheck.FD_ALLOWLIST.observed = summaryOf(s); }), 'ISOLATION_EVIDENCE_INCOMPLETE');
  // unverifiable platform: selfCheckFull must be null as well
  const un = verifyMod(iso((i) => { i.platformSupported = false; i.selfCheck = null; }), { platformSupported: false });
  want(un, 'ISOLATION_EVIDENCE_INVALID');
  const unOk = verifyMod(iso((i) => { i.platformSupported = false; i.selfCheck = null; i.selfCheckFull = null; }), { platformSupported: false });
  assert.equal(unOk.result, 'UNATTESTED'); assert.deepEqual(unOk.reasons, ['ISOLATION_UNVERIFIABLE']);
  // the fixture itself: 22 entries, none truncated, secret count recorded, statement summaries ≤ 200 code points
  const fx = JSON.parse(fixFiles['isolation.json']);
  assert.equal(Object.keys(fx.selfCheckFull).length, 22); assert.ok(Object.values(fx.selfCheckFull).every((e) => e.truncated === false));
  assert.ok(Number.isSafeInteger(fx.maskSecretCount) && fx.maskSecretCount > 0);
  assert.ok(Object.values(fx.selfCheck).every((c) => Array.from(c.observed).length <= 200));
});

// ----------------------------------------------------------------------------------------------- §6.1 java
test('C-1 §6.1: java -version is read from stderr; anything unrecognised is honestly "unknown"', () => {
  const temurin = 'openjdk version "21.0.5" 2024-10-15 LTS\nOpenJDK Runtime Environment Temurin-21.0.5+11 (build 21.0.5+11-LTS)\nOpenJDK 64-Bit Server VM Temurin-21.0.5+11 (build 21.0.5+11-LTS, mixed mode, sharing)\n';
  assert.equal(parseJavaVersion({ status: 0, stdout: '', stderr: temurin }), '21.0.5');
  assert.equal(parseJavaVersion({ status: 0, stdout: '', stderr: 'Picked up JAVA_TOOL_OPTIONS: -Dx=y\nopenjdk version "21.0.13" 2026-10-20\n' }), '21.0.13');
  assert.equal(parseJavaVersion({ status: 0, stderr: 'java version "21.0.1" 2023-10-17 LTS\n' }), '21.0.1');
  assert.equal(parseJavaVersion({ status: 0, stdout: '', stderr: '' }), 'unknown');                      // no output
  assert.equal(parseJavaVersion({ status: 1, stderr: 'openjdk version "21.0.5"' }), 'unknown');          // command failed
  assert.equal(parseJavaVersion({ status: null, error: Object.assign(new Error('x'), { code: 'ENOENT' }) }), 'unknown');   // no java
  assert.equal(parseJavaVersion({ status: 0, stderr: 'something else entirely' }), 'unknown');
  assert.equal(parseJavaVersion(), 'unknown');
});

// ----------------------------------------------------------------------------- C1-REV004 known-secret collector
import { collectKnownSecrets, platformSecretValues, MIN_SECRET_LEN } from '../src/b3/secrets.mjs';
test('C1-REV004: the packaging list unites issued tokens (rotated included), case tokens and platform credentials', () => {
  const env = { ACTIONS_RUNTIME_TOKEN: 'synthetic-platform-opaque-value-1', MY_DEPLOY_SECRET: 'synthetic-platform-opaque-value-2', PATH: '/usr/bin:/bin', HOME: '/root', GITHUB_TOKEN: 'short', RUNNER_TEMP: '/tmp/x' };
  const r = collectKnownSecrets({ issued: ['issued-id-token-0001-current', 'issued-id-token-0000-rotated', 'issued-id-token-0001-current'], caseTokens: ['case-token-value-00001'], env });
  for (const v of ['issued-id-token-0001-current', 'issued-id-token-0000-rotated', 'case-token-value-00001', 'synthetic-platform-opaque-value-1', 'synthetic-platform-opaque-value-2']) assert.ok(r.values.includes(v), v);
  assert.ok(!r.values.includes('/usr/bin:/bin') && !r.values.includes('short'));
  assert.deepEqual(r.counts, { issued: 3, caseTokens: 1, platform: 2, total: 5 });   // per-source counts before de-duplication
  assert.throws(() => collectKnownSecrets({}), TypeError);
  assert.ok(MIN_SECRET_LEN >= 12);
  assert.deepEqual(platformSecretValues({ GH_TOKEN: 'x'.repeat(20), OTHER: 'y'.repeat(20) }), ['x'.repeat(20)]);
  // the reviewer's case: an opaque platform value under a neutral key is masked once it comes from the collector
  const full = finalizeSelfCheck({ NO_CAPS: { ok: true, observedRaw: { observed: 'synthetic-platform-opaque-value-1' }, positiveControlOk: null } }, { secretValues: r.values }).selfCheckFull.NO_CAPS.observedFull;
  assert.ok(!full.includes('synthetic-platform-opaque-value-1')); assert.ok(full.includes(MASK_SECRET));
  // and b3-run assembles the list ONLY through the collector, for masking and for the leak scans
  const run = rf(f2p(new URL('./b3-run.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(run, /secretValues = h\.issuedSecrets\(\)|secrets = h\.issuedSecrets\(\)/);
  assert.equal((run.match(/packagingSecrets\(\)/g) || []).length >= 3, true);
});
