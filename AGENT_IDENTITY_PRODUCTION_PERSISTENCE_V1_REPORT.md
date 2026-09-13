# Agent Identity Production Persistence V1 Report

Date: 2026-09-08

## Decision

`AGENT_IDENTITY_PRODUCTION_PERSISTENCE_V1_LOCAL_CONTRACT_GATE`: **PASS**

This is a local production-contract result. It is not proof that a Supabase
project is migrated, operational, multi-instance safe, backed up, or deployed.

Required stop:

`MILESTONE PASS - EXTERNAL REVIEW REQUIRED`

There are zero provisional Real Jobs, so no external Real Job audit batch is
created.

## Genuine Product Requirement And Classification

- Job ID: `phase3-agent-identity-production-persistence-v1`
- Requirement: the Phase 3 exact next step in `docs/PRODUCT_ROADMAP.md`
- Independent need: the accepted SQLite identity model requires production
  persistence regardless of the Reputation corpus threshold
- Preliminary classification: `NOT_VERIFIED`
- Reason: engineering validation passed, but no full current Agent Job lifecycle
  or Verified Job Receipt ran
- Provisional contribution: `0`
- Canonical contribution: `0`
- Canonical state: provisional `0`, accepted real Verified Jobs `0`, gap `20`

## Delivered Contract

- Supabase CLI generated
  `supabase/migrations/20260908141623_agent_identity_production_persistence_v1.sql`.
- Postgres tables preserve whole-document profile revisions and first ownership
  of canonical external Agent identity keys.
- Parent-row serialization, predecessor hashes, monotonic revisions, stable
  controllers, terminal revocation, disabled-to-active denial, immutable
  external history, and update/delete rejection fail closed.
- Authenticated and anonymous reads use an RLS-bound `SECURITY INVOKER` RPC.
- Agent creation plus identity revision 1 and later identity appends are separate
  service-only atomic commands; each re-authorizes the durable actor relationship
  and writes an audit event.
- The server computes and revalidates canonical identity hashes. The command
  client accepts `SUPABASE_SECRET_KEY`, with the legacy service-role variable as
  a server-only compatibility fallback; neither key is browser-visible.
- Agent create/read/revise/link routes select the Supabase adapter only when
  `APP_MODE=supabase`; the accepted SQLite path remains covered.

## Validation

- Focused adapter/migration contract tests: `10 / 10` PASS.
- Complete suite: `315` active tests across `64` files PASS; `14` established
  skips across `7` files unchanged.
- Lint: PASS with zero warnings.
- Strict typecheck: PASS.
- Web production build: PASS; `22` static pages generated.
- Worker build: PASS.
- In-app browser: `/docs` loaded the new server-secret guidance with zero console
  warnings or errors.
- `git diff --check`: PASS; Windows line-ending notices are informational.
- Credential scan: PASS; only environment-variable names and the documented local
  workspace path matched.
- Accepted SQLite evidence JSON remained byte-identical at SHA-256
  `01457d072734d17603faf2c21e60f57a2d8ff1bd01af2fe46403bf69b6555973`.
- Accepted SQLite database remained byte-identical at SHA-256
  `b42579fbbf0819c699efdd5d8031d68b530b1919a339934d88be95f611a9e86d`;
  no WAL/SHM sidecar exists.

The earlier SQLite report printed a 63-character database hash. Its appended
erratum records the complete hash above; no historical artifact or
classification was rewritten.

## Durable Evidence

- `test-results/agent-identity-production-persistence-v1-evidence.json`
- SHA-256:
  `a9aaa98cafe5ec161737bbc061e6a9e1b5638b80e553a9d4e37f910d2da35f2a`
- Migration SHA-256:
  `79e5d47bc0efe3565ce8448662c9192a50116423ae81993ade48b27268ffec64`

## External Effects And Resource Use

- Supabase project/API reads: `0`
- Supabase/Postgres writes or migrations applied: `0`
- Credentials created, read, expanded, or changed: `0`
- Model calls: `0`
- Managed Sandboxes: `0`
- GitHub/Vercel actions: `0`
- PR, merge, deployment, payment, billing, blockchain, token, and production
  data effects: none

## Remaining Boundary

The migration has not run against Postgres. Security advisors, live Auth/RLS
isolation, database error behavior, concurrent writers across processes,
existing-row backfill, backup/recovery, operational monitoring, the remaining
Marketplace store, Supabase Storage, and deployment remain incomplete. A later
live Gate needs a separately authorized non-production Supabase project and
credential boundary. Production persistence must not be described as
operational before that Gate passes.

## Reference Basis

- Supabase Row Level Security:
  https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Next.js server-side client guidance:
  https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs
- Supabase API keys:
  https://supabase.com/docs/guides/api/api-keys
- Supabase explicit Data API grant change:
  https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

## External Review Decision

The Owner accepted this milestone on 2026-09-09 strictly as a local
Supabase/Postgres contract. Accepted scope is limited to the migration/schema
contract, append-only revisions, controller continuity, global external-identity
ownership, RLS design, service-only atomic commands, SQLite compatibility, and
local deterministic evidence/regression validation.

The migration remains unapplied and unexercised against a real
Postgres/Supabase environment. Production persistence, live RLS, production
multi-user isolation, production concurrency, and a live migration remain
unproven. Classification remains `NOT_VERIFIED`; provisional and canonical
contributions remain zero.
