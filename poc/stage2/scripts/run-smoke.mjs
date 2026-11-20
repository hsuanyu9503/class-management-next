#!/usr/bin/env node
/** Orchestrates the S2-B2 batch 1 infrastructure smoke with negative controls.
 *  Exit 0 only if: guard unit tests pass, every negative control FAILS as expected,
 *  the emulator smoke PASSES, and the smoke FAILS again after the emulators stopped. */
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_ENV, PROJECT_ID } from '../src/local-guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIREBASE = path.join(ROOT, 'node_modules', '.bin', 'firebase');
const SMOKE = ['test/smoke.mjs'];
const LOCAL = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of [...FORBIDDEN_ENV, 'FIREBASE_CONFIG', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) delete env[k];
  return { ...env, CI: '1', ...extra };          // CI=1: firebase-tools skips its remote MOTD fetch
}
function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 240000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const portOpen = (port) => new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); s.setTimeout(1500, () => { s.destroy(); res(false); }); });

const results = [];
const expect = (name, ok, detail) => { results.push({ name, ok, ...detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail.note ? ' — ' + detail.note : ''}`); };
const tail = (s, n = 6) => s.trim().split('\n').slice(-n).join('\n');

const g = run(process.execPath, ['--test', 'test/guard.test.mjs'], cleanEnv());
expect('guard unit tests pass', g.code === 0, { exit: g.code, note: (g.out.match(/# pass \d+|# fail \d+/g) || []).join(' ') });

const before = { f: await portOpen(8080), a: await portOpen(9099) };
expect('precondition: emulator ports closed before start', !before.f && !before.a, { before });

const n1 = run(process.execPath, SMOKE, cleanEnv(LOCAL));
expect('NEGATIVE emulator not running → smoke fails', n1.code !== 0 && /fetch failed|ECONNREFUSED/i.test(n1.out), { exit: n1.code, evidence: tail(n1.out, 3) });
const n2 = run(process.execPath, SMOKE, cleanEnv({ ...LOCAL, FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }));
expect('NEGATIVE production Firestore host → refused by guard before any request', n2.code !== 0 && /LOCAL_GUARD: FIRESTORE_EMULATOR_HOST/.test(n2.out), { exit: n2.code, evidence: tail(n2.out, 3) });
const n3 = run(process.execPath, SMOKE, cleanEnv({ ...LOCAL, GOOGLE_APPLICATION_CREDENTIALS: '/nonexistent/fake-sa.json' }));
expect('NEGATIVE credential variable present → refused by guard', n3.code !== 0 && /LOCAL_GUARD: credential/.test(n3.out), { exit: n3.code, evidence: tail(n3.out, 3) });
const n4 = run(process.execPath, SMOKE, cleanEnv());
expect('NEGATIVE emulator settings missing → refused (no fallback)', n4.code !== 0 && /LOCAL_GUARD: FIRESTORE_EMULATOR_HOST is not set/.test(n4.out), { exit: n4.code, evidence: tail(n4.out, 3) });

const pos = run(FIREBASE, ['emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, `node ${SMOKE.join(' ')}`], cleanEnv());
const smokeJson = (() => { const m = pos.out.match(/\{\n\s+"kind": "INFRA_SMOKE",[\s\S]*?\n\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
expect('POSITIVE emulators:exec smoke passes', pos.code === 0 && smokeJson?.steps?.every((s) => s.ok), { exit: pos.code, steps: smokeJson?.steps?.map((s) => `${s.ok ? '✓' : '✗'} ${s.name}`), firebaseLog: tail(pos.out.replace(/\{\n\s+"kind": "INFRA_SMOKE"[\s\S]*?\n\}/, '<smoke JSON>'), 12) });

const relaxed = run(FIREBASE, ['emulators:exec', '--config', 'test/negative-controls/firebase.permissive.json', '--only', 'auth,firestore', '--project', PROJECT_ID, `node ${SMOKE.join(' ')}`], cleanEnv());
expect('NEGATIVE rules relaxed to allow-all → smoke fails at deny-anonymous-read', relaxed.code !== 0 && /SMOKE_STEP_FAILED: deny-anonymous-read/.test(relaxed.out), { exit: relaxed.code, evidence: (relaxed.out.match(/SMOKE_STEP_FAILED: [^"\n]*/) || ['(no step failure found)'])[0] });

const after = { f: await portOpen(8080), a: await portOpen(9099) };
expect('emulators stopped after exec (ports closed)', !after.f && !after.a, { after });
const n5 = run(process.execPath, SMOKE, cleanEnv(LOCAL));
expect('NEGATIVE after emulators stopped (disconnect) → smoke fails', n5.code !== 0 && /fetch failed|ECONNREFUSED/i.test(n5.out), { exit: n5.code, evidence: tail(n5.out, 3) });

const ok = results.every((r) => r.ok);
console.log(JSON.stringify({ kind: 'INFRA_SMOKE_RUN', notAContractResult: true, stage1ContractStatus: 'UNCHANGED_NOT_RUN', ok, results, smoke: smokeJson }, null, 2));
process.exit(ok ? 0 : 1);
