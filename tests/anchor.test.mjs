// REV-005：外部錨定（repository variable）比對測試。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { anchorListing } from '../scripts/verify-anchor.mjs';

const root = resolve(import.meta.dirname, '..');
const run = (cwd, env) => spawnSync(process.execPath, ['scripts/verify-anchor.mjs'], { cwd, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
const { digest } = anchorListing(root);

test('未設定 CMN_STAGE1_ANCHOR_SHA256 時必須失敗（fail closed）', () => {
  const r = run(root, {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PENDING_OWNER_APPROVAL/);
});

test('與核准 digest 一致時通過；不一致時失敗', () => {
  assert.equal(run(root, { CMN_STAGE1_ANCHOR_SHA256: digest }).status, 0);
  assert.equal(run(root, { CMN_STAGE1_ANCHOR_SHA256: '0'.repeat(64) }).status, 1);
});

test('REV-005 反例：POC-017 協同改寫 oracle+approval+lock+manifest 後 digest 改變', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmn-anchor-'));
  try {
    cpSync(root, dir, { recursive: true, filter: (s) => s !== join(root, '.git') && !s.startsWith(join(root, '.git') + '/') && !s.includes('node_modules') && !s.includes('.review-packets') });
    const P = join(dir, 'poc/stage1');
    const sha = (b) => createHash('sha256').update(b).digest('hex');
    const edit = (rel, fn) => { const p = join(P, rel); const j = JSON.parse(readFileSync(p, 'utf8')); fn(j); const b = Buffer.from(JSON.stringify(j, null, 2) + '\n'); writeFileSync(p, b); return b; };
    const o = edit('contracts/canonical-oracles-v1.0.json', (j) => { const c = j.cases.find((x) => x.testId === 'POC-017'); c.expectedResult.successes = 2; c.expectedResult.conflicts = 0; });
    const a = edit('contracts/oracle-approval-v1.0.json', (j) => { const c = j.cases.find((x) => x.testId === 'POC-017'); c.fields.successes = { value: 2 }; c.fields.conflicts = { value: 0 }; });
    const fix = (list) => list.map((f) => f.path === 'contracts/canonical-oracles-v1.0.json' ? { ...f, bytes: o.length, sha256: sha(o) } : f.path === 'contracts/oracle-approval-v1.0.json' ? { ...f, bytes: a.length, sha256: sha(a) } : f);
    edit('stage1-file-manifest.json', (j) => { j.files = fix(j.files); });
    edit('contracts/stage1-baseline-lock.json', (j) => { j.fixed = fix(j.fixed); });
    const r = run(dir, { CMN_STAGE1_ANCHOR_SHA256: digest });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ANCHOR_MISMATCH/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
