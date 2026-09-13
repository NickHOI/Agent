# Verified Delivery V2 Live-Orchestrator Pre-Live Gate

## Decision

`V2 LIVE-ORCHESTRATOR PRE-LIVE GATE — BLOCKED`

The integration implementation and focused deterministic checks passed, but
the complete test suite stopped at a historical durable-record compatibility
failure. The Gate is not promoted to PASS.

## Blocker

The newly added durable version dispatcher treats every
`EVIDENCE_BUNDLE_FINAL` record at version 1 as a Reputation-entry candidate
Bundle and every `VERIFIED_JOB_RECEIPT` record at version 1 as a
Reputation-entry candidate Receipt. The retained Phase A Attempt 4 persistence
preflight legitimately uses different historical V1 payload families:

- `PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1`
- the corresponding persistence-preflight Receipt envelope

Read-only diagnosis reports:

```text
EVIDENCE_BUNDLE_FINAL 1 DURABLE_EVIDENCE_BUNDLE_V1_INVALID
VERIFIED_JOB_RECEIPT 1 DURABLE_JOB_RECEIPT_V1_INVALID
```

As a result,
`tests/integration/reputation-entry-persistence-preflight.test.ts` fails at
the retained-evidence assertion that `store.verifyAll().valid` is `true`.
The exact validation summary was 52 passing files, one failing file, seven
skipped files, 254 passing tests, one failing test, and 11 skipped tests.

This is a schema-family dispatch defect, not historical corruption. The
retained database was only inspected and was not rewritten.

## Completed Before The Stop

- V2-only `runV2()` live-orchestrator branch with explicitly locked Contract
  policy
- independent execution, verification, and delivery outcome persistence
- V2 Evidence Bundle, delivery-outcome Ledger event, Receipt, public outcome
  summary, and delivery-only candidate eligibility
- deterministic dependency adapters for pre-live execution without network,
  model, or managed Sandbox activity
- mandatory outcome matrix through the real orchestration and decision path
- V2 reload checks for Contract, evaluation, Bundle, Receipt, candidate record,
  and durable lifecycle integrity
- isolated V1 orchestration check preserving the historical completion rule
- focused V2 tests: 24/24 passed across four files
- read-only Attempt 3 validation: 2/2 passed
- lint passed
- strict typecheck passed
- `git diff --check` passed with informational line-ending warnings only

## Validation Not Run

The Web production build and Worker build were not run after the full-suite
failure, in accordance with the fail-closed instruction.

## Historical State

Attempt 3 remains unchanged and read-only. Its accepted database hash remains
`30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37`,
with immutable outcomes `FAILED` and `INCONCLUSIVE`, zero canonical qualifying
Jobs, and no WAL or SHM sidecars.

## Effects

- Actual model calls: `0`
- Managed Sandboxes: `0`
- Live Jobs: `0`
- Retained deterministic test Job state: `0`
- GitHub or Fixture mutations: `0`
- PRs, merges, deployments, payments, blockchain writes, billing changes,
  credential expansion, candidate promotion, and Reputation entry: `0`

## Exact Next Owner Decision

Owner approval is required to correct the durable V1 schema-family dispatcher
so it validates each historical V1 payload according to its own recorded
family while keeping V2 records strict, then rerun the complete pre-live Gate.
No live corpus Attempt or Reputation work is authorized.
