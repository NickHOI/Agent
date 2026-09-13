# ATTEMPT 3 LIFECYCLE EVIDENCE — VALIDATED

Date: 2026-09-04

## Decision

The owner-authorized **VERSION-AWARE LIFECYCLE VERIFIER CORRECTION + READ-ONLY
REVALIDATION OF IMMUTABLE ATTEMPT 3** is complete.

The corrected canonical verifier returns `valid: true` for the immutable Phase
B Attempt 3 database. This validates lifecycle integrity only. It does not
change Attempt 3 from `PARTIAL / BLOCKED`, change either Job result, create a
`VERIFIED_DELIVERY`, promote a candidate, add to the canonical qualifying
corpus, or start Evidence-Based Reputation.

No Attempt, Job, model call, Sandbox, Contract, Lease, Receipt, lifecycle entry,
Fixture mutation, or external action was created by this correction.

## Exact Bug

`durable_records` preserves each record's `record_version`, canonical payload,
and payload SHA-256. Phase B stored two `AGENT_MODEL_RUN` records under the same
`record_type` and `record_id` for each Job:

- version 1: the model run request
- version 2: the returned model run result

The original `recoverJob()` reconstructed a map keyed only by
`record_type:record_id`. Insertion of V2 replaced the V1 digest. The V1
lifecycle entry then compared against the V2 digest and was falsely rejected.

The missing discriminator was `record_version`. The lifecycle table does not
store it directly, but every lifecycle entry already stores the exact payload
SHA-256. The exact durable record and its preserved version can therefore be
resolved without changing historical rows or hashes by the tuple:

```text
record_type + record_id + payload_sha256
```

Attempt 3 contains no other Job-bound record type with repeated versions under
one type/ID. Global `PILOT_OUTCOME` has versions 1 and 2 but is not Job-bound
and has no lifecycle entry, so it does not share this lifecycle defect.

## Canonical V1 And V2 Definitions

Both versions retain strict object shapes. Stored bytes are parsed without
migration, upgrade, downcast, optional-field fallback, or latest-schema
reinterpretation.

`AGENT_MODEL_RUN` V1 is the `REQUESTED` record:

```text
status: "REQUESTED"
model: exact full AgentExecutionModel object
maxSteps: bounded integer
maxOutputTokens: bounded integer
providerRetryLimit: 1
```

`AGENT_MODEL_RUN` V2 is the returned run record:

```text
runId
status: "COMPLETED" | "CANCELLED" | "FAILED"
model: exact full AgentExecutionModel object
text
finishReason
stepCount
toolNames: ordered controlled-tool array
responseIds: ordered string array
usage: exact token/request/cost object
startedAt
finishedAt
```

The model object and nested pricing object are strict. The V2 usage object is
strict. Unknown fields or missing required fields fail. Unknown versions fail
closed.

Original persistence semantics are unchanged:

```text
payload_json = canonicalJson(payload)
payload_sha256 = sha256Canonical(payload)
lifecycle entry hash = sha256Canonical(original lifecycle fields)
```

Canonical object keys remain order-independent. Array order and every stored
semantic field remain hash-covered.

## Code Correction

The correction:

1. Adds explicit strict V1 and V2 validators for `AGENT_MODEL_RUN`.
2. Validates the exact recovered version before accepting a lifecycle binding.
3. Resolves lifecycle records by type, ID, and exact payload SHA-256, requiring
   exactly one matching durable record.
4. Recomputes the full canonical payload hash before version validation.
5. Fails closed for missing, invalid, relabeled, or unknown versions.
6. Adds a true immutable SQLite read mode using `readOnly: true` and
   `immutable=1`; schema initialization, metadata binding, and writes are
   unavailable in this mode.
7. Makes candidate-marker semantics explicit and retains `result ===
   "VERIFIED"` as the verified-candidate result condition.

Files changed for this authorization:

- `apps/web/src/server/reputation-entry-pilot/durable-record-versions.ts`
- `apps/web/src/server/reputation-entry-pilot/durable-store.ts`
- `apps/web/src/server/reputation-entry-pilot/candidate-evidence.ts`
- `apps/web/src/server/reputation-entry-pilot/orchestrator.ts`
- `tests/unit/reputation-entry-lifecycle-versioning.test.ts`
- `tests/unit/reputation-entry-pilot.test.ts`
- `tests/integration/reputation-entry-phase-b-attempt-3-revalidation.test.ts`
- `tests/integration/reputation-entry-phase-b-attempt-3-blocked-evidence.test.ts`
- `docs/CURRENT_PHASE.md`
- `IMPLEMENTATION_STATUS.md`
- this report

The accepted Attempt 3 blocker report was not edited.

## Focused Version Tests

Focused result: **25/25 passed across four files**.

The version-aware unit suite proves:

1. valid V1 verifies
2. valid V2 verifies
3. V1 remains V1 after read-only reload
4. V2 remains V2 after read-only reload
5. dropped `record_version` fails
6. V1 relabeled as V2 fails
7. V2 relabeled as V1 fails
8. a changed version-covered field fails its historical hash
9. an unknown version fails closed
10. canonical object equivalence and ordered-array semantics remain unchanged
11. V1 is not interpreted through the V2 schema
12. V2 is not downcast through the V1 schema

Additional focused proofs validate same-ID V1/V2 lifecycle binding, read-only
write denial, byte-identical read-only access, resource cleanup, and candidate
status semantics.

The first direct read-only Attempt 3 check validated every record and lifecycle
binding but failed its final no-sidecar assertion because SQLite's ordinary
read-only WAL transport created an empty WAL and an SHM file. The database hash
remained unchanged. Those ephemeral files were removed, the store was tightened
to `readOnly: true` plus `immutable=1`, and both the focused revalidation and
the final full suite then passed without recreating sidecars.

## Immutable Database Revalidation

- Database: `test-results/reputation-entry-phase-b-attempt-3.sqlite`
- SHA-256 before: `30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37`
- SHA-256 after: `30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37`
- Durable records: `79`
- Lifecycle entries: `76`
- Jobs: `2`
- Corrected canonical `verifyAll()`: `valid: true`
- Historical marker SHA-256: `5d90116229342b94fa9ef935e2c5780d2a0655143ec121db78b8c58176fd598f`
- WAL after revalidation: absent
- SHM after revalidation: absent
- Rows, records, hashes, and artifacts written: `0`

Attempt 3 evidence remains byte-identical:

- Evidence JSON SHA-256: `49e54b83129310603bea9d3ac93301b528426e0036f00ac07c7c934374793077`
- Blocker report SHA-256: `409fd66ee5112db1ca9dc5ba833ce71bae1bd995c734ba97e543e6505576d43b`
- Source-preflight JSON SHA-256: `f21f00f54bbdf22e17c81742c7bbb96071f61283fd9aa061ef9e8b8f77bc86b3`
- Working-tree identity SHA-256: `8a9e3c8c15555677a4ea6c7e1a1b2eb792a6203caf6d0de07321f21c637da9b6`

## Job Revalidation

| Check | `TEST_AND_FIX` | `BUILD_RESCUE` |
| --- | --- | --- |
| Job ID | `020a154d-91ef-4bc9-af43-667f515256da` | `bb07c73d-bf46-4d09-af25-0b895f99c627` |
| Lifecycle validity | `VALID` | `VALID` |
| Lifecycle entries | `47` | `29` |
| Lifecycle head | `c067bef7e5242092d23b82f84dd6398a7edb683aa0b97a9202bd872e30087eea` | `788c9a32732667e6922dc12e77c619235540889f36c14979df806615e1332c1b` |
| Model-run versions | V1 + V2 | V1 + V2 |
| Persisted model requests | `7` | `2` |
| Contract binding | `VALID` | `VALID` |
| Authority binding | `VALID`; terminal `REVOKED` | `VALID`; terminal `REVOKED` |
| Evidence Bundle | `VALID` | `VALID` |
| Ledger | `VALID` | `VALID` |
| Receipt | `VALID`, result `FAILED` | `VALID`, result `INCONCLUSIVE` |
| Repair cleanup | `VALID` | `VALID` |
| Verifier cleanup | `VALID` | `VALID` |

Evidence Bundle SHA-256 values remain:

- `TEST_AND_FIX`: `1a1e6bde07c1fdb4090606cb6568990b24c3fd043a672231630bb220063eb3ef`
- `BUILD_RESCUE`: `668c8e6a7bc7e28234bf13bf3bcf969bd82b4a3645482b5a44ec168ae95fd764`

Final Ledger SHA-256 values remain:

- `TEST_AND_FIX`: `54762893dcc6ac84b42c110d4a56cab1f299393d06308ad552d5c0d3be3518aa`
- `BUILD_RESCUE`: `089eb0118adbdb3796fb10668c7c2991ebcc171164d2e512625910a65d8bd612`

Receipt SHA-256 values remain:

- `TEST_AND_FIX`: `76b99d1be2c4052d638b622f2ebe51ac30b029995e44e7fa7df780a5401cb6ee`
- `BUILD_RESCUE`: `3ea69ffe3239008a1e6b4ceaef9f48c3653ffb6491e4d4cbcb01ca24bed7c891`

## Immutable Outcome Semantics

`TEST_AND_FIX` remains `FAILED`. Its one-file patch and successful fresh
independent verification remain valid facts, but the Agent/model run ended
`FAILED`. Lifecycle validity does not supply the missing successful run state.
`VERIFIED_DELIVERY` remains **NOT ACHIEVED**.

`BUILD_RESCUE` remains `INCONCLUSIVE`. No patch was produced and independent
verification retained the failing baseline. `VERIFIED_DELIVERY` remains **NOT
ACHIEVED**.

No missing evidence was invented. No Receipt or lifecycle record was replaced.

## Candidate Marker Semantics

The persisted `REPUTATION_ENTRY_CANDIDATE` field means **membership in the
candidate-collection workflow**, not successful qualification. The code now
names this explicitly as:

```text
CANDIDATE_COLLECTION_WORKFLOW_MEMBERSHIP_ONLY
```

Actual verified-candidate result counting separately requires `result ===
"VERIFIED"`. Receipts also retain `canonicalQualification.counted = false`,
`requiresOwnerDefinitionAcceptance = true`, and `requiresExplicitPromotion =
true`.

- Verified candidate count: `0`
- Canonical qualifying count added: `0`
- Canonical real Verified Job count: `0`
- Remaining Reputation entry gap: `20`
- Promotion: not authorized
- Evidence-Based Reputation: not started

## Required Validation

- Focused version-aware and Attempt 3 tests: `25 / 25` passed
- Attempt 3 corrected canonical read-only lifecycle validation: passed
- Lint: passed with zero warnings
- Strict typecheck: passed
- Full suite: `233 / 233` active tests passed; 11 intentionally skipped
- Web production build: passed
- Worker build: passed
- `git diff --check`: passed; only pre-existing line-ending warnings were emitted

## External Effects

- Model calls: `0`
- Sandboxes: `0`
- New Attempt or Job: `0`
- New Work Contract or Permission Lease: `0`
- Attempt 3 row/hash/Receipt/lifecycle mutations: `0`
- Fixture mutations, PRs, merges, deployments, payments, blockchain actions,
  billing actions, Snapshots, and Reputation actions: `0`

## Exact Next Action

Stop for Owner review. The Owner must explicitly accept or reject this
version-aware verifier correction and the classification **ATTEMPT 3 LIFECYCLE
EVIDENCE — VALIDATED** while retaining **PHASE B ATTEMPT 3 — PARTIAL /
BLOCKED**. No Attempt 4, Job rerun, candidate promotion, Reputation work, or
later Gate is authorized by this result.
