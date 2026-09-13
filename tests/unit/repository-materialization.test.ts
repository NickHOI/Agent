import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DemoStore } from "@donelayer/database";
import {
  PermissionGuard,
  PermissionViolationError,
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_NAME,
  REPOSITORY_MATERIALIZATION_OWNER,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  WORKER_PROTOCOL_VERSION,
  assertAllowlistedRepositoryRedirect,
  assertAllowlistedRepositoryUrl,
  assertRepositoryRelativePath,
  canonicalRepositoryJson,
  jobEnvelopeSchema,
  repositoryFileManifestSchema,
  repositoryManifestSha256,
  type JobEnvelope,
  type PermissionLeaseEnvelope,
  type WorkerCapabilities,
} from "@donelayer/worker-protocol";

const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })));
  temporaryDirectories.clear();
});

describe("Repository materialization security policy", () => {
  it("accepts only the exact HTTPS allowlist URL", () => {
    expect(assertAllowlistedRepositoryUrl(REPOSITORY_MATERIALIZATION_REMOTE_URL)).toBe(
      REPOSITORY_MATERIALIZATION_REMOTE_URL,
    );

    for (const rejected of [
      "https://github.com/NickHOI/another-repository.git",
      "file:///tmp/donelayer-build-rescue-fixture",
      "ssh://git@github.com/NickHOI/donelayer-build-rescue-fixture.git",
      "git@github.com:NickHOI/donelayer-build-rescue-fixture.git",
      "ftp://github.com/NickHOI/donelayer-build-rescue-fixture.git",
      "http://github.com/NickHOI/donelayer-build-rescue-fixture.git",
      "https://localhost/NickHOI/donelayer-build-rescue-fixture.git",
      "https://127.0.0.1/NickHOI/donelayer-build-rescue-fixture.git",
      "https://[::1]/NickHOI/donelayer-build-rescue-fixture.git",
      "https://192.168.1.10/NickHOI/donelayer-build-rescue-fixture.git",
      "C:\\fixture",
      "\\\\server\\fixture",
      "https://user:password@github.com/NickHOI/donelayer-build-rescue-fixture.git",
      `${REPOSITORY_MATERIALIZATION_REMOTE_URL}?token=secret`,
      `${REPOSITORY_MATERIALIZATION_REMOTE_URL}/extra`,
      "https://github.example.com/NickHOI/donelayer-build-rescue-fixture.git",
      "https://github.com/OtherOwner/donelayer-build-rescue-fixture.git",
    ]) {
      expect(() => assertAllowlistedRepositoryUrl(rejected), rejected).toThrow(/allowlist|repository url/i);
    }
  });

  it("revalidates redirects and rejects a different host", () => {
    expect(() =>
      assertAllowlistedRepositoryRedirect(
        REPOSITORY_MATERIALIZATION_REMOTE_URL,
        "https://evil.example/NickHOI/donelayer-build-rescue-fixture.git",
      ),
    ).toThrow(/allowlist/i);
  });

  it("rejects traversal and .git paths while hashing canonical manifests", () => {
    const manifest = repositoryFileManifestSchema.parse({
      schemaVersion: 1,
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: REPOSITORY_MATERIALIZATION_BRANCH,
      commitSha: "a".repeat(40),
      files: [
        { relative_path: "README.md", size_bytes: 12, sha256: "b".repeat(64) },
        { relative_path: "src/add.ts", size_bytes: 20, sha256: "c".repeat(64) },
      ],
    });
    const canonical = canonicalRepositoryJson(manifest);
    expect(repositoryManifestSha256(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(repositoryManifestSha256({ ...manifest, files: [{ ...manifest.files[0]!, size_bytes: 13 }, manifest.files[1]!] })).not.toBe(
      repositoryManifestSha256(manifest),
    );
    expect(JSON.parse(canonical)).toEqual(manifest);
    for (const rejected of ["../secret", "src/../../secret", "/absolute", "src\\add.ts", ".git/config", "src/.git/config"]) {
      expect(() => assertRepositoryRelativePath(rejected), rejected).toThrow(/path|git|traversal/i);
    }
  });

  it("binds the repository envelope to its executor, Permission scope, and branch", () => {
    const envelope = repositoryJobEnvelope();
    expect(jobEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(jobEnvelopeSchema.safeParse({
      ...envelope,
      repository: { ...envelope.repository, remoteUrl: "https://github.com/NickHOI/other.git" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...envelope,
      permissionLease: {
        ...envelope.permissionLease,
        scope: { ...envelope.permissionLease.scope, allowedRepositories: ["https://github.com/NickHOI/other.git"] },
      },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...envelope,
      repository: { ...envelope.repository, targetBranch: "does-not-exist" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({ ...envelope, executor: { kind: "demo" } }).success).toBe(false);
  });

  it("enforces action, repository, branch, time, revocation, and workspace boundaries", async () => {
    const workdir = await temporaryDirectory("donelayer-repository-permission-");
    const outside = await temporaryDirectory("donelayer-repository-outside-");
    await mkdir(path.join(workdir, "repository"));
    const lease = repositoryPermissionLease();
    const guard = new PermissionGuard(lease);
    guard.bindWorkspace(workdir);
    expect(() => guard.assertActionAllowed("git_clone_allowlisted_repository")).not.toThrow();
    expect(() => guard.assertRepositoryAllowed(REPOSITORY_MATERIALIZATION_REMOTE_URL, "main")).not.toThrow();
    expect(() => guard.assertPathAllowed(path.join(workdir, "repository", "README.md"))).not.toThrow();
    expect(() => guard.assertActionAllowed("npm_test")).toThrow(PermissionViolationError);
    expect(() => guard.assertRepositoryAllowed("https://github.com/NickHOI/other.git", "main")).toThrow(PermissionViolationError);
    expect(() => guard.assertRepositoryAllowed(REPOSITORY_MATERIALIZATION_REMOTE_URL, "missing")).toThrow(PermissionViolationError);
    expect(() => guard.assertPathAllowed(path.join(outside, "secret.txt"))).toThrow(PermissionViolationError);

    const expired = new PermissionGuard({ ...lease, expiresAt: new Date(Date.now() - 1).toISOString() });
    expect(() => expired.assertLeaseActive()).toThrow(PermissionViolationError);
    const revoked = new PermissionGuard({ ...lease, status: "REVOKED" } as unknown as PermissionLeaseEnvelope);
    expect(() => revoked.assertLeaseActive()).toThrow(PermissionViolationError);
  });

  it("records a repository Permission violation and cannot issue a VERIFIED Receipt", () => {
    const store = new DemoStore(":memory:", {
      remoteCommitResolver: () => {
        throw new Error("Remote verifier must not run after a Permission violation");
      },
    });
    try {
      const workerId = "20000000-0000-4000-8000-000000000002";
      store.recordWorkerHeartbeat(workerId, "ONLINE", repositoryCapabilities(12345), [], new Date().toISOString());
      const aggregate = store.createRepositoryMaterializationTask(workerId);
      const claimed = store.claimAssignedJob(workerId, aggregate.jobRun?.id);
      expect(claimed).not.toBeNull();
      const violated = store.recordPermissionViolation(
        claimed!.aggregate.jobRun!.id,
        workerId,
        "npm_test",
        "Repository code execution is denied",
      );
      expect(violated.status).toBe("VIOLATED");
      const completed = store.getTaskAggregate(aggregate.task.id);
      expect(completed.evidenceLedger.some((entry) => entry.entryType === "PERMISSION_VIOLATION")).toBe(true);
      expect(completed.receipt?.result).toBe("PERMISSION_VIOLATION");
      expect(completed.receipt?.result).not.toBe("VERIFIED");
      expect(completed.receipt?.receipt.receiptType).toBe("REPOSITORY_MATERIALIZATION_VERIFICATION");
    } finally {
      store.close();
    }
  });

  it("fails independent verification when the Worker Commit differs from the Remote", () => {
    const store = new DemoStore(":memory:", {
      remoteCommitResolver: (remoteUrl, branch) => ({
        remoteUrl,
        branch,
        commitSha: "d".repeat(40),
        exitCode: 0,
        stdout: `${"d".repeat(40)}\trefs/heads/main\n`,
        stderr: "",
        verifiedAt: new Date().toISOString(),
      }),
    });
    try {
      const active = prepareRepositoryJob(store, 23456);
      const manifest = canonicalRepositoryJson(repositoryFileManifestSchema.parse({
        schemaVersion: 1,
        remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        branch: REPOSITORY_MATERIALIZATION_BRANCH,
        commitSha: "a".repeat(40),
        files: [{ relative_path: "README.md", size_bytes: 1, sha256: "b".repeat(64) }],
      }));
      const bytes = Buffer.from(manifest, "utf8");
      const digest = createHash("sha256").update(bytes).digest("hex");
      const upload = store.initializeArtifactUpload(active.jobRunId, active.workerId, active.leaseToken, {
        artifactType: "OTHER",
        fileName: "file-manifest.json",
        mimeType: "application/json",
        size: bytes.byteLength,
        sha256: digest,
      });
      store.receiveArtifactUpload(upload.artifactId, upload.uploadToken, active.workerId, active.leaseToken, "application/json", bytes);
      expect(() =>
        store.finalizeArtifactUpload(active.jobRunId, active.workerId, active.leaseToken, upload.artifactId, digest),
      ).toThrow(/independently verified Remote Commit SHA/i);
      expect(store.getJobReceiptByJobRun(active.jobRunId)).toBeNull();
      expect(store.listEvidenceLedgerEntries(active.jobRunId).some((entry) => entry.entryType === "REMOTE_COMMIT_VERIFIED")).toBe(false);
    } finally {
      store.close();
    }
  });

  it("rejects Manifest bytes changed after the Worker SHA-256 declaration", () => {
    const store = new DemoStore(":memory:");
    try {
      const active = prepareRepositoryJob(store, 34567);
      const manifest = canonicalRepositoryJson(repositoryFileManifestSchema.parse({
        schemaVersion: 1,
        remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        branch: REPOSITORY_MATERIALIZATION_BRANCH,
        commitSha: "a".repeat(40),
        files: [{ relative_path: "README.md", size_bytes: 1, sha256: "b".repeat(64) }],
      }));
      const expectedBytes = Buffer.from(manifest, "utf8");
      const tamperedBytes = Buffer.from(manifest.replace("b".repeat(64), "c".repeat(64)), "utf8");
      expect(tamperedBytes.byteLength).toBe(expectedBytes.byteLength);
      const declaredDigest = createHash("sha256").update(expectedBytes).digest("hex");
      const upload = store.initializeArtifactUpload(active.jobRunId, active.workerId, active.leaseToken, {
        artifactType: "OTHER",
        fileName: "file-manifest.json",
        mimeType: "application/json",
        size: expectedBytes.byteLength,
        sha256: declaredDigest,
      });
      expect(() =>
        store.receiveArtifactUpload(
          upload.artifactId,
          upload.uploadToken,
          active.workerId,
          active.leaseToken,
          "application/json",
          tamperedBytes,
        ),
      ).toThrow(/hash does not match/i);
      expect(store.getJobReceiptByJobRun(active.jobRunId)).toBeNull();
    } finally {
      store.close();
    }
  });

  it("marks a clone executor failure terminal without Demo fallback or a VERIFIED Receipt", () => {
    const store = new DemoStore(":memory:");
    try {
      const active = prepareRepositoryJob(store, 45678);
      const timestamp = new Date().toISOString();
      store.appendWorkerProtocolEvent(active.jobRunId, active.workerId, active.leaseToken, {
        eventId: randomUUID(),
        type: "EXECUTOR_STARTED",
        message: "Repository materializer started",
        createdAt: timestamp,
      });
      store.appendWorkerProtocolEvent(active.jobRunId, active.workerId, active.leaseToken, {
        eventId: randomUUID(),
        type: "EXECUTOR_FAILED",
        message: "Allowlisted branch does not exist",
        createdAt: new Date().toISOString(),
      });
      store.appendWorkerProtocolEvent(active.jobRunId, active.workerId, active.leaseToken, {
        eventId: randomUUID(),
        type: "CLEANUP_FINISHED",
        message: "Disposable workspace removed",
        createdAt: new Date().toISOString(),
      });
      const aggregate = store.getTaskAggregate(store.getJobRun(active.jobRunId)!.taskId);
      expect(aggregate.task.status).toBe("VERIFICATION_FAILED");
      expect(aggregate.jobRun?.status).toBe("FAILED");
      expect(aggregate.receipt).toBeNull();
      expect(aggregate.evidence).toEqual([]);
      expect(aggregate.evidenceLedger.some((entry) => entry.entryType === "VERIFICATION_FAILED")).toBe(true);
    } finally {
      store.close();
    }
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
}

function repositoryPermissionLease(): PermissionLeaseEnvelope {
  return {
    id: randomUUID(),
    version: 1,
    status: "ACTIVE",
    startsAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    scope: {
      allowedActions: [
        "create_job_workspace",
        "git_clone_allowlisted_repository",
        "read_git_metadata",
        "read_files_inside_job_workspace",
        "calculate_file_sha256",
        "create_file_manifest",
        "upload_artifact",
        "report_progress",
        "cleanup_workspace",
      ],
      deniedActions: ["npm_test", "arbitrary_shell", "execute_repository_code"],
      allowedPaths: ["$JOB_WORKSPACE"],
      allowedDomains: ["github.com"],
      allowedRepositories: [REPOSITORY_MATERIALIZATION_REMOTE_URL],
      allowedBranches: [REPOSITORY_MATERIALIZATION_BRANCH],
      maxArtifactBytes: 2 * 1024 * 1024,
      maxRuntimeSeconds: 120,
      maxApiBudget: 0,
      humanApprovalActions: [],
    },
  };
}

function repositoryJobEnvelope(): JobEnvelope {
  const lease = repositoryPermissionLease();
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    taskId: randomUUID(),
    assignmentId: randomUUID(),
    providerAcceptedAt: new Date().toISOString(),
    jobRunId: randomUUID(),
    workerId: randomUUID(),
    leaseToken: `dls_${"a".repeat(16)}.${"b".repeat(43)}`,
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
    taskContract: { id: randomUUID(), version: 1, sha256: "c".repeat(64) },
    permissionLease: lease,
    executor: { kind: "repository-materializer" },
    workflow: { id: "REPOSITORY_MATERIALIZE_V1", version: 1, allowedCommandIds: [] },
    task: {
      title: "Repository materialization",
      problemDescription: "Clone the exact allowlisted fixture without executing repository code.",
      desiredOutcome: "Produce real repository metadata and a file manifest.",
      scopeSummary: "Repository materialization only.",
      acceptanceChecks: [],
    },
    repository: {
      mode: "allowlisted-github",
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      owner: REPOSITORY_MATERIALIZATION_OWNER,
      name: REPOSITORY_MATERIALIZATION_NAME,
      targetBranch: REPOSITORY_MATERIALIZATION_BRANCH,
    },
    permissions: { modifyCode: false, createPullRequest: false, humanApprovalRequired: false },
    limits: {
      timeoutMs: 120_000,
      maxLogBytes: 512 * 1024,
      maxArtifactBytes: lease.scope.maxArtifactBytes,
      maxArtifacts: 3,
      allowedMimeTypes: ["text/plain", "application/json"],
      allowedNetworkDomains: ["github.com"],
    },
  };
}

function repositoryCapabilities(processId: number): WorkerCapabilities {
  return {
    os: "windows",
    architecture: "x64",
    cpuCount: 4,
    nodeVersion: process.version,
    npmVersion: "11.0.0",
    workerVersion: "0.1.0",
    processId,
    memoryBytes: 8 * 1024 ** 3,
    availableMemoryBytes: 4 * 1024 ** 3,
    freeDiskBytes: 10 * 1024 ** 3,
    dockerAvailable: false,
    codexAvailable: false,
    gitAvailable: true,
    githubCliAvailable: false,
    supportedLanguages: ["JavaScript/TypeScript"],
    installedTools: ["node", "git"],
    mcpServers: [],
    executors: ["worker-smoke", "repository-materializer"],
    maxConcurrentJobs: 1,
  };
}

function prepareRepositoryJob(store: DemoStore, processId: number): {
  workerId: string;
  jobRunId: string;
  leaseToken: string;
} {
  const workerId = "20000000-0000-4000-8000-000000000002";
  store.recordWorkerHeartbeat(workerId, "ONLINE", repositoryCapabilities(processId), [], new Date().toISOString());
  const task = store.createRepositoryMaterializationTask(workerId);
  const claimed = store.claimAssignedJob(workerId, task.jobRun?.id);
  if (!claimed?.aggregate.jobRun) throw new Error("Repository Job could not be claimed");
  return { workerId, jobRunId: claimed.aggregate.jobRun.id, leaseToken: claimed.leaseToken };
}
