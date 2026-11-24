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
/** begin [t0,t0+2], receipt read [t0+3,t0+5] (missing), current read [t0+6, curEnd ?? t0+8] (found), commit [t0+9, commitEnd]. */
function txnTrace(traceId, txn, t0, commitEnd, ok = true, { curEnd = t0 + 8, curStatus = 200, curRes } = {}) {
  return [be(traceId, 'beginTransaction', t0, t0 + 2, {}, { transaction: txn }), be(traceId, 'batchGet', t0 + 3, t0 + 5, { documents: [N('x/r')], transaction: txn }, [{ missing: N('x/r') }]),
    be(traceId, 'batchGet', t0 + 6, curEnd, { documents: [N(LV)], transaction: txn }, curRes ?? [{ found: { name: N(LV), fields: { version: { integerValue: '5' } }, updateTime: 'u' } }], curStatus),
    be(traceId, 'commit', Math.max(t0 + 9, curEnd + 1), commitEnd, { transaction: txn, writes: [] }, ok ? {} : { error: { status: 'ABORTED' } }, ok ? 200 : 409)];
}
test('POC-017 overlap is decided from back-proxy intervals, not file order; touching intervals are not overlap', () => {
  const ov = [...txnTrace('A', 'TA', 1000, 3000), ...txnTrace('B', 'TB', 1001, 3010, false)].reverse();   // file order reversed on purpose
  assert.equal(concurrencyOf(ov, ['A', 'B']).established, true);
  const seq = [...txnTrace('A', 'TA', 1000, 1020), ...txnTrace('B', 'TB', 1030, 1050)];
  assert.equal(concurrencyOf(seq, ['A', 'B']).established, false);
  const touch = [...txnTrace('A', 'TA', 1000, 1020), ...txnTrace('B', 'TB', 1012, 1050)];   // B's current read ENDS exactly at A's commit end
  assert.equal(concurrencyOf(touch, ['A', 'B']).established, false);
  assert.ok(concurrencyOf(touch, ['A', 'B']).per[1].why.includes('READ_NOT_FINISHED_BEFORE_COMMIT_END'));
});
test('REV-21-02 overlap needs the first reads COMPLETED (successfully, with valid times) before the earliest commit end', () => {
  // reviewer's counter-example: A's commit ends at 1020; B's current read starts at 1010 but only ends at 1030
  const late = [...txnTrace('A', 'TA', 1000, 1020), ...txnTrace('B', 'TB', 1004, 1050, true, { curEnd: 1030 })];
  const c1 = concurrencyOf(late, ['A', 'B']); assert.equal(c1.established, false); assert.deepEqual(c1.per[1].why, ['READ_NOT_FINISHED_BEFORE_COMMIT_END']);
  const failed = [...txnTrace('A', 'TA', 1000, 3000), ...txnTrace('B', 'TB', 1001, 3010, false, { curStatus: 500, curRes: { error: {} } })];
  assert.ok(concurrencyOf(failed, ['A', 'B']).per[1].why.includes('READ_FAILED'));
  const noTime = [...txnTrace('A', 'TA', 1000, 3000), ...txnTrace('B', 'TB', 1001, 3010, false).map((e, i) => (i === 2 ? { ...e, endedAt: undefined, durationMs: undefined } : e))];
  assert.ok(concurrencyOf(noTime, ['A', 'B']).per[1].why.includes('READ_TIME_INVALID'));
  const backwards = [...txnTrace('A', 'TA', 1000, 3000), ...txnTrace('B', 'TB', 1001, 3010, false).map((e, i) => (i === 2 ? { ...e, endedAt: iso(1000) } : e))];
  assert.ok(concurrencyOf(backwards, ['A', 'B']).per[1].why.includes('READ_TIME_INVALID'));
  const noCurrent = [...txnTrace('A', 'TA', 1000, 3000), ...txnTrace('B', 'TB', 1001, 3010, false).filter((_, i) => i !== 2)];
  assert.ok(concurrencyOf(noCurrent, ['A', 'B']).per[1].why.includes('NO_CURRENT_READ'));
  assert.equal(concurrencyOf([...txnTrace('A', 'TA', 1000, 3000)], ['A', 'B']).established, false, 'one request only');
});
test('transactions: a call naming a transaction not begun by the same request is unbound; ids come from begin RESPONSES', () => {
  const tr = [...txnTrace('A', 'TA', 1000, 1020)]; tr[3] = { ...tr[3], requestBody: { transaction: 'TB', writes: [] } };
  const v = transactionsOf(tr, 'A'); assert.equal(v.unboundTxnCalls.length, 1); assert.equal(v.attempts[0].commit, null);
  const other = [...txnTrace('B', 'TB', 1000, 1020)];
  assert.equal(transactionsOf([...other, { ...tr[3], traceId: 'A' }], 'A').unboundTxnCalls.length, 1, 'another request\'s transaction id does not bind');
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

// ---------------- REV-21-01: the case operation is bound by the trusted table, not by the command that was sent
import { CASE_OPERATIONS, checkCaseOperation } from '../src/b4/case-ops.mjs';
import { observe } from '../src/observer.mjs';
import { verdict } from '../src/verdict.mjs';
import { checkBackFaults, CASE_BACK_FAULTS } from '../src/b3/verifier.mjs';
const caseSpecs = Object.fromEntries(JSON.parse(readFileSync(path.join(HERE, '../../stage1/contracts/canonical-oracles-v1.0.json'), 'utf8')).cases.map((c) => [c.testId, c]));
test('case table equals the locked fixtures (canonicalCommand, SC01 leave v5 AM, scope)', () => {
  const c = CASE_OPERATIONS['POC-016'].command; const { clientCreatedAt, ...fx } = CMD;
  assert.deepEqual({ ...c, intent: { ...c.intent } }, fx);
  const s = fixtures.datasets['SC01-20261116'];
  assert.equal(CASE_OPERATIONS['POC-016'].preVersion, s.leave.version); assert.equal(CASE_OPERATIONS['POC-016'].preDayPart, s.leave.coverageSegments[0].dayPart);
  assert.deepEqual(CASE_OPERATIONS['POC-016'].claimedScope, { workspaceId: s.workspaceId, classId: s.classId });
  assert.equal(CASE_OPERATIONS['POC-016'].currentPath, `workspaces/${s.workspaceId}/classes/${s.classId}/leaveRecords/${s.leave.leaveRecordId}`);
  for (const t of ['POC-018', 'POC-021']) assert.equal(CASE_OPERATIONS[t], CASE_OPERATIONS['POC-016']);
  assert.deepEqual([...CASE_OPERATIONS['POC-017'].intents].sort(), ['AM_TO_FULL_DAY', 'AM_TO_PM']);
});
/** A complete, self-consistent synthetic POC-016 capture made with the REAL commit builder (reviewer's probe). */
function synth016(intent) {
  const command = { ...CMD, intent: { ...CMD.intent, coverageChange: intent } };
  const committedAt = '2026-11-16T07:30:00.000Z'; const ut = '2026-11-16T07:20:00.000000Z'; const T = 'TR-00000000-0000-4000-8000-000000000001';
  const ENTRY = 'workspaces/WS-SC01/classes/CLASS-606-SC01/attendanceSessions/AS-SC01-20261116-DAILY/entries/AT-20261116-07';
  const pre = { [LV]: CURRENT, [ENTRY]: { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01', enrollmentId: CURRENT.enrollmentId, status: 'N', version: 4 }, 'authBindings/u1': { authUid: 'u1', principalId: P } };
  const docs = buildCommitDocs({ command, scope: SCOPE, principalId: P, hash: requestHash({ command, scope: SCOPE, principalId: P }), currentPath: LV, current: CURRENT, committedAt, eventId: 'EV-1' });
  const post = { ...pre, ...Object.fromEntries(docs.map((d) => [d.path, d.data])), 'workspaces/WS-SC01/auditLog/a1': { traceId: T, principalId: P, decision: 'allow', reasonCode: 'OK', action: 'leaveRecord.revise' } };
  const receipt = receiptOut(docs.find((d) => d.kind === 'receipt').data);
  const front = [{ role: 'front', traceId: T, at: iso(1000), endedAt: iso(1100), method: 'POST', path: '/v1/commit', authorizationRef: { claimedAuthUid: 'u1' }, requestBody: traceableCommitBody({ command, claimedScope: SCOPE }), status: 200, responseBody: { code: 'OK', receipt, traceId: T }, delivered: true, receiptDigest: receiptDigestOf(JSON.stringify({ receipt })) }];
  const get = (p0, t0) => ({ role: 'back', seq: t0, traceId: T, at: iso(t0), endedAt: iso(t0 + 1), durationMs: 1, method: 'GET', path: `/v1/projects/p/databases/(default)/documents/${p0}`, requestBody: null, status: 200, responseBody: {} });
  const back = [get('authBindings/u1', 1001), get(`principals/${P}`, 1002), { ...get('workspaces/WS-SC01:runQuery', 1003), method: 'POST' },
    be(T, 'beginTransaction', 1010, 1011, {}, { transaction: 'TX1' }),
    be(T, 'batchGet', 1012, 1013, { documents: [N(`workspaces/WS-SC01/operationReceipts/${command.operationId}`)], transaction: 'TX1' }, [{ missing: N(`workspaces/WS-SC01/operationReceipts/${command.operationId}`) }]),
    be(T, 'batchGet', 1014, 1015, { documents: [N(LV)], transaction: 'TX1' }, [{ found: { name: N(LV), fields: toFields(CURRENT), updateTime: ut } }]),
    be(T, 'commit', 1016, 1020, { transaction: 'TX1', writes: docs.map((d) => ({ update: { name: N(d.path), fields: toFields(d.data) }, currentDocument: d.kind === 'current' ? { updateTime: ut } : { exists: false } })) }, {})];
  const obs = observe({ testId: 'POC-016', actor: P, front, back, pre, post });
  return verdict({ caseSpec: caseSpecs['POC-016'], observation: obs, adapterOutput: null, stage1Result: null, inputDigestsVerified: true });
}
test('REV-21-01 POC-016: correct AM_TO_FULL_DAY capture MATCHes; a correctly executed AM_TO_PM is NOT this case', () => {
  const ok = synth016('AM_TO_FULL_DAY');
  assert.equal(ok.contractMatch, 'MATCH', JSON.stringify(ok.problems)); assert.deepEqual(ok.problems, []);
  const wrong = synth016('AM_TO_PM');
  assert.notEqual(wrong.contractMatch, 'MATCH');
  assert.ok(wrong.problems.includes('CASE_OPERATION_MISMATCH:intent[0]') && wrong.problems.includes('CASE_OPERATION_MISMATCH:postDayPart'), JSON.stringify(wrong.problems));
});
test('case operation check names every deviation (target, version, scope, intents of POC-017)', () => {
  const lv = { path: LV, pre: CURRENT, post: { ...CURRENT, coverageSegments: [{ ...CURRENT.coverageSegments[0], dayPart: 'FULL_DAY' }] } };
  const r = (c, sc = SCOPE) => ({ command: { ...CMD, ...c }, claimedScope: sc });
  assert.deepEqual(checkCaseOperation('POC-016', { commands: [r({})], lv }), []);
  assert.ok(checkCaseOperation('POC-016', { commands: [r({ targetId: 'LV-008' })], lv }).includes('CASE_OPERATION_MISMATCH:targetId[0]'));
  assert.ok(checkCaseOperation('POC-016', { commands: [r({ expectedVersion: 4 })], lv }).includes('CASE_OPERATION_MISMATCH:expectedVersion[0]'));
  assert.ok(checkCaseOperation('POC-016', { commands: [r({ operationId: 'OP-X' })], lv }).includes('CASE_OPERATION_MISMATCH:operationId[0]'));
  assert.ok(checkCaseOperation('POC-016', { commands: [r({}, { workspaceId: 'WS-SC01', classId: 'C-X' })], lv }).includes('CASE_OPERATION_MISMATCH:claimedScope[0]'));
  assert.ok(checkCaseOperation('POC-016', { commands: [r({})], lv: { ...lv, pre: { ...CURRENT, version: 4 } } }).includes('CASE_OPERATION_MISMATCH:preVersion'));
  const i = (cc) => r({ operationId: 'U', intent: { coverageChange: cc, reasonCode: 'SOURCE_CORRECTION' } });
  assert.deepEqual(checkCaseOperation('POC-017', { commands: [i('AM_TO_FULL_DAY'), i('AM_TO_PM')], lv }), []);
  assert.ok(checkCaseOperation('POC-017', { commands: [i('AM_TO_FULL_DAY'), i('AM_TO_FULL_DAY')], lv }).includes('CASE_OPERATION_MISMATCH:intents'));
  assert.deepEqual(checkCaseOperation('POC-999', { commands: [], lv }), ['CASE_OPERATION_UNKNOWN']);
});
test('REV-21-02 back commit hold: recorded on every commit of POC-017 only', () => {
  assert.deepEqual(Object.keys(CASE_BACK_FAULTS), ['POC-017']);
  const c = (extra) => ({ role: 'back', method: 'POST', path: '/v1/projects/p/databases/(default)/documents:commit', ...extra });
  assert.deepEqual(checkBackFaults([c({ hold: {} }), c({ hold: {} })], 'POC-017'), []);
  assert.ok(checkBackFaults([c({ hold: {} }), c({})], 'POC-017').length);
  assert.ok(checkBackFaults([c({ hold: {} })], 'POC-016').length);
  assert.deepEqual(checkBackFaults([c({})], 'POC-016'), []);
});
test('case operation: the resolved target must be THE case record path', () => {
  const lv = { path: 'workspaces/WS-X/classes/CLASS-606-SC01/leaveRecords/LV-007', pre: CURRENT, post: { ...CURRENT, coverageSegments: [{ ...CURRENT.coverageSegments[0], dayPart: 'FULL_DAY' }] } };
  assert.ok(checkCaseOperation('POC-016', { commands: [{ command: { ...CMD }, claimedScope: SCOPE }], lv }).includes('CASE_OPERATION_MISMATCH:target'));
});
import http from 'node:http';
import { createTraceProxy } from '../src/trace-proxy.mjs';
import { makeMasker } from '../src/mask.mjs';
test('REV-21-02 back commit hold: a commit waits until TWO requests completed a current read (real loopback proxy)', { timeout: 20000 }, async () => {
  const up = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(req.url.endsWith(':batchGet') ? '[]' : '{}'); }); });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${up.address().port}`;
  const px = createTraceProxy({ role: 'back', port: 0, masker: makeMasker([]), route: () => origin, faults: { commitHold: { reads: 2, timeoutMs: 3000 } } });
  const port = await px.listen();
  const post = (verb, trace, body) => fetch(`http://127.0.0.1:${port}/v1/projects/p/databases/(default)/documents:${verb}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cmn-trace-id': trace }, body: JSON.stringify(body) }).then((r) => r.text());
  try {
  const A = 'TR-00000000-0000-4000-8000-00000000000a'; const B = 'TR-00000000-0000-4000-8000-00000000000b';
  const cur = { documents: [N(LV)], transaction: 'T' };
  let committed = false;
  await post('batchGet', A, cur);
  const c = post('commit', A, { transaction: 'T', writes: [] }).then(() => { committed = true; });
  await post('batchGet', B, { documents: [N('x/r')], transaction: 'T' });          // not a current read: does not count
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(committed, false, 'commit must still be held after only ONE request read the current record');
  await post('batchGet', A, cur);                                                   // same request again: does not count
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(committed, false, 'a second read by the SAME request does not release the hold');
  await post('batchGet', B, cur);
  await c; assert.equal(committed, true);
  const rec = px.entries.find((e) => e.path.endsWith(':commit'));
  assert.equal(rec.hold.complete, true); assert.equal(rec.hold.readers, 2);
  } finally { up.closeAllConnections(); await Promise.race([Promise.all([px.close(), new Promise((r) => up.close(r))]), new Promise((r) => setTimeout(r, 500))]); }
});
