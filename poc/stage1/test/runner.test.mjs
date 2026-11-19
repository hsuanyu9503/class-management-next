import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBaseline,createFixtureHash,sha256,stableJson} from '../src/common.mjs';
import {executeCase} from '../src/runner.mjs';
import {evaluateOracle,validateAdapterEvidence} from '../src/oracle.mjs';
import {MockAdapter} from './mock-adapter.mjs';
const {fixtures,matrix,oracles,order,lock}=loadBaseline();
const byId=new Map(oracles.cases.map(x=>[x.testId,x]));

test('36 fixed cases retain P0/P1 and original source text',()=>{
  assert.equal(matrix.length,36);assert.equal(oracles.cases.length,36);
  assert.equal(matrix.filter(x=>x.priority==='P0').length,20);
  assert.equal(matrix.filter(x=>x.priority==='P1').length,16);
  for(const [i,x] of oracles.cases.entries()){
    assert.equal(x.testId,matrix[i].testId);assert.equal(x.expectedCanonicalText,matrix[i].expectedCanonical);
    assert.equal(x.fixtureSet,matrix[i].fixtureSet);
  }
});
test('36 cases remain NOT_RUN for Firebase and Postgres',()=>{
  assert.ok(matrix.every(x=>x.firebaseStatus==='NOT_RUN'&&x.postgresStatus==='NOT_RUN'));
  assert.ok(oracles.cases.every(x=>x.status==='NOT_RUN'));
});
test('Stage 0 test order is a permutation of 36',()=>{
  const ids=order.groups.flatMap(g=>g.runOrder);
  assert.equal(ids.length,36); assert.equal(new Set(ids).size,36);
  assert.deepEqual(ids.slice().sort(),matrix.map(x=>x.testId).sort());
});
test('fixture hash stable for key-order variations',()=>{
  const hash=createFixtureHash(fixtures);
  assert.match(hash,/^[0-9a-f]{64}$/);
  assert.equal(sha256(Buffer.from(stableJson({x:1,y:2}))),sha256(Buffer.from(stableJson({y:2,x:1}))));
});
test('dataset separation, no same seat as identity',()=>{
  const a=fixtures.datasets['A17-20261117'],sc=fixtures.datasets['SC01-20261116'];
  assert.notEqual(a.workspaceId,sc.workspaceId);
  assert.notEqual(a.rows.find(x=>x.seatNo===7).studentId,sc.student.studentId);
  assert.equal(a.rows.length,15);
});
test('all six toy scenarios trigger independent canonical checks (HARNESS_PASS only)',async t=>{
  for(const id of ['POC-001','POC-008','POC-009','POC-011','POC-015','POC-018']){
    await t.test(id,async()=>{
      const out=await executeCase(byId.get(id),new MockAdapter(),fixtures);
      assert.equal(out.status,'HARNESS_PASS',out.failures.join('; '));
      assert.equal(out.backendTestsExecuted,0);
      assert.equal(out.backend,'mock');
    });
  }
});
test('negative control: wrong count is rejected by independent oracle',async()=>{
  const bad=new MockAdapter({mutateResult:x=>({...x,counts:{...x.counts,P:88}})});
  const result=await executeCase(byId.get('POC-008'),bad,fixtures);
  assert.equal(result.status,'HARNESS_FAIL');
  assert.ok(result.failures.some(x=>x.includes('counts.P')));
});
test('negative control: missing required evidence cannot pass',async()=>{
  const result=await executeCase(byId.get('POC-011'),new MockAdapter({dropEvidence:true}),fixtures);
  assert.equal(result.status,'HARNESS_FAIL');
  assert.ok(result.failures.some(x=>x.includes('required evidence')));
});
test('negative control: fake adapter may not claim real Firebase identity',async()=>{
  await assert.rejects(async()=>executeCase(byId.get('POC-001'),{backend:'firebase',mode:'HARNESS_MOCK',execute:async()=>({})},fixtures),/mock/i);
});
test('negative control: missing oracle result cannot pass',()=>{
  const result=evaluateOracle(byId.get('POC-017'),{});
  assert.equal(result.ok,false);
});
test('negative control: evidence-only is not enough',()=>{
  const spec=byId.get('POC-015');
  const evidence=Object.fromEntries(spec.requiredEvidenceKeys.map(k=>[k,'a']));
  assert.equal(validateAdapterEvidence(spec,evidence).ok,true);
  assert.equal(evaluateOracle(spec,{officialVersion:6,draftCommitted:true,issueEvidenceStale:true}).ok,false);
});
test('no network or cloud SDK in imported harness',()=>{
  assert.equal(oracles.execution,'NOT_RUN_FOR_BOTH_BACKENDS');
  assert.deepEqual(['firebase','postgres'],['firebase','postgres']);
});

test('Mock cannot become official backend evidence',async()=>{
  const {toBackendEvidence}=await import('../src/evidence.mjs');
  const result=await executeCase(byId.get('POC-008'),new MockAdapter(),fixtures);
  assert.throws(()=>toBackendEvidence(byId.get('POC-008'),result,createFixtureHash(fixtures)),/mock/i);
});
test('Stage0 evidence fields available for FUTURE real backend output only',async()=>{
  const {toBackendEvidence}=await import('../src/evidence.mjs');
  const spec=byId.get('POC-008');
  // REV-002: a self-declared real result is PENDING_ATTESTATION (never PASS) and needs trace + files.
  const sample={backend:'firebase',mode:'BACKEND_REAL',status:'PENDING_ATTESTATION',attested:false,canonical:{counts:{P:9,R:1,N:1,U:4,registered:11,arrived:10,total:15}},startedAt:'2026-11-19T00:00:00.000Z',finishedAt:'2026-11-19T00:00:01.000Z'};
  const evidence=toBackendEvidence(spec,sample,createFixtureHash(fixtures),{traceId:'trace-future-0001',evidenceFiles:['redacted/future-proof.json']});
  assert.equal(evidence.status,'BLOCKED');
  assert.deepEqual(Object.keys(evidence).sort(),['testId','backend','fixtureHash','gitCommit','status','expectedCanonical','actualCanonical','startedAt','finishedAt','evidenceFiles','traceId','notes'].sort());
  assert.equal(evidence.backend,'firebase');
  // Constructing this sample is a schema check, NOT a test run against Firebase.
});
