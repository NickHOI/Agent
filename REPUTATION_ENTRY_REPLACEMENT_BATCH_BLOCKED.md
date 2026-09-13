# Replacement Reputation Entry Batch Blocked Report

Date: 2026-09-04

## Decision

**PHASE A: FAIL. REPLACEMENT BATCH: BLOCKED.**

The mandatory persistence preflight did not pass. In accordance with the Owner
decision, execution stopped before Phase B. No model was called, no repair or
verifier Sandbox was created, no replacement Fixture commit was prepared, and
no replacement Job ran.

## What Persisted Before Failure

The deterministic preflight wrote durable SQLite records, deliberately threw
`DELIBERATE_POST_PERSISTENCE_FAILURE`, closed the process-local store, reopened
the database, and recovered the original values:

| Record | Recovered value |
| --- | --- |
| Agent | `agt_PERSISTENCE_PREFLIGHT_0001`, revision `1`, profile SHA-256 `3af1511c61ce33dbbdaf19fdc1ef0d408ec6c66c7b7a76e5f0d86160e8d159d6` |
| Job | `job_persistence_preflight_0001` |
| Execution | `exe_PERSISTENCE_PREFLIGHT_0001`, execution SHA-256 `0d7e541330cecedab0000de250f5cbba7c19bfc7f0dc644c7d4b3b7cee542575` |
| Work Contract | `contract_persistence_preflight_0001`, version `1`, Contract SHA-256 `38b64c2e49dff1525ee52a86df1f77352c047d79b479d5a362250d5e14c4fa27` |
| Authority Lease | `032d8a9f-c9a6-47bd-ae97-8c2eb125fc24`, issued `ACTIVE`, final `REVOKED`, authority SHA-256 `895b601b9a392e36bebc30ecf2cec452ae70b97d219904071fcbbd4e3a692fb2` |
| Intermediate Bundle | persisted at lifecycle sequence 7 |
| Verifier result | persisted at lifecycle sequence 8; deterministic local failure fixture, no Sandbox |
| Final Bundle payload | result `FAILED`, Lease `REVOKED`, payload SHA-256 `f617ece0e5ac15653d9bd6e122596eb1b0b6e65590d9b92a737b5568a9c374a4` |
| Receipt | payload includes Receipt SHA-256 `b84b1b8c0a7e0295c2babe6242fb9c234c5d8d6d9d33f4ae2b1d8d2ad0fc0f98` |
| Lifecycle | 12 append-only entries; restart integrity validation passed |

The retained database is
`test-results/reputation-entry-persistence-preflight.sqlite`, 69,632 bytes,
SHA-256 `ad2a27aa75976d7a3202f6368fd21ccfa15b9c6fe81cb0f967b8f76e97f666af`
at the time of the blocked report.

## Exact Blocker

The preflight asserted that the durable `WORK_CONTRACT` record payload SHA-256
must equal the Contract's `workContractSha256`.

- Full stored Contract document SHA-256:
  `e3cccb78c243d346a2bf13df71c0d6bf6e8015ec50ba58afdf5d0e34967f8fda`
- Contract body SHA-256 excluding its own `workContractSha256` field:
  `38b64c2e49dff1525ee52a86df1f77352c047d79b479d5a362250d5e14c4fa27`

They intentionally cover different canonical objects. The mismatch is a Gate
assertion defect, not evidence that either stored hash changed. Nevertheless,
Phase A is FAIL because the required preflight did not complete and its JSON
summary was not written. The result is not upgraded based on this diagnosis.

## Historical Evidence Protection

The previous failed-pilot recovered marker remained unchanged before and after
Phase A:

`5d90116229342b94fa9ef935e2c5780d2a0655143ec121db78b8c58176fd598f`

The durable database binds that exact marker hash in immutable persistence
metadata. No previous pilot Job was reconstructed, overwritten, upgraded, or
counted.

## External Effects And Usage

- Replacement Jobs: `0`
- Model requests: `0`
- Repair Sandboxes: `0`
- Verifier Sandboxes: `0`
- Replacement source commits or branches: `0`
- PR, merge, deploy, payment, blockchain, billing, Snapshot, credential expansion: `0`

## Corpus Status

- Canonical qualifying real Verified Jobs: **0**
- Valid replacement candidates: **0**
- Remaining canonical gap: **20**, more than one task type, and enough samples for each claimed capability
- Reputation: **not started**

## Exact Next Action

Owner approval is required to correct the Phase A hash-domain assertion and run
a new persistence preflight against a new evidence database while permanently
retaining this failed database and report. Phase B remains unauthorized until a
subsequent Phase A run passes in full.
