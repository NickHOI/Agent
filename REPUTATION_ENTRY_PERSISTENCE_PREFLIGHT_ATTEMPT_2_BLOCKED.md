# Reputation Entry Persistence Preflight Attempt 2 Blocked

Date: 2026-09-04

## Decision

**PHASE A ATTEMPT 2: FAIL / BLOCKED. PHASE B: NOT AUTHORIZED.**

The corrected cross-domain hash assertions passed, but a new canonical
serialization compatibility blocker appeared before the mandatory tampering
negative tests and retained JSON summary completed. Execution stopped
fail-closed. No model, Sandbox, replacement source, or replacement Job was used.

## 1. Original Assertion Error

Attempt 1 reported:

```text
Expected: 38b64c2e49dff1525ee52a86df1f77352c047d79b479d5a362250d5e14c4fa27
Received: e3cccb78c243d346a2bf13df71c0d6bf6e8015ec50ba58afdf5d0e34967f8fda
```

The invalid assertion equated the complete persisted Contract payload hash with
the Contract's self-hash-excluded integrity hash.

## 2. Hash-Domain Definitions

`canonicalJson` recursively removes object properties whose values are
`undefined`, sorts object keys lexically, preserves array order, serializes with
`JSON.stringify`, and rejects unsupported or non-finite values.
`sha256Canonical` hashes the resulting UTF-8 JSON bytes.

### Complete persisted payload hash

Object: the entire `ReputationEntryWorkContract`, including
`workContractSha256` and every other persisted field.

```text
sha256Canonical(completeContract)
= e3cccb78c243d346a2bf13df71c0d6bf6e8015ec50ba58afdf5d0e34967f8fda
```

This is the durable record's byte-integrity hash.

### Canonical Work Contract hash

Object: the same Contract after destructuring out exactly
`workContractSha256`. All remaining Contract fields are included.

```text
const { workContractSha256, ...contractBody } = contract;
sha256Canonical(contractBody)
= 38b64c2e49dff1525ee52a86df1f77352c047d79b479d5a362250d5e14c4fa27
```

The self-referential field is excluded because including a digest inside the
bytes used to compute that digest would require the final digest value before
those bytes are finalized. Integrity validation recomputes the body hash and
compares it with the stored field.

Authority `workContract.sha256`, execution identity `workContract.sha256`, and
the preflight Receipt's `workContractSha256` all contain the canonical Contract
hash `38b64c...4fa27`, not the full storage-payload hash.

## 3. Exact Assertion Change

Removed invalid cross-domain equality:

```ts
expect(persistedContract.payloadSha256)
  .toBe(fixtures.contract.workContractSha256);
```

Replaced it with domain-specific recomputation:

```ts
expect(persistedContract.payloadSha256)
  .toBe(sha256Canonical(reloadedContract));

const { workContractSha256, ...contractBody } = reloadedContract;
expect(workContractSha256)
  .toBe(sha256Canonical(contractBody));

expect(persistedContract.payloadSha256)
  .not.toBe(workContractSha256);
```

These assertions passed after restart. No integrity check was removed.

## 4. Old Failed Evidence State

- Attempt 1 database:
  `test-results/reputation-entry-persistence-preflight.sqlite`
- Size: 69,632 bytes
- SHA-256:
  `ad2a27aa75976d7a3202f6368fd21ccfa15b9c6fe81cb0f967b8f76e97f666af`
- Attempt 1 blocker report SHA-256:
  `33efab2d26727e9a18d108b6d33d91f0c8615000c8b9deceea01cb962cfe3a1c`
- Historical pilot marker SHA-256:
  `5d90116229342b94fa9ef935e2c5780d2a0655143ec121db78b8c58176fd598f`

All three remained unchanged during Attempt 2.

## 5. New Evidence Database State

- Attempt 2 database:
  `test-results/reputation-entry-persistence-preflight-attempt-2.sqlite`
- SHA-256 at blocked-report capture:
  `99f924efb22dea0dc1cea2c460f66be2469588771e55f2b66fbc59aa3de6a11c`
- Durable records: 14, including two global lineage/profile records and 12
  Job-bound lifecycle records
- Lifecycle entries: 12
- Retained JSON summary: not written; it is not reconstructed after failure
- Lineage record:
  `REPLACEMENT_PREFLIGHT_ATTEMPT_NOT_HISTORY_REWRITE`

## 6. Deliberate-Failure Recovery

The store committed every required record, deliberately threw
`DELIBERATE_POST_PERSISTENCE_FAILURE`, closed, reopened, and recovered the exact
same records. `recoverJob().integrityValid` and `verifyAll().valid` both passed
before the later semantic Contract validation failed.

## 7. Lifecycle Records Recovered

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

The recovered execution ID is `exe_PERSISTENCE_PREFLIGHT_0001`. The new Lease
ID is `af576e64-c6ca-4fe8-ab39-57b6abf58331` with authority SHA-256
`4f882369c905bd38a0a4f948ba0d4d2517ceb40e2b0010267a09c1affaf6b587`.

## 8. Canonical Hash Recalculation

- Complete payload hash recomputation: PASS
- Self-hash-excluded Contract body recomputation: PASS
- Stability across reload: PASS
- Expected distinction between domains: PASS
- Store-wide record/lifecycle recomputation: PASS before semantic validation
- Authority, Execution, and Receipt values observed to equal the canonical
  Contract hash: yes, but their explicit Gate assertions were after the new
  failure point and are not counted as completed validation

## 9. Tampering Negative Tests

**NOT RUN / NOT PASSED.** They were placed after semantic Contract validation
and were not reached once that validation failed. No result is inferred.

## 10. Lease Final State

`REVOKED` at `2026-09-04T00:00:10.000Z`.

## 11. New Blocker And Validation

`assertReputationEntryWorkContractIntegrity` compares command arrays using
order-sensitive native `JSON.stringify`. The durable store reloads canonical
JSON with lexically sorted object keys:

```json
[{"command":"npm test","expectedExitCode":0,"id":"strict-port-parser-tests","role":"PRIMARY"}]
```

The in-memory task definition uses a different key insertion order:

```json
[{"id":"strict-port-parser-tests","role":"PRIMARY","command":"npm test","expectedExitCode":0}]
```

The objects are semantically identical, but native strings differ, producing
`REPUTATION_ENTRY_WORK_CONTRACT_TAMPERING_DETECTED`.

Validation results:

- TypeScript strict check: PASS before Attempt 2
- Corrected hash-domain recomputation: PASS
- Durable restart recovery: PASS
- Store and lifecycle integrity: PASS
- Semantic Contract reload validation: FAIL
- Tampering negative tests: NOT RUN
- Retained preflight JSON recomputation: NOT RUN because no JSON was written

## 12-14. Usage And External Effects

- Model requests: 0
- Sandboxes: 0
- Replacement Jobs: 0
- Replacement branches/commits: 0
- PR, merge, deployment, payment, blockchain, billing, Snapshot, production
  credential expansion: 0

## 15-17. Final Disposition

- Phase A: **FAIL / BLOCKED**
- Phase B: **remains blocked and was not started**
- Exact next action requiring Owner approval: replace the command comparison's
  native `JSON.stringify` calls with canonical structural comparison, retain
  Attempts 1 and 2 unchanged, and authorize a third Phase A preflight using a
  new Attempt 3 evidence database. No such correction or rerun is currently
  authorized.
