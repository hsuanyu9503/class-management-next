#!/usr/bin/env node
/** S2-B2 B4: controlled WRITE cases POC-016/017/018/021 on the REAL Auth/Firestore emulators, in process (no
 *  sandbox: the sandboxed honest runs are in b3-run.mjs), plus the mutation demonstrations and the seven new-path
 *  negative tests of plan S2B2-B4-PLAN v0.2 §3.4. Runs only inside `firebase emulators:exec` (scripts/run-b4.mjs).
 *  Every judgement uses the TRUSTED judges (reconcile + Observer + Stage 1 comparator + front-fault check) on the
 *  masked traces and exported state — never the Adapter's claim. Results are UNATTESTED at best, never PASS. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalConfig, assertLoopbackUrl } from '../src/local-guard.mjs';
import { firestoreClient, authClient, EMULATOR_OWNER } from '../src/emu-client.mjs';
import { MARKER_COLLECTION, assertNonce, assertFreshEmulator, assertStillOwned } from '../src/ownership.mjs';
import { loadFixtures, STAGE1_ROOT } from '../src/seed.mjs';
import { makeMasker, findLeaks } from '../src/mask.mjs';
import { fixtureNames } from '../src/world.mjs';
import { createHarness, PORTS } from '../src/harness.mjs';
import { observe } from '../src/observer.mjs';
import { verdict } from '../src/verdict.mjs';
import { reconcile } from '../src/b3/reconcile.mjs';
import { CASE_ACTORS, checkFrontFaults, frontFaultsFor } from '../src/b3/verifier.mjs';
import { transactionsOf } from '../src/b4/commit-trace.mjs';
import { stableJson, sha256Hex } from '../src/stable.mjs';
import { runWriteCase, writeClaimFrom } from '../adapter-b3/core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
export const FAULT_PORT = 18306;       // test-only backend fault proxy (negative test 7); checked closed by run-b4.mjs
const WRITE = ['POC-016', 'POC-017', 'POC-018', 'POC-021'];
const cfg = assertLocalConfig(process.env, { firebaseJsonPath: path.join(ROOT, 'firebase.json') });
const nonce = assertNonce(process.env.RUN_NONCE);
const runId = `S2B2B4-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}-${nonce.slice(0, 8)}`;
const fsc = firestoreClient(cfg); const au = authClient(cfg);
const rc = await fsc.listRootCollections(EMULATOR_OWNER); const ac0 = await au.countAccounts();
assertFreshEmulator({ rootCollections: rc.status === 200 ? (rc.json?.collectionIds || []) : null, authAccounts: ac0.status === 200 ? Number(ac0.json?.recordsCount ?? 0) : null });
if ((await fsc.set(`${MARKER_COLLECTION}/${nonce}`, { nonce, createdAt: new Date().toISOString() }, EMULATOR_OWNER)).status !== 200) throw new Error('marker');

const { fixtures } = loadFixtures();
const caseSpecs = Object.fromEntries(JSON.parse(readFileSync(path.join(STAGE1_ROOT, 'contracts/canonical-oracles-v1.0.json'))).cases.map((c) => [c.testId, c]));
const names = fixtureNames(fixtures);
const masker = makeMasker(names);
const h = createHarness({ cfg, nonce, fixtures, masker });
const runDir = path.join(ROOT, 'evidence', 'runs', 's2b2-b4', runId);
mkdirSync(runDir, { recursive: true });
const readJsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const S = { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' };
const LV_PATH = 'workspaces/WS-SC01/classes/CLASS-606-SC01/leaveRecords/LV-007';
const results = [];
const log = (ok, name, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

/** HTTP to the FRONT proxy (TCP), like the in-process Adapter of batch 2. A destroyed connection → status 0. */
function sendVia(origin, token) {
  return (p, body) => new Promise((resolve) => {
    const u = new URL(p, origin); assertLoopbackUrl(u.href);
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, timeout: 15000 }, (x) => {
      let s = ''; x.on('data', (d) => { s += d; }); x.on('end', () => { let b = null; try { b = JSON.parse(s); } catch { /* */ } resolve({ status: x.statusCode, body: b }); });
    });
    r.on('error', (e) => resolve({ status: 0, body: null, error: e.code || e.message })); r.on('timeout', () => r.destroy());
    r.end(JSON.stringify(body));
  });
}

/** The trusted judgement of one captured case: reconcile + Observer + Stage 1 comparator + front faults. */
export function judge({ testId, front, back, pre, post, caseWindow, claim = null }) {
  const rec = reconcile({ front, back, pre, post, runnerLog: [], caseWindow, markerPath: '_none/none', expectedMarker: undefined, ownershipMarkerPath: `${MARKER_COLLECTION}/${nonce}` });
  const obs = observe({ testId, actor: CASE_ACTORS[testId], front, back, pre, post });
  const v = verdict({ caseSpec: caseSpecs[testId], observation: obs, adapterOutput: claim, stage1Result: null, inputDigestsVerified: true });
  const faults = checkFrontFaults(front, testId);
  const problems = [...rec.problems, ...faults, ...v.problems.filter((x) => !rec.problems.includes(x))];
  return { accepted: v.contractMatch === 'MATCH' && rec.problems.length === 0 && faults.length === 0, contractMatch: v.contractMatch, observed: v.observedCanonical, oracleFailures: v.oracleFailures, problems, reconciliation: rec.counts, evidence: obs.evidence, assertions: obs.assertions, adapterClaimAgrees: v.adapterClaimAgreesWithObserver };
}

/** One captured case. opts (tests only): mutation (API), frontFaults override, plan override, backendOrigin, setup. */
async function capture(testId, { label = testId, mutation, frontFaults = frontFaultsFor(testId), plan, backendOrigin, setup } = {}) {
  const users = await h.seedWorld();
  if (setup) await setup(users);
  const dir = path.join(runDir, 'cases', label); mkdirSync(dir, { recursive: true });
  const frontFile = path.join(dir, 'trace-front.jsonl'), backFile = path.join(dir, 'trace-back.jsonl');
  const stack = await h.startStack({ frontFile, backFile, mutation, frontFaults, ...(backendOrigin ? { backendOrigin } : {}) });
  const pre = await h.exportState();
  const start = Date.now();
  const send = sendVia(stack.frontOrigin, users['ACTOR-SC01-TEACHER'].token);
  let run;
  if (plan) run = await plan({ send, users, stack });
  else { const r = await runWriteCase(testId, fixtures, { send, uuid: randomUUID }); run = { claim: writeClaimFrom(testId, r.results), raw: r.results }; }
  await new Promise((r) => setTimeout(r, 30));
  const end = Date.now();
  await stack.stop();
  const post = await h.exportState();
  writeFileSync(path.join(dir, 'state-pre.json'), JSON.stringify(pre.docs, null, 1));
  writeFileSync(path.join(dir, 'state-post.json'), JSON.stringify(post.docs, null, 1));
  const front = readJsonl(frontFile); const back = readJsonl(backFile);
  const j = judge({ testId, front, back, pre: pre.docs, post: post.docs, caseWindow: { start, end }, claim: run?.claim ?? null });
  writeFileSync(path.join(dir, 'judgement.json'), JSON.stringify({ label, testId, ...j, adapterClaim: run?.claim ?? null }, null, 1));
  return { ...j, label, testId, front, back, pre: pre.docs, post: post.docs, caseWindow: { start, end }, run, users };
}
const brief = (x) => `contract=${x.contractMatch} observed=${JSON.stringify(x.observed)} problems=${x.problems.slice(0, 6).join('|') || '-'}`;

// ---------------------------------------------------------------- 1. honest cases (expected: accepted, MATCH)
const honest = {};
for (const t of WRITE) {
  const x = await capture(t); honest[t] = x;
  log(x.accepted, `HONEST ${t}`, `${brief(x)} reconcile=${JSON.stringify(x.reconciliation)}`);
}
{ const e = honest['POC-017'].evidence; log(e?.concurrency?.established === true, 'POC-017 concurrency established from back-trace intervals (same proxy clock)', JSON.stringify(e?.concurrency)); }
// INFO only (not a pass condition): how the Emulator serialized the two overlapping transactions in THIS run —
// either one commit ABORTED (lock timeout) and the API retried in a new transaction, or the second read waited
// behind the first commit. Retry handling itself is covered deterministically by b4-unit and NEG-7.
{ const e = honest['POC-017'].evidence; const retried = Object.values(e?.attempts || {}).some((s) => s.length > 1);
  const info = { retried, mode: retried ? 'ABORTED_THEN_RETRIED' : 'READ_WAITED_BEHIND_COMMIT', attempts: e?.attempts };
  results.push({ name: 'INFO POC-017 serialization mode', ok: true, info: true, detail: JSON.stringify(info) }); console.log(`INFO POC-017 serialization mode — ${info.mode} ${JSON.stringify(e?.attempts)}`); }
{ const rcp = honest['POC-016'].post['workspaces/WS-SC01/operationReceipts/OP-SC01-EXAMPLE-0001']; log(rcp?.requestHash === 'ff212f322297ac317fd3869dceffb81c094b1457de01c111762c6335b177c8cf', 'POC-016 stored receipt requestHash equals the §8 test vector ff212f32…', rcp?.requestHash); }

// ---------------------------------------------------------------- 2. mutations: a broken API / setup must be REJECTED by the judges
const MUT = [
  { label: 'MUT-skip-receipt-check-POC-018', testId: 'POC-018', opts: { mutation: { skipReceiptCheck: true } }, why: 'API skips the §8 step 3 receipt check' },
  { label: 'MUT-skip-version-check-POC-017', testId: 'POC-017', opts: { mutation: { skipVersionCheck: true } }, why: 'API skips the §8 step 4 version check' },
  { label: 'MUT-split-commit-POC-016', testId: 'POC-016', opts: { mutation: { splitCommit: true } }, why: 'API writes the five documents in two commits (not atomic) — negative test 4' },
  { label: 'MUT-receipt-reexecutes-POC-021', testId: 'POC-021', opts: { mutation: { receiptReexecute: { intent: { coverageChange: 'AM_TO_PM', reasonCode: 'SOURCE_CORRECTION' } } } }, why: 'receipt query re-executes the command under a new operationId', reconcileProblem: 'transactionOrWriteWithoutCommit' },
  { label: 'MUT-receipt-writes-POC-021', testId: 'POC-021', opts: { mutation: { receiptWrites: true } }, why: 'receipt query writes (derivedProgress) — negative test 5', reconcileProblem: 'transactionOrWriteWithoutCommit' },
  { label: 'MUT-fake-transaction-ref-POC-016', testId: 'POC-016', opts: { mutation: { reportTransactionRef: () => 'FAKE-TXN-REF' } }, why: 'API self-reports a transaction id the Emulator never issued — negative test 3a' },
  { label: 'MUT-sequential-adapter-POC-017', testId: 'POC-017', opts: { plan: async ({ send }) => { const c = fixtures.canonicalCommand; const a = await send('/v1/commit', { command: { ...c, operationId: randomUUID() }, claimedScope: S }); const b = await send('/v1/commit', { command: { ...c, operationId: randomUUID(), intent: { ...c.intent, coverageChange: 'AM_TO_PM' } }, claimedScope: S }); return { claim: null, raw: { a, b } }; } }, why: 'the Adapter submits one after the other (the sync point times out): overlap not established → INCONCLUSIVE, never a pass', expectProblem: 'INCONCLUSIVE:CONCURRENCY_NOT_ESTABLISHED', onlyProblem: true },
  { label: 'MUT-no-drop-POC-021', testId: 'POC-021', opts: { frontFaults: null }, why: 'response not actually lost → the recovery is not demonstrated → INCONCLUSIVE', expectProblem: 'INCONCLUSIVE:RESPONSE_LOSS_NOT_ESTABLISHED' },
];
const mutResults = [];
for (const m of MUT) {
  const x = await capture(m.testId, { label: m.label, ...m.opts });
  // onlyProblem: the named judge is the ONLY thing that rejects the run (isolates that check)
  const ok = !x.accepted && (!m.expectProblem || x.problems.includes(m.expectProblem)) && (!m.onlyProblem || x.problems.every((p) => p === m.expectProblem || p.startsWith('ASSERTION_FAILED:')))
    // reconcileProblem: the trusted reconciliation ALONE must also flag it (each layer is tested on its own)
    && (!m.reconcileProblem || x.problems.some((p) => p.startsWith('AUDIT_UNRECONCILED') && p.includes(m.reconcileProblem)));
  mutResults.push({ label: m.label, testId: m.testId, why: m.why, rejected: !x.accepted, contractMatch: x.contractMatch, observed: x.observed, oracleFailures: x.oracleFailures, problems: x.problems });
  log(ok, `MUTATION ${m.label} rejected`, `${m.why}; ${brief(x)}`);
}

// ---------------------------------------------------------------- 3. trace-level forgeries on the honest POC-016 capture (negative test 3)
const H = honest['POC-016'];
const reJudge = (front, back, post = H.post) => judge({ testId: 'POC-016', front, back, pre: H.pre, post, caseWindow: H.caseWindow });
{ const back = H.back.filter((b) => !(b.path.endsWith(':commit') && b.status === 200));
  const x = reJudge(H.front, back); log(!x.accepted && x.problems.some((p) => p.startsWith('STATE_CHANGE_UNEXPLAINED')), 'NEG-3b back trace without the commit → rejected (state change unexplained, no successful commit)', brief(x)); }
{ const back = structuredClone(H.back); const c = back.find((b) => b.path.endsWith(':commit') && b.status === 200); c.requestBody.transaction = 'Tk9UQUlTU1VFRA==';
  const x = reJudge(H.front, back); log(!x.accepted && x.problems.some((p) => p.startsWith('TRANSACTION_UNBOUND')), 'NEG-3c commit names a transaction id the Emulator never handed to this request → rejected', brief(x)); }
{ const back = structuredClone(H.back); const b0 = back.find((b) => b.path.endsWith(':beginTransaction')); b0.responseBody.transaction = 'Rk9SR0VE';
  const x = reJudge(H.front, back); log(!x.accepted && x.problems.some((p) => p.startsWith('TRANSACTION_UNBOUND')), 'NEG-3d beginTransaction response altered (forged id) → every bound call breaks → rejected', brief(x)); }
{ const back = structuredClone(H.back); const c = back.find((b) => b.path.endsWith(':commit') && b.status === 200); c.requestBody.writes = c.requestBody.writes.filter((w) => !/\/events\//.test(w.update?.name || ''));
  const x = reJudge(H.front, back); log(!x.accepted, 'NEG-3e commit body without the event write (state still has it) → rejected', brief(x)); }

// ---------------------------------------------------------------- 4. API behaviour on the new paths (negative tests 1, 2, 6, 7)
const fieldsOnly = (b) => Object.keys(b || {}).sort().join(',');
const backOf = (stack, traceId) => stack.back.entries.filter((e) => e.traceId === traceId);
/** Extra Stage 2 test configuration for the receipt tests ONLY (plan v0.2 §3.1.2): a principal with a valid class
 *  membership WITHOUT leave.revise, and receipts written directly by the test harness. Not a POC case principal;
 *  it grants no new capability; the locked fixtures are not modified. */
const NOREV = 'ACTOR-B4-RECEIPT-NOREVISE';
async function receiptSetup(users) {
  const iso = '2026-11-01T00:00:00Z';
  await h.putDoc(`principals/${NOREV}`, { principalId: NOREV, status: 'active', createdAt: iso, updatedAt: iso });
  await h.putDoc(`workspaces/WS-SC01/memberships/MEM-${NOREV}`, { membershipId: `MEM-${NOREV}`, version: 1, principalId: NOREV, workspaceId: 'WS-SC01', scopeType: 'class', classId: 'CLASS-606-SC01', rolePreset: 'homeroom_teacher', rolePresetVersion: 's2b1-v1', capabilities: ['leave.read'], status: 'active', validFrom: '2026-09-01', validToExclusive: null, createdBy: 'B4-TEST-CONFIG', updatedBy: 'B4-TEST-CONFIG' });
  for (const [op, owner] of [['OP-B4-NOREV-0001', NOREV], ['OP-B4-SC01T-0001', 'ACTOR-SC01-TEACHER']]) {
    await h.putDoc(`workspaces/WS-SC01/operationReceipts/${op}`, { operationId: op, requestHash: '0'.repeat(64), requestHashAlgorithm: 'sha256-stablejson-v1', principalId: owner, classId: 'CLASS-606-SC01', commandType: 'LeaveRecord.Revise', targetType: 'LeaveRecord', targetId: 'LV-007', status: 'committed', previousVersion: 5, currentVersion: 6, derivedStatusAtCommit: 'pending', committedAt: iso });
    await h.putDoc(`workspaces/WS-SC01/derivedProgress/${op}`, { operationId: op, derivedStatus: 'done', updatedAt: iso, attempts: 1 });
  }
  // an Auth user + active binding for the test principal (same procedure as the harness's actors)
  const email = 'b4-norevise@example.invalid'; const password = randomUUID();
  const su = await fetch(`${cfg.auth.origin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-local`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }).then((r) => r.json());
  await h.putDoc(`authBindings/${su.localId}`, { authUid: su.localId, principalId: NOREV, status: 'active', activatedAt: new Date(Math.floor((Date.now() - 1000) / 1000) * 1000).toISOString().replace('.000Z', 'Z'), bindingVersion: 1 });
  await new Promise((r) => setTimeout(r, 1100));
  users[NOREV] = { uid: su.localId, email, password }; users[NOREV].token = await h.signIn(users[NOREV]);
}
{ // negative test 1 (+ REV-20-01 positive): receipt authorization
  const users = await h.seedWorld(); await receiptSetup(users);
  const dir = path.join(runDir, 'cases', 'NEG-1-receipts'); mkdirSync(dir, { recursive: true });
  const stack = await h.startStack({ frontFile: path.join(dir, 'trace-front.jsonl'), backFile: path.join(dir, 'trace-back.jsonl') });
  const as = (actor) => sendVia(stack.frontOrigin, users[actor].token);
  const own = await as(NOREV)('/v1/receipt', { operationId: 'OP-B4-NOREV-0001', workspaceId: 'WS-SC01' });
  log(own.status === 200 && own.body?.code === 'OK' && own.body.receipt?.operationId === 'OP-B4-NOREV-0001' && own.body.derivedStatus === 'done' && own.body.receipt.derivedStatusAtCommit === 'pending',
    'REV-20-01 owner WITHOUT leave.revise (valid membership) reads own receipt; derivedStatus comes from derivedProgress, the receipt stays immutable', `status=${own.status} derived=${own.body?.derivedStatus} atCommit=${own.body?.receipt?.derivedStatusAtCommit}`);
  const other = await as('ACTOR-SC01-TEACHER')('/v1/receipt', { operationId: 'OP-B4-NOREV-0001', workspaceId: 'WS-SC01' });
  const missing = await as('ACTOR-SC01-TEACHER')('/v1/receipt', { operationId: 'OP-B4-DOES-NOT-EXIST', workspaceId: 'WS-SC01' });
  const foreign = await as('ACTOR-OTHER')('/v1/receipt', { operationId: 'OP-B4-SC01T-0001', workspaceId: 'WS-SC01' });
  log([other, missing, foreign].every((r) => r.status === 403 && r.body?.code === 'FORBIDDEN' && fieldsOnly(r.body) === 'code,traceId'),
    'NEG-1 someone else\'s receipt / a nonexistent receipt / no membership → identical FORBIDDEN {code, traceId}, nothing leaked', [other, missing, foreign].map((r) => `${r.status}:${fieldsOnly(r.body)}`).join(' '));
  await h.patchDoc(`workspaces/WS-SC01/memberships/MEM-${NOREV}`, { validToExclusive: '2026-10-01' });
  const expired = await as(NOREV)('/v1/receipt', { operationId: 'OP-B4-NOREV-0001', workspaceId: 'WS-SC01' });
  await h.patchDoc(`workspaces/WS-SC01/memberships/MEM-${NOREV}`, { validToExclusive: null });
  await h.patchDoc(`authBindings/${users[NOREV].uid}`, { status: 'disabled' });
  const disabled = await as(NOREV)('/v1/receipt', { operationId: 'OP-B4-NOREV-0001', workspaceId: 'WS-SC01' });
  log([expired, disabled].every((r) => r.status === 403 && fieldsOnly(r.body) === 'code,traceId'), 'NEG-1 owner whose membership expired / whose binding is disabled → FORBIDDEN', `${expired.status} ${disabled.status}`);
  const receiptTraces = [own, other, missing, foreign, expired, disabled].map((r) => r.body?.traceId);
  await stack.stop();
  const noTxn = receiptTraces.every((t) => { const v = transactionsOf(stack.back.entries, t); return v.attempts.length === 0 && v.otherWrites.length === 0 && v.unboundTxnCalls.length === 0; });
  log(noTxn, 'NEG-1/5 every receipt query: no transaction call, no write except its audit record', `${receiptTraces.length} traces`);
}
{ // negative test 2: same operationId, different content → OPERATION_REUSE_MISMATCH {code, operationId}; no write; nothing leaked
  const users = await h.seedWorld();
  const dir = path.join(runDir, 'cases', 'NEG-2-reuse'); mkdirSync(dir, { recursive: true });
  const stack = await h.startStack({ frontFile: path.join(dir, 'trace-front.jsonl'), backFile: path.join(dir, 'trace-back.jsonl') });
  const send = sendVia(stack.frontOrigin, users['ACTOR-SC01-TEACHER'].token);
  const c = fixtures.canonicalCommand;
  const first = await send('/v1/commit', { command: c, claimedScope: S });
  const mid = await h.exportState();
  const reuse = await send('/v1/commit', { command: { ...c, intent: { ...c.intent, coverageChange: 'AM_TO_PM' } }, claimedScope: S });
  const after = await h.exportState();
  await stack.stop();
  const v = transactionsOf(stack.back.entries, reuse.body?.traceId);
  const nonAudit = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !/auditLog/.test(k)));
  log(first.body?.code === 'OK' && reuse.status === 409 && reuse.body?.code === 'OPERATION_REUSE_MISMATCH' && fieldsOnly(reuse.body) === 'code,operationId,traceId' && reuse.body.operationId === c.operationId
    && stableJson(nonAudit(mid.docs)) === stableJson(nonAudit(after.docs)) && v.attempts.every((a) => !a.commit) && !JSON.stringify(reuse.body).includes('"currentVersion"'),
  'NEG-2 same operationId, different intent → 409 {code, operationId} only, no write, no field of the original receipt', `status=${reuse.status} fields=${fieldsOnly(reuse.body)} attempts=${v.attempts.length}`);
}
{ // negative test 6: unauthorized commit → FORBIDDEN, and the back trace shows NO transaction and NO receipt read
  const users = await h.seedWorld();
  const dir = path.join(runDir, 'cases', 'NEG-6-unauthorized'); mkdirSync(dir, { recursive: true });
  const stack = await h.startStack({ frontFile: path.join(dir, 'trace-front.jsonl'), backFile: path.join(dir, 'trace-back.jsonl') });
  const c = fixtures.canonicalCommand; const out = [];
  for (const actor of ['ACTOR-OTHER', 'ACTOR-TEACHER']) out.push(await sendVia(stack.frontOrigin, users[actor].token)('/v1/commit', { command: c, claimedScope: S }));
  out.push(await sendVia(stack.frontOrigin, null)('/v1/commit', { command: c, claimedScope: S }));
  await stack.stop();
  const clean = out.every((r) => { const es = backOf(stack, r.body?.traceId); return r.status === 403 && fieldsOnly(r.body) === 'code,traceId' && !es.some((e) => /:beginTransaction|:batchGet|:commit|operationReceipts/.test(e.path + JSON.stringify(e.requestBody || ''))); });
  log(clean, 'NEG-6 commit by ACTOR-OTHER / ACTOR-TEACHER (no leave.revise in WS-SC01) / no token → FORBIDDEN; no transaction and no receipt read in the back trace', out.map((r) => r.status).join(','));
}
{ // negative test 7: contention beyond the retry limit → TRANSACTION_CONTENTION (503), never VERSION_CONFLICT
  // A test-only fault proxy between the API and the back proxy answers every :commit with 409 ABORTED.
  const fault = http.createServer((req, res) => {
    let s = ''; req.on('data', (d) => { s += d; }); req.on('end', async () => {
      if (req.url.endsWith(':commit')) { res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 409, message: 'injected', status: 'ABORTED' } })); return; }
      const headers = {}; for (const k of ['content-type', 'authorization', 'x-cmn-trace-id']) if (req.headers[k]) headers[k] = req.headers[k];
      const up = await fetch(`http://127.0.0.1:${PORTS.back}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : s });
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' }); res.end(await up.text());
    });
  });
  await new Promise((r) => fault.listen(FAULT_PORT, '127.0.0.1', r));
  const x = await capture('POC-017', { label: 'NEG-7-contention-POC-017', backendOrigin: `http://127.0.0.1:${FAULT_PORT}` });
  await new Promise((r) => fault.close(r));
  const reqs = x.front.filter((e) => e.path === '/v1/commit');
  const audits = Object.entries(x.post).filter(([k, d]) => /auditLog\//.test(k) && d.action === 'leaveRecord.revise').map(([, d]) => d);
  log(reqs.length === 2 && reqs.every((e) => e.status === 503 && e.responseBody?.reason === 'TRANSACTION_CONTENTION') && audits.length === 2 && audits.every((a) => a.outcome === 'TRANSACTION_CONTENTION' && a.attempts === 6 && a.transactionRef === null)
    && x.observed?.conflicts === 0 && x.observed?.successes === 0 && !x.accepted,
  'NEG-7 every commit ABORTED → 6 attempts (1 + 5 retries) → 503 TRANSACTION_CONTENTION; the judge counts 0 conflicts (never VERSION_CONFLICT)', `${reqs.map((e) => `${e.status}/${e.responseBody?.reason}`).join(',')} audits=${audits.map((a) => `${a.outcome}x${a.attempts}`).join(',')} observed=${JSON.stringify(x.observed)}`);
}

// ---------------------------------------------------------------- 5. masking scan + owned cleanup
const secrets = h.issuedSecrets();
const { readdirSync, statSync } = await import('node:fs');
const files = []; const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } }; walk(runDir);
const leaks = files.map((f) => ({ f: path.relative(runDir, f), l: findLeaks(readFileSync(f, 'utf8'), { names, secrets }) })).filter((r) => r.l.length);
log(leaks.length === 0, `MASKING ${files.length} artifact files scanned with ${secrets.length} issued secrets`, leaks.length ? JSON.stringify(leaks.slice(0, 3)) : '0 leaks');
assertStillOwned(await h.markerIds(), nonce);
await fsc.clearAll(); await au.clearAll();

const summary = { kind: 'S2B2_B4_RUN', runId, attestation: 'UNATTESTED', notAPocPass: true,
  honest: Object.fromEntries(Object.entries(honest).map(([t, x]) => [t, { accepted: x.accepted, contractMatch: x.contractMatch, observed: x.observed, problems: x.problems, reconciliation: x.reconciliation, assertions: x.assertions, evidence: x.evidence, adapterClaimAgrees: x.adapterClaimAgrees }])),
  mutations: mutResults, checks: results, ok: results.every((r) => r.ok) };
writeFileSync(path.join(runDir, 'run-summary.json'), JSON.stringify(summary, null, 1));
writeFileSync(path.join(ROOT, 'evidence', 'runs', 's2b2-b4-latest.json'), JSON.stringify({ runDir: path.relative(ROOT, runDir), ...summary }, null, 1));
console.log(`S2B2_B4_RUN ${runId} ok=${summary.ok} checks=${results.filter((r) => r.ok).length}/${results.length}`);
process.exit(summary.ok ? 0 : 1);
