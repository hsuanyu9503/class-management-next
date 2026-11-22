/** A10 attacker (TEST ONLY): tries to read the platform's credentials and command files, open sockets and
 *  reach the network from inside the sandbox, and to smuggle whatever it gets out through its stdout /
 *  stderr / claim. Its self-report is NEVER used for the verdict (attack-acceptance plan v0.4 §2.2–2.3):
 *  the negative-case modes below lie on purpose to prove that.
 *  /input/a10.json: { mode, targets: [{ id, op, insidePath | name | host, port }] }
 *   exfil            (default) read / connect everything, print what was read (stdout, stderr, claim)
 *   lie-eacces       N-1 claim EACCES for every target without trying anything
 *   read-discard-lie N-2 read everything, discard it, claim EACCES, print nothing
 *   forge-list       N-3 report a forged target list (other IDs), all "DENIED"
 *   forge-net        N-4 connect to every socket / network target, but report them all as DENIED */
import fs from 'node:fs';
import net from 'node:net';

const inp = JSON.parse(fs.readFileSync('/input/a10.json', 'utf8'));
const ctl = new net.Socket({ fd: 3, readable: true, writable: true });
// READY → the Runner reads this instance's uid / capabilities / mounts from the HOST /proc → GO
let cbuf = ''; const go = new Promise((res) => ctl.on('data', (d) => { cbuf += d; if (cbuf.split('\n').includes('GO')) res(); }));
const mode = inp.mode || 'exfil';
const tryRead = (t) => { try { return t.op === 'list' ? fs.readdirSync(t.insidePath).join('\n') : t.op === 'env' ? (process.env[t.name] ?? null) : fs.readFileSync(t.insidePath, 'utf8'); } catch (e) { return { err: e.code }; } };
const tryConnect = (t) => new Promise((res) => { const s = net.connect(t.op === 'connect-unix' ? { path: t.insidePath } : { host: t.host, port: t.port }); const to = setTimeout(() => { s.destroy(); res('TIMEOUT'); }, 1500); s.once('connect', () => { clearTimeout(to); s.destroy(); res('CONNECTED'); }); s.once('error', (e) => { clearTimeout(to); res(e.code || 'ERROR'); }); });

ctl.write('READY\n');
await go;
const claim = { kind: 'credential-probe', mode, results: {}, leaked: {} };
for (const t of inp.targets) {
  const isNet = t.op === 'connect-unix' || t.op === 'connect-tcp';
  if (mode === 'lie-eacces') { claim.results[t.id] = 'EACCES'; continue; }
  if (isNet) { const r = await tryConnect(t); claim.results[t.id] = mode === 'forge-net' ? 'DENIED' : r; continue; }
  const got = tryRead(t);
  const ok = typeof got === 'string';
  if (mode === 'read-discard-lie') { claim.results[t.id] = 'EACCES'; continue; }
  claim.results[t.id] = ok ? 'READ' : got?.err ?? 'ERROR';
  if (ok && mode === 'exfil') { claim.leaked[t.id] = got; process.stderr.write(`LEAK ${t.id} ${got}\n`); }
}
if (mode === 'forge-list') claim.results = { FAKE_TARGET_1: 'DENIED', FAKE_TARGET_2: 'DENIED' };
process.stdout.write(JSON.stringify(claim));
ctl.write('DONE\n', () => process.exit(0));
