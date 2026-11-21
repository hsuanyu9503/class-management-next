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
