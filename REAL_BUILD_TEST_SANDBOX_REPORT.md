# Real Build and Test in Managed Sandbox Gate V1 Report

Date: 2026-08-31 (Asia/Macau)

## Verdict

**REAL BUILD AND TEST IN MANAGED SANDBOX GATE V1 is complete for one exact,
allowlisted Fixture commit.**

The single live Provider run performed a fresh GitHub clone and independent
Remote resolution, created and reverified a bounded Source Package, executed
the fixed install and test commands inside one real non-persistent Vercel
Sandbox, preserved the intentional test failure, reverified the original
Source files, stopped the Sandbox, verified cleanup, and issued a
hash-verifiable `FAILED` Receipt.

The current Fixture commit has no `build` script. The locked conditional build
step therefore correctly recorded `NOT_PRESENT`, exit code `null`, duration
`0 ms`; it did not fabricate a successful build.

```text
Fresh GitHub clone + independent Remote verification
-> exact canonical Source Package
-> Vercel Managed Remote Sandbox
-> npm ci: PASSED (0)
-> build: NOT_PRESENT (the exact commit has no build script)
-> npm test: FAILED (1, intentional fixture assertion)
-> Source integrity: unchanged
-> Sandbox: stopped / cleanup verified / no snapshot
-> Task: VERIFICATION_FAILED
-> Job: FAILED
-> Receipt result: FAILED
-> Receipt integrity: VALID
-> Provider payout released: false
```

No Codex repair, Source modification, local workload execution, local Docker,
commit, push, branch, Pull Request, deployment, payment, second Provider, or
fallback executor was used.

## Required Evidence Summary

| # | Required field | Captured result |
| ---: | --- | --- |
| 1 | Repository URL | `https://github.com/NickHOI/donelayer-build-rescue-fixture.git` |
| 2 | Branch | `main` |
| 3 | Remote / Materializer Commit SHA | `600f326ce373160eb5495aaef72230d4c9807e8f` |
| 4 | Independent Commit SHA | `600f326ce373160eb5495aaef72230d4c9807e8f` |
| 5 | Source File Count | `6` |
| 6 | Source Manifest SHA-256 | Repository manifest: `644da321ce03b89fb658f99130742ef5bb2170df5a61eecebc9eb77bf7908271`; Source Package Manifest file: `38ff34e912cd846a48c2d0b19028cc41181e4b235f991c4cd0145ae264c1dd1e` |
| 7 | Source Package SHA-256 | `945bd9271a3fd11b2e2ca00437823a8122a1fca3fa5ca30e559f0f80909720d2` (`2,209` package bytes; `1,356` Source bytes) |
| 8 | Task ID | `efb18fb6-6eae-416f-9e9d-0c5679cc00d8` |
| 9 | Contract ID | `267aaed8-df5a-4e44-912a-077975bd59fd`, version `1`, `LOCKED` |
| 10 | Contract SHA-256 | `a6ae5e0a759fe0954978809afc0aafc829927c384fdea2fdafdbcd42a2a7ebc4` |
| 11 | Permission Lease ID | `69c5ea80-73fd-4d02-99ec-f8156653c622`, final status `COMPLETED` |
| 12 | Job Run ID | `aef49e65-b90c-4df0-aba7-dd236daaf2c6` |
| 13 | Vercel Sandbox ID | `donelayer-build-test-e8fcbeb1-2186-480e-b440-5d7e8e` |
| 14 | Sandbox Runtime | Vercel `node24`, region `iad1`, `REMOTE_MICROVM`, `NON_PERSISTENT` |
| 15 | Node version | `v24.14.1` inside the Sandbox |
| 16 | npm version | `11.11.0` inside the Sandbox |
| 17 | Network Policy | Initial `deny-all`; install-only exact allowlist `registry.npmjs.org`; final `deny-all`; no allowed CIDRs or ports |
| 18 | npm ci Command | `npm ci --ignore-scripts --no-audit --no-fund` |
| 19 | npm ci Exit Code | `0`, status `PASSED` |
| 20 | npm ci Duration | Provider-reported `593 ms`; started `2026-08-31T14:34:28.402Z`, finished `2026-08-31T14:34:29.382Z` |
| 21 | Build Command | Conditional `npm run build`; not executed because `package.json` has no build script |
| 22 | Build Exit Code | `null`, status `NOT_PRESENT` |
| 23 | Build Duration | `0 ms` |
| 24 | Test Command | `npm test` |
| 25 | Test Exit Code | `1` |
| 26 | Test Duration | Provider-reported `292 ms`; started `2026-08-31T14:34:29.982Z`, finished `2026-08-31T14:34:30.666Z` |
| 27 | Test result | `FAILED`; formal statistics `UNPARSABLE`, so counts remain `null` rather than guessed |
| 28 | Source mutation result | `false`; 6 checked, 0 missing, 0 modified, 0 added |
| 29 | Artifact list | 18 allowlisted artifacts; see the Artifact table below |
| 30 | Artifact SHA-256 | All 18 claimed hashes equal the Server-computed hashes; see below |
| 31 | Evidence Ledger entries | 78 contiguous entries; final entry `RECEIPT_CREATED`; see Ledger summary below |
| 32 | Evidence Chain SHA-256 | Receipt anchor through `VERIFICATION_FAILED`: `ab9bcb367696d3fa28e83df5d17df3dd057ea3231991378173439cb47d6ce8fc`; current post-Receipt Ledger head: `9ddc0eaefd0b441b9352230a6ef2f3983f67e78b50257ca8b7099a3f6637ddf8` |
| 33 | Verification result | 18 milestone checks `PASSED`; required `automated-tests-pass` check `FAILED`; Task `VERIFICATION_FAILED` |
| 34 | Test Ledger release status | No Test Ledger entries and no `RELEASE`; Provider payout released `false`; Contract budget is USD `0` |
| 35 | Receipt Public ID | `dlr_bqd9g_5dYVG8st9sOw8_4Uiu` |
| 36 | Receipt Hash | `7f00cd6a7c47f6c244dadb24751242f1403e33f0ddd8c21a7131a934c40b4cbb` |
| 37 | Receipt Integrity | `VALID` |
| 38 | Job Outcome | Task `VERIFICATION_FAILED`; Job `FAILED`; Receipt result `FAILED` |
| 39 | Public Verify URL | Browser-tested locally at `http://127.0.0.1:3203/receipts/dlr_bqd9g_5dYVG8st9sOw8_4Uiu`; no public deployment was created |
| 40 | Sandbox Stop result | Stop requested `2026-08-31T14:34:31.587Z`; confirmed `2026-08-31T14:34:38.078Z`; Provider state `stopped` |
| 41 | Sandbox Cleanup result | `cleanupVerified:true`, `stillRunning:false` |
| 42 | Persistent Snapshot created | `false`; Sandbox `persistent:false` |
| 43 | Local Host Execution used | Workload execution `false`; only server-side source materialization occurred locally |
| 44 | Local Docker used | `false` |
| 45 | Network violation count | `0` recorded; no external probe was run in this workflow, so this is not a separate network-probe claim |
| 46 | Permission violation count | `0` |
| 47 | lint result | `PASS`, zero warnings |
| 48 | typecheck result | `PASS` |
| 49 | test result | Final offline suite: 30 files passed, 2 real-gate files skipped; 152 tests passed, 4 skipped |
| 50 | production build result | `PASS`; Next.js 22 routes/pages and Worker TypeScript build completed |
| 51 | Browser console errors | `0` errors and `0` warnings after load, Verify, desktop, mobile, and scroll checks |
| 52 | Server errors | `0` request/runtime errors; captured gate child `stderr` empty. Local `next start` emitted one configuration warning because the build also has standalone output; it still served correctly |
| 53 | Provider errors | `0` in the live execution; availability, creation, commands, policy updates, collection, stop, and cleanup succeeded |
| 54 | Cost / usage observed | CPU `2,467 ms`; Provider duration `6,911 ms`; ingress `25,614` bytes; egress `16,152` bytes; Provider did not supply a USD cost (`costUsd:null`) |
| 55 | Not completed | Codex repair, repaired branch/commit/PR, independent repaired checkout, general Customer repositories, production deployment/storage/auth, payment, second Provider, Capability Passport, Reputation, and AI Transparency Kit |
| 56 | Next and only Gate | **CODEX REPAIR IN MANAGED SANDBOX**, only after owner review and explicit approval |

The Commit SHA was freshly observed by both the isolated Materializer checkout
and a separate `git ls-remote` resolution. It was not used as a hardcoded input,
even though it equals the earlier materialization milestone's observed SHA.

## Source Package

The package format is `DONELAYER_SOURCE_PACKAGE_JSON_V1`: canonical JSON with
strictly sorted relative paths and canonical base64 file bytes. It is bounded
and verified independently before upload and again inside the Sandbox.

- Repository manifest: 6 files, `1,356` Source bytes.
- Source Package: `2,209` bytes.
- Source Package Manifest: `1,192` bytes.
- `.git`, `.env*`, credential files, private keys, Worker credentials,
  DoneLayer secrets, home directories, symlinks, traversal paths and files from
  other Jobs are rejected.
- Install lifecycle scripts `preinstall`, `install`, `postinstall`, and
  `prepare` were absent and independently checked before and after upload.
- The temporary local Materializer workspace was verified removed before the
  Sandbox was created.

## Sandbox Policy

| Limit / policy | Locked value |
| --- | --- |
| Backend / Provider | `MANAGED_REMOTE_SANDBOX` / `VERCEL_SANDBOX` |
| Workflow | `NODE_BUILD_TEST_MANAGED_SANDBOX_V1` |
| vCPU / memory observed | 1 vCPU / 2,048 MB |
| Sandbox lifetime | 300 seconds maximum |
| Command count | 4, because build was absent |
| stdout / stderr | 262,144 bytes each in the Permission Lease; Provider adapter additionally caps each captured stream at 65,536 bytes |
| Artifact size | 2,097,152 bytes each |
| Ports / CIDRs | none / none |
| Persistence / Snapshot | none / forbidden |
| Environment names | `DONELAYER_JOB_ID`, `DONELAYER_SANDBOX_RUN_ID`; no credential-like variable names |
| Initial network | `deny-all` |
| Install network window | exact `registry.npmjs.org` only |
| Build / test / integrity network | final `deny-all` |

Commands were structured `cmd` plus fixed argument arrays, with `shell:false`
on source materialization and no natural-language-to-shell concatenation.

## Real Command Evidence

### Dependency install

- Command: `npm ci --ignore-scripts --no-audit --no-fund`
- Exit: `0`
- Provider duration: `593 ms`
- Captured stdout: `up to date in 506ms`
- Install stdout hash: `04583aa261d7e84b5c1e5dafa96d0460472ad792c67f3f8e460988b8a86baf43`
- Install stderr hash: `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`

### Build

- `package.json` build script present: `false`.
- Status: `NOT_PRESENT`.
- No build process was launched and no exit code was invented.
- The build stdout artifact explicitly records that the command was not
  executed; it is not a fake build log.

### Test

- Command: `npm test`
- Exit: `1`
- Provider duration: `292 ms`
- Real failing subtest: `intentionally fails for DoneLayer Build Rescue`
- Real assertion: actual `4`, expected `5`, `ERR_ASSERTION`
- Test stdout hash: `cc460474ca339d1bd8dbdbf2407c86dd53eebc0a3eee322230fcc2baadd653bd`
- Test stderr hash: `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`
- The Node 24 runner emitted Unicode information markers rather than the fixed
  TAP `# tests/# pass/# fail` form accepted by the conservative parser.
  Formal statistics therefore remain `UNPARSABLE` and all counts remain null.

## Artifact Hashes

| Artifact | Bytes | Server SHA-256 |
| --- | ---: | --- |
| `repository-materialization.json` | 745 | `ed4d2cf0469a713b01046668d1827de3493369140e34241c5bc6eae7151a3874` |
| `source-package-metadata.json` | 395 | `8ce5fa175ba7f4ede5ddd071cdaf08b610a6ddff30d5323c355736efb7df9562` |
| `source-package-manifest.json` | 1,192 | `38ff34e912cd846a48c2d0b19028cc41181e4b235f991c4cd0145ae264c1dd1e` |
| `managed-build-test-provider.json` | 1,044 | `91cf8f60013f06d9f9c6ce8903f979756dbcf978497736b49bc16bf797290402` |
| `managed-build-test-policy.json` | 2,084 | `d63f18277c75aac5ea3ec0eb6da55824f4e090307935fb942b6d7136dc2362e8` |
| `source-package-verification.json` | 718 | `67923de9315f804a04995147657e3fbfb63b8a18efb524f50b19f12ffc18dfba` |
| `install-stdout.log` | 21 | `04583aa261d7e84b5c1e5dafa96d0460472ad792c67f3f8e460988b8a86baf43` |
| `install-stderr.log` | 1 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` |
| `install-result.json` | 554 | `36a769da6278878fcf3a796d15c43b7f9faf58f57b6594e8cc3cca2e82b0b694` |
| `build-stdout.log` | 48 | `cf82814931bd33761b7e1229f3bd9e26260562a9ef5d4998da83ca647214b6a0` |
| `build-stderr.log` | 1 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` |
| `build-result.json` | 495 | `26f7af6b550d3d5cc64d4b7c77368b77648d8d8b28f00f2a897fc1f2ea9bd662` |
| `test-stdout.log` | 1,154 | `cc460474ca339d1bd8dbdbf2407c86dd53eebc0a3eee322230fcc2baadd653bd` |
| `test-stderr.log` | 1 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` |
| `test-result.json` | 638 | `857d59826d865a5b86400dd3f28f14fb4f8eb360877760815a6584a84c3453ce` |
| `source-integrity-result.json` | 288 | `8ac4fb759a8f1c5ef0c7d7e0abab8f3817e27af116e7dc8412ab9aeeab2107c3` |
| `managed-build-test-lifecycle.json` | 3,335 | `131709dfe43c58b39065671ab065ca8b442f297af276344f3e51056b05d75ace` |
| `managed-build-test-cleanup.json` | 477 | `83f483d38312eebb75a316db98837410468dc7018de34699b3095d79394ac160` |

All six context artifacts are strictly schema-checked and cross-bound to the
locked source identity, exact security profile, persisted Provider inspection,
policy transitions, command-result artifacts, cleanup timestamps, Sandbox
state, and Provider usage. A matching hash alone is insufficient.

## Evidence Ledger

`verifyLedgerChain(jobRunId)` returned `valid:true`, 78 entries, no invalid
sequence and no reason. Exact sequence summary:

```text
1 CONTRACT_LOCKED
2 PERMISSION_GRANTED
3 REPOSITORY_VERIFIED
4 SOURCE_PACKAGE_CREATED
5 SOURCE_PACKAGE_VERIFIED
6 MANAGED_SANDBOX_REQUESTED
7 MANAGED_SANDBOX_CREATED
8 MANAGED_SANDBOX_POLICY_VERIFIED
9 MANAGED_SANDBOX_STARTED
10 EXECUTION_STARTED
11-28 six ARTIFACT_CREATED / ARTIFACT_UPLOADED / ARTIFACT_HASH_VERIFIED triplets
29 SOURCE_PACKAGE_UPLOADED
30 SOURCE_MANIFEST_VERIFIED
31 NETWORK_POLICY_UPDATED (install-only registry window)
32-40 three Artifact create/upload/hash triplets (install evidence)
41 DEPENDENCY_INSTALL_STARTED
42 DEPENDENCY_INSTALL_COMPLETED
43 NETWORK_POLICY_UPDATED (restored deny-all)
44-61 six Artifact create/upload/hash triplets (conditional build + test evidence)
62 TEST_STARTED
63 TEST_FAILED
64-66 source-integrity Artifact create/upload/hash
67 SOURCE_INTEGRITY_VERIFIED
68 MANAGED_SANDBOX_STOP_REQUESTED
69 MANAGED_SANDBOX_STOPPED
70 MANAGED_SANDBOX_CLEANUP_VERIFIED
71-76 lifecycle and cleanup Artifact create/upload/hash triplets
77 VERIFICATION_FAILED
78 RECEIPT_CREATED
```

No `BUILD_STARTED` or `BUILD_COMPLETED` entry exists because the build script
was absent. This is the expected conditional behavior, not missing evidence.

## Receipt and Public Verify

- Receipt type: `REAL_BUILD_TEST_MANAGED_SANDBOX_VERIFICATION`.
- Public label: `Real Build and Test Verification`.
- Receipt result: `FAILED`.
- Public task result: `FAILED`.
- Receipt integrity: `VALID`.
- Receipt disclaimer:

> This receipt records a real build and test execution for the specified repository commit. The receipt is cryptographically consistent, but the task result is FAILED because one or more required automated tests did not pass.

The production page was exercised against the captured SQLite database:

- `Verify` recomputed and preserved `Receipt integrity is valid`.
- `Task result` remained separately displayed as `Failed`.
- Desktop `1440 x 900`: no horizontal overflow or overflowing text elements.
- Mobile `390 x 844`: no horizontal overflow or overflowing text elements;
  header, hashes, command evidence, failure result, payout status and disclaimer
  remained readable while scrolling.
- Browser console: 0 errors, 0 warnings.
- Server request/runtime errors: 0.
- The local verification server was stopped after testing.

## One-Run Process Record

Exactly one live build/test Sandbox was created for this Gate. The live process
completed and wrote the final JSON/SQLite evidence and `FAILED` Receipt. The
outer Vitest command then exited `1` because its assertion incorrectly assumed
the Fixture had a build script and expected build `PASSED`. The captured Remote
truth was `buildScriptPresent:false`, so the production workflow correctly
returned `NOT_PRESENT`.

The assertion was corrected to require `PASSED/0` only when a build script is
present and `NOT_PRESENT/null` otherwise. The live Provider Gate was **not**
rerun. A separate persisted-evidence regression test then passed against the
single captured run, and the final ordinary suite passed 152 tests.

This harness assertion mismatch was not a Provider error, Sandbox error,
server runtime error, or business workflow failure.

## Negative and Fail-Closed Coverage

Focused tests cover rejection of wrong Repository/Commit, Source Package and
Manifest tampering, sensitive paths and symlinks, arbitrary commands, policy
expansion, unauthorized domains/CIDRs, local Host/Docker fallback, lifecycle
scripts, test exit `0` becoming success, timeout-like test exits, Source
mutation, cleanup failure, Artifact/content/hash tampering, invalid Ledger,
payment release after failed verification, and conflation of Receipt integrity
with Job outcome.

The orchestration path restores exact deny-all networking before cleanup on a
failure path, rejects nonzero install/build, rejects timeout-like test exits
instead of accepting them as the intentional assertion failure, and always
attempts Provider stop/cleanup once a handle exists.

## Stored Evidence

- `test-results/real-build-test-sandbox-evidence.json`
- `test-results/real-build-test-sandbox.sqlite`
- `tests/integration/managed-build-test-evidence.test.ts`

The Source Package bytes existed only for the bounded Materializer-to-Sandbox
transfer and were destroyed with the non-persistent Sandbox. The persisted
record contains the manifest, metadata, hashes, command output and lifecycle
evidence, not a secret-bearing local checkout.

## Remaining Boundary and Stop

This milestone proves real install/test execution only for the exact public
Fixture commit. It does not establish a general Customer repository executor,
successful build evidence for this build-less commit, Codex repair, delivery,
production data infrastructure, multi-tenant certification, payment, Provider
failover, Capability Passport, Reputation, or AI Transparency.

The next and only Gate is **CODEX REPAIR IN MANAGED SANDBOX**. It has not
started. Stop here for owner review of this report.
