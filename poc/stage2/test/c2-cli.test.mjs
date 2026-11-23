/** C-2 CLI integration (PR16-REV001 / PR16-REV002): verify-attestation.mjs against a LOCAL bare repository and a STUB
 *  gh (canned JSON — NO cryptographic verification). The candidate toolchain commit plants a sentinel in every script
 *  the old CLI would have run (scripts/verify-anchor.mjs) and in package.json scripts; the sentinel must never appear,
 *  whether the input is accepted or rejected. Needs git; uses only a temporary directory.
 *  POSIX only: the stub gh is a shebang script (on Windows, spawn finds only gh.exe). PR17-REV003: on Windows NOTHING
 *  below the imports runs — no temporary directory, clone, commit or sentinel control — and the file reports one
 *  skipped test. Windows snapshot compatibility is covered by c2-snapshot.test.mjs, gh-result classification by c2-unit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTargets } from '../src/b3/third-party.mjs';
import { anchorListing } from '../../../scripts/verify-anchor.mjs';
import { materializeCommit } from '../src/b3/git-snapshot.mjs';

if (process.platform === 'win32') {
  test('c2-cli integration (POSIX only)', { skip: 'stub gh is a POSIX shebang script; Windows: see c2-snapshot.test.mjs and c2-unit (classifyGhRun)' }, () => {});
} else {
const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CLI = path.join(ROOT, 'poc/stage2/scripts/verify-attestation.mjs');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(path.join(os.tmpdir(), 's2-c2-cli-'));
const SENTINEL = path.join(tmp, 'SENTINEL-candidate-code-ran');
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=c2-test', '-c', 'user.email=c2-test@localhost', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
// the same tar-free snapshot as the CLI (src/b3/git-snapshot.mjs)
const extractTree = (repo, rev, dir) => { materializeCommit(repo, rev, dir); return dir; };

// --- fixture: origin (bare) with main = B, where A = candidate toolchain with sentinels, B = A + official policy records
const origin = path.join(tmp, 'origin.git'); const work = path.join(tmp, 'work');
execFileSync('git', ['clone', '-q', '--bare', '--no-local', ROOT, origin]);
execFileSync('git', ['clone', '-q', origin, work]);
const plant = `import { writeFileSync as __w } from 'node:fs'; __w(${JSON.stringify(SENTINEL)}, 'ran');\n`;
{ // after the shebang line, so the planted script really runs when started (checked below)
  const f = path.join(work, 'scripts/verify-anchor.mjs'); const [first, ...rest] = readFileSync(f, 'utf8').split('\n');
  writeFileSync(f, [first, plant + rest.join('\n')].join('\n')); }
const pj = JSON.parse(readFileSync(path.join(work, 'package.json'), 'utf8')); pj.scripts = { ...pj.scripts, preinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(SENTINEL)},'ran')"` };
writeFileSync(path.join(work, 'package.json'), JSON.stringify(pj, null, 2) + '\n');
g(work, 'commit', '-qam', 'TEST ONLY: candidate toolchain with sentinels'); const A = g(work, 'rev-parse', 'HEAD');
const policyFile = path.join(work, 'docs/stage2/S2B2-TRUST-POLICY.json'); const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
const BO = g(work, 'rev-parse', 'HEAD:.github/workflows/attest.yml');
const r = (id, kind, s) => ({ approvalId: id, kind, sha: s, approvedAt: '2026-11-01T00:00:00Z', approvedBy: 'test', reviewRef: 'test', status: 'active', validFrom: '2026-11-01T00:00:00Z' });
policy.records = [r('TEST-T', 'toolchain', A), r('TEST-S', 'signing-policy', BO)];
writeFileSync(policyFile, JSON.stringify(policy, null, 1) + '\n');
g(work, 'commit', '-qam', 'TEST ONLY: official policy records'); const B = g(work, 'rev-parse', 'HEAD');
g(work, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
const ANCHOR_MAIN = anchorListing(extractTree(origin, B, path.join(tmp, 'x-main'))).digest;
const treeA = extractTree(origin, A, path.join(tmp, 'x-a'));
const targets = computeTargets({ oracleBytes: readFileSync(path.join(treeA, 'poc/stage1/contracts/canonical-oracles-v1.0.json')), fixtureBytes: readFileSync(path.join(treeA, 'poc/stage1/fixtures/canonical-fixtures-v1.0.json')), testId: 'POC-001', anchorDigest: anchorListing(treeA).digest });
assert.ok(!existsSync(SENTINEL), 'the fixture itself must not run candidate code');
// control: the planted sentinel DOES fire when the candidate script is started (so its absence below means something)
{ const ctl = path.join(tmp, 'control'); const p = spawnSync(process.execPath, [path.join(treeA, 'scripts/verify-anchor.mjs'), '--print'], { cwd: treeA, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr); assert.ok(existsSync(SENTINEL), 'control: the planted sentinel did not fire'); rmSync(SENTINEL); void ctl; }
const statement = path.join(tmp, 'statement.json');
writeFileSync(statement, JSON.stringify({ schemaVersion: 's2-attestation-v1', testId: 'POC-001', scenario: 'honest', toolchain: { trustedToolchainCommit: A, signingPolicyBlob: BO }, targets, package: { artifactId: '123456' }, verdict: { result: 'PASS', reasons: [] } }));

// --- stub gh: STUB_MODE = one | dup | dup-bad | init-fail | not-json | not-array; STUB_WF = the signer workflow it reports.
// PR17-REV001: the CLI no longer passes --signer-workflow / --source-ref; the stub records the arguments it received.
const bin = path.join(tmp, 'bin'); mkdirSync(bin);
writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('gh version 2.102.0 (stub)'); process.exit(0); }
const fs = require('fs'), c = require('crypto'); const s = c.createHash('sha256').update(fs.readFileSync(a[2])).digest('hex');
fs.writeFileSync(process.env.STUB_ARGS, JSON.stringify(a));
const m = process.env.STUB_MODE;
if (m === 'init-fail') { console.error('error creating Sigstore verifier: no valid Sigstore verifiers could be initialized'); process.exit(1); }
if (m === 'not-json') { console.log('oops'); process.exit(0); }
if (m === 'not-array') { console.log('{}'); process.exit(0); }
const wf = process.env.STUB_WF || '.github/workflows/attest.yml';
const it = (p) => ({ verificationResult: { signature: { certificate: { buildSignerURI: 'https://github.com/hsuanyu9503/class-management-next/' + p + '@refs/heads/main', buildSignerDigest: ${JSON.stringify(B)},
  sourceRepositoryURI: 'https://github.com/hsuanyu9503/class-management-next', sourceRepositoryRef: 'refs/heads/main' } },
  verifiedTimestamps: [{ type: 'Tlog', timestamp: new Date(Date.now() - 3600e3).toISOString() }], statement: { subject: [{ name: 's', digest: { sha256: s } }] } } });
console.log(JSON.stringify(m === 'dup' ? [it(wf), it(wf)] : m === 'dup-bad' ? [it(wf), it(wf + '.bak')] : [it(wf)]));
`); chmodSync(path.join(bin, 'gh'), 0o755);
const repo = path.join(tmp, 'clone'); execFileSync('git', ['clone', '-q', origin, repo]);
let n = 0;
const run = (mode, anchor = ANCHOR_MAIN, { profile = 'official', subject = statement, wf } = {}) => {
  const out = path.join(tmp, `out-${n++}`); const argsFile = path.join(tmp, `stub-args-${n}`);
  const p = spawnSync(process.execPath, [CLI, '--profile', profile, '--subject', subject, '--repo-dir', repo, '--anchor', anchor, '--anchor-source', 'c2-cli test', '--out', out],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_MODE: mode, STUB_ARGS: argsFile, ...(wf ? { STUB_WF: wf } : {}) } });
  const rd = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
  return { status: p.status, stderr: p.stderr, result: rd(path.join(out, 'result.json')) ? JSON.parse(rd(path.join(out, 'result.json'))) : null, ghArgs: rd(argsFile) ? JSON.parse(rd(argsFile)) : null, ghStderr: rd(path.join(out, 'gh-stderr.txt')) };
};

test('PR16-REV001 (CLI): a rejected input never starts candidate code — and neither does an accepted one', () => {
  const rejected = run('one', 'b'.repeat(64));                  // wrong external anchor
  assert.equal(rejected.status, 1, rejected.stderr); assert.equal(rejected.result.result, 'REJECTED'); assert.ok(rejected.result.reasons.includes('ANCHOR_MISMATCH'));
  assert.deepEqual(rejected.result.toolchainTrees, [], 'the candidate commit must not even be extracted');
  assert.ok(!existsSync(SENTINEL), 'candidate code ran for a rejected input');
  const badIdentity = run('dup-bad');                          // second attestation with a prefixed workflow path
  assert.equal(badIdentity.result.result, 'REJECTED'); assert.ok(badIdentity.result.reasons.includes('SIGNER_WORKFLOW_MISMATCH#1'));
  assert.deepEqual(badIdentity.result.toolchainTrees, []); assert.ok(!existsSync(SENTINEL));
  const ok = run('one');
  assert.equal(ok.status, 0, JSON.stringify(ok.result?.reasons)); assert.equal(ok.result.result, 'ACCEPTED');
  assert.deepEqual(ok.result.toolchainTrees.map((t) => [t.commit, t.ok]), [[A, true]]);
  assert.equal(ok.result.toolchainTrees[0].anchorDigest, targets.anchorDigest);   // the candidate's anchor, computed by the verifier's own code
  assert.ok(!existsSync(SENTINEL), 'candidate code ran for an accepted input');
});

test('PR16-REV002 (CLI): two valid attestations sharing the toolchain commit are both accepted; one extraction', () => {
  const dup = run('dup');
  assert.equal(dup.status, 0, JSON.stringify(dup.result?.reasons)); assert.equal(dup.result.result, 'ACCEPTED');
  assert.equal(dup.result.toolchainTrees.length, 1); assert.equal(dup.result.toolchainTrees[0].commit, A);
  assert.deepEqual(dup.result.evidence.items.map((e) => e.targetsChecked), [true, true]);
  assert.ok(!existsSync(SENTINEL));
});

test('PR16-REV001: the anchor path list is validated data; symbolic links and unsafe paths fail the listing', () => {
  const fresh = (name) => extractTree(origin, B, path.join(tmp, name));
  assert.equal(anchorListing(fresh('v-ok')).digest, ANCHOR_MAIN);
  const ln = fresh('v-link'); unlinkSync(path.join(ln, 'poc/stage2/src/b3/verifier.mjs')); symlinkSync('/etc/hostname', path.join(ln, 'poc/stage2/src/b3/verifier.mjs'));
  assert.throws(() => anchorListing(ln), /symbolic link/);
  const lf = fresh('v-linkfile'); unlinkSync(path.join(lf, '.gitattributes')); symlinkSync('/etc/hostname', path.join(lf, '.gitattributes'));
  assert.throws(() => anchorListing(lf), /symbolic link/);
  for (const [name, mut] of [['v-dotdot', (d) => d.files.push('../../etc/passwd')], ['v-abs', (d) => d.files.push('/etc/passwd')], ['v-dot', (d) => d.trees.push('poc/./stage2')],
    ['v-noself', (d) => { d.files = d.files.filter((f) => f !== 'scripts/anchor-paths.json'); }], ['v-version', (d) => { d.version = 'v0'; }], ['v-dup', (d) => d.files.push(d.files[0])], ['v-empty', (d) => { d.trees = []; }]]) {
    const dir = fresh(name); const f = path.join(dir, 'scripts/anchor-paths.json'); const d = JSON.parse(readFileSync(f, 'utf8')); mut(d); writeFileSync(f, JSON.stringify(d));
    assert.throws(() => anchorListing(dir), /anchor path list invalid/, name);
  }
});

// C-2 Windows compatibility: an environment or repository-shape problem is NOT_RUN (exit 3) with a diagnostic — never a
// policy REJECTED (exit 1), so it cannot pass for an expected reverse-test rejection
test('environment errors are NOT_RUN ENVIRONMENT_ERROR (exit 3), never REJECTED', () => {
  const runIn = (repoDir, anchor = ANCHOR_MAIN) => { const out = path.join(tmp, `out-env-${n++}`);
    const p = spawnSync(process.execPath, [CLI, '--profile', 'sigtest', '--subject', path.join(ROOT, 'poc/stage2/sigtest/SIGTEST.txt'), '--repo-dir', repoDir, '--anchor', anchor, '--anchor-source', 'env test', '--out', out],
      { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_MODE: 'one', STUB_ARGS: path.join(tmp, 'stub-args-env'), STUB_WF: '.github/workflows/attest-sigtest.yml' } });
    return { status: p.status, stderr: p.stderr, result: existsSync(path.join(out, 'result.json')) ? JSON.parse(readFileSync(path.join(out, 'result.json'), 'utf8')) : null }; };
  // 1. not a repository / no origin → fetch-main
  const noRepo = path.join(tmp, 'no-repo'); mkdirSync(noRepo);
  const a = runIn(noRepo);
  assert.equal(a.status, 3, a.stderr); assert.equal(a.result.result, 'NOT_RUN'); assert.equal(a.result.reason, 'ENVIRONMENT_ERROR'); assert.equal(a.result.environment[0].stage, 'fetch-main');
  assert.ok(!('reasons' in a.result), 'no policy reasons are invented'); assert.match(a.stderr, /NOT_RUN ENVIRONMENT_ERROR/);
  // 2. main whose tree cannot be snapshotted safely (a symbolic link entry) → snapshot-main, not ANCHOR_MISMATCH
  const w2 = path.join(tmp, 'work-link'); execFileSync('git', ['clone', '-q', '-b', 'main', origin, w2]);
  const oid = execFileSync('git', ['-C', w2, 'hash-object', '-w', '--stdin'], { input: '/etc/passwd' }).toString().trim();
  execFileSync('git', ['-C', w2, 'update-index', '--add', '--cacheinfo', `120000,${oid},docs/link`]);
  g(w2, 'commit', '-qm', 'TEST ONLY: symbolic link entry'); g(w2, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  const c2 = path.join(tmp, 'clone-link'); execFileSync('git', ['clone', '-q', origin, c2]);
  const b = runIn(c2);
  assert.equal(b.status, 3, b.stderr); assert.equal(b.result.result, 'NOT_RUN'); assert.equal(b.result.environment[0].stage, 'snapshot-main');
  assert.match(b.result.environment[0].error, /SNAPSHOT_FAILED\[entry\]: docs\/link: mode 120000/);
  assert.ok(!existsSync(SENTINEL));
  // 3. main whose anchor path list is invalid → anchor-main (environment), not a policy ANCHOR_MISMATCH
  const w3 = path.join(tmp, 'work-anchor'); execFileSync('git', ['clone', '-q', '-b', 'main', origin, w3]);
  g(w3, 'reset', '-q', '--hard', B); writeFileSync(path.join(w3, 'scripts/anchor-paths.json'), '{"version":"v0"}\n');
  g(w3, 'commit', '-qam', 'TEST ONLY: invalid anchor path list'); g(w3, 'push', '-q', '--force', 'origin', 'HEAD:refs/heads/main');
  const c3 = path.join(tmp, 'clone-anchor'); execFileSync('git', ['clone', '-q', origin, c3]);
  const c = runIn(c3);
  assert.equal(c.status, 3, c.stderr); assert.equal(c.result.result, 'NOT_RUN'); assert.equal(c.result.environment[0].stage, 'anchor-main');
  assert.match(c.result.environment[0].error, /anchor path list invalid/);
  g(work, 'push', '-q', '--force', 'origin', `${B}:refs/heads/main`);   // restore main = B for any later test
});

// PR17-REV001: a gh run that started but did not complete (Sigstore initialisation, network, any non-zero exit, unusable
// output) is NOT_RUN — never a policy REJECTED; the reverse tests' policy rejections carry specific reasons
test('PR17-REV001: gh started but did not complete → NOT_RUN (exit 3), raw exit code and stderr kept, no policy result', () => {
  for (const [mode, stage, exitCode] of [['init-fail', 'gh-verify', 1], ['not-json', 'gh-output', 0], ['not-array', 'gh-output', 0]]) {
    for (const profile of ['official', 'sigtest']) {
      const r = run(mode, ANCHOR_MAIN, { profile, subject: profile === 'sigtest' ? path.join(ROOT, 'poc/stage2/sigtest/SIGTEST.txt') : statement });
      assert.equal(r.status, 3, `${mode}/${profile}: ${r.stderr}`); assert.equal(r.result.result, 'NOT_RUN'); assert.equal(r.result.reason, 'ENVIRONMENT_ERROR');
      assert.equal(r.result.environment[0].stage, stage, mode); assert.equal(r.result.gh.exitCode, exitCode, mode);
      assert.ok(!('reasons' in r.result) && !('policyResult' in r.result), `${mode}: no policy result for an unfinished gh run`);
      if (mode === 'init-fail') { assert.match(r.result.environment[0].error, /gh exited 1 .*no valid Sigstore verifiers could be initialized/); assert.match(r.ghStderr, /Sigstore verifier/); assert.match(r.result.gh.stderr, /Sigstore verifier/); }
    }
  }
  assert.ok(!existsSync(SENTINEL));
});

test('PR17-REV001: gh gets only --repo; the core rejects a wrong workflow with a specific reason (official on the test signature)', () => {
  const sigtest = path.join(ROOT, 'poc/stage2/sigtest/SIGTEST.txt');
  const mixed = run('one', ANCHOR_MAIN, { profile: 'official', subject: sigtest, wf: '.github/workflows/attest-sigtest.yml' });
  assert.deepEqual(mixed.ghArgs, ['attestation', 'verify', sigtest, '--repo', 'hsuanyu9503/class-management-next', '--format', 'json']);
  assert.deepEqual(mixed.result.gh.args, mixed.ghArgs);
  assert.equal(mixed.status, 1, mixed.stderr); assert.equal(mixed.result.result, 'REJECTED');
  assert.ok(mixed.result.reasons.includes('SIGNER_WORKFLOW_MISMATCH#0'), mixed.result.reasons.join());
  assert.ok(mixed.result.reasons.includes('STATEMENT_INVALID#0'));
  // the wrong-anchor reverse test: gh completed, the rejection is the anchor
  const wrong = run('one', '0'.repeat(64), { profile: 'sigtest', subject: sigtest, wf: '.github/workflows/attest-sigtest.yml' });
  assert.equal(wrong.status, 1); assert.equal(wrong.result.result, 'REJECTED'); assert.ok(wrong.result.reasons.includes('ANCHOR_MISMATCH'));
  assert.equal(wrong.result.gh.exitCode, 0);
  assert.ok(!existsSync(SENTINEL));
});

test.after(() => rmSync(tmp, { recursive: true, force: true }));
}
