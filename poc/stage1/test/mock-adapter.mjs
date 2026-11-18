/** In-memory synthetic toy adapter, solely for testing the harness. NEVER counts as a PoC backend. */
export class MockAdapter {
  backend='mock';
  mode='HARNESS_MOCK';
  constructor(options={}){this.options=options;}
  async execute(spec,fixtures){
    const data=fixtures.datasets[spec.fixtureSet];
    if(!data)throw Error('Unknown test fixture');
    let canonical;
    switch(spec.testId){
      case 'POC-001': {
        const rows=data.rows.filter(r=>r.studentId.startsWith('ST-A17-'));
        canonical={workspaceId:data.workspaceId,returnedCount:rows.length,crossWorkspaceDisclosure:false};break;
      }
      case 'POC-008': {
        const counts={P:0,R:0,N:0,U:0};
        for(const r of data.rows){if(!(r.attendanceStatus in counts))throw Error('Unknown attendance state');counts[r.attendanceStatus]++;}
        canonical={counts:{...counts,registered:counts.P+counts.R+counts.N,arrived:counts.P+counts.R,total:data.rows.length}};break;
      }
      case 'POC-009': {
        const covered=data.leave.coverageSegments.flatMap(x=>x.periodRefs);
        const absent=Array.from({length:7},(_,i)=>i+1);
        const unCovered=absent.filter(n=>!covered.includes(n));
        canonical={attendance:data.attendance.status,leaveVersion:data.leave.version,applicability:unCovered.length?'partial':'full',pendingPeriods:unCovered,autoRewrite:false};break;
      }
      case 'POC-011': {
        canonical={rateState:data.officialAttendanceRate===null?'UNKNOWN':'READY',officialRate:data.officialAttendanceRate,officialDayDenominator:data.attendanceDayDenominator,officialPeriodDenominator:data.attendancePeriodDenominator};break;
      }
      case 'POC-015': {
        const official=fixtures.datasets[data.baseDataset];
        canonical={officialVersion:official.leave.version,draftCommitted:false,issueEvidenceStale:data.issueEvidenceStale};break;
      }
      case 'POC-018': {
        // Toy dedup exercise: same operation ID repeatedly resolves to same local receipt.
        const ledger=new Map();let revisions=0;
        for(let i=0;i<100;i++){
          const key=fixtures.canonicalCommand.operationId;
          if(!ledger.has(key)){ledger.set(key,`receipt_${key}`);revisions++;}
        }
        canonical={revisionDelta:revisions,receiptCount:ledger.size,uniqueReceiptIds:new Set([...ledger.values()]).size};break;
      }
      default: throw Error('Toy mock supports only POC-001,008,009,011,015,018');
    }
    if(this.options.mutateResult)canonical=this.options.mutateResult(structuredClone(canonical),spec);
    const evidence=Object.fromEntries(spec.requiredEvidenceKeys.map(k=>[k,`synthetic_mock_${k}`]));
    if(this.options.dropEvidence) delete evidence[spec.requiredEvidenceKeys[0]];
    return {canonical,evidence};
  }
}
