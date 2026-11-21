#!/usr/bin/env node
/** S2-B2 batch 2: runs POC-001/002/008/009 against the REAL Auth/Firestore emulators through the local
 *  controlled read API, plus negative and mutation controls. Runs only inside `firebase emulators:exec`
 *  (started by scripts/run-cases.mjs). Results are UNATTESTED at best — never PASS. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalConfig } from '../src/local-guard.mjs';
import { firestoreClient, authClient, EMULATOR_OWNER } from '../src/emu-client.mjs';
import { MARKER_COLLECTION, assertNonce, assertFreshEmulator, assertStillOwned } from '../src/ownership.mjs';
import { loadFixtures, STAGE1_ROOT } from '../src/seed.mjs';
import { makeMasker, findLeaks } from '../src/mask.mjs';
import { fixtureNames } from '../src/world.mjs';
import { createHarness, PORTS } from '../src/harness.mjs';
import { createFirebaseAdapter, caseRequests } from '../src/adapter.mjs';
import { observe } from '../src/observer.mjs';
import { verdict } from '../src/verdict.mjs';
import { authorize, OPERATIONS } from '../src/authz.mjs';
import { createApi } from '../src/api/server.mjs';
import { stableJson, sha256Hex } from '../src/stable.mjs';
import { executeCase } from '../../stage1/src/runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CASES = ['POC-001', 'POC-002', 'POC-008', 'POC-009'];
const EXPECTED_MATCH = { 'POC-001': 'MATCH', 'POC-002': 'MATCH', 'POC-008': 'MATCH', 'POC-009': 'PARTIAL_MATCH_REST_BLOCKED' };
const fail = (m) => { throw new Error(`CASE_RUN_FAILED: ${m}`); };

const cfg = assertLocalConfig(process.env, { firebaseJsonPath: path.join(ROOT, 'firebase.json') });
const nonce = assertNonce(process.env.RUN_NONCE);
const runId = `S2B2B2-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}-${nonce.slice(0, 8)}`;
const fsc = firestoreClient(cfg); const au = authClient(cfg);

// --- ownership (same rules as batch 1): prove fresh, then mark ---
const rc = await fsc.listRootCollections(EMULATOR_OWNER); const ac0 = await au.countAccounts();
assertFreshEmulator({ rootCollections: rc.status === 200 ? (rc.json?.collectionIds || []) : null, authAccounts: ac0.status === 200 ? Number(ac0.json?.recordsCount ?? 0) : null });
if ((await fsc.set(`${MARKER_COLLECTION}/${nonce}`, { nonce, createdAt: new Date().toISOString() }, EMULATOR_OWNER)).status !== 200) fail('marker');

const { fixtures, fileSha256 } = loadFixtures();
const oracleBytes = readFileSync(path.join(STAGE1_ROOT, 'contracts/canonical-oracles-v1.0.json'));
const caseSpecs = Object.fromEntries(JSON.parse(oracleBytes).cases.filter((c) => CASES.includes(c.testId)).map((c) => [c.testId, c]));
const names = fixtureNames(fixtures);
const masker = makeMasker(names);
const h = createHarness({ cfg, nonce, fixtures, masker });
const runDir = path.join(ROOT, 'evidence', 'runs', 's2b2-b2', runId);
mkdirSync(runDir, { recursive: true });
const digests = {};
const writeArtifact = (rel, text) => { const p = path.join(runDir, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); digests[rel] = sha256Hex(text); return p; };
const verifyArtifacts = (rels) => rels.every((rel) => sha256Hex(readFileSync(path.join(runDir, rel), 'utf8')) === digests[rel]);
const readJsonl = (rel) => readFileSync(path.join(runDir, rel), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** One full case execution. Options are used by the mutation controls only. */
async function runCase(testId, { label = testId, authorizeFn, adapterWrap, mutateDocs, tamper } = {}) {
  const users = await h.seedWorld({ mutateDocs });
  const dir = `cases/${label}`;
  const frontRel = `${dir}/trace-front.jsonl`, backRel = `${dir}/trace-back.jsonl`;
  const stack = await h.startStack({ frontFile: path.join(runDir, frontRel), backFile: path.join(runDir, backRel), authorizeFn });
  const pre = await h.exportState();
  const tokens = Object.fromEntries(Object.entries(users).map(([a, u]) => [a, u.token]));
  let adapter = createFirebaseAdapter({ frontOrigin: stack.frontOrigin, tokens });
  if (adapterWrap) adapter = adapterWrap(adapter);
  let adapterOutput = null;
  const recording = { mode: adapter.mode, backend: adapter.backend, execute: async (...a) => (adapterOutput = await adapter.execute(...a)) };
  const caseSpec = caseSpecs[testId];
  const startedAt = new Date().toISOString();
  const stage1Result = await executeCase(caseSpec, recording, fixtures);
  const post = await h.exportState();
  await stack.stop();
  digests[frontRel] = sha256Hex(readFileSync(path.join(runDir, frontRel), 'utf8'));
  digests[backRel] = sha256Hex(readFileSync(path.join(runDir, backRel), 'utf8'));
  writeArtifact(`${dir}/state-pre.json`, JSON.stringify(pre.docs, null, 1));
  writeArtifact(`${dir}/state-post.json`, JSON.stringify(post.docs, null, 1));
  if (tamper) tamper(path.join(runDir, frontRel));
  const rels = [frontRel, backRel, `${dir}/state-pre.json`, `${dir}/state-post.json`];
  const inputDigestsVerified = verifyArtifacts(rels);
  const actor = caseRequests(testId, fixtures).actor;
  const observation = observe({ testId, actor, front: readJsonl(frontRel), back: readJsonl(backRel), pre: JSON.parse(readFileSync(path.join(runDir, `${dir}/state-pre.json`), 'utf8')), post: JSON.parse(readFileSync(path.join(runDir, `${dir}/state-post.json`), 'utf8')) });
  const v = verdict({ caseSpec, observation, adapterOutput, stage1Result, inputDigestsVerified });
  const record = { runId, label, testId, actor, startedAt, finishedAt: new Date().toISOString(), caseSpecDigest: sha256Hex(stableJson(caseSpec)), stateDigests: { pre: pre.sha256, post: post.sha256 }, artifactDigests: Object.fromEntries(rels.map((r) => [r, digests[r]])), inputDigestsVerified, adapterClaim: adapterOutput, observation, verdict: v };
  writeArtifact(`${dir}/observation.json`, JSON.stringify(record, null, 1));
  return record;
}

// ---------------------------------------------------------------- 1. contract cases
const caseResults = [];
for (const t of CASES) { const r = await runCase(t); caseResults.push(r); console.log(`CASE ${t}: stage2Status=${r.verdict.stage2Status} contractMatch=${r.verdict.contractMatch} adapterAgrees=${r.verdict.adapterClaimAgreesWithObserver} stage1Runner=${r.verdict.stage1Runner?.status} problems=${r.verdict.problems.join('|') || '-'}`); }

// ---------------------------------------------------------------- 2. negative controls (real API)
const A = { workspaceId: 'WS-A17', classId: 'CLASS-606-A17' }; const S = { workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' };
const SESSION = { op: 'attendanceSession.read', target: { sessionId: 'AS-A17-20261117-DAILY' }, claimedScope: A };
const A17_ENTRY = { op: 'attendanceEntry.read', target: { attendanceEntryId: 'AE-EN-A17-1151-0001' }, claimedScope: A };
const SC01_ENTRY = { op: 'attendanceEntry.read', target: { attendanceEntryId: 'AT-20261116-07' }, claimedScope: S };
const MEM_A = 'workspaces/WS-A17/memberships/MEM-ACTOR-TEACHER';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const forge = (token, { header, payload }) => { const [hh, pp] = token.split('.'); const H = JSON.parse(Buffer.from(hh, 'base64url')); const P = JSON.parse(Buffer.from(pp, 'base64url')); return `${b64({ ...H, ...header })}.${b64({ ...P, ...(typeof payload === 'function' ? payload(P) : payload) })}.`; };
const todayTaipei = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nowSec = () => Math.floor(Date.now() / 1000);
const isoSec = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');
const memPatch = (patch) => async () => h.patchDoc(MEM_A, patch);
const bindPatch = (actor, patch) => async (ctx) => h.patchDoc(`authBindings/${ctx.users[actor].uid}`, patch);

const T = 'ACTOR-TEACHER';
const NEG = [
  { name: 'no token', token: () => null, reason: 'TOKEN_MISSING' },
  { name: 'garbage token', token: () => 'abc.def.ghi', reason: 'TOKEN_MALFORMED' },
  { name: 'forged token: expired exp', token: (c) => forge(c.users[T].token, { payload: (p) => ({ exp: nowSec() - 10, iat: Math.min(p.iat, nowSec() - 20), auth_time: Math.min(p.iat, nowSec() - 20) }) }), reason: 'TOKEN_EXPIRED' },
  { name: 'forged token: wrong audience', token: (c) => forge(c.users[T].token, { payload: { aud: 'demo-other-project' } }), reason: 'TOKEN_WRONG_AUDIENCE' },
  { name: 'forged token: alg RS256 header', token: (c) => forge(c.users[T].token, { header: { alg: 'RS256' } }), reason: 'TOKEN_NOT_EMULATOR' },
  { name: 'forged token: iat in the future', token: (c) => forge(c.users[T].token, { payload: { iat: nowSec() + 3600, exp: nowSec() + 7200, auth_time: nowSec() + 3600 } }), reason: 'TOKEN_FROM_FUTURE' },
  { name: 'forged token: non-integer iat', token: (c) => forge(c.users[T].token, { payload: (p) => ({ iat: p.iat + 0.5 }) }), reason: 'TOKEN_BAD_TIME' },
  { name: 'Auth user disabled in emulator', mutate: async (c) => h.disableAuthUser(c.users[T].uid), reason: 'TOKEN_REJECTED_BY_EMULATOR' },
  { name: 'binding missing', mutate: async (c) => h.deleteDoc(`authBindings/${c.users[T].uid}`), reason: 'BINDING_NOT_FOUND' },
  { name: 'binding disabled (token still valid)', mutate: bindPatch(T, { status: 'disabled', disabledAt: isoSec(Date.now()), reasonCode: 'TEST_DISABLE' }), reason: 'BINDING_NOT_ACTIVE' },
  { name: 'binding revoked (token still valid)', mutate: bindPatch(T, { status: 'revoked', revokedAt: isoSec(Date.now()), reasonCode: 'TEST_REVOKE' }), reason: 'BINDING_NOT_ACTIVE' },
  { name: 'rebind: token issued before activatedAt', mutate: async (c) => { await new Promise((r) => setTimeout(r, 1100)); await bindPatch(T, { activatedAt: isoSec(Date.now()), bindingVersion: 2 })(c); }, reason: 'TOKEN_BEFORE_BINDING', afterControl: 'fresh sign-in after rebind is allowed (N-26)' },
  { name: 'binding activatedAt lowercase z', mutate: bindPatch(T, { activatedAt: '2026-11-01T00:00:00z' }), reason: 'BINDING_INVALID_TIME' },
  { name: 'binding activatedAt 2026-02-29 (not a leap year)', mutate: bindPatch(T, { activatedAt: '2026-02-29T00:00:00Z' }), reason: 'BINDING_INVALID_TIME' },
  { name: 'binding activatedAt trailing newline', mutate: bindPatch(T, { activatedAt: '2026-11-01T00:00:00Z\n' }), reason: 'BINDING_INVALID_TIME' },
  { name: 'binding activatedAt with milliseconds', mutate: bindPatch(T, { activatedAt: '2026-11-01T00:00:00.000Z' }), reason: 'BINDING_INVALID_TIME' },
  { name: 'binding re-pointed to ACTOR-OTHER (membership of another principal not used)', mutate: bindPatch(T, { principalId: 'ACTOR-OTHER' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'principal disabled', mutate: async () => h.patchDoc('principals/ACTOR-TEACHER', { status: 'disabled' }), reason: 'PRINCIPAL_NOT_ACTIVE' },
  { name: 'claimed classId of another class (N-18)', baseline: { actor: T, req: SESSION }, req: { ...SESSION, claimedScope: { ...A, classId: 'CLASS-606-SC01' } }, reason: 'SCOPE_CLAIM_MISMATCH' },
  { name: 'claimed workspace of another workspace', baseline: { actor: T, req: SESSION }, req: { ...SESSION, claimedScope: S }, reason: 'SCOPE_CLAIM_MISMATCH' },
  { name: 'cross-workspace target with honest claim', baseline: { actor: 'ACTOR-SC01-TEACHER', req: SC01_ENTRY }, req: SC01_ENTRY, reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'document classId field differs from path (N-19)', baseline: { actor: T, req: A17_ENTRY }, req: A17_ENTRY, mutate: async () => h.patchDoc('workspaces/WS-A17/classes/CLASS-606-A17/attendanceSessions/AS-A17-20261117-DAILY/entries/AE-EN-A17-1151-0001', { classId: 'CLASS-606-SC01' }), reason: 'SCOPE_INTEGRITY_ERROR' },
  { name: 'membership expired (validToExclusive in the past)', mutate: memPatch({ validToExclusive: '2026-11-18' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership validToExclusive = today (half-open boundary)', mutate: memPatch({ validToExclusive: todayTaipei }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership not yet valid', mutate: memPatch({ validFrom: '2099-01-01' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership validFrom month 13', mutate: memPatch({ validFrom: '2026-13-01' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership validFrom 2026-02-29', mutate: memPatch({ validFrom: '2026-02-29' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership validFrom trailing space', mutate: memPatch({ validFrom: '2026-11-17 ' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership validToExclusive full-width digits', mutate: memPatch({ validToExclusive: '２０９９-01-01' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership missing rolePresetVersion (N-53)', mutate: async () => h.deleteField(MEM_A, 'rolePresetVersion'), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership unknown preset version s2b1-v0 (N-47)', mutate: memPatch({ rolePresetVersion: 's2b1-v0' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership suspended', mutate: memPatch({ status: 'suspended' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership revoked (N-28)', mutate: memPatch({ status: 'revoked' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership workspaceId field of another workspace (N-52)', mutate: memPatch({ workspaceId: 'WS-SC01' }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'membership classId null (N-55)', mutate: memPatch({ classId: null }), reason: 'NO_VALID_MEMBERSHIP' },
  { name: 'capability removed (attendance.read missing)', mutate: memPatch({ capabilities: ['attendance.write', 'leave.applicability.read'] }), reason: 'CAPABILITY_NOT_GRANTED' },
  { name: 'capability beyond preset ignored (projection_display + attendance.read)', mutate: memPatch({ rolePreset: 'projection_display' }), reason: 'CAPABILITY_NOT_GRANTED' },
  { name: 'capability not enabled before D-09 (student.read needs roster.read)', baseline: null, req: { op: 'student.read', target: { studentId: 'ST-A17-0001' }, claimedScope: A }, reason: 'CAPABILITY_NOT_ENABLED' },
  { name: 'capability not held (SC01 teacher reads leave applicability)', baseline: { actor: 'ACTOR-SC01-TEACHER', req: SC01_ENTRY }, actor: 'ACTOR-SC01-TEACHER', req: { op: 'leaveApplicability.read', target: { leaveRecordId: 'LV-007' }, claimedScope: S }, reason: 'CAPABILITY_NOT_GRANTED' },
  { name: 'unknown operation', baseline: null, req: { op: 'attendance.write', target: {}, claimedScope: A }, reason: 'UNKNOWN_OPERATION' },
  { name: 'malformed target id', baseline: null, req: { ...SESSION, target: { sessionId: '../../authBindings' } }, reason: 'TARGET_INVALID' },
];
const POS = [
  { name: 'membership validFrom = today (half-open boundary, allowed)', mutate: memPatch({ validFrom: todayTaipei }) },
  { name: 'membership with no end date (null) allowed', mutate: memPatch({ validToExclusive: null }) },
];

async function apiCall(frontOrigin, token, req) {
  const r = await fetch(`${frontOrigin}/v1/read`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(req), redirect: 'error', signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function auditFor(traceId) { const st = await h.exportState(); return Object.entries(st.docs).filter(([p, d]) => /(auditLog|auditLogUnscoped)\//.test(p) && d.traceId === traceId).map(([, d]) => d); }

const negResults = [];
for (const s of [...NEG.map((x) => ({ ...x, expectAllow: false })), ...POS.map((x) => ({ ...x, expectAllow: true }))]) {
  const users = await h.seedWorld();
  const ctx = { users };
  const stack = await h.startStack({});
  const actor = s.actor || T; const req = s.req || SESSION;
  const base = s.baseline === null ? null : (s.baseline || { actor, req });
  const rec = { name: s.name, expect: s.expectAllow ? 'allow' : `deny:${s.reason}` };
  try {
    if (base) { const b = await apiCall(stack.frontOrigin, users[base.actor].token, base.req); rec.baselineStatus = b.status; rec.baselineOk = b.status === 200 && b.body?.code === 'OK'; } else rec.baselineOk = 'not-applicable';
    if (s.mutate) await s.mutate(ctx);
    const tok = s.token ? s.token(ctx) : users[actor].token;
    const r = await apiCall(stack.frontOrigin, tok, req);
    const audits = await auditFor(r.body?.traceId);
    rec.status = r.status; rec.code = r.body?.code; rec.responseKeys = Object.keys(r.body || {}).sort(); rec.auditReason = audits[0]?.reasonCode ?? null; rec.auditDecision = audits[0]?.decision ?? null; rec.auditCount = audits.length;
    if (s.expectAllow) rec.ok = rec.status === 200 && rec.code === 'OK' && rec.auditDecision === 'allow' && rec.auditCount === 1;
    else rec.ok = rec.baselineOk !== false && rec.status === 403 && rec.code === 'FORBIDDEN' && stableJson(rec.responseKeys) === stableJson(['code', 'traceId']) && rec.auditReason === s.reason && rec.auditDecision === 'deny' && rec.auditCount === 1;
    if (s.afterControl) { const fresh = await h.signIn(users[actor]); const r2 = await apiCall(stack.frontOrigin, fresh, req); rec.afterControl = { name: s.afterControl, status: r2.status, code: r2.body?.code }; rec.ok = rec.ok && r2.status === 200 && r2.body?.code === 'OK'; }
  } catch (e) { rec.ok = false; rec.error = String(e.message || e); }
  await stack.stop();
  negResults.push(rec);
  console.log(`${rec.ok ? 'OK  ' : 'FAIL'} NEGATIVE/CONTROL ${s.name} → ${rec.status} ${rec.code} reason=${rec.auditReason} baseline=${rec.baselineOk}`);
}

// Backend disconnected (API pointed at a closed loopback port): UNAVAILABLE, no data, nothing hangs.
{
  const users = await h.seedWorld();
  const api = createApi({ port: PORTS.api, projectId: cfg.projectId, backendOrigin: `http://127.0.0.1:${PORTS.closedBackend}`, emulatorMode: true });
  await api.listen();
  const r = await apiCall(`http://127.0.0.1:${PORTS.api}`, users[T].token, SESSION);
  await api.close();
  const ok = r.status === 503 && r.body?.code === 'UNAVAILABLE' && stableJson(Object.keys(r.body).sort()) === stableJson(['code', 'traceId']);
  negResults.push({ name: 'backend unreachable (closed port) → UNAVAILABLE, no data', status: r.status, code: r.body?.code, responseKeys: Object.keys(r.body || {}).sort(), ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} NEGATIVE backend unreachable → ${r.status} ${r.body?.code}`);
}

// ---------------------------------------------------------------- 3. mutation / tamper controls
const mutants = [];
const AUTHZ_BYPASS = new Set(['NO_VALID_MEMBERSHIP', 'CAPABILITY_NOT_GRANTED', 'CAPABILITY_NOT_ENABLED', 'SCOPE_CLAIM_MISMATCH']);
const skipAuthz = async (args) => {
  const r = await authorize(args);
  if (r.decision === 'allow' || !AUTHZ_BYPASS.has(r.reasonCode)) return r;
  const def = OPERATIONS[args.op]; const hits = await args.store.findTargets(def.collection, def.idField, args.target?.[def.idField]);
  if (hits.length !== 1) return r;
  const m = /^workspaces\/([^/]+)\/classes\/([^/]+)\//.exec(hits[0].path); if (!m) return r;
  return { decision: 'allow', reasonCode: 'OK', principalId: r.principalId, scope: { workspaceId: m[1], classId: m[2] }, resource: hits[0].path, target: hits[0] };
};
const hardcoded = () => ({ mode: 'BACKEND_REAL', backend: 'firebase', execute: async (cs) => ({ canonical: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(cs.expectedResult).map(([k, v]) => [k, v])))), evidence: { authzDecision: 'allow', returnedIds: ['AE-1'], workspaceId: 'WS-A17' } }) });
const unflatten = (o) => { const out = {}; for (const [k, v] of Object.entries(o)) { const ps = k.split('.'); let c = out; ps.slice(0, -1).forEach((p) => { c = c[p] ??= {}; }); c[ps.at(-1)] = v; } return out; };
const MUT = [
  { label: 'MUT-skip-authz-POC-002', testId: 'POC-002', opts: { authorizeFn: skipAuthz }, expectNot: 'MATCH', why: 'API that skips membership/capability checks must be caught by the Observer' },
  { label: 'MUT-skip-authz-POC-009', testId: 'POC-009', opts: { authorizeFn: skipAuthz }, expectNot: 'PARTIAL_MATCH_REST_BLOCKED', why: 'applicability refusal must come from the real capability check' },
  { label: 'MUT-hardcoded-adapter-POC-001', testId: 'POC-001', opts: { adapterWrap: () => { const x = hardcoded(); return { ...x, execute: async (cs, f) => { const o = await x.execute(cs, f); return { ...o, canonical: unflatten(o.canonical) }; } }; } }, expectNot: 'MATCH', why: 'answers without API calls must not be accepted' },
  { label: 'MUT-hardcoded-adapter-POC-008', testId: 'POC-008', opts: { adapterWrap: () => ({ mode: 'BACKEND_REAL', backend: 'firebase', execute: async (cs) => ({ canonical: unflatten(cs.expectedResult), evidence: { queryCount: 1, assertions: 'hardcoded' } }) }) }, expectNot: 'MATCH', why: 'hard-coded counts must not be accepted' },
  { label: 'MUT-fixture-variant-POC-008', testId: 'POC-008', opts: { mutateDocs: (docs) => docs.map((d) => (d.path.endsWith('/entries/AE-EN-A17-1151-0001') ? { ...d, data: { ...d.data, status: 'U' } } : d)) }, expectNot: 'MATCH', why: 'Observer recounts real state; it does not copy the oracle' },
  { label: 'MUT-tampered-trace-POC-001', testId: 'POC-001', opts: { tamper: (file) => { const t = readFileSync(file, 'utf8'); writeFileSync(file, t.replace('"status":200', '"status":201')); } }, expectNot: 'MATCH', why: 'observation inputs changed after capture must be detected (digest)' },
  { label: 'MUT-tampered-adapter-claim-POC-001', testId: 'POC-001', opts: { adapterWrap: (ad) => ({ ...ad, execute: async (cs, f) => { const o = await ad.execute(cs, f); return { ...o, canonical: { ...o.canonical, returnedCount: 99 } }; } }) }, expectMatchButClaimMismatch: true, why: 'a lying adapter claim does not change the Observer verdict and is flagged' },
];
for (const m of MUT) {
  const r = await runCase(m.testId, { label: m.label, ...m.opts });
  const v = r.verdict;
  const ok = m.expectMatchButClaimMismatch ? (v.contractMatch === 'MATCH' && v.adapterClaimAgreesWithObserver === false && v.stage1Runner?.status === 'FAIL') : v.contractMatch !== m.expectNot;
  mutants.push({ label: m.label, why: m.why, contractMatch: v.contractMatch, adapterClaimAgreesWithObserver: v.adapterClaimAgreesWithObserver, stage1Runner: v.stage1Runner?.status, problems: v.problems, oracleFailures: v.oracleFailures, caught: ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} MUTATION ${m.label} → contractMatch=${v.contractMatch} stage1Runner=${v.stage1Runner?.status} problems=${v.problems.slice(0, 3).join('|')}`);
}

// ---------------------------------------------------------------- 4. masking check over every artifact
const secrets = [];   // tokens and passwords exist only in memory; check none of them reached disk
const leakReport = [];
const allFiles = Object.keys(digests);
{ // collect secrets from a fresh world (tokens/passwords used in the last seeds are already gone; generate one more)
  const users = await h.seedWorld();
  for (const u of Object.values(users)) secrets.push(u.token, u.password);
  const stack = await h.startStack({ frontFile: path.join(runDir, 'masking/trace-front.jsonl'), backFile: path.join(runDir, 'masking/trace-back.jsonl') });
  mkdirSync(path.join(runDir, 'masking'), { recursive: true });
  for (const [a, u] of Object.entries(users)) await apiCall(stack.frontOrigin, u.token, { ...SESSION, note: { password: u.password, displayName: names[0], email: u.email } });
  await stack.stop();
  allFiles.push('masking/trace-front.jsonl', 'masking/trace-back.jsonl');
}
for (const rel of allFiles) { const text = readFileSync(path.join(runDir, rel), 'utf8'); const leaks = findLeaks(text, { names, secrets }); if (leaks.length) leakReport.push({ file: rel, leaks }); }
console.log(`${leakReport.length === 0 ? 'OK  ' : 'FAIL'} MASKING no token / password / Authorization header / fictional name in ${allFiles.length} artifact files`);

// ---------------------------------------------------------------- 5. owned cleanup
assertStillOwned(await h.markerIds(), nonce);
const c1 = await fsc.clearAll(); const c2 = await au.clearAll();
const left = await fsc.listRootCollections(EMULATOR_OWNER); const leftAcc = await au.countAccounts();
const cleanupOk = c1.status === 200 && c2.status === 200 && (left.json?.collectionIds || []).length === 0 && Number(leftAcc.json?.recordsCount ?? 0) === 0;
console.log(`${cleanupOk ? 'OK  ' : 'FAIL'} CLEANUP owned emulator cleared (root collections ${(left.json?.collectionIds || []).length}, accounts ${leftAcc.json?.recordsCount ?? 0})`);

// ---------------------------------------------------------------- 6. summary
let gitCommit = null; try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* */ }
let gitDirty = null; try { gitDirty = execFileSync('git', ['status', '--porcelain', '--', '.', '../../docs'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0; } catch { /* */ }
const pkg = (p) => { try { return JSON.parse(readFileSync(path.join(ROOT, 'node_modules', p, 'package.json'), 'utf8')).version; } catch { return null; } };
const summary = {
  kind: 'S2B2_BATCH2_RUN', runId, attestation: 'UNATTESTED', notAPocPass: true, stage1ContractStatus: 'UNCHANGED_NOT_RUN',
  gitCommit, gitDirty, fixtureFileSha256: fileSha256, oracleFileSha256: sha256Hex(oracleBytes),
  versions: { node: process.version, firebaseTools: pkg('firebase-tools'), projectId: cfg.projectId },
  cases: caseResults.map((r) => ({ testId: r.testId, actor: r.actor, caseSpecDigest: r.caseSpecDigest, stage2Status: r.verdict.stage2Status, contractMatch: r.verdict.contractMatch, observedCanonical: r.verdict.observedCanonical, oracleFailures: r.verdict.oracleFailures, blockedFields: r.verdict.blockedFields, problems: r.verdict.problems, adapterClaimAgreesWithObserver: r.verdict.adapterClaimAgreesWithObserver, stage1Runner: r.verdict.stage1Runner, stateDigests: r.stateDigests, artifactDigests: r.artifactDigests })),
  negativeControls: negResults, mutationControls: mutants, masking: { filesChecked: allFiles.length, leaks: leakReport }, cleanupOk,
  artifactDigests: digests,
};
const casesOk = caseResults.every((r) => r.verdict.contractMatch === EXPECTED_MATCH[r.testId]);
const allOk = casesOk && negResults.every((r) => r.ok) && mutants.every((m) => m.caught) && leakReport.length === 0 && cleanupOk;
summary.harnessOk = allOk;
writeFileSync(path.join(runDir, 'run-summary.json'), JSON.stringify(summary, null, 1));
writeFileSync(path.join(ROOT, 'evidence', 'runs', 's2b2-b2-latest.json'), JSON.stringify({ runDir: path.relative(ROOT, runDir), ...summary }, null, 1));
console.log(`S2B2_B2_RUN ${runId} harnessOk=${allOk} cases=${caseResults.map((r) => `${r.testId}:${r.verdict.contractMatch}`).join(',')} negatives=${negResults.filter((r) => r.ok).length}/${negResults.length} mutations=${mutants.filter((m) => m.caught).length}/${mutants.length}`);
process.exit(allOk ? 0 : 1);
