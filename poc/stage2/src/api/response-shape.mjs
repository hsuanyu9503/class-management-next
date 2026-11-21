/** Response shaping for the controlled read API (S2B2-B2-REV001, REV003).
 *
 *  Every document that contributes to a response is checked BEFORE anything is projected or counted:
 *   - child documents of an authorized parent (session → entries) must carry the parent's scope and ids
 *     and be located exactly where their ids say (data model §4, I-02). Any mismatch or missing field
 *     rejects the WHOLE request with SCOPE_INTEGRITY_ERROR — no partial entries or counts;
 *   - nested arrays (rosterSnapshot, coverageSegments, issue evidence) are validated element by element
 *     and only allow-listed fields are emitted. Extra fields (names, email, notes, nested data) are never
 *     sent; a missing required field or a wrong type rejects the request with DATA_INTEGRITY_ERROR.
 *  Callers turn an IntegrityError into a 403 FORBIDDEN and an auditLog deny with the reason code. */

import { parseLocalDate } from '../time-validate.mjs';

/** S2-B1 DATA-MODEL §3.5: attendanceSessions.kind is `daily`／`period`. */
export const SESSION_KINDS = Object.freeze(new Set(['daily', 'period']));
const ENTRY_PATH_RE = /^workspaces\/[^/]+\/classes\/[^/]+\/attendanceSessions\/([^/]+)\/entries\/([^/]+)$/;

export class IntegrityError extends Error {
  constructor(reasonCode, detail) { super(`${reasonCode}: ${detail}`); this.name = 'IntegrityError'; this.reasonCode = reasonCode; this.detail = detail; }
}
const scopeErr = (d) => new IntegrityError('SCOPE_INTEGRITY_ERROR', d);
const dataErr = (d) => new IntegrityError('DATA_INTEGRITY_ERROR', d);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const STATUSES = new Set(['P', 'R', 'N', 'U']);

/** Projects an object onto `spec` = { field: validator }. Every field is required; extras are dropped. */
function project(o, spec, what) {
  if (!isObj(o)) throw dataErr(`${what} is not an object`);
  const out = {};
  for (const [k, ok] of Object.entries(spec)) {
    if (!(k in o) || !ok(o[k])) throw dataErr(`${what}.${k} missing or invalid`);
    out[k] = o[k];
  }
  return out;
}
function projectArray(a, spec, what) {
  if (!Array.isArray(a)) throw dataErr(`${what} is not an array`);
  return a.map((x, i) => project(x, spec, `${what}[${i}]`));
}

export const ROSTER_ITEM = { enrollmentId: isStr, studentId: isStr, seatNo: (v) => Number.isSafeInteger(v) && v > 0 };
export const COVERAGE_SEGMENT = {
  segmentId: isStr, startLocalDate: isStr, endLocalDateExclusive: isStr, dayPart: isStr, timeZone: isStr,
  periodRefs: (v) => Array.isArray(v) && v.every((p) => Number.isSafeInteger(p) && p > 0),
};
export const ISSUE_EVIDENCE = { sourceType: isStr, sourceId: isStr, sourceVersion: (v) => Number.isSafeInteger(v) && v >= 0 };
export const ENTRY_OUT = { attendanceEntryId: isStr, sessionId: isStr, enrollmentId: isStr, studentId: isStr, status: (v) => STATUSES.has(v), scope: isStr, version: (v) => Number.isSafeInteger(v) && v >= 0 };

/** Validates one entry below an authorized session. `child` = { path, data }. */
export function checkEntry(child, { sessionPath, scope, sessionId }) {
  const d = child?.data;
  if (!isObj(d)) throw dataErr(`entry ${child?.path} has no data`);
  const prefix = `${sessionPath}/entries/`;
  if (typeof child.path !== 'string' || !child.path.startsWith(prefix)) throw scopeErr(`entry outside the authorized session: ${child.path}`);
  const docId = child.path.slice(prefix.length);
  if (docId.includes('/')) throw scopeErr(`entry path too deep: ${child.path}`);
  for (const k of ['workspaceId', 'classId', 'sessionId', 'attendanceEntryId']) if (!isStr(d[k])) throw scopeErr(`entry ${docId} missing ${k}`);
  if (d.workspaceId !== scope.workspaceId) throw scopeErr(`entry ${docId} workspaceId differs from path`);
  if (d.classId !== scope.classId) throw scopeErr(`entry ${docId} classId differs from path`);
  if (d.sessionId !== sessionId) throw scopeErr(`entry ${docId} sessionId differs from parent session`);
  if (d.attendanceEntryId !== docId) throw scopeErr(`entry ${docId} attendanceEntryId differs from document id`);
  return project(d, ENTRY_OUT, `entry ${docId}`);
}

export function countsOf(entries) {
  const c = { P: 0, R: 0, N: 0, U: 0 };
  for (const e of entries) c[e.status] += 1;      // status already validated by ENTRY_OUT
  return { ...c, total: c.P + c.R + c.N + c.U, registered: c.P + c.R + c.N, arrived: c.P + c.R };
}

/** Builds response data for an ALLOWED request. Reads only below the authorized target path.
 *  Returns null only for leaveApplicability (gap G-4). Throws IntegrityError on any inconsistency. */
export async function buildData(op, az, store) {
  const t = az.target; const scope = az.scope;
  const base = { workspaceId: scope.workspaceId, classId: scope.classId };
  switch (op) {
    case 'attendanceSession.read':
    case 'attendanceSummary.read': {
      const ctx = { sessionPath: t.path, scope, sessionId: t.data.sessionId };
      const entries = (await store.listCollection(`${t.path}/entries`)).map((c) => checkEntry(c, ctx));   // all checked before any output
      if (op === 'attendanceSummary.read') return { sessionId: t.data.sessionId, ...base, entryCount: entries.length, counts: countsOf(entries) };
      // R1-N1: session date / kind are validated, never passed through
      if (typeof t.data.date !== 'string' || parseLocalDate(t.data.date) === null) throw dataErr('session.date missing or not a valid YYYY-MM-DD date');
      if (typeof t.data.kind !== 'string' || !SESSION_KINDS.has(t.data.kind)) throw dataErr('session.kind missing or not daily/period');
      const rosterSnapshot = projectArray(t.data.rosterSnapshot, ROSTER_ITEM, 'rosterSnapshot');
      return { sessionId: t.data.sessionId, ...base, date: t.data.date, kind: t.data.kind, rosterSnapshot, entries };
    }
    case 'attendanceEntry.read': {
      // R1-N3: the entry must sit directly under attendanceSessions/{sessionId}/entries/ and carry that sessionId
      const m = ENTRY_PATH_RE.exec(t.path || '');
      if (!m) throw scopeErr(`entry is not under attendanceSessions/{sessionId}/entries: ${t.path}`);
      if (t.data?.sessionId !== m[1]) throw scopeErr(`entry sessionId differs from its path session ${m[1]}`);
      return { ...project(t.data, ENTRY_OUT, 'entry'), ...base };
    }
    case 'leaveRecord.read': {
      const d = t.data;
      const out = project(d, { leaveRecordId: isStr, studentId: isStr, enrollmentId: isStr, leaveTypeId: isStr, recordEffect: isStr, teacherConfirmation: isStr, administrativeApproval: isStr, version: (v) => Number.isSafeInteger(v) && v >= 0 }, 'leaveRecord');
      if ('lastRevisionAt' in d) { if (!isStr(d.lastRevisionAt)) throw dataErr('leaveRecord.lastRevisionAt invalid'); out.lastRevisionAt = d.lastRevisionAt; }
      return { ...out, coverageSegments: projectArray(d.coverageSegments, COVERAGE_SEGMENT, 'coverageSegments'), ...base };
    }
    case 'trackingIssue.read': {
      const d = t.data;
      const out = project(d, { issueId: isStr, progress: isStr, checkConclusion: isStr, question: (v) => typeof v === 'string', evidenceStale: (v) => typeof v === 'boolean' }, 'trackingIssue');
      return { ...out, evidence: projectArray(d.evidence, ISSUE_EVIDENCE, 'evidence'), ...base };
    }
    case 'leaveApplicability.read': return null;   // gap G-4: no trusted period calendar in this batch
    default: throw dataErr(`no response builder for ${op}`);
  }
}
