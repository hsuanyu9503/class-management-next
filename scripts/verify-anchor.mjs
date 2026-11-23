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
// .github/workflows/ci.yml, attest.yml, attest-attack.yml or attest-sigtest.yml can skip the comparison. All are in the anchored set, so the
// digest changes; such diffs need the owner's review before the variable is updated.
import { readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const POC = 'poc/stage1/';
// PR16-REV001: the protected path list is DATA (scripts/anchor-paths.json, itself protected), so that a third-party
// verifier can recompute the anchor digest of a historical toolchain commit with ITS OWN trusted code over that
// commit's files — without running any program from the commit. The groups, and why each path is protected, are
// described in the file's "notes" (Stage 1 baseline; B3b signing workflow / approval record / verdict code; C-1
// attack workflow; C-2 test signing; C1-REV005 trusted call chain). adapter-b3/ and unit tests are not protected.
export const ANCHOR_PATHS_FILE = 'scripts/anchor-paths.json';
export const ANCHOR_PATHS_VERSION = 's2-anchor-paths-v1';
const SAFE = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)*$/;
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Reads and validates <base>/scripts/anchor-paths.json. Throws on anything unexpected (fail closed). */
export function anchorPaths(base = root) {
  const d = JSON.parse(readFileSync(join(base, ANCHOR_PATHS_FILE), 'utf8'));
  const ok = (a) => Array.isArray(a) && a.length > 0 && a.every((p) => typeof p === 'string' && SAFE.test(p)) && new Set(a).size === a.length;
  if (!d || d.version !== ANCHOR_PATHS_VERSION || !ok(d.files) || !ok(d.trees) || !d.files.includes(ANCHOR_PATHS_FILE) || !d.files.includes('scripts/verify-anchor.mjs')) throw new Error('anchor path list invalid');
  return { files: d.files, trees: d.trees };
}
const P0 = anchorPaths(root);
export const PROTECTED = P0.files;
/** C1-REV005: directories protected file by file (every regular file, recursively, sorted). */
export const PROTECTED_TREES = P0.trees;
// regular files only: a symbolic link (which could point outside the tree) or any other type fails the listing
const kind = (base, q) => { const st = lstatSync(join(base, q)); if (st.isSymbolicLink()) throw new Error(`symbolic link in anchored set: ${q}`); return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other'; };
const treeFiles = (base, rel) => { const out = []; const walk = (r) => { if (kind(base, r) !== 'dir') throw new Error(`not a directory: ${r}`); for (const n of readdirSync(join(base, r)).sort()) { const q = `${r}/${n}`; const k = kind(base, q); if (k === 'dir') walk(q); else if (k === 'file') out.push(q); else throw new Error(`not a regular file: ${q}`); } }; walk(rel); return out; };

/** @param base a checkout (or an extracted tree of any commit): its OWN path list and files are used. */
export function anchorListing(base = root) {
  const { files, trees } = anchorPaths(base);
  const lock = JSON.parse(readFileSync(join(base, POC, 'contracts/stage1-baseline-lock.json'), 'utf8'));
  const fixed = (lock.fixed || []).map((f) => POC + f.path);
  if (!fixed.every((p) => typeof p === 'string' && SAFE.test(p))) throw new Error('lock path invalid');
  const paths = [...new Set([...files, ...trees.flatMap((t) => treeFiles(base, t)), ...fixed])].sort();
  const missing = paths.filter((p) => !existsSync(join(base, p)));
  if (missing.length) throw new Error(`anchored file missing: ${missing.join(', ')}`);
  for (const p of paths) if (kind(base, p) !== 'file') throw new Error(`not a regular file: ${p}`);
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
