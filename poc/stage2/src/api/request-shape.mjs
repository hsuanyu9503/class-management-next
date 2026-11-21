import { ID_RE, OPERATIONS } from '../authz.mjs';
import { CREDENTIAL_PREFIX_RE } from '../mask.mjs';

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
