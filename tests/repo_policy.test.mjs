import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('PoC 未導入自動部署與發行 workflow', async () => {
  const files = await readdir(new URL('../.github/workflows/', import.meta.url));
  assert.deepEqual(files.sort(), ['ci.yml']);
});

test('validate 只有讀取權限並執行 Stage 1 全套與不變性檢查', async () => {
  const ci = await read('.github/workflows/ci.yml');
  assert.match(ci, /validate:/);
  assert.match(ci, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(ci, /secrets\./);
  assert.match(ci, /npm run stage1:all/);
  assert.match(ci, /git diff --exit-code -- poc\/stage1/);
});

test('Stage 1 鎖定檔案停用行尾轉換', async () => {
  assert.match(await read('.gitattributes'), /^poc\/stage1\/\*\* -text$/m);
});

test('CLAUDE.md 告知不得直接合併 main', async () => {
  assert.match(await read('CLAUDE.md'), /不得直接修改、強制推送或自行合併 `main`/);
});
