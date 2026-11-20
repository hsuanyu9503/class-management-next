/** S2-B2 batch 1 smoke orchestrator logic (dependency-injectable for regression tests).
 *
 *  Rules (S2B2-REV-001, S2B2-REV-003):
 *   - every precondition is a HARD STOP: on failure nothing else runs (exit 2);
 *   - before and after every emulator run, every emulator port must be confirmed CLOSED
 *     (explicit ECONNREFUSED). 'open' and 'unknown' (EACCES, EPERM, timeout, other errors)
 *     both stop the run;
 *   - "not running" / "disconnect" / guard-refusal negatives use the READ-ONLY probe;
 *   - the smoke clears data only after proving ownership (src/ownership.mjs). */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_ENV, PROJECT_ID } from './local-guard.mjs';
import { portState } from './port-state.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Run the CLI through node (works on Linux, macOS and Windows; no .cmd shim needed).
export const FIREBASE_JS = path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
export const EMULATOR_PORTS = [8080, 9099, 4400, 4500, 9150];   // firestore, auth, hub, logging, firestore websocket
const LOCAL = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };

class HardStop extends Error {}

export function cleanEnv(base, extra = {}) {
  const env = { ...base };
  for (const k of [...FORBIDDEN_ENV, 'FIREBASE_CONFIG', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'RUN_NONCE']) delete env[k];
  return { ...env, CI: '1', ...extra };          // CI=1: firebase-tools skips its remote MOTD fetch
}

/** @param deps.run       (args, env) => { code, spawnError, signal, out }  — spawns `node ...args`
 *  @param deps.checkPort (port) => Promise<{ port, state: 'open'|'closed'|'unknown', code }>
 *  @param deps.log       (line) => void
 *  @returns Promise<{ code, abortedReason, results, smoke }> */
export async function runOrchestrator({ run, checkPort = (p) => portState(p), log = console.log, baseEnv = process.env } = {}) {
  const results = [];
  let smokeJson = null;
  const tail = (s, n = 3) => String(s).trim().split('\n').slice(-n).join('\n');
  const env = (extra) => cleanEnv(baseEnv, extra);
  function expect(name, ok, detail = {}) { results.push({ name, ok, ...detail }); log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail.note ? ' — ' + detail.note : ''}`); return ok; }
  function require_(name, ok, detail = {}) {
    if (!expect(name, ok, detail)) { log(`PRECONDITION FAILED: ${name} — stopping before any further action`); throw new HardStop(name); }
  }
  async function requirePortsClosed(when) {
    const states = [];
    for (const p of EMULATOR_PORTS) states.push(await checkPort(p));
    const notClosed = states.filter((s) => s.state !== 'closed');
    require_(`precondition (${when}): emulator ports confirmed closed`, notClosed.length === 0, {
      ports: states,
      note: notClosed.length ? `not confirmed closed: ${notClosed.map((s) => `${s.port}=${s.state}(${s.code})`).join(', ')}` : '',
    });
  }

  try {
    const g = run(['--test', 'test/guard.test.mjs'], env());
    require_('guard unit tests pass', g.code === 0, { exit: g.code, spawnError: g.spawnError, note: (String(g.out).match(/# pass \d+|# fail \d+/g) || []).join(' ') });

    await requirePortsClosed('before negatives');
    const probe = (e) => run(['test/probe.mjs'], e);
    const n1 = probe(env(LOCAL));
    expect('NEGATIVE emulator not running → read-only probe fails', n1.code !== 0 && /fetch failed|ECONNREFUSED/i.test(n1.out), { exit: n1.code, spawnError: n1.spawnError, evidence: tail(n1.out) });
    const n2 = probe(env({ ...LOCAL, FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }));
    expect('NEGATIVE production Firestore host → refused by guard before any request', n2.code !== 0 && /LOCAL_GUARD: FIRESTORE_EMULATOR_HOST/.test(n2.out), { exit: n2.code, evidence: tail(n2.out) });
    const n3 = probe(env({ ...LOCAL, GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/fake-sa.json' }));
    expect('NEGATIVE credential variable present → refused by guard', n3.code !== 0 && /LOCAL_GUARD: credential/.test(n3.out), { exit: n3.code, evidence: tail(n3.out) });
    const n4 = probe(env());
    expect('NEGATIVE emulator settings missing → refused (no fallback)', n4.code !== 0 && /LOCAL_GUARD: FIRESTORE_EMULATOR_HOST is not set/.test(n4.out), { exit: n4.code, evidence: tail(n4.out) });

    const exec = (extraArgs) => run([FIREBASE_JS, 'emulators:exec', ...extraArgs, '--only', 'auth,firestore', '--project', PROJECT_ID, 'node test/smoke.mjs'], env({ RUN_NONCE: randomBytes(16).toString('hex') }));

    await requirePortsClosed('before positive smoke');
    const pos = exec([]);
    smokeJson = (() => { const m = String(pos.out).match(/\{\n\s+"kind": "INFRA_SMOKE",[\s\S]*?\n\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
    expect('POSITIVE emulators:exec smoke passes', pos.code === 0 && !!smokeJson?.steps?.every((s) => s.ok), { exit: pos.code, spawnError: pos.spawnError, steps: smokeJson?.steps?.map((s) => `${s.ok ? '✓' : '✗'} ${s.name}`), firebaseLog: tail(String(pos.out).replace(/\{\n\s+"kind": "INFRA_SMOKE"[\s\S]*?\n\}/, '<smoke JSON>'), 12) });

    await requirePortsClosed('after positive smoke, before rules-relaxed negative');
    const relaxed = exec(['--config', 'test/negative-controls/firebase.permissive.json']);
    expect('NEGATIVE rules relaxed to allow-all → smoke fails at deny-anonymous-read', relaxed.code !== 0 && /SMOKE_STEP_FAILED: deny-anonymous-read/.test(relaxed.out), { exit: relaxed.code, spawnError: relaxed.spawnError, evidence: (String(relaxed.out).match(/SMOKE_STEP_FAILED: [^"\n]*/) || ['(no step failure found)'])[0] });

    await requirePortsClosed('after all emulator runs (emulators stopped)');
    const n5 = probe(env(LOCAL));
    expect('NEGATIVE after emulators stopped (disconnect) → read-only probe fails', n5.code !== 0 && /fetch failed|ECONNREFUSED/i.test(n5.out), { exit: n5.code, evidence: tail(n5.out) });

    return { code: results.every((r) => r.ok) ? 0 : 1, abortedReason: null, results, smoke: smokeJson };
  } catch (e) {
    if (e instanceof HardStop) return { code: 2, abortedReason: e.message, results, smoke: smokeJson };
    throw e;
  }
}
