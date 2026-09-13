# VERIFIED DELIVERY OUTCOME POLICY V1 DESIGN AND EVIDENCE GATE

## 1. Gate Decision

`PASS` at the authorized local deterministic policy/schema boundary. This Gate
implemented prospective Model C semantics without a live Job, model request,
Sandbox, external mutation, candidate promotion, or Reputation entry.

## 2. Work Contract Policy Model

`VERIFIED_DELIVERY_OUTCOME_POLICY_V1` is an explicit enum-valued policy with
two supported values:

- `EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED`
- `INDEPENDENT_ACCEPTANCE_SUFFICIENT`

The policy is selected before execution and embedded in the locked Work
Contract. Result-dependent selection is not available.

## 3. Schema And Version Changes

- Historical `VERIFIED_WORK_CONTRACT_V1` remains schema/version `1` with no
  inferred delivery policy.
- Prospective `VERIFIED_WORK_CONTRACT_V2` is schema/version `2`, uses Contract
  variant `REPUTATION_ENTRY_CANDIDATE_V3`, and contains
  `deliveryOutcomePolicy` schema/version `1`.
- The whole-Contract SHA-256 covers the selected policy.
- The task-scoped Contract validator accepts only the exact V1/no-policy or
  V2/known-policy pair. Mixed, missing, or unknown versions fail closed.
- Prospective Evidence and Receipt schemas are
  `REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2` and
  `VERIFIED_JOB_RECEIPT_V2`.

No database migration or historical payload conversion was added.

## 4. Execution Outcome

The independent execution field supports `COMPLETED`, `FAILED`,
`INCONCLUSIVE`, `TIMEOUT`, and `PROVIDER_FAILURE`. A separate explicit
attribution supports `AGENT`, `MODEL_PROVIDER`, `INFRASTRUCTURE`, `UNKNOWN`, or
`NOT_APPLICABLE`. Attribution is recorded, not inferred from delivery success.

## 5. Independent Verification Outcome

The work/Artifact field supports `VERIFIED`, `FAILED`, `INCONCLUSIVE`,
`INVALID_EVIDENCE`, and `NO_DELIVERABLE`. `VERIFIED` cannot create a successful
delivery when the required deliverable or trust evidence is absent.

## 6. Delivery Outcome

The Contract delivery field supports `VERIFIED_DELIVERY`, `FAILED`,
`INCONCLUSIVE`, and `BLOCKED`. It is computed from the locked policy,
independent verification, deliverable presence, and trust checks. It is never
copied from Agent execution status.

## 7. Exact Decision Rules

The evaluator applies these rules in order:

1. Reject an unsupported policy, invalid outcome, invalid attribution, or
   malformed trust-check set.
2. If no authorized deliverable exists, or verification reports
   `NO_DELIVERABLE`, return `INCONCLUSIVE`.
3. If independent evidence is invalid, return `BLOCKED`.
4. If required Evidence, Source integrity, Authority, provenance, lifecycle,
   cleanup, or external-effect compliance fails, return `BLOCKED` with every
   applicable reason.
5. If independent acceptance is `FAILED`, return `FAILED`.
6. If independent acceptance is `INCONCLUSIVE`, return `INCONCLUSIVE`.
7. With verified work under the strict policy, a non-completed execution
   returns `FAILED` for `FAILED` execution and `INCONCLUSIVE` for other
   non-completed execution outcomes.
8. With verified work and all trust checks satisfied, return
   `VERIFIED_DELIVERY` when the Contract's execution requirement is satisfied.

Thus the same failed-execution/verified-work vector returns `FAILED` under the
strict Contract and `VERIFIED_DELIVERY` under the independent-acceptance
Contract.

## 8. Receipt Changes

Prospective Receipt V2 records, as separate hash-covered fields:

- Agent execution outcome and failure attribution
- independent work verification outcome
- selected delivery-outcome policy
- final Contract delivery outcome
- trust checks and decision reasons
- Evidence Bundle binding and pre-Receipt ledger chain
- candidate eligibility, `counted: false`, and `reputationEntered: false`

The deterministic control Receipt truthfully contains execution `FAILED`,
independent verification `VERIFIED`, policy
`INDEPENDENT_ACCEPTANCE_SUFFICIENT`, and delivery `VERIFIED_DELIVERY`.

## 9. Evidence, Ledger, And Public View

Evidence Bundle V2 independently projects all three outcomes, policy, trust
checks, required/satisfied/missing Evidence, and decision reasons. Its
integrity validator recomputes the Contract-selected decision and rejects
outcome or policy inconsistency.

The V1 outcome ledger payload records policy, all outcomes, trust checks,
candidate eligibility, and reasons. The prospective two-entry deterministic
Ledger verifies. Public Receipt types, whitelist projection, and UI now expose
the three outcomes, policy, candidate eligibility, and failure attribution, so
a `VERIFIED_DELIVERY` label cannot conceal failed Agent execution.

## 10. Candidate Eligibility

Prospective eligibility is exactly:

```text
deliveryOutcome == VERIFIED_DELIVERY
```

plus the existing trust checks already required to reach that outcome.
`REPUTATION_ENTRY_CANDIDATE` remains workflow-membership metadata. This Gate
sets `counted: false` and does not enter Reputation.

## 11. Historical Compatibility

V1 Contract creation and validation are unchanged. A V1 Contract cannot be
passed through the V2 evaluator because it has no locked policy. Existing V1
task-definition references retain their exact hashes and semantics. A mutable
task-definition copy cannot alter a locked V2 policy. No historical Receipt,
Bundle, ledger row, outcome, or hash was rewritten.

## 12. Attempt 3 Immutability

Attempt 3 was read only and remains historically classified as:

- `TEST_AND_FIX`: `FAILED`, non-verified
- `BUILD_RESCUE`: `INCONCLUSIVE`, non-verified
- canonical real Verified Jobs: `0`

Post-Gate hashes match the accepted values:

| Artifact | SHA-256 |
|---|---|
| Evidence database | `30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37` |
| Evidence JSON | `49e54b83129310603bea9d3ac93301b528426e0036f00ac07c7c934374793077` |
| Blocker report | `409fd66ee5112db1ca9dc5ba833ce71bae1bd995c734ba97e543e6505576d43b` |
| Source preflight | `f21f00f54bbdf22e17c81742c7bbb96071f61283fd9aa061ef9e8b8f77bc86b3` |
| Working-tree identity | `8a9e3c8c15555677a4ea6c7e1a1b2eb792a6203caf6d0de07321f21c637da9b6` |

No Attempt 3 database WAL/SHM exists.

## 13. Deterministic Test Matrix

Focused result: `20 / 20` tests passed. The policy matrix contributed 19 tests,
including all 16 mandatory vectors plus lifecycle, Evidence projection, and
Receipt-tampering checks. A separate generated-evidence test reloaded and
revalidated both Contracts, the Bundle, Receipt, Ledger, zero-effect record,
and immutable Attempt 3 hashes.

The paired control Contracts have SHA-256 values:

- strict: `caddb4379103096a6d4b131655d8dc6202c32e5ca429dda0f671e33c02a59250`
- independent acceptance: `210ce2c2cb610f5f57cbbc322bcb1081a5402ad289368f26d82927b4923c4e15`

The prospective control Bundle is
`89efceba81897497b9d3080fa19ad2165a24c76c19c48b8eed4034dac0cdf26d`;
the Receipt is
`99b6ea1b11b9979165630a7b80290bb0b34d2c1dcf2f180ad106a1b0aa969b4a`;
and its pre-Receipt chain is
`5177278f84d1b0407b7d8a8af337f59e3a3aa4020723dd93028b0e1290f7c225`.

The complete deterministic evidence JSON SHA-256 is
`7fbcfeef0042bc28c80434fe555c79da5e922ec8c5e67899d9c0516b9fb68057`.
Two consecutive generations produced that same hash.

## 14. Lint

`PASS`: `npm run lint` completed with zero warnings or errors.

## 15. Strict Typecheck

`PASS`: `npm run typecheck` completed with zero TypeScript errors.

## 16. Full Suite

`PASS`: 52 files and 253 active tests passed. Seven files and 11 tests retained
their existing environment-gated skip state.

## 17. Web Build

`PASS`: Next.js 16.2.12 production build compiled, typechecked, collected page
data, and generated all 22 static pages.

## 18. Worker Build

`PASS`: the Worker TypeScript no-emit build completed successfully.

## 19. Whitespace Validation

`PASS`: `git diff --check` reported no whitespace errors. Existing Windows
line-ending notices are informational.

## 20. Model Calls

`0`.

## 21. Sandboxes

`0`.

## 22. External Effects

`0`: no GitHub or Fixture mutation, PR, merge, payment, deployment, blockchain
action, billing change, credential expansion, candidate promotion, or
Reputation entry occurred.

## 23. Remaining Limitations

- V2 is a prospective policy/schema boundary and is not wired into the live
  Phase B pilot orchestrator or durable production APIs.
- No V2 database migration, historical migration, or reclassification path
  exists.
- The public view can render a supplied V2 outcome summary, but no live V2 Job
  Receipt was issued or persisted.
- Existing Agent-run adapters do not yet emit the richer timeout/provider and
  explicit failure-attribution states automatically.
- Reputation scoring and infrastructure-failure attribution policy remain
  unimplemented.
- General repositories, production multi-tenant policy, portable credentials,
  real payments, and later roadmap phases remain outside this Gate.

## 24. Owner Approval Required Next

The exact next action is an Owner decision on whether to authorize a separate
**prospective V2 live-orchestrator integration and pre-live regression Gate**.
That future Gate would wire only newly authored V2 Contracts into the Model C
evaluator, V2 Evidence/Receipt/ledger path, and public projection while keeping
all historical V1 and Attempt 3 paths immutable. It must precede any new live
corpus Attempt. Reputation remains unauthorized.
