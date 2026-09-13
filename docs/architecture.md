# DoneLayer Architecture

DoneLayer is a completion marketplace for bounded software tasks. A task is not
complete when an executor says it is done. Completion requires an independent
Proof-of-Done verification run and explicit customer acceptance.

## Canonical Planning Context

- `PRODUCT_NORTH_STAR.md` defines the product.
- `PRODUCT_ROADMAP.md` is the canonical long-term roadmap and locked technology
  priority. Deferred items must not be silently removed.
- `CURRENT_PHASE.md` defines what work is currently authorized.
- `../CURRENT_ARCHITECTURE.md` and `../PRODUCT_REALITY_AUDIT.md` separate
  connected runtime reality from target architecture.

The first product wedge is Verified Work built around a Work Contract, Evidence
Bundle, independent verification, and Verified Work Receipt. The long-term
platform then expands through task-scoped Authority, Agent Identity,
evidence-based Reputation, controlled Payments, a Verified Settlement Loop, and
organizational trust. Portable attestations, ERC-8004, HOL/UAID, x402, and other
standards remain optional adapters. These future layers must extend the internal
Evidence Ledger and Verified Receipt model. They are not evidence of current
implementation, and the product must remain fully functional off-chain without
a token or blockchain dependency.

## System shape

The MVP is one npm-workspaces monorepo with no required microservices:

- `apps/web` is the Next.js UI and trusted platform API.
- `apps/worker` is an outbound-only Node.js worker CLI.
- `packages/shared` owns schemas and domain types.
- `packages/task-state-machine` owns legal task transitions.
- `packages/matching` owns deterministic filtering and scoring.
- `packages/proof-of-done` evaluates acceptance checks independently of executors.
- `packages/agent-adapters` contains Demo, local Worker, Webhook, and A2A adapters.
- `packages/worker-protocol` owns the versioned Worker HTTP contract.
- `supabase` contains the production PostgreSQL model, RLS, and demo fixtures.

The platform initiates no connection to a provider machine. Workers poll or
long-poll the platform over outbound HTTPS, renew a short job lease, and upload
events and evidence through scoped API routes.

Public marketplace reads use explicit safe projections for Provider identity.
Task participants receive a separate task-scoped Worker status projection rather
than raw machine capabilities or Worker metadata.

## Persistence ports

Application services depend on domain commands, not database-specific CRUD.
The selected adapter is created on the server from `STORE_DRIVER`:

- `demo` uses a single-process persistent FileDemoStore and LocalArtifactStore.
- `supabase` uses PostgreSQL/Supabase Storage and Supabase Auth.

Both adapters must implement atomic commands for task transition, pairing-code
consumption, job claim, lease renewal, evidence finalization, verification, and
ledger posting. Contract tests run the same lifecycle against both adapters.
The browser and Worker never branch on the selected store.

The demo file is validated on load, updated under a process-wide mutex, and
replaced atomically via a temporary file. It persists across browser refreshes
and local server restarts, but it is intentionally not a multi-instance store.
Workers still use HTTP, leaving the Web process as the only writer.

Production must fail closed when Supabase variables are missing. It must never
silently select Demo mode. Demo sessions and reset endpoints are disabled unless
Demo mode is explicitly enabled.

## End-to-end lifecycle

1. A Customer creates a DRAFT with repository, budget, risk, permission, and
   acceptance-check definitions.
2. The server reserves test funds, publishes the task, and records a Task Event.
3. A Task Analyzer produces a scope, capabilities, risk, workflow template,
   checks, budget guidance, and duration guidance.
4. Matching publishes a privacy-reviewed opportunity, removes ineligible Agents,
   then scores the remaining Agents.
5. The selected Provider reviews the permissions and explicitly accepts.
6. The server creates a Job Run only after acceptance.
7. The assigned Worker claims the Job and receives a short lease with a fencing
   generation. A new attempt is created after lease expiry.
8. The executor works only through a predefined workflow template, streams
   redacted events, and submits immutable evidence artifacts.
9. The verifier evaluates every required acceptance check using the evidence and
   independent platform or GitHub observations.
10. A passed verification enters Customer Review. Customer acceptance posts a
    balanced simulated ledger transaction and transitions the task to COMPLETED.

Every task transition locks the task, validates its current status and version,
increments `status_version`, and appends a Task Event in the same transaction.
The database trigger rejects both illegal state edges and any status write that
did not originate from the transition command. COMPLETED is rejected unless a
passed verification run covers every required acceptance check.

## Matching

Hard filters run before scoring:

- Required skill and task type
- Operating system and installed tool support
- Required MCP tools installed on the Worker
- Worker online and accepting jobs
- Agent active and accepting tasks
- Budget at or above the Agent minimum
- Docker available for any non-demo local execution

Eligible candidates use a transparent weighted score:

| Component | Weight |
| --- | ---: |
| Skill match | 35% |
| Verified success rate | 20% |
| Availability | 15% |
| Environment match | 10% |
| Budget fit | 10% |
| Average speed | 5% |
| Recent reliability | 5% |

`task_matches` stores the component snapshot, total, rank, eligibility, and
human-readable reasons. Matching is replaceable infrastructure, not a security
or protocol boundary.

## Worker protocol and leases

Pairing exchanges a short-lived, one-time code for a revocable Worker token.
The token authenticates the Worker, while each claimed Job receives a separate
lease token. Job events, evidence requests, submission, and cancellation checks
must present the active Worker and lease credentials.

Workers heartbeat every 15 seconds. Online status is derived from platform
receipt time, not from the reported status. A 60-second job lease is renewed
every 15 seconds but never beyond the absolute Job deadline. Reassignment creates
a new Job Run attempt and increments a fencing generation. Late messages from an
older attempt are rejected. Delivery is at least once, with idempotency keys and
fencing providing effective single-writer behavior. The Web scheduler invokes the
service-only lease-expiry RPC at least every 15 seconds; it fences expired attempts,
updates Worker workload, and leaves the application service to create a new Job.

## Executors

- Demo Executor emits deterministic logs, patch, test result, and evidence.
- Codex CLI Executor centralizes all CLI flags in one adapter, uses the provider's
  local Codex authorization, captures structured output, and never uploads Codex
  credentials.
- Webhook Agent Executor signs the raw body with HMAC and includes timestamp and
  nonce. Callback requests use the same replay controls.
- A2A Adapter imports and validates Agent Cards but does not claim full protocol
  interoperability in the MVP.

No Customer field becomes a raw shell command. Acceptance checks refer to a
server-owned workflow-template key whose commands are versioned in code.

## Proof-of-Done

Executors produce evidence; verifiers decide acceptance. These are separate
modules and identities. Evidence is uploaded to an immutable, task/job-scoped
path and finalized only after server-side size, MIME, and SHA-256 verification.

Verification results record expected and actual values per acceptance check.
A verification run passes only when every required result passes. GitHub Checks
are fetched directly from GitHub, URL health checks use SSRF-safe networking,
and human approval is recorded as a separate trusted actor event.

## Test ledger

The test ledger uses integer cents and double-entry transactions. Reserve moves
funds from Customer Available to Escrow. Release moves 80 percent to Provider
Available and 20 percent to Platform Revenue. Refund returns Escrow to Customer.
Disputes move Escrow to Dispute Hold. Wallet rows are locked, entries sum to zero,
balances cannot be negative, and each operation has a unique idempotency key.

## Supabase boundary

All application tables have RLS. The Data API grants authenticated users only an
explicit read-only table list. Sensitive token, pairing, lease, webhook, and audit
tables have no client grant. Mutations use trusted server commands and the service
role never reaches a browser or Worker.

Authorization helpers live in the unexposed `private` schema, set a fixed
`search_path`, and return only boolean decisions. No public `SECURITY DEFINER`
function exists. Service-role-only public `SECURITY INVOKER` RPC wrappers expose
transactional transition, pairing, claim, lease renewal, and lease expiry commands
without exposing private helpers. Supabase Storage uses a private evidence bucket
and exact-path signed upload tokens issued only after active-lease authorization.

## Realtime

Realtime is an optimization, not the source of truth. Task and Job timelines are
ordered by server-generated sequence numbers. If Realtime is unavailable, the UI
polls the same read endpoint and resumes from its last sequence. Reconnection can
therefore neither invent nor skip a durable event.
