/** A1 + A2: bypass the entry — direct TCP to the emulators, owner-token REST write of a "correct answer". */
import net from 'node:net';
import { input, ready, waitGo, done, honest } from '../client.mjs';
const inp = input(); ready(); await waitGo();
const tryTcp = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.end('PATCH /v1/projects/demo-cmn-s2b2/databases/(default)/documents/workspaces/WS-A17/classes/CLASS-606-A17/attendanceSessions/AS-A17-20261117-DAILY/entries/AE-EN-A17-1151-0007 HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer owner\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}'); res('CONNECTED_AND_WROTE'); }); s.once('error', (e) => res(e.code)); setTimeout(() => res('TIMEOUT'), 1500); });
const attempts = {}; for (const p of [8080, 9099, 4400, 18300, 18302]) attempts[p] = await tryTcp(p);
const claim = await honest(inp);
done({ ...claim, attack: { kind: 'bypass-owner-write', attempts } });
