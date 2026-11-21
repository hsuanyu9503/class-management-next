/** Adapter case input (TRUSTED TOOLCHAIN, B3a). B3A-N8: the Adapter receives ONLY the ID token of the case's
 *  actor, taken from the trusted case → actor table — never the tokens of other actors. */
export function buildCaseInput({ testId, fixtures, users, attackHints = null, caseActors }) {
  const actor = typeof testId === 'string' && Object.hasOwn(caseActors, testId) ? caseActors[testId] : null;
  const token = actor && Object.hasOwn(users, actor) ? users[actor]?.token : null;
  if (!actor || typeof token !== 'string' || !token) throw new Error(`no trusted actor/token for ${testId}`);
  return { testId, fixtures, tokens: { [actor]: token }, attackHints };
}
