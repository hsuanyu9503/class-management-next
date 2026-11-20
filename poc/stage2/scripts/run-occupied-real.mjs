#!/usr/bin/env node
/** Starts a real local emulator (this run owns it) and runs test/real-occupied.mjs inside it. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_ENV, PROJECT_ID } from '../src/local-guard.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, CI: '1' };
for (const k of [...FORBIDDEN_ENV, 'FIREBASE_CONFIG', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'RUN_NONCE']) delete env[k];
const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:exec', '--only', 'auth,firestore', '--project', PROJECT_ID, 'node test/real-occupied.mjs'], { cwd: ROOT, env, stdio: 'inherit', timeout: 300000 });
if (r.error) { console.error(`spawn error: ${r.error.code || ''} ${r.error.message}`); process.exit(1); }
process.exit(r.status ?? 1);
