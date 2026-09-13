# DoneLayer Product Roadmap

> Canonical long-term product roadmap.
> AI agents must read this document before proposing or implementing future phases.
> Deferred roadmap items must not be silently removed.

## Authority And Status

This document owns DoneLayer's long-term product direction and ordering. It does
not authorize implementation by itself, and a roadmap entry is never evidence
that a capability is live.

- `PRODUCT_NORTH_STAR.md` defines the product and its core value.
- `CURRENT_PHASE.md` defines the currently authorized boundary and stop point.
- `../CURRENT_ARCHITECTURE.md`, `../PRODUCT_REALITY_AUDIT.md`,
  `../IMPLEMENTATION_STATUS.md`, and the Gate reports classify what is actually
  connected and objectively verified.
- `architecture.md` describes the target system shape.
- `../AGENTS.md` requires agents to read these documents before work.

When documents appear to disagree, current objective evidence controls reality
claims, `CURRENT_PHASE.md` controls implementation authorization, and this file
controls long-term product ordering. Deferred items may change only through an
explicit roadmap decision that records what moved and why.

## Strategic Realignment - 2026-09-03

The previous roadmap correctly preserved portable Attestations, ERC-8004
compatibility, a unified Permission Engine, x402 payments, Capability
Intelligence, external Agent adapters, provenance, and the deferred AI
Transparency Kit. It ordered the first four technology tracks as:

```text
Attestations / Verifiable Credentials
-> ERC-8004 compatibility
-> Agent Permission Engine
-> x402 Agentic Payments
```

The latest owner decision supersedes that execution order without deleting any
of those tracks. Discovery of HOL / Hashgraph Online confirms meaningful
competitive overlap in identity, discovery, reputation, permissions, receipts,
payments, and interoperability. DoneLayer will continue competing in the Agent
Trust market, but will lead with a narrower and more differentiated wedge:

> Do not shrink the long-term vision. Narrow the first wedge.

The new product progression is:

```text
FOUNDATION: Evidence-backed execution
-> PHASE 1: Verified Work
-> PHASE 2: Task-scoped Agent Authority
-> PHASE 3: Agent Identity and interoperability
-> PHASE 4: Evidence-based Reputation
-> PHASE 5: Agent Budget and Payments
-> PHASE 6: Verified Settlement Loop
-> PHASE 7: Multi-Agent / Organizational Trust
-> PHASE 8: Agent Work Market / Trust Network
```

This is now the locked product progression. A future reorder requires another
explicit strategic decision with supporting product evidence.

Portable Attestations now extend Verified Work. ERC-8004 and HOL/UAID are
optional Identity/interoperability adapters. The Permission Engine becomes the
implementation path for task-scoped Authority. x402 remains an optional payment
adapter. Capability Passport and Contextual Reputation remain evidence-volume
gated. No preserved item is silently removed.

## Product Positioning

DoneLayer's destination is an **Agent Trust Platform**: trust and control
infrastructure for organizations that use autonomous AI Agents.

DoneLayer also remains an Agent Marketplace and verifiable task-execution
platform. The Marketplace is where trusted work can be requested, matched,
executed, verified, and eventually settled. Identity, Permission, Verification,
Reputation, and Payment are platform trust layers, not disconnected products.

DoneLayer is not only a work-verification product. **Verified Work is the entry
point; the broader Agent Trust Platform is the destination.** It is also not a
crypto startup, a standalone universal Agent identity protocol, or a standalone
payment network.

### Five Questions The Platform Must Answer

1. **Identity:** Who is this Agent?
2. **Reputation:** What has this Agent actually completed, and how reliably?
3. **Permission:** What may this Agent access, change, spend, deploy, or approve
   for this task right now?
4. **Verification:** The Agent says the work is done. Did it achieve the agreed
   outcome?
5. **Payment:** What may the Agent spend, and should funds be released after the
   verified outcome?

### Product Messages

Short-term message:

> AI agents constantly say "Done". We verify whether they actually did the job.

Broader message:

> Infrastructure for controlling, verifying, and trusting AI-Agent work.

Long-term vision:

> A trust operating layer for an economy where autonomous AI Agents perform
> real work, access real systems, and spend real money.

## Destination Lifecycle

Preserve the operating principle:

```text
Plan -> Authorize -> Execute -> Observe -> Verify -> Approve -> Audit
```

Evolve the complete long-term lifecycle toward:

```text
Identify
-> Define Work
-> Authorize
-> Execute
-> Observe
-> Verify
-> Approve
-> Record Outcome / Reputation
-> Settle / Pay
-> Audit
```

The lifecycle is the destination. Its stages do not all need to be implemented
at once.

## Architecture Invariants

The existing DoneLayer evidence system remains the canonical source of truth:

- Evidence Ledger
- Verified Job Receipts and public Receipt verification
- locked Task Contracts and Permission Leases
- controlled managed-Sandbox execution
- tool-call evidence
- dependency, build, and test evidence
- Artifact bytes, manifests, and SHA-256 hashes
- model and Provider provenance
- repository, Commit, diff, configuration, and execution-environment evidence
- Human approval, policy decisions, and explicit failure states

Future identity records, reputation projections, portable credentials, external
registries, chain anchors, and payment proofs must derive from finalized
internal evidence. They may not replace, silently rewrite, or become the only
way to verify that evidence.

- Off-chain first.
- Standards compatible.
- Chain optional.
- No token required.
- No blockchain lock-in.
- Provider-agnostic where practical.
- Evidence before claims.
- Prefer deterministic verification over subjective AI judgment.
- An LLM saying work "looks good" is not the strongest form of evidence.
- Human approval is required for high-risk actions.
- Finalized Evidence is immutable; corrections use supersession or revocation.
- Preserve exact input, Source, policy, configuration, model, Provider, and
  execution-environment provenance.
- Publish portable proofs while keeping private Source data and full Evidence
  private by default.
- Never put raw Evidence, private repository content, secrets, logs, or personal
  data on a public chain.
- Never give an autonomous Agent unrestricted credentials, production access,
  or unrestricted money.

## DONE - Foundation: Evidence-Backed Execution

**Status: VERIFIED ONLY WITHIN THE RECORDED GATE BOUNDARIES**

DoneLayer has objective foundations for recording, reproducing, inspecting, and
verifying bounded Agent work. These successes must not be generalized beyond
the exact reports and evidence that prove them.

### Worker And Trust Primitives

- fixed local `WORKER_SMOKE_V1` pairing, polling, claim, heartbeat, finite Lease,
  recovery, fencing, stale-attempt rejection, Artifact upload, Server SHA-256,
  and workspace cleanup
- locked Task Contract and separate Permission Lease
- append-only Evidence Ledger
- immutable Verified Job Receipt and signed-out public verification
- valid failure and permission-violation Receipts that do not mislabel outcome
  integrity as successful work

### Exact-Fixture GitHub Vertical Slice

- exact public Repository and Commit materialization
- managed Vercel Sandbox smoke/timeout execution with verified cleanup
- bounded Source Package, manifests, dependency installation, build-presence
  detection, real baseline test failure, and Source-integrity evidence
- one bounded live Agent repair that changed only `src/add.ts`, preserved tests,
  passed the repaired test, and retained post-completion provider warnings
- exact persisted patch delivered to a dedicated real branch and Commit
- real GitHub PR #1 created and left open/unmerged
- exact Remote Delivery Commit independently re-materialized in a fresh non-AI
  Sandbox and verified with 2/2 tests passing
- simulated Test Ledger release only after verification and cleanup; no real
  funds moved

The exact Fixture boundary, IDs, hashes, caveats, failed partial attempt, and
provider warnings remain in `CURRENT_PHASE.md` and the Gate reports. Production
GitHub App grants, arbitrary Customer repositories, PR merge/deployment,
production persistence, real payments, and general multi-tenant operation are
not complete.

Default execution backend remains `MANAGED_REMOTE_SANDBOX`; the first Provider
is Vercel Sandbox. `LOCAL_SELF_HOSTED_DOCKER` remains `DEFERRED_BY_OWNER`, is
optional Advanced Provider / Enterprise Self-hosted Mode, and is not required
for ordinary Customers or Providers. See
`adr/ADR-MANAGED-REMOTE-SANDBOX.md`.

Unreported or unverified code in the working tree does not change this DONE
classification. A capability becomes DONE only after its milestone produces
objective evidence and the canonical reality/status documents record it.

## NOW - Phase 1: Verified Work

**Status: BOUNDED V1 DESIGN AND EVIDENCE GATE COMPLETE; OWNER ACCEPTED**

The immediate product problem is:

> AI Agents increasingly say "Done", but people and organizations need evidence
> that the requested outcome was actually achieved.

Agent-reported completion and independently verified completion are different
states. DoneLayer should independently materialize and evaluate the exact work,
then issue an explicit result such as `VERIFIED_DELIVERY`,
`FAILED_VERIFICATION`, `ENGINEERING_REVIEW_REQUIRED`, or another defined
non-success outcome.

### Work Contract

Evolve the existing locked Task Contract into the product-level **Work
Contract** concept. Do not rebuild working contract, lease, evidence, or Receipt
infrastructure.

A Work Contract should express:

- the requested task and expected outcome
- acceptance criteria and their authority
- repository, project, or resource identity
- relevant branch, Commit, version, and configuration
- allowed and forbidden actions
- required Evidence Bundle contents
- deterministic and Human verification rules
- failure, review, supersession, and dispute behavior

Connect the primary flow:

```text
Work Contract
-> Agent execution
-> Evidence Bundle
-> Independent Verification
-> Verified Work Receipt
```

### Verification Evidence

For software work, the verifier should be able to bind and inspect:

- exact repository, base/head Commits, branch, and diff
- execution environment and lifecycle
- dependency installation
- build result or truthful build absence
- tests before and after
- generated Artifacts and logs
- Artifact, Source, configuration, and Evidence hashes
- controlled tool actions
- policy and Permission state
- timestamps
- acceptance criteria and independent reruns
- final verification result

Prefer deterministic checks and fresh independent execution. AI may assist with
bounded analysis where its uncertainty and provenance are explicit, but a model
judgment must not override stronger deterministic failure evidence.

### Portable Verified Work Proofs

The previously preserved Attestation / Verifiable Credential track belongs
inside or immediately after the Verified Work wedge. A finalized Verified Work
Receipt should eventually project to a versioned, signed portable credential
containing minimum necessary claims and references, including Agent identity,
Work Contract, inputs, repository/project, model/Provider, environment, tool
actions, files changed, test results, validation, Evidence hash, timestamp,
Human approval, and final Receipt.

Full Evidence stays in DoneLayer. Portable proof should support cryptographic
signature, SHA-256 integrity, W3C-style credential/attestation representation,
offline or API verification, revocation/supersession, selective disclosure, and
optional external anchoring of a hash only. It remains off-chain first and
requires no token.

### Phase 1 Exit Evidence

- versioned Work Contract schema and authority model
- deterministic mapping from Contract to required Evidence and verification
- explicit Agent-reported versus independently verified states
- negative tests for contradictory tests/specification, tampering, stale Source,
  policy violations, and false success
- one real bounded task whose Work Contract, Evidence Bundle, independent result,
  and Verified Work Receipt verify end to end
- portable Attestation design may follow only after the core Work Contract and
  Verified Work semantics are stable

### Verified Work Contract V1 Gate Result

The owner-authorized **VERIFIED WORK CONTRACT V1 DESIGN AND EVIDENCE GATE**
passed on 2026-09-03 at one exact-Fixture boundary. It reused the Task Contract,
Permission decision, Source materialization, managed Sandbox, Agent repair,
Evidence Ledger, independent verifier, Receipt, GitHub delivery, and simulated
Test Ledger primitives already present.

The result includes a versioned and whole-document-hashed Work Contract,
owner-authoritative acceptance criteria, a deterministic required/satisfied/
missing Evidence Bundle projection, separate Agent-reported and independently
verified states, explicit review-required and superseded outcomes, negative
tamper fixtures, and one real end-to-end repair/delivery proof. Exact scope,
identifiers, caveats, and evidence are in `CURRENT_PHASE.md` and
`../VERIFIED_WORK_CONTRACT_V1_REPORT.md`.

This bounded result satisfies the Phase 1 Gate evidence requirements only for
the recorded Fixture. It does not authorize portable credentials or start any
later phase.

### Verified Delivery Outcome Policy V1 Gate Result

The owner-authorized **VERIFIED DELIVERY OUTCOME POLICY V1 DESIGN AND EVIDENCE
GATE** passed on 2026-09-05 at a local deterministic policy/schema boundary.
The prospective Model C design records Agent execution, independent work
verification, and Contract delivery as separate outcomes. A hash-covered
`VERIFIED_WORK_CONTRACT_V2` selects either
`EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED` or
`INDEPENDENT_ACCEPTANCE_SUFFICIENT` before execution.

The decision remains fail-closed for missing deliverables, failed or
inconclusive acceptance, invalid Authority, incomplete Evidence, Source or
provenance failure, invalid lifecycle, failed cleanup, and forbidden external
effects. Future candidate eligibility derives from `VERIFIED_DELIVERY`, not
candidate-workflow membership. Historical V1 Contracts and Phase B Attempt 3
retain their original meaning and hashes.

Exact deterministic evidence and limitations are recorded in
`../VERIFIED_DELIVERY_OUTCOME_POLICY_V1_REPORT.md`. This Gate did not run a
model, create a Sandbox, start Reputation, or authorize a new live corpus
Attempt.

## NEXT - Phase 2: Task-Scoped Agent Authority

**Status: BOUNDED V1 DESIGN AND EVIDENCE GATE COMPLETE; OWNER ACCEPTED**

Permission answers:

> What may this Agent do for this job?

Treat authority as an Agent access card for one Work Contract. Extend, do not
replace, the existing Permission Lease, actor authorization, managed-Sandbox
policy, Human approval, and policy-violation evidence.

The unified Permission Engine should express and enforce:

- Repository read and branch write
- default/main branch restrictions
- Pull Request create, update, and merge as separate actions
- file and path access
- tools and approved APIs
- database read/write and data boundaries
- preview versus production deployment
- external services and secrets
- spending limits
- time limits, expiry, revocation, and renewal
- Human approval requirements

Agents must not receive permanent broad credentials, unrelated Repository/data
access, unrestricted production authority, or the ability to modify or approve
their own limits. Credentials stay server-side or in a purpose-built broker;
workloads receive minimum scoped, short-lived authority.

HOL Guard and competing permission products validate overlap, not abandonment.
DoneLayer should not clone them feature-for-feature. Its authority model should
be differentiated by direct binding to the Work Contract, execution Evidence,
verification outcome, and Receipt.

**Exit Evidence:** versioned policy schema, decision API, enforcement-point
inventory, Human approval UX, temporary credential boundary, deny/expiry/
revocation/escape tests, and one bounded real action whose authorization and
result are independently evidenced.

### Task-Scoped Agent Authority V1 Gate Result

The owner-authorized **TASK-SCOPED AGENT AUTHORITY V1 DESIGN AND EVIDENCE
GATE** passed on 2026-09-03 at one exact-Fixture boundary. It extends the
existing Permission Lease and guard rather than creating a parallel system.

The result binds one finite authority version to an exact Work Contract,
issuer, Agent/executor/Job, Repository/ref/Commit, delivery namespace, file
boundary, actions, Sandbox boundary, and approval policy. It proves deterministic
deny behavior for Contract/resource/identity mismatch, missing authority,
scope mutation/widening, expiry/revocation, unapproved action, PR merge, and
production deployment. One real read-only Fixture identity action was performed
under the Lease, independently recorded, followed by revocation and a bound
Receipt.

The narrow Gate does not claim production Human approval UX, temporary
credential minting, generalized persistence, arbitrary repositories, or
organization/data/external-service policy. Exact scope and evidence are in
`CURRENT_PHASE.md` and `../TASK_SCOPED_AGENT_AUTHORITY_V1_REPORT.md`. No later
phase is authorized by this result.

## NOW - Phase 3: Agent Identity And Interoperability

**Status: PRODUCTION PERSISTENCE V1 LOCAL CONTRACT OWNER ACCEPTED; PREREQUISITE LIVE; REMAINING MIGRATIONS REQUIRE DIRECT APPROVAL**

Build a durable platform identity/profile layer that can describe:

- Agent identifier
- owner and organization
- model or runtime
- declared and verified capabilities
- connected tools
- active task-scoped authority
- previous Verified Work
- restrictions and status
- linked external identities

Do not invent another isolated universal identity standard without compelling
evidence. Keep an authoritative internal identity and add replaceable,
versioned compatibility adapters where useful.

Potential ecosystems include:

- ERC-8004 identity, reputation, and validation compatibility
- HOL / UAID import, linking, or resolution
- future Agent identity standards
- platform-native internal identity

Competition and compatibility are allowed at the same time. If an external
standard changes or disappears, internal Identity, Work Contracts, Evidence,
Receipts, and verification must continue to operate. No raw Evidence or private
Source is published, and no token or chain is required.

### Agent Identity And Interoperability V1 Gate Result

The owner-authorized **AGENT IDENTITY AND INTEROPERABILITY V1 DESIGN AND
EVIDENCE GATE** passed on 2026-09-03 as a local deterministic identity Gate.
It retains the existing Marketplace Agent identifier as the platform identity
concept while adding an opaque V1 identifier format, append-only hashed profile
revisions, an explicit platform-account controller relationship, and a separate
per-run execution identity.

An identity-aware Work Contract now locks the exact Agent profile revision and
hash. The same reference and execution identifier are required in the
task-scoped Permission Lease, Agent execution, Evidence Ledger, and Receipt.
Mismatch, unknown identity, disabled status, stale/tampered revision, Receipt
rebinding, and conflicting external linkage fail closed. Historical Receipts
retain the display name, controller relationship, revision, and hashes observed
at execution time rather than following mutable current profile metadata.

ERC-8004 and HOL/UAID are represented only as versioned typed references with
explicit `DECLARED`, `OBSERVED`, or `VERIFIED` linkage levels. The Gate recorded
only `DECLARED` test vectors and did not claim external verification. No chain,
token, external registration, live identity resolution, payment, Sandbox,
Repository mutation, or reputation was used. Exact evidence and limitations are
in `CURRENT_PHASE.md` and `../AGENT_IDENTITY_INTEROPERABILITY_V1_REPORT.md`.

### Durable Productization V1 Result

The 2026-09-08 productization milestone connects the existing identity model to
the current Marketplace SQLite authority with append-only revision tables,
immutable external identity ownership, atomic identity creation for every Agent
path, controller-only APIs, historical reads, and a visible Agent trust profile.
The profile projects active task-scoped Authority and prior work only from
unexpired Leases and valid, non-invalidated delivery Receipts. Demo counters,
invalid Receipts, infrastructure smoke, and metadata-only verification are not
presented as Verified Work or Reputation.

The evidence is restart-verifiable and the external-link API permits only
`DECLARED` claims. Supabase/multi-instance persistence, production identity
assurance, live external verification, complete management UX, and deployment
remain unfinished. Exact evidence and limits are in
`../AGENT_IDENTITY_DURABLE_PRODUCTIZATION_V1_REPORT.md`.

### Production Persistence V1 Local Contract Result

The 2026-09-08 local contract Gate adds a timestamped Supabase/Postgres
migration and mode-aware server adapter for Agent creation and identity
read/revise/link APIs. Postgres owns the atomic command boundary, monotonic
hash/predecessor checks, stable controller relationship, immutable global
external identity ownership, RLS historical reads, explicit grants, and audit
events. The server recomputes and validates every canonical identity document
and keeps the secret command credential outside browser/Worker code.

The later Owner-authorized Beta Gate 1 created one disposable non-production
project. After preserving the original semantic prerequisite failure, the
Owner-approved Trust Foundation prerequisite, semantic verification, and Agent
Identity migrations all applied and passed catalog readback. The subsequently
approved security hardening also applied and resolved the advisor warning.
Two-account Auth/RLS isolation, service/user authorization, atomic rollback,
bounded competing revisions and identity claims, UPDATE/DELETE immutability,
reconnect reads, and safe cleanup passed. The Owner enabled leaked-password
protection without a billing change; the final advisor and repository Gate also
passed. The milestone is a non-production engineering PASS but remains
`NOT_VERIFIED` for Real Job corpus purposes. Exact local contract evidence is
in `../AGENT_IDENTITY_PRODUCTION_PERSISTENCE_V1_REPORT.md`; final live evidence
is in `../BETA_GATE_1_REAL_SUPABASE_ENVIRONMENT_REPORT.md`.

## NEXT - Phase 4: Evidence-Based Reputation

**Status: GATED BY REAL VERIFIED OUTCOME VOLUME**

Reputation must be derived from real Verified Work, not from self-written Agent
descriptions or an unexplained score such as `Trust Score = 87`.

Prefer explainable records such as:

- 73 tasks attempted
- 68 verified on first submission
- 3 verified after correction
- 2 failed
- 0 unauthorized actions
- 12/12 verified production deployments
- database migration capability not yet verified

Reputation should be evidence-backed, capability-specific, explainable, and
auditable. High trust for frontend work must not imply trust for production
database migration.

Preserve the existing future items:

- Capability Passport
- Contextual Reputation
- Known Failure Modes
- evidence-based matching

Minimum entry conditions remain at least 20 active canonical real Verified
Jobs, more than one task type, and enough samples for each claimed capability.
Seed and Demo results never contribute to formal Reputation. Optional ERC-8004
or HOL publication is an output adapter, not the authoritative reputation
source.

### Gate 4 Corpus Ramp - Owner Decision 2026-09-13

The evidence-volume boundary is now an explicit three-Gate sequence:

```text
GATE 4A
-> apply Real Corpus Eligibility rules
-> complete and externally accept at least 1 genuine Real Verified Job
-> enter it into the active canonical corpus

GATE 4B
-> expand to at least 5 active canonical Jobs
-> cover at least 2 pre-declared task types
-> verify duplicate, failure, revocation, supersession, and contamination defenses

GATE 4C
-> expand to at least 20 active canonical Jobs
-> pass Reputation Readiness Review

ONLY THEN
-> PHASE 4: EVIDENCE-BASED REPUTATION
```

`GATE_4_REAL_CORPUS_RAMP_V1` in `GATE_4_REAL_CORPUS_RAMP.md` is the exact
execution and acceptance contract. These Gates collect and validate the corpus;
they do not implement Reputation. Counts are recomputed from active, unique,
externally accepted entries. Provisional, duplicate, revoked, superseded,
quarantined, failed, Demo, Seed, benchmark, Fixture, Gate-validation, and
corpus-manufactured records contribute zero.

The bounded two-Job corpus-collection pilot on 2026-09-04 did not change these
entry conditions. Its two attempted candidate Jobs are not canonical qualifying
Verified Jobs because their complete per-Job evidence was not persisted. The
strict qualifying corpus therefore remains zero; Reputation remains gated.

Phase B Attempt 5 on 2026-09-06 durably produced one eligible
`VERIFIED_DELIVERY` candidate for `TEST_AND_FIX` and one `INCONCLUSIVE`
`BUILD_RESCUE` Job. Both preserve model-provider failure as the execution
outcome. The Owner decided `DO NOT COUNT`: the live, independently verified
owner-controlled Fixture candidate remains `counted: false`, the strict corpus
remains zero, and Reputation remains gated.

`REAL_JOB_CLASSIFICATION_POLICY_V1` now governs future preliminary decisions.
Benchmark/Fixture and non-verified work is excluded automatically. Clearly real
Owner or external work is only `PROVISIONAL_REAL_JOB` and contributes zero until
accepted in an external audit batch. The queue and separate provisional,
externally accepted, and canonical counts are maintained in
`REAL_JOB_AUDIT_QUEUE.md`. External audit is triggered at five new provisional
Jobs, a major canonical milestone, an apparent threshold crossing, or a
blocking ambiguity. This policy does not relax the 20-Job entry threshold.
The completed local policy/evidence boundary is recorded in
`../REAL_JOB_CLASSIFICATION_POLICY_V1_REPORT.md`; it made no canonical count or
Reputation change.

## LATER - Phase 5: Agent Budget And Payments

**Status: FUTURE / GATED; NO REAL PAYMENT AUTHORIZED**

Agents may eventually pay for services needed to fulfill a Work Contract:

- API calls
- data
- compute
- model inference
- external tools
- verification or specialist Agent services

The Permission Engine must control per-call, per-task, and daily budgets;
approved and denied merchants/services; assets/networks where relevant; expiry;
purpose; and Human approval thresholds. An Agent cannot change its own limits or
make arbitrary transfers.

Preserve the broader payment roadmap:

- existing simulation-only Test Ledger
- Stripe Connect
- x402 compatibility
- wallet or account adapters
- escrow / hold
- refunds, disputes, reconciliation, and Provider payout

x402 is an optional capability, not the product or canonical ledger. DoneLayer
will not build a blockchain or payment network for differentiation. Real payment
requires a separate approved Gate with security, idempotency, reconciliation,
refund, tax/KYC, and operational evidence.

## LATER - Phase 6: Verified Settlement Loop

**Status: FUTURE / GATED**

Connect the trust system into one auditable loop:

```text
Work requested
-> Agent selected
-> Work Contract created
-> temporary authority granted
-> budget granted
-> Agent executes
-> Evidence recorded
-> independent verification runs
-> outcome determined
-> Reputation updated
-> payment/reward released when appropriate
-> authority expires or changes
-> complete auditable Receipt produced
```

Permission, Verification, Reputation, and Payment should reinforce one another.
Settlement must never release solely because an Agent reports success.

## LATER - Phase 7: Multi-Agent / Organizational Trust

**Status: FUTURE / GATED**

- multiple Agents per organization
- Agent teams and cross-Agent handoffs
- delegated authority and Agent-to-Agent delegation
- organization policies and approval hierarchies
- shared budgets
- risk-based permissions
- capability-based Agent selection
- enterprise audit
- portable Verified Work history

This is not part of the immediate implementation scope.

## LATER - Phase 8: Agent Work Market / Trust Network

**Status: LONG-TERM POSSIBILITY, NOT AN IMMEDIATE REQUIREMENT**

A future user may ask for an Agent that supports Next.js, Vercel, and Supabase
and has sufficient verified history. Selection should rely primarily on
verifiable capability-specific outcomes, not self-authored descriptions.

```text
Find Agent
-> inspect Identity
-> inspect Verified Work history
-> issue Work Contract
-> grant Authority
-> execute
-> independently verify
-> settle Payment
-> update Reputation
```

DoneLayer already has a Marketplace foundation, but it must not expand into a
giant unverified Agent directory before real usage and outcome data exist.

## HOL Competitive And Interoperability Strategy

Treat HOL / Hashgraph Online as all three of the following:

1. a real competitor
2. a useful external ecosystem
3. a potential interoperability target

HOL's existence is not proof that the market is fully validated or already won.
It is not a reason to abandon Identity, Reputation, Permission, Verification,
or Agent Payments, and it is not a reason to copy HOL Guard feature-for-feature.

Potential interoperability includes:

- import or link a HOL identity / UAID
- read policy-approved external trust information
- link an external identity to an internal DoneLayer Agent
- export a minimum portable Verified Work proof
- publish DoneLayer verification as an additional trust signal

DoneLayer's strongest initial distinction is:

> We may know who an Agent claims to be, and we can also show what work it has
> actually proven it can complete.

Compete through superior usability, real Agent work, reproducible Evidence, and
complete trust workflows rather than a feature-count checklist.

## Preserved Adapter And Deferred Programs

These previously recorded roadmap items remain preserved and map into the new
phases:

- A2A Signed Agent Card, Agent Registry / ARD Adapter, external Agent endpoint,
  third-party Verifier, and permission-brokered MCP invocation map to Identity,
  Organizational Trust, and the Trust Network.
- GitHub Artifact Attestations, C2PA Content Credentials, Signed Repository
  Receipt, Deployment Provenance, and Real-world Evidence Adapter extend
  Verified Work and portable proof.
- AI Transparency Kit remains **DEFERRED FOR LATE STAGE** until stable traffic,
  real paying Customers, explicit content-business demand, a mature Evidence
  Ledger, and a real C2PA use case exist. Its prior disclosure, Source/licence,
  approval, tool/model history, audit, public Verify, watermark, and deepfake
  adapter scope remains preserved. It must extend, not duplicate, the Evidence
  Ledger and must not reposition DoneLayer as a standalone transparency product.

## Explicit Non-Goals

Unless future product evidence changes a decision explicitly, do not prioritize:

- building a blockchain
- issuing a token
- creating an isolated universal Agent ID protocol from scratch
- creating a giant Agent directory before real usage exists
- creating an opaque reputation score without underlying Work Evidence
- relying solely on one LLM to judge another Agent's work
- cloning HOL Guard feature-for-feature
- locking the platform to one AI Provider
- locking the platform to one blockchain
- locking the platform to one coding Agent
- treating Demo, metadata, or roadmap text as proof of real capability
- turning the Agent Trust Platform into a Robot Deployment feature

Robot Deployment Intelligence, QR-code or mobile surveys, robot selection, and
robot deployment passports belong to a separate product and are excluded from
this roadmap.

## Status Summary

### DONE

Evidence-backed execution and the exact-Fixture GitHub vertical slice, only at
the narrow boundaries proven by existing Gate evidence. The Verified Work
Contract V1 design/evidence Gate is also complete only for its recorded
Fixture, Commits, repair, PR, verifier run, Evidence Bundle, and Receipt.

### NOW

Owner review of whether to authorize a separately scoped corpus Gate using
genuinely new real work. Attempt 5 is closed and not counted. Reputation has not
started and remains unauthorized under `CURRENT_PHASE.md`.

### NEXT

1. Collect additional real Verified Work under separately approved bounded Gates
2. Evidence-based, capability-specific Reputation after enough real outcomes
3. Agent Budget and Payments after the earlier trust layers are proven

### LATER

1. Agent Budget and Payments, including optional x402
2. Verified Settlement Loop
3. Multi-Agent / Organizational Trust
4. Agent Work Market / Trust Network
5. demand-gated external/provenance adapters and the deferred AI Transparency
   Kit

## Completed Reliability Gates

**VERIFIED WORK CONTRACT V1 DESIGN AND EVIDENCE GATE** passed at the narrow
boundary recorded in `../VERIFIED_WORK_CONTRACT_V1_REPORT.md`. The result
distinguishes execution integrity, test conformity, Work Contract conformity,
and delivery integrity; proves deterministic conflict handling and append-only
supersession; and binds complete required Evidence to the verified Receipt.

Portable attestations remain preserved in this roadmap but are not authorized.

**TASK-SCOPED AGENT AUTHORITY V1 DESIGN AND EVIDENCE GATE** also passed at the
narrow boundary recorded in `../TASK_SCOPED_AGENT_AUTHORITY_V1_REPORT.md`. It
binds an extension of the existing Permission Lease to one exact Work Contract
and recipient, proves fail-closed negative outcomes, records one real guarded
read-only action, revokes the Lease, and binds the result to a Receipt.

**AGENT IDENTITY AND INTEROPERABILITY V1 DESIGN AND EVIDENCE GATE** passed at
the local deterministic boundary recorded in
`../AGENT_IDENTITY_INTEROPERABILITY_V1_REPORT.md`. It binds one immutable Agent
ID and profile revision through a Work Contract, Permission Lease, distinct
execution identity, Evidence Ledger, and Receipt; proves append-only mutation
semantics and fail-closed mismatch cases; and implements typed, unverified
ERC-8004 and HOL/UAID adapter references without external infrastructure.

**REAL JOB CLASSIFICATION AND EXTERNAL AUDIT POLICY V1** passed at the local
deterministic boundary recorded in
`../REAL_JOB_CLASSIFICATION_POLICY_V1_REPORT.md`. It automatically excludes
Benchmark/Fixture and non-verified work, queues real-looking work as provisional,
and permits canonical contribution only after external audit acceptance.

## Exact Next Step

Beta Gates 1-3 are complete within their recorded boundaries, and Beta Gate 3
external review is accepted with one non-blocking evidence-depth condition.
Gate 4A is now Owner authorized, and its corpus eligibility rules have a local
deterministic projection and integrity checker. Next select one genuinely
necessary work item whose need exists independently of the Reputation
threshold. Bind its requirement source, rationale, task type, acceptance
criteria, Source, authority, and delivery policy before execution. Current
active canonical count is zero and the Gate 4C gap is 20.

Do not start Reputation before Gate 4C and its Readiness Review pass. Do not
merge either Fixture PR, deploy, enable real payment, begin portable attestation
work, or start Reputation, Settlement, organizational trust, or market work
without their separately authorized Gates. Do not rerun either Attempt 5 Job.
