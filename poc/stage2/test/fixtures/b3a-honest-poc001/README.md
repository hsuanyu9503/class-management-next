# B3a fixture: honest POC-001 package (fictional data, masked)

Produced by the B3a emulator run (`test/b3-run.mjs` under `firebase emulators:exec`, root, Linux), run
`S2B2B3A-20261121T125600Z-6eff6b33`, on the PR #9 working tree: commit
`501d2d716b258d58195ba46108fe83d78a27d6f9` plus the then-uncommitted PR1-REV001 changes (so `run.json` records
that commit with `gitDirty: true`).

History: first produced on `211e11433bc3e005d3ef68383340e9b27e8183cf` (run `S2B2B3A-20261121T085237Z-4357e3e1`);
regenerated for B3A-N7 (sandbox config `18d9e21f…`, path map) and again for PR1-REV001 (back traces now record
the structured query, e.g. `currentDocument.exists=false`).

`package.tar` SHA-256: `69d1bcf2457890b71f91f2a9d47c7a84bc00479554ec00af0a201a6115e0710c`.

Used by `test/b3-unit.test.mjs` to test the Verifier without root or an emulator: probes repackage these files
with `writePackage()` and pass the new digests as trusted inputs, so only the Verifier's policy and
reconciliation layers are exercised. The fixture itself is NOT attestation evidence. The run's masking scan
(every issued secret, fictional names) found 0 hits in every artifact, including this package.
