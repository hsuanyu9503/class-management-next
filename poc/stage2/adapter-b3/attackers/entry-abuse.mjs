/** A11: malformed, oversized and credential-shaped requests through the single entry, then honest. */
import { input, ready, waitGo, done, honest, call } from '../client.mjs';
const inp = input(); ready(); await waitGo();
const tok = Object.values(inp.tokens)[0];
const r = [];
r.push(await call(tok, null, { raw: '{not json' }));
r.push(await call(tok, null, { raw: JSON.stringify({ op: 'attendanceSession.read', target: { sessionId: 'x'.repeat(60000) } }) }));
r.push(await call(tok, { op: 'toString', target: { sessionId: 'S' }, claimedScope: { workspaceId: 'W', classId: 'C' } }));
r.push(await call(tok, { op: 'attendanceSession.read', target: { sessionId: 'S' }, authorization: 'Bearer ' + ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJBMTEifQ', ''].join('.') }));
done({ ...(await honest(inp)), attack: { kind: 'entry-abuse', statuses: r.map((x) => x.status) } });
