#!/usr/bin/env node
/** S2-B2 B3b — verify job: record the signing step's outcome in delivery.json (a delivery record, NOT evidence;
 *  only an actual Sigstore bundle proves a signature). SIGN_OUTCOME is the step outcome of the signing step. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const f = path.join(process.env.OUT_DIR, 'delivery.json');
const d = JSON.parse(readFileSync(f, 'utf8'));
const o = process.env.SIGN_OUTCOME || 'skipped';
if (d.result === 'PASS') d.signing = o === 'success' ? 'SIGNED' : o === 'failure' ? 'SIGN_FAILED' : 'SIGN_NOT_RUN';
d.attestationId = o === 'success' ? (process.env.ATTESTATION_ID || null) : null;
writeFileSync(f, JSON.stringify(d, null, 1));
console.log(`DELIVERY result=${d.result} signing=${d.signing}`);
