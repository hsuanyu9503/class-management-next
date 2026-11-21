# B3a fixture: honest POC-001 package (fictional data, masked)

Produced by `npm run s2:b3` on Head `211e11433bc3e005d3ef68383340e9b27e8183cf` (clean checkout, run
`S2B2B3A-20261121T085237Z-4357e3e1`). Used by `test/b3-unit.test.mjs` to test the Verifier without root or an
emulator: probes repackage these files with `writePackage()` and pass the new digests as trusted inputs, so
only the Verifier's policy and reconciliation layers are exercised. The fixture itself is NOT attestation
evidence. Contents were scanned for issued secrets and fictional names (0 hits) before committing.
