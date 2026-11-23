/** C-2 third-party verification core (pure; synthetic gh output — NOT a cryptographic verification).
 *  Attack plan v0.4 §5.1; C-2 plan v0.2 §2–§5. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync as rf } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath as f2p } from 'node:url';
import { judgeAttestation, computeTargets, parseGhVersion, ghVersionOk, parseSignerUri, PROFILES, REPO, SIGTEST_SHA256 } from '../src/b3/third-party.mjs';
import { parseTrustPolicy, validAt, TRUST_POLICY_VERSION, SIGTEST_POLICY_VERSION } from '../src/b3/trust-policy.mjs';
import { readPackageSafe } from '../src/b3/package.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const root = (p) => f2p(new URL(`../../../${p}`, import.meta.url));
const gitBlob = (b) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
const SIGTEST = rf(root('poc/stage2/sigtest/SIGTEST.txt'));
const SC = '1'.repeat(40); const BS = '2'.repeat(40); const BO = '3'.repeat(40); const TC = '4'.repeat(40); const A = 'a'.repeat(64);
const NOW = Date.parse('2026-11-24T12:00:00Z'); const T0 = '2026-11-24T10:00:00Z';
const rec = (o = {}) => ({ approvalId: 'R-001', kind: 'signing-policy', sha: BS, approvedAt: '2026-11-23T00:00:00Z', approvedBy: 'owner', reviewRef: 'PR #X', status: 'active', validFrom: '2026-11-23T00:00:00Z', ...o });
const pol = (version, records) => JSON.stringify({ policyVersion: version, description: 'x', freshnessHours: 24, records });
const policyOf = (text, o = {}) => ({ text, sourceCommit: 'f'.repeat(40), fetchedAt: '2026-11-24T11:00:00Z', anchorDigest: A, anchorExpected: A, anchorSource: 'HANDOFF', ...o });
const item = ({ path = '.github/workflows/attest-sigtest.yml', ref = 'refs/heads/main', repo = REPO, digest = SC, subject = SIGTEST_SHA256, ts = [{ type: 'Tlog', uri: 'https://rekor.example', timestamp: T0 }], cert = {} } = {}) => ({
  attestation: { bundle: {} },
  verificationResult: { mediaType: 'application/vnd.dev.sigstore.verificationresult+json;version=0.1',
    signature: { certificate: { buildSignerURI: `https://github.com/${repo}/${path}@${ref}`, buildSignerDigest: digest, sourceRepositoryURI: `https://github.com/${REPO}`, sourceRepositoryRef: 'refs/heads/main', ...cert } },
    verifiedTimestamps: ts, statement: { _type: 'https://in-toto.io/Statement/v1', subject: [{ name: 'SIGTEST.txt', digest: { sha256: subject } }], predicateType: 'https://slsa.dev/provenance/v1',
      predicate: { buildDefinition: { externalParameters: { workflow: { path: '.github/workflows/attest-sigtest.yml', ref: 'refs/heads/main' } } } } } } });
const blobs = { [`${SC}:.github/workflows/attest-sigtest.yml`]: BS, [`${SC}:.github/workflows/attest.yml`]: BO };
const blobAt = (c, p) => blobs[`${c}:${p}`] ?? null;
const sig = (o = {}) => judgeAttestation({ profile: 'sigtest', verified: [item()], subjectBytes: SIGTEST, policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()])), blobAt, targetsAt: () => { throw new Error('not for sigtest'); }, nowMs: NOW, ...o });
const has = (r, code) => r.reasons.some((x) => x === code || x.startsWith(`${code}#`));

// ------------------------------------------------------------------ official profile fixture
const TG = { caseSpecDigest: '5'.repeat(64), oracleFileSha256: '6'.repeat(64), fixtureFileSha256: '7'.repeat(64), fixtureHash: '8'.repeat(64), anchorDigest: '9'.repeat(64) };
const statement = (o = {}) => ({ schemaVersion: 's2-attestation-v1', testId: 'POC-001', scenario: 'honest', toolchain: { trustedToolchainCommit: TC, signingPolicyBlob: BO }, targets: TG, package: { artifactId: '123456' }, verdict: { result: 'PASS', reasons: [] }, ...o });
const stBytes = (o) => Buffer.from(JSON.stringify(statement(o)));
const offRecs = (o = {}, t = {}) => [rec({ approvalId: 'S-001', sha: BO, ...o }), rec({ approvalId: 'T-001', kind: 'toolchain', sha: TC, ...t })];
const off = (o = {}) => { const bytes = o.subjectBytes || stBytes(o.st);
  let calls = 0; const r = judgeAttestation({ profile: 'official', verified: [item({ path: '.github/workflows/attest.yml', subject: sha(bytes) })], subjectBytes: bytes,
    policy: policyOf(pol(TRUST_POLICY_VERSION, offRecs())), blobAt, targetsAt: (c, t) => { calls++; return c === TC && t === 'POC-001' ? TG : null; }, nowMs: NOW, ...o.over });
  return { ...r, targetsCalls: calls }; };

test('C-2 sigtest: the approved test signature is SIGTEST_IDENTITY_ACCEPTED — never PASS; evidence keeps times and sources', () => {
  const r = sig();
  assert.equal(r.result, 'SIGTEST_IDENTITY_ACCEPTED'); assert.equal(r.accepted, true); assert.deepEqual(r.reasons, []);
  assert.doesNotMatch(JSON.stringify(r), /\bPASS\b/);
  assert.deepEqual(r.evidence.items[0].timestamps, [{ type: 'Tlog', timestamp: T0 }]);
  assert.deepEqual(r.evidence.items[0].signingPolicyApprovals, ['R-001']);
  assert.equal(r.evidence.policy.anchorSource, 'HANDOFF'); assert.equal(r.evidence.policy.fetchedAt, '2026-11-24T11:00:00Z');
  assert.equal(r.evidence.subjectSha256, SIGTEST_SHA256);
});

test('C-2 identity: exact workflow path, repo and case-sensitive ref — shared prefixes and the other profile are rejected', () => {
  for (const path of ['.github/workflows/attest-sigtest.yml.bak', '.github/workflows/attest-sigtest.yml-evil', '.github/workflows/attest.yml', '.github/workflows/Attest-sigtest.yml'])
    assert.ok(has(sig({ verified: [item({ path })] }), 'SIGNER_WORKFLOW_MISMATCH'), path);
  assert.ok(has(sig({ verified: [item({ repo: 'evil/class-management-next' })] }), 'SIGNER_REPO_MISMATCH'));
  for (const ref of ['refs/heads/Main', 'refs/heads/main-evil', 'refs/tags/main']) assert.ok(has(sig({ verified: [item({ ref })] }), 'SIGNER_REF_MISMATCH'), ref);
  assert.ok(has(sig({ verified: [item({ cert: { sourceRepositoryRef: 'refs/heads/MAIN' } })] }), 'SOURCE_REF_MISMATCH'));
  assert.ok(has(sig({ verified: [item({ cert: { sourceRepositoryURI: 'https://github.com/evil/x' } })] }), 'SOURCE_REPO_MISMATCH'));
  assert.ok(has(sig({ verified: [item({ cert: { buildSignerURI: 'not a uri' } })] }), 'SIGNER_URI_INVALID'));
  assert.ok(has(sig({ verified: [item({ digest: 'xyz' })] }), 'SIGNER_DIGEST_INVALID'));
  assert.ok(has(sig({ verified: [{ verificationResult: {} }] }), 'CERTIFICATE_MISSING'));
  assert.equal(parseSignerUri(`https://github.com/${REPO}/.github/workflows/attest.yml@refs/heads/main`).path, '.github/workflows/attest.yml');
  // the predicate is never used for identity: a predicate naming the right workflow does not rescue a wrong certificate
  assert.equal(sig({ verified: [item({ path: '.github/workflows/evil.yml' })] }).result, 'REJECTED');
  // profiles cannot be mixed: the test signature under the official profile, and an unknown profile
  const mixed = judgeAttestation({ profile: 'official', verified: [item()], subjectBytes: SIGTEST, policy: policyOf(pol(TRUST_POLICY_VERSION, offRecs())), blobAt, targetsAt: () => TG, nowMs: NOW });
  assert.equal(mixed.result, 'REJECTED'); assert.ok(has(mixed, 'SIGNER_WORKFLOW_MISMATCH')); assert.ok(has(mixed, 'STATEMENT_INVALID'));
  assert.throws(() => sig({ profile: 'debug' }), /unknown profile/);
  assert.ok(Object.isFrozen(PROFILES) && Object.isFrozen(PROFILES.sigtest));
});

test('C-2 multiple attestations: every one must pass; none, or a failed gh run, is REJECTED', () => {
  assert.equal(sig({ verified: [item(), item()] }).result, 'SIGTEST_IDENTITY_ACCEPTED');
  const two = sig({ verified: [item(), item({ path: '.github/workflows/attest-sigtest.yml.bak' })] });
  assert.equal(two.result, 'REJECTED'); assert.ok(two.reasons.includes('SIGNER_WORKFLOW_MISMATCH#1'));
  assert.ok(has(sig({ verified: [] }), 'NO_ATTESTATIONS'));
  assert.ok(has(sig({ verified: null }), 'GH_VERIFY_FAILED'));
});

test('C-2 trusted time (v0.2, Q4): non-empty, every timestamp parseable, every one inside the interval', () => {
  assert.ok(has(sig({ verified: [item({ ts: [] })] }), 'NO_TRUSTED_TIME'));
  assert.ok(has(sig({ verified: [item({ ts: null })] }), 'NO_TRUSTED_TIME'));
  for (const ts of [[{ type: 'Tlog' }], [{ type: 'Tlog', timestamp: 'yesterday' }], [{ type: 'Tlog', timestamp: '2026-11-24T10:00:00' }], [{ type: 'Tlog', timestamp: 1764000000 }], ['x']])
    assert.ok(has(sig({ verified: [item({ ts })] }), 'TRUSTED_TIME_INVALID'), JSON.stringify(ts));
  // an empty array must never pass through every(): no time → no record check can succeed either
  assert.ok(has(sig({ verified: [item({ ts: [] })] }), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));
  // mixed: a TSA time inside, a Tlog time outside the interval → REJECTED
  const mixed = sig({ verified: [item({ ts: [{ type: 'TimestampAuthority', timestamp: T0 }, { type: 'Tlog', timestamp: '2026-11-22T00:00:00Z' }] })] });
  assert.ok(has(mixed, 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));
  assert.deepEqual(mixed.evidence.items[0].timestamps.map((t) => t.type), ['TimestampAuthority', 'Tlog']);
  // explicit zones are honoured: 2026-11-23T07:59:59+08:00 is 1 s BEFORE validFrom (2026-11-23T00:00:00Z); fractions parse
  assert.ok(has(sig({ verified: [item({ ts: [{ type: 'TimestampAuthority', timestamp: T0 }, { type: 'Tlog', timestamp: '2026-11-23T07:59:59+08:00' }] })] }), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));
  assert.equal(sig({ verified: [item({ ts: [{ type: 'TimestampAuthority', timestamp: T0 }, { type: 'Tlog', timestamp: '2026-11-24T10:00:01.5+08:00' }] })] }).result, 'SIGTEST_IDENTITY_ACCEPTED');
});

test('C-2 validity at signing time: interval boundaries, normal retirement, invalidateIssued, malformed records', () => {
  const at = (t, r) => sig({ verified: [item({ ts: [{ type: 'Tlog', timestamp: t }] })], policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec(r)])) });
  const R = { status: 'revoked', validFrom: '2026-11-23T00:00:00Z', validTo: '2026-11-25T00:00:00Z' };
  assert.ok(has(at('2026-11-22T23:59:59Z', {}), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));     // t < validFrom
  assert.equal(at('2026-11-23T00:00:00Z', {}).result, 'SIGTEST_IDENTITY_ACCEPTED');                  // t = validFrom
  assert.equal(at('2026-11-24T23:59:59Z', R).result, 'SIGTEST_IDENTITY_ACCEPTED');                   // normal retirement, t before validTo
  assert.ok(has(at('2026-11-25T00:00:00Z', R), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));      // t = validTo
  assert.ok(has(at('2026-11-25T00:00:01Z', R), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));      // after revocation
  assert.ok(has(at(T0, { invalidateIssued: true }), 'SIGNING_POLICY_INVALIDATED'));                 // inside the interval, invalidated
  assert.ok(has(at(T0, { ...R, invalidateIssued: true }), 'SIGNING_POLICY_INVALIDATED'));
  // a second, valid record for the same blob does not rescue an invalidated one
  const both = sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec(), rec({ approvalId: 'R-002', invalidateIssued: true })])) });
  assert.ok(has(both, 'SIGNING_POLICY_INVALIDATED'));
  // validAt itself: malformed → never
  assert.equal(validAt(rec(), Date.parse(T0)), true);
  assert.equal(validAt(rec({ status: 'revoked' }), Date.parse(T0)), false);                       // revoked without validTo
  assert.equal(validAt(rec({ validTo: '2026-11-23T00:00:00Z' }), Date.parse(T0)), false);         // empty interval
  assert.equal(validAt(rec({ status: 'suspended' }), Date.parse(T0)), false);
  assert.equal(validAt(rec({ invalidateIssued: true }), Date.parse(T0)), false);                  // invalidated: never, even inside the interval
  assert.equal(validAt(rec({ status: 'revoked', validTo: '2026-11-25T00:00:00Z', invalidateIssued: false }), Date.parse(T0)), true);
  assert.equal(validAt(rec({ validFrom: 'soon' }), Date.parse(T0)), false);
  assert.equal(validAt(rec(), NaN), false); assert.equal(validAt(null, Date.parse(T0)), false);
  // the parser now rejects an empty interval (validTo ≤ validFrom)
  assert.throws(() => parseTrustPolicy(pol(TRUST_POLICY_VERSION, [rec({ status: 'revoked', validTo: '2026-11-23T00:00:00Z' })])), /TRUST_POLICY_INVALID: interval/);
  assert.throws(() => parseTrustPolicy(pol(TRUST_POLICY_VERSION, [rec({ status: 'revoked', validTo: '2026-11-22T00:00:00Z' })])), /TRUST_POLICY_INVALID: interval/);
});

test('C-2 policy: fixed source, anchored, fresh; local copies only through the test interface', () => {
  const stale = sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { fetchedAt: '2026-11-23T11:59:59Z' }) });
  assert.equal(stale.result, 'REVOCATION_STATUS_UNKNOWN'); assert.equal(stale.accepted, false); assert.equal(stale.stalePolicy, true);
  assert.equal(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { fetchedAt: '2026-11-23T12:00:00Z' }) }).result, 'SIGTEST_IDENTITY_ACCEPTED');   // exactly 24 h
  // stale AND a rejection → REJECTED (never softened to "unknown")
  assert.equal(sig({ verified: [item({ path: '.github/workflows/x.yml' })], policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { fetchedAt: '2026-11-20T00:00:00Z' }) }).result, 'REJECTED');
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { fetchedAt: '2026-11-25T00:00:00Z' }) }), 'POLICY_FETCH_TIME_IN_FUTURE'));
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { fetchedAt: null }) }), 'POLICY_FETCH_TIME_INVALID'));
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { anchorExpected: '' }) }), 'ANCHOR_NOT_PROVIDED'));
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { anchorExpected: 'b'.repeat(64) }) }), 'ANCHOR_MISMATCH'));
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { anchorDigest: null }) }), 'ANCHOR_MISMATCH'));
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec()]), { sourceCommit: 'main' }) }), 'POLICY_SOURCE_UNKNOWN'));
  // reverse tests with LOCAL policy copies (injected here, the test interface): record removed, other blob, wrong version / kind
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [])) }), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec({ sha: '0'.repeat(40) })])) }), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));
  assert.ok(has(sig({ policy: policyOf(pol(TRUST_POLICY_VERSION, [rec()])) }), 'POLICY_INVALID'));                       // the official policy cannot stand in
  assert.ok(has(sig({ policy: policyOf(pol(SIGTEST_POLICY_VERSION, [rec({ kind: 'toolchain' })])) }), 'POLICY_INVALID'));   // sigtest has no toolchain records
  assert.ok(has(sig({ policy: policyOf('{') }), 'POLICY_INVALID'));
  assert.ok(has(sig({ nowMs: NaN }), 'CLOCK_INVALID'));
});

test('C-2 subject binding: the fixed SIGTEST.txt bytes, and the verified subject digest', () => {
  const other = Buffer.from('another file');
  const r = sig({ subjectBytes: other, verified: [item({ subject: sha(other) })] });
  assert.ok(has(r, 'SIGTEST_SUBJECT_NOT_APPROVED')); assert.equal(r.result, 'REJECTED');
  assert.ok(has(sig({ verified: [item({ subject: 'c'.repeat(64) })] }), 'SUBJECT_DIGEST_MISMATCH'));
  assert.ok(has(sig({ subjectBytes: null }), 'SUBJECT_MISSING'));
  // blob of the signer workflow at the signer commit: unknown / unapproved
  assert.ok(has(sig({ blobAt: () => null }), 'SIGNING_POLICY_BLOB_UNAVAILABLE'));
  assert.ok(has(sig({ blobAt: () => 'e'.repeat(40) }), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));
});

test('C-2 official profile: PASS, honest, provenance, toolchain record at signing time, recomputed targets', () => {
  const ok = off(); assert.equal(ok.result, 'ACCEPTED', ok.reasons.join()); assert.equal(ok.targetsCalls, 1);
  assert.ok(has(off({ st: { scenario: 'attack-a14' } }), 'SCENARIO_NOT_HONEST'));
  assert.ok(has(off({ st: { verdict: { result: 'UNATTESTED' } } }), 'STATEMENT_NOT_PASS'));
  assert.ok(has(off({ st: { toolchain: { trustedToolchainCommit: TC, signingPolicyBlob: null } } }), 'STATEMENT_SIGNING_POLICY_NULL'));
  assert.ok(has(off({ st: { toolchain: { trustedToolchainCommit: TC, signingPolicyBlob: BS } } }), 'STATEMENT_SIGNING_POLICY_MISMATCH'));
  assert.ok(has(off({ st: { package: { artifactId: null } } }), 'STATEMENT_ARTIFACT_ID_NULL'));
  assert.ok(has(off({ st: { schemaVersion: 'v0' } }), 'STATEMENT_SCHEMA_MISMATCH'));
  assert.ok(has(off({ st: { targets: { ...TG, anchorDigest: '0'.repeat(64) } } }), 'TARGETS_MISMATCH'));
  assert.ok(has(off({ st: { testId: 'POC-002' } }), 'TARGETS_UNAVAILABLE'));
  // the toolchain record is checked at signing time BEFORE targets are recomputed (targets code of an unapproved commit never runs)
  const unapproved = off({ over: { policy: policyOf(pol(TRUST_POLICY_VERSION, [offRecs()[0]])) } });
  assert.ok(has(unapproved, 'TOOLCHAIN_NOT_VALID_AT_SIGNING_TIME')); assert.equal(unapproved.targetsCalls, 0);
  const inval = off({ over: { policy: policyOf(pol(TRUST_POLICY_VERSION, offRecs({}, { invalidateIssued: true }))) } });
  assert.ok(has(inval, 'TOOLCHAIN_INVALIDATED')); assert.equal(inval.targetsCalls, 0);
  // toolchain interval boundaries (same rule as the signing policy)
  const tAt = (t, r) => off({ over: { verified: [item({ path: '.github/workflows/attest.yml', subject: sha(stBytes()), ts: [{ type: 'Tlog', timestamp: t }] })], policy: policyOf(pol(TRUST_POLICY_VERSION, offRecs({}, r))) } });
  const R = { status: 'revoked', validTo: '2026-11-25T00:00:00Z' };
  assert.ok(has(tAt('2026-11-22T23:59:59Z', {}), 'TOOLCHAIN_NOT_VALID_AT_SIGNING_TIME'));
  assert.equal(tAt('2026-11-23T00:00:00Z', {}).result, 'ACCEPTED');
  assert.equal(tAt('2026-11-24T23:59:59Z', R).result, 'ACCEPTED');
  assert.ok(has(tAt('2026-11-25T00:00:00Z', R), 'TOOLCHAIN_NOT_VALID_AT_SIGNING_TIME'));
  // strict JSON: duplicate keys / not JSON
  const dup = Buffer.from('{"schemaVersion":"s2-attestation-v1","scenario":"honest","scenario":"attack-x"}');
  assert.ok(has(off({ subjectBytes: dup }), 'STATEMENT_INVALID'));
  // the signing policy must be the blob of attest.yml at the signer commit (the sigtest blob is not it)
  assert.ok(has(off({ over: { blobAt: () => BS } }), 'SIGNING_POLICY_NOT_VALID_AT_SIGNING_TIME'));
});

test('C-2 gh version gate (>= 2.102.0) and targets recomputation', () => {
  assert.deepEqual(parseGhVersion('gh version 2.102.0 (2026-10-01)\nhttps://github.com/cli/cli/releases/tag/v2.102.0'), [2, 102, 0]);
  assert.equal(parseGhVersion('hub version 2.14'), null);
  for (const [v, ok] of [[[2, 89, 0], false], [[2, 101, 9], false], [[2, 102, 0], true], [[2, 102, 1], true], [[3, 0, 0], true], [[1, 999, 0], false], [null, false]]) assert.equal(ghVersionOk(v), ok, String(v));
  // same formulas as the Runner: replay the committed honest fixture's run.json targets
  const run = JSON.parse(readPackageSafe(rf(root('poc/stage2/test/fixtures/b3a-honest-poc001/package.tar'))).files.get('run.json').toString('utf8'));
  const t = computeTargets({ oracleBytes: rf(root('poc/stage1/contracts/canonical-oracles-v1.0.json')), fixtureBytes: rf(root('poc/stage1/fixtures/canonical-fixtures-v1.0.json')), testId: 'POC-001', anchorDigest: run.targets.anchorDigest });
  assert.deepEqual(t, run.targets);
  assert.equal(computeTargets({ oracleBytes: Buffer.from('{}'), fixtureBytes: Buffer.from('{}'), testId: 'POC-001', anchorDigest: A }), null);
  assert.equal(computeTargets({ oracleBytes: rf(root('poc/stage1/contracts/canonical-oracles-v1.0.json')), fixtureBytes: Buffer.from('{'), testId: 'POC-001', anchorDigest: A }), null);
  assert.equal(computeTargets({ oracleBytes: rf(root('poc/stage1/contracts/canonical-oracles-v1.0.json')), fixtureBytes: rf(root('poc/stage1/fixtures/canonical-fixtures-v1.0.json')), testId: 'POC-001', anchorDigest: null }), null);
});

test('C-2 committed files: SIGTEST.txt digest, the sigtest policy approves exactly the committed workflow blob, official policy untouched', () => {
  assert.equal(sha(SIGTEST), SIGTEST_SHA256);
  const p = parseTrustPolicy(rf(root('docs/stage2/S2B2-SIGTEST-POLICY.json'), 'utf8'), { version: SIGTEST_POLICY_VERSION, kinds: ['signing-policy'] });
  assert.deepEqual(p.records.map((r) => [r.kind, r.sha, r.status]), [['signing-policy', gitBlob(rf(root('.github/workflows/attest-sigtest.yml'))), 'active']]);
  assert.equal(p.freshnessHours, 24);
  assert.deepEqual(parseTrustPolicy(rf(root('docs/stage2/S2B2-TRUST-POLICY.json'), 'utf8')).records, []);
});

test('C-2 CLI: only the fixed options; no option can replace the policy, the workflow path or the profile', () => {
  const cli = (args) => spawnSync(process.execPath, [root('poc/stage2/scripts/verify-attestation.mjs'), ...args], { encoding: 'utf8' });
  for (const extra of [['--policy', 'x'], ['--workflow', 'x'], ['--signer-workflow', 'x'], ['--source-ref', 'x'], ['--policy-file', 'x']]) {
    const r = cli(['--profile', 'sigtest', ...extra]); assert.equal(r.status, 2, extra[0]); assert.match(r.stderr, /unexpected or repeated argument/);
  }
  assert.equal(cli(['--profile', 'debug', '--subject', 'a', '--repo-dir', '.', '--anchor', 'a', '--anchor-source', 'a', '--out', 'x']).status, 2);
  assert.match(cli(['--profile', 'sigtest', '--profile', 'official']).stderr, /repeated/);
  assert.match(cli(['--profile', 'sigtest']).stderr, /--subject is required/);
});

// PR16-REV001: "finally rejected" and "nothing ran before the rejection" are separate acceptance conditions
test('PR16-REV001: targetsAt is never reached when any side-effect-free check fails', () => {
  const offP = (o = {}) => policyOf(pol(TRUST_POLICY_VERSION, offRecs()), o);
  const bad = {
    'anchor mismatch': { policy: offP({ anchorExpected: 'b'.repeat(64) }) },
    'anchor missing': { policy: offP({ anchorExpected: '' }) },
    'policy source invalid': { policy: offP({ sourceCommit: 'main' }) },
    'policy stale': { policy: offP({ fetchedAt: '2026-11-20T00:00:00Z' }) },
    'fetch time invalid': { policy: offP({ fetchedAt: 'today' }) },
    'fetch time in the future': { policy: offP({ fetchedAt: '2026-11-25T00:00:00Z' }) },
    'policy unparsable': { policy: offP({ text: '{' }) },
    'identity: other workflow': { verified: [item({ path: '.github/workflows/evil.yml', subject: sha(stBytes()) })] },
    'identity: other ref': { verified: [item({ path: '.github/workflows/attest.yml', ref: 'refs/heads/evil', subject: sha(stBytes()) })] },
    'subject mismatch': { verified: [item({ path: '.github/workflows/attest.yml', subject: 'c'.repeat(64) })] },
    'no trusted time': { verified: [item({ path: '.github/workflows/attest.yml', subject: sha(stBytes()), ts: [] })] },
    'signing policy not approved': { blobAt: () => 'e'.repeat(40) },
    'gh failed': { verified: null },
    'second attestation invalid': { verified: [item({ path: '.github/workflows/attest.yml', subject: sha(stBytes()) }), item({ path: '.github/workflows/attest.yml.bak', subject: sha(stBytes()) })] },
  };
  for (const [n, over] of Object.entries(bad)) {
    const r = off({ over });
    assert.notEqual(r.result, 'ACCEPTED', n); assert.equal(r.targetsCalls, 0, `${n}: targetsAt was called`);
    for (const it of r.evidence.items) if ('targetsChecked' in it) assert.equal(it.targetsChecked, false, n);
  }
  // statement-level rejections also stop before targets
  for (const st of [{ scenario: 'attack-a14' }, { verdict: { result: 'UNATTESTED' } }, { package: { artifactId: null } }, { toolchain: { trustedToolchainCommit: TC, signingPolicyBlob: BS } }])
    assert.equal(off({ st }).targetsCalls, 0, JSON.stringify(st));
});

// PR16-REV002: several valid attestations sharing a toolchain — computed once, all accepted
test('PR16-REV002: attestations sharing a toolchain commit are judged once per (commit, testId)', () => {
  const v = item({ path: '.github/workflows/attest.yml', subject: sha(stBytes()) });
  const two = off({ over: { verified: [v, v] } });
  assert.equal(two.result, 'ACCEPTED', two.reasons.join()); assert.equal(two.targetsCalls, 1);
  assert.deepEqual(two.evidence.items.map((e) => e.targetsChecked), [true, true]);
  const three = off({ over: { verified: [v, item({ path: '.github/workflows/attest.yml', subject: sha(stBytes()), ts: [{ type: 'TimestampAuthority', timestamp: T0 }] }), v] } });
  assert.equal(three.result, 'ACCEPTED'); assert.equal(three.targetsCalls, 1);
  // a targets failure (computed once) rejects every attestation that depends on it
  let calls = 0;
  const fail = judgeAttestation({ profile: 'official', verified: [v, v], subjectBytes: stBytes(), policy: policyOf(pol(TRUST_POLICY_VERSION, offRecs())), blobAt, targetsAt: () => { calls++; return null; }, nowMs: NOW });
  assert.deepEqual(fail.reasons, ['TARGETS_UNAVAILABLE#0', 'TARGETS_UNAVAILABLE#1']); assert.equal(calls, 1);
});

