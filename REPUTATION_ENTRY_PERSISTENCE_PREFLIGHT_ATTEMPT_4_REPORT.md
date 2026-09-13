# Reputation Entry Persistence Preflight Attempt 4 Report

Date: 2026-09-04

## Decision

**PHASE A: PASS. PHASE B: NOT AUTHORIZED.**

The durable-store constructor now releases its SQLite resource when fallible
initialization fails. Focused lifecycle tests passed on Windows, and the
complete Phase A persistence preflight passed from a new Attempt 4 database.
No replacement Job, model request, Sandbox, branch, Commit, PR, merge,
deployment, payment, blockchain action, billing change, Snapshot, credential
expansion, or other external action occurred.

## 1. Attempt 3 Exact Blocker

Attempt 3's historical-marker tamper probe correctly threw
`HISTORICAL_PILOT_MARKER_INTEGRITY_MISMATCH`, but construction failed after
SQLite had opened. The caller never received a store instance and therefore
could not call `close()`. On Windows the leaked handle retained
`marker-proof.sqlite-shm`, and immediate temporary-directory cleanup failed
with `EBUSY`.

## 2. Resource Leak Root Cause

`ReputationEntryDurableStore` opened `DatabaseSync`, enabled WAL mode,
initialized its schema, and bound the historical marker in one constructor.
The PRAGMA, schema, and marker operations were fallible but had no internal
cleanup boundary. A marker mismatch escaped the constructor while the opened
database remained live.

## 3. Exact Cleanup Implementation Change

The existing constructor still validates absolute paths, creates the parent
directory, and opens `DatabaseSync`. Its fallible PRAGMA, schema, and marker
initialization now run in `try`. On failure it calls the store's idempotent
`close()` and rethrows the original initialization error. If closing itself
fails, an `AggregateError` retains both failures and uses the original
initialization failure as its cause.

## 4. Constructor Or Factory Semantics

The public constructor and `close()` API did not change. No factory was added.
Successful construction still transfers ownership of the open database to the
returned store. Failed construction now closes the resource before the error
escapes. `close()` remains idempotent.

## 5. Failed-Initialization Cleanup Test

**PASS on `win32`.** A valid store was created first, with both WAL and SHM
observed while it was open. After its marker was changed, a second constructor
opened the existing SQLite database and threw the exact expected
`HISTORICAL_PILOT_MARKER_INTEGRITY_MISMATCH`. The original error was preserved.
After the failure, the primary database existed while WAL and SHM were already
absent because the failed constructor had closed the final handle.

## 6. Normal Open/Close Test

**PASS.** The focused test opened a fresh store, appended and read a durable
record, closed the store, immediately removed all present SQLite files, and
removed the containing temporary directory.

## 7. Repeated Lifecycle Test

**PASS.** A fresh store completed `open -> write -> close -> open -> read ->
close`, then all present SQLite files and the temporary directory were removed.
A separate assertion called `close()` twice without error and confirmed that
subsequent store operations remained rejected as closed.

## 8. Windows File-Lock Cleanup Result

**PASS.** The corrected full preflight ran on `win32`. During the initial live
probe both `marker-proof.sqlite-wal` and `marker-proof.sqlite-shm` existed.
After deliberate constructor failure both sidecars were absent; the database
was unlinked immediately, and the containing temporary directory was removed.
No sleep, arbitrary wait, retry loop, process termination, ignored `EBUSY`, or
weakened assertion was used.

## 9. Attempts 1-3 Preservation Status

All captured identities were equal before and after Attempt 4. The historical
marker remained SHA-256
`5d90116229342b94fa9ef935e2c5780d2a0655143ec121db78b8c58176fd598f`.

| Attempt | Result remains | Database SHA-256 | Report SHA-256 |
| --- | --- | --- | --- |
| 1 | FAIL: invalid cross-hash-domain assertion | `ad2a27aa75976d7a3202f6368fd21ccfa15b9c6fe81cb0f967b8f76e97f666af` | `33efab2d26727e9a18d108b6d33d91f0c8615000c8b9deceea01cb962cfe3a1c` |
| 2 | FAIL: corrected hash semantics, blocked by order-sensitive structural comparison | `99f924efb22dea0dc1cea2c460f66be2469588771e55f2b66fbc59aa3de6a11c` | `4c89f39d124375d51abf2f524fdc579b38e75eda266833730fe22e98878c178c` |
| 3 | FAIL: canonical structural comparison and tamper tests passed, blocked by constructor-failure handle leak | `648340d1e74699cfe052257b696b83977f0ed455e231bcfc231bb82ea27acf15` | `141cd03ace2caef7025018a0b6243be7b1fdfc17903e3faf558b3ddd1d479c2d` |

Each retained database is 69,632 bytes. Each retained WAL is zero bytes with
SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
Each retained SHM is 32,768 bytes with SHA-256
`fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb`.
None was opened, changed, deleted, relabeled, or promoted by Attempt 4.

The recorded lineage is:

```text
Attempt 1: invalid hash-domain assertion
-> Attempt 2: corrected hash semantics; blocked by order-sensitive comparison
-> Attempt 3: canonical structural comparison and tamper tests passed;
              blocked by constructor-failure SQLite handle leak on Windows
-> Attempt 4: constructor failure cleanup fix
```

## 10. Attempt 4 Database Path And Hash

- Database: `test-results/reputation-entry-persistence-preflight-attempt-4.sqlite`
- Size: 73,728 bytes
- SHA-256: `280d616ec1366ab00d81962b73fb5dfefe9e0b97fe9b71a64dbac20afeae8162`
- Evidence: `test-results/reputation-entry-persistence-preflight-attempt-4-evidence.json`
- Evidence SHA-256: `ea6a994968b93cd1dac2a192e8cb5cf6d409b4d11fc661a87237cd2850401b36`
- Durable records: 14, comprising two global profile/lineage records and 12
  Job-bound records
- Lifecycle entries: 12

## 11. Deliberate-Failure Recovery Result

**PASS.** Attempt 4 wrote every required record, deliberately threw
`DELIBERATE_POST_PERSISTENCE_FAILURE`, closed the primary store, reopened it,
and recovered exact values. The retained-evidence test reopened the final
database again and reverified it without changing its primary hash.

## 12. Recovered Lifecycle Records

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

Lifecycle-chain SHA-256:
`14b8e94a440605e0ab7c5d783b29580e6943e9bcc6c5ab8ce081fbf35f8c34fa`.

## 13. Contract Hash Recomputation

**PASS.** The canonical Work Contract domain excludes only
`workContractSha256`. Stored and recomputed SHA-256:
`38b64c2e49dff1525ee52a86df1f77352c047d79b479d5a362250d5e14c4fa27`.
The Authority Lease, execution identity, and Receipt bind to this same hash.

## 14. Durable Payload Hash Recomputation

**PASS.** The complete persisted Work Contract includes its self-hash field.
Stored and recomputed SHA-256:
`e3cccb78c243d346a2bf13df71c0d6bf6e8015ec50ba58afdf5d0e34967f8fda`.
All 14 durable record payloads and all 12 lifecycle entries recomputed
successfully. The full-payload and Contract hash domains remain intentionally
distinct.

## 15. Tampering Results

**PASS.** Attempt 4 independently detected covered Work Contract mutation,
command mutation, added command argument, Source identity mutation,
internally rehashed Authority rebinding, Evidence Bundle covered-content
mutation, internally rehashed Receipt rebinding, and self-hash mutation.
Key-order-only canonical reload remained accepted, while argument and command
array order remained protected by the focused semantic tests.

## 16. Historical Overwrite-Protection Result

**PASS.** A different payload for the existing Work Contract identity was
rejected with `DURABLE_RECORD_OVERWRITE_DENIED`. The copied historical marker
mutation was detected without touching the real marker, and all Attempts 1-3
file identities remained equal before and after the probe.

## 17. Lease Final State

- Lease ID: `708057d9-6652-402f-98b4-860030b83eec`
- Authority SHA-256: `a264897d684fe0d8b977a34c0c7b7599d654424a407be6fe9f85d873231877b4`
- Final status: **`REVOKED`**
- Revoked at: `2026-09-04T00:00:10.000Z`

## 18. Full Validation Results

- Focused lifecycle tests: PASS, 4/4
- Existing focused canonical comparison and mutation tests: PASS, 5/5
- Combined focused run: PASS, 9/9 across 2 files
- TypeScript strict check: PASS
- Complete fresh Attempt 4 preflight: PASS, 2/2
- Retained Attempt 4 evidence reload: PASS, 1/1; creation test correctly skipped
- Store verification: PASS, 14 durable records, 12 lifecycle entries, 1 Job
- Main store close: PASS; repeated close: PASS
- Windows constructor-failure deletion probe: PASS with zero waits/retries
- Broader repository lint, production build, and unrelated test suites: not run;
  this authorization and decision Gate were scoped to the focused cleanup,
  canonical-integrity, strict-TypeScript, and complete Phase A validations above

## 19. Model Requests

0.

## 20. Sandboxes

0.

## 21. External Effects

No replacement Job ran. No Fixture branch or Commit was prepared. No branch,
Commit, PR, merge, deployment, payment, blockchain action, billing change,
Snapshot, network action, or production credential expansion occurred. Local
effects are limited to the authorized implementation/test correction, new
Attempt 4 SQLite/evidence files, this report, and status documentation.

## 22. Phase A Decision

**PHASE A: PASS.**

## 23. Phase B Status

Phase B did not start and remains blocked. Neither replacement Job executed.

## 24. Exact Next Action Requiring Owner Approval

Stop for Owner review. A separate Owner decision must explicitly authorize
Phase B and execution of the bounded replacement evidence-collection Jobs
before any replacement Fixture preparation, model call, managed Sandbox, or
other Phase B effect may begin.
