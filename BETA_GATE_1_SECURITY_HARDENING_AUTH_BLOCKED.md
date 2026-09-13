# Beta Gate 1 Security Hardening Authorization Blocker

## Result

`MANUAL_ACTION_REQUIRED`

The two migrations directly approved by the Owner were applied successfully to
the dedicated non-production Supabase project `blriuxocrzgwlojiduue`:

1. `semantic_verification_v1` as remote version `20260909054834`
2. `agent_identity_production_persistence_v1` as remote version
   `20260909054923`

Catalog readback confirmed their expected tables, constraints, indexes,
functions, triggers, RLS configuration, and explicit grants. The migration
history also retains `initial_schema` and the separately approved Trust
Foundation prerequisite.

## Security Advisor Finding

The post-migration Supabase security advisor reported one warning:

- `function_search_path_mutable` on
  `public.prevent_receipt_semantic_review_mutation`

It also reported one informational finding on
`public.agent_external_identity_owners`: RLS is enabled with no policies. This
is the intended service-only deny-all client boundary and is not proposed for
widening.

Reference:
https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

## Bounded Hardening Prepared Locally

New file:
`supabase/migrations/20260909055143_beta_gate_1_security_hardening_v1.sql`

SHA-256:
`664d95d130691e0bc079054a1c745803d8f39f6eff15c946da5980d0fd608d1e`

The migration only:

- fixes the semantic-review mutation trigger function search path to
  `pg_catalog`;
- revokes that function from `public`, `anon`, and `authenticated`, retaining
  `service_role` execution;
- revokes semantic-review table access from client roles and retains
  `service_role` access;
- enables RLS on `public.receipt_semantic_reviews` without adding a client
  policy.

Focused local validation passed: 2 test files and 10 tests. The three
historical migration hashes remain unchanged.

## Stop Evidence

Exactly one `apply_migration` request was made for the new hardening migration.
The execution safety layer rejected it before Supabase mutation because the
Owner's direct approval named only the semantic and Agent Identity migration
hashes, not this additional security mutation. No direct-SQL, grant, function,
RLS, or other workaround was attempted.

The remote project remains at these four versions:

1. `20260908165103 initial_schema`
2. `20260909050427 trust_foundation_prerequisite_v1`
3. `20260909054834 semantic_verification_v1`
4. `20260909054923 agent_identity_production_persistence_v1`

No Auth test account or Gate validation row has been created. Live Auth/RLS,
atomicity, competing revision, external-identity conflict, durability, cleanup,
and complete repository regression validation remain outstanding.

## Exact Owner Decision Required

Approve applying
`beta_gate_1_security_hardening_v1`, SHA-256
`664d95d130691e0bc079054a1c745803d8f39f6eff15c946da5980d0fd608d1e`,
to Supabase project `blriuxocrzgwlojiduue`, acknowledging the four bounded
function/grant/table/RLS changes listed above.

The Gate remains `NOT_VERIFIED`. Provisional and canonical Real Job
contributions remain zero.
