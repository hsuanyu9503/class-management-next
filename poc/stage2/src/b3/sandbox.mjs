/** Sandbox launcher (TRUSTED TOOLCHAIN, B3a local prototype). Requires Linux, root (to create the
 *  namespaces and mounts) and util-linux `unshare`, `pivot_root`, `setpriv`. The sandboxed program runs as
 *  uid/gid 65534 with no capabilities and no_new_privs, in fresh ipc/mnt/net/pid/uts namespaces, inside a
 *  tmpfs rootfs that only contains the policy's mount allowlist.
 *
 *  Control channel = inherited fd 3 (socketpair). Allowed messages only (plan §5):
 *    Adapter → Runner: READY, DONE      Runner → Adapter: GO
 *  Anything else is a protocol violation. */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initScript, unshareArgs, USR_BINARIES, insidePathOf, pathMapDigest } from './isolation-policy.mjs';

const fileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
/** B3A-N7: resolves the host path map for one launch: the node binary (not its installation directory) and
 *  the files copied into the sandbox /usr — USR_BINARIES plus the ldd closure of those and of node — each
 *  with its content digest. Returns { ...pathMap, pathMapDigest }. */
export function resolvePathMap({ nodeBinary, adapterDir, checkDir, entryDir }) {
  const node = realpathSync(nodeBinary);
  const libs = new Set();
  for (const b of [...USR_BINARIES, node]) {
    const out = execFileSync('ldd', [b], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    for (const m of out.matchAll(/(\/[^\s]+) \(0x[0-9a-f]+\)/g)) libs.add(m[1]);
  }
  const byInside = new Map();
  for (const src of [...USR_BINARIES, ...libs]) {
    const inside = insidePathOf(src);
    if (!inside.startsWith('/usr/')) throw new Error(`library outside /usr layout: ${src}`);
    if (!byInside.has(inside)) byInside.set(inside, { inside, source: realpathSync(src), sha256: fileSha(src) });
  }
  const usrFiles = [...byInside.values()].sort((a, b) => (a.inside < b.inside ? -1 : a.inside > b.inside ? 1 : 0));
  const pm = { adapterDir, checkDir, entryDir, nodeBinary: node, nodeBinarySha256: fileSha(node), usrFiles };
  return { ...pm, pathMapDigest: pathMapDigest(pm) };
}

const ALLOWED_FROM_ADAPTER = new Set(['READY', 'DONE']);

function childrenOf(pid) {
  try { return readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number); } catch { return []; }
}
function pidNsOf(pid) { try { return readlinkSync(`/proc/${pid}/ns/pid`); } catch { return null; } }
function processesInPidNs(ns) {
  let n = 0;
  for (const d of readdirSync('/proc')) if (/^\d+$/.test(d) && pidNsOf(d) === ns) n += 1;
  return n;
}

export function launchSandbox({ cfg, pathMap, entry }) {
  const script = initScript(cfg, pathMap, entry);
  const child = spawn('unshare', [...unshareArgs(cfg), 'sh', '-c', script], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } });
  let stdout = ''; let stderr = ''; let ctlBuf = '';
  const messages = []; const violations = []; const waiters = [];
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const ctl = child.stdio[3];
  ctl.on('data', (d) => {
    ctlBuf += d.toString('utf8');
    let i;
    while ((i = ctlBuf.indexOf('\n')) >= 0) {
      const m = ctlBuf.slice(0, i); ctlBuf = ctlBuf.slice(i + 1);
      if (!ALLOWED_FROM_ADAPTER.has(m)) { violations.push(m.slice(0, 40)); continue; }
      messages.push(m);
      for (const w of waiters.splice(0)) w();
    }
    if (ctlBuf.length > 64) { violations.push('oversized control message'); ctlBuf = ''; }
  });
  ctl.on('error', () => {});
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  let initPid = null; let pidNs = null;
  const locate = () => { if (initPid) return; const c = childrenOf(child.pid); if (c.length) { initPid = c[0]; pidNs = pidNsOf(initPid); } };

  return {
    child,
    /** Resolves true when `msg` arrived, false on timeout or exit. */
    waitFor(msg, timeoutMs) {
      return new Promise((resolve) => {
        let t = null;
        const check = () => { locate(); if (messages.includes(msg)) { if (t) clearTimeout(t); resolve(true); return true; } return false; };
        if (check()) return;
        t = setTimeout(() => resolve(false), timeoutMs);
        const loop = () => { if (!check()) waiters.push(loop); };
        waiters.push(loop);
        exited.then(() => { clearTimeout(t); resolve(messages.includes(msg)); });
      });
    },
    send(msg) { if (msg !== 'GO') throw new Error('only GO may be sent'); ctl.write(`${msg}\n`); },
    /** Kills the PID namespace's init (the kernel then kills every process in the namespace) and verifies
     *  that no process of that namespace remains. */
    async terminate({ skipKill = false } = {}) {
      locate();
      const nsBefore = pidNs;
      if (!skipKill && initPid) { try { process.kill(initPid, 'SIGKILL'); } catch { /* already gone */ } }
      // unshare reaps the namespace init and exits by itself; kill it only if it does not
      let ex = skipKill ? null : await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 5000))]);
      if (!skipKill && !ex) { try { child.kill('SIGKILL'); } catch { /* */ } ex = await Promise.race([exited, new Promise((r) => setTimeout(() => r(null), 5000))]); }
      await new Promise((r) => setTimeout(r, 200));
      const remaining = nsBefore ? processesInPidNs(nsBefore) : 0;
      return { namespaceTerminated: !!ex && remaining === 0, remainingAdapterProcesses: remaining, pidNs: nsBefore };
    },
    initFds: () => { const m = /CMN_INIT_FDS((?: \d+)*)/.exec(stderr); return m ? m[1].trim().split(/\s+/).filter(Boolean).map(Number).sort((a, b) => a - b) : null; },
    output: () => ({ stdout, stderr, messages: [...messages], violations: [...violations] }),
    exited,
  };
}

/** Removes empty rootfs mount-point directories the init script created under /tmp (mounts were private). */
export function cleanupSandboxDirs() {
  for (const d of readdirSync('/tmp')) if (d.startsWith('cmn-sbx.')) { try { rmSync(`/tmp/${d}`, { recursive: true, force: true }); } catch { /* */ } }
}
