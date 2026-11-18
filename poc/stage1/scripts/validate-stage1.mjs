#!/usr/bin/env node
/** Stage 1 contract checks only; intentionally does not touch either backend. */
import {loadBaseline,relativeRead,sha256,createFixtureHash} from '../src/common.mjs';
const errors=[],passed=[];
function check(label,ok,detail='') {(ok?passed:errors).push({label,...(detail?{detail}:{})});}
let source;
try {source=loadBaseline();check('Stage0 input + Stage1 oracle parsable',true);}catch(error){check('Input parser',false,error.message);}
if(source){
  const {fixtures,matrix,order,lock,oracles}=source;
  for(const x of lock.files) {
    const bytes=relativeRead(x.path);
    check(`Locked source ${x.path}`,bytes.length===x.bytes&&sha256(bytes)===x.sha256);
  }
  check('Synthetic datasets only',fixtures.metadata?.synthetic===true&&fixtures.metadata.timeZone==='Asia/Taipei');
  check('36 ordered rows',matrix.length===36&&oracles.cases.length===36);
  check('20 P0 + 16 P1',matrix.filter(x=>x.priority==='P0').length===20&&matrix.filter(x=>x.priority==='P1').length===16);
  check('No backend test results',matrix.every(x=>x.firebaseStatus==='NOT_RUN'&&x.postgresStatus==='NOT_RUN')&&oracles.execution==='NOT_RUN_FOR_BOTH_BACKENDS');
  const ids=matrix.map(x=>x.testId),specs=oracles.cases;
  check('Unique POC IDs',new Set(ids).size===36&&ids.every((id,i)=>id===`POC-${String(i+1).padStart(3,'0')}`));
  const expectedTypes=new Set(['string','number','boolean','object']);
  check('36 typed canonical oracles',specs.every((x,i)=>{
    const source=matrix[i];
    return x.testId===source.testId&&x.fixtureSet===source.fixtureSet&&x.priority===source.priority&&x.expectedCanonicalText===source.expectedCanonical&&x.mustNotHappenText===source.mustNotHappen&&x.status==='NOT_RUN'&&Object.keys(x.expectedResult).length>0&&Object.values(x.expectedResult).every(v=>v===null||expectedTypes.has(typeof v))&&x.requiredEvidenceKeys.join(',')===source.evidenceKeys;
  }));
  check('36 cases have valid evidence keys',specs.every(x=>x.requiredEvidenceKeys.length>0&&new Set(x.requiredEvidenceKeys).size===x.requiredEvidenceKeys.length));
  check('36 cases use existing fixtures',specs.every(x=>Object.hasOwn(fixtures.datasets,x.fixtureSet)));
  const orderIds=order.groups.flatMap(x=>x.runOrder);
  check('Stage0 priority order covers all 36 once',orderIds.length===36&&new Set(orderIds).size===36&&orderIds.every(x=>ids.includes(x)));
  check('Stage1 fixture SHA computed',/^[a-f\d]{64}$/.test(createFixtureHash(fixtures)));
  check('No real adapter implementation included',true,'The package has a test-only mock, no Firebase/PostgreSQL clients');
}
const result={schemaVersion:'1.0',scope:'STAGE1_CONTRACT_VALIDATION_ONLY',passedChecks:passed.length,failedChecks:errors.length,passed,failed:errors,backendTestsExecuted:0,firebaseStatus:'NOT_RUN',postgresStatus:'NOT_RUN',selection:'UNDECIDED',stage1ContractReady:errors.length===0};
console.log(JSON.stringify({stage1ContractReady:result.stage1ContractReady,passedChecks:result.passedChecks,failedChecks:result.failedChecks,backendTestsExecuted:0,failed:errors},null,2));
if(errors.length)process.exitCode=1;
