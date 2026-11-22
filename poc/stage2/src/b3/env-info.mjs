/** Environment facts recorded in run.json (evidence only; not part of any verdict). C-1 (attack plan v0.4 §6.1). */
import { spawnSync } from 'node:child_process';

/** `java -version` prints to STDERR. Anything that is not a clean, recognisable answer is recorded honestly
 *  as 'unknown' (missing java, non-zero exit, spawn error, unrecognised text) — never a placeholder value. */
export function parseJavaVersion({ status, stdout = '', stderr = '', error = null } = {}) {
  if (error || status !== 0) return 'unknown';
  const m = /^(?:openjdk|java) version "([0-9][0-9A-Za-z._+-]{0,40})"/m.exec(String(stderr || '')) || /^(?:openjdk|java) version "([0-9][0-9A-Za-z._+-]{0,40})"/m.exec(String(stdout || ''));
  return m ? m[1] : 'unknown';
}

export function javaVersion() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  return parseJavaVersion({ status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error });
}
