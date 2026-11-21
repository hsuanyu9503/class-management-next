/** Strict time / date validation for the S2-B2 batch 2 controlled read API.
 *
 *  S2-B1 AUTHORIZATION §13 (assumption 5) lists inputs the model compared as plain strings and
 *  requires the implementation to validate them as strictly as §7.6:
 *   - Auth Binding `activatedAt`  → UTC timestamp `YYYY-MM-DDTHH:MM:SSZ` (whole string, ASCII, real date)
 *   - token `iat` / `exp`         → JWT NumericDate: non-negative safe INTEGER seconds since epoch
 *   - membership `validFrom` / `validToExclusive` → calendar date `YYYY-MM-DD` (whole string, real date)
 *  Anything that does not validate is INVALID (the caller treats the record as invalid → FORBIDDEN).
 *  No Date.parse() fallback is used anywhere: Date.parse accepts many non-conforming strings. */

const TS_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$/;   // no /m flag: ^$ are whole-string
const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function daysInMonth(y, m) { return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

function validYmd(y, m, d) { return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m); }

/** `YYYY-MM-DDTHH:MM:SSZ` → epoch seconds (integer), or null if not a valid UTC timestamp. */
export function parseUtcTimestamp(s) {
  if (typeof s !== 'string' || s.length !== 20) return null;
  const m = TS_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (!validYmd(y, mo, d) || h > 23 || mi > 59 || se > 59) return null;      // no leap second 60
  return Date.UTC(y, mo - 1, d, h, mi, se) / 1000;
}

/** `YYYY-MM-DD` → day ordinal (days since 1970-01-01, integer), or null if not a valid date. */
export function parseLocalDate(s) {
  if (typeof s !== 'string' || s.length !== 10) return null;
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  if (!validYmd(y, mo, d)) return null;
  return Date.UTC(y, mo - 1, d) / 86400000;
}

/** JWT NumericDate (RFC 7519 §2) restricted to integer seconds. */
export function isNumericDate(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }

/** Calendar date (day ordinal) of an instant in an IANA time zone. */
export function localDayOrdinal(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(epochMs));
  const get = (t) => parts.find((p) => p.type === t).value;
  return parseLocalDate(`${get('year')}-${get('month')}-${get('day')}`);
}
