# Phase B Attempt 1 Blocked Report

Date: 2026-09-04

## Decision

**PHASE B ATTEMPT 1: HISTORICAL FAIL / BLOCKED.**

This is a pre-execution Source-materialization infrastructure failure. It is
not an Agent execution failure, Verified Job failure, Reputation failure,
candidate Job, or capability signal against the Agent. The Agent never ran.

## Exact Blocker

The first live launcher invocation created the batch start and one
`TEST_AND_FIX` Job identity, then the Server-side Source materializer failed its
read-only GitHub clone with exit code `128`:

```text
fatal: unable to access 'https://github.com/NickHOI/donelayer-build-rescue-fixture.git/': Failed to connect to github.com port 443 after 11 ms: Could not connect to server
```

The durable failure stage is `SOURCE_MATERIALIZATION`; its normalized failure
code is `Git_clone_failed_with_exit_code_128`. A subsequent network-enabled
launcher invocation created no Job or lifecycle state and stopped at the
existing-evidence guard:

```text
REPUTATION_ENTRY_PHASE_B_EVIDENCE_ALREADY_EXISTS: refusing to overwrite a prior replacement batch
```

No further retry occurred.

## Preserved Evidence

- Database: `test-results/reputation-entry-replacement-phase-b.sqlite`
- Database size: `36,864` bytes
- Database SHA-256: `8cfc08cf27f560c7551ee050263df7eec4d5b365c869ff8d1d8bb45c0fa3ef82`
- Working-tree identity: `test-results/reputation-entry-replacement-phase-b-working-tree-identity.txt`
- Working-tree identity SHA-256: `5057bdbf1b11043fd2fa96fe726c6b6a450d10e53598e4a9b2a17bdc01f6d190`
- Partial Job ID: `904e08c4-fa41-42f7-abac-3eef0da9f24e`
- Agent ID: `agt_dcZX-ngYijOoEQF17VQJqPTc`
- Profile revision/hash: `1` / `f8eb98aed42dc47bf76942f032101d4d511aee1f9c2ab099f51337aa349aeb5b`
- Durable records: `4`; Job lifecycle entries: `2`
- Partial lifecycle head: `94a84a7c78fc76fdb7d9207179c48cf0a6c77a934d533905e1a3895cd1070312`
- Historical marker binding: `5d90116229342b94fa9ef935e2c5780d2a0655143ec121db78b8c58176fd598f`

The partial database contains no Source identity, Work Contract, execution,
Permission Lease, Sandbox, model request, patch, verifier, final Evidence
Bundle, Evidence Ledger, Receipt, or candidate outcome. Missing evidence was
not reconstructed.

## External Effects And Cleanup

The two owner-authorized Fixture refs remain the only remote mutations prepared
for this batch:

- `donelayer/repair/reputation-state-transition-v2` at `2839dd96b644e2e435e11c66c37a6fdacd264d6c`
- `donelayer/repair/reputation-build-config-v2` at `433257234caddbd0ee13d854d23adb78113b1f90`

Attempt 1 created zero Sandboxes, made zero model requests, created no Snapshot,
issued no Lease, and created no PR, merge, deployment, payment, blockchain
write, billing change, or production credential expansion. Its temporary
materializer workspace was removed.

## Corpus Status

- Successful candidates: `0`
- Canonical real Verified Jobs: `0`
- Remaining gap: `20`
- Evidence-Based Reputation: not started

Attempt 1 is permanently historical and must not be overwritten, promoted, or
treated as capability evidence.
