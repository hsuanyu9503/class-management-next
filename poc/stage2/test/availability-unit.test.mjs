/** C-1f attest.yml availability diagnostics (pure; no network). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { availabilityDiagnostics, MAX_ARTIFACTS } from '../src/b3/availability.mjs';

const ID_NOT_FOUND = '2026-11-23T01:26:43.1435013Z ##[error]Unable to download artifact(s): None of the provided artifact IDs were found';
const art = (id, name, o = {}) => ({ id: Number(id), name, size_in_bytes: 87552, digest: `sha256:${'a'.repeat(64)}`, expired: false, ...o });
const base = (o = {}) => ({ testId: 'POC-001', expectedArtifactId: '1001', runAttempt: '1',
  listing: { ok: true, artifacts: [art(1001, 'package-POC-001.tar'), art(1002, 's2-verify-POC-001')], totalCount: 2 },
  verifyLog: { ok: true, text: `x\n${ID_NOT_FOUND}\ny` }, ...o });

test('availability: the hosted shadowing pattern (two same-named IDs + ID-not-found) is labelled, not judged', () => {
  const d = availabilityDiagnostics(base({ listing: { ok: true, artifacts: [art(1001, 'package-POC-001.tar'), art(1004, 'package-POC-001.tar')], totalCount: 2 } }));
  assert.deepEqual(d.sameNamedArtifactIds, ['1001', '1004']); assert.equal(d.expectedListed, true);
  assert.deepEqual(d.hints, ['SAME_NAME_PRESENT', 'ID_NOT_FOUND_ERROR']);
  assert.equal(d.verifyLog.errorLines.length, 1); assert.doesNotMatch(d.verifyLog.errorLines[0], /^2026-/);   // timestamp stripped
  assert.equal(d.unsigned, true); assert.ok(!('result' in d) && !('verdict' in d));                           // never a verdict
});
test('availability: one artifact, error present → only ID_NOT_FOUND_ERROR; expected ID missing → EXPECTED_ID_NOT_LISTED', () => {
  assert.deepEqual(availabilityDiagnostics(base()).hints, ['ID_NOT_FOUND_ERROR']);
  const gone = availabilityDiagnostics(base({ listing: { ok: true, artifacts: [art(1002, 's2-verify-POC-001')], totalCount: 1 } }));
  assert.equal(gone.expectedListed, false); assert.ok(gone.hints.includes('EXPECTED_ID_NOT_LISTED'));
});
test('availability: unknown stays unknown — no listing, no log, truncated page, invalid outputs', () => {
  const none = availabilityDiagnostics(base({ listing: null, verifyLog: null }));
  assert.equal(none.expectedListed, null); assert.equal(none.sameNamedArtifactIds, null); assert.deepEqual(none.hints, ['LISTING_UNAVAILABLE', 'VERIFY_LOG_UNAVAILABLE']);
  // the run has more artifacts than the page: "not listed" must NOT be concluded
  const trunc = availabilityDiagnostics(base({ listing: { ok: true, artifacts: [art(1002, 'x')], totalCount: 150 } }));
  assert.equal(trunc.listing.truncated, true); assert.equal(trunc.expectedListed, null); assert.ok(trunc.hints.includes('LISTING_TRUNCATED')); assert.ok(!trunc.hints.includes('EXPECTED_ID_NOT_LISTED'));
  const noTotal = availabilityDiagnostics(base({ listing: { ok: true, artifacts: [art(1002, 'x')] } }));
  assert.equal(noTotal.expectedListed, null);
  const bad = availabilityDiagnostics(base({ testId: 'POC-001;rm', expectedArtifactId: '12a' }));
  assert.equal(bad.testId, null); assert.equal(bad.expectedArtifactId, null); assert.ok(bad.hints.includes('EXPECTED_OUTPUTS_INVALID')); assert.equal(bad.expectedListed, null);
});
test('availability: bounded — at most MAX_ARTIFACTS entries, 10 error lines of 300 chars, malformed fields become null', () => {
  const many = Array.from({ length: MAX_ARTIFACTS + 20 }, (_, i) => art(2000 + i, `n${i}`));
  const d = availabilityDiagnostics(base({ listing: { ok: true, artifacts: many, totalCount: many.length } }));
  assert.equal(d.listing.artifacts.length, MAX_ARTIFACTS); assert.equal(d.listing.truncated, true);
  const log = Array.from({ length: 30 }, () => `##[error]${'z'.repeat(1000)}`).join('\n');
  const e = availabilityDiagnostics(base({ verifyLog: { ok: true, text: log } }));
  assert.equal(e.verifyLog.errorLines.length, 10); assert.ok(e.verifyLog.errorLines.every((l) => l.length <= 300));
  const m = availabilityDiagnostics(base({ listing: { ok: true, artifacts: [{ id: 'x', name: 5, size_in_bytes: '1', digest: 'md5:1', expired: 'no' }], totalCount: 1 } }));
  assert.deepEqual(m.listing.artifacts[0], { id: null, name: null, sizeInBytes: null, digest: null, expired: null });
});
