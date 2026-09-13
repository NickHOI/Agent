import { createHash } from "node:crypto";
import { arch } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { DemoStore, demoIds } from "@donelayer/database";
import type { WorkerCapabilities } from "@donelayer/worker-protocol";
import { runDoctor } from "../../apps/worker/src/doctor.js";

const stores: DemoStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("Worker Reality Store pairing and capabilities", () => {
  it("expires a real pairing code and never authenticates it", async () => {
    const store = createStore({ pairingCodeTtlMs: 20 });
    const worker = store.createWorker(demoIds.providerAlpha, "Expiry Worker", "WINDOWS");
    const pairing = store.createPairingCode(worker.id, demoIds.providerAlpha);

    await waitUntilAfter(pairing.expiresAt);

    expect(() => store.pairWorker(pairing.code)).toThrow(/invalid or expired/i);
    expect(store.getWorker(worker.id)?.tokenHash).toBeNull();
  });

  it("validates a Worker token and rejects it after server-side revocation", () => {
    const store = createStore();
    const { workerId, token } = pairWorker(store, "Token Worker");
    const finalCharacter = token.at(-1);
    const tamperedToken = `${token.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`;

    expect(store.authenticateWorker(token)?.id).toBe(workerId);
    expect(store.authenticateWorker(tamperedToken)).toBeNull();
    expect(store.authenticateWorker("not-a-worker-token")).toBeNull();

    store.revokeWorkerToken(workerId);

    expect(store.authenticateWorker(token)).toBeNull();
    expect(store.getWorker(workerId)).toMatchObject({
      status: "OFFLINE",
      tokenHash: null,
      tokenId: null,
    });
  });

  it("detects the real process capabilities required by the smoke Worker", async () => {
    const report = await runDoctor({ workspacePath: process.cwd() });

    expect(report.capabilities).toMatchObject({
      architecture: arch(),
      nodeVersion: process.version,
      processId: process.pid,
      maxConcurrentJobs: 1,
      executors: report.capabilities.gitAvailable
        ? ["worker-smoke", "repository-materializer"]
        : ["worker-smoke"],
    });
    expect(report.capabilities.memoryBytes).toBeGreaterThan(0);
    expect(report.capabilities.availableMemoryBytes).toBeGreaterThanOrEqual(0);
    expect(report.capabilities.freeDiskBytes).toBeGreaterThan(0);
    expect(report.capabilities.installedTools).toContain("node");
    expect(typeof report.capabilities.gitAvailable).toBe("boolean");
    expect(typeof report.capabilities.dockerAvailable).toBe("boolean");
    expect(typeof report.capabilities.codexAvailable).toBe("boolean");
  });

  it("persists an immutable capability snapshot in Job evidence", () => {
    const store = createStore();
    const { workerId } = pairWorker(store, "Capability Worker");
    const firstCapabilities = capabilities({
      workerVersion: "1.0.0",
      installedTools: ["node", "git"],
      gitAvailable: true,
    });
    store.recordWorkerHeartbeat(workerId, "ONLINE", firstCapabilities, [], new Date().toISOString());
    firstCapabilities.installedTools.push("mutated-after-persistence");

    const firstSnapshot = store.getLatestWorkerCapabilitySnapshot(workerId);
    expect(firstSnapshot?.capabilities.installedTools).toEqual(["node", "git"]);

    const claimed = createAndClaimSmokeJob(store, workerId);
    const evidenceBeforeUpdate = store.getJobCapabilityEvidence(claimed.jobRunId);
    expect(evidenceBeforeUpdate).toMatchObject({
      snapshotId: firstSnapshot?.id,
      capabilities: { workerVersion: "1.0.0", gitAvailable: true },
    });

    const secondCapabilities = capabilities({
      workerVersion: "2.0.0",
      installedTools: ["node"],
      gitAvailable: false,
    });
    store.recordWorkerHeartbeat(
      workerId,
      "BUSY",
      secondCapabilities,
      [claimed.jobRunId],
      new Date(Date.now() + 1).toISOString(),
    );

    expect(store.getLatestWorkerCapabilitySnapshot(workerId)).toMatchObject({
      capabilities: { workerVersion: "2.0.0", gitAvailable: false },
    });
    expect(store.getJobCapabilityEvidence(claimed.jobRunId)).toEqual(evidenceBeforeUpdate);
  });
});

describe("Worker Reality Store leases", () => {
  it("creates an owned, expiring Lease when the assigned Worker claims", () => {
    const store = createStore({ leaseDurationMs: 500, heartbeatTtlMs: 1_000 });
    const { workerId } = pairWorker(store, "Lease Worker");
    heartbeat(store, workerId);
    const queued = store.createWorkerSmokeTask(workerId);
    const claim = store.claimAssignedJob(workerId, queued.jobRun?.id);

    expect(claim?.aggregate.task.status).toBe("RUNNING");
    expect(claim?.aggregate.jobRun).toMatchObject({ status: "RUNNING", workerId });
    expect(claim?.aggregate.jobRun?.leaseId).toMatch(/^[a-f0-9]{16}$/);
    expect(claim?.leaseToken).toMatch(
      new RegExp(`^dls_${claim?.aggregate.jobRun?.leaseId}\\.[A-Za-z0-9_-]{40,}$`),
    );
    expect(Date.parse(claim?.aggregate.jobRun?.leaseExpiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(store.getJobCapabilityEvidence(claim?.aggregate.jobRun?.id ?? "")?.snapshotId).toBeTruthy();
  });

  it("expires Worker A, keeps Worker B out during the Lease, and rejects the old Lease", async () => {
    const store = createStore({ leaseDurationMs: 250, heartbeatTtlMs: 500 });
    const workerA = pairWorker(store, "Lease Worker A");
    const workerB = pairWorker(store, "Lease Worker B");
    heartbeat(store, workerA.workerId);
    heartbeat(store, workerB.workerId);
    const queued = store.createWorkerSmokeTask(workerA.workerId);
    const claimA = store.claimAssignedJob(workerA.workerId, queued.jobRun?.id);
    if (!claimA?.aggregate.jobRun?.leaseExpiresAt) throw new Error("Worker A did not receive a Lease");

    expect(store.claimAssignedJob(workerB.workerId)).toBeNull();
    await waitUntilAfter(claimA.aggregate.jobRun.leaseExpiresAt);

    expect(() =>
      store.renewJobLease(
        claimA.aggregate.jobRun!.id,
        workerA.workerId,
        claimA.leaseToken,
      ),
    ).toThrow(/expired/i);

    const claimB = store.claimAssignedJob(workerB.workerId);
    expect(claimB?.aggregate.jobRun).toMatchObject({
      workerId: workerB.workerId,
      status: "RUNNING",
    });
    expect(claimB?.aggregate.jobRun?.id).not.toBe(claimA.aggregate.jobRun.id);
    expect(store.getJobRun(claimA.aggregate.jobRun.id)).toMatchObject({ status: "EXPIRED" });
    expect(store.getJobRunAttempt(claimA.aggregate.jobRun.id)).toMatchObject({
      terminalReason: "LEASE_EXPIRED",
    });
    expect(store.getJobRunAttempt(claimA.aggregate.jobRun.id)?.leaseRevokedAt).toBeTruthy();
    expect(() =>
      store.appendWorkerProtocolEvent(
        claimA.aggregate.jobRun!.id,
        workerA.workerId,
        claimA.leaseToken,
        {
          eventId: crypto.randomUUID(),
          type: "PROGRESS",
          message: "stale result",
          createdAt: new Date().toISOString(),
        },
      ),
    ).toThrow(/expired|revoked|not active/i);
  });
});

describe("Worker Reality Store artifact uploads", () => {
  it("recomputes the real SHA-256 and persists canonical Artifact metadata", () => {
    const store = createStore({ leaseDurationMs: 2_000, heartbeatTtlMs: 3_000 });
    const { workerId } = pairWorker(store, "Artifact Worker");
    heartbeat(store, workerId);
    const claimed = createAndClaimSmokeJob(store, workerId);
    const bytes = Buffer.from(
      `Job ID: ${claimed.jobRunId}\nWorker ID: ${workerId}\nStarted At: 2026-08-03T00:00:00.000Z\nFinished At: 2026-08-03T00:00:01.000Z\nWorker OS: ${process.platform}\n`,
      "utf8",
    );
    const digest = sha256(bytes);
    const upload = store.initializeArtifactUpload(claimed.jobRunId, workerId, claimed.leaseToken, {
      artifactType: "OTHER",
      fileName: "hello.txt",
      mimeType: "text/plain",
      size: bytes.byteLength,
      sha256: digest,
    });

    store.receiveArtifactUpload(
      upload.artifactId,
      upload.uploadToken,
      workerId,
      claimed.leaseToken,
      "text/plain; charset=utf-8",
      bytes,
    );
    const artifact = store.finalizeArtifactUpload(
      claimed.jobRunId,
      workerId,
      claimed.leaseToken,
      upload.artifactId,
      digest,
    );

    expect(artifact).toMatchObject({
      id: upload.artifactId,
      taskId: claimed.taskId,
      jobRunId: claimed.jobRunId,
      workerId,
      fileName: "hello.txt",
      mimeType: "text/plain",
      size: bytes.byteLength,
      sha256: digest,
      claimedSha256: digest,
      serverSha256: digest,
      content: bytes.toString("utf8"),
    });
    expect(store.getTaskAggregate(claimed.taskId).evidence).toEqual([
      expect.objectContaining({ id: upload.artifactId, sha256: digest }),
    ]);
  });

  it("rejects missing Jobs, unsafe names, disallowed MIME types, and oversized metadata", () => {
    const store = createStore({ leaseDurationMs: 2_000, heartbeatTtlMs: 3_000 });
    const { workerId } = pairWorker(store, "Artifact Validation Worker");
    heartbeat(store, workerId);
    const claimed = createAndClaimSmokeJob(store, workerId);
    const base = {
      artifactType: "OTHER",
      fileName: "hello.txt",
      mimeType: "text/plain",
      size: 5,
      sha256: sha256("hello"),
    };

    expect(() =>
      store.initializeArtifactUpload(crypto.randomUUID(), workerId, claimed.leaseToken, base),
    ).toThrow(/lease is invalid/i);
    expect(() =>
      store.initializeArtifactUpload(claimed.jobRunId, workerId, claimed.leaseToken, {
        ...base,
        fileName: "../../hello.txt",
      }),
    ).toThrow(/file name is invalid/i);
    expect(() =>
      store.initializeArtifactUpload(claimed.jobRunId, workerId, claimed.leaseToken, {
        ...base,
        mimeType: "application/octet-stream",
      }),
    ).toThrow(/MIME type is not allowed/i);
    expect(() =>
      store.initializeArtifactUpload(claimed.jobRunId, workerId, claimed.leaseToken, {
        ...base,
        size: 10 * 1024 * 1024 + 1,
      }),
    ).toThrow(/size exceeds/i);
  });

  it("rejects another Worker and verifies received MIME, size, and bytes", () => {
    const store = createStore({ leaseDurationMs: 2_000, heartbeatTtlMs: 3_000 });
    const owner = pairWorker(store, "Artifact Owner");
    const other = pairWorker(store, "Artifact Intruder");
    heartbeat(store, owner.workerId);
    heartbeat(store, other.workerId);
    const claimed = createAndClaimSmokeJob(store, owner.workerId);
    const bytes = Buffer.from("hello", "utf8");
    const upload = store.initializeArtifactUpload(
      claimed.jobRunId,
      owner.workerId,
      claimed.leaseToken,
      {
        artifactType: "OTHER",
        fileName: "hello.txt",
        mimeType: "text/plain",
        size: bytes.byteLength,
        sha256: sha256(bytes),
      },
    );

    expect(() =>
      store.receiveArtifactUpload(
        upload.artifactId,
        upload.uploadToken,
        other.workerId,
        claimed.leaseToken,
        "text/plain",
        bytes,
      ),
    ).toThrow(/lease is invalid|does not belong/i);
    expect(() =>
      store.receiveArtifactUpload(
        upload.artifactId,
        upload.uploadToken,
        owner.workerId,
        claimed.leaseToken,
        "application/json",
        bytes,
      ),
    ).toThrow(/MIME type does not match/i);
    expect(() =>
      store.receiveArtifactUpload(
        upload.artifactId,
        upload.uploadToken,
        owner.workerId,
        claimed.leaseToken,
        "text/plain",
        Buffer.from("shorter"),
      ),
    ).toThrow(/size does not match/i);
    expect(() =>
      store.receiveArtifactUpload(
        upload.artifactId,
        upload.uploadToken,
        owner.workerId,
        claimed.leaseToken,
        "text/plain",
        Buffer.from("HELLO"),
      ),
    ).toThrow(/hash does not match/i);
  });

  it("rejects an initialized upload after its owning Lease expires", async () => {
    const store = createStore({
      leaseDurationMs: 250,
      artifactUploadTtlMs: 1_000,
      heartbeatTtlMs: 500,
    });
    const { workerId } = pairWorker(store, "Expired Upload Worker");
    heartbeat(store, workerId);
    const claimed = createAndClaimSmokeJob(store, workerId);
    const bytes = Buffer.from("hello", "utf8");
    const upload = store.initializeArtifactUpload(claimed.jobRunId, workerId, claimed.leaseToken, {
      artifactType: "OTHER",
      fileName: "hello.txt",
      mimeType: "text/plain",
      size: bytes.byteLength,
      sha256: sha256(bytes),
    });

    await waitUntilAfter(upload.expiresAt);

    expect(() =>
      store.receiveArtifactUpload(
        upload.artifactId,
        upload.uploadToken,
        workerId,
        claimed.leaseToken,
        "text/plain",
        bytes,
      ),
    ).toThrow(/unavailable or expired/i);
    expect(() =>
      store.initializeArtifactUpload(claimed.jobRunId, workerId, claimed.leaseToken, {
        artifactType: "OTHER",
        fileName: "late.txt",
        mimeType: "text/plain",
        size: bytes.byteLength,
        sha256: sha256(bytes),
      }),
    ).toThrow(/lease has expired/i);
  });
});

function createStore(
  options: {
    leaseDurationMs?: number;
    pairingCodeTtlMs?: number;
    artifactUploadTtlMs?: number;
    heartbeatTtlMs?: number;
  } = {},
): DemoStore {
  const store = new DemoStore(":memory:", {
    leaseDurationMs: 1_000,
    pairingCodeTtlMs: 1_000,
    artifactUploadTtlMs: 1_000,
    heartbeatTtlMs: 2_000,
    ...options,
  });
  stores.push(store);
  return store;
}

function pairWorker(store: DemoStore, name: string): { workerId: string; token: string } {
  const worker = store.createWorker(demoIds.providerAlpha, name, "WINDOWS");
  const pairing = store.createPairingCode(worker.id, demoIds.providerAlpha);
  const paired = store.pairWorker(pairing.code);
  return { workerId: worker.id, token: paired.token };
}

function heartbeat(store: DemoStore, workerId: string): void {
  store.recordWorkerHeartbeat(
    workerId,
    "ONLINE",
    capabilities(),
    [],
    new Date().toISOString(),
  );
}

function createAndClaimSmokeJob(
  store: DemoStore,
  workerId: string,
): { taskId: string; jobRunId: string; leaseToken: string } {
  const queued = store.createWorkerSmokeTask(workerId);
  const claimed = store.claimAssignedJob(workerId, queued.jobRun?.id);
  if (!claimed?.aggregate.jobRun) throw new Error("Worker did not claim its smoke Job");
  return {
    taskId: claimed.aggregate.task.id,
    jobRunId: claimed.aggregate.jobRun.id,
    leaseToken: claimed.leaseToken,
  };
}

function capabilities(overrides: Partial<WorkerCapabilities> = {}): WorkerCapabilities {
  return {
    os: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
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
    executors: ["worker-smoke"],
    maxConcurrentJobs: 1,
    ...overrides,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function waitUntilAfter(isoDate: string): Promise<void> {
  const expiresAt = Date.parse(isoDate);
  if (!Number.isFinite(expiresAt)) throw new Error(`Invalid expiry: ${isoDate}`);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 25)));
}
