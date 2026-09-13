# Versioned Contract Historical Validation Pre-Live Blocked

Date: 2026-09-04

## Decision

**PRE-LIVE REGRESSION GATE: FAIL / BLOCKED. PHASE B JOBS: NOT STARTED.**

The focused versioning and retained Attempt 4 tests passed, but the complete
pre-live regression Gate stopped at lint. No later Gate command or live Phase B
operation ran.

## 1. Exact Mutable-Definition Root Cause

Historical validation called the single current `taskDefinition(taskType)` and
compared the retained Contract's commands, editable files, and oracle paths to
that mutable result. Replacing current `TEST_AND_FIX` authoring semantics with
the Phase B state-transition definition therefore reinterpreted Attempt 4's
locked port-parser Contract and raised
`REPUTATION_ENTRY_WORK_CONTRACT_TAMPERING_DETECTED`.

## 2. Historical Fields Affected

The task template contributed specification, desired outcome, editable files,
protected oracle paths, ordered commands, allowed workflow and actions,
Authority limits, verifier/evidence requirements, and external-effects policy.
These values were embedded in the Contract, but their template identity was not.

## 3. Previous Validation Behavior

`schemaVersion`, `contractVersion`, `contractVariant`, `commandsSha256`, and
`workContractSha256` already protected stored bytes. Semantic validation still
looked up the latest same-name task definition, making historical validity
depend on present-day authoring configuration.

## 4. New Versioned-Definition Model

The local implementation adds append-only V1 and V2 definitions for both
`TEST_AND_FIX` and `BUILD_RESCUE`. Each definition contains its ID, positive
version, complete authoring semantics, and deterministic SHA-256. Current
authoring selects the highest registered version unless an exact version is
requested.

## 5. Immutable Definition Identity In New Contracts

New `REPUTATION_ENTRY_CANDIDATE_V2` Work Contracts carry an explicit
definition ID/version/hash. The Contract remains self-contained: validation
projects its embedded specification, policies, files, oracles, and commands and
requires an exact canonical match to the referenced immutable definition.

## 6. Historical Attempt 4 Resolution

Attempt 4 remains a legacy `REPUTATION_ENTRY_CANDIDATE_V1` Contract without a
definition reference. Compatibility resolution compares its complete embedded
semantic projection against every archived definition of the same task type and
accepts only one exact match. It does not select by task type alone, use latest
fallback, special-case Attempt 4, change a hash, or mutate evidence.

## 7. Files Changed

The versioning implementation changed
`apps/web/src/server/reputation-entry-pilot/work-contract.ts`. Focused coverage
was added in
`tests/unit/reputation-entry-task-definition-versioning.test.ts`. This blocked
report and `docs/CURRENT_PHASE.md` record the outcome. Previously prepared,
unexecuted Phase B files remain untouched by this stopped Gate.

## 8. Focused V1 To V2 Evolution Tests

**PASS, 10/10 across the versioning and existing Contract files.** Tests issued
an explicit V1 Contract, introduced the meaningful V2 semantics, confirmed the
old Contract still validates, confirmed current authoring binds to V2, and
confirmed the same task-type name does not collapse definition identities.

## 9. Missing/Wrong-Version Negative Tests

**PASS.** V2 Contracts with a missing reference, unknown version, wrong hash,
or attempted V1-to-V2 rebinding fail closed.

## 10. Historical Tampering Tests

**PASS.** Rehashed semantic mutation of a V1 Contract remains rejected, and an
archived V1 definition changed without its original hash is rejected. Canonical
object-key reload remains accepted; reordered build commands remain rejected.

## 11. Retained Attempt 4 Validation

**PASS, 1/1 retained test; creation test correctly skipped.** The persisted
Contract, Authority binding, durable records/lifecycle, Bundle, Ledger, Receipt,
final `REVOKED` Lease, and historical marker validation all passed.

## 12. Attempt 4 Byte Identity

- Database SHA-256: `280d616ec1366ab00d81962b73fb5dfefe9e0b97fe9b71a64dbac20afeae8162`
- Evidence SHA-256: `ea6a994968b93cd1dac2a192e8cb5cf6d409b4d11fc661a87237cd2850401b36`
- Work Contract SHA-256 remained `38b64c2e49dff1525ee52a86df1f77352c047d79b479d5a362250d5e14c4fa27`
- Full persisted Contract payload SHA-256 remained `e3cccb78c243d346a2bf13df71c0d6bf6e8015ec50ba58afdf5d0e34967f8fda`

Attempts 1-3 database hashes and the historical marker also remained unchanged.
The prior Phase B blocker report remains byte-identical at SHA-256
`83022f7b875c972768e001142963788dd9c31131c3875c24d283be967d1da124`.

## 13. Lint

**FAIL.** ESLint reported one error:

```text
apps/web/src/server/reputation-entry-pilot/work-contract.ts:333:10
'taskDefinition' is defined but only used as a type.
@typescript-eslint/no-unused-vars
```

The helper is referenced only by `ReturnType<typeof taskDefinition>` and has no
runtime caller. The Gate stopped without correcting it.

## 14. Strict Typecheck

Not run in the complete Gate after lint failed. An earlier intermediate check
found one indexed-access type error; that was corrected before the focused tests,
but it is not represented as a final complete-Gate typecheck PASS.

## 15. Full Suite

Not run after the complete Gate failed at lint.

## 16. Web Build

Not run after the complete Gate failed at lint.

## 17. Worker Build

Not run after the complete Gate failed at lint.

## 18. Git Diff Check

Not run after the complete Gate failed at lint.

## 19. Model Calls

0.

## 20. Sandboxes

0.

## 21. External Effects

No replacement Job, remote Fixture branch/Commit, PR, merge, deployment,
payment, blockchain action, billing action, Snapshot, credential expansion, or
external mutation occurred. No Phase B database, evidence JSON, or working-tree
identity file was created.

## 22. Pre-Live Decision

**PRE-LIVE REGRESSION GATE: FAIL / BLOCKED.**

## 23. Phase B Job Status

Neither replacement Job started. Evidence-Based Reputation did not begin.

## 24. Exact Next Action Requiring Owner Approval

The Owner must authorize removal of the unused runtime-only
`taskDefinition` helper (using the existing explicit
`ReputationEntryTaskDefinition` return type instead) and one complete pre-live
regression rerun from lint through retained Attempt 4 validation. Phase B live
execution remains separately blocked even if that Gate passes.
