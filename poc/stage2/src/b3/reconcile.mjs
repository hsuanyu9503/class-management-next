/** Reconciliation for READ cases (TRUSTED TOOLCHAIN, B3a). Plan v0.3 §6.3.
 *  Every state change must be explained by the controlled API's own traffic:
 *   - front entries have unique traceIds; each front request that reached the API has EXACTLY one new audit
 *     record with the same traceId whose authUid / principal / action / resource / decision / reason match
 *     that request; audit records never change once written;
 *   - every back-proxy request carries a front traceId; the only backend writes are that trace's audit write,
 *     and every new audit document is exactly that PATCH — same trace, same path, status 200 (B3A-N6) — a
 *     create-only write whose decoded fields equal the exported record field by field (PR1-REV001);
 *   - resourceRef is the full path of the unique target document; null fields follow the API's order;
 *     claimedScope agrees with the decision (B3A-N6);
 *   - front/back traffic happens only inside the case window; the Runner does nothing inside it;
 *   - the attestation marker is unchanged; nothing else changes.
 *  B4 (plan S2B2-B4-PLAN v0.2 §3.2; implementation-review checks 2–3) — controlled writes:
 *   - the ONLY other backend writes are Firestore transaction commits whose transaction id the Emulator handed to
 *     THE SAME request (beginTransaction response in the back trace); begin / batchGet / rollback change nothing;
 *   - every non-audit state change is explained by a successful bound commit: same full path, kind `update`, and
 *     decoded fields equal to the exported document; every successful write is visible in the post-state;
 *   - the audit of an authorized commit states operationId, requestHash, attempts and transactionRef, and each is
 *     reconciled: requestHash recomputed from the front command, attempts = transactions begun, transactionRef =
 *     the transaction of the request's successful commit (taken from the Emulator, never from the API), outcome
 *     consistent with the response and the commits;
 *   - a refused commit made no transaction call and read no receipt (§6.5); a receipt query made no transaction
 *     call and no write (§3.1.2). */
import { stableJson } from '../stable.mjs';
import { OPERATIONS, WRITE_OPERATIONS, RECEIPT_OPERATION, POLICY_VERSION as AUTHZ_POLICY_VERSION } from '../authz.mjs';
import { MASK } from '../mask.mjs';
import { transactionsOf, classifyBack, judgeRequestHash, tEnd } from '../b4/commit-trace.mjs';

const WRITE_OUTCOMES = Object.freeze({
  COMMITTED: { status: 200, code: 'OK', commits: 1 }, REPLAYED: { status: 200, code: 'OK', commits: 0 },
  VERSION_CONFLICT: { status: 409, code: 'VERSION_CONFLICT', commits: 0 }, REUSE_MISMATCH: { status: 409, code: 'OPERATION_REUSE_MISMATCH', commits: 0 },
  TRANSACTION_CONTENTION: { status: 503, code: 'UNAVAILABLE', commits: 0 }, INTENT_NOT_APPLICABLE: { status: 400, code: 'INVALID_INPUT', commits: 0 },
});

const AUDIT_PATH = /^(workspaces\/[^/]+\/auditLog|auditLogUnscoped)\/[^/]+$/;
const isAudit = (p) => AUDIT_PATH.test(p);
const docPathOf = (backPath) => backPath.replace(/^.*\/documents\/?/, '');
const READ_ONLY_POST = [/:runQuery$/, /:listCollectionIds$/, /\/accounts:lookup$/];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const CLASS_SCOPE_RE = /^workspaces\/([^/]+)\/classes\/([^/]+)\//;
/** PR1-REV001: fields an audit document may hold (the API's writeAudit) and the ones it always holds. */
const AUDIT_FIELDS = new Set(['auditId', 'at', 'authUid', 'principalId', 'action', 'resourceRef', 'decision', 'reasonCode', 'policyVersion', 'traceId', 'outcome', 'workspaceId', 'operationId', 'requestHash', 'attempts', 'transactionRef']);
const INTEGER_AUDIT_FIELDS = new Set(['attempts']);
const AUDIT_REQUIRED = ['auditId', 'at', 'authUid', 'principalId', 'action', 'resourceRef', 'decision', 'reasonCode', 'policyVersion', 'traceId'];
/** Strict decoding of the audit PATCH body: exactly { fields }, only AUDIT_FIELDS, each value exactly one of
 *  { stringValue: string } | { nullValue: null }. Masking projection: the trace is masked in its Firestore
 *  encoding, the exported state after decoding, by the SAME masker — so a field whose encoding is exactly the
 *  mask string decodes to that mask string and is compared like any other value (never skipped).
 *  Returns { doc } or { error }. */
function decodeAuditWrite(body) {
  if (!isObj(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'fields') || !isObj(body.fields)) return { error: 'bodyShape' };
  const doc = {};
  for (const [k, v] of Object.entries(body.fields)) {
    if (!AUDIT_FIELDS.has(k)) return { error: `unknownField:${k}` };
    if (v === MASK) { doc[k] = MASK; continue; }
    if (!isObj(v) || Object.keys(v).length !== 1) return { error: `valueShape:${k}` };
    if (Object.hasOwn(v, 'stringValue') && typeof v.stringValue === 'string' && !INTEGER_AUDIT_FIELDS.has(k)) doc[k] = v.stringValue;
    else if (Object.hasOwn(v, 'nullValue') && v.nullValue === null) doc[k] = null;
    else if (INTEGER_AUDIT_FIELDS.has(k) && Object.hasOwn(v, 'integerValue') && /^[0-9]{1,6}$/.test(v.integerValue)) doc[k] = Number(v.integerValue);
    else return { error: `valueType:${k}` };
  }
  for (const k of AUDIT_REQUIRED) if (!Object.hasOwn(doc, k)) return { error: `missingField:${k}` };
  return { doc };
}
/** PR1-REV001: the write must be a CREATE: exactly one query parameter currentDocument.exists=false
 *  (no updateMask / mask / other parameters). A trace without a structured query cannot show it → refused. */
const isCreateOnly = (query) => Array.isArray(query) && query.length === 1 && isObj(query[0]) && Object.keys(query[0]).length === 1 && query[0]['currentDocument.exists'] === 'false';
/** B3A-N6: the documents the API's target lookup can return for (op, target) — a collection-group query on
 *  def.collection with def.idField == id — recomputed from the exported pre-state (trusted toolchain). */
function targetCandidates(pre, op, target) {
  const def = typeof op !== 'string' ? null : Object.hasOwn(OPERATIONS, op) ? OPERATIONS[op] : Object.hasOwn(WRITE_OPERATIONS, op) ? WRITE_OPERATIONS[op] : null;
  if (!def || !isObj(target) || !Object.hasOwn(target, def.idField)) return null;
  const id = target[def.idField];
  return Object.keys(pre).filter((k) => { const seg = k.split('/'); return seg.length >= 2 && seg[seg.length - 2] === def.collection && isObj(pre[k]) && pre[k][def.idField] === id; });
}

export function reconcile({ front, back, pre, post, runnerLog, caseWindow, markerPath, expectedMarker, ownershipMarkerPath }) {
  const problems = []; const p = (code, d) => problems.push(`${code}${d ? ':' + d : ''}`);
  const fronts = front.filter((e) => e.role === 'front');
  const ids = fronts.map((e) => e.traceId);
  const duplicateTraceIds = ids.length - new Set(ids).size;
  if (duplicateTraceIds) p('DUPLICATE_TRACE_ID', String(duplicateTraceIds));
  const byTrace = new Map(fronts.map((e) => [e.traceId, e]));

  // audit records
  const added = Object.keys(post).filter((k) => isAudit(k) && !Object.hasOwn(pre, k));
  let auditModifiedOrDeleted = 0;
  for (const k of Object.keys(pre)) if (isAudit(k) && (!Object.hasOwn(post, k) || stableJson(pre[k]) !== stableJson(post[k]))) auditModifiedOrDeleted += 1;
  if (auditModifiedOrDeleted) p('AUDIT_MODIFIED_OR_DELETED', String(auditModifiedOrDeleted));
  const auditsByTrace = new Map();
  for (const k of added) { const a = post[k]; if (!auditsByTrace.has(a.traceId)) auditsByTrace.set(a.traceId, []); auditsByTrace.get(a.traceId).push({ path: k, ...a }); }
  let auditMatched = 0;
  for (const [tid, list] of auditsByTrace) {
    const f = byTrace.get(tid);
    if (!f) { p('AUDIT_UNRECONCILED', `no front request for ${tid}`); continue; }
    if (list.length !== 1) { p('AUDIT_UNRECONCILED', `${list.length} audits for ${tid}`); continue; }
    const a = list[0]; const why = [];
    const op = typeof f.requestBody?.op === 'string' ? f.requestBody.op : null;
    if ((a.action ?? null) !== op) why.push('action');
    const uid = f.authorizationRef?.claimedAuthUid ?? null;
    if (a.authUid !== null && a.authUid !== uid) why.push('authUid');
    if (a.principalId !== null) { const b = pre[`authBindings/${a.authUid}`]; if (!b || b.principalId !== a.principalId) why.push('principal'); }
    // B4: 409 / 400 come only AFTER authorization passed (§6.6, §8)
    const expectDecision = f.status === 200 || f.status === 409 || f.status === 400 ? 'allow' : f.status === 403 ? 'deny' : null;
    const isReceiptOp = op === RECEIPT_OPERATION; const isWriteOp = typeof op === 'string' && Object.hasOwn(WRITE_OPERATIONS, op);
    if (expectDecision && a.decision !== expectDecision) why.push('decision');
    if (f.status === 503 && !a.outcome) why.push('outcome');
    if ((a.decision === 'allow') !== (a.reasonCode === 'OK')) why.push('reasonCode');
    // B3A-N6: null fields follow the API's order (token → binding/principal → target); an allow has them all
    const has = (v) => v !== null && v !== undefined;
    if (a.decision === 'allow' && !(has(a.authUid) && has(a.principalId) && has(a.resourceRef) && has(a.workspaceId))) why.push('allowFieldsMissing');
    if (!has(a.authUid) && (has(a.principalId) || has(a.resourceRef))) why.push('nullOrder');
    if (!has(a.principalId) && has(a.resourceRef)) why.push('nullOrder');
    // B3A-N6: resourceRef is the FULL path of the unique document the target lookup returns
    if (has(a.resourceRef) && isReceiptOp) {
      // B4: a receipt is addressed by (claimed workspace, operationId) and may have been created inside this case
      const cs0 = f.requestBody?.claimedScope; const t0 = f.requestBody?.target;
      const rd = post[a.resourceRef];
      if (!isObj(cs0) || !isObj(t0) || a.resourceRef !== `workspaces/${cs0.workspaceId}/operationReceipts/${t0.operationId}` || !isObj(rd) || rd.operationId !== t0.operationId) why.push('resourceRef');
      else if (a.decision === 'allow' && rd.principalId !== a.principalId) why.push('receiptOwner');
    } else if (has(a.resourceRef)) {
      const cands = targetCandidates(pre, f.requestBody?.op, f.requestBody?.target);
      if (!Object.hasOwn(pre, a.resourceRef) || !cands || cands.length !== 1 || cands[0] !== a.resourceRef) why.push('resourceRef');
    }
    if (a.workspaceId !== undefined && !a.path.startsWith(`workspaces/${a.workspaceId}/`)) why.push('workspace');
    // B3A-N6: claimedScope agrees with the decision (allow ⇒ equals the path scope; mismatch ⇒ differs; missing ⇒ absent)
    const cs = f.requestBody?.claimedScope; const csOk = isObj(cs) && typeof cs.workspaceId === 'string' && typeof cs.classId === 'string';
    const ps = has(a.resourceRef) ? CLASS_SCOPE_RE.exec(a.resourceRef) : null;
    if (isReceiptOp) {
      if (a.decision === 'allow' && !(isObj(cs) && a.workspaceId === cs.workspaceId)) why.push('claimedScope');
    } else {
      if (a.decision === 'allow' && !(csOk && ps && cs.workspaceId === ps[1] && cs.classId === ps[2] && a.workspaceId === ps[1])) why.push('claimedScope');
      if (a.reasonCode === 'SCOPE_CLAIM_MISMATCH' && !(csOk && ps && !(cs.workspaceId === ps[1] && cs.classId === ps[2]))) why.push('claimedScope');
      if (a.reasonCode === 'SCOPE_CLAIM_MISSING' && csOk) why.push('claimedScope');
    }
    // B4: what the API claims about a commit is checked against the TRUSTED traces, field by field
    const view = transactionsOf(back, tid);
    const okCommits = view.attempts.filter((x) => x.commit?.ok);
    const WRITE_KEYS = ['operationId', 'requestHash', 'attempts', 'transactionRef'];
    if (isWriteOp && a.decision === 'allow' && !String(a.outcome || '').startsWith('INVALID_INPUT:') && a.outcome !== 'BACKEND_UNAVAILABLE' && !(a.reasonCode && a.reasonCode !== 'OK')) {
      const cmd = f.requestBody?.command;
      if (!WRITE_KEYS.every((k) => Object.hasOwn(a, k))) why.push('writeFieldsMissing');
      else {
        if (!isObj(cmd) || a.operationId !== cmd.operationId) why.push('operationId');
        const ps2 = has(a.resourceRef) ? CLASS_SCOPE_RE.exec(a.resourceRef) : null;
        if (!isObj(cmd) || !ps2 || a.requestHash !== judgeRequestHash({ command: cmd, workspaceId: ps2[1], classId: ps2[2], principalId: a.principalId })) why.push('requestHash');
        if (a.attempts !== view.attempts.length) why.push('attempts');
        const expRef = okCommits.length === 1 ? okCommits[0].txn : null;
        if (a.transactionRef !== expRef) why.push('transactionRef');
        const rule = Object.hasOwn(WRITE_OUTCOMES, a.outcome) ? WRITE_OUTCOMES[a.outcome] : null;
        if (!rule || f.status !== rule.status || f.responseBody?.code !== rule.code || okCommits.length !== rule.commits) why.push('outcome');
      }
    } else if (isWriteOp || isReceiptOp) {
      // refused / invalid commits and every receipt query: no transaction, no write; a refused commit read no receipt (§6.5)
      if (WRITE_KEYS.some((k) => Object.hasOwn(a, k)) && !(isWriteOp && a.decision === 'allow')) why.push('writeFieldsOnNonCommit');
      if (view.attempts.length || view.unboundTxnCalls.length || view.otherWrites.length) why.push('transactionOrWriteWithoutCommit');
      if (isWriteOp && a.decision !== 'allow' && view.plainReads.some((r) => /\/operationReceipts(\/|$)/.test(r.docPath || '') || /operationReceipts/.test(JSON.stringify(r.e.requestBody || '')))) why.push('receiptReadBeforeAuthorization');
    }
    if (why.length) p('AUDIT_UNRECONCILED', `${tid} ${why.join(',')}`); else auditMatched += 1;
  }
  const reached = fronts.filter((e) => e.status !== 502);
  for (const f of reached) if (!auditsByTrace.has(f.traceId)) p('AUDIT_UNRECONCILED', `missing audit for ${f.traceId}`);

  // back traffic
  let unattributedBackendRequests = 0; let nonAuditBackendWrites = 0; const auditWrites = new Map();
  for (const b of back.filter((x) => x.role === 'back')) {
    if (!b.traceId || !byTrace.has(b.traceId)) { unattributedBackendRequests += 1; continue; }
    const isRead = b.method === 'GET' || (b.method === 'POST' && READ_ONLY_POST.some((re) => re.test(b.path)));
    if (isRead) continue;
    const cls = classifyBack(b).cls;
    if (cls === 'begin' || cls === 'batchGet' || cls === 'rollback' || cls === 'commit') continue;   // B4: transaction calls, reconciled below
    const dp = docPathOf(b.path);
    if (b.method === 'PATCH' && isAudit(dp)) { if (!auditWrites.has(b.traceId)) auditWrites.set(b.traceId, []); auditWrites.get(b.traceId).push({ path: dp, status: b.status, query: b.query, body: b.requestBody }); }
    else nonAuditBackendWrites += 1;
  }
  // B4: successful commits — bound to a transaction of the same request; their writes explain the state changes
  const explained = new Map(); let commitWrites = 0; let unboundTransactionCalls = 0; let commitWriteProblems = 0;
  for (const tid of byTrace.keys()) {
    const v = transactionsOf(back, tid);
    unboundTransactionCalls += v.unboundTxnCalls.length + v.problems.length;
    for (const x of v.attempts) {
      if (!x.commit?.ok) continue;
      if (!Array.isArray(x.commit.writes) || x.commit.writes.length === 0) { commitWriteProblems += 1; continue; }
      for (const w of x.commit.writes) {
        commitWrites += 1;
        if (w.kind !== 'update' || typeof w.path !== 'string' || isAudit(w.path) || w.path.startsWith('_') || w.hasMask || w.hasTransforms || (w.unknownKeys || []).length || !isObj(w.fields)) { commitWriteProblems += 1; continue; }
        const prev = explained.get(w.path);
        if (!prev || tEnd(x.commit.e) > prev.end) explained.set(w.path, { end: tEnd(x.commit.e), fields: w.fields });
      }
    }
  }
  if (unboundTransactionCalls) p('TRANSACTION_UNBOUND', String(unboundTransactionCalls));
  if (commitWriteProblems) p('COMMIT_WRITE_INVALID', String(commitWriteProblems));
  let commitWritesNotInState = 0;
  for (const [path, w] of explained) if (stableJson(post[path]) !== stableJson(w.fields)) commitWritesNotInState += 1;
  if (commitWritesNotInState) p('COMMIT_WRITE_NOT_IN_STATE', String(commitWritesNotInState));
  for (const [tid, ws] of auditWrites) if (ws.length !== 1) p('AUDIT_UNRECONCILED', `${ws.length} audit writes for ${tid}`);
  // B3A-N6: every new audit document is the one successful back PATCH of its own trace, at the same path
  for (const [tid, list] of auditsByTrace) {
    if (list.length !== 1) continue;
    const ws = auditWrites.get(tid) || [];
    if (ws.length !== 1 || ws[0].path !== list[0].path || ws[0].status !== 200) { p('AUDIT_UNRECONCILED', `${tid} audit write not bound to its PATCH`); continue; }
    // PR1-REV001: what the PATCH wrote must BE the new audit document (create-only, same content, field by field)
    if (!isCreateOnly(ws[0].query)) p('AUDIT_UNRECONCILED', `${tid} audit write is not an observable create (currentDocument.exists=false)`);
    const dec = decodeAuditWrite(ws[0].body);
    if (dec.error) { p('AUDIT_UNRECONCILED', `${tid} audit write body ${dec.error}`); continue; }
    const stored = post[list[0].path]; const why = [];
    if (!isObj(stored)) why.push('stored');
    else for (const k of new Set([...Object.keys(dec.doc), ...Object.keys(stored)])) if (Object.hasOwn(dec.doc, k) !== Object.hasOwn(stored, k) || stableJson(dec.doc[k]) !== stableJson(stored[k])) why.push(k);
    if (dec.doc.auditId !== list[0].path.split('/').pop()) why.push('auditIdPath');
    if (dec.doc.traceId !== tid) why.push('traceIdTrace');
    if (dec.doc.policyVersion !== AUTHZ_POLICY_VERSION) why.push('policyVersion');
    if (why.length) p('AUDIT_UNRECONCILED', `${tid} audit write content differs from the exported record: ${why.join(',')}`);
  }
  if (unattributedBackendRequests) p('UNATTRIBUTED_BACKEND_TRAFFIC', String(unattributedBackendRequests));
  if (nonAuditBackendWrites) p('NON_AUDIT_BACKEND_WRITE', String(nonAuditBackendWrites));

  // phases
  let phaseViolations = 0;
  const inWindow = (at) => { const t = Date.parse(at); return t >= caseWindow.start && t <= caseWindow.end; };
  for (const e of [...fronts, ...back.filter((x) => x.role === 'back')]) if (!inWindow(e.at)) phaseViolations += 1;
  for (const r of runnerLog) if (r.channel === 'runner' && inWindow(r.at) && r.phase !== 'case-control') phaseViolations += 1;
  if (phaseViolations) p('PHASE_VIOLATION', String(phaseViolations));

  // marker + all other documents
  const nonceMarkerUnchanged = stableJson(pre[markerPath]) === stableJson(expectedMarker) && stableJson(post[markerPath]) === stableJson(expectedMarker);
  if (!nonceMarkerUnchanged) p('NONCE_MISMATCH');
  let unexplainedChanges = 0;
  const keys = new Set([...Object.keys(pre), ...Object.keys(post)]);
  for (const k of keys) {
    if (isAudit(k) || k === markerPath || k === ownershipMarkerPath) continue;
    if (stableJson(pre[k]) !== stableJson(post[k]) && !(explained.has(k) && stableJson(post[k]) === stableJson(explained.get(k).fields))) unexplainedChanges += 1;
  }
  if (ownershipMarkerPath && stableJson(pre[ownershipMarkerPath]) !== stableJson(post[ownershipMarkerPath])) unexplainedChanges += 1;
  if (unexplainedChanges) p('STATE_CHANGE_UNEXPLAINED', String(unexplainedChanges));
  return {
    counts: { frontRequests: fronts.length, auditAdded: added.length, auditMatched, auditModifiedOrDeleted, nonceMarkerUnchanged, unexplainedChanges, unattributedBackendRequests, nonAuditBackendWrites, duplicateTraceIds, phaseViolations, commitWrites, commitWritesExplained: explained.size, unboundTransactionCalls },
    problems,
  };
}
