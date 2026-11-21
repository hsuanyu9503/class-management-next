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
  if (checkRequestShape(body)) return { op: body.op, target: { ...body.target }, ...(body.claimedScope ? { claimedScope: { ...body.claimedScope } } : {}) };
  const keys = body !== null && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).length : null;
  return { shapeValid: false, bodyType: Array.isArray(body) ? 'array' : body === null ? 'null' : typeof body, topLevelKeyCount: keys, valuesNotRecorded: true };
}
