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
 *   3. `gh attestation verify <subject> --repo <repo> --format json` (PR17-REV001: the signer workflow and refs are checked
 *      exactly by the core, not as gh filters). Only exit 0 with a JSON array is a verification result; any other gh
 *      outcome is NOT_RUN (verification not completed). Version, arguments, exit code, stdout and stderr are kept;
 *   4. blobs at the signer commit via `git rev-parse <commit>:<path>` in the clone;
 *   5. (official) targets of the approved toolchain commit, recomputed with THIS verifier's own code from that commit's
 *      files: its Stage 1 oracle / fixture files and anchorListing() over its tree with ITS path list (data,
 *      scripts/anchor-paths.json). PR16-REV001: no program from the candidate commit is ever run, and the core calls
 *      this only after every other check of every attestation passed. PR16-REV002: one extraction per full commit SHA;
 *   6. judgeAttestation(). Exit codes: 0 only for the profile's accept label; 1 REJECTED / REVOCATION_STATUS_UNKNOWN (policy);
 *      2 usage or unsupported gh; 3 NOT_RUN ENVIRONMENT_ERROR (fetch, snapshot, anchor computation, gh not startable,
 *      signer commit missing from the clone) — never reported as a policy rejection. result.json is always written. */
import { execFileSync, spawnSync } from 'node:child_process';   // spawnSync: gh only; git via execFileSync; no tar
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { judgeAttestation, computeTargets, parseGhVersion, ghVersionOk, ghVerifyArgs, classifyGhRun, PROFILES, MIN_GH } from '../src/b3/third-party.mjs';
import { anchorListing } from '../../../scripts/verify-anchor.mjs';
import { materializeCommit } from '../src/b3/git-snapshot.mjs';

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
// C-2 Windows compatibility: snapshots are read from Git's object database and written by the verifier's own code
// (src/b3/git-snapshot.mjs) — no `git archive | tar` (bsdtar on Windows failed on the repository's UTF-8 file names).
// Each snapshot gets its own fresh directory named by the FULL commit SHA (never a prefix); a name is used once.
const snapshot = (commit, name) => { const dir = path.join(tmp, name); materializeCommit(repoDir, commit, dir); return dir; };
// Environment / repository-shape problems are NOT policy decisions: they end as NOT_RUN (exit 3) with a diagnostic,
// never as REJECTED (exit 1) — a failed snapshot or a missing tool must not look like an expected policy rejection.
const envIssues = [];
const env = (stage, e) => { const d = { stage, error: String(e?.message ?? e).slice(0, 400) }; envIssues.push(d); return d; };
const writeResult = (o) => writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(o, null, 1));
const notRun = (extra = {}) => ({ result: 'NOT_RUN', reason: 'ENVIRONMENT_ERROR', accepted: false, environment: envIssues, platform: `${process.platform}/${process.arch} node ${process.version}`,
  notice: 'NOT a policy decision: the verification could not be completed in this environment. Fix the cause and run again.', ...extra });
try {
  // 2. policy from main as actually fetched now
  let sourceCommit = null; let fetchedAt = null; let mainDir = null;
  try { git('fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main'); fetchedAt = iso(); sourceCommit = git('rev-parse', 'refs/remotes/origin/main^{commit}'); }
  catch (e) { env('fetch-main', e); }
  if (sourceCommit) { try { mainDir = snapshot(sourceCommit, `main-${sourceCommit}`); } catch (e) { env('snapshot-main', e); } }
  let mainAnchor = null;
  if (mainDir) { try { mainAnchor = anchorListing(mainDir).digest; } catch (e) { env('anchor-main', e); } }
  if (envIssues.length) { writeResult(notRun()); console.error(`S2_THIRD_PARTY profile=${profile} result=NOT_RUN ENVIRONMENT_ERROR ${envIssues.map((d) => `${d.stage}: ${d.error}`).join(' | ')}`); process.exitCode = 3; }
  else {
    const policyPath = path.join(mainDir, P.policyFile);
    const policy = { text: existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : null, sourceCommit, fetchedAt, anchorDigest: mainAnchor,
      anchorExpected: String(args['--anchor']).trim().toLowerCase(), anchorSource: String(args['--anchor-source']).slice(0, 300) };

    // 3. gh attestation verify (parsed only on exit 0)
    const subject = path.resolve(args['--subject']);
    const subjectBytes = existsSync(subject) ? readFileSync(subject) : null;
    const ghArgs = ghVerifyArgs(subject);                          // PR17-REV001: workflow / refs are checked by the core
    const gh = spawnSync('gh', ghArgs, { encoding: 'utf8', maxBuffer: 64 << 20 });
    writeFileSync(path.join(outDir, 'gh-stdout.json'), gh.stdout || '');
    writeFileSync(path.join(outDir, 'gh-stderr.txt'), gh.stderr || '');
    // PR17-REV001: only exit 0 with a JSON array is a verification result; anything else → NOT_RUN (exit 3)
    const ghRun = classifyGhRun(gh);
    if (ghRun.issue) env(ghRun.issue.stage, ghRun.issue.error);
    const verified = ghRun.verified;

    // 4. / 5. facts from the clone
    const blobAt = (commit, p) => {
      try { git('cat-file', '-e', `${commit}^{commit}`); } catch (e) { env('signer-commit-missing', `${commit} is not in the clone (fetch main first): ${e.message}`); return null; }
      try { const b = git('rev-parse', '--verify', `${commit}:${p}`); return /^[0-9a-f]{40}$/.test(b) ? b : null; } catch { return null; }   // path absent at that commit: a fact
    };
    // PR16-REV002: one snapshot per full commit SHA, cached with its outcome (a failed snapshot stays failed)
    const trees = new Map();
    const treeOf = (commit) => {
      if (!/^[0-9a-f]{40}$/.test(commit)) return { ok: false };
      if (!trees.has(commit)) {
        let t; let dir = null;
        try { dir = snapshot(commit, `toolchain-${commit}`); } catch (e) { t = { ok: false, error: env('snapshot-toolchain', e).error }; }
        if (dir) { try { t = { ok: true, dir, anchorDigest: anchorListing(dir).digest }; } catch (e) { t = { ok: false, error: String(e.message).slice(0, 400) }; } }   // anchor list of the candidate: a fact about it
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

    // 6. judge — only over a COMPLETED gh verification (PR17-REV001: no policy result is produced for a run gh did not finish)
    const r = envIssues.length ? null : judgeAttestation({ profile, verified, subjectBytes, policy, blobAt, targetsAt, nowMs: Date.now() });
    const record = { toolchainTrees: [...trees].map(([commit, t]) => ({ commit, ok: t.ok, anchorDigest: t.anchorDigest ?? null, error: t.error ?? null })),
      gh: { version: ghVersion.join('.'), args: ghArgs, exitCode: gh.status, spawnError: gh.error ? String(gh.error.code || gh.error.message) : null, stdoutSha256: sha(gh.stdout || ''), stderr: String(gh.stderr || '').slice(0, 2000) },
      clock: { verifiedAt: iso(), source: 'local system clock of the verifier' }, platform: `${process.platform}/${process.arch} node ${process.version}` };
    if (envIssues.length) {
      writeResult(notRun({ ...(r ? { policyResult: r } : {}), ...record }));
      console.error(`S2_THIRD_PARTY profile=${profile} result=NOT_RUN ENVIRONMENT_ERROR ${envIssues.map((d) => `${d.stage}: ${d.error}`).join(' | ')}`);
      process.exitCode = 3;
    } else {
      writeResult({ ...r, ...record, notice: 'UNSIGNED VERIFICATION RECORD. Only gh verifies signatures; this record is the policy decision over gh\'s verified output.' });
      console.log(`S2_THIRD_PARTY profile=${profile} result=${r.result} reasons=${r.reasons.join(',') || '-'} attestations=${Array.isArray(verified) ? verified.length : '-'} gh=${ghVersion.join('.')}/exit=${gh.status} policy=${sourceCommit.slice(0, 12)}@${fetchedAt}`);
      process.exitCode = r.accepted ? 0 : 1;
    }
  }
} catch (e) {
  env('unexpected', e); writeResult(notRun()); console.error(`S2_THIRD_PARTY result=NOT_RUN ENVIRONMENT_ERROR unexpected: ${e.message}`); process.exitCode = 3;
} finally { rmSync(tmp, { recursive: true, force: true }); }
