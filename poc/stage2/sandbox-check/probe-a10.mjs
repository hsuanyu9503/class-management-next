/** A10 trusted probe — runs INSIDE the sandbox, in its OWN sandbox instance (no Adapter present), with the
 *  same config as the attacker instance (attack-acceptance plan v0.4 §2.3(1)). TRUSTED TOOLCHAIN code,
 *  mounted read-only at /check. Reads its target list from /input/a10.json and writes ONE JSON object to
 *  stdout (a pipe owned by the Runner). Contents it manages to read are discarded here, never returned:
 *  the result per target is only DENIED / READ_OK / CONNECT_OK, an errno class and (on success) the
 *  device/inode of what was opened, so the Runner can check it reached the same object. */
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';

export const PROBE_VERSION = 's2-a10-probe-v1';
const input = JSON.parse(fs.readFileSync('/input/a10.json', 'utf8'));
const ctl = new net.Socket({ fd: 3, readable: true, writable: true });
// READY → the Runner reads this instance's uid / capabilities / mounts from the HOST /proc → GO
let cbuf = ''; const go = new Promise((res) => ctl.on('data', (d) => { cbuf += d; if (cbuf.split('\n').includes('GO')) res(); }));
const errClass = (e) => (e && typeof e.code === 'string' && /^[A-Z0-9_]{1,24}$/.test(e.code) ? e.code : 'ERROR');
const status = Object.fromEntries(fs.readFileSync('/proc/self/status', 'utf8').split('\n').filter((l) => l.includes(':')).map((l) => [l.split(':')[0], l.split(':')[1].trim()]));

function readTarget(p) {
  let fd = null;
  try { fd = fs.openSync(p, 'r'); const st = fs.fstatSync(fd); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, 0); b.fill(0); return { result: 'READ_OK', errnoClass: null, identity: { dev: String(st.dev), ino: String(st.ino) } }; }
  catch (e) { return { result: 'DENIED', errnoClass: errClass(e) }; }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* */ } }
}
function listTarget(p) {
  try { const st = fs.statSync(p); fs.readdirSync(p); return { result: 'READ_OK', errnoClass: null, identity: { dev: String(st.dev), ino: String(st.ino) } }; }
  catch (e) { return { result: 'DENIED', errnoClass: errClass(e) }; }
}
const connect = (opts) => new Promise((res) => {
  const s = net.connect(opts); const t = setTimeout(() => { s.destroy(); res({ result: 'DENIED', errnoClass: 'TIMEOUT' }); }, 2000);
  s.once('connect', () => { clearTimeout(t); s.destroy(); res({ result: 'CONNECT_OK', errnoClass: null }); });
  s.once('error', (e) => { clearTimeout(t); res({ result: 'DENIED', errnoClass: errClass(e) }); });
});
async function tcpTarget(host, port) {
  let addr = host;
  if (!net.isIP(host)) { try { addr = (await dns.promises.lookup(host)).address; } catch (e) { return { result: 'DENIED', errnoClass: errClass(e) }; } }
  return connect({ host: addr, port });
}

ctl.write('READY\n');
await go;
const results = {};
for (const t of input.targets) {
  if (input.skip && input.skip.includes(t.id)) continue;            // test harness only (N-7: a probe that omits a target)
  if (t.op === 'read') results[t.id] = readTarget(t.insidePath);
  else if (t.op === 'list') results[t.id] = listTarget(t.insidePath);
  else if (t.op === 'env') results[t.id] = Object.hasOwn(process.env, t.name) ? { result: 'READ_OK', errnoClass: null } : { result: 'DENIED', errnoClass: 'ABSENT' };
  else if (t.op === 'connect-unix') results[t.id] = await connect({ path: t.insidePath });
  else if (t.op === 'connect-tcp') results[t.id] = await tcpTarget(t.host, t.port);
  else results[t.id] = { result: 'DENIED', errnoClass: 'UNKNOWN_OP' };
}
process.stdout.write(JSON.stringify({ probeVersion: PROBE_VERSION, results, self: { uid: process.getuid(), gid: process.getgid(), caps: ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map((k) => status[k]), noNewPrivs: status.NoNewPrivs } }));
ctl.write('DONE\n', () => process.exit(0));
