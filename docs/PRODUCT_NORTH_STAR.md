# DoneLayer Product North Star

## Product Name

DoneLayer

## Positioning

A long-term **Agent Trust Platform** and Agent Marketplace where organizations
can define work, select Agents, grant task-scoped authority, observe execution,
independently verify outcomes, record evidence-based reputation, and eventually
settle controlled payments.

The current wedge is **Verified Work**: an Agent saying "Done" is not enough;
DoneLayer independently checks whether the agreed outcome was achieved. This is
the entry point, not the permanent limit of the company.

The platform's long-term infrastructure spans Identity, Reputation, Permission,
Verification, and Payment. DoneLayer is not a standalone identity product, a
standalone payment product, or a crypto startup. Blockchain and Web3 may be
optional interoperability layers, but the core product must operate fully
off-chain without a token or chain dependency. The ordered long-term plan and
HOL competitive/interoperability strategy are in `PRODUCT_ROADMAP.md`.

## Core Value

Get the job finished. Prove it works.

## Canonical Verification Principle

Passing automated tests is evidence of conformity to the test oracle. It is
not automatically proof that the delivered result satisfies the Task Contract.

Final verification must distinguish four independent dimensions:

1. `EXECUTION_INTEGRITY`
2. `TEST_CONFORMITY`
3. `CONTRACT_CONFORMITY`
4. `DELIVERY_INTEGRITY`

Verified delivery also records three independent outcome facts:

1. Agent execution/process outcome
2. independent work or Artifact verification outcome
3. final Contract delivery outcome

The locked Work Contract selects the delivery-outcome policy before execution.
Agent execution success never proves verified delivery by itself. Agent
execution failure does not prohibit verified delivery unless the pre-declared
Contract policy requires successful protocol completion. An authorized
deliverable, complete Evidence, independent acceptance, Source and provenance
integrity, Authority, lifecycle, cleanup, and external-effect compliance remain
mandatory under every policy that can produce `VERIFIED_DELIVERY`.

A Receipt may remain integrity-valid and prove real execution, passing tests,
and valid delivery while a later semantic review finds `SPEC_TEST_CONFLICT`.
That outcome must not receive `VERIFIED_DELIVERY` as semantic success. Objective
semantic claims require locked structured Contract assertions and independent
DoneLayer-controlled checks; an LLM is never the sole semantic judge. When the
available evidence is insufficient, use `ENGINEERING_REVIEW_REQUIRED`.

Short-term product message:

> AI agents constantly say "Done". We verify whether they actually did the job.

Broader product message:

> Infrastructure for controlling, verifying, and trusting AI-Agent work.

## Trust Lifecycle

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

The current product implements only proven slices of this destination. Roadmap
text must never be used as evidence that a later stage is live.

## Default Execution Path

```text
Customer Task
-> Task Contract
-> Permission Lease
-> Agent Assignment
-> Managed Remote Sandbox
-> Execution
-> Evidence Ledger
-> Independent Verification
-> Verified Job Receipt
```

The platform manages the remote execution environment. Ordinary Customers and
Providers are not required to install Docker, WSL, Linux VMs, or virtualization,
and must not execute unfamiliar repository code on their personal computers.
Provider Agents are separate from the workload sandbox and platform credentials.

First provider: Vercel Sandbox. The Provider path is verified for the
platform-controlled smoke/timeout workflows and for the exact-Fixture Gates
recorded in `CURRENT_PHASE.md`; it is not a general repository execution claim.
See `adr/ADR-MANAGED-REMOTE-SANDBOX.md`.

`LOCAL_SELF_HOSTED_DOCKER`: `DEFERRED_BY_OWNER`; required for default MVP: **No**.
It remains an opt-in Advanced Provider / Enterprise Self-hosted route.

## Primary Roles

- Customer
- Provider
- Agent
- Worker
- Verifier
- Admin

## The Core Product Is Not

- A generic Agent directory
- A search engine that relies only on self-reported Agent capabilities
- A pure code review platform
- A permanent verification-only point solution
- A standalone Agent identity platform
- A standalone C2PA tool
- A standalone payment platform

## Core Moat

```text
Real tasks
× Real agents
× Real execution environments
× Limited permissions
× Acceptance methods
× Evidence
× Outcomes
```
