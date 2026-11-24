/** Loopback-only recording reverse proxy (batch 2 "trace 記錄代理").
 *  front: Adapter → [front proxy] → API      (assigns the traceId; records requests/responses)
 *  back:  API     → [back proxy]  → Emulator (records every backend read/write tagged with traceId)
 *  Every entry is masked (src/mask.mjs) before it is kept or written. The proxy is NOT an isolation
 *  boundary (S2B2-ATTESTATION §9 is not implemented): a local process could bypass it. */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { assertLoopbackUrl } from './local-guard.mjs';
import { maskAuthorization } from './mask.mjs';
import { traceableBodyFor, ROUTES } from './api/request-shape.mjs';
import { stableJson, sha256Hex } from './stable.mjs';

export const TRACE_HEADER = 'x-cmn-trace-id';
export const TRACE_ID_RE = /^TR-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BODY = 1024 * 1024;

const parseStrict = (t) => { try { return JSON.parse(t); } catch { return undefined; } };
const parseJson = (t) => { if (!t) return null; try { return JSON.parse(t); } catch { return { nonJsonBodyLength: t.length }; } };
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** @param opts.role 'front' | 'back'
 *  @param opts.route (path) => upstream origin (loopback)
 *  @param opts.masker makeMasker(...)
 *  @param opts.file optional JSONL file path */
/** B3a: `socketPath` makes the proxy listen on a Unix socket instead of TCP (the sandboxed Adapter's only
 *  entry). On the front proxy, GET /__entry_probe is answered locally (204) and never forwarded, so the
 *  isolation self-check can prove the entry is reachable without creating API traffic or audit records. */
export const ENTRY_PROBE_PATH = '/__entry_probe';
/** PR1-REV001 / PR1-R1-REV001: the query string as a SAFE PROJECTION, in order, duplicates kept, one single-key
 *  object per parameter. Parameter NAMES and VALUES come from the caller and can carry anything (the masker
 *  keeps object keys), so nothing caller-chosen is copied unless it is on this allow-list:
 *   - a known name whose value matches that name's rule        → { name: value }
 *   - a known name whose value is opaque or fails the rule      → { name: { valueRecorded: false } }
 *   - any other name                                            → { unknownParameter: { valueRecorded: false } }
 *  Extra, duplicate or invalid parameters therefore stay visible (and rejectable) without their text. */
const NOT_RECORDED_VALUE = Object.freeze({ valueRecorded: false });
const FIELD_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const QUERY_ALLOWLIST = Object.freeze({
  'currentDocument.exists': (v) => v === 'true' || v === 'false',
  pageSize: (v) => /^[0-9]{1,4}$/.test(v),
  pageToken: () => false,                                     // opaque: name kept, value never recorded
  key: (v) => v === 'emulator-local' || v === 'fake-api-key-for-emulator',
  'updateMask.fieldPaths': (v) => FIELD_PATH_RE.test(v),
  'mask.fieldPaths': (v) => FIELD_PATH_RE.test(v),
});
export const MAX_QUERY_PARAMS = 32;
export function queryOf(url) {
  const u = String(url); const i = u.indexOf('?');
  if (i < 0) return [];
  const out = [];
  for (const [k, v] of new URLSearchParams(u.slice(i + 1))) {
    if (out.length === MAX_QUERY_PARAMS) { out.push({ moreParameters: { valueRecorded: false } }); break; }
    if (!Object.hasOwn(QUERY_ALLOWLIST, k)) out.push({ unknownParameter: NOT_RECORDED_VALUE });
    else out.push({ [k]: QUERY_ALLOWLIST[k](v) ? v : NOT_RECORDED_VALUE });
  }
  return out;
}

/** B4 (plan v0.2 §2.1): trusted FRONT faults, set by the Runner per case from a trusted table — never by the Adapter.
 *   commitBarrier { count, timeoutMs }: every POST /v1/commit is held after its full body arrived until `count`
 *     commits are held (or the timeout passes), then all are released together (POC-017 sync point).
 *   dropCommitResponses n: the first n POST /v1/commit are forwarded, the API's response is read, then the client
 *     connection is destroyed WITHOUT delivering it (POC-021, API → client boundary).
 *  BACK (REV-21-02), commitHold { reads, timeoutMs }: every Firestore :commit is held until `reads` DIFFERENT requests
 *     (traceIds) have COMPLETED a successful in-transaction read of a leave record (:batchGet, HTTP 200), or the
 *     timeout passes; the entry records { hold: { arrivedAt, releasedAt, complete } }. It only arranges the overlap;
 *     the judge still decides concurrency from the recorded intervals (b4/commit-trace.mjs concurrencyOf).
 *  Front entries of /v1/commit and /v1/receipt also record `receiptDigest` = sha256(stableJson(response.receipt))
 *  (scope: the `receipt` member only — the immutable receipt, not derivedStatus / code / traceId) and `delivered`. */
export const RECEIPT_DIGEST_SCOPE = 'sha256(stableJson(responseBody.receipt))';
export function receiptDigestOf(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  return j && typeof j === 'object' && j.receipt && typeof j.receipt === 'object' && !Array.isArray(j.receipt) ? sha256Hex(Buffer.from(stableJson(j.receipt), 'utf8')) : null;
}

export function createTraceProxy({ role, route, masker, file = null, port, host = '127.0.0.1', socketPath = null, faults = null }) {
  const entries = [];
  let seq = 0;
  const barrier = role === 'front' && faults?.commitBarrier ? { need: faults.commitBarrier.count, timeoutMs: faults.commitBarrier.timeoutMs, waiting: [], released: false, timedOut: false, timer: null } : null;
  let dropsLeft = role === 'front' && Number.isSafeInteger(faults?.dropCommitResponses) ? faults.dropCommitResponses : 0;
  const hold = role === 'back' && faults?.commitHold ? { need: faults.commitHold.reads, timeoutMs: faults.commitHold.timeoutMs, readers: new Set(), waiting: [], released: false, timedOut: false, timer: null } : null;
  const releaseHold = () => { if (!hold || hold.released) return; hold.released = true; hold.releasedAt = Date.now(); clearTimeout(hold.timer); hold.waiting.splice(0).forEach((w) => w(hold.releasedAt)); };
  // a commit arriving after the release passes at once; the record still names WHEN and WHY the hold was released
  const waitHold = () => new Promise((resolve) => {
    if (!hold || hold.released) { resolve(hold ? hold.releasedAt : null); return; }
    hold.waiting.push(resolve);
    if (!hold.timer) hold.timer = setTimeout(() => { hold.timedOut = true; releaseHold(); }, hold.timeoutMs);
  });
  const releaseAll = () => { if (!barrier || barrier.released) return; barrier.released = true; clearTimeout(barrier.timer); const at = Date.now(); barrier.waiting.splice(0).forEach((w) => w(at)); };
  const holdAtBarrier = () => new Promise((resolve) => {
    if (!barrier || barrier.released) { resolve(null); return; }
    barrier.waiting.push(resolve);
    if (!barrier.timer) barrier.timer = setTimeout(() => { barrier.timedOut = true; releaseAll(); }, barrier.timeoutMs);
    if (barrier.waiting.length >= barrier.need) releaseAll();
  });
  if (file) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, ''); }
  const record = (e) => { const m = masker.maskValue(e); entries.push(m); if (file) appendFileSync(file, JSON.stringify(m) + '\n'); };
  const server = http.createServer(async (req, res) => {
    if (role === 'front' && req.method === 'GET' && req.url === ENTRY_PROBE_PATH) { req.resume(); res.writeHead(204); res.end(); return; }
    const started = Date.now();
    let traceId;
    if (role === 'front') traceId = `TR-${randomUUID()}`;
    else { const h = req.headers[TRACE_HEADER]; traceId = typeof h === 'string' && TRACE_ID_RE.test(h) ? h : null; }
    let reqText = ''; let status = 0; let resText = '';
    const urlPath = req.url.split('?')[0];
    const isWriteRoute = role === 'front' && req.method === 'POST' && (urlPath === ROUTES.commit || urlPath === ROUTES.receipt);
    const fault = {};
    try {
      reqText = await readBody(req);
      if (role === 'front' && req.method === 'POST' && urlPath === ROUTES.commit && barrier) {
        fault.barrierArrivedAt = new Date().toISOString();
        const releasedAt = await holdAtBarrier();
        fault.barrierReleasedAt = releasedAt === null ? null : new Date(releasedAt).toISOString();
        fault.barrierComplete = releasedAt !== null && barrier.timedOut !== true;
      }
      if (hold && req.method === 'POST' && /\/documents:commit$/.test(urlPath)) {
        fault.holdArrivedAt = new Date().toISOString();
        const releasedAt = await waitHold();
        // complete: released because `reads` requests had completed their current read (not by the timeout)
        fault.hold = { arrivedAt: fault.holdArrivedAt, releasedAt: releasedAt === null ? null : new Date(releasedAt).toISOString(), complete: releasedAt !== null && hold.timedOut !== true, readers: hold.readers.size };
      }
      const origin = route(req.url);
      const url = `${origin}${req.url}`;
      assertLoopbackUrl(url);
      const headers = {};
      if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
      if (req.headers.authorization) headers.authorization = req.headers.authorization;
      if (traceId) headers[TRACE_HEADER] = traceId;
      const up = await fetch(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : reqText, redirect: 'error', signal: AbortSignal.timeout(8000) });
      status = up.status; resText = await up.text();
      if (hold && !hold.released && traceId && req.method === 'POST' && /\/documents:batchGet$/.test(urlPath) && status === 200 && /\/leaveRecords\/[^/"]+"/.test(reqText)) {
        hold.readers.add(traceId); if (hold.readers.size >= hold.need) releaseHold();
      }
      if (role === 'front' && req.method === 'POST' && urlPath === ROUTES.commit && dropsLeft > 0) {
        // POC-021: the API answered; the client never receives it (connection destroyed, nothing written)
        dropsLeft -= 1; fault.delivered = false; fault.droppedAt = new Date().toISOString();
        req.socket.destroy();
      } else {
        res.writeHead(status, { 'content-type': up.headers.get('content-type') || 'application/json' });
        res.end(resText);
        if (isWriteRoute) fault.delivered = true;
      }
    } catch (e) {
      status = 502; resText = JSON.stringify({ code: 'UNAVAILABLE' });
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(resText);
    } finally {
      const ended = Date.now();
      record({ role, seq: ++seq, traceId, at: new Date(started).toISOString(), endedAt: new Date(ended).toISOString(), durationMs: ended - started, method: req.method, path: urlPath, query: queryOf(req.url), authorizationRef: maskAuthorization(req.headers.authorization), requestBody: role === 'front' ? traceableBodyFor(urlPath, parseStrict(reqText)) : parseJson(reqText), status, responseBody: parseJson(resText),
        ...(isWriteRoute ? { receiptDigest: receiptDigestOf(resText), delivered: fault.delivered ?? false } : {}),
        ...(fault.barrierArrivedAt ? { barrier: { arrivedAt: fault.barrierArrivedAt, releasedAt: fault.barrierReleasedAt, complete: fault.barrierComplete } } : {}),
        ...(fault.droppedAt ? { droppedAt: fault.droppedAt } : {}),
        ...(fault.hold ? { hold: fault.hold } : {}) });
    }
  });
  return {
    entries,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      if (socketPath) server.listen(socketPath, () => { chmodSync(socketPath, 0o666); resolve(socketPath); });
      else server.listen(port, host, () => resolve(server.address().port));
    }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
