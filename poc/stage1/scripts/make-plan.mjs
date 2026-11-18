#!/usr/bin/env node
/** Produces the same 36-case execution plan for both candidate backends; does not execute them. */
import {writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {loadBaseline,ROOT,createFixtureHash} from '../src/common.mjs';
const {fixtures,oracles,order}=loadBaseline();
const items=new Map(oracles.cases.map(c=>[c.testId,c]));
const ordered=order.groups.flatMap(g=>g.runOrder.map(testId=>({groupId:g.groupId,...items.get(testId)})));
if(ordered.length!==36||ordered.some(x=>!x.testId))throw Error('Invalid Stage0 test ordering');
const execution=[];
for(const backend of ['firebase','postgres']){
  for(const spec of ordered){
    execution.push({backend,testId:spec.testId,priority:spec.priority,fixtureSet:spec.fixtureSet,status:'NOT_RUN',requiredEvidenceKeys:spec.requiredEvidenceKeys,oracleFields:Object.keys(spec.expectedResult)});
  }
}
const plan={schemaVersion:'1.0',scope:'PLANNING_ONLY_NO_BACKEND_EXECUTION',fixtureHash:createFixtureHash(fixtures),caseCount:36,backendRows:execution.length,p0Count:oracles.cases.filter(x=>x.priority==='P0').length,p1Count:oracles.cases.filter(x=>x.priority==='P1').length,firebaseStatus:'NOT_RUN',postgresStatus:'NOT_RUN',execution};
const dest=path.join(ROOT,'artifacts','stage1-72-backend-not-run-plan.json');
mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,JSON.stringify(plan,null,2)+'\n','utf8');
console.log(JSON.stringify({stage1PlanReady:true,caseCount:plan.caseCount,backendRows:plan.backendRows,firebaseStatus:'NOT_RUN',postgresStatus:'NOT_RUN',file:'artifacts/stage1-72-backend-not-run-plan.json'},null,2));
