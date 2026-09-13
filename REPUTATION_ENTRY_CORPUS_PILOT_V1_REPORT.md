# Two-Job Reputation Entry Corpus Collection Pilot V1 Report

Date: 2026-09-04

## Gate Decision

**FAIL / NOT PROMOTABLE.** The bounded batch consumed exactly two approved Jobs
and returned an in-memory pilot decision of `PARTIAL` with zero verified
candidates. The integration harness then failed its expected-`PASS` assertion
before writing the returned outcome. Complete per-Job evidence is therefore not
available and neither Job can count as a canonical real Verified Job.

Reputation scoring, ranking, trust scores, capability scoring, matching,
payments, marketplace work, and Robot Deployment Intelligence did not begin.

## Scope And Limits

| Limit | Result |
| --- | --- |
| Jobs | 2 attempted / 2 maximum |
| Task types | `TEST_AND_FIX`, `BUILD_RESCUE` |
| Agent continuity | One new ACTIVE profile revision was used in memory across both Jobs; exact identity was not persisted |
| Model requests | Hard code limit `<=16`; exact observed count was lost with the outcome |
| Model pricing | Only catalogued zero-price models were eligible; exact selected model and Gateway cost were lost |
| Currency cap | `$0.10` proposed cap was not deterministically enforceable by the Provider |
| Sandboxes | 4 created / 4 maximum; all stopped, non-persistent, no Snapshot |
| PR / merge / deploy / payment / blockchain | 0 / 0 / 0 / 0 / 0 |

## Job 1 - TEST_AND_FIX

1. **Task type:** `TEST_AND_FIX`.
2. **Exact requested outcome:** make `parsePort(input)` accept only a trimmed whole-decimal integer from 1 through 65535 without changing the locked tests or acceptance criteria.
3. **Agent ID/profile revision:** one new ACTIVE owner-controlled pilot Agent was used; exact Agent ID, revision, profile hash, and profile document were not persisted.
4. **Execution ID:** generated and bound in memory; not recoverable. Provider Sandbox prefix: `c8cbd132-989b-4738-b`.
5. **Work Contract:** `VERIFIED_WORK_CONTRACT_V1`, candidate variant; unique ID/version/hash were generated but not persisted.
6. **Authority Lease:** bound in memory to the Contract, Agent, execution, exact source, `src/parse-port.ts`, and two Sandboxes. Its ID/hash/operations were lost, and its `COMPLETED` disposition did not satisfy the Owner's revoke-or-expire requirement.
7. **Source:** `NickHOI/donelayer-build-rescue-fixture`, branch `donelayer/repair/reputation-test-and-fix-v1`, Commit `abb6f4e3555acb94a2ea8878b053dec9690e6f89`.
8. **Actual Agent execution outcome:** a real bounded Agent Sandbox ran, but exact tool calls, patch, model outcome, and failure reason are not recoverable. No substitute history was created.
9. **Evidence Bundle:** generated in memory but not persisted; hash unknown and completeness cannot be independently recomputed.
10. **Independent verification:** fresh Sandbox `donelayer-verify-c8cbd132-989b-4738-b` ran; exact command results were not persisted, so success cannot be claimed.
11. **Receipt:** generated in memory, then lost; ID, result, and hash unavailable.
12. **Cleanup:** both Sandboxes are Provider-observed `stopped`, non-persistent, and snapshot-free; the Fixture preparation workspace was removed.
13. **Reached `VERIFIED_DELIVERY`:** **No.** The aggregate recorded zero verified candidates and the full evidence chain is unavailable.
14. **`REPUTATION_ENTRY_CANDIDATE`:** attempted in memory, but not a durable promotable candidate because the record was not persisted.
15. **Real Verified Job assessment:** **No.** Missing immutable Bundle, Ledger, Receipt, exact execution, independent command evidence, and compliant Lease revocation are disqualifying.

## Job 2 - BUILD_RESCUE

1. **Task type:** `BUILD_RESCUE`.
2. **Exact requested outcome:** restore the required `normalizeSlug` public package export while preserving the already passing internal-module behavior and protected build verifier.
3. **Agent ID/profile revision:** the same ACTIVE pilot profile revision was used; exact Agent ID, revision, profile hash, and profile document were not persisted.
4. **Execution ID:** generated and bound in memory; not recoverable. Provider Sandbox prefix: `4c9d78fb-8541-41bd-9`.
5. **Work Contract:** `VERIFIED_WORK_CONTRACT_V1`, candidate variant; unique ID/version/hash were generated but not persisted.
6. **Authority Lease:** bound in memory to the Contract, Agent, execution, exact source, `src/index.ts`, and two Sandboxes. Its ID/hash/operations were lost, and its `COMPLETED` disposition did not satisfy the Owner's revoke-or-expire requirement.
7. **Source:** `NickHOI/donelayer-build-rescue-fixture`, branch `donelayer/repair/reputation-build-rescue-v1`, Commit `c31360d1e64c457bdeeea9820840876d9c4b77be`.
8. **Actual Agent execution outcome:** a real bounded Agent Sandbox ran, but exact tool calls, patch, model outcome, and failure reason are not recoverable. No substitute history was created.
9. **Evidence Bundle:** generated in memory but not persisted; hash unknown and completeness cannot be independently recomputed.
10. **Independent verification:** fresh Sandbox `donelayer-verify-4c9d78fb-8541-41bd-9` ran; exact build/test results were not persisted, so success cannot be claimed.
11. **Receipt:** generated in memory, then lost; ID, result, and hash unavailable.
12. **Cleanup:** both Sandboxes are Provider-observed `stopped`, non-persistent, and snapshot-free; the Fixture preparation workspace was removed.
13. **Reached `VERIFIED_DELIVERY`:** **No.** The aggregate recorded zero verified candidates and the full evidence chain is unavailable.
14. **`REPUTATION_ENTRY_CANDIDATE`:** attempted in memory, but not a durable promotable candidate because the record was not persisted.
15. **Real Verified Job assessment:** **No.** Missing immutable Bundle, Ledger, Receipt, exact execution, independent build/test evidence, and compliant Lease revocation are disqualifying.

## Implemented

- Candidate-only Work Contracts with exact source manifests, protected oracle
  hashes, task-specific commands, and whole-document hashes.
- Generalized task-scoped Authority policies while preserving the legacy
  addition Gate defaults.
- Task-specific editable-file controls and test/build baseline profiles.
- Per-Job Agent Sandbox plus fresh independent-verifier Sandbox execution.
- Candidate Evidence Bundle, append-only hash-chained Ledger, Receipt, explicit
  post-Job Lease revocation, credential scanning, and immutable SQLite schema.
- Candidate Receipts can never count automatically: `counted` is always false
  and Owner definition acceptance plus explicit promotion are required.
- A fail-closed persistence correction: outcomes are written before PASS
  assertions, and prior attempt markers cannot be overwritten.

The future code path now revokes each Lease. This correction was not used to
rewrite the two attempted Jobs and is not evidence that their Leases were
properly revoked.

## Qualification Definition Proposed

A candidate may become a qualifying real Verified Job only when all of the
following are true:

1. It is a genuine non-Demo Agent execution with a unique task outcome, not a duplicated Fixture replay.
2. A versioned locked Work Contract names the exact source, protected oracle, acceptance commands, Agent profile revision, and evidence requirements.
3. A task-scoped Permission Lease binds that Agent and execution to the Contract, Repository, Commit, files, actions, Sandbox Providers, and limits.
4. The Agent uses only controlled tools in a non-persistent managed Sandbox and cannot change the oracle.
5. A different fresh managed Sandbox reconstructs the exact source, applies the recorded patch, and passes every locked acceptance command.
6. The immutable complete Evidence Bundle links to a valid append-only Ledger and Receipt and passes credential scanning.
7. Every Sandbox is stopped without a Snapshot and every external effect is disclosed.
8. Owner review accepts this definition and explicitly promotes the candidate; candidate creation alone never changes corpus totals.

The definition is recommended for future evidence collection. The two Jobs in
this report do not satisfy it because their complete records were not persisted.

## Validation And Evidence

- Fixture baseline checks: `TEST_AND_FIX` tests failed on the validation defect;
  `BUILD_RESCUE` internal tests passed and package build failed on the export.
- New unit tests and TypeScript checks passed before the live run.
- The live integration test ran for 118.762 seconds and correctly failed because
  expected `PASS`/2 verified candidates differed from actual `PARTIAL`/0.
- Final local validation passed: lint, strict TypeScript, production web/Worker
  build, and 198 tests across 42 passing files; 10 conditional tests in 7 files
  were skipped.
- Remote verification confirmed both exact Fixture branch/Commit pairs, no PR
  exists for either branch, and no Fixture preparation workspace remains.
- Recovered Provider metadata is preserved in
  `test-results/reputation-entry-pilot-attempt-1-recovered.json`.
- Exact model request count, model ID, token usage, Gateway cost, Agent actions,
  patches, Bundle hashes, Ledgers, and Receipts remain unavailable.
- Both attempted Leases used an insufficient `COMPLETED` disposition rather
  than the specifically required revoked/expired state. This is preserved as a
  second independent disqualifying failure.

## Current Corpus And Gap

- Current qualifying real Verified Jobs: **0**
- Current qualifying task types: **none**
- Non-qualifying pilot work: **2 attempted Jobs**, one per requested task type
- Remaining Reputation entry gap: **20 qualifying real Verified Jobs**, more
  than one qualifying task type, and enough samples for each claimed capability

## Exact Next Step

Owner approval is required for a replacement bounded evidence-collection batch.
It must use new, materially distinct source Commits and defects, preserve this
failed attempt, and persist every returned outcome before evaluating success.
No replacement batch and no Reputation implementation is authorized yet.
