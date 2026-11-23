/** Full self-check observations (TRUSTED TOOLCHAIN, C-1). Attack-acceptance plan v0.4 §6.2.
 *
 *  Processing contract (fixed order):
 *   1. observations are collected as structured values (objects, arrays, strings) — never pre-serialised;
 *   2. maskObservation(): the existing masker (makeMasker: secret field names, credential-shaped strings,
 *      fictional fixture names → [MASKED_NAME]) runs on the structured value, THEN every string value and
 *      object key that CONTAINS any of this run's known secret values is replaced whole by [MASKED_SECRET];
 *   3. stableJson() serialisation;
 *   4. size in UTF-8 bytes; over OBS_MAX_BYTES (65,536) the bytes are cut at the last complete UTF-8
 *      character boundary that fits (a multi-byte character is never split) and truncated = true;
 *   5. observedSha256 = SHA-256 of the final UTF-8 bytes.
 *  The statement summary is the first SUMMARY_CODEPOINTS (200) Unicode code points of observedFull.
 *
 *  The secret list is passed in explicitly (from the trusted Runner's memory: every token it issued or used
 *  in this run, rotated ones included). It is never written anywhere; only its size is recorded. */
import { createHash } from 'node:crypto';
import { makeMasker } from '../mask.mjs';
import { stableJson } from '../stable.mjs';

export const OBS_MAX_BYTES = 65536;
export const SUMMARY_CODEPOINTS = 200;
export const MASK_SECRET = '[MASKED_SECRET]';
export const FULL_ENTRY_KEYS = Object.freeze(['byteLength', 'observedFull', 'observedSha256', 'originalByteLength', 'truncated']);
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** @param secretValues REQUIRED array (may be empty); a missing list is an error, never "no secrets". */
export function maskObservation(value, { fixtureNames = [], secretValues } = {}) {
  if (!Array.isArray(secretValues)) throw new TypeError('maskObservation: secretValues list is required');
  const secrets = [...new Set(secretValues.filter((s) => typeof s === 'string' && s.length > 0))];
  const hit = (s) => secrets.some((x) => s.includes(x));
  const base = makeMasker(fixtureNames).maskValue(value);
  let n = 0;
  const walk = (v) => {
    if (typeof v === 'string') return hit(v) ? MASK_SECRET : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [hit(k) ? `${MASK_SECRET}#${++n}` : k, walk(x)]));
    return v;
  };
  return walk(base);
}

/** Largest cut ≤ max that does not split a UTF-8 sequence. */
export function utf8Cut(buf, max) {
  if (buf.length <= max) return buf.length;
  let cut = max;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  return cut;
}

export const summaryOf = (s) => Array.from(s).slice(0, SUMMARY_CODEPOINTS).join('');

/** Steps 2–5 for one check. */
export function fullObservation(value, opts) {
  const text = stableJson(maskObservation(value, opts));
  const buf = Buffer.from(text, 'utf8');
  const cut = utf8Cut(buf, OBS_MAX_BYTES);
  const fin = buf.subarray(0, cut);
  const observedFull = fin.toString('utf8');
  return { observedFull, observedSha256: sha(fin), byteLength: fin.length, truncated: cut < buf.length, originalByteLength: buf.length };
}

/** Builds the statement selfCheck (summaries) and isolation.json selfCheckFull from RAW checks
 *  { [id]: { ok, observedRaw, positiveControlOk } } — called at packaging time with the complete secret list. */
export function finalizeSelfCheck(raw, opts) {
  if (raw === null || raw === undefined) return { selfCheck: null, selfCheckFull: null };
  const selfCheck = {}; const selfCheckFull = {};
  for (const [id, c] of Object.entries(raw)) {
    const full = fullObservation(c.observedRaw, opts);
    selfCheckFull[id] = full;
    selfCheck[id] = { ok: c.ok, observed: summaryOf(full.observedFull), positiveControlOk: c.positiveControlOk };
  }
  return { selfCheck, selfCheckFull };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isSafeInteger(v) && v >= 0;
/** Verifier side (pure). checkIds = the TRUSTED CHECK_IDS. Returns [] or reason codes:
 *  ISOLATION_EVIDENCE_INVALID (shape, types, lengths, digests, summaries, secret count) and/or
 *  ISOLATION_EVIDENCE_INCOMPLETE (any truncated entry — never supports DEFENDED or PASS). */
export function checkSelfCheckFull({ selfCheck, selfCheckFull, maskSecretCount }, checkIds) {
  const bad = new Set();
  if (!isInt(maskSecretCount)) bad.add('ISOLATION_EVIDENCE_INVALID');
  if (!isObj(selfCheckFull) || !isObj(selfCheck)) { bad.add('ISOLATION_EVIDENCE_INVALID'); return [...bad]; }
  const keys = Object.keys(selfCheckFull);
  if (keys.length !== checkIds.length || checkIds.some((id) => !Object.hasOwn(selfCheckFull, id))) bad.add('ISOLATION_EVIDENCE_INVALID');
  for (const id of checkIds) {
    const e = Object.hasOwn(selfCheckFull, id) ? selfCheckFull[id] : null;
    if (!isObj(e) || stableJson(Object.keys(e).sort()) !== stableJson([...FULL_ENTRY_KEYS])) { bad.add('ISOLATION_EVIDENCE_INVALID'); continue; }
    if (typeof e.observedFull !== 'string' || typeof e.observedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.observedSha256)
      || !isInt(e.byteLength) || !isInt(e.originalByteLength) || typeof e.truncated !== 'boolean') { bad.add('ISOLATION_EVIDENCE_INVALID'); continue; }
    const b = Buffer.from(e.observedFull, 'utf8');
    if (b.length !== e.byteLength || e.byteLength > OBS_MAX_BYTES || sha(b) !== e.observedSha256) bad.add('ISOLATION_EVIDENCE_INVALID');
    if (e.truncated ? !(e.originalByteLength > OBS_MAX_BYTES && e.originalByteLength > e.byteLength) : e.originalByteLength !== e.byteLength) bad.add('ISOLATION_EVIDENCE_INVALID');
    const s = Object.hasOwn(selfCheck, id) ? selfCheck[id] : null;
    if (!isObj(s) || s.observed !== summaryOf(e.observedFull)) bad.add('ISOLATION_EVIDENCE_INVALID');
    if (e.truncated) bad.add('ISOLATION_EVIDENCE_INCOMPLETE');
  }
  return [...bad];
}
