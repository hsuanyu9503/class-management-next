/** attest.yml VERIFY job logic (TRUSTED TOOLCHAIN, B3b). Plan v0.3 §3.1, §3.4, §4.5, §7.2. Pure function over
 *  injected I/O so it is unit-testable; scripts/attest-verify.mjs is the thin CLI.
 *  Every trusted input comes from the verify job itself or the execute job's outputs — never from the package:
 *   - runId / runAttempt          : this workflow run (GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT)
 *   - package / manifest digests, nonce, platformSupported, artifactId : execute job outputs
 *   - trustedToolchainCommit      : the commit this job checked out (and the execute job reports the same)
 *   - runnerKind                  : this job's own runner environment
 *   - trust root                  : S2B2-TRUST-POLICY.json from the CURRENTLY ANCHORED main (§4.5), the owner's
 *                                   variables, and the blob of attest.yml in the commit whose workflow ran
 *  A14: the downloaded artifact must be exactly ONE regular file named package-<testId>.tar. */
import { createHash } from 'node:crypto';
import { verifyPackage } from './verifier.mjs';
import { evaluateTrust } from './trust-policy.mjs';
import { stableJson } from '../stable.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
export const DELIVERY_VERSION = 's2-delivery-v1';
const CASES = new Set(['POC-001', 'POC-002', 'POC-008', 'POC-009']);

/** @param io { env, listDownload(): [{name, isFile}], readDownload(name): Buffer, head: string,
 *              policy: { text, commit, anchorDigest } | null, workflowBlob: string|null, caseSpecs: {testId: spec}, now(): Date } */
export function runVerifyJob(io) {
  const { env } = io; const now = io.now ? io.now() : new Date();
  const fail = (code, detail) => ({ result: 'BLOCKED', reasons: [code], detail, statement: null });
  const testId = env.EXP_TEST_ID;
  const selection = { artifactId: env.EXP_ARTIFACT_ID || null, expectedFile: `package-${testId}.tar`, entries: [] };
  let verdict;
  const entries = io.listDownload(); selection.entries = entries.map((e) => e.name).sort();
  if (!CASES.has(testId)) verdict = fail('TRUSTED_INPUT_MISSING', 'testId');
  else if (!/^[0-9]{1,20}$/.test(env.EXP_ARTIFACT_ID || '')) verdict = fail('ARTIFACT_SELECTION_MISMATCH', 'artifact id');
  else if (entries.length !== 1 || entries[0].name !== selection.expectedFile || entries[0].isFile !== true) verdict = fail('ARTIFACT_SELECTION_MISMATCH', 'download set');
  else if (env.EXP_TOOLCHAIN_COMMIT !== io.head) verdict = fail('TOOLCHAIN_COMMIT_MISMATCH', 'execute job ran another commit');
  // anchored-main policy (§4.5): its protected-file digest must equal the owner's CMN_STAGE1_ANCHOR_SHA256
  const anchorVar = String(env.CMN_STAGE1_ANCHOR_SHA256 || '').trim().toLowerCase();
  const policyAnchored = !!io.policy && !!anchorVar && io.policy.anchorDigest === anchorVar;
  const trust = evaluateTrust({ policyText: policyAnchored ? io.policy.text : '', toolchainVar: env.CMN_S2_TRUSTED_TOOLCHAIN_SHA, signingPolicyVar: env.CMN_S2_SIGNING_POLICY_BLOB,
    toolchainCommit: io.head, workflowBlob: io.workflowBlob, nowMs: now.getTime() });
  if (!policyAnchored) trust.reasons.unshift('TRUST_POLICY_NOT_ANCHORED');
  trust.configured = trust.configured && policyAnchored;
  const hosted = env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted';
  if (!verdict) {
    const bytes = io.readDownload(selection.expectedFile);
    const platformSupported = env.EXP_PLATFORM_SUPPORTED === 'true' ? true : env.EXP_PLATFORM_SUPPORTED === 'false' ? false : undefined;
    const trusted = {
      packageSha256: env.EXP_PACKAGE_SHA256, manifestSha256: env.EXP_MANIFEST_SHA256, runId: env.GITHUB_RUN_ID,
      runAttempt: /^[0-9]{1,6}$/.test(env.GITHUB_RUN_ATTEMPT || '') ? Number(env.GITHUB_RUN_ATTEMPT) : undefined,
      attestationNonce: env.EXP_ATTESTATION_NONCE, testId, trustedToolchainCommit: io.head, adapterCommit: io.head,
      caseSpec: Object.hasOwn(io.caseSpecs, testId) ? io.caseSpecs[testId] : undefined,
      runnerKind: hosted ? 'github-hosted' : 'local-untrusted', platformSupported, trustRoot: trust,
    };
    verdict = verifyPackage(bytes, trusted);
  }
  const statementText = verdict.statement ? stableJson(verdict.statement) : null;
  const statementSha256 = statementText ? sha(statementText) : null;
  const delivery = {
    deliveryVersion: DELIVERY_VERSION, testId: testId ?? null, runId: env.GITHUB_RUN_ID ?? null, runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    result: verdict.result, statementSha256,
    signing: verdict.result === 'PASS' ? 'PENDING' : 'NOT_ATTEMPTED_NOT_PASS',
    note: 'Delivery record only — NOT evidence. Signing status is proven only by an actual Sigstore bundle.',
  };
  const report = {
    verifierVersion: verdict.verifierVersion ?? null, result: verdict.result, reasons: verdict.reasons, detail: verdict.detail ?? null,
    reconciliation: verdict.reconciliation ?? null, observedCanonical: verdict.observedCanonical ?? null, contract: verdict.contract ?? null,
    selection, runnerKind: hosted ? 'github-hosted' : 'local-untrusted', toolchainCommit: io.head,
    trust: { ...trust, policySource: io.policy ? { commit: io.policy.commit, sha256: sha(io.policy.text), anchorDigest: io.policy.anchorDigest, anchoredByOwnerVariable: policyAnchored } : null, workflowBlob: io.workflowBlob, fetchedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z') },
    unsigned: true, notice: 'UNSIGNED DIAGNOSTIC — not an attestation.',
  };
  return { result: verdict.result, statementText, statementSha256, report, delivery };
}
