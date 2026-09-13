import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { DemoStore } from "@donelayer/database";
import {
  MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS,
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  managedSandboxBuildTestSecurityProfile,
} from "@donelayer/worker-protocol";

const stores: DemoStore[] = [];

type ManagedBuildTestSource = Parameters<DemoStore["createManagedBuildTestTask"]>[0];

type BuildTestContext = {
  store: DemoStore;
  taskId: string;
  jobRunId: string;
  runId: string;
  source: ManagedBuildTestSource;
  sourceManifestBytes: Buffer;
  timestamp: (offsetMs: number) => string;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("DemoStore managed build/test workflow", () => {
  it("records a hash-valid FAILED Receipt for nonzero fixture test evidence", () => {
    const context = prepareBuildTest();
    persistBuildTestArtifacts(context);
    stopSandbox(context, true);
    persistBuildTestArtifacts(context, { afterCleanup: true });

    const completed = context.store.completeManagedBuildTest(context.runId);
    const permission = completed.permissionLease;
    const receipt = completed.receipt;
    if (!permission || !receipt) throw new Error("Expected completed Permission and FAILED Receipt");

    const ledger = context.store.verifyLedgerChain(context.jobRunId);
    const ledgerEntries = context.store.listEvidenceLedgerEntries(context.jobRunId);
    const publicReceipt = context.store.getPublicJobReceipt(receipt.receiptPublicId);

    expect(completed.task.status).toBe("VERIFICATION_FAILED");
    expect(completed.jobRun).toMatchObject({ status: "FAILED", exitCode: 1 });
    expect(permission.status).toBe("COMPLETED");
    expect(ledger).toMatchObject({ valid: true, entryCount: ledgerEntries.length });
    expect(ledgerEntries.at(-1)?.entryType).toBe("RECEIPT_CREATED");
    expect(ledgerEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ entryType: "CONTRACT_LOCKED" }),
      expect.objectContaining({ entryType: "REPOSITORY_VERIFIED" }),
      expect.objectContaining({ entryType: "SOURCE_PACKAGE_VERIFIED" }),
      expect.objectContaining({ entryType: "DEPENDENCY_INSTALL_COMPLETED" }),
      expect.objectContaining({ entryType: "BUILD_COMPLETED" }),
      expect.objectContaining({ entryType: "TEST_FAILED" }),
      expect.objectContaining({ entryType: "SOURCE_INTEGRITY_VERIFIED" }),
      expect.objectContaining({ entryType: "MANAGED_SANDBOX_CLEANUP_VERIFIED" }),
      expect.objectContaining({ entryType: "VERIFICATION_FAILED" }),
    ]));

    expect(receipt).toMatchObject({
      result: "FAILED",
      receipt: {
        receiptType: "REAL_BUILD_TEST_MANAGED_SANDBOX_VERIFICATION",
        finalResult: "FAILED",
        whatHappened: {
          buildTest: {
            install: { command: "npm ci --ignore-scripts --no-audit --no-fund", exitCode: 0, status: "PASSED" },
            build: { command: "npm run build", exitCode: 0, status: "PASSED" },
            test: { command: "npm test", exitCode: 1, status: "FAILED" },
            sourceMutationDetected: false,
            providerPayoutReleased: false,
          },
          repositoryMaterialization: {
            noRepositoryCodeExecuted: false,
          },
        },
      },
    });
    expect(publicReceipt).toMatchObject({
      taskType: "Real Build and Test Verification",
      verificationStatus: "VALID",
      result: "FAILED",
      buildTest: {
        install: { exitCode: 0, status: "PASSED" },
        build: { exitCode: 0, status: "PASSED" },
        test: { exitCode: 1, status: "FAILED" },
        sourceMutationDetected: false,
        providerPayoutReleased: false,
      },
      managedSandbox: {
        cleanupVerified: true,
        localHostExecutionUsed: false,
        localDockerUsed: false,
        persistentSnapshotCreated: false,
      },
    });
    expect(completed.verificationResults.find((result) => result.checkId === "automated-tests-pass"))
      .toMatchObject({ status: "FAILED" });
    expect(completed.ledgerEntries.some((entry) => entry.entryType === "RELEASE")).toBe(false);
    expect(ledgerEntries.some((entry) => entry.entryType === "VERIFICATION_PASSED")).toBe(false);
  });

  it("rejects a repository or independently verified Commit outside the locked identity", () => {
    const store = createStore();
    const fixture = sourceFixture();

    expect(() => store.createManagedBuildTestTask({
      ...fixture.source,
      remoteUrl: "https://github.com/example/not-the-fixture.git",
    } as unknown as ManagedBuildTestSource)).toThrow(/allowlist/i);
    expect(() => store.createManagedBuildTestTask({
      ...fixture.source,
      independentRemoteCommitSha: "d".repeat(40),
    })).toThrow(/source identity is invalid/i);
  });

  it("cannot turn an unexpectedly successful test command into success", () => {
    const context = prepareBuildTest({ recordTest: false, recordIntegrity: false });

    expect(() => context.store.recordManagedBuildTestCommand(context.runId, {
      phase: "test",
      command: "npm test",
      exitCode: 0,
      startedAt: context.timestamp(7_000),
      finishedAt: context.timestamp(7_100),
      durationMs: 100,
    })).toThrow(/unexpectedly passed/i);

    const aggregate = context.store.getTaskAggregate(context.taskId);
    expect(aggregate.task.status).toBe("RUNNING");
    expect(aggregate.jobRun?.status).toBe("RUNNING");
    expect(aggregate.receipt).toBeNull();
    expect(aggregate.evidenceLedger.some((entry) => entry.entryType === "TEST_FAILED")).toBe(false);
    expect(aggregate.evidenceLedger.some((entry) => entry.entryType === "VERIFICATION_PASSED")).toBe(false);
  });

  it("detects Source mutation evidence and refuses to record Source integrity", () => {
    const context = prepareBuildTest({ recordIntegrity: false });

    expect(() => context.store.recordManagedBuildTestSourceIntegrity(context.runId, {
      commitSha: context.source.commitSha,
      manifestSha256: context.source.manifestSha256,
      checkedFileCount: context.source.fileCount,
      sourceMutationDetected: true,
      missing: [],
      modified: ["src/add.ts"],
      added: [],
      verifiedAt: context.timestamp(8_000),
    })).toThrow(/SOURCE_MUTATION_DETECTED/);

    const aggregate = context.store.getTaskAggregate(context.taskId);
    expect(aggregate.receipt).toBeNull();
    expect(aggregate.evidenceLedger.some((entry) => entry.entryType === "SOURCE_INTEGRITY_VERIFIED"))
      .toBe(false);
  });

  it("cannot complete while provider cleanup remains unverified", () => {
    const context = prepareBuildTest();
    persistBuildTestArtifacts(context);
    stopSandbox(context, false);

    expect(context.store.getManagedSandboxRun(context.runId)?.status).toBe("CLEANUP_UNVERIFIED");
    expect(() => context.store.completeManagedBuildTest(context.runId)).toThrow(/must be DESTROYED/i);
    expect(context.store.getJobReceiptByJobRun(context.jobRunId)).toBeNull();
    expect(context.store.getPermissionLeaseForJob(context.jobRunId)?.status).toBe("ACTIVE");
  });

  it("rejects a missing Artifact and a mismatched claimed Artifact hash", () => {
    const missingContext = prepareBuildTest();
    persistBuildTestArtifacts(missingContext, { skip: "test-stderr.log" });
    stopSandbox(missingContext, true);
    persistBuildTestArtifacts(missingContext, { skip: "test-stderr.log", afterCleanup: true });

    expect(() => missingContext.store.completeManagedBuildTest(missingContext.runId))
      .toThrow(/Artifact test-stderr\.log is missing/i);
    expect(missingContext.store.getJobReceiptByJobRun(missingContext.jobRunId)).toBeNull();

    const hashContext = prepareBuildTest();
    const bytes = Buffer.from("tampered provider evidence\n");
    expect(() => hashContext.store.persistManagedSandboxArtifact({
      runId: hashContext.runId,
      artifactType: "UNIT_MANAGED_BUILD_TEST_EVIDENCE",
      fileName: "managed-build-test-provider.json",
      mimeType: "application/json",
      content: bytes,
      claimedSha256: "0".repeat(64),
    })).toThrow(/SHA-256 mismatch/i);
    expect(hashContext.store.getTaskAggregate(hashContext.taskId).evidence).toHaveLength(0);
  });

  it("rejects hash-valid context Artifacts that are not bound to the locked run", () => {
    const mutations: Array<[string, (value: Record<string, unknown>) => void]> = [
      ["repository-materialization.json", (value) => { value.independentRemoteCommitSha = "d".repeat(40); }],
      ["source-package-metadata.json", (value) => { value.sourcePackageSha256 = "d".repeat(64); }],
      ["managed-build-test-provider.json", (value) => {
        (value.inspection as Record<string, unknown>).sandboxId = "sbx-not-this-run";
      }],
      ["managed-build-test-policy.json", (value) => { value.timeoutMs = 1; }],
      ["managed-build-test-lifecycle.json", (value) => {
        (value.finalNetworkPolicy as Record<string, unknown>).mode = "custom";
      }],
      ["managed-build-test-cleanup.json", (value) => { value.finalProviderState = "running"; }],
    ];

    for (const [fileName, mutate] of mutations) {
      const context = prepareBuildTest();
      const original = buildTestArtifactPayloads(context).get(fileName);
      if (!original) throw new Error(`Missing unit Artifact ${fileName}`);
      const value = JSON.parse(original.toString("utf8")) as Record<string, unknown>;
      mutate(value);
      const overrides = new Map([[fileName, Buffer.from(`${JSON.stringify(value)}\n`)]]);
      persistBuildTestArtifacts(context, { overrides });
      stopSandbox(context, true);
      persistBuildTestArtifacts(context, { afterCleanup: true, overrides });

      expect(() => context.store.completeManagedBuildTest(context.runId)).toThrow();
      expect(context.store.getJobReceiptByJobRun(context.jobRunId)).toBeNull();
    }
  });

  it("does not issue a Receipt from a tampered Evidence Ledger", () => {
    const context = prepareBuildTest();
    persistBuildTestArtifacts(context);
    stopSandbox(context, true);
    persistBuildTestArtifacts(context, { afterCleanup: true });
    const db = databaseOf(context.store);
    db.exec("DROP TRIGGER trg_evidence_ledger_no_update");
    db.prepare("UPDATE evidence_ledger_entries SET entry_sha256=? WHERE job_run_id=? AND sequence_number=1")
      .run("f".repeat(64), context.jobRunId);

    expect(() => context.store.completeManagedBuildTest(context.runId)).toThrow(/Ledger is invalid/i);
    expect(context.store.getJobReceiptByJobRun(context.jobRunId)).toBeNull();
  });
});

function prepareBuildTest(options: {
  recordTest?: boolean;
  recordIntegrity?: boolean;
} = {}): BuildTestContext {
  const store = createStore();
  const fixture = sourceFixture();
  const aggregate = store.createManagedBuildTestTask(fixture.source);
  const taskId = aggregate.task.id;
  const jobRunId = aggregate.jobRun?.id;
  if (!jobRunId) throw new Error("Managed build/test Job was not created");
  const runId = store.getManagedSandboxRunForJob(jobRunId)?.id;
  if (!runId) throw new Error("Managed build/test Sandbox Run was not created");
  const baseTime = Date.now() - 60_000;
  const timestamp = (offsetMs: number) => new Date(baseTime + offsetMs).toISOString();
  const context = {
    store,
    taskId,
    jobRunId,
    runId,
    source: fixture.source,
    sourceManifestBytes: fixture.sourceManifestBytes,
    timestamp,
  };

  store.startManagedSandboxJob(jobRunId);
  store.markManagedSandboxCreated({
    runId,
    providerSandboxId: "sbx-managed-build-test-unit",
    providerRequestId: "request-managed-build-test-unit",
    region: "iad1",
    inspection: providerInspection(context),
    providerMetadata: providerMetadata(),
  });
  const profile = managedSandboxBuildTestSecurityProfile(fixture.source.commitSha, true);
  store.markManagedSandboxPolicyVerified(runId, {
    initial: { mode: "deny-all", allowedDomains: [], allowedCidrs: [] },
    install: profile.installNetworkPolicy,
    final: profile.finalNetworkPolicy,
    persistent: false,
    snapshot: false,
    timeoutMs: profile.timeoutMs,
    vcpus: profile.vcpus,
    ports: [],
    uploadedFiles: profile.uploadedFiles,
    environmentVariableNames: profile.environmentVariableNames,
    commands: profile.commands,
    localHostExecution: false,
    localDockerExecution: false,
  });
  store.recordManagedBuildTestSourceUploaded(runId, {
    commitSha: fixture.source.commitSha,
    manifestSha256: fixture.source.manifestSha256,
    sourcePackageManifestSha256: fixture.source.sourcePackageManifestSha256,
    sourcePackageSha256: fixture.source.sourcePackageSha256,
    packageVerified: true,
    manifestVerified: true,
    commitVerified: true,
    extracted: true,
    nodeVersion: "v24.15.0",
    npmVersion: "11.5.1",
    buildScriptPresent: true,
  });
  store.recordManagedBuildTestNetworkPolicy(runId, {
    phase: "INSTALL",
    mode: "custom",
    allowedDomains: ["registry.npmjs.org"],
    allowedCidrs: [],
    observedAt: timestamp(1_000),
  });
  store.recordManagedBuildTestCommand(runId, {
    phase: "install",
    command: "npm ci --ignore-scripts --no-audit --no-fund",
    exitCode: 0,
    startedAt: timestamp(2_000),
    finishedAt: timestamp(2_400),
    durationMs: 400,
  });
  store.recordManagedBuildTestNetworkPolicy(runId, {
    phase: "FINAL",
    mode: "deny-all",
    allowedDomains: [],
    allowedCidrs: [],
    observedAt: timestamp(3_000),
  });
  store.recordManagedBuildTestCommand(runId, {
    phase: "build",
    command: "npm run build",
    exitCode: 0,
    startedAt: timestamp(4_000),
    finishedAt: timestamp(4_300),
    durationMs: 300,
  });
  if (options.recordTest !== false) {
    store.recordManagedBuildTestCommand(runId, {
      phase: "test",
      command: "npm test",
      exitCode: 1,
      startedAt: timestamp(5_000),
      finishedAt: timestamp(5_250),
      durationMs: 250,
    });
  }
  if (options.recordIntegrity !== false) {
    store.recordManagedBuildTestSourceIntegrity(runId, {
      commitSha: fixture.source.commitSha,
      manifestSha256: fixture.source.manifestSha256,
      checkedFileCount: fixture.source.fileCount,
      sourceMutationDetected: false,
      missing: [],
      modified: [],
      added: [],
      verifiedAt: timestamp(6_000),
    });
  }
  return context;
}

function persistBuildTestArtifacts(
  context: BuildTestContext,
  options: { skip?: string; afterCleanup?: boolean; overrides?: Map<string, Buffer> } = {},
): void {
  const payloads = buildTestArtifactPayloads(context);
  const cleanupArtifacts = new Set([
    "managed-build-test-lifecycle.json",
    "managed-build-test-cleanup.json",
  ]);
  for (const fileName of MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS) {
    if (fileName === options.skip) continue;
    if (cleanupArtifacts.has(fileName) !== Boolean(options.afterCleanup)) continue;
    const content = options.overrides?.get(fileName) ?? payloads.get(fileName);
    if (!content) throw new Error(`Unit fixture is missing ${fileName}`);
    context.store.persistManagedSandboxArtifact({
      runId: context.runId,
      artifactType: "UNIT_MANAGED_BUILD_TEST_EVIDENCE",
      fileName,
      mimeType: fileName.endsWith(".json") ? "application/json" : "text/plain",
      content,
      claimedSha256: sha256(content),
    });
  }
}

function buildTestArtifactPayloads(context: BuildTestContext): Map<string, Buffer> {
  const installStdout = Buffer.from("added 1 package in 1s\n");
  const installStderr = Buffer.from("\n");
  const buildStdout = Buffer.from("build complete\n");
  const buildStderr = Buffer.from("\n");
  const testStdout = Buffer.from("tests 2, pass 1, fail 1\n");
  const testStderr = Buffer.from("AssertionError: intentional fixture failure\n");
  const reference = (fileName: string, content: Buffer) => ({ fileName, sha256: sha256(content) });
  const json = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
  const profile = managedSandboxBuildTestSecurityProfile(context.source.commitSha, true);
  const inspection = providerInspection(context);
  const installNetworkPolicy = {
    mode: "custom",
    allowedDomains: ["registry.npmjs.org"],
    allowedCidrs: [],
    observedAt: context.timestamp(1_000),
  };
  const finalNetworkPolicy = {
    mode: "deny-all",
    allowedDomains: [],
    allowedCidrs: [],
    observedAt: context.timestamp(3_000),
  };
  const installResult = {
    command: "npm ci --ignore-scripts --no-audit --no-fund",
    commandId: "cmd-install-unit",
    startedAt: context.timestamp(2_000),
    finishedAt: context.timestamp(2_400),
    durationMs: 400,
    exitCode: 0,
    status: "PASSED",
    stdoutArtifact: reference("install-stdout.log", installStdout),
    stderrArtifact: reference("install-stderr.log", installStderr),
  };
  const buildResult = {
    command: "npm run build",
    commandId: "cmd-build-unit",
    startedAt: context.timestamp(4_000),
    finishedAt: context.timestamp(4_300),
    durationMs: 300,
    exitCode: 0,
    status: "PASSED",
    stdoutArtifact: reference("build-stdout.log", buildStdout),
    stderrArtifact: reference("build-stderr.log", buildStderr),
  };
  const testResult = {
    command: "npm test",
    commandId: "cmd-test-unit",
    startedAt: context.timestamp(5_000),
    finishedAt: context.timestamp(5_250),
    durationMs: 250,
    exitCode: 1,
    status: "FAILED",
    stdoutArtifact: reference("test-stdout.log", testStdout),
    stderrArtifact: reference("test-stderr.log", testStderr),
    testRunner: "node:test",
    totalTests: 2,
    passedTests: 1,
    failedTests: 1,
    statisticsStatus: "PARSED",
  };
  const cleanup = providerCleanup(context);

  const payloads = new Map<string, Buffer>([
    ["repository-materialization.json", json({
      schemaVersion: 1,
      remoteUrl: context.source.remoteUrl,
      branch: context.source.branch,
      materializerCommitSha: context.source.commitSha,
      independentRemoteCommitSha: context.source.independentRemoteCommitSha,
      fileCount: context.source.fileCount,
      manifestSha256: context.source.manifestSha256,
      clone: {
        startedAt: context.source.cloneStartedAt,
        finishedAt: context.source.cloneFinishedAt,
        durationMs: context.source.cloneDurationMs,
        exitCode: 0,
        stdout: "",
        stderr: "Cloning into '<MATERIALIZER_WORKSPACE>\\repository'...",
      },
      remoteVerifiedAt: "2026-08-31T00:00:02.000Z",
      noRepositoryCodeExecuted: true,
      materializerWorkspaceCleaned: true,
    })],
    ["source-package-metadata.json", json({
      schemaVersion: 1,
      format: "DONELAYER_SOURCE_PACKAGE_JSON_V1",
      sourcePackageBytes: context.source.sourcePackageBytes,
      sourcePackageSha256: context.source.sourcePackageSha256,
      sourcePackageManifestSha256: context.source.sourcePackageManifestSha256,
      repositoryManifestSha256: context.source.manifestSha256,
    })],
    ["source-package-manifest.json", context.sourceManifestBytes],
    ["managed-build-test-provider.json", json({
      availability: {
        available: true,
        provider: "VERCEL_SANDBOX",
        checkedAt: context.timestamp(-2_000),
        authentication: "VERCEL_OIDC_DEVELOPMENT",
        errorCode: null,
        errorMessage: null,
      },
      metadata: providerMetadata(),
      inspection,
    })],
    ["managed-build-test-policy.json", json(profile)],
    ["source-package-verification.json", json({
      schemaVersion: 1,
      repositoryUrl: context.source.remoteUrl,
      branch: context.source.branch,
      commitSha: context.source.commitSha,
      manifestSha256: context.source.manifestSha256,
      sourcePackageManifestSha256: context.source.sourcePackageManifestSha256,
      sourcePackageSha256: context.source.sourcePackageSha256,
      fileCount: context.source.fileCount,
      totalSourceBytes: 512,
      packageVerified: true,
      manifestVerified: true,
      commitVerified: true,
      extracted: true,
      nodeVersion: "v24.15.0",
      npmVersion: "11.5.1",
      buildScriptPresent: true,
      installLifecycleScriptsPresent: false,
      verifiedAt: context.timestamp(500),
    })],
    ["install-result.json", json(installResult)],
    ["install-stdout.log", installStdout],
    ["install-stderr.log", installStderr],
    ["build-result.json", json(buildResult)],
    ["build-stdout.log", buildStdout],
    ["build-stderr.log", buildStderr],
    ["test-result.json", json(testResult)],
    ["test-stdout.log", testStdout],
    ["test-stderr.log", testStderr],
    ["source-integrity-result.json", json({
      schemaVersion: 1,
      commitSha: context.source.commitSha,
      manifestSha256: context.source.manifestSha256,
      checkedFileCount: context.source.fileCount,
      missing: [],
      modified: [],
      added: [],
      sourceMutationDetected: false,
      verifiedAt: context.timestamp(6_000),
    })],
    ["managed-build-test-lifecycle.json", json({
      created: inspection,
      installNetworkPolicy,
      finalNetworkPolicy,
      install: installResult,
      build: buildResult,
      test: testResult,
      cleanup,
    })],
    ["managed-build-test-cleanup.json", json(cleanup)],
  ]);
  return payloads;
}

function stopSandbox(context: BuildTestContext, cleanupVerified: boolean): void {
  const stoppedAt = context.timestamp(9_000);
  context.store.markManagedSandboxStopRequested(context.runId, context.timestamp(8_500));
  context.store.markManagedSandboxStopped(context.runId, {
    stopConfirmedAt: stoppedAt,
    finalProviderState: cleanupVerified ? "stopped" : "running",
    cleanupVerified,
    persistent: false,
    snapshotCreated: false,
    stillRunning: !cleanupVerified,
  });
}

function providerMetadata() {
  return {
    provider: "VERCEL_SANDBOX",
    sdkPackage: "@vercel/sandbox",
    sdkVersion: "3.2.1-unit",
    authentication: "VERCEL_OIDC_DEVELOPMENT",
  } as const;
}

function providerInspection(context: BuildTestContext) {
  return {
    provider: "VERCEL_SANDBOX",
    sandboxId: "sbx-managed-build-test-unit",
    sessionId: "session-managed-build-test-unit",
    status: "running",
    createdAt: context.timestamp(-1_500),
    statusUpdatedAt: context.timestamp(-1_000),
    region: "iad1",
    runtime: "node24",
    image: "node24",
    persistent: false,
    timeoutMs: 300_000,
    vcpus: 1,
    memoryMb: 2_048,
    networkPolicy: "deny-all",
    allowedDomains: [],
    allowedCidrs: [],
    portCount: 0,
    sourceSnapshotId: null,
    currentSnapshotId: null,
    cwd: "/vercel/sandbox",
  };
}

function providerCleanup(context: BuildTestContext) {
  return {
    sandboxId: "sbx-managed-build-test-unit",
    stopRequestedAt: context.timestamp(8_500),
    stopConfirmedAt: context.timestamp(9_000),
    finalProviderState: "stopped",
    persistent: false,
    snapshotCreated: false,
    stillRunning: false,
    cleanupVerified: true,
    usage: {
      totalActiveCpuDurationMs: 1_250,
      totalDurationMs: 9_500,
      totalIngressBytes: 4_096,
      totalEgressBytes: 8_192,
      costUsd: null,
    },
  };
}

function sourceFixture(): {
  source: ManagedBuildTestSource;
  sourceManifestBytes: Buffer;
} {
  const commitSha = "a".repeat(40);
  const manifestSha256 = "b".repeat(64);
  const sourcePackageSha256 = "c".repeat(64);
  const sourceManifestBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
    branch: REPOSITORY_MATERIALIZATION_BRANCH,
    commitSha,
    fileCount: 6,
    manifestSha256,
    sourcePackageSha256,
  })}\n`);
  return {
    sourceManifestBytes,
    source: {
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: REPOSITORY_MATERIALIZATION_BRANCH,
      commitSha,
      independentRemoteCommitSha: commitSha,
      fileCount: 6,
      manifestSha256,
      sourcePackageManifestSha256: sha256(sourceManifestBytes),
      sourcePackageSha256,
      sourcePackageBytes: 2_048,
      buildScriptPresent: true,
      cloneStartedAt: "2026-08-31T00:00:00.000Z",
      cloneFinishedAt: "2026-08-31T00:00:01.000Z",
      cloneDurationMs: 1_000,
      materializerWorkspaceCleaned: true,
    },
  };
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function createStore(): DemoStore {
  const store = new DemoStore(":memory:");
  stores.push(store);
  return store;
}

function databaseOf(store: DemoStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db;
}
