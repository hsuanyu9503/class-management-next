/** Produces a Stage0-compatible evidence record from a future real backend result.
 *  This module does NOT collect trustable backend proof; callers must attach it. */
import {stableJson} from './common.mjs';
const HEX64=/^[0-9a-f]{64}$/;
export function toBackendEvidence(caseSpec,execResult,fixtureHash,{gitCommit=null,traceId=null,evidenceFiles=[],notes=''}={}) {
  if(execResult?.mode!=='BACKEND_REAL'||!['firebase','postgres'].includes(execResult?.backend))throw Error('Cannot create backend evidence from harness mock');
  if(!HEX64.test(fixtureHash))throw Error('Bad fixture hash');
  if(!['PASS','FAIL'].includes(execResult.status))throw Error('Incomplete real backend run status');
  if(!Array.isArray(evidenceFiles))throw Error('Evidence files should be an array');
  return {
    testId:caseSpec.testId,backend:execResult.backend,fixtureHash,gitCommit,status:execResult.status,
    expectedCanonical:caseSpec.expectedCanonicalText,
    actualCanonical:stableJson(execResult.canonical),
    startedAt:execResult.startedAt??null,
    finishedAt:execResult.finishedAt??null,
    evidenceFiles,traceId,notes
  };
}
