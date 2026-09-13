# DoneLayer Trust Foundation v1 Report

Report date: 2026-08-26 (Asia/Macau)

Branch: `feat/trust-foundation-v1`

## Result

Trust Foundation v1 is complete for one deliberately narrow boundary: the fixed, repository-free `WORKER_SMOKE_V1` Worker Infrastructure Verification workflow.

```text
Locked Task Contract v1
-> separate active Permission Lease
-> independent Node.js Worker process
-> real hello.txt and real SHA-256
-> append-only Evidence Ledger
-> independently gated Verified Job Receipt
-> signed-out Public Verify page
```

This is not a Customer coding Job Receipt. The only permitted public claim is:

> Hash-verifiable DoneLayer execution receipt.

## 1. What Was Built

- Durable product context in root `AGENTS.md` and `docs/PRODUCT_NORTH_STAR.md`, `docs/PRODUCT_ROADMAP.md`, and `docs/CURRENT_PHASE.md`.
- Versioned, canonically hashed and immutable Task Contract records linked to Job Runs.
- A separate, versioned Permission Lease with fixed scope, Server enforcement, Admin revocation, recovery reissue, violation handling and Worker-side `PermissionGuard`.
- A lightweight append-only Evidence Ledger over existing Job, event, Artifact and verification records.
- One immutable Verified Job Receipt model with receipt SHA-256, pre-receipt Evidence-chain anchor, invalidation metadata and strict public projection.
- Task Detail tabs for Contract, Permissions, Evidence and Receipt.
- Public `/receipts/[receiptPublicId]` page plus read-only Verify API.
- A non-VERIFIED `PERMISSION_VIOLATION` Receipt path for blocked violations.
- Real-process happy-path and Worker A/Worker B recovery integration evidence.

No GitHub repository was created or cloned. No external repository code, Codex CLI, Pull Request, production Supabase, Stripe, x402, A2A, ARD, C2PA, Blockchain, Capability Passport, reputation ranking or AI Transparency Kit was connected.

## 2. Durable Product Context

`AGENTS.md` fixes these stable rules: DoneLayer is an Agent Marketplace and verifiable task-execution platform; the product flow begins with a User Task and ends with evidence-backed contextual reputation and better matching; trust features are Marketplace layers; Demo must never be called Real; every milestone requires objective evidence; payment remains gated until a real GitHub vertical slice; future work must read the three durable product documents first.

Product North Star:

- Product: DoneLayer
- Positioning: a marketplace that assigns capable Agents and Workers, limits permissions, verifies work and produces trusted Job Receipts.
- Core value: `Get the job finished. Prove it works.`
- Roles: Customer, Provider, Agent, Worker, Verifier and Admin.
- Moat: real tasks x real Agents x real execution environments x limited permissions x acceptance methods x evidence x outcomes.

Roadmap state:

1. Worker Reality: COMPLETED for fixed local smoke.
2. Trust Foundation: COMPLETED for fixed local smoke and awaiting review.
3. Real GitHub Build Rescue: GATED.
4. Capability Intelligence: GATED until at least 20 real Verified Jobs, multiple task types and sufficient per-capability samples; Seed/Demo results are excluded.
5. External Agent Ecosystem: GATED.
6. Provenance Adapters: GATED.
7. Marketplace Payments: GATED.
8. AI Transparency Kit: DEFERRED.

AI Transparency Kit stays deferred until DoneLayer has stable traffic, real paying Customers, explicit demand from content businesses, a mature Evidence Ledger, and a real C2PA use case. It must extend the Evidence Ledger rather than create a duplicate data system.

## 3. Real Happy-Path Evidence

All times below are real UTC timestamps captured from `test-results/worker-reality-evidence.json`.

| Evidence | Captured value |
| --- | --- |
| Worker PID | `20552` |
| Worker ID | `20000000-0000-4000-8000-000000000002` |
| Task ID | `7b5cb5b1-7980-403e-a800-15fe75a4427a` |
| Job Run ID | `07eafcab-c49f-48ff-9ed1-88667c8fa9c1` |
| Pairing time | `2026-08-25T20:38:43.049Z` |
| Claim time | `2026-08-25T20:38:43.424Z` |
| Execution Lease ID | `3dba5ecb6f0ae5e3` |
| Execution Lease expiry | `2026-08-25T20:38:48.424Z` |
| Task Contract ID | `75a345df-e8da-490c-a0c3-82cd47ac7f6f` |
| Contract version / status | `1 / LOCKED` |
| Contract SHA-256 | `6044f8cd10dd4ba27ebaf86b66950e533ce0a96bd3c2ca58bed5af8c9b189a07` |
| Permission Lease ID | `b0f7f61f-5a1c-4759-9183-28ab2a392c91` |
| Permission version / final status | `1 / COMPLETED` |
| Permission effective / expiry | `2026-08-25T20:38:43.424Z` / `2026-08-25T20:39:43.424Z` |
| Artifact | `hello.txt`, `185` bytes, `text/plain` |
| Worker and Server Artifact SHA-256 | `b805b95a80eb51fbc4de67e5a049f18351bae511022683d5c020b38d023629e3` |
| Evidence Ledger entries | `11` |
| Receipt Evidence-chain SHA-256 | `ce7cf0f30b1145208c22595d2765c0339b70a8f99c54b8356671217e15a5a0cb` |
| Final Ledger entry SHA-256 | `009328224e4c231cec5c1f825485c76d2fab2ac9927b3ed693da9b914aee4604` |
| Receipt Public ID | `dlr_fqZKUlTfMsEejRyMnSy-kfGZ` |
| Receipt SHA-256 | `cfa75ee286970d77137a336f6d4402ecff30b19858a9e8422a82477c02e5e3c8` |
| Receipt result | `VERIFIED` |
| Final Task state | `COMPLETED` |
| Disposable workspace | `<host-temp>\donelayer-worker-reality-pftlhG\worker-b\jobs\job-77C3vx` |
| Workspace cleaned | `true`; path no longer existed after execution |

The Receipt stores the verified Ledger tail immediately before `RECEIPT_CREATED`. The final Ledger hash differs because `RECEIPT_CREATED` is then appended with its `previous_entry_sha256` equal to the stored Receipt chain hash and its `payload_sha256` equal to the Receipt SHA-256. Public Verify checks the full chain and all three anchor relations.

Real heartbeat records included an actual BUSY heartbeat for the claimed Job at `2026-08-25T20:38:43.436Z` sent and `2026-08-25T20:38:43.438Z` received, plus real ONLINE heartbeats before and after execution.

## 4. Task Contract v1

The persisted Contract includes the required task identity, outcome, deliverable, workflow, allowed and forbidden actions, seven acceptance checks with full config, required evidence, zero-dollar budget, 60-second time limit, privacy classification, human approval requirements, failure conditions and independent Contract version.

Rules proven by tests and SQLite guards:

- DRAFT content is editable and rehashed.
- LOCKED content, identity, creator, timestamps and hash are immutable and cannot be deleted.
- Revisions receive monotonically increasing versions and new SHA-256 values.
- Locking a revision supersedes the prior locked version atomically and writes Audit Log entries.
- A trusted Job Run must point to the matching LOCKED or SUPERSEDED Contract snapshot.
- Claim envelope workflow, desired outcome, checks and limits are derived from the snapshot and Permission Lease, not mutable Task flags.

## 5. Permission Lease v1

Happy-path scope:

```text
allowed_actions:
  create_job_workspace
  write_hello_txt
  calculate_sha256
  upload_artifact
  report_progress
  cleanup_workspace

allowed_paths:
  $JOB_WORKSPACE

allowed_domains: []

denied_actions:
  git
  network
  arbitrary_shell
  production_deploy
  delete_outside_workspace
  read_home_directory
  read_other_jobs
  read_credentials

max_artifact_bytes: 1048576
max_runtime_seconds: 60
max_api_budget: 0
human_approval_actions: []
```

Execution Lease ownership and Permission Lease authority are separate. Execution renewal is capped by Permission expiry. Server mutation paths reject expired, revoked, violated, wrong-Worker or wrongly-bound authority. `PermissionGuard` independently checks active time, denied-before-allowed actions, real workspace containment, exact HTTPS domains, finite cumulative API budget and Artifact/runtime limits.

Admin can revoke Permission through the existing Admin action API. Violation reporting blocks the operation, marks the Lease `VIOLATED`, writes immutable violation and verification-failure evidence, fences the Job, and produces a `PERMISSION_VIOLATION` Receipt. It cannot produce `VERIFIED`.

This enforcement claim applies only to `WORKER_SMOKE_V1`; it does not claim interception of future Codex tools.

## 6. Evidence Ledger v1

The real happy-path order was:

1. `CONTRACT_LOCKED`
2. `PERMISSION_GRANTED`
3. `JOB_CLAIMED`
4. `EXECUTION_STARTED`
5. `HEARTBEAT_RECORDED`
6. `ARTIFACT_CREATED`
7. `ARTIFACT_UPLOADED`
8. `ARTIFACT_HASH_VERIFIED`
9. `WORKSPACE_CLEANED`
10. `VERIFICATION_PASSED`
11. `RECEIPT_CREATED`

Each entry contains only a source reference, payload hash, previous-entry hash and deterministic entry hash. Large Artifact content remains in the existing Artifact store. SQLite triggers reject Ledger update or delete, and verification detects field tampering, link breaks, removal and reordering.

## 7. Verified Job Receipt v1

The immutable Receipt contains Who Requested, Who Executed, What Was Agreed, What Was Permitted, What Happened, How It Was Verified and Final Result. A formal `VERIFIED` result requires all seven Contract checks, no Permission violation, a completed Permission Lease, matching Worker/Server Artifact SHA-256, cleanup evidence and a valid ordered Ledger chain. DemoExecutor never receives a formal Verified Job Receipt.

The public projection is a strict whitelist. It exposes only Public Receipt ID, literal Task Type `Worker Infrastructure Verification`, public Agent/Worker aliases, Contract hash, Evidence-chain hash, Artifact hash, sanitized verification summary, result, timestamp, integrity and invalidated/disputed disposition. It excludes Customer reference, Task/Job/Lease/internal Receipt IDs, PID, capability snapshot, paths, tokens, secrets, raw logs, Artifact content, and full Permission scope.

## 8. Public Verify Page

Route: `/receipts/dlr_fqZKUlTfMsEejRyMnSy-kfGZ`

The final signed-out Browser run used `http://127.0.0.1:3201/receipts/dlr_fqZKUlTfMsEejRyMnSy-kfGZ` against the captured real-process SQLite database. The temporary Server was stopped after verification.

Observed:

- Page rendered `Worker Infrastructure Verification` and `Receipt integrity is valid`.
- Verify button called the real read-only API and recomputed Receipt/chain integrity.
- Reload preserved and reverified the same Receipt.
- Desktop and 390px mobile layouts had no horizontal overflow or incoherent overlap.
- Browser console errors: `0`.
- Sensitive-string scan found no internal Task/Job/Worker/Permission/Receipt IDs, token fields, PID labels or local paths.

## 9. Recovery Evidence

Recovery reused the same locked Contract while reissuing authority:

| Attempt | Evidence |
| --- | --- |
| Worker A | PID `33192`, Job `90805116-a5d4-40f1-8389-4bc6f1025b22`, Permission `befd70a1-8619-4109-b9e9-daff0095c9b6` v1 |
| A terminal state | Job `EXPIRED`, Permission `REVOKED`, reason `Execution Lease expired during recovery`, Worker `OFFLINE` |
| A stale operations | Lease renew, event, Artifact and submit each rejected with HTTP `409` |
| Worker B | PID `28864`, Job `822102f7-a5b2-4489-a38b-4bce5a247b66`, new Permission `d8d30811-a207-438e-a4f0-ce9c75d9e5b1` v2 |
| B result | Job `SUCCEEDED`, Permission `COMPLETED`, Receipt `dlr_3bHRoxH2aJ59jyKsXILYhCIm`, Task `COMPLETED` |

Worker A received no Receipt. Only Worker B's new Job, Permission, Artifact and Evidence chain produced the successful Receipt.

## 10. Tests and Build

| Check | Result |
| --- | --- |
| `npm run lint` | PASS, zero warnings |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 22 files / 105 tests |
| Real-process integration | PASS, happy path plus real 5-second Worker A/Worker B recovery |
| `npm run build` | PASS, Next.js production build plus Worker TypeScript build |
| Public Browser verification | PASS, signed-out Verify/reload/privacy/desktop/mobile checks |
| Browser console errors | `0` |
| Captured fixture Server stderr | empty |
| Captured happy/recovery Worker stderr | empty |

The Browser harness emitted one non-fatal Next.js start-mode warning because the project uses standalone output; it produced no application Server error and the production build itself passed.

Focused unit coverage includes Contract draft/edit/lock/revision/hash/binding/migration, Permission allow/deny/expiry/revocation/path/domain/budget/violation, Execution-vs-Permission expiry, Ledger sequence/link/tamper/removal/append-only behavior, Artifact source linkage, Receipt gating/hash/anchor/invalidation/immutability/public privacy, DemoExecutor exclusion, and violation failure Receipt semantics.

## 11. Main Files Changed

- `AGENTS.md`
- `docs/PRODUCT_NORTH_STAR.md`
- `docs/PRODUCT_ROADMAP.md`
- `docs/CURRENT_PHASE.md`
- `packages/database/src/schema.ts`
- `packages/database/src/types.ts`
- `packages/database/src/trust-foundation.ts`
- `packages/database/src/demo-store.ts`
- `packages/worker-protocol/src/types.ts`
- `packages/worker-protocol/src/schemas.ts`
- `packages/worker-protocol/src/permission-guard.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/src/executors/types.ts`
- `apps/worker/src/executors/worker-smoke.ts`
- `apps/web/src/app/api/worker/jobs/claim/route.ts`
- `apps/web/src/app/api/admin/actions/route.ts`
- `apps/web/src/server/task-view.ts`
- `apps/web/src/server/public-receipt-view.ts`
- `apps/web/src/app/api/receipts/[receiptPublicId]/verify/route.ts`
- `apps/web/src/app/receipts/[receiptPublicId]/page.tsx`
- `apps/web/src/components/receipts/public-receipt-client.tsx`
- `apps/web/src/components/task-detail/task-detail-client.tsx`
- `tests/unit/task-contract.test.ts`
- `tests/unit/permission-lease.test.ts`
- `tests/unit/evidence-ledger.test.ts`
- `tests/unit/verified-job-receipt.test.ts`
- `tests/unit/trust-view.test.ts`
- `tests/integration/worker-reality.test.ts`
- `tests/integration/fixtures/worker-reality-server.ts`
- `PRODUCT_REALITY_AUDIT.md`
- `IMPLEMENTATION_STATUS.md`
- `TRUST_FOUNDATION_V1_REPORT.md`

## 12. Not Complete and Still Demo

- `WORKER_SMOKE_V1` verifies Worker infrastructure only. It is not a real Customer coding Job.
- Local SQLite and base64 Artifact persistence are not production multi-instance storage.
- Receipt hashes have no external signature, trusted timestamp, attestation, C2PA credential or production cryptographic identity.
- The internal assignment still uses an existing Seed Agent record; the public Receipt uses the explicit `DoneLayer Worker Smoke Agent` infrastructure alias. No external Agent identity was verified.
- Demo Auth, DemoStore's legacy lifecycle, DemoExecutor, synthetic repository output, Test Ledger, seed success/rating data and Demo matching remain Demo.
- Repository envelope validation remains fail-closed and partial; no GitHub ownership provider or materialization exists.
- GitHub App installation, clone/archive materialization, disposable container, `npm ci`, test/build of external code, Codex Repair, Branch, Commit and Pull Request remain paused.
- Supabase production, Stripe, x402, A2A execution, ARD, MCP invocation/credentials, C2PA, GitHub Artifact Attestations, third-party verification, Capability Passport, Contextual Reputation and AI Transparency Kit remain unimplemented or gated.
- PermissionGuard is complete only for the fixed smoke workflow and must not be described as a universal Codex tool sandbox.

## 13. Next Gate and Stop

The next and only gate is:

**REAL REPOSITORY MATERIALIZATION**

It has not started. No GitHub Clone, fixture repository, disposable container, Codex Repair or Pull Request work was performed. Work stops here pending review of this report.
