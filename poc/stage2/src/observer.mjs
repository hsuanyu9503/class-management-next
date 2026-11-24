/** Observer prototype (S2B2-ATTESTATION §4): computes each case's canonical ONLY from
 *   - the masked FRONT trace (what the API actually answered),
 *   - the masked BACK trace (what the API actually read from the emulator),
 *   - exported emulator state before / after the case (incl. the API's own auditLog records).
 *  It never reads the Adapter's claim and never reads the oracle's expected values; comparison against
 *  the oracle happens later in verdict.mjs. This is a prototype, NOT the trusted Observer of §9.1:
 *  it runs in the same process/user as the Adapter and gives no isolation. */
import { stableJson, sha256Hex } from './stable.mjs';
import { transactionsOf, successfulCommits, checkCommitWriteSet, concurrencyOf, attemptSummary } from './b4/commit-trace.mjs';
import { checkCaseOperation } from './b4/case-ops.mjs';

const AUDIT_RE = /(^|\/)(auditLog|auditLogUnscoped)\/[^/]+$/;
const isAudit = (p) => AUDIT_RE.test(p);
const ALLOWED_DENY_KEYS = new Set(['code', 'traceId']);

export function auditByTrace(state) {
  const m = new Map();
  for (const [p, d] of Object.entries(state)) if (isAudit(p) && typeof d.traceId === 'string') { if (!m.has(d.traceId)) m.set(d.traceId, []); m.get(d.traceId).push({ path: p, ...d }); }
  return m;
}
const findDoc = (state, collection, id) => Object.entries(state).filter(([p]) => p.endsWith(`/${collection}/${id}`));
const wsOf = (p) => (/^workspaces\/([^/]+)\//.exec(p) || [])[1] ?? null;
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };

/** Identifier strings of every non-audit document in `state`, grouped by workspace. */
function identifiersByWorkspace(state) {
  const idKeys = ['studentId', 'enrollmentId', 'attendanceEntryId', 'sessionId', 'leaveRecordId', 'issueId', 'classId'];
  const m = new Map();
  for (const [p, d] of Object.entries(state)) {
    if (isAudit(p)) continue;
    const ws = wsOf(p); if (!ws) continue;
    if (!m.has(ws)) m.set(ws, new Set());
    for (const k of idKeys) if (typeof d[k] === 'string') m.get(ws).add(d[k]);
    m.get(ws).add(p.split('/').pop());
  }
  return m;
}

/** Requests of the case window, each joined with the API's own audit record (same traceId). */
export function joinRequests(front, post) {
  const audits = auditByTrace(post);
  return front.filter((e) => e.role === 'front').map((e) => {
    const a = audits.get(e.traceId) || [];
    return { traceId: e.traceId, op: e.requestBody?.op ?? null, target: e.requestBody?.target ?? null, claimedScope: e.requestBody?.claimedScope ?? null, status: e.status, body: e.responseBody, audit: a.length === 1 ? a[0] : null, auditCount: a.length, claimedAuthUid: e.authorizationRef?.claimedAuthUid ?? null,
      // B4: command projection, delivery and receipt digest as recorded by the trusted front proxy
      command: e.requestBody?.command ?? null, delivered: e.delivered ?? null, receiptDigest: e.receiptDigest ?? null, at: e.at, endedAt: e.endedAt ?? null };
  });
}

/** Firestore reads the API performed for one traceId (audit writes and Auth lookups excluded). */
export function backendReads(back, traceId) {
  return back.filter((b) => b.role === 'back' && b.traceId === traceId && !b.path.includes('/identitytoolkit.googleapis.com/')
    && !(b.method === 'PATCH' && AUDIT_RE.test(b.path.replace(/^.*\/documents\//, ''))));
}

function common(reqs, actor, problems) {
  for (const r of reqs) {
    if (r.auditCount !== 1) problems.push(`AUDIT_MISSING_OR_DUPLICATE:${r.traceId}`);
    else if (r.audit.principalId !== null && r.audit.principalId !== actor && r.audit.decision === 'allow') problems.push(`UNEXPECTED_PRINCIPAL:${r.traceId}`);
  }
  const mine = reqs.filter((r) => r.audit?.principalId === actor);
  if (mine.length === 0) problems.push('NO_TRACE_FOR_ACTOR');
  return mine;
}

/** Re-authorization evidence: every request of the actor must have read binding, principal and memberships. */
function reauthorized(back, reqs) {
  return reqs.every((r) => {
    const reads = backendReads(back, r.traceId).map((b) => b.path);
    return reads.some((p) => /\/authBindings\/[^/]+$/.test(p)) && reads.some((p) => /\/principals\/[^/]+$/.test(p))
      && (r.audit?.reasonCode !== 'OK' || reads.some((p) => p.endsWith('/memberships:runQuery') || /\/workspaces\/[^/]+:runQuery$/.test(p)));
  });
}

function unchanged(pre, post) {
  const changed = []; const added = []; const removed = [];
  for (const [p, d] of Object.entries(post)) { if (isAudit(p)) continue; if (!(p in pre)) added.push(p); else if (stableJson(pre[p]) !== stableJson(d)) changed.push(p); }
  for (const p of Object.keys(pre)) if (!isAudit(p) && !(p in post)) removed.push(p);
  return { changed, added, removed, none: !changed.length && !added.length && !removed.length };
}

// ---------------- B4 (plan v0.2 §2.1): controlled write cases
const WRITE_OP = 'leaveRecord.revise'; const RECEIPT_OP = 'operationReceipt.read';
/** Judge-side copy of the receipt fields the API returns (deliberately not imported from the API). */
const JUDGE_RECEIPT_FIELDS = ['operationId', 'status', 'commandType', 'targetType', 'targetId', 'previousVersion', 'currentVersion', 'requestHash', 'requestHashAlgorithm', 'derivedStatusAtCommit', 'committedAt'];
const receiptProjection = (doc) => (doc && typeof doc === 'object' ? Object.fromEntries(JUDGE_RECEIPT_FIELDS.map((k) => [k, doc[k]])) : null);
const receiptDigestOfDoc = (doc) => (doc ? sha256Hex(Buffer.from(stableJson(receiptProjection(doc)), 'utf8')) : null);
const LEAVE_MUTABLE = new Set(['version', 'coverageSegments', 'lastOperationId', 'lastRevisionAt']);
/** A command projection is usable only when every field the judges need was recorded (no { valueRecorded:false }). */
const fullyRecorded = (c) => !!c && !JSON.stringify(c).includes('"valueRecorded":false');
const keysUnder = (state, re) => Object.keys(state).filter((k) => re.test(k));
/** REV-21-01: the case is satisfied only by ITS operation (trusted table), never by whatever the Adapter sent. */
const bindCase = (testId, rs, lv, problems) => { for (const x of checkCaseOperation(testId, { commands: rs.map((r) => ({ command: r.command, claimedScope: r.claimedScope })), lv })) problems.push(x); };
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function leaveTarget(pre, post, command) {
  const hits = findDoc(pre, 'leaveRecords', command?.targetId);
  if (hits.length !== 1) return null;
  const path = hits[0][0]; const m = /^workspaces\/([^/]+)\/classes\/([^/]+)\//.exec(path);
  return m ? { path, ws: m[1], cls: m[2], pre: pre[path], post: post[path] ?? null } : null;
}
function writeDeltas(pre, post, lv) {
  const rev = new RegExp(`^${esc(lv.path)}/revisions/[^/]+$`); const rcp = new RegExp(`^workspaces/${esc(lv.ws)}/operationReceipts/[^/]+$`); const evt = new RegExp(`^workspaces/${esc(lv.ws)}/events/[^/]+$`);
  const newRev = keysUnder(post, rev).filter((k) => !(k in pre));
  return {
    revisionDelta: keysUnder(post, rev).length - keysUnder(pre, rev).length, receiptDelta: keysUnder(post, rcp).length - keysUnder(pre, rcp).length, eventDelta: keysUnder(post, evt).length - keysUnder(pre, evt).length,
    newRevisions: newRev.sort(), newReceipts: keysUnder(post, rcp).filter((k) => !(k in pre)).sort(), newEvents: keysUnder(post, evt).filter((k) => !(k in pre)).sort(),
  };
}
/** The attendance entry of the leave record's enrollment in the same class (from state, not from fixtures). */
function attendanceOf(state, lv) {
  const en = lv.pre?.enrollmentId;
  const hits = Object.entries(state).filter(([p, d]) => p.startsWith(`workspaces/${lv.ws}/classes/${lv.cls}/attendanceSessions/`) && /\/entries\/[^/]+$/.test(p) && d?.enrollmentId === en);
  return hits.length === 1 ? { path: hits[0][0], doc: hits[0][1] } : null;
}
/** Every non-audit document that differs pre → post. */
const changedPaths = (pre, post) => [...new Set([...Object.keys(pre), ...Object.keys(post)])].filter((k) => !isAudit(k) && !k.startsWith('_attestationRuns/') && !k.startsWith('_smokeOwnership/') && stableJson(pre[k]) !== stableJson(post[k])).sort();
/** No call in ANY trace of the case writes outside a bound transaction commit (batchWrite, PATCH, DELETE, …) and no
 *  transaction call names an id the Emulator did not hand out to that same request. */
function strayWrites(back, traceIds) {
  let other = 0; let unbound = 0;
  for (const t of traceIds) { const v = transactionsOf(back, t); other += v.otherWrites.length; unbound += v.unboundTxnCalls.length + v.problems.length; }
  return { other, unbound };
}
/** A receipt query trace that is read-only: no transaction call and no write of any kind. */
function readOnlyTrace(back, traceId) { const v = transactionsOf(back, traceId); return v.attempts.length === 0 && v.unboundTxnCalls.length === 0 && v.otherWrites.length === 0 && v.problems.length === 0; }

const OBSERVERS = {

  'POC-016'({ reqs, back, pre, post, actor, problems }) {
    const mine = common(reqs, actor, problems).filter((r) => r.op === WRITE_OP);
    if (mine.length !== 1) { problems.push(`EXPECTED_ONE_COMMIT_REQUEST:${mine.length}`); return null; }
    const r = mine[0];
    if (!fullyRecorded(r.command)) { problems.push('COMMAND_NOT_FULLY_RECORDED'); return null; }
    const lv = leaveTarget(pre, post, r.command);
    if (!lv) { problems.push('TARGET_NOT_RESOLVED_IN_PRE_STATE'); return null; }
    bindCase('POC-016', [r], lv, problems);
    const all = reqs.map((x) => x.traceId);
    const succ = successfulCommits(back, all);
    const ws = succ.length === 1 ? checkCommitWriteSet({ attempt: succ[0].attempt, pre, command: r.command, principalId: actor }) : { ok: false, problems: [`SUCCESSFUL_COMMITS:${succ.length}`] };
    const d = writeDeltas(pre, post, lv); const stray = strayWrites(back, all);
    const att = attendanceOf(post, lv); const attPre = attendanceOf(pre, lv);
    const changed = changedPaths(pre, post);
    const expectedChanged = ws.ok ? [ws.currentPath, ws.revisionPath, ws.receiptPath, ws.eventPath, `workspaces/${lv.ws}/derivedProgress/${r.command.operationId}`].sort() : null;
    const leaveDiff = lv.post ? [...new Set([...Object.keys(lv.pre), ...Object.keys(lv.post)])].filter((k) => stableJson(lv.pre[k]) !== stableJson(lv.post[k])) : null;
    const stateReceipt = ws.ok ? post[ws.receiptPath] : null;
    for (const x of ws.problems) problems.push(`WRITE_SET:${x}`);
    const assertions = {
      responseOk: r.status === 200 && r.body?.code === 'OK' && r.delivered === true,
      exactlyOneSuccessfulCommitInCase: succ.length === 1 && succ[0].traceId === r.traceId,
      commitWriteSetExact: ws.ok,
      noWriteOutsideTheCommit: stray.other === 0 && stray.unbound === 0,
      stateEqualsCommittedWrites: ws.ok && succ[0].attempt.commit.writes.every((w) => stableJson(post[w.path]) === stableJson(w.fields)),
      onlyTheFiveDocumentsChanged: !!expectedChanged && stableJson(changed) === stableJson(expectedChanged),
      leaveChangedOnlyMutableFields: !!leaveDiff && leaveDiff.every((k) => LEAVE_MUTABLE.has(k)),
      attendanceUnchanged: !!att && !!attPre && stableJson(att.doc) === stableJson(attPre.doc),
      responseReceiptEqualsStateReceipt: !!stateReceipt && stableJson(r.body?.receipt) === stableJson(receiptProjection(stateReceipt)) && r.receiptDigest === receiptDigestOfDoc(stateReceipt),
      stateReceiptRequestHashRecomputed: !!stateReceipt && stateReceipt.requestHash === ws.requestHash,
      reauthorizedFromAuthoritativeDocs: reauthorized(back, [r]),
    };
    return {
      canonical: { officialVersion: lv.post?.version ?? null, revisionDelta: d.revisionDelta, receiptDelta: d.receiptDelta, eventDelta: d.eventDelta, attendance: att?.doc?.status ?? null },
      evidence: { current: `${lv.path}@v${lv.post?.version}`, revision: d.newRevisions.join(',') || '', receipt: stateReceipt ? `${ws.receiptPath} requestHash=${stateReceipt.requestHash}` : '', event: d.newEvents.join(',') || '', attendance: att ? `${att.path}=${att.doc.status}` : '',
        commit: succ.length === 1 ? { traceId: succ[0].traceId, transaction: succ[0].attempt.txn, writes: succ[0].attempt.commit.writes.map((w) => ({ path: w.path, kind: w.kind, precondition: w.precondition })) } : null, traceId: r.traceId },
      assertions,
    };
  },
  'POC-017'({ reqs, back, pre, post, actor, problems }) {
    const mine = common(reqs, actor, problems).filter((r) => r.op === WRITE_OP);
    if (mine.length !== 2) { problems.push(`EXPECTED_TWO_COMMIT_REQUESTS:${mine.length}`); return null; }
    if (!mine.every((r) => fullyRecorded(r.command))) { problems.push('COMMAND_NOT_FULLY_RECORDED'); return null; }
    const [a, b] = mine; const ca = a.command; const cb = b.command;
    // the case's own preconditions (plan §2.1): different operationIds, same target and expectedVersion, different intents
    if (!(ca.operationId !== cb.operationId && ca.targetId === cb.targetId && ca.expectedVersion === cb.expectedVersion && ca.intent.coverageChange !== cb.intent.coverageChange)) { problems.push('INCONCLUSIVE:CASE_PRECONDITIONS_NOT_MET'); return null; }
    const lv = leaveTarget(pre, post, ca);
    if (!lv || lv.pre.version !== ca.expectedVersion) { problems.push('INCONCLUSIVE:TARGET_NOT_AT_EXPECTED_VERSION'); return null; }
    bindCase('POC-017', mine, lv, problems);
    const conc = concurrencyOf(back, [a.traceId, b.traceId]);
    if (!conc.established) problems.push('INCONCLUSIVE:CONCURRENCY_NOT_ESTABLISHED');
    const all = reqs.map((x) => x.traceId);
    const succ = successfulCommits(back, all);
    const views = Object.fromEntries(mine.map((r) => [r.traceId, transactionsOf(back, r.traceId)]));
    const rp = (c) => `workspaces/${lv.ws}/operationReceipts/${c.operationId}`;
    const sums = Object.fromEntries(mine.map((r) => [r.traceId, attemptSummary(views[r.traceId], { receiptPath: rp(r.command), currentPath: lv.path })]));
    const winner = mine.filter((r) => r.status === 200 && r.body?.code === 'OK' && succ.filter((s) => s.traceId === r.traceId).length === 1);
    const ws = winner.length === 1 && succ.length === 1 ? checkCommitWriteSet({ attempt: succ[0].attempt, pre, command: winner[0].command, principalId: actor }) : { ok: false, problems: [] };
    for (const x of ws.problems) problems.push(`WRITE_SET:${x}`);
    // a VERSION_CONFLICT counts only if the LAST attempt read the current at a version ≠ expectedVersion inside its own
    // transaction, wrote nothing and rolled back; every earlier attempt of that request ended without a commit (aborted)
    const isConflict = (r) => {
      const s = sums[r.traceId]; const last = s[s.length - 1];
      return r.status === 409 && r.body?.code === 'VERSION_CONFLICT' && !!last && last.receiptRead === 'absent' && Number.isSafeInteger(last.currentVersionRead) && last.currentVersionRead !== r.command.expectedVersion
        && last.commit === 'none' && last.rolledBack === true && s.slice(0, -1).every((x) => x.commit !== 'ok') && s.length <= 6;
    };
    const conflicts = mine.filter(isConflict);
    const d = writeDeltas(pre, post, lv);
    const winIntent = winner[0]?.command.intent.coverageChange;
    const silentOverwrite = !(lv.post?.version === lv.pre.version + 1 && d.revisionDelta === 1 && winner.length === 1
      && lv.post?.coverageSegments?.[0]?.dayPart === (winIntent === 'AM_TO_FULL_DAY' ? 'FULL_DAY' : winIntent === 'AM_TO_PM' ? 'PM' : null) && lv.post?.lastOperationId === winner[0]?.command.operationId);
    const stray = strayWrites(back, all);
    const loser = mine.find((r) => r !== winner[0]);
    const assertions = {
      exactlyOneSuccessfulCommitInCase: succ.length === 1,
      winnerWriteSetExact: ws.ok,
      loserWroteNothing: !!loser && !views[loser.traceId].attempts.some((x) => x.commit?.ok),
      loserLastReadSawWinnerVersion: !!loser && sums[loser.traceId].at(-1)?.currentVersionRead === ws.currentVersion,
      everyAttemptInItsOwnTransaction: mine.every((r) => views[r.traceId].unboundTxnCalls.length === 0 && views[r.traceId].problems.length === 0),
      retriesWithinLimit: mine.every((r) => sums[r.traceId].length >= 1 && sums[r.traceId].length <= 6),
      noWriteOutsideTheCommit: stray.other === 0 && stray.unbound === 0,
      oneNewReceipt: d.receiptDelta === 1,
      reauthorizedFromAuthoritativeDocs: reauthorized(back, mine),
    };
    return {
      canonical: { successes: winner.length, conflicts: conflicts.length, silentOverwrite },
      evidence: { versionHistory: `v${lv.pre.version}->v${lv.post?.version}; revisions=${d.newRevisions.map((k) => k.split('/').pop()).join(',')}`, receiptCount: d.receiptDelta, conflicts: `count=${conflicts.length}` + conflicts.map((r) => `; ${r.traceId}:lastRead=v${sums[r.traceId].at(-1)?.currentVersionRead},attempts=${sums[r.traceId].length}`).join(''),
        concurrency: conc, attempts: sums, traceId: mine.map((r) => r.traceId).join(',') },
      assertions,
    };
  },
  'POC-018'({ reqs, back, pre, post, actor, problems }) {
    const mine = common(reqs, actor, problems).filter((r) => r.op === WRITE_OP).sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    if (mine.length !== 100) { problems.push(`EXPECTED_100_SUBMISSIONS:${mine.length}`); return null; }
    if (!mine.every((r) => fullyRecorded(r.command))) { problems.push('COMMAND_NOT_FULLY_RECORDED'); return null; }
    const sameCommand = new Set(mine.map((r) => stableJson({ ...r.command, clientCreatedAt: null }))).size === 1;
    if (!sameCommand) { problems.push('INCONCLUSIVE:SUBMISSIONS_DIFFER'); return null; }
    const c = mine[0].command; const lv = leaveTarget(pre, post, c);
    if (!lv) { problems.push('TARGET_NOT_RESOLVED_IN_PRE_STATE'); return null; }
    bindCase('POC-018', mine, lv, problems);
    const all = reqs.map((x) => x.traceId);
    const succ = successfulCommits(back, all);
    const ws = succ.length === 1 ? checkCommitWriteSet({ attempt: succ[0].attempt, pre, command: c, principalId: actor }) : { ok: false, problems: [`SUCCESSFUL_COMMITS:${succ.length}`] };
    for (const x of ws.problems) problems.push(`WRITE_SET:${x}`);
    const receiptPath = `workspaces/${lv.ws}/operationReceipts/${c.operationId}`;
    // the 99 replays: §8 step 3 — receipt found in a transaction, current NOT read, nothing committed, rolled back
    const replays = mine.filter((r) => r.traceId !== succ[0]?.traceId);
    const replayOk = replays.every((r) => { const s = attemptSummary(transactionsOf(back, r.traceId), { receiptPath, currentPath: lv.path }); const last = s.at(-1); return !!last && last.receiptRead === 'found' && last.currentVersionRead === null && last.commit === 'none' && last.rolledBack && s.every((x) => x.commit !== 'ok'); });
    const digests = new Set(mine.map((r) => r.receiptDigest));
    const d = writeDeltas(pre, post, lv); const stray = strayWrites(back, all);
    const stateReceipt = post[receiptPath] ?? null;
    const assertions = {
      allResponsesOk: mine.every((r) => r.status === 200 && r.body?.code === 'OK' && r.delivered === true),
      firstSubmissionCommitted: succ.length === 1 && succ[0].traceId === mine[0].traceId,
      commitWriteSetExact: ws.ok,
      replaysReadReceiptOnly: replayOk,
      allReceiptsEqualStateReceipt: digests.size === 1 && !!stateReceipt && [...digests][0] === receiptDigestOfDoc(stateReceipt),
      versionIncrementedOnce: lv.post?.version === lv.pre.version + 1,
      noWriteOutsideTheCommit: stray.other === 0 && stray.unbound === 0,
      reauthorizedFromAuthoritativeDocs: reauthorized(back, mine),
    };
    return {
      // uniqueReceiptIds: number of DISTINCT receipts (whole-receipt digest, not only the id) over the 100 responses
      canonical: { revisionDelta: d.revisionDelta, receiptCount: d.receiptDelta, uniqueReceiptIds: digests.size },
      evidence: { requestHash: stateReceipt?.requestHash ?? '', receiptId: stateReceipt ? receiptPath : '', revisionCount: d.newRevisions.length, submissions: mine.length, traceId: succ[0]?.traceId ?? null },
      assertions,
    };
  },
  'POC-021'({ reqs, back, pre, post, actor, problems }) {
    const mine = common(reqs, actor, problems);
    const commits = mine.filter((r) => r.op === WRITE_OP); const lookups = mine.filter((r) => r.op === RECEIPT_OP);
    if (commits.length < 1 || lookups.length < 1) { problems.push(`EXPECTED_COMMIT_AND_LOOKUP:${commits.length}/${lookups.length}`); return null; }
    const first = commits.slice().sort((x, y) => Date.parse(x.at) - Date.parse(y.at))[0];
    if (!fullyRecorded(first.command)) { problems.push('COMMAND_NOT_FULLY_RECORDED'); return null; }
    // the fault (plan §2.1): the API answered 200 with a receipt, the client never got it
    const lost = first.status === 200 && first.delivered === false && typeof first.receiptDigest === 'string';
    if (!lost) problems.push('INCONCLUSIVE:RESPONSE_LOSS_NOT_ESTABLISHED');
    const lv = leaveTarget(pre, post, first.command);
    if (!lv) { problems.push('TARGET_NOT_RESOLVED_IN_PRE_STATE'); return null; }
    bindCase('POC-021', commits, lv, problems);
    const op = first.command.operationId;
    const mineLookups = lookups.filter((r) => r.target?.operationId === op && r.claimedScope?.workspaceId === lv.ws && Date.parse(r.at) >= Date.parse(first.endedAt ?? first.at));
    const okLookup = mineLookups.find((r) => r.status === 200 && r.body?.code === 'OK' && r.delivered === true);
    const all = reqs.map((x) => x.traceId);
    const succ = successfulCommits(back, all);
    const ws = succ.length === 1 ? checkCommitWriteSet({ attempt: succ[0].attempt, pre, command: first.command, principalId: actor }) : { ok: false, problems: [`SUCCESSFUL_COMMITS:${succ.length}`] };
    for (const x of ws.problems) problems.push(`WRITE_SET:${x}`);
    const receiptPath = `workspaces/${lv.ws}/operationReceipts/${op}`; const stateReceipt = post[receiptPath] ?? null;
    const dp = post[`workspaces/${lv.ws}/derivedProgress/${op}`] ?? null;
    const d = writeDeltas(pre, post, lv); const stray = strayWrites(back, all);
    const otherOpCommits = commits.filter((r) => r.command?.operationId !== op);
    const receiptRecovered = lost && !!okLookup && okLookup.receiptDigest === first.receiptDigest && !!stateReceipt && okLookup.receiptDigest === receiptDigestOfDoc(stateReceipt);
    const duplicateCommit = succ.length !== 1 || otherOpCommits.length > 0 || d.revisionDelta !== 1;
    const assertions = {
      lookupTracesReadOnly: lookups.every((r) => readOnlyTrace(back, r.traceId)),
      lookupReceiptEqualsStateReceipt: !!okLookup && !!stateReceipt && stableJson(okLookup.body?.receipt) === stableJson(receiptProjection(stateReceipt)),
      // check 4: the immutable receipt and the separately read derived status are compared separately
      lookupDerivedStatusEqualsDerivedProgress: !!okLookup && !!dp && okLookup.body?.derivedStatus === dp.derivedStatus,
      commitInTheLostRequest: succ.length === 1 && succ[0].traceId === first.traceId,
      commitWriteSetExact: ws.ok,
      noWriteOutsideTheCommit: stray.other === 0 && stray.unbound === 0,
      reauthorizedFromAuthoritativeDocs: reauthorized(back, [first, ...mineLookups]),
    };
    return {
      canonical: { receiptRecovered, revisionDelta: d.revisionDelta, duplicateCommit },
      evidence: { receiptLookup: okLookup ? `${okLookup.traceId} digest=${okLookup.receiptDigest} lostResponseDigest=${first.receiptDigest}` : '', revisionCount: d.newRevisions.length, lostTraceId: first.traceId, digestScope: 'sha256(stableJson(receipt)) over the 11 receipt fields; derivedStatus compared separately' },
      assertions,
    };
  },
  'POC-001'({ reqs, back, post, actor, problems }) {
    const mine = common(reqs, actor, problems).filter((r) => r.op === 'attendanceSession.read');
    if (mine.length !== 1) { problems.push(`EXPECTED_ONE_SESSION_READ:${mine.length}`); return null; }
    const r = mine[0];
    const items = Array.isArray(r.body?.data?.entries) ? r.body.data.entries : [];
    const returnedIds = items.map((e) => e.attendanceEntryId);
    const located = returnedIds.map((id) => findDoc(post, 'entries', id));
    const wsSet = new Set(located.map((l) => (l.length === 1 ? wsOf(l[0][0]) : 'UNRESOLVED')));
    const sessionDoc = findDoc(post, 'attendanceSessions', r.target?.sessionId);
    const sessionWs = sessionDoc.length === 1 ? wsOf(sessionDoc[0][0]) : null;
    const otherIds = new Set(); for (const [ws, ids] of identifiersByWorkspace(post)) if (ws !== sessionWs) ids.forEach((i) => otherIds.add(i));
    const foreignStrings = strings(r.body).filter((s) => otherIds.has(s));
    const crossWorkspaceDisclosure = wsSet.has('UNRESOLVED') || [...wsSet].some((w) => w !== sessionWs) || foreignStrings.length > 0;
    const expectedEntries = Object.keys(post).filter((p) => sessionDoc.length === 1 && p.startsWith(`${sessionDoc[0][0]}/entries/`)).sort();
    return {
      canonical: { workspaceId: wsSet.size === 1 ? [...wsSet][0] : 'MIXED', returnedCount: items.length, crossWorkspaceDisclosure },
      evidence: { authzDecision: r.audit?.decision ?? null, returnedIds, workspaceId: sessionWs, traceId: r.traceId },
      assertions: {
        auditAllow: r.audit?.decision === 'allow',
        responseMatchesStateSession: stableJson(returnedIds.slice().sort()) === stableJson(expectedEntries.map((p) => p.split('/').pop())),
        noForeignIdentifierStrings: foreignStrings.length === 0,
        reauthorizedFromAuthoritativeDocs: reauthorized(back, [r]),
      },
    };
  },
  'POC-002'({ reqs, back, post, actor, problems }) {
    const mine = common(reqs, actor, problems);
    if (mine.length === 0) return null;
    const allIds = new Set(); for (const [, ids] of identifiersByWorkspace(post)) ids.forEach((i) => allIds.add(i));
    const extraKeys = mine.flatMap((r) => Object.keys(r.body || {}).filter((k) => !ALLOWED_DENY_KEYS.has(k)));
    const idStrings = mine.flatMap((r) => strings(r.body).filter((s) => allIds.has(s)));
    const codes = [...new Set(mine.map((r) => r.body?.code ?? `HTTP_${r.status}`))];
    const existing = mine.filter((r) => r.target && Object.values(r.target).some((id) => typeof id === 'string' && allIds.has(id)));
    const nonexistent = mine.filter((r) => !existing.includes(r));
    const shape = (r) => stableJson({ status: r.status, keys: Object.keys(r.body || {}).sort(), code: r.body?.code });
    return {
      canonical: { code: codes.length === 1 ? codes[0] : `MIXED:${codes.join('|')}`, identifyingFieldsReturned: extraKeys.length + idStrings.length },
      evidence: { authzDecision: [...new Set(mine.map((r) => r.audit?.decision))].join('|'), returnedFields: [...new Set(mine.flatMap((r) => Object.keys(r.body || {})))].sort(), traceId: mine.map((r) => r.traceId).join(',') },
      assertions: {
        allAuditedDeny: mine.every((r) => r.audit?.decision === 'deny'),
        existingTargetsRequested: existing.length > 0,
        nonexistentTargetRequested: nonexistent.length > 0,
        indistinguishableFromNonexistent: existing.length > 0 && nonexistent.length > 0 && new Set([...existing, ...nonexistent].map(shape)).size === 1,
        noDataReadBelowTarget: mine.every((r) => !backendReads(back, r.traceId).some((b) => /\/entries(\?|$)/.test(b.path))),
      },
    };
  },
  'POC-008'({ reqs, back, post, actor, problems }) {
    const mine = common(reqs, actor, problems);
    const sum = mine.filter((r) => r.op === 'attendanceSummary.read'); const ses = mine.filter((r) => r.op === 'attendanceSession.read');
    if (sum.length !== 1 || ses.length !== 1) { problems.push(`EXPECTED_ONE_SUMMARY_AND_ONE_SESSION:${sum.length}/${ses.length}`); return null; }
    const recount = (statuses) => { const c = { P: 0, R: 0, N: 0, U: 0 }; for (const s of statuses) c[s] = (c[s] ?? 0) + 1; return { ...c, total: statuses.length, registered: c.P + c.R + c.N, arrived: c.P + c.R }; };
    const sesDoc = findDoc(post, 'attendanceSessions', sum[0].target?.sessionId);
    const stateStatuses = sesDoc.length === 1 ? Object.entries(post).filter(([p]) => p.startsWith(`${sesDoc[0][0]}/entries/`)).map(([, d]) => d.status) : [];
    const fromState = recount(stateStatuses);
    const fromTrace = recount((ses[0].body?.data?.entries || []).map((e) => e.status));
    const api = sum[0].body?.data?.counts ?? null;
    const reads = backendReads(back, sum[0].traceId);
    const k = ['P', 'R', 'N', 'U', 'total', 'registered', 'arrived'];
    const eqCounts = (x, y) => !!x && !!y && k.every((f) => x[f] === y[f]);
    const assertions = {
      apiSummaryEqualsStateRecount: eqCounts(api, fromState),
      sessionResponseEqualsStateRecount: eqCounts(fromTrace, fromState),
      apiTotalIsSumOfPrimaryStates: !!api && api.total === api.P + api.R + api.N + api.U,
      apiRegisteredIsPRN: !!api && api.registered === api.P + api.R + api.N,
      apiArrivedIsPR: !!api && api.arrived === api.P + api.R,
      primaryStatesOnlyPRNU: stateStatuses.every((s) => ['P', 'R', 'N', 'U'].includes(s)),
      auditAllow: sum[0].audit?.decision === 'allow' && ses[0].audit?.decision === 'allow',
      reauthorizedFromAuthoritativeDocs: reauthorized(back, [...sum, ...ses]),
    };
    return {
      canonical: { counts: api ? Object.fromEntries(k.map((f) => [f, api[f]])) : null },
      evidence: { queryCount: reads.length, assertions: Object.entries(assertions).map(([n, v]) => `${n}=${v}`).join(';'), traceId: sum[0].traceId },
      assertions,
    };
  },
  'POC-009'({ reqs, back, pre, post, actor, problems }) {
    const mine = common(reqs, actor, problems);
    const one = (op) => { const x = mine.filter((r) => r.op === op); if (x.length < 1) problems.push(`MISSING_REQUEST:${op}`); return x[0] ?? null; };
    const en = one('attendanceEntry.read'); const lv = one('leaveRecord.read'); const ap = one('leaveApplicability.read'); const is = one('trackingIssue.read');
    if (!en || !lv || !ap) return null;
    const entId = en.target?.attendanceEntryId; const lvId = lv.target?.leaveRecordId;
    const enPre = findDoc(pre, 'entries', entId)[0]?.[1] ?? null; const enPost = findDoc(post, 'entries', entId)[0]?.[1] ?? null;
    const lvPre = findDoc(pre, 'leaveRecords', lvId)[0]?.[1] ?? null; const lvPost = findDoc(post, 'leaveRecords', lvId)[0]?.[1] ?? null;
    const diff = unchanged(pre, post);
    const respEntry = en.body?.data ?? null; const respLeave = lv.body?.data ?? null;
    const canonical = {
      attendance: respEntry?.status ?? null,
      leaveVersion: respLeave?.version ?? null,
      autoRewrite: !diff.none,
      // applicability / pendingPeriods are NOT observable in this batch: the applicability read is refused
      // for the fixture actor (gap G-1) and no trusted period calendar exists (gap G-4). Left absent.
    };
    const assertions = {
      entryResponseMatchesState: !!respEntry && !!enPost && respEntry.status === enPost.status && respEntry.version === enPost.version,
      leaveResponseMatchesState: !!respLeave && !!lvPost && respLeave.version === lvPost.version && stableJson(respLeave.coverageSegments) === stableJson(lvPost.coverageSegments),
      entryUnchangedPrePost: !!enPre && stableJson(enPre) === stableJson(enPost),
      leaveUnchangedPrePost: !!lvPre && stableJson(lvPre) === stableJson(lvPost),
      noNonAuditDocumentAddedOrRemoved: diff.added.length === 0 && diff.removed.length === 0,
      applicabilityRequestRefused: ap.body?.code === 'FORBIDDEN' && ap.audit?.reasonCode === 'CAPABILITY_NOT_GRANTED',
      issueReadAllowed: !!is && is.body?.code === 'OK',
      reauthorizedFromAuthoritativeDocs: reauthorized(back, mine),
    };
    return {
      canonical,
      evidence: {
        versions: { attendanceEntry: { pre: enPre?.version ?? null, response: respEntry?.version ?? null, post: enPost?.version ?? null }, leaveRecord: { pre: lvPre?.version ?? null, response: respLeave?.version ?? null, post: lvPost?.version ?? null } },
        coverageResult: { applicabilityResponse: ap.body?.code ?? null, applicabilityAuditReason: ap.audit?.reasonCode ?? null, coverageSegments: respLeave?.coverageSegments ?? null, issueQuestionPresent: typeof is?.body?.data?.question === 'string' },
        entryHash: enPost ? sha256Hex(stableJson(enPost)) : null,
        responseEntryHash: respEntry ? sha256Hex(stableJson(respEntry)) : null,
        stateDiff: diff,
      },
      assertions,
    };
  },
};

/** @returns { canonical, evidence, assertions, problems } — canonical null when not computable. */
export function observe({ testId, actor, front, back, pre, post }) {
  const problems = [];
  const fn = OBSERVERS[testId];
  if (!fn) return { canonical: null, evidence: null, assertions: {}, problems: [`NO_OBSERVER:${testId}`] };
  if (!Array.isArray(front) || front.length === 0) return { canonical: null, evidence: null, assertions: {}, problems: ['NO_TRACE'] };
  const reqs = joinRequests(front, post);
  const out = fn({ reqs, back, pre, post, actor, problems }) || { canonical: null, evidence: null, assertions: {} };
  for (const [n, v] of Object.entries(out.assertions || {})) if (v !== true) problems.push(`ASSERTION_FAILED:${n}`);
  return { ...out, problems };
}
