# Beta Gate 1 Real Supabase Migration Blocked

## Decision

`OWNER DECISION REQUIRED - SUPABASE HISTORICAL MIGRATION PREREQUISITE`

The authorized non-production Gate stopped at the first non-routine migration
failure. The Agent Identity migration was not applied. Continuing would require
a product-level decision about the canonical Supabase trust schema and migration
history; it is not an objectively safe implementation-only correction.

## 1. Gate identity and result

- Gate: `BETA GATE 1 - REAL SUPABASE ENVIRONMENT / AGENT IDENTITY LIVE SUPABASE VALIDATION V1`
- Result: `OWNER_DECISION_REQUIRED`
- Stage reached: historical migration application
- Corpus classification: `NOT_VERIFIED`
- Provisional contribution: `0`
- Canonical contribution: `0`

This Gate did not run a full current Agent Job lifecycle and produced no Verified
Job Receipt. It is not a Real Job corpus candidate.

## 2. Authorization and project boundary

The Owner authorized exactly one disposable non-production Supabase project in
organization `odqxzaqhkknfzjkwgued` and prohibited access to or mutation of the
unrelated `gym` project.

- Authorized project name: `donelayer-beta-validation`
- Project ID: `blriuxocrzgwlojiduue`
- Region: `ap-northeast-1` (Tokyo)
- Created: `2026-09-08T16:32:11.093451Z`
- Status at preflight: `ACTIVE_HEALTHY`
- Purpose: disposable non-production DoneLayer validation only
- Normal disclosed replacement cost: USD 10 monthly
- Unexpected purchase, plan upgrade, or billing change: none

The deleted `monday` project was absent. `gym` appeared only in the organization
project listing used to establish the authorized boundary. No project-specific
read, migration, SQL, advisor, Auth, or mutation call targeted `gym`.

## 3. Read-only preflight

Preflight passed for beginning the reviewed migration chain:

- PostgreSQL `17.6.1.166`, major version 17, GA
- empty remote migration history
- zero public application tables
- zero Auth users
- no unrelated or customer data
- standard Supabase schemas only
- expected installed extensions, including `pgcrypto 1.3`, `uuid-ossp 1.1`,
  `pg_stat_statements 1.11`, `vault`, and `plpgsql`

Current Supabase guidance was checked before mutation. In particular, explicit
Data API grants remain separate from RLS, server secrets must remain server-side,
and live migration/advisor evidence is required for operational claims.

## 4. Reviewed local migration set

| Order | Migration | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `20260731235500_initial_schema.sql` | 103659 | `36883b21e22bef69d415e479d09765621641d449e6de4a40416154fd4e26630a` |
| 2 | `20260903090000_semantic_verification_v1.sql` | 1893 | `f7d8ce4a14fa603b9d9f2e946fd7216f7b11c61920b21a3eb357ff08769b655d` |
| 3 | `20260908141623_agent_identity_production_persistence_v1.sql` | 20272 | `79e5d47bc0efe3565ce8448662c9192a50116423ae81993ade48b27268ffec64` |

No historical migration file was edited.

## 5. Migration application evidence

The initial schema applied successfully and is the only recorded remote
migration:

- remote version: `20260908165103`
- remote name: `initial_schema`
- outcome: `APPLIED`

A final read-only inventory found 41 public tables. Forty contain zero rows;
`task_state_transitions` contains the 43 reference rows intentionally seeded by
the initial migration. There are still zero Auth users and zero customer,
application, or synthetic test rows. `job_receipts`,
`task_contract_versions`, `permission_leases`, and
`evidence_ledger_entries` are absent.

The next historical migration failed at its first statement:

```text
ERROR: 42P01: relation "job_receipts" does not exist
```

Failing statement:

```sql
ALTER TABLE job_receipts DROP CONSTRAINT IF EXISTS job_receipts_result_check;
```

The failed migration is not present in remote migration history. Read-only
post-failure checks found zero semantic columns, no
`receipt_semantic_reviews` table, and no half-applied semantic objects. The
transaction therefore rolled back. The Agent Identity migration was not
attempted.

## 6. Why this is not a routine fix

The semantic migration requires `public.job_receipts`, then creates an
append-only review table with a foreign key to that receipt table. The preceding
Supabase initial schema does not create `job_receipts`. It also omits the
SQLite trust-foundation family that includes `task_contract_versions`,
`permission_leases`, and `evidence_ledger_entries`.

There is no single implementation-only correction with unchanged trust
semantics. At least one of these product decisions is required:

1. Port the established trust-foundation table family into a new prerequisite
   Supabase migration and define its place in migration history.
2. Formally quarantine the semantic migration from the Supabase chain.
3. Redefine semantic review persistence against a different production receipt
   model.
4. Permit a project-specific out-of-order or skipped migration strategy.

Options 2-4 could change evidence, receipt, or future installation semantics.
Codex did not select one unilaterally.

## 7. Validation not reached

Because migration application is a prerequisite, the following checks did not
run and must not be inferred as passing:

- Agent Identity schema, constraints, and append-only behavior
- global external-identity uniqueness
- two-account Auth and negative RLS matrix
- service-role versus authenticated-user command boundary
- atomic commands and concurrent conflicts
- reconnect and durability checks
- security and performance advisors
- focused, negative-RLS, concurrency, lint, typecheck, full-test, and build
  regression after the live Gate

## 8. Test identities and cleanup

No test Auth account or test row was created. There was therefore no temporary
identity or data cleanup to perform. The validation project remains in place as
the Owner required and was not deleted. No credential, token, connection string,
or secret is recorded in this report or its machine evidence.

## 9. External effects

- Supabase projects created: exactly one, `blriuxocrzgwlojiduue`
- Supabase projects deleted: zero
- other projects mutated: zero
- migrations successfully applied: one, `initial_schema`
- failed migrations persisted: zero
- Auth accounts created: zero
- test rows created: zero
- model calls: zero
- managed Sandboxes: zero
- deployments, merges, payments, or blockchain actions: zero

## 10. Claims that remain prohibited

This result does not establish:

- production persistence active
- live Agent Identity schema applied
- live RLS verified
- production multi-user isolation verified
- production concurrency verified
- live Supabase migration completed

The accepted local contract limitations remain authoritative.

## 11. Machine evidence

- Evidence: `test-results/beta-gate-1-real-supabase-migration-blocked.json`
- Evidence SHA-256: `05e627dfbef6941716425982ec82d0944ce7cde013887accb7feeca82e61aada`
- Recorded at: `2026-09-08T16:55:29.908Z`

The evidence contains the authorized boundary, project identity, preflight,
migration hashes, exact failure, rollback check, unreached validations, external
effects, cleanup state, and prohibited claims. It contains no credentials.

## 12. Exact owner action required

Choose and authorize the canonical migration strategy for the missing Supabase
trust-foundation prerequisites before any further migration is applied.

Recommended bounded decision: authorize a new prerequisite migration that ports
the already-defined trust-foundation tables and constraints to Supabase without
editing either historical migration, explicitly approve its position before
`semantic_verification_v1`, then allow this same disposable project to resume
from the preserved state.

Until that decision, do not apply `agent_identity_production_persistence_v1`,
skip `semantic_verification_v1`, edit either historical migration, create a
replacement project, or begin write-based Auth/RLS/concurrency validation.
