import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  WORKER_PROTOCOL_VERSION,
  sha256,
  type ExecutionResult,
  type JobEnvelope,
  type ProducedArtifact,
  type WorkerCapabilities,
} from "@donelayer/worker-protocol";
import type { WorkerApiClient } from "../../apps/worker/src/client.js";
import type { JobExecutor } from "../../apps/worker/src/executors/types.js";
import { WorkerRuntime } from "../../apps/worker/src/runtime.js";

describe("Worker runtime lease lifecycle", () => {
  it("keeps renewing the lease through evidence upload and submit", async () => {
    const workerId = randomUUID();
    const job = jobEnvelope(workerId);
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "donelayer-runtime-test-"));
    let renewals = 0;
    let submitted = false;
    let claimed = false;
    const fakeClient = {
      heartbeat: async () => undefined,
      claim: async () => {
        if (claimed) return null;
        claimed = true;
        return job;
      },
      renewLease: async () => {
        renewals += 1;
        return new Date(Date.now() + 45_000).toISOString();
      },
      getControl: async () => ({
        cancelRequested: false,
        leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
      }),
      sendEvent: async () => undefined,
      uploadArtifact: async (
        _jobRunId: string,
        _leaseToken: string,
        artifact: ProducedArtifact,
      ) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return {
          artifactId: randomUUID(),
          artifactType: artifact.artifactType,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.bytes.byteLength,
          sha256: sha256(artifact.bytes),
        };
      },
      submit: async () => {
        submitted = true;
      },
    } as unknown as WorkerApiClient;
    const executor: JobExecutor = {
      kind: "demo",
      execute: async (): Promise<ExecutionResult> => ({
        status: "succeeded",
        summary: "done",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        exitCode: 0,
        gitDiff: "diff --git a/a b/a",
        changedFiles: ["a"],
        commandsRun: [],
        artifacts: [
          {
            artifactType: "TEST_RESULT",
            fileName: "test-results.json",
            mimeType: "application/json",
            bytes: new TextEncoder().encode('{"passed":true}'),
          },
        ],
      }),
    };
    const runtime = new WorkerRuntime({
      client: fakeClient,
      config: {
        apiUrl: "http://localhost:3000",
        workerId,
        name: "Test Worker",
        pairedAt: new Date().toISOString(),
        pollIntervalMs: 1,
      },
      capabilities: capabilities(),
      workspaceRoot,
      executors: [executor],
      heartbeatIntervalMs: 60_000,
      leaseRenewIntervalMs: 2,
      controlPollIntervalMs: 2,
    });

    try {
      await runtime.start({ signal: new AbortController().signal, once: true });
      expect(submitted).toBe(true);
      expect(renewals).toBeGreaterThan(0);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("cancels one job fail-closed and continues polling for the next assignment", async () => {
    const workerId = randomUUID();
    const firstJob = jobEnvelope(workerId);
    const secondJob = jobEnvelope(workerId);
    const jobs = [firstJob, secondJob];
    const controller = new AbortController();
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "donelayer-runtime-cancel-test-"));
    let claims = 0;
    let submits = 0;
    let firstAborted = false;
    const fakeClient = {
      heartbeat: async () => undefined,
      claim: async () => jobs[claims++] ?? null,
      renewLease: async () => new Date(Date.now() + 45_000).toISOString(),
      getControl: async (jobRunId: string) => ({
        cancelRequested: jobRunId === firstJob.jobRunId,
        leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
      }),
      sendEvent: async () => undefined,
      uploadArtifact: async (
        _jobRunId: string,
        _leaseToken: string,
        artifact: ProducedArtifact,
      ) => ({
        artifactId: randomUUID(),
        artifactType: artifact.artifactType,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        size: artifact.bytes.byteLength,
        sha256: sha256(artifact.bytes),
      }),
      submit: async () => {
        submits += 1;
        controller.abort(new Error("test complete"));
      },
    } as unknown as WorkerApiClient;
    const executor: JobExecutor = {
      kind: "demo",
      execute: async (context): Promise<ExecutionResult> => {
        if (context.job.jobRunId === firstJob.jobRunId) {
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => {
                firstAborted = true;
                reject(context.signal.reason);
              },
              { once: true },
            );
          });
        }
        return successfulResult();
      },
    };
    const runtime = new WorkerRuntime({
      client: fakeClient,
      config: {
        apiUrl: "http://localhost:3000",
        workerId,
        name: "Test Worker",
        pairedAt: new Date().toISOString(),
        pollIntervalMs: 1,
      },
      capabilities: capabilities(),
      workspaceRoot,
      executors: [executor],
      heartbeatIntervalMs: 60_000,
      leaseRenewIntervalMs: 1_000,
      controlPollIntervalMs: 1,
    });

    try {
      await runtime.start({ signal: controller.signal });
      expect(firstAborted).toBe(true);
      expect(claims).toBe(2);
      expect(submits).toBe(1);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function successfulResult(): ExecutionResult {
  return {
    status: "succeeded",
    summary: "done",
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    exitCode: 0,
    gitDiff: "diff --git a/a b/a",
    changedFiles: ["a"],
    commandsRun: [],
    artifacts: [
      {
        artifactType: "TEST_RESULT",
        fileName: "test-results.json",
        mimeType: "application/json",
        bytes: new TextEncoder().encode('{"passed":true}'),
      },
    ],
  };
}

function capabilities(): WorkerCapabilities {
  return {
    os: "linux",
    architecture: "x64",
    cpuCount: 4,
    memoryBytes: 8_000_000_000,
    freeDiskBytes: 20_000_000_000,
    dockerAvailable: false,
    codexAvailable: false,
    gitAvailable: true,
    githubCliAvailable: false,
    supportedLanguages: ["JavaScript/TypeScript"],
    installedTools: ["git"],
    mcpServers: [],
    executors: ["demo"],
    maxConcurrentJobs: 1,
  };
}

function jobEnvelope(workerId: string): JobEnvelope {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    taskId: randomUUID(),
    assignmentId: randomUUID(),
    providerAcceptedAt: new Date(Date.now() - 1_000).toISOString(),
    jobRunId: randomUUID(),
    workerId,
    leaseToken: "lease-token-that-is-at-least-thirty-two-characters",
    leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
    executor: { kind: "demo" },
    workflow: { id: "TEST_AND_FIX", version: 1, allowedCommandIds: ["NPM_TEST"] },
    task: {
      title: "Fix tests",
      problemDescription: "The authentication test suite has a deterministic failure.",
      desiredOutcome: "All tests pass.",
      scopeSummary: "Fix the scoped failure.",
      acceptanceChecks: [],
    },
    repository: { mode: "demo", owner: "donelayer", name: "demo", targetBranch: "main" },
    permissions: { modifyCode: true, createPullRequest: false, humanApprovalRequired: true },
    limits: {
      timeoutMs: 60_000,
      maxLogBytes: 1_000_000,
      maxArtifactBytes: 1_000_000,
      maxArtifacts: 10,
      allowedMimeTypes: ["application/json"],
      allowedNetworkDomains: [],
    },
  };
}
