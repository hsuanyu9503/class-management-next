// REV-004：PoC 操作文件不得含網站部署／發行的操作指示；範本參考集中於 docs/starter-kit-reference/。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const MARK = '本 PoC 適用說明';
const OPERATIONAL = ['CLAUDE.md', 'README.md', 'docs/WORKFLOW.md', 'docs/ONE_PAGE.md', 'docs/SETUP_CHECKLIST.md',
  'docs/CODE_REVIEW.md', 'docs/TECH.md', 'templates/CLAUDE_GITHUB_TASK.md', '.github/pull_request_template.md'];
// 會誤導 AI 操作者的部署／發行「指示」句型
const DIRECTIVE = /合併[^。\n]{0,12}自動部署|自動部署 ?Pages|觸發[^。\n]{0,8}Pages|npm run build|手動(?:啟動|執行)[^。\n]{0,8}[Rr]elease|Release Actions|Pages Source|package_release\.py --draft|pages\.yml` 於/;
const withoutBanner = (s) => s.split('\n').filter((l) => !l.includes(MARK)).join('\n');

test('PoC 操作文件不含網站部署／發行的操作指示', async () => {
  for (const p of OPERATIONAL) {
    const hit = withoutBanner(await read(p)).match(DIRECTIVE);
    assert.equal(hit, null, `${p} 含有不適用的指示：${hit?.[0]}`);
  }
});

test('CLAUDE.md 指向 PoC 驗證命令與外部錨定', async () => {
  const s = await read('CLAUDE.md');
  assert.match(s, /npm run stage1:all/);
  assert.match(s, /CMN_STAGE1_ANCHOR_SHA256/);
  assert.match(s, /docs\/starter-kit-reference\//);
});

test('網站／發行範本集中在 starter-kit-reference 並標示不適用', async () => {
  assert.match(await read('docs/starter-kit-reference/README.md'), /本 PoC 不適用/);
  for (const f of ['RELEASE_AUTOMATION.md', 'INSTALL.md', 'RELEASE_NOTES.md', 'ACCEPTANCE.md', 'ADOPT_EXISTING.md', 'CHANGELOG.md', 'REVIEW_UPGRADE_NOTES.md']) {
    assert.ok((await read(`docs/starter-kit-reference/${f}`)).includes(MARK), f);
  }
  for (const gone of ['docs/RELEASE_AUTOMATION.md', 'docs/INSTALL.md', 'templates/RELEASE_APPROVAL.md']) {
    await assert.rejects(read(gone), undefined, `${gone} 應已移至 starter-kit-reference`);
  }
});

test('其餘 docs／templates 若提到 Pages／Release／site 須有不適用標示', async () => {
  const MENTIONS = /pages\.yml|release\.yml|自動部署|Pages|Release|site\/|npm run build|package_release/;
  const skip = new Set(['docs/HANDOFF.md', 'docs/REVIEW_LOG.md', ...OPERATIONAL]);
  for (const dir of ['docs', 'templates']) {
    for (const f of await readdir(new URL(`../${dir}/`, import.meta.url))) {
      const p = `${dir}/${f}`;
      if (!f.endsWith('.md') || skip.has(p)) continue;
      const s = await read(p);
      if (MENTIONS.test(s)) assert.ok(s.includes(MARK), `${p} 缺少「${MARK}」`);
    }
  }
});

test('PR 模板以 stage1:all 取代 npm run build，且列出 baseline-anchor', async () => {
  const s = await read('.github/pull_request_template.md');
  assert.match(s, /npm run stage1:all/);
  assert.match(s, /baseline-anchor/);
});
