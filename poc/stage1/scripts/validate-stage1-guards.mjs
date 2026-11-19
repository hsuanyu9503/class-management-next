#!/usr/bin/env node
/** Stage 1 contract guards (REV-001 / REV-003). Separate from validate-stage1.mjs so that the
 *  original 14 contract checks stay unchanged and comparable. Touches no backend. */
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {loadBaseline,jsonRead,ROOT} from '../src/common.mjs';
import {checkOracleApproval,checkSafetyInvariants,checkBaselineLock,checkP0Pins} from '../src/contract-guard.mjs';

// Hard-coded so that removing an entry from the lock file itself is detected.
export const REQUIRED_FIXED=[
  'contracts/poc-test-matrix-v1.0.csv','fixtures/canonical-fixtures-v1.0.json','contracts/source-lock.json',
  'contracts/canonical-oracles-v1.0.json','contracts/oracle-approval-v1.0.json','contracts/test-order-v1.0.json',
  'contracts/evidence-schema-v1.0.json','artifacts/stage1-72-backend-not-run-plan.json',
  'stage0-file-manifest.json','stage1-file-manifest.json'
];
const read=p=>{const f=path.join(ROOT,p);return existsSync(f)?readFileSync(f):null;};
function listFiles(dir=ROOT,out=[]){
  for(const e of readdirSync(dir,{withFileTypes:true})){
    if(e.name==='node_modules')continue;
    const p=path.join(dir,e.name);
    if(e.isDirectory())listFiles(p,out);else out.push(path.relative(ROOT,p).split(path.sep).join('/'));
  }
  return out;
}
const passed=[],failed=[];
const check=(label,r)=>(r.ok?passed:failed).push({label,...(r.ok?{}:{failures:r.failures})});
const {fixtures,matrix,oracles}=loadBaseline();
const approval=jsonRead('contracts/oracle-approval-v1.0.json');
const lock=jsonRead('contracts/stage1-baseline-lock.json');
const delivery=jsonRead('stage1-file-manifest.json');
check('36 oracles match independent approval table (fixture-derived + CSV-traced)',checkOracleApproval(oracles,approval,matrix,fixtures));
check('Non-relaxable safety invariants (hard-coded) hold for all 36',checkSafetyInvariants(oracles,matrix));
check('20 P0 expectations equal literals pinned in code',checkP0Pins(oracles,matrix));
const b=checkBaselineLock({...lock,mustBeFixed:REQUIRED_FIXED},delivery,read,()=>listFiles());
check(`Fixed baseline: ${b.fixedCount} files match SHA-256/bytes; all package files classified`,b);
console.log(JSON.stringify({stage1GuardsReady:failed.length===0,passedChecks:passed.length,failedChecks:failed.length,
  approvalStatus:approval.status,modifiedSinceV1Delivery:b.modifiedSinceDelivery,failed},null,2));
if(failed.length)process.exitCode=1;
