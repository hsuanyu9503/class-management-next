/** Host side of the isolation self-check (TRUSTED TOOLCHAIN, B3a). Runs the in-sandbox probe with the SAME
 *  config as the Adapter, performs the positive controls on the host at the same time, and judges every
 *  check ID of s2-isolation-policy-v1. An errno alone is never accepted as proof (plan §3.3). */
import net from 'node:net';
import { existsSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { CHECK_IDS, POSITIVE_CONTROL_REQUIRED, ENDPOINTS, SENTINEL_TCP_PORT, DEV_ALLOWLIST, ENV_ALLOWLIST, INHERITED_FDS, MOUNT_TARGETS, configDigest } from './isolation-policy.mjs';
import { launchSandbox } from './sandbox.mjs';

const tcpHost = (port) => new Promise((res) => { const s = net.connect(port, '127.0.0.1'); const t = setTimeout(() => { s.destroy(); res(false); }, 1500); s.once('connect', () => { clearTimeout(t); s.destroy(); res(true); }); s.once('error', () => { clearTimeout(t); res(false); }); });
const blocked = (v) => v !== 'CONNECTED';
const hiddenCode = (v) => v !== true;     // lstat failed inside the sandbox

export function platformSupport() {
  if (process.platform !== 'linux') return { supported: false, reason: 'not linux' };
  if (process.getuid() !== 0) return { supported: false, reason: 'runner is not root (namespaces/mounts need root in this prototype)' };
  for (const b of ['unshare', 'setpriv', 'pivot_root']) if (spawnSync('sh', ['-c', `command -v ${b}`]).status !== 0) return { supported: false, reason: `${b} missing` };
  return { supported: true };
}

/** @param o.cfg sandbox config (normally sandboxConfig())
 *  @param o.pathMap {nodeDir, adapterDir, checkDir, entryDir, inputDir}
 *  @param o.hostPaths {evidence:[], toolchain:[], git:[]} host paths that must exist on the host and be invisible inside
 *  @param o.outputChannels host files standing for GITHUB_OUTPUT etc.
 *  @param o.workDir runner-private dir for sentinels
 *  @param o.startSentinel false only in the A16 test (sentinel deliberately absent) */
export async function runSelfCheck({ cfg, pathMap, hostPaths, outputChannels, workDir, startSentinel = true, endpoints = ENDPOINTS }) {
  const support = platformSupport();
  if (!support.supported) return { platformSupported: false, reason: support.reason, selfCheck: null, sandboxPolicyDigest: configDigest(cfg) };
  mkdirSync(workDir, { recursive: true });
  // Unix socket paths are limited to ~107 bytes: the runner-private socket dir must be short (e.g. /tmp/cmn-r-XXXX)
  const sentinelSock = path.join(workDir, 'sentinel.sock');
  rmSync(sentinelSock, { force: true });
  const servers = [];
  if (startSentinel) {
    for (const target of [SENTINEL_TCP_PORT, sentinelSock]) {
      const srv = net.createServer((s) => s.destroy());
      await new Promise((r, j) => { srv.once('error', j); typeof target === 'number' ? srv.listen(target, '127.0.0.1', r) : srv.listen(target, r); });
      servers.push(srv);
    }
  }
  const otherSockets = [sentinelSock];
  const checkInputDir = path.join(workDir, 'check-input');
  mkdirSync(checkInputDir, { recursive: true });
  writeFileSync(path.join(checkInputDir, 'check.json'), JSON.stringify({ endpoints, entrySocket: cfg.entrySocket, otherSockets, hiddenPaths: hostPaths, outputChannels }));
  const hostSocketsExist = otherSockets.every((p) => existsSync(p));
  const sbx = launchSandbox({ cfg, pathMap: { ...pathMap, inputDir: checkInputDir }, entry: '/check/selfcheck.mjs' });
  // host-side positive controls, concurrently
  const hostTcp = {}; for (const e of endpoints) hostTcp[e.port] = await tcpHost(e.port);
  const done = await sbx.waitFor('DONE', cfg.limits.readyTimeoutMs);
  const term = await sbx.terminate();
  for (const s of servers) await new Promise((r) => s.close(r));
  rmSync(sentinelSock, { force: true });
  const o = sbx.output();
  let inside = null; try { inside = JSON.parse(o.stdout); } catch { /* */ }
  const hostNs = Object.fromEntries(['net', 'pid', 'mnt', 'ipc', 'uts'].map((n) => [n, readlinkSync(`/proc/self/ns/${n}`)]));
  const hostCanElevate = process.getuid() === 0 || spawnSync('sudo', ['-n', 'true']).status === 0;
  const fds = sbx.initFds();
  const C = {};
  const set = (id, ok, observed, pos = null) => { C[id] = { ok: !!ok, observed: String(observed).slice(0, 200), positiveControlOk: pos }; };
  if (!inside || !done) {
    for (const id of CHECK_IDS) set(id, false, `self-check did not complete (done=${done}, violations=${o.violations.join('|')})`, POSITIVE_CONTROL_REQUIRED.includes(id) ? false : null);
  } else {
    for (const n of ['net', 'pid', 'mnt', 'ipc', 'uts']) set(`NS_${n.toUpperCase()}_DISTINCT`, inside.ns[n] !== hostNs[n], `${inside.ns[n]} vs host ${hostNs[n]}`, true);
    set('NET_NO_INTERFACES', inside.interfaces.length === 1 && inside.interfaces[0] === 'lo', inside.interfaces.join(','));
    const expected = endpoints.filter((e) => e.expect === 'listening');
    const posOk = expected.every((e) => hostTcp[e.port] === true) && endpoints.some((e) => e.kind === 'sentinel');
    set('HOST_ENDPOINTS_BLOCKED', endpoints.every((e) => blocked(inside.tcp[e.port])), endpoints.map((e) => `${e.port}:${inside.tcp[e.port]}/host:${hostTcp[e.port]}`).join(' '), posOk);
    set('ENTRY_SOCKET_REACHABLE', inside.entryProbe === 204, `probe=${inside.entryProbe}`);
    set('NO_OTHER_SOCKETS', otherSockets.every((p) => hiddenCode(inside.otherSockets[p])), JSON.stringify(inside.otherSockets), hostSocketsExist);
    set('UID_NONROOT', inside.uid !== 0 && inside.gid !== 0, `uid=${inside.uid} gid=${inside.gid}`);
    set('NO_CAPS', inside.caps.every((c) => /^0+$/.test(c || '')), inside.caps.join(','));
    set('NO_NEW_PRIVS', inside.noNewPrivs === '1', `NoNewPrivs=${inside.noNewPrivs}`);
    set('NO_SUDO', inside.sudoExit !== 0, `sudo exit=${inside.sudoExit} err=${inside.sudoError}`, hostCanElevate);
    for (const [id, key] of [['FS_EVIDENCE_HIDDEN', 'evidence'], ['FS_TOOLCHAIN_HIDDEN', 'toolchain'], ['FS_GIT_HIDDEN', 'git']]) {
      const list = inside.hidden[key] || [];
      set(id, list.length > 0 && list.every(([, v]) => hiddenCode(v)), JSON.stringify(list), (hostPaths[key] || []).length > 0 && hostPaths[key].every((p) => existsSync(p)));
    }
    set('PROC_ISOLATED', inside.foreignProcs === 0, `procs=${inside.procCount} foreign=${inside.foreignProcs}`);
    set('DEV_ALLOWLIST', JSON.stringify(inside.dev) === JSON.stringify([...DEV_ALLOWLIST].sort()), inside.dev.join(','));
    set('ENV_ALLOWLIST', JSON.stringify(inside.env) === JSON.stringify([...ENV_ALLOWLIST].sort()), inside.env.join(','));
    set('FD_ALLOWLIST', !!fds && JSON.stringify(fds) === JSON.stringify([...INHERITED_FDS]), `init fds=${fds}`);
    set('MOUNT_ALLOWLIST', JSON.stringify(inside.mounts) === JSON.stringify([...MOUNT_TARGETS].sort()), inside.mounts.join(','));
    set('OUTPUT_CHANNELS_HIDDEN', inside.outputChannels.length > 0 && inside.outputChannels.every(([, v]) => hiddenCode(v)), JSON.stringify(inside.outputChannels), outputChannels.length > 0 && outputChannels.every((p) => existsSync(p)));
  }
  return { platformSupported: true, selfCheck: C, sandboxPolicyDigest: configDigest(cfg), termination: term, violations: o.violations };
}
