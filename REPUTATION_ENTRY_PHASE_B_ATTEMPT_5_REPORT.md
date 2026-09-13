# Phase B Attempt 5 - V2 Live Corpus Collection

## Classification

`PARTIAL - ONE VERIFIED DELIVERY CANDIDATE, ONE INCONCLUSIVE JOB`

Attempt 5 is complete and immutable. It is not a full batch PASS. One Job
reached `VERIFIED_DELIVERY` under its pre-execution V2 policy and is eligible
for an Owner classification decision. The other produced no deliverable and
remains `INCONCLUSIVE`.

No candidate was counted and Evidence-Based Reputation did not start.

## Stage 0 Preflight

Stage 0 passed before any Attempt 5 Job database or lifecycle existed:

- development Vercel OIDC was structurally valid, current, and exactly bound to
  `nickhois-projects/donelayer`
- the authenticated non-model AI Gateway catalog check returned three eligible
  zero-price models
- `TEST_AND_FIX` ref `donelayer/repair/reputation-async-retry-v3` resolved to
  exact Commit `abf1bc277a7c27a4b50ab32033cf5d3ef8ee7728`
- `BUILD_RESCUE` ref `donelayer/repair/reputation-path-alias-v3` resolved to
  exact Commit `746fa8ba7cef938a6245be3952e97f8697dfd2ca`
- both exact Source packages were materialized and all temporary workspaces
  were cleaned
- no Stage 0 mutation, model request, Sandbox, or Job lifecycle occurred

The preflight ran from `2026-09-05T16:30:21.942Z` through
`2026-09-05T16:30:30.519Z`. Its embedded SHA-256 is
`b09f6f570fc77098ac717c499aae6c7ba24f991fb7831db40b6e93d8576d9022`.

## Locked Policy And Identity

Both new `VERIFIED_WORK_CONTRACT_V2` Contracts selected
`INDEPENDENT_ACCEPTANCE_SUFFICIENT` before execution. No result-dependent
policy selection occurred.

One new ACTIVE Agent profile revision was used across both Jobs:

- Agent ID: `agt_uC1FuYyZKGgEi5MiGils9eEs`
- revision: `1`
- profile SHA-256:
  `49ed663b7dabe8b4f1ac0ddea593717b9a7e22609e9f9de52fd8b5e1a90f90f1`

The DoneLayer HEAD and complete tracked/untracked working-tree identity were
captured before lifecycle execution. `UNRECORDED` provenance was not allowed.

## Job 1 - TEST_AND_FIX

- Job ID: `0e511627-1593-4963-8d5c-84d9953ff729`
- execution ID: `exe_9gl6xyZZFJg0kEimjIhp-HiS`
- Work Contract SHA-256:
  `305e5b43f926087828a91f8a3c72d55b5f93b503c28b9a065ae9499d64316872`
- Authority SHA-256:
  `48ef6ddd9e53d7e449bbf1d8930bcd23a879e8c05ec8c36287847850126cd8a4`
- selected model: `inclusionai/ling-3.0-flash-fin`
- model requests: `7`
- Agent process outcome: `PROVIDER_FAILURE`
- failure attribution: `MODEL_PROVIDER`
- provider finish reason: `AI_GATEWAY_MODEL_REQUEST_FAILED`

Before the provider failure, eight durably recorded controlled tool calls
succeeded. The Agent changed only `src/retry.ts`, correcting the retry loop to
perform the initial attempt plus the allowed retry count. The exact patch
SHA-256 is
`c61a9eff7bf269176a2cbb244335902053053a7dde9607e866887e7b9b7294f2`.
Tests and protected acceptance material were unchanged.

A fresh independent non-AI Sandbox applied the recorded patch and passed the
locked verification command with exit `0`. Independent verification is
`VERIFIED`. Every delivery trust check is true, including complete required
Evidence, Source integrity, Authority, provenance, lifecycle, cleanup, and
external-effect compliance.

Under the locked independent-acceptance policy, the final Contract outcome is
`VERIFIED_DELIVERY`. The candidate is eligible but remains:

- `counted: false`
- `reputationEntered: false`

Evidence identifiers:

- Evidence Bundle:
  `856240fd1dc59981e7417640c29c7909231bf779647204738bfc61ae429fbc5d`
- Ledger: 46 entries, chain
  `ab013f41ba2cd298abb15837ae7fe710c68ee7c1f306ba0bf2dd31c2ec6b8ef2`
- Receipt:
  `1a5d1cee356e71b21cea2e14bdad8096fd8cd8da57a09d777a78d4dc065e5bc5`

## Job 2 - BUILD_RESCUE

- Job ID: `940ce9ac-e6d7-419c-a198-07bf24620e4a`
- execution ID: `exe_BBu-hkGFGF3MA7IfmGwjqNeP`
- Work Contract SHA-256:
  `8cd96bd981410d6c131dfbcd57f0b52c9a2756f008d6604de72abd59947d79d4`
- Authority SHA-256:
  `7dc452ed7c770726af340a9eba8a0af3b24fb6b67bc8e4050b9cf01d25edfb73`
- selected model: `inclusionai/ling-3.0-flash-fin`
- model requests: `2`
- Agent process outcome: `PROVIDER_FAILURE`
- failure attribution: `MODEL_PROVIDER`
- provider finish reason: `AI_GATEWAY_MODEL_REQUEST_FAILED`

The model produced no controlled tool call and no patch. The exact empty-patch
SHA-256 is
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
The fresh independent verifier correctly recorded `NO_DELIVERABLE` and ran no
acceptance command against a nonexistent repair.

The final Contract outcome is `INCONCLUSIVE`. This Job is not candidate-eligible
and must not be rerun or relabeled as success.

Evidence identifiers:

- Evidence Bundle:
  `59950cf8c2717b1f5feaae97ca544fd814adffa4e5151afdd982d1ac3300a2de`
- Ledger: 34 entries, chain
  `b2ec6eaa68b99be7dfd0be889a966d6d5fc04ffd11512b4032dba837c3f3b5ea`
- Receipt:
  `9b20a16f85c6c4a9a4285f61deba16bc3d8ee9d44554a78c4b4dfffb35485f61`

## Limits And Cleanup

- model requests: `9 / 16`
- model token counts: unavailable and retained as `null`
- Gateway-reported cost: unavailable and retained as `null`
- eligible models: zero-price only
- declared spend cap: `$0.10`; deterministic currency enforcement remains
  unavailable and is not claimed
- managed Sandboxes: `4 / 4`
- repair and verifier Sandboxes: all Provider-observed `stopped`,
  non-persistent, cleanup-verified, and snapshot-free
- both Permission Leases: `REVOKED`
- PR, merge, deployment, payment, blockchain write, billing change, production
  credential expansion, Fixture mutation, candidate promotion, and Reputation
  entry: `0`

## Evidence Validation

The Attempt 5 SQLite store verifies read-only with:

- 81 durable records
- 78 lifecycle entries
- 2 Jobs
- valid payload hashes, lifecycle chains, V2 Contracts, Authority, Bundles,
  Ledgers, Receipts, and outcomes

Complete validation passed:

- focused Attempt 5 retained-evidence replay: `2 / 2 PASS`
- lint: `PASS`, zero warnings
- strict typecheck: `PASS`
- full suite: 276 active tests across 57 passing files; 14 established
  environment-gated tests skipped across seven files
- Web production build: `PASS`, 22 static pages generated
- Worker build: `PASS`
- `git diff --check`: `PASS`; line-ending notices were informational
- credential and local-path scan: `PASS`

Attempt 3 and Attempt 4 accepted hashes remain byte-identical. Attempt 3 and
Attempt 5 have no SQLite WAL/SHM sidecars.

Exact Attempt 5 file SHA-256 values:

- preflight JSON:
  `5df0a53cfd78bfdf5518c661716f351bbcbc7a1831a362b146dffb52e8fc1080`
- working-tree identity:
  `7d13d0bbaf9aab7865b27d1b64dce3aab5304728b2dc179c30a32cc4f8555776`
- SQLite evidence database:
  `1d87f2c84a0e6ab7445131208630201ca5b4fd2d1065c93c037bbfdf4ba349bf`
- evidence JSON:
  `98ca89e1d4bd0216570d82e95f197470d8a7b51f616b84ba29589b19df3f104b`

## Current Corpus

- eligible Attempt 5 candidates: `1`
- candidates automatically counted: `0`
- canonical real Verified Jobs before Owner classification: `0`
- current gap before Owner classification: `20`
- Evidence-Based Reputation: not started

## Owner Decision Required - Real Verified Job Classification

Proposed classification: count only the Attempt 5 `TEST_AND_FIX` candidate as
one canonical real Verified Job.

Why: it was a unique, non-Demo live Agent execution against a source Commit
that had never received Agent execution; it used a locked V2 Contract,
task-scoped Authority, controlled tools, two fresh managed Sandboxes, an exact
one-file patch, independent acceptance, complete Evidence, valid Ledger and
Receipt, revoked Lease, verified cleanup, and no prohibited effects. The
provider failure remains visible and is not reclassified.

The ambiguity is that this is an owner-controlled Fixture Job rather than a
Customer marketplace Job. Only the Owner can decide whether that satisfies the
roadmap term "real Verified Job."

If accepted, the canonical count becomes `1`, the remaining numeric gap becomes
`19`, and the only qualifying task type is `TEST_AND_FIX`. Reputation still
cannot start because the roadmap requires at least 20 real Verified Jobs, more
than one task type, and enough samples for each claimed capability.

If declined, the canonical count remains `0` and the gap remains `20`.

## Owner Decision - 2026-09-06

`DO NOT COUNT`

The Owner declined to classify the eligible Attempt 5 `TEST_AND_FIX`
candidate as a canonical real Verified Job. Its technical outcome remains
`VERIFIED_DELIVERY`, and its execution remains `PROVIDER_FAILURE` attributed to
`MODEL_PROVIDER`; neither fact was changed or reinterpreted.

Final classification effects:

- candidate eligibility: `true`
- canonical qualification counted: `false`
- Reputation entered: `false`
- canonical real Verified Job count: `0`
- remaining numeric gap: `20`
- qualifying task types: none
- Evidence-Based Reputation: not started

Attempt 5 is closed. Neither Job may be rerun or relabeled. A future corpus
collection Gate requires a separate Owner decision and must use genuinely new
work rather than treating this owner-controlled Fixture candidate as canonical
real work.

## Permanent Classification Label And Evidence

The Owner subsequently fixed the exact historical label as:

- `TEST_AND_FIX`: `BENCHMARK_FIXTURE_VERIFIED_JOB`
- `BUILD_RESCUE`: `NON_VERIFIED_BENCHMARK_ATTEMPT`

Both records have preliminary state `BENCHMARK_FIXTURE`, canonical contribution
`0`, and no audit-queue entry. These labels are permanent and must not be
historically reclassified.

The append-only classification artifact is
`test-results/reputation-entry-phase-b-attempt-5-owner-classification.json`:

- evidence SHA-256:
  `ce239b19ad025389ec9657f1d05cc24dce82dfe2422f2d6db2753666ce61dfc6`
- file SHA-256:
  `3d20d34c62b20b85a6036439b2bd046331ab1f079c008b03b82de0dbaf14e4d4`

The permanent policy is `docs/REAL_JOB_CLASSIFICATION_POLICY.md`; the separate
provisional/canonical queue is `docs/REAL_JOB_AUDIT_QUEUE.md`.
