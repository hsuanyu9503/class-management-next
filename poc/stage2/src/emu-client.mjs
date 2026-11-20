/** Minimal REST client for the LOCAL Auth/Firestore emulators. No Firebase SDK, no credentials.
 *  Every URL is re-checked with assertLoopbackUrl() before fetch (defence in depth). */
import { assertLoopbackUrl } from './local-guard.mjs';

const TIMEOUT_MS = 5000;
async function call(url, { method = 'GET', body, token } = {}) {
  assertLoopbackUrl(url);
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

// Emulator-only admin bypass of Security Rules ("owner"). Valid ONLY against the emulator;
// used solely to seed/inspect fictional data. Never a production credential.
export const EMULATOR_OWNER = 'owner';

export function firestoreClient(cfg) {
  const base = `${cfg.firestore.origin}/v1/projects/${cfg.projectId}/databases/(default)/documents`;
  const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));
  const toValue = (v) => v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v }
    : Number.isInteger(v) ? { integerValue: String(v) } : typeof v === 'number' ? { doubleValue: v }
    : Array.isArray(v) ? { arrayValue: { values: v.map(toValue) } }
    : typeof v === 'object' ? { mapValue: { fields: toFields(v) } } : { stringValue: String(v) };
  const fromValue = (v) => 'nullValue' in v ? null : 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? Number(v.integerValue)
    : 'doubleValue' in v ? v.doubleValue : 'stringValue' in v ? v.stringValue
    : 'arrayValue' in v ? (v.arrayValue.values || []).map(fromValue)
    : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)])) : undefined;
  return {
    ping: () => call(`${cfg.firestore.origin}/`),
    set: (path, data, token) => call(`${base}/${path}`, { method: 'PATCH', body: { fields: toFields(data) }, token }),
    get: (path, token) => call(`${base}/${path}`, { token }),
    list: async (collPath, token) => {
      const out = []; let pageToken = '';
      do {
        const r = await call(`${base}/${collPath}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { token });
        if (r.status !== 200) return { status: r.status, docs: null, json: r.json };
        for (const d of r.json?.documents || []) out.push({ name: d.name, data: Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromValue(v)])) });
        pageToken = r.json?.nextPageToken || '';
      } while (pageToken);
      return { status: 200, docs: out };
    },
    // Read-only: names of root collections (used to prove the emulator is a fresh, empty instance).
    listRootCollections: (token) => call(`${base}:listCollectionIds`, { method: 'POST', body: { pageSize: 100 }, token }),
    clearAll: () => call(`${cfg.firestore.origin}/emulator/v1/projects/${cfg.projectId}/databases/(default)/documents`, { method: 'DELETE' }),
  };
}

export function authClient(cfg) {
  const idt = `${cfg.auth.origin}/identitytoolkit.googleapis.com/v1`;
  return {
    config: () => call(`${cfg.auth.origin}/emulator/v1/projects/${cfg.projectId}/config`),
    signUp: (email, password) => call(`${idt}/accounts:signUp?key=fake-api-key-for-emulator`, { method: 'POST', body: { email, password, returnSecureToken: true } }),
    lookup: (idToken) => call(`${idt}/accounts:lookup?key=fake-api-key-for-emulator`, { method: 'POST', body: { idToken } }),
    countAccounts: () => call(`${idt}/projects/${cfg.projectId}/accounts:query`, { method: 'POST', body: { returnUserInfo: false }, token: EMULATOR_OWNER }),
    clearAll: () => call(`${cfg.auth.origin}/emulator/v1/projects/${cfg.projectId}/accounts`, { method: 'DELETE' }),
  };
}
