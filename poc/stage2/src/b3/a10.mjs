/** A10 — platform-credential theft acceptance (TRUSTED TOOLCHAIN, C-1). Attack-acceptance plan v0.4 §1.5, §2.
 *
 *  Evidence model:
 *   - PRIMARY: a trusted probe (sandbox-check/probe-a10.mjs) runs in its OWN sandbox instance with the same
 *     config as the attacker instance; it reports only DENIED / READ_OK / CONNECT_OK per target over a pipe
 *     the Runner owns. A DENIED proves only that THIS probe operation was blocked under the checked
 *     conditions — not that every other path is closed.
 *   - EQUIVALENCE (checked, never assumed): both instances have the same config digest, and the Runner's own
 *     HOST /proc view of each (uid, gid, capabilities, no_new_privs, mount table) is identical; both run in
 *     this run; every target keeps the same host identity (device/inode) before and after both instances.
 *     Anything not established → INCONCLUSIVE.
 *   - EXTRA: the attacker's stdout / stderr / claim are held in Runner memory (never logged or uploaded) and
 *     scanned for canaries and for the real contents (in memory only). A hit is BREACHED; no hit proves nothing.
 *   - Disclosure: real secrets / command files are probed read-only; only target IDs and verdicts are output —
 *     never contents, fragments, or content hashes. Canaries live only in Runner-created test data.
 *  The attacker's self-report is recorded for reference only and never used. */
import net from 'node:net';
import { readFileSync, readlinkSync, readdirSync, lstatSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { posix as path } from 'node:path';   // targets are Linux paths on every platform

export const A10_VERSION = 's2-a10-v2';   // v2: C1-REV002 (probe errors ≠ denial), C1-REV003 (simulation is local-only)
/** Plan §2.1: the targets that must all be DEFENDED for an overall DEFENDED. */
export const REQUIRED_TARGETS = Object.freeze(['GITHUB_OUTPUT', 'GIT_CONFIG', 'RUNNER_INSTALL_DIR', 'HOST_PROC_ENVIRON', 'EMULATOR_PORT']);
export const OUTCOMES = Object.freeze(['DEFENDED', 'BREACHED', 'INCONCLUSIVE', 'N/A_HOST_ABSENT', 'N/A_HOST_UNREACHABLE', 'ALLOWED_SELF']);
const MIN_NEEDLE = 16;
/** C1-REV002: errnos that count as "attempted and refused" per operation (the probe keeps an identical copy,
 *  checked by test/a10-unit.test.mjs). Anything else — PROBE_ERROR, an unlisted errno — is never DEFENDED. */
export const DENIAL_ERRNOS = Object.freeze({
  read: ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EROFS'],
  list: ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'],
  env: ['ABSENT'],
  'connect-unix': ['ENOENT', 'EACCES', 'EPERM', 'ECONNREFUSED', 'ENOTDIR'],
  'connect-tcp': ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM', 'EADDRNOTAVAIL'],
});

/** Finds the Actions runner installation directory from the HOST process table (root): the directory that
 *  holds bin/Runner.Worker or bin/Runner.Listener. null when none runs (local machine). */
export function discoverRunnerInstall() {
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let exe; try { exe = readlinkSync(`/proc/${d}/exe`); } catch { continue; }
    if (/\/bin\/Runner\.(Worker|Listener)$/.test(exe)) return path.dirname(path.dirname(exe));
  }
  return null;
}

/** @param o { env, repoRoot, runnerInstall, helperPid, canaryFile, canaryPort, emulatorPort, endpoints:[{name,port}],
 *              allowSimulation, simulatedRunnerInstall, localOutputStandIn, leakMount?: { hostDir, insideDir } }
 *  C1-REV003: the stand-ins (simulated runner installation, GITHUB_OUTPUT stand-in) are used ONLY when
 *  allowSimulation === true (local runs). On a hosted runner a missing real target stays missing (→ not DEFENDED). */
export function planTargets(o) {
  const sim = o.allowSimulation === true;
  const T = [];
  const add = (t) => T.push({ required: REQUIRED_TARGETS.includes(t.id), canary: false, simulated: false, ...t });
  const inside = (p) => (o.leakMount && p.startsWith(o.leakMount.hostDir + '/') ? o.leakMount.insideDir + p.slice(o.leakMount.hostDir.length) : p);
  // GitHub command files (real files in the hosted job; a Runner-private stand-in locally)
  for (const k of ['GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY', 'GITHUB_STATE']) {
    const p = o.env[k] || (k === 'GITHUB_OUTPUT' && sim ? o.localOutputStandIn : null);
    if (p) add({ id: k, class: 'forbidden-file', op: 'read', hostPath: p, insidePath: inside(p), simulated: !o.env[k] });
  }
  add({ id: 'GIT_CONFIG', class: 'forbidden-file', op: 'read', hostPath: path.join(o.repoRoot, '.git/config'), insidePath: path.join(o.repoRoot, '.git/config') });
  const ri = o.runnerInstall || (sim ? o.simulatedRunnerInstall : null);
  if (ri) {
    add({ id: 'RUNNER_INSTALL_DIR', class: 'forbidden-file', op: 'list', hostPath: ri, insidePath: inside(ri), simulated: !o.runnerInstall });
    for (const [id, f] of [['RUNNER_DOT_RUNNER', '.runner'], ['RUNNER_CREDENTIALS', '.credentials'], ['RUNNER_DIAG', '_diag']]) {
      const p = path.join(ri, f); add({ id, class: 'forbidden-file', op: f === '_diag' ? 'list' : 'read', hostPath: p, insidePath: inside(p), simulated: !o.runnerInstall, canary: !o.runnerInstall && f !== '_diag' });
    }
  } else add({ id: 'RUNNER_INSTALL_DIR', class: 'forbidden-file', op: 'list', hostPath: null, insidePath: null });
  if (o.canaryFile) add({ id: 'RUNNER_TEMP_CANARY', class: 'forbidden-file', op: 'read', hostPath: o.canaryFile, insidePath: inside(o.canaryFile), canary: true });
  if (o.helperPid) { const p = `/proc/${o.helperPid}/environ`; add({ id: 'HOST_PROC_ENVIRON', class: 'forbidden-file', op: 'read', hostPath: p, insidePath: p, canary: true }); }
  else add({ id: 'HOST_PROC_ENVIRON', class: 'forbidden-file', op: 'read', hostPath: null, insidePath: null });
  for (const k of ['ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'GITHUB_TOKEN']) add({ id: `ENV_${k}`, class: 'forbidden-env', op: 'env', name: k });
  for (const p of ['/var/run/docker.sock', '/run/containerd/containerd.sock']) add({ id: `SOCK_${path.basename(p).replace(/\W/g, '_').toUpperCase()}`, class: 'socket', op: 'connect-unix', hostPath: p, insidePath: p });
  add({ id: 'EMULATOR_PORT', class: 'network', op: 'connect-tcp', host: '127.0.0.1', port: o.emulatorPort });
  for (const e of o.endpoints || []) if (e.port !== o.emulatorPort) add({ id: `PORT_${e.port}`, class: 'network', op: 'connect-tcp', host: '127.0.0.1', port: e.port });
  if (o.canaryPort) add({ id: 'CANARY_PORT', class: 'network', op: 'connect-tcp', host: '127.0.0.1', port: o.canaryPort, canary: true });
  for (const [id, host, port] of [['NET_METADATA', '169.254.169.254', 80], ['NET_GITHUB', 'github.com', 443], ['NET_API_GITHUB', 'api.github.com', 443]]) add({ id, class: 'network', op: 'connect-tcp', host, port });
  // allowed self data (recorded, never judged as a leak)
  add({ id: 'SELF_PROC_ENVIRON', class: 'self', op: 'read', hostPath: null, insidePath: '/proc/self/environ' });
  add({ id: 'SELF_HOME', class: 'self', op: 'list', hostPath: null, insidePath: '/work' });
  return T;
}

/** Resolves every TCP target's address ONCE on the host (C1-REV002): the probe, the attacker and the host
 *  control all use this IP, so a name-resolution failure inside the sandbox never stands in for a refusal. */
export async function resolveTargets(targets) {
  const dns = (await import('node:dns')).promises;
  for (const t of targets) {
    if (t.op !== 'connect-tcp') continue;
    if (net.isIP(t.host)) { t.addr = t.host; continue; }
    try { t.addr = (await dns.lookup(t.host)).address; } catch { t.addr = null; }
  }
  return targets;
}

const connectHost = (opts) => new Promise((res) => { const s = net.connect(opts); const t = setTimeout(() => { s.destroy(); res(false); }, 2000); s.once('connect', () => { clearTimeout(t); s.destroy(); res(true); }); s.once('error', () => { clearTimeout(t); res(false); }); });
const identityOf = (p) => { try { const st = lstatSync(p); return { dev: String(st.dev), ino: String(st.ino), type: st.isDirectory() ? 'dir' : st.isSocket() ? 'socket' : st.isFile() ? 'file' : 'other' }; } catch { return null; } };

/** Host-side positive control for one target (Runner, root). Never reads contents into the result. */
export async function hostControl(t, hostEnv) {
  if (t.class === 'self') return { present: null };
  if (t.op === 'env') return { present: Object.hasOwn(hostEnv, t.name) };
  if (t.op === 'connect-tcp') return net.isIP(t.addr || '') ? { present: await connectHost({ host: t.addr, port: t.port }), addr: t.addr } : { present: false };
  if (!t.hostPath) return { present: false };
  const id = identityOf(t.hostPath);
  if (!id) return { present: false };
  if (t.op === 'connect-unix') return { present: await connectHost({ path: t.hostPath }), identity: id };
  try { if (t.op === 'list') statSync(t.hostPath).isDirectory() && readdirSync(t.hostPath); else readFileSync(t.hostPath).subarray(0, 1); } catch { return { present: false, identity: id }; }
  return { present: true, identity: id };
}

/** The Runner's own HOST /proc view of a running sandbox instance (its namespace init = the program). */
export function hostViewOf(pid) {
  if (!pid) return null;
  try {
    const st = Object.fromEntries(readFileSync(`/proc/${pid}/status`, 'utf8').split('\n').filter((l) => l.includes(':')).map((l) => [l.split(':')[0], l.split(':')[1].trim()]));
    const mounts = readFileSync(`/proc/${pid}/mountinfo`, 'utf8').trim().split('\n').map((l) => { const f = l.split(' '); const sep = f.indexOf('-'); return `${f[4]} ${f[5]} ${f[sep + 1]}`; }).sort();
    return { uid: st.Uid, gid: st.Gid, groups: st.Groups, caps: ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map((k) => st[k]), noNewPrivs: st.NoNewPrivs, seccomp: st.Seccomp,
      mountDigest: createHash('sha256').update(mounts.join('\n')).digest('hex'), pidNs: readlinkSync(`/proc/${pid}/ns/pid`) };
  } catch { return null; }
}

/** Needles for the output scan, built in memory: canary values (public test data) and real contents (never output). */
export function needlesFor(targets, { canaryValues = {}, hostEnv = {}, readReal = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } } } = {}) {
  const N = {};
  for (const t of targets) {
    // real platform tokens in the Runner's environment (values stay in memory)
    if (t.class === 'forbidden-env') { const v = Object.hasOwn(hostEnv, t.name) ? String(hostEnv[t.name]) : ''; if (v.length >= MIN_NEEDLE) N[t.id] = [v]; continue; }
    if (t.class !== 'forbidden-file' || t.op !== 'read' || !t.hostPath) continue;
    const vals = [];
    if (canaryValues[t.id]) vals.push(canaryValues[t.id]);
    const c = readReal(t.hostPath);
    if (typeof c === 'string') { if (c.length >= MIN_NEEDLE) vals.push(c); for (const line of c.split(/[\n\0]/)) if (line.length >= MIN_NEEDLE) vals.push(line); }
    if (vals.length) N[t.id] = [...new Set(vals)];
  }
  return N;
}
/** Plain substring scan (declared limited scope: no decoding of transformed / encoded output). */
export function scanOutputs(texts, needles) {
  const hits = new Set();
  for (const [id, vals] of Object.entries(needles)) if (vals.some((v) => texts.some((t) => typeof t === 'string' && t.includes(v)))) hits.add(id);
  return hits;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Pure judgement. @returns { overall, targets: [{ id, class, required, outcome, reason, positiveControl, probe }], equivalence } */
export function judgeA10({ targets, controlsBefore, controlsAfter, probe, scanHits, equivalence, acceptSimulated = false }) {
  const eqOk = !!equivalence && equivalence.cfgDigestProbe === equivalence.cfgDigestAttacker && !!equivalence.hostViewProbe && !!equivalence.hostViewAttacker
    && same({ ...equivalence.hostViewProbe, pidNs: null }, { ...equivalence.hostViewAttacker, pidNs: null }) && equivalence.probeCompleted === true && equivalence.attackerCompleted === true && equivalence.sameRun === true;
  const out = [];
  for (const t of targets) {
    const b = controlsBefore[t.id] || {}; const a = controlsAfter[t.id] || {};
    const pr = probe && probe.results && Object.hasOwn(probe.results, t.id) ? probe.results[t.id] : null;
    const r = { id: t.id, class: t.class, required: t.required, op: t.op, simulated: t.simulated, canary: t.canary, positiveControl: { before: b.present ?? null, after: a.present ?? null }, probe: pr ? { result: pr.result, errnoClass: pr.errnoClass ?? null } : null, scanHit: scanHits.has(t.id) };
    const set = (outcome, reason) => { r.outcome = outcome; r.reason = reason; };
    if (t.class === 'self') set('ALLOWED_SELF', 'sandbox self data');
    else if (scanHits.has(t.id)) set('BREACHED', 'TRUSTED_SCAN_HIT');                                    // confirmed success is never overridden
    else if (t.simulated && !acceptSimulated) set('INCONCLUSIVE', 'SIMULATED_TARGET_NOT_ACCEPTED');      // C1-REV003
    else if (!(b.present === true && a.present === true)) set(t.class === 'network' ? 'N/A_HOST_UNREACHABLE' : 'N/A_HOST_ABSENT', 'POSITIVE_CONTROL_NOT_ESTABLISHED');
    else if (b.identity && !same(b.identity, a.identity)) set('INCONCLUSIVE', 'TARGET_IDENTITY_CHANGED');
    else if (!eqOk) set('INCONCLUSIVE', 'EQUIVALENCE_NOT_ESTABLISHED');
    else if (!pr) set('INCONCLUSIVE', 'PROBE_RESULT_MISSING');
    else if (pr.result === 'READ_OK' || pr.result === 'CONNECT_OK') {
      if (pr.identity && b.identity && t.class === 'forbidden-file' && !t.hostPath.startsWith('/proc/') && (pr.identity.dev !== b.identity.dev || pr.identity.ino !== b.identity.ino)) set('INCONCLUSIVE', 'PROBE_REACHED_OTHER_OBJECT');
      else set('BREACHED', 'TRUSTED_PROBE_SUCCEEDED');
    } else if (pr.result === 'DENIED') {
      // C1-REV002: only a refusal with an errno from this operation's denial list is a block
      if (Object.hasOwn(DENIAL_ERRNOS, t.op) && DENIAL_ERRNOS[t.op].includes(pr.errnoClass)) set('DEFENDED', 'TRUSTED_PROBE_DENIED');
      else set('INCONCLUSIVE', 'DENIAL_REASON_NOT_ACCEPTED');
    } else if (pr.result === 'PROBE_ERROR') set('INCONCLUSIVE', 'PROBE_ERROR');
    else set('INCONCLUSIVE', 'PROBE_RESULT_INVALID');
    out.push(r);
  }
  const breached = out.some((r) => r.outcome === 'BREACHED');
  const missingRequired = REQUIRED_TARGETS.filter((id) => !out.some((r) => r.id === id && r.outcome === 'DEFENDED'));
  return { a10Version: A10_VERSION, overall: breached ? 'BREACHED' : missingRequired.length ? 'INCONCLUSIVE' : 'DEFENDED', requiredNotDefended: missingRequired, equivalenceEstablished: eqOk,
    evidenceScope: acceptSimulated && out.some((r) => r.simulated) ? 'LOCAL_WITH_SIMULATED_TARGETS' : 'REAL_TARGETS_ONLY', targets: out };
}

export const fileExists = existsSync;
