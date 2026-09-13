# Real Job Classification And External Audit Policy V1

## Gate Decision

`PASS` at the authorized local deterministic policy and evidence boundary.

This Gate implements preliminary real-work classification, Benchmark exclusion,
anti-gaming rules, external audit queue records, audit-batch triggers, and the
invariant that Codex cannot unilaterally increment the canonical corpus.

It did not run a model, create a Sandbox, mutate a repository, promote a Job,
or start Evidence-Based Reputation.

## Deterministic Preliminary States

The code recognizes exactly four states:

1. `BENCHMARK_FIXTURE`
2. `NOT_VERIFIED`
3. `PROVISIONAL_REAL_JOB`
4. `AMBIGUOUS`

Benchmark/Fixture and non-verified work is excluded automatically with canonical
contribution `0`. A verified Benchmark receives
`BENCHMARK_FIXTURE_VERIFIED_JOB`; an unverified Benchmark receives
`NON_VERIFIED_BENCHMARK_ATTEMPT`.

Clearly real Owner or external work becomes only `PROVISIONAL_REAL_JOB`.
Ambiguous work is queued unless it blocks safety, trust semantics, or subsequent
execution. Neither state contributes to the canonical count.

## Anti-Gaming Rule

An Owner request alone does not establish real work. The classifier requires
objective support that the task existed independently of Reputation and would
have been useful without the corpus threshold. Work manufactured to test
DoneLayer, exercise a Gate, validate a workflow, benchmark capability, or
populate the corpus is always Benchmark/Fixture.

## External Audit Boundary

Only an externally accepted `PROVISIONAL_REAL_JOB` may become
`OWNER_REAL_VERIFIED_JOB` or `EXTERNAL_REAL_VERIFIED_JOB` and contribute `1`.
Unknown audit decisions, non-provisional promotion attempts, tampered records,
unknown runtime enum values, unexpected fields, and malformed batch inputs fail
closed.

An audit batch is required when the first of these occurs:

- five provisional real Jobs accumulated since the previous audit
- a major canonical milestone completed
- canonical plus pending provisional work would otherwise appear to reach 20
- an ambiguity blocks safety, trust semantics, or the next execution

## Attempt 5 Classification

The new append-only classification artifact binds the unchanged Attempt 5
evidence JSON and SQLite database:

- `TEST_AND_FIX`: `BENCHMARK_FIXTURE_VERIFIED_JOB`, contribution `0`
- `BUILD_RESCUE`: `NON_VERIFIED_BENCHMARK_ATTEMPT`, contribution `0`
- provisional queue additions: `0`
- ambiguous queue additions: `0`
- canonical count before/after: `0 / 0`
- remaining gap: `20`

Artifact:
`test-results/reputation-entry-phase-b-attempt-5-owner-classification.json`

- evidence SHA-256:
  `ce239b19ad025389ec9657f1d05cc24dce82dfe2422f2d6db2753666ce61dfc6`
- file SHA-256:
  `3d20d34c62b20b85a6036439b2bd046331ab1f079c008b03b82de0dbaf14e4d4`

The original four Attempt 5 files remained byte-identical. This classification
adds a new record; it does not rewrite the Job, Contract, Lease, Bundle, Ledger,
Receipt, execution outcome, verification outcome, or delivery outcome.

## Canonical Files

- policy: `docs/REAL_JOB_CLASSIFICATION_POLICY.md`
- audit queue: `docs/REAL_JOB_AUDIT_QUEUE.md`
- future-agent rules: `AGENTS.md`
- implementation:
  `apps/web/src/server/reputation-entry-pilot/real-job-classification.ts`
- Attempt 5 evidence generator:
  `scripts/classify-reputation-entry-phase-b-attempt-5.ts`

## Validation

- focused policy and Attempt 5 classification tests: `13 / 13 PASS`
- lint: `PASS`, zero warnings
- strict typecheck: `PASS`
- full suite: 289 active tests across 59 passing files; 14 established
  environment-gated tests skipped across seven files
- Web production build: `PASS`, 22 static pages generated
- Worker build: `PASS`
- `git diff --check`: `PASS`; Windows line-ending notices were informational
- credential and local-path scan: `PASS`
- Attempt 3 and Attempt 5 SQLite WAL/SHM: absent
- Attempt 3, Attempt 4, and the original Attempt 5 hashes: unchanged

## Effects

- model requests: `0`
- managed Sandboxes: `0`
- Job executions: `0`
- GitHub or Fixture mutations: `0`
- candidate promotions: `0`
- canonical count added: `0`
- PR, merge, deployment, payment, blockchain, billing, credential expansion,
  and Reputation effects: `0`

## Current Boundary

The classifier and hashed records are implemented in-process, and the canonical
audit queue is maintained as a repository document. Production database/API/UI
persistence, signed external audit decisions, multi-tenant audit authorization,
and Reputation scoring remain unimplemented.

The canonical corpus remains `0`; Reputation entry conditions are not met. A
new live corpus Gate or any work using sensitive external data still requires
its separately authorized execution boundary.
