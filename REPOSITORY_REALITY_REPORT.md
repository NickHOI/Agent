# DoneLayer Repository Reality Report

Report date: 2026-08-27 (Asia/Macau)

Branch: `feat/real-repository-materialization-v1`

Raw evidence:

- `test-results/repository-reality-evidence.json`
- `test-results/repository-reality.sqlite`

## Result

`REPOSITORY_MATERIALIZE_V1` passed the deliberately narrow Real Repository Materialization Gate:

```text
locked Task Contract
-> separate Permission Lease
-> independent Node.js Worker process
-> real HTTPS clone of the exact public allowlist Remote
-> origin / main / HEAD capture
-> per-file SHA-256 manifest
-> real Artifact upload and Server SHA-256
-> independent Server git ls-remote verification
-> append-only Evidence Ledger
-> workspace cleanup
-> VERIFIED Repository Materialization Receipt
```

No repository code, package script, install, test, build, Codex, branch repair, commit repair, Pull Request, container runner, payment, production Supabase, A2A, ARD, C2PA, Capability Passport, Contextual Reputation or AI Transparency Kit operation was performed.

## 1-9. Fixture Repository

1. **Completed:** created the single authorized public fixture, pushed one real commit, deleted its local preparation directory, and then materialized it only through a fresh Worker clone.
2. **Main files changed:** protocol repository policy/types/schemas/PermissionGuard; Worker materializer/runtime/doctor/workspace/CLI; SQLite schema/store/verifier/Receipt projection; claim/submit/internal APIs; public Receipt view; unit and real-process integration tests; Gate scripts and status documents.
3. **Created by Codex using GitHub CLI:** yes, with `gh repo create NickHOI/donelayer-build-rescue-fixture --public`; no other repository was created.
4. **GitHub account:** `NickHOI`, keyring authentication, HTTPS Git protocol, `repo` scope confirmed by `gh auth status`.
5. **Remote URL / ID:** `https://github.com/NickHOI/donelayer-build-rescue-fixture.git`; GitHub Repository ID `R_kgDOUFK33A`.
6. **Default branch:** `main`.
7. **Fixture commit SHA:** `600f326ce373160eb5495aaef72230d4c9807e8f`.
8. **Push result:** the first host-side attempt exited `1` before network access because the sandbox-owned temp directory triggered Git dubious-ownership protection. No global config was changed. The exact retry used a command-local `safe.directory`; actual Push exit code was `0` at `2026-08-26T17:16:38.3353369Z`. Remote API readback returned the same commit and all six expected blobs.
9. **Preparation directory:** `<host-temp>\donelayer-fixture-prep-20260827`; deleted after Remote verification, `ExistsAfterDelete = false`. The Worker did not reuse it.

The fixture has no dependencies. Its lockfile was written as a valid zero-dependency lockfile, so no `npm install`, `npm ci`, test, build or package script was needed or run.

## 10-17. Real Worker and Trust Records

| Item | Captured value |
| --- | --- |
| 10. Worker PID | `12212` |
| 11. Worker ID | `20000000-0000-4000-8000-000000000002` |
| Pairing time | `2026-08-26T17:47:44.051Z` |
| Task ID | `c9618f58-578a-4e7a-b3ba-65820f97e5e8` |
| 12. Job Run ID | `8287e662-3f56-4cd8-88dd-99843cbcb7f5` |
| Claim / Job start | `2026-08-26T17:47:44.980Z` |
| 13. Execution Lease ID | `83e2d2407e1ba75d` |
| Execution Lease expiry | `2026-08-26T17:47:54.063Z` |
| 14. Permission Lease ID | `26bc1ee8-60e7-401c-8aa8-0dba97585d39` |
| 15. Task Contract ID | `0c34c7e1-648c-4f26-b7a4-8130f5fd65dc` |
| 16. Contract version | `1`, status `LOCKED` |
| 17. Contract SHA-256 | `09910a3c07a35ed7386434228a6a780ac7234bd19acfadc66132a148285384bf` |

The claim-time capability snapshot recorded Worker `0.1.0`, Windows/x64, Node `v24.16.0`, real PID `12212`, real Git availability and the `repository-materializer` executor. Persisted heartbeats include a real `BUSY` heartbeat for the Job at `2026-08-26T17:47:45.007Z` sent / `2026-08-26T17:47:45.010Z` received, plus `ONLINE` heartbeats before and after execution.

## 18-26. Clone and Independent Commit Verification

18. **Actual executable and arguments:** `spawn("git", args, { shell: false })` with:

```text
-c http.followRedirects=false
-c credential.helper=
-c core.hooksPath=<JOB_WORKSPACE>/.empty-hooks
-c init.templateDir=<JOB_WORKSPACE>/.empty-templates
clone
--no-recurse-submodules
--single-branch
--branch main
--no-tags
https://github.com/NickHOI/donelayer-build-rescue-fixture.git
<JOB_WORKSPACE>/repository
```

The environment set `GIT_TERMINAL_PROMPT=0`, `GIT_LFS_SKIP_SMUDGE=1`, `GIT_CONFIG_NOSYSTEM=1`, a blank job-local `GIT_CONFIG_GLOBAL`, isolated `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME`, and `GCM_INTERACTIVE=Never`. Network enforcement in this milestone is application-level allowlisting, not an OS-level network sandbox.

Captured full argument array:

```json
["-c","http.followRedirects=false","-c","credential.helper=","-c","core.hooksPath=<host-temp>\\donelayer-repository-reality-7BM7Xf\\worker-b\\jobs\\job-013pvE\\.empty-hooks","-c","init.templateDir=<host-temp>\\donelayer-repository-reality-7BM7Xf\\worker-b\\jobs\\job-013pvE\\.empty-templates","clone","--no-recurse-submodules","--single-branch","--branch","main","--no-tags","https://github.com/NickHOI/donelayer-build-rescue-fixture.git","<host-temp>\\donelayer-repository-reality-7BM7Xf\\worker-b\\jobs\\job-013pvE\\repository"]
```

| Item | Result |
| --- | --- |
| Clone started | `2026-08-26T17:47:45.040Z` |
| Clone finished | `2026-08-26T17:47:47.161Z` |
| Duration | `2121 ms` |
| 19. Clone exit | `0` |
| 20. stdout | empty |
| 20. stderr summary | `Cloning into '<JOB_WORKSPACE>\repository'...`; no credential or token |
| 21. `git remote get-url origin` | `https://github.com/NickHOI/donelayer-build-rescue-fixture.git` |
| 22. `git branch --show-current` | `main` |
| 23. `git rev-parse HEAD` | `600f326ce373160eb5495aaef72230d4c9807e8f` |
| 24. Independent Remote Commit | `600f326ce373160eb5495aaef72230d4c9807e8f` |
| 25. Exact match | `true` |
| 26. File count | `6` |

The Server independently ran a separate, isolated, read-only `git ls-remote --exit-code --heads <exact-url> refs/heads/main`. It did not read the Worker workspace, trust the Worker SHA, use a hardcoded SHA, or reuse the fixture preparation directory.

## 27-38. Manifest, Ledger, Cleanup and Receipt

27. **File Manifest:** stable POSIX-relative order, real file sizes and SHA-256 values:

| Relative path | Bytes | SHA-256 |
| --- | ---: | --- |
| `package-lock.json` | 278 | `445ee116b8fbfdf8e06374bdf0b3ffe31d6f7f14436367db270708403d55aff5` |
| `package.json` | 240 | `c58adcb9e9347e38975bb241a2555bffe5c421d8d593a476d4a0bdc021872c49` |
| `README.md` | 227 | `032da98b0ee1d8e78c17a4b6ea7cb3db3a740ddb162f36c5904be867b3549f73` |
| `src/add.ts` | 84 | `a968c8f2bbfa307017a7a4af8f5fe13762891e3fa754fc495b9c1d80a460f073` |
| `tests/add.test.ts` | 284 | `a50fbe2449ea376abaad73d33db660670a98d6e9812d7b883ca4a97d5545bd7c` |
| `tsconfig.json` | 243 | `20b50fa167f1c62b27fc036eec23d39284041111d212b751b45e6b4e0a67d014` |

28. **Manifest SHA-256:** `644da321ce03b89fb658f99130742ef5bb2170df5a61eecebc9eb77bf7908271`.
29. **Artifact SHA-256:** Worker claim and Server recomputation for `file-manifest.json` both equal `644da321ce03b89fb658f99130742ef5bb2170df5a61eecebc9eb77bf7908271`. Clone Log and Remote Metadata were also independently hashed and persisted.
30. **Evidence Ledger entries:** `22`, contiguous sequence; repository-specific entries plus three real Artifact upload/hash pairs and `RECEIPT_CREATED`.
31. **Evidence-chain SHA-256:** Receipt pre-creation anchor `73d63dbc1014a2f3919768ec5d536992e71d0518ac6127592af9c20ab1f4df2b`; final `RECEIPT_CREATED` Ledger tail `d760c2fbf683b17885b3afa209ce22f670b3911553e995014aa2ee1c8bef7ca1`.
32. **Workspace:** `<host-temp>\donelayer-repository-reality-7BM7Xf\worker-b\jobs\job-013pvE`.
33. **Workspace cleanup:** `true`; the exact path returned `ENOENT`, and the Worker `jobs` directory was empty.
34. **Permission violations:** `0`.
35. **Receipt Public ID:** `dlr_z2CvvYYJJIj5UmZwwc5qwcoF`.
36. **Receipt SHA-256:** `4a1fa21d3401de444e8932afc5f9a452f8c4fc6b1e3ed047f42d8f1a5c6d7287`.
37. **Receipt result:** `VERIFIED`; Task state `COMPLETED`, Job state `SUCCEEDED`, Permission state `COMPLETED`.
38. **Public Verify URL used:** `http://127.0.0.1:3202/receipts/dlr_z2CvvYYJJIj5UmZwwc5qwcoF`. The temporary production Server was stopped after verification.

The public view displayed the exact Remote, branch, both commits, manifest hash and file count, and the required limitation:

> This receipt verifies repository materialization only. It does not verify that the repository builds, tests pass, or the software is correct.

## 39. Negative Tests

All required negative boundaries passed. The focused repository suite passed `9/9`; the full suite passed `114` tests, with the two network-gated repository process tests skipped in the ordinary run and passed separately in real Gate mode.

| Boundary | Result |
| --- | --- |
| Exact allowlist URL | PASS |
| Other GitHub repository / owner / extra path / lookalike host | REJECTED |
| `file://`, SSH, `git@`, FTP, HTTP, local path and UNC path | REJECTED |
| localhost, `127.0.0.1`, `::1`, private IP | REJECTED |
| URL username/password or query credential | REJECTED |
| Redirect to another host | REJECTED; Git also uses `http.followRedirects=false` |
| Path traversal and `.git` Manifest entries | REJECTED |
| Unauthorized clone action, repo, branch or outside-workspace path | REJECTED by `PermissionGuard` |
| Expired or revoked Permission Lease | REJECTED |
| Permission violation | Persisted in Ledger; Receipt result `PERMISSION_VIOLATION`, never `VERIFIED` |
| Non-main / nonexistent branch | REJECTED by the locked envelope before Git; executor-failure state separately proves terminal failure and no fallback |
| Clone executor failure | Job `FAILED`, Task `VERIFICATION_FAILED`, no Artifact and no Receipt; no Demo fallback |
| Worker Commit vs independent Remote mismatch / hardcoded SHA | REJECTED before Receipt |
| Manifest bytes changed after declared SHA | REJECTED by Server hash observation |
| Artifact owned by another Job/Worker or expired Lease | REJECTED by existing Artifact ownership and Lease tests |
| Worker A old Lease / Permission | renew, event, Artifact and submit all HTTP `409`; old Permission `REVOKED` |
| Worker B recovery | New Job and Permission v2; only B produced the `VERIFIED` Receipt |
| Invalid Ledger chain | Existing Receipt tests reject validity / return `INVALID_EVIDENCE_CHAIN` |
| Public privacy | No internal Worker/Job/Permission IDs, PID, path, token, raw log or stderr |
| Repository code execution | No npm/package/Codex command record; clone log contains only fixed Git operations |

Recovery evidence: Worker A PID `6956`, Job `9c79b9db-e9a9-4d29-8511-9230ca3995a6`; Worker B PID `30124`, replacement Job `d669a15f-68ec-4577-a382-8930cfe30c55`; old Permission `REVOKED`, new Permission version `2`, final Task `COMPLETED`.

## 40-46. Quality and Console Results

| Item | Result |
| --- | --- |
| 40. `npm run lint` | PASS, zero warnings |
| 41. `npm run typecheck` | PASS |
| 42. `npm test` | PASS, 23 files / 114 passed / 2 network-gated skipped; separate real Gate 4/4 PASS |
| 43. `npm run build` | PASS, Next.js production build and Worker TypeScript build |
| 44. Browser console errors | `0`; Verify click, reload, 1440px and 390px checks passed without horizontal overflow |
| 45. Server stderr | real integration fixture empty; production receipt Server emitted only the known Next standalone start-mode warning, no application error |
| 46. Worker stderr | happy path empty; recovery Worker B empty |

## Actual Failure Causes Fixed

The real Gate was deliberately rerun after each failure:

1. `PermissionGuard` tried to `realpath` the isolated Git config before its parent directory existed. Directory creation and config validation are now correctly ordered.
2. SQLite's immutable Ledger table `CHECK` did not include repository Evidence types. Fresh schema and a data-preserving migration now contain the new allowlist.
3. The Contract-derived Artifact MIME allowlist omitted the real `text/plain` Clone Log. The locked Clone check now explicitly declares its filename and MIME.
4. Shared upload code requested smoke action `calculate_sha256` while the repository Lease correctly granted `calculate_file_sha256`. Worker and Server now select the action from the workflow.
5. The pre-gate claim path hardcoded a repository-free envelope and had no exact public-repository ownership mode. Claim now resolves a server-owned, exact allowlist envelope before Lease mutation, with protocol and Permission binding.

## Main Files Changed

- `packages/worker-protocol/src/repository-materialization.ts`
- `packages/worker-protocol/src/types.ts`
- `packages/worker-protocol/src/schemas.ts`
- `packages/worker-protocol/src/permission-guard.ts`
- `apps/worker/src/executors/repository-materializer.ts`
- `apps/worker/src/runtime.ts`
- `apps/worker/src/workspace.ts`
- `apps/worker/src/doctor.ts`
- `apps/worker/src/cli.ts`
- `packages/database/src/repository-verifier.ts`
- `packages/database/src/demo-store.ts`
- `packages/database/src/schema.ts`
- `packages/database/src/types.ts`
- `packages/database/src/trust-foundation.ts`
- `apps/web/src/server/repository-envelope.ts`
- `apps/web/src/app/api/worker/jobs/claim/route.ts`
- `apps/web/src/app/api/worker/job-runs/[jobRunId]/submit/route.ts`
- `apps/web/src/app/api/internal/repository-reality/jobs/route.ts`
- `apps/web/src/components/receipts/public-receipt-client.tsx`
- `tests/unit/repository-materialization.test.ts`
- `tests/integration/worker-reality.test.ts`
- `tests/integration/fixtures/worker-reality-server.ts`
- `scripts/run-repository-reality-gate.ps1`
- `scripts/start-repository-receipt-server.ps1`

## 47. Not Complete and Still Demo

- General Customer-selected repositories and GitHub App installation/ownership grants are not implemented by this Gate. REAL applies only to the exact public allowlist URL and `main`.
- Repository materialization uses application-level policy plus isolated Git configuration, not a disposable container or OS-level network/filesystem sandbox.
- The repository was not executed. Build, test and software correctness are unverified.
- Codex, repair branch, repair commit, Pull Request and GitHub write operations remain paused.
- Local SQLite/base64 Artifact persistence is not production multi-instance storage.
- DemoStore's legacy lifecycle, DemoExecutor, Demo repositories, fake Demo evidence, Test Ledger, Demo Auth and seed marketplace records remain Demo.
- Supabase production, Stripe/x402, A2A execution, MCP credential execution, ARD, C2PA, GitHub Artifact Attestations, Capability Passport, Contextual Reputation and AI Transparency Kit remain gated or deferred.

## 48. Next Gate and Stop

The next and only Gate is:

**DISPOSABLE CONTAINER RUNNER**

It has not started. No fixture code, install, test, build, container, Codex repair, branch, commit or Pull Request work was performed. Work stops here pending review of this report.
