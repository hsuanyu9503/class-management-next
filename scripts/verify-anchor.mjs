#!/usr/bin/env node
// REV-005: external trust anchor for the Stage 1 baseline.
// Every in-repo guard (lock, approval table, P0 pins, tests) can be edited inside the same PR,
// so CI compares one digest of all protected files with CMN_STAGE1_ANCHOR_SHA256, a GitHub
// repository variable that only the project owner can set (Settings → Secrets and variables →
// Actions → Variables). Setting it is the owner's approval record for exactly this baseline.
//
//   node scripts/verify-anchor.mjs --print   list "sha256  path" lines and the digest
//   node scripts/verify-anchor.mjs           compare with env CMN_STAGE1_ANCHOR_SHA256 (fails if unset)
//
// Residual risk (documented, not solvable inside the PR): a PR that edits this file,
// .github/workflows/ci.yml or .github/workflows/attest.yml can skip the comparison. Both are in the anchored set, so the
// digest changes; such diffs need the owner's review before the variable is updated.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const POC = 'poc/stage1/';
const S2 = 'poc/stage2/';
export const PROTECTED = [
  '.gitattributes', '.github/workflows/ci.yml', 'package.json', 'scripts/check.mjs', 'scripts/verify-anchor.mjs',
  POC + 'package.json', POC + 'contracts/stage1-baseline-lock.json',
  POC + 'src/common.mjs', POC + 'src/contract-guard.mjs', POC + 'src/runner.mjs', POC + 'src/oracle.mjs', POC + 'src/evidence.mjs',
  POC + 'scripts/validate-stage0.mjs', POC + 'scripts/validate-stage1.mjs', POC + 'scripts/validate-stage1-guards.mjs', POC + 'scripts/make-plan.mjs',
  POC + 'test/runner.test.mjs', POC + 'test/contract-guard.test.mjs', POC + 'test/mock-adapter.mjs',
  // S2-B2 B3b (plan v0.3 §9.5): the signing workflow, the approval record, and every file that launches the
  // sandbox or decides the verdict. Any change here changes the digest → the owner re-approves the anchor.
  // (Everything else the toolchain runs is pinned by the approved toolchain commit, CMN_S2_TRUSTED_TOOLCHAIN_SHA.)
  '.github/workflows/attest.yml', 'docs/stage2/S2B2-TRUST-POLICY.json',
  S2 + 'src/b3/sandbox.mjs', S2 + 'src/b3/isolation-policy.mjs', S2 + 'src/b3/verifier.mjs', S2 + 'src/b3/reconcile.mjs',
  S2 + 'src/b3/package.mjs', S2 + 'src/b3/trust-policy.mjs', S2 + 'src/b3/attest-verify.mjs', S2 + 'scripts/attest-verify.mjs',
  S2 + 'src/observer.mjs', S2 + 'src/verdict.mjs',
];
const sha = (b) => createHash('sha256').update(b).digest('hex');

export function anchorListing(base = root) {
  const lock = JSON.parse(readFileSync(join(base, POC, 'contracts/stage1-baseline-lock.json'), 'utf8'));
  const paths = [...new Set([...PROTECTED, ...lock.fixed.map((f) => POC + f.path)])].sort();
  const missing = paths.filter((p) => !existsSync(join(base, p)));
  if (missing.length) throw new Error(`anchored file missing: ${missing.join(', ')}`);
  const lines = paths.map((p) => `${sha(readFileSync(join(base, p)))}  ${p}`);
  const text = lines.join('\n') + '\n';
  return { lines, digest: sha(Buffer.from(text, 'utf8')) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let listing;
  try { listing = anchorListing(); } catch (e) { console.error(`ANCHOR_ERROR：${e.message}`); process.exit(1); }
  const { lines, digest } = listing;
  if (process.argv.includes('--print')) {
    console.log(lines.join('\n'));
    console.log(`\nCMN_STAGE1_ANCHOR_SHA256=${digest}  (${lines.length} files)`);
  } else {
    const expected = (process.env.CMN_STAGE1_ANCHOR_SHA256 || '').trim().toLowerCase();
    if (!expected) {
      console.error('PENDING_OWNER_APPROVAL：尚未設定 repository variable CMN_STAGE1_ANCHOR_SHA256。');
      console.error(`本 Head 的 digest：${digest}（${lines.length} 個受保護檔案）。負責人核准後才設定。`);
      process.exit(1);
    }
    if (expected !== digest) {
      console.error(`ANCHOR_MISMATCH：受保護檔案與負責人核准的基準不同。\n  approved=${expected}\n  current =${digest}`);
      console.error('執行 node scripts/verify-anchor.mjs --print 查看逐檔 SHA，並與已核准的清單比對。');
      process.exit(1);
    }
    console.log(`ANCHOR_OK：${lines.length} 個受保護檔案與負責人核准的基準一致（${digest}）。`);
  }
}
