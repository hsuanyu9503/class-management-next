/** Canonical JSON + SHA-256. stableJson is re-used (read-only import) from the locked Stage 1 code so
 *  digests are computed exactly as Stage 1 defines them. */
import { createHash } from 'node:crypto';
export { stableJson } from '../../stage1/src/common.mjs';
export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
