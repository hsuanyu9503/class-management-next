#!/usr/bin/env node
/** S2-B2 B4 orchestrator (local, UNTRUSTED → never PASS): unit tests, then the in-process write-case suite on the
 *  real emulators (test/b4-run.mjs). Same port lifecycle as batches 1–3: every precondition is a hard stop and a
 *  port counts as closed ONLY on ECONNREFUSED. The sandboxed honest runs of the same cases are in s2:b3. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { portState } from '../src/port-state.mjs';
import { ROOT, FIREBASE_JS, EMULATOR_PORTS, cleanEnv } from '../src/orchestrator.mjs';
import { BATCH2_PORTS } from '../src/harness.mjs';
import { PROJECT_ID } from '../src/local-guard.mjs';

const PORTS = [...EMULATOR_PORTS, ...BATCH2_PORTS, 18306];
const results = [];
const log = (ok, name, note = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`); return ok; };
async function requireClosed(when) {
  const bad = []; for (const p of PORTS) { const s = await portState(p); if (s.state !== 'closed') bad.push(`${p}=${s.state}(${s.code})`); }
  if (!log(bad.length === 0, `precondition (${when}): ports confirmed closed`, bad.join(', '))) { console.log(`PRECONDITION FAILED: ${when}`); process.exit(2); }
}
const run = (args, env) => { const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 1500000, maxBuffer: 64 * 1024 * 1024 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

const unit = run(['--test', 'test/b4-unit.test.mjs'], cleanEnv(process.env));
if (!log(unit.code === 0, 'B4 unit tests', (unit.out.match(/# (pass|fail) \d+/g) || []).join(' '))) { console.log(unit.out.slice(-4000)); process.exit(2); }
await requireClosed('before emulator run');
const ex = run([FIREBASE_JS, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, 'node test/b4-run.mjs'], cleanEnv(process.env, { RUN_NONCE: randomBytes(16).toString('hex') }));
process.stdout.write(ex.out.split('\n').filter((l) => /^(OK|FAIL|INFO|S2B2_B4_RUN|PRECONDITION|Error|OWNERSHIP|LOCAL_GUARD)/.test(l.trim())).join('\n') + '\n');
log(ex.code === 0, 'emulators:exec B4 run (honest + mutations + negative tests + masking + cleanup)', `exit ${ex.code}`);
if (ex.code !== 0) console.log(ex.out.slice(-6000));
await requireClosed('after emulator run');
console.log(JSON.stringify({ kind: 'S2B2_B4_ORCHESTRATION', attestation: 'UNATTESTED', notAPocPass: true, ok: results.every((r) => r.ok), results }, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
