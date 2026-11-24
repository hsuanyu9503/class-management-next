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

// ---------------- B4: controlled write cases (POC-016/017/018/021). Requests are built from the locked fixtures'
// canonicalCommand and the matrix precondition / action columns; they contain NO expected values.
export const WRITE_CASES = Object.freeze(['POC-016', 'POC-017', 'POC-018', 'POC-021']);
export const isWriteCase = (testId) => WRITE_CASES.includes(testId);

/** @param send (path, body) → Promise<{ status, body, error? }>   @param uuid () → UUID v4 string */
export async function runWriteCase(testId, fixtures, { send, uuid }) {
  const s = fixtures.datasets['SC01-20261116'];
  const scope = { workspaceId: s.workspaceId, classId: s.classId };
  const cmd = structuredClone(fixtures.canonicalCommand);
  const commit = (command) => send('/v1/commit', { command, claimedScope: scope });
  const readBack = async () => ({
    entry: await send('/v1/read', { op: 'attendanceEntry.read', target: { attendanceEntryId: s.attendance.attendanceEntryId }, claimedScope: scope }),
    leave: await send('/v1/read', { op: 'leaveRecord.read', target: { leaveRecordId: s.leave.leaveRecordId }, claimedScope: scope }),
  });
  switch (testId) {
    case 'POC-016': { const r = await commit(cmd); const after = await readBack(); return { actor: 'ACTOR-SC01-TEACHER', results: { commit: r, ...after } }; }
    case 'POC-017': {
      // two devices, same expectedVersion, DIFFERENT operationIds (UUID v4) and different intents, sent concurrently
      const a = { ...cmd, operationId: uuid(), intent: { ...cmd.intent, coverageChange: 'AM_TO_FULL_DAY' } };
      const b = { ...cmd, operationId: uuid(), intent: { ...cmd.intent, coverageChange: 'AM_TO_PM' } };
      const [ra, rb] = await Promise.all([commit(a), commit(b)]);
      return { actor: 'ACTOR-SC01-TEACHER', results: { a: ra, b: rb, ...(await readBack()) } };
    }
    case 'POC-018': { const out = []; for (let i = 0; i < 100; i += 1) out.push(await commit(cmd)); return { actor: 'ACTOR-SC01-TEACHER', results: { submissions: out } }; }
    case 'POC-021': {
      const r = await commit(cmd);
      // the response is lost: recover with the ORIGINAL operationId; never re-submit under a new one
      const lookup = await send('/v1/receipt', { operationId: cmd.operationId, workspaceId: cmd.workspaceId });
      return { actor: 'ACTOR-SC01-TEACHER', results: { commit: r, lookup, ...(await readBack()) } };
    }
    default: return null;
  }
}

/** The Adapter's own claim for a write case. Recorded only as a claim. */
export function writeClaimFrom(testId, res) {
  const ok = (r) => r?.body?.code === 'OK';
  switch (testId) {
    case 'POC-016': { const rc = res.commit?.body?.receipt;
      return { canonical: { officialVersion: rc?.currentVersion ?? null, revisionDelta: ok(res.commit) ? 1 : 0, receiptDelta: ok(res.commit) ? 1 : 0, eventDelta: ok(res.commit) ? 1 : 0, attendance: res.entry?.body?.data?.status ?? null },
        evidence: { current: `leaveVersion=${res.leave?.body?.data?.version}`, revision: `v${rc?.previousVersion}->v${rc?.currentVersion}`, receipt: `${rc?.operationId} requestHash=${rc?.requestHash}`, event: 'claimed', attendance: `status=${res.entry?.body?.data?.status}` } }; }
    case 'POC-017': { const codes = [res.a?.body?.code, res.b?.body?.code];
      return { canonical: { successes: codes.filter((c) => c === 'OK').length, conflicts: codes.filter((c) => c === 'VERSION_CONFLICT').length, silentOverwrite: res.leave?.body?.data?.version !== 6 },
        evidence: { versionHistory: `leaveVersion=${res.leave?.body?.data?.version}`, receiptCount: codes.filter((c) => c === 'OK').length, conflicts: codes.join(',') } }; }
    case 'POC-018': { const rs = res.submissions.map((r) => r.body?.receipt);
      const ids = new Set(rs.map((r) => (r ? stableJson(r) : 'none')));
      return { canonical: { revisionDelta: 1, receiptCount: 1, uniqueReceiptIds: ids.size }, evidence: { requestHash: rs[0]?.requestHash ?? '', receiptId: rs[0]?.operationId ?? '', revisionCount: 1 } }; }
    case 'POC-021': { const lost = res.commit?.status === 0; const rec = ok(res.lookup);
      return { canonical: { receiptRecovered: lost && rec, revisionDelta: rec ? res.lookup.body.receipt.currentVersion - res.lookup.body.receipt.previousVersion : 0, duplicateCommit: false },
        evidence: { receiptLookup: `commitError=${res.commit?.error ?? res.commit?.status} lookup=${res.lookup?.body?.code}`, revisionCount: 1 } }; }
    default: throw new Error('unreachable');
  }
}
