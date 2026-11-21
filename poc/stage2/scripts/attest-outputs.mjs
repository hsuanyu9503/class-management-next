#!/usr/bin/env node
/** S2-B2 B3b — execute job: hand the sealed values to the job outputs (TRUSTED TOOLCHAIN). Runs as a separate,
 *  non-root step AFTER run-attest-execute.mjs has terminated the Adapter's namespace and exited, so no Adapter
 *  process exists when GITHUB_OUTPUT is written. Every value is validated before it is passed on. */
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
const out = process.env.B3_OUT_DIR; const testId = process.env.B3_SINGLE_CASE;
const o = JSON.parse(readFileSync(path.join(out, 'execute-outputs.json'), 'utf8'));
const rules = { testId: (v) => v === testId, attestationNonce: (v) => /^[0-9a-f]{64}$/.test(v), packageSha256: (v) => /^[0-9a-f]{64}$/.test(v),
  manifestSha256: (v) => /^[0-9a-f]{64}$/.test(v), platformSupported: (v) => typeof v === 'boolean', toolchainCommit: (v) => /^[0-9a-f]{40}$/.test(v),
  runId: (v) => v === process.env.GITHUB_RUN_ID, runAttempt: (v) => String(v) === process.env.GITHUB_RUN_ATTEMPT };
for (const [k, ok] of Object.entries(rules)) if (!ok(o[k])) { console.log(`OUTPUTS_INVALID ${k}`); process.exit(1); }
const lines = ['testId', 'attestationNonce', 'packageSha256', 'manifestSha256', 'platformSupported', 'toolchainCommit'].map((k) => `${k}=${o[k]}`);
appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
console.log(`OUTPUTS ${lines.join(' ')} (local diagnostic: ${o.localDiagnostic.result})`);
