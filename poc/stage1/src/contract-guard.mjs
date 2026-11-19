/** Stage 1 contract guards (REV-001 / REV-003). Pure functions; no network, no backend.
 *
 *  Three independent layers protect canonical-oracles from silent semantic relaxation:
 *   1. checkOracleApproval   – a separate expectation table (contracts/oracle-approval-v1.0.json)
 *                              whose fixture-derived fields are recomputed from locked fixtures and
 *                              whose sourceTokens must appear in the locked CSV row.
 *   2. checkSafetyInvariants – rules hard-coded HERE (not in any JSON) that no expectation may relax.
 *   3. checkBaselineLock     – byte-level SHA-256/size lock of every fixed baseline file.
 */
import {isDeepStrictEqual} from 'node:util';
import {getDataAtPath,sha256} from './common.mjs';

const ERROR_CODES=['FORBIDDEN','VERSION_CONFLICT','OPERATION_REUSE_MISMATCH','LOCAL_SAVE_FAILED'];
// Boolean outcomes that would mean disclosure, overwrite, fake success or auto-change. Must stay false.
const MUST_BE_FALSE=/(Disclosure|Disclosed|Leaked|Accepted|Guessed|AutoResolved|Published|ServerVerifiedShown)$|^(silentOverwrite|autoRewrite|duplicateCommit|sensitiveReasonReturned|pretendedLatest|draftCommitted|successShown|remoteVerified)$/;
// Counts of leaked / unconfirmed / duplicated items. Must stay exactly 0.
const MUST_BE_ZERO=/^(identifyingFieldsReturned|committedWithoutConfirmation|duplicateIssues)$/;

export function checkOracleApproval(oracles,approval,matrix,fixtures){
  const failures=[];
  const rows=new Map(matrix.map(r=>[r.testId,r]));
  const approved=new Map((approval?.cases??[]).map(c=>[c.testId,c]));
  if(approved.size!==36||approval.cases.length!==36)failures.push(`approval table must list 36 unique cases, got ${approval?.cases?.length}`);
  for(const spec of oracles.cases){
    const a=approved.get(spec.testId),row=rows.get(spec.testId);
    if(!a){failures.push(`${spec.testId}: not in approval table`);continue;}
    if(!row){failures.push(`${spec.testId}: not in locked CSV`);continue;}
    const text=[row.precondition,row.action,row.expectedCanonical,row.mustNotHappen].join('\n');
    if(!Array.isArray(a.sourceTokens)||a.sourceTokens.length===0)failures.push(`${spec.testId}: no sourceTokens`);
    for(const t of a.sourceTokens??[])if(!text.includes(t))failures.push(`${spec.testId}: source token not in CSV row: ${t}`);
    const oracleKeys=Object.keys(spec.expectedResult).sort(),approvedKeys=Object.keys(a.fields??{}).sort();
    if(!isDeepStrictEqual(oracleKeys,approvedKeys))failures.push(`${spec.testId}: field set differs from approval (oracle=${oracleKeys}; approved=${approvedKeys})`);
    for(const [field,rule] of Object.entries(a.fields??{})){
      let expected;
      if(Object.hasOwn(rule,'fixture')){
        const got=getDataAtPath(fixtures,rule.fixture);
        if(!got.exists){failures.push(`${spec.testId}.${field}: fixture path missing ${rule.fixture}`);continue;}
        expected=got.value;
      }else if(Object.hasOwn(rule,'value'))expected=rule.value;
      else{failures.push(`${spec.testId}.${field}: rule needs fixture or value`);continue;}
      if(!Object.hasOwn(spec.expectedResult,field))continue;
      if(!isDeepStrictEqual(spec.expectedResult[field],expected))failures.push(`${spec.testId}.${field}: oracle ${JSON.stringify(spec.expectedResult[field])} != approved ${JSON.stringify(expected)}`);
    }
  }
  return {ok:failures.length===0,failures};
}

export function checkSafetyInvariants(oracles,matrix){
  const failures=[];
  const rows=new Map(matrix.map(r=>[r.testId,r]));
  for(const spec of oracles.cases){
    const text=rows.get(spec.testId)?.expectedCanonical??'';
    for(const [field,value] of Object.entries(spec.expectedResult)){
      const leaf=field.split('.').pop();
      if(MUST_BE_FALSE.test(leaf)&&value!==false)failures.push(`${spec.testId}.${field} must be false, got ${JSON.stringify(value)}`);
      if(MUST_BE_ZERO.test(leaf)&&value!==0)failures.push(`${spec.testId}.${field} must be 0, got ${JSON.stringify(value)}`);
    }
    const code=spec.expectedResult.code;
    if(code!==undefined&&!ERROR_CODES.includes(code))failures.push(`${spec.testId}.code must be a rejection code, got ${JSON.stringify(code)}`);
    for(const c of ERROR_CODES)if(text.includes(c)&&code!==undefined&&code!==c)failures.push(`${spec.testId}.code must be ${c} per CSV, got ${JSON.stringify(code)}`);
    if(spec.priority==='P0'&&text.includes('FORBIDDEN')&&code!=='FORBIDDEN')failures.push(`${spec.testId}: P0 FORBIDDEN case lost its code`);
  }
  return {ok:failures.length===0,failures};
}

/** read(path) -> Buffer|null. Verifies fixed files byte-for-byte and classifies every package file. */
export function checkBaselineLock(lock,deliveryManifest,read,listFiles){
  const failures=[],modifiedSinceDelivery=[];
  const fixed=new Map((lock?.fixed??[]).map(f=>[f.path,f]));
  for(const required of lock?.mustBeFixed??[])if(!fixed.has(required))failures.push(`required fixed file not locked: ${required}`);
  for(const f of fixed.values()){
    const bytes=read(f.path);
    if(!bytes){failures.push(`fixed file missing: ${f.path}`);continue;}
    if(bytes.length!==f.bytes||sha256(bytes)!==f.sha256)failures.push(`fixed file changed: ${f.path}`);
  }
  const delivered=new Map(deliveryManifest.files.map(f=>[f.path,f]));
  for(const f of fixed.values()){
    const d=delivered.get(f.path);
    if(d&&d.sha256!==f.sha256)failures.push(`fixed file differs from v1.0 delivery manifest: ${f.path}`);
  }
  const mutable=new Set(lock?.mutable??[]),added=new Set(lock?.addedSinceDelivery??[]),ignored=lock?.ignoredRuntimeOutputs??[];
  for(const p of delivered.keys())if(!fixed.has(p)&&!mutable.has(p))failures.push(`delivered file not classified fixed/mutable: ${p}`);
  for(const p of listFiles()){
    if(ignored.some(g=>p===g||(g.endsWith('/')&&p.startsWith(g))))continue;
    if(delivered.has(p)){
      if(mutable.has(p)){const b=read(p);if(sha256(b)!==delivered.get(p).sha256)modifiedSinceDelivery.push(p);}
      continue;
    }
    if(p==='stage1-file-manifest.json'||fixed.has(p))continue;
    if(!added.has(p))failures.push(`unlisted file in package: ${p}`);
  }
  return {ok:failures.length===0,failures,fixedCount:fixed.size,modifiedSinceDelivery};
}
