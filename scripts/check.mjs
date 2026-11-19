// Starter Kit V1.2 scripts/check.mjs 的 PoC 版本：
// 本 Repository 不採用範本的 site/、pages.yml、release.yml，故改為檢查流程文件、
// Stage 1 套件必要檔案，以及全庫的機密檔名。這是基礎結構檢查，不是完整安全稽核。
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'README.md', 'CLAUDE.md', 'docs/SPEC.md', 'docs/DESIGN.md', 'docs/TECH.md',
  'docs/HANDOFF.md', 'docs/WORKFLOW.md', 'docs/DATA_SAFETY.md',
  'docs/CODE_REVIEW.md', 'docs/RISK_POLICY.md', 'docs/REVIEW_LOG.md',
  'templates/CHATGPT_TO_CLAUDE.md', 'templates/CLAUDE_TO_CHATGPT.md',
  'templates/CLAUDE_GITHUB_TASK.md', 'templates/CHATGPT_CODE_REVIEW.md',
  'templates/CHATGPT_REVIEW_REQUEST.md', 'templates/REVIEW_FIX_HANDOFF.md',
  'templates/CLAUDE_REVIEW_RESPONSE.md', 'scripts/export_review_packet.py', 'scripts/verify-anchor.mjs',
  '.github/workflows/ci.yml', '.github/pull_request_template.md', '.gitattributes',
  'poc/stage1/package.json', 'poc/stage1/contracts/source-lock.json',
  'poc/stage1/contracts/poc-test-matrix-v1.0.csv',
  'poc/stage1/contracts/canonical-oracles-v1.0.json',
  'poc/stage1/fixtures/canonical-fixtures-v1.0.json',
  'poc/stage1/stage1-file-manifest.json'
];
for (const f of required) await readFile(join(root, f));

// 本 PoC 不得自動部署或發行：範本的 pages.yml / release.yml 未導入。
const workflows = await readdir(join(root, '.github/workflows'));
for (const forbidden of ['pages.yml', 'release.yml']) {
  if (workflows.includes(forbidden)) throw new Error(`PoC 未核准自動部署／發行：${forbidden}`);
}

// 全庫機密檔名掃描（.env.example 允許）。
const sensitive = /(^|\/)(\.env(\..+)?|secrets?|credentials?|service[-_]?account[^/]*\.json)$|\.(pem|p12|pfx|key)$/i;
const hits = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.review-packets'].includes(e.name)) continue;
    const p = join(dir, e.name);
    const rel = relative(root, p).split('\\').join('/');
    if (e.isDirectory()) { await walk(p); continue; }
    if (sensitive.test(rel) && !rel.endsWith('.env.example')) hits.push(rel);
  }
}
await walk(root);
if (hits.length) throw new Error(`偵測到可能含機密的檔名：${hits.join(', ')}`);

console.log(`檢查通過：${required.length} 個必要檔案、無 Pages/Release 自動部署、無機密檔名。`);
console.log('注意：這是基礎結構檢查，不是完整安全稽核。');
