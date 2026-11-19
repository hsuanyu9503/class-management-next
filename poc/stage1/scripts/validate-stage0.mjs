#!/usr/bin/env node
/** Stage 0 純靜態校驗，不執行 Firebase / PostgreSQL PoC。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const errors=[];
const passed=[];
function check(name,ok,detail=''){(ok?passed:errors).push({check:name,...(detail?{detail}:{})});}
function read(relative){return fs.readFileSync(path.join(root,relative));}
function hash(data){return crypto.createHash('sha256').update(data).digest('hex');}
function parseCsv(s){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(quoted){if(c==='"'){if(s[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
    else if(c==='"') quoted=true;
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field.replace(/\r$/,''));if(row.some(x=>x!=='')) rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted) throw new Error('Unclosed CSV quoted field');
  if(field!==''||row.length){row.push(field);rows.push(row);}
  const [headers,...values]=rows;
  return values.map((v,i)=>{if(v.length!==headers.length)throw new Error(`CSV row ${i+2} column mismatch (${v.length} != ${headers.length})`);return Object.fromEntries(headers.map((h,k)=>[h,v[k]]));});
}
let dataset,matrix,lock;
try{
  dataset=JSON.parse(read('fixtures/canonical-fixtures-v1.0.json').toString('utf8'));
  matrix=parseCsv(read('contracts/poc-test-matrix-v1.0.csv').toString('utf8').replace(/^\uFEFF/,''));
  lock=JSON.parse(read('contracts/source-lock.json').toString('utf8'));
  check('兩份共用資料與來源鎖定檔可解析',true);
}catch(e){check('共用檔案解析',false,e.message);}
if(matrix&&dataset&&lock){
  for(const f of lock.files){
    try{check(`來源雜湊：${f.path}`,hash(read(f.path))===f.sha256);}catch(e){check(`來源雜湊：${f.path}`,false,e.message);}
  }
  const order=JSON.parse(read('contracts/test-order-v1.0.json').toString('utf8'));
  const evidenceSchema=JSON.parse(read('contracts/evidence-schema-v1.0.json').toString('utf8'));
  const orderedIds=order.groups.flatMap(g=>g.allTestIds);
  check('執行分組涵蓋36項且不重複',orderedIds.length===36 && new Set(orderedIds).size===36 && matrix.every(x=>orderedIds.includes(x.testId)));
  check('每組優先執行P0且不遺漏',order.groups.every(g=>g.runOrder.length===g.allTestIds.length && new Set(g.runOrder).size===g.allTestIds.length && g.runOrder.every(x=>g.allTestIds.includes(x)) && g.runOrder.every((id,i,a)=>i===0 || matrix.find(x=>x.testId===a[i-1]).priority!=='P1' || matrix.find(x=>x.testId===id).priority==='P1')));
  check('後續證據格式包含結果與來源欄位', ['testId','backend','fixtureHash','status','expectedCanonical','actualCanonical','startedAt','finishedAt'].every(x=>evidenceSchema.required.includes(x)));
  const ids=matrix.map(x=>x.testId);
  check('測試案例 36 筆且 ID 不重複',matrix.length===36&&new Set(ids).size===36);
  check('POC-001～036 連續且齊全',Array.from({length:36},(_,i)=>`POC-${String(i+1).padStart(3,'0')}`).every(id=>ids.includes(id)));
  check('P0 20／P1 16',matrix.filter(x=>x.priority==='P0').length===20&&matrix.filter(x=>x.priority==='P1').length===16);
  check('兩候選全部 NOT_RUN',matrix.every(x=>x.firebaseStatus==='NOT_RUN'&&x.postgresStatus==='NOT_RUN'));
  check('所有測試對應有效資料集',matrix.every(x=>x.fixtureSet in dataset.datasets));
  check('所有測試具預期結果、禁止情況與證據',matrix.every(x=>x.expectedCanonical&&x.mustNotHappen&&x.evidenceKeys));
  const a=dataset.datasets['A17-20261117'],sc=dataset.datasets['SC01-20261116'],d=dataset.datasets['SC01-DRAFT-v6'],c=dataset.datasets['SC01-COMMITTED-v6'],m=dataset.datasets['M04-PENDING'],illus=dataset.datasets['L1-ILLUSTRATIVE'];
  check('全部為虛構測資',dataset.metadata.synthetic===true&&dataset.metadata.timeZone==='Asia/Taipei');
  check('A17 固定15名/唯一識別/座號',a.rows.length===15&&a.studentCount===15&&new Set(a.rows.map(x=>x.studentId)).size===15&&new Set(a.rows.map(x=>x.enrollmentId)).size===15&&new Set(a.rows.map(x=>x.seatNo)).size===15);
  const counts={P:0,R:0,N:0,U:0}; for(const r of a.rows){if(r.attendanceStatus in counts)counts[r.attendanceStatus]++;}
  check('A17 P9/R1/N1/U4',Object.entries({P:9,R:1,N:1,U:4}).every(([k,v])=>a.counts[k]===v&&counts[k]===v));
  check('U座號 07/09/13/15',JSON.stringify(a.rows.filter(r=>r.attendanceStatus==='U').map(r=>r.seatNo).sort((x,y)=>x-y))==='[7,9,13,15]');
  check('兩資料集不共享工作空間／學生識別',a.workspaceId!==sc.workspaceId&&!a.rows.some(x=>x.studentId===sc.student.studentId));
  check('SC-01 leave v5 午前、出席 N、來源 issue',sc.date==='2026-11-16'&&sc.leave.leaveRecordId==='LV-007'&&sc.leave.version===5&&sc.leave.coverageSegments[0].dayPart==='AM'&&JSON.stringify(sc.leave.coverageSegments[0].periodRefs)==='[1,2,3,4]'&&sc.attendance.attendanceEntryId==='AT-20261116-07'&&sc.attendance.status==='N'&&sc.issue.issueId==='CR-20261116-001');
  check('草稿與正式版本更正分流',d.mustRemainOfficialVersion===5&&d.issueEvidenceStale===false&&c.hypotheticalOnly===true&&c.targetVersion===6&&c.originalIssueEvidenceStale===true);
  check('M04 未知分母/ L1 統計僅示例',m.attendanceDayDenominator===null&&m.attendancePeriodDenominator===null&&m.officialAttendanceRate===null&&illus.verifiedForOfficialStatistics===false&&illus.cannotMergeWith==='M04-PENDING');
  check('正式命令與收據契約一致',dataset.canonicalCommand.targetId===dataset.canonicalCommittedReceipt.targetId&&dataset.canonicalCommand.expectedVersion===5&&dataset.canonicalCommittedReceipt.currentVersion===6&&dataset.canonicalCommittedReceipt.hypotheticalOnly===true);
}
const report={schemaVersion:'1.0',inspectionScope:'STATIC_FIXTURE_AND_CONTRACT_ONLY',timeUtc:new Date().toISOString(),passedChecks:passed.length,failedChecks:errors.length,checksPassed:passed,checksFailed:errors,backendTestsExecuted:0,firebaseStatus:'NOT_RUN',postgresStatus:'NOT_RUN',technicalSelection:'UNDECIDED',stage0StaticReady:errors.length===0};
if(process.argv.includes('--write')){
 fs.mkdirSync(path.join(root,'reports'),{recursive:true});
 fs.writeFileSync(path.join(root,'reports','stage0-validation-local.json'),JSON.stringify(report,null,2)+'\n');
 console.log('報告已建立：reports/stage0-validation-local.json');
}
console.log(JSON.stringify({stage0StaticReady:report.stage0StaticReady,passedChecks:passed.length,failedChecks:errors.length,checksFailed:errors},null,2));
if(errors.length)process.exitCode=1;
