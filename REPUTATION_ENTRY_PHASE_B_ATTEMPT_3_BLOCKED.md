# Phase B Attempt 3 Blocked Report

Date: 2026-09-04

## Decision

**PHASE B ATTEMPT 3: PARTIAL / BLOCKED.**

The mandatory pre-lifecycle Source, credential, and provider preflight passed.
Both authorized Jobs then ran within the aggregate limits, but neither produced
a successful Verified Job result. The persisted batch decision is `PARTIAL`
with zero verified candidates. Evidence-Based Reputation did not start.

**PHASE B ATTEMPT 2 — HISTORICAL FAIL / BLOCKED** remains the permanent
classification of Attempt 2. Attempt 1 and Attempt 2 evidence remained
byte-identical during Attempt 3 and was not retried or overwritten.

## Pre-Lifecycle Preflight

Preflight evidence:
`test-results/reputation-entry-phase-b-attempt-3-source-preflight.json`

- Preflight: `PHASE_B_SOURCE_AND_PROVIDER_PREFLIGHT_V1`
- Status: `PASS`
- Internal evidence SHA-256: `2f32b0b3d8c7288db7032edebef4679756a99e46ec30366d0f4e8dd14b577d35`
- File SHA-256: `f21f00f54bbdf22e17c81742c7bbb96071f61283fd9aa061ef9e8b8f77bc86b3`
- Started: `2026-09-04T14:59:59.381Z`
- Completed: `2026-09-04T15:00:09.105Z`
- Job lifecycle state at completion: not created
- Model requests: `0`
- External mutation: `0`

The local structural claims audit found a three-part JWT with parseable header
and payload, current `iat`/`nbf`/`exp` values, and an expiry of
`2026-09-05T02:51:15.000Z`. Its project, project ID, owner/team ID,
development environment, issuer, audience, scope, and subject matched the
linked `nickhois-projects/donelayer` project in `.vercel/project.json`. The
authenticated Vercel AI Gateway availability/catalog check passed with two
eligible zero-price tool/reasoning models and a positive existing balance. No
model inference was requested by the preflight.

The exact production materializer independently resolved and materialized both
approved refs, reproduced the Attempt 2 Source hashes, and removed its temporary
workspaces:

| Task | Ref | Exact commit | Manifest SHA-256 | Source package SHA-256 |
| --- | --- | --- | --- | --- |
| `TEST_AND_FIX` | `donelayer/repair/reputation-state-transition-v2` | `2839dd96b644e2e435e11c66c37a6fdacd264d6c` | `68d8d3a2024c8674817c13dd8dbd920e837ab069bd3cb90aa66bf9afbd9071a8` | `83506c2455663c01acc0fab6cb5db0cf332b26977ce55e92899cd37952e02514` |
| `BUILD_RESCUE` | `donelayer/repair/reputation-build-config-v2` | `433257234caddbd0ee13d854d23adb78113b1f90` | `c7b0f1e070bb480da7b804d236eea4f3cc45bd14d79749fcb5dfd2f2ecf3539e` | `647a19121d3890580924e0f1b3f46184f44020e68ee457eeb1ae173b5b4f4348` |

## Attempt And Agent Identity

- Attempt ID: `PHASE_B_ATTEMPT_3`
- Batch record ID: `phase-b-attempt-3-batch`
- Agent ID: `agt_A0ZGNJ9qvqttApm3uWllyXQe`
- Agent profile revision: `1`
- Agent profile SHA-256: `c3e8b8360d036e63c1ca04ebbce3cad30ac39a11f341a341cbe0f8fde0c35049`
- Identity continuity across both Jobs: verified

## Job Results

### TEST_AND_FIX

- Job ID: `020a154d-91ef-4bc9-af43-667f515256da`
- Job run ID: `b88b4004-87ce-4b44-a6e2-497734c75fb3`
- Execution ID: `exe_w8OuWRuvoGD-cxnq2d8_Bhku`
- Result: `FAILED`
- V2 task definition: `REPUTATION_ENTRY_TEST_AND_FIX` / `99709cca2210ed51e9781fe2516387cf6f36d4b657472bbf444bfe247ba5f4f4`
- Work Contract: `reputation-entry-1-020a154d-91ef-4bc9-af43-667f515256da` / `ff271820c598c2632590c7155005323d0e6316394a8c09bab1de643d483b4958`
- Permission Lease: `e9c965b3-400a-40c9-8e9a-b94d9712d197` / `52cbf76cae24210364c6b76fd6cd95b601409cce21f8caa1d39a597d7f019f58`; terminal state `REVOKED`
- Model: `inclusionai/ling-3.0-flash-fin`; requests `7`; run status `FAILED`; finish reason `AI_GATEWAY_MODEL_REQUEST_FAILED`
- Controlled tools: `8/8` successful
- Patch: only `src/order-state.ts`; SHA-256 `9b3571b1dd0e51ff621fbad795faba29465c936b59241e97a2ce7d4a90b4fd6c`
- Fresh independent verification: passed, including 3/3 repository tests, protected-oracle integrity, exact patch match, and Source integrity
- Overall Job result remained `FAILED` because Agent run completion is an independent required condition and the model run did not complete successfully.

### BUILD_RESCUE

- Job ID: `bb07c73d-bf46-4d09-af25-0b895f99c627`
- Job run ID: `82bc28f8-1b6d-42d9-ac52-9e16060e7d34`
- Execution ID: `exe_PweJR8NcxS-R2-sYfHHvXvAE`
- Result: `INCONCLUSIVE`
- V2 task definition: `REPUTATION_ENTRY_BUILD_RESCUE` / `1ed29aa15efc0ec7784a3ae85d70e2ca2c79fbd5982f5d6079bfe964528ec47d`
- Work Contract: `reputation-entry-2-bb07c73d-bf46-4d09-af25-0b895f99c627` / `2ed498d4d5c1f475592c10004c5153e7523e5be2330ca08442ea0e10cd81fc4d`
- Permission Lease: `619e1d50-ee54-4cc1-970b-a1702e613310` / `899dc0ec3d8c845a6140301297dbc43a1fe49b49e1d900f8601391431b205a15`; terminal state `REVOKED`
- Model: `inclusionai/ling-3.0-flash-fin`; requests `2`; run status `FAILED`; finish reason `AI_GATEWAY_MODEL_REQUEST_FAILED`
- Controlled tools: `0`; patch: none
- Fresh independent verification: correctly failed at the unchanged baseline build; protected oracles and Source remained unchanged

## Limits And Cleanup

- Model requests: `9 / 16`
- Non-persistent Sandboxes: `4 / 4`
- Repair Sandboxes stopped and cleanup verified: `2 / 2`
- Fresh verifier Sandboxes stopped and cleanup verified: `2 / 2`
- Snapshots: `0`
- Local Attempt 3 SQLite WAL/SHM sidecars after offline audit: removed; absent
- PRs, merges, deployments, real payments, blockchain writes, billing changes,
  production credential expansion, and Fixture mutations: `0`
- Only zero-price eligible models were selected. Gateway-reported run cost was
  unavailable, so no numerical spend claim is made.

## Evidence And Receipt Integrity

Both immutable Job Evidence Bundles are complete with no missing required
category. Both Job-level final Ledgers recompute as valid, and both Receipts
pass `assertReputationEntryCandidateJobIntegrity`; validity records the actual
non-success outcomes and does not convert them into successful delivery.

| Task | Bundle SHA-256 | Final Ledger | Receipt result | Receipt SHA-256 |
| --- | --- | --- | --- | --- |
| `TEST_AND_FIX` | `1a1e6bde07c1fdb4090606cb6568990b24c3fd043a672231630bb220063eb3ef` | 45 entries / `54762893dcc6ac84b42c110d4a56cab1f299393d06308ad552d5c0d3be3518aa` | `FAILED` | `76b99d1be2c4052d638b622f2ebe51ac30b029995e44e7fa7df780a5401cb6ee` |
| `BUILD_RESCUE` | `668c8e6a7bc7e28234bf13bf3bcf969bd82b4a3645482b5a44ec168ae95fd764` | 33 entries / `089eb0118adbdb3796fb10668c7c2991ebcc171164d2e512625910a65d8bd612` | `INCONCLUSIVE` | `3ea69ffe3239008a1e6b4ceaef9f48c3653ffb6491e4d4cbcb01ca24bed7c891` |

The evidence database is preserved at
`test-results/reputation-entry-phase-b-attempt-3.sqlite` (737,280 bytes,
SHA-256 `30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37`).
It contains 79 durable records, 76 Job lifecycle entries, and two Jobs.

The built-in `ReputationEntryDurableStore.verifyAll()` result is `valid: false`.
This is a Gate blocker. Both Jobs persist `AGENT_MODEL_RUN` records with the
same record type and ID at versions 1 and 2. `recoverJob()` keys its digest map
only by record type and ID, so version 2 replaces version 1 during lookup and
the version 1 lifecycle binding is reported invalid. The lifecycle schema also
does not store `record_version`.

A separate read-only recomputation that matched lifecycle entries by record
type, record ID, and payload SHA-256 found both cryptographic chains and every
exact payload binding valid. The 47-entry TEST_AND_FIX lifecycle ends at
`c067bef7e5242092d23b82f84dd6398a7edb683aa0b97a9202bd872e30087eea`;
the 29-entry BUILD_RESCUE lifecycle ends at
`788c9a32732667e6922dc12e77c619235540889f36c14979df806615e1332c1b`.
This diagnosis does not relabel the canonical built-in verifier result or
authorize mutation of the retained database.

Final batch evidence:
`test-results/reputation-entry-phase-b-attempt-3-evidence.json` (SHA-256
`49e54b83129310603bea9d3ac93301b528426e0036f00ac07c7c934374793077`).

## Delivery And Reputation Status

- `VERIFIED_DELIVERY`: **NOT ACHIEVED** for either Job
- Persisted status field: `REPUTATION_ENTRY_CANDIDATE` for both Job records
- Verified candidate count: `0`
- Promotion recommendation: `DO_NOT_PROMOTE`
- Canonical qualifying count before Owner classification: `0`
- Canonical count added by Attempt 3: `0`
- Remaining entry gap: `20`
- Evidence-Based Reputation: not started

## Exact Next Step

Owner approval is required for one narrowly scoped, non-mutating corrective
task: make durable lifecycle recovery version-aware (or bind by the exact
payload SHA-256 already present), add the missing regression coverage, and
read-only revalidate the immutable Attempt 3 database. That authorization must
not rerun either Job, make a model request, create a Sandbox, promote a
candidate, change the qualifying definition, or begin Evidence-Based
Reputation. No Phase B Attempt 4 or further Gate is authorized.
