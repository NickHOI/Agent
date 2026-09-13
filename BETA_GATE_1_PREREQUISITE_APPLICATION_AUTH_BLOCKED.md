# Beta Gate 1 Prerequisite Application Authorization Blocked

## Result

`MANUAL ACTION REQUIRED - DIRECT CHAT APPROVAL FOR PREREQUISITE DDL`

The Owner-approved migration strategy was implemented and locally verified, but
the execution safety layer rejected the live `apply_migration` call before it
reached Supabase. The approval was supplied through a pasted attachment rather
than a direct chat statement. The safety result explicitly prohibits indirect
execution or a workaround.

No new migration, Auth account, test row, or other database mutation occurred.
The earlier blocked report remains unchanged.

## Historical prerequisite proof

The exact pre-semantic schema was recovered read-only from immutable Gate
databases rather than inferred from current code:

- `test-results/repository-reality.sqlite`, SHA-256
  `87d2f6da919528bc02d41c33d4446024ab403137d25616659af30b7474b5cf80`
- `test-results/real-build-test-sandbox.sqlite`, SHA-256
  `0ec472ae954d7dcb682106e78e8c230bc971ac5cfc4ded738d0d736acdd56be4`

The complete minimum Trust Foundation prerequisite is:

1. `public.task_contract_versions`
2. `public.job_runs.task_contract_version_id`
3. `public.permission_leases`
4. `public.evidence_ledger_entries`
5. `public.job_receipts`

It includes the accepted indexes, Contract and Permission binding checks,
status guards, append-only Ledger and Receipt protection, one-way Receipt
invalidation, participant-scoped RLS reads, and service-only mutations. It does
not include semantic review, Task-Scoped Authority, or Agent Identity objects.

## New migration

- Path: `supabase/migrations/20260903080000_trust_foundation_prerequisite_v1.sql`
- SHA-256: `ae62be0c0144b25a3590cfcf800abe419ef131e757fe2922426c1d798bcd1871`
- Supabase CLI generated the migration skeleton first.
- The new file alone was assigned an explicit backfilled version so clean
  databases apply it before `semantic_verification_v1`.
- No existing historical migration was renamed or modified.

Effective clean-install order:

1. `20260731235500_initial_schema.sql`
2. `20260903080000_trust_foundation_prerequisite_v1.sql`
3. `20260903090000_semantic_verification_v1.sql`
4. `20260908141623_agent_identity_production_persistence_v1.sql`

Historical migration hashes remain:

- initial schema: `36883b21e22bef69d415e479d09765621641d449e6de4a40416154fd4e26630a`
- semantic verification: `f7d8ce4a14fa603b9d9f2e946fd7216f7b11c61920b21a3eb357ff08769b655d`
- Agent Identity: `79e5d47bc0efe3565ce8448662c9192a50116423ae81993ade48b27268ffec64`

## Local validation

The focused migration suite passed `5 / 5`. It proves effective order,
historical hashes, exact pre-semantic Receipt and Ledger value sets, the bounded
four-table scope, binding/immutability triggers, RLS, explicit grants, and the
absence of later semantic or identity objects.

The first focused run passed four tests and failed one because its SQL parser
was case-sensitive while the historical SQLite DDL used uppercase `CHECK`. The
parser was corrected without changing migration SQL or expectations; the full
focused suite then passed.

## Remote state before the rejected call

- Project: `donelayer-beta-validation`
- Project ID: `blriuxocrzgwlojiduue`
- Status: `ACTIVE_HEALTHY`
- Recorded migrations: only `20260908165103 initial_schema`
- Trust Foundation tables present: none
- `job_runs.task_contract_version_id` present: no
- Auth users: `0`
- Existing reference rows: `43` in `task_state_transitions`
- `gym` access or mutation: none

## Exact manual action

Reply directly in this chat with explicit approval to apply migration SHA-256
`ae62be0c0144b25a3590cfcf800abe419ef131e757fe2922426c1d798bcd1871`
to Supabase project `blriuxocrzgwlojiduue`.

That migration creates four Trust Foundation tables, adds
`public.job_runs.task_contract_version_id`, and installs the documented
constraints, indexes, append-only triggers, RLS policies, and explicit grants.

## Machine evidence

- `test-results/beta-gate-1-prerequisite-application-auth-blocked.json`
- SHA-256: `bff18ea58d514b12a5a9bb65506ebd4c66e39e9556954d80819fcd0df7f581f3`
- Credentials or tokens persisted: no
