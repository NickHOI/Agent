# Verified Work Contract V1 Design and Evidence Gate

Date: 2026-09-03

## Gate Decision

`PASS`, at the narrow owner-controlled Fixture boundary described below.

This result proves a versioned Work Contract, deterministic Evidence Bundle
projection, independent result semantics, append-only supersession, Receipt
binding, and one bounded real repair/delivery flow. It does not make these
capabilities general or production-ready.

## Implemented

- `VERIFIED_WORK_CONTRACT_V1` locks the requested outcome, owner-authoritative
  structured acceptance criteria, exact Source identity, permissions, required
  Evidence, deterministic verifier policy, outcome policy, and whole-contract
  SHA-256.
- `VERIFIED_WORK_EVIDENCE_BUNDLE_V1` binds the Work Contract, permission
  decision, Source Manifest, Agent repair Receipt, repair patch, delivery diff,
  and independent verification. Its deterministic projection records required,
  satisfied, and missing Evidence and cannot claim `VERIFIED_DELIVERY` with an
  incomplete projection or failed verification dimension.
- Receipt semantics keep Agent-reported and independently verified completion
  as separate fields. Review-only evidence cannot claim verified delivery.
- The existing Evidence Ledger records Evidence Bundle creation. The public
  Receipt binds its primary Artifact hash to the Evidence Bundle hash.
- Historical Receipt integrity remains unchanged; the new semantic assessment
  is append-only and records the historical semantic-success claim as
  `SUPERSEDED`.
- Negative tests cover Work Contract mutation, Evidence Bundle mutation,
  missing Evidence, false verified success, assertion-result mutation, and
  unapproved source branches.

## Real Bounded Proof

The live Gate ran from `2026-09-03T13:26:04Z` to
`2026-09-03T13:27:25Z`.

1. Exact historical `main` Commit
   `600f326ce373160eb5495aaef72230d4c9807e8f` produced a deterministic
   `SPEC_TEST_CONFLICT`: the repository expected `add(2, 2) = 5`, while the
   locked owner assertion required ordinary arithmetic result `4`. No Agent
   call, repair Sandbox, or payout was authorized for that conflict.
2. The historical Receipt was independently revalidated, then append-only
   semantic review recorded `SUPERSEDED` without modifying its original hash or
   execution evidence.
3. Exact isolated branch `fixture/real-source-bug-v1`, Commit
   `5ae6dd136b99c4727e8ac50833a716cfbbf4ae00`, contained a real source bug and
   four correct repository tests.
4. Live model `inclusionai/ling-3.0-flash-fin` made eight successful bounded
   tool calls in a non-persistent Vercel Sandbox. It modified only
   `src/add.ts`; baseline test exit was `1`, repaired test exit was `0`, and
   four locked Contract assertions passed. A follow-up model request failed, so
   the Agent run remains truthfully `FAILED` while the independently evaluated
   repair outcome is `VERIFIED`.
5. The exact patch SHA-256 is
   `b9aee74ff52dfe2f5a7d1c7bd478b333d656b6f4ce68b77212f5d863f441c1db`.
   It was delivered to branch `donelayer/repair/c30fdf0e687d`, Commit
   `3c96382fc6e8a2f154ad422286b6cf63c75397b3`, with parent
   `5ae6dd136b99c4727e8ac50833a716cfbbf4ae00`, and GitHub PR #2. The PR is
   `OPEN` and unmerged.
6. A separate non-AI verifier re-materialized the Remote Delivery Commit in a
   fresh Vercel Sandbox. Install exited `0`, build was truthfully
   `NOT_PRESENT`, repository test exited `0` with 4/4 passing, all four locked
   Contract assertions passed, tests/configuration remained unchanged, and
   cleanup passed.
7. Both Sandboxes stopped, were non-persistent, and created no Snapshot. The
   controlled delivery workspace was removed.
8. Evidence Bundle
   `bedc4785e44968606fc512996799102882a74ee4f98845fadecb4532ee7e5dd9`
   has all nine required Evidence categories satisfied. The delivery Receipt
   hash is `c3e230a1120a53a8ba3452406902cbf6b3893002e5acb9ab7dcf4a5dd469b3ee`;
   its pre-Receipt chain has 34 entries and the full Ledger has 35.
9. The Test Ledger released only simulated funds: `$8.00` Provider and `$2.00`
   platform from a simulated `$10.00` charge. No real funds moved.

GitHub PR: <https://github.com/NickHOI/donelayer-build-rescue-fixture/pull/2>

## Evidence

- `test-results/semantic-verification-real-evidence.json`, SHA-256
  `4fb77e55c717318070937a0a8ffbfc084fc6e5b63bc0d166c07f1c43522bbc94`
- `test-results/semantic-verification-reality.sqlite`, SHA-256
  `393f5997b71e3cebd027735c40d369510e82cc5e7378814c659e1ab8fa7b5004`
- `test-results/semantic-true-repair.patch`, SHA-256
  `b9aee74ff52dfe2f5a7d1c7bd478b333d656b6f4ce68b77212f5d863f441c1db`
- `test-results/semantic-delivery-diff.patch`, SHA-256
  `58c206e4553437f9af7d1aa0192d1f0ccd963b4c6eb3f6eb243ce80f193c3a5c`
- `test-results/semantic-donelayer-working-tree-identity.txt`
- Initial fail-closed attempt:
  `test-results/verified-work-contract-v1-source-boundary-failure-evidence.json`
  and
  `test-results/verified-work-contract-v1-source-boundary-failure-worktree-identity.txt`

The initial attempt rejected the isolated Fixture branch at the Source runner
boundary. It made zero Agent calls and authorized no payout. Its Sandbox was
located and stopped as recorded in `VERIFIED_WORK_CONTRACT_V1_BLOCKED.md`. The
runner now permits only `main`, an exact explicit approved Fixture branch, or a
bounded repair branch; arbitrary scenario branches remain rejected.

## Validation

- focused Work Contract/source-boundary suite: 10 tests passed
- live Gate: 1 test passed
- persisted evidence suite: 2 tests passed
- full ordinary suite before the live Gate: 174 passed, 7 live-gated tests
  skipped
- typecheck: passed
- lint: passed
- production Web and Worker build: passed

## Remaining Limits

- One public owner-controlled Fixture and two exact Commits only.
- GitHub authentication is owner development authentication, not a production
  GitHub App installation grant.
- Local SQLite and local Evidence files are not production storage, external
  timestamps, or portable credentials.
- The Work Contract schema currently has one structured function-example
  assertion shape for this Fixture, not a general task-authoring system.
- Vercel Sandbox is the only managed Provider; there is no Provider failover.
- Build success was not demonstrated because the Fixture has no build script.
- The Agent follow-up request failed and token/cost fields were unavailable;
  those fields remain null rather than estimated.
- PR merge, deployment, production persistence/auth, general repositories,
  real payment, portable attestation, later roadmap phases, and Robot
  Deployment Intelligence were not started.

## Exact Next Step

Stop for owner review. After separate owner approval, the next canonical phase
is a narrow **TASK-SCOPED AGENT AUTHORITY V1 DESIGN AND EVIDENCE GATE** that
extends the existing Permission Lease for one Work Contract. Do not begin that
Gate, merge either PR, deploy, or enable real payment without that approval.
