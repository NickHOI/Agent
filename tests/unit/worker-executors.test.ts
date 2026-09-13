import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  PermissionGuard,
  WORKER_PROTOCOL_VERSION,
  type JobEnvelope,
} from "@donelayer/worker-protocol";
import {
  CODEX_OUTPUT_SCHEMA,
  CodexCliExecutor,
  buildCodexExecArgs,
  captureGitState,
  createCodexEnvironment,
} from "../../apps/worker/src/executors/codex.js";
import { DemoExecutor } from "../../apps/worker/src/executors/demo.js";
import { WorkerSmokeExecutor } from "../../apps/worker/src/executors/worker-smoke.js";
import { DisposableWorkspaceManager } from "../../apps/worker/src/workspace.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Worker executors", () => {
  it("creates a real hello.txt in an empty disposable smoke workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "donelayer-smoke-root-"));
    temporaryDirectories.push(workspaceRoot);
    const manager = new DisposableWorkspaceManager(workspaceRoot);
    const job = smokeJobEnvelope();
    const workdir = await manager.prepare(job);
    const events: string[] = [];

    expect(await readdir(workdir)).toEqual([]);
    const result = await new WorkerSmokeExecutor().execute({
      job,
      workdir,
      permissionGuard: boundPermissionGuard(job, workdir),
      signal: new AbortController().signal,
      emit: async (event) => {
        events.push(event.type);
      },
    });

    const artifact = result.artifacts[0];
    expect(artifact).toMatchObject({
      artifactType: "OTHER",
      fileName: "hello.txt",
      mimeType: "text/plain",
    });
    const persistedBytes = await readFile(path.join(workdir, "hello.txt"));
    expect(Buffer.from(artifact!.bytes)).toEqual(persistedBytes);
    const content = persistedBytes.toString("utf8");
    expect(content).toContain(`Job ID: ${job.jobRunId}`);
    expect(content).toContain(`Worker ID: ${job.workerId}`);
    expect(content).toMatch(/Started At: \d{4}-\d{2}-\d{2}T/);
    expect(content).toMatch(/Finished At: \d{4}-\d{2}-\d{2}T/);
    expect(content).toMatch(/Worker OS: \S+/);
    expect(events).toEqual(["EXECUTOR_STARTED", "FILE_CHANGED", "EXECUTOR_FINISHED"]);

    await manager.cleanup(workdir);
    await expect(stat(workdir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to write smoke evidence when the Permission Lease omits the action", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "donelayer-smoke-denied-root-"));
    temporaryDirectories.push(workspaceRoot);
    const manager = new DisposableWorkspaceManager(workspaceRoot);
    const base = smokeJobEnvelope();
    const job: JobEnvelope = {
      ...base,
      permissionLease: {
        ...base.permissionLease,
        scope: {
          ...base.permissionLease.scope,
          allowedActions: base.permissionLease.scope.allowedActions.filter(
            (action) => action !== "write_hello_txt",
          ),
        },
      },
    };
    const workdir = await manager.prepare(job);

    await expect(
      new WorkerSmokeExecutor().execute({
        job,
        workdir,
        permissionGuard: boundPermissionGuard(job, workdir),
        signal: new AbortController().signal,
        emit: async () => undefined,
      }),
    ).rejects.toThrow("Action write_hello_txt is not allowed");
    expect(await readdir(workdir)).toEqual([]);
  });

  it("runs the deterministic DemoExecutor and produces real artifact hashes inputs", async () => {
    const events: string[] = [];
    const executor = new DemoExecutor({ stepDelayMs: 0, sleep: async () => undefined });
    const job = jobEnvelope();
    const result = await executor.execute({
      job,
      workdir: process.cwd(),
      permissionGuard: boundPermissionGuard(job, process.cwd()),
      signal: new AbortController().signal,
      emit: async (event) => {
        events.push(event.type);
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.tests).toEqual({ total: 12, passed: 12, failed: 0, skipped: 0 });
    expect(result.gitDiff).toContain("diff --git");
    expect(result.artifacts.map((artifact) => artifact.fileName)).toEqual(
      expect.arrayContaining(["changes.patch", "test-results.json", "test.log", "build.log"]),
    );
    expect(events).toEqual([
      "EXECUTOR_STARTED",
      "LOG",
      "FILE_CHANGED",
      "TEST_RESULT",
      "BUILD_RESULT",
      "EXECUTOR_FINISHED",
    ]);
  });

  it("supports cancellation through AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));
    const executor = new DemoExecutor();
    const job = jobEnvelope();

    await expect(
      executor.execute({
        job,
        workdir: process.cwd(),
        permissionGuard: boundPermissionGuard(job, process.cwd()),
        signal: controller.signal,
        emit: async () => undefined,
      }),
    ).rejects.toThrow(/cancelled/);
  });

  it("technically enforces read-only and Pull Request permissions in DemoExecutor", async () => {
    const events: string[] = [];
    const base = jobEnvelope();
    const job: JobEnvelope = {
      ...base,
      permissions: { modifyCode: false, createPullRequest: false, humanApprovalRequired: true },
    };
    const executor = new DemoExecutor({ stepDelayMs: 0, sleep: async () => undefined });
    const result = await executor.execute({
      job,
      workdir: process.cwd(),
      permissionGuard: boundPermissionGuard(job, process.cwd()),
      signal: new AbortController().signal,
      emit: async (event) => {
        events.push(event.type);
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.gitDiff).toBe("");
    expect(result.changedFiles).toEqual([]);
    expect(result.pullRequestUrl).toBeUndefined();
    expect(events).not.toContain("FILE_CHANGED");
  });

  it("centralizes safe Codex CLI arguments and excludes secrets from its environment", () => {
    const args = buildCodexExecArgs({ workdir: "C:\\jobs\\one", schemaPath: "C:\\jobs\\schema.json" });
    expect(args).toContain("workspace-write");
    expect(args).toContain("sandbox_workspace_write.network_access=false");
    expect(args).toContain('approval_policy="never"');
    expect(args).toContain("--ignore-user-config");
    expect(args).not.toContain("--full-auto");
    expect(args).not.toContain("danger-full-access");
    expect(args.at(-1)).toBe("-");

    const environment = createCodexEnvironment({
      PATH: "/bin",
      HOME: "/home/provider",
      OPENAI_API_KEY: "must-not-leak",
      GITHUB_TOKEN: "must-not-leak",
    });
    expect(environment).toEqual({
      NODE_ENV: "production",
      PATH: "/bin",
      HOME: "/home/provider",
    });
  });

  it("uses SDK workspace-write, no-network options and validates structured output", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "donelayer-codex-test-"));
    temporaryDirectories.push(workdir);
    let threadOptions: Record<string, unknown> | undefined;
    let turnOptions: Record<string, unknown> | undefined;
    const final = {
      status: "succeeded",
      summary: "Fixed the scoped test failure.",
      commandIdsRun: ["NPM_TEST"],
      tests: { total: 2, passed: 2, failed: 0, skipped: 0 },
      buildSucceeded: true,
      pullRequestUrl: null,
      notes: [],
    };
    const sdk = {
      Codex: class {
        startThread(options: Record<string, unknown>) {
          threadOptions = options;
          return {
            async runStreamed(_prompt: string, optionsForTurn: Record<string, unknown>) {
              turnOptions = optionsForTurn;
              async function* events() {
                yield { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(final) } };
                yield { type: "turn.completed", usage: {} };
              }
              return { events: events() };
            },
          };
        }
      },
    };
    const executor = new CodexCliExecutor({ loadSdk: async () => sdk as never });
    const job: JobEnvelope = { ...jobEnvelope(), executor: { kind: "codex-cli" } };
    const result = await executor.execute({
      job,
      workdir,
      permissionGuard: boundPermissionGuard(job, workdir),
      signal: new AbortController().signal,
      emit: async () => undefined,
    });

    expect(result.status).toBe("succeeded");
    expect(result.commandsRun).toEqual([]);
    expect(result.tests).toBeUndefined();
    expect(result.buildSucceeded).toBeUndefined();
    expect(result.pullRequestUrl).toBeUndefined();
    expect(threadOptions).toMatchObject({
      workingDirectory: path.resolve(workdir),
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      approvalPolicy: "never",
      additionalDirectories: [],
      skipGitRepoCheck: false,
    });
    expect((turnOptions ?? {}).outputSchema).toEqual(CODEX_OUTPUT_SCHEMA);
  });

  it("captures committed, staged, and untracked Git changes", async () => {
    const workdir = await mkdtemp(path.join(tmpdir(), "donelayer-git-evidence-test-"));
    temporaryDirectories.push(workdir);
    const git = async (...args: string[]) => execFileAsync("git", args, { cwd: workdir });
    await git("init");
    await git("config", "user.name", "DoneLayer Test");
    await git("config", "user.email", "test@invalid.local");
    await writeFile(path.join(workdir, "committed.txt"), "before\n", "utf8");
    await git("add", "committed.txt");
    await git("commit", "-m", "initial");
    const before = await captureGitState(workdir);

    await writeFile(path.join(workdir, "committed.txt"), "after\n", "utf8");
    await git("add", "committed.txt");
    await git("commit", "-m", "committed change");
    await writeFile(path.join(workdir, "staged.txt"), "staged\n", "utf8");
    await git("add", "staged.txt");
    await writeFile(path.join(workdir, "untracked.txt"), "untracked\n", "utf8");

    const after = await captureGitState(workdir, before.sha);
    expect(after.sha).not.toBe(before.sha);
    expect(after.changedFiles).toEqual(
      expect.arrayContaining(["committed.txt", "staged.txt", "untracked.txt"]),
    );
    expect(after.diff).toContain("committed.txt");
    expect(after.diff).toContain("staged.txt");
    expect(after.diff).toContain("untracked.txt");
  });
});

function jobEnvelope(): JobEnvelope {
  const permissionStartsAt = new Date(Date.now() - 1_000).toISOString();
  const permissionExpiresAt = new Date(Date.now() + 60_000).toISOString();
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    taskId: randomUUID(),
    assignmentId: randomUUID(),
    providerAcceptedAt: "2026-07-31T11:59:00.000Z",
    jobRunId: randomUUID(),
    workerId: randomUUID(),
    leaseToken: "lease-token-that-is-at-least-thirty-two-characters",
    leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
    taskContract: { id: randomUUID(), version: 1, sha256: "a".repeat(64) },
    permissionLease: {
      id: randomUUID(),
      version: 1,
      status: "ACTIVE",
      startsAt: permissionStartsAt,
      expiresAt: permissionExpiresAt,
      scope: {
        allowedActions: [
          "create_job_workspace",
          "write_hello_txt",
          "calculate_sha256",
          "upload_artifact",
          "report_progress",
          "cleanup_workspace",
        ],
        deniedActions: [
          "git",
          "network",
          "arbitrary_shell",
          "production_deploy",
          "delete_outside_workspace",
          "read_home_directory",
          "read_other_jobs",
          "read_credentials",
        ],
        allowedPaths: ["$JOB_WORKSPACE"],
        allowedDomains: [],
        maxArtifactBytes: 5_000_000,
        maxRuntimeSeconds: 60,
        maxApiBudget: 0,
        humanApprovalActions: [],
      },
    },
    executor: { kind: "demo" },
    workflow: { id: "TEST_AND_FIX", version: 1, allowedCommandIds: ["NPM_TEST"] },
    task: {
      title: "Fix authentication tests",
      problemDescription: "The authentication tests fail because session expiry is inverted.",
      desiredOutcome: "All authentication tests pass.",
      scopeSummary: "Correct the session validation function.",
      acceptanceChecks: [],
    },
    repository: { mode: "demo", owner: "donelayer", name: "demo", targetBranch: "main" },
    permissions: { modifyCode: true, createPullRequest: false, humanApprovalRequired: true },
    limits: {
      timeoutMs: 60_000,
      maxLogBytes: 1_000_000,
      maxArtifactBytes: 5_000_000,
      maxArtifacts: 10,
      allowedMimeTypes: [
        "text/x-diff",
        "text/plain",
        "application/json",
      ],
      allowedNetworkDomains: [],
    },
  };
}

function smokeJobEnvelope(): JobEnvelope {
  return {
    ...jobEnvelope(),
    executor: { kind: "worker-smoke" },
    workflow: { id: "WORKER_SMOKE_V1", version: 1, allowedCommandIds: [] },
    repository: { mode: "none" },
    permissions: { modifyCode: false, createPullRequest: false, humanApprovalRequired: false },
    limits: {
      timeoutMs: 60_000,
      maxLogBytes: 1_000_000,
      maxArtifactBytes: 5_000_000,
      maxArtifacts: 1,
      allowedMimeTypes: ["text/plain"],
      allowedNetworkDomains: [],
    },
  };
}

function boundPermissionGuard(job: JobEnvelope, workdir: string): PermissionGuard {
  const guard = new PermissionGuard(job.permissionLease);
  guard.bindWorkspace(workdir);
  return guard;
}
