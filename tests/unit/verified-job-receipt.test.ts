import { randomUUID } from "node:crypto";
import { arch } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  DemoStore,
  computeEvidenceLedgerEntryHash,
  computeReceiptSha256,
  sha256Canonical,
  toPublicJobReceipt,
  type EvidenceLedgerEntryRecord,
  type JobReceiptRecord,
  type VerifiedJobReceiptDocument,
} from "@donelayer/database";

const stores: DemoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("Verified Job Receipt v1", () => {
  it("does not issue a formal receipt before verification or for DemoExecutor output", () => {
    const store = createStore();
    const worker = store.createWorker("provider-alpha", "Unverified Receipt Worker", "WINDOWS");
    const smoke = store.createWorkerSmokeTask(worker.id);
    expect(smoke.jobRun).toBeTruthy();
    expect(store.getJobReceiptByJobRun(smoke.jobRun!.id)).toBeNull();

    const demoTask = store.createDemoTask();
    let demo = store.getTaskAggregate(demoTask.id);
    while (demo.task.status !== "COMPLETED") demo = store.advanceDemo(demo.task.id);
    expect(demo.jobRun?.executor).toBe("DEMO");
    expect(demo.receipt).toBeNull();
  });

  it("hashes the complete canonical receipt and exposes only public whitelist fields", () => {
    const { record, entries } = receiptFixture();
    const publicReceipt = toPublicJobReceipt(record, entries);

    expect(record.receiptSha256).toBe(computeReceiptSha256(record.receipt));
    expect(publicReceipt).toEqual({
      publicReceiptId: record.receiptPublicId,
      taskType: "Worker Infrastructure Verification",
      agentIdentity: "DoneLayer Smoke Agent",
      workerIdentity: "Receipt Test Worker",
      contractSha256: "a".repeat(64),
      evidenceChainSha256: record.evidenceChainSha256,
      artifactSha256: "b".repeat(64),
      verificationSummary: "artifact-hash: PASSED, workspace-cleaned: PASSED",
      result: "VERIFIED",
      createdAt: record.createdAt,
      verificationStatus: "VALID",
      invalidated: false,
      disputed: false,
      scopeDisclaimer: "This receipt verifies a Worker infrastructure workflow. It is not a customer coding task receipt.",
    });
    expect(Object.keys(publicReceipt).sort()).toEqual([
      "agentIdentity",
      "artifactSha256",
      "contractSha256",
      "createdAt",
      "disputed",
      "evidenceChainSha256",
      "invalidated",
      "publicReceiptId",
      "result",
      "scopeDisclaimer",
      "taskType",
      "verificationStatus",
      "verificationSummary",
      "workerIdentity",
    ]);

    const serialized = JSON.stringify(publicReceipt);
    for (const secret of [
      record.receipt.whoRequested.customerReference,
      record.taskId,
      record.jobRunId,
      record.permissionLeaseId,
      record.receipt.whoExecuted.agentId,
      record.receipt.whoExecuted.workerId,
      record.receipt.whoExecuted.providerId,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("capabilitySnapshot");
    expect(serialized).not.toContain("allowedActions");
    expect(serialized).not.toContain("permissionViolations");
    expect(serialized).not.toContain("storagePath");
  });

  it("keeps Receipt integrity VALID while the real build and test outcome is FAILED", () => {
    const { record, entries } = failedBuildTestReceiptFixture();
    const publicReceipt = toPublicJobReceipt(record, entries);

    expect(publicReceipt).toMatchObject({
      taskType: "Real Build and Test Verification",
      result: "FAILED",
      verificationStatus: "VALID",
      artifactSha256: "d".repeat(64),
      buildTest: {
        sourceManifestSha256: "c".repeat(64),
        sourcePackageSha256: "d".repeat(64),
        install: { command: "npm ci --ignore-scripts --no-audit --no-fund", exitCode: 0, status: "PASSED" },
        build: { command: "npm run build", exitCode: 0, status: "PASSED" },
        test: { command: "npm test", exitCode: 1, status: "FAILED" },
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        providerPayoutReleased: false,
      },
      scopeDisclaimer: "This receipt records a real build and test execution for the specified repository commit. The receipt is cryptographically consistent, but the task result is FAILED because one or more required automated tests did not pass.",
    });
  });

  it("requires the stored result and documented Ledger anchor to match the hashed Receipt", () => {
    const fixture = failedBuildTestReceiptFixture();
    const resultMismatch: JobReceiptRecord = { ...fixture.record, result: "VERIFIED" };

    expect(toPublicJobReceipt(resultMismatch, fixture.entries)).toMatchObject({
      result: "FAILED",
      verificationStatus: "INVALID",
    });

    const ledgerClaimMismatch = structuredClone(fixture.record);
    ledgerClaimMismatch.receipt.howVerified.evidenceLedger.chainSha256 = "e".repeat(64);
    ledgerClaimMismatch.receiptSha256 = computeReceiptSha256(ledgerClaimMismatch.receipt);
    const rebuiltEntries = structuredClone(fixture.entries);
    const receiptEntry = rebuiltEntries.at(-1)!;
    receiptEntry.payloadSha256 = ledgerClaimMismatch.receiptSha256;
    receiptEntry.entrySha256 = computeEvidenceLedgerEntryHash(receiptEntry);

    expect(toPublicJobReceipt(ledgerClaimMismatch, rebuiltEntries)).toMatchObject({
      result: "FAILED",
      verificationStatus: "INVALID",
    });
  });

  it("invalidates verification when receipt content or its Evidence Ledger anchor is tampered", () => {
    const { record, entries } = receiptFixture();
    const receiptTamper = structuredClone(record);
    receiptTamper.receipt.whatWasAgreed.desiredOutcome = "Tampered outcome";

    expect(computeReceiptSha256(receiptTamper.receipt)).not.toBe(record.receiptSha256);
    expect(toPublicJobReceipt(receiptTamper, entries)).toMatchObject({
      verificationStatus: "INVALID",
    });

    const ledgerTamper = structuredClone(entries);
    ledgerTamper[0]!.sourceRecordId = "tampered-source";
    expect(toPublicJobReceipt(record, ledgerTamper)).toMatchObject({
      verificationStatus: "INVALID",
      result: "VERIFIED",
    });

    const unanchored = structuredClone(entries);
    unanchored[1]!.payloadSha256 = "c".repeat(64);
    unanchored[1]!.entrySha256 = computeEvidenceLedgerEntryHash(unanchored[1]!);
    expect(toPublicJobReceipt(record, unanchored)).toMatchObject({
      verificationStatus: "INVALID",
    });
  });

  it("marks an invalidated receipt without changing its cryptographic verification or exposing the private reason", () => {
    const { record, entries } = receiptFixture();
    const invalidated: JobReceiptRecord = {
      ...record,
      invalidatedAt: "2026-08-26T12:02:00.000Z",
      invalidationReason: "Private operator investigation notes",
    };
    const publicReceipt = toPublicJobReceipt(invalidated, entries);

    expect(publicReceipt).toMatchObject({ invalidated: true, verificationStatus: "VALID" });
    expect(JSON.stringify(publicReceipt)).not.toContain(invalidated.invalidationReason!);
  });

  it("allows invalidation metadata while keeping persisted receipt content immutable", () => {
    const store = createStore();
    const worker = store.createWorker("provider-alpha", "Receipt Persistence Worker", "WINDOWS");
    const aggregate = store.createWorkerSmokeTask(worker.id);
    if (!aggregate.jobRun?.taskContractVersionId) {
      throw new Error("Smoke Job is not bound to a Task Contract");
    }
    const permissionLease = store.getPermissionLeaseForJob(aggregate.jobRun.id);
    if (!permissionLease) throw new Error("Smoke Job has no Permission Lease");
    const { record } = receiptFixture({
      taskId: aggregate.task.id,
      jobRunId: aggregate.jobRun.id,
      taskContractVersionId: aggregate.jobRun.taskContractVersionId,
      permissionLeaseId: permissionLease.id,
    });
    const db = databaseOf(store);
    db.prepare(`
      INSERT INTO job_receipts(
        id,receipt_public_id,task_id,job_run_id,task_contract_version_id,permission_lease_id,
        result,receipt_json,receipt_sha256,evidence_chain_sha256,created_at,invalidated_at,invalidation_reason
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)
    `).run(
      record.id,
      record.receiptPublicId,
      record.taskId,
      record.jobRunId,
      record.taskContractVersionId,
      record.permissionLeaseId,
      record.result,
      JSON.stringify(record.receipt),
      record.receiptSha256,
      record.evidenceChainSha256,
      record.createdAt,
    );
    const originalJson = JSON.stringify(record.receipt);

    expect(() =>
      db.prepare("UPDATE job_receipts SET invalidated_at=?, invalidation_reason=? WHERE id=?").run(
        "2026-08-26T12:02:00.000Z",
        "Operator invalidated receipt",
        record.id,
      ),
    ).not.toThrow();
    expect(db.prepare("SELECT receipt_json,invalidated_at FROM job_receipts WHERE id=?").get(record.id))
      .toMatchObject({
        receipt_json: originalJson,
        invalidated_at: "2026-08-26T12:02:00.000Z",
      });
    expect(() =>
      db.prepare("UPDATE job_receipts SET receipt_json=? WHERE id=?").run(
        JSON.stringify({ tampered: true }),
        record.id,
      ),
    ).toThrow(/immutable/i);
    expect(() => db.prepare("DELETE FROM job_receipts WHERE id=?").run(record.id)).toThrow(
      /cannot be deleted/i,
    );
  });
});

function receiptFixture(
  ids: Partial<Pick<JobReceiptRecord, "taskId" | "jobRunId" | "taskContractVersionId" | "permissionLeaseId">> = {},
): { record: JobReceiptRecord; entries: EvidenceLedgerEntryRecord[] } {
  const taskId = ids.taskId ?? randomUUID();
  const jobRunId = ids.jobRunId ?? randomUUID();
  const taskContractVersionId = ids.taskContractVersionId ?? randomUUID();
  const permissionLeaseId = ids.permissionLeaseId ?? randomUUID();
  const receiptId = randomUUID();
  const publicReceiptId = `dlr_${randomUUID().replaceAll("-", "")}`;
  const issuedAt = "2026-08-26T12:01:10.000Z";
  const receipt: VerifiedJobReceiptDocument = {
    schemaVersion: 1,
    receiptType: "WORKER_INFRASTRUCTURE_VERIFICATION",
    claim: "Hash-verifiable DoneLayer execution receipt.",
    publicReceiptId,
    whoRequested: {
      customerReference: "customer-private-reference",
      taskId,
      orderedAt: "2026-08-26T12:00:00.000Z",
    },
    whoExecuted: {
      agentId: randomUUID(),
      agentPublicIdentity: "DoneLayer Smoke Agent",
      agentVersion: "1.0.0",
      providerId: randomUUID(),
      workerId: randomUUID(),
      workerPublicIdentity: "Receipt Test Worker",
      workerVersion: "1.0.0",
      capabilitySnapshot: capabilities(),
      runtime: process.version,
      os: process.platform,
    },
    whatWasAgreed: {
      taskContractVersionId,
      contractVersion: 1,
      contractSha256: "a".repeat(64),
      desiredOutcome: "Produce a hash-verified hello.txt artifact.",
      deliverables: ["hello.txt"],
      acceptanceChecks: [
        {
          id: "artifact-hash",
          label: "Worker and Server SHA-256 match",
          required: true,
          type: "SHA256",
          config: { algorithm: "SHA-256" },
        },
      ],
    },
    whatWasPermitted: {
      permissionLeaseId,
      allowedActions: ["write_hello_txt", "upload_artifact"],
      deniedActions: ["network", "git", "arbitrary_shell"],
      effectiveAt: "2026-08-26T12:00:01.000Z",
      expiresAt: "2026-08-26T12:01:01.000Z",
      budgetLimit: { currency: "USD", maxAmount: 0 },
      permissionViolations: [],
    },
    whatHappened: {
      jobRunId,
      startedAt: "2026-08-26T12:00:02.000Z",
      finishedAt: "2026-08-26T12:01:00.000Z",
      durationMs: 58_000,
      importantRunEvents: [
        { type: "JOB_CLAIMED", createdAt: "2026-08-26T12:00:01.000Z" },
        { type: "WORKSPACE_CLEANED", createdAt: "2026-08-26T12:01:00.000Z" },
      ],
      artifacts: [
        {
          id: randomUUID(),
          fileName: "hello.txt",
          mimeType: "text/plain",
          size: 128,
          sha256: "b".repeat(64),
        },
      ],
      workspaceCleaned: true,
    },
    howVerified: {
      checks: [
        { id: "artifact-hash", status: "PASSED", summary: "Worker and Server SHA-256 matched." },
        { id: "workspace-cleaned", status: "PASSED", summary: "Workspace cleanup was recorded." },
      ],
      workerSha256: "b".repeat(64),
      serverSha256: "b".repeat(64),
      evidenceLedger: {
        valid: true,
        entryCount: 1,
        chainSha256: null,
        invalidSequence: null,
        reason: null,
      },
      humanApproval: null,
    },
    finalResult: "VERIFIED",
    issuedAt,
  };
  const preReceipt = ledgerEntry({
    taskId,
    jobRunId,
    sequenceNumber: 1,
    previousEntrySha256: null,
    entryType: "VERIFICATION_PASSED",
    sourceRecordType: "verification_result",
    sourceRecordId: randomUUID(),
    payloadSha256: sha256Canonical({ passed: true }),
    createdAt: "2026-08-26T12:01:05.000Z",
  });
  receipt.howVerified.evidenceLedger = {
    valid: true,
    entryCount: 1,
    chainSha256: preReceipt.entrySha256,
    invalidSequence: null,
    reason: null,
  };
  const receiptSha256 = computeReceiptSha256(receipt);
  const receiptEntry = ledgerEntry({
    taskId,
    jobRunId,
    sequenceNumber: 2,
    previousEntrySha256: preReceipt.entrySha256,
    entryType: "RECEIPT_CREATED",
    sourceRecordType: "job_receipt",
    sourceRecordId: receiptId,
    payloadSha256: receiptSha256,
    createdAt: issuedAt,
  });
  const record: JobReceiptRecord = {
    id: receiptId,
    receiptPublicId: publicReceiptId,
    taskId,
    jobRunId,
    taskContractVersionId,
    permissionLeaseId,
    result: "VERIFIED",
    receipt,
    receiptSha256,
    evidenceChainSha256: preReceipt.entrySha256,
    createdAt: issuedAt,
    invalidatedAt: null,
    invalidationReason: null,
  };
  return { record, entries: [preReceipt, receiptEntry] };
}

function failedBuildTestReceiptFixture(): {
  record: JobReceiptRecord;
  entries: EvidenceLedgerEntryRecord[];
} {
  const base = receiptFixture();
  const issuedAt = base.record.createdAt;
  const receipt = structuredClone(base.record.receipt);
  receipt.receiptType = "REAL_BUILD_TEST_MANAGED_SANDBOX_VERIFICATION";
  receipt.finalResult = "FAILED";
  receipt.howVerified.checks = [
    { id: "dependency-install", status: "PASSED", summary: "npm ci exited zero." },
    { id: "build", status: "PASSED", summary: "The build exited zero." },
    { id: "tests-pass", status: "FAILED", summary: "One required automated test failed." },
  ];
  receipt.whatHappened.buildTest = buildTestSummary();

  const verificationEntry = ledgerEntry({
    taskId: base.record.taskId,
    jobRunId: base.record.jobRunId,
    sequenceNumber: 1,
    previousEntrySha256: null,
    entryType: "VERIFICATION_FAILED",
    sourceRecordType: "verification_result",
    sourceRecordId: randomUUID(),
    payloadSha256: sha256Canonical({ result: "FAILED", failedCheckId: "tests-pass" }),
    createdAt: "2026-08-26T12:01:05.000Z",
  });
  receipt.howVerified.evidenceLedger = {
    valid: true,
    entryCount: 1,
    chainSha256: verificationEntry.entrySha256,
    invalidSequence: null,
    reason: null,
  };
  const receiptSha256 = computeReceiptSha256(receipt);
  const receiptEntry = ledgerEntry({
    taskId: base.record.taskId,
    jobRunId: base.record.jobRunId,
    sequenceNumber: 2,
    previousEntrySha256: verificationEntry.entrySha256,
    entryType: "RECEIPT_CREATED",
    sourceRecordType: "job_receipt",
    sourceRecordId: base.record.id,
    payloadSha256: receiptSha256,
    createdAt: issuedAt,
  });

  return {
    record: {
      ...base.record,
      result: "FAILED",
      receipt,
      receiptSha256,
      evidenceChainSha256: verificationEntry.entrySha256,
    },
    entries: [verificationEntry, receiptEntry],
  };
}

function buildTestSummary(): NonNullable<VerifiedJobReceiptDocument["whatHappened"]["buildTest"]> {
  const artifact = (prefix: string, sha256: string) => ({
    fileName: `${prefix}.log`,
    sha256,
  });
  return {
    sourceManifestSha256: "c".repeat(64),
    sourcePackageSha256: "d".repeat(64),
    nodeVersion: "v24.15.0",
    npmVersion: "11.5.1",
    install: {
      command: "npm ci --ignore-scripts --no-audit --no-fund",
      exitCode: 0,
      durationMs: 900,
      status: "PASSED",
      stdoutArtifact: artifact("install-stdout", "1".repeat(64)),
      stderrArtifact: artifact("install-stderr", "2".repeat(64)),
    },
    build: {
      command: "npm run build",
      exitCode: 0,
      durationMs: 400,
      status: "PASSED",
      stdoutArtifact: artifact("build-stdout", "3".repeat(64)),
      stderrArtifact: artifact("build-stderr", "4".repeat(64)),
    },
    test: {
      command: "npm test",
      exitCode: 1,
      durationMs: 300,
      status: "FAILED",
      stdoutArtifact: artifact("test-stdout", "5".repeat(64)),
      stderrArtifact: artifact("test-stderr", "6".repeat(64)),
    },
    testRunner: "node:test",
    totalTests: 2,
    passedTests: 1,
    failedTests: 1,
    statisticsStatus: "PARSED",
    sourceMutationDetected: false,
    networkViolationCount: 0,
    permissionViolationCount: 0,
    providerPayoutReleased: false,
  };
}

function ledgerEntry(
  entry: Omit<EvidenceLedgerEntryRecord, "id" | "entrySha256">,
): EvidenceLedgerEntryRecord {
  return {
    ...entry,
    id: randomUUID(),
    entrySha256: computeEvidenceLedgerEntryHash(entry),
  };
}

function capabilities() {
  return {
    os: process.platform === "win32" ? "windows" as const : process.platform === "darwin" ? "macos" as const : "linux" as const,
    architecture: arch(),
    cpuCount: 1,
    nodeVersion: process.version,
    npmVersion: "11.0.0",
    workerVersion: "1.0.0",
    processId: process.pid,
    memoryBytes: 1024 * 1024 * 1024,
    availableMemoryBytes: 512 * 1024 * 1024,
    freeDiskBytes: 1024 * 1024 * 1024,
    dockerAvailable: false,
    codexAvailable: false,
    gitAvailable: false,
    githubCliAvailable: false,
    supportedLanguages: ["JavaScript/TypeScript"],
    installedTools: ["node", "npm"],
    mcpServers: [],
    executors: ["worker-smoke" as const],
    maxConcurrentJobs: 1,
  };
}

function createStore(): DemoStore {
  const store = new DemoStore(":memory:");
  stores.push(store);
  return store;
}

function databaseOf(store: DemoStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db;
}
