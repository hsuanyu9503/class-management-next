/** Produces a Stage0-schema evidence record from a future real backend result.
 *  REV-002: this module does NOT and CANNOT attest that a backend really ran. It never emits PASS.
 *  An oracle-matching BACKEND_REAL result is recorded as status BLOCKED with a
 *  PENDING_ATTESTATION note until an external, controlled acceptance layer (not part of Stage 1)
 *  verifies adapter identity, environment, backend trace and evidence files. */
import {stableJson} from './common.mjs';
const HEX64=/^[0-9a-f]{64}$/;
export const ATTESTATION_NOTE='PENDING_ATTESTATION: self-declared adapter result; not verified by a controlled acceptance layer; MUST NOT be counted as PoC PASS.';
export function toBackendEvidence(caseSpec,execResult,fixtureHash,{gitCommit=null,traceId=null,evidenceFiles=[],notes=''}={}) {
  if(execResult?.mode!=='BACKEND_REAL'||!['firebase','postgres'].includes(execResult?.backend))throw Error('Cannot create backend evidence from harness mock');
  if(!HEX64.test(fixtureHash))throw Error('Bad fixture hash');
  if(execResult.status==='PASS')throw Error('Stage 1 cannot accept a self-declared PASS; attestation layer not implemented');
  if(!['PENDING_ATTESTATION','FAIL'].includes(execResult.status))throw Error('Incomplete real backend run status');
  if(execResult.attested!==false)throw Error('Stage 1 results must be marked attested:false');
  if(typeof traceId!=='string'||!traceId.trim())throw Error('Backend traceId is required');
  if(!Array.isArray(evidenceFiles)||evidenceFiles.length===0||!evidenceFiles.every(f=>typeof f==='string'&&f.trim()))throw Error('At least one non-empty evidence file path is required');
  return {
    testId:caseSpec.testId,backend:execResult.backend,fixtureHash,gitCommit,
    status:execResult.status==='FAIL'?'FAIL':'BLOCKED',
    expectedCanonical:caseSpec.expectedCanonicalText,
    actualCanonical:stableJson(execResult.canonical),
    startedAt:execResult.startedAt??null,
    finishedAt:execResult.finishedAt??null,
    evidenceFiles,traceId,
    notes:execResult.status==='FAIL'?notes:[ATTESTATION_NOTE,notes].filter(Boolean).join(' ')
  };
}
