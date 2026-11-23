# B3a fixture: honest POC-001 package (fictional data, masked)

Produced by the B3a emulator run (`test/b3-run.mjs` under `firebase emulators:exec`, root, Linux), run
`S2B2B3A-20261122T030000Z-db7299e3`, on the C-1 working tree: commit
`5e0ce3bd5811e77bef111e01cad2a00cd3347cbc` plus the then-uncommitted C-1a changes (so `run.json` records that
commit with `gitDirty: true`).

History:
- first produced on `211e11433bc3e005d3ef68383340e9b27e8183cf` (run `S2B2B3A-20261121T085237Z-4357e3e1`);
- regenerated for B3A-N7 (sandbox config `18d9e21f…`, path map), then for PR1-REV001 (back traces record the
  structured query), run `S2B2B3A-20261121T125600Z-6eff6b33`;
- regenerated for C-1a (attack-acceptance plan v0.4 §1.2 and §6):
  - `run.json` records the trusted `scenario: "honest"`;
  - `isolation.json` carries `selfCheckFull` (22 entries, masked, none truncated) and `maskSecretCount`;
  - statement summaries are the first 200 code points of each `observedFull`;
  - the Java version is read from stderr.

`package.tar` SHA-256: `1f14f4ea9204fbee53135dc4bf6f4ef22761848cf64e8b3cf71e29c18f9ae76b`.

Used by `test/b3-unit.test.mjs` and `test/c1-unit.test.mjs` to test the Verifier without root or an emulator.
Probes repackage these files with `writePackage()` and pass the new digests as trusted inputs, so only the
Verifier's policy and reconciliation layers are exercised. The fixture itself is NOT attestation evidence.
The run's masking scan (every issued secret, fictional names) found 0 hits in every artifact (90 files, 225
issued secrets), including this package.
