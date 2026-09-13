# Worker Reality Gate Report

驗收日期：2026-08-03（Asia/Macau）
證據時間：下列 runtime timestamp 為 Worker/Server 保存的 UTC ISO-8601。
原始執行證據：`test-results/worker-reality-evidence.json`

## 結論

`WORKER_SMOKE_V1` 已由獨立 Node.js Worker process 經真實 loopback HTTP 完成：Server 建立固定任務、Worker pairing/poll/claim、Lease、heartbeat、Node `fs` 建立 `hello.txt`、真實上載、Server 重算 SHA-256、server-side state machine 完成任務，以及工作目錄清理。Recovery 測試亦證明 Worker A 的過期 Lease 被 fencing，只有 Worker B 的新 attempt 可以完成任務。

這個結論只適用於本機 SQLite-backed Worker Reality Gate。GitHub Repository、Codex、Pull Request、Supabase production、付款、A2A、MCP 與新 UI 均未接入或宣稱完成。

## Happy Path Evidence

| 項目 | 真實記錄 |
| --- | --- |
| Worker PID | `20000` |
| Worker ID | `20000000-0000-4000-8000-000000000002` |
| Task ID | `5c98c654-6d2f-483a-88c5-693979c68ba2` |
| Job ID | `3e01d825-c3a6-474c-bcc9-4a5904431cee` |
| Pairing time | `2026-08-02T19:03:20.504Z` |
| Claim time | `2026-08-02T19:03:20.872Z` |
| Lease ID | `aa18cfa0adcb26c8` |
| Lease expires at | `2026-08-02T19:03:25.872Z` |
| Artifact | `hello.txt`, `text/plain`, 185 bytes |
| Worker claimed SHA-256 | `5a7df8078d4cba6f82354bdc7e54806cb0f9b8e5a3b5b04fe7f825e153af7628` |
| Server recomputed SHA-256 | `5a7df8078d4cba6f82354bdc7e54806cb0f9b8e5a3b5b04fe7f825e153af7628` |
| Final Task State | `COMPLETED` |
| Work directory | `<host-temp>\donelayer-worker-reality-kr2Xei\worker-b\jobs\job-wtJpUx` |
| Work directory cleaned | `true`; exact path returned `ENOENT` and the Worker `jobs` directory was empty |

Heartbeat records persisted by the Server:

| Received at | Status | Active Job |
| --- | --- | --- |
| `2026-08-02T19:03:20.509Z` | `ONLINE` | none |
| `2026-08-02T19:03:20.864Z` | `ONLINE` | none |
| `2026-08-02T19:03:20.882Z` | `BUSY` | `3e01d825-c3a6-474c-bcc9-4a5904431cee` |
| `2026-08-02T19:03:20.935Z` | `ONLINE` | none |
| `2026-08-02T19:03:20.939Z` | `ONLINE` | none |

Claim-time capability evidence was immutable and matched Worker PID `20000`: Windows/x64, Node `v24.16.0`, npm `11.13.0`, Worker `0.1.0`, 16 CPUs, 33,408,675,840 total memory bytes, 15,268,196,352 available memory bytes, 479,760,642,048 free disk bytes, Git present, Docker/Codex/GitHub CLI absent, and runtime-enforced max concurrency `1`.

## Recovery Evidence

Worker A (`PID 3684`, Worker `20000000-0000-4000-8000-000000000001`) claimed Job `c2cae2d4-51b9-4fbd-82f0-0388f11f0360` with Lease `9b29b61bc630665c`, expiring at `2026-08-02T19:03:27.364Z`, then exited. Before expiry Worker B received no Job. At `2026-08-02T19:03:27.902Z` the Server marked attempt 1 `EXPIRED`, recorded `LEASE_EXPIRED`, revoked its lease, returned the Task to `ASSIGNED`, and queued attempt 2.

Worker B (`PID 27328`, Worker `20000000-0000-4000-8000-000000000002`) claimed replacement Job `801c9075-4dec-4279-8601-cbe0e36a2ceb` with Lease `62e85d88bcc06cef`. Attempt 2 records `supersedesJobRunId = c2cae2d4-51b9-4fbd-82f0-0388f11f0360`, uploaded its own `hello.txt` with SHA-256 `b359851d7ab3d2d7e8edde11497b05b5ebf558bf30f62f8ae7211326a72e6224`, reached `SUCCEEDED`, and alone moved the Task to `COMPLETED`.

After B completed, a separate process using Worker A's identity and old Lease attempted renew, event upload, artifact initialization/upload, and submit. All four received HTTP `409` with `Job lease has expired.` Worker A ended `OFFLINE`.

## Four Root Causes

1. **Repository envelope**: the claim route acquired a Lease and changed Task/Job to `RUNNING` before constructing or validating the envelope. It parsed every repository string as `demo://owner/name`, so a GitHub URL produced an invalid name only detected by the Worker. There was no repository ownership grant. The fix uses a strict discriminated schema, raw traversal checks, customer-bound grant validation, a repository-free smoke descriptor, and full envelope preflight before claim mutation.
2. **Artifact upload**: the Server derived an absolute upload URL from inbound `request.url`, while the Worker trusted its configured API origin; proxy/host/port differences caused the observed allowlist rejection. PUT also validated only an upload token, not the current Worker Lease, and the persisted digest was the Worker-declared value. The fix uses a relative same-origin URL, exact-origin/path validation, bearer Worker identity plus Lease on PUT, bounded streaming, MIME/size/ownership checks, and a separately persisted Server digest recomputed again at finalize/submit.
3. **Capability detection**: Node was displayed but omitted from installed tools, npm was not probed, `totalmem()` was presented instead of available memory, Docker daemon reachability was conflated with binary presence, and pair/heartbeat routes discarded most fields. The fix performs real probes, reports process/version/OS/architecture/memory/disk/tool data, persists every snapshot/heartbeat, and copies an immutable snapshot into each Job's evidence.
4. **Lease recovery**: expired rows remained `RUNNING`; capacity reconciliation merely stopped counting them and no scheduler requeued work. The fix fences the expired attempt, expires pending uploads, preserves attempt lineage, transitions `RUNNING -> ASSIGNED` through the state machine, creates a fresh assignment/Job/Lease for an eligible different Worker, and rejects every stale endpoint.

Regression tests cover the original failures rather than adapting expectations to the broken behavior. The repository traversal test was observed failing because `URL` normalized raw `..`; the raw descriptor validation fix changed it to passing.

## Main Files Changed

- Worker protocol and executor: `packages/worker-protocol/src/{types,schemas,workflows}.ts`, `apps/worker/src/{doctor,runtime,workspace,cli,client}.ts`, `apps/worker/src/executors/worker-smoke.ts`
- Server/store: `packages/database/src/{schema,types,demo-store}.ts`, `apps/web/src/server/repository-envelope.ts`, Worker pair/heartbeat/claim/artifact/submit routes, and the environment-gated fixed-task route
- Tests: `tests/unit/worker-{protocol,doctor,executors,runtime,client,reality-store}.test.ts`, `tests/unit/repository-envelope.test.ts`, `tests/integration/worker-reality.test.ts`, and its two child-process fixtures

## Validation

| Check | Result |
| --- | --- |
| `npm run lint` | PASS, zero warnings |
| `npm run typecheck` | PASS |
| `npm run test` | PASS, 17 files / 80 tests |
| Real-process smoke + recovery integration | PASS, 2 / 2 |
| `npm run build` | PASS, Next.js production build and Worker TypeScript build |
| Browser console | Not exercised; UI work was intentionally frozen for this gate |
| Server console | No stdout/stderr errors in either captured process run |
| Worker console | No stderr errors; stdout contains only real workflow events through `CLEANUP_FINISHED` |

## Remaining Demo Surface

The local persistence class is still named `DemoStore` and uses SQLite; legacy browser demo routes, DemoExecutor/Codex source files, simulated marketplace lifecycle, Test Ledger, demo authentication, and existing UI remain in the repository. For this gate the Worker CLI registers only `WorkerSmokeExecutor`; the verified path does not call DemoExecutor, Codex, Git, Docker, a repository, shell commands, Supabase, Stripe, A2A, or MCP. No Repository clone, branch, commit, Pull Request, payment, or production deployment was attempted.
