#!/usr/bin/env node
/** attest-attack.yml VERIFY-ATTACK job: platform evidence for A14-2 / A14-3a (TRUSTED TOOLCHAIN, C1-REV001).
 *  Reads, with the job's read-only token, (1) this run's artifact list and (2) the "##[error]" lines of the
 *  same-name job's log; writes them to OUT_FILE. Never prints or writes the token. Any API failure is
 *  recorded as unavailable (→ the suite cannot call the related scenario DEFENDED).
 *  R2: (3) the foreign artifact given for A14-3a, looked up by ID in THIS repository (exists / expired / owning run).
 *  env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_API_URL, OUT_FILE, SAMENAME_CONTROL_OUTCOME, FOREIGN_ARTIFACT_ID */
import { writeFileSync } from 'node:fs';
import { errorLines } from '../src/b3/attack-suite.mjs';

const env = process.env;
const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '') ? env.GITHUB_REPOSITORY : null;
const run = /^[0-9]{1,20}$/.test(env.GITHUB_RUN_ID || '') ? env.GITHUB_RUN_ID : null;
const attempt = /^[0-9]{1,6}$/.test(env.GITHUB_RUN_ATTEMPT || '') ? env.GITHUB_RUN_ATTEMPT : null;
const raw = (url, accept = 'application/vnd.github+json') => fetch(url, { headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept, 'x-github-api-version': '2022-11-28' }, redirect: 'follow' });
const get = async (url, accept = 'application/vnd.github+json') => {
  const r = await raw(url, accept);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return accept === 'application/vnd.github+json' ? r.json() : r.text();
};
const foreignId = /^[0-9]{1,20}$/.test(env.FOREIGN_ARTIFACT_ID || '') ? env.FOREIGN_ARTIFACT_ID : null;
const out = { artifactsOk: false, artifacts: [], sameNameErrorLines: [], sameNameLogOk: false, sameNameControlOutcome: env.SAMENAME_CONTROL_OUTCOME || null, foreign: null, errors: [] };
if (repo && run && attempt && env.GITHUB_TOKEN) {
  try { const j = await get(`${api}/repos/${repo}/actions/runs/${run}/artifacts?per_page=100`); out.artifacts = (j.artifacts || []).map((x) => ({ id: String(x.id), name: String(x.name) })); out.artifactsOk = Array.isArray(j.artifacts) && j.total_count === j.artifacts.length; } catch (e) { out.errors.push(`artifacts: ${e.message}`); }
  try {
    const jobs = await get(`${api}/repos/${repo}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`);
    const job = (jobs.jobs || []).find((x) => x.name === 'same-name');
    if (job) { out.sameNameErrorLines = errorLines(await get(`${api}/repos/${repo}/actions/jobs/${job.id}/logs`, 'application/vnd.github.v3.raw')); out.sameNameLogOk = true; } else out.errors.push('same-name job not found');
  } catch (e) { out.errors.push(`same-name log: ${e.message}`); }
  if (foreignId) {
    // repository-scoped lookup: a 200 proves the artifact exists IN THIS repository; 404 = no such artifact here
    try { const r = await raw(`${api}/repos/${repo}/actions/artifacts/${foreignId}`); const j = r.status === 200 ? await r.json() : null;
      out.foreign = { artifactId: foreignId, status: r.status, expired: j ? j.expired === true : null, runId: j?.workflow_run?.id != null ? String(j.workflow_run.id) : null, name: j ? String(j.name) : null };
    } catch (e) { out.foreign = { artifactId: foreignId, status: null }; out.errors.push(`foreign artifact: ${e.message}`); }
  }
} else out.errors.push('missing repository / run / attempt / token');
writeFileSync(env.OUT_FILE, JSON.stringify(out, null, 1));
console.log(`PLATFORM_EVIDENCE foreign=${out.foreign ? `${out.foreign.status}/expired=${out.foreign.expired}/run=${out.foreign.runId}` : '-'} artifactsOk=${out.artifactsOk} artifacts=${out.artifacts.length} sameNameLogOk=${out.sameNameLogOk} errorLines=${out.sameNameErrorLines.length} control=${out.sameNameControlOutcome} errors=${out.errors.length}`);
