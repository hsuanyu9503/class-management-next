/** S2B2-REV-001 regression: a busy port or a foreign emulator must cause an immediate stop with
 *  NO destructive request. Uses in-process fake HTTP servers that record every request; asserts on
 *  the recorded methods, not only on exit codes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNonce, assertFreshEmulator, assertStillOwned, OwnershipError } from '../src/ownership.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NONCE = 'a'.repeat(32);
const READ_ONLY_POST = [/:listCollectionIds$/, /\/accounts:query$/];

function fakeEmulator(port, { collections = [], accounts = 0 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0]; requests.push({ method: req.method, url });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && url === '/') return res.end('Ok');
      if (url.endsWith(':listCollectionIds')) return res.end(JSON.stringify({ collectionIds: collections }));
      if (url.endsWith('/accounts:query')) return res.end(JSON.stringify({ recordsCount: String(accounts) }));
      res.end('{}');                            // tempt the client: any write would "succeed"
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ requests, close: () => new Promise((r) => server.close(r)) })));
}
function runNode(args, env, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
const destructive = (reqs) => reqs.filter((r) => r.method === 'DELETE' || r.method === 'PATCH' || (r.method === 'POST' && !READ_ONLY_POST.some((re) => re.test(r.url))));

test('ownership helpers: nonce format, fresh-emulator and still-owned checks', () => {
  assert.equal(assertNonce(NONCE), NONCE);
  for (const bad of [undefined, '', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(32) + '\n', 'g'.repeat(32)]) assert.throws(() => assertNonce(bad), OwnershipError);
  assert.doesNotThrow(() => assertFreshEmulator({ rootCollections: [], authAccounts: 0 }));
  for (const bad of [{ rootCollections: ['x'], authAccounts: 0 }, { rootCollections: [], authAccounts: 1 }, { rootCollections: null, authAccounts: 0 }, { rootCollections: [], authAccounts: null }]) {
    assert.throws(() => assertFreshEmulator(bad), OwnershipError);
  }
  assert.doesNotThrow(() => assertStillOwned([NONCE], NONCE));
  for (const bad of [[], ['b'.repeat(32)], [NONCE, 'b'.repeat(32)], null]) assert.throws(() => assertStillOwned(bad, NONCE), OwnershipError);
});

test('orchestrator: emulator ports already occupied → immediate stop, zero requests to the occupant', async () => {
  const f = await fakeEmulator(8080); const a = await fakeEmulator(9099);
  try {
    const r = await runNode(['scripts/run-smoke.mjs'], {});
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /PRECONDITION FAILED: precondition \(before negatives\): emulator ports confirmed closed/);
    assert.doesNotMatch(r.out, /POSITIVE|NEGATIVE/);
    assert.deepEqual(f.requests, [], 'no request of any kind may reach the occupying Firestore');
    assert.deepEqual(a.requests, [], 'no request of any kind may reach the occupying Auth');
  } finally { await f.close(); await a.close(); }
});

for (const [label, opts] of [['Firestore has data', { collections: ['workspaces'], accounts: 0 }], ['Auth has accounts', { collections: [], accounts: 3 }]]) {
  test(`smoke against a foreign emulator (${label}) → refuses with no DELETE/PATCH/write`, async () => {
    const f = await fakeEmulator(18080, { collections: opts.collections }); const a = await fakeEmulator(19099, { accounts: opts.accounts });
    try {
      const r = await runNode(['test/smoke.mjs'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099', RUN_NONCE: NONCE });
      assert.notEqual(r.code, 0, r.out);
      assert.match(r.out, /OWNERSHIP: (Auth )?emulator is not empty/);
      assert.deepEqual(destructive([...f.requests, ...a.requests]), []);
    } finally { await f.close(); await a.close(); }
  });
}

test('positive control: an empty emulator passes the ownership check and gets a marker write', async () => {
  const f = await fakeEmulator(18080); const a = await fakeEmulator(19099);
  try {
    const r = await runNode(['test/smoke.mjs'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099', RUN_NONCE: NONCE });
    assert.doesNotMatch(r.out, /OWNERSHIP: (Auth )?emulator is not empty/);
    assert.ok(f.requests.some((q) => q.method === 'PATCH' && q.url.endsWith(`/_smokeOwnership/${NONCE}`)), 'marker must be written after the fresh check');
    const firstWrite = f.requests.findIndex((q) => q.method === 'PATCH');
    const freshCheck = f.requests.findIndex((q) => q.url.endsWith(':listCollectionIds'));
    assert.ok(freshCheck >= 0 && freshCheck < firstWrite, 'fresh check must happen before the first write');
  } finally { await f.close(); await a.close(); }
});

test('smoke without RUN_NONCE refuses before any request', async () => {
  const f = await fakeEmulator(18080); const a = await fakeEmulator(19099);
  try {
    const r = await runNode(['test/smoke.mjs'], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099' });
    assert.notEqual(r.code, 0); assert.match(r.out, /OWNERSHIP: RUN_NONCE missing/);
    assert.deepEqual([...f.requests, ...a.requests], []);
  } finally { await f.close(); await a.close(); }
});
