/** B4: controlled WRITE processing — `LeaveRecord.Revise` only (S2B1-AUTHORIZATION §6.5, §8; DATA-MODEL §3.6–§3.7;
 *  plan S2B2-B4-PLAN v0.2 §3.1.1). The caller (api/server.mjs) has ALREADY authorized the request (§8 step 1,
 *  capability leave.revise) before anything here runs, so an unauthorized caller never reaches a receipt read.
 *
 *  Per attempt, in ONE Firestore transaction:
 *   3. read operationReceipts/{operationId}: missing → continue; same requestHash → return the stored receipt,
 *      no write; different requestHash → OPERATION_REUSE_MISMATCH {code, operationId}, no write;
 *   4. read the current leave record: version ≠ expectedVersion → VERSION_CONFLICT, no write;
 *   5. ONE commit with exactly five writes: current (version + 1, precondition = the updateTime read in this
 *      transaction), revision, receipt, event, derivedProgress (each create-only: exists = false).
 *  An Emulator ABORTED (lock timeout / contention) restarts the whole attempt in a NEW transaction from step 3;
 *  at most MAX_RETRIES retries, then TRANSACTION_CONTENTION (503). Nothing else is ever a VERSION_CONFLICT.
 *
 *  Known limitation (G-4): the trusted period calendar does not exist, so an intent changes ONLY the segment's
 *  dayPart; periodRefs are kept as they were and are NOT recomputed. No expected value of POC-016/017/018/021
 *  depends on periodRefs. */
import { randomUUID } from 'node:crypto';
import { stableJson, sha256Hex } from '../stable.mjs';
import { ID_RE } from '../authz.mjs';
import { TxnAborted } from './txn.mjs';
import { IntegrityError } from './response-shape.mjs';

export const REQUEST_HASH_ALGORITHM = 'sha256-stablejson-v1';
export const MAX_RETRIES = 5;
export const COMMAND_TYPE = 'LeaveRecord.Revise';
export const TARGET_TYPE = 'LeaveRecord';
export const WRITE_OP = 'leaveRecord.revise';
/** intent.coverageChange → the single segment's dayPart before / after (G-4: periodRefs are not recomputed). */
export const COVERAGE_CHANGES = Object.freeze({ AM_TO_FULL_DAY: { from: 'AM', to: 'FULL_DAY' }, AM_TO_PM: { from: 'AM', to: 'PM' } });
const COMMAND_KEYS = ['schemaVersion', 'workspaceId', 'operationId', 'commandType', 'targetType', 'targetId', 'expectedVersion', 'intent', 'clientCreatedAt'];
const REASON_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

/** Structural allow-list, checked BEFORE authorization (format errors there are FORBIDDEN, §6.6):
 *  { command: <canonicalCommand shape>, claimedScope: { workspaceId, classId } }, the command naming THIS
 *  operation (commandType / targetType) and the same workspace as the claimed scope. */
export function checkCommitShape(body) {
  if (!exactKeys(body, ['command', 'claimedScope'])) return false;
  const c = body.command; const s = body.claimedScope;
  if (!exactKeys(c, COMMAND_KEYS) || !exactKeys(s, ['workspaceId', 'classId'])) return false;
  if (typeof s.workspaceId !== 'string' || typeof s.classId !== 'string') return false;
  for (const k of ['schemaVersion', 'workspaceId', 'operationId', 'commandType', 'targetType', 'targetId', 'clientCreatedAt']) if (typeof c[k] !== 'string') return false;
  if (typeof c.expectedVersion !== 'number') return false;
  if (!exactKeys(c.intent, ['coverageChange', 'reasonCode']) || typeof c.intent.coverageChange !== 'string' || typeof c.intent.reasonCode !== 'string') return false;
  if (c.commandType !== COMMAND_TYPE || c.targetType !== TARGET_TYPE) return false;
  if (c.workspaceId !== s.workspaceId) return false;
  return true;
}

/** Input validation AFTER authorization (§6.6: INVALID_INPUT only for a caller who passed the operator checks). */
export function validateCommand(c) {
  if (c.schemaVersion !== '1.0') return 'SCHEMA_VERSION';
  if (!ID_RE.test(c.operationId)) return 'OPERATION_ID';
  if (!ID_RE.test(c.targetId)) return 'TARGET_ID';
  if (!Number.isSafeInteger(c.expectedVersion) || c.expectedVersion < 0) return 'EXPECTED_VERSION';
  if (!Object.hasOwn(COVERAGE_CHANGES, c.intent.coverageChange)) return 'COVERAGE_CHANGE';
  if (!REASON_RE.test(c.intent.reasonCode)) return 'REASON_CODE';
  if (c.clientCreatedAt.length > 64) return 'CLIENT_CREATED_AT';
  return null;
}

/** §8 canonical requestHash input: server-resolved scope + principal, client command fields; nothing else. */
export const requestHashInput = ({ command, scope, principalId }) => ({
  v: REQUEST_HASH_ALGORITHM, workspaceId: scope.workspaceId, classId: scope.classId, principalId,
  commandType: command.commandType, targetType: command.targetType, targetId: command.targetId, expectedVersion: command.expectedVersion, intent: command.intent,
});
export const requestHash = (args) => sha256Hex(Buffer.from(stableJson(requestHashInput(args)), 'utf8'));

/** The receipt as returned to its owner: the immutable stored receipt, field by field (no principal / class). */
export const RECEIPT_OUT_FIELDS = Object.freeze(['operationId', 'status', 'commandType', 'targetType', 'targetId', 'previousVersion', 'currentVersion', 'requestHash', 'requestHashAlgorithm', 'derivedStatusAtCommit', 'committedAt']);
export function receiptOut(r) {
  const out = {};
  for (const k of RECEIPT_OUT_FIELDS) { if (!Object.hasOwn(r || {}, k)) throw new IntegrityError('DATA_INTEGRITY_ERROR', `receipt.${k} missing`); out[k] = r[k]; }
  return out;
}

function nextCoverage(current, change, anyDayPart = false) {
  const segs = current.coverageSegments;
  if (!Array.isArray(segs) || segs.length !== 1 || !isObj(segs[0])) return null;
  const rule = COVERAGE_CHANGES[change];
  if (segs[0].dayPart !== rule.from && !anyDayPart) return null;
  return [{ ...segs[0], dayPart: rule.to }];
}

/** The five documents of one commit (data model §3.6–§3.7). Exported for unit tests. */
export function buildCommitDocs({ command, scope, principalId, hash, currentPath, current, committedAt, eventId, anyDayPart = false }) {
  const ws = scope.workspaceId; const op = command.operationId; const v = current.version; const nv = v + 1;
  const coverage = nextCoverage(current, command.intent.coverageChange, anyDayPart);
  if (!coverage) return null;
  return [
    { path: currentPath, kind: 'current', data: { ...current, version: nv, coverageSegments: coverage, lastOperationId: op, lastRevisionAt: committedAt } },
    { path: `${currentPath}/revisions/${nv}`, kind: 'revision', data: { revisionNo: nv, previousVersion: v, newVersion: nv, operationId: op, principalId, changedFields: ['coverageSegments'], before: { coverageSegments: current.coverageSegments }, after: { coverageSegments: coverage }, committedAt } },
    { path: `workspaces/${ws}/operationReceipts/${op}`, kind: 'receipt', data: { operationId: op, requestHash: hash, requestHashAlgorithm: REQUEST_HASH_ALGORITHM, principalId, classId: scope.classId, commandType: command.commandType, targetType: command.targetType, targetId: command.targetId, status: 'committed', previousVersion: v, currentVersion: nv, derivedStatusAtCommit: 'pending', committedAt } },
    { path: `workspaces/${ws}/events/${eventId}`, kind: 'event', data: { eventId, operationId: op, eventType: 'LeaveRecord.Revised', sourceType: TARGET_TYPE, sourceId: command.targetId, sourceVersion: nv, occurredAt: committedAt } },
    { path: `workspaces/${ws}/derivedProgress/${op}`, kind: 'derivedProgress', data: { operationId: op, derivedStatus: 'pending', updatedAt: committedAt, attempts: 0 } },
  ];
}

/** @param ctx { command, scope, principalId, currentPath, txn (createTxnClient), toFields, nowMs, mutation, sleep }
 *  @returns { status, body, outcome, attempts, transactionRef, requestHash } — never throws TxnAborted. */
export async function processCommit({ command, scope, principalId, currentPath, txn, toFields, nowMs, mutation = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const hash = requestHash({ command, scope, principalId });
  const receiptPath = `workspaces/${scope.workspaceId}/operationReceipts/${command.operationId}`;
  const encode = (d, precondition) => ({ update: { name: txn.nameOf(d.path), fields: toFields(d.data) }, currentDocument: precondition });
  let attempts = 0;
  const done = (status, body, outcome, transactionRef = null) => ({ status, body, outcome, attempts, transactionRef, requestHash: hash });
  while (attempts <= MAX_RETRIES) {
    attempts += 1;
    let t = null;
    try {
      t = await txn.begin();
      // §8 step 3 — the receipt, inside this transaction, before the current record
      const rec = mutation?.skipReceiptCheck ? null : await txn.get(receiptPath, t);
      if (rec) {
        await txn.rollback(t);
        if (rec.data.requestHash === hash) return done(200, { code: 'OK', receipt: receiptOut(rec.data) }, 'REPLAYED');
        return done(409, { code: 'OPERATION_REUSE_MISMATCH', operationId: command.operationId }, 'REUSE_MISMATCH');
      }
      // §8 step 4 — current, inside the same transaction
      const cur = await txn.get(currentPath, t);
      if (!cur || !Number.isSafeInteger(cur.data.version)) { await txn.rollback(t); throw new IntegrityError('DATA_INTEGRITY_ERROR', 'current leave record missing or without version'); }
      if (cur.data.version !== command.expectedVersion && !mutation?.skipVersionCheck) { await txn.rollback(t); return done(409, { code: 'VERSION_CONFLICT' }, 'VERSION_CONFLICT'); }
      const committedAt = new Date(nowMs()).toISOString();
      const docs = buildCommitDocs({ command, scope, principalId, hash, currentPath, current: cur.data, committedAt, eventId: `EV-${randomUUID()}`, anyDayPart: mutation?.anyDayPart === true });
      if (!docs) { await txn.rollback(t); return done(400, { code: 'INVALID_INPUT' }, 'INTENT_NOT_APPLICABLE'); }
      // §8 step 5 — one commit, five writes: current guarded by the updateTime read in THIS transaction, the rest create-only
      const writes = docs.map((d) => encode(d, d.kind === 'current' ? { updateTime: cur.updateTime } : { exists: false }));
      if (mutation?.splitCommit) {
        // MUTATION (tests only): the same writes in two separate commits — not atomic
        await txn.commit(t, writes.slice(0, 2));
        const t2 = await txn.begin(); await txn.commit(t2, writes.slice(2));
      } else await txn.commit(t, writes);
      const receipt = receiptOut(docs.find((d) => d.kind === 'receipt').data);
      return done(200, { code: 'OK', receipt }, 'COMMITTED', mutation?.reportTransactionRef ? mutation.reportTransactionRef(t) : t);
    } catch (e) {
      if (!(e instanceof TxnAborted)) throw e;
      // contention: a NEW transaction re-reads receipt and current from §8 step 3 (no value of this attempt is reused)
      if (attempts <= MAX_RETRIES) await sleep(10 + Math.floor(Math.random() * 40));
    }
  }
  return done(503, { code: 'UNAVAILABLE', reason: 'TRANSACTION_CONTENTION' }, 'TRANSACTION_CONTENTION');
}
