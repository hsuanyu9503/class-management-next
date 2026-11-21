/** Firebase Adapter CORE — the code under test (adapterCommit). Self-contained: no imports from the
 *  trusted toolchain, so it can run inside the B3 sandbox where only /adapter is visible. Used by the
 *  batch 2 in-process adapter (src/adapter.mjs) and by the sandboxed entry (adapter-b3/main.mjs). */
import { createHash } from 'node:crypto';

/** Same algorithm as Stage 1 stableJson (poc/stage1/src/common.mjs). */
export function stableJson(obj) {
  if (Array.isArray(obj)) return `[${obj.map(stableJson).join(',')}]`;
  if (obj !== null && typeof obj === 'object') return `{${Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + stableJson(obj[k])).join(',')}}`;
  return JSON.stringify(obj);
}
export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');

/** Case definitions: actor + requests. Derived from the locked matrix (precondition / action columns)
 *  and the fixtures; they contain NO expected values. */
export function caseRequests(testId, fixtures) {
  const a = fixtures.datasets['A17-20261117']; const s = fixtures.datasets['SC01-20261116'];
  const A = { workspaceId: a.workspaceId, classId: a.classId }; const S = { workspaceId: s.workspaceId, classId: s.classId };
  const firstA17Entry = `AE-${a.rows[0].enrollmentId}`;
  switch (testId) {
    case 'POC-001': return { actor: 'ACTOR-TEACHER', requests: [{ op: 'attendanceSession.read', target: { sessionId: a.sessionId }, claimedScope: A }] };
    case 'POC-002': return { actor: 'ACTOR-OTHER', requests: [
      { op: 'attendanceEntry.read', target: { attendanceEntryId: firstA17Entry }, claimedScope: A },
      { op: 'student.read', target: { studentId: a.rows[0].studentId }, claimedScope: A },
      { op: 'attendanceEntry.read', target: { attendanceEntryId: 'AE-DOES-NOT-EXIST-0001' }, claimedScope: A },   // existence comparison
    ] };
    case 'POC-008': return { actor: 'ACTOR-TEACHER', requests: [
      { op: 'attendanceSummary.read', target: { sessionId: a.sessionId }, claimedScope: A },
      { op: 'attendanceSession.read', target: { sessionId: a.sessionId }, claimedScope: A },
    ] };
    case 'POC-009': return { actor: 'ACTOR-SC01-TEACHER', requests: [
      { op: 'attendanceEntry.read', target: { attendanceEntryId: s.attendance.attendanceEntryId }, claimedScope: S },
      { op: 'leaveRecord.read', target: { leaveRecordId: s.leave.leaveRecordId }, claimedScope: S },
      { op: 'trackingIssue.read', target: { issueId: s.issue.issueId }, claimedScope: S },
      { op: 'leaveApplicability.read', target: { leaveRecordId: s.leave.leaveRecordId }, claimedScope: S },
      { op: 'attendanceEntry.read', target: { attendanceEntryId: s.attendance.attendanceEntryId }, claimedScope: S },   // re-read after
    ] };
    default: return null;
  }
}

/** The Adapter's own claim (canonical + evidence) built from its API responses. Recorded only as a claim. */
export function claimFrom(testId, res) {
  const ok = (r) => r.body?.code === 'OK';
      switch (testId) {
        case 'POC-001': { const d = res[0].body?.data; const items = d?.entries || [];
          return { canonical: { workspaceId: d?.workspaceId ?? null, returnedCount: items.length, crossWorkspaceDisclosure: items.some((e) => e.workspaceId && e.workspaceId !== d.workspaceId) },
            evidence: { authzDecision: ok(res[0]) ? 'allow' : 'deny', returnedIds: items.map((e) => e.attendanceEntryId), workspaceId: d?.workspaceId ?? null } }; }
        case 'POC-002': { const codes = [...new Set(res.map((r) => r.body?.code))];
          return { canonical: { code: codes.length === 1 ? codes[0] : 'MIXED', identifyingFieldsReturned: res.reduce((n, r) => n + Object.keys(r.body || {}).filter((k) => !['code', 'traceId'].includes(k)).length, 0) },
            evidence: { authzDecision: res.every((r) => r.body?.code === 'FORBIDDEN') ? 'deny' : 'allow', returnedFields: [...new Set(res.flatMap((r) => Object.keys(r.body || {})))].sort().join(','), traceId: res.map((r) => r.body?.traceId).join(',') } }; }
        case 'POC-008': { const c = res[0].body?.data?.counts || {};
          return { canonical: { counts: c }, evidence: { queryCount: res.length, assertions: `adapterApiCalls=${res.length};summaryCode=${res[0].body?.code}` } }; }
        case 'POC-009': { const e0 = res[0].body?.data; const lv = res[1].body?.data; const e1 = res[4].body?.data;
          return { canonical: { attendance: e0?.status ?? null, leaveVersion: lv?.version ?? null, applicability: ok(res[3]) ? 'UNKNOWN_FORMAT' : 'UNKNOWN', pendingPeriods: null, autoRewrite: stableJson(e0) !== stableJson(e1) },
            evidence: { versions: `attendanceEntry=${e0?.version};leaveRecord=${lv?.version}`, coverageResult: `applicabilityResponse=${res[3].body?.code}`, entryHash: e0 ? sha256Hex(stableJson(e0)) : '' } }; }
        default: throw new Error('unreachable');
      }
}
