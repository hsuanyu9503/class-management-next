/** A8 + A12: forged evidence references and a lying claim. */
import { input, ready, waitGo, done, honest } from '../client.mjs';
const inp = input(); ready(); await waitGo();
const claim = await honest(inp);
done({ canonical: { ...claim.canonical, returnedCount: 999 }, evidence: { ...claim.evidence, evidenceFiles: [{ path: 'cases/POC-001/trace-front.jsonl', sha256: 'f'.repeat(64) }, { path: '../../etc/passwd', sha256: 'e'.repeat(64) }] }, attack: { kind: 'forge-evidence' } });
