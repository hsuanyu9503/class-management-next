#!/usr/bin/env node
/** S2-B2 batch 3a orchestrator (local, UNTRUSTED prototype → never PASS). Same port lifecycle as batches 1–2:
 *  every precondition is a hard stop; only ECONNREFUSED counts as closed. Needs Linux + root for the sandbox;
 *  otherwise the run is reported NOT_RUN (exit 3) instead of pretending to pass. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { portState } from '../src/port-state.mjs';
import { ROOT, FIREBASE_JS, EMULATOR_PORTS, cleanEnv } from '../src/orchestrator.mjs';
import { PROJECT_ID } from '../src/local-guard.mjs';
import { SENTINEL_TCP_PORT } from '../src/b3/isolation-policy.mjs';
import { platformSupport } from '../src/b3/selfcheck-host.mjs';

const PORTS = [...EMULATOR_PORTS, 18300, 18301, 18302, SENTINEL_TCP_PORT];
const results = [];
const log = (ok, name, note = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`); return ok; };
async function requireClosed(when) {
  const st = []; for (const p of PORTS) st.push(await portState(p));
  const bad = st.filter((s) => s.state !== 'closed');
  if (!log(bad.length === 0, `precondition (${when}): ports confirmed closed`, bad.map((s) => `${s.port}=${s.state}(${s.code})`).join(', '))) { console.log(`PRECONDITION FAILED: ${when}`); process.exit(2); }
}
const run = (args, env) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 1500000, maxBuffer: 64 * 1024 * 1024 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

const sup = platformSupport();
if (!sup.supported) { console.log(`NOT_RUN: sandbox platform unsupported (${sup.reason})`); process.exit(3); }
const unit = run(['--test', 'test/b3-unit.test.mjs'], cleanEnv(process.env));
if (!log(unit.code === 0, 'B3a unit tests', (unit.out.match(/# (pass|fail) \d+/g) || []).join(' '))) { console.log(unit.out.slice(-3000)); process.exit(2); }
await requireClosed('before emulator run');
const ex = run([FIREBASE_JS, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, 'node test/b3-run.mjs'], cleanEnv(process.env, { RUN_NONCE: randomBytes(16).toString('hex') }));
process.stdout.write(ex.out.split('\n').filter((l) => /^(OK|FAIL|S2B2_B3A_RUN|PRECONDITION|Error|OWNERSHIP|LOCAL_GUARD)/.test(l.trim())).join('\n') + '\n');
log(ex.code === 0, 'emulators:exec B3a run (honest + attacks + masking + cleanup)', `exit ${ex.code}`);
if (ex.code !== 0) console.log(ex.out.slice(-5000));
await requireClosed('after emulator run');
console.log(JSON.stringify({ kind: 'S2B2_B3A_ORCHESTRATION', attestation: 'UNATTESTED', notAPocPass: true, ok: results.every((r) => r.ok), results }, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
