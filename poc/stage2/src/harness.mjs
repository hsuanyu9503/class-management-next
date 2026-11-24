/** Batch 2 harness: owned reset, world seeding, Auth users + bindings, server lifecycle, state export.
 *  Runs only inside `firebase emulators:exec` after assertLocalConfig() passed. Owner access is used
 *  here (test initialisation / observation) and inside the API store — never handed to the Adapter. */
import { randomBytes } from 'node:crypto';
import { firestoreClient, authClient, EMULATOR_OWNER } from './emu-client.mjs';
import { MARKER_COLLECTION, assertStillOwned } from './ownership.mjs';
import { fromFields, toFields } from './api/store.mjs';
import { assertLoopbackUrl } from './local-guard.mjs';
import { createApi } from './api/server.mjs';
import { createTraceProxy } from './trace-proxy.mjs';
import { buildWorld, ACTORS } from './world.mjs';
import { stableJson, sha256Hex } from './stable.mjs';

export const PORTS = Object.freeze({ api: 18300, front: 18301, back: 18302, closedBackend: 18305 });
export const BATCH2_PORTS = Object.freeze([PORTS.api, PORTS.front, PORTS.back, PORTS.closedBackend]);

export function createHarness({ cfg, nonce, fixtures, masker }) {
  // R1-N7: every secret this harness issues (passwords, ID tokens) — kept in memory only, used to scan
  // every artifact before it leaves the run. Never written anywhere.
  const issued = [];
  const fs = firestoreClient(cfg); const au = authClient(cfg);
  const docsPrefix = `projects/${cfg.projectId}/databases/(default)/documents`;
  const base = `${cfg.firestore.origin}/v1/${docsPrefix}`;
  const owner = async (url, opts = {}) => {
    assertLoopbackUrl(url);
    const r = await fetch(url, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${EMULATOR_OWNER}` }, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: 'error', signal: AbortSignal.timeout(8000) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* */ }
    return { status: r.status, json: j };
  };
  const must = (r, what) => { if (r.status !== 200) throw new Error(`HARNESS: ${what} → ${r.status}`); return r; };

  async function markerIds() { const m = await fs.list(MARKER_COLLECTION, EMULATOR_OWNER); if (m.status !== 200) throw new Error('HARNESS: marker list failed'); return m.docs.map((d) => d.name.split('/').pop()); }
  /** Clears ONLY an emulator this run owns (marker check first), then re-writes the marker. */
  async function ownedReset() {
    assertStillOwned(await markerIds(), nonce);
    must(await fs.clearAll(), 'clear firestore'); must(await au.clearAll(), 'clear auth');
    must(await fs.set(`${MARKER_COLLECTION}/${nonce}`, { nonce, createdAt: new Date().toISOString() }, EMULATOR_OWNER), 'marker');
  }
  async function putDoc(path, data) { must(await fs.set(path, data, EMULATOR_OWNER), `write ${path}`); }
  async function patchDoc(path, data) { const cur = await getDoc(path); await putDoc(path, { ...(cur || {}), ...data }); }
  async function getDoc(path) { const r = await owner(`${base}/${path}`); if (r.status === 404) return null; must(r, `get ${path}`); return fromFields(r.json.fields); }
  async function deleteDoc(path) { must(await owner(`${base}/${path}`, { method: 'DELETE' }), `delete ${path}`); }
  async function deleteField(path, field) { const cur = await getDoc(path); delete cur[field]; must(await owner(`${base}/${path}`, { method: 'PATCH', body: { fields: toFields(cur) } }), `rewrite ${path}`); }

  const idt = `${cfg.auth.origin}/identitytoolkit.googleapis.com/v1`;
  async function authCall(p, body, token) { const url = `${idt}/${p}`; assertLoopbackUrl(url); const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(8000) }); return { status: r.status, json: await r.json().catch(() => null) }; }
  const isoSec = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

  /** Fresh world: owned reset, documents, one Auth user + active binding per actor, fresh tokens. */
  async function seedWorld({ mutateDocs = (d) => d } = {}) {
    await ownedReset();
    for (const d of mutateDocs(buildWorld(fixtures))) await putDoc(d.path, d.data);
    const users = {};
    for (const actor of ACTORS) {
      const email = `${actor.toLowerCase()}@example.invalid`; const password = randomBytes(12).toString('hex');
      issued.push(password);
      const su = must(await authCall('accounts:signUp?key=emulator-local', { email, password, returnSecureToken: true }), `signUp ${actor}`);
      issued.push(su.json.idToken); if (su.json.refreshToken) issued.push(su.json.refreshToken);
      const uid = su.json.localId;
      await putDoc(`authBindings/${uid}`, { authUid: uid, principalId: actor, status: 'active', activatedAt: isoSec(Date.now() - 1000), bindingVersion: 1 });
      users[actor] = { uid, email, password };
    }
    await new Promise((r) => setTimeout(r, 1100));      // tokens issued strictly after binding activation
    for (const actor of ACTORS) users[actor].token = await signIn(users[actor]);
    return users;
  }
  async function signIn(u) { const t = must(await authCall('accounts:signInWithPassword?key=emulator-local', { email: u.email, password: u.password, returnSecureToken: true }), 'signIn').json; issued.push(t.idToken); if (t.refreshToken) issued.push(t.refreshToken); return t.idToken; }
  async function disableAuthUser(uid) { must(await authCall(`projects/${cfg.projectId}/accounts:update`, { localId: uid, disableUser: true }, EMULATOR_OWNER), 'disable user'); }

  /** Recursive export of every document (masked), sorted by path. */
  async function exportState() {
    const out = {};
    async function walkCollections(parent) {
      const r = must(await owner(`${base}${parent ? '/' + parent : ''}:listCollectionIds`, { method: 'POST', body: { pageSize: 300 } }), 'listCollectionIds');
      for (const c of r.json?.collectionIds || []) {
        const coll = parent ? `${parent}/${c}` : c;
        let pageToken = '';
        do {
          const l = must(await owner(`${base}/${coll}?pageSize=300&showMissing=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`), `list ${coll}`);
          for (const d of l.json?.documents || []) {
            const p = d.name.slice(d.name.indexOf(docsPrefix) + docsPrefix.length + 1);
            if (d.fields) out[p] = masker.maskValue(fromFields(d.fields));
            await walkCollections(p);
          }
          pageToken = l.json?.nextPageToken || '';
        } while (pageToken);
      }
    }
    await walkCollections('');
    const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
    return { docs: sorted, sha256: sha256Hex(stableJson(sorted)) };
  }

  /** Starts back proxy → API → front proxy. `authorizeFn` / `mutation` overrides are for mutation tests only;
   *  `frontFaults` (B4) comes from the trusted case table (CASE_FRONT_FAULTS), never from the Adapter. */
  async function startStack({ frontFile, backFile, authorizeFn, mutation, backendOrigin, frontSocketPath, frontFaults = null, backFaults = null } = {}) {
    const back = createTraceProxy({ role: 'back', port: PORTS.back, faults: backFaults, masker, file: backFile, route: (u) => (u.startsWith('/identitytoolkit.googleapis.com/') ? cfg.auth.origin : cfg.firestore.origin) });
    await back.listen();
    const api = createApi({ port: PORTS.api, projectId: cfg.projectId, backendOrigin: backendOrigin || `http://127.0.0.1:${PORTS.back}`, emulatorMode: true, ...(authorizeFn ? { authorizeFn } : {}), ...(mutation ? { mutation } : {}) });
    await api.listen();
    const front = createTraceProxy({ role: 'front', port: PORTS.front, socketPath: frontSocketPath || null, faults: frontFaults, masker, file: frontFile, route: () => `http://127.0.0.1:${PORTS.api}` });
    await front.listen();
    return { frontOrigin: `http://127.0.0.1:${PORTS.front}`, front, back, api, stop: async () => { await front.close(); await api.close(); await back.close(); } };
  }

  return { issuedSecrets: () => [...issued], ownedReset, seedWorld, signIn, disableAuthUser, putDoc, patchDoc, getDoc, deleteDoc, deleteField, exportState, startStack, markerIds };
}
