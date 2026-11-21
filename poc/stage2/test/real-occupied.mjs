#!/usr/bin/env node
/** S2B2-REV-001 real-emulator regression (run inside `firebase emulators:exec`, see run-occupied-real).
 *  Seeds "foreign" data into the RUNNING emulator, runs the full orchestrator while it is up, and
 *  requires: orchestrator stops at the port precondition (exit 2) AND the foreign data is unchanged. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalConfig } from '../src/local-guard.mjs';
import { firestoreClient, authClient, EMULATOR_OWNER } from '../src/emu-client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = assertLocalConfig(process.env, { firebaseJsonPath: path.join(ROOT, 'firebase.json') });
const fs = firestoreClient(cfg), au = authClient(cfg);
const DOC = 'foreign/preexisting-doc';
const fail = (m) => { console.error(`REAL_OCCUPIED_FAILED: ${m}`); process.exit(1); };

const w = await fs.set(DOC, { owner: 'someone-else', value: 42 }, EMULATOR_OWNER);
if (w.status !== 200) fail(`could not seed foreign doc (${w.status})`);
const su = await au.signUp('foreign-user@example.invalid', 'not-a-real-password-2');
if (su.status !== 200) fail(`could not seed foreign account (${su.status})`);
const before = { doc: (await fs.get(DOC, EMULATOR_OWNER)).json?.fields, accounts: Number((await au.countAccounts()).json?.recordsCount ?? -1) };

const env = { ...process.env };
for (const k of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_CONFIG', 'GCLOUD_PROJECT', 'RUN_NONCE']) delete env[k];
const r = spawnSync(process.execPath, ['scripts/run-smoke.mjs'], { cwd: ROOT, env, encoding: 'utf8', timeout: 120000 });
const out = (r.stdout || '') + (r.stderr || '');

const after = { doc: (await fs.get(DOC, EMULATOR_OWNER)).json?.fields, accounts: Number((await au.countAccounts()).json?.recordsCount ?? -1) };
const result = {
  kind: 'REAL_OCCUPIED_REGRESSION', orchestratorExit: r.status,
  stoppedAtPrecondition: /PRECONDITION FAILED: precondition \(before negatives\): emulator ports confirmed closed/.test(out),
  ranAnySmokeOrProbe: /POSITIVE|NEGATIVE/.test(out),
  foreignDocUnchanged: JSON.stringify(before.doc) === JSON.stringify(after.doc) && before.doc !== undefined,
  foreignAccountsUnchanged: before.accounts === after.accounts && before.accounts === 1,
  before, after,
};
console.log(JSON.stringify(result, null, 2));
await fs.clearAll(); await au.clearAll();          // this exec owns this emulator: it started it
const ok = result.orchestratorExit === 2 && result.stoppedAtPrecondition && !result.ranAnySmokeOrProbe && result.foreignDocUnchanged && result.foreignAccountsUnchanged;
process.exit(ok ? 0 : 1);
