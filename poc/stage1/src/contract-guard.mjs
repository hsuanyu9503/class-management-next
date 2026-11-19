/** Stage 1 contract guards (REV-001 / REV-003). Pure functions; no network, no backend.
 *
 *  Three independent layers protect canonical-oracles from silent semantic relaxation:
 *   1. checkOracleApproval   – a separate expectation table (contracts/oracle-approval-v1.0.json)
 *                              whose fixture-derived fields are recomputed from locked fixtures and
 *                              whose sourceTokens must appear in the locked CSV row.
 *   2. checkSafetyInvariants – rules hard-coded HERE (not in any JSON) that no expectation may relax.
 *   3. checkBaselineLock     – byte-level SHA-256/size lock of every fixed baseline file.
 *   4. checkP0Pins           – all 20 P0 expectations pinned as literals in this file.
 * Layers 1–4 all live inside the repository; scripts/verify-anchor.mjs compares them with an
 * owner-controlled digest OUTSIDE the PR (REV-005).
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

/** REV-001 R2 / REV-005: P0 expectations pinned IN CODE, one literal per field, each traced to the
 *  locked CSV expectedCanonical text (quoted). Not read from any JSON, so rewriting
 *  canonical-oracles + oracle-approval + lock + manifest together still fails here.
 *  Changing a pin is a code change to a protected file (see scripts/verify-anchor.mjs). */
export const P0_PINNED=Object.freeze({
  'POC-001':{workspaceId:'WS-A17',returnedCount:15,crossWorkspaceDisclosure:false}, // 15筆且僅 WS-A17
  'POC-002':{code:'FORBIDDEN',identifyingFieldsReturned:0},                         // FORBIDDEN／無可識別 payload
  'POC-003':{sensitiveReasonReturned:false,applicabilityAvailable:true},            // 僅可授權的適用提示／假別
  'POC-004':{code:'FORBIDDEN',personalDataDisclosed:false},                         // FORBIDDEN／去識別
  'POC-005':{code:'FORBIDDEN',scopeForgeryAccepted:false},                          // 拒絕不匹配 actor 身份及班級
  'POC-008':{'counts.P':9,'counts.R':1,'counts.N':1,'counts.U':4,'counts.registered':11,'counts.arrived':10,'counts.total':15}, // P9 R1 N1 U4；T15，已登記11，到校10
  'POC-009':{attendance:'N',leaveVersion:5,applicability:'partial',pendingPeriods:[5,6,7],autoRewrite:false}, // 部分適用，下午5–7待核對
  'POC-015':{officialVersion:5,draftCommitted:false,issueEvidenceStale:false},      // 正式仍 v5；issue evidence 不過期
  'POC-016':{officialVersion:6,revisionDelta:1,receiptDelta:1,eventDelta:1,attendance:'N'}, // v6, revision一次, receipt一次, event一次, Attendance N不變
  'POC-017':{successes:1,conflicts:1,silentOverwrite:false},                        // 恰一成功，另一 VERSION_CONFLICT
  'POC-018':{revisionDelta:1,receiptCount:1,uniqueReceiptIds:1},                    // 只一次正式改版與一次 revision，100次同一 receipt
  'POC-019':{code:'OPERATION_REUSE_MISMATCH',revisionDelta:0,receiptLeaked:false},  // OPERATION_REUSE_MISMATCH
  'POC-020':{rolledBack:true,currentVersion:5,revisionDelta:0,receiptDelta:0,eventDelta:0}, // 整筆回滾 current／revision／receipt／event
  'POC-021':{receiptRecovered:true,revisionDelta:1,duplicateCommit:false},          // 取得同一正式結果，不二次執行
  'POC-025':{remoteVerified:false,officialVersion:5,state:'DRAFT_PENDING_RECHECK'}, // 僅草稿／待重驗，不能正式成功
  'POC-026':{durableConfirmedBeforeDisplay:true,serverReceiptAfterReconnect:true,offlineServerVerifiedShown:false}, // 只有證明 durable 才顯示本機已存
  'POC-027':{crossAccountDisclosure:false,unsyncedWarningShown:true,originalAccountRecoverySignaled:true}, // 不同 principal 無法讀取舊快取／Outbox
  'POC-029':{sensitiveReasonDisclosed:false,exportMinimized:true,sourceScopeEnforced:true}, // 資料源端拒絕或裁剪
  'POC-031':{restoreVerified:true,linksIntact:true,integrityHashesMatch:true},      // current/revision/receipt/issue 結構一致；可核驗雜湊
  'POC-035':{code:'FORBIDDEN',serverAuthorityNotBypassed:true},                     // 受控 API/RPC 仍執行明示的 principal+scope 驗證
});

export function checkP0Pins(oracles,matrix){
  const failures=[];
  const p0=matrix.filter(r=>r.priority==='P0').map(r=>r.testId).sort();
  if(!isDeepStrictEqual(p0,Object.keys(P0_PINNED).sort()))failures.push(`P0 set in locked CSV differs from pinned set: ${p0}`);
  for(const [id,pinned] of Object.entries(P0_PINNED)){
    const spec=oracles.cases.find(c=>c.testId===id);
    if(!spec){failures.push(`${id}: missing from oracles`);continue;}
    if(spec.priority!=='P0')failures.push(`${id}: priority changed to ${spec.priority}`);
    if(!isDeepStrictEqual(spec.expectedResult,pinned))failures.push(`${id}: expectedResult ${JSON.stringify(spec.expectedResult)} != pinned ${JSON.stringify(pinned)}`);
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
  for(const p of mutable)if(!read(p))failures.push(`mutable file missing: ${p}`);
  for(const p of listFiles()){
    if(ignored.some(g=>p===g||(g.endsWith('/')&&p.startsWith(g))))continue;
    if(delivered.has(p)){
      if(mutable.has(p)){const b=read(p);if(!b)failures.push(`listed file unreadable: ${p}`);else if(sha256(b)!==delivered.get(p).sha256)modifiedSinceDelivery.push(p);}
      continue;
    }
    if(p==='stage1-file-manifest.json'||fixed.has(p))continue;
    if(!added.has(p))failures.push(`unlisted file in package: ${p}`);
  }
  return {ok:failures.length===0,failures,fixedCount:fixed.size,modifiedSinceDelivery};
}
