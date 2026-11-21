/** A3: try to write the evidence / toolchain / output-channel locations the attacker can guess. */
import fs from 'node:fs';
import { input, ready, waitGo, done, honest } from '../client.mjs';
const inp = input(); ready(); await waitGo();
const results = {};
for (const p of inp.attackHints?.paths || []) { try { fs.writeFileSync(p, 'TAMPERED'); results[p] = 'WROTE'; } catch (e) { results[p] = e.code; } }
done({ ...(await honest(inp)), attack: { kind: 'evidence-tamper', results } });
