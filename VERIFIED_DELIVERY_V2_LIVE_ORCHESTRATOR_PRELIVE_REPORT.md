# Verified Delivery V2 Live-Orchestrator Pre-Live Gate

## Decision

`V2 LIVE-ORCHESTRATOR PRE-LIVE GATE — PASS`

This result is integration and deterministic validation evidence only. It did
not run a live corpus Attempt or authorize Reputation.

## 1. Restored Historical-Store State

Before the clean rerun, both accepted stores matched their canonical database
and evidence hashes and had no WAL/SHM sidecars. The same facts held after the
focused matrix, complete suite, and builds.

## 2. Immutable Reader

Historical databases were opened only through
`ReputationEntryDurableStore(..., { readOnly: true })`. That reader converts the
path to an immutable SQLite URL with `immutable=1` and enables
`PRAGMA query_only=ON`. File hashes and sidecar presence were checked with
ordinary filesystem reads, which do not open SQLite.

No raw writable or generic SQLite inspection was used in this clean rerun.

## 3. Schema Families

Exactly three repository-proven families apply to the shared durable record
types:

| Family | Bundle discriminator | Receipt discriminator |
|---|---|---|
| Persistence Preflight V1 | `bundleType=PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1` | top-level `receiptType=PERSISTENCE_PREFLIGHT_RECEIPT_V1` |
| Reputation Entry V1 | `bundleType=REPUTATION_ENTRY_CANDIDATE_EVIDENCE_BUNDLE_V1` | `document.receiptType=VERIFIED_JOB_RECEIPT_V1` |
| Reputation Entry Outcome V2 | `bundleType=REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2` | `document.receiptType=VERIFIED_JOB_RECEIPT_V2` |

No speculative family was added.

## 4. Dispatcher Mechanism

The durable validator now resolves `recordType + recordVersion + schemaFamily`.
It uses only the exact immutable literals already covered by the durable
payload hash, then validates the payload with that family's strict schema.

Missing, unknown, conflicting, relabeled, or version-incompatible family
identity fails closed. A Receipt containing both top-level and document-level
family discriminators is rejected as ambiguous. There is no latest-version
fallback, parser trial order, ID exception, current task-definition lookup, or
V1-to-V2 normalization.

## 5. Family Matrix

Focused result: `18 / 18` tests passed.

The matrix proved all six valid payloads:

- exact Attempt 4 Persistence Preflight Bundle V1
- exact Attempt 4 Persistence Preflight Receipt V1
- exact Attempt 3 Reputation Entry Bundle V1
- exact Attempt 3 Reputation Entry Receipt V1
- accepted Verified Delivery Bundle V2
- accepted Verified Delivery Receipt V2

Negative tests proved wrong-family rejection in both V1 directions, no silent
V1 upgrade or V2 downcast, wrong and unknown `bundleType`/`receiptType`
rejection, family-field tamper detection, relabeled-payload rejection,
unsupported record-version rejection, ambiguous Receipt rejection, and stable
canonical ordering/hash semantics.

## 6. Attempt 4 Validation

Attempt 4 was reloaded through the immutable reader. Its exact historical
Bundle and Receipt validate under `PERSISTENCE_PREFLIGHT_V1`; durable records,
lifecycle bindings, Contract binding, and canonical hashes remain valid.

Before and after:

- database SHA-256:
  `280d616ec1366ab00d81962b73fb5dfefe9e0b97fe9b71a64dbac20afeae8162`
- evidence SHA-256:
  `ea6a994968b93cd1dac2a192e8cb5cf6d409b4d11fc661a87237cd2850401b36`
- WAL: absent
- SHM: absent

## 7. Attempt 3 Validation

Attempt 3 was reloaded through the same immutable reader. `verifyAll()` remains
valid for 79 records, 76 lifecycle entries, and both Jobs. Version-aware
`AGENT_MODEL_RUN` V1/V2 behavior, Contracts, Authority, Bundles, Ledgers,
Receipts, and cleanup evidence remain valid.

Its immutable classification remains:

- `TEST_AND_FIX = FAILED`
- `BUILD_RESCUE = INCONCLUSIVE`
- `PHASE B ATTEMPT 3 = PARTIAL / BLOCKED`
- canonical qualifying count added: `0`

Before and after:

- database SHA-256:
  `30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37`
- evidence SHA-256:
  `49e54b83129310603bea9d3ac93301b528426e0036f00ac07c7c934374793077`
- WAL: absent
- SHM: absent

No historical payload, row, hash, outcome, or timestamp was rewritten.

## 8. V2 Live-Orchestrator Matrix

The real `runV2()` orchestration path passed the accepted deterministic matrix:

| Execution | Verification | Policy | Delivery |
|---|---|---|---|
| `COMPLETED` | `VERIFIED` | strict | `VERIFIED_DELIVERY` |
| `FAILED` | `VERIFIED` | strict | `FAILED` |
| `FAILED` | `VERIFIED` | independent acceptance | `VERIFIED_DELIVERY` |
| `INCONCLUSIVE` | `NO_DELIVERABLE` | independent acceptance | `INCONCLUSIVE` |
| `COMPLETED` | `FAILED` | independent acceptance | `FAILED` |

The same decision path also rejects invalid Authority and missing required
Evidence. Eligibility is exactly
`deliveryOutcome === VERIFIED_DELIVERY`. Receipt V2 preserves execution
`FAILED`, failure attribution, verification `VERIFIED`, and delivery
`VERIFIED_DELIVERY` together. The isolated V1 path retains its original rule
and semantics.

The orchestrator issues only new `VERIFIED_WORK_CONTRACT_V2` Contracts into the
V2 evaluator and persists separate execution, verification, and delivery
outcomes through Bundle V2, Ledger, Receipt V2, public projection, and
candidate eligibility.

## 9. Files Changed

Core integration and validation files include:

- `apps/web/src/server/reputation-entry-pilot/orchestrator.ts`
- `apps/web/src/server/reputation-entry-pilot/delivery-outcome-evidence.ts`
- `apps/web/src/server/reputation-entry-pilot/durable-record-versions.ts`
- `apps/web/src/server/reputation-entry-pilot/durable-store.ts`
- `apps/web/src/server/agent-execution/repair-tools.ts`
- `tests/integration/reputation-entry-v2-live-orchestrator.test.ts`
- `tests/integration/reputation-entry-schema-family-dispatch.test.ts`
- `tests/integration/reputation-entry-persistence-preflight.test.ts`

Prior BLOCKED reports were not rewritten.

## 10. Complete Validation

- family-dispatch focused tests: `18 / 18 PASS`
- V2 orchestrator focused tests: `2 / 2 PASS`
- Attempt 4 and Attempt 3 immutable tests: `2 PASS`, one unrelated
  evidence-generation case retained its environment-gated skip
- lint: `PASS`, zero warnings
- strict typecheck: `PASS`
- full suite: `273 / 273` active tests across 54 passing files; 11 established
  environment-gated tests skipped across seven files
- Web production build: `PASS`; Next.js 16.2.12 compiled, typechecked, and
  generated 22 static pages
- Worker build: `PASS`
- `git diff --check`: `PASS`; Windows line-ending notices were informational

## 11. Effects

- actual model calls: `0`
- managed Sandboxes: `0`
- live Jobs: `0`
- retained deterministic Job state: `0`
- GitHub or Fixture mutations: `0`
- PRs, merges, deployments, payments, blockchain actions, billing actions,
  production credential expansion, candidate promotion, and Reputation entry:
  `0`

The orchestrator tests used deterministic local provider/Sandbox adapters and
deleted their temporary lifecycle stores.

## 12. Exact Next Owner Decision

The next decision is whether to authorize a separately identified new Phase B
live corpus Attempt using the integrated V2 Contract and delivery-outcome path.
No live Attempt starts automatically, and Evidence-Based Reputation remains
unauthorized.
