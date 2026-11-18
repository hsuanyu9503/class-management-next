/** Pure executor shared by mock harness and future adapters. No implicit service calls. */
import {evaluateOracle,validateAdapterEvidence} from './oracle.mjs';
const BACKENDS=new Set(['firebase','postgres']);
export async function executeCase(caseSpec, adapter, fixtures) {
  if(!caseSpec?.testId || !fixtures?.datasets) throw Error('Invalid test case / fixture set');
  if(!adapter||typeof adapter.execute!=='function')throw Error('Adapter requires execute(caseSpec, fixtures)');
  if(!['HARNESS_MOCK','BACKEND_REAL'].includes(adapter.mode))throw Error('Unsupported adapter mode');
  if(adapter.mode==='BACKEND_REAL'&&!BACKENDS.has(adapter.backend))throw Error('Real backend must be firebase or postgres');
  if(adapter.mode==='HARNESS_MOCK'&&adapter.backend!=='mock')throw Error('Mock backend must identify as mock');
  const startedAt=new Date().toISOString();
  const output=await adapter.execute(caseSpec,structuredClone(fixtures));
  const finishedAt=new Date().toISOString();
  if(!output||typeof output!=='object')throw Error('Adapter returned no output');
  const oracle=evaluateOracle(caseSpec,output.canonical);
  const evidence=validateAdapterEvidence(caseSpec,output.evidence);
  const success=oracle.ok&&evidence.ok;
  return {
    testId:caseSpec.testId,
    mode:adapter.mode,
    backend:adapter.backend,
    fixtureSet:caseSpec.fixtureSet,
    startedAt,finishedAt,
    status:adapter.mode==='HARNESS_MOCK'?(success?'HARNESS_PASS':'HARNESS_FAIL'):(success?'PASS':'FAIL'),
    failures:[...oracle.failures,...evidence.failures],
    // Recorded canonical/evidence, not a pass assertion from adapter.
    canonical:output.canonical??null,
    evidence:output.evidence??null,
    backendTestsExecuted:adapter.mode==='BACKEND_REAL'?1:0
  };
}
