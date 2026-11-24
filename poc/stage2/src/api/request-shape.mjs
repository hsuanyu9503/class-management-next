import { ID_RE, OPERATIONS, RECEIPT_OPERATION } from '../authz.mjs';
import { CREDENTIAL_PREFIX_RE } from '../mask.mjs';
import { checkCommitShape, COVERAGE_CHANGES, COMMAND_TYPE, TARGET_TYPE, WRITE_OP } from './commit.mjs';

export { checkCommitShape };
export const ROUTES = Object.freeze({ read: '/v1/read', commit: '/v1/commit', receipt: '/v1/receipt' });

const NOT_RECORDED = Object.freeze({ valueRecorded: false });
const ID_FIELDS = new Set(Object.values(OPERATIONS).map((d) => d.idField));
export const traceableId = (v) => (typeof v === 'string' && ID_RE.test(v) && !CREDENTIAL_PREFIX_RE.test(v) ? v : NOT_RECORDED);

/** Request body allow-list (S2B2-B2-REV002): exactly {op, target, claimedScope}; target / claimedScope are
 *  flat objects of strings. Anything else is refused BEFORE authorization (→ FORBIDDEN, §6.6). */
export function checkRequestShape(body) {
  const flat = (o, max) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length <= max && Object.values(o).every((v) => typeof v === 'string');
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  if (!keys.every((k) => ['op', 'target', 'claimedScope'].includes(k))) return false;
  if (typeof body.op !== 'string' || !flat(body.target, 1)) return false;
  if (body.claimedScope !== undefined && (!flat(body.claimedScope, 2) || !Object.keys(body.claimedScope).every((k) => ['workspaceId', 'classId'].includes(k)))) return false;
  return true;
}

/** What the FRONT trace may keep of a request body: the allow-listed fields when the shape is valid,
 *  otherwise only a marker (no values, no key names) — unknown fields can carry anything. */
export function traceableRequestBody(body) {
  if (checkRequestShape(body)) {
    // R1-N2: even a well-shaped body is recorded value by value — only known operation names, known id
    // field names and id-shaped values that do not look like credentials; anything else is a marker.
    const target = {};
    for (const [k, v] of Object.entries(body.target)) { if (ID_FIELDS.has(k)) target[k] = traceableId(v); else target.unknownField = NOT_RECORDED; }
    const out = { op: Object.hasOwn(OPERATIONS, body.op) ? body.op : NOT_RECORDED, target };
    if (body.claimedScope) out.claimedScope = Object.fromEntries(Object.entries(body.claimedScope).map(([k, v]) => [k, traceableId(v)]));
    return out;
  }
  const keys = body !== null && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).length : null;
  return { shapeValid: false, bodyType: Array.isArray(body) ? 'array' : body === null ? 'null' : typeof body, topLevelKeyCount: keys, valuesNotRecorded: true };
}

/** B4 receipt query: exactly { operationId, workspaceId } (strings). The workspace only ADDRESSES the receipt;
 *  owner and class come from the stored receipt (§8). */
export function checkReceiptShape(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 2
    && typeof body.operationId === 'string' && typeof body.workspaceId === 'string';
}

const NR = NOT_RECORDED;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const REASON_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** What the FRONT trace keeps of a commit body: every field the requestHash and the judges need, value by value
 *  and only when it has the expected form (ids via traceableId, enums from the allow-list). A malformed body
 *  is a marker only. The op / target / claimedScope members mirror the read projection so the audit binding
 *  (reconcile) works the same way. */
export function traceableCommitBody(body) {
  if (!checkCommitShape(body)) return traceableRequestBody(body && typeof body === 'object' && !Array.isArray(body) ? { __notAReadBody: true } : body);
  const c = body.command;
  return {
    op: WRITE_OP, target: { leaveRecordId: traceableId(c.targetId) },
    claimedScope: { workspaceId: traceableId(body.claimedScope.workspaceId), classId: traceableId(body.claimedScope.classId) },
    command: {
      schemaVersion: c.schemaVersion === '1.0' ? c.schemaVersion : NR, workspaceId: traceableId(c.workspaceId), operationId: traceableId(c.operationId),
      commandType: c.commandType === COMMAND_TYPE ? c.commandType : NR, targetType: c.targetType === TARGET_TYPE ? c.targetType : NR, targetId: traceableId(c.targetId),
      expectedVersion: Number.isSafeInteger(c.expectedVersion) ? c.expectedVersion : NR,
      intent: { coverageChange: Object.hasOwn(COVERAGE_CHANGES, c.intent.coverageChange) ? c.intent.coverageChange : NR, reasonCode: REASON_RE.test(c.intent.reasonCode) ? c.intent.reasonCode : NR },
      clientCreatedAt: ISO_RE.test(c.clientCreatedAt) ? c.clientCreatedAt : NR,
    },
  };
}
export function traceableReceiptBody(body) {
  if (!checkReceiptShape(body)) return traceableRequestBody(body && typeof body === 'object' && !Array.isArray(body) ? { __notAReadBody: true } : body);
  return { op: RECEIPT_OPERATION, target: { operationId: traceableId(body.operationId) }, claimedScope: { workspaceId: traceableId(body.workspaceId) } };
}
/** Route-aware projection used by the front proxy. Unknown routes: a marker only. */
export function traceableBodyFor(urlPath, body) {
  const p = String(urlPath).split('?')[0];
  if (p === ROUTES.commit) return traceableCommitBody(body);
  if (p === ROUTES.receipt) return traceableReceiptBody(body);
  return traceableRequestBody(body);
}
