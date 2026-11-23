/** A10 judgement unit tests (pure; no sandbox, no root). Attack-acceptance plan v0.4 §2.1, §2.3. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planTargets, judgeA10, needlesFor, scanOutputs, hostControl, REQUIRED_TARGETS, DENIAL_ERRNOS } from '../src/b3/a10.mjs';

const opts = { env: { GITHUB_OUTPUT: '/rt/_temp/out', GITHUB_ENV: '/rt/_temp/env' }, repoRoot: '/repo', runnerInstall: '/runner', helperPid: 4242, canaryFile: '/rt/_temp/s2-canary-x/canary', canaryPort: 18398, emulatorPort: 8080, endpoints: [{ port: 8080 }, { port: 9099 }] };
const targets = planTargets(opts);
const view = { uid: '65534', gid: '65534', caps: ['0', '0', '0', '0', '0'], noNewPrivs: '1', mountDigest: 'm', pidNs: 'pid:[1]' };
const eq = (o = {}) => ({ cfgDigestProbe: 'd', cfgDigestAttacker: 'd', hostViewProbe: view, hostViewAttacker: { ...view, pidNs: 'pid:[2]' }, probeCompleted: true, attackerCompleted: true, sameRun: true, ...o });
const present = () => Object.fromEntries(targets.map((t) => [t.id, t.class === 'self' ? { present: null } : { present: true, identity: t.hostPath && !t.hostPath.startsWith('/proc') ? { dev: '1', ino: t.id.length + '' } : undefined }]));
const denyCode = (t) => DENIAL_ERRNOS[t.op][0];
const denied = () => ({ probeVersion: 's2-a10-probe-v2', results: Object.fromEntries(targets.filter((t) => t.class !== 'self').map((t) => [t.id, { result: 'DENIED', errnoClass: denyCode(t) }])) });
const run = (o = {}) => judgeA10({ targets, controlsBefore: o.before || present(), controlsAfter: o.after || present(), probe: o.probe === undefined ? denied() : o.probe, scanHits: o.scanHits || new Set(), equivalence: o.equivalence || eq() });
const out = (r, id) => r.targets.find((t) => t.id === id);

test('A10 plan: required targets present; command files, runner install, canaries, sockets, network, self data', () => {
  for (const id of REQUIRED_TARGETS) assert.ok(targets.some((t) => t.id === id && t.required), id);
  assert.equal(out({ targets }, 'GITHUB_OUTPUT').simulated, false);
  assert.ok(targets.some((t) => t.id === 'SELF_PROC_ENVIRON' && t.class === 'self'));
  // weakened configs only: a leak mount maps the inside path of targets under the mounted host dir
  const leak = planTargets({ ...opts, leakMount: { hostDir: '/rt/_temp/s2-canary-x', insideDir: '/leak' } });
  assert.equal(leak.find((t) => t.id === 'RUNNER_TEMP_CANARY').insidePath, '/leak/canary');
  assert.equal(leak.find((t) => t.id === 'GIT_CONFIG').insidePath, '/repo/.git/config');
  // no runner installation found → the required target exists but has no host path (→ not DEFENDED)
  const none = planTargets({ ...opts, runnerInstall: null });
  assert.equal(none.find((t) => t.id === 'RUNNER_INSTALL_DIR').hostPath, null);
});

test('A10 judge: DEFENDED needs positive control + completed probe + DENIED + no scan hit, for every required target', () => {
  const r = run(); assert.equal(r.overall, 'DEFENDED'); assert.deepEqual(r.requiredNotDefended, []);
  assert.equal(out(r, 'SELF_PROC_ENVIRON').outcome, 'ALLOWED_SELF');
  assert.equal(out(r, 'GIT_CONFIG').reason, 'TRUSTED_PROBE_DENIED');
});

test('A10 judge: a trusted scan hit is BREACHED and is never overridden by another instance\'s DENIED', () => {
  const r = run({ scanHits: new Set(['GIT_CONFIG']) });
  assert.equal(r.overall, 'BREACHED'); assert.deepEqual([out(r, 'GIT_CONFIG').outcome, out(r, 'GIT_CONFIG').reason], ['BREACHED', 'TRUSTED_SCAN_HIT']);
  // even when equivalence is not established
  const r2 = run({ scanHits: new Set(['GIT_CONFIG']), equivalence: eq({ cfgDigestProbe: 'other' }) });
  assert.equal(out(r2, 'GIT_CONFIG').outcome, 'BREACHED'); assert.equal(r2.overall, 'BREACHED');
});

test('A10 judge: no positive control → N/A (not a pass); a required N/A makes the whole run INCONCLUSIVE', () => {
  const before = present(); before.HOST_PROC_ENVIRON = { present: false }; before.NET_GITHUB = { present: false };
  const r = run({ before });
  assert.equal(out(r, 'HOST_PROC_ENVIRON').outcome, 'N/A_HOST_ABSENT'); assert.equal(out(r, 'NET_GITHUB').outcome, 'N/A_HOST_UNREACHABLE');
  assert.equal(r.overall, 'INCONCLUSIVE'); assert.deepEqual(r.requiredNotDefended, ['HOST_PROC_ENVIRON']);
  const after = present(); after.GIT_CONFIG = { present: false };
  assert.equal(out(run({ after }), 'GIT_CONFIG').outcome, 'N/A_HOST_ABSENT');      // must hold before AND after
});

test('A10 judge: equivalence is checked, never assumed (config digest, host view, completion, same run)', () => {
  for (const e of [eq({ cfgDigestProbe: 'x' }), eq({ hostViewAttacker: { ...view, caps: ['1', '0', '0', '0', '0'] } }), eq({ hostViewAttacker: { ...view, mountDigest: 'other' } }), eq({ hostViewProbe: null }), eq({ probeCompleted: false }), eq({ attackerCompleted: false }), eq({ sameRun: false })]) {
    const r = run({ equivalence: e });
    assert.equal(r.overall, 'INCONCLUSIVE'); assert.equal(out(r, 'GIT_CONFIG').reason, 'EQUIVALENCE_NOT_ESTABLISHED'); assert.equal(r.equivalenceEstablished, false);
  }
});

test('A10 judge: missing / invalid probe results and changed targets are INCONCLUSIVE; READ_OK is BREACHED', () => {
  const p = denied(); delete p.results.GIT_CONFIG;
  const r = run({ probe: p }); assert.deepEqual([out(r, 'GIT_CONFIG').outcome, out(r, 'GIT_CONFIG').reason], ['INCONCLUSIVE', 'PROBE_RESULT_MISSING']); assert.equal(r.overall, 'INCONCLUSIVE');
  assert.equal(run({ probe: null }).overall, 'INCONCLUSIVE');
  const bad = denied(); bad.results.GIT_CONFIG = { result: 'MAYBE' }; assert.equal(out(run({ probe: bad }), 'GIT_CONFIG').reason, 'PROBE_RESULT_INVALID');
  const after = present(); after.GIT_CONFIG = { present: true, identity: { dev: '9', ino: '9' } };
  assert.equal(out(run({ after }), 'GIT_CONFIG').reason, 'TARGET_IDENTITY_CHANGED');
  const ok = denied(); ok.results.GIT_CONFIG = { result: 'READ_OK', identity: { dev: '1', ino: String('GIT_CONFIG'.length) } };
  const b = run({ probe: ok }); assert.deepEqual([out(b, 'GIT_CONFIG').outcome, out(b, 'GIT_CONFIG').reason], ['BREACHED', 'TRUSTED_PROBE_SUCCEEDED']); assert.equal(b.overall, 'BREACHED');
  const other = denied(); other.results.GIT_CONFIG = { result: 'READ_OK', identity: { dev: '7', ino: '7' } };
  assert.equal(out(run({ probe: other }), 'GIT_CONFIG').reason, 'PROBE_REACHED_OTHER_OBJECT');
  const net = denied(); net.results.EMULATOR_PORT = { result: 'CONNECT_OK' }; assert.equal(out(run({ probe: net }), 'EMULATOR_PORT').outcome, 'BREACHED');
});

test('A10 judge: the attacker\'s self-report is not an input at all', () => {
  assert.equal(judgeA10.length, 1);
  const r = judgeA10({ targets, controlsBefore: present(), controlsAfter: present(), probe: denied(), scanHits: new Set(), equivalence: eq(), attackerClaim: { results: { GIT_CONFIG: 'READ' } } });
  assert.equal(r.overall, 'DEFENDED');
});

test('A10 scan: needles from canaries, real contents (lines ≥ 16 chars) and real env tokens; plain substring scope', () => {
  const real = { '/repo/.git/config': '[core]\n\turl = https://example.invalid/some/long/remote\n', '/rt/_temp/out': '' };
  const N = needlesFor(targets, { canaryValues: { RUNNER_TEMP_CANARY: 'S2CANARY-TEMP-0123456789' }, hostEnv: { ACTIONS_RUNTIME_TOKEN: 'rt-token-value-0123456789', GITHUB_TOKEN: 'short' }, readReal: (p) => real[p] ?? null });
  assert.ok(N.GIT_CONFIG.some((v) => v.includes('example.invalid'))); assert.ok(!N.GIT_CONFIG.includes('[core]'));
  assert.deepEqual(N.RUNNER_TEMP_CANARY, ['S2CANARY-TEMP-0123456789']);
  assert.deepEqual(N.ENV_ACTIONS_RUNTIME_TOKEN, ['rt-token-value-0123456789']); assert.equal(N.ENV_GITHUB_TOKEN, undefined);
  assert.equal(N.GITHUB_OUTPUT, undefined);          // empty file: nothing to scan for (reported as no needle, not as safe)
  const hits = scanOutputs(['x\turl = https://example.invalid/some/long/remote y', 'rt-token-value-0123456789'], N);
  assert.deepEqual([...hits].sort(), ['ENV_ACTIONS_RUNTIME_TOKEN', 'GIT_CONFIG']);
  assert.equal(scanOutputs([Buffer.from('S2CANARY-TEMP-0123456789').toString('base64')], N).size, 0);   // declared limit: no decoding
});

// ------------------------------------------------------------------ C1-REV002: a probe failure is never a block
test('C1-REV002: UNKNOWN_OP, ERROR, EMFILE, TIMEOUT or an unlisted errno is INCONCLUSIVE, never DEFENDED', () => {
  for (const [result, errnoClass] of [['DENIED', 'UNKNOWN_OP'], ['DENIED', 'ERROR'], ['DENIED', 'EMFILE'], ['DENIED', 'EIO'], ['PROBE_ERROR', 'EMFILE'], ['PROBE_ERROR', 'TIMEOUT'], ['PROBE_ERROR', 'UNKNOWN_OP_OR_TARGET'], ['DENIED', 'ENOTFOUND'], ['DENIED', 'EAI_AGAIN']]) {
    const p = denied(); p.results.GIT_CONFIG = { result, errnoClass }; p.results.EMULATOR_PORT = { result, errnoClass };
    const r = run({ probe: p });
    assert.equal(out(r, 'GIT_CONFIG').outcome, 'INCONCLUSIVE', `${result}/${errnoClass}`);
    assert.equal(out(r, 'EMULATOR_PORT').outcome, 'INCONCLUSIVE', `${result}/${errnoClass}`);
    assert.equal(r.overall, 'INCONCLUSIVE', `${result}/${errnoClass}`);
  }
  // a denial errno valid for one op is not valid for another (ECONNREFUSED is not a file denial)
  const p = denied(); p.results.GIT_CONFIG = { result: 'DENIED', errnoClass: 'ECONNREFUSED' };
  assert.equal(out(run({ probe: p }), 'GIT_CONFIG').reason, 'DENIAL_REASON_NOT_ACCEPTED');
  // a confirmed success still wins over a probe error elsewhere
  const b = denied(); b.results.GIT_CONFIG = { result: 'PROBE_ERROR', errnoClass: 'EMFILE' };
  assert.equal(run({ probe: b, scanHits: new Set(['RUNNER_TEMP_CANARY']) }).overall, 'BREACHED');
});

test('C1-REV002: the probe and the judge use the same denial lists; the probe never resolves names itself', () => {
  const src = readFileSync(new URL('../sandbox-check/probe-a10.mjs', import.meta.url), 'utf8');
  const m = /export const DENIAL_ERRNOS = Object\.freeze\((\{[\s\S]*?\})\);/.exec(src);
  assert.ok(m); assert.deepEqual(new Function(`return ${m[1]}`)(), JSON.parse(JSON.stringify(DENIAL_ERRNOS)));
  assert.doesNotMatch(src, /dns|lookup\(/); assert.match(src, /host: t\.addr/);
  for (const ok of [['DENIED', 'TIMEOUT'], ['DENIED', 'ENOTFOUND']]) assert.ok(!Object.values(DENIAL_ERRNOS).flat().includes(ok[1]));
});

test('C1-REV002: a TCP target without a host-resolved address has no positive control (N/A, not DEFENDED)', async () => {
  const t = { id: 'NET_X', class: 'network', op: 'connect-tcp', host: 'unresolvable.invalid', port: 443, addr: null };
  assert.deepEqual(await hostControl(t, {}), { present: false });
});

// ------------------------------------------------------------------ C1-REV003: simulation is local-only
test('C1-REV003: stand-ins are used only with allowSimulation; a simulated required target never satisfies acceptance by default', () => {
  const hostedLike = { ...opts, env: {}, runnerInstall: null, simulatedRunnerInstall: '/sim', localOutputStandIn: '/sim/out' };
  const h = planTargets({ ...hostedLike, allowSimulation: false });
  assert.equal(h.find((t) => t.id === 'RUNNER_INSTALL_DIR').hostPath, null); assert.equal(h.find((t) => t.id === 'GITHUB_OUTPUT'), undefined);
  const l = planTargets({ ...hostedLike, allowSimulation: true });
  assert.equal(l.find((t) => t.id === 'RUNNER_INSTALL_DIR').simulated, true); assert.equal(l.find((t) => t.id === 'GITHUB_OUTPUT').simulated, true);
  // judged with the default (acceptSimulated=false): the simulated required targets are INCONCLUSIVE
  const ctl = Object.fromEntries(l.map((t) => [t.id, t.class === 'self' ? { present: null } : { present: true }]));
  const pr = { probeVersion: 's2-a10-probe-v2', results: Object.fromEntries(l.filter((t) => t.class !== 'self').map((t) => [t.id, { result: 'DENIED', errnoClass: DENIAL_ERRNOS[t.op][0] }])) };
  const strict = judgeA10({ targets: l, controlsBefore: ctl, controlsAfter: ctl, probe: pr, scanHits: new Set(), equivalence: eq() });
  assert.equal(strict.overall, 'INCONCLUSIVE'); assert.equal(strict.targets.find((t) => t.id === 'GITHUB_OUTPUT').reason, 'SIMULATED_TARGET_NOT_ACCEPTED');
  assert.ok(strict.requiredNotDefended.includes('GITHUB_OUTPUT') && strict.requiredNotDefended.includes('RUNNER_INSTALL_DIR'));
  // a local run may accept them, and says so
  const local = judgeA10({ targets: l, controlsBefore: ctl, controlsAfter: ctl, probe: pr, scanHits: new Set(), equivalence: eq(), acceptSimulated: true });
  assert.equal(local.overall, 'DEFENDED'); assert.equal(local.evidenceScope, 'LOCAL_WITH_SIMULATED_TARGETS');
  assert.equal(run().evidenceScope, 'REAL_TARGETS_ONLY');
});

