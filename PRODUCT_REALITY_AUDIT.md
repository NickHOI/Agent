# DoneLayer Product Reality Audit

## Gate 4A-P Canonical Orchestration update (2026-09-14)

**GATE 4A-P passes as a local infrastructure prerequisite only.** The product
execute route no longer directly selects the Beta Gate 3 orchestrator. It uses
a closed server registry, while the Beta executor persists through new
canonical service-only prepare/finalize/fail commands. Preparation locks the
Work row and atomically binds the locked Contract, approved Authority, exact
Source, workflow source, Assignment, Job, and both Leases into an append-only
execution envelope.

| Capability | Current classification | Objective evidence | Boundary still in force |
| --- | --- | --- | --- |
| Workflow dispatch | **REAL in code/local tests** | Closed registry contains only Beta Gate 3 and Gate 4A; arbitrary workflow rejected | Gate 4A executor remains precheck-only |
| Canonical preparation | **LOCAL CONTRACT PASS** | Owner/hash/lineage/source/file/action/network/limit negatives; concurrency and stale-retry tests | Migration not yet applied to non-production Postgres |
| Immutable envelope | **LOCAL CONTRACT PASS** | Append-only table/triggers, canonical text/hash check, Contract/Authority/Source/Job/Lease bindings | No live row exists; 0 Jobs created |
| Finalization | **LOCAL CONTRACT PASS** | Independent-verifier failure, lineage mismatch, incomplete Evidence, cleanup, and policy-violation rejection | No Gate 4A execution or Receipt occurred |
| Failure | **LOCAL CONTRACT PASS** | Idempotent replay, preserved reason, append-only audit, Lease closure, success-protection tests | No live failure row was created |
| Migration | **LOCAL POSTGRES/CONTRACT PASS; LIVE UNAPPLIED** | Complete ten-migration clean application; transactional prepare/replay/verifier-failure/fail/rollback probe; SQL security contracts | Supabase CLI stopped at missing access token before link/apply |
| Gate 3 compatibility | **PRESERVED** | Historical migration SHA unchanged; classification locked at `NOT_VERIFIED / BETA_GATE_VALIDATION / 0 / 0` | Historical rows were not mutated |
| Gate 4A candidate | **UNCHANGED DRAFT** | Three approved feature files remain byte-identical | Contract unlocked; feature absent; new source binding awaits Owner review |

This prerequisite made zero model requests, Sandboxes, Jobs, Receipts, corpus
entries, or Reputation calculations. It is `INFRASTRUCTURE_VALIDATION`, never a
Real Job, and contributes zero.

## Task-Scoped Agent Authority V1 Gate update (2026-09-03)

**TASK-SCOPED AGENT AUTHORITY V1 DESIGN AND EVIDENCE GATE passed at one narrow
Fixture boundary.** The existing Permission Lease now has a server-side V1
extension binding it to one Work Contract, issuer, recipient, Repository/ref/
Commit, delivery namespace, file boundary, actions, Sandbox policy, approval
requirements, finite validity, and immutable authority hash.

The guarded Work Contract path fails before source materialization when
authority is missing and checks authority before repair Sandbox, source patch,
delivery branch, PR creation, and independent-verifier Sandbox operations. The
live Gate made only one read-only exact-Fixture GitHub identity check, recorded
one allowed and seven denied operations, revoked the Lease, and issued a valid
authority Receipt. It made no model/Sandbox call or Repository mutation.

| Capability | Current classification | Objective evidence | Boundary still in force |
| --- | --- | --- | --- |
| Authority schema/decision | **REAL for exact V1** | Canonical decision and authority hashes; exact Contract/issuer/recipient/resources | Server module, not general product persistence/API |
| Repository/ref/Commit scope | **REAL for captured action** | Guarded GitHub readback returned the exact Fixture branch and Commit | One owner-controlled public Fixture only |
| Action/file/delivery scope | **REAL in focused enforcement tests** | Wrong action/file/branch namespace and scope widening fail closed | No arbitrary task/repository policy |
| Sandbox scope | **REAL in code/local tests** | Pre-create check, exact Provider/backend, deny-all/non-persistent policy, cumulative count | No new live Sandbox was necessary for this Gate |
| Approval/merge/deploy | **REAL policy decisions** | PR create requires prior approval; merge and deployment denied | No production Human approval UX/signature or external API interception |
| Lifecycle | **REAL for captured Lease** | Five-minute validity; explicit revocation; post-revocation use denied | No renewal or distributed authority service |
| Evidence/Receipt | **REAL for captured Gate** | 13-entry pre-Receipt chain, 14-entry full Ledger, recomputed Receipt/authority hashes | Local JSON evidence; no public deployment/external timestamp |
| Credentials/payment | **NOT CLAIMED** | Owner credential stayed server-side; no credential minted; no payment attempted | No task credential broker, real payment, or settlement |

Production Identity, Reputation, Payment, Settlement, organizational policy,
arbitrary GitHub grants, and Robot Deployment Intelligence were not started.

## Verified Work Contract V1 Gate update (2026-09-03)

This update supersedes the earlier semantic-Gate `CURRENT` classification only
for the exact Fixture evidence recorded in
`VERIFIED_WORK_CONTRACT_V1_REPORT.md`.

**VERIFIED WORK CONTRACT V1 DESIGN AND EVIDENCE GATE passed at a narrow
boundary.** The versioned Work Contract locks owner-authoritative criteria,
Source, permission policy, Evidence requirements, deterministic verifier, and
outcome policy under a whole-document hash. Its Evidence Bundle projects nine
required categories to satisfied/missing state and binds the Contract, Source,
permission, Agent repair, patch, delivery diff, and independent verifier into
the final Receipt.

The live path detected the historical `SPEC_TEST_CONFLICT` before any Agent
call, preserved the historical Receipt while appending `SUPERSEDED`, repaired a
separate true source bug, created real open/unmerged GitHub PR #2, and passed
fresh non-AI verification with 4/4 repository tests and 4/4 locked assertions.
Both Vercel Sandboxes stopped without persistence or Snapshots. The Test Ledger
released simulated funds only; no real payment occurred.

The model completed all eight bounded repair tool calls, but its follow-up
request failed. The Agent run therefore remains `FAILED`; only DoneLayer's
separate repair and delivery evaluations are `VERIFIED`. Unavailable token and
exact cost values remain null rather than estimated.

| Capability | Current classification | Objective evidence | Boundary still in force |
| --- | --- | --- | --- |
| Work Contract authority/schema | **REAL for exact Fixture V1** | Version, lock, owner assertion authority, Source/policy/evidence/outcome fields, whole-contract SHA-256 | One function-example schema; no general authoring or production store |
| Acceptance conflict | **REAL deterministic review** | Historical `add(2,2)` conflict detected with 0 Agent calls/repair attempts/payout | Fixture-specific structured arithmetic assertions |
| Evidence Bundle projection | **REAL for captured Receipt** | All 9 required categories satisfied; bundle hash recomputes and is public Receipt Artifact hash | Local JSON/SQLite; no external timestamp or portable credential |
| Completion semantics | **REAL for captured states** | Agent-reported and independently verified fields are distinct; review-only evidence cannot claim delivery | Not generalized to all task types |
| Independent verification | **REAL for exact Delivery Commit** | Fresh non-AI Sandbox passed install, 4 tests, 4 assertions, integrity, anti-tamper, cleanup | Build `NOT_PRESENT`; one Provider/Fixture |
| GitHub delivery | **REAL open/unmerged PR #2** | Exact parent/head, source-only diff, GitHub readback, open state | Owner development auth; no GitHub App grants, merge, or deployment |
| Receipt/supersession | **REAL for captured Gate** | 34-entry pre-Receipt chain, 35-entry full delivery Ledger; historical semantic status append-only `SUPERSEDED` | Local Receipt service; no third-party trust anchor |
| Payment | **SIMULATION ONLY** | Test Ledger `$10` charge, `$8/$2` split after verification/cleanup | No real funds, escrow, Stripe, x402, or settlement |

The initial live attempt failed closed on a source-branch boundary, used zero
Agent calls, and authorized no payout. Its evidence and manually verified
Sandbox cleanup remain preserved. The fixed runner permits only an exact
explicit approved Fixture branch in addition to the prior fixed boundaries;
arbitrary branches still fail closed.

Phase 2 Task-Scoped Agent Authority, portable attestations, Identity,
Reputation, real Payments, Settlement, organizational trust, the market, and
Robot Deployment Intelligence were not started.

## GitHub Delivery and Independent Verification Gate V1 update (2026-09-01)

This update supersedes prior `PAUSED` branch/Commit/PR and independent
verification classifications only for the exact owner-controlled Fixture,
Base Commit `600f326ce373160eb5495aaef72230d4c9807e8f`, persisted repair patch
`6e8679bbef6dbbba31f84ffb20b209df4d3fadfee81e58383e9926a70855c996`,
and captured delivery/verifier runs.

**GITHUB PATCH DELIVERY AND INDEPENDENT VERIFICATION GATE V1 is complete at
that narrow boundary.** Real branch `donelayer/repair/ed564b18-8fa2`, Commit
`466be67975a953a1ae3b5cfc41e80d42ee057164`, and GitHub PR #1 exist. GitHub
readback confirms the exact Base parent, head Commit, changed file, diff, open
state, and unmerged status. Authentication was
`OWNER_DEVELOPMENT_GITHUB_AUTH`, not a production GitHub App.

A separate `NON_AI_DETERMINISTIC_VERIFIER` re-materialized the exact pushed
Commit from GitHub into a fresh Vercel Sandbox. `npm ci` exited `0`, build was
truthfully `NOT_PRESENT`, and `npm test` exited `0` with 2/2 tests passed. Tests,
the test script, and test configuration match the Base Commit. The Sandbox
received no platform or model credential, stopped without persistence or a
Snapshot, and passed Source-integrity and cleanup checks. The Gate made zero
AI/model calls and used `$0` AI Gateway credit.

| Capability | Current classification | Objective evidence | Boundary still in force |
| --- | --- | --- | --- |
| Exact patch delivery | **REAL for one recorded patch** | Required persisted patch SHA; exact Base Commit; only `src/add.ts`; local/Remote/PR diff semantic equivalence | No general patch generation or arbitrary Repository scope |
| Branch and Commit | **REAL for captured Fixture delivery** | Dedicated Remote branch; Commit parent equals Base; author/committer and changed file read back from GitHub | No direct `main`, force push, tag change, or branch deletion |
| Pull Request | **REAL open/unmerged PR** | GitHub PR #1 base `main`, exact head branch/Commit, state `OPEN`, merged `false` | No merge, deployment, review automation, or general PR service |
| Delivery authentication | **REAL owner development boundary** | Authenticated `NickHOI` GitHub CLI credential used only server-side; redaction and Sandbox credential probe passed | Not `PRODUCTION_GITHUB_APP`; no Customer installation grants |
| Independent Remote materialization | **REAL for exact Delivery Commit** | Remote, independently resolved, materialized, and Sandbox Source Commit all `466be679...`; Manifest/package hashes match | One public Fixture; custom bounded Source Package |
| Clean verification | **REAL passing result** | Fresh Sandbox install `0`, build `NOT_PRESENT`, test `0`, 2/2 passed, post-test 6-file Source integrity | Does not prove a build for this build-less Fixture or general workload support |
| Anti-cheating | **REAL for exact Fixture comparison** | Exact tests Manifest, package test script, and `tsconfig.json` hash unchanged; no forbidden test markers | Rules are Fixture-specific, not a universal semantic test-tamper detector |
| Model isolation | **REAL no-model Gate** | `aiCalls: 0`, Gateway usage `$0`, no model import/call path, empty credential-name probe | Original Repair used the separately recorded model and retains its postflight warnings |
| Evidence / Receipt | **REAL for captured Gate** | 20 Artifact bytes/hash/size checks; valid 39-entry Receipt chain and 40-entry full Ledger; `VERIFIED_DELIVERY` / `VALID` public Receipt | Local SQLite/blob storage and localhost Receipt; no external timestamp or public deployment |
| Test Ledger | **REAL simulated release decision** | `RESERVED -> RELEASED` only after verification and cleanup; simulated `$8/$2` split | No real funds, Stripe, escrow, settlement, or payout |
| Lifecycle cleanup | **REAL at Provider-observable boundary** | Verification Sandbox stopped, non-persistent, no Snapshot; delivery workspace removed | No physical-erasure certification |

The first live attempt created the same final branch, Commit, and PR, then
stopped before Sandbox creation because an offline check compared the exact
persisted-patch output (with final newline) to the earlier model replacement
(without final newline). It produced a valid `PATCH_MISMATCH` partial Receipt,
made zero model calls, and released no simulated funds. The verifier was fixed
to derive expected content by applying the persisted patch, covered by a
regression test, and resumed idempotently without a duplicate push or PR.

Exact evidence is in `GITHUB_DELIVERY_INDEPENDENT_VERIFY_REPORT.md`,
`test-results/github-delivery-independent-verify-evidence.json`,
`test-results/github-delivery-independent-verify.sqlite`,
`test-results/github-delivery.json`, and `test-results/delivery-diff.patch`.
The PR remains open and unmerged. Work stops for owner review; general GitHub
App delivery, deployment, real payment, and later product phases remain gated.

## Real Build and Test in Managed Sandbox Gate V1 update (2026-08-31)

This update supersedes the prior `PAUSED` repository build/test classification
only for the exact public Fixture
`https://github.com/NickHOI/donelayer-build-rescue-fixture.git`, branch `main`,
freshly resolved Commit `600f326ce373160eb5495aaef72230d4c9807e8f`, and fixed
`NODE_BUILD_TEST_MANAGED_SANDBOX_V1` workflow.

**REAL BUILD AND TEST IN MANAGED SANDBOX GATE V1 is complete at that narrow
boundary.** A real Vercel Sandbox reverified and extracted a bounded Source
Package, ran fixed `npm ci` with install scripts disabled, restored deny-all,
ran the real Fixture test, preserved its intentional failure, reverified all
original Source hashes, stopped without persistence or Snapshot, and produced
a `FAILED` Receipt whose independent integrity result is `VALID`.

The current exact Commit has no build script. Build status is therefore
`NOT_PRESENT`, not `PASSED`; this Gate does not claim a successful build.
Formal test counts are `UNPARSABLE` and remain null. Raw logs and exit code `1`
are preserved without guessed statistics.

| Capability | Current classification | Objective evidence | Boundary still in force |
| --- | --- | --- | --- |
| Exact Remote / Commit | **REAL for one allowlist** | Fresh Materializer clone and separate Remote resolution both returned `600f326ce373160eb5495aaef72230d4c9807e8f` | No general GitHub App grants or Customer-selected repositories |
| Source Package | **REAL for captured Commit** | 6 files, per-file SHA-256, canonical package/manifest hashes, sensitive path and symlink exclusion, Server and Sandbox revalidation | Custom bounded JSON archive for this workflow, not a general artifact service |
| Dependency install | **REAL for captured Job** | `npm ci --ignore-scripts --no-audit --no-fund`, exit `0`, real stdout/stderr hashes | Exact Fixture only; no lifecycle scripts; install network only to `registry.npmjs.org` |
| Build | **REAL absence detection** | `package.json` independently showed no build script; result `NOT_PRESENT`, exit `null`, no command launched | No successful build evidence exists for this Commit |
| Automated test | **REAL failed result** | `npm test`, exit `1`, real intentional assertion `4 !== 5`, raw log Artifact | Counts intentionally remain `UNPARSABLE`; no software-correctness claim |
| Source integrity / no repair | **REAL for captured Job** | 6 original files rehashed; 0 missing, modified or added; Codex repair unused | Does not prove a future repair workflow |
| Network / Permission | **REAL policy transitions for captured Job** | Provider-observed initial deny-all, exact registry-only install window, final deny-all; 0 recorded violations | No external network probe in this workflow and no general egress certification |
| Evidence / Ledger | **REAL for captured Job** | 18 claimed/Server hashes match; strict artifact content cross-bindings; valid 78-entry Ledger | Local SQLite content storage and hash chain; no production object storage/external timestamp |
| Failed Receipt / Public Verify | **REAL for captured local Receipt** | Task `VERIFICATION_FAILED`, Job/Receipt `FAILED`, Receipt integrity `VALID`; signed-out Verify and desktop/mobile checks | Localhost only; no public deployment or third-party attestation |
| Cleanup / usage | **REAL at Provider-observable boundary** | Provider `stopped`, non-persistent, no Snapshot, cleanup verified; CPU/duration/network usage captured | No USD cost supplied and no physical-erasure certification |
| Provider payout | **REAL no-release decision in Test boundary** | No Test Ledger `RELEASE`; payout flag false; Contract budget USD 0 | No real payment integration |
| Codex repair / delivery | **HISTORICAL: PAUSED at this build/test Gate** | No model, Source edit, branch, commit, push, PR or deployment occurred in this Gate | The newer updates above supersede repair and delivery only for the one exact Fixture patch/PR; deployment remains paused |

Exactly one live build/test Sandbox run was made. The Provider workflow and
cleanup completed, but the outer test command initially exited `1` because its
assertion incorrectly required build `PASSED`. The captured Remote truth was no
build script. The assertion was corrected offline to accept `NOT_PRESENT` only
when build is absent; the Provider run was not repeated. Persisted JSON/SQLite
evidence then passed an offline regression test. This was a disclosed harness
expectation error, not a Provider or business-flow error.

Final validation: lint PASS; typecheck PASS; 30 test files / 152 tests PASS,
with 2 real-gate files / 4 tests skipped in the ordinary suite; Web and Worker
production build PASS. Browser Verify passed at 1440x900 and 390x844 with zero
console errors/warnings. Exact evidence is in
`REAL_BUILD_TEST_SANDBOX_REPORT.md`,
`test-results/real-build-test-sandbox-evidence.json`, and
`test-results/real-build-test-sandbox.sqlite`.

The next and only Gate is **CODEX REPAIR IN MANAGED SANDBOX**. It has not
started. Repair, delivery, payments, second Provider, Capability Passport,
Reputation and AI Transparency work remain paused.

## Managed Remote Sandbox Gate V1 update (2026-08-31)

**MANAGED REMOTE SANDBOX GATE V1 is complete** for the fixed
`MANAGED_REMOTE_SANDBOX_SMOKE_V1` and timeout-probe boundary. Vercel Project
`donelayer` was renamed in place and linked with no deployment or Git
connection. Development OIDC and Provider availability passed. A real Vercel
Sandbox ran the platform-owned smoke program under Provider-observed
`deny-all`, returned real logs and proof bytes, passed independent SHA-256 and
Evidence Ledger verification, stopped without a Snapshot, and received a
`VERIFIED` Receipt. A second real Sandbox returned exit `137` after the fixed
`1500 ms` timeout, stopped, verified cleanup, and correctly received no success
Receipt. Exact evidence is in `MANAGED_SANDBOX_REALITY_REPORT.md` and
`test-results/managed-sandbox-reality-evidence.json`.

`LOCAL_SELF_HOSTED_DOCKER`: `DEFERRED_BY_OWNER`; required for default MVP: **No**.
The original Docker failure remains in the unchanged `CONTAINER_RUNNER_BLOCKED.md`.
Ordinary users are no longer required to install Docker, WSL, or Linux VMs.
No local host/Docker fallback, repository code, snapshot, deployment, payment,
or second provider was used. The historical Project-link report remains the
truth for its earlier attempt and is now superseded only by the later manual
link plus this successful Gate. At that milestone, the next gate was REAL BUILD
AND TEST IN MANAGED SANDBOX; that exact-Fixture gate is now recorded in the
newer update above.

| Capability | Current classification | Objective evidence | Boundary |
| --- | --- | --- | --- |
| Vercel Project link / OIDC | **REAL for local development link** | Correct Team/Project IDs, ignored `.vercel`, short-lived OIDC, Provider list call passed | No deployment, Git connection, PAT, production secret store, or account billing certification |
| Managed Provider boundary | **REAL for Vercel Sandbox smoke** | Official `@vercel/sandbox@3.2.1`; fail-closed provider-neutral interface and live Provider metadata | One Provider only; no failover |
| Managed remote execution | **REAL for fixed platform smoke** | Server PID `26068`; Linux Node24 remote proof; no Customer/Repository code | Does not verify repository build/test or arbitrary workloads |
| Network deny-all | **REAL for captured Sandboxes** | Provider inspection says `deny-all`; fixed external probe failed `ENOTFOUND`; empty domain/CIDR lists | Not a general egress-policy certification for future profiles |
| Artifact / SHA-256 | **REAL for seven managed artifacts** | Real sizes/MIME/Job/Run ownership; proof claimed and Server hashes match | Local SQLite content storage, not production object storage |
| Lifecycle cleanup | **REAL at Provider-observable boundary** | Smoke, timeout, and first attempt all `stopped`, `persistent:false`, no Snapshot | Does not prove physical disk erasure |
| Timeout cleanup | **REAL for fixed probe** | Exit `137` after `1504 ms`; cleanup after Lease expiry; no success Receipt | No general cancellation/scheduler certification |
| Managed Receipt / Public Verify | **REAL for captured smoke** | 22/22 checks, 34-entry Ledger, valid Receipt, signed-out Verify/reload, console errors 0 | Local SQLite/localhost only; no production deployment or third-party attestation |
| Repository build/test/Codex/PR | **HISTORICAL: PAUSED at this smoke Gate** | Not executed by this Gate | The newer update above supersedes build/test only for one exact Fixture; Codex/PR remain paused |

Audit date: 2026-08-02 (Asia/Macau)

Worker Reality Gate update: 2026-08-03 (Asia/Macau)

Repository Reality Gate update: 2026-08-27 (Asia/Macau)

## Real Repository Materialization Gate v1 update

This update supersedes the historical `BROKEN` / `PAUSED` classification only for the exact public fixture `https://github.com/NickHOI/donelayer-build-rescue-fixture.git`, branch `main`, and fixed `REPOSITORY_MATERIALIZE_V1` workflow. Exact identifiers, hashes and raw evidence are in `REPOSITORY_REALITY_REPORT.md` and `test-results/repository-reality-evidence.json`.

| Capability | Current classification | Objective evidence | Boundary |
| --- | --- | --- | --- |
| Fixture Remote | **REAL** | Public GitHub Repository ID `R_kgDOUFK33A`, real pushed commit and GitHub API tree readback | Single authorized fixture only |
| Repository envelope / ownership | **REAL for fixed allowlist** | Exact HTTPS URL, owner/name/main literals, pre-claim resolution and Permission binding; negative schemes/hosts/credentials/redirects/traversal fail | No general GitHub App grant provider |
| Repository materialization | **REAL for fixed allowlist** | Independent Worker PID `12212` cloned Remote with exit `0`; origin/main/HEAD captured; no local-copy fallback | Application-level policy, not container isolation |
| File Manifest | **REAL for captured Job** | Six real working-tree files, stable relative paths, size and per-file SHA-256; `.git` excluded | Worker performs file reads; no repository code execution |
| Artifact upload | **REAL for three repository artifacts** | Clone Log, Remote Metadata and Manifest bound to Worker/Job/Lease, Server MIME/size/name/bytes/SHA checks and persisted metadata | Local SQLite/base64, not production object storage |
| Independent Remote commit verification | **REAL for fixed Remote** | Server isolated `git ls-remote` returned the same non-hardcoded `600f326...` as Worker HEAD | Same Server process invokes a separate read-only verifier; no third-party attestation |
| Evidence Ledger | **REAL for materialization Job** | 22 contiguous append-only entries, repository event allowlist migration, valid receipt anchor and final chain | Local hash chain, no external timestamp |
| Verified Repository Receipt | **REAL for materialization-only claim** | 16/16 checks passed; Permission complete, cleanup true, no violation, Receipt/Public Verify integrity valid | Does not verify build, tests or software correctness |
| Repository Lease recovery | **REAL for local gate** | A expired and all stale operations returned 409; B received a new Job and Permission v2 and alone completed | Poll-triggered local recovery, not distributed scheduling |
| Public Receipt Verify | **REAL for captured local Receipt** | Signed-out Verify click, reload, 1440/390 layout, privacy scan and console error `0` | Localhost/SQLite only |
| Repository execution / repair / delivery | **HISTORICAL: PAUSED at materialization Gate** | No install, package script, test, build, Codex, branch, commit or PR operation occurred in that Gate | The newer updates supersede install/test, bounded repair, and exact-patch delivery only for one exact Fixture |

Trust Foundation v1 update: 2026-08-26 (Asia/Macau)

## Trust Foundation v1 update

The original Demo audit and Worker Reality Gate remain the historical record. This update classifies only the trust records proven by a new independent `WORKER_SMOKE_V1` process run. Exact IDs and hashes are in `TRUST_FOUNDATION_V1_REPORT.md` and `test-results/worker-reality-evidence.json`.

```text
Server locks Task Contract v1
-> creates a separate Permission Lease
-> real Worker claims and executes WORKER_SMOKE_V1
-> PermissionGuard and Server enforce the fixed scope
-> real hello.txt bytes and SHA-256 are verified
-> append-only Evidence Ledger chain is verified
-> immutable Verified Job Receipt is issued
-> signed-out Public Verify recomputes Receipt and chain integrity
```

| Capability | Current class | Objective evidence | Boundary still in force |
| --- | --- | --- | --- |
| Durable product context | **REAL repository context** | Root `AGENTS.md` plus versioned North Star, Roadmap and Current Phase documents | Documentation is a development constraint, not runtime enforcement |
| Task Contract v1 | **REAL for local `WORKER_SMOKE_V1`** | Version 1 is persisted, canonically hashed, locked, immutable, Job-bound and audit logged; revision and supersession tests pass | No real Customer coding Contract or production store |
| Permission Lease v1 | **REAL for local `WORKER_SMOKE_V1`** | Separate Job authority, versioned scope, expiry/revocation/violation states, Server checks and Worker `PermissionGuard`; recovery reissues v2 | It does not claim control over future Codex tool calls or arbitrary executors |
| Evidence Ledger v1 | **REAL for local `WORKER_SMOKE_V1`** | 11 persisted entries with contiguous sequence and previous-hash links; update/delete/tamper tests fail closed | Local SQLite hash chain, not Blockchain or external timestamping |
| Verified Job Receipt v1 | **REAL for local Worker Infrastructure Verification** | Required checks, Permission state, Artifact hash and chain gate `VERIFIED`; Receipt hash and chain anchor recompute; failure Receipt tested | Not a Customer coding receipt and not production-grade cryptographic identity |
| Public Receipt Verify | **REAL for captured local Receipt** | Signed-out production page, Verify click, reload persistence, desktop/mobile overflow and console checks passed | Local SQLite/localhost only; no C2PA or third-party verifier |
| Permission-violation Receipt | **REAL store/runtime boundary** | Violation blocks authority, marks Lease `VIOLATED`, records `VERIFICATION_FAILED`, and issues `PERMISSION_VIOLATION`, never `VERIFIED` | No claim of exhaustive interception outside the fixed smoke workflow |
| Legacy Demo lifecycle | **DEMO** | Demo controls are now gated to `executor=DEMO` and cannot issue a formal Verified Job Receipt | Synthetic logs, repository output and Test Ledger remain Demo |
| GitHub / repository materialization / Codex / PR / payment / Supabase production / A2A / MCP execution | **PAUSED / UNCHANGED** | Not exercised or upgraded by this milestone | Next work requires explicit approval of Real Repository Materialization |

Validation on 2026-08-26: lint PASS; typecheck PASS; 22 test files / 105 tests PASS; real-process happy-path and Worker A/Worker B recovery integration PASS; Web and Worker production build PASS. Captured Worker and fixture Server stderr were empty. Signed-out Browser Verify, reload, desktop/mobile layout and console inspection passed with zero Browser console errors and no internal ID/path/token exposure.

## Worker Reality Gate update

The 2026-08-02 baseline findings below remain the audit trail for the Demo product. This update supersedes only the Worker protocol findings listed here. Evidence and exact runtime identifiers are in `WORKER_REALITY_REPORT.md` and `test-results/worker-reality-evidence.json`.

```text
Server creates fixed WORKER_SMOKE_V1 task
-> independent Node.js Worker pairs and heartbeats
-> poll / claim / finite Lease
-> Node fs writes real hello.txt
-> Worker computes and uploads real bytes
-> Server recomputes SHA-256
-> Server-side state machine reaches COMPLETED
-> disposable work directory is removed
```

| Capability | Updated class | Verified reality | Boundary still in force |
| --- | --- | --- | --- |
| Pairing code and Worker token | **REAL for local gate** | One-time expiry and hashed token validation/revocation covered; real child process paired | Development credential file and SQLite remain non-production |
| Worker heartbeat / online state | **REAL for local gate** | Real `ONLINE -> BUSY -> ONLINE` HTTP heartbeats persisted | Snapshot is self-reported, not remotely attested |
| Capability detection | **REAL for local gate** | Actual PID, OS, Node/npm, architecture, memory, disk, Git, Docker, Codex, Worker version and max concurrency captured per Job | No production attestation |
| Poll / claim / Lease | **REAL for `WORKER_SMOKE_V1`** | Exact assigned Worker claimed; full envelope parsed before state mutation | Repository/Codex Jobs remain paused |
| Artifact upload | **REAL for `hello.txt`** | Same-origin PUT, Worker/Job/Lease ownership, MIME/size/name, real bytes and independently persisted Server hash verified | Local SQLite/base64 storage is not production object storage |
| Lease recovery | **REAL for smoke attempts** | A expired, B received a new attempt, A's renew/event/artifact/submit all returned 409 | Opportunistic poll-triggered recovery is not a distributed production scheduler |
| Server-side completion | **REAL for fixed smoke** | Only verified B attempt moved the Task through the state machine to `COMPLETED`; no frontend state mutation | Legacy Demo lifecycle remains simulated |
| Repository envelope schema/ownership | **PARTIAL, fail-closed** | Strict discriminated schema, traversal rejection, customer-bound grant tests, pre-claim validation | No GitHub grant provider or repository materialization is connected |
| Repository / GitHub / PR / Codex / payment / Supabase production / A2A / MCP | **UNCHANGED / PAUSED** | Not exercised and not upgraded by this milestone | All corresponding baseline blockers remain |

Validation on 2026-08-03: lint PASS; typecheck PASS; 17 test files / 80 tests PASS; two real-process Worker integration tests PASS; production build PASS. Browser testing was intentionally not rerun because this milestone froze new UI work. Server and Worker stderr were empty in the captured gate runs.

## Audit mandate

This audit treats the current product as a **Demo MVP**. A screen, button, passing unit test, persisted simulated state, or generated evidence is not accepted as proof that an external workflow is real.

Classification used throughout:

- **REAL**: connected to the claimed external system and observed performing the claimed operation.
- **PARTIAL**: a real primitive exists, but the product path still contains a demo, mock, fallback, trust gap, or missing branch.
- **DEMO**: deterministic local simulation suitable only for demonstration.
- **UI_ONLY**: the interface exists without the claimed backend behavior.
- **BROKEN**: the current path was observed failing or cannot complete by construction.
- **DEAD**: code exists but is not reachable from the runtime product path.

## Executive verdict

DoneLayer remains a **Demo MVP**, not a completed production marketplace. It now has two narrow real paths: repository-free `WORKER_SMOKE_V1` and exact-allowlist, no-code-execution `REPOSITORY_MATERIALIZE_V1`.

At the original 2026-08-02 audit, the only complete end-to-end lifecycle was:

```text
Customer browser timer
-> /api/demo/[taskId]/step
-> DemoStore.advanceDemo()
-> simulated Provider acceptance
-> simulated Worker claim and execution
-> generated logs/diff/test/build/screenshot
-> in-process evidence evaluation
-> generated human approval
-> simulated Test Ledger release
-> COMPLETED
```

The complete demo does not wait for the Worker process. A Customer request is allowed to trigger state changes attributed to Provider, Worker, System, and Customer actors. The generated screenshot is text stored as `image/png`; commit SHAs, diff, tests, build results, and PR data are constants or generated structures rather than observations of a real repository.

The Worker Reality Gate no longer emits Demo envelopes for its fixed task: it emits `executor.kind = "worker-smoke"` and `repository.mode = "none"`. The ordinary repository path remains paused, and a real GitHub repository still cannot be materialized, executed, committed, or delivered.

## Original strict completion estimate

| Measure | Honest result |
| --- | ---: |
| Audited capabilities classified `REAL` end to end | **0 / 32 (0%)** |
| Reusable real foundation, weighted conservatively | **about 23%** |
| Demo lifecycle completeness | **about 75%** |
| Real Build Rescue vertical slice completion | **0% end to end** |

This table is retained as the 2026-08-02 baseline and is not a current percentage claim. The 2026-08-03 work establishes only the explicitly scoped Worker Reality Gate; it does not justify recalculating the broader 32-capability marketplace estimate.

## Runtime audit record

### Environment

- Web: Next.js 16.2.12, tested on `127.0.0.1:3100`, plus clean standalone audit instances on ports 3200/3201.
- Worker: Node.js Worker CLI, paired twice through the Provider UI and run with `--once` for controlled evidence.
- Persistence: separate audit SQLite databases under `.data/`.
- Browser: Codex in-app browser, desktop viewport.
- Roles exercised: Customer, Provider, Admin.

### Manual paths exercised

1. Customer sign-in, Dashboard, Tasks, Create Task four-step form, validation, rule-based analysis, task creation, Task Detail tabs, refresh persistence, dispute form, acceptance view.
2. Provider sign-in, Dashboard, Later/Accept offer decisions, Agents, Create Agent validation and persistence, A2A import rejection, Workers, pairing-code generation/copy, Worker setup/status, Jobs, Job Detail logs.
3. Admin sign-in, Dashboard, task rematch, Agent suspension, Worker suspension, audit event list, Disputes list.
4. Agent Hall search, filters, online/verified filters, price slider, sort, empty state, Agent Detail.
5. Full `Run Full Demo`, completion, Evidence display, Proof-of-Done display, Test Ledger release, and refresh persistence.
6. Real Worker pairing, heartbeat, claim, disposable workspace creation, DemoExecutor run, event emission, cleanup, and failure paths.

### Observed runtime results

The table below records the original audit failures. The Worker pairing, heartbeat, smoke claim/artifact path, and Lease recovery rows are superseded by the update table above; repository Jobs remain paused and broken end to end.

| Check | Result | Evidence / finding |
| --- | --- | --- |
| Web starts | PASS | App rendered and role sessions worked. |
| Worker starts | PARTIAL | Worker paired and polled successfully; real task path failed before completion. |
| Customer / Provider / Admin sign-in | PASS as DEMO | Signed role cookie worked. Sidebar identity remained hardcoded as `Nick Demo / Customer` for every role. |
| Page refresh persistence | PASS as DEMO | Created Task, Agent, completed Demo, and Dispute remained in SQLite. |
| Create Task form | PARTIAL | Invalid title/description blocked; invalid budget blocked without a visible budget error. Arbitrary repository text was accepted without GitHub validation. |
| Rule-based Task Analyzer | PASS as local rule engine | Returned deterministic scope/risk/budget guidance; no LLM or repository inspection occurred. |
| Provider Later / Accept | PASS in SQLite | Both actions persisted and wrote events. |
| Worker pairing | PASS locally | One-time code and token exchange worked; generated command hardcodes `http://localhost:3000`. Relative `--config-dir` resolves under `apps/worker`, not repository root. |
| Worker heartbeat | PARTIAL | Real HTTP heartbeat worked. Doctor omitted installed Node.js/npm tools, making a real paired web Worker ineligible for tasks previously matched by fake seed capabilities. |
| Worker claim: seeded demo repository | FAIL after execution | DemoExecutor ran, but artifact upload failed with `Artifact upload host is not allowlisted`; Task/Job remained `RUNNING`. |
| Worker claim: user-entered GitHub URL | FAIL | Claim changed the task to `RUNNING`, then JobEnvelope parsing failed because `https://...` was split as a `demo://owner/name` string, producing an empty repository name. |
| Lease recovery | FAIL | Expired failed attempts were not fenced/requeued; no scheduler exists and cancellation control always returns false. |
| Run Full Demo | PASS as DEMO | Reached `COMPLETED`, showed 6/6 checks and released Test Ledger in about 10 seconds, without the Worker process. |
| Evidence download buttons | FAIL / UI only | Buttons were enabled but had no download behavior; source title says download is disabled in Demo mode. |
| Dispute open / hold | PARTIAL | Status and ledger hold persisted; Payment UI still said `Held in test escrow` after funds moved to the dispute wallet. No resolution action exists. |
| A2A unsafe URL rejection | PASS primitive | `https://127.0.0.1/...` was rejected as private/reserved. Task execution methods remain unsupported. |
| Standalone package | FAIL without manual assembly | HTML served, but JS/CSS returned 404 until `.next/static` was manually copied into an additional monorepo-relative nested path. |

### Logs

Browser console across the exercised pages contained no application `error` or `warn` entries. That does not clear server/Worker failures: the primary Worker failures were rendered only in Job logs and CLI output.

Worker log issues observed:

```text
[EXECUTOR_FAILED] Artifact upload host is not allowlisted
Artifact upload host is not allowlisted

repository.name: Too small: expected string to have >=1 characters
```

Server/build issues observed:

```text
"next start" does not work with "output: standalone" configuration.

Standalone HTML rendered without client behavior because /_next/static assets were absent.

npm run build:
EBUSY: resource busy or locked, rmdir apps/web/.next/standalone/apps/web
```

The final build rerun was blocked by the already-running local Next server locking the shared `.next` output. Worker TypeScript build passed separately.

Baseline commands:

| Command | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS: 13 files, 55 tests |
| `npm run build --workspace @donelayer/worker` | PASS |
| `npm run build` | FAIL during audit because live Next process locked `.next/standalone` |

Those baseline passing tests primarily proved demo invariants and isolated adapters. They did not prove GitHub installation, clone, Codex execution, branch/commit/PR delivery, or independent fresh-checkout verification; later Gate evidence above now proves the narrow exact-Fixture cases it explicitly records.

## Capability classification

The original classification table is retained for audit history. For Worker Pairing, Heartbeat, Job Claim, Evidence Upload, Task completion, and Lease recovery, use the 2026-08-03 Worker Reality Gate table above. Its `REAL` labels are deliberately limited to the fixed repository-free local workflow.

Priority: P0 blocks the Real Build Rescue slice; P1 blocks trustworthy acceptance or operation; P2 is important but can follow the first real slice; P3 is cleanup/polish.

| Capability | Class | Related files | Actual data source | Demo adapter? | Manual test and actual result | Missing | Security risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Authentication | PARTIAL | `apps/web/src/server/auth.ts`, `supabase-auth.ts`, `app/api/auth/demo/route.ts`, `app/sign-in/*`, `app/sign-up/page.tsx` | Signed fixed-role cookie; optional Supabase `getUser()` only | Yes | All three demo roles logged in; role redirects worked; sidebar always showed Nick Demo | Production sign-up/sign-in/callback, profile provisioning, logout UI, role administration, session tests against Supabase | Fixed demo identities; development fallback secret; hardcoded shell identity; demo routes remain present | P1 |
| Customer Dashboard | DEMO | `app/customer/page.tsx`, `components/dashboard/*`, `components/app-shell.tsx` | `DemoStore.getDashboardSnapshot()` and seeded wallets/tasks | Yes | Rendered and refreshed; metrics changed after demo operations | User-scoped production queries, true empty/loading/error states, real repository/payment status | Snapshot is globally scoped; hardcoded identity can mislead operators | P2 |
| Provider Dashboard | DEMO | `app/provider/page.tsx`, `components/provider/task-offer-actions.tsx` | DemoStore, seed Agents/Workers, Test wallet | Yes | Later and Accept persisted | Production store, real liveness, real job dispatch and settlement | Seed Workers appear online without a process; metrics look operational | P1 |
| Admin Dashboard | DEMO | `app/admin/page.tsx`, `components/admin/admin-action-button.tsx` | DemoStore aggregate and local audit rows | Yes | Rematch and suspend persisted | Production admin authorization, queues, recovery, resolution, pagination | Rematch leaves task in `MATCHING`; repeated Suspend has no recovery action | P1 |
| Agent Hall | DEMO | `app/agents/*`, `components/agents/agent-hall-client.tsx`, `seed-data.ts` | Seeded and user-created metadata | Yes | Search/filter/sort/slider/empty state worked | Verified external performance, live availability, trusted reviews | Every Agent, including a new pending Agent, shows the same hardcoded "verified completions" | P2 |
| Create Agent | PARTIAL | `components/provider/create-agent-form.tsx`, `app/api/agents/route.ts`, `DemoStore.createAgent()` | SQLite metadata | Indirectly | Validation and Local Worker Agent creation persisted; Agent stayed Pending/Paused | Endpoint ownership verification, activation workflow, Worker binding, version/update lifecycle | Provider-supplied capability claims are displayed as "provider-verified" without verification | P1 |
| Create Task | PARTIAL | `components/tasks/create-task-wizard.tsx`, `app/api/tasks/route.ts`, shared schemas | SQLite task + Test Ledger reserve | Yes | Four-step form and refresh worked; arbitrary GitHub URL accepted | GitHub App repository selector, installation/repo access validation, immutable base SHA | Arbitrary repository strings later break claim after the lease is acquired | P0 |
| Task Analyzer | PARTIAL | `server/task-analyzers.ts`, `app/api/tasks/analyze/route.ts` | Form input only | Optional Demo analyzer | RuleBased analyzer returned immediately; did not read repository | Repository-aware bounded analysis or clearly scoped rules, provenance, failure handling | Guidance can look repository-aware although no repository was accessed | P2 |
| Matching | PARTIAL | `packages/matching/src/index.ts`, `DemoStore.matchTask()` | Seed/user Agent metadata and Worker rows | Yes | Seeded match worked; real heartbeat removed fake Node/npm tools and caused `No eligible agent` | Trustworthy capability attestation, liveness TTL, executor/repo eligibility, retry scheduler | `matchTask()` refreshes last heartbeat for every Online/Busy row, fabricating liveness | P0 |
| Provider Acceptance | PARTIAL | `app/api/provider/tasks/[taskId]/decision/route.ts`, `DemoStore.providerTaskDecision()` | SQLite assignment/job rows | Yes in full demo | Real Provider Later/Accept APIs worked | Dispatch queue, acceptance expiry, real repository permission disclosure | `Run Full Demo` lets Customer trigger acceptance attributed to Provider | P0 |
| Worker Pairing | PARTIAL | `pair-worker-form.tsx`, pairing routes, `DemoStore.pairWorker()`, Worker CLI/config | Hashed one-time code and hashed Worker token in SQLite; plaintext local credential file | No for protocol; demo store backing | Pair/setup/status worked | OS keychain, production store, revocation UI, correct generated base URL | Credential file is development-only; setup command hardcodes port 3000 | P1 |
| Worker Heartbeat | PARTIAL | Worker `runtime.ts`, `doctor.ts`, heartbeat route, `DemoStore.heartbeat()` | Outbound Worker HTTP plus seeded Worker rows | Yes | Real heartbeat reached server; Doctor underreported Node/npm; seed liveness remained fake | Signed/attested capabilities, proper tool detection, TTL/offline scheduler | Matching mutates heartbeat timestamps; self-asserted capabilities are trusted | P0 |
| Worker Job Claim | PARTIAL | `app/api/worker/jobs/claim/route.ts`, `DemoStore.claimAssignedJob()`, Worker client/runtime | SQLite queue + lease token | Always Demo envelope | Claim and lease worked for demo descriptor; GitHub URL claim failed after Task became Running | Fail-closed envelope construction before claim, real repo/executor selection, lease recovery | Invalid envelope strands task; no absolute deadline; no fencing scheduler | P0 |
| Repository Materialization | BROKEN | Worker `workspace.ts`, claim route | Generated local demo fixture only | Yes | Non-demo repository is explicitly rejected; entered GitHub URL never becomes GitHub mode | Installation-scoped archive/clone, base SHA, safe extraction, size limits, provenance | No trustworthy input workspace exists | P0 |
| Codex Executor | PARTIAL | Worker `executors/codex.ts`, `cli.ts`, `doctor.ts` | Local Codex SDK/CLI preview against a generated demo Git repo | Claim path never selects it | Unit tests exist; no real product job reached Codex in audit | Real materialization, reachable selection, container runner, command attestation, delivery | Docker is only a gate; Codex is not actually run in Docker. Native credential boundary is unverified | P0 |
| Webhook Executor | DEAD | `packages/agent-adapters/src/webhook.ts`, callback route | Adapter memory state and optional callbacks | No demo fallback in class | No product task instantiated `WebhookAgentAdapter`; callbacks only append events | Adapter factory/orchestration, secret ownership, external interoperability, result validation | Shared callback secret and memory replay stores do not support multi-tenant/multi-instance operation | P2 |
| A2A Adapter | PARTIAL | `agent-adapters/src/a2a.ts`, import-card route, Create Agent form | External Agent Card metadata | No | Private-address import was safely rejected | `createTask`, status, cancel, result; protocol/version interoperability | Metadata may be displayed although execution always throws unsupported | P2 |
| MCP Metadata | PARTIAL | Worker `doctor.ts`, Agent form/store, matching package | Environment string and provider-entered names | No execution adapter | Metadata persisted and displayed | Task UI support, verified server/tool discovery, job-scoped credential broker, invocation | Self-asserted metadata; Doctor declares servers with empty tools; no secret isolation path | P2 |
| GitHub App | DEAD | `server/github-app.ts`, GitHub webhook route, docs | Environment config check + verified webhook receipt only | Falls back to Demo Repository | No installation, repository selection, or task update path existed | App installation/callback, repo grants, token service, API client, task binding | Webhook acceptance can look like integration while it only records a receipt | P0 |
| Branch Creation | UI_ONLY | Task permission checkbox, docs, DemoExecutor | Boolean permission only | Yes | No branch command/API found | Trusted branch naming and creation at verified base SHA | No branch provenance or collision policy | P0 |
| Commit | DEMO | DemoStore, DemoExecutor, Codex git-state capture | Constant fake SHAs or uncommitted local state | Yes | Demo displayed commit-like metadata; no real commit path found | Trusted commit creation, author policy, signed metadata, base/head verification | Worker can claim SHAs without platform observation | P0 |
| Pull Request | DEMO | DemoExecutor, submit route, proof evaluator, task form | Fake URL and hardcoded PR number 42, or Worker-supplied URL | Yes | No real PR created | GitHub App PR creation and server-side readback | Any valid URL can become PR evidence; evaluator does not query GitHub | P0 |
| Evidence Upload | PARTIAL | Worker client, artifact init/PUT/finalize routes, DemoStore artifact methods | Scoped token and SQLite base64/content | Direct demo insert bypass exists | Hash/size upload primitives ran until host mismatch; Demo full flow bypassed upload validation | Correct trusted URL construction, object storage, download, retention, provenance | Demo screenshot bypasses PNG magic; structured submit creates trusted-looking artifacts from Worker claims | P0 |
| Proof-of-Done | DEMO | `packages/proof-of-done`, DemoStore `verifyTask()` | Submitted/generated evidence records | Yes | 6/6 checks passed for synthetic evidence | Evidence trust levels, verifier attestations, GitHub readback, real commands | Pure evaluator validates shape/content claims, not whether observations happened | P0 |
| Independent Verification | DEMO | DemoStore `verifyTask()`, proof evaluator | Same process, same job evidence, no fresh checkout | Yes | Verification followed submission but did not run Build/Test | Separate verifier identity, fresh checkout, clean environment, command execution | Executor-controlled claims can satisfy checks; human approval is auto-inserted before Customer review | P0 |
| Task State Machine | PARTIAL | `packages/task-state-machine`, DemoStore transition methods, Supabase SQL functions | In-process validation + SQLite events | Demo orchestrator drives it | Illegal transitions are tested; observed transitions persisted | Production transaction adapter, scheduler, actor/request binding, recovery states | Demo API lets a Customer cause transitions recorded as other actors; SQLite update count is not checked | P1 |
| Test Ledger | DEMO | DemoStore reserve/release/hold, `payment-provider.ts` | SQLite Test wallets/entries | Intentionally simulated | Reserve/release/dispute hold persisted | One authoritative ledger abstraction, provider derived from assignment, resolution | Release hardcodes `provider-alpha`; standalone `TestLedgerProvider` is dead duplicate code | P1 |
| Disputes | PARTIAL | disputes page/API, DemoStore `openDispute()` | SQLite Dispute and Test Ledger rows | Payment is Demo | Open/validation/hold worked and refreshed | Admin resolution, refund/release decision, evidence review, notifications | Funds can remain permanently held; Payment UI reports wrong wallet state | P1 |
| Audit Log | PARTIAL | DemoStore `insertAudit()`, admin page, webhook receipts | SQLite append rows | Yes | Main successful mutations appeared | Failure/auth access logging, correlation IDs, tamper resistance, export/retention | Not immutable against process/database owner; many read/failure events absent | P1 |
| Supabase Runtime | BROKEN | `supabase/*`, `server/supabase-auth.ts`, `auth.ts` | Auth `getUser()` only; all application data still DemoStore | Falls through to DemoStore for data | Not runnable as a complete backend; no store/storage adapter exists | Apply migration, persistence/storage adapter, commands, contract tests, deployment config | Real Supabase identity would operate against mismatched local DemoStore IDs/wallets | P1 after vertical slice, P0 before production |
| SQLite Demo Store | DEMO | `packages/database/src/demo-store.ts`, `schema.ts` | Node `DatabaseSync`, WAL, JSON columns | It is the Demo adapter | Refresh/restart-style persistence works locally | General store boundary, migrations, concurrency/backup/retention | Single Web process only; synchronous; global singleton; local content and secrets | P2 for local slice, replace before production |
| Security Isolation | BROKEN | Worker `runtime.ts`, `workspace.ts`, `executors/codex.ts`, config/client, security docs | Native host process and generated demo workspace | Demo is the only working executor | Demo workspace cleaned; no real untrusted repo was isolated | Disposable container/VM, resource limits, network policy, read-only secrets, attestation | Docker availability is checked but Docker is never used; Codex env includes home/config paths; no verifier isolation | P0 |

## Demo, fallback, and misleading-completion inventory

Repository-wide case-insensitive scan (excluding `node_modules`, `.next`, `test-results`, and lockfile):

| Term | Matches | Interpretation |
| --- | ---: | --- |
| `demo` | 397 in 88 files | Dominant runtime mode, fixtures, UI copy, tests, and documentation |
| `mock` | 0 | No literal match; fake behavior is named Demo instead |
| `fake` | 7 | Mostly tests/docs |
| `sample` | 15 | Demo repositories, landing UI, tests, seed data |
| `stub` | 0 | Skeletons are described without this literal |
| `placeholder` | 12 | Form placeholders only; not runtime simulation |
| `fallback` | 8 | Mostly CLI parameter naming/docs; Codex SDK-to-CLI fallback is real |
| `TODO` / `FIXME` / `hardcoded` | 0 | Absence of marker does not imply completion; several constants are hardcoded without the word |
| `setTimeout` | 11 | Mostly legitimate timeouts/retries; one product timer auto-advances the complete Demo lifecycle |
| `Math.random` | 0 | Security tokens use cryptographic randomness |

High-impact locations that create a "looks complete" result:

| Location | Effect |
| --- | --- |
| `DemoStore.advanceDemo()` | One endpoint advances every actor and lifecycle state |
| `DemoStore.generateDemoEvidence()` | Generates command/test/build/diff/manifest/screenshot evidence |
| `DemoStore.runJobStep()` | Generates execution logs and constant commit SHA |
| `DemoStore.verifyTask()` | Auto-creates Customer approval and evaluates same-process evidence |
| `TaskDetailClient` `window.setTimeout()` | Frontend auto-calls the demo step every 650/900 ms |
| Worker claim route | Hardcodes Demo executor and Demo repository for every job |
| `DemoExecutor` | Returns constant SHAs, tests, build, diff, logs, and fake PR |
| Worker `workspace.ts` | Generates a sample repo and explicitly rejects GitHub mode |
| Agent detail page | Shows hardcoded verified completion history for every Agent |
| App shell | Shows hardcoded Customer identity for Provider/Admin sessions |
| Evidence download button | Looks enabled but has no download implementation |
| Supabase docs/schema | Production-oriented design exists, but runtime application services never use it |

Not all `setTimeout` use is deceptive. Worker leases, network timeouts, retry backoff, and copy feedback are legitimate. The deceptive timer is specifically the Task Detail auto-run loop because it simulates multi-party execution.

## Demo adapter replacement matrix

| Current Demo / incomplete adapter | Current use | Replacement for Real Build Rescue | Acceptance evidence |
| --- | --- | --- | --- |
| Signed Demo Auth | Fixed Customer/Provider/Admin roles | Supabase Auth or another real OIDC flow with server-owned roles | Three real accounts, session rotation, role authorization tests |
| `DemoStore` | All product reads/writes | Minimal `TaskStore` port backed by transactional SQLite for local slice or Supabase for shared deployment; no `advanceDemo()` in real path | Same lifecycle contract tests, no synthetic commands |
| Demo Repository string | Arbitrary text/default `demo://...` | GitHub App installation + repository/branch selector + immutable base SHA | Server readback of installation, repo, permission, SHA |
| DemoTaskAnalyzer | Optional deterministic response | Keep clearly labeled rule engine for scope only, or repository-aware analyzer after materialization | Analyzer provenance and failure state |
| Demo matching liveness | Seed rows and refreshed timestamps | Worker heartbeat TTL plus capability attestation and executor eligibility | Offline expiry and real Worker selection test |
| Demo provider dispatch | `advanceDemo()` attribution | Explicit Provider API plus queue event | Provider actor/session event and accepted assignment |
| DemoExecutor | Synthetic execution | Codex executor inside a disposable, resource-limited container | Captured container identity, real workspace diff, exit status |
| Demo workspace seeding | Generated fixture | Verified GitHub archive/checkout at base SHA | Archive hash, commit SHA, extraction manifest |
| Fake branch/commit/PR | Constants or Worker URL claim | Trusted GitHub delivery service using GitHub App | GitHub API readback of branch, commit, PR head/base |
| Demo evidence insertion | Direct SQLite strings | Immutable object storage with server-computed hashes and provenance | Downloadable artifacts and storage metadata |
| In-process Proof-of-Done | Evaluates executor claims | Independent verifier job on a fresh checkout | Verifier identity, clean checkout SHA, command logs/results |
| Auto human approval | Inserted during verification | Explicit Customer acceptance event after evidence review | Customer session, timestamp, task version |
| Test Ledger | Simulated 80/20 release | Keep for this milestone, but derive Provider from accepted assignment | Balanced entries tied to verified task and actor |
| Webhook adapter library | Unwired | Exclude from this milestone; leave disabled | No product route selects it |
| A2A task skeleton | Discovery only | Exclude from this milestone; keep discovery labeled | No claim of task execution |
| MCP strings | Display/matching metadata | Exclude execution from this milestone unless Codex job requires an explicitly brokered server | Job-scoped credential and invocation audit |

## Historical audit conclusion

The following was the conclusion at the original repository-materialization audit and is retained as history. The newer updates at the top of this document supersede build/test only for the exact Fixture boundary; DoneLayer remains a Demo MVP outside the explicitly proven real paths.

At that time, the next gate was Disposable Container Runner. It was later blocked and superseded by the owner-approved Managed Remote Sandbox architecture. Subsequent separately approved Gates completed bounded repair and one exact-patch branch/Commit/open-PR delivery with simulated payment release. The current boundary and stop point are recorded in the newest audit update above.
