// C1-REV005：錨定必須涵蓋兩個 attest workflow 到判定／證據輸出的完整可信呼叫鏈。
// Entries: every `node …` command of attest.yml / attest-attack.yml (with its working-directory), every
// Runner program those scripts spawn ('node test/….mjs'), and every in-sandbox trusted entry ('/check/….mjs').
// Closure: static `import … from '<relative>'` and dynamic `import('<relative>')`. Every file reached must be
// in the anchored listing, except the Adapter under test (adapter-b3/, untrusted by design).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { anchorListing, PROTECTED_TREES } from '../scripts/verify-anchor.mjs';

const root = resolve(import.meta.dirname, '..');
const S2 = 'poc/stage2';
const anchored = new Set(anchorListing(root).lines.map((l) => l.split('  ')[1]));

function workflowEntries(file) {
  const L = readFileSync(join(root, file), 'utf8').split('\n'); const out = [];
  for (let i = 0; i < L.length; i++) {
    const m = /^\s*run: (.*node (\S+\.mjs).*)$/.exec(L[i]); if (!m) continue;
    let wd = '.'; for (let j = i - 1; j >= 0 && !/^\s+- name:/.test(L[j]); j--) { const w = /^\s*working-directory: (\S+)/.exec(L[j]); if (w) wd = w[1]; }
    out.push(join(wd, m[2]));
  }
  return out;
}
function closure(entries) {
  const seen = new Set(); const stack = [...entries];
  while (stack.length) {
    const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
    const src = readFileSync(join(root, f), 'utf8');
    const specs = [...src.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specs) { const t = relative(root, resolve(root, dirname(f), s)); assert.ok(existsSync(join(root, t)), `${f} imports missing ${t}`); stack.push(t); }
    // spawned Runner programs and in-sandbox trusted entries
    for (const m of src.matchAll(/'node (test\/[a-z0-9-]+\.mjs)'/g)) stack.push(join(S2, m[1]));
    for (const m of src.matchAll(/'\/check\/([a-z0-9-]+\.mjs)'/g)) stack.push(join(S2, 'sandbox-check', m[1]));
  }
  return [...seen].sort();
}

test('C1-REV005: every file of the trusted call chain of attest.yml and attest-attack.yml is anchored', () => {
  const entries = [...workflowEntries('.github/workflows/attest.yml'), ...workflowEntries('.github/workflows/attest-attack.yml')];
  for (const e of ['poc/stage2/scripts/run-attest-execute.mjs', 'poc/stage2/scripts/attest-verify.mjs', 'poc/stage2/scripts/run-a10.mjs', 'poc/stage2/scripts/attack-verify.mjs', 'poc/stage2/scripts/attack-platform-evidence.mjs']) assert.ok(entries.includes(e), `entry not found in workflows: ${e}`);
  const files = closure(entries);
  for (const must of ['poc/stage2/test/b3-run.mjs', 'poc/stage2/test/a10-run.mjs', 'poc/stage2/src/b3/selfcheck-host.mjs', 'poc/stage2/sandbox-check/selfcheck.mjs', 'poc/stage2/sandbox-check/probe-a10.mjs', 'poc/stage2/src/harness.mjs', 'poc/stage2/src/b3/mask-list.mjs']) assert.ok(files.includes(must), `closure misses ${must}`);
  const missing = files.filter((f) => !f.startsWith(`${S2}/adapter-b3/`) && !anchored.has(f));
  assert.deepEqual(missing, [], `trusted files outside the anchor: ${missing.join(', ')}`);
  // the runtime configuration those programs depend on
  for (const f of [`${S2}/package.json`, `${S2}/package-lock.json`, `${S2}/firebase.json`, `${S2}/firestore.rules`, '.github/workflows/attest.yml', '.github/workflows/attest-attack.yml']) assert.ok(anchored.has(f), f);
});

test('C1-REV005: protected trees are listed file by file, and a new file there changes the digest', () => {
  for (const t of PROTECTED_TREES) assert.ok([...anchored].some((f) => f.startsWith(`${t}/`)), t);
  assert.ok(anchored.has(`${S2}/src/b3/a10.mjs`) && anchored.has(`${S2}/src/b3/observation.mjs`) && anchored.has(`${S2}/src/b3/attack-suite.mjs`));
  assert.ok(![...anchored].some((f) => f.startsWith(`${S2}/adapter-b3/`)), 'the Adapter under test is not part of the trusted anchor');
});
