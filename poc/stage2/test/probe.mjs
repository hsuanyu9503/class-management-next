#!/usr/bin/env node
/** READ-ONLY connectivity probe for negative controls (S2B2-REV-001).
 *  Uses the same local guard as the smoke, then sends only GET requests. Never writes or clears. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalConfig, assertLoopbackUrl } from '../src/local-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
async function get(url) { assertLoopbackUrl(url); const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000), redirect: 'error' }); return r.status; }
try {
  const cfg = assertLocalConfig(process.env, { firebaseJsonPath: path.join(HERE, '..', 'firebase.json') });
  const f = await get(`${cfg.firestore.origin}/`);
  const a = await get(`${cfg.auth.origin}/emulator/v1/projects/${cfg.projectId}/config`);
  console.log(JSON.stringify({ kind: 'READ_ONLY_PROBE', reachable: true, firestore: f, auth: a }));
  process.exit(f === 200 && a === 200 ? 0 : 1);
} catch (e) {
  console.error(JSON.stringify({ kind: 'READ_ONLY_PROBE', reachable: false, error: String(e.message || e) }));
  process.exit(1);
}
