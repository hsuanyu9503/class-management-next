/** Known-secret collector for packaging (TRUSTED TOOLCHAIN, C1-REV004; attack-acceptance plan v0.4 §6.2).
 *  ONE list, assembled in the trusted Runner's memory, is used BOTH for masking the full self-check
 *  observations and for the pre-hand-over leak scan. It is never written; only per-source counts are recorded.
 *  Sources (union, deduplicated, append-only):
 *   - issued: every password / ID token / refresh token the harness issued in this process (rotated ones included);
 *   - caseTokens: the token values actually written into this run's case.json;
 *   - platform: the Runner's environment, classified BY NAME / PURPOSE (never by value length):
 *       secret  = the fixed GitHub / Actions credential names below, or a name containing TOKEN / SECRET /
 *                 PASSWORD / PASSWD / CREDENTIAL / PRIVATE_KEY / API_KEY …
 *       … unless the name is in a named NON-SECRET class: a reference to where a secret lives (…_FILE, …_PATH,
 *       …_DIR) or a count / limit setting (MAX_…, MIN_…, …_TOKENS). Excluded names are counted, never their values.
 *  R2 (C1-REV004): a known secret is NEVER dropped because it is short — only empty values are skipped. A very
 *  short secret simply masks more text, and if it occurs in an artifact the leak scan hits and nothing is handed
 *  over (fail closed). */
export const PLATFORM_ENV_NAMES = Object.freeze(['ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_RESULTS_URL', 'ACTIONS_CACHE_URL', 'GITHUB_TOKEN', 'GH_TOKEN']);
const SECRET_NAME_RE = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY)/i;
/** Named non-secret classes (purpose, not length): locations of secrets and numeric settings. */
export const NON_SECRET_NAME_CLASSES = Object.freeze([
  { class: 'location', re: /_(FILE|PATH|DIR)$/i },
  { class: 'setting', re: /^(MAX|MIN)_|_TOKENS$/i },
]);

export function classifyEnvName(name) {
  if (PLATFORM_ENV_NAMES.includes(name)) return 'secret';
  if (!SECRET_NAME_RE.test(name)) return 'other';
  const nc = NON_SECRET_NAME_CLASSES.find((c) => c.re.test(name));
  return nc ? `non-secret:${nc.class}` : 'secret';
}

export function platformSecretValues(env = {}) {
  const values = []; const excluded = {};
  for (const [k, v] of Object.entries(env)) {
    const c = classifyEnvName(k);
    if (c === 'secret' && typeof v === 'string') values.push(v);
    else if (c.startsWith('non-secret:')) excluded[c] = (excluded[c] || 0) + 1;
  }
  return { values, excluded };
}

/** @returns { values: string[], counts: { issued, caseTokens, platform, total, short, platformExcludedByClass } } */
export function collectKnownSecrets({ issued, caseTokens = [], env = {} } = {}) {
  if (!Array.isArray(issued)) throw new TypeError('collectKnownSecrets: issued list is required');
  const keep = (a) => a.filter((s) => typeof s === 'string' && s.length > 0);
  const p = platformSecretValues(env);
  const parts = { issued: keep(issued), caseTokens: keep(caseTokens), platform: keep(p.values) };
  const values = [...new Set([...parts.issued, ...parts.caseTokens, ...parts.platform])];
  return { values, counts: { issued: parts.issued.length, caseTokens: parts.caseTokens.length, platform: parts.platform.length, total: values.length, short: values.filter((v) => v.length < 12).length, platformExcludedByClass: p.excluded } };
}
