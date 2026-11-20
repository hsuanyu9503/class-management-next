/** Run ownership for destructive emulator operations (S2B2-REV-001).
 *  The smoke may clear data ONLY in an emulator it has proven it owns:
 *   1. before any write, the emulator must be empty (no root collections, no Auth accounts);
 *   2. it then writes one marker document _smokeOwnership/{RUN_NONCE};
 *   3. before clearing, exactly that one marker must still be present. */
export const MARKER_COLLECTION = '_smokeOwnership';
export const NONCE_RE = /^[0-9a-f]{32}$/;

export class OwnershipError extends Error {
  constructor(msg) { super(`OWNERSHIP: ${msg}`); this.name = 'OwnershipError'; }
}
export function assertNonce(nonce) {
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) throw new OwnershipError('RUN_NONCE missing or not 32 lowercase hex characters');
  return nonce;
}
/** Precondition before ANY write. */
export function assertFreshEmulator({ rootCollections, authAccounts }) {
  if (!Array.isArray(rootCollections)) throw new OwnershipError('could not list root collections');
  if (rootCollections.length !== 0) throw new OwnershipError(`emulator is not empty (root collections: ${rootCollections.length}); refusing to write or clear`);
  if (!Number.isInteger(authAccounts)) throw new OwnershipError('could not count Auth accounts');
  if (authAccounts !== 0) throw new OwnershipError(`Auth emulator is not empty (${authAccounts} accounts); refusing to write or clear`);
}
/** Precondition before clearing. `markerIds` are the document ids found in MARKER_COLLECTION. */
export function assertStillOwned(markerIds, nonce) {
  if (!Array.isArray(markerIds)) throw new OwnershipError('could not read ownership markers');
  if (markerIds.length !== 1 || markerIds[0] !== nonce) throw new OwnershipError(`ownership marker mismatch (found ${markerIds.length}); refusing to clear`);
}
