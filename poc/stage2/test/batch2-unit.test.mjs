/** Batch 2 unit tests (no emulator): strict time validation, emulator token claim checks, branch-C
 *  authorization with an in-memory authoritative store, masking, Observer and verdict rules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUtcTimestamp, parseLocalDate, isNumericDate, localDayOrdinal } from '../src/time-validate.mjs';
import { checkEmulatorTokenClaims } from '../src/api/token.mjs';
import { authorize, effectiveClassCapabilities, ENABLED_CAPABILITIES } from '../src/authz.mjs';
import { makeMasker, maskAuthorization, findLeaks, MASK, MASK_NAME } from '../src/mask.mjs';
import { observe } from '../src/observer.mjs';
import { verdict } from '../src/verdict.mjs';
import { caseRequests } from '../src/adapter.mjs';
import { loadFixtures } from '../src/seed.mjs';
import { buildWorld, actorMemberships } from '../src/world.mjs';

test('parseUtcTimestamp: whole-string ASCII YYYY-MM-DDTHH:MM:SSZ and real UTC dates only', () => {
  assert.equal(parseUtcTimestamp('2026-11-20T12:00:00Z'), Date.UTC(2026, 10, 20, 12) / 1000);
  assert.equal(parseUtcTimestamp('2024-02-29T23:59:59Z'), Date.UTC(2024, 1, 29, 23, 59, 59) / 1000);
  assert.equal(parseUtcTimestamp('2000-02-29T00:00:00Z'), Date.UTC(2000, 1, 29) / 1000);
  for (const bad of ['2026-11-20T12:00:00z', '2026-11-20T12:00:00Z\n', ' 2026-11-20T12:00:00Z', '2026-11-20T12:00:00.000Z', '2026-11-20T12:00:00+08:00',
    '2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z', '2026-04-31T00:00:00Z', '2026-11-20T24:00:00Z',
    '2026-11-20T12:60:00Z', '2026-11-20T12:00:60Z', '２０２６-11-20T12:00:00Z', '2026-11-20 12:00:00Z', '', null, 1795000000, undefined]) {
    assert.equal(parseUtcTimestamp(bad), null, `must reject ${JSON.stringify(bad)}`);
  }
});

test('parseLocalDate: whole-string YYYY-MM-DD, leap years, no padding/whitespace/full-width', () => {
  assert.equal(parseLocalDate('2026-11-17'), Date.UTC(2026, 10, 17) / 86400000);
  assert.equal(parseLocalDate('2028-02-29'), Date.UTC(2028, 1, 29) / 86400000);
  for (const bad of ['2026-02-29', '2100-02-29', '2026-13-01', '2026-11-31', '2026-11-17 ', '2026-11-17\n', '2026-1-17', '２０２６-11-17', '2026/11/17', '2026-11-17T00:00:00Z', null, 20261117]) assert.equal(parseLocalDate(bad), null, `must reject ${JSON.stringify(bad)}`);
});

test('isNumericDate and local day in Asia/Taipei (UTC+8 date boundary)', () => {
  assert.ok(isNumericDate(1795000000)); for (const bad of [1.5, -1, '1795000000', NaN, Infinity, 2 ** 60]) assert.ok(!isNumericDate(bad));
  assert.equal(localDayOrdinal(Date.UTC(2026, 10, 16, 15, 59, 59), 'Asia/Taipei'), parseLocalDate('2026-11-16'));
  assert.equal(localDayOrdinal(Date.UTC(2026, 10, 16, 16, 0, 0), 'Asia/Taipei'), parseLocalDate('2026-11-17'));
});

const P = 'demo-cmn-s2b2';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tok = (payload, header = { alg: 'none', typ: 'JWT' }) => `${b64(header)}.${b64(payload)}.`;
const NOW = 1795200000;
const good = { iss: `https://securetoken.google.com/${P}`, aud: P, sub: 'Uid1', user_id: 'Uid1', iat: NOW - 100, exp: NOW + 3000, auth_time: NOW - 100 };

test('emulator token claims: accepted only with exact iss/aud/sub, integer times, not expired, not from the future', () => {
  assert.deepEqual(checkEmulatorTokenClaims(tok(good), { projectId: P, nowSec: NOW }), { ok: true, claims: { authUid: 'Uid1', iat: NOW - 100, exp: NOW + 3000 } });
  const cases = [
    [tok({ ...good, exp: NOW }), 'TOKEN_EXPIRED'], [tok({ ...good, aud: 'x' }), 'TOKEN_WRONG_AUDIENCE'], [tok({ ...good, iss: 'https://securetoken.google.com/x' }), 'TOKEN_WRONG_AUDIENCE'],
    [tok(good, { alg: 'RS256' }), 'TOKEN_NOT_EMULATOR'], [tok(good, { alg: 'none', kid: 'k' }), 'TOKEN_NOT_EMULATOR'], [tok({ ...good, user_id: 'Other' }), 'TOKEN_BAD_SUBJECT'],
    [tok({ ...good, iat: NOW - 100.5 }), 'TOKEN_BAD_TIME'], [tok({ ...good, iat: String(NOW) }), 'TOKEN_BAD_TIME'], [tok({ ...good, auth_time: NOW }), 'TOKEN_BAD_TIME'],
    [tok({ ...good, iat: NOW + 3600, exp: NOW + 7200, auth_time: NOW + 3600 }), 'TOKEN_FROM_FUTURE'], [`${tok(good)}sig`, 'TOKEN_MALFORMED'], ['abc', 'TOKEN_MALFORMED'], [null, 'TOKEN_MALFORMED'],
  ];
  for (const [t, reason] of cases) assert.equal(checkEmulatorTokenClaims(t, { projectId: P, nowSec: NOW }).reason, reason, reason);
});

// ---- in-memory authoritative store
const NOW_MS = Date.UTC(2026, 10, 20, 4, 0, 0);       // 2026-11-20 12:00 Asia/Taipei
function memStore(over = {}) {
  const st = {
    bindings: { Uid1: { authUid: 'Uid1', principalId: 'P-T', status: 'active', activatedAt: '2026-11-01T00:00:00Z', bindingVersion: 1 } },
    principals: { 'P-T': { principalId: 'P-T', status: 'active' }, 'P-O': { principalId: 'P-O', status: 'active' } },
    targets: [{ path: 'workspaces/W1/classes/C1/attendanceSessions/S1', data: { workspaceId: 'W1', classId: 'C1', sessionId: 'S1' } }, { path: 'workspaces/W2/classes/C2/attendanceSessions/S2', data: { workspaceId: 'W2', classId: 'C2', sessionId: 'S2' } }],
    memberships: [{ membershipId: 'M1', version: 1, principalId: 'P-T', workspaceId: 'W1', scopeType: 'class', classId: 'C1', rolePreset: 'homeroom_teacher', rolePresetVersion: 's2b1-v1', capabilities: ['attendance.read'], status: 'active', validFrom: '2026-11-17', validToExclusive: null, _ws: 'W1' }],
    ...over,
  };
  const reads = [];
  return {
    st, reads,
    getBinding: async (u) => { reads.push(`binding:${u}`); return st.bindings[u] ?? null; },
    getPrincipal: async (p) => { reads.push(`principal:${p}`); return st.principals[p] ?? null; },
    findTargets: async (coll, f, id) => { reads.push(`target:${id}`); return st.targets.filter((t) => t.path.includes(`/${coll}/`) && t.data[f] === id); },
    listMemberships: async (w, p) => { reads.push(`memberships:${w}:${p}`); return st.memberships.filter((m) => m._ws === w && m.principalId === p).map(({ _ws, ...m }) => m); },
  };
}
const REQ = { op: 'attendanceSession.read', claims: { authUid: 'Uid1', iat: Date.UTC(2026, 10, 20) / 1000 }, target: { sessionId: 'S1' }, claimedScope: { workspaceId: 'W1', classId: 'C1' }, nowMs: NOW_MS };
const az = (store, over = {}) => authorize({ ...REQ, ...over, store });
const mutM = (patch) => memStore({ memberships: [{ ...memStore().st.memberships[0], ...patch }] });

test('authorize: positive control, and every request re-reads binding, principal and memberships', async () => {
  const s = memStore();
  const r = await az(s);
  assert.equal(r.decision, 'allow'); assert.deepEqual(r.scope, { workspaceId: 'W1', classId: 'C1' }); assert.deepEqual(r.effectiveCapabilities, ['attendance.read']);
  await az(s);
  assert.equal(s.reads.filter((x) => x.startsWith('binding:')).length, 2); assert.equal(s.reads.filter((x) => x.startsWith('memberships:')).length, 2);
});

test('authorize: §6.1 binding / principal / token-time negatives', async () => {
  const b = (patch) => memStore({ bindings: { Uid1: { ...memStore().st.bindings.Uid1, ...patch } } });
  const cases = [
    [memStore({ bindings: {} }), 'BINDING_NOT_FOUND'], [b({ status: 'disabled' }), 'BINDING_NOT_ACTIVE'], [b({ status: 'revoked' }), 'BINDING_NOT_ACTIVE'],
    [b({ activatedAt: '2026-11-20T00:00:01Z' }), 'TOKEN_BEFORE_BINDING'], [b({ activatedAt: '2026-11-01T00:00:00z' }), 'BINDING_INVALID_TIME'], [b({ activatedAt: '2026-02-30T00:00:00Z' }), 'BINDING_INVALID_TIME'],
    [b({ activatedAt: null }), 'BINDING_INVALID_TIME'], [b({ authUid: 'Uid2' }), 'BINDING_INVALID'], [b({ principalId: 'P-X' }), 'PRINCIPAL_NOT_ACTIVE'],
    [memStore({ principals: { 'P-T': { principalId: 'P-T', status: 'disabled' } } }), 'PRINCIPAL_NOT_ACTIVE'], [b({ principalId: 'P-O' }), 'NO_VALID_MEMBERSHIP'],
  ];
  for (const [s, reason] of cases) assert.equal((await az(s)).reasonCode, reason, reason);
  assert.equal((await az(memStore(), { claims: null })).reasonCode, 'TOKEN_INVALID');
  // token iat exactly equal to activatedAt is allowed ("not earlier than")
  assert.equal((await az(b({ activatedAt: '2026-11-20T00:00:00Z' }))).decision, 'allow');
});

test('authorize: §6.1 step 3 scope from path; claimed scope must match; integrity errors', async () => {
  assert.equal((await az(memStore(), { claimedScope: { workspaceId: 'W1', classId: 'C2' } })).reasonCode, 'SCOPE_CLAIM_MISMATCH');
  assert.equal((await az(memStore(), { claimedScope: { workspaceId: 'W2', classId: 'C1' } })).reasonCode, 'SCOPE_CLAIM_MISMATCH');
  assert.equal((await az(memStore(), { claimedScope: undefined })).reasonCode, 'SCOPE_CLAIM_MISSING');
  assert.equal((await az(memStore(), { target: { sessionId: 'NOPE' } })).reasonCode, 'TARGET_NOT_FOUND');
  assert.equal((await az(memStore(), { target: { sessionId: '../x' } })).reasonCode, 'TARGET_INVALID');
  assert.equal((await az(memStore(), { target: { sessionId: 'S2' }, claimedScope: { workspaceId: 'W2', classId: 'C2' } })).reasonCode, 'NO_VALID_MEMBERSHIP');
  const integ = memStore({ targets: [{ path: 'workspaces/W1/classes/C1/attendanceSessions/S1', data: { workspaceId: 'W1', classId: 'C9', sessionId: 'S1' } }] });
  assert.equal((await az(integ)).reasonCode, 'SCOPE_INTEGRITY_ERROR');
  const dup = memStore({ targets: [...memStore().st.targets, { path: 'workspaces/W2/classes/C2/attendanceSessions/S1', data: { workspaceId: 'W2', classId: 'C2', sessionId: 'S1' } }] });
  assert.equal((await az(dup)).reasonCode, 'SCOPE_INTEGRITY_ERROR');
});

test('authorize: §6.2 membership validity (dates, status, required fields, preset, principal, workspace, classId)', async () => {
  const negatives = [
    { validToExclusive: '2026-11-18' }, { validToExclusive: '2026-11-20' }, { validFrom: '2026-11-21' }, { validFrom: '2026-13-01' }, { validFrom: '2026-02-29' }, { validFrom: '2026-11-17 ' },
    { validToExclusive: '２０９９-01-01' }, { validFrom: null }, { status: 'suspended' }, { status: 'revoked' }, { rolePresetVersion: 's2b1-v0' }, { rolePreset: 'nonexistent' },
    { rolePreset: 'workspace_admin' }, { scopeType: 'workspace' }, { classId: null }, { classId: 'C2' }, { workspaceId: 'W2' }, { version: '1' }, { capabilities: 'attendance.read' },
  ];
  for (const patch of negatives) assert.equal((await az(mutM(patch))).reasonCode, 'NO_VALID_MEMBERSHIP', JSON.stringify(patch));
  for (const k of ['membershipId', 'version', 'principalId', 'workspaceId', 'scopeType', 'classId', 'rolePreset', 'rolePresetVersion', 'capabilities', 'status', 'validFrom']) {
    const m = { ...memStore().st.memberships[0] }; delete m[k];
    assert.equal((await az(memStore({ memberships: [m] }))).reasonCode, 'NO_VALID_MEMBERSHIP', `missing ${k}`);
  }
  assert.equal((await az(mutM({ validFrom: '2026-11-20' }))).decision, 'allow', 'validFrom = today allowed');
  assert.equal((await az(mutM({ validToExclusive: '2026-11-21' }))).decision, 'allow', 'validToExclusive = tomorrow allowed');
});

test('authorize: §5/§6.2 step 6 capability — preset is an upper bound, never a grant; disabled caps refused', async () => {
  assert.equal((await az(mutM({ capabilities: ['attendance.write'] }))).reasonCode, 'CAPABILITY_NOT_GRANTED');
  assert.equal((await az(mutM({ capabilities: [] }))).reasonCode, 'CAPABILITY_NOT_GRANTED', 'preset has attendance.read but membership does not (N-46)');
  assert.equal((await az(mutM({ rolePreset: 'projection_display' }))).reasonCode, 'CAPABILITY_NOT_GRANTED', 'beyond-preset capability ignored (N-37/N-45)');
  assert.equal((await az(memStore(), { op: 'student.read', target: { studentId: 'X' } })).reasonCode, 'CAPABILITY_NOT_ENABLED');
  assert.equal((await az(memStore(), { op: 'leaveApplicability.read', target: { leaveRecordId: 'L' } })).reasonCode, 'TARGET_NOT_FOUND');
  assert.equal((await az(memStore(), { op: 'attendance.write' })).reasonCode, 'UNKNOWN_OPERATION');
  // union of several valid memberships; an invalid one contributes nothing
  const m0 = memStore().st.memberships[0];
  const two = memStore({ memberships: [{ ...m0, capabilities: ['attendance.write'] }, { ...m0, membershipId: 'M2', capabilities: ['attendance.read'], validFrom: '2026-13-01' }] });
  assert.equal((await az(two)).reasonCode, 'CAPABILITY_NOT_GRANTED');
  const union = memStore({ memberships: [{ ...m0, capabilities: ['attendance.write'] }, { ...m0, membershipId: 'M2', capabilities: ['attendance.read'] }] });
  assert.equal((await az(union)).decision, 'allow');
  for (const c of ['roster.read', 'leave.sensitive.read', 'stats.read', 'export.basic', 'membership.manage']) assert.ok(!ENABLED_CAPABILITIES.has(c), c);
  assert.deepEqual(effectiveClassCapabilities({ ...m0, capabilities: ['attendance.read', 'roster.read', 'leave.sensitive.read', 'membership.manage'] }, { principalId: 'P-T', workspaceId: 'W1', classId: 'C1', todayOrdinal: parseLocalDate('2026-11-20') }), ['attendance.read']);
});

test('world: fixture memberships carry EXACTLY the Stage 1 capabilities; ACTOR-OTHER has none', () => {
  const { fixtures } = loadFixtures();
  const ms = actorMemberships(fixtures);
  assert.equal(ms.length, 2);
  for (const m of ms) { const p = fixtures.principals.find((x) => x.principalId === m.data.principalId); assert.deepEqual(m.data.capabilities, p.capabilities); assert.equal(m.data.rolePreset, 'homeroom_teacher'); }
  assert.ok(!ms.some((m) => m.data.principalId === 'ACTOR-OTHER'));
  assert.ok(!buildWorld(fixtures).some((d) => d.path.includes('/memberships/') && d.data.principalId === 'ACTOR-OTHER'));
  const sc = fixtures.principals.find((p) => p.principalId === 'ACTOR-SC01-TEACHER');
  assert.ok(!sc.capabilities.includes('leave.applicability.read'), 'basis of gap G-1');
});

test('masking: tokens, Authorization, passwords, emails and fictional names never survive', () => {
  const m = makeMasker(['王子軒', '學生 A']);
  const v = m.maskValue({ password: 'p@ss', idToken: 'eyJ.x.', displayName: '王子軒', note: 'student 學生 A here', nested: [{ email: 'a@example.invalid' }], fields: { displayName: { stringValue: '王子軒' } }, keep: 'ST-A17-0001' });
  assert.deepEqual(v, { password: MASK, idToken: MASK, displayName: MASK, note: MASK_NAME, nested: [{ email: MASK }], fields: { displayName: MASK }, keep: 'ST-A17-0001' });
  const a = maskAuthorization(`Bearer ${tok(good)}`);
  assert.equal(a.claimedAuthUid, 'Uid1'); assert.equal(a.verified, false); assert.ok(!JSON.stringify(a).includes(tok(good)));
  assert.deepEqual(maskAuthorization('Bearer owner'), { scheme: 'Bearer', masked: true, emulatorOwner: true });
  assert.deepEqual(findLeaks('{"authorization":"Bearer abc"} 王子軒 SECRET', { names: ['王子軒'], secrets: ['SECRET'] }).length, 3);
});

// ---- Observer / verdict on synthetic traces
const { fixtures } = loadFixtures();
const ORACLE = { 'POC-001': { testId: 'POC-001', fixtureSet: 'A17-20261117', expectedResult: { workspaceId: 'WS-A17', returnedCount: 2, crossWorkspaceDisclosure: false }, requiredEvidenceKeys: ['authzDecision', 'returnedIds', 'workspaceId'] } };
function synth({ extraEntry = false, audit = true } = {}) {
  const ses = 'workspaces/WS-A17/classes/C/attendanceSessions/S';
  const post = { [ses]: { sessionId: 'S', workspaceId: 'WS-A17', classId: 'C' }, [`${ses}/entries/E1`]: { attendanceEntryId: 'E1', status: 'P', workspaceId: 'WS-A17' }, [`${ses}/entries/E2`]: { attendanceEntryId: 'E2', status: 'U', workspaceId: 'WS-A17' },
    'workspaces/WS-SC01/classes/K/attendanceSessions/X/entries/AT-9': { attendanceEntryId: 'AT-9', studentId: 'ST-SC01-0007', workspaceId: 'WS-SC01' } };
  if (audit) post['workspaces/WS-A17/auditLog/a1'] = { traceId: 'TR-1', principalId: 'ACTOR-TEACHER', decision: 'allow', reasonCode: 'OK' };
  const entries = [{ attendanceEntryId: 'E1', status: 'P' }, { attendanceEntryId: 'E2', status: 'U' }, ...(extraEntry ? [{ attendanceEntryId: 'AT-9', status: 'N' }] : [])];
  const front = [{ role: 'front', traceId: 'TR-1', requestBody: { op: 'attendanceSession.read', target: { sessionId: 'S' } }, status: 200, responseBody: { code: 'OK', data: { workspaceId: 'WS-A17', entries } } }];
  const back = [{ role: 'back', traceId: 'TR-1', method: 'GET', path: '/v1/x/documents/authBindings/U' }, { role: 'back', traceId: 'TR-1', method: 'GET', path: '/v1/x/documents/principals/ACTOR-TEACHER' }, { role: 'back', traceId: 'TR-1', method: 'POST', path: '/v1/x/documents/workspaces/WS-A17:runQuery' }];
  return { front, back, pre: post, post };
}

test('observer: computes from trace + state; detects cross-workspace disclosure, missing trace and missing audit', () => {
  const ok = observe({ testId: 'POC-001', actor: 'ACTOR-TEACHER', ...synth() });
  assert.deepEqual(ok.canonical, { workspaceId: 'WS-A17', returnedCount: 2, crossWorkspaceDisclosure: false }); assert.deepEqual(ok.problems, []);
  const leak = observe({ testId: 'POC-001', actor: 'ACTOR-TEACHER', ...synth({ extraEntry: true }) });
  assert.equal(leak.canonical.crossWorkspaceDisclosure, true); assert.equal(leak.canonical.workspaceId, 'MIXED');
  assert.deepEqual(observe({ testId: 'POC-001', actor: 'ACTOR-TEACHER', ...synth(), front: [] }).problems, ['NO_TRACE']);
  assert.ok(observe({ testId: 'POC-001', actor: 'ACTOR-TEACHER', ...synth({ audit: false }) }).problems.some((p) => p.startsWith('AUDIT_MISSING')));
  const noReauth = observe({ testId: 'POC-001', actor: 'ACTOR-TEACHER', ...synth(), back: [] });
  assert.ok(noReauth.problems.includes('ASSERTION_FAILED:reauthorizedFromAuthoritativeDocs'));
});

test('verdict: never PASS; observer (not adapter) decides; digests and claim mismatch recorded', () => {
  const s = synth(); const obs = observe({ testId: 'POC-001', actor: 'ACTOR-TEACHER', ...s });
  const good1 = verdict({ caseSpec: ORACLE['POC-001'], observation: obs, adapterOutput: { canonical: obs.canonical }, stage1Result: { status: 'PENDING_ATTESTATION', attested: false, failures: [] }, inputDigestsVerified: true });
  assert.equal(good1.contractMatch, 'MATCH'); assert.equal(good1.stage2Status, 'UNATTESTED'); assert.equal(good1.attested, false);
  const lying = verdict({ caseSpec: ORACLE['POC-001'], observation: obs, adapterOutput: { canonical: { ...obs.canonical, returnedCount: 15 } }, inputDigestsVerified: true });
  assert.equal(lying.contractMatch, 'MATCH'); assert.equal(lying.adapterClaimAgreesWithObserver, false); assert.deepEqual(lying.adapterClaimMismatchFields, ['returnedCount']);
  assert.equal(verdict({ caseSpec: ORACLE['POC-001'], observation: obs, inputDigestsVerified: false }).contractMatch, 'MISMATCH_OR_UNOBSERVABLE');
  const all = [good1, lying].map((v) => JSON.stringify(v));
  assert.ok(all.every((t) => !/"stage2Status":"PASS"/.test(t)));
});

test('adapter case plans contain actors and targets only (no expected values)', () => {
  for (const id of ['POC-001', 'POC-002', 'POC-008', 'POC-009']) {
    const p = caseRequests(id, fixtures);
    assert.ok(p.actor && p.requests.length > 0);
    const t = JSON.stringify(p);
    for (const forbidden of ['returnedCount', 'counts', 'applicability', 'pendingPeriods', 'expectedResult', 'FORBIDDEN']) assert.ok(!t.includes(forbidden), `${id} plan contains ${forbidden}`);
  }
  assert.equal(caseRequests('POC-002', fixtures).actor, 'ACTOR-OTHER');
  assert.ok(caseRequests('POC-009', fixtures).requests.some((r) => r.op === 'leaveApplicability.read'));
});

test('store.listMemberships returns membership documents (not {path,data} wrappers) — regression', async () => {
  const { createStore } = await import('../src/api/store.mjs');
  const http = await import('node:http');
  const doc = { name: 'projects/demo-cmn-s2b2/databases/(default)/documents/workspaces/W1/memberships/M1', fields: { membershipId: { stringValue: 'M1' }, principalId: { stringValue: 'P-T' } } };
  const other = { name: 'projects/demo-cmn-s2b2/databases/(default)/documents/workspaces/W9/memberships/MX', fields: { membershipId: { stringValue: 'MX' } } };
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify([{ document: doc }, { document: other }, { readTime: 'x' }])); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const st = createStore({ origin: `http://127.0.0.1:${srv.address().port}`, projectId: 'demo-cmn-s2b2' });
    assert.deepEqual(await st.listMemberships('W1', 'P-T'), [{ membershipId: 'M1', principalId: 'P-T' }]);
  } finally { await new Promise((r) => srv.close(r)); }
});
