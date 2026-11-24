/** S2-B2 local controlled API (loopback only, emulator mode only).
 *
 *  POST /v1/read  { op, target: {<idField>: id}, claimedScope: {workspaceId, classId} }          (batch 2)
 *  POST /v1/commit { command: <canonicalCommand>, claimedScope: {workspaceId, classId} }         (B4, §6.5 / §8)
 *  POST /v1/receipt { operationId, workspaceId }                                                  (B4, §6.4 / §8)
 *    Authorization: Bearer <Auth Emulator ID token>
 *  → 200 { code: 'OK', traceId, data | receipt [, derivedStatus] }
 *  → 403 { code: 'FORBIDDEN', traceId }  (identical for "does not exist" and "not allowed", §6.6)
 *  → 409 { code: 'VERSION_CONFLICT' } | { code: 'OPERATION_REUSE_MISMATCH', operationId }   (commit only)
 *  → 400 { code: 'INVALID_INPUT' }       (commit only, AFTER authorization, §6.6)
 *  → 503 { code: 'UNAVAILABLE', traceId [, reason: 'TRANSACTION_CONTENTION'] } (backend; no data)
 *
 *  Rules:
 *   - Every request re-runs token checks and §6.1/§6.2 authorization against authoritative documents.
 *   - The caller never supplies owner access, principal, workspace or class: scope comes from the
 *     resolved document path; the claimed scope must match it.
 *   - Every decision (allow and deny) is appended to auditLog BEFORE the response is sent; if the audit
 *     write fails the request fails closed (UNAVAILABLE).
 *   - /v1/commit authorizes (leave.revise) BEFORE any receipt is read (§6.5); /v1/receipt needs no capability,
 *     only the caller's own valid identity, ownership of the stored receipt and a valid class membership. */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { authorize, checkReceiptAccess, OPERATIONS, WRITE_OPERATIONS, RECEIPT_OPERATION, POLICY_VERSION } from '../authz.mjs';
import { verifyEmulatorIdToken } from './token.mjs';
import { createStore, BackendUnavailable, toFields } from './store.mjs';
import { createTxnClient } from './txn.mjs';
import { checkCommitShape, validateCommand, processCommit, receiptOut, WRITE_OP } from './commit.mjs';
import { checkReceiptShape, ROUTES } from './request-shape.mjs';
import { TRACE_HEADER, TRACE_ID_RE } from '../trace-proxy.mjs';
import { assertLoopbackUrl } from '../local-guard.mjs';
import { buildData, IntegrityError } from './response-shape.mjs';

export { checkRequestShape } from './request-shape.mjs';
import { checkRequestShape } from './request-shape.mjs';

export const UNSCOPED_AUDIT_COLLECTION = 'auditLogUnscoped';   // gap G-2: denials whose workspace is unknown
const DERIVED_STATUSES = new Set(['pending', 'done', 'failed']);
const ROUTE_KIND = Object.freeze({ [ROUTES.read]: 'read', [ROUTES.commit]: 'commit', [ROUTES.receipt]: 'receipt' });

/** @param deps.backendOrigin loopback origin for Firestore + Auth (normally the back trace proxy)
 *  @param deps.authorizeFn   injectable ONLY so mutation tests can prove the Observer catches a broken API
 *  @param deps.mutation      B4 mutation hooks, injectable ONLY by tests (the Runner never passes them):
 *                            { skipReceiptCheck, skipVersionCheck, splitCommit, reportTransactionRef(t),
 *                              receiptWrites, receiptReexecute: { intent } } */
export function createApi({ port, host = '127.0.0.1', projectId, backendOrigin, emulatorMode, now = () => Date.now(), authorizeFn = authorize, mutation = null }) {
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
    const route = req.method === 'POST' && Object.hasOwn(ROUTE_KIND, req.url) ? ROUTE_KIND[req.url] : null;
    try {
      if (!route) { audit.reasonCode = 'ROUTE_NOT_FOUND'; return await finish(403, { code: 'FORBIDDEN' }); }
      const text = await new Promise((resolve, reject) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 65536) reject(new Error('too large')); }); req.on('end', () => resolve(s)); req.on('error', reject); });
      try { body = JSON.parse(text); } catch { body = null; }
      // action is recorded only for a well-shaped request naming an OWN operation key (R1-N5; matches the trace)
      if (route === 'read') audit.action = checkRequestShape(body) && Object.hasOwn(OPERATIONS, body.op) ? body.op : null;
      else if (route === 'commit') audit.action = checkCommitShape(body) ? WRITE_OP : null;
      else audit.action = checkReceiptShape(body) ? RECEIPT_OPERATION : null;
      // §6.1 step 1
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      const v = m ? await verifyEmulatorIdToken(m[1], { projectId, nowSec: Math.floor(nowMs / 1000), lookup: lookupVia(traceId) }) : { ok: false, reason: 'TOKEN_MISSING' };
      if (!v.ok) { if (v.reason === 'AUTH_UNAVAILABLE') throw new BackendUnavailable('auth'); audit.reasonCode = v.reason; return await finish(403, { code: 'FORBIDDEN' }); }
      audit.authUid = v.claims.authUid;
      if (route === 'commit') return await handleCommit(v.claims);
      if (route === 'receipt') return await handleReceipt(v.claims);
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
      if (e instanceof IntegrityError) {
        // inconsistent stored data met by a write / receipt handler → the whole request is denied
        audit = { ...audit, decision: 'deny', reasonCode: e.reasonCode, outcome: e.detail.slice(0, 200) };
        try { return await finish(403, { code: 'FORBIDDEN' }); } catch { /* audit failed → fall through to 503 */ }
      }
      audit = { ...audit, decision: audit.decision === 'allow' ? 'allow' : 'deny', outcome: 'BACKEND_UNAVAILABLE' };
      try { await writeAudit(); } catch { /* backend gone: nothing more we can record */ }
      if (!res.headersSent) send(503, { code: 'UNAVAILABLE' });
    }

    /** B4 §8 step 1 → 5. Authorization (leave.revise) first; nothing here reads a receipt before it passed. */
    async function handleCommit(claims) {
      if (!checkCommitShape(body)) { audit.reasonCode = 'REQUEST_SHAPE_INVALID'; return finish(403, { code: 'FORBIDDEN' }); }
      const c = body.command;
      const az = await authorizeFn({ op: WRITE_OP, claims, target: { leaveRecordId: c.targetId }, claimedScope: body.claimedScope, nowMs, store, operations: WRITE_OPERATIONS });
      audit = { ...audit, principalId: az.principalId ?? null, resourceRef: az.resource ?? null, decision: az.decision, reasonCode: az.reasonCode, workspaceId: az.scope?.workspaceId ?? null };
      if (az.decision !== 'allow') return finish(403, { code: 'FORBIDDEN' });
      const bad = validateCommand(c);
      if (bad) { audit.outcome = `INVALID_INPUT:${bad}`; return finish(400, { code: 'INVALID_INPUT' }); }
      const txn = createTxnClient({ origin: backendOrigin, projectId, traceId });
      const r = await processCommit({ command: c, scope: az.scope, principalId: az.principalId, currentPath: az.resource, txn, toFields, nowMs: now, mutation });
      audit = { ...audit, outcome: r.outcome, operationId: c.operationId, requestHash: r.requestHash, attempts: r.attempts, transactionRef: r.transactionRef };
      return finish(r.status, r.body);
    }
    /** B4 receipt query (§6.4, §8; plan v0.2 §3.1.2): no capability, no commit, no write (audit only). */
    async function handleReceipt(claims) {
      if (!checkReceiptShape(body)) { audit.reasonCode = 'REQUEST_SHAPE_INVALID'; return finish(403, { code: 'FORBIDDEN' }); }
      const az = await checkReceiptAccess({ claims, workspaceId: body.workspaceId, operationId: body.operationId, nowMs, store });
      audit = { ...audit, principalId: az.principalId ?? null, resourceRef: az.resource ?? null, decision: az.decision, reasonCode: az.reasonCode, workspaceId: az.resource ? body.workspaceId : null };
      if (az.decision !== 'allow') return finish(403, { code: 'FORBIDDEN' });
      const receipt = receiptOut(az.receipt);
      const dp = await store.getDoc(`workspaces/${body.workspaceId}/derivedProgress/${body.operationId}`);
      if (!dp || dp.operationId !== body.operationId || !DERIVED_STATUSES.has(dp.derivedStatus)) throw new IntegrityError('DATA_INTEGRITY_ERROR', 'derivedProgress missing or invalid');
      if (mutation?.receiptWrites) {
        // MUTATION (tests only): the receipt query writes (bumps derivedProgress.attempts)
        const txn = createTxnClient({ origin: backendOrigin, projectId, traceId }); const t = await txn.begin();
        await txn.commit(t, [{ update: { name: txn.nameOf(`workspaces/${body.workspaceId}/derivedProgress/${body.operationId}`), fields: toFields({ ...dp, attempts: (dp.attempts || 0) + 1 }) } }]);
      }
      if (mutation?.receiptReexecute) {
        // MUTATION (tests only): the receipt query re-executes the command under a NEW operationId, ignoring the version
        const hits = await store.findTargets('leaveRecords', 'leaveRecordId', az.receipt.targetId);
        const command = { schemaVersion: '1.0', workspaceId: body.workspaceId, operationId: randomUUID(), commandType: az.receipt.commandType, targetType: az.receipt.targetType, targetId: az.receipt.targetId, expectedVersion: -1, intent: mutation.receiptReexecute.intent, clientCreatedAt: new Date(nowMs).toISOString() };
        await processCommit({ command, scope: az.scope, principalId: az.principalId, currentPath: hits[0].path, txn: createTxnClient({ origin: backendOrigin, projectId, traceId }), toFields, nowMs: now, mutation: { skipVersionCheck: true, anyDayPart: true } });
      }
      return finish(200, { code: 'OK', receipt, derivedStatus: dp.derivedStatus });
    }

    async function writeAudit() {
      const auditId = randomUUID();
      const doc = { auditId, at: new Date(nowMs).toISOString(), authUid: audit.authUid, principalId: audit.principalId, action: audit.action, resourceRef: audit.resourceRef, decision: audit.decision, reasonCode: audit.reasonCode, policyVersion: POLICY_VERSION, traceId, ...(audit.outcome ? { outcome: audit.outcome } : {}) };
      // B4 write evidence: what the API itself claims about the commit (reconciled against the back trace)
      for (const k of ['operationId', 'requestHash', 'attempts', 'transactionRef']) if (audit[k] !== undefined) doc[k] = audit[k];
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
