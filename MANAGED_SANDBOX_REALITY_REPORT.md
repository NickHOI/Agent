# Managed Remote Sandbox Reality Report

Gate: `MANAGED REMOTE SANDBOX GATE V1`
Provider: Vercel Sandbox
Result: **PASS within the fixed platform-controlled smoke and timeout boundary**
Evidence date: 2026-08-31 (Asia/Macau)

## Verdict

DoneLayer created a real non-persistent Vercel Sandbox from an independent
Server-side Node.js process, uploaded only the platform-owned
`smoke-runner.mjs`, executed it on Linux, observed a blocked external HTTPS
probe under Provider-enforced `deny-all`, collected real stdout/stderr and a
real `managed-sandbox-proof.json`, recomputed the Artifact SHA-256, verified a
34-entry Evidence Ledger, stopped the Sandbox, and issued a `VERIFIED` Receipt.

A second real Sandbox ran the fixed blocking program. Vercel terminated the
command with exit `137` after `1504 ms`; the Sandbox reached `stopped`, cleanup
was verified, the timeout Ledger remained valid, and no success Receipt was
created. No repository code, Git clone, dependency install, test, build, Codex,
deployment, local host execution, local Docker execution, Snapshot, Git
connection, payment, plan upgrade, billing change, or credit purchase occurred.

Provider lifecycle evidence proves that each Sandbox is stopped,
non-persistent, and has no Snapshot. It does not prove physical disk erasure.

## Verified Flow

```text
Server creates fixed MANAGED_REMOTE_SANDBOX_SMOKE_V1 Task
-> locks Task Contract v1
-> activates Permission Lease
-> creates MANAGED_REMOTE_SANDBOX Job Run
-> Vercel creates a real remote microVM Sandbox
-> Server uploads only smoke-runner.mjs
-> Provider executes the fixed Node.js command
-> deny-all blocks the external probe
-> Provider returns stdout, stderr, exit 0 and proof bytes
-> Server recomputes SHA-256
-> Evidence Ledger verifies
-> Sandbox stops with no Snapshot
-> Server state machine completes the Task
-> VERIFIED public Receipt verifies
```

```text
Server creates fixed MANAGED_SANDBOX_TIMEOUT_PROBE_V1 Task
-> Vercel creates a second non-persistent Sandbox
-> fixed blocking command runs
-> command timeout returns exit 137 after 1504 ms
-> stop is requested in finally
-> Provider state is stopped
-> cleanup is verified after Lease expiry
-> Task reaches VERIFICATION_FAILED by design
-> no success Receipt is created
```

## Required Evidence

| # | Required report item | Actual evidence |
| ---: | --- | --- |
| 1 | Completed work | Real Vercel smoke, Artifact/hash/Ledger/Receipt, real timeout, lifecycle cleanup, public Verify, and fail-closed tests completed. |
| 2 | Architecture decision | Default backend is `MANAGED_REMOTE_SANDBOX`; local self-hosted Docker is optional and deferred. |
| 3 | Main changed files | Listed in **Main Files** below. Existing unrelated and prior-gate changes were preserved. |
| 4 | `@vercel/sandbox` version | `3.2.1`; installed in `apps/web/package.json`, lockfile updated. |
| 5 | Vercel CLI version | `58.1.0`, Node.js `24.16.0`. |
| 6 | Vercel login account | CLI user `nickhoi`; email masked as `n***@gmail.com`; team `nickhoi's projects`. |
| 7 | Linked Project ID | Masked public value `prj_uXQP...apslX`; project name `donelayer`; the original `project-e4lus` was renamed in place, with no second Project created. |
| 8 | Authentication | `VERCEL_OIDC_DEVELOPMENT`; `.env.local` contains the short-lived key and is Git-ignored. No value was logged or exported. |
| 9 | Long-lived Access Token | **No**. No Personal Access Token was requested or created. |
| 10 | Provider availability | `available: true` at `2026-08-31T10:01:59.302Z`; no auth, availability, quota, or billing error. |
| 11 | Real Provider | `VERCEL_SANDBOX`. |
| 12 | Real smoke Sandbox ID | `donelayer-smoke-ec901afc-a3ad-4b29-a93f-694cc8`. |
| 13 | Provider Request ID | Provider SDK did not expose one; persisted as `null`. Provider Sandbox and session identities were captured separately. |
| 14 | Isolation model | `REMOTE_MICROVM`. |
| 15 | Lifecycle mode | `NON_PERSISTENT`. |
| 16 | Runtime | `node24`; proof observed Node.js `v24.14.1` on Linux x64. |
| 17 | Region | `iad1`. |
| 18 | Network policy | Provider inspection and locked policy both report `deny-all`; external request failed with `ENOTFOUND`. |
| 19 | Allowed domains | `0`. |
| 20 | Allowed CIDRs | `0`. |
| 21 | Runtime limit | Smoke Sandbox `60 s`; smoke command `20 s`; timeout Sandbox `10 s`; timeout command `1500 ms`. |
| 22 | Task Contract ID | `51282ab3-2df7-412e-b14a-742596d8fca0`. |
| 23 | Contract version | `1`, status `LOCKED`. |
| 24 | Contract SHA-256 | `b571b5f5bf20eb7f083c4303377f04ac259c3b977c0373d870c01f79d6e474e3`. |
| 25 | Permission Lease ID | `05c20cfb-29dc-49f0-bf12-f2fa2734dc81`; final status `COMPLETED`. |
| 26 | Job Run ID | `146d4f7b-c02c-4682-bb5c-e5a3e0f2858b`; backend `MANAGED_REMOTE_SANDBOX`; final status `SUCCEEDED`. |
| 27 | Smoke command | Fixed `node /vercel/sandbox/smoke-runner.mjs`; no Customer command or shell. |
| 28 | Exit code | `0`; Provider command ID `cmd_2fb012eace4347c18abfe4e93a5b`. |
| 29 | Network probe | `blocked: true`, outcome `blocked`, error `ENOTFOUND`; no credential was sent. |
| 30 | stdout / stderr | stdout: `MANAGED_SANDBOX_SMOKE_FINISHED`, `passed: true`, platform `linux`; stderr contained only the persisted newline placeholder and no Provider error. |
| 31 | Artifact list | Seven real Artifacts listed in **Artifacts** below. |
| 32 | Proof claimed SHA-256 | `2b0c5a5c11fd6cb8f275aa0cf2652bf5cab5ca8d8a63d1810a0bed6f7d08d8a8`. |
| 33 | Server SHA-256 | `2b0c5a5c11fd6cb8f275aa0cf2652bf5cab5ca8d8a63d1810a0bed6f7d08d8a8`; exact match. |
| 34 | Evidence Ledger entries | Smoke `34`; timeout `12`; both contiguous chains are valid. |
| 35 | Evidence chain SHA-256 | Receipt-anchored smoke chain `2c5b758108176ea515a2f98badb70e25d808839147d5eb4a78afd63441eb80fd`. Pre-receipt verification chain is recorded in raw Evidence. |
| 36 | Stop requested | Smoke `2026-08-31T09:55:24.707Z`; timeout `2026-08-31T09:55:35.179Z`. |
| 37 | Stop confirmed | Smoke `2026-08-31T09:55:31.175Z`; timeout Provider status update `2026-08-31T09:55:42.650Z`. |
| 38 | Final Provider state | `stopped` for smoke, timeout, and the failed first-attempt Sandbox. |
| 39 | Cleanup confirmed | **Yes** for smoke and timeout: non-running, non-persistent, no Snapshot. |
| 40 | Persistent Snapshot | **No**; all three Provider list rows show `-` / `null`. |
| 41 | Local host execution | **false**. The Server orchestrated remotely; the workload proof is Linux and contains no Windows mount. |
| 42 | Local Docker execution | **false**. Docker was not invoked and no Docker fallback exists. |
| 43 | Timeout probe | Sandbox `donelayer-smoke-6ceab3a4-94b2-495e-b261-d9ba90`; exit `137` after `1504 ms`; stopped; cleanup verified; Task `VERIFICATION_FAILED`; Receipt absent. |
| 44 | Receipt Public ID | `dlr_iJvTa9QJyUbybtRmE_FqaWtF`. |
| 45 | Receipt SHA-256 | `4476481c98eee362db223ce97d2145554d3c9c080106bc47d9ab67c14cc62c87`. |
| 46 | Receipt result | `VERIFIED`; 22/22 required checks passed; public projection integrity `VALID`. |
| 47 | Public Verify URL | Locally verified at `http://localhost:3100/receipts/dlr_iJvTa9QJyUbybtRmE_FqaWtF`. No deployment was created, so there is intentionally no production URL. |
| 48 | Real Sandbox count | `3` total, the hard cap: one stopped first attempt, one successful smoke, one successful timeout. No further retry occurred. |
| 49 | Paid action / upgrade | **No** billing approval, payment method, plan upgrade, credit purchase, add-on, or observed monetary charge. The list reports about `3.928 s` total Sandbox CPU usage, consumed from the account's available allowance. Account-wide billing is not certified. |
| 50 | Negative tests | PASS; details in **Negative Tests**. |
| 51 | lint | PASS, `eslint . --max-warnings=0`, zero errors/warnings. |
| 52 | typecheck | PASS, strict `tsc --noEmit`. |
| 53 | tests | PASS, 25 files / 125 tests; 3 explicitly network/gate-only tests skipped in the ordinary suite. Real Evidence integration assertion passed separately. |
| 54 | production build | PASS, Next.js 16.2.12 production build plus Worker TypeScript build. |
| 55 | Browser console | `0` errors and `0` warnings after load, Verify click, and reload. |
| 56 | Server stderr | Gate process PID `26068`: empty. Local `next start` emitted the existing standalone-output warning; the page still served successfully. |
| 57 | Provider stderr / error | Successful smoke stderr had no error. First attempt exposed the SDK list-query issue described below; no Provider error remained in the verified flow. |
| 58 | Still Demo / incomplete | General Customer repository execution, build/test, Codex repair, branch/commit/PR, production object storage/database/auth, payments, reputation, external A2A/MCP execution, failover, and production multi-tenancy remain unverified, Demo, gated, or deferred. |
| 59 | Local self-hosted Docker | `DEFERRED_BY_OWNER`; opt-in Advanced Provider / Enterprise Self-hosted only; not required for default MVP. Historical `CONTAINER_RUNNER_BLOCKED.md` remains unchanged. |
| 60 | Only next Gate | `REAL BUILD AND TEST IN MANAGED SANDBOX`, pending explicit owner review and approval. |

## Artifacts

| File | MIME | Bytes | Server SHA-256 |
| --- | --- | ---: | --- |
| `managed-sandbox-provider.json` | `application/json` | 988 | `d943131d8adfe423d7bf3e31545457cee07f9392156e01cdfef3742c04c16238` |
| `managed-sandbox-policy.json` | `application/json` | 711 | `8ccc33fd4cb80abd02cebfa7ff582ea066809fbc72f3645881d673ac89c9a5cb` |
| `managed-sandbox-stdout.log` | `text/plain` | 102 | `6c3a4d725f22a46216db4ef0884218178853241a4e89c5a5217510cc2197e10f` |
| `managed-sandbox-stderr.log` | `text/plain` | 1 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` |
| `managed-sandbox-proof.json` | `application/json` | 757 | `2b0c5a5c11fd6cb8f275aa0cf2652bf5cab5ca8d8a63d1810a0bed6f7d08d8a8` |
| `managed-sandbox-lifecycle.json` | `application/json` | 1135 | `89f5fed01ec919ec1eb4673edfaf5e7321b2ba0345992416958af92fe409460e` |
| `managed-sandbox-cleanup.json` | `application/json` | 304 | `5254e4b7b4923bb4cf5657acd606f104a5498d3bb6629178627b3bc9f4d3b36f` |

Every row is bound to the Job, Platform Managed Execution Node, and Sandbox Run;
the claimed and Server-computed hashes match. Artifact metadata persists in the
Gate SQLite database.

## Real Defects Found

### SDK lifecycle list query

The first real Sandbox executed and stopped, but cleanup read-back failed with:

```text
Invalid request: `namePrefix` is only valid when `sortBy` is `name`
```

Root cause: current `@vercel/sandbox` TypeScript definitions and example permit
`namePrefix`, while the live API also requires `sortBy: "name"`. The adapter now
sets `sortBy: "name"` and `sortOrder: "asc"`; a regression test verifies the
exact call. The first Sandbox
`donelayer-smoke-2e95c5e2-abc9-47d0-8600-a6e80f` is confirmed stopped,
non-persistent, and without a Snapshot.

### Cleanup after Permission expiry

The timeout Lease expired between `stopSandbox()` and `verifyDestroyed()`.
The old guard rejected cleanup after expiry even though the Provider stop had
already succeeded. Root cause: execution authority and mandatory safety-cleanup
authority shared the same time check. The fix keeps create/upload/command/
Artifact operations fenced by the active Lease while permitting only the two
pre-authorized safety actions, `stop_sandbox` and `verify_cleanup`, after expiry.
The existing stopped timeout Sandbox was reconciled read-only; it was not
resumed and no additional Sandbox was created.

## Negative Tests

PASS coverage includes:

- unavailable or authentication-failed Provider returns a blocked error with no local, Docker, child-process, or Demo fallback;
- billing/quota-style create failure is attempted once and cannot issue a Receipt;
- fake Sandbox ID and cross-Job Sandbox handle are rejected;
- non-Vercel Provider, `allow-all`, non-empty domain/CIDR, persistence, Snapshot, excessive runtime, arbitrary command, arbitrary file, repository upload, arbitrary environment, credential-like environment, local host, and local Docker profiles are rejected before create;
- expired Lease cannot create; revoked Lease cannot execute; safety cleanup remains available after expiry;
- successful external network probe, non-zero smoke exit, host exposure, mismatched Artifact hash, unconfirmed cleanup, and invalid Evidence Ledger cannot issue `VERIFIED`;
- public Receipt allowlist hides credential/local-path inputs and contains the exact scope disclaimer;
- real timeout cannot remain running and cannot create a success Receipt.

The focused Managed Sandbox suite passes `10/10`; the persisted real-Evidence
integration assertion also passes.

## Project Link and Deployment Baseline

- Current team: `nickhoi's projects`.
- Current project: `donelayer`, renamed in place from `project-e4lus`.
- `.vercel/project.json` binds the same Project and Team; `.vercel/` is ignored.
- `.env.local` is ignored and only its key name, never value, was inspected.
- Before the Gate: zero Sandboxes, zero production deployments, no Git link.
- After the Gate: three stopped test Sandboxes; still zero production deployments and no Git link.
- No Vercel deployment or Git connection command was executed.

## Main Files

- `.gitignore`
- `package.json`, `package-lock.json`, `apps/web/package.json`
- `packages/worker-protocol/src/managed-sandbox.ts`
- `packages/worker-protocol/src/types.ts`, `packages/worker-protocol/src/index.ts`
- `packages/database/src/schema.ts`, `packages/database/src/types.ts`
- `packages/database/src/demo-store.ts`, `packages/database/src/trust-foundation.ts`
- `apps/web/src/server/managed-sandbox/provider.ts`
- `apps/web/src/server/managed-sandbox/vercel-provider.ts`
- `apps/web/src/server/managed-sandbox/orchestrator.ts`
- `apps/web/src/server/managed-sandbox/smoke-program.ts`
- `apps/web/src/server/public-receipt-view.ts`
- `apps/web/src/components/receipts/public-receipt-client.tsx`
- `apps/web/src/components/task-detail/task-detail-client.tsx`
- `tests/unit/managed-sandbox.test.ts`
- `tests/integration/managed-sandbox-reality.test.ts`
- `tests/integration/managed-sandbox-evidence.test.ts`
- `tests/integration/fixtures/managed-sandbox-reality-server.ts`
- `tests/integration/fixtures/managed-sandbox-reconcile.ts`
- `scripts/run-managed-sandbox-reality-gate.ps1`
- `test-results/managed-sandbox-reality-evidence.json`

## Evidence Locations

- Machine-readable Evidence: `test-results/managed-sandbox-reality-evidence.json`
- Persistent Gate database: `test-results/managed-sandbox-reality.sqlite`
- Historical Project-link blocker: `MANAGED_SANDBOX_AUTH_BLOCKED.md` (preserved; superseded only by the later manual link and this report)
- Historical Docker blocker: `CONTAINER_RUNNER_BLOCKED.md` (unchanged)

Stop here. Do not begin repository code execution, build/test, Codex repair,
branch/commit/PR work, payments, reputation, a second Provider, or the next Gate
until the owner reviews this report.
