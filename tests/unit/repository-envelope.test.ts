import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  WORKER_PROTOCOL_VERSION,
  jobEnvelopeSchema,
  type JobEnvelope,
  type WorkerCapabilities,
} from "@donelayer/worker-protocol";
import { DemoStore, demoIds } from "@donelayer/database";
import { POST as claimJob } from "../../apps/web/src/app/api/worker/jobs/claim/route.js";
import {
  resolveRepositoryEnvelope,
  type RepositoryGrant,
} from "../../apps/web/src/server/repository-envelope.js";

describe("Repository envelope validation", () => {
  it("strictly validates repository-free, demo, and GitHub App descriptors", () => {
    const base = validJobEnvelope();

    expect(jobEnvelopeSchema.safeParse(base).success).toBe(true);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: { mode: "demo", owner: "acme", name: "..", targetBranch: "main" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: { mode: "demo", owner: "acme", name: "project", targetBranch: "../../main" },
    }).success).toBe(false);

    const githubApp = {
      mode: "github-app" as const,
      repositoryId: randomUUID(),
      owner: "acme",
      name: "project",
      targetBranch: "main",
      commitSha: "a".repeat(40),
      archiveUrl: "https://artifacts.example.test/repository.tar.gz",
    };
    expect(jobEnvelopeSchema.safeParse({ ...base, repository: githubApp }).success).toBe(true);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: { ...githubApp, archiveUrl: "http://artifacts.example.test/repository.tar.gz" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: { ...githubApp, commitSha: "not-a-commit" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: { ...githubApp, repositoryId: "not-a-uuid" },
    }).success).toBe(false);

    const smoke = {
      ...base,
      executor: { kind: "worker-smoke" as const },
      workflow: { id: "WORKER_SMOKE_V1" as const, version: 1 as const, allowedCommandIds: [] },
      repository: { mode: "none" as const },
    };
    expect(jobEnvelopeSchema.safeParse(smoke).success).toBe(true);
    expect(jobEnvelopeSchema.safeParse({
      ...smoke,
      repository: { mode: "none", owner: "acme" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({ ...smoke, repository: githubApp }).success).toBe(false);
  });

  it("resolves only the server-owned repository-free smoke descriptor", () => {
    expect(resolveRepositoryEnvelope({
      repository: "worker-smoke://none",
      targetBranch: "none",
      customerId: "customer-1",
      workflowId: "WORKER_SMOKE_V1",
    })).toEqual({ mode: "none" });

    expect(() => resolveRepositoryEnvelope({
      repository: "demo://acme/project",
      targetBranch: "main",
      customerId: "customer-1",
      workflowId: "WORKER_SMOKE_V1",
    })).toThrow(/server-owned repository-free descriptor/i);
  });

  it("validates demo descriptors before constructing an envelope", () => {
    expect(resolveRepositoryEnvelope({
      repository: "demo://acme/project",
      targetBranch: "main",
      customerId: "customer-1",
      workflowId: "TEST_AND_FIX",
    })).toEqual({ mode: "demo", owner: "acme", name: "project", targetBranch: "main" });

    for (const repository of [
      "demo://acme/../project",
      "demo://acme/project/extra",
      "demo://-acme/project",
      "demo://acme/..",
    ]) {
      expect(() => resolveRepositoryEnvelope({
        repository,
        targetBranch: "main",
        customerId: "customer-1",
        workflowId: "TEST_AND_FIX",
      })).toThrow(/descriptor is invalid/i);
    }
  });

  it("binds a GitHub App grant to the Task customer, repository, and branch", () => {
    const grant = repositoryGrant();
    const input = {
      repository: "https://github.com/acme/project.git",
      targetBranch: "main",
      customerId: "customer-1",
      workflowId: "TEST_AND_FIX",
    };

    expect(resolveRepositoryEnvelope({ ...input, grant })).toEqual({
      mode: "github-app",
      repositoryId: grant.repositoryId,
      owner: grant.owner,
      name: grant.name,
      targetBranch: grant.targetBranch,
      commitSha: grant.commitSha,
      archiveUrl: grant.archiveUrl,
    });
    expect(jobEnvelopeSchema.safeParse({
      ...validJobEnvelope(),
      repository: resolveRepositoryEnvelope({ ...input, grant }),
    }).success).toBe(true);

    for (const unownedGrant of [
      { ...grant, customerId: "customer-2" },
      { ...grant, owner: "another-owner" },
      { ...grant, name: "another-repository" },
      { ...grant, targetBranch: "release" },
    ]) {
      expect(() => resolveRepositoryEnvelope({ ...input, grant: unownedGrant })).toThrow(
        /does not belong to this Task/i,
      );
    }
  });

  it("rejects incomplete ownership grants and ungranted repository URLs", () => {
    const input = {
      repository: "https://github.com/acme/project",
      targetBranch: "main",
      customerId: "customer-1",
      workflowId: "TEST_AND_FIX",
    };
    const grant = repositoryGrant();

    expect(() => resolveRepositoryEnvelope(input)).toThrow(/paused.*verified ownership grant/i);
    expect(() => resolveRepositoryEnvelope({
      ...input,
      repository: "https://example.com/acme/project",
      grant,
    })).toThrow(/paused.*verified ownership grant/i);
    expect(() => resolveRepositoryEnvelope({
      ...input,
      grant: { ...grant, commitSha: "not-a-commit" },
    })).toThrow(/grant is incomplete/i);
    expect(() => resolveRepositoryEnvelope({
      ...input,
      grant: { ...grant, archiveUrl: "http://artifacts.example.test/repository.tar.gz" },
    })).toThrow(/grant is incomplete/i);
    expect(() => resolveRepositoryEnvelope({
      ...input,
      grant: { ...grant, installationId: " " },
    })).toThrow(/no installation identity/i);
  });

  it("rejects an ungranted repository before creating a Lease or changing Task state", async () => {
    const store = new DemoStore(":memory:");
    (globalThis as typeof globalThis & { __doneLayerDemoStore?: DemoStore }).__doneLayerDemoStore = store;
    try {
      const task = store.createTask({
        title: "Repository envelope regression",
        problemDescription: "Prove an unverified GitHub URL cannot strand a Task after Worker claim.",
        desiredOutcome: "The Server rejects the envelope before creating a Lease.",
        repository: "https://github.com/acme/project",
        targetBranch: "main",
        taskType: "TEST_AND_FIX",
        requiredSkills: ["React", "TypeScript"],
        requiredOperatingSystem: "WINDOWS",
        requiredTools: [],
        requiredMcpTools: [],
        budgetCents: 24_000,
        deadline: new Date(Date.now() + 60_000).toISOString(),
        acceptanceChecks: [{
          id: "file",
          type: "FILE_EXISTS",
          title: "A file exists",
          required: true,
          path: "hello.txt",
        }],
        securitySensitivity: "LOW",
        allowCodeChanges: false,
        allowPullRequest: false,
        requiresHumanApproval: false,
        preferredAgentId: null,
      }, demoIds.customer);
      for (let step = 0; step < 5; step += 1) store.advanceDemo(task.id);
      const offered = store.getTaskAggregate(task.id);
      if (!offered.agent) throw new Error("Test task was not matched");
      store.acceptTaskAsProvider(task.id, offered.agent.providerId);
      const assigned = store.getTaskAggregate(task.id);
      if (!assigned.worker) throw new Error("Test task was not assigned");
      const pairing = store.createPairingCode(assigned.worker.id, assigned.worker.providerId);
      const paired = store.pairWorker(pairing.code);
      store.recordWorkerHeartbeat(
        assigned.worker.id,
        "ONLINE",
        demoCapabilities(),
        [],
        new Date().toISOString(),
      );

      const response = await claimJob(new Request("http://localhost/api/worker/jobs/claim", {
        method: "POST",
        headers: {
          authorization: `Bearer ${paired.token}`,
          "content-type": "application/json",
          "x-donelayer-worker-id": assigned.worker.id,
        },
        body: JSON.stringify({ protocolVersion: WORKER_PROTOCOL_VERSION, availableSlots: 1 }),
      }));

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/paused.*ownership grant/i) });
      expect(store.getTaskAggregate(task.id)).toMatchObject({
        task: { status: "ASSIGNED" },
        jobRun: { status: "QUEUED", leaseId: null, leaseExpiresAt: null },
      });
    } finally {
      store.close();
      delete (globalThis as typeof globalThis & { __doneLayerDemoStore?: DemoStore }).__doneLayerDemoStore;
    }
  });
});

function repositoryGrant(): RepositoryGrant {
  return {
    customerId: "customer-1",
    repositoryId: randomUUID(),
    installationId: "installation-1",
    owner: "acme",
    name: "project",
    targetBranch: "main",
    commitSha: "a".repeat(40),
    archiveUrl: "https://artifacts.example.test/repository.tar.gz",
  };
}

function validJobEnvelope(): JobEnvelope {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    taskId: randomUUID(),
    assignmentId: randomUUID(),
    providerAcceptedAt: "2026-08-03T00:00:00.000Z",
    jobRunId: randomUUID(),
    workerId: randomUUID(),
    leaseToken: `dls_0000000000000000.${"x".repeat(43)}`,
    leaseExpiresAt: "2026-08-03T00:01:00.000Z",
    taskContract: {
      id: randomUUID(),
      version: 1,
      sha256: "a".repeat(64),
    },
    permissionLease: {
      id: randomUUID(),
      version: 1,
      status: "ACTIVE",
      startsAt: "2026-08-02T23:59:00.000Z",
      expiresAt: "2026-08-03T00:01:00.000Z",
      scope: {
        allowedActions: ["execute_workflow"],
        deniedActions: ["network", "arbitrary_shell"],
        allowedPaths: ["$JOB_WORKSPACE"],
        allowedDomains: [],
        maxArtifactBytes: 1024 * 1024,
        maxRuntimeSeconds: 60,
        maxApiBudget: 0,
        humanApprovalActions: [],
      },
    },
    executor: { kind: "demo" },
    workflow: { id: "TEST_AND_FIX", version: 1, allowedCommandIds: ["NPM_TEST"] },
    task: {
      title: "Repository validation",
      problemDescription: "Validate the repository descriptor before the Worker receives it.",
      desiredOutcome: "Only a server-owned repository envelope reaches the Worker.",
      scopeSummary: "Validate repository identity and ownership.",
      acceptanceChecks: [],
    },
    repository: { mode: "demo", owner: "acme", name: "project", targetBranch: "main" },
    permissions: {
      modifyCode: true,
      createPullRequest: false,
      humanApprovalRequired: true,
    },
    limits: {
      timeoutMs: 60_000,
      maxLogBytes: 128 * 1024,
      maxArtifactBytes: 1024 * 1024,
      maxArtifacts: 1,
      allowedMimeTypes: ["text/plain"],
      allowedNetworkDomains: [],
    },
  };
}

function demoCapabilities(): WorkerCapabilities {
  return {
    os: "windows",
    architecture: process.arch,
    cpuCount: 1,
    nodeVersion: process.version,
    npmVersion: null,
    workerVersion: "0.1.0",
    processId: process.pid,
    memoryBytes: 1024,
    availableMemoryBytes: 512,
    freeDiskBytes: 1024,
    dockerAvailable: false,
    codexAvailable: false,
    gitAvailable: false,
    githubCliAvailable: false,
    supportedLanguages: ["JavaScript/TypeScript"],
    installedTools: ["node"],
    mcpServers: [],
    executors: ["demo"],
    maxConcurrentJobs: 1,
  };
}
