# DoneLayer Agent Rules

1. DoneLayer is an Agent Marketplace and a verifiable task-execution platform.
2. The core product flow is:

   ```text
   User Task
   -> Task Contract
   -> Agent / Worker Assignment
   -> Permission Lease
   -> Execution
   -> Evidence
   -> Independent Verification
   -> Verified Job Receipt
   -> Contextual Reputation
   -> Better Matching
   ```

3. DoneLayer is not a standalone Agent Identity Platform.
4. DoneLayer is not a standalone AI Transparency Platform.
5. Identity, provenance, verification, and reputation are trust layers for the Marketplace.
6. Never describe a Demo flow as Real.
7. Never present fake logs, fake artifacts, frontend `setTimeout`, or a Demo fallback as real execution.
8. Every milestone requires objective evidence.
9. Do not connect real payments before the Real GitHub Vertical Slice is complete.
10. Before starting any work, read:
    - `docs/PRODUCT_NORTH_STAR.md`
    - `docs/PRODUCT_ROADMAP.md`
    - `docs/CURRENT_PHASE.md`
11. Default execution backend: `MANAGED_REMOTE_SANDBOX`; first provider: Vercel Sandbox. Follow `docs/adr/ADR-MANAGED-REMOTE-SANDBOX.md`. Do not require ordinary Customers or Providers to install Docker, WSL, Linux VMs, or local virtualization.
12. `LOCAL_SELF_HOSTED_DOCKER` is `DEFERRED_BY_OWNER`, opt-in Advanced Provider / Enterprise Self-hosted Mode, and not required for the default MVP. Preserve the historical Docker BLOCKED report; do not portray it as success.
13. Keep Agent, Server-side Orchestrator, Execution Backend, Sandbox Provider, and Sandbox Instance distinct. Platform credentials stay server-side and must never reach workloads, logs, artifacts, or public receipts.
14. Managed execution must fail closed when unavailable. No local host, local Docker, or Demo fallback. This gate permits only platform-controlled smoke/timeout programs, deny-all network, no snapshots, no repository code, and verified cleanup.
15. Stop at the first authentication, linking, OIDC, availability, or billing blocker with one specific manual next step. No billing changes, plan upgrades, purchases, or second provider implementation.
16. `docs/PRODUCT_ROADMAP.md` is the canonical long-term roadmap. Future agents must preserve its locked priority order and must not silently delete deferred items. The roadmap does not override the implementation boundary in `docs/CURRENT_PHASE.md`.
17. Before classifying Verified Work or changing any Reputation corpus count, read `docs/REAL_JOB_CLASSIFICATION_POLICY.md` and `docs/REAL_JOB_AUDIT_QUEUE.md`.
18. Automatically exclude Demo, Seed, benchmark, Fixture, Gate-exercise, workflow-validation, and corpus-manufactured Jobs. A verified benchmark is `BENCHMARK_FIXTURE_VERIFIED_JOB`; it contributes zero and does not require individual Owner review.
19. Codex may classify clearly genuine work only as `PROVISIONAL_REAL_JOB`. Provisional and ambiguous Jobs enter `docs/REAL_JOB_AUDIT_QUEUE.md` and contribute zero until an external audit accepts them. Stop for `OWNER DECISION REQUIRED - EXTERNAL REAL JOB AUDIT BATCH` at five new provisional Jobs, an apparent threshold crossing, a blocking ambiguity, or a major canonical milestone only when at least one provisional Job actually requires classification. A major milestone with zero provisional Jobs requires only `MILESTONE PASS - EXTERNAL REVIEW REQUIRED`.
20. Never relabel Owner-requested work as real merely to populate the corpus. Ask whether the work would genuinely have been needed without the Reputation threshold. Real customer/sensitive data or new legal/privacy implications require Owner approval before execution.
