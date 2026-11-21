/** Stage 2 verdict for one case. Uses the locked Stage 1 comparator (evaluateOracle /
 *  validateAdapterEvidence, imported read-only) on the OBSERVER's canonical — never the Adapter's.
 *  Possible stage2Status values: UNATTESTED (executed; contract match recorded separately), BLOCKED,
 *  ERROR. There is no PASS: no Verifier, trust root (D-17) or §9 isolation exists in this batch. */
import { evaluateOracle, validateAdapterEvidence } from '../../stage1/src/oracle.mjs';
import { stableJson } from './stable.mjs';

/** Fields of a case that cannot be observed in this batch, with the reason (see S2B2-B2-PLAN §3). */
export const BLOCKED_FIELDS = Object.freeze({
  'POC-009': { fields: ['applicability', 'pendingPeriods'], reason: 'G-1: leave-applicability read needs leave.applicability.read, which ACTOR-SC01-TEACHER does not hold in the locked fixtures; G-4: no trusted period calendar for WS-SC01 2026-11-16 to derive periods 5–7' },
});

export function verdict({ caseSpec, observation, adapterOutput, stage1Result, inputDigestsVerified }) {
  const blocked = Object.hasOwn(BLOCKED_FIELDS, caseSpec.testId) ? BLOCKED_FIELDS[caseSpec.testId] : null;
  const problems = [...(observation?.problems || [])];
  if (inputDigestsVerified !== true) problems.push('INPUT_DIGEST_MISMATCH');
  const canonical = observation?.canonical ?? null;
  const oracle = canonical ? evaluateOracle(caseSpec, canonical) : { ok: false, failures: ['observer canonical missing'] };
  const evidence = observation?.evidence ? validateAdapterEvidence(caseSpec, observation.evidence, { rejectPlaceholders: true }) : { ok: false, failures: ['observer evidence missing'] };
  const blockedFailures = blocked ? oracle.failures.filter((f) => blocked.fields.some((b) => f.startsWith(`${b}:`))) : [];
  const otherFailures = oracle.failures.filter((f) => !blockedFailures.includes(f));
  const claimFields = Object.keys(caseSpec.expectedResult);
  const pickPath = (o, k) => k.split('.').reduce((v, p) => (v && typeof v === 'object' ? v[p] : undefined), o);
  const claimMismatches = canonical && adapterOutput?.canonical ? claimFields.filter((k) => stableJson(pickPath(adapterOutput.canonical, k) ?? null) !== stableJson(pickPath(canonical, k) ?? null)) : claimFields;
  let contractMatch;
  if (!canonical || problems.length || !evidence.ok) contractMatch = 'MISMATCH_OR_UNOBSERVABLE';
  else if (otherFailures.length) contractMatch = 'MISMATCH';
  else if (blockedFailures.length) contractMatch = 'PARTIAL_MATCH_REST_BLOCKED';
  else contractMatch = 'MATCH';
  return {
    testId: caseSpec.testId,
    stage2Status: blocked ? 'BLOCKED' : (canonical ? 'UNATTESTED' : 'ERROR'),
    attested: false,
    contractMatch,
    observedCanonical: canonical,
    oracleFailures: otherFailures,
    blockedFields: blocked ? { ...blocked, failures: blockedFailures } : null,
    evidenceFailures: evidence.failures,
    problems,
    adapterClaimAgreesWithObserver: claimMismatches.length === 0,
    adapterClaimMismatchFields: claimMismatches,
    stage1Runner: stage1Result ? { status: stage1Result.status, attested: stage1Result.attested, failures: stage1Result.failures } : null,
    note: 'Not a PoC PASS. Executed on the local emulator without §9 isolation, Verifier or trust root (D-17).',
  };
}
