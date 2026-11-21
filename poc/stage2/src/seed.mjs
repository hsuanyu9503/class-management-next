/** Builds a small, fictional seed for the infrastructure smoke from the LOCKED Stage 1 fixtures.
 *  Reads poc/stage1/fixtures read-only. Paths follow docs/stage2/S2B1-DATA-MODEL.md §2/§4
 *  (path is authoritative; workspaceId/classId fields equal the path). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const STAGE1_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../stage1');
export function loadFixtures() {
  const bytes = readFileSync(path.join(STAGE1_ROOT, 'fixtures/canonical-fixtures-v1.0.json'));
  return { fixtures: JSON.parse(bytes.toString('utf8')), fileSha256: createHash('sha256').update(bytes).digest('hex') };
}

export function buildA17Seed(fixtures) {
  const a = fixtures.datasets['A17-20261117'];
  const ws = a.workspaceId, cls = a.classId, sid = a.sessionId;
  const docs = [];
  docs.push([`workspaces/${ws}/classes/${cls}`, { workspaceId: ws, classId: cls, termId: a.termId, status: 'active' }]);
  docs.push([`workspaces/${ws}/classes/${cls}/attendanceSessions/${sid}`, {
    workspaceId: ws, classId: cls, sessionId: sid, date: a.date, kind: a.kind,
    rosterSnapshot: a.rows.map((r) => ({ enrollmentId: r.enrollmentId, studentId: r.studentId, seatNo: r.seatNo })),
  }]);
  for (const r of a.rows) {
    docs.push([`workspaces/${ws}/students/${r.studentId}`, { workspaceId: ws, studentId: r.studentId, displayName: r.displayName, status: 'active' }]);
    docs.push([`workspaces/${ws}/enrollments/${r.enrollmentId}`, { workspaceId: ws, classId: cls, enrollmentId: r.enrollmentId, studentId: r.studentId, termId: a.termId, seatNo: r.seatNo, validFrom: '2026-09-01', validToExclusive: null, status: 'active' }]);
    // Infra-smoke-derived entry id (the A17 fixture has no attendanceEntryId); not a contract identifier.
    const eid = `AE-SMOKE-${r.enrollmentId}`;
    docs.push([`workspaces/${ws}/classes/${cls}/attendanceSessions/${sid}/entries/${eid}`, {
      workspaceId: ws, classId: cls, attendanceEntryId: eid, sessionId: sid, enrollmentId: r.enrollmentId, studentId: r.studentId, status: r.attendanceStatus, scope: 'daily', version: 1,
    }]);
  }
  return { workspaceId: ws, classId: cls, sessionId: sid, expectedEntries: a.rows.length, expectedCounts: { ...a.counts }, docs };
}
