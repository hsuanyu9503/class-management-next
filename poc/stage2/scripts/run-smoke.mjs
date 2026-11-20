#!/usr/bin/env node
/** Orchestrates the S2-B2 batch 1 infrastructure smoke with negative controls.
 *
 *  S2B2-REV-001 rules:
 *   - every precondition is a HARD STOP (process exits immediately; nothing else runs);
 *   - before every emulator start, all emulator ports must be closed;
 *   - "not running" / "disconnect" / guard-refusal negatives use the READ-ONLY probe
 *     (GET only), never the smoke that writes and clears;
 *   - the smoke itself clears data only after proving ownership (src/ownership.mjs).
 *  Exit 0 only if everything behaves as expected. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_ENV, PROJECT_ID } from '../src/local-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Run the CLI through node (works on Linux, macOS and Windows; no .cmd shim needed).
const FIREBASE_JS = path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const EMULATOR_PORTS = [8080, 9099, 4400, 4500, 9150];   // firestore, auth, hub, logging, firestore websocket
const LOCAL = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of [...FORBIDDEN_ENV, 'FIREBASE_CONFIG', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'RUN_NONCE']) delete env[k];
  return { ...env, CI: '1', ...extra };          // CI=1: firebase-tools skips its remote MOTD fetch
}
function run(args, env) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 240000 });
  return { code: r.status, spawnError: r.error ? `${r.error.code || ''} ${r.error.message}`.trim() : null, signal: r.signal, out: (r.stdout || '') + (r.stderr || '') };
}
const portOpen = (port) => new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); s.setTimeout(1500, () => { s.destroy(); res(false); }); });
const openPorts = async () => { const out = []; for (const p of EMULATOR_PORTS) if (await portOpen(p)) out.push(p); return out; };

const results = [];
const tail = (s, n = 3) => s.trim().split('\n').slice(-n).join('\n');
function expect(name, ok, detail = {}) { results.push({ name, ok, ...detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail.note ? ' — ' + detail.note : ''}`); return ok; }
function finish(code, reason) {
  console.log(JSON.stringify({ kind: 'INFRA_SMOKE_RUN', notAContractResult: true, stage1ContractStatus: 'UNCHANGED_NOT_RUN', ok: code === 0, abortedReason: reason ?? null, results, smoke: smokeJson }, null, 2));
  process.exit(code);
}
/** Hard stop: on failure, exit immediately without running anything else. */
function require_(name, ok, detail = {}) { if (!expect(name, ok, detail)) { console.log(`PRECONDITION FAILED: ${name} — stopping before any further action`); finish(2, name); } }
async function requirePortsClosed(when) { const open = await openPorts(); require_(`precondition (${when}): emulator ports closed`, open.length === 0, { openPorts: open, note: open.length ? `open: ${open.join(',')}` : '' }); }
let smokeJson = null;

const g = run(['--test', 'test/guard.test.mjs'], cleanEnv());
require_('guard unit tests pass', g.code === 0, { exit: g.code, spawnError: g.spawnError, note: (g.out.match(/# pass \d+|# fail \d+/g) || []).join(' ') });

await requirePortsClosed('before negatives');
const probe = (env) => run(['test/probe.mjs'], env);
const n1 = probe(cleanEnv(LOCAL));
expect('NEGATIVE emulator not running → read-only probe fails', n1.code !== 0 && /fetch failed|ECONNREFUSED/i.test(n1.out), { exit: n1.code, spawnError: n1.spawnError, evidence: tail(n1.out) });
const n2 = probe(cleanEnv({ ...LOCAL, FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }));
expect('NEGATIVE production Firestore host → refused by guard before any request', n2.code !== 0 && /LOCAL_GUARD: FIRESTORE_EMULATOR_HOST/.test(n2.out), { exit: n2.code, evidence: tail(n2.out) });
const n3 = probe(cleanEnv({ ...LOCAL, GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/fake-sa.json' }));
expect('NEGATIVE credential variable present → refused by guard', n3.code !== 0 && /LOCAL_GUARD: credential/.test(n3.out), { exit: n3.code, evidence: tail(n3.out) });
const n4 = probe(cleanEnv());
expect('NEGATIVE emulator settings missing → refused (no fallback)', n4.code !== 0 && /LOCAL_GUARD: FIRESTORE_EMULATOR_HOST is not set/.test(n4.out), { exit: n4.code, evidence: tail(n4.out) });

const exec = (extraArgs) => run([FIREBASE_JS, 'emulators:exec', ...extraArgs, '--only', 'auth,firestore', '--project', PROJECT_ID, 'node test/smoke.mjs'], cleanEnv({ RUN_NONCE: randomBytes(16).toString('hex') }));

await requirePortsClosed('before positive smoke');
const pos = exec([]);
smokeJson = (() => { const m = pos.out.match(/\{\n\s+"kind": "INFRA_SMOKE",[\s\S]*?\n\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
expect('POSITIVE emulators:exec smoke passes', pos.code === 0 && smokeJson?.steps?.every((s) => s.ok), { exit: pos.code, spawnError: pos.spawnError, steps: smokeJson?.steps?.map((s) => `${s.ok ? '✓' : '✗'} ${s.name}`), firebaseLog: tail(pos.out.replace(/\{\n\s+"kind": "INFRA_SMOKE"[\s\S]*?\n\}/, '<smoke JSON>'), 12) });

await requirePortsClosed('after positive smoke, before rules-relaxed negative');
const relaxed = exec(['--config', 'test/negative-controls/firebase.permissive.json']);
expect('NEGATIVE rules relaxed to allow-all → smoke fails at deny-anonymous-read', relaxed.code !== 0 && /SMOKE_STEP_FAILED: deny-anonymous-read/.test(relaxed.out), { exit: relaxed.code, spawnError: relaxed.spawnError, evidence: (relaxed.out.match(/SMOKE_STEP_FAILED: [^"\n]*/) || ['(no step failure found)'])[0] });

await requirePortsClosed('after all emulator runs (emulators stopped)');
const n5 = probe(cleanEnv(LOCAL));
expect('NEGATIVE after emulators stopped (disconnect) → read-only probe fails', n5.code !== 0 && /fetch failed|ECONNREFUSED/i.test(n5.out), { exit: n5.code, evidence: tail(n5.out) });

finish(results.every((r) => r.ok) ? 0 : 1);
