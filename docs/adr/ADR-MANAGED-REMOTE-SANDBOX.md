# ADR: Managed Remote Sandbox as the Default Execution Backend

Date: 2026-08-27

Decision status: ACCEPTED BY PRODUCT OWNER

Implementation status: VERIFIED on 2026-08-31 only for the fixed
`MANAGED_REMOTE_SANDBOX_SMOKE_V1` and timeout-probe boundary. See
`MANAGED_SANDBOX_REALITY_REPORT.md`. Repository execution remains gated.

## Decision

DoneLayer's default execution backend changes from local Provider Docker to a
platform-managed remote sandbox. Ordinary Customers and Providers must not need
Docker, WSL, a Linux VM, or other underlying virtualization on their personal
computers. Untrusted repository code must not run on their local host.

This is a product architecture decision, not evidence of a working provider.
The existing Worker, Trust Foundation, and Repository Materialization evidence
remains valid only within each report's original scope.

## Default Path

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

The Agent, Server-side Orchestrator, Execution Backend, Sandbox Provider, and
Sandbox Instance are distinct roles. A remote sandbox must not be represented
as an ordinary local Worker. Provider credentials belong to the platform and
remain in the Server-side Orchestrator, never in the workload or public evidence.

## Local Self-hosted Path

- Backend: `LOCAL_SELF_HOSTED_DOCKER`
- Status: `DEFERRED_BY_OWNER` (DEFERRED BY PRODUCT OWNER)
- Required for default MVP: **No**
- Advanced Provider Mode and Enterprise Self-hosted Mode only
- Opt-in; no implementation or deletion of that path in this gate

`CONTAINER_RUNNER_BLOCKED.md` is preserved unchanged as historical evidence.
Its Docker installation next step is superseded by this owner decision, not by
a successful local Docker check. No local Docker success is claimed.

## Reasons

- Avoid requiring ordinary users to install Docker, WSL, or Linux.
- Avoid running unfamiliar repositories on an ordinary user's computer.
- Reduce onboarding friction.
- Let the platform enforce a consistent sandbox policy.
- Centralize timeout, network, secrets, logs, artifacts, and cleanup controls.
- Separate Provider Agents from the untrusted-code execution environment.
- Establish repeatable execution and verification standards.

## Trade-offs

- The platform bears remote compute costs.
- Execution depends on an external sandbox provider.
- Provider outages, quotas, pricing, and lock-in require explicit handling.
- A small provider-neutral interface is required without speculative adapters.
- At least one additional provider will eventually be needed for failover, but
  failover is not implemented or claimed by this gate.

## First Provider

Vercel Sandbox, through the current official `@vercel/sandbox` SDK. Read current
official documentation and installed TypeScript definitions before integration.
Use development OIDC where supported; do not request a permanent personal access
token without separate owner approval.

## Gate Boundary

Only platform-controlled smoke and timeout programs may run. Require deny-all
network policy, no secret injection, no repository or home upload, non-persistent
lifecycle, no snapshots, a maximum 60-second runtime, bounded output/artifacts,
and cleanup in `finally`. Never fall back to local host, Docker, or Demo execution.

Allow at most one normal smoke sandbox and one timeout sandbox, with at most one
extra retry if the first creation fails; total creations must not exceed three.
No plan upgrades, billing changes, credits, paid add-ons, or persistent resources
are authorized. Authentication, project linking, OIDC, availability, or billing
blockers must be reported with only the next required manual action, then stop.

Only real provider execution, logs, artifacts, independently recomputed hashes,
valid ledger, and confirmed lifecycle cleanup can support a VERIFIED receipt.
Stopping a sandbox must not be described as proof of physical disk erasure.

## Future Providers

Recorded only; do not implement in this milestone:

- GitHub-hosted execution adapter
- Other managed microVM providers
- Enterprise private runner
- Advanced self-hosted Docker runner

## Next Gate

Only after owner review of this gate: **REAL BUILD AND TEST IN MANAGED SANDBOX**.
Repository execution, Codex Repair, repair branches/commits/PRs, payments,
reputation, external provider integration, and the AI Transparency Kit remain gated.
