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

// ---------------------------------------------------------------- S2B2-B2-REV001 / REV003 (no HTTP)
const { buildData, IntegrityError } = await import('../src/api/response-shape.mjs');
const { checkRequestShape, traceableRequestBody } = await import('../src/api/request-shape.mjs');
const SES_PATH = 'workspaces/WS-A/classes/C-A/attendanceSessions/S-A';
const goodEntry = (id, over = {}) => ({ path: `${SES_PATH}/entries/${id}`, data: { workspaceId: 'WS-A', classId: 'C-A', sessionId: 'S-A', attendanceEntryId: id, enrollmentId: `EN-${id}`, studentId: `ST-${id}`, status: 'P', scope: 'daily', version: 1, ...over } });
const sessionAz = (roster = [{ enrollmentId: 'EN-E-A', studentId: 'ST-E-A', seatNo: 1 }]) => ({ scope: { workspaceId: 'WS-A', classId: 'C-A' }, target: { path: SES_PATH, data: { workspaceId: 'WS-A', classId: 'C-A', sessionId: 'S-A', date: '2026-11-17', kind: 'daily', rosterSnapshot: roster } } });
const listStore = (children) => ({ listCollection: async (p) => { assert.equal(p, `${SES_PATH}/entries`); return children; } });
async function reason(p) { try { await p; return 'NO_ERROR'; } catch (e) { assert.ok(e instanceof IntegrityError, String(e)); return e.reasonCode; } }

test('REV001: every entry of an authorized session is checked before projection or counting (both endpoints)', async () => {
  const ok = await buildData('attendanceSession.read', sessionAz(), listStore([goodEntry('E-A'), goodEntry('E-B', { status: 'U' })]));
  assert.deepEqual(ok.entries.map((e) => e.attendanceEntryId), ['E-A', 'E-B']);
  assert.deepEqual((await buildData('attendanceSummary.read', sessionAz(), listStore([goodEntry('E-A'), goodEntry('E-B', { status: 'U' })]))).counts, { P: 1, R: 0, N: 0, U: 1, total: 2, registered: 1, arrived: 1 });
  // reviewer's reproduction: child under WS-A/C-A/S-A but labelled WS-B/C-B/S-B/E-B with a foreign studentId
  const foreign = { path: `${SES_PATH}/entries/E-A`, data: { ...goodEntry('E-A').data, workspaceId: 'WS-B', classId: 'C-B', sessionId: 'S-B', attendanceEntryId: 'E-B', studentId: 'ST-FOREIGN' } };
  const variants = {
    'workspaceId differs': goodEntry('E-X', { workspaceId: 'WS-B' }), 'classId differs': goodEntry('E-X', { classId: 'C-B' }), 'sessionId differs': goodEntry('E-X', { sessionId: 'S-B' }),
    'entry id differs from doc id': goodEntry('E-X', { attendanceEntryId: 'E-Y' }), 'missing workspaceId': goodEntry('E-X', { workspaceId: undefined }), 'missing classId': goodEntry('E-X', { classId: null }),
    'missing sessionId': goodEntry('E-X', { sessionId: '' }), 'missing attendanceEntryId': goodEntry('E-X', { attendanceEntryId: undefined }), 'path outside session': { ...goodEntry('E-X'), path: 'workspaces/WS-A/classes/C-A/attendanceSessions/S-B/entries/E-X' }, reviewer: foreign,
  };
  for (const op of ['attendanceSession.read', 'attendanceSummary.read']) {
    for (const [name, bad] of Object.entries(variants)) assert.equal(await reason(buildData(op, sessionAz(), listStore([goodEntry('E-A'), bad]))), 'SCOPE_INTEGRITY_ERROR', `${op}: ${name}`);
    for (const [name, over] of Object.entries({ 'unknown status': { status: 'X' }, 'missing studentId': { studentId: undefined }, 'version not integer': { version: '1' } })) assert.equal(await reason(buildData(op, sessionAz(), listStore([goodEntry('E-A', over)]))), 'DATA_INTEGRITY_ERROR', `${op}: ${name}`);
  }
});

test('REV003: rosterSnapshot / coverageSegments / evidence are validated and projected to the allow-list', async () => {
  const roster = [{ enrollmentId: 'EN-1', studentId: 'ST-1', seatNo: 1, displayName: 'UNEXPECTED_NAME', email: 'x@example.invalid', note: 'free text', nested: { a: { displayName: 'UNEXPECTED_NAME' } } }];
  const r = await buildData('attendanceSession.read', sessionAz(roster), listStore([goodEntry('E-A')]));
  assert.deepEqual(r.rosterSnapshot, [{ enrollmentId: 'EN-1', studentId: 'ST-1', seatNo: 1 }]);
  assert.ok(!JSON.stringify(r).includes('UNEXPECTED_NAME') && !JSON.stringify(r).includes('example.invalid') && !JSON.stringify(r).includes('free text'));
  for (const [name, bad] of Object.entries({ 'not an array': { enrollmentId: 'EN-1' }, null: null, 'item is a string': ['EN-1'], 'item is an array': [['EN-1', 'ST-1', 1]], 'missing seatNo': [{ enrollmentId: 'EN-1', studentId: 'ST-1' }], 'seatNo not integer': [{ enrollmentId: 'EN-1', studentId: 'ST-1', seatNo: '1' }], 'empty studentId': [{ enrollmentId: 'EN-1', studentId: '', seatNo: 1 }] })) {
    assert.equal(await reason(buildData('attendanceSession.read', sessionAz(bad), listStore([goodEntry('E-A')]))), 'DATA_INTEGRITY_ERROR', name);
  }
  const lv = { leaveRecordId: 'L', studentId: 'S', enrollmentId: 'E', leaveTypeId: 'SICK', recordEffect: 'active', teacherConfirmation: 'pending', administrativeApproval: 'x', version: 5, reasonNote: 'SENSITIVE', coverageSegments: [{ segmentId: 'G', startLocalDate: '2026-11-16', endLocalDateExclusive: '2026-11-17', dayPart: 'AM', periodRefs: [1, 2], timeZone: 'Asia/Taipei', note: 'UNEXPECTED_NAME' }] };
  const lr = await buildData('leaveRecord.read', { scope: { workspaceId: 'W', classId: 'C' }, target: { data: lv } }, {});
  assert.ok(!JSON.stringify(lr).includes('SENSITIVE') && !JSON.stringify(lr).includes('UNEXPECTED_NAME'));
  assert.equal(await reason(buildData('leaveRecord.read', { scope: {}, target: { data: { ...lv, coverageSegments: [{ segmentId: 'G' }] } } }, {})), 'DATA_INTEGRITY_ERROR');
  const is = { issueId: 'I', progress: 'p', checkConclusion: 'c', question: 'q', evidenceStale: false, evidence: [{ sourceType: 'LeaveRecord', sourceId: 'L', sourceVersion: 5, extra: 'UNEXPECTED_NAME' }] };
  assert.deepEqual((await buildData('trackingIssue.read', { scope: { workspaceId: 'W', classId: 'C' }, target: { data: is } }, {})).evidence, [{ sourceType: 'LeaveRecord', sourceId: 'L', sourceVersion: 5 }]);
});

test('REV002: request body allow-list; trace keeps only allow-listed fields; credentials masked at any depth', () => {
  const FAKE_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJGQUtFLVJFVjAwMiJ9.';
  assert.ok(checkRequestShape({ op: 'x', target: { sessionId: 'S' }, claimedScope: { workspaceId: 'W', classId: 'C' } }));
  for (const bad of [{ op: 'x', target: { sessionId: 'S' }, authorization: `Bearer ${FAKE_JWT}` }, { op: 'x', target: { sessionId: 'S', note: 'n' } }, { op: 'x', target: { sessionId: { nested: FAKE_JWT } } },
    { op: 'x', target: { sessionId: 'S' }, claimedScope: { workspaceId: 'W', classId: 'C', Authorization: FAKE_JWT } }, [{ op: 'x' }], null, 'str', { op: 'x', target: ['S'] }]) {
    assert.equal(checkRequestShape(bad), false, JSON.stringify(bad));
    assert.ok(!JSON.stringify(traceableRequestBody(bad)).includes('FAKE') && !JSON.stringify(traceableRequestBody(bad)).includes('eyJ'), JSON.stringify(bad));
  }
  const m = makeMasker([]);
  const masked = JSON.stringify(m.maskValue({ Authorization: `Bearer ${FAKE_JWT}`, nested: { AUTHORIZATION: FAKE_JWT, 'proxy-authorization': 'x', list: [`Bearer ${FAKE_JWT}`, { x_api_key: 'k' }] }, text: `see bearer ${FAKE_JWT} here`, bare: FAKE_JWT, Token: 'abc', Cookie: 'c' }));
  assert.ok(!masked.includes(FAKE_JWT) && !masked.includes('eyJ') && !/bearer [^\[]/i.test(masked), masked);
  assert.ok(findLeaks(`{"x":"${FAKE_JWT}"}`).includes('jwt-shaped-string'));
});

// ---------------------------------------------------------------- R2: R1-N1 … R1-N4 (no network)
test('R1-N1: session date must be a real YYYY-MM-DD and kind daily/period, else the whole request is denied', async () => {
  const az = (patch) => { const a = sessionAz(); Object.assign(a.target.data, patch); if (patch.__del) { delete a.target.data[patch.__del]; delete a.target.data.__del; } return a; };
  const st = listStore([goodEntry('E-A')]);
  assert.equal((await buildData('attendanceSession.read', az({ kind: 'period' }), st)).kind, 'period');
  for (const [name, patch] of Object.entries({
    'date object': { date: { y: 2026 } }, 'date array': { date: ['2026-11-17'] }, 'date 2026-02-30': { date: '2026-02-30' }, 'date with time': { date: '2026-11-17T00:00:00Z' }, 'date number': { date: 20261117 }, 'date missing': { __del: 'date' },
    'kind array': { kind: ['daily'] }, 'kind unknown': { kind: 'weekly' }, 'kind upper-case': { kind: 'DAILY' }, 'kind missing': { __del: 'kind' },
  })) assert.equal(await reason(buildData('attendanceSession.read', az(patch), st)), 'DATA_INTEGRITY_ERROR', name);
  // attendanceSummary.read outputs neither date nor kind (documented); its entries are still checked (REV001)
  assert.equal((await buildData('attendanceSummary.read', az({ kind: 'weekly' }), st)).date, undefined);
});

test('R1-N2: trace keeps only known op names, known id fields and id-shaped, non-credential values', () => {
  const secretsIn = ['sk-live-FAKE0123456789abcdef', 'ghp_FAKE0123456789abcdefABCDEF', 'password=FAKE-pw-123', 'x'.repeat(60000), 'eyJhbGciOi.FAKE'];
  const ok = traceableRequestBody({ op: 'attendanceSession.read', target: { sessionId: 'AS-A17-20261117-DAILY' }, claimedScope: { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' } });
  assert.deepEqual(ok, { op: 'attendanceSession.read', target: { sessionId: 'AS-A17-20261117-DAILY' }, claimedScope: { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' } });
  for (const sec of secretsIn) {
    for (const body of [
      { op: 'attendanceSession.read', target: { sessionId: sec }, claimedScope: { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' } },
      { op: sec, target: { sessionId: 'S' } },
      { op: 'attendanceSession.read', target: { sessionId: 'S' }, claimedScope: { workspaceId: sec, classId: 'C' } },
      { op: 'attendanceSession.read', target: { [sec.slice(0, 40)]: 'S' } },
    ]) { const t = JSON.stringify(traceableRequestBody(body)); assert.ok(!t.includes(sec.slice(0, 12)) && t.length < 400, `${sec.slice(0, 12)} leaked: ${t.slice(0, 120)}`); }
  }
  for (const proto of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) assert.deepEqual(traceableRequestBody({ op: proto, target: { sessionId: 'S' } }).op, { valueRecorded: false }, proto);
});

test('R1-N3: attendanceEntry.read requires attendanceSessions/{sessionId}/entries/{id} and a matching sessionId', async () => {
  const E = { attendanceEntryId: 'E1', sessionId: 'S-A', enrollmentId: 'EN', studentId: 'ST', status: 'N', scope: 'daily', version: 4, workspaceId: 'W', classId: 'C' };
  const azE = (path, data = E) => ({ scope: { workspaceId: 'W', classId: 'C' }, target: { path, data } });
  assert.equal((await buildData('attendanceEntry.read', azE('workspaces/W/classes/C/attendanceSessions/S-A/entries/E1'), {})).status, 'N');
  assert.equal(await reason(buildData('attendanceEntry.read', azE('workspaces/W/classes/C/attendanceSessions/S-B/entries/E1'), {})), 'SCOPE_INTEGRITY_ERROR', 'sessionId differs from path');
  assert.equal(await reason(buildData('attendanceEntry.read', azE('workspaces/W/classes/C/otherParent/S-A/entries/E1'), {})), 'SCOPE_INTEGRITY_ERROR', 'parent is not attendanceSessions');
  assert.equal(await reason(buildData('attendanceEntry.read', azE('workspaces/W/classes/C/x/y/attendanceSessions/S-A/entries/E1'), {})), 'SCOPE_INTEGRITY_ERROR', 'nested deeper');
  assert.equal(await reason(buildData('attendanceEntry.read', azE('workspaces/W/classes/C/attendanceSessions/S-A/entries/E1', { ...E, sessionId: undefined }), {})), 'SCOPE_INTEGRITY_ERROR', 'sessionId missing');
});

test('R1-N4: a listing with nextPageToken fails closed (no partial entries / counts) — fetch stubbed, no network', async () => {
  const { createStore } = await import('../src/api/store.mjs');
  const orig = globalThis.fetch;
  const docs = [goodEntry('E-A'), goodEntry('E-B')].map((c) => ({ name: `projects/demo-cmn-s2b2/databases/(default)/documents/${c.path}`, fields: Object.fromEntries(Object.entries(c.data).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: v }])) }));
  let page = { documents: docs, nextPageToken: 'MORE' };
  globalThis.fetch = async () => new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const st = createStore({ origin: 'http://127.0.0.1:1', projectId: 'demo-cmn-s2b2' });
    for (const op of ['attendanceSession.read', 'attendanceSummary.read']) {
      try { await buildData(op, sessionAz(), st); assert.fail('must throw'); } catch (e) { assert.ok(e instanceof IntegrityError, String(e)); assert.equal(e.reasonCode, 'DATA_INTEGRITY_ERROR'); assert.match(e.detail, /^LIST_TRUNCATED/); }
    }
    page = { documents: docs };          // control: a complete listing is accepted
    assert.equal((await buildData('attendanceSummary.read', sessionAz(), st)).counts.total, 2);
  } finally { globalThis.fetch = orig; }
});

test('R1-N2: credential-prefixed values are masked in any trace (e.g. a backend query carrying the target id)', () => {
  const m = makeMasker([]);
  const t = JSON.stringify(m.maskValue({ structuredQuery: { where: { fieldFilter: { value: { stringValue: 'sk-live-FAKE0123456789' } } } }, ids: ['ghp_FAKE0123456789', 'AE-EN-A17-1151-0001'] }));
  assert.ok(!t.includes('sk-live-FAKE') && !t.includes('ghp_FAKE') && t.includes('AE-EN-A17-1151-0001'), t);
});
