/** B4: Firestore REST transactions for the controlled write API (Emulator only, owner = admin-equivalent).
 *  Every call goes to `origin` (the BACK trace proxy in normal runs) and carries the request traceId, so the
 *  trusted back trace holds each beginTransaction RESPONSE (the transaction id comes from the Emulator, never
 *  from the API) and every read / commit / rollback that names it in its request body.
 *  Reads inside a transaction use :batchGet with the transaction in the BODY (recorded by the back proxy).
 *
 *  Error classes (plan v0.2 §2.1):
 *   - TxnAborted        : HTTP 409 with error.status ABORTED (Emulator lock timeout / contention) → retryable
 *   - BackendUnavailable: anything else (network, 5xx, 4xx such as FAILED_PRECONDITION) → never a VERSION_CONFLICT */
import { assertLoopbackUrl } from '../local-guard.mjs';
import { EMULATOR_OWNER } from '../emu-client.mjs';
import { TRACE_HEADER } from '../trace-proxy.mjs';
import { BackendUnavailable, fromFields } from './store.mjs';

export class TxnAborted extends Error { constructor(m) { super(m); this.name = 'TxnAborted'; } }

export function createTxnClient({ origin, projectId, traceId = null }) {
  const docsPrefix = `projects/${projectId}/databases/(default)/documents`;
  const base = `${origin}/v1/${docsPrefix}`;
  const nameOf = (p) => `${docsPrefix}/${p}`;
  const rel = (name) => (typeof name === 'string' && name.startsWith(`${docsPrefix}/`) ? name.slice(docsPrefix.length + 1) : null);
  async function call(verb, body) {
    const url = `${base}:${verb}`;
    assertLoopbackUrl(url);
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${EMULATOR_OWNER}` };
    if (traceId) headers[TRACE_HEADER] = traceId;
    let res;
    try { res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) }); } catch (e) { throw new BackendUnavailable(`${verb}: ${e.name}`); }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (res.status === 409 && json?.error?.status === 'ABORTED') throw new TxnAborted(verb);
    if (res.status !== 200) throw new BackendUnavailable(`${verb} ${res.status}${json?.error?.status ? ' ' + json.error.status : ''}`);
    return json;
  }
  return {
    nameOf,
    async begin() {
      const j = await call('beginTransaction', { options: { readWrite: {} } });
      if (typeof j?.transaction !== 'string' || j.transaction === '') throw new BackendUnavailable('beginTransaction: no transaction id');
      return j.transaction;
    },
    /** One document read inside `transaction`. → null (missing) | { data, updateTime } */
    async get(path, transaction) {
      const j = await call('batchGet', { documents: [nameOf(path)], transaction });
      if (!Array.isArray(j) || j.length !== 1) throw new BackendUnavailable('batchGet: unexpected shape');
      const r = j[0];
      if (r.missing && rel(r.missing) === path) return null;
      if (r.found && rel(r.found.name) === path && typeof r.found.updateTime === 'string') return { data: fromFields(r.found.fields), updateTime: r.found.updateTime };
      throw new BackendUnavailable('batchGet: result does not name the requested document');
    },
    async commit(transaction, writes) { return call('commit', { writes, transaction }); },
    async rollback(transaction) { try { await call('rollback', { transaction }); } catch { /* the transaction is already gone (aborted) or the backend is down */ } },
  };
}
