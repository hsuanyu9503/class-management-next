/** Firebase Adapter for the Stage 1 runner interface (poc/stage1/src/runner.mjs, unchanged):
 *    { mode: 'BACKEND_REAL', backend: 'firebase', execute(caseSpec, fixtures) → { canonical, evidence } }
 *  It drives the controlled API through the FRONT trace proxy using real Auth Emulator tokens of the
 *  case actor. It receives no owner access and no emulator address. Its `canonical` is recorded only as
 *  the ADAPTER'S CLAIM; the Stage 2 verdict uses the Observer instead (S2B2-ATTESTATION §4). */
import { caseRequests, claimFrom } from '../adapter-b3/core.mjs';
export { caseRequests } from '../adapter-b3/core.mjs';

export function createFirebaseAdapter({ frontOrigin, tokens }) {
  async function call(token, req) {
    const r = await fetch(`${frontOrigin}/v1/read`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(req), redirect: 'error', signal: AbortSignal.timeout(10000) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  return {
    mode: 'BACKEND_REAL', backend: 'firebase',
    async execute(caseSpec, fixtures) {
      const plan = caseRequests(caseSpec.testId, fixtures);
      if (!plan) throw new Error(`no adapter plan for ${caseSpec.testId}`);
      const token = tokens[plan.actor];
      const res = []; for (const q of plan.requests) res.push(await call(token, q));
      return claimFrom(caseSpec.testId, res);
    },
  };
}
