#!/usr/bin/env node
/** S2-B2 batch 1 INFRASTRUCTURE SMOKE. Runs inside `firebase emulators:exec` (local only).
 *  This is NOT a run of any Stage 1 contract case: POC-001..036 stay NOT_RUN. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalConfig } from '../src/local-guard.mjs';
import { firestoreClient, authClient, EMULATOR_OWNER } from '../src/emu-client.mjs';
import { loadFixtures, buildA17Seed } from '../src/seed.mjs';
import { MARKER_COLLECTION, assertNonce, assertFreshEmulator, assertStillOwned } from '../src/ownership.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const steps = [];
const step = (name, ok, detail = {}) => { steps.push({ name, ok: !!ok, ...detail }); if (!ok) throw new Error(`SMOKE_STEP_FAILED: ${name} ${JSON.stringify(detail)}`); };

async function main() {
  const cfg = assertLocalConfig(process.env, { firebaseJsonPath: path.join(HERE, '..', 'firebase.json') });
  const nonce = assertNonce(process.env.RUN_NONCE);
  step('local-guard', true, { projectId: cfg.projectId, firestore: cfg.firestore.origin, auth: cfg.auth.origin });
  const fs = firestoreClient(cfg), au = authClient(cfg);

  const ping = await fs.ping(); step('firestore-reachable', ping.status === 200, { status: ping.status });
  const ac = await au.config(); step('auth-reachable', ac.status === 200, { status: ac.status });

  // S2B2-REV-001: never clear an emulator this run does not own. Prove it is a fresh, empty instance
  // (read-only checks) BEFORE any write; otherwise stop without sending any PATCH/DELETE.
  const rc = await fs.listRootCollections(EMULATOR_OWNER); const ac0 = await au.countAccounts();
  assertFreshEmulator({ rootCollections: rc.status === 200 ? (rc.json?.collectionIds || []) : null, authAccounts: ac0.status === 200 ? Number(ac0.json?.recordsCount ?? 0) : null });
  step('ownership-fresh-emulator', true, { rootCollections: 0, authAccounts: 0 });
  const mk = await fs.set(`${MARKER_COLLECTION}/${nonce}`, { nonce, createdAt: new Date().toISOString() }, EMULATOR_OWNER);
  step('ownership-marker-written', mk.status === 200, { status: mk.status });

  const { fixtures, fileSha256 } = loadFixtures();
  const seed = buildA17Seed(fixtures);
  for (const [p, data] of seed.docs) { const r = await fs.set(p, data, EMULATOR_OWNER); if (r.status !== 200) step('seed-write', false, { path: p, status: r.status }); }
  step('seed-write', true, { documents: seed.docs.length });

  const entriesPath = `workspaces/${seed.workspaceId}/classes/${seed.classId}/attendanceSessions/${seed.sessionId}/entries`;
  const read = await fs.list(entriesPath, EMULATOR_OWNER);
  const counts = { P: 0, R: 0, N: 0, U: 0 };
  for (const d of read.docs || []) counts[d.data.status] = (counts[d.data.status] ?? 0) + 1;
  const scopeOk = (read.docs || []).every((d) => d.data.workspaceId === seed.workspaceId && d.data.classId === seed.classId);
  step('seed-readback-from-emulator-state', read.status === 200 && read.docs.length === seed.expectedEntries && scopeOk
    && ['P', 'R', 'N', 'U'].every((k) => counts[k] === seed.expectedCounts[k]), { entries: read.docs?.length, counts, scopeFieldsMatchPath: scopeOk });

  // Default-deny: client access with no token and with an emulator-issued user token must both be refused.
  const anyEntry = `${entriesPath}/${read.docs[0].name.split('/').pop()}`;
  const anon = await fs.get(anyEntry);
  step('deny-anonymous-read', anon.status === 403, { status: anon.status });
  const su = await au.signUp('smoke-user@example.invalid', 'not-a-real-password-1');
  step('auth-signup-fictional-user', su.status === 200 && typeof su.json?.idToken === 'string', { status: su.status });
  const lk = await au.lookup(su.json.idToken);
  step('auth-token-lookup', lk.status === 200 && lk.json?.users?.length === 1, { status: lk.status });
  const authed = await fs.get(anyEntry, su.json.idToken);
  step('deny-authenticated-read', authed.status === 403, { status: authed.status });
  const wr = await fs.set(`${entriesPath}/AE-SMOKE-CLIENT-WRITE`, { status: 'P' }, su.json.idToken);
  step('deny-authenticated-write', wr.status === 403, { status: wr.status });

  const markers = await fs.list(MARKER_COLLECTION, EMULATOR_OWNER);
  assertStillOwned(markers.status === 200 ? markers.docs.map((d) => d.name.split('/').pop()) : null, nonce);
  step('ownership-verified-before-clear', true, { markers: 1 });
  const c1 = await fs.clearAll(); const a1 = await au.clearAll();
  const after = await fs.list(entriesPath, EMULATOR_OWNER); const acc = await au.countAccounts();
  step('cleanup', c1.status === 200 && a1.status === 200 && after.docs?.length === 0 && acc.status === 200 && Number(acc.json?.recordsCount ?? 0) === 0,
    { firestoreLeft: after.docs?.length, authAccountsLeft: Number(acc.json?.recordsCount ?? 0), queryStatus: acc.status });

  let gitCommit = null; try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
  const result = {
    kind: 'INFRA_SMOKE', notAContractResult: true, stage1ContractStatus: 'UNCHANGED_NOT_RUN',
    gitCommit, projectId: cfg.projectId, emulatorOrigins: { firestore: cfg.firestore.origin, auth: cfg.auth.origin },
    node: process.version, fixtureFileSha256: fileSha256, steps, finishedAt: new Date().toISOString(),
    note: 'Fictional fixture data only; names are not written to this record.',
  };
  mkdirSync(path.join(HERE, '..', 'evidence', 'runs'), { recursive: true });
  writeFileSync(path.join(HERE, '..', 'evidence', 'runs', 'infra-smoke-latest.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(JSON.stringify({ kind: 'INFRA_SMOKE', ok: false, error: String(e.message || e), steps }, null, 2)); process.exit(1); });
