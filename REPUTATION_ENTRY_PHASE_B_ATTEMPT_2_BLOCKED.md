# Phase B Attempt 2 Blocked Report

Date: 2026-09-04

## Decision

**PHASE B ATTEMPT 2: FAIL / BLOCKED.**

Stage 0 passed. The first authorized Job then stopped fail-closed at the Agent
provider authentication preflight. The second Job did not start.

This is an infrastructure/authentication failure before Agent execution. It is
not an Agent repair failure, Verified Job failure, candidate Job, Reputation
failure, or capability signal against the Agent.

## Stage 0 Source Preflight

The exact Node/Vitest process class used by the live runner called
`materializeVerifiedSourcePackage` for both approved refs. Both clones exited
`0`, both remote refs independently resolved to the approved commits, both
commits were materialized, and all temporary workspaces were removed.

| Task | Ref | Exact commit | Manifest SHA-256 | Source package SHA-256 |
| --- | --- | --- | --- | --- |
| `TEST_AND_FIX` | `donelayer/repair/reputation-state-transition-v2` | `2839dd96b644e2e435e11c66c37a6fdacd264d6c` | `68d8d3a2024c8674817c13dd8dbd920e837ab069bd3cb90aa66bf9afbd9071a8` | `83506c2455663c01acc0fab6cb5db0cf332b26977ce55e92899cd37952e02514` |
| `BUILD_RESCUE` | `donelayer/repair/reputation-build-config-v2` | `433257234caddbd0ee13d854d23adb78113b1f90` | `c7b0f1e070bb480da7b804d236eea4f3cc45bd14d79749fcb5dfd2f2ecf3539e` | `647a19121d3890580924e0f1b3f46184f44020e68ee457eeb1ae173b5b4f4348` |

Preflight evidence:
`test-results/reputation-entry-phase-b-attempt-2-source-preflight.json`

- Internal evidence SHA-256: `97e117943613f3f5553951dd72421d98594636cde465c3cc1fed0955bef83b7f`
- File SHA-256: `e873f17dba7bebe4faf8d137ceb5cb5527b12933567bcb810b23e51265890b38`
- Remote mutations: `0`
- Workspace cleanup: verified

## Exact Blocker

Job 1 successfully repeated exact Source materialization and issued its locked
V2 Work Contract. Before execution identity, Permission Lease, model request,
or Sandbox creation, the Vercel AI Gateway provider preflight returned:

```text
AI_GATEWAY_AUTH_OR_CATALOG_UNAVAILABLE: AI_GATEWAY_OIDC_EXPIRED_OR_WRONG_PROJECT
```

A credential-safe local claims audit distinguishes the two possibilities:

- token present: yes
- token structure valid: yes
- `project:donelayer:` subject binding: yes
- expiry: `2026-09-04T01:09:53.000Z`
- expired at execution: yes

The exact blocker is therefore an expired development Vercel OIDC token, not a
wrong-project token. No credential value is stored in evidence.

## Attempt 2 Partial State

- Database: `test-results/reputation-entry-phase-b-attempt-2.sqlite`
- Database size: `49,152` bytes
- Database SHA-256: `f5d78d27138ae1c03c14897427858d7116d0bd21047a87d503e40539b1695d5a`
- Working-tree identity: `test-results/reputation-entry-phase-b-attempt-2-working-tree-identity.txt`
- Working-tree identity SHA-256: `c3c48aa3f7193edf5b740808fa6a3a36f2bc37602e2717996acbfc290ee7e35e`
- Durable records: `6`; Job lifecycle entries: `4`
- Lifecycle head: `286a485c9862bd8d7fbd79aa631f05bd5e3bf06856b8c759ed7cbb15a7b6efd1`
- Job ID: `c16a51a2-fbfd-40a2-aeb2-6ea1a64a1cf6`
- New Agent ID: `agt_y0YpqbaLJrNMZ9g2-t5ewPBe`
- Profile revision/hash: `1` / `731076eafcd826a578a83981618e4ec45e1e3184df320e668c21cd9214a01b49`
- Work Contract ID: `reputation-entry-1-c16a51a2-fbfd-40a2-aeb2-6ea1a64a1cf6`
- Work Contract version/hash: `1` / `722e8d645af9c4e097cf1d277e8bc330f70db0d1490bf0bd6e1029a4490cf8be`
- Task definition: `REPUTATION_ENTRY_TEST_AND_FIX` V2 / `99709cca2210ed51e9781fe2516387cf6f36d4b657472bbf444bfe247ba5f4f4`
- Durable failure stage/code: `PROVIDER_PREFLIGHT` / `AI_GATEWAY_AUTH_OR_CATALOG_UNAVAILABLE`

No execution identity, Permission Lease, model request, Sandbox, patch,
verifier, final Evidence Bundle, Evidence Ledger, Receipt, or candidate outcome
exists. Missing evidence was not reconstructed. No final batch evidence JSON
was written.

## Validation And Effects

Before the live attempt, lint, strict typecheck, 29 focused tests, 213 full-suite
tests, Web production build, Worker build, and `git diff --check` passed.

Attempt 2 totals:

- Jobs legitimately attempted: `1`
- Successful candidates: `0`
- Model requests: `0`
- Sandboxes: `0`
- Snapshot, PR, merge, deployment, payment, blockchain, billing, or production credential mutation: `0`
- Final post-two-Job regression: not run because the fail-closed stop rule applied before Job 2

Attempt 1, Attempt 4, and the failed-pilot marker remained byte-identical.
Canonical real Verified Jobs remain `0`; the gap remains `20`.
Evidence-Based Reputation did not start.

## Exact Next Action

The owner must refresh the linked `donelayer` project's development OIDC token
in `.env.local` using `vercel env pull .env.local --environment=development`,
then separately decide whether a new live attempt is authorized. Attempt 2 must
not be overwritten or retried automatically.
