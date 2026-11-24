/** B4 trusted case operations (TRUSTED TOOLCHAIN; REV-21-01). What each write case MUST have executed, taken
 *  from the locked matrix (precondition / action columns) and the locked fixtures (canonicalCommand,
 *  SC01-COMMITTED-v6 = "AM→全天 v6"), and fixed here so the Observer never judges a case by the command the
 *  Adapter happened to send. test/b4-unit.test.mjs proves these values equal the locked fixture file.
 *  The API may legitimately execute other intents (e.g. AM_TO_PM); a CASE is satisfied only by its own operation.
 *  These are case preconditions, not oracle values: officialVersion / deltas stay with the Stage 1 comparator. */
const CMD = Object.freeze({ schemaVersion: '1.0', workspaceId: 'WS-SC01', commandType: 'LeaveRecord.Revise', targetType: 'LeaveRecord', targetId: 'LV-007', expectedVersion: 5 });
const FULL_DAY_INTENT = Object.freeze({ coverageChange: 'AM_TO_FULL_DAY', reasonCode: 'SOURCE_CORRECTION' });
const SCOPE = Object.freeze({ workspaceId: 'WS-SC01', classId: 'CLASS-606-SC01' });
const CURRENT = 'workspaces/WS-SC01/classes/CLASS-606-SC01/leaveRecords/LV-007';
/** canonicalCommand as one operation: the official AM→full-day revision of LV-007 at v5 (operationId fixed by the fixture). */
const CANONICAL = Object.freeze({ command: Object.freeze({ ...CMD, operationId: 'OP-SC01-EXAMPLE-0001', intent: FULL_DAY_INTENT }), claimedScope: SCOPE, currentPath: CURRENT, preVersion: 5, preDayPart: 'AM', postDayPart: 'FULL_DAY' });
export const CASE_OPERATIONS = Object.freeze({
  'POC-016': CANONICAL,
  // two devices, the same target and expectedVersion, DIFFERENT intents: exactly one AM_TO_FULL_DAY and one AM_TO_PM
  // (plan v0.2 §2.1); operationIds are the clients' own UUIDs and are only required to differ
  'POC-017': Object.freeze({ command: CMD, intents: Object.freeze(['AM_TO_FULL_DAY', 'AM_TO_PM']), reasonCode: 'SOURCE_CORRECTION', claimedScope: SCOPE, currentPath: CURRENT, preVersion: 5, preDayPart: 'AM' }),
  'POC-018': CANONICAL,
  'POC-021': CANONICAL,
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** → problems (empty when the recorded request(s) and the pre / post state are exactly this case's operation).
 *  @param commands  [{ command, claimedScope }] as recorded by the FRONT trace (commit requests of the case actor)
 *  @param lv        { path, pre, post } of the resolved target (from the exported state) */
export function checkCaseOperation(testId, { commands, lv }) {
  const spec = Object.hasOwn(CASE_OPERATIONS, testId) ? CASE_OPERATIONS[testId] : null;
  if (!spec) return ['CASE_OPERATION_UNKNOWN'];
  const p = []; const bad = (f) => p.push(`CASE_OPERATION_MISMATCH:${f}`);
  for (const [i, r] of commands.entries()) {
    const c = r?.command;
    if (!isObj(c)) { bad(`command[${i}]`); continue; }
    for (const [k, v] of Object.entries(spec.command)) if (k !== 'intent' && c[k] !== v) bad(`${k}[${i}]`);
    if (spec.command.intent && !(isObj(c.intent) && c.intent.coverageChange === spec.command.intent.coverageChange && c.intent.reasonCode === spec.command.intent.reasonCode)) bad(`intent[${i}]`);
    if (spec.reasonCode && c.intent?.reasonCode !== spec.reasonCode) bad(`intent.reasonCode[${i}]`);
    if (!isObj(r.claimedScope) || r.claimedScope.workspaceId !== spec.claimedScope.workspaceId || r.claimedScope.classId !== spec.claimedScope.classId) bad(`claimedScope[${i}]`);
  }
  if (spec.intents) {
    const got = commands.map((r) => r?.command?.intent?.coverageChange).sort();
    if (JSON.stringify(got) !== JSON.stringify([...spec.intents].sort())) bad('intents');
  }
  if (!lv || lv.path !== spec.currentPath) bad('target');
  else {
    if (lv.pre?.version !== spec.preVersion) bad('preVersion');
    const segs = lv.pre?.coverageSegments;
    if (!(Array.isArray(segs) && segs.length === 1 && segs[0]?.dayPart === spec.preDayPart)) bad('preDayPart');
    if (spec.postDayPart) { const ps = lv.post?.coverageSegments; if (!(Array.isArray(ps) && ps.length === 1 && ps[0]?.dayPart === spec.postDayPart)) bad('postDayPart'); }
  }
  return p;
}
