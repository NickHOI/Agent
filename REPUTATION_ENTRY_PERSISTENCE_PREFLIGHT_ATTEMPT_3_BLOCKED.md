# Reputation Entry Persistence Preflight Attempt 3 Blocked

Date: 2026-09-04

## Decision

**PHASE A ATTEMPT 3: FAIL / BLOCKED. PHASE B: NOT AUTHORIZED.**

The canonical command comparison correction and all focused comparison tests
passed. The complete Attempt 3 preflight persisted, deliberately failed,
restarted, recovered, recomputed integrity, and ran the required tampering
tests. A new cleanup blocker then appeared in the historical-marker tamper
probe: the expected constructor failure left a SQLite handle open, so Windows
could not unlink the probe's `marker-proof.sqlite-shm` file. Execution stopped
fail-closed. The new database is retained and was not rerun or overwritten.

## 1. Exact Attempt 2 Blocker

Attempt 2 failed with `REPUTATION_ENTRY_WORK_CONTRACT_TAMPERING_DETECTED`.
Canonical persistence reloaded the command with property order `command`,
`expectedExitCode`, `id`, `role`; the task definition used `id`, `role`,
`command`, `expectedExitCode`. The values were identical.

## 2. Old Comparison Semantics

```ts
JSON.stringify(contract.acceptanceCriteria.commands) !==
  JSON.stringify(definition.commands)
```

Native `JSON.stringify` preserves object insertion order, so property order was
incorrectly treated as semantic while array order was also treated as semantic.

## 3. New Canonical Structural Comparison Semantics

```ts
canonicalJson(contract.acceptanceCriteria.commands) !==
  canonicalJson(definition.commands)
```

The existing `canonicalJson` primitive recursively excludes object properties
whose value is `undefined`, sorts object keys lexically, preserves supported
field names, values, nested structures, scalar types, and `null`, then
serializes as JSON. `sha256Canonical` hashes the UTF-8 bytes of that exact
representation. No new normalization format was introduced.

## 4. Array And Order Protection

`canonicalJson` maps arrays in their existing order; it does not sort them.
Argument order, command order, array membership, and execution sequence remain
semantically protected. Only object-property insertion order is normalized.

## 5. Focused Equivalence Test

**PASS.** A command with `command`, `cwd`, `args`, expected exit code, and
nested options compared equal to the same command constructed with different
object-key and nested-key insertion order. A real Work Contract serialized and
reloaded through `canonicalJson` also passed its integrity validator.

## 6. Focused Mutation Negative Tests

**PASS.** Focused tests rejected changed command, changed argument, removed
argument, added argument, changed working directory, missing field, extra
covered field, changed argument-array order, changed command sequence, and
changed nested value. The focused Vitest file passed 5/5 tests, including both
new comparison tests.

## 7. Attempt 1 Database And Report State

- Database: `test-results/reputation-entry-persistence-preflight.sqlite`
- Size: 69,632 bytes
- SHA-256: `ad2a27aa75976d7a3202f6368fd21ccfa15b9c6fe81cb0f967b8f76e97f666af`
- Report: `REPUTATION_ENTRY_REPLACEMENT_BATCH_BLOCKED.md`
- Report SHA-256: `33efab2d26727e9a18d108b6d33d91f0c8615000c8b9deceea01cb962cfe3a1c`
- Historical marker SHA-256: `5d90116229342b94fa9ef935e2c5780d2a0655143ec121db78b8c58176fd598f`

These values remained unchanged through Attempt 3.

## 8. Attempt 2 Database And Report State

- Database: `test-results/reputation-entry-persistence-preflight-attempt-2.sqlite`
- Size: 69,632 bytes
- SHA-256: `99f924efb22dea0dc1cea2c460f66be2469588771e55f2b66fbc59aa3de6a11c`
- Report: `REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT_ATTEMPT_2_BLOCKED.md`
- Report SHA-256: `4c89f39d124375d51abf2f524fdc579b38e75eda266833730fe22e98878c178c`

These values remained unchanged through Attempt 3.

## 9. Attempt 3 Database Path And Hash

- Database: `test-results/reputation-entry-persistence-preflight-attempt-3.sqlite`
- Size: 69,632 bytes
- SHA-256 at blocked-report capture: `648340d1e74699cfe052257b696b83977f0ed455e231bcfc231bb82ea27acf15`
- Durable records: 14, comprising two global profile/lineage records and 12
  Job-bound records
- Lifecycle entries: 12
- Retained PASS JSON: absent and not reconstructed
- Lineage: Attempt 1 cross-domain assertion failure -> Attempt 2 corrected
  domains and key-order failure -> Attempt 3 structural-comparison correction

The failed probe left local diagnostics at
`<host-temp>\donelayer-marker-proof-YNwNhH`. They are
not Gate evidence and were not deleted after the fail-closed stop.

## 10. Deliberate-Failure Recovery

**PASS before the later cleanup blocker.** Attempt 3 wrote all records from
scratch, threw `DELIBERATE_POST_PERSISTENCE_FAILURE`, closed the primary
database, reopened it, and recovered the same identifiers and hashes. Job and
store integrity checks passed. A later read-only WAL-mode audit left a zero-byte
`reputation-entry-persistence-preflight-attempt-3.sqlite-wal` sidecar (SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`) and a
32,768-byte `reputation-entry-persistence-preflight-attempt-3.sqlite-shm`
sidecar (SHA-256
`fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb`).
The primary database hash remained unchanged. These sidecars were retained.

## 11. Exact Recovered Lifecycle Records

1. `JOB_IDENTITY`
2. `AGENT_PROFILE_BINDING`
3. `SOURCE_IDENTITY`
4. `WORK_CONTRACT`
5. `AUTHORITY_LEASE_ISSUED`
6. `EXECUTION_IDENTITY`
7. `EVIDENCE_BUNDLE_INTERMEDIATE`
8. `VERIFIER_RESULT`
9. `AUTHORITY_LEASE_REVOKED`
10. `EVIDENCE_BUNDLE_FINAL`
11. `EVIDENCE_LEDGER_FINAL`
12. `VERIFIED_JOB_RECEIPT`

Final lifecycle-chain SHA-256:
`0baa912daba85400c53183964c5b723543bdc4cb8d53cddc10988040d437b17b`.

## 12. Contract Hash Recomputation

**PASS.** The canonical Work Contract domain excludes exactly
`workContractSha256`. Its recomputed and stored SHA-256 is
`38b64c2e49dff1525ee52a86df1f77352c047d79b479d5a362250d5e14c4fa27`.
Authority and Receipt bind to this same hash. The self-hash field is excluded
because including it would make the digest input depend on its unknown output.

## 13. Durable Payload Hash Recomputation

**PASS.** The complete persisted Work Contract includes its hash field. Its
recomputed and stored SHA-256 is
`e3cccb78c243d346a2bf13df71c0d6bf6e8015ec50ba58afdf5d0e34967f8fda`.
The two domains are stable and intentionally distinct. A read-only audit
recomputed every durable payload and lifecycle entry successfully.

## 14. Tampering Test Results

All required assertions ran and passed before the cleanup failure:

- covered Work Contract field: detected
- command value: detected
- added command argument: detected
- Source identity: detected
- internally rehashed but Contract-rebound Authority Lease: binding mismatch detected
- Evidence Bundle covered content: Receipt binding mismatch detected
- internally rehashed but Contract-rebound Receipt: binding mismatch detected
- self-hash mutation: detected while the self-hash-excluded domain stayed stable
- durable-record overwrite: denied
- key-order-only canonical reload: accepted, not treated as tampering

The historical-marker copy mutation produced the expected
`HISTORICAL_PILOT_MARKER_INTEGRITY_MISMATCH`. Cleanup then failed because the
throwing constructor had already opened a database handle and did not close it.

## 15. Lease Final State

- Lease ID: `d1cfba1d-98e3-4a42-b528-6229d9bdfca5`
- Authority SHA-256: `e9e2cc49ae1d3a0eae7863e2156016e0732f8c385ecb16b222b853a1cfe89421`
- Final status: **`REVOKED`**
- Revoked at: `2026-09-04T00:00:10.000Z`

## 16. Full Validation Results

- TypeScript strict check: PASS
- Focused canonical comparison tests: PASS, 5/5
- Complete persistence/restart flow: reached all persistence, restart,
  recomputation, binding, and tampering assertions
- Durable records: PASS, 14/14 recomputed
- Lifecycle chain: PASS, 12/12 recomputed
- Historical marker mismatch detection: PASS
- Historical marker probe cleanup: **FAIL**

```text
EBUSY: resource busy or locked, unlink
'<host-temp>\donelayer-marker-proof-YNwNhH\marker-proof.sqlite-shm'
```

- Retained-evidence reload test: FAIL with `ENOENT` because the PASS JSON was
  not written after the first test failed
- Full preflight file: FAIL, 0/2 tests passed
- Broader suite/build/lint: not run after the new blocker

## 17. Model Requests

0.

## 18. Sandboxes

0.

## 19. External Effects

No replacement Job, Fixture branch/Commit, PR, merge, deployment, payment,
blockchain action, billing change, Snapshot, external network action, or
credential expansion occurred. Local effects were limited to the authorized
source/test correction, Attempt 3 database, report/status records, and retained
SQLite sidecars and temporary diagnostic directory.

## 20. Phase A Decision

**FAIL / BLOCKED.** The command comparison is corrected and its tests pass, but
the SQLite cleanup defect prevents a complete preflight PASS.

## 21. Phase B Status

Phase B was not started and remains blocked. No replacement Job ran.

## 22. Exact Next Action Requiring Owner Approval

The Owner must separately authorize a narrow correction that guarantees the
SQLite database opened during a failing `ReputationEntryDurableStore`
constructor is closed, validates cleanup on Windows, preserves Attempts 1-3
unchanged, and permits a fourth complete Phase A run using a new Attempt 4
database. That correction and rerun are not authorized by Attempt 3.
