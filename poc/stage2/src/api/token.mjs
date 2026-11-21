/** ID token verification — EMULATOR MODE ONLY (§6.1 step 1).
 *
 *  Auth Emulator tokens are unsigned JWTs (`alg: none`). The emulator's own accounts:lookup does NOT
 *  check expiry, audience or integrity (verified in this batch: a forged user_id, an expired exp and a
 *  wrong aud were all accepted). Therefore this module:
 *   1. accepts `alg: none` ONLY because the caller is in explicit local emulator mode (see server.mjs);
 *   2. checks the claims itself: iss, aud, sub/user_id, iat/exp as integer NumericDate, exp > now,
 *      iat not in the future (small skew), auth_time ≤ iat;
 *   3. asks the Auth Emulator whether the user exists and is not disabled.
 *  LIMITATION: an unsigned token cannot be authenticated cryptographically. Anyone who can reach the
 *  loopback API can mint a token for any existing emulator user. This is acceptable only for a local
 *  PoC with fictional data; there is NO production verification path in this code. */
import { isNumericDate } from '../time-validate.mjs';

export const MAX_FUTURE_SKEW_SEC = 60;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const UID_RE = /^[A-Za-z0-9]{1,128}$/;

const fail = (reason) => ({ ok: false, reason });

function decodeJson(seg) {
  if (!B64URL_RE.test(seg)) return null;
  try { const v = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/** Parse + claim checks, no network. */
export function checkEmulatorTokenClaims(token, { projectId, nowSec }) {
  if (typeof token !== 'string' || token.length > 8192) return fail('TOKEN_MALFORMED');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[2] !== '') return fail('TOKEN_MALFORMED');            // emulator tokens have an empty signature
  const header = decodeJson(parts[0]); const payload = decodeJson(parts[1]);
  if (!header || !payload) return fail('TOKEN_MALFORMED');
  if (header.alg !== 'none' || 'kid' in header) return fail('TOKEN_NOT_EMULATOR');
  if (payload.iss !== `https://securetoken.google.com/${projectId}` || payload.aud !== projectId) return fail('TOKEN_WRONG_AUDIENCE');
  if (typeof payload.sub !== 'string' || !UID_RE.test(payload.sub) || payload.user_id !== payload.sub) return fail('TOKEN_BAD_SUBJECT');
  if (!isNumericDate(payload.iat) || !isNumericDate(payload.exp)) return fail('TOKEN_BAD_TIME');
  if (payload.auth_time !== undefined && (!isNumericDate(payload.auth_time) || payload.auth_time > payload.iat)) return fail('TOKEN_BAD_TIME');
  if (payload.exp <= nowSec) return fail('TOKEN_EXPIRED');
  if (payload.iat > nowSec + MAX_FUTURE_SKEW_SEC) return fail('TOKEN_FROM_FUTURE');
  if (payload.exp <= payload.iat) return fail('TOKEN_BAD_TIME');
  return { ok: true, claims: { authUid: payload.sub, iat: payload.iat, exp: payload.exp } };
}

/** Full verification: claims + Auth Emulator user state (exists, not disabled, same uid). */
export async function verifyEmulatorIdToken(token, { projectId, nowSec, lookup }) {
  const c = checkEmulatorTokenClaims(token, { projectId, nowSec });
  if (!c.ok) return c;
  const r = await lookup(token);
  if (r.status !== 200) return fail(r.status >= 500 || r.status === 0 ? 'AUTH_UNAVAILABLE' : 'TOKEN_REJECTED_BY_EMULATOR');
  const users = r.json?.users;
  if (!Array.isArray(users) || users.length !== 1 || users[0].localId !== c.claims.authUid || users[0].disabled === true) return fail('TOKEN_REJECTED_BY_EMULATOR');
  return c;
}
