/** s2-isolation-policy-v1 (S2B2-B3-PLAN v0.3 §3.3). TRUSTED TOOLCHAIN — B3a local prototype.
 *
 *  The sandbox configuration is LOGICAL: host source paths are bound at launch time from a path map, but
 *  the digest covers only what the policy fixes (namespaces, uid/gid, capabilities, no_new_privs, rootfs
 *  layout, mount allowlist with flags, /proc, /dev, entry socket, env allowlist, inherited fds, limits).
 *  The init script is generated FROM this config, so a different launch parameter is a different digest.
 *  The Verifier regenerates the expected config from this module at the trusted toolchain commit. */
import { createHash } from 'node:crypto';
import { stableJson } from '../stable.mjs';

export const POLICY_VERSION = 's2-isolation-policy-v1';
export const SANDBOX_UID = 65534;
export const SANDBOX_GID = 65534;

export const CHECK_IDS = Object.freeze([
  'NS_NET_DISTINCT', 'NS_PID_DISTINCT', 'NS_MNT_DISTINCT', 'NS_IPC_DISTINCT', 'NS_UTS_DISTINCT',
  'NET_NO_INTERFACES', 'HOST_ENDPOINTS_BLOCKED', 'ENTRY_SOCKET_REACHABLE', 'NO_OTHER_SOCKETS',
  'UID_NONROOT', 'NO_CAPS', 'NO_NEW_PRIVS', 'NO_SUDO',
  'FS_EVIDENCE_HIDDEN', 'FS_TOOLCHAIN_HIDDEN', 'FS_GIT_HIDDEN',
  'PROC_ISOLATED', 'DEV_ALLOWLIST', 'ENV_ALLOWLIST', 'FD_ALLOWLIST', 'MOUNT_ALLOWLIST', 'OUTPUT_CHANNELS_HIDDEN',
]);

/** Endpoints for HOST_ENDPOINTS_BLOCKED (plan §3.3 "端點清單與 sentinel"). front is a Unix socket → not listed. */
export const SENTINEL_TCP_PORT = 18399;
export const ENDPOINTS = Object.freeze([
  { name: 'firestore', port: 8080, kind: 'service', expect: 'listening' },
  { name: 'auth', port: 9099, kind: 'service', expect: 'listening' },
  { name: 'hub', port: 4400, kind: 'service', expect: 'listening' },
  { name: 'logging', port: 4500, kind: 'service', expect: 'listening' },
  { name: 'firestore-ws', port: 9150, kind: 'service', expect: 'listening' },
  { name: 'api', port: 18300, kind: 'service', expect: 'listening' },
  { name: 'back-proxy', port: 18302, kind: 'service', expect: 'listening' },
  { name: 'sentinel', port: SENTINEL_TCP_PORT, kind: 'sentinel', expect: 'listening' },
]);

/** B3A-N3: checks that MUST carry a host-side positive control (positiveControlOk === true); every other
 *  check must report positiveControlOk === null. Not part of the sandbox config → configDigest unchanged. */
export const POSITIVE_CONTROL_REQUIRED = Object.freeze([
  'NS_NET_DISTINCT', 'NS_PID_DISTINCT', 'NS_MNT_DISTINCT', 'NS_IPC_DISTINCT', 'NS_UTS_DISTINCT',
  'HOST_ENDPOINTS_BLOCKED', 'NO_OTHER_SOCKETS', 'NO_SUDO', 'FS_EVIDENCE_HIDDEN', 'FS_TOOLCHAIN_HIDDEN', 'FS_GIT_HIDDEN', 'OUTPUT_CHANNELS_HIDDEN',
]);
export const ENV_ALLOWLIST = Object.freeze(['HOME', 'PATH']);
export const DEV_ALLOWLIST = Object.freeze(['null', 'urandom', 'zero']);
export const INHERITED_FDS = Object.freeze([0, 1, 2, 3]);      // stdin, stdout, stderr, control
export const MOUNT_TARGETS = Object.freeze(['/', '/usr', '/opt/node/bin/node', '/adapter', '/check', '/input', '/entry', '/work', '/dev', '/dev/null', '/dev/zero', '/dev/urandom', '/proc']);
/** B3A-N7: host binaries copied into the sandbox's /usr (plus the ldd closure of these and of the node binary).
 *  No host /etc, no host /usr tree, no node installation directory — only the node binary itself. */
export const USR_BINARIES = Object.freeze(['/usr/bin/env', '/usr/bin/rmdir', '/usr/bin/setpriv', '/usr/bin/umount']);

/** The logical sandbox configuration fixed by the policy. `overrides` exists ONLY so tests can prove that a
 *  changed launch parameter changes the digest (A15); the runner never passes overrides. */
export function sandboxConfig(overrides = {}) {
  return {
    policyVersion: POLICY_VERSION,
    namespaces: ['ipc', 'mnt', 'net', 'pid', 'uts'],
    uid: SANDBOX_UID, gid: SANDBOX_GID, supplementaryGroups: [],
    capabilities: { inheritable: 'none', ambient: 'none', bounding: 'none', effective: 'none', permitted: 'none' },
    noNewPrivs: true,
    rootfs: 'tmpfs-pivot_root',
    symlinks: { '/bin': 'usr/bin', '/lib': 'usr/lib', '/lib64': 'usr/lib64', '/sbin': 'usr/sbin' },
    // B3A-N7: /usr is a read-only tmpfs holding only USR_BINARIES and their libraries (pathMap.usrFiles);
    // there is no /etc; /opt/node holds only the node binary (file bind)
    usrPopulation: { binaries: [...USR_BINARIES], libraries: 'ldd-closure(binaries + nodeBinary)', layout: '/lib|/lib64|/bin|/sbin -> /usr/*', copy: 'dereference' },
    mounts: [
      { target: '/usr', source: 'tmpfs', mode: 'ro', flags: ['nodev', 'nosuid'], tmpfs: { size: '64m', mode: '755' }, populate: 'pathmap:usrFiles' },
      { target: '/opt/node/bin/node', source: 'pathmap:nodeBinary', mode: 'ro', file: true, flags: ['nodev', 'nosuid'] },
      { target: '/adapter', source: 'pathmap:adapterDir', mode: 'ro', flags: ['nodev', 'nosuid'] },
      { target: '/check', source: 'pathmap:checkDir', mode: 'ro', flags: ['nodev', 'nosuid'] },
      { target: '/input', source: 'pathmap:inputDir', mode: 'ro', flags: ['nodev', 'nosuid'] },
      { target: '/entry', source: 'pathmap:entryDir', mode: 'rw', flags: ['nodev', 'noexec', 'nosuid'] },
      { target: '/work', source: 'tmpfs', mode: 'rw', flags: ['nodev', 'nosuid'], tmpfs: { size: '64m', mode: '700', uid: SANDBOX_UID, gid: SANDBOX_GID } },
      { target: '/dev', source: 'tmpfs', mode: 'rw', flags: ['nosuid'], tmpfs: { size: '1m', mode: '755' }, devices: [...DEV_ALLOWLIST] },
      { target: '/proc', source: 'proc', mode: 'rw', flags: ['nodev', 'noexec', 'nosuid'] },
    ],
    entrySocket: '/entry/front.sock',
    env: { HOME: '/work', PATH: '/usr/bin' },
    inheritedFds: [...INHERITED_FDS],
    limits: { readyTimeoutMs: 60000, caseTimeoutMs: 120000 },
    ...overrides,
  };
}

export const configDigest = (cfg) => createHash('sha256').update(stableJson(cfg)).digest('hex');

/** B3A-N7: top-level names the sandbox root must contain — exactly the symlinks and the first segment of
 *  every mount target (nothing else). */
export const expectedRootEntries = (cfg) => [...new Set([...Object.keys(cfg.symlinks).map((l) => l.slice(1)), ...cfg.mounts.map((m) => m.target.split('/')[1])])].sort();
/** Path inside the sandbox for a host library path reported by ldd (/lib → /usr/lib etc., via the symlinks). */
export const insidePathOf = (p) => p.replace(/^\/(lib|lib64|bin|sbin)\//, '/usr/$1/');
/** B3A-N7: digest of the host path map the launch used (host-dependent, so NOT in configDigest). Covers every
 *  host source directory and, for copied/bound files, their content digests; recorded in isolation.json and
 *  the statement so the launch is reproducible and auditable. */
export const PATH_MAP_KEYS = Object.freeze(['adapterDir', 'checkDir', 'entryDir', 'nodeBinary', 'nodeBinarySha256', 'usrFiles']);
export const pathMapDigest = (pm) => createHash('sha256').update(stableJson(Object.fromEntries(PATH_MAP_KEYS.map((k) => [k, pm?.[k] ?? null])))).digest('hex');

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** Generates the init script (run as root inside the new namespaces) from the config + host path map. */
export function initScript(cfg, pathMap, entry) {
  const src = (m) => (m.source.startsWith('host:') ? m.source.slice(5) : m.source.startsWith('pathmap:') ? pathMap[m.source.slice(8)] : null);
  const L = ['set -eu', 'R=$(mktemp -d /tmp/cmn-sbx.XXXXXX)', 'mount --make-rprivate /', 'mount -t tmpfs -o mode=755 tmpfs "$R"'];
  for (const [link, to] of Object.entries(cfg.symlinks)) L.push(`ln -s ${q(to)} "$R"${q(link)}`);
  for (const m of cfg.mounts) {
    if (m.file) L.push(`mkdir -p "$R"${q(m.target.slice(0, m.target.lastIndexOf('/')))}`, `touch "$R"${q(m.target)}`);
    else L.push(`mkdir -p "$R"${q(m.target)}`);
    if (m.source === 'tmpfs') {
      const o = [`size=${m.tmpfs.size}`, `mode=${m.tmpfs.mode}`, ...(m.tmpfs.uid !== undefined ? [`uid=${m.tmpfs.uid}`, `gid=${m.tmpfs.gid}`] : []), ...m.flags].join(',');
      L.push(`mount -t tmpfs -o ${o} tmpfs "$R"${q(m.target)}`);
      for (const d of m.devices || []) L.push(`touch "$R"${q(`${m.target}/${d}`)}`, `mount --bind ${q(`/dev/${d}`)} "$R"${q(`${m.target}/${d}`)}`);
      if (m.populate) {
        const files = pathMap[m.populate.slice(8)];
        if (!Array.isArray(files) || !files.length) throw new Error(`no files to populate ${m.target}`);
        for (const f of files) {
          if (!f.inside.startsWith(`${m.target}/`)) throw new Error(`populate path outside ${m.target}: ${f.inside}`);
          L.push(`mkdir -p "$R"${q(f.inside.slice(0, f.inside.lastIndexOf('/')))}`, `cp -L ${q(f.source)} "$R"${q(f.inside)}`);
        }
      }
      if (m.mode === 'ro') L.push(`mount -o remount,ro,${m.flags.join(',')} "$R"${q(m.target)}`);
    } else if (m.source === 'proc') {
      L.push(`mount -t proc -o ${m.flags.join(',')} proc "$R"${q(m.target)}`);
    } else {
      const s = src(m); if (!s) throw new Error(`no source for ${m.target}`);
      L.push(`mount --bind ${q(s)} "$R"${q(m.target)}`, `mount -o remount,bind,${m.mode},${m.flags.join(',')} "$R"${q(m.target)}`);
    }
  }
  L.push('mkdir "$R/oldroot"', 'cd "$R"', 'pivot_root . oldroot', 'umount -l /oldroot', 'rmdir /oldroot', 'cd /');
  // FD_ALLOWLIST evidence: the init shell's own fds right before exec (glob, no subshell, no pipe)
  // second pass drops the directory fd the glob itself held while reading /proc/$$/fd
  L.push('names=""; for f in /proc/$$/fd/*; do names="$names ${f##*/}"; done; fds=""; for n in $names; do [ -e "/proc/$$/fd/$n" ] && fds="$fds $n"; done; echo "CMN_INIT_FDS$fds" >&2');
  const caps = cfg.capabilities.inheritable === 'none' ? '--inh-caps=-all --ambient-caps=-all --bounding-set=-all' : '';
  const env = Object.entries(cfg.env).map(([k, v]) => q(`${k}=${v}`)).join(' ');
  L.push(`exec /usr/bin/setpriv --reuid ${cfg.uid} --regid ${cfg.gid} --clear-groups ${caps} ${cfg.noNewPrivs ? '--no-new-privs' : ''} /usr/bin/env -i ${env} /opt/node/bin/node ${q(entry)}`);
  return L.join('\n');
}

export function unshareArgs(cfg) {
  const flag = { ipc: '--ipc', mnt: '--mount', net: '--net', pid: '--pid', uts: '--uts' };
  return [...cfg.namespaces.map((n) => flag[n]), '--fork'];
}
