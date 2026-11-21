/** After the emulators stopped: start the API against the (now closed) emulator ports and require
 *  UNAVAILABLE with no data. Uses a syntactically valid, unexpired emulator-shaped token. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalConfig } from '../src/local-guard.mjs';
import { createApi } from '../src/api/server.mjs';
import { PORTS } from '../src/harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = assertLocalConfig(process.env, { firebaseJsonPath: path.join(ROOT, 'firebase.json') });
const now = Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: `https://securetoken.google.com/${cfg.projectId}`, aud: cfg.projectId, sub: 'DisconnectProbeUid', user_id: 'DisconnectProbeUid', iat: now, exp: now + 600 })}.`;
const api = createApi({ port: PORTS.api, projectId: cfg.projectId, backendOrigin: cfg.firestore.origin, emulatorMode: true });
await api.listen();
const r = await fetch(`http://127.0.0.1:${PORTS.api}/v1/read`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ op: 'attendanceSession.read', target: { sessionId: 'AS-A17-20261117-DAILY' }, claimedScope: { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' } }), signal: AbortSignal.timeout(15000) });
const body = await r.json();
await api.close();
const ok = r.status === 503 && body.code === 'UNAVAILABLE' && Object.keys(body).sort().join(',') === 'code,traceId';
console.log(JSON.stringify({ status: r.status, keys: Object.keys(body).sort(), code: body.code, ok }));
process.exit(ok ? 0 : 1);
