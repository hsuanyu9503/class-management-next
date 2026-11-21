/** A7: try to read or change the attestation marker before / during the case (API op and direct TCP). */
import net from 'node:net';
import { input, ready, waitGo, done, honest, call } from '../client.mjs';
const inp = input();
const tcp = await new Promise((res) => { const s = net.connect(8080, '127.0.0.1'); s.once('connect', () => { s.destroy(); res('CONNECTED'); }); s.once('error', (e) => res(e.code)); });
ready(); await waitGo();
const tok = Object.values(inp.tokens)[0];
const viaApi = await call(tok, { op: 'attestationRun.read', target: { runId: '1' }, claimedScope: { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' } });
done({ ...(await honest(inp)), attack: { kind: 'nonce-probe', tcpBeforeReady: tcp, apiStatus: viaApi.status, apiCode: viaApi.body?.code } });
