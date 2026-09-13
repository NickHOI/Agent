import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { arch, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DemoStore, demoIds } from "@donelayer/database";
import {
  PermissionGuard,
  PermissionViolationError,
  type PermissionLeaseEnvelope,
  type PermissionViolation,
  type WorkerCapabilities,
} from "@donelayer/worker-protocol";

const stores: DemoStore[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("PermissionGuard", () => {
  it("allows only listed actions while the Permission Lease is active", () => {
    const violations: PermissionViolation[] = [];
    const guard = new PermissionGuard(permissionLease(), {
      onViolation: (violation) => violations.push(violation),
    });
    const duringLease = new Date("2026-08-26T12:00:30.000Z");

    expect(() => guard.assertActionAllowed("upload_artifact", duringLease)).not.toThrow();
    expect(() => guard.assertActionAllowed("git", duringLease)).toThrow(
      /explicitly denied/i,
    );
    expect(() => guard.assertActionAllowed("unknown_action", duringLease)).toThrow(
      /not allowed/i,
    );
    expect(violations).toMatchObject([
      { action: "git", reason: expect.stringMatching(/explicitly denied/i) },
      { action: "unknown_action", reason: expect.stringMatching(/not allowed/i) },
    ]);
  });

  it("fails closed before activation, at expiry, after revocation, and for invalid dates", () => {
    const active = permissionLease();
    const guard = new PermissionGuard(active);

    expect(() => guard.assertLeaseActive(new Date("2026-08-26T11:59:59.999Z"))).toThrow(
      /not active/i,
    );
    expect(() => guard.assertLeaseActive(new Date(active.expiresAt))).toThrow(/not active/i);
    expect(() =>
      new PermissionGuard({ ...active, status: "REVOKED" } as unknown as PermissionLeaseEnvelope)
        .assertLeaseActive(new Date("2026-08-26T12:00:30.000Z")),
    ).toThrow(/not active/i);
    expect(() =>
      new PermissionGuard({ ...active, expiresAt: "not-a-date" })
        .assertLeaseActive(new Date("2026-08-26T12:00:30.000Z")),
    ).toThrow(/not active/i);
  });

  it("confines file access to the real Job workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "donelayer-permission-path-"));
    temporaryDirectories.push(root);
    const workspace = path.join(root, "job");
    const outside = path.join(root, "outside");
    await mkdir(workspace);
    await mkdir(outside);
    const guard = new PermissionGuard(permissionLease(), { workspaceRoot: workspace });
    const duringLease = new Date("2026-08-26T12:00:30.000Z");

    expect(() =>
      guard.assertPathAllowed(path.join(workspace, "hello.txt"), duringLease),
    ).not.toThrow();
    expect(() =>
      guard.assertPathAllowed(path.join(workspace, "..", "outside", "stolen.txt"), duringLease),
    ).toThrow(/outside the granted Job workspace/i);
    expect(() =>
      new PermissionGuard({
        ...permissionLease(),
        scope: { ...permissionLease().scope, allowedPaths: ["$OTHER_WORKSPACE"] },
      }, { workspaceRoot: workspace }).assertPathAllowed(
        path.join(workspace, "hello.txt"),
        duringLease,
      ),
    ).toThrow(/not granted/i);
  });

  it("requires HTTPS and an exact allowlisted network domain", () => {
    const guard = new PermissionGuard(permissionLease());
    const duringLease = new Date("2026-08-26T12:00:30.000Z");

    expect(() =>
      guard.assertDomainAllowed("https://api.example.test/v1/jobs", duringLease),
    ).not.toThrow();
    expect(() =>
      guard.assertDomainAllowed("https://sub.api.example.test/v1/jobs", duringLease),
    ).toThrow(/not allowed/i);
    expect(() =>
      guard.assertDomainAllowed("http://api.example.test/v1/jobs", duringLease),
    ).toThrow(/https|invalid/i);
    expect(() => guard.assertDomainAllowed("not-a-url", duringLease)).toThrow(/invalid/i);
  });

  it("enforces a finite cumulative API budget and records explicit violations", () => {
    const violations: PermissionViolation[] = [];
    const guard = new PermissionGuard(permissionLease(), {
      onViolation: (violation) => violations.push(violation),
    });
    const duringLease = new Date("2026-08-26T12:00:30.000Z");

    expect(() => guard.assertBudgetAvailable(0.5, 0.5, duringLease)).not.toThrow();
    expect(() => guard.assertBudgetAvailable(0.51, 0.5, duringLease)).toThrow(/exceeded/i);
    expect(() => guard.assertBudgetAvailable(Number.NaN, 0, duringLease)).toThrow(/exceeded/i);

    const error = guard.recordViolation("read_credentials", "Credential access was blocked", "HOME");
    expect(error).toBeInstanceOf(PermissionViolationError);
    expect(error.violation).toMatchObject({
      action: "read_credentials",
      resource: "HOME",
      reason: "Credential access was blocked",
    });
    expect(violations.at(-1)).toEqual(error.violation);
  });
});

describe("Permission Lease persistence", () => {
  it("binds the lease to the locked Contract, Job, Agent, and assigned Worker", () => {
    const store = createStore();
    const worker = pairAndHeartbeat(store, "Permission Owner");
    const aggregate = store.createWorkerSmokeTask(worker.workerId);
    if (!aggregate.jobRun) throw new Error("Smoke Job was not created");

    const pending = store.getPermissionLeaseForJob(aggregate.jobRun.id);
    expect(pending).toMatchObject({
      taskId: aggregate.task.id,
      taskContractVersionId: aggregate.jobRun.taskContractVersionId,
      jobRunId: aggregate.jobRun.id,
      agentId: aggregate.jobRun.agentId,
      workerId: worker.workerId,
      version: 1,
      status: "PENDING",
      startsAt: null,
      expiresAt: null,
    });

    const claimed = store.claimAssignedJob(worker.workerId, aggregate.jobRun.id);
    expect(claimed?.aggregate.jobRun?.leaseExpiresAt).toBeTruthy();
    const active = store.getPermissionLeaseForJob(aggregate.jobRun.id);
    expect(active).toMatchObject({ status: "ACTIVE", startsAt: expect.any(String), expiresAt: expect.any(String) });
    expect(Date.parse(claimed?.aggregate.jobRun?.leaseExpiresAt ?? "")).toBeLessThanOrEqual(
      Date.parse(active?.expiresAt ?? ""),
    );
    expect(store.assertPermissionActionAllowed(aggregate.jobRun.id, worker.workerId, "upload_artifact").id)
      .toBe(active?.id);
  });

  it("revokes authority immediately and persists a violation in the Evidence Ledger", () => {
    const store = createStore();
    const worker = pairAndHeartbeat(store, "Permission Revocation Worker");
    const aggregate = store.createWorkerSmokeTask(worker.workerId);
    if (!aggregate.jobRun) throw new Error("Smoke Job was not created");
    store.claimAssignedJob(worker.workerId, aggregate.jobRun.id);
    const active = store.getPermissionLeaseForJob(aggregate.jobRun.id);
    if (!active) throw new Error("Permission Lease was not created");

    const revoked = store.revokePermissionLease(active.id, "admin-test", "Operator revoked authority");
    expect(revoked).toMatchObject({ status: "REVOKED", revokeReason: "Operator revoked authority" });
    expect(() =>
      store.assertPermissionActionAllowed(aggregate.jobRun!.id, worker.workerId, "upload_artifact"),
    ).toThrow(/revoked/i);

    const secondWorker = pairAndHeartbeat(store, "Permission Violation Worker");
    const second = store.createWorkerSmokeTask(secondWorker.workerId);
    if (!second.jobRun) throw new Error("Second smoke Job was not created");
    store.claimAssignedJob(secondWorker.workerId, second.jobRun.id);
    const violated = store.recordPermissionViolation(
      second.jobRun.id,
      secondWorker.workerId,
      "read_credentials",
      "Credential access was blocked",
      "HOME",
    );

    expect(violated).toMatchObject({ status: "VIOLATED", revokeReason: "Credential access was blocked" });
    expect(store.verifyLedgerChain(second.jobRun.id).valid).toBe(true);
    expect(store.listEvidenceLedgerEntries(second.jobRun.id)).toEqual(expect.arrayContaining([expect.objectContaining({
      entryType: "PERMISSION_VIOLATION",
      sourceRecordType: "job_run_event",
    })]));
    expect(store.listEvidenceLedgerEntries(second.jobRun.id).at(-1)).toMatchObject({ entryType: "RECEIPT_CREATED" });
    expect(store.getJobReceiptByJobRun(second.jobRun.id)).toMatchObject({
      result: "PERMISSION_VIOLATION",
      receipt: {
        finalResult: "PERMISSION_VIOLATION",
        whatWasPermitted: { permissionViolations: ["Credential access was blocked"] },
      },
    });
    expect(store.getTaskAggregate(second.task.id).task.status).toBe("VERIFICATION_FAILED");
    expect(store.getJobReceiptByJobRun(second.jobRun.id)?.result).not.toBe("VERIFIED");
    expect(() =>
      store.assertPermissionActionAllowed(second.jobRun!.id, secondWorker.workerId, "upload_artifact"),
    ).toThrow(/violated/i);
  });
});

function permissionLease(): PermissionLeaseEnvelope {
  return {
    id: crypto.randomUUID(),
    version: 1,
    status: "ACTIVE",
    startsAt: "2026-08-26T12:00:00.000Z",
    expiresAt: "2026-08-26T12:01:00.000Z",
    scope: {
      allowedActions: ["upload_artifact", "report_progress"],
      deniedActions: ["git", "network", "read_credentials"],
      allowedPaths: ["$JOB_WORKSPACE"],
      allowedDomains: ["api.example.test"],
      maxArtifactBytes: 1024 * 1024,
      maxRuntimeSeconds: 60,
      maxApiBudget: 1,
      humanApprovalActions: [],
    },
  };
}

function createStore(): DemoStore {
  const store = new DemoStore(":memory:", { leaseDurationMs: 1_000, heartbeatTtlMs: 2_000 });
  stores.push(store);
  return store;
}

function pairAndHeartbeat(store: DemoStore, name: string): { workerId: string; token: string } {
  const worker = store.createWorker(demoIds.providerAlpha, name, "WINDOWS");
  const pairing = store.createPairingCode(worker.id, demoIds.providerAlpha);
  const paired = store.pairWorker(pairing.code);
  store.recordWorkerHeartbeat(worker.id, "ONLINE", capabilities(), [], new Date().toISOString());
  return { workerId: worker.id, token: paired.token };
}

function capabilities(): WorkerCapabilities {
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
  };
}
