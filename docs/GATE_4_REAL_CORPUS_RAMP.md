# Gate 4 Real Corpus Ramp

## Authority And Status

`GATE_4_REAL_CORPUS_RAMP_V1` is the Owner-authorized execution order for
crossing the evidence-volume boundary before Phase 4 Evidence-Based Reputation.
It resolves the earlier ambiguity about the exact Gate 4 boundary.

These are corpus-entry Gates, not Reputation implementation. Phase 4 starts
only after Gate 4C passes its Reputation Readiness Review.

Current state on 2026-09-13:

- current Gate: `GATE_4A`
- eligibility projection: `COMPLETE_LOCAL_DETERMINISTIC`
- first genuine real Job: `NOT_STARTED`
- provisional real Jobs: `0`
- active canonical real Verified Jobs: `0`
- active canonical task types: `0`
- remaining Gate 4C gap: `20`

## Shared Eligibility Rules

`REAL_JOB_CLASSIFICATION_POLICY_V1` remains the preliminary-classification and
external-audit authority. `REAL_CORPUS_ELIGIBILITY_RULES_V1` adds the following
canonical corpus rules without changing any historical classification:

1. A contribution starts as `0` and can become `1` only after external audit
   accepts a `PROVISIONAL_REAL_JOB` as `OWNER_REAL_VERIFIED_JOB` or
   `EXTERNAL_REAL_VERIFIED_JOB`.
2. The task must have been genuinely needed without the corpus threshold. Its
   requirement source, independent-need rationale, and task type must be
   captured before execution and bound to the locked Work Contract.
3. The full current Contract, Authority, Execution, Evidence, independent
   verification, delivery, Receipt, and cleanup lifecycle must verify. Delivery
   must be `VERIFIED_DELIVERY`, and the Receipt must be integrity-valid.
4. Demo, Seed, benchmark, Fixture, Gate-exercise, workflow-validation,
   corpus-manufactured, failed, inconclusive, incomplete, or ambiguous work
   contributes `0`.
5. One real requirement and delivered outcome may contribute at most once.
   Replays are idempotent. Conflicting Job, requirement, Contract, Evidence,
   delivery, or Receipt identity collisions are quarantined with contribution
   `0` pending external resolution.
6. Classification and Evidence history remains append-only. A later revocation,
   supersession, or confirmed contamination adds a new status event; it never
   rewrites the original Receipt or audit decision.
7. Revoked, superseded, or quarantined entries contribute `0` to the active
   canonical count. Every Gate and the Readiness Review recomputes the active
   count instead of relying on a historical peak.
8. A task type is the pre-execution Work Contract category, not a label chosen
   after the result. Relabeling does not create type diversity.

Negative probes used to prove these rules are themselves Fixtures and always
contribute `0`.

The deterministic local projection and integrity checker are implemented in
`apps/web/src/server/reputation-entry-pilot/real-corpus-eligibility.ts`. They
enforce the active-count rules over supplied accepted candidates but do not
create, persist, externally audit, or count a real Job by themselves.

## Gate 4A - First Canonical Real Job

Purpose: prove that the eligibility rules admit one genuinely needed,
independently verified Job without weakening anti-gaming controls.

Execution order:

1. Apply `REAL_CORPUS_ELIGIBILITY_RULES_V1`. The local deterministic
   projection is complete; durable use against the first real Job remains open.
2. Select one work item that already has a genuine Owner or external need and
   would still be required if the Reputation corpus did not exist.
3. Lock its requirement source, independent-need rationale, task type,
   acceptance criteria, authority, Source, and delivery policy before execution.
4. Complete the full current DoneLayer lifecycle and obtain
   `VERIFIED_DELIVERY` plus a valid Verified Job Receipt.
5. Classify it only as `PROVISIONAL_REAL_JOB`, add it to the audit queue, and
   stop for an external Real Job audit decision.
6. Enter it into the corpus only after external audit acceptance.

Gate 4A passes only when:

- active canonical real Verified Job count is at least `1`
- the accepted Job contributes exactly `1`
- its complete Evidence and classification references are durable and
  independently recomputable
- duplicate, revocation, supersession, and contamination state are clear
- no excluded historical Job was relabeled or counted

A provisional Job, a valid Fixture Receipt, or a self-approved classification
does not pass Gate 4A.

## Gate 4B - Five Jobs And Diversity

Gate 4B starts only after Gate 4A passes.

Gate 4B passes only when:

- active canonical real Verified Job count is at least `5`
- at least `2` pre-declared task types are represented
- every counted Job remains externally accepted, unique, active, and fully
  evidence-backed
- deterministic negative validation proves duplicate replay is idempotent and
  conflicting duplicates fail closed
- failed, inconclusive, incomplete, and invalid-Evidence outcomes contribute `0`
- revocation and supersession remove an entry from the active count without
  mutating historical Evidence
- contamination detection quarantines affected entries, prevents derived
  claims, and recomputes the active count

Gate 4B does not authorize Reputation scores, Capability Passports, ranking, or
matching claims. Five Jobs across two types are diversity evidence, not enough
evidence for an unsupported capability claim.

## Gate 4C - Twenty Jobs And Readiness Review

Gate 4C starts only after Gate 4B passes.

Gate 4C passes only when:

- active canonical real Verified Job count is at least `20`
- more than one task type remains represented
- each capability proposed for Phase 4 has a disclosed sample count and enough
  current evidence for that exact claim
- all pending provisional and ambiguous entries are resolved or excluded from
  the threshold
- duplicate, failure, revocation, supersession, contamination, audit, and
  active-count recomputation controls remain verified
- a `REPUTATION_READINESS_REVIEW_V1` independently approves the exact corpus,
  task-type coverage, limitations, and proposed first Reputation projection

An apparent threshold based on pending, historical-peak, revoked, quarantined,
or duplicated entries does not pass Gate 4C.

## Phase 4 Boundary

After Gate 4C passes, the next authorized product phase is:

```text
PHASE 4: EVIDENCE-BASED REPUTATION
```

Phase 4 must derive explainable, capability-specific projections from the
approved corpus. It may not replace or rewrite the underlying Evidence,
classification, audit, revocation, or contamination history.

## Current Stop And Next Action

Gate 4A is authorized. The local deterministic eligibility projection and its
integrity checks are implemented, but no eligible real work item has yet
completed the full lifecycle. The next action is to select one independently
necessary work item and record its requirement source, independent-need
rationale, task type, acceptance criteria, Source, authority, and delivery
policy before any Job or Sandbox is created.

The Gate must stop at the first authentication, repository-access, sensitive
data, legal/privacy, Provider-availability, OIDC, or billing blocker with one
specific manual next step. No payment, billing change, plan upgrade, second
Provider, Demo fallback, local-host execution fallback, or Fixture relabeling is
authorized.
