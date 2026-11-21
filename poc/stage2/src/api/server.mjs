/** S2-B2 batch 2 — local controlled READ API (loopback only, emulator mode only).
 *
 *  POST /v1/read  { op, target: {<idField>: id}, claimedScope: {workspaceId, classId} }
 *    Authorization: Bearer <Auth Emulator ID token>
 *  → 200 { code: 'OK', traceId, data }   (whitelisted fields only; no names)
 *  → 403 { code: 'FORBIDDEN', traceId }  (identical for "does not exist" and "not allowed", §6.6)
 *  → 503 { code: 'UNAVAILABLE', traceId } (backend unreachable; no data)
 *
 *  Rules:
 *   - Every request re-runs token checks and §6.1/§6.2 authorization against authoritative documents.
 *   - The caller never supplies owner access, principal, workspace or class: scope comes from the
 *     resolved document path; the claimed scope must match it.
 *   - Every decision (allow and deny) is appended to auditLog BEFORE the response is sent; if the audit
 *     write fails the request fails closed (UNAVAILABLE).
 *   - There are no write operations. */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { authorize, OPERATIONS, POLICY_VERSION } from '../authz.mjs';
import { verifyEmulatorIdToken } from './token.mjs';
import { createStore, BackendUnavailable } from './store.mjs';
import { TRACE_HEADER, TRACE_ID_RE } from '../trace-proxy.mjs';
import { assertLoopbackUrl } from '../local-guard.mjs';

export const UNSCOPED_AUDIT_COLLECTION = 'auditLogUnscoped';   // gap G-2: denials whose workspace is unknown
const ENTRY_FIELDS = ['attendanceEntryId', 'sessionId', 'enrollmentId', 'studentId', 'status', 'scope', 'version'];
const LEAVE_FIELDS = ['leaveRecordId', 'studentId', 'enrollmentId', 'leaveTypeId', 'coverageSegments', 'recordEffect', 'teacherConfirmation', 'administrativeApproval', 'version', 'lastRevisionAt'];
const ISSUE_FIELDS = ['issueId', 'progress', 'checkConclusion', 'question', 'evidence', 'evidenceStale'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

function countsOf(entries) {
  const c = { P: 0, R: 0, N: 0, U: 0 };
  for (const e of entries) { if (!(e.status in c)) throw new Error(`unknown attendance status ${e.status}`); c[e.status] += 1; }
  return { ...c, total: c.P + c.R + c.N + c.U, registered: c.P + c.R + c.N, arrived: c.P + c.R };
}

/** Builds the response data for an ALLOWED request. Reads only below the authorized target path. */
async function buildData(op, az, store) {
  const t = az.target;
  switch (op) {
    case 'attendanceSession.read': {
      const entries = (await store.listCollection(`${t.path}/entries`)).map((e) => pick(e.data, ENTRY_FIELDS));
      return { sessionId: t.data.sessionId, workspaceId: az.scope.workspaceId, classId: az.scope.classId, date: t.data.date, kind: t.data.kind, rosterSnapshot: t.data.rosterSnapshot, entries };
    }
    case 'attendanceSummary.read': {
      const entries = (await store.listCollection(`${t.path}/entries`)).map((e) => e.data);
      return { sessionId: t.data.sessionId, workspaceId: az.scope.workspaceId, classId: az.scope.classId, entryCount: entries.length, counts: countsOf(entries) };
    }
    case 'attendanceEntry.read': return { ...pick(t.data, ENTRY_FIELDS), workspaceId: az.scope.workspaceId, classId: az.scope.classId };
    case 'leaveRecord.read': return { ...pick(t.data, LEAVE_FIELDS), workspaceId: az.scope.workspaceId, classId: az.scope.classId };
    case 'trackingIssue.read': return { ...pick(t.data, ISSUE_FIELDS), workspaceId: az.scope.workspaceId, classId: az.scope.classId };
    case 'leaveApplicability.read': return null;   // gap G-4: no trusted period calendar in this batch
    default: return null;
  }
}

/** @param deps.backendOrigin loopback origin for Firestore + Auth (normally the back trace proxy)
 *  @param deps.authorizeFn   injectable ONLY so mutation tests can prove the Observer catches a broken API */
export function createApi({ port, host = '127.0.0.1', projectId, backendOrigin, emulatorMode, now = () => Date.now(), authorizeFn = authorize }) {
  if (emulatorMode !== true) throw new Error('API: only explicit local emulator mode is implemented; no production token verification exists');
  if (!/^demo-/.test(projectId)) throw new Error('API: project must be a demo- project');
  assertLoopbackUrl(`${backendOrigin}/`);
  const lookupVia = (traceId) => async (idToken) => {
    const url = `${backendOrigin}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=emulator-local`;
    assertLoopbackUrl(url);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(traceId ? { [TRACE_HEADER]: traceId } : {}) }, body: JSON.stringify({ idToken }), redirect: 'error', signal: AbortSignal.timeout(5000) });
      return { status: r.status, json: await r.json().catch(() => null) };
    } catch { return { status: 0, json: null }; }
  };

  const server = http.createServer(async (req, res) => {
    const hdr = req.headers[TRACE_HEADER];
    const traceId = typeof hdr === 'string' && TRACE_ID_RE.test(hdr) ? hdr : `TR-${randomUUID()}`;
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...body, traceId })); };
    const store = createStore({ origin: backendOrigin, projectId, traceId });
    const nowMs = now();
    let body = null;
    let audit = { authUid: null, principalId: null, action: null, resourceRef: null, decision: 'deny', reasonCode: 'REQUEST_INVALID', workspaceId: null };
    try {
      if (req.method !== 'POST' || req.url !== '/v1/read') { audit.reasonCode = 'ROUTE_NOT_FOUND'; return await finish(403, { code: 'FORBIDDEN' }); }
      const text = await new Promise((resolve, reject) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 65536) reject(new Error('too large')); }); req.on('end', () => resolve(s)); req.on('error', reject); });
      try { body = JSON.parse(text); } catch { body = null; }
      audit.action = typeof body?.op === 'string' && OPERATIONS[body.op] ? body.op : null;
      // §6.1 step 1
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      const v = m ? await verifyEmulatorIdToken(m[1], { projectId, nowSec: Math.floor(nowMs / 1000), lookup: lookupVia(traceId) }) : { ok: false, reason: 'TOKEN_MISSING' };
      if (!v.ok) { if (v.reason === 'AUTH_UNAVAILABLE') throw new BackendUnavailable('auth'); audit.reasonCode = v.reason; return await finish(403, { code: 'FORBIDDEN' }); }
      audit.authUid = v.claims.authUid;
      // §6.1 steps 2–3, §6.2 steps 5–6 (pre-authorization format problems are FORBIDDEN, §6.6)
      const az = await authorizeFn({ op: body?.op, claims: v.claims, target: body?.target, claimedScope: body?.claimedScope, nowMs, store });
      audit = { ...audit, principalId: az.principalId ?? null, resourceRef: az.resource ?? null, decision: az.decision, reasonCode: az.reasonCode, workspaceId: az.scope?.workspaceId ?? null };
      if (az.decision !== 'allow') return await finish(403, { code: 'FORBIDDEN' });
      const data = await buildData(body.op, az, store);
      if (data === null) { audit.outcome = 'NOT_IMPLEMENTED_NO_TRUSTED_CALENDAR'; return await finish(503, { code: 'UNAVAILABLE' }); }
      return await finish(200, { code: 'OK', data });
    } catch (e) {
      audit = { ...audit, decision: audit.decision === 'allow' ? 'allow' : 'deny', outcome: 'BACKEND_UNAVAILABLE' };
      try { await writeAudit(); } catch { /* backend gone: nothing more we can record */ }
      if (!res.headersSent) send(503, { code: 'UNAVAILABLE' });
    }

    async function writeAudit() {
      const auditId = randomUUID();
      const doc = { auditId, at: new Date(nowMs).toISOString(), authUid: audit.authUid, principalId: audit.principalId, action: audit.action, resourceRef: audit.resourceRef, decision: audit.decision, reasonCode: audit.reasonCode, policyVersion: POLICY_VERSION, traceId, ...(audit.outcome ? { outcome: audit.outcome } : {}) };
      const coll = audit.workspaceId ? `workspaces/${audit.workspaceId}/auditLog` : UNSCOPED_AUDIT_COLLECTION;
      await store.appendAudit(coll, auditId, audit.workspaceId ? { ...doc, workspaceId: audit.workspaceId } : doc);
    }
    async function finish(status, payload) {
      await writeAudit();                // fail closed: no response body before the audit record exists
      send(status, payload);
    }
  });
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address().port)); }),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
