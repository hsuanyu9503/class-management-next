/** Isolation self-check — runs INSIDE the sandbox with the same config as the Adapter (plan §3.3).
 *  TRUSTED TOOLCHAIN code, mounted read-only at /check. Reads its probe list from /input/check.json and
 *  prints one JSON object with raw observations; the host side (src/b3/selfcheck-host.mjs) judges them. */
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

const input = JSON.parse(fs.readFileSync('/input/check.json', 'utf8'));
const ctl = new net.Socket({ fd: 3, readable: true, writable: true });
const exists = (p) => { try { fs.lstatSync(p); return true; } catch (e) { return e.code; } };
const tcp = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); const t = setTimeout(() => { s.destroy(); res('TIMEOUT'); }, 1500); s.once('connect', () => { clearTimeout(t); s.destroy(); res('CONNECTED'); }); s.once('error', (e) => { clearTimeout(t); res(e.code || 'ERROR'); }); });
const probe = () => new Promise((res) => { const r = http.request({ socketPath: input.entrySocket, path: '/__entry_probe', method: 'GET', timeout: 2000 }, (x) => { x.resume(); res(x.statusCode); }); r.on('error', (e) => res(e.code)); r.on('timeout', () => { r.destroy(); res('TIMEOUT'); }); r.end(); });
const status = Object.fromEntries(fs.readFileSync('/proc/self/status', 'utf8').split('\n').filter((l) => l.includes(':')).map((l) => [l.split(':')[0], l.split(':')[1].trim()]));
const ownPidNs = fs.readlinkSync('/proc/self/ns/pid');
const procPids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x));
const foreignProcs = procPids.filter((p) => { try { return fs.readlinkSync(`/proc/${p}/ns/pid`) !== ownPidNs; } catch { return false; } });
const sudo = spawnSync('/usr/bin/sudo', ['-n', 'true'], { encoding: 'utf8', timeout: 5000 });
const out = {
  ns: Object.fromEntries(['net', 'pid', 'mnt', 'ipc', 'uts'].map((n) => [n, fs.readlinkSync(`/proc/self/ns/${n}`)])),
  interfaces: fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2).filter(Boolean).map((l) => l.trim().split(':')[0]),
  tcp: {},
  entryProbe: await probe(),
  otherSockets: Object.fromEntries(input.otherSockets.map((p) => [p, exists(p)])),
  uid: process.getuid(), gid: process.getgid(),
  caps: ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map((k) => status[k]),
  noNewPrivs: status.NoNewPrivs,
  sudoExit: sudo.status, sudoError: sudo.error ? sudo.error.code : null,
  hidden: Object.fromEntries(Object.entries(input.hiddenPaths).map(([k, ps]) => [k, ps.map((p) => [p, exists(p)])])),
  procCount: procPids.length, foreignProcs: foreignProcs.length,
  dev: fs.readdirSync('/dev').sort(),
  env: Object.keys(process.env).sort(),
  mounts: fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map((l) => l.split(' ')[4]).sort(),
  // B3A-N7: per-mount options, the root listing and every file under /usr
  mountOptions: Object.fromEntries(fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map((l) => { const f = l.split(' '); return [f[4], f[5]]; })),
  rootEntries: fs.readdirSync('/').sort(),
  usrFiles: (() => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else out.push(e.isFile() ? p : `${p} (not a regular file)`); } }; walk('/usr'); return out.sort(); })(),
  outputChannels: input.outputChannels.map((p) => [p, exists(p)]),
};
for (const e of input.endpoints) out.tcp[e.port] = await tcp(e.port);
process.stdout.write(JSON.stringify(out));
ctl.write('DONE\n', () => process.exit(0));
