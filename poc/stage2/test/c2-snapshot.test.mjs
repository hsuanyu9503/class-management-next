/** C-2 Windows compatibility: Git snapshots without tar (src/b3/git-snapshot.mjs). Runs on Linux, macOS AND Windows
 *  (no shell, no tar, no symlink creation on disk). Needs only git.
 *    node --test test/c2-snapshot.test.mjs        (from poc/stage2)
 *  Reproduces the reported failure class: UTF-8 (Chinese) file names under poc/stage1/docs/ — the snapshot must
 *  contain them byte-for-byte, and the anchor digest computed over the snapshot must equal the digest of the committed
 *  bytes. Unsupported repository shapes fail closed with a SnapshotError (stage + path), never silently. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeCommit, listTree, pathProblem, parseBatch, SnapshotError } from '../src/b3/git-snapshot.mjs';
import { anchorListing, anchorPaths } from '../../../scripts/verify-anchor.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = mkdtempSync(path.join(os.tmpdir(), 's2-c2-snapshot-'));
const g = (cwd, args, o = {}) => execFileSync('git', ['-C', cwd, '-c', 'user.name=c2-test', '-c', 'user.email=c2-test@localhost', '-c', 'commit.gpgsign=false', ...args], { maxBuffer: 256 << 20, ...o });
const gs = (cwd, args, o) => g(cwd, args, o).toString('utf8').trim();
const HEAD = gs(ROOT, ['rev-parse', 'HEAD']);
let n = 0; const dest = () => path.join(tmp, `s${n++}`);

/** PR17-REV002: a commit built from tree objects with `git mktree -z` (plumbing only; no index, no checkout). Unlike
 *  `update-index`, mktree does not apply core.protectNTFS / protectHFS path filters, so on Windows the tree really
 *  contains names the OS cannot create (a:b.txt, CON.md, "x ") — exactly what the snapshot must reject. Only this
 *  throw-away repository is used; no global or user configuration is read or changed. */
const repo = path.join(tmp, 'plumb'); execFileSync('git', ['init', '-q', repo]);
const blobOf = (content) => gs(repo, ['hash-object', '-w', '--stdin'], { input: content ?? '' });
const mktree = (node) => {
  const lines = Object.entries(node).map(([name, v]) => v.__entry ? `${v.mode} ${v.type} ${v.oid}\t${name}` : `040000 tree ${mktree(v)}\t${name}`);
  return gs(repo, ['mktree', '-z', '--missing'], { input: lines.join('\0') + '\0' });
};
const commitOf = (entries) => {
  const root = {};
  for (const e of entries) {
    const parts = e.path.split('/'); let node = root;
    for (const dir of parts.slice(0, -1)) node = node[dir] ??= {};
    const mode = e.mode || '100644';
    node[parts.at(-1)] = { __entry: true, mode, type: mode === '160000' ? 'commit' : 'blob', oid: e.oid || blobOf(e.content) };
  }
  return gs(repo, ['commit-tree', mktree(root), '-m', 'test'], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@localhost', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@localhost' } });
};
/** the raw tree as git stores it (independent of git-snapshot.mjs): [{ mode, path }] */
const rawTree = (c) => g(repo, ['ls-tree', '-r', '-z', '--full-tree', c]).toString('utf8').split('\0').filter(Boolean).map((l) => ({ mode: l.split(' ')[0], path: l.slice(l.indexOf('\t') + 1) }));

test('snapshot of HEAD: every file byte-identical to the committed blob, UTF-8 (Chinese) names included', () => {
  const d = dest(); const r = materializeCommit(ROOT, HEAD, d);
  const files = listTree(ROOT, HEAD);
  assert.equal(r.files, files.length);
  const cjk = files.filter((f) => /[^\x00-\x7f]/.test(f.path));
  assert.ok(cjk.length >= 1, 'the repository has non-ASCII file names (the reported Windows failure)');
  assert.ok(cjk.some((f) => f.path.startsWith('poc/stage1/docs/')));
  for (const f of cjk) assert.ok(existsSync(path.join(d, ...f.path.split('/'))), f.path);
  // independent check: every file equals `git cat-file blob` (a separate git invocation per file for a sample + all non-ASCII)
  const sample = [...cjk, ...files.filter((_, i) => i % 7 === 0)];
  for (const f of sample) assert.equal(sha(readFileSync(path.join(d, ...f.path.split('/')))), sha(g(ROOT, ['cat-file', 'blob', f.oid])), f.path);
  // nothing else was written
  const walk = (p) => readdirSync(p, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(p, e.name)) : [path.relative(d, path.join(p, e.name)).split(path.sep).join('/')]);
  assert.deepEqual(walk(d).sort(), files.map((f) => f.path).sort());
});

test('anchor digest over the snapshot equals the digest of the committed bytes (no file skipped, no conversion)', () => {
  const d = dest(); materializeCommit(ROOT, HEAD, d);
  const listing = anchorListing(d);
  // recompute every anchored line from git objects directly, without the snapshot
  const expected = listing.lines.map((l) => { const p = l.slice(66); return `${sha(g(ROOT, ['cat-file', 'blob', `${HEAD}:${p}`]))}  ${p}`; });
  assert.deepEqual(listing.lines, expected);
  assert.equal(listing.digest, sha(Buffer.from(expected.join('\n') + '\n', 'utf8')));
  // the anchored set is complete: every listed file, every tree file, every lock file
  const { files } = anchorPaths(d); for (const f of files) assert.ok(listing.lines.some((l) => l.endsWith(`  ${f}`)), f);
  // on platforms with tar, the old path must agree byte-for-byte (cross-check, not used by the verifier)
  if (process.platform !== 'win32') {
    const t = path.join(tmp, 'old-tar'); const tarf = `${t}.tar`; execFileSync('mkdir', ['-p', t]);
    execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tarf, HEAD]); execFileSync('tar', ['-xf', tarf, '-C', t]);
    assert.equal(anchorListing(t).digest, listing.digest);
  }
});

test('byte fidelity: CRLF, BOM, binary, empty and executable files are written unchanged; NFD/NFC names kept as committed', () => {
  const bin = Buffer.from([0, 255, 13, 10, 13, 0x1a, 0xef, 0xbb, 0xbf]);
  const c = commitOf([
    { path: 'crlf.txt', content: 'a\r\nb\r\n' }, { path: 'bom.json', content: '﻿{"a":1}\n' }, { path: 'bin.dat', content: bin },
    { path: 'empty', content: '' }, { path: 'x.sh', content: '#!/bin/sh\n', mode: '100755' },
    { path: '文件/審查提示詞.md', content: '中文內容\n' }, { path: 'nfd/café.txt', content: 'nfd' },
  ]);
  const d = dest(); materializeCommit(repo, c, d);
  const rd = (p) => readFileSync(path.join(d, ...p.split('/')));
  assert.deepEqual(rd('crlf.txt'), Buffer.from('a\r\nb\r\n')); assert.deepEqual(rd('bom.json'), Buffer.from('﻿{"a":1}\n'));
  assert.deepEqual(rd('bin.dat'), bin); assert.equal(rd('empty').length, 0); assert.equal(rd('文件/審查提示詞.md').toString('utf8'), '中文內容\n');
  assert.deepEqual(listTree(repo, c).map((e) => e.path).filter((p) => p.startsWith('nfd/')), ['nfd/café.txt']);
});

test('fail closed with a diagnostic: symbolic links, submodules, unsafe or colliding names, bad commit IDs', () => {
  const blob = gs(repo, ['hash-object', '-w', '--stdin'], { input: 'x' });
  const cases = {
    'symbolic link': [[{ path: 'link', mode: '120000', content: '/etc/passwd' }], /\[entry\]: link: mode 120000/],
    'submodule': [[{ path: 'sub', mode: '160000', oid: HEAD }], /\[entry\]: sub: mode 160000/],
    'colon (Windows-reserved)': [[{ path: 'a:b.txt' }], /\[path\]: a:b\.txt: reserved or control character/],
    'reserved device name': [[{ path: 'docs/CON.md' }], /\[path\]: docs\/CON\.md: reserved name/],
    'trailing dot': [[{ path: 'dir./x' }], /\[path\]: dir\.\/x: segment ends in/],
    'trailing space': [[{ path: 'x ' }], /\[path\]: x : segment ends in/],
    'backslash': [[{ path: 'a\\b' }], /\[path\]: a\\b: reserved or control character/],
    'case collision': [[{ path: 'Readme.md' }, { path: 'README.md' }], /\[path\]: .* collides with/],
    'normalisation collision': [[{ path: 'caf\u00e9' }, { path: 'cafe\u0301' }], /\[path\]: .* collides with/],
  };
  for (const [name, [entries, why]] of Object.entries(cases)) {
    const c = commitOf(entries.map((e) => ({ content: 'x', ...e })));
    // PR17-REV002: first prove the fixture really contains the entry under test (path AND mode) — on every platform
    const raw = rawTree(c);
    for (const e of entries) assert.ok(raw.some((t) => t.path === e.path && t.mode === (e.mode || '100644')), `${name}: fixture lacks ${JSON.stringify(e.path)} ${e.mode || '100644'} (got ${JSON.stringify(raw)})`);
    assert.equal(raw.length, entries.length, `${name}: fixture has extra or missing entries`);
    assert.throws(() => materializeCommit(repo, c, dest()), (e) => e instanceof SnapshotError && why.test(e.message), name);   // the SPECIFIC reason
  }
  void blob;
  for (const bad of ['HEAD', HEAD.slice(0, 12), 'x'.repeat(40)]) assert.throws(() => listTree(ROOT, bad), SnapshotError, bad);
  assert.throws(() => listTree(ROOT, '0'.repeat(40)), /SNAPSHOT_FAILED\[ls-tree\]/);              // unknown commit
  assert.throws(() => listTree(path.join(tmp, 'not-a-repo'), HEAD), /SNAPSHOT_FAILED\[ls-tree\]/);
  // a non-empty destination is refused (a snapshot directory is used once)
  const d = dest(); materializeCommit(ROOT, HEAD, d); assert.throws(() => materializeCommit(ROOT, HEAD, d), /SNAPSHOT_FAILED\[write\]/);
  { const d2 = dest(); mkdirSync(d2); writeFileSync(path.join(d2, 'stray.txt'), 'x'); assert.throws(() => materializeCommit(ROOT, HEAD, d2), /destination not empty/); }   // even without a name clash
  for (const [p, ok] of [['poc/stage1/docs/官方參考與版本假設.md', true], ['a/b', true], ['../x', false], ['/x', false], ['a//b', false], ['a/./b', false], ['nul', false], ['COM1.txt', false], ['a?b', false], ['tab\tx', false]])
    assert.equal(pathProblem(p) === null, ok, p);
});

test('integrity: every blob from cat-file is re-hashed against its object ID; truncation and substitution fail', () => {
  const body = Buffer.from('payload\r\n'); const oid = createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex');
  const frame = (id, b) => Buffer.concat([Buffer.from(`${id} blob ${b.length}\n`), b, Buffer.from('\n')]);
  assert.deepEqual(parseBatch(frame(oid, body), [oid]).get(oid), body);
  assert.throws(() => parseBatch(frame(oid, Buffer.from('payload\n\n')), [oid]), /SNAPSHOT_FAILED\[integrity\]/);            // same size, other bytes
  assert.throws(() => parseBatch(frame(oid, body).subarray(0, 20), [oid]), /SNAPSHOT_FAILED\[cat-file\]/);                      // truncated
  { const f = frame(oid, body); assert.throws(() => parseBatch(f.subarray(0, f.length - 3), [oid]), /SNAPSHOT_FAILED\[cat-file\]: truncated blob/); }   // header complete, body short
  assert.throws(() => parseBatch(Buffer.from(`${oid} missing\n`), [oid]), /SNAPSHOT_FAILED\[cat-file\]/);                    // object missing
  assert.throws(() => parseBatch(frame('f'.repeat(40), body), [oid]), /SNAPSHOT_FAILED\[cat-file\]/);                        // another object
});

test.after(() => rmSync(tmp, { recursive: true, force: true }));
