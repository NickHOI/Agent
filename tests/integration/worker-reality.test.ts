import { createHash, randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  repositoryFileManifestSchema,
  repositoryMetadataSchema,
  type JobEnvelope,
} from "@donelayer/worker-protocol";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const serverFixturePath = fileURLToPath(
  new URL("./fixtures/worker-reality-server.ts", import.meta.url),
);
const workerFixturePath = fileURLToPath(
  new URL("./fixtures/worker-reality-child.ts", import.meta.url),
);

const providerId = "provider-alpha";
const workerAId = "20000000-0000-4000-8000-000000000001";
const workerBId = "20000000-0000-4000-8000-000000000002";

type CreatedSmokeTask = { id: string } | { task: { id: string } };
type CreatedRepositoryTask = CreatedSmokeTask;

type RealityArtifact = {
  id: string;
  jobRunId: string;
  workerId: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  claimedSha256?: string;
  serverSha256?: string;
  content: string;
};

type RealityJobRun = {
  id: string;
  taskId: string;
  workerId: string;
  status: string;
  startedAt: string | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  taskContractVersionId: string | null;
};

type RealityPermissionLease = {
  id: string;
  version: number;
  taskContractVersionId: string;
  jobRunId: string;
  workerId: string;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  scope: {
    allowedActions: string[];
    deniedActions: string[];
    allowedPaths: string[];
    allowedDomains: string[];
    allowedRepositories?: string[];
    allowedBranches?: string[];
    maxArtifactBytes: number;
    maxRuntimeSeconds: number;
    maxApiBudget: number;
  };
};

type RealityReceipt = {
  id: string;
  receiptPublicId: string;
  jobRunId: string;
  taskContractVersionId: string;
  permissionLeaseId: string;
  result: string;
  receiptSha256: string;
  evidenceChainSha256: string;
  receipt: {
    receiptType: string;
    whoExecuted: { workerId: string };
    whatWasAgreed: { contractSha256: string };
    whatWasPermitted: { permissionLeaseId: string; permissionViolations: string[] };
    whatHappened: {
      workspaceCleaned: boolean;
      artifacts: Array<{ sha256: string }>;
      repositoryMaterialization?: {
        remoteUrl: string;
        branch: string;
        workerCommitSha: string;
        independentRemoteCommitSha: string;
        cloneExitCode: number;
        cloneDurationMs: number;
        fileCount: number;
        manifestSha256: string;
        artifactSha256: string;
        noRepositoryCodeExecuted: boolean;
      };
    };
    howVerified: { checks: Array<{ status: string }>; evidenceLedger: { valid: boolean; chainSha256: string | null } };
    finalResult: string;
  };
};

type RealityPublicReceipt = {
  publicReceiptId: string;
  taskType: string;
  artifactSha256: string;
  contractSha256: string;
  evidenceChainSha256: string;
  result: string;
  verificationStatus: string;
  invalidated: boolean;
  disputed: boolean;
  repository?: {
    remoteUrl: string;
    branch: string;
    workerCommitSha: string;
    independentRemoteCommitSha: string;
    manifestSha256: string;
    fileCount: number;
  };
  scopeDisclaimer: string;
};

type RealityJobRunAttempt = {
  jobRunId: string;
  attemptNumber: number;
  supersedesJobRunId: string | null;
  terminalReason: string | null;
  leaseRevokedAt: string | null;
};

type RealityHeartbeat = {
  workerId: string;
  status: "ONLINE" | "BUSY";
  activeJobRunIds: string[];
  sentAt: string;
  receivedAt: string;
  capabilitySnapshotId: string;
};

type RealityCapabilityEvidence = {
  jobRunId: string;
  snapshotId: string;
  capabilities: {
    os: string;
    nodeVersion: string;
    processId: number;
    architecture: string;
    memoryBytes: number;
    freeDiskBytes: number;
    gitAvailable: boolean;
    dockerAvailable: boolean;
    codexAvailable: boolean;
    workerVersion: string;
    maxConcurrentJobs: number;
    executors?: string[];
  };
  capturedAt: string;
};

type RealityAggregate = {
  task: { id: string; status: string; assignedWorkerId: string | null; repository: string; targetBranch: string };
  jobRun: RealityJobRun | null;
  evidence: RealityArtifact[];
  jobEvents: Array<{
    kind: string;
    message: string;
    payload: { data?: Record<string, unknown> };
    createdAt: string;
  }>;
  verificationResults: Array<{
    checkId: string;
    status: string;
    observed: Record<string, unknown>;
  }>;
  taskContract: {
    id: string;
    status: string;
    version: number;
    contractSha256: string;
    contract: {
      taskType: string;
      allowedWorkflow: string;
      allowedActions: string[];
      forbiddenActions: string[];
      acceptanceChecks: Array<{ id: string; required: boolean }>;
      budgetLimit: { maxAmount: number };
      timeLimitSeconds: number;
    };
  } | null;
  permissionLease: RealityPermissionLease | null;
  evidenceLedger: Array<{
    id: string;
    sequenceNumber: number;
    entryType: string;
    sourceRecordType: string;
    sourceRecordId: string;
    payloadSha256: string;
    previousEntrySha256: string | null;
    entrySha256: string;
  }>;
  evidenceLedgerVerification: { valid: boolean; chainSha256: string | null; entryCount: number };
  receipt: RealityReceipt | null;
};

type WorkerSnapshot = {
  id: string;
  status: string;
  lastHeartbeatAt: string;
  activeJobs: number;
};

type PairingCode = { code: string; expiresAt: string };

const runningChildren = new Set<ProcessHarness>();
const temporaryDirectories = new Set<string>();
const capturedEvidence: Record<string, unknown> = {};

afterAll(async () => {
  if (process.env.WORKER_REALITY_CAPTURE_EVIDENCE === "true") {
    const evidencePath = path.join(workspaceRoot, "test-results", "worker-reality-evidence.json");
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(capturedEvidence, null, 2)}\n`, "utf8");
  }
  if (process.env.REPOSITORY_REALITY_CAPTURE_EVIDENCE === "true") {
    const evidencePath = path.join(workspaceRoot, "test-results", "repository-reality-evidence.json");
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify({
      happyPath: capturedEvidence.repositoryHappyPath,
      recovery: capturedEvidence.repositoryRecovery,
    }, null, 2)}\n`, "utf8");
  }
});

afterEach(async () => {
  await Promise.all([...runningChildren].map((child) => child.terminate()));
  await Promise.all(
    [...temporaryDirectories].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
      temporaryDirectories.delete(directory);
    }),
  );
});

describe("WORKER REALITY GATE", () => {
  it(
    "completes WORKER_SMOKE_V1 through an independent Worker process and cleans its workspace",
    async () => {
      const testRoot = await temporaryDirectory("donelayer-worker-reality-");
      const capturedDatabasePath = process.env.WORKER_REALITY_CAPTURE_DB_PATH
        ? path.resolve(process.env.WORKER_REALITY_CAPTURE_DB_PATH)
        : null;
      if (capturedDatabasePath) {
        await mkdir(path.dirname(capturedDatabasePath), { recursive: true });
        await rm(capturedDatabasePath, { force: true });
      }
      const server = await RealityServer.start(capturedDatabasePath ?? path.join(testRoot, "reality.sqlite"));
      const workerDirectory = path.join(testRoot, "worker-b");

      try {
        const pairing = await server.rpc<PairingCode>("createPairingCode", {
          workerId: workerBId,
          providerId,
        });
        const paired = await runWorker("pair", server.apiUrl, workerDirectory, {
          pairingCode: pairing.code,
          workerName: "Reality Worker B",
        });
        expect(paired.exit.code).toBe(0);
        const pairedAt = paired.messageConfig?.pairedAt;
        expect(pairedAt).toBeTruthy();

        const created = await server.rpc<CreatedSmokeTask>("createWorkerSmokeTask", {
          workerId: workerBId,
        });
        const taskId = smokeTaskId(created);

        const workerRun = await runWorker("start", server.apiUrl, workerDirectory);
        expect(workerRun.exit.code).toBe(0);
        expect(workerRun.pid).toBeGreaterThan(0);
        expect(workerRun.stderr).not.toMatch(/\b(?:error|unhandled|failed)\b/i);

        const aggregate = await server.rpc<RealityAggregate>("getTaskAggregate", { taskId });
        expect(aggregate.task.status).toBe("COMPLETED");
        expect(aggregate.jobRun).toMatchObject({ workerId: workerBId, status: "SUCCEEDED" });
        expect(aggregate.jobRun?.leaseId).toBeTruthy();
        expect(aggregate.jobRun?.leaseExpiresAt).toBeTruthy();
        expect(aggregate.jobRun?.startedAt).toBeTruthy();
        expect(aggregate.taskContract).toMatchObject({
          status: "LOCKED",
          version: 1,
          contract: {
            taskType: "WORKER_SMOKE_V1",
            allowedWorkflow: "WORKER_SMOKE_V1",
            budgetLimit: { maxAmount: 0 },
            timeLimitSeconds: 60,
          },
        });
        expect(aggregate.taskContract?.contract.allowedActions).toEqual([
          "create_job_workspace",
          "write_hello_txt",
          "calculate_sha256",
          "upload_artifact",
          "report_progress",
          "cleanup_workspace",
        ]);
        expect(aggregate.taskContract?.contract.forbiddenActions).toEqual([
          "network_access",
          "shell_execution_from_customer_input",
          "git_clone",
          "external_repository_access",
          "production_deployment",
          "file_access_outside_job_workspace",
        ]);
        expect(aggregate.taskContract?.contract.acceptanceChecks.map((check) => check.id)).toEqual([
          "worker-claimed",
          "execution-lease",
          "hello-created",
          "artifact-uploaded",
          "artifact-hash",
          "workspace-cleaned",
          "no-permission-violation",
        ]);
        expect(aggregate.jobRun?.taskContractVersionId).toBe(aggregate.taskContract?.id);
        expect(aggregate.permissionLease).toMatchObject({
          jobRunId: aggregate.jobRun?.id,
          workerId: workerBId,
          taskContractVersionId: aggregate.taskContract?.id,
          status: "COMPLETED",
          revokedAt: null,
          revokeReason: null,
          scope: {
            allowedPaths: ["$JOB_WORKSPACE"],
            allowedDomains: [],
            maxArtifactBytes: 1024 * 1024,
            maxRuntimeSeconds: 60,
            maxApiBudget: 0,
          },
        });

        const artifact = aggregate.evidence.find((item) => item.fileName === "hello.txt");
        expect(artifact).toBeDefined();
        expect(artifact).toMatchObject({
          jobRunId: aggregate.jobRun?.id,
          workerId: workerBId,
          mimeType: "text/plain",
        });
        expect(artifact?.content).toContain(`Job ID: ${aggregate.jobRun?.id}`);
        expect(artifact?.content).toContain(`Worker ID: ${workerBId}`);
        expect(artifact?.content).toMatch(/Started At:/);
        expect(artifact?.content).toMatch(/Finished At:/);
        expect(artifact?.content).toMatch(/Worker OS:/);
        const bytes = Buffer.from(artifact?.content ?? "", "utf8");
        expect(artifact?.size).toBe(bytes.byteLength);
        expect(artifact?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
        const verification = aggregate.verificationResults.find(
          (result) => result.checkId === "artifact-hash",
        );
        expect(verification).toMatchObject({ status: "PASSED" });
        expect(verification?.observed).toMatchObject({
          workerSha256: artifact?.sha256,
          serverSha256: artifact?.sha256,
          matched: true,
        });
        expect(aggregate.verificationResults).toHaveLength(7);
        expect(aggregate.verificationResults.every((result) => result.status === "PASSED")).toBe(true);
        expect(aggregate.evidenceLedger.map((entry) => entry.entryType)).toEqual([
          "CONTRACT_LOCKED",
          "PERMISSION_GRANTED",
          "JOB_CLAIMED",
          "EXECUTION_STARTED",
          "HEARTBEAT_RECORDED",
          "ARTIFACT_CREATED",
          "ARTIFACT_UPLOADED",
          "ARTIFACT_HASH_VERIFIED",
          "WORKSPACE_CLEANED",
          "VERIFICATION_PASSED",
          "RECEIPT_CREATED",
        ]);
        expect(aggregate.evidenceLedgerVerification).toMatchObject({
          valid: true,
          entryCount: aggregate.evidenceLedger.length,
          chainSha256: aggregate.evidenceLedger.at(-1)?.entrySha256,
        });
        aggregate.evidenceLedger.forEach((entry, index) => {
          expect(entry.sequenceNumber).toBe(index + 1);
          expect(entry.previousEntrySha256).toBe(index === 0 ? null : aggregate.evidenceLedger[index - 1]?.entrySha256);
        });
        for (const entryType of ["ARTIFACT_UPLOADED", "ARTIFACT_HASH_VERIFIED"]) {
          expect(aggregate.evidenceLedger.find((entry) => entry.entryType === entryType)).toMatchObject({
            sourceRecordType: "evidence_artifact",
            sourceRecordId: artifact?.id,
            payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          });
        }
        expect(aggregate.receipt).toMatchObject({
          jobRunId: aggregate.jobRun?.id,
          taskContractVersionId: aggregate.taskContract?.id,
          permissionLeaseId: aggregate.permissionLease?.id,
          result: "VERIFIED",
          receipt: {
            receiptType: "WORKER_INFRASTRUCTURE_VERIFICATION",
            whoExecuted: { workerId: workerBId },
            whatWasAgreed: { contractSha256: aggregate.taskContract?.contractSha256 },
            whatWasPermitted: { permissionLeaseId: aggregate.permissionLease?.id, permissionViolations: [] },
            whatHappened: { workspaceCleaned: true, artifacts: [{ sha256: artifact?.sha256 }] },
            howVerified: { evidenceLedger: { valid: true }, checks: expect.arrayContaining([expect.objectContaining({ status: "PASSED" })]) },
            finalResult: "VERIFIED",
          },
        });
        expect(aggregate.receipt?.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(aggregate.receipt?.evidenceChainSha256).toBe(
          aggregate.evidenceLedger.at(-1)?.previousEntrySha256,
        );
        const publicReceipt = await server.rpc<RealityPublicReceipt>("getPublicJobReceipt", {
          receiptPublicId: aggregate.receipt?.receiptPublicId ?? "",
        });
        expect(publicReceipt).toEqual({
          publicReceiptId: aggregate.receipt?.receiptPublicId,
          taskType: "Worker Infrastructure Verification",
          agentIdentity: expect.any(String),
          workerIdentity: expect.any(String),
          contractSha256: aggregate.taskContract?.contractSha256,
          evidenceChainSha256: aggregate.receipt?.evidenceChainSha256,
          artifactSha256: artifact?.sha256,
          verificationSummary: expect.any(String),
          result: "VERIFIED",
          createdAt: expect.any(String),
          verificationStatus: "VALID",
          invalidated: false,
          disputed: false,
          scopeDisclaimer: "This receipt verifies a Worker infrastructure workflow. It is not a customer coding task receipt.",
        });

        expect(aggregate.jobEvents.some((event) => event.message.includes("workspace prepared"))).toBe(true);
        const cleanupEvent = aggregate.jobEvents.find((event) => event.message.includes("workspace removed"));
        expect(cleanupEvent).toBeDefined();
        const cleanedWorkdir = cleanupEvent?.payload.data?.workdir;
        expect(typeof cleanedWorkdir).toBe("string");
        if (typeof cleanedWorkdir === "string") {
          expect(path.dirname(cleanedWorkdir)).toBe(path.resolve(workerDirectory, "jobs"));
          await expect(access(cleanedWorkdir)).rejects.toMatchObject({ code: "ENOENT" });
        }
        const worker = await server.rpc<WorkerSnapshot>("getWorker", { workerId: workerBId });
        expect(worker.status).toBe("ONLINE");
        expect(worker.activeJobs).toBe(0);
        expect(Date.parse(worker.lastHeartbeatAt)).toBeGreaterThanOrEqual(Date.parse(pairedAt ?? ""));
        const heartbeats = await server.rpc<RealityHeartbeat[]>("listWorkerHeartbeats", {
          workerId: workerBId,
        });
        expect(heartbeats.length).toBeGreaterThanOrEqual(2);
        const capabilityEvidence = await server.rpc<RealityCapabilityEvidence>(
          "getJobCapabilityEvidence",
          { jobRunId: aggregate.jobRun?.id ?? "" },
        );
        expect(capabilityEvidence.jobRunId).toBe(aggregate.jobRun?.id);
        expect(capabilityEvidence.capabilities).toMatchObject({
          architecture: process.arch,
          maxConcurrentJobs: 1,
          processId: workerRun.pid,
        });
        expect(capabilityEvidence.capabilities.nodeVersion).toMatch(/^v\d+/);
        expect(capabilityEvidence.capabilities.workerVersion).toBeTruthy();
        expect(capabilityEvidence.capabilities.memoryBytes).toBeGreaterThan(0);
        expect(capabilityEvidence.capabilities.freeDiskBytes).toBeGreaterThan(0);
        await expectWorkspaceClean(workerDirectory);
        expect(heartbeats.some((heartbeat) => heartbeat.status === "BUSY")).toBe(true);
        capturedEvidence.happyPath = {
          workerPid: workerRun.pid,
          workerId: workerBId,
          taskId,
          jobId: aggregate.jobRun?.id,
          pairingTime: pairedAt,
          heartbeats,
          claimTime: aggregate.jobRun?.startedAt,
          leaseId: aggregate.jobRun?.leaseId,
          leaseExpiresAt: aggregate.jobRun?.leaseExpiresAt,
          artifact: {
            fileName: artifact?.fileName,
            size: artifact?.size,
            claimedSha256: artifact?.claimedSha256 ?? artifact?.sha256,
            serverSha256: artifact?.serverSha256 ?? artifact?.sha256,
          },
          taskContract: aggregate.taskContract,
          permissionLease: aggregate.permissionLease,
          evidenceLedger: aggregate.evidenceLedger,
          receipt: aggregate.receipt,
          publicReceipt,
          capabilityEvidence,
          finalTaskState: aggregate.task.status,
          workdir: cleanedWorkdir,
          workdirCleaned: true,
          workerStdout: workerRun.stdout,
          workerStderr: workerRun.stderr,
          serverStdout: server.stdout,
          serverStderr: server.stderr,
        };
      } finally {
        await server.stop();
      }
    },
    120_000,
  );

  it(
    "expires Worker A, fences its old lease, and lets Worker B finish a fresh attempt",
    async () => {
      const testRoot = await temporaryDirectory("donelayer-worker-recovery-");
      const server = await RealityServer.start(path.join(testRoot, "recovery.sqlite"));
      const workerADirectory = path.join(testRoot, "worker-a");
      const workerBDirectory = path.join(testRoot, "worker-b");

      try {
        await pairExistingWorker(server, workerAId, workerADirectory, "Recovery Worker A");
        await pairExistingWorker(server, workerBId, workerBDirectory, "Recovery Worker B");

        const created = await server.rpc<CreatedSmokeTask>("createWorkerSmokeTask", {
          workerId: workerAId,
        });
        const taskId = smokeTaskId(created);

        const claimA = await runWorker("claim-and-exit", server.apiUrl, workerADirectory);
        expect(claimA.exit.code).toBe(0);
        const staleJob = claimA.claimedJob;
        expect(staleJob).toMatchObject({ taskId, workerId: workerAId });
        expect(staleJob?.leaseToken).toBeTruthy();
        expect(staleJob?.leaseExpiresAt).toBeTruthy();
        expect(staleJob?.taskContract).toMatchObject({ version: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
        expect(staleJob?.permissionLease).toMatchObject({
          status: "ACTIVE",
          scope: { allowedPaths: ["$JOB_WORKSPACE"], allowedDomains: [], maxApiBudget: 0 },
        });

        const earlyB = await runWorker("start", server.apiUrl, workerBDirectory);
        expect(earlyB.exit.code).toBe(0);
        const beforeExpiry = await server.rpc<RealityAggregate>("getTaskAggregate", { taskId });
        expect(beforeExpiry.task.status).toBe("RUNNING");
        expect(beforeExpiry.jobRun?.id).toBe(staleJob?.jobRunId);
        expect(beforeExpiry.jobRun?.workerId).toBe(workerAId);
        expect(beforeExpiry.taskContract?.id).toBe(staleJob?.taskContract.id);
        expect(beforeExpiry.permissionLease).toMatchObject({
          id: staleJob?.permissionLease.id,
          workerId: workerAId,
          status: "ACTIVE",
        });

        await waitUntilAfter(staleJob?.leaseExpiresAt ?? "");

        const workerBRun = await runWorker("start", server.apiUrl, workerBDirectory);
        expect(workerBRun.exit.code).toBe(0);
        expect(workerBRun.stderr).not.toMatch(/\b(?:error|unhandled|failed)\b/i);

        if (!staleJob) throw new Error("Worker A did not return a claimed JobEnvelope");
        const staleAttempt = await runStaleAttempt(
          server.apiUrl,
          workerADirectory,
          staleJob,
        );
        expect(staleAttempt.exit.code).toBe(0);
        expect(staleAttempt.staleAttempts).toBeDefined();
        expect(Object.values(staleAttempt.staleAttempts ?? {}).every((attempt) => attempt.rejected)).toBe(
          true,
        );

        const aggregate = await server.rpc<RealityAggregate>("getTaskAggregate", { taskId });
        expect(aggregate.task.status).toBe("COMPLETED");
        expect(aggregate.task.assignedWorkerId).toBe(workerBId);
        expect(aggregate.jobRun).toMatchObject({ workerId: workerBId, status: "SUCCEEDED" });
        expect(aggregate.jobRun?.id).not.toBe(staleJob.jobRunId);
        expect(aggregate.taskContract?.id).toBe(staleJob.taskContract.id);
        expect(aggregate.jobRun?.taskContractVersionId).toBe(staleJob.taskContract.id);
        expect(aggregate.permissionLease).toMatchObject({
          workerId: workerBId,
          status: "COMPLETED",
          version: 2,
          taskContractVersionId: staleJob.taskContract.id,
        });
        expect(aggregate.permissionLease?.id).not.toBe(staleJob.permissionLease.id);

        const workerAPermission = await server.rpc<RealityPermissionLease>("getPermissionLeaseForJob", {
          jobRunId: staleJob.jobRunId,
        });
        expect(workerAPermission).toMatchObject({
          id: staleJob.permissionLease.id,
          workerId: workerAId,
          status: "REVOKED",
          revokeReason: "Execution Lease expired during recovery",
        });
        expect(workerAPermission.revokedAt).toBeTruthy();

        const jobRuns = await server.rpc<RealityJobRun[]>("listJobRuns");
        const taskRuns = jobRuns.filter((job) => job.taskId === taskId);
        expect(taskRuns).toHaveLength(2);
        expect(taskRuns.find((job) => job.id === staleJob.jobRunId)?.status).toBe("EXPIRED");
        const expiredAttempt = await server.rpc<RealityJobRunAttempt>("getJobRunAttempt", {
          jobRunId: staleJob.jobRunId,
        });
        const replacementAttempt = await server.rpc<RealityJobRunAttempt>("getJobRunAttempt", {
          jobRunId: aggregate.jobRun?.id ?? "",
        });
        expect(expiredAttempt).toMatchObject({
          attemptNumber: 1,
          terminalReason: "LEASE_EXPIRED",
        });
        expect(expiredAttempt.leaseRevokedAt).toBeTruthy();
        expect(replacementAttempt).toMatchObject({
          attemptNumber: 2,
          supersedesJobRunId: staleJob.jobRunId,
          terminalReason: "SUCCEEDED",
        });

        const artifact = aggregate.evidence.find((item) => item.fileName === "hello.txt");
        expect(artifact).toMatchObject({ workerId: workerBId, jobRunId: aggregate.jobRun?.id });
        expect(artifact?.content).toContain(`Worker ID: ${workerBId}`);
        expect(artifact?.content).not.toContain(`Worker ID: ${workerAId}`);
        expect(aggregate.receipt).toMatchObject({
          jobRunId: aggregate.jobRun?.id,
          permissionLeaseId: aggregate.permissionLease?.id,
          result: "VERIFIED",
          receipt: {
            whoExecuted: { workerId: workerBId },
            finalResult: "VERIFIED",
          },
        });
        const workerAReceipt = await server.rpc<RealityReceipt | null>("getJobReceiptByJobRun", {
          jobRunId: staleJob.jobRunId,
        });
        expect(workerAReceipt).toBeNull();
        expect(aggregate.evidenceLedger.at(-1)?.entryType).toBe("RECEIPT_CREATED");
        expect(aggregate.evidenceLedgerVerification.valid).toBe(true);

        const workerA = await server.rpc<WorkerSnapshot>("getWorker", { workerId: workerAId });
        expect(workerA.status).toBe("OFFLINE");
        await expectWorkspaceClean(workerBDirectory);
        capturedEvidence.recovery = {
          taskId,
          workerA: {
            pid: claimA.pid,
            workerId: workerAId,
            jobId: staleJob.jobRunId,
            leaseId: staleJob.leaseToken.split(".", 1)[0]?.replace(/^dls_/, ""),
            leaseExpiresAt: staleJob.leaseExpiresAt,
            finalStatus: workerA.status,
            permissionLease: workerAPermission,
          },
          workerB: {
            pid: workerBRun.pid,
            workerId: workerBId,
            jobId: aggregate.jobRun?.id,
            leaseId: aggregate.jobRun?.leaseId,
            leaseExpiresAt: aggregate.jobRun?.leaseExpiresAt,
            finalJobStatus: aggregate.jobRun?.status,
            permissionLease: aggregate.permissionLease,
          },
          expiredAttempt,
          replacementAttempt,
          staleAttempts: staleAttempt.staleAttempts,
          artifact: {
            fileName: artifact?.fileName,
            sha256: artifact?.sha256,
            workerId: artifact?.workerId,
          },
          taskContract: aggregate.taskContract,
          evidenceLedger: aggregate.evidenceLedger,
          receipt: aggregate.receipt,
          finalTaskState: aggregate.task.status,
          workerBStdout: workerBRun.stdout,
          workerBStderr: workerBRun.stderr,
          serverStdout: server.stdout,
          serverStderr: server.stderr,
        };
      } finally {
        await server.stop();
      }
    },
    120_000,
  );
});

describe.skipIf(process.env.RUN_REPOSITORY_REALITY_GATE !== "true")(
  "REAL REPOSITORY MATERIALIZATION GATE V1",
  () => {
    it(
      "clones the real allowlisted Remote in an independent Worker process and issues a verified Receipt",
      async () => {
        const testRoot = await temporaryDirectory("donelayer-repository-reality-");
        const capturedDatabasePath = process.env.REPOSITORY_REALITY_CAPTURE_DB_PATH
          ? path.resolve(process.env.REPOSITORY_REALITY_CAPTURE_DB_PATH)
          : null;
        if (capturedDatabasePath) {
          await mkdir(path.dirname(capturedDatabasePath), { recursive: true });
          await rm(capturedDatabasePath, { force: true });
        }
        const server = await RealityServer.start(capturedDatabasePath ?? path.join(testRoot, "repository-reality.sqlite"));
        const workerDirectory = path.join(testRoot, "worker-b");

        try {
          const pairing = await server.rpc<PairingCode>("createPairingCode", { workerId: workerBId, providerId });
          const paired = await runWorker("pair", server.apiUrl, workerDirectory, {
            pairingCode: pairing.code,
            workerName: "Repository Reality Worker B",
          });
          expect(paired.exit.code).toBe(0);
          expect(paired.messageConfig?.pairedAt).toBeTruthy();

          const created = await server.rpc<CreatedRepositoryTask>("createRepositoryMaterializationTask", {
            workerId: workerBId,
          });
          const taskId = smokeTaskId(created);
          const workerRun = await runWorker("start", server.apiUrl, workerDirectory);
          expect(workerRun.exit.code).toBe(0);
          expect(workerRun.pid).toBeGreaterThan(0);
          expect(workerRun.stderr).toBe("");

          const aggregate = await server.rpc<RealityAggregate>("getTaskAggregate", { taskId });
          expect(aggregate.task).toMatchObject({
            status: "COMPLETED",
            assignedWorkerId: workerBId,
            repository: REPOSITORY_MATERIALIZATION_REMOTE_URL,
            targetBranch: REPOSITORY_MATERIALIZATION_BRANCH,
          });
          expect(aggregate.jobRun).toMatchObject({ workerId: workerBId, status: "SUCCEEDED" });
          expect(aggregate.taskContract).toMatchObject({
            status: "LOCKED",
            version: 1,
            contract: {
              taskType: "REPOSITORY_MATERIALIZATION_V1",
              allowedWorkflow: "REPOSITORY_MATERIALIZE_V1",
              timeLimitSeconds: 120,
            },
          });
          expect(aggregate.taskContract?.contract.acceptanceChecks).toHaveLength(16);
          expect(aggregate.permissionLease).toMatchObject({
            workerId: workerBId,
            status: "COMPLETED",
            scope: {
              allowedDomains: ["github.com"],
              allowedRepositories: [REPOSITORY_MATERIALIZATION_REMOTE_URL],
              allowedBranches: [REPOSITORY_MATERIALIZATION_BRANCH],
              maxApiBudget: 0,
            },
          });

          expect(aggregate.evidence.map((artifact) => artifact.fileName).sort()).toEqual([
            "clone-log.txt",
            "file-manifest.json",
            "repository-metadata.json",
          ]);
          for (const artifact of aggregate.evidence) {
            expect(artifact.claimedSha256).toBe(artifact.serverSha256);
            expect(artifact.sha256).toBe(artifact.serverSha256);
            expect(createHash("sha256").update(artifact.content, "utf8").digest("hex")).toBe(artifact.sha256);
          }
          const cloneLog = aggregate.evidence.find((artifact) => artifact.fileName === "clone-log.txt");
          const metadataArtifact = aggregate.evidence.find((artifact) => artifact.fileName === "repository-metadata.json");
          const manifestArtifact = aggregate.evidence.find((artifact) => artifact.fileName === "file-manifest.json");
          if (!cloneLog || !metadataArtifact || !manifestArtifact) throw new Error("Repository Evidence artifacts are missing");
          const metadata = repositoryMetadataSchema.parse(JSON.parse(metadataArtifact.content) as unknown);
          const manifest = repositoryFileManifestSchema.parse(JSON.parse(manifestArtifact.content) as unknown);
          expect(metadata).toMatchObject({
            remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
            branch: REPOSITORY_MATERIALIZATION_BRANCH,
            cloneExitCode: 0,
            workerId: workerBId,
            jobRunId: aggregate.jobRun?.id,
          });
          expect(metadata.commitSha).toMatch(/^[a-f0-9]{40}$/);
          expect(manifest.commitSha).toBe(metadata.commitSha);
          expect(manifest.files.map((entry) => entry.relative_path)).toEqual([
            "package-lock.json",
            "package.json",
            "README.md",
            "src/add.ts",
            "tests/add.test.ts",
            "tsconfig.json",
          ]);
          expect(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
          expect(manifest.files.some((entry) => entry.relative_path.split("/").includes(".git"))).toBe(false);
          expect(cloneLog.content).toContain("Exit Code: 0");
          expect(cloneLog.content).toContain("--no-recurse-submodules");
          expect(cloneLog.content).toContain(REPOSITORY_MATERIALIZATION_REMOTE_URL);
          expect(cloneLog.content).not.toMatch(/npm (?:install|ci|test)|npm run|pnpm|yarn|codex/i);

          const ledgerTypes = aggregate.evidenceLedger.map((entry) => entry.entryType);
          for (const required of [
            "CONTRACT_LOCKED",
            "PERMISSION_GRANTED",
            "JOB_CLAIMED",
            "EXECUTION_STARTED",
            "REPOSITORY_CLONE_STARTED",
            "REPOSITORY_CLONE_COMPLETED",
            "REMOTE_METADATA_CAPTURED",
            "FILE_MANIFEST_CREATED",
            "ARTIFACT_UPLOADED",
            "ARTIFACT_HASH_VERIFIED",
            "REMOTE_COMMIT_VERIFIED",
            "WORKSPACE_CLEANED",
            "VERIFICATION_PASSED",
            "RECEIPT_CREATED",
          ]) expect(ledgerTypes).toContain(required);
          expect(aggregate.evidenceLedger.map((entry) => entry.sequenceNumber)).toEqual(
            aggregate.evidenceLedger.map((_entry, index) => index + 1),
          );
          expect(aggregate.evidenceLedgerVerification.valid).toBe(true);
          expect(aggregate.verificationResults).toHaveLength(16);
          expect(aggregate.verificationResults.every((check) => check.status === "PASSED")).toBe(true);
          expect(aggregate.receipt).toMatchObject({
            result: "VERIFIED",
            receipt: {
              receiptType: "REPOSITORY_MATERIALIZATION_VERIFICATION",
              whoExecuted: { workerId: workerBId },
              whatHappened: {
                workspaceCleaned: true,
                repositoryMaterialization: {
                  remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
                  branch: REPOSITORY_MATERIALIZATION_BRANCH,
                  workerCommitSha: metadata.commitSha,
                  independentRemoteCommitSha: metadata.commitSha,
                  cloneExitCode: 0,
                  fileCount: 6,
                  noRepositoryCodeExecuted: true,
                },
              },
              finalResult: "VERIFIED",
            },
          });
          const publicReceipt = await server.rpc<RealityPublicReceipt>("getPublicJobReceipt", {
            receiptPublicId: aggregate.receipt?.receiptPublicId ?? "",
          });
          expect(publicReceipt).toMatchObject({
            taskType: "Repository Materialization Verification",
            result: "VERIFIED",
            verificationStatus: "VALID",
            repository: {
              remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
              branch: REPOSITORY_MATERIALIZATION_BRANCH,
              workerCommitSha: metadata.commitSha,
              independentRemoteCommitSha: metadata.commitSha,
              fileCount: 6,
            },
          });
          expect(publicReceipt.scopeDisclaimer).toBe(
            "This receipt verifies repository materialization only. It does not verify that the repository builds, tests pass, or the software is correct.",
          );

          const workspaceEvent = aggregate.jobEvents.find((event) => event.payload.data && "workdir" in event.payload.data);
          const workdir = typeof workspaceEvent?.payload.data?.workdir === "string" ? workspaceEvent.payload.data.workdir : "";
          expect(workdir).toBeTruthy();
          await expect(access(workdir)).rejects.toMatchObject({ code: "ENOENT" });
          await expectWorkspaceClean(workerDirectory);
          const heartbeats = await server.rpc<RealityHeartbeat[]>("listWorkerHeartbeats", { workerId: workerBId });
          expect(heartbeats.some((heartbeat) => heartbeat.status === "BUSY" && heartbeat.activeJobRunIds.includes(aggregate.jobRun?.id ?? ""))).toBe(true);
          const capabilityEvidence = await server.rpc<RealityCapabilityEvidence>("getJobCapabilityEvidence", {
            jobRunId: aggregate.jobRun?.id ?? "",
          });
          expect(capabilityEvidence.capabilities).toMatchObject({
            processId: workerRun.pid,
            gitAvailable: true,
          });

          capturedEvidence.repositoryHappyPath = {
            fixtureRemoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
            pairingTime: paired.messageConfig?.pairedAt,
            workerPid: workerRun.pid,
            workerId: workerBId,
            jobRun: aggregate.jobRun,
            taskContract: aggregate.taskContract,
            permissionLease: aggregate.permissionLease,
            cloneLog,
            repositoryMetadata: metadata,
            fileManifest: manifest,
            manifestArtifact,
            evidenceLedger: aggregate.evidenceLedger,
            evidenceLedgerVerification: aggregate.evidenceLedgerVerification,
            receipt: aggregate.receipt,
            publicReceipt,
            heartbeatRecords: heartbeats,
            capabilityEvidence,
            workspacePath: workdir,
            workspaceCleaned: true,
            finalTaskState: aggregate.task.status,
            workerStdout: workerRun.stdout,
            workerStderr: workerRun.stderr,
            serverStdout: server.stdout,
            serverStderr: server.stderr,
          };
        } finally {
          await server.stop();
        }
      },
      180_000,
    );

    it(
      "fences Worker A after lease expiry and lets Worker B complete with a new Permission Lease",
      async () => {
        const testRoot = await temporaryDirectory("donelayer-repository-recovery-");
        const server = await RealityServer.start(path.join(testRoot, "repository-recovery.sqlite"));
        const workerADirectory = path.join(testRoot, "worker-a");
        const workerBDirectory = path.join(testRoot, "worker-b");
        try {
          await pairExistingWorker(server, workerAId, workerADirectory, "Repository Recovery Worker A");
          await pairExistingWorker(server, workerBId, workerBDirectory, "Repository Recovery Worker B");
          const created = await server.rpc<CreatedRepositoryTask>("createRepositoryMaterializationTask", { workerId: workerAId });
          const taskId = smokeTaskId(created);
          const claimA = await runWorker("claim-and-exit", server.apiUrl, workerADirectory);
          const staleJob = claimA.claimedJob;
          expect(staleJob).toMatchObject({
            taskId,
            workerId: workerAId,
            executor: { kind: "repository-materializer" },
            workflow: { id: "REPOSITORY_MATERIALIZE_V1" },
          });
          if (!staleJob) throw new Error("Worker A did not claim the repository Job");
          const earlyB = await runWorker("start", server.apiUrl, workerBDirectory);
          expect(earlyB.exit.code).toBe(0);
          await waitUntilAfter(staleJob.leaseExpiresAt);
          const workerBRun = await runWorker("start", server.apiUrl, workerBDirectory);
          expect(workerBRun.exit.code).toBe(0);
          expect(workerBRun.stderr).toBe("");
          const staleAttempt = await runStaleAttempt(server.apiUrl, workerADirectory, staleJob);
          expect(Object.values(staleAttempt.staleAttempts ?? {}).every((attempt) => attempt.rejected)).toBe(true);

          const aggregate = await server.rpc<RealityAggregate>("getTaskAggregate", { taskId });
          expect(aggregate.task).toMatchObject({ status: "COMPLETED", assignedWorkerId: workerBId });
          expect(aggregate.jobRun).toMatchObject({ status: "SUCCEEDED", workerId: workerBId });
          expect(aggregate.jobRun?.id).not.toBe(staleJob.jobRunId);
          expect(aggregate.taskContract?.id).toBe(staleJob.taskContract.id);
          expect(aggregate.permissionLease).toMatchObject({
            workerId: workerBId,
            status: "COMPLETED",
            version: 2,
            taskContractVersionId: staleJob.taskContract.id,
          });
          expect(aggregate.permissionLease?.id).not.toBe(staleJob.permissionLease.id);
          const workerAPermission = await server.rpc<RealityPermissionLease>("getPermissionLeaseForJob", {
            jobRunId: staleJob.jobRunId,
          });
          expect(workerAPermission).toMatchObject({
            id: staleJob.permissionLease.id,
            workerId: workerAId,
            status: "REVOKED",
            revokeReason: "Execution Lease expired during recovery",
          });
          const oldReceipt = await server.rpc<RealityReceipt | null>("getJobReceiptByJobRun", { jobRunId: staleJob.jobRunId });
          expect(oldReceipt).toBeNull();
          expect(aggregate.receipt).toMatchObject({
            result: "VERIFIED",
            receipt: {
              whoExecuted: { workerId: workerBId },
              whatHappened: { repositoryMaterialization: { noRepositoryCodeExecuted: true } },
            },
          });
          await expectWorkspaceClean(workerBDirectory);
          capturedEvidence.repositoryRecovery = {
            taskId,
            workerA: {
              pid: claimA.pid,
              workerId: workerAId,
              jobRunId: staleJob.jobRunId,
              executionLeaseId: staleJob.leaseToken.split(".", 1)[0]?.replace(/^dls_/, ""),
              leaseExpiresAt: staleJob.leaseExpiresAt,
              permissionLease: workerAPermission,
            },
            workerB: {
              pid: workerBRun.pid,
              workerId: workerBId,
              jobRun: aggregate.jobRun,
              permissionLease: aggregate.permissionLease,
            },
            staleAttempts: staleAttempt.staleAttempts,
            taskContract: aggregate.taskContract,
            receipt: aggregate.receipt,
            evidenceLedgerVerification: aggregate.evidenceLedgerVerification,
            finalTaskState: aggregate.task.status,
            workerBStdout: workerBRun.stdout,
            workerBStderr: workerBRun.stderr,
            serverStdout: server.stdout,
            serverStderr: server.stderr,
          };
        } finally {
          await server.stop();
        }
      },
      180_000,
    );
  },
);

async function pairExistingWorker(
  server: RealityServer,
  workerId: string,
  configDirectory: string,
  workerName: string,
): Promise<void> {
  const pairing = await server.rpc<PairingCode>("createPairingCode", { workerId, providerId });
  const paired = await runWorker("pair", server.apiUrl, configDirectory, {
    pairingCode: pairing.code,
    workerName,
  });
  expect(paired.exit.code).toBe(0);
}

async function runStaleAttempt(
  apiUrl: string,
  configDirectory: string,
  job: JobEnvelope,
): Promise<WorkerRunResult> {
  const child = spawnWorker("stale-attempt", apiUrl, configDirectory);
  await child.waitFor(isReadyForStaleAttempt);
  child.send({ kind: "stale-attempt", job });
  return finishWorker(child, isStaleAttemptResult);
}

async function runWorker(
  mode: "pair" | "pair-and-run" | "start" | "claim-and-exit",
  apiUrl: string,
  configDirectory: string,
  options: { pairingCode?: string; workerName?: string } = {},
): Promise<WorkerRunResult> {
  const child = spawnWorker(mode, apiUrl, configDirectory, options);
  const terminal =
    mode === "claim-and-exit"
      ? isClaimResult
      : mode === "pair"
        ? isPairedResult
        : isRunFinishedResult;
  return finishWorker(child, terminal);
}

async function finishWorker(
  child: ProcessHarness,
  terminal: (message: unknown) => boolean,
): Promise<WorkerRunResult> {
  const message = await child.waitFor((candidate) => terminal(candidate) || isFatal(candidate));
  const exit = await child.waitForExit();
  if (isFatal(message)) {
    throw new Error(`Worker child ${child.pid} failed: ${message.error}\n${child.stderr}`);
  }
  const result: WorkerRunResult = {
    pid: child.pid,
    exit,
    stdout: child.stdout,
    stderr: child.stderr,
  };
  const messageConfig = configFromMessage(message);
  if (messageConfig) result.messageConfig = messageConfig;
  if (isClaimResult(message)) result.claimedJob = message.job;
  if (isStaleAttemptResult(message)) result.staleAttempts = message.attempts;
  return result;
}

function spawnWorker(
  mode: string,
  apiUrl: string,
  configDirectory: string,
  options: { pairingCode?: string; workerName?: string } = {},
): ProcessHarness {
  return spawnHarness(workerFixturePath, {
    REALITY_CHILD_MODE: mode,
    REALITY_API_URL: apiUrl,
    REALITY_CONFIG_DIR: configDirectory,
    ...(options.pairingCode ? { REALITY_PAIRING_CODE: options.pairingCode } : {}),
    ...(options.workerName ? { REALITY_WORKER_NAME: options.workerName } : {}),
  });
}

async function expectWorkspaceClean(configDirectory: string): Promise<void> {
  const workspaceDirectory = path.join(configDirectory, "jobs");
  try {
    expect(await readdir(workspaceDirectory)).toEqual([]);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

async function waitUntilAfter(isoDate: string): Promise<void> {
  const target = Date.parse(isoDate);
  if (!Number.isFinite(target)) throw new Error(`Invalid lease expiry: ${isoDate}`);
  const delay = Math.max(0, target - Date.now() + 150);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

function smokeTaskId(created: CreatedSmokeTask): string {
  return "task" in created ? created.task.id : created.id;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

type WorkerRunResult = {
  pid: number;
  exit: { code: number | null; signal: NodeJS.Signals | null };
  stdout: string;
  stderr: string;
  messageConfig?: { workerId: string; pairedAt: string };
  claimedJob?: JobEnvelope | null;
  staleAttempts?: Record<string, { rejected: boolean; error?: string }>;
};

type ChildMessage =
  | { kind: "ready"; apiUrl: string; pid: number }
  | { kind: "paired"; pid: number; config: { workerId: string; pairedAt: string } }
  | { kind: "run-finished"; pid: number; config: { workerId: string; pairedAt: string } }
  | { kind: "claim-result"; pid: number; config: { workerId: string; pairedAt: string }; job: JobEnvelope | null }
  | { kind: "ready-for-stale-attempt"; pid: number }
  | {
      kind: "stale-attempt-result";
      pid: number;
      attempts: Record<string, { rejected: boolean; error?: string }>;
    }
  | { kind: "rpc-result"; requestId: string; ok: boolean; value?: unknown; error?: string }
  | { kind: "fatal"; pid: number; error: string };

function isMessage(value: unknown): value is ChildMessage {
  return Boolean(value && typeof value === "object" && "kind" in value && typeof value.kind === "string");
}

function isFatal(value: unknown): value is Extract<ChildMessage, { kind: "fatal" }> {
  return isMessage(value) && value.kind === "fatal";
}

function isPairedResult(value: unknown): value is Extract<ChildMessage, { kind: "paired" }> {
  return isMessage(value) && value.kind === "paired";
}

function isRunFinishedResult(value: unknown): value is Extract<ChildMessage, { kind: "run-finished" }> {
  return isMessage(value) && value.kind === "run-finished";
}

function isClaimResult(value: unknown): value is Extract<ChildMessage, { kind: "claim-result" }> {
  return isMessage(value) && value.kind === "claim-result";
}

function isReadyForStaleAttempt(
  value: unknown,
): value is Extract<ChildMessage, { kind: "ready-for-stale-attempt" }> {
  return isMessage(value) && value.kind === "ready-for-stale-attempt";
}

function isStaleAttemptResult(
  value: unknown,
): value is Extract<ChildMessage, { kind: "stale-attempt-result" }> {
  return isMessage(value) && value.kind === "stale-attempt-result";
}

function configFromMessage(message: unknown): { workerId: string; pairedAt: string } | undefined {
  if (isPairedResult(message) || isRunFinishedResult(message) || isClaimResult(message)) {
    return message.config;
  }
  return undefined;
}

class RealityServer {
  private constructor(
    private readonly process: ProcessHarness,
    readonly apiUrl: string,
  ) {}

  static async start(databasePath: string): Promise<RealityServer> {
    const child = spawnHarness(serverFixturePath, {
      DEMO_DATABASE_PATH: databasePath,
      DEMO_SESSION_SECRET: "worker-reality-test-only-pairing-secret-32-chars",
      WORKER_REALITY_LEASE_TTL_MS: "5000",
      TSX_TSCONFIG_PATH: path.join(workspaceRoot, "apps", "web", "tsconfig.json"),
      NODE_ENV: "test",
    });
    const ready = await child.waitFor(
      (message): message is Extract<ChildMessage, { kind: "ready" }> =>
        isMessage(message) && message.kind === "ready",
    );
    return new RealityServer(child, ready.apiUrl);
  }

  get stdout(): string {
    return this.process.stdout;
  }

  get stderr(): string {
    return this.process.stderr;
  }

  async rpc<T>(operation: string, input?: Record<string, unknown>): Promise<T> {
    const requestId = randomUUID();
    this.process.send({ kind: "rpc", requestId, operation, ...(input ? { input } : {}) });
    const response = await this.process.waitFor(
      (message): message is Extract<ChildMessage, { kind: "rpc-result" }> =>
        isMessage(message) && message.kind === "rpc-result" && message.requestId === requestId,
    );
    if (!response.ok) throw new Error(response.error ?? `Reality server RPC ${operation} failed`);
    return response.value as T;
  }

  async stop(): Promise<void> {
    if (this.process.exited) return;
    try {
      await this.rpc("shutdown");
      await this.process.waitForExit();
    } finally {
      runningChildren.delete(this.process);
    }
  }
}

class ProcessHarness {
  readonly pid: number;
  stdout = "";
  stderr = "";
  exited = false;

  private readonly messages: unknown[] = [];
  private readonly waiters = new Set<{
    predicate: (message: unknown) => boolean;
    resolve: (message: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  constructor(private readonly child: ChildProcess) {
    if (!child.pid) throw new Error("Child process did not receive a PID");
    this.pid = child.pid;
    child.stdout?.on("data", (chunk: Buffer) => (this.stdout += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (this.stderr += chunk.toString("utf8")));
    child.on("message", (message: unknown) => this.receive(message));
    this.exitPromise = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        this.exited = true;
        for (const waiter of this.waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error(`Child ${this.pid} exited before the expected message\n${this.stderr}`));
        }
        this.waiters.clear();
        resolve({ code, signal });
      });
    });
    runningChildren.add(this);
  }

  send(message: unknown): void {
    if (!this.child.connected) throw new Error(`Child ${this.pid} IPC channel is closed`);
    this.child.send(message as never);
  }

  waitFor<T>(predicate: (message: unknown) => message is T, timeoutMs?: number): Promise<T>;
  waitFor(predicate: (message: unknown) => boolean, timeoutMs?: number): Promise<unknown>;
  waitFor(predicate: (message: unknown) => boolean, timeoutMs = 30_000): Promise<unknown> {
    const existingIndex = this.messages.findIndex(predicate);
    if (existingIndex >= 0) return Promise.resolve(this.messages.splice(existingIndex, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for child ${this.pid}\n${this.stderr}`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async waitForExit(timeoutMs = 30_000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for child ${this.pid} to exit`)),
          timeoutMs,
        );
      });
      const result = await Promise.race([this.exitPromise, timeout]);
      runningChildren.delete(this);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async terminate(): Promise<void> {
    if (this.exited) {
      runningChildren.delete(this);
      return;
    }
    this.child.kill("SIGTERM");
    await this.waitForExit(5_000).catch(async () => {
      this.child.kill("SIGKILL");
      await this.waitForExit(5_000).catch(() => undefined);
    });
    runningChildren.delete(this);
  }

  private receive(message: unknown): void {
    for (const waiter of this.waiters) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(message);
      return;
    }
    this.messages.push(message);
  }
}

function spawnHarness(scriptPath: string, environment: Record<string, string>): ProcessHarness {
  const child = fork(scriptPath, [], {
    cwd: workspaceRoot,
    execArgv: ["--import", "tsx"],
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  return new ProcessHarness(child);
}
