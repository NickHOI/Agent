# VERIFIED DELIVERY OUTCOME SEMANTICS AUDIT

## 1. Audit Boundary

This is a read-only/product-semantics audit of the accepted Phase B Attempt 3 record.

- No Phase B rerun occurred.
- No Attempt 4 was created.
- No model request or Sandbox was created.
- No Attempt 3 Job, execution, Work Contract, Permission Lease, Evidence Bundle, ledger chain, Receipt, evidence database row, or classification was changed.
- Attempt 3 remains `PHASE B ATTEMPT 3 — PARTIAL / BLOCKED`.
- `VERIFIED_DELIVERY` remains not achieved for Attempt 3.
- `REPUTATION_ENTRY_CANDIDATE` remains false for Attempt 3.
- Evidence-Based Reputation was not started.

## 2. Executive Finding

The Attempt 3 `TEST_AND_FIX` Job was denied the pilot's final `VERIFIED` result by one condition: the Agent execution protocol ended with `agentRun.status === "FAILED"` instead of `"COMPLETED"`. The materialized patch and every independent artifact-verification condition passed.

That protocol-status hard gate is implemented locally in the Phase B pilot orchestrator. It is not an explicit condition in the approved V2 Work Contract or task definition. It is also in tension with the product's established separation of Agent-reported completion from independent verification and with the four-dimensional verification model already expressed in the semantic-verification contract.

This does not justify retroactively promoting Attempt 3. It identifies a forward-looking policy ambiguity that the owner should resolve before another qualifying execution.

## 3. Current Decision Path

The Phase B pilot computes a single `ReputationEntryResult` in `apps/web/src/server/reputation-entry-pilot/orchestrator.ts`:

1. It builds `agentActionComplete` from Agent protocol status, a successful primary tool result, patch and authority checks, and evidence-tool calls.
2. It returns `VERIFIED` only when `agentActionComplete` and `independentVerification.verified` are both true.
3. Otherwise, a nonempty patch plus verifier commands maps to `FAILED`; absence of either maps to `INCONCLUSIVE`.
4. The Evidence Bundle records Agent execution and independent verification separately, but the Receipt accepts the already-collapsed result.
5. The ledger emits `CANDIDATE_VERIFIED` only for `VERIFIED`; all other results emit `CANDIDATE_NOT_VERIFIED`.

The pilot has no distinct `VERIFIED_DELIVERY` enum. The Phase B report maps a pilot result of `VERIFIED` to the delivery qualification and treats `FAILED` or `INCONCLUSIVE` as not achieving `VERIFIED_DELIVERY`.

## 4. Complete `TEST_AND_FIX` Condition Table

All evidence paths below are rooted at `outcome.jobs[0]` in the immutable
`test-results/reputation-entry-phase-b-attempt-3-evidence.json` unless stated
otherwise.

| # | Current condition for `VERIFIED` | Attempt 3 and evidence source | Requirement classification |
|---|---|---|---|
| 1 | Agent run status is `COMPLETED` | **Unsatisfied:** `agentRun.status = FAILED` | Phase B orchestrator implementation only; not explicit in the locked V2 Work Contract |
| 2 | Last Agent `run_test` primary action succeeds with exit code 0 | Satisfied: `toolCalls[5].toolName = run_test`, `success = true`, `output.exitCode = 0` | Acceptance command is Contract-defined; requiring a same-Sandbox Agent-side success is an orchestrator policy |
| 3 | Patch modifies at least one file | Satisfied: `patch.modifiedFiles = [src/order-state.ts]` | Desired repair outcome and task definition |
| 4 | Modified files exactly equal the allowed editable-file set | Satisfied: `patch.modifiedFiles` equals `contract.authorityPolicy.allowedFiles` | Locked Work Contract authority boundary |
| 5 | Repair source materialization has no missing files | Satisfied: `repairSourceIntegrity.missing = []` | Evidence/source-integrity platform policy |
| 6 | Repair source materialization has no added files | Satisfied: `repairSourceIntegrity.added = []` | Authority and source-integrity platform policy |
| 7 | Repair source materialization has no unauthorized modified files | Satisfied: `repairSourceIntegrity.unauthorizedModified = []` | Locked Work Contract authority boundary and platform policy |
| 8 | Agent successfully calls `get_diff` | Satisfied: `toolCalls[6]` is successful `get_diff` | Orchestrator evidence-collection assumption implementing required `SOURCE_CHANGE` evidence |
| 9 | Agent successfully calls `get_source_integrity` | Satisfied: `toolCalls[7]` is successful `get_source_integrity` | Orchestrator assumption implementing source-integrity platform policy |
| 10 | Independent verification uses a fresh Sandbox | Satisfied: `independentVerification.freshSandbox = true`; verifier and repair Sandbox IDs differ | Locked Work Contract evidence policy |
| 11 | Baseline command fails before repair | Satisfied: `independentVerification.baseline.exitCode` is nonzero | Locked Work Contract acceptance policy |
| 12 | Verifier runs exactly all Contract acceptance commands | Satisfied: `independentVerification.commands.length = 1`; `contract.acceptanceCriteria.commands.length = 1` | Locked Work Contract acceptance criteria |
| 13 | Every independent verifier command exits 0 | Satisfied: `independentVerification.commands[0].exitCode = 0` | Locked Work Contract acceptance criteria |
| 14 | Every protected oracle remains valid | Satisfied: every `independentVerification.oracleFiles[*].valid = true` | Locked Work Contract protected-oracle boundary |
| 15 | Independently verified patch hash/files match the Agent patch | Satisfied: `independentVerification.matchesAgentPatch = true` and the patch SHA/files bind | Delivery-integrity platform policy |
| 16 | Independent source check has no missing, added, or unauthorized modified files | Satisfied: all three `independentVerification.sourceIntegrity` arrays are empty | Work Contract authority boundary and source-integrity platform policy |
| 17 | Repair and verification Sandboxes are verified cleaned up | Satisfied: both cleanup objects have `cleanupVerified = true` and final state `stopped` | Locked platform policy |
| 18 | No Snapshot exists | Satisfied: both cleanup objects have `snapshotCreated = false` | Locked platform policy |
| 19 | Conditions 1-18 collapse to `agentActionComplete && independentVerification.verified` | **Unsatisfied solely because of #1:** `independentVerification.verified = true`, but Job and Receipt `result = FAILED` | Phase B orchestrator implementation |

Evidence Bundle completeness, ledger integrity, Receipt integrity, Permission Lease revocation, and cleanup were all valid. They are produced or checked around the result, but are not additional predicates in the line that computes the pilot result. A valid Receipt proves that the Receipt faithfully preserves the computed outcome; it does not turn a `FAILED` outcome into a successful one.

## 5. First and Final Preventing Condition

The first and ultimately decisive condition preventing `TEST_AND_FIX` from becoming `VERIFIED` was:

```ts
agentRun.status === "COMPLETED"
```

Every other conjunct in `agentActionComplete` was satisfied. `independentVerification.verified` was also true. Because the protocol status was `FAILED`, the orchestrator selected `FAILED` through its fallback branch for a Job that had both a patch and independent verifier commands.

## 6. Artifact Success vs Protocol Failure

The accepted Attempt 3 record supports all of these statements at once:

- The Agent execution protocol failed during finalization/reporting.
- The repair Sandbox produced a bounded patch.
- The patch touched exactly `src/order-state.ts`.
- The independent verifier used a fresh Sandbox.
- The baseline failed as required.
- The repaired acceptance command passed.
- Protected test material remained valid.
- The independently observed patch matched the Agent patch.
- Source authority, lifecycle, cleanup, no-Snapshot, Evidence Bundle, ledger, and Receipt integrity checks passed.

Accordingly, the execution/reporting outcome was failed while the independently verified artifact outcome was successful. The current pilot collapses those facts into one `FAILED` result.

## 7. Work Contract Requirement Audit

The approved V2 `TEST_AND_FIX` Work Contract requires the order-state transition repair, limits edits to `src/order-state.ts`, protects `tests/order-state.test.ts`, requires `npm test` to exit 0 after a failing baseline, requires independent evidence, and declares that Agent-reported completion alone is insufficient.

It does **not** explicitly say that the Agent protocol must return a `COMPLETED` final status after the independently verified artifact has satisfied every acceptance, authority, evidence, and cleanup condition. The `COMPLETED` gate is therefore an implementation assumption in the Phase B pilot, not a locked task-definition or Work Contract entry condition.

## 8. Evidence and Receipt Architecture

The architecture separates the underlying facts only partially:

- The Evidence Bundle stores Agent execution status separately from `independentVerification.verified`.
- Bundle completeness checks required category presence, not successful semantic outcome.
- The Receipt stores a single collapsed `result` plus supporting usage and cleanup fields.
- The ledger derives its candidate event from that single result.

The broader semantic-verification contract is more expressive. It separates `EXECUTION_INTEGRITY`, `TEST_CONFORMITY`, `CONTRACT_CONFORMITY`, and `DELIVERY_INTEGRITY`, and distinguishes Agent-reported completion from independently verified delivery. However, parts of the semantic-delivery implementation still derive execution integrity from an overall successful delivery status, so the conceptual separation is not yet consistently enforced end to end.

Under Work Contract V1, `agentReported = REPORTED` means that Agent-report
evidence exists; it does not assert that the Agent reported success or that the
provider protocol ended `COMPLETED`. Likewise, `executionIntegrity = VALID` is
an integrity dimension, not presently a complete vocabulary for protocol
outcomes such as timeout or provider failure. The accepted Verified Work Gate
itself recorded a failed Agent run after the repair existed while retaining a
separately verified repair and delivery. This makes the Phase B protocol-status
gate a local inconsistency, not an unavoidable consequence of the V1 terms.

## 9. Existing-Test Audit

The current tests establish the persisted behavior but do not justify the
protocol-status hard gate:

- `tests/integration/reputation-entry-phase-b-attempt-3-blocked-evidence.test.ts`
  locks the immutable Job results as `FAILED` and `INCONCLUSIVE`, while also
  requiring complete Bundles, valid ledgers, revoked Leases, cleanup, and
  uncounted Receipts.
- `tests/integration/reputation-entry-phase-b-attempt-3-revalidation.test.ts`
  proves read-only durable/lifecycle integrity and again preserves those two
  results and Receipts.
- `tests/unit/reputation-entry-pilot.test.ts` proves that only the already
  computed `VERIFIED` enum counts as a verified candidate; it does not test how
  the result should be computed.
- `tests/integration/reputation-entry-pilot-reality.test.ts` covers the clean
  success path, expecting both Jobs and independent verification to be
  `VERIFIED`; it lacks an isolated truth-table case for a failed protocol plus
  a verified artifact.
- `tests/unit/semantic-verification.test.ts` requires complete evidence and all
  four verification dimensions before `VERIFIED_DELIVERY`, and separately
  tests review/failure states.
- `tests/integration/agent-repair-evidence.test.ts` records an Agent run as
  `FAILED` after a valid repair because of a post-repair Gateway rate limit.
  The earlier Agent Repair evaluator in
  `apps/web/src/server/agent-execution/agent-repair-orchestrator.ts` deliberately
  bases its verified result on repair, build, source, Contract, and cleanup
  evidence without requiring `agentRun.status = COMPLETED`.

## 10. Policy Model A: Execution-Centric

**Rule:** `VERIFIED_DELIVERY` requires a clean Agent protocol completion as well as successful independent verification.

Pros:

- Conservative and simple to explain.
- Rewards complete end-to-end protocol behavior.
- Prevents a partially failed execution from being presented as wholly successful.
- Fits workflows where final Agent output itself is a contracted deliverable.

Cons:

- Produces false-negative delivery outcomes when a valid artifact is already independently proven.
- Lets a reporting/finalization failure override stronger deterministic evidence.
- Blurs protocol reliability with artifact correctness.
- Conflicts with the product principle that Agent-reported completion is not the source of truth.
- Is inconsistent with the earlier Agent Repair Gate behavior, which could verify a repair without requiring the final Agent run status to be `COMPLETED`.

## 11. Policy Model B: Artifact-Centric

**Rule:** `VERIFIED_DELIVERY` depends on independent artifact, Contract, authority, provenance, and cleanup verification; Agent protocol status is recorded but is not a delivery hard gate.

Pros:

- Treats independently verified work as the primary delivery truth.
- Remains robust to post-repair model/provider finalization failures.
- Closely matches the accepted distinction between Agent claims and independent verification.
- Avoids discarding proven useful work.

Cons:

- A single success label can hide an unreliable execution protocol.
- Is unsafe unless authority, evidence provenance, lifecycle, cleanup, and external-effect checks remain mandatory.
- Needs explicit Contract language when a final narrative, structured response, or handoff is itself part of delivery.
- Could over-credit an Agent for work produced before a failure whose attribution is unclear.

## 12. Policy Model C: Multidimensional

**Rule:** Record execution/protocol outcome, artifact verification outcome, and Contract delivery outcome independently. The Work Contract explicitly declares which dimensions are delivery prerequisites.

Pros:

- Matches the North Star's four verification dimensions.
- Preserves both truths in Attempt 3-like cases: protocol failed; artifact verified.
- Allows different task types to require different completion semantics.
- Supports fairer future Reputation by separating capability from protocol and infrastructure reliability.
- Avoids making Agent self-reporting authoritative while retaining process accountability.

Cons:

- Requires versioned Contract, evaluator, Evidence Bundle, Receipt, ledger, and presentation changes.
- Adds truth-table and compatibility testing.
- Requires careful naming so `VERIFIED_DELIVERY` is never read as “every dimension succeeded.”
- Needs an attribution policy for Agent, model/provider, orchestrator, and infrastructure failures.

## 13. Recommended Forward-Looking Policy

Adopt **Model C**. For software repair/build tasks, permit an artifact-centric delivery outcome only when all of the following are true:

- The versioned Work Contract explicitly selects artifact-centric delivery semantics.
- Independent verification satisfies every locked acceptance criterion in a fresh execution environment.
- Patch identity and source provenance are valid.
- Editable-file, protected-oracle, and external-effect boundaries are satisfied.
- Permission Lease lifecycle, cleanup, and no-Snapshot requirements are valid.
- The execution protocol failure occurred after the qualifying artifact was captured and does not create an evidence gap.
- The failed execution dimension remains visible and immutable; it is not rewritten as successful.

Agent protocol completion should remain a hard delivery gate when the Work Contract explicitly requires a final structured response, handoff, explanation, approval request, or other protocol output as part of the deliverable. Authority, provenance, verifier, lifecycle, cleanup, and prohibited-effect failures should remain hard gates for every policy model.

This recommendation is prospective. It does not reclassify or promote Attempt 3.

## 14. `BUILD_RESCUE` Under Each Model

`BUILD_RESCUE` had an underlying Agent run status of `FAILED`, a final Job and
Receipt result of `INCONCLUSIVE`, no qualifying patch, and none of its two
independent acceptance commands ran. Its independent verification outcome was
not verified.

- **Model A:** Not verified because execution did not complete and delivery criteria did not pass.
- **Model B:** Not verified because there is no independently verified artifact.
- **Model C:** Execution/protocol is failed; artifact verification is not verified; Contract delivery is failed or inconclusive according to the versioned mapping. It cannot be `VERIFIED_DELIVERY`.

The policy choice changes only the treatment of independently proven artifacts after a protocol failure. It does not rescue Jobs with no qualifying artifact or verifier result.

## 15. Future Reputation Semantics

No Reputation entry is authorized by this audit. Conceptually, a future Reputation system should treat the dimensions separately:

- A correct independently verified artifact may support task-capability reliability.
- A failed Agent protocol should reduce or withhold protocol-completion reliability.
- A provider or infrastructure failure should not be charged to the Agent without attribution evidence.
- A verified artifact with failed protocol should not receive the same confidence or composite treatment as a clean end-to-end delivery.
- No dimension should be inferred from a single collapsed status.

These are design constraints for later owner-approved work, not Reputation calculations or entries.

## 16. Correction Recommendation

**Yes, a prospective policy/code correction is recommended, but only after the
owner chooses the outcome model.** Policy must be versioned and locked before
implementation changes. No correction should reinterpret Attempt 3 under rules
that did not govern it.

## 17. Exact Components Requiring Change If Approved

An approved Model C implementation would require narrowly scoped, versioned changes to:

1. `apps/web/src/server/reputation-entry-pilot/work-contract.ts`
   Add an explicit outcome policy declaring whether protocol completion is a delivery prerequisite for the task type.
2. `apps/web/src/server/reputation-entry-pilot/orchestrator.ts`
   Replace the collapsed `agentActionComplete` decision with a dimension evaluator and Contract-selected delivery policy.
3. `apps/web/src/server/reputation-entry-pilot/candidate-evidence.ts`
   Version Evidence Bundle and Receipt schemas to preserve execution/protocol, artifact verification, and Contract delivery outcomes independently.
4. `apps/web/src/server/semantic-verification/semantic-contract.ts`
   Align the existing four dimensions and Agent-reported/independently-verified states with the explicit outcome policy.
5. `apps/web/src/server/semantic-verification/semantic-delivery-orchestrator.ts`
   Remove circular derivation of a dimension from the already-collapsed delivery status and evaluate each dimension from its own evidence.
6. Relevant Receipt/ledger projections and any public Receipt view
   Display the separate immutable dimensions without implying that a delivery-qualified artifact had a clean protocol run.
7. Unit and integration tests for the policy truth table
   Cover verified artifact plus protocol failure, clean end-to-end success, no artifact, acceptance failure, authority violation, evidence gap, lifecycle failure, cleanup failure, and prohibited external effects.

No migration, code change, schema change, or test change is authorized or performed by this audit.

## 18. Attempt 3 Immutable Status

Attempt 3 remains exactly as accepted:

- Classification: `PHASE B ATTEMPT 3 — PARTIAL / BLOCKED`
- `TEST_AND_FIX`: final pilot result `FAILED`; independent artifact verification true
- `BUILD_RESCUE`: final pilot result `INCONCLUSIVE`; no qualifying artifact; independent verification false
- `VERIFIED_DELIVERY`: not achieved
- Candidate workflow field: `REPUTATION_ENTRY_CANDIDATE` (membership only)
- Verified-candidate eligibility: false
- Canonical qualifying count before Owner classification: `0`
- No Reputation entry

The accepted immutable artifacts were re-hashed after this audit and remain
byte-identical to their pre-audit hashes:

| Artifact | SHA-256 |
|---|---|
| Evidence database | `30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37` |
| Evidence JSON | `49e54b83129310603bea9d3ac93301b528426e0036f00ac07c7c934374793077` |
| Accepted blocker report | `409fd66ee5112db1ca9dc5ba833ce71bae1bd995c734ba97e543e6505576d43b` |
| Source preflight | `f21f00f54bbdf22e17c81742c7bbb96071f61283fd9aa061ef9e8b8f77bc86b3` |
| Working-tree identity | `8a9e3c8c15555677a4ea6c7e1a1b2eb792a6203caf6d0de07321f21c637da9b6` |

No Attempt 3 database WAL/SHM exists.

## 19. Owner Decision Required

The exact next step is an owner decision to approve or reject the prospective **Model C multidimensional outcome policy**, including this specific rule:

> A future versioned Work Contract may declare artifact-centric delivery, allowing `VERIFIED_DELIVERY` when independent artifact, Contract, authority, provenance, lifecycle, cleanup, and external-effect verification all pass even if the Agent protocol ends `FAILED`; the execution/protocol dimension must remain failed and visible.

If approved, the owner must separately authorize the versioned Contract/Receipt/evaluator implementation and its tests. Approval must not be interpreted as a re-evaluation, promotion, or rerun of Attempt 3.

## 20. Audit Effects

- Model requests: `0`
- Sandboxes created: `0`
- External mutations: `0`
- Attempt 3 evidence mutations: `0`
- Attempt 3 Receipt replacements: `0`
- Reputation changes: `0`
