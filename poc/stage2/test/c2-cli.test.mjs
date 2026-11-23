/** C-2 CLI integration (PR16-REV001 / PR16-REV002): verify-attestation.mjs against a LOCAL bare repository and a STUB
 *  gh (canned JSON — NO cryptographic verification). The candidate toolchain commit plants a sentinel in every script
 *  the old CLI would have run (scripts/verify-anchor.mjs) and in package.json scripts; the sentinel must never appear,
 *  whether the input is accepted or rejected. Needs git and tar; uses only a temporary directory. */
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

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CLI = path.join(ROOT, 'poc/stage2/scripts/verify-attestation.mjs');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(path.join(os.tmpdir(), 's2-c2-cli-'));
const SENTINEL = path.join(tmp, 'SENTINEL-candidate-code-ran');
const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=c2-test', '-c', 'user.email=c2-test@localhost', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
const extractTree = (repo, rev, dir) => { mkdirSync(dir, { recursive: true }); const t = `${dir}.tar`; execFileSync('git', ['-C', repo, 'archive', '--format=tar', '-o', t, rev]); execFileSync('tar', ['-xf', t, '-C', dir]); return dir; };

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

// --- stub gh: STUB_MODE = one | dup | dup-bad
const bin = path.join(tmp, 'bin'); mkdirSync(bin);
writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('gh version 2.102.0 (stub)'); process.exit(0); }
const fs = require('fs'), c = require('crypto'); const s = c.createHash('sha256').update(fs.readFileSync(a[2])).digest('hex');
const wf = a[a.indexOf('--signer-workflow') + 1].split('/').slice(2).join('/');
const it = (p) => ({ verificationResult: { signature: { certificate: { buildSignerURI: 'https://github.com/hsuanyu9503/class-management-next/' + p + '@refs/heads/main', buildSignerDigest: ${JSON.stringify(B)},
  sourceRepositoryURI: 'https://github.com/hsuanyu9503/class-management-next', sourceRepositoryRef: 'refs/heads/main' } },
  verifiedTimestamps: [{ type: 'Tlog', timestamp: new Date(Date.now() - 3600e3).toISOString() }], statement: { subject: [{ name: 's', digest: { sha256: s } }] } } });
const m = process.env.STUB_MODE;
console.log(JSON.stringify(m === 'dup' ? [it(wf), it(wf)] : m === 'dup-bad' ? [it(wf), it(wf + '.bak')] : [it(wf)]));
`); chmodSync(path.join(bin, 'gh'), 0o755);
const repo = path.join(tmp, 'clone'); execFileSync('git', ['clone', '-q', origin, repo]);
let n = 0;
const run = (mode, anchor = ANCHOR_MAIN) => {
  const out = path.join(tmp, `out-${n++}`);
  const p = spawnSync(process.execPath, [CLI, '--profile', 'official', '--subject', statement, '--repo-dir', repo, '--anchor', anchor, '--anchor-source', 'c2-cli test', '--out', out],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, STUB_MODE: mode } });
  return { status: p.status, stderr: p.stderr, result: existsSync(path.join(out, 'result.json')) ? JSON.parse(readFileSync(path.join(out, 'result.json'), 'utf8')) : null };
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

test.after(() => rmSync(tmp, { recursive: true, force: true }));
