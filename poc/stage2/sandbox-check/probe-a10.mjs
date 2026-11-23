/** A10 trusted probe — runs INSIDE the sandbox, in its OWN sandbox instance (no Adapter present), with the
 *  same config as the attacker instance (attack-acceptance plan v0.4 §2.3(1)). TRUSTED TOOLCHAIN code,
 *  mounted read-only at /check. Reads its target list from /input/a10.json and writes ONE JSON object to
 *  stdout (a pipe owned by the Runner). Contents it manages to read are discarded here, never returned.
 *
 *  Per target it reports exactly one of (C1-REV002: a probe failure is never reported as a block):
 *   READ_OK / CONNECT_OK   the operation succeeded (+ dev/ino of what was opened, for files)
 *   DENIED                 the operation was attempted and refused with an errno from the op's denial list
 *   PROBE_ERROR            anything else: unknown op, malformed target, resource exhaustion (EMFILE …),
 *                          timeout, unexpected errno — the probe could not establish the result
 *  TCP targets are connected by the IP the Runner resolved on the host (t.addr); a name is never resolved
 *  here, so a DNS failure inside cannot stand in for a refused connection to the intended target. */
import fs from 'node:fs';
import net from 'node:net';

export const PROBE_VERSION = 's2-a10-probe-v2';
/** errnos that mean "attempted and refused" per operation; everything else is PROBE_ERROR */
export const DENIAL_ERRNOS = Object.freeze({
  read: ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EROFS'],
  list: ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'],
  env: ['ABSENT'],
  'connect-unix': ['ENOENT', 'EACCES', 'EPERM', 'ECONNREFUSED', 'ENOTDIR'],
  'connect-tcp': ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM', 'EADDRNOTAVAIL'],
});
const input = JSON.parse(fs.readFileSync('/input/a10.json', 'utf8'));
const ctl = new net.Socket({ fd: 3, readable: true, writable: true });
// READY → the Runner reads this instance's uid / capabilities / mounts from the HOST /proc → GO
let cbuf = ''; const go = new Promise((res) => ctl.on('data', (d) => { cbuf += d; if (cbuf.split('\n').includes('GO')) res(); }));
const errClass = (e) => (e && typeof e.code === 'string' && /^[A-Z0-9_]{1,24}$/.test(e.code) ? e.code : 'ERROR');
const status = Object.fromEntries(fs.readFileSync('/proc/self/status', 'utf8').split('\n').filter((l) => l.includes(':')).map((l) => [l.split(':')[0], l.split(':')[1].trim()]));
const refused = (op, code) => (DENIAL_ERRNOS[op].includes(code) ? { result: 'DENIED', errnoClass: code } : { result: 'PROBE_ERROR', errnoClass: code });

function readTarget(p) {
  let fd = null;
  try { fd = fs.openSync(p, 'r'); const st = fs.fstatSync(fd); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, 0); b.fill(0); return { result: 'READ_OK', errnoClass: null, identity: { dev: String(st.dev), ino: String(st.ino) } }; }
  catch (e) { return refused('read', errClass(e)); }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* */ } }
}
function listTarget(p) {
  try { const st = fs.statSync(p); fs.readdirSync(p); return { result: 'READ_OK', errnoClass: null, identity: { dev: String(st.dev), ino: String(st.ino) } }; }
  catch (e) { return refused('list', errClass(e)); }
}
const connect = (op, opts) => new Promise((res) => {
  const s = net.connect(opts); const t = setTimeout(() => { s.destroy(); res({ result: 'PROBE_ERROR', errnoClass: 'TIMEOUT' }); }, 3000);
  s.once('connect', () => { clearTimeout(t); s.destroy(); res({ result: 'CONNECT_OK', errnoClass: null }); });
  s.once('error', (e) => { clearTimeout(t); res(refused(op, errClass(e))); });
});

const okPath = (p) => typeof p === 'string' && p.startsWith('/') && p.length < 4096;
const results = {};
ctl.write('READY\n');
await go;
for (const t of input.targets) {
  if (input.skip && input.skip.includes(t.id)) continue;            // test harness only (N-7: a probe that omits a target)
  if (t.op === 'read' && okPath(t.insidePath)) results[t.id] = readTarget(t.insidePath);
  else if (t.op === 'list' && okPath(t.insidePath)) results[t.id] = listTarget(t.insidePath);
  else if (t.op === 'env' && typeof t.name === 'string') results[t.id] = Object.hasOwn(process.env, t.name) ? { result: 'READ_OK', errnoClass: null } : { result: 'DENIED', errnoClass: 'ABSENT' };
  else if (t.op === 'connect-unix' && okPath(t.insidePath)) results[t.id] = await connect('connect-unix', { path: t.insidePath });
  else if (t.op === 'connect-tcp' && net.isIP(t.addr || '') && Number.isInteger(t.port)) results[t.id] = await connect('connect-tcp', { host: t.addr, port: t.port });
  else results[t.id] = { result: 'PROBE_ERROR', errnoClass: 'UNKNOWN_OP_OR_TARGET' };
}
process.stdout.write(JSON.stringify({ probeVersion: PROBE_VERSION, results, self: { uid: process.getuid(), gid: process.getgid(), caps: ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map((k) => status[k]), noNewPrivs: status.NoNewPrivs } }));
ctl.write('DONE\n', () => process.exit(0));
