#!/usr/bin/env node
/** A10 acceptance run (TRUSTED TOOLCHAIN, C-1; attack-acceptance plan v0.4 §2). Runs only inside
 *  `firebase emulators:exec` (scripts/run-a10.mjs locally; attest-attack.yml on a hosted runner), as root on
 *  Linux. The emulator is needed only so the EMULATOR_PORT target has a host-side positive control; this run
 *  never reads or writes emulator data.
 *
 *  Per scenario: host positive controls → trusted probe instance → attacker instance (same config unless the
 *  scenario says otherwise) → host positive controls again → in-memory output scan → judgeA10().
 *  Only safe diagnostics are written: target IDs, classes, outcomes, errno classes, config digests, the
 *  Runner's host view of each instance. Never contents, fragments, content hashes, or the attacker's output.
 *  env: A10_OUT_DIR (optional; hosted upload dir), A10_SCENARIOS (comma list; default all). */
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalConfig } from '../src/local-guard.mjs';
import { sandboxConfig, configDigest, ENDPOINTS } from '../src/b3/isolation-policy.mjs';
import { launchSandbox, cleanupSandboxDirs, resolvePathMap } from '../src/b3/sandbox.mjs';
import { planTargets, hostControl, hostViewOf, needlesFor, scanOutputs, judgeA10, discoverRunnerInstall, A10_VERSION } from '../src/b3/a10.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REPO = path.resolve(ROOT, '../..');
assertLocalConfig(process.env, { firebaseJsonPath: path.join(ROOT, 'firebase.json') });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const rnd = () => randomBytes(24).toString('hex');

// ---------------------------------------------------------------- Runner-created test data (canaries are public test values)
const workDir = mkdtempSync('/tmp/cmn-a10-'); chmodSync(workDir, 0o700);
const runnerTemp = process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP) ? process.env.RUNNER_TEMP : workDir;
const canaryDir = mkdtempSync(path.join(runnerTemp, 's2-canary-')); chmodSync(canaryDir, 0o755);
const CANARY = { RUNNER_TEMP_CANARY: `S2CANARY-TEMP-${rnd()}`, HOST_PROC_ENVIRON: `S2CANARY-ENV-${rnd()}`, GITHUB_OUTPUT: `S2CANARY-OUT-${rnd()}`, RUNNER_DOT_RUNNER: `S2CANARY-RUNNER-${rnd()}`, RUNNER_CREDENTIALS: `S2CANARY-CRED-${rnd()}` };
const canaryFile = path.join(canaryDir, 'canary'); writeFileSync(canaryFile, `${CANARY.RUNNER_TEMP_CANARY}\n`); chmodSync(canaryFile, 0o644);
const helper = spawn('/bin/sleep', ['900'], { env: { S2_CANARY: CANARY.HOST_PROC_ENVIRON }, stdio: 'ignore' });
const CANARY_PORT = 18398;
const canarySrv = net.createServer((s) => s.destroy()); await new Promise((r, j) => { canarySrv.once('error', j); canarySrv.listen(CANARY_PORT, '127.0.0.1', r); });
// local only: a Runner-private stand-in for GITHUB_OUTPUT and a simulated runner install (marked simulated)
const localOutputStandIn = path.join(workDir, 'GITHUB_OUTPUT'); writeFileSync(localOutputStandIn, `${CANARY.GITHUB_OUTPUT}\n`);
const runnerInstall = discoverRunnerInstall();
let simulatedRunnerInstall = null;
if (!runnerInstall) {
  simulatedRunnerInstall = path.join(workDir, 'sim-runner'); mkdirSync(path.join(simulatedRunnerInstall, '_diag'), { recursive: true });
  writeFileSync(path.join(simulatedRunnerInstall, '.runner'), `${CANARY.RUNNER_DOT_RUNNER}\n`); writeFileSync(path.join(simulatedRunnerInstall, '.credentials'), `${CANARY.RUNNER_CREDENTIALS}\n`);
}
const entryDir = mkdtempSync('/tmp/cmn-e-'); chmodSync(entryDir, 0o755);
const pathMap = resolvePathMap({ nodeBinary: process.execPath, adapterDir: path.join(ROOT, 'adapter-b3'), checkDir: path.join(ROOT, 'sandbox-check'), entryDir });
const probeSha256 = sha(readFileSync(path.join(ROOT, 'sandbox-check/probe-a10.mjs')));

const POLICY = sandboxConfig();
const leakCfg = () => sandboxConfig({ mounts: [...POLICY.mounts, { target: '/leak', source: `host:${canaryDir}`, mode: 'ro', flags: ['nodev', 'nosuid'] }] });
const baseOpts = { env: process.env, repoRoot: REPO, runnerInstall, simulatedRunnerInstall, localOutputStandIn, helperPid: helper.pid, canaryFile, canaryPort: CANARY_PORT, emulatorPort: 8080, endpoints: ENDPOINTS };

/** Scenario table (plan §2.3(3)). expect: overall and per-target expectations checked below. */
const SCENARIOS = {
  'A10-main': { mode: 'exfil', expect: { overall: 'DEFENDED' } },
  'N-1-lie-eacces': { mode: 'lie-eacces', expect: { overall: 'DEFENDED' } },
  'N-2-read-discard-lie': { mode: 'read-discard-lie', leak: true, expect: { overall: 'BREACHED', target: ['RUNNER_TEMP_CANARY', 'BREACHED', 'TRUSTED_PROBE_SUCCEEDED'] } },
  'N-3-forge-list': { mode: 'forge-list', expect: { overall: 'DEFENDED' } },
  'N-4-forge-net': { mode: 'forge-net', expect: { overall: 'DEFENDED' } },
  'N-5-exfil-canary': { mode: 'exfil', leak: true, expect: { overall: 'BREACHED', target: ['RUNNER_TEMP_CANARY', 'BREACHED', 'TRUSTED_SCAN_HIT'] } },
  'N-6-probe-config-differs': { mode: 'lie-eacces', probeCfg: sandboxConfig({ env: { HOME: '/work', PATH: '/usr/bin', S2_PROBE_VARIANT: '1' } }), expect: { overall: 'INCONCLUSIVE', target: ['GIT_CONFIG', 'INCONCLUSIVE', 'EQUIVALENCE_NOT_ESTABLISHED'] } },
  'N-7-probe-omits-target': { mode: 'lie-eacces', skip: ['GIT_CONFIG'], expect: { overall: 'INCONCLUSIVE', target: ['GIT_CONFIG', 'INCONCLUSIVE', 'PROBE_RESULT_MISSING'] } },
  'N-8-weakened-config': { mode: 'lie-eacces', leak: true, expect: { overall: 'BREACHED', target: ['RUNNER_TEMP_CANARY', 'BREACHED', 'TRUSTED_PROBE_SUCCEEDED'] } },
};
const only = (process.env.A10_SCENARIOS || '').split(',').filter(Boolean);
for (const s of only) if (!SCENARIOS[s]) throw new Error(`A10_SCENARIOS: unknown ${s}`);

async function instance({ cfg, entry, input }) {
  const inputDir = mkdtempSync(path.join(workDir, 'in-')); chmodSync(inputDir, 0o755);
  writeFileSync(path.join(inputDir, 'a10.json'), JSON.stringify(input)); chmodSync(path.join(inputDir, 'a10.json'), 0o644);
  const startedAt = new Date().toISOString();
  const sbx = launchSandbox({ cfg, pathMap: { ...pathMap, inputDir }, entry });
  const ready = await sbx.waitFor('READY', cfg.limits.readyTimeoutMs);
  const hostView = ready ? hostViewOf(sbx.initPid()) : null;            // the Runner's own HOST /proc view
  if (ready) sbx.send('GO');
  const done = ready && await sbx.waitFor('DONE', cfg.limits.caseTimeoutMs);
  const term = await sbx.terminate();
  const o = sbx.output();
  rmSync(inputDir, { recursive: true, force: true });
  return { ready, done, term, hostView, stdout: o.stdout, stderr: o.stderr, violations: o.violations, cfgDigest: configDigest(cfg), startedAt, endedAt: new Date().toISOString() };
}

const results = []; const log = (ok, name, detail) => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const reports = {};
for (const [name, sc] of Object.entries(SCENARIOS)) {
  if (only.length && !only.includes(name)) continue;
  const attackerCfg = sc.leak ? leakCfg() : POLICY;
  const probeCfg = sc.probeCfg || attackerCfg;
  const targets = planTargets({ ...baseOpts, leakMount: sc.leak ? { hostDir: canaryDir, insideDir: '/leak' } : null });
  const insideList = targets.map(({ id, op, insidePath, name: n, host, port }) => ({ id, op, insidePath, name: n, host, port }));
  const controlsBefore = {}; for (const t of targets) controlsBefore[t.id] = await hostControl(t, process.env);
  const p = await instance({ cfg: probeCfg, entry: '/check/probe-a10.mjs', input: { targets: insideList, skip: sc.skip || [] } });
  let probe = null; try { probe = JSON.parse(p.stdout); } catch { /* not completed */ }
  const a = await instance({ cfg: attackerCfg, entry: '/adapter/attackers/credential-probe.mjs', input: { mode: sc.mode, targets: insideList } });
  const controlsAfter = {}; for (const t of targets) controlsAfter[t.id] = await hostControl(t, process.env);
  // attacker output: Runner memory only; scanned, then dropped
  const needles = needlesFor(targets, { canaryValues: CANARY, hostEnv: process.env });
  const scanHits = scanOutputs([a.stdout, a.stderr], needles);
  const equivalence = { cfgDigestProbe: p.cfgDigest, cfgDigestAttacker: a.cfgDigest, hostViewProbe: p.hostView, hostViewAttacker: a.hostView,
    probeCompleted: p.done && !!probe && probe.probeVersion === 's2-a10-probe-v1', attackerCompleted: a.done, sameRun: true,
    timing: { probe: [p.startedAt, p.endedAt], attacker: [a.startedAt, a.endedAt] } };
  const j = judgeA10({ targets, controlsBefore, controlsAfter, probe, scanHits, equivalence });
  const report = {
    a10Version: A10_VERSION, scenario: name, attackerMode: sc.mode, policyConfig: attackerCfg === POLICY && probeCfg === POLICY, policyConfigDigest: configDigest(POLICY),
    probeSha256, runnerInstall: runnerInstall ? 'discovered' : 'simulated', overall: j.overall, requiredNotDefended: j.requiredNotDefended, equivalenceEstablished: j.equivalenceEstablished,
    equivalence: { ...equivalence }, targets: j.targets.map((t) => ({ ...t, hostIdentity: controlsBefore[t.id]?.identity ? { dev: controlsBefore[t.id].identity.dev, ino: controlsBefore[t.id].identity.ino } : null })),
    termination: { probe: { namespaceTerminated: p.term.namespaceTerminated, remaining: p.term.remainingAdapterProcesses }, attacker: { namespaceTerminated: a.term.namespaceTerminated, remaining: a.term.remainingAdapterProcesses } },
    controlViolations: { probe: p.violations.length, attacker: a.violations.length },
    attackerOutput: { stdoutBytes: Buffer.byteLength(a.stdout), stderrBytes: Buffer.byteLength(a.stderr), selfReport: 'IGNORED_NOT_RECORDED' },
  };
  // the report itself must contain no needle (canary or real content) — otherwise it is not written at all
  const text = JSON.stringify(report, null, 1);
  const leak = scanOutputs([text], needles);
  if (leak.size) { log(false, `A10 ${name} report contains protected content — not written`, [...leak].join(',')); continue; }
  reports[name] = text;
  const e = sc.expect; const tgt = e.target ? j.targets.find((t) => t.id === e.target[0]) : null;
  const ok = j.overall === e.overall && (!tgt || (tgt.outcome === e.target[1] && tgt.reason === e.target[2])) && (name !== 'A10-main' || report.policyConfig) && p.term.namespaceTerminated && a.term.namespaceTerminated;
  log(ok, `A10 ${name}`, `overall=${j.overall} required-not-defended=[${j.requiredNotDefended.join(',')}]${tgt ? ` ${tgt.id}=${tgt.outcome}/${tgt.reason}` : ''} equivalence=${j.equivalenceEstablished} outcomes=${JSON.stringify(Object.fromEntries(j.targets.map((t) => [t.id, t.outcome])))}`);
}

// ---------------------------------------------------------------- cleanup and safe output
helper.kill('SIGKILL'); await new Promise((r) => canarySrv.close(r));
cleanupSandboxDirs(); rmSync(entryDir, { recursive: true, force: true }); rmSync(canaryDir, { recursive: true, force: true }); rmSync(workDir, { recursive: true, force: true });
const tag = `S2B2A10-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`;
const outDir = process.env.A10_OUT_DIR && path.isAbsolute(process.env.A10_OUT_DIR) ? process.env.A10_OUT_DIR : path.join(ROOT, 'evidence', 'runs', 's2b2-a10', tag);
mkdirSync(outDir, { recursive: true });
for (const [n, t] of Object.entries(reports)) writeFileSync(path.join(outDir, `a10-${n}.json`), t);
const summary = { kind: 'S2B2_A10_RUN', tag, a10Version: A10_VERSION, notAPocPass: true, runnerKind: process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' ? 'github-hosted' : 'local-untrusted', runnerInstall: runnerInstall ? 'discovered' : 'simulated', checks: results, ok: results.length > 0 && results.every((r) => r.ok) };
writeFileSync(path.join(outDir, 'a10-summary.json'), JSON.stringify(summary, null, 1));
console.log(`S2B2_A10_RUN ${tag} ok=${summary.ok} checks=${results.filter((r) => r.ok).length}/${results.length} out=${path.relative(ROOT, outDir) || outDir}`);
process.exit(summary.ok ? 0 : 1);
