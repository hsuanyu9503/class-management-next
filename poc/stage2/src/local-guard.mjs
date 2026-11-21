/** S2-B2 batch 1 local-only guard. Every emulator request must pass through here.
 *  Fails closed: missing emulator settings, non-loopback hosts, non-demo projects or
 *  any credential in the environment stop the run BEFORE any network call. */
import { readFileSync } from 'node:fs';

export const PROJECT_ID = 'demo-cmn-s2b2';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
// Credentials or production pointers that must never be present during a local run.
export const FORBIDDEN_ENV = [
  'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'FIREBASE_SERVICE_ACCOUNT',
  'GOOGLE_OAUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN',
];
// `firebase emulators:exec` injects FIREBASE_CONFIG = {projectId, storageBucket, databaseURL} derived
// from the project id (firebase-tools lib/emulator/commandUtils.js runScript). It is accepted ONLY in
// exactly that shape for the demo project; any other content is refused. Its databaseURL is never used:
// every request is still pinned to loopback by assertLoopbackUrl().
export function checkFirebaseConfig(value, projectId) {
  if (value === undefined || value === '') return;
  let o; try { o = JSON.parse(value); } catch { throw new LocalGuardError('FIREBASE_CONFIG is not JSON'); }
  const expected = { projectId, storageBucket: `${projectId}.appspot.com`, databaseURL: `https://${projectId}.firebaseio.com` };
  const keys = Object.keys(o ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(expected).sort()) || keys.some((k) => o[k] !== expected[k])) {
    throw new LocalGuardError('FIREBASE_CONFIG is not the emulators:exec-derived demo config; refusing');
  }
}

export class LocalGuardError extends Error {
  constructor(msg) { super(`LOCAL_GUARD: ${msg}`); this.name = 'LocalGuardError'; }
}

export function parseHostPort(name, value) {
  if (typeof value !== 'string' || value === '') throw new LocalGuardError(`${name} is not set; refusing to fall back to any non-emulator endpoint`);
  const m = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(value);
  if (!m) throw new LocalGuardError(`${name}=${JSON.stringify(value)} is not a loopback host:port`);
  const port = Number(m[2]);
  if (port < 1 || port > 65535) throw new LocalGuardError(`${name} port out of range`);
  return { host: m[1], port, origin: `http://${m[1]}:${port}` };
}

export function assertLoopbackUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new LocalGuardError(`invalid URL ${JSON.stringify(url)}`); }
  if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname === '::1' ? '[::1]' : u.hostname) || u.username || u.password) {
    throw new LocalGuardError(`refusing non-loopback URL ${u.protocol}//${u.host}`);
  }
  return u;
}

export function assertLocalConfig(env = process.env, { projectId = PROJECT_ID, firebaseJsonPath = null } = {}) {
  for (const k of FORBIDDEN_ENV) if (env[k] !== undefined && env[k] !== '') throw new LocalGuardError(`credential/production variable ${k} is set; unset it for local emulator runs`);
  if (!/^demo-[a-z0-9-]{1,40}$/.test(projectId)) throw new LocalGuardError(`project id ${JSON.stringify(projectId)} is not a demo- project`);
  checkFirebaseConfig(env.FIREBASE_CONFIG, projectId);
  for (const k of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[k] !== undefined && env[k] !== '' && env[k] !== projectId) throw new LocalGuardError(`${k}=${JSON.stringify(env[k])} does not match ${projectId}`);
  }
  const firestore = parseHostPort('FIRESTORE_EMULATOR_HOST', env.FIRESTORE_EMULATOR_HOST);
  const auth = parseHostPort('FIREBASE_AUTH_EMULATOR_HOST', env.FIREBASE_AUTH_EMULATOR_HOST);
  if (firebaseJsonPath) {
    let cfg;
    try { cfg = JSON.parse(readFileSync(firebaseJsonPath, 'utf8')); } catch { throw new LocalGuardError('firebase.json missing or unreadable'); }
    const e = cfg.emulators || {};
    for (const svc of ['auth', 'firestore', 'hub', 'logging']) {
      if (!e[svc] || !LOOPBACK.has(e[svc].host)) throw new LocalGuardError(`firebase.json emulators.${svc}.host must be loopback`);
    }
    if (e.ui?.enabled !== false) throw new LocalGuardError('firebase.json must disable the emulator UI');
  }
  return Object.freeze({ projectId, firestore, auth });
}
