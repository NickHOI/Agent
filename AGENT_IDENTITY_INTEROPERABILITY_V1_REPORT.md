# Agent Identity And Interoperability V1 Design And Evidence Gate

Date: 2026-09-03

## Gate Decision

**PASS**, limited to the versioned internal identity model, identity-aware trust
bindings, typed external identity references, deterministic negative cases, and
offline-recomputable Evidence recorded here.

This Gate performed no live external identity lookup or write. It created no
Sandbox, model call, Repository change, branch, Commit, Pull Request, token,
payment, or deployment. It did not implement Reputation.

## Reused Identity And Trust Primitives

- Existing `AgentRecord.id` semantics remain the platform Agent identifier.
- Existing Provider/platform profiles supply the controller account boundary.
- Work Contract hashing, task-scoped Permission Lease, Evidence Ledger hash
  chain, execution provenance, Receipt hashing, and public Receipt projection
  remain authoritative.
- Worker, Server-side executor, Sandbox instance, model/provider, and Job run
  identities remain distinct from the Agent identity.
- A2A Agent Card import remains discovery metadata, not verified identity.

The previous implementation could connect an `agentId` across assignment, Job,
Lease, and Receipt, but Work Contract assignment, profile revision, controller
assurance, and a first-class execution identity were missing. Mutable display
names and runtime versions could not safely explain historical Receipt meaning.

## Internal Agent Identity V1

`AGENT_IDENTITY_PROFILE_V1` accepts existing opaque UUID Agent keys and emits a
new `agt_`-prefixed opaque format for newly generated V1 identities. It contains:

- immutable opaque `agentId`
- append-only integer profile revision and whole-profile SHA-256
- previous-profile hash for revision history
- mutable display name and minimal declared capabilities
- `ACTIVE`, `DISABLED`, or terminal `REVOKED` status
- explicit platform-account controller relationship
- runtime/provider references
- typed external identity references
- creation and revision timestamps

The Gate Agent is `agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5`. Its controller assurance
means only that DoneLayer records control by platform service account
`done-layer-platform-provider`. `legallyVerified` is explicitly `false`.

## Execution Identity V1

`AGENT_EXECUTION_IDENTITY_V1` is distinct from the Agent profile. It binds one
execution ID and hash to:

- exact Agent ID, profile revision, profile hash, display-name snapshot, and
  controller snapshot
- exact Work Contract ID/version/hash
- exact Permission Lease ID/version/authority hash
- Job run and Server-side executor IDs
- runtime Provider, model reference, and Sandbox Provider metadata
- execution start time

The captured execution is `exe_aFYARMnUCDUum-OWEurk7kpn` with SHA-256
`735a8ed4ba14aa902615b9985c965400e1f1c5fab09b093c9d991a5d6f40659d`.

## Binding Rules

An identity-aware Work Contract locks an `AgentIdentityReference`. The same
reference and execution ID must be present in the Permission Lease subject.
Agent repair validates the Contract, Lease, profile reference, execution, Job,
and executor before Source materialization. Semantic delivery revalidates the
same binding and projects it into Evidence and the private/public Receipt.

Identity does not grant permission. The Permission Lease remains the authority
source. A valid Agent can have no authority, and a declared capability is not a
verified capability or Reputation claim.

## Versioning And Historical Meaning

The Gate recorded three append-only revisions for one Agent ID:

1. execution-bound profile revision 1
2. display-name change in revision 2
3. disabled status in revision 3

Each revision has a new hash and points to its predecessor. The Receipt retains
the revision-1 display name, controller, revision, and hash. Later mutation does
not rewrite the Receipt. A disabled Agent cannot start a new execution, and a
revoked profile is terminal in V1.

## External Identity Adapter Model

External identities are replaceable references with system, namespace,
network, identifier, linkage level, method, Evidence hash, and timestamps.
V1 distinguishes:

- `DECLARED`: supplied by an Agent or controller
- `OBSERVED`: observed from a named runtime/provider source
- `VERIFIED`: requires a defined verification method, Evidence SHA-256, and
  verification timestamp

The Gate includes format-valid **test vectors** for ERC-8004 and HOL/UAID. Both
are `DECLARED`; neither is a real registered or verified external identity.
Duplicate and cross-Agent conflicting links fail explicitly.

ERC-8004 is an interoperability target only. Its current official EIP defines
an on-chain identity registry key using a CAIP-2-style registry namespace plus
an Agent token ID, but is still marked Draft:
<https://eips.ethereum.org/EIPS/eip-8004>.

HOL HCS-14/UAID is also an optional adapter target. The official proposal and
SDK show UAID parsing/resolution and DNS/DID proof directions, but the standard
and package surface continue to evolve:
<https://github.com/hashgraph-online/hcs-improvement-proposals/discussions/135>
and <https://github.com/hashgraph-online/standards-sdk>.

A typed reference is sufficient for this Gate. Live chain registration,
ownership challenge, DNS proof, token creation, and external profile resolution
would add irreversible or unnecessary dependencies without strengthening the
internal binding proof.

## Negative Evidence

All ten expected probes were denied:

1. unknown Agent
2. wrong Agent reusing a Work Contract
3. wrong Agent reusing a Permission Lease
4. execution identity mismatch
5. Receipt rebound to another Agent
6. disabled Agent starting a new execution
7. malformed external identifier
8. conflicting external identity linkage
9. `DECLARED` external identity treated as `VERIFIED`
10. historical profile tampering

## Captured Evidence

- Work Contract SHA-256: `6d4d4ca65971ae843f491ba04af0e28724a45263869692eff1c0fce06a7dcd90`
- Authority SHA-256: `2ab5182781744d20809ae3d4aa49eb248f2612448b82f05099ede4d44d13a0d6`
- Profile revision 1 SHA-256: `7f2088ca743122caa47c387ddcfb39374ac5531f0d03756d8fe21845699f83d7`
- Profile revision 3 SHA-256: `fe52656b31e09b73240428b96df47cc8287fc28259bb2c398ac0acd963c534f9`
- Receipt ID: `dlr_BGLO9nuQFnrnzEcMuH9BzLza`
- Receipt SHA-256: `a5ef2429cd1af52488dfb08e639a28ae6f9f89047440b37600a6de980cb7ff49`
- Full Evidence Ledger: 22 entries, valid
- Evidence file SHA-256: `f09c8dc1764aa0cae82f2e39b60a85103aa45e73ecae4a23fbb96be4c48f555a`
- Working-tree identity SHA-256: `0ab29c2c00f3adf097be325777f96344a074107ee49182d70247a09f621a7fa9`
- DoneLayer HEAD at capture: `50aecde8f5ad91462609daadffc3ac648fd0971d`

Evidence files:

- `test-results/agent-identity-v1-evidence.json`
- `test-results/agent-identity-working-tree-identity.txt`

## Implementation

- `apps/web/src/server/agent-identity/agent-identity.ts`
- `apps/web/src/server/agent-identity/execution-identity.ts`
- `apps/web/src/server/agent-identity/agent-identity-gate.ts`
- `apps/web/src/server/semantic-verification/semantic-contract.ts`
- `apps/web/src/server/task-scoped-authority/task-scoped-authority.ts`
- `apps/web/src/server/agent-execution/agent-repair-orchestrator.ts`
- `apps/web/src/server/semantic-verification/semantic-delivery-orchestrator.ts`
- `apps/web/src/server/public-receipt-view.ts`
- `packages/database/src/types.ts`
- `packages/database/src/schema.ts`
- `tests/unit/agent-identity.test.ts`
- `tests/integration/agent-identity-evidence.test.ts`
- `scripts/run-agent-identity-evidence-gate.ps1`

## Validation

- strict TypeScript check: PASS
- focused Identity, Authority, Work Contract, and Evidence tests: PASS
- persisted Evidence offline recomputation: PASS
- credential-pattern scan: PASS
- repository-wide lint: PASS, zero warnings
- repository-wide tests: PASS, 41 files and 195 tests passed; 6 conditional
  live-Gate files and 8 tests skipped
- production Web and Worker build: PASS
- Playwright browser validation: PASS, 2/2 tests after correcting an existing
  Demo-only guard that rejected the initial `demo://` task before its Demo Job
  record existed; non-Demo repositories and executors remain denied
- `git diff --check`: PASS

## Remaining Limitations

- The V1 registry is an in-process domain implementation, not a connected
  production identity database/API or multi-instance service.
- Existing legacy Work Contracts remain valid without an identity reference;
  only identity-aware Contracts fail closed on the new binding.
- No live ERC-8004, HOL/UAID, A2A, DID, DNS, wallet, key-control, or endpoint
  linkage verification was performed.
- No legal/KYC identity assurance is implemented.
- Runtime/model references are provenance fields, not proof that a Provider's
  marketing identity or declared capabilities are correct.
- No public directory, discovery/ranking, capability verification, portable
  reputation, payment, or Reputation scoring is included.

## Exact Next Step

Stop for owner review. After separate approval, the next canonical phase is
**EVIDENCE-BASED REPUTATION**, but it remains gated by its documented real
Verified Work volume requirements. This Gate does not authorize Reputation.
