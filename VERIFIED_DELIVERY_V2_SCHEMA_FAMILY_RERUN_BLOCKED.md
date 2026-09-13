# V1 Schema-Family Dispatcher Correction And V2 Pre-Live Rerun

## Decision

`V2 LIVE-ORCHESTRATOR PRE-LIVE GATE — BLOCKED`

The authorized correction restored the retained Attempt 4 validation, but a
mandatory Attempt 3 validation invocation failed the no-sidecar assertion.
The Gate stopped immediately and is not promoted to PASS.

## Exact Dispatcher Bug

The dispatcher selected the parser using only `recordType` and
`recordVersion`. It therefore treated every version-1 final Bundle and Receipt
as a Reputation-entry candidate record. That rejected the legitimate
Persistence Preflight V1 family.

Record version alone is insufficient because both Persistence Preflight and
Reputation Entry issued version-1 records under the same durable record types.

## Historical Families And Discriminators

Repository evidence proves exactly three applicable families:

| Family | Final Bundle discriminator | Receipt discriminator |
|---|---|---|
| Persistence Preflight V1 | top-level `bundleType=PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1` | top-level `receiptType=PERSISTENCE_PREFLIGHT_RECEIPT_V1` |
| Reputation Entry V1 | top-level `bundleType=REPUTATION_ENTRY_CANDIDATE_EVIDENCE_BUNDLE_V1` | `document.receiptType=VERIFIED_JOB_RECEIPT_V1` |
| Reputation Entry Outcome V2 | top-level `bundleType=REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2` | `document.receiptType=VERIFIED_JOB_RECEIPT_V2` |

These are explicit immutable literals already covered by the durable record
payload hash. No family inference from IDs or current configuration is needed.

## Attempt 4 Exact Shapes

The exact persisted Bundle is a six-field strict object:

```text
bundleType, jobId, result, intermediateRecovered,
verifierResultPersisted, leaseStatus
```

Its `bundleType` is `PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1`.

The exact persisted Receipt is a nine-field strict object:

```text
receiptType, jobId, executionId, workContractSha256, authoritySha256,
bundleSha256, result, candidateCounted, receiptSha256
```

Its `receiptType` is `PERSISTENCE_PREFLIGHT_RECEIPT_V1`.

## Correction Implemented Before Stop

`durable-record-versions.ts` now contains:

- exact family literals and a three-family type
- deterministic Bundle and Receipt family resolution
- rejection of missing, unknown, or conflicting Receipt discriminators
- an explicit family assertion API
- family/version compatibility enforcement
- separate strict schemas for Persistence Preflight V1, Reputation Entry V1,
  and Reputation Entry Outcome V2
- canonical self-hash checks where the historical family includes a self-hash

No historical bytes were normalized, migrated, or rewritten.

## Validation Results

1. Strict typecheck: `PASS`.
2. Retained Attempt 4 validation: `PASS` (`1` passed, `1` environment-gated skip).
3. Attempt 3 content, lifecycle, versioned model-run, Contract, Bundle, Ledger,
   Receipt, cleanup, and outcome assertions: reached and passed.
4. Attempt 3 final no-sidecar assertion: `FAIL`; a WAL sidecar existed before
   the test reached that assertion.
5. Remaining focused family matrix: not run after the mandatory failure.
6. V2 orchestrator matrix: not rerun after the mandatory failure.
7. Lint, full suite, Web build, Worker build, and final diff check: not run.

## Sidecar Cause And Restoration

The sidecars were transient files created during the preceding raw SQLite
shape inspection, which used `DatabaseSync(..., { readOnly: true })` directly
rather than the repository's immutable read-only URI wrapper. Their identities
were:

- WAL: zero bytes, SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- SHM: 32,768 bytes, SHA-256
  `fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb`

Both transient files were removed as cleanup. The accepted database remained
byte-identical throughout and the required final state is restored:

```text
databaseSha256 = 30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37
walExists = false
shmExists = false
```

## Historical Byte Identity

| Artifact | SHA-256 after stop |
|---|---|
| Attempt 4 database | `280d616ec1366ab00d81962b73fb5dfefe9e0b97fe9b71a64dbac20afeae8162` |
| Attempt 4 evidence JSON | `ea6a994968b93cd1dac2a192e8cb5cf6d409b4d11fc661a87237cd2850401b36` |
| Attempt 3 database | `30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37` |
| Attempt 3 evidence JSON | `49e54b83129310603bea9d3ac93301b528426e0036f00ac07c7c934374793077` |

Attempt 3 remains `PARTIAL / BLOCKED`, with `TEST_AND_FIX=FAILED`,
`BUILD_RESCUE=INCONCLUSIVE`, and no historical promotion.

## Effects

- Model calls: `0`
- Managed Sandboxes: `0`
- Live Jobs: `0`
- GitHub or Fixture mutations: `0`
- PRs, merges, deployments, payments, blockchain actions, billing actions,
  production credential expansion, candidate promotion, and Reputation work:
  `0`

## Exact Next Owner Decision

Owner approval is required to resume from the restored sidecar-free state, add
and run the mandatory schema-family negative matrix, and perform one clean
complete V2 pre-live regression rerun using only the repository's immutable
read-only historical-store path. No live corpus Attempt or Reputation work is
authorized.
