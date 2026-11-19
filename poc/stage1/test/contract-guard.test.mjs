/** Negative controls for review REV-001 / REV-002 / REV-003 (Head 211716e56186). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {loadBaseline,jsonRead,ROOT,createFixtureHash} from '../src/common.mjs';
import {checkOracleApproval,checkSafetyInvariants,checkBaselineLock} from '../src/contract-guard.mjs';
import {executeCase} from '../src/runner.mjs';
import {toBackendEvidence} from '../src/evidence.mjs';

const {fixtures,matrix,oracles}=loadBaseline();
const approval=jsonRead('contracts/oracle-approval-v1.0.json');
const lock=jsonRead('contracts/stage1-baseline-lock.json');
const delivery=jsonRead('stage1-file-manifest.json');
const schema=jsonRead('contracts/evidence-schema-v1.0.json');
const byId=new Map(oracles.cases.map(x=>[x.testId,x]));
const mutateOracle=(id,fn)=>{const o=structuredClone(oracles);fn(o.cases.find(c=>c.testId===id).expectedResult);return o;};
const mutateApproval=(id,fn)=>{const a=structuredClone(approval);fn(a.cases.find(c=>c.testId===id));return a;};
const read=p=>{const f=path.join(ROOT,p);return existsSync(f)?readFileSync(f):null;};
const files=()=>[...lock.fixed.map(f=>f.path),...lock.mutable,...lock.addedSinceDelivery];

// ---------- REV-001 ----------
test('REV-001 baseline: current oracles pass approval table and safety invariants',()=>{
  const a=checkOracleApproval(oracles,approval,matrix,fixtures);assert.ok(a.ok,a.failures.join('; '));
  const s=checkSafetyInvariants(oracles,matrix);assert.ok(s.ok,s.failures.join('; '));
});
test('REV-001 POC-002 identifyingFieldsReturned=99 fails approval AND safety layer',()=>{
  const bad=mutateOracle('POC-002',r=>{r.identifyingFieldsReturned=99;});
  assert.ok(checkOracleApproval(bad,approval,matrix,fixtures).failures.some(f=>f.includes('POC-002.identifyingFieldsReturned')));
  assert.ok(checkSafetyInvariants(bad,matrix).failures.some(f=>f.includes('POC-002.identifyingFieldsReturned must be 0')));
});
test('REV-001 relaxing oracle AND approval together is still caught by hard-coded invariants',()=>{
  const bad=mutateOracle('POC-002',r=>{r.identifyingFieldsReturned=99;});
  const badApproval=mutateApproval('POC-002',c=>{c.fields.identifyingFieldsReturned={value:99};});
  assert.equal(checkOracleApproval(bad,badApproval,matrix,fixtures).ok,true);
  assert.equal(checkSafetyInvariants(bad,matrix).ok,false);
});
test('REV-001 other high-risk relaxations are rejected',()=>{
  const cases=[
    ['POC-008',r=>{r['counts.U']=5;},'approval'],
    ['POC-015',r=>{r.officialVersion=6;},'approval'],
    ['POC-016',r=>{r.attendance='P';},'approval'],
    ['POC-020',r=>{r.currentVersion=6;},'approval'],
    ['POC-001',r=>{r.crossWorkspaceDisclosure=true;},'safety'],
    ['POC-017',r=>{r.silentOverwrite=true;},'safety'],
    ['POC-004',r=>{r.code='OK';},'safety'],
    ['POC-019',r=>{r.code='FORBIDDEN';},'safety'],
    ['POC-029',r=>{r.sensitiveReasonDisclosed=true;},'safety'],
    ['POC-025',r=>{r.remoteVerified=true;},'safety'],
  ];
  for(const [id,fn,layer] of cases){
    const bad=mutateOracle(id,fn);
    const r=layer==='approval'?checkOracleApproval(bad,approval,matrix,fixtures):checkSafetyInvariants(bad,matrix);
    assert.equal(r.ok,false,`${id} relaxation not caught by ${layer}`);
    assert.equal(checkOracleApproval(bad,approval,matrix,fixtures).ok,false,`${id} not caught by approval`);
  }
});
test('REV-001 dropping or adding an expected field is rejected',()=>{
  assert.equal(checkOracleApproval(mutateOracle('POC-002',r=>{delete r.identifyingFieldsReturned;}),approval,matrix,fixtures).ok,false);
  assert.equal(checkOracleApproval(mutateOracle('POC-002',r=>{r.extra=1;}),approval,matrix,fixtures).ok,false);
});
test('REV-001 approval sourceTokens must trace to locked CSV text',()=>{
  const bad=mutateApproval('POC-002',c=>{c.sourceTokens.push('允許回傳個資');});
  assert.ok(checkOracleApproval(oracles,bad,matrix,fixtures).failures.some(f=>f.includes('source token not in CSV')));
});

// ---------- REV-003 ----------
test('REV-003 fixed baseline matches lock and every package file is classified',()=>{
  const r=checkBaselineLock({...lock,mustBeFixed:lock.fixed.map(f=>f.path)},delivery,read,files);
  assert.ok(r.ok,r.failures.join('; '));
  assert.equal(r.fixedCount,10);
});
test('REV-003 a single changed byte in a fixed file fails',()=>{
  const tampered=p=>{const b=read(p);if(p==='contracts/canonical-oracles-v1.0.json'){const c=Buffer.from(b);c[c.length-2]^=1;return c;}return b;};
  assert.ok(checkBaselineLock(lock,delivery,tampered,files).failures.some(f=>f.includes('fixed file changed: contracts/canonical-oracles-v1.0.json')));
});
test('REV-003 removing a fixed entry from the lock, or an unlisted file, fails',()=>{
  const dropped={...lock,fixed:lock.fixed.filter(f=>f.path!=='contracts/canonical-oracles-v1.0.json'),mustBeFixed:['contracts/canonical-oracles-v1.0.json']};
  assert.equal(checkBaselineLock(dropped,delivery,read,files).ok,false);
  assert.ok(checkBaselineLock(lock,delivery,read,()=>[...files(),'contracts/sneaky-override.json']).failures.some(f=>f.includes('unlisted file')));
});

// ---------- REV-002 ----------
const fakeReal=(evidenceValue)=>({mode:'BACKEND_REAL',backend:'firebase',async execute(spec){
  // Disconnected object that merely echoes the expected answer.
  return {canonical:structuredClone(spec.expectedResult),evidence:Object.fromEntries(spec.requiredEvidenceKeys.map(k=>[k,evidenceValue]))};
}});
test('REV-002 disconnected fake claiming BACKEND_REAL never gets PASS',async()=>{
  const r=await executeCase(byId.get('POC-002'),fakeReal('authz-log-ref-0001'),fixtures);
  assert.notEqual(r.status,'PASS');
  assert.equal(r.status,'PENDING_ATTESTATION');
  assert.equal(r.attested,false);
});
test('REV-002 placeholder evidence from a BACKEND_REAL adapter fails',async()=>{
  const r=await executeCase(byId.get('POC-002'),fakeReal('placeholder'),fixtures);
  assert.equal(r.status,'FAIL');
  assert.ok(r.failures.some(f=>f.includes('placeholder')));
});
test('REV-002 toBackendEvidence refuses PASS, empty trace and empty evidence files',async()=>{
  const spec=byId.get('POC-002'),h=createFixtureHash(fixtures);
  const r=await executeCase(spec,fakeReal('authz-log-ref-0001'),fixtures);
  assert.throws(()=>toBackendEvidence(spec,{...r,status:'PASS'},h,{traceId:'t',evidenceFiles:['f']}),/PASS/);
  assert.throws(()=>toBackendEvidence(spec,{...r,attested:true},h,{traceId:'t',evidenceFiles:['f']}),/attested/);
  assert.throws(()=>toBackendEvidence(spec,r,h,{traceId:null,evidenceFiles:['f']}),/traceId/);
  assert.throws(()=>toBackendEvidence(spec,r,h,{traceId:'  ',evidenceFiles:['f']}),/traceId/);
  assert.throws(()=>toBackendEvidence(spec,r,h,{traceId:'t',evidenceFiles:[]}),/evidence file/);
  assert.throws(()=>toBackendEvidence(spec,r,h,{traceId:'t',evidenceFiles:['']}),/evidence file/);
});
test('REV-002 recordable output is schema-valid and explicitly not a pass',async()=>{
  const spec=byId.get('POC-002');
  const r=await executeCase(spec,fakeReal('authz-log-ref-0001'),fixtures);
  const e=toBackendEvidence(spec,r,createFixtureHash(fixtures),{traceId:'trace-0001',evidenceFiles:['redacted/x.json']});
  assert.equal(e.status,'BLOCKED');
  assert.match(e.notes,/PENDING_ATTESTATION/);
  assert.ok(schema.properties.status.enum.includes(e.status));
  assert.ok(schema.required.every(k=>Object.hasOwn(e,k)));
  assert.ok(Object.keys(e).every(k=>Object.hasOwn(schema.properties,k)));
});

// ---------- R2：REV-005 coordinated multi-file tampering (reviewer's POC-017 counterexample) ----------
import {checkP0Pins,P0_PINNED} from '../src/contract-guard.mjs';
import {sha256} from '../src/common.mjs';
test('R2 P0 pins: current oracles equal the 20 literals pinned in code',()=>{
  const r=checkP0Pins(oracles,matrix);assert.ok(r.ok,r.failures.join('; '));
  assert.equal(Object.keys(P0_PINNED).length,20);
});
test('REV-005 POC-017 successes:2/conflicts:0 with oracle+approval+lock+manifest all rewritten still fails',()=>{
  const bad=mutateOracle('POC-017',r=>{r.successes=2;r.conflicts=0;});
  const badApproval=mutateApproval('POC-017',c=>{c.fields.successes={value:2};c.fields.conflicts={value:0};});
  // Rewrite lock and delivery manifest so every in-repo hash comparison is self-consistent.
  const enc=o=>Buffer.from(JSON.stringify(o,null,2)+'\n');
  const tampered={'contracts/canonical-oracles-v1.0.json':enc(bad),'contracts/oracle-approval-v1.0.json':enc(badApproval)};
  const rehash=list=>list.map(f=>tampered[f.path]?{...f,bytes:tampered[f.path].length,sha256:sha256(tampered[f.path])}:f);
  const badLock={...lock,fixed:rehash(lock.fixed)};
  const badDelivery={...delivery,files:rehash(delivery.files)};
  const badRead=p=>tampered[p]??read(p);
  assert.equal(checkOracleApproval(bad,badApproval,matrix,fixtures).ok,true,'approval layer is consistent by construction');
  assert.equal(checkSafetyInvariants(bad,matrix).ok,true,'generic invariants do not cover counts');
  assert.equal(checkBaselineLock({...badLock,mustBeFixed:lock.fixed.map(f=>f.path)},badDelivery,badRead,files).ok,true,'lock is consistent by construction');
  const pins=checkP0Pins(bad,matrix);
  assert.equal(pins.ok,false);
  assert.ok(pins.failures.some(f=>f.startsWith('POC-017')));
});
test('R2 every P0 field relaxation is caught by pins (all 20 cases)',()=>{
  for(const id of Object.keys(P0_PINNED)){
    for(const field of Object.keys(P0_PINNED[id])){
      const bad=mutateOracle(id,r=>{const v=r[field];r[field]=typeof v==='number'?v+1:typeof v==='boolean'?!v:Array.isArray(v)?[]:`${v}_RELAXED`;});
      assert.equal(checkP0Pins(bad,matrix).ok,false,`${id}.${field}`);
    }
  }
});
test('LOW checkBaselineLock reports a missing mutable file instead of throwing',()=>{
  const noRunner=p=>p==='src/runner.mjs'?null:read(p);
  const r=checkBaselineLock(lock,delivery,noRunner,files);
  assert.ok(r.failures.some(f=>f.includes('src/runner.mjs')));
});
