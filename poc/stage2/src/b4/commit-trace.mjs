/** B4 judge helpers (TRUSTED TOOLCHAIN; plan S2B2-B4-PLAN v0.2 §2.1, §3.2). Pure functions over the masked
 *  BACK trace, the masked FRONT trace and the exported pre / post state. They never read the Adapter's claim and
 *  never believe what the API says about itself: transaction ids come from the Emulator's beginTransaction
 *  RESPONSES in the back trace; every read / commit / rollback is bound to one of them.
 *
 *  Time base (implementation-review check 1): every interval is [at, endedAt] of ONE back-proxy entry, taken from
 *  the back proxy's own clock (one process). Concurrency is decided from these intervals, never from the order in
 *  which lines were written. The expected values of POC-016/017/018/021 are NOT used here. */
import { stableJson, sha256Hex } from '../stable.mjs';
import { fromFields } from '../api/store.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const AUDIT_DOC_RE = /^(workspaces\/[^/]+\/auditLog|auditLogUnscoped)\/[^/]+$/;
const VERB_RE = /\/documents:([A-Za-z]+)$/;
const DOC_RE = /\/documents\/(.+)$/;
export const docPathOfName = (name) => { if (typeof name !== 'string') return null; const m = /\/databases\/\(default\)\/documents\/(.+)$/.exec(name); return m ? m[1] : null; };
export const tStart = (e) => Date.parse(e.at);
export const tEnd = (e) => (typeof e.endedAt === 'string' ? Date.parse(e.endedAt) : Date.parse(e.at) + (Number.isSafeInteger(e.durationMs) ? e.durationMs : NaN));

/** Judge-side copy of the §8 rule (deliberately NOT imported from the API). */
export function judgeRequestHash({ command, workspaceId, classId, principalId }) {
  const o = { v: 'sha256-stablejson-v1', workspaceId, classId, principalId, commandType: command.commandType, targetType: command.targetType, targetId: command.targetId, expectedVersion: command.expectedVersion, intent: command.intent };
  return sha256Hex(Buffer.from(stableJson(o), 'utf8'));
}
/** Judge-side intent table (deliberately NOT imported from the API): coverageChange → [dayPart before, after]. */
export const JUDGE_COVERAGE = Object.freeze({ AM_TO_FULL_DAY: ['AM', 'FULL_DAY'], AM_TO_PM: ['AM', 'PM'] });

const WRITE_KEYS = new Set(['update', 'delete', 'transform', 'currentDocument', 'updateMask', 'updateTransforms']);
/** One Firestore write of a commit body, decoded with nothing dropped silently. */
export function decodeWrite(w) {
  if (!isObj(w)) return { kind: 'invalid' };
  const unknownKeys = Object.keys(w).filter((k) => !WRITE_KEYS.has(k));
  const kind = w.update ? 'update' : w.delete ? 'delete' : w.transform ? 'transform' : 'invalid';
  const name = kind === 'update' ? w.update?.name : kind === 'delete' ? w.delete : w.transform?.document;
  const updateKeys = kind === 'update' && isObj(w.update) ? Object.keys(w.update).filter((k) => k !== 'name' && k !== 'fields') : [];
  let fields = null; try { fields = kind === 'update' && isObj(w.update.fields) ? fromFields(w.update.fields) : null; } catch { fields = null; }
  return { kind, path: docPathOfName(name), fields, precondition: isObj(w.currentDocument) ? w.currentDocument : null, hasMask: Object.hasOwn(w, 'updateMask'), hasTransforms: Object.hasOwn(w, 'updateTransforms') || kind === 'transform', unknownKeys: [...unknownKeys, ...updateKeys] };
}

/** Classifies one back entry. → { cls, verb?, docPath? }  cls ∈ auth | audit | read | begin | batchGet | commit | rollback | write */
export function classifyBack(b) {
  if (typeof b.path !== 'string') return { cls: 'write' };
  if (b.path.includes('/identitytoolkit.googleapis.com/')) return { cls: 'auth' };
  const v = VERB_RE.exec(b.path);
  if (v && b.method === 'POST') {
    const verb = v[1];
    if (verb === 'runQuery' || verb === 'listCollectionIds') return { cls: 'read', verb };
    if (verb === 'beginTransaction') return { cls: 'begin', verb };
    if (verb === 'batchGet') return { cls: 'batchGet', verb };
    if (verb === 'commit') return { cls: 'commit', verb };
    if (verb === 'rollback') return { cls: 'rollback', verb };
    return { cls: 'write', verb };
  }
  const d = DOC_RE.exec(b.path); const docPath = d ? d[1].replace(/:runQuery$/, '') : null;
  if (b.method === 'POST' && /:runQuery$/.test(b.path)) return { cls: 'read', verb: 'runQuery', docPath };
  if (b.method === 'GET') return { cls: 'read', docPath };
  if (b.method === 'PATCH' && docPath && AUDIT_DOC_RE.test(docPath)) return { cls: 'audit', docPath };
  return { cls: 'write', docPath };
}

/** Rebuilds the transactions of ONE front request (traceId) from the back trace.
 *  → { attempts: [{ txn, begin, reads: [{ e, path, found, data, updateTime }], commit: { e, ok, writes } | null, rolledBack }],
 *      unboundTxnCalls, otherWrites, plainReads, problems } */
export function transactionsOf(back, traceId) {
  const mine = back.filter((b) => b.role === 'back' && b.traceId === traceId).slice().sort((a, b) => tStart(a) - tStart(b) || a.seq - b.seq);
  const attempts = []; const byTxn = new Map(); const out = { attempts, unboundTxnCalls: [], otherWrites: [], plainReads: [], problems: [] };
  for (const b of mine) {
    const c = classifyBack(b);
    if (c.cls === 'begin') {
      const txn = b.status === 200 && typeof b.responseBody?.transaction === 'string' && b.responseBody.transaction !== '' ? b.responseBody.transaction : null;
      if (!txn) { out.problems.push('BEGIN_WITHOUT_TRANSACTION'); continue; }
      if (byTxn.has(txn)) { out.problems.push('TRANSACTION_ID_REUSED'); continue; }
      const a = { txn, begin: b, reads: [], commit: null, rolledBack: false }; attempts.push(a); byTxn.set(txn, a);
    } else if (c.cls === 'batchGet' || c.cls === 'commit' || c.cls === 'rollback') {
      const txn = b.requestBody?.transaction;
      const a = typeof txn === 'string' ? byTxn.get(txn) : undefined;
      if (!a) { out.unboundTxnCalls.push({ cls: c.cls, e: b }); continue; }
      if (c.cls === 'batchGet') {
        const docs = Array.isArray(b.requestBody?.documents) ? b.requestBody.documents : [];
        const res = Array.isArray(b.responseBody) ? b.responseBody : [];
        if (b.status !== 200 || docs.length !== 1 || res.length !== 1) { a.reads.push({ e: b, path: docPathOfName(docs[0]), failed: true }); continue; }
        const r = res[0]; const path = docPathOfName(docs[0]);
        if (r.found && docPathOfName(r.found.name) === path) a.reads.push({ e: b, path, found: true, data: fromFields(r.found.fields || {}), updateTime: r.found.updateTime });
        else if (r.missing && docPathOfName(r.missing) === path) a.reads.push({ e: b, path, found: false });
        else a.reads.push({ e: b, path, failed: true });
      } else if (c.cls === 'commit') {
        if (a.commit) { out.problems.push('TWO_COMMITS_IN_ONE_TRANSACTION'); continue; }
        const ws = Array.isArray(b.requestBody?.writes) ? b.requestBody.writes.map(decodeWrite) : null;
        a.commit = { e: b, ok: b.status === 200, aborted: b.status === 409 && b.responseBody?.error?.status === 'ABORTED', writes: ws };
      } else a.rolledBack = true;
    } else if (c.cls === 'write') out.otherWrites.push(b);
    else if (c.cls === 'read') out.plainReads.push({ e: b, docPath: c.docPath ?? null, verb: c.verb ?? null });
  }
  return out;
}

/** Every successful commit of the case, over all traces. → [{ traceId, attempt, e }] */
export function successfulCommits(back, traceIds) {
  const out = [];
  for (const t of traceIds) for (const a of transactionsOf(back, t).attempts) if (a.commit?.ok) out.push({ traceId: t, attempt: a });
  return out;
}

/** POC-016 / every honest commit (plan §2.1, implementation-review check 2): the ONE successful commit must hold
 *  exactly the five expected writes — full document paths, kind, preconditions and content — recomputed here from
 *  the pre-state, the front-trace command, the actor and the current read of the SAME transaction.
 *  → { ok, problems, committedAt, receiptPath, revisionPath } */
export function checkCommitWriteSet({ attempt, pre, command, principalId }) {
  const problems = []; const p = (c) => problems.push(c);
  const writes = attempt.commit?.writes;
  if (!Array.isArray(writes)) return { ok: false, problems: ['COMMIT_BODY_UNREADABLE'] };
  const curRead = attempt.reads.find((r) => r.found && /\/leaveRecords\/[^/]+$/.test(r.path || ''));
  if (!curRead) return { ok: false, problems: ['NO_CURRENT_READ_IN_COMMIT_TRANSACTION'] };
  const currentPath = curRead.path;
  const m = /^workspaces\/([^/]+)\/classes\/([^/]+)\/leaveRecords\/([^/]+)$/.exec(currentPath);
  const before = pre[currentPath];
  if (!m || !isObj(before) || m[3] !== command.targetId) return { ok: false, problems: ['CURRENT_PATH_NOT_THE_TARGET'] };
  const [, ws, cls] = m; const v = before.version; const nv = v + 1; const op = command.operationId;
  // the transaction's current read must be the pre-state document itself (nothing changed it before this commit)
  if (stableJson(curRead.data) !== stableJson(before)) p('CURRENT_READ_DIFFERS_FROM_PRE_STATE');
  const receiptPath = `workspaces/${ws}/operationReceipts/${op}`; const revisionPath = `${currentPath}/revisions/${nv}`; const dpPath = `workspaces/${ws}/derivedProgress/${op}`;
  const receiptRead = attempt.reads.find((r) => r.path === receiptPath);
  if (!receiptRead || receiptRead.found !== false) p('RECEIPT_NOT_READ_ABSENT_IN_COMMIT_TRANSACTION');
  else if (!(tEnd(receiptRead.e) <= tStart(curRead.e))) p('RECEIPT_NOT_READ_BEFORE_CURRENT');
  if (writes.length !== 5) p(`WRITE_COUNT:${writes.length}`);
  for (const w of writes) {
    if (w.kind !== 'update') p(`WRITE_KIND:${w.kind}`);
    if (w.hasMask || w.hasTransforms || (w.unknownKeys || []).length) p(`WRITE_EXTRA:${w.path}`);
    if (typeof w.path !== 'string' || AUDIT_DOC_RE.test(w.path)) p(`WRITE_PATH:${w.path}`);
  }
  const at = (path) => writes.filter((w) => w.path === path);
  const one = (path, what) => { const x = at(path); if (x.length !== 1) { p(`WRITE_MISSING_OR_DUPLICATE:${what}`); return null; } return x[0]; };
  const events = writes.filter((w) => typeof w.path === 'string' && new RegExp(`^workspaces/${ws}/events/[^/]+$`).test(w.path));
  if (events.length !== 1) p(`WRITE_MISSING_OR_DUPLICATE:event:${events.length}`);
  const cur = one(currentPath, 'current'); const rev = one(revisionPath, 'revision'); const rcp = one(receiptPath, 'receipt'); const dp = one(dpPath, 'derivedProgress'); const ev = events[0] || null;
  const known = new Set([currentPath, revisionPath, receiptPath, dpPath, ev?.path]);
  for (const w of writes) if (!known.has(w.path)) p(`WRITE_UNEXPECTED_PATH:${w.path}`);
  const exact = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
  // preconditions: current guarded by the updateTime read in THIS transaction; the others create-only
  if (cur && !(exact(cur.precondition, ['updateTime']) && cur.precondition.updateTime === curRead.updateTime)) p('CURRENT_PRECONDITION');
  for (const [w, n] of [[rev, 'revision'], [rcp, 'receipt'], [ev, 'event'], [dp, 'derivedProgress']]) if (w && !(exact(w.precondition, ['exists']) && w.precondition.exists === false)) p(`CREATE_PRECONDITION:${n}`);
  const committedAt = rcp?.fields?.committedAt;
  if (typeof committedAt !== 'string' || Number.isNaN(Date.parse(committedAt))) p('COMMITTED_AT');
  const rule = JUDGE_COVERAGE[command.intent?.coverageChange];
  const segsBefore = before.coverageSegments;
  const expCoverage = rule && Array.isArray(segsBefore) && segsBefore.length === 1 && segsBefore[0].dayPart === rule[0] ? [{ ...segsBefore[0], dayPart: rule[1] }] : null;
  if (!expCoverage) p('INTENT_NOT_APPLICABLE_TO_PRE_STATE');
  if (cur?.fields) {
    const expCur = { ...before, version: nv, coverageSegments: expCoverage, lastOperationId: op, lastRevisionAt: committedAt };
    if (stableJson(cur.fields) !== stableJson(expCur)) p('CURRENT_CONTENT');
  }
  if (rev?.fields && stableJson(rev.fields) !== stableJson({ revisionNo: nv, previousVersion: v, newVersion: nv, operationId: op, principalId, changedFields: ['coverageSegments'], before: { coverageSegments: segsBefore }, after: { coverageSegments: expCoverage }, committedAt })) p('REVISION_CONTENT');
  const hash = judgeRequestHash({ command, workspaceId: ws, classId: cls, principalId });
  if (rcp?.fields && stableJson(rcp.fields) !== stableJson({ operationId: op, requestHash: hash, requestHashAlgorithm: 'sha256-stablejson-v1', principalId, classId: cls, commandType: command.commandType, targetType: command.targetType, targetId: command.targetId, status: 'committed', previousVersion: v, currentVersion: nv, derivedStatusAtCommit: 'pending', committedAt })) p('RECEIPT_CONTENT');
  const evId = ev?.path?.split('/').pop();
  if (ev?.fields && !(ID.test(evId || '') && stableJson(ev.fields) === stableJson({ eventId: evId, operationId: op, eventType: 'LeaveRecord.Revised', sourceType: 'LeaveRecord', sourceId: command.targetId, sourceVersion: nv, occurredAt: committedAt }))) p('EVENT_CONTENT');
  if (dp?.fields && stableJson(dp.fields) !== stableJson({ operationId: op, derivedStatus: 'pending', updatedAt: committedAt, attempts: 0 })) p('DERIVED_PROGRESS_CONTENT');
  return { ok: problems.length === 0, problems, committedAt, receiptPath, revisionPath, requestHash: hash, eventPath: ev?.path ?? null, currentPath, previousVersion: v, currentVersion: nv };
}

/** POC-017 (plan §2.1, implementation-review check 1): the two requests' transactions overlap in time.
 *  Established iff BOTH first attempts began and made their first in-transaction read STRICTLY BEFORE the earliest
 *  successful commit (of either) finished. Intervals are back-proxy [at, endedAt]; ties are NOT overlap. */
export function concurrencyOf(back, traceIds) {
  const views = traceIds.map((t) => ({ traceId: t, ...transactionsOf(back, t) }));
  const commitEnds = views.flatMap((v) => v.attempts.filter((a) => a.commit?.ok).map((a) => tEnd(a.commit.e)));
  const firstCommitEnd = commitEnds.length ? Math.min(...commitEnds) : null;
  const per = views.map((v) => {
    const a0 = v.attempts[0]; const r0 = a0?.reads[0];
    return { traceId: v.traceId, firstBeginAt: a0 ? tStart(a0.begin) : null, firstReadAt: r0 ? tStart(r0.e) : null, attempts: v.attempts.length };
  });
  const established = firstCommitEnd !== null && per.length === 2 && per.every((x) => x.firstBeginAt !== null && x.firstReadAt !== null && x.firstBeginAt < firstCommitEnd && x.firstReadAt < firstCommitEnd);
  return { established, firstCommitEnd, per };
}

/** Attempt-level classification of one commit request (implementation-review check 1): retries are counted, every
 *  attempt is its own transaction, and an attempt's decision uses only reads of THAT transaction. */
export function attemptSummary(view, { receiptPath, currentPath }) {
  return view.attempts.map((a, i) => {
    const rec = a.reads.find((r) => r.path === receiptPath); const cur = a.reads.find((r) => r.path === currentPath);
    return { n: i + 1, txn: a.txn, receiptRead: rec ? (rec.failed ? 'failed' : rec.found ? 'found' : 'absent') : 'none', currentVersionRead: cur?.found ? cur.data.version : null,
      commit: a.commit ? (a.commit.ok ? 'ok' : a.commit.aborted ? 'aborted' : 'failed') : 'none', rolledBack: a.rolledBack };
  });
}
