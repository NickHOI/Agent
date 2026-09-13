# Beta Gate 1 Auth Password Protection Blocker

## Result

`MANUAL_ACTION_REQUIRED`

The two directly authorized service-role DELETE negative probes both reached
the dedicated non-production Supabase database and behaved exactly as required:

1. deleting Agent `0e825fa5-8cf0-42a3-8a8a-bc212a842209` identity revision 1
   failed with `55000 agent_identity_profiles is append-only`;
2. deleting external identity ownership
   `OTHER:beta-gate-1::primary-identity-20260909` failed with `55000
   agent_external_identity_owners is append-only`.

Readback after each attempt proved the targeted row remained intact. No trigger,
policy, cascade, or grant was changed.

The temporary unrelated Auth user and profile were then safely removed using
their exact IDs, validation-purpose metadata, and no-reference guards. Cleanup
readback returned zero unrelated Auth/Profile rows while retaining the owner
Auth row, three primary revisions, and two external identity ownership rows.

## Durable State

An independent reconnect query proved:

- project status: `ACTIVE_HEALTHY`;
- PostgreSQL: `17.6.1.166`, engine 17 GA;
- five coherent remote migration versions;
- one retained isolated Auth/controller row and one public profile;
- two successful validation Agents;
- four identity revision rows with four distinct `(agent, revision)` keys and
  four distinct profile hashes;
- all profile columns, JSON documents, predecessor links, controller IDs, and
  timestamps agree;
- two distinct external ownership keys, each bound to its first profile row;
- invalid-create and competing-claim loser Agents remain absent;
- expected audit counts: two registrations, two Agent creations, and two
  revisions.

The four Trust Foundation tables and semantic review table remain free of
fabricated Job, Receipt, Ledger, Lease, or semantic-review data.

## Final Advisor Finding

The final security advisor run contains:

- two informational `rls_enabled_no_policy` findings on the intentionally
  service-only `agent_external_identity_owners` and
  `receipt_semantic_reviews` tables;
- one warning: `auth_leaked_password_protection` is disabled.

Supabase documents leaked-password protection as an Auth setting available on
the Pro Plan and above. The current tool boundary has no scoped Auth-config
mutation operation. Enabling it through an unreviewed Management API token,
guessing the account plan, or altering Auth internals through SQL is not
authorized.

References:

- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

The final performance advisor run remains non-blocking for this Gate:

- 9 informational unindexed foreign keys;
- 58 informational unused indexes in the mostly empty validation project;
- 2 pre-existing multiple-permissive-policy warnings;
- 1 informational Auth absolute-connection allocation notice.

These are recorded without unrelated optimization or trust-policy expansion.

## Pending Work

- enable leaked-password protection without a plan change or purchase;
- rerun the security advisor and verify the warning is gone;
- persist the final PASS evidence and report;
- run focused tests, negative evidence tests, lint, strict typecheck, the full
  suite, Web build, Worker build, diff checks, historical integrity checks, and
  credential/path leakage scanning.

## Exact Manual Action

Open the Supabase dashboard for project `blriuxocrzgwlojiduue`, go to
Authentication / Providers / Email password security, and enable **Leaked
password protection**. Do not approve any plan upgrade, purchase, or billing
change. If Supabase requests one, leave the setting unchanged and report that
exact blocker.

The Gate remains `NOT_VERIFIED`. Provisional and canonical Real Job
contributions remain zero.
