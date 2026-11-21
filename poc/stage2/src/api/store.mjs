/** Authoritative Firestore reads/writes for the controlled API (Emulator, owner = admin-equivalent).
 *  All calls go to `origin` (the BACK trace proxy in normal runs) and carry the request traceId so the
 *  Observer can attribute every backend access to one API request. Owner access lives ONLY here:
 *  callers of the API never choose or see it. */
import { assertLoopbackUrl } from '../local-guard.mjs';
import { EMULATOR_OWNER } from '../emu-client.mjs';
import { TRACE_HEADER } from '../trace-proxy.mjs';
import { IntegrityError } from './response-shape.mjs';

export class BackendUnavailable extends Error { constructor(m) { super(m); this.name = 'BackendUnavailable'; } }

const fromValue = (v) => 'nullValue' in v ? null : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
  : 'doubleValue' in v ? v.doubleValue : 'stringValue' in v ? v.stringValue : 'timestampValue' in v ? v.timestampValue
  : 'arrayValue' in v ? (v.arrayValue.values || []).map(fromValue)
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)])) : undefined;
export const fromFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromValue(v)]));
const toValue = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v }
  : Number.isInteger(v) ? { integerValue: String(v) } : typeof v === 'number' ? { doubleValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(toValue) } }
  : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } } : { stringValue: String(v) };
export const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

export function createStore({ origin, projectId, traceId = null }) {
  const docsPrefix = `projects/${projectId}/databases/(default)/documents`;
  const base = `${origin}/v1/${docsPrefix}`;
  async function call(url, { method = 'GET', body } = {}) {
    assertLoopbackUrl(url);
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${EMULATOR_OWNER}` };
    if (traceId) headers[TRACE_HEADER] = traceId;
    let res;
    try { res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(5000) }); } catch (e) { throw new BackendUnavailable(e.message); }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (res.status >= 500) throw new BackendUnavailable(`backend ${res.status}`);
    return { status: res.status, json };
  }
  const rel = (name) => name.slice(name.indexOf(docsPrefix) + docsPrefix.length + 1);
  async function getDoc(path) {
    const r = await call(`${base}/${path}`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new BackendUnavailable(`get ${r.status}`);
    return fromFields(r.json.fields);
  }
  async function runQuery(parentPath, structuredQuery) {
    const r = await call(`${base}${parentPath ? '/' + parentPath : ''}:runQuery`, { method: 'POST', body: { structuredQuery } });
    if (r.status !== 200 || !Array.isArray(r.json)) throw new BackendUnavailable(`runQuery ${r.status}`);
    return r.json.filter((x) => x.document).map((x) => ({ path: rel(x.document.name), data: fromFields(x.document.fields) }));
  }
  const eq = (field, value) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } });
  return {
    getBinding: (uid) => getDoc(`authBindings/${uid}`),
    getPrincipal: (pid) => getDoc(`principals/${pid}`),
    // Collection-group lookup over the WHOLE database: scope is derived afterwards from the path.
    findTargets: (collection, idField, id) => runQuery('', { from: [{ collectionId: collection, allDescendants: true }], where: eq(idField, id), limit: 3 }),
    // Returns the membership DOCUMENTS (data only); the path is fixed by the query parent, so every hit
    // is under workspaces/{wid}/memberships. authorize() additionally checks the workspaceId field.
    listMemberships: async (wid, pid) => (await runQuery(`workspaces/${wid}`, { from: [{ collectionId: 'memberships' }], where: eq('principalId', pid), limit: 50 }))
      .filter((x) => x.path.startsWith(`workspaces/${wid}/memberships/`)).map((x) => x.data),
    listCollection: async (collPath) => {
      const r = await call(`${base}/${collPath}?pageSize=300`);
      if (r.status !== 200) throw new BackendUnavailable(`list ${r.status}`);
      // R1-N4: never return a partial list (or counts built from one): more pages → fail closed
      if (r.json?.nextPageToken) throw new IntegrityError('DATA_INTEGRITY_ERROR', `LIST_TRUNCATED: ${collPath}`);
      return (r.json?.documents || []).map((d) => ({ path: rel(d.name), data: fromFields(d.fields) }));
    },
    getDoc,
    /** Audit write (auditLog is append-only; document id is random, create-only via precondition). */
    appendAudit: async (collPath, auditId, data) => {
      const r = await call(`${base}/${collPath}/${auditId}?currentDocument.exists=false`, { method: 'PATCH', body: { fields: toFields(data) } });
      if (r.status !== 200) throw new BackendUnavailable(`audit write ${r.status}`);
    },
  };
}
