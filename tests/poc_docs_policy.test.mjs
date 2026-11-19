// REV-004: inherited Starter Kit docs must not present Pages/Release/site as current PoC requirements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const MARK = '本 PoC 適用說明';
const MENTIONS = /pages\.yml|release\.yml|自動部署|Pages|Release|site\/|npm run build|package_release/;

test('CLAUDE.md 不再宣稱合併 main 會自動部署或要求 release.yml／package_release', async () => {
  const s = await read('CLAUDE.md');
  assert.ok(s.includes(MARK));
  assert.doesNotMatch(s, /合併 `main` 後會自動部署 Pages/);
  assert.doesNotMatch(s, /合併 main 會\*\*自動部署網站\*\*/);
  assert.doesNotMatch(s, /手動啟動 `release\.yml`/);
  assert.doesNotMatch(s, /使用 `scripts\/package_release\.py --draft`/);
  assert.match(s, /npm run stage1:all/);
});

test('提到 Pages／Release／site 的範本文件都有不適用標示', async () => {
  const exempt = new Set(['docs/HANDOFF.md', 'docs/REVIEW_LOG.md', 'docs/TECH.md']);
  for (const dir of ['docs', 'templates']) {
    for (const f of await readdir(new URL(`../${dir}/`, import.meta.url))) {
      const p = `${dir}/${f}`;
      if (!f.endsWith('.md') || exempt.has(p)) continue;
      const s = await read(p);
      if (MENTIONS.test(s)) assert.ok(s.includes(MARK), `${p} 缺少「${MARK}」`);
    }
  }
});

test('PR 模板以 stage1:all 取代 npm run build', async () => {
  const s = await read('.github/pull_request_template.md');
  assert.match(s, /npm run stage1:all/);
  assert.doesNotMatch(s, /- \[ \] `npm run build`$/m);
});
