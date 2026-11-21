#!/usr/bin/env node
/** Batch 2 orchestrator: same safety lifecycle as batch 1 (src/orchestrator.mjs rules):
 *  every port precondition is a hard stop (exit 2); a port counts as closed ONLY on ECONNREFUSED;
 *  the emulator ports AND the batch 2 API / trace-proxy ports are checked before and after. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { portState } from '../src/port-state.mjs';
import { ROOT, FIREBASE_JS, EMULATOR_PORTS, cleanEnv } from '../src/orchestrator.mjs';
import { BATCH2_PORTS } from '../src/harness.mjs';
import { PROJECT_ID } from '../src/local-guard.mjs';

export const ALL_PORTS = [...EMULATOR_PORTS, ...BATCH2_PORTS];
const results = [];
const log = (ok, name, note = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`); return ok; };
async function requireClosed(when) {
  const states = []; for (const p of ALL_PORTS) states.push(await portState(p));
  const bad = states.filter((s) => s.state !== 'closed');
  if (!log(bad.length === 0, `precondition (${when}): ports confirmed closed`, bad.map((s) => `${s.port}=${s.state}(${s.code})`).join(', '))) {
    console.log(`PRECONDITION FAILED: ${when} — stopping before any further action`); process.exit(2);
  }
}
const run = (args, env) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024 }); return { code: r.status, spawnError: r.error ? String(r.error.message) : null, out: (r.stdout || '') + (r.stderr || '') }; };

const unit = run(['--test', 'test/guard.test.mjs', 'test/port-state.test.mjs', 'test/batch2-unit.test.mjs'], cleanEnv(process.env));
if (!log(unit.code === 0, 'unit tests (guard, port-state, batch2 authz/token/time/mask/observer)', (unit.out.match(/# (pass|fail) \d+/g) || []).join(' '))) { console.log(unit.out.slice(-3000)); process.exit(2); }
await requireClosed('before emulator run');
const ex = run([FIREBASE_JS, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, 'node test/case-run.mjs'], cleanEnv(process.env, { RUN_NONCE: randomBytes(16).toString('hex') }));
process.stdout.write(ex.out.split('\n').filter((l) => /^(OK|FAIL|CASE|S2B2_B2_RUN|PRECONDITION|CASE_RUN_FAILED|OWNERSHIP|LOCAL_GUARD|Error)/.test(l.trim())).join('\n') + '\n');
log(ex.code === 0, 'emulators:exec case run (cases + negative + mutation + masking + cleanup)', `exit ${ex.code}${ex.spawnError ? ' ' + ex.spawnError : ''}`);
if (ex.code !== 0) console.log(ex.out.slice(-4000));
await requireClosed('after emulator run (emulators and API stopped)');
const dc = run(['test/api-disconnect.mjs'], cleanEnv(process.env, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }));
log(dc.code === 0, 'NEGATIVE emulators stopped (real disconnect) → API answers UNAVAILABLE with no data', dc.out.trim().split('\n').at(-1));
await requireClosed('after disconnect check');
console.log(JSON.stringify({ kind: 'S2B2_BATCH2_ORCHESTRATION', attestation: 'UNATTESTED', notAPocPass: true, ok: results.every((r) => r.ok), results }, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
