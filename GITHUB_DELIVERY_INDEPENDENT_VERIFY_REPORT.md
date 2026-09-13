# GitHub Delivery and Independent Verification Gate V1 Report

Date: 2026-09-01 (Asia/Macau)

## Result

`GITHUB PATCH DELIVERY AND INDEPENDENT VERIFICATION GATE V1` completed for one
owner-controlled public Fixture and one exact persisted repair patch. The exact
patch was applied to the exact base Commit, delivered to a dedicated GitHub
branch and open Pull Request, independently re-materialized from the pushed
Commit, and tested in a new non-persistent Vercel Sandbox without any AI/model
call. The Test Ledger released simulated funds only after independent
verification and both Sandbox and delivery-workspace cleanup were verified.

This result is intentionally narrow. The Pull Request is open and unmerged. No
Fixture deployment, production GitHub App, real payment, general repository
grant, second Agent Provider, or second Sandbox Provider was added.

## Gate Record

| # | Required field | Recorded value |
| ---: | --- | --- |
| 1 | Repair Job ID | `ed564b18-8fa2-48d8-a307-1d0901e8b52f` |
| 2 | Repair Receipt ID | Internal `98f981fe-1204-43ac-90b2-52ed92daa2e4`; public `dlr_MdFiAU6qEBFAGtLKILBMfV5s` |
| 3 | Repair Patch SHA | `6e8679bbef6dbbba31f84ffb20b209df4d3fadfee81e58383e9926a70855c996` |
| 4 | Base Repository | `https://github.com/NickHOI/donelayer-build-rescue-fixture.git` |
| 5 | Base Commit | `600f326ce373160eb5495aaef72230d4c9807e8f` |
| 6 | Delivery Branch | `donelayer/repair/ed564b18-8fa2` |
| 7 | Delivery Commit | `466be67975a953a1ae3b5cfc41e80d42ee057164` |
| 8 | Parent Commit | `600f326ce373160eb5495aaef72230d4c9807e8f` |
| 9 | Changed Files | `src/add.ts` only |
| 10 | Delivery Diff Hash | Raw delivered diff SHA-256 `6f3bbd9cf96828ef9ae871561e702eca96b491c14bc2334867548f5d4b1d6e8d`; normalized semantic diff SHA-256 `ae1dacbf7d1243b43be898c27b35789926e4929d2d7403992e86db019d667bb9` |
| 11 | Git Authentication Mode | `OWNER_DEVELOPMENT_GITHUB_AUTH` |
| 12 | Push Result | Exit `0`; local and Remote Commit both `466be67975a953a1ae3b5cfc41e80d42ee057164`; idempotent resume verified the existing branch |
| 13 | PR Number | `1` |
| 14 | PR URL | `https://github.com/NickHOI/donelayer-build-rescue-fixture/pull/1` |
| 15 | PR Base | `main` |
| 16 | PR Head | `donelayer/repair/ed564b18-8fa2` |
| 17 | PR State | `OPEN` |
| 18 | Merged status | `false` / No |
| 19 | Independent Verifier Type | `NON_AI_DETERMINISTIC_VERIFIER` |
| 20 | Repair Sandbox ID | `donelayer-agent-repair-d8b3bd13-456e-44cb-aa7b-` |
| 21 | Verification Sandbox ID | `donelayer-delivery-verify-f2b8226c-fbae-4735-a0d` |
| 22 | IDs are different | Yes |
| 23 | Verification Commit | Remote, materialized, and verification Source all `466be67975a953a1ae3b5cfc41e80d42ee057164` |
| 24 | `npm ci` Exit Code | `0` |
| 25 | Build Status | `NOT_PRESENT`; no build command was executed because the exact delivered `package.json` has no build script |
| 26 | `npm test` Exit Code | `0` |
| 27 | Test count | 2 total, 2 passed, 0 failed; reliably parsed from `node:test` |
| 28 | Tests unchanged | Yes; before/after tests Manifest `f818cc3ee7f6f5e69a036ede667f96daa5666905455bca35597486ccab426424` |
| 29 | Test script unchanged | Yes; `node --experimental-strip-types --test tests/*.test.ts` |
| 30 | Policy violations | `0`; no `.skip`, `.only`, test/config/script change, forbidden action, or credential exposure detected |
| 31 | Artifact list | 20 content-bound Artifacts; listed below |
| 32 | Artifact hashes | Server-computed SHA-256 values listed below; persisted bytes, sizes, and hashes revalidated |
| 33 | Evidence Ledger Entry Count | 39 entries in the Receipt-authorizing chain; 40 persisted full-chain entries including Receipt issuance |
| 34 | Evidence Chain Hash | Receipt anchor `6b7affdbc4089288645f569c8038078b000c98bc847ecbb6d87ff0c4629007d8`; full chain `8f2a8f91b2ab9db0c20a523cb101efbe26ea1026397fe9c4920365cab992138e` |
| 35 | Verification result | `PASSED` |
| 36 | Receipt ID | Internal `a0db5f2a-858c-4e5a-8a8c-8f9f821808a7`; public `dlr_jMBVGIH17OLg8T541rmKiB6s` |
| 37 | Receipt Hash | `b816f580e633b86a8005f7b2a5ec6559abb13c44b477e7025845e5b679647d51` |
| 38 | Receipt Integrity | `VALID` |
| 39 | Delivery Outcome | `VERIFIED_DELIVERY` |
| 40 | Test Ledger state | `RELEASED` at `2026-08-31T19:06:40.782Z`; customer simulated charge `$10.00` |
| 41 | Simulated Provider payout | `$8.00` / 800 cents |
| 42 | Simulated Platform fee | `$2.00` / 200 cents |
| 43 | AI calls during Gate | `0` |
| 44 | AI Gateway usage during Gate | `$0` |
| 45 | Sandbox cleanup | Verified; Provider final state `stopped`, still running `false` |
| 46 | Snapshot created | `false` |
| 47 | lint | PASS |
| 48 | typecheck | PASS |
| 49 | tests | PASS: 35 files passed / 4 skipped; 166 tests passed / 6 skipped |
| 50 | production build | PASS |
| 51 | Browser desktop verification | PASS at 1440x900: Receipt loaded, Verify interaction returned valid integrity, required claims visible, no horizontal overflow or framework overlay |
| 52 | Browser mobile verification | PASS at 390x844: required claims visible, hashes/provider labels wrapped, no horizontal overflow or framework overlay |
| 53 | console errors | No visible application/runtime error and no Next.js error overlay; the selected in-app Browser surface did not expose a historical console-log collector, so this report does not fabricate a stronger zero-console claim |
| 54 | remaining non-real components | Production GitHub App/grants, arbitrary Customer repositories, PR merge/deploy, Supabase production persistence/storage/auth, production queues/operations, real payment/Stripe, multi-Provider/failover, A2A/MCP execution, external trust anchor, Capability Passport, Reputation, and AI Transparency Kit |
| 55 | next recommended Gate | Owner review of this evidence and open PR. No next implementation Gate is authorized or started by this result |

## Commit And Pull Request

- Commit message: `fix: apply DoneLayer verified repair`
- Author and committer: `NickHOI <NickHOI@users.noreply.github.com>`
- PR title: `DoneLayer verified repair`
- PR body records the Repair Receipt, Base and Delivery Commits, Patch SHA,
  modified file, failed initial test, passed Repair Sandbox test, and the required
  initial independent-verification state `PENDING`.
- GitHub readback confirmed the PR base/head, open/unmerged state, Commit parent,
  author/committer, changed file, and delivered diff.
- Neither `main` nor any tag was modified. No force push or branch deletion was
  performed.

## Exact Patch Proof

The delivery provider used the persisted `repair.patch`; it did not regenerate
or manually recreate the fix. Before delivery it independently confirmed Remote
`main`, the expected Base Commit, the Base Source Manifest, and the required
patch SHA. Applying that exact patch changed only `src/add.ts`:

- before SHA-256: `a968c8f2bbfa307017a7a4af8f5fe13762891e3fa754fc495b9c1d80a460f073`
- after SHA-256 from the exact persisted patch:
  `a3c830828530a88f156c86e65ea6a2c42bc6d1876bf8c8a7adb547a99067eaad`
- normalized semantic diff SHA-256:
  `ae1dacbf7d1243b43be898c27b35789926e4929d2d7403992e86db019d667bb9`
- GitHub/PR diff SHA-256:
  `6f3bbd9cf96828ef9ae871561e702eca96b491c14bc2334867548f5d4b1d6e8d`

The semantic comparison confirmed the same file, before content, after content,
and effective hunks. Tests, the package test script, and test configuration are
byte-identical to the Base Commit.

## Independent Verification

The verifier did not trust or reuse the Repair Sandbox or controlled delivery
workspace. It independently resolved the Remote branch and exact pushed Commit,
materialized that Commit into a fresh Source Package, and used the package as
the only execution source for a new Vercel Sandbox.

- verifier run: `f2b8226c-fbae-4735-a0d1-9e4e87e92130`
- delivery Manifest:
  `0328630dec42367519ca242eb2c943c739be44d80fef23a058e2295ea27bdd89`
- Source Package SHA-256:
  `19ab015b180ebbdc034e263e8bee4ed9f54317cce15d3d752782ea59c5ec6abd`
- Source Package Manifest SHA-256:
  `7484cf9e02e5306ea1624126f7b22090d761e08b6a1536f6f03f2e8419b5023c`
- credential environment names observed in Sandbox: empty list
- install: exit `0`, duration `633 ms`
- build: `NOT_PRESENT`
- test: exit `0`, duration `279 ms`, 2/2 passed
- post-test Source integrity: 6 checked, 0 missing, 0 modified, 0 added
- Sandbox usage: CPU `2390 ms`, active duration `7028 ms`, ingress `25968`
  bytes, egress `15952` bytes; Provider supplied no USD cost
- lifecycle: non-persistent, no Snapshot, stopped and cleanup verified

The Sandbox received no GitHub, Vercel, AI Gateway, OpenAI, or other platform
credential. Network began deny-all, opened only to the exact npm registry for
the fixed install command, and returned to deny-all in a `finally` path before
test and Source-integrity verification.

## Artifacts

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `task-contract.json` | 1582 | `ffbce7cbf36f7d513a6632909fe70173c2f6cb8d02c4265c641e7697ccfa69ae` |
| `delivery-permission.json` | 836 | `e6d343698ae72d154c506afc4102bf11e6d19c0c5f177a13ec4678da4e50abe4` |
| `repair-input.json` | 1015 | `0ed5c1614680992e6ff1c8225e676c288f07f9226e097a7b86bc3ea86d538219` |
| `github-delivery.json` | 3021 | `36f91be70c11bbe9145a885097dacfe44829aff65d8ddc40ec98441aeaf44433` |
| `local-delivery-diff.patch` | 260 | `6f3bbd9cf96828ef9ae871561e702eca96b491c14bc2334867548f5d4b1d6e8d` |
| `delivery-diff.patch` | 260 | `6f3bbd9cf96828ef9ae871561e702eca96b491c14bc2334867548f5d4b1d6e8d` |
| `delivery-integrity.json` | 4564 | `1d74d57f2d7b85fa7b74538c74f7c728ed8f5bf741e8ea76e815f8142cefa735` |
| `independent-source.json` | 677 | `c40572699592949d503b9ca6d9b9bcd2bf313748a23662a81ed5b69a68319b1e` |
| `independent-install-stdout.log` | 21 | `0117ffdb69cb6b242874301527014efc465051b4d903d97ecc52b03f95d6de5f` |
| `independent-install-stderr.log` | 1 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` |
| `independent-build.json` | 300 | `3d176e5b3ee10544915db0ce22fcdf820fd11008775d2d1f20fad84471f9c631` |
| `independent-test-stdout.log` | 324 | `bfdbedbc3c08c9ccde4709262953202a36cdeb3007ce9df7a284a96fe73ddae0` |
| `independent-test-stderr.log` | 1 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` |
| `independent-test-result.json` | 756 | `f44e1e43f0c288adedb689a3e8f8de5027fa7f80075c0a0fced74b9181e7281c` |
| `anti-cheating-verification.json` | 932 | `c8488b6ed704d190aac1700025d3ab74f0cda55a4abbcbcb839af38bfacfedf8` |
| `independent-source-integrity.json` | 326 | `65bd3d40b6cc5f7e6e3d7702604ad79dee4be5ecc279f87989b9d778bab38329` |
| `verification-sandbox-cleanup.json` | 474 | `d2f2c042a30bb4f61b29455df1afc03b3bc8a0a20eda9e2ec6a12673b9a2d24c` |
| `test-ledger.json` | 253 | `f3cf0000604f2c540cdaddcdbefdabc46bb25518b91014db07e2290f68eab0c3` |
| `delivery-workspace-cleanup.json` | 22 | `3ab5ce8cfb9d6a150f0a906e89d63fe772e0581ac7e894a0a56feac8ad78fc48` |
| `delivery-failure.json` | 5 | `38e0b9de817f645c4bec37c0d4a3e58baecccb040f5718dc069a72c7385a0bed` |

Machine-readable evidence is persisted in:

- `test-results/github-delivery-independent-verify-evidence.json`
- `test-results/github-delivery-independent-verify.sqlite`
- `test-results/github-delivery.json`
- `test-results/delivery-diff.patch`

Final repository validation after implementation and documentation updates:
`npm run lint` PASS; `npm run typecheck` PASS; `npm test` PASS with 35 files
passed / 4 skipped and 166 tests passed / 6 skipped; `npm run build` PASS for
the Next.js production build and Worker TypeScript build.

## Disclosed Partial Run

The first live delivery attempt created the exact final branch, Commit, and PR,
then stopped before creating a verification Sandbox. An offline verifier check
incorrectly compared the exact persisted-patch output, which contains a final
newline, to the earlier in-memory model replacement, which did not. Their hashes
were therefore different even though the persisted patch was authoritative:

- earlier in-memory replacement: 136 bytes,
  `8d8c18e431b3a574ad24658f9328ddcbe63613b783f3860c34e0af32f3893ea9`
- exact persisted-patch output: 137 bytes,
  `a3c830828530a88f156c86e65ea6a2c42bc6d1876bf8c8a7adb547a99067eaad`

That attempt produced a valid `FAILED / PATCH_MISMATCH` partial Receipt, made no
Sandbox or AI call, and left the Test Ledger `RESERVED` with no provider payout
or platform fee. Its evidence is preserved in the four
`test-results/github-delivery-partial-v1*` / `delivery-diff-partial-v1.patch`
files. The verifier was corrected offline to derive the expected after-hash by
applying the persisted patch, and a regression test was added. The resumed Gate
verified the existing Remote branch/Commit/PR idempotently; it did not create a
duplicate push or PR.

The earlier post-repair Gateway `429` responses remain recorded as provider
warnings in the Repair evidence. This delivery Gate made no model request and
does not alter those warnings.

## Stop Boundary

Work stops at the verified open PR and simulated Test Ledger release. The PR
was not merged, the Fixture was not deployed, and no next product phase was
started. Owner review is required before any further Gate is authorized.
