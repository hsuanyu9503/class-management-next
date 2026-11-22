#!/usr/bin/env node
/** A10 acceptance orchestrator (C-1; attack-acceptance plan v0.4 §2). Same port lifecycle as run-b3.mjs:
 *  every precondition is a hard stop. Needs Linux + root; otherwise NOT_RUN (exit 3), never a pass.
 *  Locally the runner installation and GITHUB_OUTPUT are SIMULATED (reported as such); on a hosted runner
 *  (attest-attack.yml) they are the real ones. env: A10_OUT_DIR, A10_SCENARIOS (passed through). */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { portState } from '../src/port-state.mjs';
import { ROOT, FIREBASE_JS, EMULATOR_PORTS, cleanEnv } from '../src/orchestrator.mjs';
import { PROJECT_ID } from '../src/local-guard.mjs';
import { platformSupport } from '../src/b3/selfcheck-host.mjs';

const PORTS = [...EMULATOR_PORTS, 18398];
async function requireClosed(when) {
  const bad = []; for (const p of PORTS) { const s = await portState(p); if (s.state !== 'closed') bad.push(`${p}=${s.state}(${s.code})`); }
  if (bad.length) { console.log(`PRECONDITION FAILED (${when}): ports not confirmed closed: ${bad.join(', ')}`); process.exit(2); }
}
const sup = platformSupport();
if (!sup.supported) { console.log(`NOT_RUN: sandbox platform unsupported (${sup.reason})`); process.exit(3); }
await requireClosed('before emulator run');
const extra = { RUN_NONCE: randomBytes(16).toString('hex') };
for (const k of ['A10_OUT_DIR', 'A10_SCENARIOS']) if (process.env[k]) extra[k] = process.env[k];
const r = spawnSync(process.execPath, [FIREBASE_JS, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, 'node test/a10-run.mjs'], { cwd: ROOT, env: cleanEnv(process.env, extra), encoding: 'utf8', timeout: 1500000, maxBuffer: 64 * 1024 * 1024 });
const text = (r.stdout || '') + (r.stderr || '');
// only the Runner's own verdict lines are printed (the attacker's output never reaches this process's stdout)
process.stdout.write(text.split('\n').filter((l) => /^(OK|FAIL|S2B2_A10_RUN|PRECONDITION|Error|LOCAL_GUARD|NOT_RUN)/.test(l.trim())).join('\n') + '\n');
await requireClosed('after emulator run');
if (r.status !== 0) { console.log(`A10_FAILED exit=${r.status}`); process.exit(1); }
console.log('A10_OK (trusted judgement; not an attestation)');
