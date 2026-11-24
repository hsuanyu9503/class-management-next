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
  const s = initScript(sandboxConfig(), { nodeBinary: '/n/bin/node', adapterDir: '/a', checkDir: '/c', inputDir: '/i', entryDir: '/e', usrFiles: [{ inside: '/usr/bin/env', source: '/usr/bin/env' }] }, '/adapter/main.mjs');
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
/** Firestore encoding of an audit record as the API's store writes it (strings and nulls only). */
const encAudit = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null ? { nullValue: null } : { stringValue: v }])) });
/** The synthetic audit PATCH writes WHATEVER post holds at reconcile time (getter), so tests that change the
 *  post record keep testing their own rule; PR1-REV001 tests override requestBody / query explicitly. */
const withAuditPatch = (b) => { const patch = b.back[1]; patch.query = [{ 'currentDocument.exists': 'false' }];
  Object.defineProperty(patch, 'requestBody', { configurable: true, enumerable: true, get: () => encAudit(b.post['workspaces/W/auditLog/a1'] || {}) }); return b; };
const base = () => withAuditPatch({
  front: [{ role: 'front', traceId: 'TR-1', at: T, status: 200, requestBody: { op: 'attendanceEntry.read', target: { attendanceEntryId: 'E1' }, claimedScope: { workspaceId: 'W', classId: 'C' } }, authorizationRef: { claimedAuthUid: 'U1' } }],
  back: [{ role: 'back', traceId: 'TR-1', at: T, method: 'GET', path: '/v1/projects/p/databases/(default)/documents/authBindings/U1' }, { role: 'back', traceId: 'TR-1', at: T, method: 'PATCH', status: 200, path: '/v1/projects/p/databases/(default)/documents/workspaces/W/auditLog/a1' }],
  pre: { 'authBindings/U1': { principalId: 'P1' }, 'workspaces/W/classes/C/attendanceSessions/S/entries/E1': { attendanceEntryId: 'E1', status: 'N' }, '_attestationRuns/1': { nonce: 'n' } },
  post: { 'authBindings/U1': { principalId: 'P1' }, 'workspaces/W/classes/C/attendanceSessions/S/entries/E1': { attendanceEntryId: 'E1', status: 'N' }, '_attestationRuns/1': { nonce: 'n' }, 'workspaces/W/auditLog/a1': { auditId: 'a1', at: T, policyVersion: 's2b1-v0.7', traceId: 'TR-1', authUid: 'U1', principalId: 'P1', action: 'attendanceEntry.read', decision: 'allow', reasonCode: 'OK', resourceRef: 'workspaces/W/classes/C/attendanceSessions/S/entries/E1', workspaceId: 'W' } },
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
const trustedBase = { runId: fixRun.runId, runAttempt: fixRun.runAttempt, attestationNonce: fixRun.attestationNonce, testId: 'POC-001', scenario: 'honest', trustedToolchainCommit: fixRun.trustedToolchainCommit, adapterCommit: fixRun.adapterCommit, caseSpec: caseSpec001, runnerKind: 'local-untrusted', platformSupported: true };
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
  const lie = verifyMod(isoMod((i) => { i.platformSupported = false; i.selfCheck = null; i.selfCheckFull = null; }));
  assert.equal(lie.result, 'BLOCKED'); assert.ok(codes(lie).includes('ISOLATION_PLATFORM_MISMATCH'));
  const unsupported = (fn = () => {}) => verifyMod(isoMod((i) => { i.platformSupported = false; i.selfCheck = null; i.selfCheckFull = null; fn(i); }), { platformSupported: false });
  const ok = unsupported();
  assert.equal(ok.result, 'UNATTESTED'); assert.deepEqual(ok.reasons, ['ISOLATION_UNVERIFIABLE']);
  const bad = {
    'wrong sandbox digest': [(i) => { i.sandboxPolicyDigest = '0'.repeat(64); }, 'SANDBOX_CONFIG_MISMATCH'],
    'control violation': [(i) => { i.controlViolations = ['HELLO']; }, 'CONTROL_PROTOCOL_VIOLATION'],
    'not READY': [(i) => { i.adapterReady = false; }, 'ADAPTER_NOT_READY'],
    'termination unverified': [(i) => { i.adapterTermination.remainingAdapterProcesses = 1; }, 'ADAPTER_TERMINATION_UNVERIFIED'],
  };
  for (const [n, [fn, c]] of Object.entries(bad)) { const r = unsupported(fn); assert.equal(r.result, 'BLOCKED', n); assert.ok(codes(r).includes(c), n); }
  const wrongRunDigest = verifyMod({ ...isoMod((i) => { i.platformSupported = false; i.selfCheck = null; i.selfCheckFull = null; }), 'run.json': JSON.stringify({ ...fixRun, adapterSandboxPolicyDigest: '1'.repeat(64) }) }, { platformSupported: false });
  assert.equal(wrongRunDigest.result, 'BLOCKED'); assert.ok(codes(wrongRunDigest).includes('SANDBOX_CONFIG_MISMATCH'));
  const missing = verifyMod({}, { platformSupported: undefined });
  assert.equal(missing.result, 'BLOCKED'); assert.ok(codes(missing).includes('TRUSTED_INPUT_MISSING'));
});

test('B3A-N5 (P6): bytes appended after the tar end-of-archive marker are rejected by the safe reader', () => {
  const p = writePackage({ 'a.json': '{}' });
  assert.equal(code(() => readPackageSafe(p.packageBytes)), 'NO_ERROR');   // control: canonical package
  for (const tail of [Buffer.from('trailing'), Buffer.alloc(512, 0), Buffer.alloc(1, 0)]) assert.equal(code(() => readPackageSafe(Buffer.concat([p.packageBytes, tail]))), 'ARTIFACT_NONCANONICAL');
  assert.equal(code(() => readPackageSafe(p.packageBytes.subarray(0, p.packageBytes.length - 512))), 'ARTIFACT_NONCANONICAL');   // short end marker
});

test('B3A-N5: every non-canonical serialisation of a valid payload is refused (headers, order, manifest text)', () => {
  const p = writePackage({ 'a.json': '{}', 'b.json': '[]' }); const b = Buffer.from(p.packageBytes);
  const reheader = (buf, off, field, val) => { const x = Buffer.from(buf); x.write(val, off + field); let sum = 0; for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : x[off + i]; x.write(sum.toString(8).padStart(6, '0') + '\0 ', off + 148); return x; };
  assert.equal(code(() => readPackageSafe(reheader(b, 0, 136, '00000000001\0'))), 'ARTIFACT_NONCANONICAL');   // mtime ≠ 0
  assert.equal(code(() => readPackageSafe(reheader(b, 0, 100, '0000755\0'))), 'ARTIFACT_NONCANONICAL');       // mode ≠ 0644
  assert.equal(code(() => readPackageSafe(reheader(b, 0, 265, 'root'))), 'ARTIFACT_NONCANONICAL');            // uname set
  // same files, payload entries in reverse order
  const m = JSON.parse(p.manifestBytes); const raw = rawTar([{ name: 'manifest.json', content: p.manifestBytes.toString() }, { name: 'b.json', content: '[]' }, { name: 'a.json', content: '{}' }]);
  assert.equal(code(() => readPackageSafe(raw)), 'ARTIFACT_NONCANONICAL');
  // manifest with the same content but different JSON text (whitespace)
  const pretty = JSON.stringify(m, null, 1);
  const raw2 = rawTar([{ name: 'manifest.json', content: pretty }, { name: 'a.json', content: '{}' }, { name: 'b.json', content: '[]' }]);
  assert.equal(code(() => readPackageSafe(raw2)), 'ARTIFACT_NONCANONICAL');
  // control: rawTar with canonical order and text reproduces writePackage exactly
  const raw3 = rawTar([{ name: 'manifest.json', content: p.manifestBytes.toString() }, { name: 'a.json', content: '{}' }, { name: 'b.json', content: '[]' }]);
  assert.ok(raw3.equals(p.packageBytes)); assert.equal(code(() => readPackageSafe(raw3)), 'NO_ERROR');
});

// ======================================================================= F1 (B3A-R1-N1, NOTE-a, NOTE-b)
import { VERIFIER_VERSION } from '../src/b3/verifier.mjs';

test('NOTE-b: Verifier version is s2-verifier-b4-0 (B4 write cases)', () => {
  assert.equal(VERIFIER_VERSION, 's2-verifier-b4-0');
  assert.equal(verifyMod().verifierVersion, 's2-verifier-b4-0');
});

test('B3A-R1-N1: non-object top-level JSON is BLOCKED with a named reason and never throws', () => {
  const firstLine = (name, line) => ({ [name]: [line, ...fixFiles[name].split('\n').slice(1)].join('\n') });
  const someLine = (name, line) => { const l = fixFiles[name].split('\n'); l.splice(1, 0, line); return { [name]: l.join('\n') }; };
  const cases = [
    ...['null', '[]', '"x"', '0'].map((v) => [`isolation.json = ${v}`, { 'isolation.json': v }, 'ISOLATION_EVIDENCE_INVALID']),
    ...['null', '[]'].map((v) => [`run.json = ${v}`, { 'run.json': v }, 'ARTIFACT_JSON_INVALID']),
    ['state-pre.json = null', { 'state-pre.json': 'null' }, 'ARTIFACT_JSON_INVALID'],
    ['state-post.json = []', { 'state-post.json': '[]' }, 'ARTIFACT_JSON_INVALID'],
    ['trace-front.jsonl first line = null', firstLine('trace-front.jsonl', 'null'), 'ARTIFACT_JSON_INVALID'],
    ['runner-log.jsonl a line = [1]', someLine('runner-log.jsonl', '[1]'), 'ARTIFACT_JSON_INVALID'],
    ['trace-back.jsonl a line = "x"', someLine('trace-back.jsonl', '"x"'), 'ARTIFACT_JSON_INVALID'],
    ['adapter-claim.json = []', { 'adapter-claim.json': '[]' }, 'ARTIFACT_JSON_INVALID'],
  ];
  for (const [n, mods, c] of cases) {
    let r; assert.doesNotThrow(() => { r = verifyMod(mods); }, n);
    assert.equal(r.result, 'BLOCKED', n); assert.deepEqual(codes(r), [c], n);
    assert.equal(r.isolation, null, n);   // out.isolation is assigned only after the isolation shape check
  }
  // adapter-claim.json = null is allowed by design (no Adapter output) and is not a shape error
  const nullClaim = verifyMod({ 'adapter-claim.json': 'null' });
  assert.ok(!codes(nullClaim).includes('ARTIFACT_JSON_INVALID'), JSON.stringify(nullClaim.reasons));
});

test('B3A-R1-N1 / NOTE ⑨: trusted input null or not an object → BLOCKED TRUSTED_INPUT_MISSING, never throws', () => {
  for (const t of [null, undefined, [], 'x', 0]) {
    let r; assert.doesNotThrow(() => { r = verifyPackage(fixBytes, t); }, String(t));
    assert.equal(r.result, 'BLOCKED'); assert.deepEqual(r.reasons, ['TRUSTED_INPUT_MISSING'], String(t));
  }
});

test('B3A-R1-N1: an unexpected error is BLOCKED VERIFIER_INTERNAL_ERROR with the error class only (no message)', () => {
  const trusted = { ...trustedBase, packageSha256: fixOut.packageSha256, manifestSha256: fixOut.manifestSha256 };
  for (const bytes of [undefined, null, 42, {}]) {
    let r; assert.doesNotThrow(() => { r = verifyPackage(bytes, trusted); }, String(bytes));
    assert.equal(r.result, 'BLOCKED'); assert.equal(r.reasons.length, 1); assert.match(r.reasons[0], /^VERIFIER_INTERNAL_ERROR:(TypeError|RangeError|SyntaxError|ReferenceError|Error|NonError)$/);
  }
  // a crash deep inside (an audit record that is null) is contained too, and its message is not copied
  const AUD = 'workspaces/WS-A17/auditLog/11111111-1111-4111-8111-111111111111';
  const r = verifyMod({ 'state-post.json': addDoc(fixFiles['state-post.json'], AUD, null) });
  assert.equal(r.result, 'BLOCKED'); assert.deepEqual(r.reasons, ['VERIFIER_INTERNAL_ERROR:TypeError']);
});

test('NOTE-a: reconcile never treats keys on the prototype chain of pre/post as existing documents', () => {
  const AUDIT_KEY = 'workspaces/W/auditLog/a1'; const DOC = 'workspaces/W/classes/C/attendanceSessions/S/entries/E1';
  const protoOf = (proto, own) => Object.assign(Object.create(proto), own);
  // (1) audit record on pre's prototype: the post audit is still a NEW record and still reconciles
  { const b = base(); b.pre = protoOf({ [AUDIT_KEY]: b.post[AUDIT_KEY] }, b.pre); const r = reconcile(b);
    assert.deepEqual(r.problems, []); assert.equal(r.counts.auditAdded, 1); assert.equal(r.counts.auditMatched, 1); }
  // (2) an own pre audit that survives only on post's prototype counts as deleted
  { const b = base(); const old = { traceId: 'TR-0', decision: 'allow' }; b.pre['workspaces/W/auditLog/old'] = old; b.post = protoOf({ 'workspaces/W/auditLog/old': old }, b.post);
    assert.ok(reconcile(b).problems.some((x) => x.startsWith('AUDIT_MODIFIED_OR_DELETED'))); }
  // (3) the audited resource exists only on the prototype chain → resourceRef is not reconciled
  { const b = base(); const d = b.pre[DOC]; delete b.pre[DOC]; delete b.post[DOC]; b.pre = protoOf({ [DOC]: d }, b.pre); b.post = protoOf({ [DOC]: d }, b.post);
    const p = reconcile(b).problems; assert.ok(p.some((x) => x.startsWith('AUDIT_UNRECONCILED') && x.includes('resourceRef')), JSON.stringify(p)); }
  // control: the same documents as own keys reconcile cleanly
  assert.deepEqual(reconcile(base()).problems, []);
});

// ======================================================================= PR-1 (B3A-N6): audit ↔ request binding
test('B3A-N6: audit fields are bound to the request (full resourceRef, null order, claimedScope, one PATCH per audit)', () => {
  const A = 'workspaces/W/auditLog/a1';
  const has = (mut, code = 'AUDIT_UNRECONCILED') => { const b = base(); mut(b); const pr = reconcile(b).problems; return pr.some((x) => x.startsWith(code)); };
  assert.deepEqual(reconcile(base()).problems, []);   // control
  const cases = {
    // resourceRef: same last segment, different (real) document → was accepted by the last-segment rule
    'resourceRef in another class with the same id': (b) => { const o = 'workspaces/W/classes/C2/attendanceSessions/S/entries/E1'; b.pre[o] = { attendanceEntryId: 'OTHER' }; b.post[o] = { attendanceEntryId: 'OTHER' }; b.post[A].resourceRef = o; },
    'target id matches two documents (ambiguous)': (b) => { const o = 'workspaces/W/classes/C2/attendanceSessions/S2/entries/E9'; b.pre[o] = { attendanceEntryId: 'E1' }; b.post[o] = { attendanceEntryId: 'E1' }; },
    'unknown op cannot resolve a resource': (b) => { b.front[0].requestBody.op = 'toString'; b.post[A].action = 'toString'; },
    // null order
    'allow without resourceRef': (b) => { b.post[A].resourceRef = null; },
    'authUid null but principal set': (b) => { b.post[A].authUid = null; b.post[A].decision = 'deny'; b.post[A].reasonCode = 'TOKEN_MISSING'; b.front[0].status = 403; },
    'principal null but resource set': (b) => { b.post[A].principalId = null; b.post[A].decision = 'deny'; b.post[A].reasonCode = 'BINDING_NOT_FOUND'; b.front[0].status = 403; },
    // claimedScope
    'allow while the claimed class differs': (b) => { b.front[0].requestBody.claimedScope = { workspaceId: 'W', classId: 'C9' }; },
    'allow without claimedScope': (b) => { delete b.front[0].requestBody.claimedScope; },
    'SCOPE_CLAIM_MISMATCH while the claim matches': (b) => { Object.assign(b.post[A], { decision: 'deny', reasonCode: 'SCOPE_CLAIM_MISMATCH' }); b.front[0].status = 403; },
    'SCOPE_CLAIM_MISSING while a claim is present': (b) => { Object.assign(b.post[A], { decision: 'deny', reasonCode: 'SCOPE_CLAIM_MISSING', resourceRef: null }); b.front[0].status = 403; },
    // PATCH binding
    'no back PATCH for the audit': (b) => { b.back = b.back.filter((x) => x.method !== 'PATCH'); },
    'PATCH to a different audit path': (b) => { b.back[1].path = b.back[1].path.replace('/a1', '/a2'); },
    'PATCH failed (409)': (b) => { b.back[1].status = 409; },
  };
  for (const [n, fn] of Object.entries(cases)) assert.ok(has(fn), n);
  // controls: consistent deny records reconcile cleanly
  const mismatchOk = (b) => { Object.assign(b.post[A], { decision: 'deny', reasonCode: 'SCOPE_CLAIM_MISMATCH' }); b.front[0].status = 403; b.front[0].requestBody.claimedScope = { workspaceId: 'W', classId: 'C9' }; };
  const missingOk = (b) => { Object.assign(b.post[A], { decision: 'deny', reasonCode: 'SCOPE_CLAIM_MISSING', resourceRef: null }); b.front[0].status = 403; delete b.front[0].requestBody.claimedScope; };
  const tokenOk = (b) => { Object.assign(b.post[A], { decision: 'deny', reasonCode: 'TOKEN_MISSING', authUid: null, principalId: null, resourceRef: null }); b.front[0].status = 403; b.front[0].authorizationRef = null; };
  for (const [n, fn] of [['mismatch', mismatchOk], ['missing', missingOk], ['token', tokenOk]]) { const b = base(); fn(b); assert.deepEqual(reconcile(b).problems, [], n); }
});

// ======================================================================= PR-1 (B3A-N7): minimal rootfs + path map
import { expectedRootEntries, insidePathOf, pathMapDigest, USR_BINARIES, MOUNT_TARGETS } from '../src/b3/isolation-policy.mjs';

test('B3A-N7: rootfs has no host /usr or /etc tree; /usr is a read-only copy of the listed files; node binary only', () => {
  const cfg = sandboxConfig();
  assert.ok(!cfg.mounts.some((m) => m.source === 'host:/usr' || m.source === 'host:/etc' || m.target === '/etc'), 'no host /usr or /etc');
  assert.ok(!MOUNT_TARGETS.includes('/etc') && MOUNT_TARGETS.includes('/opt/node/bin/node') && !MOUNT_TARGETS.includes('/opt/node'));
  const usr = cfg.mounts.find((m) => m.target === '/usr'); assert.equal(usr.source, 'tmpfs'); assert.equal(usr.mode, 'ro');
  const pm = { nodeBinary: '/n/bin/node', adapterDir: '/a', checkDir: '/c', inputDir: '/i', entryDir: '/e', usrFiles: [{ inside: '/usr/bin/env', source: '/usr/bin/env' }, { inside: '/usr/lib/x/libc.so.6', source: '/usr/lib/x/libc.so.6' }] };
  const s = initScript(cfg, pm, '/adapter/main.mjs');
  for (const frag of ["cp -L '/usr/bin/env' \"$R\"'/usr/bin/env'", "cp -L '/usr/lib/x/libc.so.6' \"$R\"'/usr/lib/x/libc.so.6'", "mount -o remount,ro,nodev,nosuid \"$R\"'/usr'", "touch \"$R\"'/opt/node/bin/node'", "mount --bind '/n/bin/node' \"$R\"'/opt/node/bin/node'"]) assert.ok(s.includes(frag), frag);
  assert.ok(!/mount --bind '\/usr' /.test(s) && !s.includes("'/etc'"), 'no bind of host /usr or /etc');
  // the copy happens before the read-only remount
  assert.ok(s.indexOf("cp -L '/usr/bin/env'") < s.indexOf("mount -o remount,ro,nodev,nosuid \"$R\"'/usr'"));
  assert.throws(() => initScript(cfg, { ...pm, usrFiles: [{ inside: '/etc/passwd', source: '/etc/passwd' }] }, '/x'), /outside \/usr/);
  assert.throws(() => initScript(cfg, { ...pm, usrFiles: [] }, '/x'), /no files/);
  assert.deepEqual(expectedRootEntries(cfg), ['adapter', 'bin', 'check', 'dev', 'entry', 'input', 'lib', 'lib64', 'opt', 'proc', 'sbin', 'usr', 'work']);
  assert.equal(insidePathOf('/lib/x86_64-linux-gnu/libc.so.6'), '/usr/lib/x86_64-linux-gnu/libc.so.6'); assert.equal(insidePathOf('/lib64/ld-linux-x86-64.so.2'), '/usr/lib64/ld-linux-x86-64.so.2');
  // the config digest covers the population rule
  assert.notEqual(configDigest(sandboxConfig({ usrPopulation: { ...cfg.usrPopulation, binaries: [...USR_BINARIES, '/usr/bin/sudo'] } })), configDigest(cfg));
});

test('B3A-N7: pathMapDigest covers every host source and file digest; the Verifier rejects inconsistent path maps', () => {
  const iso = JSON.parse(fixFiles['isolation.json']); const pm = iso.pathMap;
  assert.equal(pathMapDigest(pm), iso.pathMapDigest);
  for (const mut of [(p) => { p.nodeBinarySha256 = '0'.repeat(64); }, (p) => { p.adapterDir = '/x'; }, (p) => { p.usrFiles[0].sha256 = '1'.repeat(64); }, (p) => { p.usrFiles.pop(); }]) {
    const p = structuredClone(pm); mut(p); assert.notEqual(pathMapDigest(p), iso.pathMapDigest);
  }
  const bad = {
    'pathMap missing': (i) => { i.pathMap = null; },
    'digest missing': (i) => { i.pathMapDigest = null; },
    'digest of another map': (i) => { i.pathMap.adapterDir = '/elsewhere'; },
    'required binary absent (digest recomputed)': (i) => { i.pathMap.usrFiles = i.pathMap.usrFiles.filter((f) => f.inside !== '/usr/bin/setpriv'); i.pathMapDigest = pathMapDigest(i.pathMap); },
    'file outside /usr (digest recomputed)': (i) => { i.pathMap.usrFiles.push({ inside: '/etc/shadow', source: '/etc/shadow', sha256: '2'.repeat(64) }); i.pathMapDigest = pathMapDigest(i.pathMap); },
    'duplicate inside path (digest recomputed)': (i) => { i.pathMap.usrFiles.push({ ...i.pathMap.usrFiles[0] }); i.pathMapDigest = pathMapDigest(i.pathMap); },
    'traversal (digest recomputed)': (i) => { i.pathMap.usrFiles.push({ inside: '/usr/../etc/passwd', source: '/etc/passwd', sha256: '3'.repeat(64) }); i.pathMapDigest = pathMapDigest(i.pathMap); },
  };
  for (const [n, fn] of Object.entries(bad)) { const r = verifyMod(isoMod(fn)); assert.equal(r.result, 'BLOCKED', n); assert.ok(codes(r).includes('PATH_MAP_INVALID'), n); }
  // unsupported platform: no path map is required (still UNATTESTED ISOLATION_UNVERIFIABLE)
  const un = verifyMod(isoMod((i) => { i.platformSupported = false; i.selfCheck = null; i.selfCheckFull = null; i.pathMap = null; i.pathMapDigest = null; }), { platformSupported: false });
  assert.equal(un.result, 'UNATTESTED'); assert.deepEqual(un.reasons, ['ISOLATION_UNVERIFIABLE']);
  // statement carries the digest
  assert.equal(verifyMod().statement.isolation.pathMapDigest, iso.pathMapDigest);
});

// ======================================================================= PR-1 (B3A-N8): actor-only token
import { buildCaseInput } from '../src/b3/case-input.mjs';
import { CASE_ACTORS } from '../src/b3/verifier.mjs';

test('B3A-N8: case input carries only the case actor\'s token', () => {
  const users = { 'ACTOR-TEACHER': { token: 't-teacher' }, 'ACTOR-OTHER': { token: 't-other' }, 'ACTOR-SC01-TEACHER': { token: 't-sc01' } };
  for (const t of ['POC-001', 'POC-002', 'POC-008', 'POC-009', 'POC-016', 'POC-017', 'POC-018', 'POC-021']) {
    const inp = buildCaseInput({ testId: t, fixtures: {}, users, caseActors: CASE_ACTORS });
    assert.deepEqual(Object.keys(inp.tokens), [CASE_ACTORS[t]], t); assert.equal(inp.tokens[CASE_ACTORS[t]], users[CASE_ACTORS[t]].token);
    assert.ok(!JSON.stringify(inp).includes(Object.values(users).map((u) => u.token).find((x) => x !== users[CASE_ACTORS[t]].token)), t);
  }
  for (const t of ['POC-999', 'toString', '__proto__', null]) assert.throws(() => buildCaseInput({ testId: t, fixtures: {}, users, caseActors: CASE_ACTORS }), /no trusted actor/, String(t));
  assert.throws(() => buildCaseInput({ testId: 'POC-001', fixtures: {}, users: { 'ACTOR-OTHER': { token: 'x' } }, caseActors: CASE_ACTORS }), /no trusted actor/);
});

// ======================================================================= PR1-REV001: audit PATCH content ↔ exported record
// These probes seal an INTERNALLY CONTRADICTORY package and supply its digests consistently: they test the
// Verifier's own reconciliation, not an untrusted Adapter changing the trusted Runner's digests.
import { MASK } from '../src/mask.mjs';
import { queryOf } from '../src/trace-proxy.mjs';

test('PR1-REV001 (reviewer probe): an audit PATCH body that contradicts the exported record → BLOCKED; control → UNATTESTED', () => {
  const lines = fixFiles['trace-back.jsonl'].split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const i = lines.findIndex((e) => e.method === 'PATCH' && /\/auditLog\//.test(e.path));
  assert.ok(i >= 0); assert.deepEqual(lines[i].query, [{ 'currentDocument.exists': 'false' }]);   // structured query recorded
  const rebuild = (fn) => { const ls = structuredClone(lines); fn(ls[i]); return { 'trace-back.jsonl': ls.map((e) => JSON.stringify(e)).join('\n') + '\n' }; };
  const control = verifyMod(rebuild(() => {}));
  assert.equal(control.result, 'UNATTESTED'); assert.deepEqual(control.reasons, LOCAL_ONLY);
  const probe = verifyMod(rebuild((e) => { e.requestBody = { fields: { decision: { stringValue: 'deny' }, reasonCode: { stringValue: 'FAKE_REASON' } } }; }));
  assert.equal(probe.result, 'BLOCKED'); assert.ok(codes(probe).includes('AUDIT_UNRECONCILED'), JSON.stringify(probe.reasons));
  const oneField = verifyMod(rebuild((e) => { e.requestBody.fields.decision = { stringValue: 'deny' }; }));
  assert.equal(oneField.result, 'BLOCKED'); assert.ok(oneField.reasons.some((r) => r.includes('content differs') && r.includes('decision')), JSON.stringify(oneField.reasons));
  const noQuery = verifyMod(rebuild((e) => { delete e.query; }));
  assert.equal(noQuery.result, 'BLOCKED'); assert.ok(noQuery.reasons.some((r) => r.includes('not an observable create')));
});

test('PR1-REV001: audit write content is compared field by field, strictly decoded, and must be create-only', () => {
  const A = 'workspaces/W/auditLog/a1';
  const run = (fn) => { const b = base(); fn(b); return reconcile(b).problems; };
  const setBody = (b, body) => Object.defineProperty(b.back[1], 'requestBody', { value: body, enumerable: true, configurable: true, writable: true });
  const stored = () => base().post[A];
  assert.deepEqual(run(() => {}), []);   // control (body = encoded post record, query create-only)
  // every field: a different value in the write → BLOCKED, naming the field
  for (const k of Object.keys(stored())) {
    const pr = run((b) => { const d = { ...b.post[A], [k]: `${b.post[A][k]}-X` }; setBody(b, encAudit(d)); });
    assert.ok(pr.some((x) => x.startsWith('AUDIT_UNRECONCILED') && x.includes('content differs') && x.includes(k)), `${k}: ${pr}`);
  }
  // optional field present on one side only
  assert.ok(run((b) => { setBody(b, encAudit({ ...b.post[A], outcome: 'BACKEND_UNAVAILABLE' })); }).some((x) => x.includes('outcome')));
  assert.ok(run((b) => { const d = { ...b.post[A] }; delete d.workspaceId; setBody(b, encAudit(d)); }).some((x) => x.includes('workspaceId')));
  // missing required fields, unknown fields, wrong value types, wrong body shape
  for (const k of ['auditId', 'at', 'authUid', 'principalId', 'action', 'resourceRef', 'decision', 'reasonCode', 'policyVersion', 'traceId']) {
    assert.ok(run((b) => { const e = encAudit(b.post[A]); delete e.fields[k]; setBody(b, e); }).some((x) => x.includes(`missingField:${k}`)), k);
  }
  const shapes = {
    'unknown field': (e) => { e.fields.extra = { stringValue: 'x' }; },
    'integerValue': (e) => { e.fields.decision = { integerValue: '1' }; },
    'mapValue': (e) => { e.fields.decision = { mapValue: { fields: {} } }; },
    'two encodings': (e) => { e.fields.decision = { stringValue: 'allow', nullValue: null }; },
    'stringValue not a string': (e) => { e.fields.decision = { stringValue: 1 }; },
    'bare string': (e) => { e.fields.decision = 'allow'; },
  };
  for (const [n, fn] of Object.entries(shapes)) assert.ok(run((b) => { const e = encAudit(b.post[A]); fn(e); setBody(b, e); }).some((x) => x.startsWith('AUDIT_UNRECONCILED') && x.includes('audit write body')), n);
  for (const [n, body] of [['no body', null], ['array', []], ['extra top-level key', { ...encAudit(stored()), updateMask: { fieldPaths: ['decision'] } }], ['fields not an object', { fields: [] }]]) {
    assert.ok(run((b) => setBody(b, body)).some((x) => x.includes('bodyShape')), n);
  }
  // auditId must match the document path, traceId the trace, policyVersion the API's
  assert.ok(run((b) => { b.post[A].auditId = 'other'; }).some((x) => x.includes('auditIdPath')));
  assert.ok(run((b) => { b.post[A].policyVersion = 's2b1-v0.6'; }).some((x) => x.includes('policyVersion')));
  // create-only semantics
  const q = { 'missing (unobservable)': undefined, empty: [], 'exists=true': [{ 'currentDocument.exists': 'true' }], 'updateMask added': [{ 'currentDocument.exists': 'false' }, { 'updateMask.fieldPaths': 'decision' }], 'duplicate': [{ 'currentDocument.exists': 'false' }, { 'currentDocument.exists': 'false' }], 'not structured': 'currentDocument.exists=false' };
  for (const [n, v] of Object.entries(q)) assert.ok(run((b) => { b.back[1].query = v; }).some((x) => x.includes('not an observable create')), n);
  // masking projection: masked identically on both sides → equal; masked on one side only → differs
  assert.deepEqual(run((b) => { b.post[A].authUid = MASK; const e = encAudit(b.post[A]); e.fields.authUid = MASK; setBody(b, e); }).filter((x) => x.includes('content differs')), []);
  assert.ok(run((b) => { const e = encAudit(b.post[A]); e.fields.authUid = MASK; setBody(b, e); }).some((x) => x.includes('content differs') && x.includes('authUid')));
  // the proxy's structured query
  assert.deepEqual(queryOf('/v1/x/auditLog/a?currentDocument.exists=false'), [{ 'currentDocument.exists': 'false' }]);
  assert.deepEqual(queryOf('/v1/x?a=1&a=2&b='), [{ unknownParameter: { valueRecorded: false } }, { unknownParameter: { valueRecorded: false } }, { unknownParameter: { valueRecorded: false } }]);   // PR1-R1-REV001
  assert.deepEqual(queryOf('/v1/read'), []);
});

// ======================================================================= PR1-R1-REV001: query names/values never leak
import http from 'node:http';
import { mkdtempSync, readFileSync as rfs, rmSync as rms } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTraceProxy, MAX_QUERY_PARAMS } from '../src/trace-proxy.mjs';
import { makeMasker, findLeaks } from '../src/mask.mjs';

const FAKE_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJGQUtFX09OTFkifQ.fake_signature';   // fictional
const FAKE_NAME = '測試姓名甲'; const FAKE_EMAIL = 'fake.person@example.invalid';
const FAKE_KEY = ['sk', 'live', 'FAKE0000000000'].join('-');   // fictional; built at runtime so the source holds no credential-shaped literal
const NR = { valueRecorded: false };
const hostileQueries = () => [
  `${encodeURIComponent(FAKE_JWT)}=x`, `${encodeURIComponent(FAKE_NAME)}=1`, `${encodeURIComponent(FAKE_EMAIL)}=1`,
  `token=${encodeURIComponent(FAKE_JWT)}`, `key=${FAKE_KEY}`, `pageToken=${encodeURIComponent(FAKE_EMAIL)}`,
  `currentDocument.exists=${encodeURIComponent(FAKE_NAME)}`, `updateMask.fieldPaths=${encodeURIComponent(FAKE_JWT)}`,
  `currentDocument.exists=false&${encodeURIComponent(FAKE_JWT)}=1`, `currentDocument.exists=false&currentDocument.exists=false`,
  `${'%65%79%4A'}hbGciOiJub25lIn0.x.y=1`,   // percent-encoded "eyJ…" name
];

test('PR1-R1-REV001: queryOf is an allow-list projection — no caller-chosen name or value is copied', () => {
  for (const q of hostileQueries()) {
    const out = queryOf(`/v1/read?${q}`); const text = JSON.stringify(out);
    for (const secret of [FAKE_JWT, FAKE_NAME, FAKE_EMAIL, FAKE_KEY, 'eyJhbG']) assert.ok(!text.includes(secret), `${q} → ${text}`);
  }
  assert.deepEqual(queryOf('/x?currentDocument.exists=false'), [{ 'currentDocument.exists': 'false' }]);
  assert.deepEqual(queryOf('/x?pageSize=300&pageToken=abc&key=emulator-local'), [{ pageSize: '300' }, { pageToken: NR }, { key: 'emulator-local' }]);
  assert.deepEqual(queryOf(`/x?currentDocument.exists=false&${encodeURIComponent(FAKE_JWT)}=1`), [{ 'currentDocument.exists': 'false' }, { unknownParameter: NR }]);
  assert.deepEqual(queryOf(`/x?currentDocument.exists=${encodeURIComponent(FAKE_NAME)}`), [{ 'currentDocument.exists': NR }]);
  assert.equal(queryOf(`/x?${Array.from({ length: 40 }, (_, i) => `p${i}=1`).join('&')}`).length, MAX_QUERY_PARAMS + 1);
});

test('PR1-R1-REV001: extra, duplicate or invalid query parameters keep the audit PATCH rejectable', () => {
  const run = (url) => { const b = base(); b.back[1].query = queryOf(url); return reconcile(b).problems; };
  assert.deepEqual(run('/p?currentDocument.exists=false'), []);   // normal create stays reconcilable
  for (const u of [`/p?currentDocument.exists=false&${encodeURIComponent(FAKE_JWT)}=1`, '/p?currentDocument.exists=false&currentDocument.exists=false', `/p?currentDocument.exists=${encodeURIComponent(FAKE_NAME)}`, '/p?currentDocument.exists=false&updateMask.fieldPaths=decision', '/p?']) {
    assert.ok(run(u).some((x) => x.includes('not an observable create')), u);
  }
});

test('PR1-R1-REV001: the JSONL the trace proxy actually writes holds none of the hostile query names/values (incl. failed requests)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cmn-q-'));
  const upstream = http.createServer((req, res) => { req.resume(); res.writeHead(req.url.startsWith('/v1/read') ? 403 : 200, { 'content-type': 'application/json' }); res.end('{"code":"FORBIDDEN"}'); });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const masker = makeMasker([FAKE_NAME]);
  const proxies = [];
  try {
    for (const [role, routeTo] of [['front', upOrigin], ['back', upOrigin], ['back', 'http://127.0.0.1:1']]) {   // last one: upstream down → 502 (failed request)
      const file = path.join(dir, `${role}-${proxies.length}.jsonl`);
      const px = createTraceProxy({ role, route: () => routeTo, masker, file, port: 0 });
      const port = await px.listen(); proxies.push({ px, file });
      for (const q of hostileQueries()) {
        const p = role === 'front' ? '/v1/read' : '/v1/projects/p/databases/(default)/documents/workspaces/W/auditLog/a1';
        await fetch(`http://127.0.0.1:${port}${p}?${q}`, { method: role === 'front' ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json', ...(role === 'back' ? { 'x-cmn-trace-id': 'TR-00000000-0000-4000-8000-000000000000' } : {}) }, body: '{"op":"attendanceSession.read","target":{"sessionId":"S1"}}' }).then((r) => r.text()).catch(() => null);
      }
    }
    for (const { px, file } of proxies) {
      await px.close(); px.closed = true;
      const text = rfs(file, 'utf8'); const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
      assert.equal(lines.length, hostileQueries().length, file);
      assert.deepEqual(findLeaks(text, { names: [FAKE_NAME], secrets: [FAKE_JWT, FAKE_EMAIL, FAKE_KEY] }), [], file);
      for (const s of [FAKE_JWT, FAKE_NAME, FAKE_EMAIL, FAKE_KEY, 'eyJhbG', encodeURIComponent(FAKE_JWT), encodeURIComponent(FAKE_NAME)]) assert.ok(!text.includes(s), `${file}: ${s}`);
      for (const l of lines) for (const e of l.query) assert.equal(Object.keys(e).length, 1);
    }
    // the failed-request proxy really recorded failures
    assert.ok(rfs(proxies[2].file, 'utf8').split('\n').filter(Boolean).every((l) => JSON.parse(l).status === 502));
  } finally {
    for (const { px } of proxies) if (!px.closed) await Promise.race([px.close(), new Promise((r) => setTimeout(r, 2000))]);
    upstream.closeAllConnections?.(); await new Promise((r) => upstream.close(r)); rms(dir, { recursive: true, force: true });
  }
});

// ======================================================================= PR-2 (B3b): trust root, PASS gate, verify job
import { parseTrustPolicy, evaluateTrust, TRUST_POLICY_VERSION } from '../src/b3/trust-policy.mjs';
import { runVerifyJob } from '../src/b3/attest-verify.mjs';
import { PASS_ENABLED } from '../src/b3/verifier.mjs';
import { createHash as ch } from 'node:crypto';

const C1 = 'c'.repeat(40); const B1 = 'b'.repeat(40);
const rec = (o = {}) => ({ approvalId: 'T-001', kind: 'toolchain', sha: C1, approvedAt: '2026-11-21T00:00:00Z', approvedBy: 'owner', reviewRef: 'PR #X', status: 'active', validFrom: '2026-11-21T00:00:00Z', validTo: null, ...o });
const policyText = (records) => JSON.stringify({ policyVersion: TRUST_POLICY_VERSION, description: 'x', freshnessHours: 24, records });
const FULL = [rec(), rec({ approvalId: 'S-001', kind: 'signing-policy', sha: B1 })];
const NOW = Date.parse('2026-11-22T00:00:00Z');

test('B3b trust policy: strict record format; the committed record has no approvals', () => {
  const committed = parseTrustPolicy(rf(f2p(new URL('../../../docs/stage2/S2B2-TRUST-POLICY.json', import.meta.url)), 'utf8'));
  assert.deepEqual(committed.records, []);
  assert.doesNotThrow(() => parseTrustPolicy(policyText(FULL)));
  const bad = {
    'duplicate approvalId': [rec(), rec()], 'short sha': [rec({ sha: 'abc' })], 'unknown kind': [rec({ kind: 'adapter' })], 'unknown key': [rec({ extra: 1 })],
    'revoked without validTo': [rec({ status: 'revoked' })], 'active with validTo': [rec({ validTo: '2026-11-22T00:00:00Z' })], 'bad time': [rec({ approvedAt: '2026-11-21' })],
    'no approvedBy': [rec({ approvedBy: '' })], 'invalidateIssued not boolean': [rec({ invalidateIssued: 'yes' })],
  };
  for (const [n, r] of Object.entries(bad)) assert.throws(() => parseTrustPolicy(policyText(r)), /TRUST_POLICY_INVALID/, n);
  assert.throws(() => parseTrustPolicy('{"__proto__":{},"policyVersion":"s2-trust-policy-v1"}'), /TRUST_POLICY_INVALID/);
  assert.throws(() => parseTrustPolicy(JSON.stringify({ policyVersion: 'v0', freshnessHours: 24, records: [] })), /TRUST_POLICY_INVALID/);
});

test('B3b trust policy: both pointers must name ACTIVE records and match what actually ran', () => {
  const ev = (o = {}) => evaluateTrust({ policyText: policyText(FULL), toolchainVar: C1, signingPolicyVar: B1, toolchainCommit: C1, workflowBlob: B1, nowMs: NOW, ...o });
  const ok = ev(); assert.equal(ok.configured, true); assert.deepEqual(ok.reasons, []); assert.equal(ok.toolchainApproval, 'T-001'); assert.equal(ok.signingPolicyApproval, 'S-001');
  const cases = {
    'variables unset': [{ toolchainVar: '', signingPolicyVar: '' }, ['TRUSTED_TOOLCHAIN_NOT_SET', 'SIGNING_POLICY_NOT_SET']],
    'another commit ran': [{ toolchainCommit: 'd'.repeat(40) }, ['TOOLCHAIN_COMMIT_MISMATCH']],
    'unapproved workflow blob ran (A18)': [{ workflowBlob: 'e'.repeat(40) }, ['SIGNING_POLICY_BLOB_MISMATCH']],
    'toolchain not in record': [{ policyText: policyText([FULL[1]]) }, ['TOOLCHAIN_NOT_APPROVED']],
    'toolchain revoked': [{ policyText: policyText([rec({ status: 'revoked', validTo: '2026-11-21T12:00:00Z' }), FULL[1]]) }, ['TOOLCHAIN_NOT_APPROVED']],
    'record valid only in the future': [{ policyText: policyText([rec({ validFrom: '2026-12-01T00:00:00Z' }), FULL[1]]) }, ['TOOLCHAIN_NOT_APPROVED']],
    'signing policy approved as toolchain kind only': [{ policyText: policyText([FULL[0], rec({ approvalId: 'S-002', sha: B1 })]) }, ['SIGNING_POLICY_NOT_APPROVED']],
    'malformed record': [{ policyText: '{' }, ['TRUST_POLICY_INVALID']],
    'empty (committed) record': [{ policyText: policyText([]) }, ['TOOLCHAIN_NOT_APPROVED', 'SIGNING_POLICY_NOT_APPROVED']],
  };
  for (const [n, [o, want]] of Object.entries(cases)) { const r = ev(o); assert.equal(r.configured, false, n); for (const w of want) assert.ok(r.reasons.includes(w), `${n}: ${r.reasons}`); }
});

// verify job on the committed honest fixture (local evidence replayed with the hosted decision logic)
const vjEnv = (o = {}) => ({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_RUN_ID: fixRun.runId, GITHUB_RUN_ATTEMPT: String(fixRun.runAttempt),
  EXP_TEST_ID: 'POC-001', EXP_ARTIFACT_ID: '123456', EXP_PACKAGE_SHA256: fixOut.packageSha256, EXP_MANIFEST_SHA256: fixOut.manifestSha256, EXP_ATTESTATION_NONCE: fixRun.attestationNonce,
  EXP_PLATFORM_SUPPORTED: 'true', EXP_TOOLCHAIN_COMMIT: fixRun.trustedToolchainCommit, EXP_SCENARIO: 'honest', CMN_STAGE1_ANCHOR_SHA256: 'a'.repeat(64), ...o });
const HEAD_F = fixRun.trustedToolchainCommit;
const vj = ({ env = vjEnv(), entries = [{ name: 'package-POC-001.tar', isFile: true }], bytes = fixBytes, policy = { text: policyText([]), commit: 'f'.repeat(40), anchorDigest: 'a'.repeat(64) }, workflowBlob = B1, head = HEAD_F } = {}) =>
  runVerifyJob({ env, head, workflowBlob, policy, caseSpecs: { 'POC-001': caseSpec001 }, listDownload: () => entries, readDownload: () => bytes, now: () => new Date(NOW) });

test('B3b verify job: hosted runner without a configured trust root → UNATTESTED TRUST_ROOT_NOT_CONFIGURED; local → unchanged', () => {
  assert.equal(PASS_ENABLED, false);
  const hostedNoTrust = vj(); assert.equal(hostedNoTrust.result, 'UNATTESTED'); assert.deepEqual(hostedNoTrust.report.reasons, ['TRUST_ROOT_NOT_CONFIGURED']);
  assert.ok(hostedNoTrust.report.trust.reasons.includes('TRUSTED_TOOLCHAIN_NOT_SET'));
  const local = vj({ env: vjEnv({ GITHUB_ACTIONS: undefined, RUNNER_ENVIRONMENT: undefined }) });
  assert.equal(local.result, 'UNATTESTED'); assert.deepEqual(local.report.reasons, LOCAL_ONLY);
  // statement / delivery / diagnostic
  assert.equal(hostedNoTrust.statementSha256, ch('sha256').update(hostedNoTrust.statementText).digest('hex'));
  assert.equal(hostedNoTrust.delivery.signing, 'NOT_ATTEMPTED_NOT_PASS'); assert.equal(hostedNoTrust.report.unsigned, true);
  assert.equal(JSON.parse(hostedNoTrust.statementText).verdict.result, 'UNATTESTED');
});

test('B3b verify job: even a FULLY configured trust root cannot PASS while PASS_ENABLED is false', () => {
  const full = vj({ env: vjEnv({ CMN_S2_TRUSTED_TOOLCHAIN_SHA: HEAD_F, CMN_S2_SIGNING_POLICY_BLOB: B1 }), policy: { text: policyText([rec({ sha: HEAD_F }), FULL[1]]), commit: 'f'.repeat(40), anchorDigest: 'a'.repeat(64) } });
  assert.equal(full.report.trust.configured, true, JSON.stringify(full.report.trust.reasons));
  assert.equal(full.result, 'UNATTESTED'); assert.deepEqual(full.report.reasons, ['PASS_NOT_ENABLED']); assert.equal(full.delivery.signing, 'NOT_ATTEMPTED_NOT_PASS');
  // the same configuration read from a main that is NOT the owner-anchored one is not trusted (§4.5)
  const unanchored = vj({ env: vjEnv({ CMN_S2_TRUSTED_TOOLCHAIN_SHA: HEAD_F, CMN_S2_SIGNING_POLICY_BLOB: B1, CMN_STAGE1_ANCHOR_SHA256: '9'.repeat(64) }), policy: { text: policyText([rec({ sha: HEAD_F }), FULL[1]]), commit: 'f'.repeat(40), anchorDigest: 'a'.repeat(64) } });
  assert.equal(unanchored.report.trust.configured, false); assert.ok(unanchored.report.trust.reasons.includes('TRUST_POLICY_NOT_ANCHORED')); assert.deepEqual(unanchored.report.reasons, ['TRUST_ROOT_NOT_CONFIGURED']);
  const noPolicy = vj({ policy: null }); assert.ok(noPolicy.report.trust.reasons.includes('TRUST_POLICY_NOT_ANCHORED'));
});

test('B3b verify job: A14 artifact selection and run binding are enforced before anything is believed', () => {
  const sel = {
    'two files': { entries: [{ name: 'package-POC-001.tar', isFile: true }, { name: 'extra.tar', isFile: true }] },
    'wrong file name': { entries: [{ name: 'package-POC-002.tar', isFile: true }] },
    'not a regular file': { entries: [{ name: 'package-POC-001.tar', isFile: false }] },
    'nothing downloaded': { entries: [] },
    'artifact id missing': { env: vjEnv({ EXP_ARTIFACT_ID: '' }) },
    'artifact id not numeric': { env: vjEnv({ EXP_ARTIFACT_ID: '12;rm' }) },
  };
  for (const [n, o] of Object.entries(sel)) { const r = vj(o); assert.equal(r.result, 'BLOCKED', n); assert.deepEqual(r.report.reasons, ['ARTIFACT_SELECTION_MISMATCH'], n); assert.equal(r.statementText, null, n); }
  assert.deepEqual(vj({ env: vjEnv({ EXP_TOOLCHAIN_COMMIT: 'd'.repeat(40) }) }).report.reasons, ['TOOLCHAIN_COMMIT_MISMATCH']);
  assert.deepEqual(vj({ env: vjEnv({ EXP_TEST_ID: 'POC-999' }) }).report.reasons, ['TRUSTED_INPUT_MISSING']);
  const codesOf = (r) => r.report.reasons.map((x) => x.split(':')[0]);
  // replay: the package of this run checked against another run id / attempt / nonce (A6 with trusted job values)
  assert.ok(codesOf(vj({ env: vjEnv({ GITHUB_RUN_ID: '999' }) })).includes('RUN_BINDING_MISMATCH'));
  assert.ok(codesOf(vj({ env: vjEnv({ GITHUB_RUN_ATTEMPT: '2' }) })).includes('RUN_BINDING_MISMATCH'));
  assert.ok(codesOf(vj({ env: vjEnv({ EXP_ATTESTATION_NONCE: '0'.repeat(64) }) })).includes('RUN_BINDING_MISMATCH'));
  // package digest from the execute job's outputs (A13)
  assert.deepEqual(vj({ env: vjEnv({ EXP_PACKAGE_SHA256: '0'.repeat(64) }) }).report.reasons, ['PACKAGE_DIGEST_MISMATCH']);
  // platformSupported must come from the execute job's output
  assert.ok(codesOf(vj({ env: vjEnv({ EXP_PLATFORM_SUPPORTED: '' }) })).includes('TRUSTED_INPUT_MISSING'));
  // the verify job never executes anything: a package is only ever parsed (bytes that are not a package → BLOCKED)
  assert.equal(vj({ bytes: Buffer.from('#!/bin/sh\nexit 0\n'), env: vjEnv({ EXP_PACKAGE_SHA256: ch('sha256').update('#!/bin/sh\nexit 0\n').digest('hex') }) }).result, 'BLOCKED');
});

// ======================================================================= PR2-REV001: statement provenance from trusted inputs
import { stableJson as sj } from '../src/stable.mjs';

test('PR2-REV001: hosted statement carries the trusted artifact ID, producer job and workflow blob (never package claims or placeholders)', () => {
  const a = vj({ env: vjEnv({ EXP_ARTIFACT_ID: '123456' }), workflowBlob: B1 }); const st = JSON.parse(a.statementText);
  assert.equal(st.package.artifactId, '123456'); assert.equal(st.package.producerJob, 'attest-execute'); assert.equal(st.toolchain.signingPolicyBlob, B1);
  assert.deepEqual(a.report.provenance, { artifactId: '123456', producerJob: 'attest-execute', signingPolicyBlob: B1 });
  // other trusted values → other statement
  const b = vj({ env: vjEnv({ EXP_ARTIFACT_ID: '777' }), workflowBlob: 'e'.repeat(40) }); const st2 = JSON.parse(b.statementText);
  assert.equal(st2.package.artifactId, '777'); assert.equal(st2.toolchain.signingPolicyBlob, 'e'.repeat(40)); assert.notEqual(a.statementSha256, b.statementSha256);
  assert.ok(!a.statementText.includes('0'.repeat(40)), 'no all-zero placeholder blob');
  // a package that claims another artifact ID (run.json) cannot override the trusted one
  const forgedRun = { ...fixRun, artifactId: '999999' };
  const p = writePackage({ ...fixFiles, 'run.json': JSON.stringify(forgedRun) });
  const c = vj({ env: vjEnv({ EXP_ARTIFACT_ID: '123456', EXP_PACKAGE_SHA256: p.packageSha256, EXP_MANIFEST_SHA256: p.manifestSha256 }), bytes: p.packageBytes });
  assert.equal(JSON.parse(c.statementText).package.artifactId, '123456');
});

test('PR2-REV001: hosted without valid provenance → BLOCKED; local prototype states unknown provenance as null', () => {
  const noBlob = vj({ workflowBlob: null }); assert.equal(noBlob.result, 'BLOCKED'); assert.ok(noBlob.report.reasons.includes('PROVENANCE_INVALID'), JSON.stringify(noBlob.report.reasons));
  const hostedDirect = verifyMod({}, { runnerKind: 'github-hosted' }); assert.equal(hostedDirect.result, 'BLOCKED'); assert.ok(codes(hostedDirect).includes('PROVENANCE_MISSING'));
  const badProv = verifyMod({}, { provenance: { artifactId: 'x', producerJob: 'attest-execute', signingPolicyBlob: B1 } }); assert.ok(codes(badProv).includes('PROVENANCE_INVALID'));
  const local = verifyMod(); assert.equal(local.result, 'UNATTESTED'); assert.deepEqual(local.reasons, LOCAL_ONLY);
  assert.equal(local.statement.package.artifactId, null); assert.equal(local.statement.toolchain.signingPolicyBlob, null); assert.equal(local.statement.package.producerJob, 'local-b3a');
});

test('PR2-REV001: the statement digest is computed over the exact bytes written (file, diagnostic, delivery, future signing subject)', () => {
  const r = vj({ env: vjEnv({ EXP_ARTIFACT_ID: '123456' }) });
  const digest = ch('sha256').update(r.statementText).digest('hex');
  assert.equal(r.statementSha256, digest); assert.equal(r.delivery.statementSha256, digest); assert.equal(r.report.statementSha256, digest);
  assert.equal(sj(JSON.parse(r.statementText)), r.statementText);   // canonical serialisation: re-serialising gives the same bytes
});
