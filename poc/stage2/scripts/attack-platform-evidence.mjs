#!/usr/bin/env node
/** attest-attack.yml VERIFY-ATTACK job: platform evidence for A14-2 / A14-3a (TRUSTED TOOLCHAIN, C1-REV001).
 *  Reads, with the job's read-only token, (1) this run's artifact list and (2) the "##[error]" lines of the
 *  same-name job's log; writes them to OUT_FILE. Never prints or writes the token. Any API failure is
 *  recorded as unavailable (→ the suite cannot call the related scenario DEFENDED).
 *  env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_API_URL, OUT_FILE, SAMENAME_CONTROL_OUTCOME */
import { writeFileSync } from 'node:fs';
import { errorLines } from '../src/b3/attack-suite.mjs';

const env = process.env;
const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '') ? env.GITHUB_REPOSITORY : null;
const run = /^[0-9]{1,20}$/.test(env.GITHUB_RUN_ID || '') ? env.GITHUB_RUN_ID : null;
const attempt = /^[0-9]{1,6}$/.test(env.GITHUB_RUN_ATTEMPT || '') ? env.GITHUB_RUN_ATTEMPT : null;
const get = async (url, accept = 'application/vnd.github+json') => {
  const r = await fetch(url, { headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept, 'x-github-api-version': '2022-11-28' }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return accept === 'application/vnd.github+json' ? r.json() : r.text();
};
const out = { artifactsOk: false, artifacts: [], sameNameErrorLines: [], sameNameLogOk: false, sameNameControlOutcome: env.SAMENAME_CONTROL_OUTCOME || null, errors: [] };
if (repo && run && attempt && env.GITHUB_TOKEN) {
  try { const j = await get(`${api}/repos/${repo}/actions/runs/${run}/artifacts?per_page=100`); out.artifacts = (j.artifacts || []).map((x) => ({ id: String(x.id), name: String(x.name) })); out.artifactsOk = Array.isArray(j.artifacts) && j.total_count === j.artifacts.length; } catch (e) { out.errors.push(`artifacts: ${e.message}`); }
  try {
    const jobs = await get(`${api}/repos/${repo}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`);
    const job = (jobs.jobs || []).find((x) => x.name === 'same-name');
    if (job) { out.sameNameErrorLines = errorLines(await get(`${api}/repos/${repo}/actions/jobs/${job.id}/logs`, 'application/vnd.github.v3.raw')); out.sameNameLogOk = true; } else out.errors.push('same-name job not found');
  } catch (e) { out.errors.push(`same-name log: ${e.message}`); }
} else out.errors.push('missing repository / run / attempt / token');
writeFileSync(env.OUT_FILE, JSON.stringify(out, null, 1));
console.log(`PLATFORM_EVIDENCE artifactsOk=${out.artifactsOk} artifacts=${out.artifacts.length} sameNameLogOk=${out.sameNameLogOk} errorLines=${out.sameNameErrorLines.length} control=${out.sameNameControlOutcome} errors=${out.errors.length}`);
