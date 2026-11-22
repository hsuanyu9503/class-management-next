#!/usr/bin/env node
/** attest-attack.yml VERIFY-ATTACK job CLI (TRUSTED TOOLCHAIN, C-1). No id-token / attestations permission in
 *  that job. Parses every downloaded file only through the Verifier's safe parser (runVerifyJob); executes
 *  nothing from any artifact. Writes ONLY the safe summary (codes, IDs, digests). Attack plan v0.4 §3, §4.1.
 *  env (all from the workflow; inputs validated here):
 *   OUT_DIR, POLICY_DIR, WORKFLOW_SHA, GITHUB_*, CMN_* (vars)
 *   A14_*  : execute-a14 outputs  (TEST_ID ARTIFACT_ID PACKAGE_SHA256 MANIFEST_SHA256 NONCE PLATFORM_SUPPORTED TOOLCHAIN_COMMIT), A14_SCENARIO, DIR_A14
 *   DECOY_ARTIFACT_ID, DIR_DECOY · SAMENAME_OUTCOME, SAMENAME_ARTIFACT_ID, DIR_SAMENAME
 *   FOREIGN_ARTIFACT_ID, FOREIGN_OUTCOME, DIR_FOREIGN · PREV_OUTCOME, DIR_PREV
 *   A4_*   : execute-a4 outputs (same keys + TREES_UNCHANGED), A4_SCENARIO, DIR_A4
 *   PLATFORM_FILE : output of attack-platform-evidence.mjs (C1-REV001); missing → no platform evidence
 *  Exit code (C1 review): 0 ONLY when the summary is DEFENDED_WHERE_RUN; otherwise 1 after the summary is written.
 *  A green job is still not an acceptance — that needs the summary and the raw artifacts reviewed. */
import { readFileSync, readdirSync, lstatSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAttackVerify } from '../src/b3/attack-suite.mjs';
import { anchorListing } from '../../../scripts/verify-anchor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../..');
const env = process.env;
const git = (cwd, ...a) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const head = git(REPO, 'rev-parse', 'HEAD');
const workflowBlob = /^[0-9a-f]{40}$/.test(env.WORKFLOW_SHA || '') ? git(REPO, 'rev-parse', `${env.WORKFLOW_SHA}:.github/workflows/attest-attack.yml`) : null;
let policy = null;
if (env.POLICY_DIR) { try { policy = { text: readFileSync(path.join(env.POLICY_DIR, 'docs/stage2/S2B2-TRUST-POLICY.json'), 'utf8'), commit: git(env.POLICY_DIR, 'rev-parse', 'HEAD'), anchorDigest: anchorListing(env.POLICY_DIR).digest }; } catch { policy = null; } }
const oracle = JSON.parse(readFileSync(path.join(REPO, 'poc/stage1/contracts/canonical-oracles-v1.0.json'), 'utf8'));
const ID = (v) => (/^[0-9]{1,20}$/.test(v || '') ? v : '');
const dirIO = (d) => (d && existsSync(d) ? { list: () => readdirSync(d).map((n) => ({ name: n, isFile: lstatSync(path.join(d, n)).isFile() })), read: (n) => readFileSync(path.join(d, n)) } : null);
const outputs = (p) => ({ testId: env[`${p}_TEST_ID`], artifactId: ID(env[`${p}_ARTIFACT_ID`]), packageSha256: env[`${p}_PACKAGE_SHA256`], manifestSha256: env[`${p}_MANIFEST_SHA256`], attestationNonce: env[`${p}_NONCE`],
  platformSupported: env[`${p}_PLATFORM_SUPPORTED`] === 'true' ? true : env[`${p}_PLATFORM_SUPPORTED`] === 'false' ? false : undefined, toolchainCommit: env[`${p}_TOOLCHAIN_COMMIT`], trustedTreesUnchanged: env[`${p}_TREES_UNCHANGED`] === 'true' });
const a14Dir = dirIO(env.DIR_A14);
if (!a14Dir) { console.log('ATTACK_VERIFY_NOT_RUN: A14 package not downloaded'); process.exit(1); }
const prevDir = dirIO(env.DIR_PREV); let previous = { bytes: null, reason: env.PREV_OUTCOME === 'failure' ? 'previous package download failed (expired, wrong IDs, or no access)' : 'previous run / artifact not given' };
if (prevDir && env.PREV_OUTCOME === 'success') { const fs = prevDir.list().filter((e) => e.isFile); if (fs.length === 1) previous = { bytes: prevDir.read(fs[0].name) }; else previous = { bytes: null, reason: `previous download holds ${fs.length} files` }; }
let platform = null; try { platform = JSON.parse(readFileSync(env.PLATFORM_FILE, 'utf8')); } catch { platform = null; }
const sameDir = dirIO(env.DIR_SAMENAME); const decoyDir = dirIO(env.DIR_DECOY); const foreignDir = dirIO(env.DIR_FOREIGN); const a4Dir = dirIO(env.DIR_A4);
const summary = runAttackVerify({
  env, head, workflowBlob, policy, platform, caseSpecs: Object.fromEntries(oracle.cases.map((c) => [c.testId, c])),
  a14: { outputs: outputs('A14'), scenario: env.A14_SCENARIO, pkg: a14Dir.list, read: a14Dir.read,
    decoy: ID(env.DECOY_ARTIFACT_ID) && decoyDir ? { artifactId: ID(env.DECOY_ARTIFACT_ID), ...decoyDir } : null,
    sameName: { uploadOutcome: env.SAMENAME_OUTCOME, artifactId: ID(env.SAMENAME_ARTIFACT_ID), ...(sameDir || {}) },
    foreign: { artifactId: ID(env.FOREIGN_ARTIFACT_ID), downloadOutcome: env.FOREIGN_OUTCOME, previousRunId: ID(env.FOREIGN_RUN_ID), crossRunDownload: env.PREV_OUTCOME || null, ...(foreignDir || {}) },
    previous },
  a4: a4Dir && ID(env.A4_ARTIFACT_ID) ? { outputs: outputs('A4'), scenario: env.A4_SCENARIO, pkg: a4Dir.list, read: a4Dir.read } : null,
});
mkdirSync(env.OUT_DIR, { recursive: true });
writeFileSync(path.join(env.OUT_DIR, 'attack-summary.json'), JSON.stringify({ ...summary, runId: env.GITHUB_RUN_ID ?? null, runAttempt: env.GITHUB_RUN_ATTEMPT ?? null, verifyHead: head, workflowBlob }, null, 1));
for (const s of summary.scenarios) console.log(`ATTACK ${s.id} test=${s.testOutcome} platform=${s.platformOutcome} verifier=${s.verifierOutcome}${s.notRunReason ? ` notRun="${s.notRunReason}"` : ''}`);
console.log(`ATTACK_SUMMARY overall=${summary.overall} notRun=${summary.notRun.join(',') || '-'}`);
process.exit(summary.overall === 'DEFENDED_WHERE_RUN' ? 0 : 1);
