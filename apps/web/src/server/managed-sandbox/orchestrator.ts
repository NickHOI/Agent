import { createHash } from "node:crypto";

import type {
  DemoStore,
  EvidenceArtifactRecord,
  JobReceiptRecord,
  ManagedSandboxRunRecord,
  PublicJobReceipt,
  TaskAggregate,
} from "@donelayer/database";
import {
  MANAGED_SANDBOX_PROOF_FILE,
  MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_VERIFICATION_FILE,
  MANAGED_SANDBOX_SMOKE_FILE,
  MANAGED_SANDBOX_TIMEOUT_FILE,
  MANAGED_SANDBOX_WORKDIR,
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  ManagedSandboxPermissionGuard,
  managedSandboxBuildTestSecurityProfile,
  managedSandboxSecurityProfile,
  managedSandboxTimeoutSecurityProfile,
  type ManagedSandboxSecurityProfile,
  type PermissionLeaseEnvelope,
} from "@donelayer/worker-protocol";

import type {
  ManagedSandboxCleanupResult,
  ManagedSandboxCommandResult,
  ManagedSandboxHandle,
  ManagedSandboxInspection,
  ManagedSandboxProvider,
} from "./provider";
import { materializeVerifiedSourcePackage, type MaterializedSourcePackage } from "./repository-source";
import { verifySourcePackage } from "./source-package";
import { managedBuildTestSourceRunner } from "./source-package-runner";
import { managedSandboxSmokeProgram, managedSandboxTimeoutProgram } from "./smoke-program";

export type ManagedSandboxSmokeOutcome = {
  aggregate: TaskAggregate;
  sandboxRun: ManagedSandboxRunRecord;
  receipt: JobReceiptRecord;
  publicReceipt: PublicJobReceipt;
  createdInspection: ManagedSandboxInspection;
  cleanup: ManagedSandboxCleanupResult;
  command: ManagedSandboxCommandResult;
  proof: Record<string, unknown>;
  proofClaimedSha256: string;
  proofServerSha256: string;
  artifacts: EvidenceArtifactRecord[];
};

export type ManagedSandboxTimeoutOutcome = {
  aggregate: TaskAggregate;
  sandboxRun: ManagedSandboxRunRecord;
  createdInspection: ManagedSandboxInspection;
  cleanup: ManagedSandboxCleanupResult;
  timeoutAt: string;
  timeoutEvidence: string;
};

export type ManagedBuildTestCommandEvidence = {
  command: string;
  commandId: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  status: "PASSED" | "FAILED" | "NOT_PRESENT" | "TIMED_OUT" | "UNPARSABLE";
  stdoutArtifact: { fileName: string; sha256: string };
  stderrArtifact: { fileName: string; sha256: string };
};

export type ManagedBuildTestOutcome = {
  aggregate: TaskAggregate;
  sandboxRun: ManagedSandboxRunRecord;
  receipt: JobReceiptRecord;
  publicReceipt: PublicJobReceipt;
  source: MaterializedSourcePackage;
  createdInspection: ManagedSandboxInspection;
  installNetworkPolicy: { mode: "custom"; allowedDomains: string[]; allowedCidrs: string[]; observedAt: string };
  finalNetworkPolicy: { mode: "deny-all"; allowedDomains: string[]; allowedCidrs: string[]; observedAt: string };
  cleanup: ManagedSandboxCleanupResult;
  sourceVerification: Record<string, unknown>;
  sourceIntegrity: Record<string, unknown>;
  install: ManagedBuildTestCommandEvidence;
  build: ManagedBuildTestCommandEvidence;
  test: ManagedBuildTestCommandEvidence & {
    testRunner: string | null;
    totalTests: number | null;
    passedTests: number | null;
    failedTests: number | null;
    statisticsStatus: "PARSED" | "UNPARSABLE";
  };
  artifacts: EvidenceArtifactRecord[];
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function leaseEnvelope(aggregate: TaskAggregate): PermissionLeaseEnvelope {
  const permission = aggregate.permissionLease;
  if (!permission || permission.status !== "ACTIVE" || !permission.startsAt || !permission.expiresAt) {
    throw new Error("Managed Sandbox Permission Lease is not active");
  }
  return {
    id: permission.id,
    version: permission.version,
    status: "ACTIVE",
    startsAt: permission.startsAt,
    expiresAt: permission.expiresAt,
    scope: permission.scope,
  };
}

function verifyInspection(
  inspection: ManagedSandboxInspection,
  profile: ManagedSandboxSecurityProfile,
  handle: ManagedSandboxHandle,
): void {
  if (
    inspection.sandboxId.length < 1 ||
    inspection.sandboxId !== handle.sandboxId ||
    inspection.sessionId.length < 1 ||
    inspection.persistent !== false ||
    inspection.networkPolicy !== "deny-all" ||
    inspection.allowedDomains.length !== 0 ||
    inspection.allowedCidrs.length !== 0 ||
    inspection.portCount !== 0 ||
    inspection.sourceSnapshotId !== null ||
    inspection.currentSnapshotId !== null ||
    inspection.timeoutMs !== profile.timeoutMs ||
    inspection.vcpus !== profile.vcpus ||
    inspection.runtime !== profile.runtime ||
    inspection.cwd !== MANAGED_SANDBOX_WORKDIR
  ) {
    throw new Error("Provider inspection does not match the locked Managed Sandbox policy");
  }
}

function sanitizedInspection(inspection: ManagedSandboxInspection): Record<string, unknown> {
  return {
    provider: inspection.provider,
    sandboxId: inspection.sandboxId,
    sessionId: inspection.sessionId,
    status: inspection.status,
    createdAt: inspection.createdAt,
    statusUpdatedAt: inspection.statusUpdatedAt,
    region: inspection.region,
    runtime: inspection.runtime,
    image: inspection.image,
    persistent: inspection.persistent,
    timeoutMs: inspection.timeoutMs,
    vcpus: inspection.vcpus,
    memoryMb: inspection.memoryMb,
    networkPolicy: inspection.networkPolicy,
    allowedDomains: inspection.allowedDomains,
    allowedCidrs: inspection.allowedCidrs,
    portCount: inspection.portCount,
    sourceSnapshotId: inspection.sourceSnapshotId,
    currentSnapshotId: inspection.currentSnapshotId,
    cwd: inspection.cwd,
  };
}

export class ManagedSandboxOrchestrator {
  constructor(
    private readonly store: DemoStore,
    private readonly provider: ManagedSandboxProvider,
  ) {}

  async checkAvailability() {
    return this.provider.checkAvailability();
  }

  async runSmoke(): Promise<ManagedSandboxSmokeOutcome> {
    const availability = await this.provider.checkAvailability();
    if (!availability.available) throw new Error(`${availability.errorCode}: ${availability.errorMessage}`);
    const initial = this.store.createManagedSandboxTask();
    const jobRunId = initial.jobRun?.id;
    const runId = initial.jobRun ? this.store.getManagedSandboxRunForJob(initial.jobRun.id)?.id : null;
    if (!jobRunId || !runId) throw new Error("Server did not create the Managed Sandbox Job and Run");
    const started = this.store.startManagedSandboxJob(jobRunId);
    const aggregate = this.store.getTaskAggregate(started.task.id);
    const guard = new ManagedSandboxPermissionGuard(leaseEnvelope(aggregate));
    const profile = managedSandboxSecurityProfile();
    const environment = { DONELAYER_JOB_ID: jobRunId, DONELAYER_SANDBOX_RUN_ID: runId };
    guard.assertCreateAllowed(profile);
    guard.assertEnvironmentAllowed(environment);

    let handle: ManagedSandboxHandle | null = null;
    let inspection: ManagedSandboxInspection | null = null;
    let command: ManagedSandboxCommandResult | null = null;
    let proof: Record<string, unknown> | null = null;
    let proofBytes: Buffer | null = null;
    let cleanup: ManagedSandboxCleanupResult | null = null;
    let primaryError: unknown = null;
    const artifacts: EvidenceArtifactRecord[] = [];
    try {
      handle = await this.provider.createSandbox({ runId, jobRunId, profile });
      inspection = await this.provider.inspectSandbox(handle);
      verifyInspection(inspection, profile, handle);
      this.store.markManagedSandboxCreated({
        runId,
        providerSandboxId: inspection.sandboxId,
        providerRequestId: null,
        region: inspection.region,
        inspection: sanitizedInspection(inspection),
        providerMetadata: this.provider.getProviderMetadata(),
      });
      guard.assertUploadAllowed(MANAGED_SANDBOX_SMOKE_FILE);
      await this.provider.uploadFiles(handle, [{ path: MANAGED_SANDBOX_SMOKE_FILE, content: managedSandboxSmokeProgram, mode: 0o500 }]);
      this.store.markManagedSandboxPolicyVerified(runId, {
        mode: "deny-all",
        allowedDomains: [],
        allowedCidrs: [],
        persistent: false,
        snapshot: false,
        timeoutMs: profile.timeoutMs,
        vcpus: profile.vcpus,
        ports: [],
        uploadedFiles: [MANAGED_SANDBOX_SMOKE_FILE],
        environmentVariableNames: profile.environmentVariableNames,
        command: profile.command,
        localHostExecution: false,
        localDockerExecution: false,
      });
      guard.assertCommandAllowed(profile.command);
      command = await this.provider.runCommand(handle, { ...profile.command, timeoutMs: 20_000 });
      guard.assertActionAllowed("stream_logs");
      const logs = await this.provider.streamLogs(handle, command);
      command = { ...command, stdout: logs.stdout, stderr: logs.stderr };
      guard.assertOutputAllowed(Buffer.byteLength(logs.stdout), Buffer.byteLength(logs.stderr));
      if (command.exitCode !== 0) throw new Error(`Managed Sandbox smoke command exited ${command.exitCode}`);
      guard.assertActionAllowed("collect_artifact");
      proofBytes = await this.provider.collectArtifact(handle, `${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_PROOF_FILE}`);
      guard.assertArtifactAllowed(proofBytes.byteLength);
      proof = JSON.parse(proofBytes.toString("utf8")) as Record<string, unknown>;
      this.store.recordManagedSandboxNetworkProbe(runId, proof);
      const beforeStopArtifacts = [
        { artifactType: "MANAGED_SANDBOX_PROVIDER", fileName: "managed-sandbox-provider.json", mimeType: "application/json" as const, bytes: jsonBytes({ availability, metadata: this.provider.getProviderMetadata(), inspection: sanitizedInspection(inspection) }) },
        { artifactType: "MANAGED_SANDBOX_POLICY", fileName: "managed-sandbox-policy.json", mimeType: "application/json" as const, bytes: jsonBytes(profile) },
        { artifactType: "MANAGED_SANDBOX_STDOUT", fileName: "managed-sandbox-stdout.log", mimeType: "text/plain" as const, bytes: Buffer.from(command.stdout || "\n", "utf8") },
        { artifactType: "MANAGED_SANDBOX_STDERR", fileName: "managed-sandbox-stderr.log", mimeType: "text/plain" as const, bytes: Buffer.from(command.stderr || "\n", "utf8") },
        { artifactType: "MANAGED_SANDBOX_PROOF", fileName: MANAGED_SANDBOX_PROOF_FILE, mimeType: "application/json" as const, bytes: proofBytes },
      ];
      for (const item of beforeStopArtifacts) {
        artifacts.push(this.store.persistManagedSandboxArtifact({
          runId,
          artifactType: item.artifactType,
          fileName: item.fileName,
          mimeType: item.mimeType,
          content: item.bytes,
          claimedSha256: sha256(item.bytes),
        }));
      }
    } catch (error) {
      primaryError = error;
      this.store.failManagedSandboxRun(runId, classifyProviderError(error), error instanceof Error ? error.message : String(error));
    } finally {
      if (handle) {
        try {
          const requestedAt = new Date().toISOString();
          guard.assertSafetyCleanupAllowed("stop_sandbox");
          this.store.markManagedSandboxStopRequested(runId, requestedAt);
          const stopped = await this.provider.stopSandbox(handle);
          guard.assertSafetyCleanupAllowed("verify_cleanup");
          cleanup = await this.provider.verifyDestroyed(handle, stopped);
          this.store.markManagedSandboxStopped(runId, cleanup);
        } catch (cleanupError) {
          if (!primaryError) primaryError = cleanupError;
        }
      }
    }
    if (primaryError) throw primaryError;
    if (!handle || !inspection || !command || !proof || !proofBytes || !cleanup?.cleanupVerified) {
      throw new Error("Managed Sandbox smoke ended without complete Provider Evidence");
    }
    const afterStopArtifacts = [
      { artifactType: "MANAGED_SANDBOX_LIFECYCLE", fileName: "managed-sandbox-lifecycle.json", bytes: jsonBytes({ created: sanitizedInspection(inspection), command: { commandId: command.commandId, startedAt: command.startedAt, finishedAt: command.finishedAt, durationMs: command.durationMs, exitCode: command.exitCode }, cleanup }) },
      { artifactType: "MANAGED_SANDBOX_CLEANUP", fileName: "managed-sandbox-cleanup.json", bytes: jsonBytes(cleanup) },
    ];
    for (const item of afterStopArtifacts) {
      artifacts.push(this.store.persistManagedSandboxArtifact({ runId, ...item, mimeType: "application/json", content: item.bytes, claimedSha256: sha256(item.bytes) }));
    }
    const completed = this.store.completeManagedSandboxSmoke({ runId, command });
    const receipt = completed.receipt;
    if (!receipt) throw new Error("Managed Sandbox Verified Receipt was not created");
    const publicReceipt = this.store.getPublicJobReceipt(receipt.receiptPublicId);
    if (!publicReceipt || publicReceipt.verificationStatus !== "VALID" || publicReceipt.result !== "VERIFIED") {
      throw new Error("Managed Sandbox public Receipt verification failed");
    }
    const storedProof = completed.evidence.find((artifact) => artifact.fileName === MANAGED_SANDBOX_PROOF_FILE);
    if (!storedProof?.serverSha256) throw new Error("Server proof hash observation is missing");
    return {
      aggregate: completed,
      sandboxRun: this.store.getManagedSandboxRun(runId)!,
      receipt,
      publicReceipt,
      createdInspection: inspection,
      cleanup,
      command,
      proof,
      proofClaimedSha256: sha256(proofBytes),
      proofServerSha256: storedProof.serverSha256,
      artifacts: completed.evidence.filter((artifact) => artifact.sandboxRunId === runId),
    };
  }

  async runBuildTest(): Promise<ManagedBuildTestOutcome> {
    const availability = await this.provider.checkAvailability();
    if (!availability.available) throw new Error(`${availability.errorCode}: ${availability.errorMessage}`);

    const source = await materializeVerifiedSourcePackage();
    const independentlyVerifiedPackage = verifySourcePackage({
      sourcePackageBytes: source.sourcePackageBytes,
      sourcePackageManifestBytes: source.sourcePackageManifestBytes,
      expected: source.identity,
    });
    if (
      independentlyVerifiedPackage.identity.commitSha !== source.independentRemoteCommitSha ||
      independentlyVerifiedPackage.identity.sourcePackageSha256 !== source.sourcePackageSha256
    ) throw new Error("Server Source Package verification differs from the independent Remote identity");
    if (
      source.repositoryManifest.remoteUrl !== REPOSITORY_MATERIALIZATION_REMOTE_URL ||
      source.repositoryManifest.branch !== REPOSITORY_MATERIALIZATION_BRANCH
    ) {
      throw new Error("Managed build/test source branch is outside the main-branch Gate boundary");
    }

    const initial = this.store.createManagedBuildTestTask({
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: REPOSITORY_MATERIALIZATION_BRANCH,
      commitSha: source.materializerCommitSha,
      independentRemoteCommitSha: source.independentRemoteCommitSha,
      fileCount: source.sourceFileCount,
      manifestSha256: source.repositoryManifestSha256,
      sourcePackageManifestSha256: source.sourcePackageManifestSha256,
      sourcePackageSha256: source.sourcePackageSha256,
      sourcePackageBytes: source.sourcePackageBytes.byteLength,
      buildScriptPresent: source.buildScriptPresent,
      cloneStartedAt: source.clone.startedAt,
      cloneFinishedAt: source.clone.finishedAt,
      cloneDurationMs: source.clone.durationMs,
      materializerWorkspaceCleaned: true,
    });
    const jobRunId = initial.jobRun?.id;
    const runId = jobRunId ? this.store.getManagedSandboxRunForJob(jobRunId)?.id : null;
    if (!jobRunId || !runId) throw new Error("Server did not create the managed build/test Job and Run");
    const started = this.store.startManagedSandboxJob(jobRunId);
    const guard = new ManagedSandboxPermissionGuard(leaseEnvelope(this.store.getTaskAggregate(started.task.id)));
    const profile = managedSandboxBuildTestSecurityProfile(source.materializerCommitSha, source.buildScriptPresent);
    guard.assertCreateAllowed(profile);
    guard.assertEnvironmentAllowed({ DONELAYER_JOB_ID: jobRunId, DONELAYER_SANDBOX_RUN_ID: runId });

    let handle: ManagedSandboxHandle | null = null;
    let inspection: ManagedSandboxInspection | null = null;
    let cleanup: ManagedSandboxCleanupResult | null = null;
    let installNetworkPolicy: ManagedBuildTestOutcome["installNetworkPolicy"] | null = null;
    let finalNetworkPolicy: ManagedBuildTestOutcome["finalNetworkPolicy"] | null = null;
    let registryNetworkWindowAttempted = false;
    let sourceVerification: Record<string, unknown> | null = null;
    let sourceIntegrity: Record<string, unknown> | null = null;
    let installEvidence: ManagedBuildTestCommandEvidence | null = null;
    let buildEvidence: ManagedBuildTestCommandEvidence | null = null;
    let testEvidence: ManagedBuildTestOutcome["test"] | null = null;
    let primaryError: unknown = null;
    const artifacts: EvidenceArtifactRecord[] = [];

    const persistArtifact = (
      artifactType: string,
      fileName: string,
      mimeType: "application/json" | "text/plain",
      bytes: Buffer,
    ): EvidenceArtifactRecord => {
      guard.assertArtifactAllowed(bytes.byteLength);
      const artifact = this.store.persistManagedSandboxArtifact({
        runId,
        artifactType,
        fileName,
        mimeType,
        content: bytes,
        claimedSha256: sha256(bytes),
      });
      artifacts.push(artifact);
      return artifact;
    };

    const executePhase = async (
      command: NonNullable<typeof profile.commands.build> | typeof profile.commands.prepare | typeof profile.commands.install | typeof profile.commands.test | typeof profile.commands.verify,
    ): Promise<ManagedSandboxCommandResult> => {
      if (!handle) throw new Error("Managed build/test Sandbox handle is missing");
      guard.assertCommandAllowed(command);
      const result = await this.provider.runCommand(handle, command);
      const logs = await this.provider.streamLogs(handle, result);
      guard.assertOutputAllowed(Buffer.byteLength(logs.stdout), Buffer.byteLength(logs.stderr));
      return { ...result, stdout: logs.stdout, stderr: logs.stderr };
    };

    const persistCommandEvidence = (
      prefix: "install" | "build" | "test",
      commandText: string,
      command: ManagedSandboxCommandResult | null,
      status: ManagedBuildTestCommandEvidence["status"],
      statistics?: {
        testRunner: string | null;
        totalTests: number | null;
        passedTests: number | null;
        failedTests: number | null;
        statisticsStatus: "PARSED" | "UNPARSABLE";
      },
    ): ManagedBuildTestCommandEvidence | ManagedBuildTestOutcome["test"] => {
      const timestamp = new Date().toISOString();
      const stdoutBytes = Buffer.from(command?.stdout || (status === "NOT_PRESENT" ? "Build script not present; command not executed.\n" : "\n"), "utf8");
      const stderrBytes = Buffer.from(command?.stderr || "\n", "utf8");
      const stdout = persistArtifact("MANAGED_BUILD_TEST_STDOUT", `${prefix}-stdout.log`, "text/plain", stdoutBytes);
      const stderr = persistArtifact("MANAGED_BUILD_TEST_STDERR", `${prefix}-stderr.log`, "text/plain", stderrBytes);
      const evidence = {
        command: commandText,
        commandId: command?.commandId ?? null,
        startedAt: command?.startedAt ?? timestamp,
        finishedAt: command?.finishedAt ?? timestamp,
        durationMs: command?.durationMs ?? 0,
        exitCode: command?.exitCode ?? null,
        status,
        stdoutArtifact: { fileName: stdout.fileName, sha256: stdout.serverSha256! },
        stderrArtifact: { fileName: stderr.fileName, sha256: stderr.serverSha256! },
        ...(statistics ?? {}),
      };
      persistArtifact("MANAGED_BUILD_TEST_RESULT", `${prefix}-result.json`, "application/json", jsonBytes(evidence));
      return evidence;
    };

    try {
      handle = await this.provider.createSandbox({ runId, jobRunId, profile });
      inspection = await this.provider.inspectSandbox(handle);
      verifyInspection(inspection, profile, handle);
      this.store.markManagedSandboxCreated({
        runId,
        providerSandboxId: inspection.sandboxId,
        providerRequestId: null,
        region: inspection.region,
        inspection: sanitizedInspection(inspection),
        providerMetadata: this.provider.getProviderMetadata(),
      });
      const runner = managedBuildTestSourceRunner({ identity: source.identity, buildScriptPresent: source.buildScriptPresent });
      for (const fileName of [
        MANAGED_SANDBOX_SOURCE_PACKAGE_FILE,
        MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE,
        MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE,
      ]) guard.assertUploadAllowed(fileName);
      await this.provider.uploadFiles(handle, [
        { path: MANAGED_SANDBOX_SOURCE_PACKAGE_FILE, content: source.sourcePackageBytes, mode: 0o400 },
        { path: MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE, content: source.sourcePackageManifestBytes, mode: 0o400 },
        { path: MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE, content: runner, mode: 0o500 },
      ]);
      this.store.markManagedSandboxPolicyVerified(runId, {
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

      persistArtifact("REPOSITORY_MATERIALIZATION", "repository-materialization.json", "application/json", jsonBytes({
        schemaVersion: 1,
        remoteUrl: source.repositoryManifest.remoteUrl,
        branch: source.repositoryManifest.branch,
        materializerCommitSha: source.materializerCommitSha,
        independentRemoteCommitSha: source.independentRemoteCommitSha,
        fileCount: source.sourceFileCount,
        manifestSha256: source.repositoryManifestSha256,
        clone: source.clone,
        remoteVerifiedAt: source.remoteVerifiedAt,
        noRepositoryCodeExecuted: true,
        materializerWorkspaceCleaned: true,
      }));
      persistArtifact("SOURCE_PACKAGE_METADATA", "source-package-metadata.json", "application/json", jsonBytes({
        schemaVersion: 1,
        format: source.sourcePackageManifest.format,
        sourcePackageBytes: source.sourcePackageBytes.byteLength,
        sourcePackageSha256: source.sourcePackageSha256,
        sourcePackageManifestSha256: source.sourcePackageManifestSha256,
        repositoryManifestSha256: source.repositoryManifestSha256,
      }));
      persistArtifact("SOURCE_PACKAGE_MANIFEST", MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE, "application/json", source.sourcePackageManifestBytes);
      persistArtifact("MANAGED_BUILD_TEST_PROVIDER", "managed-build-test-provider.json", "application/json", jsonBytes({ availability, metadata: this.provider.getProviderMetadata(), inspection: sanitizedInspection(inspection) }));
      persistArtifact("MANAGED_BUILD_TEST_POLICY", "managed-build-test-policy.json", "application/json", jsonBytes(profile));

      const prepare = await executePhase(profile.commands.prepare);
      if (prepare.exitCode !== 0) throw new Error(`Source Package preparation exited ${prepare.exitCode}`);
      guard.assertCollectAllowed(MANAGED_SANDBOX_SOURCE_PACKAGE_VERIFICATION_FILE);
      const sourceVerificationBytes = await this.provider.collectArtifact(handle, `${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_PACKAGE_VERIFICATION_FILE}`);
      guard.assertArtifactAllowed(sourceVerificationBytes.byteLength);
      sourceVerification = JSON.parse(sourceVerificationBytes.toString("utf8")) as Record<string, unknown>;
      persistArtifact("SOURCE_PACKAGE_VERIFICATION", MANAGED_SANDBOX_SOURCE_PACKAGE_VERIFICATION_FILE, "application/json", sourceVerificationBytes);
      this.store.recordManagedBuildTestSourceUploaded(runId, sourceVerification as Parameters<DemoStore["recordManagedBuildTestSourceUploaded"]>[1]);

      guard.assertNetworkPolicyUpdateAllowed(profile.installNetworkPolicy);
      registryNetworkWindowAttempted = true;
      const observedInstallPolicy = await this.provider.updateNetworkPolicy(handle, profile.installNetworkPolicy);
      if (observedInstallPolicy.mode !== "custom") throw new Error("Provider did not open the exact npm registry network window");
      installNetworkPolicy = { ...observedInstallPolicy, mode: "custom" };
      this.store.recordManagedBuildTestNetworkPolicy(runId, { phase: "INSTALL", ...installNetworkPolicy });

      const install = await executePhase(profile.commands.install);
      installEvidence = persistCommandEvidence(
        "install",
        "npm ci --ignore-scripts --no-audit --no-fund",
        install,
        install.exitCode === 0 ? "PASSED" : "FAILED",
      ) as ManagedBuildTestCommandEvidence;
      if (install.exitCode !== 0) {
        throw new Error(`MANAGED_BUILD_TEST_INSTALL_FAILED: npm ci exited ${install.exitCode}`);
      }
      this.store.recordManagedBuildTestCommand(runId, {
        phase: "install",
        command: installEvidence.command,
        exitCode: install.exitCode,
        startedAt: install.startedAt,
        finishedAt: install.finishedAt,
        durationMs: install.durationMs,
      });

      guard.assertNetworkPolicyUpdateAllowed(profile.finalNetworkPolicy);
      const observedFinalPolicy = await this.provider.updateNetworkPolicy(handle, profile.finalNetworkPolicy);
      if (
        observedFinalPolicy.mode !== "deny-all" ||
        observedFinalPolicy.allowedDomains.length !== 0 ||
        observedFinalPolicy.allowedCidrs.length !== 0
      ) throw new Error("Provider did not restore exact deny-all networking");
      finalNetworkPolicy = { ...observedFinalPolicy, mode: "deny-all" };
      this.store.recordManagedBuildTestNetworkPolicy(runId, { phase: "FINAL", ...finalNetworkPolicy });

      if (profile.commands.build) {
        const build = await executePhase(profile.commands.build);
        buildEvidence = persistCommandEvidence(
          "build",
          "npm run build",
          build,
          build.exitCode === 0 ? "PASSED" : "FAILED",
        ) as ManagedBuildTestCommandEvidence;
        if (build.exitCode !== 0) {
          throw new Error(`MANAGED_BUILD_TEST_BUILD_FAILED: npm run build exited ${build.exitCode}`);
        }
        this.store.recordManagedBuildTestCommand(runId, {
          phase: "build",
          command: buildEvidence.command,
          exitCode: build.exitCode,
          startedAt: build.startedAt,
          finishedAt: build.finishedAt,
          durationMs: build.durationMs,
        });
      } else {
        buildEvidence = persistCommandEvidence("build", "npm run build", null, "NOT_PRESENT") as ManagedBuildTestCommandEvidence;
      }

      let test: ManagedSandboxCommandResult;
      try {
        test = await executePhase(profile.commands.test);
      } catch (error) {
        if (isTimeoutLikeError(error)) {
          throw new Error("MANAGED_BUILD_TEST_TEST_TIMEOUT: npm test did not produce a completed assertion result");
        }
        throw error;
      }
      const testTimedOut = test.exitCode === 124 || test.exitCode === 137;
      const statistics = parseTestStatistics(`${test.stdout}\n${test.stderr}`);
      testEvidence = persistCommandEvidence(
        "test",
        "npm test",
        test,
        testTimedOut ? "TIMED_OUT" : test.exitCode === 0 ? "PASSED" : "FAILED",
        statistics,
      ) as ManagedBuildTestOutcome["test"];
      if (testTimedOut) {
        throw new Error(`MANAGED_BUILD_TEST_TEST_TIMEOUT: npm test exited ${test.exitCode}`);
      }
      if (test.exitCode === 0) {
        throw new Error("MANAGED_BUILD_TEST_UNEXPECTED_TEST_PASS: the intentionally broken fixture passed npm test");
      }
      this.store.recordManagedBuildTestCommand(runId, {
        phase: "test",
        command: testEvidence.command,
        exitCode: test.exitCode,
        startedAt: test.startedAt,
        finishedAt: test.finishedAt,
        durationMs: test.durationMs,
      });

      const integrityCommand = await executePhase(profile.commands.verify);
      if (integrityCommand.exitCode !== 0) throw new Error(`SOURCE_MUTATION_DETECTED: integrity command exited ${integrityCommand.exitCode}`);
      guard.assertCollectAllowed(MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE);
      const sourceIntegrityBytes = await this.provider.collectArtifact(handle, `${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE}`);
      guard.assertArtifactAllowed(sourceIntegrityBytes.byteLength);
      sourceIntegrity = JSON.parse(sourceIntegrityBytes.toString("utf8")) as Record<string, unknown>;
      persistArtifact("SOURCE_INTEGRITY", MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE, "application/json", sourceIntegrityBytes);
      this.store.recordManagedBuildTestSourceIntegrity(runId, sourceIntegrity as Parameters<DemoStore["recordManagedBuildTestSourceIntegrity"]>[1]);
    } catch (error) {
      primaryError = error;
      this.store.failManagedSandboxRun(runId, classifyProviderError(error), error instanceof Error ? error.message : String(error));
    } finally {
      if (handle) {
        if (registryNetworkWindowAttempted && !finalNetworkPolicy) {
          try {
            const observedFinalPolicy = await this.provider.updateNetworkPolicy(handle, profile.finalNetworkPolicy);
            if (
              observedFinalPolicy.mode !== "deny-all" ||
              observedFinalPolicy.allowedDomains.length !== 0 ||
              observedFinalPolicy.allowedCidrs.length !== 0
            ) {
              throw new Error("Provider did not restore exact deny-all networking during failure cleanup");
            }
            finalNetworkPolicy = { ...observedFinalPolicy, mode: "deny-all" };
          } catch (restoreError) {
            if (!primaryError) primaryError = restoreError;
          }
        }
        try {
          const requestedAt = new Date().toISOString();
          guard.assertSafetyCleanupAllowed("stop_sandbox");
          this.store.markManagedSandboxStopRequested(runId, requestedAt);
          const stopped = await this.provider.stopSandbox(handle);
          guard.assertSafetyCleanupAllowed("verify_cleanup");
          cleanup = await this.provider.verifyDestroyed(handle, stopped);
          this.store.markManagedSandboxStopped(runId, cleanup);
        } catch (cleanupError) {
          if (!primaryError) primaryError = cleanupError;
        }
      }
    }
    if (primaryError) throw primaryError;
    if (
      !inspection || !cleanup?.cleanupVerified || !installNetworkPolicy || !finalNetworkPolicy ||
      !sourceVerification || !sourceIntegrity || !installEvidence || !buildEvidence || !testEvidence
    ) throw new Error("Managed build/test ended without complete Provider Evidence");

    persistArtifact("MANAGED_BUILD_TEST_LIFECYCLE", "managed-build-test-lifecycle.json", "application/json", jsonBytes({
      created: sanitizedInspection(inspection),
      installNetworkPolicy,
      finalNetworkPolicy,
      install: installEvidence,
      build: buildEvidence,
      test: testEvidence,
      cleanup,
    }));
    persistArtifact("MANAGED_BUILD_TEST_CLEANUP", "managed-build-test-cleanup.json", "application/json", jsonBytes(cleanup));
    const completed = this.store.completeManagedBuildTest(runId);
    const receipt = completed.receipt;
    if (!receipt || receipt.result !== "FAILED") throw new Error("Managed build/test FAILED Receipt was not created");
    const publicReceipt = this.store.getPublicJobReceipt(receipt.receiptPublicId);
    if (!publicReceipt || publicReceipt.verificationStatus !== "VALID" || publicReceipt.result !== "FAILED") {
      throw new Error("Managed build/test public Receipt does not preserve FAILED outcome with VALID integrity");
    }
    return {
      aggregate: completed,
      sandboxRun: this.store.getManagedSandboxRun(runId)!,
      receipt,
      publicReceipt,
      source,
      createdInspection: inspection,
      installNetworkPolicy,
      finalNetworkPolicy,
      cleanup,
      sourceVerification,
      sourceIntegrity,
      install: installEvidence,
      build: buildEvidence,
      test: testEvidence,
      artifacts: completed.evidence.filter((artifact) => artifact.sandboxRunId === runId),
    };
  }

  async runTimeoutProbe(): Promise<ManagedSandboxTimeoutOutcome> {
    const initial = this.store.createManagedSandboxTask("MANAGED_SANDBOX_TIMEOUT_PROBE_V1");
    const jobRunId = initial.jobRun?.id;
    const runId = jobRunId ? this.store.getManagedSandboxRunForJob(jobRunId)?.id : null;
    if (!jobRunId || !runId) throw new Error("Server did not create the timeout Job and Run");
    const started = this.store.startManagedSandboxJob(jobRunId);
    const guard = new ManagedSandboxPermissionGuard(leaseEnvelope(this.store.getTaskAggregate(started.task.id)));
    const profile = managedSandboxTimeoutSecurityProfile();
    guard.assertCreateAllowed(profile);
    guard.assertEnvironmentAllowed({ DONELAYER_JOB_ID: jobRunId, DONELAYER_SANDBOX_RUN_ID: runId });
    let handle: ManagedSandboxHandle | null = null;
    let inspection: ManagedSandboxInspection | null = null;
    let cleanup: ManagedSandboxCleanupResult | null = null;
    let timeoutEvidence = "";
    let timeoutAt = "";
    try {
      handle = await this.provider.createSandbox({ runId, jobRunId, profile });
      inspection = await this.provider.inspectSandbox(handle);
      verifyInspection(inspection, profile, handle);
      this.store.markManagedSandboxCreated({ runId, providerSandboxId: inspection.sandboxId, providerRequestId: null, region: inspection.region, inspection: sanitizedInspection(inspection), providerMetadata: this.provider.getProviderMetadata() });
      guard.assertUploadAllowed(MANAGED_SANDBOX_TIMEOUT_FILE);
      await this.provider.uploadFiles(handle, [{ path: MANAGED_SANDBOX_TIMEOUT_FILE, content: managedSandboxTimeoutProgram, mode: 0o500 }]);
      this.store.markManagedSandboxPolicyVerified(runId, { mode: "deny-all", allowedDomains: [], allowedCidrs: [], persistent: false, snapshot: false, timeoutMs: profile.timeoutMs, vcpus: profile.vcpus, ports: [], uploadedFiles: [MANAGED_SANDBOX_TIMEOUT_FILE], environmentVariableNames: profile.environmentVariableNames, command: profile.command, localHostExecution: false, localDockerExecution: false });
      guard.assertCommandAllowed(profile.command);
      let timeoutObserved = false;
      try {
        const result = await this.provider.runCommand(handle, { ...profile.command, timeoutMs: 1_500 });
        if (result.exitCode === 0 || result.durationMs < 1_200) {
          throw new Error("MANAGED_SANDBOX_TIMEOUT_NOT_OBSERVED: fixed blocking command was not stopped by the timeout policy");
        }
        timeoutObserved = true;
        timeoutEvidence = `Provider command returned exit ${result.exitCode} after ${result.durationMs} ms under the 1500 ms command timeout`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/TIMEOUT_NOT_OBSERVED/.test(message) || !/time.?out|timed out|deadline|command.*terminated|exit (124|137)/i.test(message)) {
          throw error;
        }
        timeoutObserved = true;
        timeoutEvidence = message;
      }
      if (!timeoutObserved) throw new Error("MANAGED_SANDBOX_TIMEOUT_NOT_OBSERVED");
      timeoutAt = new Date().toISOString();
      this.store.recordManagedSandboxTimeout(runId, timeoutAt, timeoutEvidence);
    } finally {
      if (handle) {
        const requestedAt = new Date().toISOString();
        guard.assertSafetyCleanupAllowed("stop_sandbox");
        this.store.markManagedSandboxStopRequested(runId, requestedAt);
        const stopped = await this.provider.stopSandbox(handle);
        guard.assertSafetyCleanupAllowed("verify_cleanup");
        cleanup = await this.provider.verifyDestroyed(handle, stopped);
        this.store.markManagedSandboxStopped(runId, cleanup);
      }
    }
    if (!inspection || !cleanup?.cleanupVerified || !timeoutAt) throw new Error("Timeout probe cleanup evidence is incomplete");
    const completed = this.store.completeManagedSandboxTimeout(runId);
    if (completed.receipt) throw new Error("Timeout probe must not create a success Receipt");
    return { aggregate: completed, sandboxRun: this.store.getManagedSandboxRun(runId)!, createdInspection: inspection, cleanup, timeoutAt, timeoutEvidence };
  }
}

function classifyProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/MANAGED_BUILD_TEST_TEST_TIMEOUT/i.test(message)) return "MANAGED_BUILD_TEST_TEST_TIMEOUT";
  if (/MANAGED_BUILD_TEST_INSTALL_FAILED/i.test(message)) return "MANAGED_BUILD_TEST_INSTALL_FAILED";
  if (/MANAGED_BUILD_TEST_BUILD_FAILED/i.test(message)) return "MANAGED_BUILD_TEST_BUILD_FAILED";
  if (/MANAGED_BUILD_TEST_UNEXPECTED_TEST_PASS/i.test(message)) return "MANAGED_BUILD_TEST_UNEXPECTED_TEST_PASS";
  if (/billing|payment|plan|credit|quota/i.test(message)) return "MANAGED_SANDBOX_BILLING_OR_QUOTA_BLOCKED";
  if (/auth|oidc|token|unauthorized|forbidden/i.test(message)) return "MANAGED_SANDBOX_AUTH_FAILED";
  if (/policy|network|persistent|snapshot|inspection/i.test(message)) return "MANAGED_SANDBOX_POLICY_FAILED";
  return "MANAGED_SANDBOX_PROVIDER_ERROR";
}

function isTimeoutLikeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /time.?out|timed out|deadline exceeded|command.*(?:terminated|killed)/i.test(message);
}

function parseTestStatistics(output: string): {
  testRunner: string | null;
  totalTests: number | null;
  passedTests: number | null;
  failedTests: number | null;
  statisticsStatus: "PARSED" | "UNPARSABLE";
} {
  const readCount = (label: string): number | null => {
    const match = output.match(new RegExp(`^\\s*# ${label} (\\d+)\\s*$`, "m"));
    return match ? Number(match[1]) : null;
  };
  const totalTests = readCount("tests");
  const passedTests = readCount("pass");
  const failedTests = readCount("fail");
  if (
    totalTests !== null && passedTests !== null && failedTests !== null &&
    Number.isSafeInteger(totalTests) && Number.isSafeInteger(passedTests) && Number.isSafeInteger(failedTests) &&
    totalTests === passedTests + failedTests
  ) {
    return {
      testRunner: /TAP version 13/.test(output) ? "node:test" : null,
      totalTests,
      passedTests,
      failedTests,
      statisticsStatus: "PARSED",
    };
  }
  return {
    testRunner: null,
    totalTests: null,
    passedTests: null,
    failedTests: null,
    statisticsStatus: "UNPARSABLE",
  };
}
