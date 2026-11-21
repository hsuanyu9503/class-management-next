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
import { buildData, IntegrityError } from './response-shape.mjs';

export { checkRequestShape } from './request-shape.mjs';
import { checkRequestShape } from './request-shape.mjs';

export const UNSCOPED_AUDIT_COLLECTION = 'auditLogUnscoped';   // gap G-2: denials whose workspace is unknown
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
      // Unknown / nested request fields: refused before authorization (format errors are FORBIDDEN, §6.6)
      if (!checkRequestShape(body)) { audit.reasonCode = 'REQUEST_SHAPE_INVALID'; return await finish(403, { code: 'FORBIDDEN' }); }
      // §6.1 steps 2–3, §6.2 steps 5–6
      const az = await authorizeFn({ op: body?.op, claims: v.claims, target: body?.target, claimedScope: body?.claimedScope, nowMs, store });
      audit = { ...audit, principalId: az.principalId ?? null, resourceRef: az.resource ?? null, decision: az.decision, reasonCode: az.reasonCode, workspaceId: az.scope?.workspaceId ?? null };
      if (az.decision !== 'allow') return await finish(403, { code: 'FORBIDDEN' });
      let data;
      try { data = await buildData(body.op, az, store); } catch (e) {
        if (!(e instanceof IntegrityError)) throw e;
        // REV001/REV003: inconsistent or malformed data anywhere in the response → whole request denied
        audit = { ...audit, decision: 'deny', reasonCode: e.reasonCode, outcome: e.detail.slice(0, 200) };
        return await finish(403, { code: 'FORBIDDEN' });
      }
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
