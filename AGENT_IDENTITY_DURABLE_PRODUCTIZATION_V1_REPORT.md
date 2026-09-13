# Agent Identity Durable Productization V1

Date: 2026-09-08

## Gate Decision

`PASS - LOCAL DURABLE PRODUCTIZATION BOUNDARY`

This is a major Phase 3 product milestone and requires external review before
it becomes an accepted canonical milestone. It does not claim Supabase,
multi-instance, or production deployment readiness.

## Real Product Job Classification

- Job ID: `phase3-agent-identity-durable-productization-v1`
- Independent need: yes; Phase 3 already required a durable identity/profile
  layer, API, and UX without regard to the Reputation corpus.
- Preliminary classification: `NOT_VERIFIED`
- Reason: engineering and browser verification passed, but this delivery did
  not run through the full current Agent Job trust lifecycle and has no
  Verified Job Receipt.
- Provisional queue contribution: `0`
- Canonical contribution: `0`

## Delivered Boundary

- The Agent Identity domain now lives in the database package and remains the
  single implementation used by Contracts, Authority, execution, Evidence,
  and Receipts.
- `agent_identity_profiles` stores canonical whole-profile JSON, revision and
  previous-profile hashes, controller account, and append time.
- SQLite triggers reject update, delete, invalid predecessor, revision gaps,
  and controller changes. External identity ownership is immutable and unique.
- Provider-created and platform-managed Marketplace Agents receive revision 1
  in the same SQLite transaction. Existing Agents are backfilled once with an
  auditable migration event.
- Authenticated controller-only APIs read historical revisions, append profile
  changes, and link external identities. Admin is read-only. Public linkage is
  limited to `DECLARED`; clients cannot self-promote a link to `VERIFIED`.
- The Provider list shows identity status, revision, and hash. The public Agent
  page shows the stable ID, full profile hash, controller assurance, runtime and
  Marketplace metadata, active task-scoped Authority, and Receipt-backed work.
- Hard-coded Demo completion claims were removed from the trust view. Invalid,
  invalidated, disputed, failed, infrastructure-only, and metadata-only
  Receipts fail closed and do not appear as Verified Work. Receipt validity is
  explicitly separate from Reputation classification.

## Defects Corrected During The Gate

1. Existing seed Agent IDs used a bounded historical `agent-*` format that the
   in-process Gate had never exercised. The compatibility grammar now accepts
   that exact legacy family while new generated identities remain `agt_` IDs.
2. Platform-managed Gate helpers inserted Agents directly and could leave them
   without an identity until restart migration. Every managed creation path now
   initializes identity in the same nested SQLite transaction.

Both were narrow implementation corrections. No trust rule, Authority,
Verified Delivery meaning, or historical artifact changed.

## Verification

- Focused identity persistence and trust projection: 14/14 PASS.
- Persisted evidence replay: 2/2 PASS.
- Full suite: 305 active tests PASS across 62 files; 14 established tests
  skipped across 7 files.
- Lint: PASS with zero warnings.
- Strict typecheck: PASS.
- Web production build: PASS; 22 static pages generated.
- Worker build: PASS.
- Real HTTP contract: create `201` / revision 1; read `200`; revise `200` /
  revision 2 with predecessor hash; declared external link `201` / revision 3;
  stale revision `409`; non-controller read `403`.
- Browser QA: Provider list to Agent detail passed at 1440x900 and 390x844;
  no document/hash overflow, framework overlay, console warning, or console
  error on success paths. The truthful zero-Receipt and zero-Authority states
  rendered, and the former hard-coded completion titles were absent.
- `git diff --check`: PASS; Windows line-ending notices are informational.
- Credential/path scan: PASS; only the test sentinel pattern matched itself.

## Durable Evidence

- `test-results/agent-identity-durable-productization-v1-evidence.json`
  SHA-256: `01457d072734d17603faf2c21e60f57a2d8ff1bd01af2fe46403bf69b6555973`
- `test-results/agent-identity-durable-productization-v1.sqlite`
  SHA-256: `b42579fbbf0819c699efd5d8031d68b530b1919a339934d88be95f611a9e86d`
- The store verifies five Agents, seven profile revisions, one declared external
  identity, three linked revisions for the evidence Agent, and four expected
  denial probes before and after restart.
- No WAL or SHM sidecar remains for the evidence database.

## Trust And External Effects

- Model calls: `0`
- Managed Sandboxes: `0`
- GitHub/Vercel reads or writes: `0`
- External identity verification: not performed
- PR, merge, deployment, payment, billing, blockchain, token, and production
  credential effects: none
- Historical Attempt 3-5 artifacts: unchanged

## Remaining Boundary

Supabase persistence, multi-instance concurrency, backup/recovery, production
authentication assurance, live external identity resolution/challenges,
verified capability derivation, identity edit/link UX, and production
deployment remain incomplete. Identity still grants no Authority by itself.

## External Review Decision

The Owner accepted this completed local SQLite productization milestone on
2026-09-08 with every limitation above unchanged. Its product status is PASS;
its Real Job corpus classification remains `NOT_VERIFIED`, with zero provisional
and canonical contribution. The Owner also clarified that a major milestone
with zero provisional Jobs requires milestone review only, not an empty Real
Job audit batch.

## Evidence Hash Erratum

An offline verification on 2026-09-08 found that the SQLite SHA-256 printed
earlier in this report omitted one `d` and was therefore only 63 hexadecimal
characters. The accepted SQLite artifact was not changed. Its complete SHA-256
is `b42579fbbf0819c699efdd5d8031d68b530b1919a339934d88be95f611a9e86d`.
