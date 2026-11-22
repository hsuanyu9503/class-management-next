/** Known-secret collector for packaging (TRUSTED TOOLCHAIN, C1-REV004; attack-acceptance plan v0.4 §6.2).
 *  ONE list, assembled in the trusted Runner's memory, is used BOTH for masking the full self-check
 *  observations and for the pre-hand-over leak scan. It is never written; only its size is recorded.
 *  Sources (union, deduplicated, append-only):
 *   - issued: every password / ID token / refresh token the harness issued in this process (rotated ones included);
 *   - caseTokens: the token values actually written into this run's case.json;
 *   - platform: values of the Runner's own environment that look like platform credentials — the fixed names
 *     below plus any variable whose NAME contains TOKEN / SECRET / PASSWORD / CREDENTIAL / PRIVATE_KEY / API_KEY.
 *  Values shorter than MIN_SECRET_LEN are ignored (they would mask ordinary text); none are expected. */
export const MIN_SECRET_LEN = 12;
export const PLATFORM_ENV_NAMES = Object.freeze(['ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_RESULTS_URL', 'ACTIONS_CACHE_URL', 'GITHUB_TOKEN', 'GH_TOKEN']);
const SECRET_NAME_RE = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY)/i;

export function platformSecretValues(env = {}) {
  const out = [];
  for (const [k, v] of Object.entries(env)) if ((PLATFORM_ENV_NAMES.includes(k) || SECRET_NAME_RE.test(k)) && typeof v === 'string') out.push(v);
  return out;
}

/** @returns { values: string[], counts: { issued, caseTokens, platform, total } } */
export function collectKnownSecrets({ issued, caseTokens = [], env = {} } = {}) {
  if (!Array.isArray(issued)) throw new TypeError('collectKnownSecrets: issued list is required');
  const keep = (a) => a.filter((s) => typeof s === 'string' && s.length >= MIN_SECRET_LEN);
  const parts = { issued: keep(issued), caseTokens: keep(caseTokens), platform: keep(platformSecretValues(env)) };
  const values = [...new Set([...parts.issued, ...parts.caseTokens, ...parts.platform])];
  return { values, counts: { issued: parts.issued.length, caseTokens: parts.caseTokens.length, platform: parts.platform.length, total: values.length } };
}
