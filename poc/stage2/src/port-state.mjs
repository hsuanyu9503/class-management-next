/** Tri-state TCP port check for the S2-B2 smoke preconditions (S2B2-REV-003).
 *
 *  'open'    — a TCP connection succeeded: something is listening.
 *  'closed'  — the connection was explicitly refused (ECONNREFUSED): nothing is listening right now.
 *  'unknown' — anything else (EACCES, EPERM, timeout, any other error): the state could NOT be
 *              confirmed. Callers must treat 'unknown' exactly like 'open' (fail closed).
 *
 *  No other error code is mapped to 'closed'. */
import net from 'node:net';

export const CLOSED_CODES = Object.freeze(['ECONNREFUSED']);

export function portState(port, { host = '127.0.0.1', timeoutMs = 1500, connect = net.connect } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let sock;
    const finish = (state, code) => {
      if (done) return;                                  // first outcome wins; later events ignored
      done = true;
      clearTimeout(timer);
      try { sock?.removeAllListeners(); sock?.on?.('error', () => {}); sock?.destroy(); } catch { /* ignore */ }
      resolve({ port, state, code });
    };
    const timer = setTimeout(() => finish('unknown', 'TIMEOUT'), timeoutMs);
    try {
      sock = connect({ host, port });
    } catch (e) {
      finish('unknown', e?.code || 'CONNECT_THREW');
      return;
    }
    sock.once('connect', () => finish('open', 'CONNECTED'));
    sock.once('error', (e) => finish(CLOSED_CODES.includes(e?.code) ? 'closed' : 'unknown', e?.code || 'UNKNOWN_ERROR'));
  });
}
