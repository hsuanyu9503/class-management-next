/** attest.yml availability diagnostics (TRUSTED TOOLCHAIN, C-1f; PR #14 R1 non-blocking follow-up).
 *  When the verify job fails (typically: the sealed package could not be downloaded by its ID), a separate job with
 *  only `actions: read` records BOUNDED facts so the cause can be reviewed later:
 *   - this run's artifact listing (id / name / size / digest / expired; at most 100 entries);
 *   - whether the expected ID is listed, and every ID that carries the expected package name;
 *   - the verify job's "##[error]" lines (at most 10 × 300 characters, via errorLines()).
 *  The `hints` are labels for a human reviewer, NOT verdicts: nothing here can change a Verifier result, and no PASS
 *  or signature depends on it. Hosted run 45094456766 showed that a newer same-named artifact can make an older ID
 *  undownloadable for download-artifact (fail closed); SAME_NAME_PRESENT + ID_NOT_FOUND_ERROR is that pattern.
 *  Pure function: no I/O. Unknown inputs stay null (never "listed" / "not listed"). */
import { errorLines, saysIdNotFound } from './attack-suite.mjs';

export const AVAILABILITY_VERSION = 's2-availability-v1';
export const MAX_ARTIFACTS = 100;
const ID = /^[0-9]{1,20}$/;
const TEST_ID = /^POC-[0-9]{3}$/;

/** @param o.testId, o.expectedArtifactId   execute job outputs (validated here)
 *  @param o.listing   { ok: bool, artifacts: [{ id, name, size_in_bytes, digest, expired }], totalCount } | null
 *  @param o.verifyLog { ok: bool, text: string } | null    the verify job's raw log
 *  @param o.runAttempt                       GITHUB_RUN_ATTEMPT */
export function availabilityDiagnostics({ testId, expectedArtifactId, listing, verifyLog, runAttempt } = {}) {
  const tid = TEST_ID.test(testId || '') ? testId : null;
  const eid = ID.test(String(expectedArtifactId ?? '')) ? String(expectedArtifactId) : null;
  const name = tid ? `package-${tid}.tar` : null;
  const listOk = !!listing && listing.ok === true && Array.isArray(listing.artifacts);
  const artifacts = listOk ? listing.artifacts.slice(0, MAX_ARTIFACTS).map((x) => ({
    id: ID.test(String(x?.id ?? '')) ? String(x.id) : null,
    name: typeof x?.name === 'string' ? x.name.slice(0, 200) : null,
    sizeInBytes: Number.isSafeInteger(x?.size_in_bytes) ? x.size_in_bytes : null,
    digest: typeof x?.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(x.digest) ? x.digest : null,
    expired: typeof x?.expired === 'boolean' ? x.expired : null })) : null;
  // the API page can hold fewer entries than the run has: then "not listed" cannot be concluded
  const truncated = listOk ? (listing.artifacts.length > MAX_ARTIFACTS || !Number.isSafeInteger(listing.totalCount) || listing.totalCount > Math.min(listing.artifacts.length, MAX_ARTIFACTS)) : null;
  const sameNamed = artifacts && name ? artifacts.filter((x) => x.name === name).map((x) => x.id) : null;
  const expectedListed = artifacts && eid && !truncated ? artifacts.some((x) => x.id === eid) : null;
  const logOk = !!verifyLog && verifyLog.ok === true && typeof verifyLog.text === 'string';
  const lines = logOk ? errorLines(verifyLog.text) : [];
  const hints = [];
  if (!tid || !eid) hints.push('EXPECTED_OUTPUTS_INVALID');
  if (!listOk) hints.push('LISTING_UNAVAILABLE');
  if (!logOk) hints.push('VERIFY_LOG_UNAVAILABLE');
  if (truncated) hints.push('LISTING_TRUNCATED');
  if (expectedListed === false) hints.push('EXPECTED_ID_NOT_LISTED');
  if (sameNamed && sameNamed.length > 1) hints.push('SAME_NAME_PRESENT');
  if (saysIdNotFound(lines)) hints.push('ID_NOT_FOUND_ERROR');
  return { version: AVAILABILITY_VERSION, unsigned: true, notice: 'UNSIGNED AVAILABILITY DIAGNOSTIC — not evidence, not a verdict.',
    testId: tid, expectedArtifactId: eid, runAttempt: /^[0-9]{1,6}$/.test(String(runAttempt ?? '')) ? String(runAttempt) : null,
    listing: { ok: listOk, truncated, artifacts }, expectedListed, sameNamedArtifactIds: sameNamed,
    verifyLog: { ok: logOk, errorLines: lines }, hints };
}
