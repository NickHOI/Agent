# DoneLayer Implementation Status

Last updated: 2026-09-13

Status legend:

- `[x]` Implemented in the current repository
- `[~]` Implemented as an MVP boundary or preview, with production work remaining
- `[ ]` Not yet verified or not yet implemented

## Product Roadmap Boundary

`docs/PRODUCT_ROADMAP.md` is the canonical product roadmap. The numbered
implementation sections later in this file are a historical MVP engineering
inventory, not competing product phases. The current strategic order is
Verified Work, task-scoped Authority, Agent Identity/interoperability,
evidence-based Reputation, controlled Payments, Verified Settlement,
organizational trust, and the Agent Work Market.

This status file marks capabilities complete only when repository evidence
proves them. Roadmap realignment does not make future Reputation, external
HOL/UAID or ERC-8004 verification, x402, real payment, or organizational
features implemented.

## Gate 4A Real Corpus Eligibility

- [x] Owner-defined Gate 4A/4B/4C corpus ramp resolves the earlier executable-boundary ambiguity without starting Reputation
- [x] `REAL_CORPUS_ELIGIBILITY_RULES_V1` extends preliminary classification without changing historical V1 records or hashes
- [x] Deterministic projection requires external acceptance, a pre-bound task type, Receipt integrity, and an active uncontaminated entry
- [x] Exact replays are idempotent; conflicting Job/requirement/Contract/Evidence/delivery/Receipt identities are quarantined
- [x] Revoked, superseded, pending-contamination, and confirmed-contamination entries fail closed with active contribution 0
- [x] Projection count, active task types, replay/quarantine totals, and canonical hash are integrity checked
- [x] Focused 24/24 tests, full 361/361 active tests, lint, strict typecheck, and `git diff --check` passed
- [ ] No Gate 4A Job has completed the full lifecycle; provisional and active canonical counts remain 0, task-type coverage remains 0, and the Gate 4C gap remains 20
- [ ] Phase 4 Reputation remains gated until Gate 4C reaches at least 20 active canonical Jobs and passes `REPUTATION_READINESS_REVIEW_V1`

Exact contract: `docs/GATE_4_REAL_CORPUS_RAMP.md`. Deterministic projection:
`apps/web/src/server/reputation-entry-pilot/real-corpus-eligibility.ts`.

## Beta Gate 3 Real End-to-End Verified Work

- [x] Reused the existing `donelayer-beta-validation` Workspace and persisted Gate 3 stop state
- [x] Exact anonymous source `main` Commit resolved and packaged without host credentials
- [x] Exactly one AI Gateway Job, one execution Sandbox, and one fresh verifier Sandbox
- [x] Single-file authorized patch; two locked assertions passed independently
- [x] Separate `COMPLETED`, `VERIFIED`, and `VERIFIED_DELIVERY` outcomes
- [x] Four verified artifacts, 18-entry valid Evidence Ledger, and valid durable Receipt
- [x] Sign-out/sign-in durability, anonymous Receipt readback, Account B isolation, and service-only RPC denial
- [x] Execution and verifier cleanup, offline Worker, released Worker Lease, completed Permission Lease, and no snapshot
- [x] Focused 53/53, full 349 active tests with 14 skips, lint, strict typecheck, Web/Worker builds, browser QA, diff check, and leakage scan
- [x] `NOT_VERIFIED / BETA_GATE_VALIDATION`, zero provisional and canonical contribution
- [x] External review approved Gate 3 with one non-blocking `EXTERNAL_REVIEW_EVIDENCE_DEPTH_LIMITATION`; no rerun is required
- [ ] A complete raw external-review export remains required before production/public third-party-verification claims

Exact result: `BETA_GATE_3_REAL_END_TO_END_VERIFIED_WORK_REPORT.md` and
`test-results/beta-gate-3-real-end-to-end-evidence.json`.

## Beta Gate 2 Trust Workspace V1

- [x] Real Supabase Auth application sessions, reload/navigation persistence, sign-out, and invalid-session fail-closed behavior
- [x] Durable Agent, Work, locked V2 Contract, Authority, Evidence-state, Receipt-state, and History product surfaces
- [x] Human-readable allowed/denied Authority, separate Execution/Verification/Delivery dimensions, and honest missing-Evidence/no-Receipt states
- [x] Two-account browser and RLS/RPC isolation, locked-state rejection, historical V1/V2 compatibility, tamper fail-closed behavior, and Demo/Seed exclusion
- [x] Desktop and 390x844 mobile browser validation with zero success-path console errors
- [x] Both exact-hash Gate 2 migrations are live on the dedicated non-production project; final advisor readback has zero high/critical findings
- [x] Focused 13/13, 338 active repository tests, 14 established skips, lint, strict typecheck, Supabase-mode Web build, Worker build, diff check, and sensitive-data scan
- [ ] No Gate 2 Job Run, Permission Lease, execution Evidence, or Receipt exists; classification remains `NOT_VERIFIED` with zero provisional/canonical contribution
- [x] Beta Gate 2 external review was accepted and Beta Gate 3 was separately authorized

Exact result: `BETA_GATE_2_TRUST_WORKSPACE_V1_REPORT.md` and
`test-results/beta-gate-2-trust-workspace-v1-evidence.json`.

## Phase B Attempt 5

- [x] Separately identified Stage 0 passed before lifecycle creation with exact development OIDC/project binding, read-only Gateway catalog, both approved V3 ref/Commit pairs, Source materialization, workspace cleanup, and no preflight mutation
- [x] Exactly one `TEST_AND_FIX` and one `BUILD_RESCUE` Job ran through new V2 Contracts, executions, Leases, repair/verifier Sandboxes, Bundles, Ledgers, Receipts, and durable lifecycle identities
- [x] Both Contracts locked `INDEPENDENT_ACCEPTANCE_SUFFICIENT` before execution; no outcome-dependent policy selection occurred
- [x] `TEST_AND_FIX` produced one authorized `src/retry.ts` patch, passed fresh independent verification, and reached `VERIFIED_DELIVERY` while preserving execution `PROVIDER_FAILURE` and attribution `MODEL_PROVIDER`
- [ ] `BUILD_RESCUE` produced no deliverable after provider failure and remains `INCONCLUSIVE`; it is not eligible and cannot be rerun or relabeled as success
- [x] Limits held at 9/16 model requests and 4/4 non-persistent Sandboxes; all Sandboxes are stopped, cleanup-verified, snapshot-free, and both Leases are `REVOKED`
- [x] The store verifies 81 records, 78 lifecycle entries, two Jobs, all V2 outcome bindings, both Ledgers and Receipts; lint, typecheck, 276 active tests, Web/Worker builds, diff check, and credential/path scan passed
- [x] Owner classification is `DO NOT COUNT`; the technically eligible Fixture candidate remains `counted: false` and `reputationEntered: false`
- [ ] Canonical real Verified Job count remains 0, gap remains 20, qualifying task types remain none, and Reputation has not started

Exact result: `REPUTATION_ENTRY_PHASE_B_ATTEMPT_5_REPORT.md` and the five
`test-results/reputation-entry-phase-b-attempt-5*` evidence artifacts.

## Real Job Classification And External Audit Policy V1

- [x] Four preliminary states are explicit: `BENCHMARK_FIXTURE`, `NOT_VERIFIED`, `PROVISIONAL_REAL_JOB`, and `AMBIGUOUS`
- [x] Demo, Seed, benchmark, Fixture, Gate-exercise, workflow-validation, and corpus-manufactured work is automatically excluded with canonical contribution 0
- [x] The anti-gaming rule rejects work that would not genuinely have been needed without the Reputation/corpus goal, even when the Owner requested it
- [x] Clearly genuine Owner or external work can become only `PROVISIONAL_REAL_JOB`; provisional and canonical counts remain separate
- [x] Only an externally accepted provisional record may become `OWNER_REAL_VERIFIED_JOB` or `EXTERNAL_REAL_VERIFIED_JOB` and contribute 1
- [x] Batch audit triggers are deterministic: five new provisional Jobs, a major canonical milestone, an apparent threshold crossing, or blocking ambiguity
- [x] `docs/REAL_JOB_AUDIT_QUEUE.md` contains zero pending entries and preserves Attempt 5 as an automatically excluded Benchmark history
- [x] Attempt 5 classification evidence binds the unchanged evidence JSON and SQLite hashes; `TEST_AND_FIX` is `BENCHMARK_FIXTURE_VERIFIED_JOB`, `BUILD_RESCUE` is `NON_VERIFIED_BENCHMARK_ATTEMPT`, and both contribute 0
- [x] Focused 13/13, lint, strict typecheck, full suite 289/289 active tests, Web build, Worker build, `git diff --check`, credential/path scan, and historical immutability checks passed

Exact policy: `docs/REAL_JOB_CLASSIFICATION_POLICY.md`. Exact queue:
`docs/REAL_JOB_AUDIT_QUEUE.md`. Exact classification artifact:
`test-results/reputation-entry-phase-b-attempt-5-owner-classification.json`.
Gate report: `REAL_JOB_CLASSIFICATION_POLICY_V1_REPORT.md`.

## Attempt 3 Version-Aware Lifecycle Revalidation

- [x] Strict version-specific schemas preserve the exact `AGENT_MODEL_RUN` V1 request body and V2 returned-run body without upgrade, downcast, optional-field fallback, or unknown-version acceptance
- [x] Lifecycle recovery binds by record type, record ID, and exact payload SHA-256, resolving one preserved `record_version` instead of overwriting V1 with V2 in a type/ID-only map
- [x] Canonical payload hashing and original lifecycle-entry hashing remain unchanged; arrays stay ordered and object keys remain canonicalized
- [x] Immutable SQLite mode uses `readOnly: true` plus `immutable=1`, denies append, skips schema/metadata writes, and creates no WAL/SHM sidecars
- [x] Corrected canonical `verifyAll()` validates all 79 Attempt 3 records, 76 lifecycle entries, and both Jobs
- [x] Attempt 3 database SHA-256 is byte-identical before and after: `30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37`
- [x] Both Contracts, Authorities, Evidence Bundles, Ledgers, Receipts, persisted request counts, and repair/verifier cleanup records validate read-only
- [x] `REPUTATION_ENTRY_CANDIDATE` is explicit workflow-membership metadata; verified counting still requires result `VERIFIED`, while canonical qualification remains uncounted pending separate Owner acceptance and promotion
- [x] Focused 25/25, lint, strict typecheck, full suite 233/233 active tests, Web build, Worker build, and `git diff --check` passed
- [ ] Attempt 3 remains `PARTIAL / BLOCKED`; Job results remain `FAILED` and `INCONCLUSIVE`, neither has `VERIFIED_DELIVERY`, verified/canonical counts remain zero, and Reputation has not started

Exact result: `REPUTATION_ENTRY_PHASE_B_ATTEMPT_3_LIFECYCLE_REVALIDATION_REPORT.md`.
This correction made zero model calls, Sandboxes, Attempts, Jobs, Contracts,
Leases, Receipts, lifecycle writes, Fixture mutations, or external effects.
No later work is authorized.

## Phase B Attempt 3

- [x] New pre-lifecycle preflight passed before the Attempt 3 database existed: exact linked development OIDC structure/project/expiry, authenticated non-model Gateway catalog, both approved V2 refs/commits, materializer cleanup, and zero mutation
- [x] Exactly one `TEST_AND_FIX` and one `BUILD_RESCUE` Job ran with new Job/execution/Contract/Lease/Evidence/Ledger/Receipt identities
- [x] Aggregate limits held at 9/16 model requests and 4/4 non-persistent Sandboxes; all four Sandboxes are stopped, cleanup-verified, and snapshot-free
- [x] Both Leases are `REVOKED`; no PR, merge, deployment, real payment, blockchain write, billing change, production credential expansion, or Fixture mutation occurred
- [x] Both Job Evidence Bundles are complete and both Job-level Ledgers and outcome-truthful Receipts recompute as valid
- [ ] Batch decision is `PARTIAL`: `TEST_AND_FIX` is `FAILED` despite a correct independently verified patch because the model run failed; `BUILD_RESCUE` is `INCONCLUSIVE` with no patch; verified candidate count is zero
- [ ] Built-in durable database verification is blocked by a version-collision lookup for V1/V2 `AGENT_MODEL_RUN` records; a read-only version-aware recomputation validates both chains and payload bindings but does not override `verifyAll(): false`
- [ ] `VERIFIED_DELIVERY` was not achieved; canonical qualifying count remains 0, gap remains 20, and Evidence-Based Reputation has not started

Exact evidence: `REPUTATION_ENTRY_PHASE_B_ATTEMPT_3_BLOCKED.md`,
`test-results/reputation-entry-phase-b-attempt-3-source-preflight.json`,
`test-results/reputation-entry-phase-b-attempt-3-evidence.json`, and
`test-results/reputation-entry-phase-b-attempt-3.sqlite`.

`PHASE B ATTEMPT 2 — HISTORICAL FAIL / BLOCKED` is permanent and its four
historical files remained unchanged. No Attempt 3 retry or Attempt 4 is
authorized. The next action requires Owner approval for a narrowly scoped,
non-mutating version-aware lifecycle-verifier correction and read-only database
revalidation.

## Replacement Batch Persistence Preflight

- [x] Attempt 4 closes the opened SQLite resource internally when constructor initialization fails, preserves the original failure, and retains the existing constructor plus idempotent `close()` API
- [x] Focused Windows lifecycle tests passed for failed initialization, normal open/use/close/delete, open/close/reopen/close, and repeated close safety
- [x] Attempt 4 used a fourth new database and preserved the exact Attempt 1-3 databases, WAL/SHM sidecars, reports, hashes, historical marker, and lineage
- [x] The complete Attempt 4 preflight independently passed deliberate-failure restart recovery, all 14 durable payload and 12 lifecycle recomputations, Contract/Authority/Bundle/Receipt binding, tamper detection, overwrite protection, final `REVOKED` Lease recovery, clean close, and retained reload
- [x] Phase A persistence preflight is PASS at the exact local deterministic Attempt 4 boundary
- [ ] Phase B remains blocked with zero replacement Jobs, model calls, Sandboxes, Fixture preparation, or external actions under Attempt 4 authorization
- [x] Attempt 3 replaced only the command-object comparison with the existing canonical JSON comparison; object-key-only differences pass while arrays, commands, arguments, working directories, fields, sequence, and nested values remain protected
- [x] Attempt 3 used a third new database, preserved exact Attempt 1/2 database and report hashes, recorded lineage, and recovered 14 records plus the 12-entry Job lifecycle after a deliberate failure/restart
- [x] Attempt 3 recomputed both Contract hash domains, every durable payload, the lifecycle chain, Authority/Bundle/Receipt bindings, final `REVOKED` Lease, and all required tampering probes
- [ ] Attempt 3 failed closed when the historical-marker tamper probe's expected constructor failure leaked an opened SQLite handle and Windows could not remove the temporary SHM file; no PASS JSON was written
- [ ] Phase B remains blocked with zero replacement Jobs, model calls, Sandboxes, or external actions
- [x] Owner-authorized Attempt 2 used a new database and recorded immutable lineage to the unchanged Attempt 1 database, blocker report, and historical marker
- [x] Corrected assertions independently recomputed the complete persisted payload hash and the self-hash-excluded canonical Work Contract hash after restart
- [x] Both hash domains remained stable and distinct after reload; Authority, Execution, and Receipt records were observed to reference the canonical Contract hash
- [x] Attempt 2 again preserved Job/Agent/execution/Contract/Lease/Bundle/verifier/Ledger/Receipt state and a final `REVOKED` Lease across deliberate failure and restart
- [ ] Attempt 2 failed on a new key-order blocker: canonical persistence sorts command-object keys but the semantic validator compares them with order-sensitive native `JSON.stringify`
- [ ] Covered-field and self-hash-field tampering negative tests were not reached and cannot be claimed as passed
- [ ] Phase B remains blocked with zero replacement Jobs, model calls, Sandboxes, or replacement Fixture commits
- [x] Append-only SQLite durable-record store with canonical payload hashes, per-Job lifecycle chaining, immutable triggers, restart recovery, and historical-marker binding
- [x] Job, Agent/profile, execution, Work Contract, issued/revoked Lease, intermediate/final Bundle, verifier, Ledger, and Receipt records survived a deliberate post-persistence failure
- [x] Explicit Lease state recovered as `REVOKED`
- [x] Store-wide recomputation and 12-entry lifecycle-chain validation passed after restart
- [x] Historical failed-pilot marker remained byte-identical at SHA-256 `5d90116229342b94fa9ef935e2c5780d2a0655143ec121db78b8c58176fd598f`
- [ ] Phase A Gate failed because the test compared a full persisted document hash with the Work Contract's self-excluding semantic hash
- [ ] The JSON preflight summary was not written after that assertion failure; the retained SQLite attempt must not be relabeled as PASS
- [ ] Phase B was not started: zero replacement Jobs, model calls, Sandboxes, or replacement Fixture commits

Exact blocker: `REPUTATION_ENTRY_REPLACEMENT_BATCH_BLOCKED.md` and
`test-results/reputation-entry-persistence-preflight.sqlite`.

Attempt 2 blocker: `REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT_ATTEMPT_2_BLOCKED.md`
and `test-results/reputation-entry-persistence-preflight-attempt-2.sqlite`.

Attempt 3 blocker: `REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT_ATTEMPT_3_BLOCKED.md`
and `test-results/reputation-entry-persistence-preflight-attempt-3.sqlite`.

Attempt 4 PASS: `REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT_ATTEMPT_4_REPORT.md`,
`test-results/reputation-entry-persistence-preflight-attempt-4-evidence.json`,
and `test-results/reputation-entry-persistence-preflight-attempt-4.sqlite`.

## Two-Job Reputation Entry Corpus Collection Pilot V1

- [x] Exactly two distinct owner-controlled Fixture sources: one `TEST_AND_FIX` validation defect and one `BUILD_RESCUE` package export failure
- [x] Candidate-only V1 Work Contract, task-scoped Authority, Agent execution identity, Evidence Bundle, Ledger, Receipt, and explicit post-Job Lease revocation
- [x] Per-task editable-file and protected-oracle boundaries while retaining the existing legacy `src/add.ts` behavior
- [x] One Agent Sandbox plus one fresh independent-verifier Sandbox per Job, with a cumulative four-Sandbox limit
- [x] Zero-price tool-capable model eligibility, maximum eight model steps per Job, maximum 16 aggregate requests, and 4,096 output tokens per Job
- [x] Candidate Receipts hard-code `canonicalQualification.counted = false`; candidate creation cannot silently alter corpus totals
- [x] Two remote Fixture branches created without PR, merge, deployment, payment, or blockchain action
- [x] Provider recovery proves all four attempted Sandboxes are stopped, non-persistent, and snapshot-free
- [ ] Neither attempted candidate is promotable: the in-memory outcome was `PARTIAL` with zero verified candidates
- [ ] Complete Job Evidence was not persisted because the integration test asserted `PASS` before writing a returned `PARTIAL` outcome
- [ ] The attempted Jobs used `COMPLETED` rather than the specifically required revoked/expired Lease disposition
- [x] Persistence now occurs before success assertions, future pilot Leases are revoked, and the recovered attempt marker cannot be overwritten; no live rerun was performed

Exact recovered evidence: `REPUTATION_ENTRY_CORPUS_PILOT_V1_REPORT.md` and
`test-results/reputation-entry-pilot-attempt-1-recovered.json`. The canonical
qualifying corpus remains zero and Reputation remains unimplemented and gated.

## Agent Identity And Interoperability V1 Design and Evidence Gate

- [x] Stable opaque internal Agent ID distinct from display name
- [x] Append-only whole-profile-hashed revisions with previous-hash linkage
- [x] Explicit platform-account controller relationship without legal/KYC claim
- [x] Separate per-run execution identity bound to Agent, Contract, Lease, Job, executor, runtime, and hash
- [x] Identity-aware Work Contract, Permission Lease, repair/delivery Evidence, Receipt, and public Receipt projection
- [x] Display-name mutation preserves historical Receipt meaning
- [x] Disabled and terminal revoked Agent status behavior
- [x] Typed ERC-8004 and HOL/UAID references with `DECLARED`, `OBSERVED`, and evidence-required `VERIFIED` levels
- [x] Ten negative cases covering unknown/mismatched/tampered identity and external-link conflicts
- [x] Local 22-entry Ledger and Receipt with offline Evidence recomputation

Exact evidence: `AGENT_IDENTITY_INTEROPERABILITY_V1_REPORT.md`,
`test-results/agent-identity-v1-evidence.json`, and
`test-results/agent-identity-working-tree-identity.txt`. This is REAL only for
the recorded in-process identity model, binding rules, negative tests, and
offline-recomputable Evidence. It is not a production identity service, live
external linkage verification, capability verification, or Reputation.

## Agent Identity Durable Productization V1

- [x] Current Marketplace SQLite stores canonical append-only identity profiles
- [x] Agent creation and identity revision 1 share one transaction
- [x] Existing and platform-managed Agent identity reconciliation
- [x] Stable controller and predecessor-chain enforcement in SQLite triggers
- [x] Immutable, globally unique external identity ownership
- [x] Controller-only revision/history API and admin read-only access
- [x] Public API links only `DECLARED` external identities
- [x] Provider list shows status/revision/hash without claiming legal identity
- [x] Agent trust page derives active Authority and valid delivery Receipts
- [x] Demo counters and hard-coded completion history excluded from proof
- [x] Restart, stale-write, revocation, conflict, tamper, and access tests

Exact evidence: `AGENT_IDENTITY_DURABLE_PRODUCTIZATION_V1_REPORT.md`,
`test-results/agent-identity-durable-productization-v1-evidence.json`, and
`test-results/agent-identity-durable-productization-v1.sqlite`. This is a local
durable product boundary, not Supabase/multi-instance production persistence,
live external verification, legal assurance, or Reputation. The implementation
Job is `NOT_VERIFIED` because it did not produce a full Agent Job Receipt.

## Agent Identity Production Persistence V1 Local Contract Gate - Owner Accepted

- [x] Supabase CLI generated a timestamped Postgres migration
- [x] Append-only profile revisions with predecessor, timestamp, controller, and terminal-status enforcement
- [x] Immutable global external identity ownership with concurrent-conflict rollback
- [x] RLS-protected historical reads and explicit Data API grants
- [x] Service-only atomic Agent creation plus identity revision 1
- [x] Service-only identity append command with durable actor re-authorization
- [x] Server-only Supabase secret client; publishable user client remains bound to Auth cookies and RLS
- [x] Mode-aware create/read/revise/link APIs retain SQLite behavior outside Supabase mode
- [x] Adapter conflict, stale-race, corrupt-document, missing-command-client, and SQLite compatibility tests
- [x] Owner-authorized non-production project preflight, Trust Foundation prerequisite, semantic verification, and Agent Identity migrations applied and catalog-verified
- [x] Security hardening applied; the mutable function search-path warning is resolved and intentional service-only RLS notices remain informational
- [x] Two-account Auth/RLS isolation, service/user boundary, atomic rollback, stale/controller rejection, competing revisions, external-identity uniqueness, UPDATE immutability, and reconnect durability passed live
- [x] Both service-role DELETE immutability probes failed `55000`; unrelated test Auth/Profile cleanup passed and durable provenance rows remain
- [x] Supabase Auth leaked-password protection enabled without billing change; final security advisor has zero warnings
- [x] Final evidence replay, lint, strict typecheck, full suite, Web/Worker builds, diff check, historical integrity, and credential/path scan passed

This Gate is a local production contract only. It made no live Supabase read or
write, changed no credential or deployment, and does not claim production
persistence is operational. It is `NOT_VERIFIED` for the Real Job corpus because
no full current Agent Job lifecycle or Verified Job Receipt ran. The Owner
accepted this exact local boundary on 2026-09-09; live migration and RLS claims
remain prohibited until separately proven.

Beta Gate 1 evidence is in
`BETA_GATE_1_REAL_SUPABASE_MIGRATION_BLOCKED.md` and
`test-results/beta-gate-1-real-supabase-migration-blocked.json`. The retained
project is `donelayer-beta-validation` (`blriuxocrzgwlojiduue`). The unrelated
`gym` project was not accessed project-specifically or mutated. The Owner
directly approved the missing Trust Foundation migration; it applied as remote
version `20260909050427` and passed complete catalog validation. The separately
approved semantic and Agent Identity migrations then applied and passed catalog
readback. The approved security hardening then applied as remote version
`20260909062033`, resolved the warning, and enabled the live identity Gate.
Auth/RLS, transaction, conflict, UPDATE/DELETE immutability, reconnect, and
cleanup checks passed. The Owner enabled leaked-password protection without a
billing change; the security advisor and complete repository Gate then passed.
Final evidence is in `BETA_GATE_1_REAL_SUPABASE_ENVIRONMENT_REPORT.md` and
`test-results/beta-gate-1-real-supabase-environment-evidence.json`.

## Task-Scoped Agent Authority V1 Design and Evidence Gate

- [x] `TASK_SCOPED_AUTHORITY_V1` extends the existing Permission Lease and guard
- [x] Exact Work Contract ID/version/hash and Agent/executor/Job binding
- [x] Exact Repository, base ref, Commit, delivery namespace, and source-file scope
- [x] Vercel managed-Sandbox purpose/provider/backend and cumulative two-Sandbox limit
- [x] Separate PR-create approval, PR-merge denial, and production-deploy denial
- [x] Finite active interval, explicit revocation, terminal-use denial, and immutable authority hash
- [x] Missing authority blocks Work Contract repair before source materialization or Sandbox creation
- [x] Protected-operation allow/deny Evidence, Ledger chain, and authority Receipt binding
- [x] Mandatory negative tests for Contract/resource/recipient/action/lifecycle/scope escapes
- [x] One bounded real read-only exact-Fixture action followed by Lease revocation

Exact evidence: `TASK_SCOPED_AGENT_AUTHORITY_V1_REPORT.md`,
`test-results/task-scoped-authority-v1-evidence.json`, and
`test-results/task-scoped-authority-working-tree-identity.txt`. This is REAL
only for the recorded schema, guard, Fixture action, Lease, negative evidence,
and Receipt. It is not production Human approval, credential minting,
generalized persistence, arbitrary Repository access, or organization/data
policy. Its owner review was accepted before the Agent Identity Gate above.

## Verified Work Contract V1 Design and Evidence Gate

- [x] Versioned, locked, whole-document-hashed `VERIFIED_WORK_CONTRACT_V1`
- [x] Owner-authoritative structured acceptance criteria and deterministic `SPEC_TEST_CONFLICT` handling
- [x] Allowed/forbidden action policy and deterministic verifier selection recorded in the Work Contract
- [x] `VERIFIED_WORK_EVIDENCE_BUNDLE_V1` required/satisfied/missing projection with false-success rejection
- [x] Agent-reported and independently verified states recorded separately
- [x] Review-required and append-only historical `SUPERSEDED` outcomes
- [x] Evidence Bundle hash bound into delivery Receipt and public Receipt
- [x] Negative Work Contract, assertion-result, Evidence Bundle, missing-Evidence, and source-branch tests
- [x] Real bounded repair from correct tests, source-only GitHub PR #2, and fresh non-AI Vercel Sandbox verification
- [x] 4/4 repository tests and 4/4 locked Contract assertions passed; both Sandboxes and delivery workspace cleaned
- [x] Simulated Test Ledger release only after complete verification; no real funds moved

Exact evidence: `VERIFIED_WORK_CONTRACT_V1_REPORT.md`,
`test-results/semantic-verification-real-evidence.json`,
`test-results/semantic-verification-reality.sqlite`,
`test-results/semantic-true-repair.patch`, and
`test-results/semantic-delivery-diff.patch`. This is REAL only for the exact
owner-controlled Fixture, Commits, captured Agent repair, open/unmerged PR #2,
independent verifier run, Evidence Bundle, and Receipt. Its owner review was
accepted before the Task-Scoped Agent Authority V1 Gate recorded above.

## GitHub Patch Delivery and Independent Verification Gate V1

- [x] Provider-neutral `GitDeliveryProvider` boundary with fixed GitHub CLI implementation for availability, Repository verification, branch, exact patch application, Commit, push, PR, readback, diff, and cleanup
- [x] Exact persisted patch SHA-256 `6e8679bbef6dbbba31f84ffb20b209df4d3fadfee81e58383e9926a70855c996` applied to Base Commit `600f326ce373160eb5495aaef72230d4c9807e8f`; only `src/add.ts` changed
- [x] Real deterministic branch `donelayer/repair/ed564b18-8fa2`, Commit `466be67975a953a1ae3b5cfc41e80d42ee057164`, and open/unmerged GitHub PR #1 created with `OWNER_DEVELOPMENT_GITHUB_AUTH`
- [x] Local/Remote Commit, parent Commit, PR base/head, changed file, and GitHub diff independently read back; resumed execution reused the exact existing branch/Commit/PR idempotently
- [x] `IndependentDeliveryVerifier` re-materialized the exact Remote Delivery Commit without trusting the Repair Sandbox or delivery workspace and made zero AI/model calls
- [x] New non-persistent Vercel Sandbox `donelayer-delivery-verify-f2b8226c-fbae-4735-a0d` received no GitHub, Vercel, or AI credential; install-only registry access returned to deny-all before test
- [x] Independent `npm ci` exited `0`, build was truthfully `NOT_PRESENT`, and `npm test` exited `0` with 2/2 tests passed
- [x] Tests, package test script, and test configuration match the Base Commit exactly; no disabled/deleted tests, fake wrapper, or acceptance-criteria modification detected
- [x] Verification Sandbox and controlled delivery workspace cleanup verified; no Snapshot or persistent Sandbox
- [x] 20 content-bound Artifacts, valid 39-entry Receipt chain / 40-entry full Ledger, integrity-valid `VERIFIED_DELIVERY` Receipt, and signed-out public Receipt
- [x] Test Ledger moved `RESERVED -> RELEASED` only after verification and cleanup: simulated customer `$10.00`, Provider `$8.00`, platform `$2.00`; no real funds moved
- [x] Browser Verify passed at 1440x900 and 390x844 with required delivery/verification/payment claims visible, no horizontal overflow, and no framework error overlay
- [x] The first live attempt's final-newline comparison error is preserved as a valid `PATCH_MISMATCH` partial Receipt; it created no Sandbox, made no AI call, and released no simulated payout

Exact evidence: `GITHUB_DELIVERY_INDEPENDENT_VERIFY_REPORT.md`,
`test-results/github-delivery-independent-verify-evidence.json`,
`test-results/github-delivery-independent-verify.sqlite`,
`test-results/github-delivery.json`, and `test-results/delivery-diff.patch`.
This is REAL only for the exact owner-controlled Fixture, Base Commit, persisted
patch, delivery Commit, open PR, and captured verifier run. The PR is unmerged;
general GitHub App grants, arbitrary Customer repositories, deployment, and
real payment remain incomplete. Work stops for owner review.

## Agent Repair in Managed Sandbox Gate V1

- [x] Exact Fixture Commit pinned and independently verified as `600f326ce373160eb5495aaef72230d4c9807e8f`
- [x] Existing provider-neutral execution layer reused through `VercelAIGatewayAgentProvider`; no second gateway, direct OpenAI key, billing change, purchase, or paid fallback
- [x] Authenticated live catalog selected free model `inclusionai/ling-3.0-flash-fin` with reasoning and tool support after preferred MiniMax was absent from the authenticated catalog
- [x] Fresh non-persistent Vercel Sandbox reproduced the real baseline test failure under deny-all networking
- [x] Live model made eight successful bounded DoneLayer tool calls with no unrestricted shell or arbitrary network
- [x] Model-generated patch changed only `src/add.ts`; tests and package scripts remained unchanged; real repaired `npm test` exited `0`
- [x] Patch SHA-256 `6e8679bbef6dbbba31f84ffb20b209df4d3fadfee81e58383e9926a70855c996`
- [x] Four successful Gateway calls completed repair evidence; two final text-only calls returned `429` and are disclosed without being relabeled as successful Agent completion
- [x] Six API requests, 14,576 input tokens, 6,483 cached input tokens, 259 output tokens, and exact observed credit delta `$0.000375` recorded; unavailable exact Gateway cost remains null
- [x] 13 content-bound Artifacts, valid 34-entry full Ledger, valid Receipt/public Receipt, matching SQLite records, and independently verified Sandbox cleanup

Exact evidence: `AGENT_REPAIR_SANDBOX_REPORT.md`,
`test-results/agent-repair-sandbox-evidence.json`,
`test-results/agent-repair-sandbox.sqlite`, and
`test-results/agent-repair.patch`. This is REAL only for the exact Fixture,
Commit, model run, and bounded tools. At that milestone the next Gate was
**GITHUB PATCH DELIVERY AND INDEPENDENT VERIFICATION**; its separately approved
result is now recorded above.

## Real Build and Test in Managed Sandbox Gate V1

- [x] Exact allowlist remains `https://github.com/NickHOI/donelayer-build-rescue-fixture.git`, branch `main`; the fresh Materializer HEAD and independent Remote resolution both returned `600f326ce373160eb5495aaef72230d4c9807e8f`
- [x] Six-file Repository Manifest, canonical Source Package, Source Package Manifest, per-file SHA-256, bounded sizes, sensitive-path/symlink exclusion, and temporary Materializer cleanup
- [x] Versioned locked `REAL_BUILD_TEST_MANAGED_SANDBOX_V1` Contract and separate Commit-bound Permission Lease for `NODE_BUILD_TEST_MANAGED_SANDBOX_V1`
- [x] Exact structured command sequence, no customer command or `shell:true`: prepare; `npm ci --ignore-scripts --no-audit --no-fund`; conditional build; `npm test`; Source integrity
- [x] Server and Sandbox both reject install lifecycle scripts; focused negative tests cover `preinstall`, `install`, `postinstall`, and `prepare`
- [x] Initial/final `deny-all`; exact `registry.npmjs.org` install-only network window; no CIDRs, ports, private/localhost access, allow-all, or automatic policy widening
- [x] Real Vercel Sandbox install exited `0`; exact Fixture has no build script, so build is correctly `NOT_PRESENT`, not falsely `PASSED`
- [x] Real `npm test` exited `1` on the intentional assertion; raw logs/exit captured, formal counts left `UNPARSABLE` rather than guessed
- [x] Post-command Source integrity: 6 checked, 0 missing/modified/added; no Codex repair or Source mutation
- [x] 18 allowlisted Artifacts have matching claimed/Server hashes and strict schema/cross-binding to Source, Provider inspection, exact policy, commands, lifecycle, cleanup, and usage
- [x] Task `VERIFICATION_FAILED`, Job `FAILED`, Receipt result `FAILED`; Receipt integrity `VALID`; 18 milestone checks passed and only `automated-tests-pass` failed
- [x] 78-entry Evidence Ledger valid; Provider payout release `false`; no Test Ledger `RELEASE`
- [x] Sandbox Provider state `stopped`, cleanup verified, non-persistent, no Snapshot; Provider usage captured without a supplied USD cost
- [x] Signed-out Receipt Verify passed at 1440x900 and 390x844 with no horizontal/text overflow and zero Browser console errors/warnings
- [x] Exactly one live build/test Sandbox run was made. The outer test initially asserted build `PASSED`, learned the Remote truth was no build script, and was corrected offline; the Provider run was not repeated

Exact evidence: `REAL_BUILD_TEST_SANDBOX_REPORT.md`,
`test-results/real-build-test-sandbox-evidence.json`, and
`test-results/real-build-test-sandbox.sqlite`. This is REAL only for the exact
Fixture/Commit. The separately scoped Agent Repair and exact-Fixture GitHub
delivery milestones are recorded above; general repositories, production
infrastructure, real payment and a second Provider remain unapproved.

## Managed Remote Sandbox Gate V1

- [x] Owner architecture decision recorded in `docs/adr/ADR-MANAGED-REMOTE-SANDBOX.md`: default `MANAGED_REMOTE_SANDBOX`, first provider Vercel Sandbox
- [x] `LOCAL_SELF_HOSTED_DOCKER` is `DEFERRED_BY_OWNER`, opt-in Advanced Provider / Enterprise Self-hosted Mode; required for default MVP: **No**
- [x] Historical `CONTAINER_RUNNER_BLOCKED.md` and prior real-gate reports preserved unchanged
- [x] Vercel CLI 58.1.0 and read-only login check passed (authorized network retry after local EACCES)
- [x] Existing Vercel Project renamed in place from `project-e4lus` to `donelayer`; repository linked to `nickhoi's projects`; `.vercel/` and `.env.local` Git-ignored
- [x] Zero-deployment/no-Git-link baseline verified; no Project, deployment, or Git connection was created by the Gate
- [x] Development OIDC and real Provider availability passed without a permanent Access Token, plan upgrade, billing change, or credit purchase
- [x] Official `@vercel/sandbox@3.2.1` integrated behind `ManagedSandboxProvider`; unavailable mode fails closed with no local/Docker/Demo fallback
- [x] Versioned locked Contract, separate Permission Lease, `MANAGED_REMOTE_SANDBOX` Job and persisted `managed_sandbox_runs` lifecycle
- [x] Real non-persistent Vercel Sandbox ran only `smoke-runner.mjs` under `deny-all`; external network probe failed as required
- [x] Seven real Provider/Policy/Log/Proof/Lifecycle/Cleanup Artifacts persisted with Job/Run ownership and Server-computed SHA-256
- [x] Real smoke cleanup reached Provider state `stopped`, with no Snapshot; 34-entry Ledger valid; 22/22 checks passed; `VERIFIED` Receipt/public Verify valid
- [x] Real timeout returned exit `137` after `1504 ms`; cleanup after Permission expiry verified; timeout Ledger valid; no success Receipt created
- [x] All three capped Gate Sandboxes are stopped, non-persistent, and without Snapshots; no further retry was made
- [x] Public Receipt Verify click/reload/privacy inspection passed with zero Browser console errors or warnings

This historical Gate remains REAL only for the fixed platform-owned smoke and
timeout workflows. The separately scoped exact-Fixture build/test milestone is
recorded above; it does not make Codex repair, PR delivery, general repository
execution, production persistence/storage/auth, payments, multi-tenant
security, or Provider failover real. Historical evidence:
`MANAGED_SANDBOX_REALITY_REPORT.md` and
`test-results/managed-sandbox-reality-evidence.json`.

## Worker Reality Gate

The repository now contains one independently verified, non-Demo Worker workflow:

```text
Server-owned WORKER_SMOKE_V1
-> real Worker process pair / heartbeat / poll / claim
-> finite Lease
-> Node.js fs writes hello.txt
-> real artifact PUT
-> Server SHA-256 verification
-> server-side state machine COMPLETED
-> workspace cleanup
```

- [x] Worker CLI registers only the fixed `WorkerSmokeExecutor` and `RepositoryMaterializerExecutor` real-gate executors; Demo and Codex execution are paused
- [x] Fixed task cannot contain a repository, customer shell command, network allowlist, Pull Request, or payment action
- [x] Full Worker capabilities and heartbeat history persist; the claim-time snapshot is immutable Job evidence
- [x] Artifact PUT is bound to authenticated Worker + current Lease and validates ownership, filename, MIME, size, bytes, and Server SHA-256
- [x] Expired Worker A attempt is preserved and fenced; Worker B receives a new assignment, Job, Lease, and attempt lineage
- [x] Real child-process smoke and recovery integration tests verify cleanup and stale A rejection
- [ ] This does not make general GitHub Repository work, Codex, Pull Request, Supabase production, Stripe/payment, A2A, MCP, or the legacy Demo UI real

Exact evidence: `WORKER_REALITY_REPORT.md`.

## Trust Foundation v1

Trust Foundation v1 is complete for the fixed local `WORKER_SMOKE_V1` Worker Infrastructure Verification workflow:

- [x] Versioned `task_contract_versions` with canonical SHA-256, DRAFT edit, immutable LOCKED records, revision, supersession, Job binding and Audit Log
- [x] Separate, versioned `permission_leases` with Server enforcement, expiry, Admin revocation, recovery reissue, violation state and fixed smoke scope
- [x] Worker `PermissionGuard` enforces active lease, allowed/denied actions, workspace containment, HTTPS domain allowlist, artifact/runtime limits and API budget
- [x] Append-only `evidence_ledger_entries` with contiguous Job sequence, previous-hash links, deterministic entry hashes and full-chain verification
- [x] Immutable `job_receipts` gated by required checks, Permission state and valid Evidence chain; Permission violations produce a non-VERIFIED failure Receipt
- [x] Strict public Receipt projection and signed-out `/receipts/[receiptPublicId]` Verify page with hash/chain recomputation, invalidation and dispute disposition
- [x] Task Detail Contract, Permissions, Evidence and Receipt tabs; Demo timer/payment/review controls are unavailable for real Worker smoke Jobs
- [x] Real child-process integration proves Contract -> Permission -> Worker -> Artifact -> Ledger -> Receipt -> Public Verify, plus A/B recovery with Permission v2
- [ ] This does not make `WORKER_SMOKE_V1` a Customer coding Job or make GitHub, Codex, external Agent identity, payment, Supabase production, A2A, MCP execution, C2PA, Capability Passport or Reputation real

Exact evidence: `TRUST_FOUNDATION_V1_REPORT.md`.

## Real Repository Materialization Gate v1

- [x] Single public fixture `NickHOI/donelayer-build-rescue-fixture` created by authenticated `NickHOI` GitHub CLI and pushed once on `main`
- [x] Versioned, locked `REPOSITORY_MATERIALIZATION_V1` Task Contract with 16 required checks and a separate repository/branch/domain-scoped Permission Lease
- [x] Exact HTTPS URL policy rejects alternate repository, owner, host, scheme, credential, query, redirect, local/private target and traversal inputs
- [x] Independent Worker `repository-materializer` performs real fixed-argument Git clone with isolated HOME/config, no prompt, no submodules, no LFS smudge and no hooks
- [x] Real origin, branch and HEAD capture plus stable six-file working-tree Manifest with per-file SHA-256; `.git` and temporary evidence are excluded
- [x] Three real Artifact uploads persist Clone Log, Remote Metadata and File Manifest with Server-computed SHA-256
- [x] Server independently runs isolated read-only `git ls-remote` and requires exact Worker/Remote commit equality
- [x] Repository-specific Evidence Ledger events, data-preserving schema migration and independently gated `VERIFIED` Receipt
- [x] Worker A expiry / Worker B recovery issues Permission v2 and fences A renew/event/Artifact/submit operations
- [x] Signed-out public Receipt Verify, reload, privacy, 1440px/390px layout and zero-console-error checks passed
- [ ] Materialization is REAL only for the exact allowlisted fixture. No repository code, install, test, build, Codex, branch, commit or Pull Request was executed.

Exact evidence: `REPOSITORY_REALITY_REPORT.md` and `test-results/repository-reality-evidence.json`.

## MVP verdict

The core Demo lifecycle is implemented and covered by an integration test:

```text
Customer creates task
-> analyzer and matching
-> Provider acceptance
-> Worker claim and events
-> Evidence submission
-> independent Proof-of-Done
-> Customer acceptance
-> simulated 80/20 ledger release
-> COMPLETED
```

This is a runnable local MVP with a real fixed Worker smoke path, real exact-allowlist repository materialization, one real exact-Fixture managed install/failed-test path, one bounded live Gateway repair, and a hash-verifiable local trust chain, not a production marketplace. General GitHub delivery, general repository execution, and Supabase production persistence are not complete.

## Phase 1 - Core platform

- [x] npm workspaces monorepo with `apps/web`, `apps/worker`, and domain packages
- [x] Signed Demo Auth roles for Customer, Provider, and Admin
- [~] Supabase Auth server boundary implemented; complete sign-up/sign-in production flow remains to be connected
- [x] Persistent local SQLite Demo Store and seed data
- [x] Production-oriented Supabase PostgreSQL migration, constraints, indexes, functions, RLS, explicit grants, and seed SQL
- [x] Customer Dashboard and Provider Dashboard
- [x] Agent Hall with search, filters, sorting, online and verification filters
- [x] Agent detail, create Agent, Worker Nodes, Provider Jobs, Admin, and Disputes pages
- [x] Multi-step Create Task Wizard and Task Analyzer UI
- [x] Strict server-side task state machine with actor guards, reason, timestamp, and Task Events
- [x] Task Detail with Contract, Permissions, Evidence Ledger and Receipt views; legacy Demo-only payment/review views remain explicitly gated

## Phase 2 - Matching and Worker lifecycle

- [x] Deterministic Agent hard filters and documented seven-factor weighted matching score
- [x] Human-readable matching reasons and rank snapshots
- [x] Provider task offer with accept, decline, and run-later decisions
- [x] Job Run creation only after Provider acceptance
- [x] One-time, expiring pairing code and hashed revocable Worker token
- [x] Outbound Worker heartbeat and capability reporting
- [x] Atomic Job claim, short lease, renewal, expiry fencing, cancellation polling, and reassignment primitives
- [x] Versioned Worker protocol with Zod validation and no arbitrary command field
- [x] Repository-free `WORKER_SMOKE_V1` executor using only Node.js `fs` for its fixed workflow
- [x] Exact-allowlist `REPOSITORY_MATERIALIZE_V1` executor using fixed Git arguments and Node.js file hashing without executing repository code
- [x] Persisted Worker heartbeat and claim-time capability snapshots
- [x] Attempt-preserving Lease recovery proven with two independent Worker processes
- [x] Deterministic Demo Executor with bounded logs, disposable workspace, cancellation, and cleanup
- [x] Idempotent Worker Job events and persisted Task timeline

## Phase 3 - Proof and simulated settlement

- [x] Scoped evidence upload initialization and finalization
- [x] MIME, size, storage path, Worker/Job binding, and SHA-256 validation
- [x] Current-Lease validation on raw Artifact PUT and separately persisted Server-computed SHA-256
- [x] `WORKER_SMOKE_V1` server-side verification and completion without frontend state mutation
- [x] `REPOSITORY_MATERIALIZE_V1` remote/branch/commit/Manifest/Artifact/Ledger verification and completion without frontend state mutation
- [x] Exact-Fixture `NODE_BUILD_TEST_MANAGED_SANDBOX_V1` real install/test, Source integrity, cleanup, `VERIFICATION_FAILED`, and hash-valid `FAILED` Receipt without frontend state mutation
- [x] Exact-Fixture live Agent Repair through Vercel AI Gateway, eight bounded tools, source-only patch, unchanged tests, real repaired test pass, cleanup, and hash-valid `VERIFIED` Receipt
- [x] Evidence Pack containing Agent, Worker, timing, commits, diff, files, logs, tests, PR metadata, checks, and hashes
- [x] Executor and Proof-of-Done verifier are separate modules
- [x] Required Acceptance Checks must all pass before `VERIFICATION_PASSED`
- [x] `COMPLETED` cannot be forced or reached before verification and Customer review
- [x] Test Ledger reserve, release, refund, and dispute hold operations
- [x] 80 percent Provider share and 20 percent platform fee simulation
- [x] Persisted full Demo lifecycle and page-refresh persistence
- [x] `Run Full Demo` server-driven demonstration

## Phase 4 - Integrations and adapters

- [x] `AgentProviderAdapter` contract with discover, validate, create, status, cancel, and result operations
- [x] Demo and Local Worker Agent adapters
- [x] Webhook Agent HMAC signature, timestamp, nonce, replay protection, timeout, retry, and callback primitives
- [~] Webhook Agent production interoperability has not been tested against an external Provider endpoint
- [x] A2A Agent Card download, validation, normalization, and clear error handling
- [~] A2A task methods remain an intentional skeleton; full protocol support is not claimed
- [x] Centralized Codex SDK / `codex exec` adapter with workspace-write, timeout, cancellation, structured JSON, stdout/stderr, Git state, diff, and secret exclusion
- [~] Codex adapter is opt-in preview; container orchestration and a real local Codex end-to-end run are not verified in this environment
- [x] GitHub webhook signature, event allowlist, replay receipt, redacted audit metadata, and least-privilege setup guide
- [~] One exact public Fixture checkout and one owner-development-authenticated branch/Commit/open-PR delivery are REAL; production GitHub App installation callback, general repository grants, and generalized delivery are not wired end to end
- [x] MCP server/tool/resource/prompt capability metadata and matching eligibility
- [~] MCP servers and credentials remain Provider-managed and are not hosted by the platform
- [x] Test Ledger provider behavior
- [~] Stripe Connect remains disabled scaffolding behind a feature flag; no real payment exists

## Phase 5 - Tests, security, docs, and polish

- [x] Unit tests for matching, filtering, state transitions, pairing, leases, HMAC, evidence hashing, acceptance checks, ledger behavior, Zod, executors, and Worker protocol
- [x] Integration test for the complete persisted Demo lifecycle and refund path
- [x] Authorization tests for cross-Customer access, unassigned claim, cross-Worker evidence, and direct `COMPLETED` attempts
- [x] Threat model covering malicious Customer/Provider, prompt injection, secret leakage, token theft, fake evidence, replay, offline Workers, infinite jobs, resources, and uploads
- [x] Architecture, security, Worker, GitHub App, Codex, README, and implementation status documentation
- [x] Dark, operational SaaS UI focused on tasks, progress, evidence, and verification
- [x] Playwright Chromium E2E covers the full persisted Demo flow plus public account/documentation routes
- [x] In-app browser walkthrough, zero-error console inspection, and 1280px/390px responsive verification
- [ ] Production penetration test, external integration tests, and Supabase migration application remain pending

## Last confirmed validation

| Check | Result | Notes |
| --- | --- | --- |
| `npm install` | PASS | Workspace dependencies installed successfully |
| `npm audit` | PASS | Zero known vulnerabilities after overriding transitive `nanoid` to patched `3.3.18` |
| `npm run lint` | PASS | Zero warnings allowed |
| `npm run typecheck` | PASS | Strict workspace TypeScript check |
| `npm run test` | PASS | 64 files passed, 7 conditional live-gate files skipped; 315 tests passed, 14 established skips |
| `npm run build` | PASS | Next.js production build and Worker TypeScript build |
| Repository Reality Gate | PASS | Real Gate mode 4/4: smoke, smoke recovery, real Remote materialization, repository A/B recovery |
| `npm run worker:doctor -- --json` | PASS | Real OS/Node/npm/architecture/memory/disk/tool/PID detection; fixed smoke and repository materializer capabilities |
| Worker CLI setup/start smoke | PASS | Independent process completed real pair/heartbeat/claim/artifact/hash/cleanup path |
| Worker A / Worker B recovery | PASS | Real 5-second expiry; A stale operations fenced; B attempt 2 completed |
| Public Receipt Browser verification | PASS | Repository Receipt Verify click, reload persistence, 1440/390 responsive checks, no internal ID/PID/path/token/raw-log leak, zero console errors |
| Managed Sandbox Reality Gate | PASS | Real smoke and timeout; deny-all; seven Artifacts; Server hash; valid Ledgers; all Sandboxes stopped/no Snapshot; public Receipt valid |
| Real Build/Test Managed Sandbox Gate | PASS with disclosed harness correction | One real run: install `0`, build `NOT_PRESENT`, intentional test `1`, Source unchanged, 18 Artifacts, valid Ledger, cleanup, `FAILED` Receipt / `VALID` integrity; no rerun after correcting the build-presence assertion |
| Agent Repair Managed Sandbox Gate | PASS with disclosed final-response rate limit | One authorized recovery: live free model, eight successful tools, only `src/add.ts` changed, repaired test `0`, 13 Artifacts, valid 34-entry Ledger, cleanup, `VERIFIED` Receipt; two post-repair text-only requests returned `429` |
| GitHub Delivery and Independent Verification Gate | PASS with disclosed partial attempt | Real branch/Commit/open PR #1; exact Remote Commit re-materialized in a fresh non-AI Vercel Sandbox; 2/2 tests passed; 20 Artifacts and Ledger/Receipt valid; cleanup passed; simulated payout released after verification only; first offline newline-comparison mismatch preserved |
| Agent Identity and Interoperability V1 Gate | PASS, local deterministic boundary | Stable Agent ID, three hashed profile revisions, distinct execution identity, exact Contract/Lease/Evidence/Receipt binding, 10 denied probes, 22-entry Ledger, typed unverified ERC-8004/HOL references, no live external action |
| Agent Identity Production Persistence V1 | OWNER ACCEPTED local contract; Beta Gate 1 MILESTONE PASS pending external review | Five migrations, Auth/RLS, atomicity, bounded concurrency, update/delete immutability, durability, advisors, cleanup, and repository regression passed in non-production |
| Two-Job Reputation Entry Corpus Pilot | FAIL / not promotable | Exactly two attempted Jobs and four cleaned Sandboxes; in-memory result `PARTIAL`/0 verified candidates; complete Job evidence was not persisted, no rerun occurred, canonical corpus remains 0 |
| Build/Test Receipt Browser verification | PASS | Verify click, integrity/outcome separation, 1440x900 and 390x844 overflow checks, zero console errors/warnings |
| Delivery Receipt Browser verification | PASS | Verify click, required delivery/PR/clean-test/payment claims, 1440x900 and 390x844 overflow checks, no framework error overlay |
| `npm run test:e2e` | PASS | 2 Chromium tests; full Demo completes in 11.5 seconds |
| `npm audit --audit-level=high` | PASS | 0 vulnerabilities reported |

The local Demo acceptance loop is complete and reproducible. Production integrations remain deliberately gated by the blockers below.

## Production blockers

1. Produce the complete third-party recomputation export required before production/public verification claims; the accepted Beta Gate 3 review records this as a non-blocking evidence-depth limitation.
2. Keep general GitHub App grants and arbitrary Customer repositories gated; real materialization, repair, delivery, and independent verification apply only to the exact public Fixture/Commit/patch/PR recorded by the Gates.
3. Keep PR merge, Fixture deployment, and any generalized Git delivery paused for owner review. General Agent repair remains limited to the exact verified Fixture boundary. Local self-hosted Docker remains deferred, not a default MVP prerequisite.
4. Replace the Worker development credential file with native OS keychain implementations.
5. Add accessibility, external webhook interoperability, penetration, and operational recovery testing.
6. Add production queues/scheduling, multi-instance concurrency controls, observability, retention, backup, and incident procedures.

## Adapter truth table

| Component | Current usable mode | Production status |
| --- | --- | --- |
| Task analysis | Demo and RuleBased | LLM adapter not connected |
| Execution | Real fixed `WORKER_SMOKE_V1`, exact-allowlist `REPOSITORY_MATERIALIZE_V1`, platform Vercel smoke/timeout, one exact-Fixture managed install/failed-test run, one bounded live Gateway repair, and one exact GitHub delivery plus fresh non-AI verification; legacy Demo Worker | General repository execution/delivery, successful build evidence for this build-less Fixture, and Webhook work remain paused or unverified |
| A2A | Agent Card import | Full task protocol not implemented |
| Agent Identity | Versioned identity/execution binding, append-only SQLite profiles, mode-aware identity API adapter, and Beta Gate 1 live validation PASS on a disposable Supabase project | Non-production database boundary passed; production deployment, public Auth session flow, management UX, legal assurance, and live external linkage verification remain incomplete |
| Repository | Real clone/metadata/Manifest, managed install/test/repair, and one real open-PR delivery plus independent verification for the exact public Fixture/Commit/patch; Demo elsewhere | Production GitHub App grants, arbitrary repositories, merge/deploy, and generalized delivery incomplete |
| Persistence | Local SQLite plus Agent Identity-specific Supabase adapter contract; five live migrations and complete Beta Gate 1 non-production evidence | Remaining Marketplace/Storage adapters, deployment, operational recovery, and production validation are incomplete |
| Evidence | Real local Artifact hash + content binding + append-only Ledger + Receipt for fixed Worker smoke, repository materialization, Managed Sandbox smoke, exact-Fixture build/test failure, bounded Agent Repair, and exact GitHub delivery/independent verification; Demo evidence elsewhere | Production object storage and external trust anchor incomplete |
| Payment | Test Ledger | No real payment or Stripe Connect |
| MCP | Capability metadata | No platform-hosted MCP and no secret transfer |
