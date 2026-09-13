# Beta Gate 1 Delete Negative Probes Authorization Blocker

## Result

`MANUAL_ACTION_REQUIRED`

The directly approved `beta_gate_1_security_hardening_v1` migration, SHA-256
`664d95d130691e0bc079054a1c745803d8f39f6eff15c946da5980d0fd608d1e`,
applied successfully to the dedicated non-production Supabase project
`blriuxocrzgwlojiduue` as remote version `20260909062033`.

Catalog readback proved:

- `public.receipt_semantic_reviews` has RLS enabled and zero client policies;
- only `service_role` and `postgres` retain table privileges;
- `public.prevent_receipt_semantic_review_mutation()` has
  `search_path=pg_catalog`;
- `anon` and `authenticated` cannot execute that function;
- `service_role` can execute it.

The security advisor warning is gone. Its only remaining findings are two
informational `rls_enabled_no_policy` notices on intentionally service-only
tables: `agent_external_identity_owners` and `receipt_semantic_reviews`.

## Live Validation Completed Before Stop

Two isolated non-production Auth user rows were created with random,
unrecorded passwords and safe references:

- owner/controller: `owner-controller-667e4450`
- unrelated account: `unrelated-8d458760`

No real customer identity, password, token, or secret was persisted in Gate
evidence.

The following live checks passed:

- service-role Agent creation plus identity revision 1 committed atomically;
- an invalid initial revision failed with `23514
  AGENT_IDENTITY_INITIAL_REVISION_INVALID`, and every Agent/skill/task
  type/endpoint/identity/audit row from that transaction rolled back to zero;
- revision 2 appended and claimed one immutable external identity;
- replaying stale revision 2 failed with `23514
  AGENT_IDENTITY_REVISION_CHAIN_INVALID`;
- changing the controller failed with `23514
  AGENT_IDENTITY_CONTROLLER_MISMATCH`;
- owner RLS read returned two revisions while hiding the unrelated profile;
- unrelated-account RLS returned zero identity rows and a null RPC result while
  still allowing that account to read its own profile;
- anonymous access returned zero private Agent/identity rows and a null RPC
  result;
- authenticated mutation RPC execution failed with `42501`;
- authenticated direct identity insertion failed with `42501`;
- a service-side command carrying the unrelated account ID failed with `42501
  AGENT_IDENTITY_ACCESS_DENIED`;
- two concurrent revision-3 requests produced exactly one commit and one
  explicit `23514` chain conflict; the durable chain contains revisions 1, 2,
  and 3 with three distinct hashes and no overwrite;
- two concurrent Agent creations claiming the same external identity produced
  exactly one commit and one explicit `23505 EXTERNAL_IDENTITY_CONFLICT`; one
  ownership row exists, and the losing Agent plus all child rows rolled back;
- service-role UPDATE attempts against both append-only identity tables reached
  Postgres and failed with `55000` from the append-only trigger;
- independent reconnect reads confirmed three intact primary revisions and two
  intact external ownership rows.

## Stop Evidence

The Gate also requires live proof that prohibited DELETE operations fail. Two
bounded service-role DELETE probes were submitted:

1. identity revision 1 for Agent
   `0e825fa5-8cf0-42a3-8a8a-bc212a842209`;
2. external identity ownership key
   `OTHER:beta-gate-1::primary-identity-20260909`.

The execution safety layer rejected both before they reached Supabase because
it treats attempted DELETEs of append-only identity evidence as destructive,
even though the existing triggers are expected to reject and roll back each
statement. No indirect query, trigger change, cascade, or other workaround was
attempted.

A read-only integrity check after rejection confirmed that revision 1, its
expected SHA-256, the ownership row, all three primary revisions, and both
external owner rows remain intact.

## Still Pending

- the two live DELETE negative probes;
- cleanup of the unrelated temporary account and profile;
- final durability summary and evidence persistence;
- focused and complete repository regressions;
- credential/path leakage scan;
- final Gate report and external milestone review.

## Exact Owner Action Required

Explicitly authorize only the two service-role DELETE negative probes listed
above, solely to prove that the existing append-only triggers reject them. No
trigger disablement, cascade, policy change, or successful deletion is
authorized. If either DELETE succeeds instead of returning the expected
`55000`, execution must stop immediately without a second destructive action.

The Gate remains `NOT_VERIFIED`. Provisional and canonical Real Job
contributions remain zero.
