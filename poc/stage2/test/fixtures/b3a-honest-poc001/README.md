# B3a fixture: honest POC-001 package (fictional data, masked)

Produced by the B3a emulator run (`test/b3-run.mjs` under `firebase emulators:exec`, root, Linux) on the PR-1
working tree (base `322f65b0373c1fda0f040cc0d249c930da0a6a7e` plus the uncommitted B3A-N5～N8 changes, so
`run.json` records `gitDirty: true` and the base commit), run `S2B2B3A-20261121T123541Z-82d5d09c`. Regenerated because B3A-N7 changed the
sandbox config (`sandboxPolicyDigest` `18d9e21f…`) and added the path map; the previous fixture came from
`211e11433bc3e005d3ef68383340e9b27e8183cf` (run `S2B2B3A-20261121T085237Z-4357e3e1`).

`package.tar` SHA-256: `7fd6f87e43ff23955281772365adc14e39dd52cbf6efd013d1880b47acd2a717`.

Used by `test/b3-unit.test.mjs` to test the Verifier without root or an emulator: probes repackage these files
with `writePackage()` and pass the new digests as trusted inputs, so only the Verifier's policy and
reconciliation layers are exercised. The fixture itself is NOT attestation evidence. The run's masking scan
(every issued secret, fictional names) found 0 hits in every artifact, including this package.
