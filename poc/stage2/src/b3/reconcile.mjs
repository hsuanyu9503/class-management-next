/** Reconciliation for READ cases (TRUSTED TOOLCHAIN, B3a). Plan v0.3 §6.3.
 *  Every state change must be explained by the controlled API's own traffic:
 *   - front entries have unique traceIds; each front request that reached the API has EXACTLY one new audit
 *     record with the same traceId whose authUid / principal / action / resource / decision / reason match
 *     that request; audit records never change once written;
 *   - every back-proxy request carries a front traceId; the only backend writes are that trace's audit write;
 *   - front/back traffic happens only inside the case window; the Runner does nothing inside it;
 *   - the attestation marker is unchanged; nothing else changes. */
import { stableJson } from '../stable.mjs';

const AUDIT_PATH = /^(workspaces\/[^/]+\/auditLog|auditLogUnscoped)\/[^/]+$/;
const isAudit = (p) => AUDIT_PATH.test(p);
const docPathOf = (backPath) => backPath.replace(/^.*\/documents\/?/, '');
const READ_ONLY_POST = [/:runQuery$/, /:listCollectionIds$/, /\/accounts:lookup$/];

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
    if (a.resourceRef !== null && a.resourceRef !== undefined) {
      const tv = Object.values(f.requestBody?.target || {})[0];
      if (!Object.hasOwn(pre, a.resourceRef) || a.resourceRef.split('/').pop() !== tv) why.push('resourceRef');
    }
    if (a.workspaceId !== undefined && !a.path.startsWith(`workspaces/${a.workspaceId}/`)) why.push('workspace');
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
    if (b.method === 'PATCH' && isAudit(dp)) auditWrites.set(b.traceId, (auditWrites.get(b.traceId) || 0) + 1);
    else nonAuditBackendWrites += 1;
  }
  for (const [tid, n] of auditWrites) if (n !== 1) p('AUDIT_UNRECONCILED', `${n} audit writes for ${tid}`);
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
