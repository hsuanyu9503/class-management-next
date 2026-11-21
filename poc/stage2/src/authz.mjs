/** Branch-C authorization for the S2-B2 batch 2 controlled READ API.
 *  Implements docs/stage2/S2B1-AUTHORIZATION.md v0.7 §6.1 (steps 1–3), §6.2 (steps 5–6), §6.4 (read rows),
 *  §5 (preset upper bound) and §12 defaults. Pure logic: all state comes from an injected `store`
 *  that reads AUTHORITATIVE documents on every call (nothing is cached between requests).
 *
 *  Not implemented here (out of scope for batch 2, so the API exposes no such operation):
 *  branch W, C-sens / grants, self-read, receipts, writes. */
import { parseUtcTimestamp, parseLocalDate, localDayOrdinal } from './time-validate.mjs';

export const POLICY_VERSION = 's2b1-v0.7';
/** Time zone used to turn "now" into a calendar date for membership validity. The S2-B1 model stores
 *  membership dates as `YYYY-MM-DD` without a zone; the locked fixtures declare Asia/Taipei
 *  (metadata.timeZone). Recorded as gap G-3 in docs/stage2/S2B2-B2-PLAN.md. */
export const MEMBERSHIP_DATE_TIME_ZONE = 'Asia/Taipei';

/** §4: capabilities usable before D-09. Everything else is treated as not granted. */
export const ENABLED_CAPABILITIES = Object.freeze(new Set([
  'attendance.read', 'attendance.write', 'attendance.revise', 'leave.applicability.read', 'leave.read', 'leave.revise', 'issue.read',
]));
const CLASS_CAPABILITIES = new Set([
  'attendance.read', 'attendance.write', 'attendance.revise', 'leave.applicability.read', 'leave.read', 'leave.revise', 'issue.read',
  'roster.read', 'leave.sensitive.read', 'leave.sensitive.revise', 'stats.read', 'projection.read', 'export.basic', 'archive.revise',
]);
/** §5 preset upper bounds, version s2b1-v1. Unknown preset or version → membership invalid. */
export const PRESETS = Object.freeze({
  's2b1-v1': {
    homeroom_teacher: { scopeType: 'class', caps: ['attendance.read', 'attendance.write', 'attendance.revise', 'leave.read', 'leave.revise', 'leave.applicability.read', 'issue.read', 'roster.read', 'stats.read'] },
    subject_teacher: { scopeType: 'class', caps: ['attendance.read', 'leave.applicability.read', 'roster.read'] },
    workspace_admin: { scopeType: 'workspace', caps: ['membership.manage', 'class.manage', 'calendar.manage', 'audit.read'] },
    projection_display: { scopeType: 'class', caps: ['projection.read'] },
  },
});

/** Read operations exposed in batch 2 (§6.4). `collection` is the collection-group used to resolve the
 *  target; the scope then comes from the document PATH (data model §4), never from the request. */
export const OPERATIONS = Object.freeze({
  'attendanceSession.read': { capability: 'attendance.read', collection: 'attendanceSessions', idField: 'sessionId' },
  'attendanceSummary.read': { capability: 'attendance.read', collection: 'attendanceSessions', idField: 'sessionId' },
  'attendanceEntry.read': { capability: 'attendance.read', collection: 'entries', idField: 'attendanceEntryId' },
  'leaveRecord.read': { capability: 'leave.read', collection: 'leaveRecords', idField: 'leaveRecordId' },
  'trackingIssue.read': { capability: 'issue.read', collection: 'trackingIssues', idField: 'issueId' },
  'leaveApplicability.read': { capability: 'leave.applicability.read', collection: 'leaveRecords', idField: 'leaveRecordId' },
  // roster.read is "未啟用" (D-09): the operation exists only to prove it is refused for everyone.
  'student.read': { capability: 'roster.read', collection: 'students', idField: 'studentId', workspaceLevel: true },
});

const MEMBERSHIP_REQUIRED = ['membershipId', 'version', 'principalId', 'workspaceId', 'scopeType', 'classId', 'rolePreset', 'rolePresetVersion', 'capabilities', 'status', 'validFrom'];
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CLASS_PATH_RE = /^workspaces\/([^/]+)\/classes\/([^/]+)\/(?:.+\/)?([^/]+)\/([^/]+)$/;

const deny = (reasonCode, extra = {}) => ({ decision: 'deny', reasonCode, ...extra });

/** Effective capabilities of ONE membership for (principalId, workspaceId, classId) at `todayOrdinal`.
 *  Returns null when the membership is not valid. */
export function effectiveClassCapabilities(m, { principalId, workspaceId, classId, todayOrdinal }) {
  if (!m || typeof m !== 'object') return null;
  for (const k of MEMBERSHIP_REQUIRED) if (!(k in m) || m[k] === undefined) return null;
  if (m.principalId !== principalId || m.workspaceId !== workspaceId) return null;
  if (m.scopeType !== 'class' || typeof m.classId !== 'string' || m.classId === '' || m.classId !== classId) return null;
  if (m.status !== 'active' || !Number.isSafeInteger(m.version) || !Array.isArray(m.capabilities)) return null;
  const from = parseLocalDate(m.validFrom);
  if (from === null) return null;
  let to = null;
  if (m.validToExclusive !== null && m.validToExclusive !== undefined) { to = parseLocalDate(m.validToExclusive); if (to === null) return null; }
  if (!(from <= todayOrdinal) || (to !== null && !(todayOrdinal < to))) return null;
  const preset = PRESETS[m.rolePresetVersion]?.[m.rolePreset];
  if (!preset || preset.scopeType !== 'class') return null;
  const upper = new Set(preset.caps);
  return m.capabilities.filter((c) => typeof c === 'string' && upper.has(c) && CLASS_CAPABILITIES.has(c) && ENABLED_CAPABILITIES.has(c));
}

/** @param claims verified token claims { authUid, iat } (see api/token.mjs)
 *  @param store  { getBinding(uid), getPrincipal(pid), findTargets(collection, idField, id), listMemberships(wid, pid) }
 *  @returns { decision, reasonCode, principalId?, scope?, resource?, effectiveCapabilities? } */
export async function authorize({ op, claims, target, claimedScope, nowMs, store }) {
  // R1-N5: own keys only — prototype names (toString, __proto__, constructor …) are unknown operations
  const def = typeof op === 'string' && Object.hasOwn(OPERATIONS, op) ? OPERATIONS[op] : null;
  if (!def) return deny('UNKNOWN_OPERATION');
  // §6.1 step 1 — token already verified by the caller; without verified claims nothing proceeds.
  if (!claims || typeof claims.authUid !== 'string' || !Number.isSafeInteger(claims.iat)) return deny('TOKEN_INVALID');
  // §6.1 step 2 — Auth Binding, re-read on every request.
  const b = await store.getBinding(claims.authUid);
  if (!b) return deny('BINDING_NOT_FOUND');
  if (b.authUid !== claims.authUid || typeof b.principalId !== 'string' || !ID_RE.test(b.principalId)) return deny('BINDING_INVALID');
  if (b.status !== 'active') return deny('BINDING_NOT_ACTIVE');
  const activatedAt = parseUtcTimestamp(b.activatedAt);
  if (activatedAt === null) return deny('BINDING_INVALID_TIME');
  if (claims.iat < activatedAt) return deny('TOKEN_BEFORE_BINDING');
  // §6.1 step 2a — Principal.
  const p = await store.getPrincipal(b.principalId);
  if (!p || p.principalId !== b.principalId || p.status !== 'active') return deny('PRINCIPAL_NOT_ACTIVE', { principalId: b.principalId });
  const principalId = b.principalId;
  // Capability not enabled (D-09) → refused for everyone, independent of the target.
  if (!ENABLED_CAPABILITIES.has(def.capability)) return deny('CAPABILITY_NOT_ENABLED', { principalId });
  // §6.1 step 3 — resolve the target from authoritative documents; scope from the PATH.
  const id = target?.[def.idField];
  if (typeof id !== 'string' || !ID_RE.test(id)) return deny('TARGET_INVALID', { principalId });
  if (!claimedScope || typeof claimedScope.workspaceId !== 'string' || typeof claimedScope.classId !== 'string') return deny('SCOPE_CLAIM_MISSING', { principalId });
  const hits = await store.findTargets(def.collection, def.idField, id);
  if (hits.length === 0) return deny('TARGET_NOT_FOUND', { principalId });
  if (hits.length > 1) return deny('SCOPE_INTEGRITY_ERROR', { principalId, detail: 'ambiguous target id' });
  const hit = hits[0];
  const m = CLASS_PATH_RE.exec(hit.path);
  if (!m || m[3] !== def.collection || m[4] !== id) return deny('SCOPE_INTEGRITY_ERROR', { principalId, resource: hit.path });
  const scope = { workspaceId: m[1], classId: m[2] };
  if (hit.data?.workspaceId !== scope.workspaceId || hit.data?.classId !== scope.classId || hit.data?.[def.idField] !== id) {
    return deny('SCOPE_INTEGRITY_ERROR', { principalId, scope, resource: hit.path });
  }
  if (claimedScope.workspaceId !== scope.workspaceId || claimedScope.classId !== scope.classId) return deny('SCOPE_CLAIM_MISMATCH', { principalId, scope, resource: hit.path });
  // §6.2 step 5 — valid class memberships of THIS principal in THIS workspace/class (union).
  const todayOrdinal = localDayOrdinal(nowMs, MEMBERSHIP_DATE_TIME_ZONE);
  const ms = await store.listMemberships(scope.workspaceId, principalId);
  const eff = new Set();
  let anyValid = false;
  for (const mem of ms) {
    const caps = effectiveClassCapabilities(mem, { principalId, workspaceId: scope.workspaceId, classId: scope.classId, todayOrdinal });
    if (caps) { anyValid = true; caps.forEach((c) => eff.add(c)); }
  }
  if (!anyValid) return deny('NO_VALID_MEMBERSHIP', { principalId, scope, resource: hit.path });
  // §6.2 step 6 — capability.
  if (!eff.has(def.capability)) return deny('CAPABILITY_NOT_GRANTED', { principalId, scope, resource: hit.path, effectiveCapabilities: [...eff].sort() });
  return { decision: 'allow', reasonCode: 'OK', principalId, scope, resource: hit.path, target: hit, effectiveCapabilities: [...eff].sort() };
}
