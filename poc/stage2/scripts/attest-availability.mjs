#!/usr/bin/env node
/** attest.yml AVAILABILITY job CLI (TRUSTED TOOLCHAIN, C-1f). Runs only when the verify job failed; has only
 *  `contents: read` + `actions: read` (no id-token, no attestations). Reads this run's artifact listing and the verify
 *  job's log (current attempt) with the job's read-only token, and writes availabilityDiagnostics() to OUT_DIR.
 *  Never prints or writes the token. Any API failure is recorded as unavailable.
 *  env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_API_URL, OUT_DIR, EXP_TEST_ID, EXP_ARTIFACT_ID */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { availabilityDiagnostics, MAX_ARTIFACTS } from '../src/b3/availability.mjs';

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
const errors = []; let listing = null; let verifyLog = null;
if (repo && run && attempt && env.GITHUB_TOKEN) {
  try { const j = await get(`${api}/repos/${repo}/actions/runs/${run}/artifacts?per_page=${MAX_ARTIFACTS}`);
    listing = { ok: Array.isArray(j.artifacts) && Number.isSafeInteger(j.total_count), artifacts: j.artifacts || [], totalCount: j.total_count };
  } catch (e) { errors.push(`artifacts: ${e.message}`); }
  try { const jobs = await get(`${api}/repos/${repo}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`);
    const job = (jobs.jobs || []).find((x) => x.name === 'verify');
    if (job) verifyLog = { ok: true, text: await get(`${api}/repos/${repo}/actions/jobs/${job.id}/logs`, 'application/vnd.github.v3.raw') }; else errors.push('verify job not found');
  } catch (e) { errors.push(`verify log: ${e.message}`); }
} else errors.push('missing repository / run / attempt / token');
const d = { ...availabilityDiagnostics({ testId: env.EXP_TEST_ID, expectedArtifactId: env.EXP_ARTIFACT_ID, listing, verifyLog, runAttempt: attempt }), errors: errors.map((e) => e.slice(0, 200)).slice(0, 5) };
mkdirSync(env.OUT_DIR, { recursive: true });
writeFileSync(path.join(env.OUT_DIR, 'availability.json'), JSON.stringify(d, null, 1));
console.log(`S2B2_AVAILABILITY test=${d.testId} expected=${d.expectedArtifactId} attempt=${d.runAttempt} listed=${d.expectedListed} sameNamed=${d.sameNamedArtifactIds ? d.sameNamedArtifactIds.length : '-'} errorLines=${d.verifyLog.errorLines.length} hints=${d.hints.join(',') || '-'} errors=${d.errors.length}`);
