# Task-Scoped Agent Authority V1 Design and Evidence Gate

Date: 2026-09-03

## Gate Decision

`PASS`, limited to the exact owner-controlled Fixture, Work Contract, authority
decision, five-minute Permission Lease, one read-only GitHub action, local
negative enforcement tests, and Receipt evidence recorded here.

This Gate does not claim general production authorization infrastructure.

## Authority Model Implemented

`TASK_SCOPED_AUTHORITY_V1` extends the existing Permission Lease envelope. The
Work Contract continues to define what must be achieved; the Permission Lease
defines what the assigned Agent/executor may do while attempting that exact
Contract.

The immutable authority hash binds:

- Work Contract ID, version, and `workContractSha256`
- DoneLayer Server issuer
- exact Agent, executor, and Job Run recipient
- exact Repository, base ref, and base Commit
- `donelayer/repair/` delivery branch namespace
- exact allowed file boundary
- allowed and forbidden actions
- Vercel Sandbox / managed-remote execution boundary
- maximum duration, Sandbox count, commands, output, and Artifact size
- Owner approval requirements for Pull Request creation
- explicit unsupported enforcement areas

The decision API denies Agent self-authorization, Contract scope widening,
removed prohibitions, non-exact Repository/ref/Commit scope, unsafe Sandbox
policy, invalid approval evidence, and excessive time/resource requests.

## Existing Primitives Reused

- `PermissionLeaseEnvelope`, `PermissionScope`, and `PermissionGuard`
- existing Work Contract V1 integrity checks
- existing managed-Sandbox Provider/backend constants and deny-all model
- existing GitHub repository verifier
- existing semantic repair and delivery orchestrators
- existing Evidence Ledger canonical hashing and chain verification
- existing Receipt hashing pattern
- existing server-side credential boundary

No parallel permission database or alternative Work Contract was created.

## Scopes Actually Enforced

- exact Work Contract/Agent/executor/Job binding
- finite active interval and revoked-state denial
- exact Fixture Repository, base ref, and Commit
- delivery branches limited to `donelayer/repair/*`
- source modification limited to `src/add.ts`
- exact allowed/forbidden Work Contract actions
- Vercel Sandbox, managed-remote backend, deny-all/non-persistent policy, and
  cumulative maximum of two Sandboxes
- fixed test authorization
- PR creation as a distinct approval-required action
- PR merge and production deployment as explicit denials
- missing authority before Work Contract source materialization
- authority checks before repair Sandbox creation
- Lease binding in repair/delivery Evidence and final delivery Receipt
- Lease revocation before simulated release eligibility

## Scopes Not Claimed

- arbitrary Customer repositories or general multi-tenant policy
- production GitHub App installation grants or task-specific credential minting
- production Human identity/approval UX or cryptographic approval signatures
- model-provider request/token/cost budget enforcement
- database row/column policy, secrets, or external-service brokers
- PR update/merge or deployment API interception outside the guarded semantic
  flow
- organization delegation, cross-Agent delegation, or universal Provider policy
- real payment or settlement authority

`maxApiBudget` remains zero in this V1 Lease. Model-provider request budgeting
is explicitly unsupported rather than presented as enforced.

## Mandatory Negative Evidence

Focused tests prove denial for:

- wrong Repository
- wrong base branch/ref
- wrong Commit
- unapproved action
- expired and revoked Lease
- wrong Work Contract, Agent, executor, and Job binding
- attempted Repository/action scope widening
- post-issuance scope mutation
- Agent self-authorization
- delivery namespace escape
- disallowed file modification
- PR creation without prior Owner approval
- PR merge despite PR-create capability
- production deployment despite repair capability
- missing authority before source materialization
- cumulative Sandbox-limit overflow

## Bounded Live Evidence

The live Gate ran from approximately `2026-09-03T13:56:31Z` to
`2026-09-03T13:56:33Z`.

- Work Contract ID:
  `task-scoped-authority-5f4b2f11-eb16-412f-810f-9822d9ebb94e`
- Work Contract SHA-256:
  `03c9cea51c13b9d3884bc3dbcf100ab9c5ffa456eacad2140f5b59d4dbb6068f`
- Decision SHA-256:
  `9f72e6484c3763ea6f03a6e6f44e0f634eff2b9553840750023656e8735aad97`
- Permission Lease ID: `31a4344f-b29e-443b-b72e-89693dd67a2c`, version 1
- Authority SHA-256:
  `0ccff3a327101df15b60332b01f8a22ae46d3a456ea3d76d3a870ba855234faf`
- exact Remote/branch/Commit:
  `NickHOI/donelayer-build-rescue-fixture`,
  `fixture/real-source-bug-v1`,
  `5ae6dd136b99c4727e8ac50833a716cfbbf4ae00`
- one allowed real operation: `read_source`
- seven denied Gate probes: wrong Repository, wrong ref, remote-branch deletion,
  PR creation without approval, PR merge, production deployment, and use after
  revocation
- terminal Lease status: `REVOKED`
- Receipt ID: `dlr_RTrvcneT8acOXUMT31RAJQnL`
- Receipt SHA-256:
  `44753b68567b1ec883e3abda2f21ae1e8838775803758d958f30ffd43b423157`
- Ledger: 13 pre-Receipt entries, 14 full entries, valid chain

No Sandbox, model request, branch, Commit, PR, merge, deployment, or payment was
created by this Gate. The credential/path leakage scan passed.

## Evidence Files

- `test-results/task-scoped-authority-v1-evidence.json`, SHA-256
  `b8696781b72503e7c814d1c02f0cfdaf7af27ea1b0aefe6a20a3b3a8e87dbb63`
- `test-results/task-scoped-authority-working-tree-identity.txt`, SHA-256
  `4b2ed168a971ff6f261c43145088371890165a8402bc647839dd770947ea86bc`

## Validation

- focused authority unit/integration checks before the live run: passed
- bounded live Gate: 1 passed
- persisted offline evidence verification: 1 passed
- pre-live ordinary suite: 184 passed, 9 live-gated tests skipped
- final ordinary suite: 185 passed, 8 live-gated tests skipped
- lint: passed
- typecheck: passed
- production Web and Worker build: passed

## Remaining Limitations

The live proof is intentionally read-only and does not repeat the already
completed repair/delivery Gate. Authority enforcement in the semantic repair
and delivery path is covered by code and local tests, not a new live Sandbox or
GitHub mutation. The new authority object is captured in Gate/Receipt Evidence
but is not yet a general product UI or production persistence service. Existing
owner development GitHub authentication remains server-side and is not a
task-specific credential.

## Exact Next Canonical Step

Stop for owner review. If this bounded Gate is separately accepted, the next
canonical roadmap phase is **AGENT IDENTITY AND INTEROPERABILITY V1 DESIGN AND
EVIDENCE GATE**. Do not start it, or any Reputation, Payment, Settlement,
organizational, marketplace, or Robot Deployment Intelligence work, without
separate owner approval.
