/** Observer prototype (S2B2-ATTESTATION §4): computes each case's canonical ONLY from
 *   - the masked FRONT trace (what the API actually answered),
 *   - the masked BACK trace (what the API actually read from the emulator),
 *   - exported emulator state before / after the case (incl. the API's own auditLog records).
 *  It never reads the Adapter's claim and never reads the oracle's expected values; comparison against
 *  the oracle happens later in verdict.mjs. This is a prototype, NOT the trusted Observer of §9.1:
 *  it runs in the same process/user as the Adapter and gives no isolation. */
import { stableJson, sha256Hex } from './stable.mjs';

const AUDIT_RE = /(^|\/)(auditLog|auditLogUnscoped)\/[^/]+$/;
const isAudit = (p) => AUDIT_RE.test(p);
const ALLOWED_DENY_KEYS = new Set(['code', 'traceId']);

export function auditByTrace(state) {
  const m = new Map();
  for (const [p, d] of Object.entries(state)) if (isAudit(p) && typeof d.traceId === 'string') { if (!m.has(d.traceId)) m.set(d.traceId, []); m.get(d.traceId).push({ path: p, ...d }); }
  return m;
}
const findDoc = (state, collection, id) => Object.entries(state).filter(([p]) => p.endsWith(`/${collection}/${id}`));
const wsOf = (p) => (/^workspaces\/([^/]+)\//.exec(p) || [])[1] ?? null;
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };

/** Identifier strings of every non-audit document in `state`, grouped by workspace. */
function identifiersByWorkspace(state) {
  const idKeys = ['studentId', 'enrollmentId', 'attendanceEntryId', 'sessionId', 'leaveRecordId', 'issueId', 'classId'];
  const m = new Map();
  for (const [p, d] of Object.entries(state)) {
    if (isAudit(p)) continue;
    const ws = wsOf(p); if (!ws) continue;
    if (!m.has(ws)) m.set(ws, new Set());
    for (const k of idKeys) if (typeof d[k] === 'string') m.get(ws).add(d[k]);
    m.get(ws).add(p.split('/').pop());
  }
  return m;
}

/** Requests of the case window, each joined with the API's own audit record (same traceId). */
export function joinRequests(front, post) {
  const audits = auditByTrace(post);
  return front.filter((e) => e.role === 'front').map((e) => {
    const a = audits.get(e.traceId) || [];
    return { traceId: e.traceId, op: e.requestBody?.op ?? null, target: e.requestBody?.target ?? null, claimedScope: e.requestBody?.claimedScope ?? null, status: e.status, body: e.responseBody, audit: a.length === 1 ? a[0] : null, auditCount: a.length, claimedAuthUid: e.authorization?.claimedAuthUid ?? null };
  });
}

/** Firestore reads the API performed for one traceId (audit writes and Auth lookups excluded). */
export function backendReads(back, traceId) {
  return back.filter((b) => b.role === 'back' && b.traceId === traceId && !b.path.includes('/identitytoolkit.googleapis.com/')
    && !(b.method === 'PATCH' && AUDIT_RE.test(b.path.replace(/^.*\/documents\//, ''))));
}

function common(reqs, actor, problems) {
  for (const r of reqs) {
    if (r.auditCount !== 1) problems.push(`AUDIT_MISSING_OR_DUPLICATE:${r.traceId}`);
    else if (r.audit.principalId !== null && r.audit.principalId !== actor && r.audit.decision === 'allow') problems.push(`UNEXPECTED_PRINCIPAL:${r.traceId}`);
  }
  const mine = reqs.filter((r) => r.audit?.principalId === actor);
  if (mine.length === 0) problems.push('NO_TRACE_FOR_ACTOR');
  return mine;
}

/** Re-authorization evidence: every request of the actor must have read binding, principal and memberships. */
function reauthorized(back, reqs) {
  return reqs.every((r) => {
    const reads = backendReads(back, r.traceId).map((b) => b.path);
    return reads.some((p) => /\/authBindings\/[^/]+$/.test(p)) && reads.some((p) => /\/principals\/[^/]+$/.test(p))
      && (r.audit?.reasonCode !== 'OK' || reads.some((p) => p.endsWith('/memberships:runQuery') || /\/workspaces\/[^/]+:runQuery$/.test(p)));
  });
}

function unchanged(pre, post) {
  const changed = []; const added = []; const removed = [];
  for (const [p, d] of Object.entries(post)) { if (isAudit(p)) continue; if (!(p in pre)) added.push(p); else if (stableJson(pre[p]) !== stableJson(d)) changed.push(p); }
  for (const p of Object.keys(pre)) if (!isAudit(p) && !(p in post)) removed.push(p);
  return { changed, added, removed, none: !changed.length && !added.length && !removed.length };
}

const OBSERVERS = {
  'POC-001'({ reqs, back, post, actor, problems }) {
    const mine = common(reqs, actor, problems).filter((r) => r.op === 'attendanceSession.read');
    if (mine.length !== 1) { problems.push(`EXPECTED_ONE_SESSION_READ:${mine.length}`); return null; }
    const r = mine[0];
    const items = Array.isArray(r.body?.data?.entries) ? r.body.data.entries : [];
    const returnedIds = items.map((e) => e.attendanceEntryId);
    const located = returnedIds.map((id) => findDoc(post, 'entries', id));
    const wsSet = new Set(located.map((l) => (l.length === 1 ? wsOf(l[0][0]) : 'UNRESOLVED')));
    const sessionDoc = findDoc(post, 'attendanceSessions', r.target?.sessionId);
    const sessionWs = sessionDoc.length === 1 ? wsOf(sessionDoc[0][0]) : null;
    const otherIds = new Set(); for (const [ws, ids] of identifiersByWorkspace(post)) if (ws !== sessionWs) ids.forEach((i) => otherIds.add(i));
    const foreignStrings = strings(r.body).filter((s) => otherIds.has(s));
    const crossWorkspaceDisclosure = wsSet.has('UNRESOLVED') || [...wsSet].some((w) => w !== sessionWs) || foreignStrings.length > 0;
    const expectedEntries = Object.keys(post).filter((p) => sessionDoc.length === 1 && p.startsWith(`${sessionDoc[0][0]}/entries/`)).sort();
    return {
      canonical: { workspaceId: wsSet.size === 1 ? [...wsSet][0] : 'MIXED', returnedCount: items.length, crossWorkspaceDisclosure },
      evidence: { authzDecision: r.audit?.decision ?? null, returnedIds, workspaceId: sessionWs, traceId: r.traceId },
      assertions: {
        auditAllow: r.audit?.decision === 'allow',
        responseMatchesStateSession: stableJson(returnedIds.slice().sort()) === stableJson(expectedEntries.map((p) => p.split('/').pop())),
        noForeignIdentifierStrings: foreignStrings.length === 0,
        reauthorizedFromAuthoritativeDocs: reauthorized(back, [r]),
      },
    };
  },
  'POC-002'({ reqs, back, post, actor, problems }) {
    const mine = common(reqs, actor, problems);
    if (mine.length === 0) return null;
    const allIds = new Set(); for (const [, ids] of identifiersByWorkspace(post)) ids.forEach((i) => allIds.add(i));
    const extraKeys = mine.flatMap((r) => Object.keys(r.body || {}).filter((k) => !ALLOWED_DENY_KEYS.has(k)));
    const idStrings = mine.flatMap((r) => strings(r.body).filter((s) => allIds.has(s)));
    const codes = [...new Set(mine.map((r) => r.body?.code ?? `HTTP_${r.status}`))];
    const existing = mine.filter((r) => r.target && Object.values(r.target).some((id) => typeof id === 'string' && allIds.has(id)));
    const nonexistent = mine.filter((r) => !existing.includes(r));
    const shape = (r) => stableJson({ status: r.status, keys: Object.keys(r.body || {}).sort(), code: r.body?.code });
    return {
      canonical: { code: codes.length === 1 ? codes[0] : `MIXED:${codes.join('|')}`, identifyingFieldsReturned: extraKeys.length + idStrings.length },
      evidence: { authzDecision: [...new Set(mine.map((r) => r.audit?.decision))].join('|'), returnedFields: [...new Set(mine.flatMap((r) => Object.keys(r.body || {})))].sort(), traceId: mine.map((r) => r.traceId).join(',') },
      assertions: {
        allAuditedDeny: mine.every((r) => r.audit?.decision === 'deny'),
        existingTargetsRequested: existing.length > 0,
        nonexistentTargetRequested: nonexistent.length > 0,
        indistinguishableFromNonexistent: existing.length > 0 && nonexistent.length > 0 && new Set([...existing, ...nonexistent].map(shape)).size === 1,
        noDataReadBelowTarget: mine.every((r) => !backendReads(back, r.traceId).some((b) => /\/entries(\?|$)/.test(b.path))),
      },
    };
  },
  'POC-008'({ reqs, back, post, actor, problems }) {
    const mine = common(reqs, actor, problems);
    const sum = mine.filter((r) => r.op === 'attendanceSummary.read'); const ses = mine.filter((r) => r.op === 'attendanceSession.read');
    if (sum.length !== 1 || ses.length !== 1) { problems.push(`EXPECTED_ONE_SUMMARY_AND_ONE_SESSION:${sum.length}/${ses.length}`); return null; }
    const recount = (statuses) => { const c = { P: 0, R: 0, N: 0, U: 0 }; for (const s of statuses) c[s] = (c[s] ?? 0) + 1; return { ...c, total: statuses.length, registered: c.P + c.R + c.N, arrived: c.P + c.R }; };
    const sesDoc = findDoc(post, 'attendanceSessions', sum[0].target?.sessionId);
    const stateStatuses = sesDoc.length === 1 ? Object.entries(post).filter(([p]) => p.startsWith(`${sesDoc[0][0]}/entries/`)).map(([, d]) => d.status) : [];
    const fromState = recount(stateStatuses);
    const fromTrace = recount((ses[0].body?.data?.entries || []).map((e) => e.status));
    const api = sum[0].body?.data?.counts ?? null;
    const reads = backendReads(back, sum[0].traceId);
    const k = ['P', 'R', 'N', 'U', 'total', 'registered', 'arrived'];
    const eqCounts = (x, y) => !!x && !!y && k.every((f) => x[f] === y[f]);
    const assertions = {
      apiSummaryEqualsStateRecount: eqCounts(api, fromState),
      sessionResponseEqualsStateRecount: eqCounts(fromTrace, fromState),
      apiTotalIsSumOfPrimaryStates: !!api && api.total === api.P + api.R + api.N + api.U,
      apiRegisteredIsPRN: !!api && api.registered === api.P + api.R + api.N,
      apiArrivedIsPR: !!api && api.arrived === api.P + api.R,
      primaryStatesOnlyPRNU: stateStatuses.every((s) => ['P', 'R', 'N', 'U'].includes(s)),
      auditAllow: sum[0].audit?.decision === 'allow' && ses[0].audit?.decision === 'allow',
      reauthorizedFromAuthoritativeDocs: reauthorized(back, [...sum, ...ses]),
    };
    return {
      canonical: { counts: api ? Object.fromEntries(k.map((f) => [f, api[f]])) : null },
      evidence: { queryCount: reads.length, assertions: Object.entries(assertions).map(([n, v]) => `${n}=${v}`).join(';'), traceId: sum[0].traceId },
      assertions,
    };
  },
  'POC-009'({ reqs, back, pre, post, actor, problems }) {
    const mine = common(reqs, actor, problems);
    const one = (op) => { const x = mine.filter((r) => r.op === op); if (x.length < 1) problems.push(`MISSING_REQUEST:${op}`); return x[0] ?? null; };
    const en = one('attendanceEntry.read'); const lv = one('leaveRecord.read'); const ap = one('leaveApplicability.read'); const is = one('trackingIssue.read');
    if (!en || !lv || !ap) return null;
    const entId = en.target?.attendanceEntryId; const lvId = lv.target?.leaveRecordId;
    const enPre = findDoc(pre, 'entries', entId)[0]?.[1] ?? null; const enPost = findDoc(post, 'entries', entId)[0]?.[1] ?? null;
    const lvPre = findDoc(pre, 'leaveRecords', lvId)[0]?.[1] ?? null; const lvPost = findDoc(post, 'leaveRecords', lvId)[0]?.[1] ?? null;
    const diff = unchanged(pre, post);
    const respEntry = en.body?.data ?? null; const respLeave = lv.body?.data ?? null;
    const canonical = {
      attendance: respEntry?.status ?? null,
      leaveVersion: respLeave?.version ?? null,
      autoRewrite: !diff.none,
      // applicability / pendingPeriods are NOT observable in this batch: the applicability read is refused
      // for the fixture actor (gap G-1) and no trusted period calendar exists (gap G-4). Left absent.
    };
    const assertions = {
      entryResponseMatchesState: !!respEntry && !!enPost && respEntry.status === enPost.status && respEntry.version === enPost.version,
      leaveResponseMatchesState: !!respLeave && !!lvPost && respLeave.version === lvPost.version && stableJson(respLeave.coverageSegments) === stableJson(lvPost.coverageSegments),
      entryUnchangedPrePost: !!enPre && stableJson(enPre) === stableJson(enPost),
      leaveUnchangedPrePost: !!lvPre && stableJson(lvPre) === stableJson(lvPost),
      noNonAuditDocumentAddedOrRemoved: diff.added.length === 0 && diff.removed.length === 0,
      applicabilityRequestRefused: ap.body?.code === 'FORBIDDEN' && ap.audit?.reasonCode === 'CAPABILITY_NOT_GRANTED',
      issueReadAllowed: !!is && is.body?.code === 'OK',
      reauthorizedFromAuthoritativeDocs: reauthorized(back, mine),
    };
    return {
      canonical,
      evidence: {
        versions: { attendanceEntry: { pre: enPre?.version ?? null, response: respEntry?.version ?? null, post: enPost?.version ?? null }, leaveRecord: { pre: lvPre?.version ?? null, response: respLeave?.version ?? null, post: lvPost?.version ?? null } },
        coverageResult: { applicabilityResponse: ap.body?.code ?? null, applicabilityAuditReason: ap.audit?.reasonCode ?? null, coverageSegments: respLeave?.coverageSegments ?? null, issueQuestionPresent: typeof is?.body?.data?.question === 'string' },
        entryHash: enPost ? sha256Hex(stableJson(enPost)) : null,
        responseEntryHash: respEntry ? sha256Hex(stableJson(respEntry)) : null,
        stateDiff: diff,
      },
      assertions,
    };
  },
};

/** @returns { canonical, evidence, assertions, problems } — canonical null when not computable. */
export function observe({ testId, actor, front, back, pre, post }) {
  const problems = [];
  const fn = OBSERVERS[testId];
  if (!fn) return { canonical: null, evidence: null, assertions: {}, problems: [`NO_OBSERVER:${testId}`] };
  if (!Array.isArray(front) || front.length === 0) return { canonical: null, evidence: null, assertions: {}, problems: ['NO_TRACE'] };
  const reqs = joinRequests(front, post);
  const out = fn({ reqs, back, pre, post, actor, problems }) || { canonical: null, evidence: null, assertions: {} };
  for (const [n, v] of Object.entries(out.assertions || {})) if (v !== true) problems.push(`ASSERTION_FAILED:${n}`);
  return { ...out, problems };
}
