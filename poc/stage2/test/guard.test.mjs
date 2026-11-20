import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assertLocalConfig, assertLoopbackUrl, parseHostPort, LocalGuardError } from '../src/local-guard.mjs';

const OK = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' };
const FB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'firebase.json');

test('accepts loopback emulator hosts and the demo project (positive control)', () => {
  const c = assertLocalConfig(OK, { firebaseJsonPath: FB });
  assert.equal(c.projectId, 'demo-cmn-s2b2');
  assert.equal(c.firestore.origin, 'http://127.0.0.1:8080');
  assert.equal(c.auth.origin, 'http://127.0.0.1:9099');
});
test('missing emulator settings fail closed (no fallback to any cloud endpoint)', () => {
  assert.throws(() => assertLocalConfig({ FIREBASE_AUTH_EMULATOR_HOST: OK.FIREBASE_AUTH_EMULATOR_HOST }), /FIRESTORE_EMULATOR_HOST is not set/);
  assert.throws(() => assertLocalConfig({ FIRESTORE_EMULATOR_HOST: OK.FIRESTORE_EMULATOR_HOST }), /FIREBASE_AUTH_EMULATOR_HOST is not set/);
  assert.throws(() => assertLocalConfig({}), LocalGuardError);
});
test('non-loopback hosts are refused', () => {
  for (const v of ['firestore.googleapis.com:443', '10.0.0.5:8080', '127.0.0.1.evil.example:8080', '0.0.0.0:8080', 'localhost', 'localhost:abc', 'localhost:0', 'localhost:70000', 'http://127.0.0.1:8080', ' 127.0.0.1:8080', '127.0.0.1:8080\n']) {
    assert.throws(() => parseHostPort('X', v), LocalGuardError, v);
  }
});
test('non-demo project ids are refused', () => {
  for (const p of ['cmn-prod', 'demo', 'demo-', 'DEMO-x', 'demo-UPPER']) assert.throws(() => assertLocalConfig(OK, { projectId: p }), /not a demo- project/, p);
  assert.throws(() => assertLocalConfig({ ...OK, GCLOUD_PROJECT: 'real-project' }), /does not match/);
});
test('credential / production variables in the environment are refused', () => {
  for (const k of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'FIREBASE_SERVICE_ACCOUNT', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN']) {
    assert.throws(() => assertLocalConfig({ ...OK, [k]: 'x' }), /credential\/production variable/, k);
  }
});
test('FIREBASE_CONFIG: only the exact emulators:exec-derived demo shape is accepted', () => {
  const p = 'demo-cmn-s2b2';
  const exact = JSON.stringify({ projectId: p, storageBucket: `${p}.appspot.com`, databaseURL: `https://${p}.firebaseio.com` });
  assert.ok(assertLocalConfig({ ...OK, FIREBASE_CONFIG: exact }));
  for (const bad of ['not json', JSON.stringify({ projectId: 'real-prod', storageBucket: 'real-prod.appspot.com', databaseURL: 'https://real-prod.firebaseio.com' }),
    JSON.stringify({ projectId: p }), JSON.stringify({ projectId: p, storageBucket: `${p}.appspot.com`, databaseURL: `https://${p}.firebaseio.com`, apiKey: 'x' }),
    JSON.stringify({ projectId: p, storageBucket: `${p}.appspot.com`, databaseURL: 'https://evil.example' })]) {
    assert.throws(() => assertLocalConfig({ ...OK, FIREBASE_CONFIG: bad }), LocalGuardError, bad);
  }
});
test('every request URL is re-checked as loopback http', () => {
  assert.equal(assertLoopbackUrl('http://127.0.0.1:8080/v1/x').port, '8080');
  for (const u of ['https://firestore.googleapis.com/v1/x', 'http://firestore.googleapis.com/', 'http://user:pw@127.0.0.1:8080/', 'https://127.0.0.1:8080/', 'file:///etc/passwd', 'not a url']) {
    assert.throws(() => assertLoopbackUrl(u), LocalGuardError, u);
  }
});
test('firebase.json must bind every emulator to loopback and disable the UI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 's2b2-'));
  const write = (o) => { const p = path.join(dir, 'firebase.json'); writeFileSync(p, JSON.stringify(o)); return p; };
  const good = { emulators: { auth: { host: '127.0.0.1' }, firestore: { host: '127.0.0.1' }, hub: { host: '127.0.0.1' }, logging: { host: '127.0.0.1' }, ui: { enabled: false } } };
  assert.ok(assertLocalConfig(OK, { firebaseJsonPath: write(good) }));
  assert.throws(() => assertLocalConfig(OK, { firebaseJsonPath: write({ ...good, emulators: { ...good.emulators, firestore: { host: '0.0.0.0' } } }) }), /firestore.host must be loopback/);
  assert.throws(() => assertLocalConfig(OK, { firebaseJsonPath: write({ ...good, emulators: { ...good.emulators, ui: { enabled: true } } }) }), /disable the emulator UI/);
  assert.throws(() => assertLocalConfig(OK, { firebaseJsonPath: path.join(dir, 'missing.json') }), /missing or unreadable/);
});
