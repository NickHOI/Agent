# Beta Gate 1 Real Supabase Environment Report

## Status

# MILESTONE PASS — BETA GATE 1 REAL SUPABASE ENVIRONMENT — EXTERNAL REVIEW REQUIRED

This is an engineering and non-production validation PASS. It is not a Real
Verified Job, does not add to the Reputation corpus, does not declare Private
Beta readiness, and does not prove that the complete Marketplace is running on
production Supabase.

## Project And Boundary

- Project: `donelayer-beta-validation`
- Project ID: `blriuxocrzgwlojiduue`
- Purpose: `NON_PRODUCTION_VALIDATION`
- Region: `ap-northeast-1`
- Status: `ACTIVE_HEALTHY`
- PostgreSQL: `17.6.1.166`, engine 17 GA
- Unrelated `gym` project: not accessed project-specifically or modified
- Billing-plan change or purchase: none

The retained project remains available for later Beta Gates. No production
deployment, PR merge, payment, blockchain action, model request, or managed
Sandbox occurred.

## Historical Root Cause And Migrations

The original `semantic_verification_v1` failure remains preserved: PostgreSQL
`42P01` proved that `job_receipts` and the accepted pre-semantic Trust
Foundation family were absent from the earlier initial Supabase schema. No
historical migration was rewritten. The separately reviewed prerequisite made
that dependency explicit.

Effective remote history:

1. `20260908165103 initial_schema`
2. `20260909050427 trust_foundation_prerequisite_v1`
3. `20260909054834 semantic_verification_v1`
4. `20260909054923 agent_identity_production_persistence_v1`
5. `20260909062033 beta_gate_1_security_hardening_v1`

Local SHA-256 values are bound in
`test-results/beta-gate-1-real-supabase-environment-evidence.json` and recomputed
by the final evidence test. The prerequisite introduced only the four accepted
Trust Foundation tables plus the Job Contract binding; semantic verification
and Agent Identity then applied without duplicate or conflicting objects.

## Schema And Security

Catalog validation passed for the Trust Foundation, semantic review, and Agent
Identity tables, constraints, indexes, functions, RPC wrappers, triggers, RLS,
and explicit grants. The hardening migration fixed
`prevent_receipt_semantic_review_mutation()` to `search_path=pg_catalog`, removed
client execution/table access, retained service-role access, and enabled RLS on
semantic reviews with no client policy.

The final security advisor has zero warnings. Leaked-password protection is now
enabled. Its only two findings are informational `rls_enabled_no_policy`
notices on `agent_external_identity_owners` and `receipt_semantic_reviews`; both
are intentional service-only deny-all client boundaries.

## Auth And RLS Matrix

Two isolated records in `auth.users` were provisioned with random, unrecorded
password hashes. Database-level Auth was exercised with the real
`authenticated`/`anon` roles and exact `request.jwt.claims` subjects:

| Actor | Own state | Other/private Agent identity | Mutation |
|---|---:|---:|---|
| Owner/controller | own profile and two revisions visible at probe time | unrelated profile hidden | client mutation RPC denied `42501` |
| Unrelated account | own profile visible | zero revisions; identity RPC null; owner profile hidden | direct insert denied `42501`; cross-account service command denied `42501` |
| Anonymous | no Auth subject | zero private Agent/revision rows; identity RPC null | no mutation grant |

No broad fallback access was observed. This proves database-enforced RLS and
service/user separation; it does not claim a public Supabase Auth HTTP signup,
email confirmation, or browser session flow.

## Atomicity And Conflict Handling

- Agent creation and identity revision 1 committed together.
- A deliberately invalid initial revision failed with
  `23514 AGENT_IDENTITY_INITIAL_REVISION_INVALID`; Agent, skill, task-type,
  endpoint, identity, and audit residual counts were all zero.
- Revision 2 appended with its predecessor hash and first external identity.
- A stale revision failed with `23514 AGENT_IDENTITY_REVISION_CHAIN_INVALID`.
- A controller-changing revision failed with
  `23514 AGENT_IDENTITY_CONTROLLER_MISMATCH`.
- A service command carrying the unrelated actor failed with
  `42501 AGENT_IDENTITY_ACCESS_DENIED`.

Two genuinely concurrent revision-3 requests produced one commit and one
explicit chain conflict. The durable primary history contains revisions 1, 2,
and 3 with three distinct hashes and no overwrite.

Two genuinely concurrent Agent creations claimed one identical external
identity. Exactly one Agent and ownership claim committed; the other returned
`23505 EXTERNAL_IDENTITY_CONFLICT`, with zero losing Agent or child rows. No
duplicate ownership exists.

## Append-Only And Durability

Service-role UPDATE and DELETE probes against both identity tables each reached
Postgres and returned `55000` from the append-only trigger. Readback after every
probe proved the target row remained intact. No trigger, policy, cascade, or
grant was changed for testing.

Independent reconnects proved four identity rows with four unique
`(agent, revision)` keys and hashes. Every column, JSON document, controller,
timestamp, and predecessor link agrees. Two external ownership keys remain
unique and correctly reference their first profile. Audit totals are two Agent
creations, two identity registrations, and two revisions.

## Cleanup And Data Truth

The unrelated Auth/Profile test identity was deleted after RLS testing. Failed
atomic and concurrency transactions left no rows. One controller Auth/Profile,
two Agents, four append-only revisions, and two ownership claims remain because
they are the minimal durable live Gate provenance.

Trust Foundation Job, Lease, Ledger, and Receipt rows remain zero. Semantic
review rows remain zero. No fabricated historical work, Receipt, or Reputation
sample was inserted, and no real customer data was used.

## Advisors

Security advisor:

- warnings: `0`
- informational service-only RLS notices: `2`

Performance advisor, recorded without unrelated optimization:

- informational unindexed foreign keys: `9`
- informational unused indexes in the mostly empty project: `58`
- inherited multiple-permissive-policy warnings: `2`
- informational Auth absolute-connection allocation notice: `1`

The composite external-ownership FK is append-only and small at this Gate; the
other findings are inherited or empty-project signals. None is a Beta-critical
correctness or isolation defect in this validation boundary.

## Repository Regression

- focused Supabase/Identity tests: 30/30 across 5 files
- initial strict typecheck: exposed one TypeScript 6-only test-helper capture
  type; failure preserved in this report
- narrow Class A correction: excluded an impossible undefined regex capture;
  6/6 focused tests and strict typecheck then passed
- lint: PASS with zero warnings
- full suite including final evidence replay: 325 active tests across 66 files;
  14 established skips across 7 files
- Web production build: PASS; 22 static pages generated
- Worker build: PASS
- `git diff --check`: PASS; Windows line-ending notices informational
- credential/path scan: PASS; only the existing synthetic redaction-test
  sentinel matched the broad repository scan
- Attempt 3, Attempt 5, and accepted durable-identity evidence hashes remained
  byte-identical; SQLite WAL/SHM sidecars remain absent

## Classification And Remaining Beta Work

Classification remains `NOT_VERIFIED` for the Real Job corpus. This milestone
did not execute as a full current Agent Job and produced no Verified Job
Receipt. Provisional real Jobs remain `0`, canonical real Verified Jobs remain
`0`, and the Reputation gap remains `20`. No external Real Job audit batch is
emitted for an empty queue.

This PASS proves the live non-production Agent Identity/Postgres migration,
RLS, atomic-command, conflict, append-only, and durability boundary. It does not
prove production deployment, production multi-user load, complete Marketplace
or Storage persistence, public Auth session flow, or Private Beta readiness.

Remaining Private Beta work includes the user-facing Trust Workspace, a full
end-to-end live journey, remaining persistence adapters, public Auth session
validation, and Beta deployment/safety validation.

## Exact Next Action

External review of this Beta Gate 1 evidence. Do not begin Beta Gate 2 until the
review decision is recorded.
