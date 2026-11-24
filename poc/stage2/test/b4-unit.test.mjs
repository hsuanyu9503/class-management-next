/** B4 unit tests (no emulator): §8 requestHash, commit shape, every §8 branch and the retry rules of processCommit,
 *  the receipt authorization (§3.1.2), write-op separation, and the trusted judge helpers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestHash, checkCommitShape, validateCommand, processCommit, buildCommitDocs, receiptOut, MAX_RETRIES, RECEIPT_OUT_FIELDS } from '../src/api/commit.mjs';
import { TxnAborted } from '../src/api/txn.mjs';
import { BackendUnavailable, toFields } from '../src/api/store.mjs';
import { authorize, checkReceiptAccess, OPERATIONS, WRITE_OPERATIONS } from '../src/authz.mjs';
import { traceableCommitBody, traceableReceiptBody, traceableBodyFor } from '../src/api/request-shape.mjs';
import { receiptDigestOf } from '../src/trace-proxy.mjs';
import { judgeRequestHash, concurrencyOf, transactionsOf, decodeWrite, checkCommitWriteSet } from '../src/b4/commit-trace.mjs';
import { checkFrontFaults, CASE_ACTORS, CASE_FRONT_FAULTS } from '../src/b3/verifier.mjs';
import { stableJson, sha256Hex } from '../src/stable.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(HERE, '../../stage1/fixtures/canonical-fixtures-v1.0.json'), 'utf8'));
const CMD = fixtures.canonicalCommand;
const SCOPE = { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' };
const P = 'ACTOR-SC01-TEACHER';
const LV = 'workspaces/WS-SC01/classes/CLASS-606-SC01/leaveRecords/LV-007';
const CURRENT = { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01', studentId: 'ST-SC01-0007', enrollmentId: 'EN-SC01-1151-0007', ...fixtures.datasets['SC01-20261116'].leave };

test('§8 requestHash test vector ff212f32… and the documented variants (API and judge copies agree)', () => {
  const vec = 'ff212f322297ac317fd3869dceffb81c094b1457de01c111762c6335b177c8cf';
  assert.equal(requestHash({ command: CMD, scope: SCOPE, principalId: P }), vec);
  assert.equal(judgeRequestHash({ command: CMD, workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01', principalId: P }), vec);
  assert.ok(requestHash({ command: CMD, scope: SCOPE, principalId: 'ACTOR-SC01-TEACHER-2' }).startsWith('2e0195cf'));
  assert.ok(requestHash({ command: { ...CMD, intent: { ...CMD.intent, coverageChange: 'AM_TO_PM' } }, scope: SCOPE, principalId: P }).startsWith('9f0a1d08'));
  assert.ok(requestHash({ command: { ...CMD, targetId: 'LV-008' }, scope: SCOPE, principalId: P }).startsWith('37793557'));
  // not part of the hash: operationId, clientCreatedAt
  assert.equal(requestHash({ command: { ...CMD, operationId: 'X', clientCreatedAt: '2030-01-01T00:00:00Z' }, scope: SCOPE, principalId: P }), vec);
});

test('commit shape is checked before authorization; semantic input only after', () => {
  const ok = { command: CMD, claimedScope: SCOPE };
  assert.equal(checkCommitShape(ok), true);
  for (const bad of [null, [], {}, { command: CMD }, { ...ok, extra: 1 }, { command: { ...CMD, extra: 1 }, claimedScope: SCOPE }, { command: { ...CMD, commandType: 'Attendance.Revise' }, claimedScope: SCOPE },
    { command: { ...CMD, intent: { coverageChange: 'AM_TO_PM' } }, claimedScope: SCOPE }, { command: { ...CMD, workspaceId: 'WS-A17' }, claimedScope: SCOPE }, { command: { ...CMD, expectedVersion: '5' }, claimedScope: SCOPE }]) assert.equal(checkCommitShape(bad), false);
  assert.equal(validateCommand(CMD), null);
  assert.equal(validateCommand({ ...CMD, intent: { ...CMD.intent, coverageChange: 'DELETE_ALL' } }), 'COVERAGE_CHANGE');
  assert.equal(validateCommand({ ...CMD, expectedVersion: -1 }), 'EXPECTED_VERSION');
  assert.equal(validateCommand({ ...CMD, operationId: '../x' }), 'OPERATION_ID');
});

/** Fake transaction client: records every call with the transaction it names; scripted outcomes. */
function fakeTxn({ receipt = null, current = { data: CURRENT, updateTime: '2026-11-16T07:20:00.000000Z' }, commitPlan = [], readError = null } = {}) {
  const calls = []; let n = 0; let commits = 0;
  return {
    calls, nameOf: (p) => `projects/demo/databases/(default)/documents/${p}`,
    begin: async () => { n += 1; const t = `T${n}`; calls.push(['begin', t]); return t; },
    get: async (p, t) => { calls.push(['get', p, t]); if (readError) throw readError; if (p.includes('/operationReceipts/')) return receipt; if (p === LV) return typeof current === 'function' ? current(t) : current; throw new Error('unexpected read'); },
    commit: async (t, writes) => { calls.push(['commit', t, writes.length, writes]); const o = commitPlan[commits++] ?? 'ok'; if (o === 'aborted') throw new TxnAborted('commit'); if (o === 'down') throw new BackendUnavailable('x'); return {}; },
    rollback: async (t) => { calls.push(['rollback', t]); },
  };
}
const run = (txn, extra = {}) => processCommit({ command: CMD, scope: SCOPE, principalId: P, currentPath: LV, txn, toFields, nowMs: () => Date.parse('2026-11-16T07:30:00Z'), sleep: async () => {}, ...extra });

test('§8 step 3→5: receipt read (in the transaction) BEFORE current, then ONE commit of five writes', async () => {
  const t = fakeTxn(); const r = await run(t);
  assert.equal(r.status, 200); assert.equal(r.outcome, 'COMMITTED'); assert.equal(r.attempts, 1); assert.equal(r.transactionRef, 'T1');
  assert.deepEqual(t.calls.map((c) => c[0]), ['begin', 'get', 'get', 'commit']);
  assert.ok(t.calls[1][1].endsWith('/operationReceipts/OP-SC01-EXAMPLE-0001') && t.calls[2][1] === LV && t.calls.slice(1, 3).every((c) => c[2] === 'T1') && t.calls[3][1] === 'T1');
  assert.equal(t.calls[3][2], 5);
  // preconditions actually sent: current guarded by the updateTime read in this transaction, the other four create-only
  const ws = t.calls[3][3];
  assert.deepEqual(ws[0].currentDocument, { updateTime: '2026-11-16T07:20:00.000000Z' }); assert.ok(ws[0].update.name.endsWith(LV));
  assert.ok(ws.slice(1).every((w) => JSON.stringify(w.currentDocument) === '{"exists":false}'));
  assert.deepEqual(ws.map((w) => w.update.name.split('/documents/')[1].replace(/EV-[^/]+$/, 'EV-*')), [LV, `${LV}/revisions/6`, 'workspaces/WS-SC01/operationReceipts/OP-SC01-EXAMPLE-0001', 'workspaces/WS-SC01/events/EV-*', 'workspaces/WS-SC01/derivedProgress/OP-SC01-EXAMPLE-0001']);
  assert.deepEqual(Object.keys(r.body.receipt), RECEIPT_OUT_FIELDS);
  assert.equal(r.body.receipt.requestHash, 'ff212f322297ac317fd3869dceffb81c094b1457de01c111762c6335b177c8cf');
});
test('§8 step 3: same requestHash → the stored receipt, no current read, no commit; different hash → {code, operationId} only', async () => {
  const stored = buildCommitDocs({ command: CMD, scope: SCOPE, principalId: P, hash: requestHash({ command: CMD, scope: SCOPE, principalId: P }), currentPath: LV, current: CURRENT, committedAt: '2026-11-16T07:30:00.000Z', eventId: 'EV-1' }).find((d) => d.kind === 'receipt').data;
  const t1 = fakeTxn({ receipt: { data: stored, updateTime: 'x' } }); const r1 = await run(t1);
  assert.equal(r1.outcome, 'REPLAYED'); assert.deepEqual(t1.calls.map((c) => c[0]), ['begin', 'get', 'rollback']); assert.deepEqual(r1.body.receipt, receiptOut(stored));
  const t2 = fakeTxn({ receipt: { data: { ...stored, requestHash: '0'.repeat(64) }, updateTime: 'x' } }); const r2 = await run(t2);
  assert.equal(r2.status, 409); assert.deepEqual(r2.body, { code: 'OPERATION_REUSE_MISMATCH', operationId: CMD.operationId }); assert.ok(!t2.calls.some((c) => c[0] === 'commit'));
});
test('§8 step 4: version ≠ expectedVersion → VERSION_CONFLICT, no commit', async () => {
  const t = fakeTxn({ current: { data: { ...CURRENT, version: 6 }, updateTime: 'x' } }); const r = await run(t);
  assert.equal(r.status, 409); assert.deepEqual(r.body, { code: 'VERSION_CONFLICT' }); assert.ok(!t.calls.some((c) => c[0] === 'commit'));
});
test('contention: every retry is a NEW transaction re-reading from step 3; at most 5 retries; then TRANSACTION_CONTENTION, never VERSION_CONFLICT', async () => {
  const t = fakeTxn({ commitPlan: ['aborted', 'aborted', 'aborted', 'aborted', 'aborted', 'ok'] }); const r = await run(t);
  assert.equal(r.outcome, 'COMMITTED'); assert.equal(r.attempts, MAX_RETRIES + 1); assert.equal(r.transactionRef, 'T6');
  for (let i = 1; i <= 6; i += 1) assert.equal(t.calls.filter((c) => c[0] === 'get' && c[2] === `T${i}`).length, 2, `attempt ${i} read receipt and current in its own transaction`);
  const t2 = fakeTxn({ commitPlan: Array(10).fill('aborted') }); const r2 = await run(t2);
  assert.equal(r2.status, 503); assert.deepEqual(r2.body, { code: 'UNAVAILABLE', reason: 'TRANSACTION_CONTENTION' }); assert.equal(r2.attempts, 6); assert.equal(t2.calls.filter((c) => c[0] === 'begin').length, 6);
  // a retry that then reads a newer version is a real conflict — decided from THAT attempt's read
  const t3 = fakeTxn({ commitPlan: ['aborted'], current: (tx) => ({ data: { ...CURRENT, version: tx === 'T1' ? 5 : 6 }, updateTime: 'x' }) }); const r3 = await run(t3);
  assert.equal(r3.outcome, 'VERSION_CONFLICT'); assert.equal(r3.attempts, 2);
});
test('other backend errors are never VERSION_CONFLICT (they propagate → 503 UNAVAILABLE in the server)', async () => {
  await assert.rejects(run(fakeTxn({ readError: new BackendUnavailable('down') })), BackendUnavailable);
  await assert.rejects(run(fakeTxn({ commitPlan: ['down'] })), BackendUnavailable);
});

/** Fake authoritative store for authorize / checkReceiptAccess. */
function fakeStore({ bindingStatus = 'active', receipt = undefined, capabilities = ['leave.read'], memberships = true } = {}) {
  const reads = [];
  return {
    reads,
    getBinding: async (uid) => { reads.push('binding'); return { authUid: uid, principalId: 'ACTOR-X', status: bindingStatus, activatedAt: '2026-01-01T00:00:00Z' }; },
    getPrincipal: async (pid) => { reads.push('principal'); return { principalId: pid, status: 'active' }; },
    findTargets: async () => { reads.push('target'); return [{ path: LV, data: CURRENT }]; },
    listMemberships: async () => { reads.push('memberships'); return memberships ? [{ membershipId: 'M', version: 1, principalId: 'ACTOR-X', workspaceId: 'WS-SC01', scopeType: 'class', classId: 'CLASS-606-SC01', rolePreset: 'homeroom_teacher', rolePresetVersion: 's2b1-v1', capabilities, status: 'active', validFrom: '2026-09-01', validToExclusive: null }] : []; },
    getDoc: async (p) => { reads.push(`doc:${p}`); return receipt === undefined ? null : receipt; },
  };
}
const CLAIMS = { authUid: 'uid1', iat: Date.parse('2026-11-01T00:00:00Z') / 1000 };
const NOW = Date.parse('2026-11-16T07:30:00Z');
const RCP = { operationId: 'OP-1', principalId: 'ACTOR-X', classId: 'CLASS-606-SC01' };
test('REV-20-01 receipt read: no capability needed; owner + valid class membership only; not found ≡ not allowed', async () => {
  const ok = await checkReceiptAccess({ claims: CLAIMS, workspaceId: 'WS-SC01', operationId: 'OP-1', nowMs: NOW, store: fakeStore({ receipt: RCP, capabilities: [] }) });
  assert.equal(ok.decision, 'allow');
  assert.equal((await checkReceiptAccess({ claims: CLAIMS, workspaceId: 'WS-SC01', operationId: 'OP-1', nowMs: NOW, store: fakeStore({ receipt: { ...RCP, principalId: 'ACTOR-Y' } }) })).reasonCode, 'NOT_RECEIPT_OWNER');
  assert.equal((await checkReceiptAccess({ claims: CLAIMS, workspaceId: 'WS-SC01', operationId: 'OP-1', nowMs: NOW, store: fakeStore({}) })).reasonCode, 'TARGET_NOT_FOUND');
  assert.equal((await checkReceiptAccess({ claims: CLAIMS, workspaceId: 'WS-SC01', operationId: 'OP-1', nowMs: NOW, store: fakeStore({ receipt: RCP, memberships: false }) })).reasonCode, 'NO_VALID_MEMBERSHIP');
  assert.equal((await checkReceiptAccess({ claims: CLAIMS, workspaceId: 'WS-SC01', operationId: 'OP-1', nowMs: NOW, store: fakeStore({ receipt: { ...RCP, operationId: 'OP-2' } }) })).reasonCode, 'SCOPE_INTEGRITY_ERROR');
  // identity is checked BEFORE the receipt is read
  const st = fakeStore({ bindingStatus: 'disabled', receipt: RCP });
  assert.equal((await checkReceiptAccess({ claims: CLAIMS, workspaceId: 'WS-SC01', operationId: 'OP-1', nowMs: NOW, store: st })).reasonCode, 'BINDING_NOT_ACTIVE');
  assert.ok(!st.reads.some((r) => r.startsWith('doc:')));
});
test('write and read operations are separate: neither route can authorize the other\'s operation; leave.revise required', async () => {
  assert.equal((await authorize({ op: 'leaveRecord.revise', claims: CLAIMS, target: { leaveRecordId: 'LV-007' }, claimedScope: SCOPE, nowMs: NOW, store: fakeStore() })).reasonCode, 'UNKNOWN_OPERATION');
  assert.equal((await authorize({ op: 'leaveRecord.read', claims: CLAIMS, target: { leaveRecordId: 'LV-007' }, claimedScope: SCOPE, nowMs: NOW, store: fakeStore(), operations: WRITE_OPERATIONS })).reasonCode, 'UNKNOWN_OPERATION');
  assert.equal((await authorize({ op: 'leaveRecord.revise', claims: CLAIMS, target: { leaveRecordId: 'LV-007' }, claimedScope: SCOPE, nowMs: NOW, store: fakeStore({ capabilities: ['leave.read'] }), operations: WRITE_OPERATIONS })).reasonCode, 'CAPABILITY_NOT_GRANTED');
  assert.equal((await authorize({ op: 'leaveRecord.revise', claims: CLAIMS, target: { leaveRecordId: 'LV-007' }, claimedScope: SCOPE, nowMs: NOW, store: fakeStore({ capabilities: ['leave.read', 'leave.revise'] }), operations: WRITE_OPERATIONS })).decision, 'allow');
  assert.ok(!Object.hasOwn(OPERATIONS, 'leaveRecord.revise'));
});

test('front-trace projections: values recorded only in the expected form; credential-like ids never', () => {
  const t = traceableCommitBody({ command: CMD, claimedScope: SCOPE });
  assert.equal(t.op, 'leaveRecord.revise'); assert.deepEqual(t.command.intent, CMD.intent); assert.equal(t.command.expectedVersion, 5);
  const bad = traceableCommitBody({ command: { ...CMD, operationId: ['gh', 'p_abcdefABCDEF0123456789'].join(''), intent: { coverageChange: 'WIPE', reasonCode: 'lowercase secret' } }, claimedScope: SCOPE });
  assert.deepEqual(bad.command.operationId, { valueRecorded: false }); assert.deepEqual(bad.command.intent, { coverageChange: { valueRecorded: false }, reasonCode: { valueRecorded: false } });
  assert.equal(traceableCommitBody({ command: { ...CMD, x: 'secret' }, claimedScope: SCOPE }).shapeValid, false);
  assert.deepEqual(traceableReceiptBody({ operationId: 'OP-1', workspaceId: 'WS-SC01' }), { op: 'operationReceipt.read', target: { operationId: 'OP-1' }, claimedScope: { workspaceId: 'WS-SC01' } });
  assert.equal(traceableBodyFor('/v1/read', { op: 'x', target: {} }).op.valueRecorded, false);
});
test('receipt digest scope is the receipt member only (not code / traceId / derivedStatus)', () => {
  const rc = { a: 1, b: 'x' };
  const d = sha256Hex(Buffer.from(stableJson(rc), 'utf8'));
  assert.equal(receiptDigestOf(JSON.stringify({ code: 'OK', traceId: 'TR-1', receipt: rc })), d);
  assert.equal(receiptDigestOf(JSON.stringify({ code: 'OK', traceId: 'TR-2', receipt: { b: 'x', a: 1 }, derivedStatus: 'done' })), d);
  assert.equal(receiptDigestOf(JSON.stringify({ code: 'FORBIDDEN' })), null);
});

// ---------------- judge helpers on synthetic traces
const iso = (ms) => new Date(ms).toISOString();
const be = (traceId, verb, t0, t1, reqBody, resBody, status = 200) => ({ role: 'back', seq: t0, traceId, at: iso(t0), endedAt: iso(t1), durationMs: t1 - t0, method: 'POST', path: `/v1/projects/p/databases/(default)/documents:${verb}`, requestBody: reqBody, status, responseBody: resBody });
const N = (p) => `projects/p/databases/(default)/documents/${p}`;
function txnTrace(traceId, txn, t0, commitEnd, ok = true) {
  return [be(traceId, 'beginTransaction', t0, t0 + 2, {}, { transaction: txn }), be(traceId, 'batchGet', t0 + 3, t0 + 5, { documents: [N('x/r')], transaction: txn }, [{ missing: N('x/r') }]),
    be(traceId, 'commit', t0 + 6, commitEnd, { transaction: txn, writes: [] }, ok ? {} : { error: { status: 'ABORTED' } }, ok ? 200 : 409)];
}
test('POC-017 overlap is decided from back-proxy intervals, not file order; touching intervals are not overlap', () => {
  const ov = [...txnTrace('A', 'TA', 1000, 3000), ...txnTrace('B', 'TB', 1001, 3010, false)].reverse();   // file order reversed on purpose
  assert.equal(concurrencyOf(ov, ['A', 'B']).established, true);
  const seq = [...txnTrace('A', 'TA', 1000, 1020), ...txnTrace('B', 'TB', 1030, 1050)];
  assert.equal(concurrencyOf(seq, ['A', 'B']).established, false);
  const touch = [...txnTrace('A', 'TA', 1000, 1020), ...txnTrace('B', 'TB', 1017, 1050)];   // B's first read starts exactly at A's commit end
  assert.equal(concurrencyOf(touch, ['A', 'B']).established, false);
});
test('transactions: a call naming a transaction not begun by the same request is unbound; ids come from begin RESPONSES', () => {
  const tr = [...txnTrace('A', 'TA', 1000, 1020)]; tr[2] = { ...tr[2], requestBody: { transaction: 'TB', writes: [] } };
  const v = transactionsOf(tr, 'A'); assert.equal(v.unboundTxnCalls.length, 1); assert.equal(v.attempts[0].commit, null);
  const other = [...txnTrace('B', 'TB', 1000, 1020)];
  assert.equal(transactionsOf([...other, { ...tr[2], traceId: 'A' }], 'A').unboundTxnCalls.length, 1, 'another request\'s transaction id does not bind');
});
test('write decoding keeps kind, full path, precondition and flags masks / transforms / unknown keys', () => {
  const w = decodeWrite({ update: { name: N('a/b'), fields: { x: { integerValue: '1' } } }, currentDocument: { exists: false }, updateMask: { fieldPaths: ['x'] } });
  assert.equal(w.kind, 'update'); assert.equal(w.path, 'a/b'); assert.deepEqual(w.fields, { x: 1 }); assert.deepEqual(w.precondition, { exists: false }); assert.equal(w.hasMask, true);
  assert.equal(decodeWrite({ delete: N('a/b') }).kind, 'delete');
  assert.deepEqual(decodeWrite({ update: { name: N('a/b'), fields: {}, extra: 1 } }).unknownKeys, ['extra']);
});
test('commit write-set check: exact five writes recomputed from pre-state; a missing / extra / altered write is named', () => {
  const pre = { [LV]: CURRENT };
  const committedAt = '2026-11-16T07:30:00.000Z';
  const docs = buildCommitDocs({ command: CMD, scope: SCOPE, principalId: P, hash: requestHash({ command: CMD, scope: SCOPE, principalId: P }), currentPath: LV, current: CURRENT, committedAt, eventId: 'EV-1' });
  const ut = '2026-11-16T07:20:00.000000Z';
  const writes = docs.map((d) => decodeWrite({ update: { name: N(d.path), fields: toFields(d.data) }, currentDocument: d.kind === 'current' ? { updateTime: ut } : { exists: false } }));
  const rp = `workspaces/WS-SC01/operationReceipts/${CMD.operationId}`;
  const reads = [{ e: { at: iso(1), endedAt: iso(2) }, path: rp, found: false }, { e: { at: iso(3), endedAt: iso(4) }, path: LV, found: true, data: CURRENT, updateTime: ut }];
  const attempt = (ws) => ({ txn: 'T', reads, commit: { ok: true, writes: ws } });
  assert.deepEqual(checkCommitWriteSet({ attempt: attempt(writes), pre, command: CMD, principalId: P }).problems, []);
  assert.ok(checkCommitWriteSet({ attempt: attempt(writes.slice(0, 4)), pre, command: CMD, principalId: P }).problems.includes('WRITE_COUNT:4'));
  assert.ok(checkCommitWriteSet({ attempt: attempt([...writes, { ...writes[1], path: 'workspaces/WS-SC01/x/y' }]), pre, command: CMD, principalId: P }).problems.some((p) => p.startsWith('WRITE_UNEXPECTED_PATH')));
  assert.ok(checkCommitWriteSet({ attempt: attempt(writes.map((w, i) => (i === 2 ? { ...w, precondition: null } : w))), pre, command: CMD, principalId: P }).problems.includes('CREATE_PRECONDITION:receipt'));
  assert.ok(checkCommitWriteSet({ attempt: attempt(writes.map((w, i) => (i === 0 ? { ...w, precondition: { exists: true } } : w))), pre, command: CMD, principalId: P }).problems.includes('CURRENT_PRECONDITION'));
  assert.ok(checkCommitWriteSet({ attempt: attempt(writes.map((w, i) => (i === 2 ? { ...w, fields: { ...w.fields, requestHash: '0'.repeat(64) } } : w))), pre, command: CMD, principalId: P }).problems.includes('RECEIPT_CONTENT'));
  // receipt read must come before the current read in the same transaction
  const late = { txn: 'T', reads: [reads[1], { ...reads[0], e: { at: iso(5), endedAt: iso(6) } }], commit: { ok: true, writes } };
  assert.ok(checkCommitWriteSet({ attempt: late, pre, command: CMD, principalId: P }).problems.includes('RECEIPT_NOT_READ_BEFORE_CURRENT'));
});
test('front faults must match the trusted table exactly', () => {
  assert.deepEqual(Object.keys(CASE_FRONT_FAULTS).sort(), ['POC-017', 'POC-021']);
  for (const t of ['POC-016', 'POC-017', 'POC-018', 'POC-021']) assert.equal(CASE_ACTORS[t], 'ACTOR-SC01-TEACHER');
  const commit = (extra) => ({ role: 'front', method: 'POST', path: '/v1/commit', ...extra });
  assert.deepEqual(checkFrontFaults([commit({ delivered: true })], 'POC-016'), []);
  assert.ok(checkFrontFaults([commit({ delivered: false, droppedAt: 'x' })], 'POC-016').length);
  assert.deepEqual(checkFrontFaults([commit({ delivered: false, droppedAt: 'x' })], 'POC-021'), []);
  assert.ok(checkFrontFaults([commit({ delivered: true })], 'POC-021').length);
  assert.deepEqual(checkFrontFaults([commit({ barrier: {} }), commit({ barrier: {} })], 'POC-017'), []);
  assert.ok(checkFrontFaults([commit({}), commit({})], 'POC-017').length);
  assert.ok(checkFrontFaults([commit({ barrier: {} })], 'POC-018').length);
});
