# Beta Gate 2 Trust Workspace V1 Report

## Status

# MILESTONE PASS — BETA GATE 2 TRUST WORKSPACE V1 — EXTERNAL REVIEW REQUIRED

This is a non-production product and engineering PASS. It is not Beta Gate 3,
Private Beta readiness, a live Agent execution, or a Real Verified Job.

1. **Auth HTTP-session result:** PASS. Two isolated test accounts signed in
   through the real application/Supabase Auth path. The valid session survived
   reload and navigation, sign-out removed access, protected routes redirected
   after sign-out, invalid credentials failed with `401`, and an expired/invalid
   browser session failed closed with `401`/`403` on protected writes.
2. **Workspace surfaces:** PASS. The authenticated shell exposes Overview,
   Agents, Work, Work detail, Contract, Authority, Evidence, Receipt, and
   History surfaces with useful empty, loading, and error states.
3. **Persistence:** PASS. Supabase/Postgres now durably stores the Beta profile
   bootstrap, Agent plus identity revision, Work plus locked V2 Contract,
   Authority review, and projections over existing Job, Lease, Evidence, and
   Receipt tables. Reload, sign-out/sign-in, and revisit restored the same state.
4. **Agent UX:** PASS. A user can create, list, and inspect an Agent, controller
   relationship, status, revision, Authority summary, and truthful Work/Receipt
   counts. Demo success is not presented as trust evidence.
5. **Work UX:** PASS. Work creation collects a request, selected Agent,
   repository and branch reference, acceptance requirements, and verification
   explanation through a human-readable form.
6. **Contract UX:** PASS. The Work detail shows the locked V2 Contract,
   requested outcome, source, delivery policy, acceptance criteria, required
   Evidence, version, and lock state without making JSON or hashes primary UX.
7. **Authority UX:** PASS. Allowed actions, denied actions, paths, source,
   network, persistence, and runtime limits are shown before approval. Live
   readback proved the display equals the persisted scope and decision hashes.
8. **Execution / Verification / Delivery UX:** PASS. The three Model C
   dimensions are rendered separately. With no Gate 2 execution they truthfully
   remain Not Started, Not Started, and Not Delivered.
9. **Evidence UX:** PASS. Source, commit-resolution requirement, Contract
   assertions, verifier state, and missing execution Evidence are readable. The
   UI explicitly says execution has not started and claims no success.
10. **Receipt and history UX:** PASS. History is durable and user-scoped. The
    Work view says `No Receipt issued`; a Receipt appears only after real
    execution, independent verification, and delivery, and integrity failure
    withholds the verified claim.
11. **Two-account isolation:** PASS. Each real signed-in browser session saw
    only its own Agent and Work; direct cross-account Agent and Work URLs were
    `404`. Account B's real JWT returned empty reads and `42501` on an Account A
    mutation. A complementary authenticated-role Account A to Account B
    Authority mutation returned `WORKSPACE_WORK_NOT_FOUND`, and Account B kept
    zero Authority rows.
12. **Historical compatibility:** PASS. V1 and V2 Receipt histories remain
    readable. Only valid `VERIFIED_WORK_RECEIPT_V2` records can qualify;
    unknown, Gate, candidate, Demo, and Seed records remain nonqualifying.
    Tampered Evidence chains or Receipts fail integrity tests and are not shown
    as valid.
13. **Desktop and mobile:** PASS. The real app was exercised on desktop and at
    `390x844`. The mobile navigation was moved into a `document.body` portal to
    eliminate clipping and text bleed. Final pages were usable with zero
    success-path console errors.
14. **Security advisor:** PASS for the Gate boundary. There are no high or
    critical findings. Two INFO notices cover intentional service-only RLS
    tables. Four WARN notices identify the intentionally authenticated
    `SECURITY DEFINER` Workspace RPCs; each is bounded by internal subject and
    ownership checks. Performance notices are documented and deferred for the
    mostly empty Beta project.
15. **Full regression:** PASS. Workspace/history focus: 13/13. Repository:
    338 active tests passed in 68 files with 14 established skips in 7 files.
    Lint, strict typecheck, Supabase-mode Web production build, Worker build,
    browser checks, diff check, and sensitive-data scan passed.
16. **External effects:** Only the approved append-only migrations and bounded
    test-account Workspace records were written to `donelayer-beta-validation`
    (`blriuxocrzgwlojiduue`). No model call, Sandbox, Job Run, Permission Lease,
    Evidence row, Receipt, PR, deployment, payment, blockchain action, billing
    change, or second provider occurred. `gym` was not accessed or modified.
17. **Classification:** `NOT_VERIFIED`. This engineering milestone did not run
    through the complete Verified Work lifecycle and produced no Verified Job
    Receipt. Provisional count: `0`; canonical contribution: `0`; remaining
    Reputation entry gap: `20`.
18. **Beta Gate 2 result:** PASS within the Trust Workspace V1 scope.
19. **Remaining blockers before Beta Gate 3:** external acceptance of this Gate,
    followed by a separately authorized real User to Agent to Sandbox to
    Deliverable to Fresh Verifier to Receipt run. Production readiness,
    generalized repository access, payments, and Reputation remain outside this
    result.
20. **Exact next action:** conduct external review of this report and
    `test-results/beta-gate-2-trust-workspace-v1-evidence.json`; do not begin
    Beta Gate 3 until that review is explicitly accepted.

## Migration Evidence

- `20260909153232 beta_gate_2_trust_workspace_v1`, local SHA-256
  `f33138b1f79dedc43bc57cd2c58141ba30590d1b06c457cba62167fdca0426d6`
- `20260909164614 beta_gate_2_workspace_bootstrap_fix_v1`, local SHA-256
  `2291fd08e77d55f4dcc6efb124922203e635fe8f4910fe5a8be9b63fd8cce172`

Catalog readback confirms `SECURITY DEFINER`, fixed
`search_path=pg_catalog, public`, no `anon` execution, authenticated and
service-role execution, the distinct `actor_auth_user_id` variable, and removal
of the ambiguous predicate.

Advisor references:

- Security definer executable:
  <https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable>
- RLS enabled with no client policy:
  <https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy>
- Unindexed foreign keys:
  <https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys>
- Unused indexes:
  <https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index>
- Multiple permissive policies:
  <https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies>
