#!/usr/bin/env node
/** Third-party attestation verifier CLI (TRUSTED TOOLCHAIN, C-2; attack plan v0.4 §5.1; C-2 plan v0.2 §2).
 *  Run by an INDEPENDENT verifier on their own machine, from their own clone of the repository — never in a workflow.
 *
 *    node poc/stage2/scripts/verify-attestation.mjs --profile <official|sigtest> --subject <file> \
 *         --repo-dir <clone> --anchor <owner-approved CMN_STAGE1_ANCHOR_SHA256> --anchor-source <where it was read> \
 *         --out <dir>
 *
 *  Steps (external programs via execFile, never a shell; nothing from the artifact or the statement is executed):
 *   1. `gh --version` must be >= 2.102.0 (GHSA-wjmr-j3rp-mh2g, GHSA-4mq3-hpgx-9cx8), otherwise exit 2 without verifying;
 *   2. fetch main into the clone; record the commit and the ACTUAL fetch time; extract that tree; recompute its anchor
 *      digest; read the profile's FIXED policy file from it (no option can point elsewhere);
 *   3. `gh attestation verify <subject> --repo … --signer-workflow <repo>/<fixed path> --source-ref refs/heads/main
 *      --format json` — the output is parsed ONLY when gh exits 0; version, arguments, exit code and output are kept;
 *   4. blobs at the signer commit via `git rev-parse <commit>:<path>` in the clone;
 *   5. (official) targets of the approved toolchain commit, recomputed with THIS verifier's own code from that commit's
 *      files: its Stage 1 oracle / fixture files and anchorListing() over its tree with ITS path list (data,
 *      scripts/anchor-paths.json). PR16-REV001: no program from the candidate commit is ever run, and the core calls
 *      this only after every other check of every attestation passed. PR16-REV002: one extraction per full commit SHA;
 *   6. judgeAttestation(); exit 0 only for the profile's accept label, 1 for REJECTED / REVOCATION_STATUS_UNKNOWN, 2 for usage. */
import { execFileSync, spawnSync } from 'node:child_process';   // spawnSync: gh only
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { judgeAttestation, computeTargets, parseGhVersion, ghVersionOk, PROFILES, REPO, SOURCE_REF, MIN_GH } from '../src/b3/third-party.mjs';
import { anchorListing } from '../../../scripts/verify-anchor.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const ALLOWED = new Set(['--profile', '--subject', '--repo-dir', '--anchor', '--anchor-source', '--out']);
const usage = (m) => { console.error(`verify-attestation: ${m}`); process.exit(2); };
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]; const v = process.argv[i + 1];
  if (!ALLOWED.has(k) || v === undefined || Object.hasOwn(args, k)) usage(`unexpected or repeated argument: ${k}`);
  args[k] = v;
}
const profile = args['--profile'];
if (!Object.hasOwn(PROFILES, profile)) usage('--profile must be official or sigtest');
for (const k of ['--subject', '--repo-dir', '--anchor', '--anchor-source', '--out']) if (!args[k]) usage(`${k} is required`);
const P = PROFILES[profile]; const repoDir = path.resolve(args['--repo-dir']); const outDir = path.resolve(args['--out']);
const git = (...a) => execFileSync('git', ['-C', repoDir, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
mkdirSync(outDir, { recursive: true });

// 1. gh version
let ghVersionText = ''; try { ghVersionText = execFileSync('gh', ['--version'], { encoding: 'utf8' }); } catch { ghVersionText = ''; }
const ghVersion = parseGhVersion(ghVersionText);
if (!ghVersionOk(ghVersion)) {
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ result: 'NOT_RUN', reason: 'GH_VERSION_UNSUPPORTED', ghVersion: ghVersion ? ghVersion.join('.') : null, minimum: MIN_GH.join('.') }, null, 1));
  usage(`gh ${ghVersion ? ghVersion.join('.') : '(not found)'} is older than ${MIN_GH.join('.')}: refusing to verify`);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 's2-verify-attestation-'));
// each extraction gets its own fresh directory, named by the FULL commit SHA (never a prefix); a name is used once
const extract = (rev, name) => { const dir = path.join(tmp, name); mkdirSync(dir); const tar = path.join(tmp, `${name}.tar`);
  execFileSync('git', ['-C', repoDir, 'archive', '--format=tar', '-o', tar, rev]); execFileSync('tar', ['-xf', tar, '-C', dir, '--no-same-owner']); return dir; };
try {
  // 2. policy from main as actually fetched now
  git('fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main');
  const fetchedAt = iso();
  const sourceCommit = git('rev-parse', 'refs/remotes/origin/main^{commit}');
  const mainDir = extract(sourceCommit, 'main');
  const policyPath = path.join(mainDir, P.policyFile);
  const policy = { text: existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : null, sourceCommit, fetchedAt,
    anchorDigest: (() => { try { return anchorListing(mainDir).digest; } catch { return null; } })(),
    anchorExpected: String(args['--anchor']).trim().toLowerCase(), anchorSource: String(args['--anchor-source']).slice(0, 300) };

  // 3. gh attestation verify (parsed only on exit 0)
  const subject = path.resolve(args['--subject']);
  const subjectBytes = existsSync(subject) ? readFileSync(subject) : null;
  const ghArgs = ['attestation', 'verify', subject, '--repo', REPO, '--signer-workflow', `${REPO}/${P.workflowPath}`, '--source-ref', SOURCE_REF, '--format', 'json'];
  const gh = spawnSync('gh', ghArgs, { encoding: 'utf8', maxBuffer: 64 << 20 });
  writeFileSync(path.join(outDir, 'gh-stdout.json'), gh.stdout || '');
  let verified = null;
  if (gh.status === 0) { try { const j = JSON.parse(gh.stdout); verified = Array.isArray(j) ? j : null; } catch { verified = null; } }

  // 4. / 5. facts from the clone
  const blobAt = (commit, p) => { try { git('cat-file', '-e', `${commit}^{commit}`); const b = git('rev-parse', '--verify', `${commit}:${p}`); return /^[0-9a-f]{40}$/.test(b) ? b : null; } catch { return null; } };
  // PR16-REV002: one extraction per full commit SHA, cached with its outcome (a failed extraction stays failed)
  const trees = new Map();
  const treeOf = (commit) => {
    if (!/^[0-9a-f]{40}$/.test(commit)) return { ok: false };
    if (!trees.has(commit)) {
      let t;
      try { const dir = extract(commit, `toolchain-${commit}`); t = { ok: true, dir, anchorDigest: anchorListing(dir).digest }; } catch (e) { t = { ok: false, error: String(e.message).slice(0, 200) }; }
      trees.set(commit, t);
    }
    return trees.get(commit);
  };
  const targetsAt = (commit, testId) => {
    const t = treeOf(commit); if (!t.ok) return null;
    try {
      return computeTargets({ oracleBytes: readFileSync(path.join(t.dir, 'poc/stage1/contracts/canonical-oracles-v1.0.json')),
        fixtureBytes: readFileSync(path.join(t.dir, 'poc/stage1/fixtures/canonical-fixtures-v1.0.json')), testId, anchorDigest: t.anchorDigest });
    } catch { return null; }
  };

  // 6. judge
  const r = judgeAttestation({ profile, verified, subjectBytes, policy, blobAt, targetsAt, nowMs: Date.now() });
  const out = { ...r, toolchainTrees: [...trees].map(([commit, t]) => ({ commit, ok: t.ok, anchorDigest: t.anchorDigest ?? null, error: t.error ?? null })), gh: { version: ghVersion.join('.'), args: ghArgs, exitCode: gh.status, stdoutSha256: sha(gh.stdout || ''), stderr: String(gh.stderr || '').slice(0, 2000) },
    clock: { verifiedAt: iso(), source: 'local system clock of the verifier' },
    notice: 'UNSIGNED VERIFICATION RECORD. Only gh verifies signatures; this record is the policy decision over gh\'s verified output.' };
  writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(out, null, 1));
  console.log(`S2_THIRD_PARTY profile=${profile} result=${r.result} reasons=${r.reasons.join(',') || '-'} attestations=${Array.isArray(verified) ? verified.length : '-'} gh=${ghVersion.join('.')}/exit=${gh.status} policy=${sourceCommit.slice(0, 12)}@${fetchedAt}`);
  process.exitCode = r.accepted ? 0 : 1;
} finally { rmSync(tmp, { recursive: true, force: true }); }
