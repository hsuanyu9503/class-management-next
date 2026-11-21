/** Masking applied BEFORE anything is written to a trace or evidence file (batch 2 step 10).
 *  - Authorization headers are replaced by a reference that keeps the identity link the Observer needs
 *    (token SHA-256 + the UNVERIFIED subject claim) without the token itself.
 *  - Secret / personal keys (password, tokens, displayName, email, …) are replaced by "[MASKED]".
 *  - Any string containing a known fictional fixture name is replaced by "[MASKED_NAME]" (value-based
 *    backstop for names appearing under unexpected keys).
 *  Token SHA-256 is kept because ID tokens are high-entropy and not enumerable; names and student IDs
 *  are never hashed (S2-B1 §6.6: hashes of enumerable IDs are not de-identification). */
import { createHash } from 'node:crypto';

export const MASK = '[MASKED]';
export const MASK_NAME = '[MASKED_NAME]';
const SECRET_KEYS = new Set(['password', 'idtoken', 'refreshtoken', 'displayname', 'email', 'oobcode', 'passwordhash', 'salt', 'rawpassword', 'newpassword', 'accesstoken', 'customtoken', 'reasonnote']);
const EMAIL_RE = /[^\s"@]+@[^\s"@]+\.[^\s"@]+/g;

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function tokenRef(token) {
  if (token === 'owner') return { masked: true, emulatorOwner: true };
  let claimedAuthUid = null, claimedIat = null;
  try { const p = JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8')); claimedAuthUid = typeof p.sub === 'string' ? p.sub : null; claimedIat = Number.isSafeInteger(p.iat) ? p.iat : null; } catch { /* not a JWT */ }
  return { masked: true, tokenSha256: sha256(String(token)), claimedAuthUid, claimedIat, verified: false };
}

export function maskAuthorization(value) {
  if (typeof value !== 'string' || value === '') return null;
  const m = /^Bearer (.+)$/.exec(value);
  return m ? { scheme: 'Bearer', ...tokenRef(m[1]) } : { masked: true, scheme: 'other', valueSha256: sha256(value) };
}

export function makeMasker(names = []) {
  const nameList = [...new Set(names.filter((n) => typeof n === 'string' && n.length > 0))];
  const maskString = (s) => {
    if (nameList.some((n) => s.includes(n))) return MASK_NAME;
    return s.replace(EMAIL_RE, MASK);
  };
  const walk = (v) => {
    if (typeof v === 'string') return maskString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.has(k.toLowerCase()) ? MASK : walk(x)]));
    return v;
  };
  return { maskValue: walk, maskString };
}

/** Returns the list of leaked secrets/names found in a serialized artifact (used by tests). */
export function findLeaks(text, { names = [], secrets = [] } = {}) {
  const leaks = [];
  for (const n of names) if (n && text.includes(n)) leaks.push(`name:${n}`);
  for (const s of secrets) if (s && text.includes(s)) leaks.push(`secret:${s.slice(0, 6)}…`);
  if (/"authorization"\s*:\s*"Bearer /i.test(text)) leaks.push('raw-authorization-header');
  return leaks;
}
