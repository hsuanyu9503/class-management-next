/** B3a unit tests (no emulator, no root, no network). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../src/authz.mjs';
import { maskAuthorization } from '../src/mask.mjs';
import { sandboxConfig, configDigest, initScript, unshareArgs, CHECK_IDS } from '../src/b3/isolation-policy.mjs';
import { writePackage, readPackageSafe, rawTar, parseStrictJson, PackageError } from '../src/b3/package.mjs';
import { verifyPackage, PAYLOAD } from '../src/b3/verifier.mjs';
import { reconcile } from '../src/b3/reconcile.mjs';

const code = (fn) => { try { fn(); return 'NO_ERROR'; } catch (e) { assert.ok(e instanceof PackageError, String(e)); return e.code; } };

test('R1-N5: prototype names are unknown operations (own-key lookup)', async () => {
  const store = { getBinding: async () => ({ authUid: 'U', principalId: 'P', status: 'active', activatedAt: '2026-11-01T00:00:00Z' }), getPrincipal: async () => ({ principalId: 'P', status: 'active' }), findTargets: async () => [], listMemberships: async () => [] };
  for (const op of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'valueOf']) {
    assert.equal((await authorize({ op, claims: { authUid: 'U', iat: 1795000000 }, target: {}, claimedScope: {}, nowMs: Date.now(), store })).reasonCode, 'UNKNOWN_OPERATION', op);
  }
});

test('R1-N6: non-Bearer Authorization values are not hashed', () => {
  const r = maskAuthorization('Basic dXNlcjpwYXNzd29yZA==');
  assert.deepEqual(r, { masked: true, scheme: 'other' });
  assert.ok(!JSON.stringify(r).includes('dXNlcj'));
});

test('isolation policy: 22 check IDs; digest is stable and changes with any launch parameter', () => {
  assert.equal(CHECK_IDS.length, 22); assert.equal(new Set(CHECK_IDS).size, 22);
  assert.equal(configDigest(sandboxConfig()), configDigest(sandboxConfig()));
  const base = configDigest(sandboxConfig());
  for (const o of [{ namespaces: ['ipc', 'mnt', 'pid', 'uts'] }, { uid: 0 }, { noNewPrivs: false }, { env: { HOME: '/work', PATH: '/usr/bin', EXTRA: '1' } }, { inheritedFds: [0, 1, 2, 3, 4] }, { mounts: sandboxConfig().mounts.slice(1) }]) {
    assert.notEqual(configDigest(sandboxConfig(o)), base, JSON.stringify(o).slice(0, 40));
  }
  assert.deepEqual(unshareArgs(sandboxConfig()), ['--ipc', '--mount', '--net', '--pid', '--uts', '--fork']);
  assert.ok(!unshareArgs(sandboxConfig({ namespaces: ['ipc', 'mnt', 'pid', 'uts'] })).includes('--net'));
  const s = initScript(sandboxConfig(), { nodeDir: '/n', adapterDir: '/a', checkDir: '/c', inputDir: '/i', entryDir: '/e' }, '/adapter/main.mjs');
  for (const frag of ['pivot_root . oldroot', '--reuid 65534', '--no-new-privs', '--bounding-set=-all', '/usr/bin/env -i', "remount,bind,ro,nodev,nosuid \"$R\"'/adapter'", 'CMN_INIT_FDS']) assert.ok(s.includes(frag), frag);
});

test('package: reproducible, payload-only manifest, round trip', () => {
  const a = writePackage({ 'b.json': '{"x":1}', 'a/c.jsonl': '{}\n' });
  const b = writePackage({ 'a/c.jsonl': '{}\n', 'b.json': '{"x":1}' });
  assert.equal(a.packageSha256, b.packageSha256);
  const r = readPackageSafe(a.packageBytes);
  assert.deepEqual([...r.files.keys()], ['manifest.json', 'a/c.jsonl', 'b.json']);
  assert.deepEqual(r.manifest.files.map((f) => f.path), ['a/c.jsonl', 'b.json']);
  assert.equal(r.manifestSha256, a.manifestSha256);
  assert.equal(code(() => writePackage({ 'manifest.json': '{}' })), 'ARTIFACT_PATH_INVALID');
});

test('A17: hostile packages are rejected before anything is read', () => {
  const m = (files) => JSON.stringify({ manifestVersion: 's2-package-manifest-v1', files });
  const okManifest = { name: 'manifest.json', content: m([]) };
  const cases = {
    '../outside.json': [okManifest, { name: '../outside.json', content: '{}' }],
    '/abs.json': [okManifest, { name: '/abs.json', content: '{}' }],
    'a/../../x': [okManifest, { name: 'a/../../x', content: '{}' }],
    '.hidden': [okManifest, { name: '.hidden', content: '{}' }],
    'symlink': [okManifest, { name: 'link', type: '2' }],
    'hardlink': [okManifest, { name: 'hard', type: '1' }],
    'device': [okManifest, { name: 'dev', type: '3' }],
    'duplicate': [okManifest, { name: 'a.json', content: '{}' }, { name: 'a.json', content: '{}' }],
    'case collision': [okManifest, { name: 'A.json', content: '{}' }, { name: 'a.json', content: '{}' }],
    'unlisted file': [okManifest, { name: 'extra.json', content: '{}' }],
    'missing manifest': [{ name: 'x.json', content: '{}' }],
    'listed but missing': [{ name: 'manifest.json', content: m([{ path: 'x.json', bytes: 2, sha256: '0'.repeat(64) }]) }],
    'digest mismatch': [{ name: 'manifest.json', content: m([{ path: 'x.json', bytes: 2, sha256: '0'.repeat(64) }]) }, { name: 'x.json', content: '{}' }],
    'manifest lists itself': [{ name: 'manifest.json', content: m([{ path: 'manifest.json', bytes: 1, sha256: '0'.repeat(64) }]) }],
    'duplicate key in manifest': [{ name: 'manifest.json', content: '{"files":[],"files":[]}' }],
    'too many files': [okManifest, ...Array.from({ length: 2002 }, (_, i) => ({ name: `f${i}`, content: '' }))],
  };
  const expected = { '../outside.json': 'ARTIFACT_PATH_INVALID', '/abs.json': 'ARTIFACT_PATH_INVALID', 'a/../../x': 'ARTIFACT_PATH_INVALID', '.hidden': 'ARTIFACT_PATH_INVALID', symlink: 'ARTIFACT_ENTRY_TYPE', hardlink: 'ARTIFACT_ENTRY_TYPE', device: 'ARTIFACT_ENTRY_TYPE', duplicate: 'ARTIFACT_DUPLICATE', 'case collision': 'ARTIFACT_PATH_COLLISION', 'unlisted file': 'ARTIFACT_MANIFEST', 'missing manifest': 'ARTIFACT_MANIFEST', 'listed but missing': 'ARTIFACT_MANIFEST', 'digest mismatch': 'ARTIFACT_MANIFEST', 'manifest lists itself': 'ARTIFACT_MANIFEST', 'duplicate key in manifest': 'ARTIFACT_JSON_INVALID', 'too many files': 'ARTIFACT_LIMIT' };
  for (const [n, entries] of Object.entries(cases)) assert.equal(code(() => readPackageSafe(rawTar(entries))), expected[n], n);
});

test('strict JSON: duplicate keys, depth, trailing data, unsafe numbers', () => {
  assert.deepEqual(parseStrictJson('{"a":[1,2.5,"x\\n",true,null]}'), { a: [1, 2.5, 'x\n', true, null] });
  for (const bad of ['{"a":1,"a":2}', '['.repeat(70) + ']'.repeat(70), '{"a":1} x', '9007199254740993', 'NaN', '{"a":01}', "{'a':1}", '{"a":"\u0001"}']) assert.equal(code(() => parseStrictJson(bad)), 'ARTIFACT_JSON_INVALID', bad.slice(0, 20));
});

test('Verifier: content binding and payload set are checked before anything else', () => {
  const files = Object.fromEntries(PAYLOAD.map((p) => [p, p.endsWith('.jsonl') ? '' : '{}']));
  const p = writePackage(files);
  const trusted = { packageSha256: p.packageSha256, manifestSha256: p.manifestSha256 };
  assert.deepEqual(verifyPackage(Buffer.from(p.packageBytes), { ...trusted, packageSha256: '0'.repeat(64) }).reasons, ['PACKAGE_DIGEST_MISMATCH']);
  assert.deepEqual(verifyPackage(p.packageBytes, { ...trusted, manifestSha256: '0'.repeat(64) }).reasons, ['MANIFEST_DIGEST_MISMATCH']);
  const q = writePackage({ ...files, 'extra.json': '{}' });
  assert.deepEqual(verifyPackage(q.packageBytes, { packageSha256: q.packageSha256, manifestSha256: q.manifestSha256 }).reasons, ['PAYLOAD_SET_MISMATCH']);
  const v = verifyPackage(p.packageBytes, trusted); assert.equal(v.result, 'BLOCKED'); assert.match(v.reasons[0], /^TRUSTED_INPUT_MISSING/);
});

// ---- reconciliation on a synthetic world
const T = '2026-11-21T00:00:10.000Z';
const base = () => ({
  front: [{ role: 'front', traceId: 'TR-1', at: T, status: 200, requestBody: { op: 'attendanceEntry.read', target: { attendanceEntryId: 'E1' } }, authorizationRef: { claimedAuthUid: 'U1' } }],
  back: [{ role: 'back', traceId: 'TR-1', at: T, method: 'GET', path: '/v1/projects/p/databases/(default)/documents/authBindings/U1' }, { role: 'back', traceId: 'TR-1', at: T, method: 'PATCH', path: '/v1/projects/p/databases/(default)/documents/workspaces/W/auditLog/a1' }],
  pre: { 'authBindings/U1': { principalId: 'P1' }, 'workspaces/W/classes/C/attendanceSessions/S/entries/E1': { status: 'N' }, '_attestationRuns/1': { nonce: 'n' } },
  post: { 'authBindings/U1': { principalId: 'P1' }, 'workspaces/W/classes/C/attendanceSessions/S/entries/E1': { status: 'N' }, '_attestationRuns/1': { nonce: 'n' }, 'workspaces/W/auditLog/a1': { traceId: 'TR-1', authUid: 'U1', principalId: 'P1', action: 'attendanceEntry.read', decision: 'allow', reasonCode: 'OK', resourceRef: 'workspaces/W/classes/C/attendanceSessions/S/entries/E1', workspaceId: 'W' } },
  runnerLog: [], caseWindow: { start: Date.parse('2026-11-21T00:00:00Z'), end: Date.parse('2026-11-21T00:01:00Z') }, markerPath: '_attestationRuns/1', expectedMarker: { nonce: 'n' },
});
const probs = (mut) => { const b = base(); mut(b); return reconcile(b).problems.map((x) => x.split(':')[0]); };

test('reconcile: positive control and each rule', () => {
  assert.deepEqual(reconcile(base()).problems, []);
  assert.deepEqual(probs((b) => { delete b.post['workspaces/W/auditLog/a1']; }), ['AUDIT_UNRECONCILED']);
  assert.ok(probs((b) => { b.post['workspaces/W/auditLog/a2'] = { ...b.post['workspaces/W/auditLog/a1'], traceId: 'TR-X' }; }).includes('AUDIT_UNRECONCILED'));
  for (const [f, v] of [['action', 'student.read'], ['principalId', 'P2'], ['decision', 'deny'], ['reasonCode', 'NO_VALID_MEMBERSHIP'], ['resourceRef', 'workspaces/W/other'], ['authUid', 'U2']]) {
    assert.ok(probs((b) => { b.post['workspaces/W/auditLog/a1'][f] = v; }).includes('AUDIT_UNRECONCILED'), f);
  }
  assert.ok(probs((b) => { b.front.push({ ...b.front[0] }); }).includes('DUPLICATE_TRACE_ID'));
  assert.ok(probs((b) => { b.back.push({ role: 'back', traceId: null, at: T, method: 'GET', path: '/x' }); }).includes('UNATTRIBUTED_BACKEND_TRAFFIC'));
  assert.ok(probs((b) => { b.back.push({ role: 'back', traceId: 'TR-1', at: T, method: 'PATCH', path: '/v1/projects/p/databases/(default)/documents/workspaces/W/classes/C/attendanceSessions/S/entries/E1' }); }).includes('NON_AUDIT_BACKEND_WRITE'));
  assert.ok(probs((b) => { b.front[0].at = '2026-11-21T00:05:00.000Z'; }).includes('PHASE_VIOLATION'));
  assert.ok(probs((b) => { b.runnerLog.push({ at: T, phase: 'case', channel: 'runner', op: 'x' }); }).includes('PHASE_VIOLATION'));
  assert.ok(probs((b) => { b.post['_attestationRuns/1'] = { nonce: 'other' }; }).includes('NONCE_MISMATCH'));
  assert.ok(probs((b) => { b.post['workspaces/W/classes/C/attendanceSessions/S/entries/E1'] = { status: 'P' }; }).includes('STATE_CHANGE_UNEXPLAINED'));
  assert.ok(probs((b) => { b.pre['workspaces/W/auditLog/old'] = { traceId: 'TR-0' }; b.post['workspaces/W/auditLog/old'] = { traceId: 'TR-0', decision: 'allow' }; }).includes('AUDIT_MODIFIED_OR_DELETED'));
});

// ======================================================================= R1 (B3A-N1 … N4) probes on a real package
import { readFileSync as rf } from 'node:fs';
import { fileURLToPath as f2p } from 'node:url';
import { CHECK_IDS as IDS, POSITIVE_CONTROL_REQUIRED } from '../src/b3/isolation-policy.mjs';
const FIX = f2p(new URL('./fixtures/b3a-honest-poc001/', import.meta.url));
const fixBytes = rf(`${FIX}package.tar`);
const fixOut = JSON.parse(rf(`${FIX}job-outputs.json`, 'utf8'));
const fixFiles = Object.fromEntries([...readPackageSafe(fixBytes).files].filter(([n]) => n !== 'manifest.json').map(([n, b]) => [n, b.toString('utf8')]));
const fixRun = JSON.parse(fixFiles['run.json']);
const caseSpec001 = JSON.parse(rf(f2p(new URL('../../stage1/contracts/canonical-oracles-v1.0.json', import.meta.url)), 'utf8')).cases.find((c) => c.testId === 'POC-001');
const trustedBase = { runId: fixRun.runId, runAttempt: fixRun.runAttempt, attestationNonce: fixRun.attestationNonce, testId: 'POC-001', trustedToolchainCommit: fixRun.trustedToolchainCommit, adapterCommit: fixRun.adapterCommit, caseSpec: caseSpec001, runnerKind: 'local-untrusted', platformSupported: true };
/** Repackage with modified payload text; digests are supplied consistently (simulating a Runner that produced it). */
const verifyMod = (mods = {}, trustedMods = {}) => { const p = writePackage({ ...fixFiles, ...mods }); return verifyPackage(p.packageBytes, { ...trustedBase, packageSha256: p.packageSha256, manifestSha256: p.manifestSha256, ...trustedMods }); };
const isoMod = (fn) => { const v = JSON.parse(fixFiles['isolation.json']); fn(v); return { 'isolation.json': JSON.stringify(v) }; };
const codes = (r) => r.reasons.map((x) => x.split(':')[0]);
const LOCAL_ONLY = ['LOCAL_UNTRUSTED_RUNNER', 'TRUST_ROOT_NOT_CONFIGURED'];

test('R1 positive control: the honest fixture package verifies as UNATTESTED (local only)', () => {
  const r = verifyPackage(fixBytes, { ...trustedBase, packageSha256: fixOut.packageSha256, manifestSha256: fixOut.manifestSha256 });
  assert.equal(r.result, 'UNATTESTED'); assert.deepEqual(r.reasons, LOCAL_ONLY);
  const r2 = verifyMod();   // repackaged unchanged → same verdict
  assert.equal(r2.result, 'UNATTESTED'); assert.deepEqual(r2.reasons, LOCAL_ONLY);
});

test('B3A-N1 (P1): a check whose value is not a plain object is never skipped', () => {
  for (const v of [null, false, 0, '', [], true, 1, 'ok']) {
    const r = verifyMod(isoMod((i) => { i.selfCheck.NO_CAPS = v; }));
    assert.equal(r.result, 'BLOCKED', JSON.stringify(v)); assert.ok(codes(r).includes('ISOLATION_CHECK_FAILED'), JSON.stringify(v));
  }
  const all = verifyMod(isoMod((i) => { for (const id of IDS) i.selfCheck[id] = null; }));
  assert.equal(all.result, 'BLOCKED'); assert.ok(codes(all).includes('ISOLATION_CHECK_FAILED'));
  for (const v of [null, [], 'x', 0]) { const r = verifyMod(isoMod((i) => { i.selfCheck = v; })); assert.equal(r.result, 'BLOCKED'); assert.ok(codes(r).includes('ISOLATION_CHECK_MISSING'), JSON.stringify(v)); }
});

test('B3A-N2: parseStrictJson rejects "__proto__" and never touches the prototype', () => {
  assert.equal(code(() => parseStrictJson('{"__proto__":{"x":1}}')), 'ARTIFACT_JSON_INVALID');
  assert.equal(code(() => parseStrictJson('{"a":{"b":[{"__proto__":null}]}}')), 'ARTIFACT_JSON_INVALID');
  const o = parseStrictJson('{"constructor":1,"toString":2}');
  assert.equal(Object.getPrototypeOf(o), Object.prototype); assert.ok(Object.hasOwn(o, 'constructor') && Object.hasOwn(o, 'toString'));
});

const FAKE_AUDIT = 'workspaces/WS-A17/auditLog/00000000-0000-4000-8000-000000000000';
const fakeAudit = { auditId: 'x', traceId: 'TR-00000000-0000-4000-8000-000000000000', decision: 'allow', reasonCode: 'OK', action: null, authUid: null, principalId: null, resourceRef: null, workspaceId: 'WS-A17' };
const INJECTED = 'workspaces/WS-A17/classes/CLASS-606-A17/injected/doc1';
const withProto = (text, protoObj) => text.replace(/^\{/, `{"__proto__":${JSON.stringify(protoObj)},`);
const addDoc = (text, k, v) => { const o = JSON.parse(text); o[k] = v; return JSON.stringify(o); };

test('B3A-N2 (P2): an audit record hidden in state-pre.__proto__ → BLOCKED; control (no trick) → BLOCKED', () => {
  const post = addDoc(fixFiles['state-post.json'], FAKE_AUDIT, fakeAudit);
  const trick = verifyMod({ 'state-post.json': post, 'state-pre.json': withProto(fixFiles['state-pre.json'], { [FAKE_AUDIT]: fakeAudit }) });
  assert.equal(trick.result, 'BLOCKED'); assert.ok(codes(trick).includes('ARTIFACT_JSON_INVALID'));
  const control = verifyMod({ 'state-post.json': post });
  assert.equal(control.result, 'BLOCKED'); assert.ok(codes(control).includes('AUDIT_UNRECONCILED'));
});

test('B3A-N2 (P3): a non-audit document hidden in state-pre.__proto__ → BLOCKED; control → BLOCKED', () => {
  const post = addDoc(fixFiles['state-post.json'], INJECTED, { status: 'P' });
  const trick = verifyMod({ 'state-post.json': post, 'state-pre.json': withProto(fixFiles['state-pre.json'], { [INJECTED]: { status: 'P' } }) });
  assert.equal(trick.result, 'BLOCKED'); assert.ok(codes(trick).includes('ARTIFACT_JSON_INVALID'));
  const control = verifyMod({ 'state-post.json': post });
  assert.equal(control.result, 'BLOCKED'); assert.ok(codes(control).includes('STATE_CHANGE_UNEXPLAINED'));
});

test('B3A-N2 (P4): self-check items supplied through selfCheck.__proto__ → BLOCKED; control (empty selfCheck) → BLOCKED', () => {
  const v = JSON.parse(fixFiles['isolation.json']); const all = v.selfCheck;
  for (const protoContent of [all, { UNKNOWN_CHECK: { ok: true, observed: 'x', positiveControlOk: null } }]) {
    const text = JSON.stringify({ ...v, selfCheck: {} }).replace('"selfCheck":{}', `"selfCheck":{"__proto__":${JSON.stringify(protoContent)}}`);
    const r = verifyMod({ 'isolation.json': text });
    assert.equal(r.result, 'BLOCKED'); assert.ok(codes(r).includes('ARTIFACT_JSON_INVALID'));
  }
  const control = verifyMod(isoMod((i) => { i.selfCheck = {}; }));
  assert.equal(control.result, 'BLOCKED'); assert.ok(codes(control).includes('ISOLATION_CHECK_MISSING'));
});

test('B3A-N3 (P5): positive controls must be exactly true where required and exactly null elsewhere', () => {
  assert.equal(POSITIVE_CONTROL_REQUIRED.length, 12);
  const cases = {
    'HOST_ENDPOINTS_BLOCKED positiveControlOk null': (i) => { i.selfCheck.HOST_ENDPOINTS_BLOCKED.positiveControlOk = null; },
    'HOST_ENDPOINTS_BLOCKED positiveControlOk deleted': (i) => { delete i.selfCheck.HOST_ENDPOINTS_BLOCKED.positiveControlOk; },
    'all positiveControlOk deleted': (i) => { for (const id of IDS) delete i.selfCheck[id].positiveControlOk; },
    'non-required UID_NONROOT positiveControlOk true': (i) => { i.selfCheck.UID_NONROOT.positiveControlOk = true; },
    'non-required NO_CAPS positiveControlOk deleted': (i) => { delete i.selfCheck.NO_CAPS.positiveControlOk; },
    'required NO_SUDO positiveControlOk "true" (string)': (i) => { i.selfCheck.NO_SUDO.positiveControlOk = 'true'; },
  };
  for (const [n, fn] of Object.entries(cases)) { const r = verifyMod(isoMod(fn)); assert.equal(r.result, 'BLOCKED', n); assert.ok(codes(r).includes('ISOLATION_CHECK_FAILED'), n); }
  const honestIso = JSON.parse(fixFiles['isolation.json']);
  for (const id of IDS) assert.equal(honestIso.selfCheck[id].positiveControlOk, POSITIVE_CONTROL_REQUIRED.includes(id) ? true : null, id);
});

test('B3A-N4: platformSupported comes from the trusted input; the unverifiable branch still checks digests, protocol, READY and termination', () => {
  const lie = verifyMod(isoMod((i) => { i.platformSupported = false; i.selfCheck = null; }));
  assert.equal(lie.result, 'BLOCKED'); assert.ok(codes(lie).includes('ISOLATION_PLATFORM_MISMATCH'));
  const unsupported = (fn = () => {}) => verifyMod(isoMod((i) => { i.platformSupported = false; i.selfCheck = null; fn(i); }), { platformSupported: false });
  const ok = unsupported();
  assert.equal(ok.result, 'UNATTESTED'); assert.deepEqual(ok.reasons, ['ISOLATION_UNVERIFIABLE']);
  const bad = {
    'wrong sandbox digest': [(i) => { i.sandboxPolicyDigest = '0'.repeat(64); }, 'SANDBOX_CONFIG_MISMATCH'],
    'control violation': [(i) => { i.controlViolations = ['HELLO']; }, 'CONTROL_PROTOCOL_VIOLATION'],
    'not READY': [(i) => { i.adapterReady = false; }, 'ADAPTER_NOT_READY'],
    'termination unverified': [(i) => { i.adapterTermination.remainingAdapterProcesses = 1; }, 'ADAPTER_TERMINATION_UNVERIFIED'],
  };
  for (const [n, [fn, c]] of Object.entries(bad)) { const r = unsupported(fn); assert.equal(r.result, 'BLOCKED', n); assert.ok(codes(r).includes(c), n); }
  const wrongRunDigest = verifyMod({ ...isoMod((i) => { i.platformSupported = false; i.selfCheck = null; }), 'run.json': JSON.stringify({ ...fixRun, adapterSandboxPolicyDigest: '1'.repeat(64) }) }, { platformSupported: false });
  assert.equal(wrongRunDigest.result, 'BLOCKED'); assert.ok(codes(wrongRunDigest).includes('SANDBOX_CONFIG_MISMATCH'));
  const missing = verifyMod({}, { platformSupported: undefined });
  assert.equal(missing.result, 'BLOCKED'); assert.ok(codes(missing).includes('TRUSTED_INPUT_MISSING'));
});

test('B3A-N5 (P6): bytes appended after the tar end-of-archive marker are rejected by the safe reader', { todo: 'B3A-N5 deferred: strict tar parsing (re-serialisation must be byte-identical)' }, () => {
  const p = writePackage({ 'a.json': '{}' });
  assert.equal(code(() => readPackageSafe(Buffer.concat([p.packageBytes, Buffer.from('trailing')]))), 'ARTIFACT_FORMAT');
});
