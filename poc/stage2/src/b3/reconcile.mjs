/** Reconciliation for READ cases (TRUSTED TOOLCHAIN, B3a). Plan v0.3 §6.3.
 *  Every state change must be explained by the controlled API's own traffic:
 *   - front entries have unique traceIds; each front request that reached the API has EXACTLY one new audit
 *     record with the same traceId whose authUid / principal / action / resource / decision / reason match
 *     that request; audit records never change once written;
 *   - every back-proxy request carries a front traceId; the only backend writes are that trace's audit write;
 *   - front/back traffic happens only inside the case window; the Runner does nothing inside it;
 *   - the attestation marker is unchanged; nothing else changes. */
import { stableJson } from '../stable.mjs';
import { OPERATIONS } from '../authz.mjs';

const AUDIT_PATH = /^(workspaces\/[^/]+\/auditLog|auditLogUnscoped)\/[^/]+$/;
const isAudit = (p) => AUDIT_PATH.test(p);
const docPathOf = (backPath) => backPath.replace(/^.*\/documents\/?/, '');
const READ_ONLY_POST = [/:runQuery$/, /:listCollectionIds$/, /\/accounts:lookup$/];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const CLASS_SCOPE_RE = /^workspaces\/([^/]+)\/classes\/([^/]+)\//;
/** B3A-N6: the documents the API's target lookup can return for (op, target) — a collection-group query on
 *  def.collection with def.idField == id — recomputed from the exported pre-state (trusted toolchain). */
function targetCandidates(pre, op, target) {
  const def = typeof op === 'string' && Object.hasOwn(OPERATIONS, op) ? OPERATIONS[op] : null;
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
    const expectDecision = f.status === 200 ? 'allow' : f.status === 403 ? 'deny' : null;
    if (expectDecision && a.decision !== expectDecision) why.push('decision');
    if (f.status === 503 && !a.outcome) why.push('outcome');
    if ((a.decision === 'allow') !== (a.reasonCode === 'OK')) why.push('reasonCode');
    // B3A-N6: null fields follow the API's order (token → binding/principal → target); an allow has them all
    const has = (v) => v !== null && v !== undefined;
    if (a.decision === 'allow' && !(has(a.authUid) && has(a.principalId) && has(a.resourceRef) && has(a.workspaceId))) why.push('allowFieldsMissing');
    if (!has(a.authUid) && (has(a.principalId) || has(a.resourceRef))) why.push('nullOrder');
    if (!has(a.principalId) && has(a.resourceRef)) why.push('nullOrder');
    // B3A-N6: resourceRef is the FULL path of the unique document the target lookup returns
    if (has(a.resourceRef)) {
      const cands = targetCandidates(pre, f.requestBody?.op, f.requestBody?.target);
      if (!Object.hasOwn(pre, a.resourceRef) || !cands || cands.length !== 1 || cands[0] !== a.resourceRef) why.push('resourceRef');
    }
    if (a.workspaceId !== undefined && !a.path.startsWith(`workspaces/${a.workspaceId}/`)) why.push('workspace');
    // B3A-N6: claimedScope agrees with the decision (allow ⇒ equals the path scope; mismatch ⇒ differs; missing ⇒ absent)
    const cs = f.requestBody?.claimedScope; const csOk = isObj(cs) && typeof cs.workspaceId === 'string' && typeof cs.classId === 'string';
    const ps = has(a.resourceRef) ? CLASS_SCOPE_RE.exec(a.resourceRef) : null;
    if (a.decision === 'allow' && !(csOk && ps && cs.workspaceId === ps[1] && cs.classId === ps[2] && a.workspaceId === ps[1])) why.push('claimedScope');
    if (a.reasonCode === 'SCOPE_CLAIM_MISMATCH' && !(csOk && ps && !(cs.workspaceId === ps[1] && cs.classId === ps[2]))) why.push('claimedScope');
    if (a.reasonCode === 'SCOPE_CLAIM_MISSING' && csOk) why.push('claimedScope');
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
    const dp = docPathOf(b.path);
    if (b.method === 'PATCH' && isAudit(dp)) { if (!auditWrites.has(b.traceId)) auditWrites.set(b.traceId, []); auditWrites.get(b.traceId).push({ path: dp, status: b.status }); }
    else nonAuditBackendWrites += 1;
  }
  for (const [tid, ws] of auditWrites) if (ws.length !== 1) p('AUDIT_UNRECONCILED', `${ws.length} audit writes for ${tid}`);
  // B3A-N6: every new audit document is the one successful back PATCH of its own trace, at the same path
  for (const [tid, list] of auditsByTrace) {
    if (list.length !== 1) continue;
    const ws = auditWrites.get(tid) || [];
    if (ws.length !== 1 || ws[0].path !== list[0].path || ws[0].status !== 200) p('AUDIT_UNRECONCILED', `${tid} audit write not bound to its PATCH`);
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
    if (stableJson(pre[k]) !== stableJson(post[k])) unexplainedChanges += 1;
  }
  if (ownershipMarkerPath && stableJson(pre[ownershipMarkerPath]) !== stableJson(post[ownershipMarkerPath])) unexplainedChanges += 1;
  if (unexplainedChanges) p('STATE_CHANGE_UNEXPLAINED', String(unexplainedChanges));
  return {
    counts: { frontRequests: fronts.length, auditAdded: added.length, auditMatched, auditModifiedOrDeleted, nonceMarkerUnchanged, unexplainedChanges, unattributedBackendRequests, nonAuditBackendWrites, duplicateTraceIds, phaseViolations },
    problems,
  };
}
