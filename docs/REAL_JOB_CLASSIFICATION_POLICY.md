# Real Job Classification Policy

## Authority And Scope

`REAL_JOB_CLASSIFICATION_POLICY_V1` is the canonical preliminary classification
and external-audit policy for determining which `VERIFIED_DELIVERY` Jobs may
eventually contribute to DoneLayer's Reputation entry corpus.

Classification does not change a Work Contract, execution outcome, independent
verification outcome, delivery outcome, Evidence Bundle, Ledger, or Receipt.
Historical classification decisions are append-only.

The Owner-authorized Gate 4 corpus-entry sequence and active-count rules are in
`GATE_4_REAL_CORPUS_RAMP.md`. Those `REAL_CORPUS_ELIGIBILITY_RULES_V1` rules
extend this preliminary-classification policy without changing historical V1
records or hashes.

## Preliminary States

1. `BENCHMARK_FIXTURE`
2. `NOT_VERIFIED`
3. `PROVISIONAL_REAL_JOB`
4. `AMBIGUOUS`

`BENCHMARK_FIXTURE` and `NOT_VERIFIED` are automatically excluded with
canonical contribution `0`. They do not require individual Owner review.

`PROVISIONAL_REAL_JOB` and `AMBIGUOUS` are added to
`docs/REAL_JOB_AUDIT_QUEUE.md`. Neither may increment the canonical count.

## Benchmark And Fixture Rule

A Job is `BENCHMARK_FIXTURE` when its task, defect, repository state, or
acceptance scenario was intentionally created primarily to test DoneLayer,
exercise a Gate, populate the Reputation corpus, validate an Agent workflow,
benchmark capability, or manufacture threshold samples.

A benchmark that reaches `VERIFIED_DELIVERY` is recorded as
`BENCHMARK_FIXTURE_VERIFIED_JOB`. A benchmark without verified delivery is
recorded as `NON_VERIFIED_BENCHMARK_ATTEMPT`. Both contribute `0`.

Demo and Seed work is excluded under the same preliminary state.

## Anti-Gaming Rule

The decisive question is:

> Would this work genuinely have needed to be done if the Reputation corpus
> threshold did not exist?

An Owner request alone is not proof. If the answer is no, the Job is
`BENCHMARK_FIXTURE`. Do not manufacture, duplicate, or relabel work to increase
the canonical count.

## Provisional Real Work

A Job may be `PROVISIONAL_REAL_JOB` only when all are objectively supported:

- a genuine Owner or external need existed independently of Reputation
- the outcome would have been useful without the Reputation system
- the task was not manufactured for testing or corpus completion
- the full current Contract, Authority, Execution, Evidence, independent
  verification, and Receipt lifecycle completed
- delivery outcome is `VERIFIED_DELIVERY`
- required Evidence is complete and valid
- no Demo, Seed, or Fixture exclusion applies

The preliminary origin determines the proposed post-audit label:

- Owner need: `OWNER_REAL_VERIFIED_JOB`
- external user/customer/project need: `EXTERNAL_REAL_VERIFIED_JOB`

These labels become final only after an external audit accepts the provisional
record. Preliminary classification always contributes `0`.

## Ambiguous Work

Use `AMBIGUOUS` only when available Evidence cannot determine whether the task
existed independently of testing or corpus goals. Add it to the audit queue and
continue normal roadmap execution unless the ambiguity affects safety, trust
semantics, or the ability to execute the next task.

## External Audit Batches

Stop with `OWNER DECISION REQUIRED - EXTERNAL REAL JOB AUDIT BATCH` when the
first of these occurs:

- five `PROVISIONAL_REAL_JOB` entries accumulated since the previous audit
- a major canonical milestone completed and at least one provisional Job is
  waiting for external classification
- canonical count plus pending provisional Jobs would otherwise appear to meet
  the threshold
- an ambiguity affects safety, trust semantics, or the next execution

A major milestone with zero provisional Jobs requires only
`MILESTONE PASS - EXTERNAL REVIEW REQUIRED`. Do not emit an empty Real Job audit
batch. `BENCHMARK_FIXTURE` and `NOT_VERIFIED` exclusions do not create a batch.

Only an externally accepted provisional Job contributes `1` to
`canonicalRealVerifiedJobCount`. Provisional and canonical counts are always
reported separately. Evidence-Based Reputation cannot start merely because the
provisional count reaches 20.

## Canonical Corpus Eligibility

External acceptance is necessary but not sufficient for an active canonical
contribution. A counted entry must also remain unique, integrity-valid,
non-revoked, non-superseded, and free of unresolved contamination.

- exact replay of the same accepted entry is idempotent and does not increment
  the count again
- conflicting reuse of a Job, requirement, Contract, Evidence Bundle,
  delivered-outcome, or Receipt identity is quarantined and contributes `0`
- a revocation or supersession is appended as a new event and changes the
  entry's active contribution to `0`; historical Evidence is not rewritten
- suspected contamination is quarantined with contribution `0` until external
  resolution; confirmed contamination remains excluded
- failed, inconclusive, incomplete, invalid-Evidence, Demo, Seed, benchmark,
  Fixture, Gate-validation, and corpus-manufactured records contribute `0`

`canonicalRealVerifiedJobCount` means the recomputed active count, not the
number ever accepted. Gate thresholds may not use a historical peak.

The deterministic local projection and integrity check are implemented in
`apps/web/src/server/reputation-entry-pilot/real-corpus-eligibility.ts`. This
implementation does not create a Job, perform external audit, or make any
historical record eligible.

## Task Type Binding

Each candidate records a task type before execution in its locked Work
Contract. The type may describe the actual contracted work, but it may not be
chosen or relabeled after the outcome to manufacture diversity. Gate 4B
requires at least five active canonical Jobs across at least two such types.
Gate 4C requires at least twenty active canonical Jobs and a separate
Reputation Readiness Review before Phase 4 starts.

## Sensitive External Work

Real customer data, sensitive data, or new legal/privacy implications require
Owner approval before execution under the existing Controlled Autopilot rules.
