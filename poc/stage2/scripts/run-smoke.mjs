#!/usr/bin/env node
/** Entry point for the S2-B2 batch 1 infrastructure smoke with negative controls.
 *  Logic lives in src/orchestrator.mjs (see the rules there). Exit 0 only if everything behaves
 *  as expected; exit 2 on any precondition failure (nothing after it runs). */
import { spawnSync } from 'node:child_process';
import { runOrchestrator, ROOT } from '../src/orchestrator.mjs';

function run(args, env) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 240000 });
  return { code: r.status, spawnError: r.error ? `${r.error.code || ''} ${r.error.message}`.trim() : null, signal: r.signal, out: (r.stdout || '') + (r.stderr || '') };
}

const r = await runOrchestrator({ run });
console.log(JSON.stringify({ kind: 'INFRA_SMOKE_RUN', notAContractResult: true, stage1ContractStatus: 'UNCHANGED_NOT_RUN', ok: r.code === 0, abortedReason: r.abortedReason, results: r.results, smoke: r.smoke }, null, 2));
process.exit(r.code);
