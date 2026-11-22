import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('PoC 未導入自動部署與發行 workflow（B3b 只新增已核准的 attest.yml）', async () => {
  const files = await readdir(new URL('../.github/workflows/', import.meta.url));
  assert.deepEqual(files.sort(), ['attest.yml', 'ci.yml']);
});

// S2-B2 B3b（plan v0.3 §3.1、§9.4 選項 b；負責人 2026-11-21 決定）
test('attest.yml：只在 main 觸發、逐 job 最小權限、action 以完整 SHA 固定、只有 PASS 才簽章', async () => {
  const w = await read('.github/workflows/attest.yml');
  const onBlock = w.slice(w.indexOf('\non:'), w.indexOf('\npermissions:'));
  assert.doesNotMatch(onBlock, /pull_request/);
  assert.match(onBlock, /push:\s*\n\s*branches: \[main\]/);
  assert.match(onBlock, /workflow_dispatch:/);
  assert.match(w, /^permissions: \{\}$/m);
  assert.match(w, /execute:\s*\n(?:.*\n)*?\s+if: github\.ref == 'refs\/heads\/main'/);
  // job sections: the lines from "  <name>:" up to the next two-space-indented job key (or end of file)
  const jobs = Object.fromEntries(w.slice(w.indexOf('\njobs:\n') + 7).split(/\n(?=  [a-z][a-z0-9-]*:\n)/).map((t) => [t.trim().split(':')[0], t]));
  assert.deepEqual(Object.keys(jobs).sort(), ['execute', 'verify']);
  const ex = jobs.execute; const ve = jobs.verify;
  assert.match(ve, /needs: execute/);
  assert.match(ex, /permissions:\s*\n\s*contents: read\s*\n\s*env:/);
  assert.doesNotMatch(ex, /id-token|attestations: write|attest-build-provenance/);
  assert.match(ve, /permissions:\s*\n\s*contents: read\s*\n\s*id-token: write\s*\n\s*attestations: write/);
  for (const u of w.match(/uses: .+/g)) assert.match(u, /^uses: actions\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, u);
  assert.match(ve, /if: steps\.v\.outputs\.result == 'PASS'\s*\n\s*uses: actions\/attest-build-provenance@/);
  for (const m of w.match(/persist-credentials: \w+/g)) assert.equal(m, 'persist-credentials: false');
  assert.equal((w.match(/uses: actions\/checkout@/g) || []).length, (w.match(/persist-credentials: false/g) || []).length);
  for (const m of w.match(/retention-days: \d+/g)) assert.equal(m, 'retention-days: 30');   // Q-3: 30 days
  assert.doesNotMatch(w, /secrets\./);
  for (const line of w.split('\n').filter((l) => /^\s*run: /.test(l))) assert.doesNotMatch(line, /\$\{\{/, line);   // expressions only via env, never inside run
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
