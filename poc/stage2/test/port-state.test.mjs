/** S2B2-REV-003 regression: a port is "closed" ONLY on explicit ECONNREFUSED. Occupied, EACCES,
 *  EPERM, timeout and any other error must stop the orchestrator at the precondition with ZERO
 *  probe / Emulator CLI launches (asserted on recorded launches, not only on the exit code). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { portState } from '../src/port-state.mjs';
import { runOrchestrator, EMULATOR_PORTS, FIREBASE_JS } from '../src/orchestrator.mjs';

/** Fake socket factory: behaviour 'connect' | 'timeout' | 'throw' | an error code string. */
function fakeConnect(behaviour, { alsoEmitLater = false } = {}) {
  const sockets = [];
  const connect = () => {
    if (behaviour === 'throw') throw Object.assign(new Error('sync failure'), { code: 'EINVAL' });
    const s = new EventEmitter(); s.destroyed = false; s.destroy = () => { s.destroyed = true; }; sockets.push(s);
    setImmediate(() => {
      if (behaviour === 'connect') s.emit('connect');
      else if (behaviour !== 'timeout') s.emit('error', Object.assign(new Error(behaviour), { code: behaviour }));
      if (alsoEmitLater) { s.emit('error', Object.assign(new Error('late'), { code: 'ECONNRESET' })); s.emit('connect'); }
    });
    return s;
  };
  return { connect, sockets };
}

const CASES = [
  ['connect', 'open', 'CONNECTED'],
  ['ECONNREFUSED', 'closed', 'ECONNREFUSED'],
  ['EACCES', 'unknown', 'EACCES'],
  ['EPERM', 'unknown', 'EPERM'],
  ['timeout', 'unknown', 'TIMEOUT'],
  ['EHOSTUNREACH', 'unknown', 'EHOSTUNREACH'],
  ['ENETUNREACH', 'unknown', 'ENETUNREACH'],
  ['ECONNRESET', 'unknown', 'ECONNRESET'],
  ['EMFILE', 'unknown', 'EMFILE'],
  ['throw', 'unknown', 'EINVAL'],
];

for (const [behaviour, state, code] of CASES) {
  test(`portState: ${behaviour} → ${state}`, async () => {
    const f = fakeConnect(behaviour);
    const r = await portState(8080, { connect: f.connect, timeoutMs: 50 });
    assert.deepEqual(r, { port: 8080, state, code });
    for (const s of f.sockets) assert.equal(s.destroyed, true, 'socket must be destroyed');
  });
}

test('portState: first outcome wins; late events do not resolve twice or throw', async () => {
  const f = fakeConnect('ECONNREFUSED', { alsoEmitLater: true });
  const r = await portState(8080, { connect: f.connect, timeoutMs: 50 });
  assert.equal(r.state, 'closed');
  await new Promise((res) => setTimeout(res, 80));          // let the timeout pass too
});

test('portState (real socket): a listening loopback port is open; a just-closed one is closed', async () => {
  const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  const open = await portState(port);
  await new Promise((r) => srv.close(r));
  const closed = await portState(port);
  // In environments where loopback connects are denied (e.g. EACCES), both must be 'unknown' — never 'closed'.
  if (open.state === 'unknown') { assert.equal(closed.state, 'unknown'); return; }
  assert.equal(open.state, 'open');
  assert.equal(closed.state, 'closed');
});

/** Fake spawner recording every launch; guard unit tests "pass", everything else "fails". */
function fakeRun() {
  const launches = [];
  const run = (args) => {
    launches.push(args);
    if (args[0] === '--test') return { code: 0, out: '# pass 8\n# fail 0', spawnError: null, signal: null };
    return { code: 1, out: 'fetch failed ECONNREFUSED', spawnError: null, signal: null };
  };
  const count = () => ({
    probe: launches.filter((a) => a[0] === 'test/probe.mjs').length,
    cli: launches.filter((a) => a[0] === FIREBASE_JS).length,
  });
  return { run, count };
}

const ORCH_CASES = [
  ['occupied', { state: 'open', code: 'CONNECTED' }],
  ['EACCES', { state: 'unknown', code: 'EACCES' }],
  ['EPERM', { state: 'unknown', code: 'EPERM' }],
  ['timeout', { state: 'unknown', code: 'TIMEOUT' }],
  ['other error', { state: 'unknown', code: 'EHOSTUNREACH' }],
];

for (const [label, bad] of ORCH_CASES) {
  for (const badPort of [8080, 4500]) {
    test(`orchestrator: port ${badPort} ${label} → exit 2 at first precondition, 0 probe, 0 CLI`, async () => {
      const f = fakeRun(); const lines = [];
      const r = await runOrchestrator({ run: f.run, log: (l) => lines.push(l), baseEnv: {}, checkPort: async (p) => (p === badPort ? { port: p, ...bad } : { port: p, state: 'closed', code: 'ECONNREFUSED' }) });
      assert.equal(r.code, 2);
      assert.equal(r.abortedReason, 'precondition (before negatives): emulator ports confirmed closed');
      assert.deepEqual(f.count(), { probe: 0, cli: 0 });
      const out = lines.join('\n');
      assert.match(out, new RegExp(`PRECONDITION FAILED`));
      assert.match(out, new RegExp(`${badPort}=${bad.state}\\(${bad.code}\\)`), 'port and error code must be reported');
      assert.doesNotMatch(out, /POSITIVE|NEGATIVE/);
    });
  }
}

for (const [label, bad] of ORCH_CASES) {
  test(`orchestrator: ${label} detected AFTER the positive smoke → stop, no rules-relaxed CLI, no disconnect probe`, async () => {
    const f = fakeRun(); let checks = 0;
    // closed for the first two precondition rounds (before negatives, before positive), bad from the third on
    const r = await runOrchestrator({ run: f.run, log: () => {}, baseEnv: {}, checkPort: async (p) => (checks++ >= EMULATOR_PORTS.length * 2 ? { port: p, ...bad } : { port: p, state: 'closed', code: 'ECONNREFUSED' }) });
    assert.equal(r.code, 2);
    assert.equal(r.abortedReason, 'precondition (after positive smoke, before rules-relaxed negative): emulator ports confirmed closed');
    assert.deepEqual(f.count(), { probe: 4, cli: 1 }, 'only the 4 pre-start negatives and the 1 positive exec may have run');
  });
}

test('orchestrator positive control: all ports ECONNREFUSED → every step launches (4+1 probe, 2 CLI)', async () => {
  const f = fakeRun();
  const r = await runOrchestrator({ run: f.run, log: () => {}, baseEnv: {}, checkPort: async (p) => ({ port: p, state: 'closed', code: 'ECONNREFUSED' }) });
  assert.equal(r.abortedReason, null);
  assert.deepEqual(f.count(), { probe: 5, cli: 2 });
  assert.equal(r.code, 1, 'the fake CLI does not produce a passing smoke, so the run must not report success');
});
