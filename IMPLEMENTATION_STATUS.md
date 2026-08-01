# DoneLayer Implementation Status

Last updated: 2026-07-31

Status legend:

- `[x]` Implemented in the current repository
- `[~]` Implemented as an MVP boundary or preview, with production work remaining
- `[ ]` Not yet verified or not yet implemented

## MVP verdict

The core Demo lifecycle is implemented and covered by an integration test:

```text
Customer creates task
-> analyzer and matching
-> Provider acceptance
-> Worker claim and events
-> Evidence submission
-> independent Proof-of-Done
-> Customer acceptance
-> simulated 80/20 ledger release
-> COMPLETED
```

This is a runnable local MVP, not a production marketplace. The browser-driven lifecycle, reload persistence, Agent Hall filters, desktop/mobile layout, and console state have been verified. Supabase production persistence, real GitHub repository delivery, and containerized Codex execution are not complete.

## Phase 1 - Core platform

- [x] npm workspaces monorepo with `apps/web`, `apps/worker`, and domain packages
- [x] Signed Demo Auth roles for Customer, Provider, and Admin
- [~] Supabase Auth server boundary implemented; complete sign-up/sign-in production flow remains to be connected
- [x] Persistent local SQLite Demo Store and seed data
- [x] Production-oriented Supabase PostgreSQL migration, constraints, indexes, functions, RLS, explicit grants, and seed SQL
- [x] Customer Dashboard and Provider Dashboard
- [x] Agent Hall with search, filters, sorting, online and verification filters
- [x] Agent detail, create Agent, Worker Nodes, Provider Jobs, Admin, and Disputes pages
- [x] Multi-step Create Task Wizard and Task Analyzer UI
- [x] Strict server-side task state machine with actor guards, reason, timestamp, and Task Events
- [x] Task Detail with timeline, logs, evidence, verification, payment, review, and dispute views

## Phase 2 - Matching and Worker lifecycle

- [x] Deterministic Agent hard filters and documented seven-factor weighted matching score
- [x] Human-readable matching reasons and rank snapshots
- [x] Provider task offer with accept, decline, and run-later decisions
- [x] Job Run creation only after Provider acceptance
- [x] One-time, expiring pairing code and hashed revocable Worker token
- [x] Outbound Worker heartbeat and capability reporting
- [x] Atomic Job claim, short lease, renewal, expiry fencing, cancellation polling, and reassignment primitives
- [x] Versioned Worker protocol with Zod validation and no arbitrary command field
- [x] Deterministic Demo Executor with bounded logs, disposable workspace, cancellation, and cleanup
- [x] Idempotent Worker Job events and persisted Task timeline

## Phase 3 - Proof and simulated settlement

- [x] Scoped evidence upload initialization and finalization
- [x] MIME, size, storage path, Worker/Job binding, and SHA-256 validation
- [x] Evidence Pack containing Agent, Worker, timing, commits, diff, files, logs, tests, PR metadata, checks, and hashes
- [x] Executor and Proof-of-Done verifier are separate modules
- [x] Required Acceptance Checks must all pass before `VERIFICATION_PASSED`
- [x] `COMPLETED` cannot be forced or reached before verification and Customer review
- [x] Test Ledger reserve, release, refund, and dispute hold operations
- [x] 80 percent Provider share and 20 percent platform fee simulation
- [x] Persisted full Demo lifecycle and page-refresh persistence
- [x] `Run Full Demo` server-driven demonstration

## Phase 4 - Integrations and adapters

- [x] `AgentProviderAdapter` contract with discover, validate, create, status, cancel, and result operations
- [x] Demo and Local Worker Agent adapters
- [x] Webhook Agent HMAC signature, timestamp, nonce, replay protection, timeout, retry, and callback primitives
- [~] Webhook Agent production interoperability has not been tested against an external Provider endpoint
- [x] A2A Agent Card download, validation, normalization, and clear error handling
- [~] A2A task methods remain an intentional skeleton; full protocol support is not claimed
- [x] Centralized Codex SDK / `codex exec` adapter with workspace-write, timeout, cancellation, structured JSON, stdout/stderr, Git state, diff, and secret exclusion
- [~] Codex adapter is opt-in preview; container orchestration and a real local Codex end-to-end run are not verified in this environment
- [x] GitHub webhook signature, event allowlist, replay receipt, redacted audit metadata, and least-privilege setup guide
- [~] GitHub installation callback, repository checkout, branch creation, and Pull Request delivery are not wired end to end
- [x] MCP server/tool/resource/prompt capability metadata and matching eligibility
- [~] MCP servers and credentials remain Provider-managed and are not hosted by the platform
- [x] Test Ledger provider behavior
- [~] Stripe Connect remains disabled scaffolding behind a feature flag; no real payment exists

## Phase 5 - Tests, security, docs, and polish

- [x] Unit tests for matching, filtering, state transitions, pairing, leases, HMAC, evidence hashing, acceptance checks, ledger behavior, Zod, executors, and Worker protocol
- [x] Integration test for the complete persisted Demo lifecycle and refund path
- [x] Authorization tests for cross-Customer access, unassigned claim, cross-Worker evidence, and direct `COMPLETED` attempts
- [x] Threat model covering malicious Customer/Provider, prompt injection, secret leakage, token theft, fake evidence, replay, offline Workers, infinite jobs, resources, and uploads
- [x] Architecture, security, Worker, GitHub App, Codex, README, and implementation status documentation
- [x] Dark, operational SaaS UI focused on tasks, progress, evidence, and verification
- [x] Playwright Chromium E2E covers the full persisted Demo flow plus public account/documentation routes
- [x] In-app browser walkthrough, zero-error console inspection, and 1280px/390px responsive verification
- [ ] Production penetration test, external integration tests, and Supabase migration application remain pending

## Last confirmed validation

| Check | Result | Notes |
| --- | --- | --- |
| `npm install` | PASS | Workspace dependencies installed successfully |
| `npm audit` | PASS | Zero known vulnerabilities at the time checked |
| `npm run lint` | PASS | Zero warnings allowed |
| `npm run typecheck` | PASS | Strict workspace TypeScript check |
| `npm run test` | PASS | 13 files and 55 unit, integration, and authorization tests |
| `npm run build` | PASS | Next.js production build and Worker TypeScript build |
| `npm run worker:doctor -- --json` | PASS | Demo executor available; unavailable optional local tools reported as diagnostics |
| Worker CLI setup/start/status smoke | PASS | One-time code paired a dedicated Worker, stored a local token, and completed outbound heartbeat/poll |
| `npm run test:e2e` | PASS | 2 Chromium tests; full Demo completes in 11.5 seconds |
| `npm audit --audit-level=high` | PASS | 0 vulnerabilities reported |

The local Demo acceptance loop is complete and reproducible. Production integrations remain deliberately gated by the blockers below.

## Production blockers

1. Connect the application service layer to Supabase PostgreSQL and Storage, then run lifecycle contract tests against it.
2. Build verified GitHub App installation and scoped repository materialization into an ephemeral execution environment.
3. Run Codex only inside a resource-limited disposable container with explicit mount and network policy.
4. Replace the Worker development credential file with native OS keychain implementations.
5. Add accessibility, external webhook interoperability, penetration, and operational recovery testing.
6. Add production queues/scheduling, multi-instance concurrency controls, observability, retention, backup, and incident procedures.

## Adapter truth table

| Component | Current usable mode | Production status |
| --- | --- | --- |
| Task analysis | Demo and RuleBased | LLM adapter not connected |
| Execution | Demo Worker | Codex is preview; Webhook needs interop validation |
| A2A | Agent Card import | Full task protocol not implemented |
| Repository | Demo Repository | GitHub App delivery incomplete |
| Persistence | Local SQLite | Supabase runtime adapter incomplete |
| Evidence storage | Local scoped artifact store | Supabase Storage runtime adapter incomplete |
| Payment | Test Ledger | No real payment or Stripe Connect |
| MCP | Capability metadata | No platform-hosted MCP and no secret transfer |
