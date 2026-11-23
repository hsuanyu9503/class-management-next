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
// .github/workflows/ci.yml, attest.yml or attest-attack.yml can skip the comparison. Both are in the anchored set, so the
// digest changes; such diffs need the owner's review before the variable is updated.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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
  // (C1-REV005: this list alone is NOT the whole trusted chain — see the C-1 block below. A configured
  //  CMN_S2_TRUSTED_TOOLCHAIN_SHA pins the toolchain commit too, but while it is unset the workflows run github.sha.)
  '.github/workflows/attest.yml', 'docs/stage2/S2B2-TRUST-POLICY.json',
  S2 + 'src/b3/sandbox.mjs', S2 + 'src/b3/isolation-policy.mjs', S2 + 'src/b3/verifier.mjs', S2 + 'src/b3/reconcile.mjs',
  S2 + 'src/b3/package.mjs', S2 + 'src/b3/trust-policy.mjs', S2 + 'src/b3/attest-verify.mjs', S2 + 'scripts/attest-verify.mjs',
  S2 + 'src/observer.mjs', S2 + 'src/verdict.mjs',
  // S2-B2 C-1 (attack-acceptance plan v0.4): the no-signing attack workflow
  '.github/workflows/attest-attack.yml',
  // C1-REV005: the whole TRUSTED call chain from both attest workflows to every verdict / evidence output — not a
  // hand-picked subset. With no trust root set the workflows check out github.sha, so the anchor (not the
  // toolchain variable) is what pins these files:
  //  - entry scripts the workflows run, and the Runner programs they spawn (b3-run, a10-run produce the sealed
  //    evidence, positive controls, equivalence, masking inputs and summaries);
  //  - the Stage 2 package / lock / emulator config those programs depend on;
  //  - PROTECTED_TREES below: every file of src/ (Verifier, Observer, harness, traces, masking, sandbox, self-check
  //    host, A10, attack suite, secret collector …) and sandbox-check/ (in-sandbox self-check and A10 probe).
  // Not protected by design: adapter-b3/ (the Adapter UNDER TEST — untrusted; A4-1 checks its tree from the host)
  // and unit tests. tests/anchor_coverage.test.mjs proves the static import closure of every entry is covered.
  S2 + 'scripts/run-attest-execute.mjs', S2 + 'scripts/attest-outputs.mjs', S2 + 'scripts/attest-delivery.mjs',
  S2 + 'scripts/run-a10.mjs', S2 + 'scripts/attack-verify.mjs', S2 + 'scripts/attack-platform-evidence.mjs',
  S2 + 'test/b3-run.mjs', S2 + 'test/a10-run.mjs', S2 + 'test/smoke.mjs',   // smoke.mjs: named by src/orchestrator.mjs
  S2 + 'package.json', S2 + 'package-lock.json', S2 + 'firebase.json', S2 + 'firestore.rules',
];
/** C1-REV005: directories protected file by file (every regular file, recursively, sorted). */
export const PROTECTED_TREES = [S2 + 'src', S2 + 'sandbox-check'];
const treeFiles = (base, rel) => { const out = []; const walk = (r) => { for (const n of readdirSync(join(base, r)).sort()) { const q = `${r}/${n}`; if (statSync(join(base, q)).isDirectory()) walk(q); else out.push(q); } }; walk(rel); return out; };
const sha = (b) => createHash('sha256').update(b).digest('hex');

export function anchorListing(base = root) {
  const lock = JSON.parse(readFileSync(join(base, POC, 'contracts/stage1-baseline-lock.json'), 'utf8'));
  const paths = [...new Set([...PROTECTED, ...PROTECTED_TREES.flatMap((t) => treeFiles(base, t)), ...lock.fixed.map((f) => POC + f.path)])].sort();
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
