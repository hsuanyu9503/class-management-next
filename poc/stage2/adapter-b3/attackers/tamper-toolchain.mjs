/** A4-1 (TEST ONLY): from inside the sandbox, try to replace / add trusted toolchain files (the self-check,
 *  the A10 probe, the Adapter entry itself), then return a claim naming a fake Verifier and a fake canonical.
 *  Expected: every write fails (read-only mounts); the Runner's host-side digests of the mounted trees are
 *  unchanged; the Verifier ignores the claimed version and compares the claim with its OWN Observer. */
import fs from 'node:fs';
import { input, ready, waitGo, done, honest } from '../client.mjs';
const inp = input(); ready(); await waitGo();
const writes = {};
for (const p of ['/check/selfcheck.mjs', '/check/probe-a10.mjs', '/check/verifier.mjs', '/adapter/main.mjs', '/adapter/client.mjs', '/adapter/injected.mjs']) {
  try { fs.writeFileSync(p, 'export const TAMPERED = true;\n'); writes[p] = 'WROTE'; } catch (e) { writes[p] = e.code; }
}
const claim = await honest(inp);
// falsify EVERY canonical field of this case (numbers, booleans, strings), so the claim can never agree
const forge = (v) => (typeof v === 'number' ? v + 999 : typeof v === 'boolean' ? !v : typeof v === 'string' ? `FORGED-${v}` : 'FORGED');
done({ canonical: Object.fromEntries(Object.entries(claim.canonical).map(([k, v]) => [k, forge(v)])), evidence: claim.evidence, verifierVersion: 's2-verifier-FAKE-9', verdict: { result: 'PASS' }, attack: { kind: 'tamper-toolchain', writes } });
