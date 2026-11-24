/** Sandbox-side helpers for the Adapter under test (adapterCommit). Only /adapter, /input, /entry, /work are
 *  visible. Control channel = fd 3; the only messages this side may send are READY and DONE. */
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { caseRequests, claimFrom, isWriteCase, runWriteCase, writeClaimFrom } from './core.mjs';

export const input = () => JSON.parse(fs.readFileSync('/input/case.json', 'utf8'));
const ctl = new net.Socket({ fd: 3, readable: true, writable: true });
let buf = ''; const lines = []; const waiters = [];
ctl.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.splice(0).forEach((w) => w()); } });
export const ready = () => ctl.write('READY\n');
export const waitGo = () => new Promise((res) => { const c = () => (lines.includes('GO') ? res() : waiters.push(c)); c(); });
export const done = (out, { exit = true } = {}) => { process.stdout.write(JSON.stringify(out)); ctl.write('DONE\n', () => { if (exit) process.exit(0); }); };

export function call(token, body, { raw, path = '/v1/read' } = {}) {
  return new Promise((resolve) => {
    const payload = raw !== undefined ? raw : JSON.stringify(body);
    const r = http.request({ socketPath: '/entry/front.sock', path, method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, timeout: 10000 }, (x) => {
      let s = ''; x.on('data', (d) => { s += d; }); x.on('end', () => { let b = null; try { b = JSON.parse(s); } catch { /* */ } resolve({ status: x.statusCode, body: b }); });
    });
    r.on('error', (e) => resolve({ status: 0, body: null, error: e.code })); r.on('timeout', () => r.destroy());
    r.end(payload);
  });
}

/** The honest behaviour: the case plan through the single entry, then the claim. */
export async function honest(inp) {
  if (isWriteCase(inp.testId)) {
    const token = inp.tokens['ACTOR-SC01-TEACHER'];
    const run = await runWriteCase(inp.testId, inp.fixtures, { send: (p, b) => call(token, b, { path: p }), uuid: randomUUID });
    return writeClaimFrom(inp.testId, run.results);
  }
  const plan = caseRequests(inp.testId, inp.fixtures);
  const token = inp.tokens[plan.actor];
  const res = []; for (const q of plan.requests) res.push(await call(token, q));
  return claimFrom(inp.testId, res);
}
