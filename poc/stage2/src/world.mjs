/** Batch 2 test world: fictional data from the LOCKED Stage 1 fixtures (read-only), laid out per
 *  docs/stage2/S2B1-DATA-MODEL.md §2–§4 and the fixture→membership mapping of S2B1-ACCESS-MATRIX §5:
 *   - each fixture principal gets ONE class membership with EXACTLY its Stage 1 capabilities
 *     (rolePreset homeroom_teacher@s2b1-v1 as upper bound; validFrom = dataset date, no end);
 *   - ACTOR-OTHER gets a principal and a login, but NO membership;
 *   - both datasets are loaded side by side (different workspaces) so cross-workspace leaks are observable.
 *  Loader-derived identifiers (not in the fixtures) are prefixed and documented in S2B2-B2-PLAN.md §3. */
export const LOADER = 'LOADER-S2B2-B2';
export const PRESET_VERSION = 's2b1-v1';

export function actorMemberships(fixtures) {
  const byWs = { 'WS-A17': fixtures.datasets['A17-20261117'], 'WS-SC01': fixtures.datasets['SC01-20261116'] };
  return fixtures.principals.filter((p) => byWs[p.workspaceId]).map((p) => {
    const d = byWs[p.workspaceId];
    return {
      path: `workspaces/${p.workspaceId}/memberships/MEM-${p.principalId}`,
      data: {
        membershipId: `MEM-${p.principalId}`, version: 1, principalId: p.principalId, workspaceId: p.workspaceId, scopeType: 'class', classId: d.classId,
        rolePreset: 'homeroom_teacher', rolePresetVersion: PRESET_VERSION, capabilities: [...p.capabilities], status: 'active',
        validFrom: d.date, validToExclusive: null, createdBy: LOADER, updatedBy: LOADER,
      },
    };
  });
}

/** Documents that do not depend on Auth UIDs. Returns [{path, data}]. */
export function buildWorld(fixtures) {
  const docs = [];
  const put = (path, data) => docs.push({ path, data });
  const nowIso = '2026-11-01T00:00:00Z';
  for (const p of fixtures.principals) put(`principals/${p.principalId}`, { principalId: p.principalId, status: 'active', createdAt: nowIso, updatedAt: nowIso });
  for (const ws of ['WS-A17', 'WS-SC01', 'WS-FOREIGN']) put(`workspaces/${ws}`, { workspaceId: ws, name: `fictional ${ws}`, status: 'active' });
  for (const m of actorMemberships(fixtures)) put(m.path, m.data);

  const a = fixtures.datasets['A17-20261117'];
  put(`workspaces/${a.workspaceId}/terms/${a.termId}`, { workspaceId: a.workspaceId, termId: a.termId, state: 'active' });
  put(`workspaces/${a.workspaceId}/classes/${a.classId}`, { workspaceId: a.workspaceId, classId: a.classId, termId: a.termId, status: 'active' });
  put(`workspaces/${a.workspaceId}/classes/${a.classId}/attendanceSessions/${a.sessionId}`, {
    workspaceId: a.workspaceId, classId: a.classId, sessionId: a.sessionId, date: a.date, kind: a.kind,
    rosterSnapshot: a.rows.map((r) => ({ enrollmentId: r.enrollmentId, studentId: r.studentId, seatNo: r.seatNo })),
  });
  for (const r of a.rows) {
    put(`workspaces/${a.workspaceId}/students/${r.studentId}`, { workspaceId: a.workspaceId, studentId: r.studentId, displayName: r.displayName, status: 'active' });
    put(`workspaces/${a.workspaceId}/enrollments/${r.enrollmentId}`, { workspaceId: a.workspaceId, classId: a.classId, enrollmentId: r.enrollmentId, studentId: r.studentId, termId: a.termId, seatNo: r.seatNo, validFrom: '2026-09-01', validToExclusive: null, status: 'active' });
    const eid = `AE-${r.enrollmentId}`;   // loader-derived: the A17 fixture has no attendanceEntryId
    put(`workspaces/${a.workspaceId}/classes/${a.classId}/attendanceSessions/${a.sessionId}/entries/${eid}`, {
      workspaceId: a.workspaceId, classId: a.classId, attendanceEntryId: eid, sessionId: a.sessionId, enrollmentId: r.enrollmentId, studentId: r.studentId,
      status: r.attendanceStatus, scope: 'daily', version: 1,
    });
  }

  const s = fixtures.datasets['SC01-20261116'];
  const st = s.student;
  put(`workspaces/${s.workspaceId}/terms/${s.termId}`, { workspaceId: s.workspaceId, termId: s.termId, state: 'active' });
  put(`workspaces/${s.workspaceId}/classes/${s.classId}`, { workspaceId: s.workspaceId, classId: s.classId, termId: s.termId, status: 'active' });
  put(`workspaces/${s.workspaceId}/students/${st.studentId}`, { workspaceId: s.workspaceId, studentId: st.studentId, displayName: st.displayName, status: 'active' });
  put(`workspaces/${s.workspaceId}/enrollments/${st.enrollmentId}`, { workspaceId: s.workspaceId, classId: s.classId, enrollmentId: st.enrollmentId, studentId: st.studentId, termId: s.termId, seatNo: st.seatNo, validFrom: st.validFrom, validToExclusive: st.validTo, status: 'active' });
  const sesPath = `workspaces/${s.workspaceId}/classes/${s.classId}/attendanceSessions/${s.dailySessionId}`;
  // Only student 07 is specified by the fixture; the session snapshot holds only that student.
  put(sesPath, { workspaceId: s.workspaceId, classId: s.classId, sessionId: s.dailySessionId, date: s.date, kind: 'daily', rosterSnapshot: [{ enrollmentId: st.enrollmentId, studentId: st.studentId, seatNo: st.seatNo }] });
  const at = s.attendance;
  put(`${sesPath}/entries/${at.attendanceEntryId}`, { workspaceId: s.workspaceId, classId: s.classId, attendanceEntryId: at.attendanceEntryId, sessionId: s.dailySessionId, enrollmentId: st.enrollmentId, studentId: st.studentId, status: at.status, scope: at.scope, version: at.version, events: at.events });
  const lv = s.leave;
  put(`workspaces/${s.workspaceId}/classes/${s.classId}/leaveRecords/${lv.leaveRecordId}`, { workspaceId: s.workspaceId, classId: s.classId, studentId: st.studentId, enrollmentId: st.enrollmentId, ...lv });
  const is = s.issue;
  put(`workspaces/${s.workspaceId}/classes/${s.classId}/trackingIssues/${is.issueId}`, { workspaceId: s.workspaceId, classId: s.classId, issueId: is.issueId, progress: is.progress, checkConclusion: is.checkConclusion, question: is.question, evidence: is.evidence, evidenceStale: false });
  return docs;
}

export const ACTORS = ['ACTOR-TEACHER', 'ACTOR-SC01-TEACHER', 'ACTOR-OTHER'];
export const fixtureNames = (fixtures) => [...fixtures.datasets['A17-20261117'].rows.map((r) => r.displayName), fixtures.datasets['SC01-20261116'].student.displayName];
