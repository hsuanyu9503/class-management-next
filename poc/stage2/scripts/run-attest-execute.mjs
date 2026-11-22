#!/usr/bin/env node
/** S2-B2 B3b — attest.yml EXECUTE job (TRUSTED TOOLCHAIN). Runs ONE honest case in the sandbox on the real
 *  emulators and seals it (package + execute-outputs.json in B3_OUT_DIR). Same port lifecycle as run-b3.mjs:
 *  every precondition is a hard stop. Needs Linux + root (the job runs it with sudo). Unsupported platform or
 *  any failure → non-zero exit and NO package: the verify job then has nothing to verify (NOT_RUN, never PASS).
 *  Usage: B3_SINGLE_CASE=POC-001 B3_SCENARIO=honest B3_OUT_DIR=/path node scripts/run-attest-execute.mjs
 *  B3_SCENARIO is a TRUSTED workflow input (attest.yml fixes 'honest'; attest-attack.yml: the dispatch input). */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { portState } from '../src/port-state.mjs';
import { ROOT, FIREBASE_JS, EMULATOR_PORTS, cleanEnv } from '../src/orchestrator.mjs';
import { PROJECT_ID } from '../src/local-guard.mjs';
import { SENTINEL_TCP_PORT } from '../src/b3/isolation-policy.mjs';
import { platformSupport } from '../src/b3/selfcheck-host.mjs';
import { SCENARIO_RE } from '../src/b3/verifier.mjs';

const testId = process.env.B3_SINGLE_CASE; const out = process.env.B3_OUT_DIR;
const scenario = process.env.B3_SCENARIO;
if (!SCENARIO_RE.test(scenario || '')) { console.log('USAGE: B3_SCENARIO=<honest|attack-…> is required (never defaulted)'); process.exit(2); }
if (!['POC-001', 'POC-002', 'POC-008', 'POC-009'].includes(testId) || !out || !path.isAbsolute(out)) { console.log('USAGE: B3_SINGLE_CASE=<POC-001|002|008|009> B3_OUT_DIR=<absolute dir>'); process.exit(2); }
const PORTS = [...EMULATOR_PORTS, 18300, 18301, 18302, SENTINEL_TCP_PORT];
async function requireClosed(when) {
  const bad = []; for (const p of PORTS) { const s = await portState(p); if (s.state !== 'closed') bad.push(`${p}=${s.state}(${s.code})`); }
  if (bad.length) { console.log(`PRECONDITION FAILED (${when}): ports not confirmed closed: ${bad.join(', ')}`); process.exit(2); }
}
const sup = platformSupport();
if (!sup.supported) { console.log(`NOT_RUN: sandbox platform unsupported (${sup.reason})`); process.exit(3); }
await requireClosed('before emulator run');
const env = cleanEnv(process.env, { RUN_NONCE: randomBytes(16).toString('hex'), B3_SINGLE_CASE: testId, B3_SCENARIO: scenario, B3_OUT_DIR: out });
// GitHub Actions context the Runner needs (run binding, command-file paths to hide); never tokens
for (const k of ['GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY', 'GITHUB_STATE']) if (process.env[k]) env[k] = process.env[k];
const r = spawnSync(process.execPath, [FIREBASE_JS, 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, 'node test/b3-run.mjs'], { cwd: ROOT, env, encoding: 'utf8', timeout: 1500000, maxBuffer: 64 * 1024 * 1024 });
const text = (r.stdout || '') + (r.stderr || '');
process.stdout.write(text.split('\n').filter((l) => /^(OK|FAIL|S2B2_B3B_EXECUTE|PRECONDITION|Error|OWNERSHIP|LOCAL_GUARD|NOT_RUN)/.test(l.trim())).join('\n') + '\n');
await requireClosed('after emulator run');
const ok = r.status === 0 && existsSync(path.join(out, 'execute-outputs.json')) && existsSync(path.join(out, `package-${testId}.tar`));
if (!ok) { console.log(text.slice(-4000)); console.log(`EXECUTE_FAILED exit=${r.status}`); process.exit(1); }
console.log('EXECUTE_OK (sealed; not an attestation)');
