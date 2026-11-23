import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('PoC 未導入自動部署與發行 workflow（B3b 的 attest.yml；C-1 的無簽章 attest-attack.yml）', async () => {
  const files = await readdir(new URL('../.github/workflows/', import.meta.url));
  assert.deepEqual(files.sort(), ['attest-attack.yml', 'attest.yml', 'ci.yml']);
});
const jobsOf = (w) => Object.fromEntries(w.slice(w.indexOf('\njobs:\n') + 7).split(/\n(?=  [a-z][a-z0-9-]*:\n)/).map((t) => [t.trim().split(':')[0], t]));
/** every line of every run step (single-line and block scalars) */
const runLines = (w) => { const out = []; const L = w.split('\n'); for (let i = 0; i < L.length; i++) { const m = /^(\s*)run: (.*)$/.exec(L[i]); if (!m) continue; out.push(m[2]); if (m[2] === '|') for (let j = i + 1; j < L.length && (L[j].startsWith(m[1] + '  ') || L[j] === ''); j++) out.push(L[j]); } return out; };

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
  // C-1 §1.2: this workflow only ever runs (and verifies) the honest scenario — fixed in the file
  assert.match(ex, /B3_SCENARIO: honest\n/); assert.match(ve, /EXP_SCENARIO: honest\n/);
  assert.doesNotMatch(w, /B3_SINGLE_ENTRY|attack-/);
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

// C-1（attack plan v0.4 §1.1、§3、§4.1；負責人 2026-11-22 Q-A）：攻擊驗收 workflow 不能簽章
test('attest-attack.yml：只能手動觸發、只在 main、沒有任何簽章權限、scenario 固定、只執行可信工具鏈', async () => {
  // full-line comments removed (they describe what is absent); everything else is checked as written
  const w = (await read('.github/workflows/attest-attack.yml')).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const a = await read('.github/workflows/attest.yml');
  const onBlock = w.slice(w.indexOf('\non:'), w.indexOf('\npermissions:'));
  assert.match(onBlock, /^\non:\n  workflow_dispatch:\n/); assert.doesNotMatch(onBlock, /push|pull_request|schedule|workflow_run|workflow_call/);
  assert.match(w, /^permissions: \{\}$/m);
  assert.doesNotMatch(w, /id-token|attestations|attest-build-provenance|secrets\./);
  const jobs = jobsOf(w);
  assert.deepEqual(Object.keys(jobs).sort(), ['a10', 'execute-a14', 'execute-a4', 'same-name', 'verify-attack']);
  for (const [n, j] of Object.entries(jobs)) assert.match(j, /\n    if: (always\(\) && )?github\.ref == 'refs\/heads\/main'/, n);
  for (const n of ['a10', 'execute-a14', 'execute-a4']) assert.match(jobs[n], /\n    permissions:\n      contents: read\n    [a-z]/, n);
  assert.match(jobs['same-name'], /\n    permissions: \{\}\n/);
  assert.match(jobs['verify-attack'], /\n    permissions:\n      contents: read\n      actions: read\n    steps:/);
  // actions: the same pinned SHAs as attest.yml (no new action, no tag)
  const pinned = new Set(a.match(/uses: .+/g));
  for (const u of w.match(/uses: .+/g)) { assert.match(u, /^uses: actions\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, u); assert.ok(pinned.has(u), `not pinned in attest.yml: ${u}`); }
  assert.equal((w.match(/uses: actions\/checkout@/g) || []).length, (w.match(/persist-credentials: false/g) || []).length);
  for (const m of w.match(/persist-credentials: \w+/g)) assert.equal(m, 'persist-credentials: false');
  for (const m of w.match(/retention-days: \d+/g)) assert.equal(m, 'retention-days: 30');
  for (const line of runLines(w)) assert.doesNotMatch(line, /\$\{\{/, line);   // expressions (incl. dispatch inputs) only via env / with
  // trusted scenarios fixed in this file; never honest
  assert.match(jobs['execute-a14'], /B3_SCENARIO: attack-a14\n/); assert.match(jobs['execute-a4'], /B3_SCENARIO: attack-a4-tamper\n\s+B3_SINGLE_ENTRY: tamper-toolchain\n/);
  assert.match(jobs['verify-attack'], /A14_SCENARIO: attack-a14\n/); assert.match(jobs['verify-attack'], /A4_SCENARIO: attack-a4-tamper\n/);
  assert.doesNotMatch(w, /SCENARIO: honest/);
  // A4-3: the verify job checks out only the trusted toolchain (+ main for the policy) and runs only the trusted CLI
  const ve = jobs['verify-attack'];
  assert.deepEqual(ve.match(/ref: .+/g), ['ref: ${{ vars.CMN_S2_TRUSTED_TOOLCHAIN_SHA || github.sha }}', 'ref: main']);
  assert.deepEqual(runLines(ve), ['node poc/stage2/scripts/attack-platform-evidence.mjs', 'node poc/stage2/scripts/attack-verify.mjs']);
  // the read-only token is used in exactly two places of verify-attack: the earlier run's package (A14-3b) and
  // the platform-evidence step (C1-REV001: this run's artifact list, same-name job error lines)
  assert.equal((w.match(/github\.token/g) || []).length, 2); assert.equal((ve.match(/github\.token/g) || []).length, 2);
  assert.match(ve, /run-id: \$\{\{ inputs\.previousRunId \}\}\n\s+github-token: \$\{\{ github\.token \}\}/);
  assert.match(ve, /GITHUB_TOKEN: \$\{\{ github\.token \}\}\n\s+OUT_FILE: .+\n\s+SAMENAME_CONTROL_OUTCOME: .+\n\s+FOREIGN_ARTIFACT_ID: .+\n\s+run: node poc\/stage2\/scripts\/attack-platform-evidence\.mjs\n/);
  // the same-name job has an upload control with a different name, before the same-name attempt
  assert.ok(jobs['same-name'].indexOf('id: control') > 0 && jobs['same-name'].indexOf('id: control') < jobs['same-name'].indexOf('id: up'));
  // the same-name upload must not overwrite, and its failure is expected (recorded, not fatal)
  assert.match(jobs['same-name'], /continue-on-error: true\n\s+uses: actions\/upload-artifact@[0-9a-f]{40} # v7\.0\.2\n\s+with:\n(?:.*\n)*?\s+overwrite: false/);
});

