#!/usr/bin/env node
/** S2-B2 B3b — attest.yml VERIFY job CLI (TRUSTED TOOLCHAIN). Runs only code of the commit this job checked
 *  out; never executes anything from the artifact (it is parsed by readPackageSafe only).
 *  env: PACKAGE_DIR, OUT_DIR, POLICY_DIR (checkout of main), WORKFLOW_SHA, EXP_* (execute job outputs),
 *       CMN_STAGE1_ANCHOR_SHA256, CMN_S2_TRUSTED_TOOLCHAIN_SHA, CMN_S2_SIGNING_POLICY_BLOB, GITHUB_* (runner). */
import { readFileSync, readdirSync, lstatSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifyJob } from '../src/b3/attest-verify.mjs';
import { anchorListing } from '../../../scripts/verify-anchor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '../..');
const env = process.env;
const git = (cwd, ...a) => { try { return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const head = git(REPO, 'rev-parse', 'HEAD');
const workflowBlob = env.WORKFLOW_SHA && /^[0-9a-f]{40}$/.test(env.WORKFLOW_SHA) ? git(REPO, 'rev-parse', `${env.WORKFLOW_SHA}:.github/workflows/attest.yml`) : null;
let policy = null;
if (env.POLICY_DIR) {
  try { policy = { text: readFileSync(path.join(env.POLICY_DIR, 'docs/stage2/S2B2-TRUST-POLICY.json'), 'utf8'), commit: git(env.POLICY_DIR, 'rev-parse', 'HEAD'), anchorDigest: anchorListing(env.POLICY_DIR).digest }; } catch { policy = null; }
}
const oracle = JSON.parse(readFileSync(path.join(REPO, 'poc/stage1/contracts/canonical-oracles-v1.0.json'), 'utf8'));
const dir = env.PACKAGE_DIR;
const r = runVerifyJob({
  env, head, workflowBlob, policy,
  caseSpecs: Object.fromEntries(oracle.cases.map((c) => [c.testId, c])),
  listDownload: () => readdirSync(dir).map((n) => ({ name: n, isFile: lstatSync(path.join(dir, n)).isFile() })),
  readDownload: (n) => readFileSync(path.join(dir, n)),
});
mkdirSync(env.OUT_DIR, { recursive: true });
if (r.statementText) writeFileSync(path.join(env.OUT_DIR, 'statement.json'), r.statementText);
writeFileSync(path.join(env.OUT_DIR, 'verify.json'), JSON.stringify(r.report, null, 1));
writeFileSync(path.join(env.OUT_DIR, 'delivery.json'), JSON.stringify(r.delivery, null, 1));
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `result=${r.result}\nstatementSha256=${r.statementSha256 ?? ''}\n`);
console.log(`S2B2_B3B_VERIFY ${env.EXP_TEST_ID} result=${r.result} reasons=${r.report.reasons.join(',')} trust=${r.report.trust.configured ? 'configured' : r.report.trust.reasons.join(',')} statement=${r.statementSha256 ?? '-'}`);
