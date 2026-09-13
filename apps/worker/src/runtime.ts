import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  PermissionGuard,
  PermissionViolationError,
  WORKER_PROTOCOL_VERSION,
  redactSecrets,
  redactStructuredValue,
  sha256,
  truncateUtf8,
  type ExecutionResult,
  type JobEnvelope,
  type JobRunEvent,
  type ProducedArtifact,
  type UploadedArtifact,
  type WorkerCapabilities,
  type WorkerHeartbeat,
} from "@donelayer/worker-protocol";

import { WorkerApiClient } from "./client.js";
import type { WorkerConfig } from "./config.js";
import type { ExecutorProgressSink, JobExecutor } from "./executors/types.js";
import { DisposableWorkspaceManager } from "./workspace.js";

export class WorkerRuntime {
  private readonly activeJobRunIds = new Set<string>();
  private readonly executors = new Map<string, JobExecutor>();

  constructor(
    private readonly options: {
      client: WorkerApiClient;
      config: WorkerConfig;
      capabilities: WorkerCapabilities;
      workspaceRoot: string;
      executors: JobExecutor[];
      heartbeatIntervalMs?: number;
      leaseRenewIntervalMs?: number;
      controlPollIntervalMs?: number;
      onMessage?: (message: string) => void;
    },
  ) {
    for (const executor of options.executors) this.executors.set(executor.kind, executor);
  }

  async start(options: { signal: AbortSignal; once?: boolean }): Promise<void> {
    await this.sendHeartbeat(options.signal);
    const heartbeatController = new AbortController();
    const heartbeatSignal = AbortSignal.any([options.signal, heartbeatController.signal]);
    const heartbeatLoop = this.heartbeatLoop(heartbeatSignal);
    try {
      do {
        let job: JobEnvelope | null;
        try {
          job = await this.options.client.claim(options.signal);
        } catch (error) {
          if (options.signal.aborted || options.once) throw error;
          this.options.onMessage?.(
            `Job polling failed: ${redactSecrets(error instanceof Error ? error.message : "unknown error")}`,
          );
          await sleep(this.options.config.pollIntervalMs, options.signal);
          continue;
        }
        if (!job) {
          if (options.once) return;
          await sleep(this.options.config.pollIntervalMs, options.signal);
          continue;
        }
        try {
          await this.executeJob(job, options.signal);
        } catch (error) {
          if (options.signal.aborted || options.once) throw error;
          this.options.onMessage?.(
            `Job ${job.jobRunId} ended with an error: ${redactSecrets(error instanceof Error ? error.message : "unknown error")}`,
          );
        }
        if (options.once) return;
      } while (!options.signal.aborted);
    } finally {
      heartbeatController.abort();
      await heartbeatLoop.catch(() => undefined);
      if (!options.signal.aborted) await this.sendHeartbeat(undefined).catch(() => undefined);
    }
  }

  private async executeJob(job: JobEnvelope, parentSignal: AbortSignal): Promise<void> {
    if (job.workerId !== this.options.config.workerId) {
      throw new Error("Server assigned a job to a different Worker");
    }
    if (job.executor.kind === "codex-cli" && !this.options.capabilities.dockerAvailable) {
      throw new Error("Codex execution is disabled because Docker is unavailable");
    }
    if (!this.options.capabilities.executors.includes(job.executor.kind)) {
      throw new Error(`Worker did not declare the ${job.executor.kind} executor`);
    }
    const executor = this.executors.get(job.executor.kind);
    if (!executor) throw new Error(`Executor ${job.executor.kind} is not installed`);

    const permissionGuard = new PermissionGuard(job.permissionLease);
    const workspaceManager = new DisposableWorkspaceManager(this.options.workspaceRoot);
    const jobController = new AbortController();
    const executionSignal = AbortSignal.any([parentSignal, jobController.signal]);
    let workdir: string | null = null;
    let sequence = 0;
    let emittedBytes = 0;
    let logLimitReported = false;
    let leaseLoop: Promise<void> | null = null;
    let controlLoop: Promise<void> | null = null;
    this.activeJobRunIds.add(job.jobRunId);

    const emit: ExecutorProgressSink = async (event) => {
      permissionGuard.assertActionAllowed("report_progress");
      let message = redactSecrets(event.message);
      const messageBytes = Buffer.byteLength(message, "utf8");
      if (emittedBytes + messageBytes > job.limits.maxLogBytes) {
        if (logLimitReported) return;
        message = "Worker log limit reached; further log messages were suppressed";
        logLimitReported = true;
      }
      emittedBytes += Buffer.byteLength(message, "utf8");
      const wireEvent: JobRunEvent = {
        protocolVersion: WORKER_PROTOCOL_VERSION,
        eventId: randomUUID(),
        jobRunId: job.jobRunId,
        sequence: sequence++,
        type: event.type,
        message: truncateUtf8(message, 16_384),
        createdAt: new Date().toISOString(),
        ...(event.progress === undefined ? {} : { progress: event.progress }),
        ...(event.data === undefined ? {} : { data: redactEventData(event.data) }),
      };
      await this.options.client.sendEvent(wireEvent, job.leaseToken, parentSignal);
      this.options.onMessage?.(`[${wireEvent.type}] ${wireEvent.message}`);
    };

    try {
      permissionGuard.assertLeaseActive();
      permissionGuard.assertBudgetAvailable(0);
      permissionGuard.assertActionAllowed("create_job_workspace");
      await this.sendHeartbeat(parentSignal);
      leaseLoop = this.maintainLease(job, permissionGuard, jobController, executionSignal);
      workdir = await workspaceManager.prepare(job);
      permissionGuard.bindWorkspace(workdir);
      await emit({ type: "WORKSPACE_PREPARED", message: "Disposable workspace prepared", progress: 2, data: { workdir } });
      controlLoop = this.watchControl(job, jobController, executionSignal);
      const result: ExecutionResult = await executor.execute({
        job,
        workdir,
        permissionGuard,
        signal: executionSignal,
        emit,
      });
      validateArtifacts(result.artifacts, job, permissionGuard);
      const uploaded: UploadedArtifact[] = [];
      for (const artifact of result.artifacts) {
        permissionGuard.assertActionAllowed(
          job.workflow.id === "REPOSITORY_MATERIALIZE_V1"
            ? "calculate_file_sha256"
            : "calculate_sha256",
        );
        const localSha256 = sha256(artifact.bytes);
        await emit({
          type: "ARTIFACT_CREATED",
          message: `Created evidence artifact ${artifact.fileName}`,
          data: {
            fileName: artifact.fileName,
            size: artifact.bytes.byteLength,
            sha256: localSha256,
          },
        });
        permissionGuard.assertActionAllowed("upload_artifact");
        permissionGuard.assertBudgetAvailable(0);
        const record = await this.options.client.uploadArtifact(
          job.jobRunId,
          job.leaseToken,
          artifact,
          executionSignal,
        );
        uploaded.push(record);
      }
      if (workdir) {
        const cleanedWorkdir = workdir;
        permissionGuard.assertActionAllowed("cleanup_workspace");
        await workspaceManager.cleanup(cleanedWorkdir);
        workdir = null;
        await emit({
          type: "CLEANUP_FINISHED",
          message: "Disposable workspace removed",
          progress: 100,
          data: { workdir: cleanedWorkdir },
        });
      }
      const { artifacts: _artifacts, ...wireResult } = result;
      void _artifacts;
      await this.options.client.submit(
        job.jobRunId,
        job.leaseToken,
        wireResult,
        uploaded,
        executionSignal,
      );
    } catch (error) {
      if (error instanceof PermissionViolationError) {
        await this.reportPermissionViolation(job, error, sequence++, parentSignal).catch(() => undefined);
      }
      const message = redactSecrets(error instanceof Error ? error.message : "Worker execution failed");
      await emit({
        type: parentSignal.aborted || executionSignal.aborted ? "CANCELLED" : "EXECUTOR_FAILED",
        message,
        progress: 100,
      }).catch(() => undefined);
      if (!parentSignal.aborted) throw error;
    } finally {
      jobController.abort();
      await Promise.allSettled([leaseLoop, controlLoop].filter((loop): loop is Promise<void> => Boolean(loop)));
      try {
        if (workdir) {
          const cleanedWorkdir = workdir;
          // Revocation cleanup is Worker-owned containment and must not leave a stale workspace behind.
          await workspaceManager.cleanup(cleanedWorkdir);
          await emit({ type: "CLEANUP_FINISHED", message: "Disposable workspace removed", data: { workdir: cleanedWorkdir } }).catch(() => undefined);
        }
      } finally {
        this.activeJobRunIds.delete(job.jobRunId);
        await this.sendHeartbeat(parentSignal.aborted ? undefined : parentSignal).catch(() => undefined);
      }
    }
  }

  private async heartbeatLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await sleep(this.options.heartbeatIntervalMs ?? 15_000, signal).catch(() => undefined);
      if (signal.aborted) return;
      await this.sendHeartbeat(signal).catch((error) => {
        this.options.onMessage?.(
          `Heartbeat failed: ${redactSecrets(error instanceof Error ? error.message : "unknown error")}`,
        );
      });
    }
  }

  private async sendHeartbeat(signal?: AbortSignal): Promise<void> {
    const heartbeat: WorkerHeartbeat = {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      status: this.activeJobRunIds.size > 0 ? "BUSY" : "ONLINE",
      capabilities: this.options.capabilities,
      activeJobRunIds: [...this.activeJobRunIds],
      sentAt: new Date().toISOString(),
    };
    await this.options.client.heartbeat(heartbeat, signal);
  }

  private async maintainLease(
    job: JobEnvelope,
    permissionGuard: PermissionGuard,
    controller: AbortController,
    signal: AbortSignal,
  ): Promise<void> {
    let leaseExpiresAt = new Date(job.leaseExpiresAt).getTime();
    const permissionExpiresAt = new Date(job.permissionLease.expiresAt).getTime();
    const permissionRuntimeEndsAt =
      new Date(job.permissionLease.startsAt).getTime() +
      job.permissionLease.scope.maxRuntimeSeconds * 1_000;
    while (!signal.aborted) {
      try {
        permissionGuard.assertLeaseActive();
      } catch (error) {
        controller.abort(error);
        return;
      }
      const now = Date.now();
      const remainingMs = Math.min(leaseExpiresAt, permissionExpiresAt, permissionRuntimeEndsAt) - now;
      if (remainingMs <= 0) {
        controller.abort(
          permissionGuard.recordViolation(
            "runtime",
            "Permission Lease runtime or expiry boundary was reached",
          ),
        );
        return;
      }
      const renewalDelay = Math.min(
        this.options.leaseRenewIntervalMs ?? 15_000,
        Math.max(1, Math.floor(remainingMs / 3)),
      );
      await sleep(renewalDelay, signal);
      if (signal.aborted) return;
      try {
        const renewedExpiry = new Date(
          await this.options.client.renewLease(job.jobRunId, job.leaseToken, signal),
        ).getTime();
        if (!Number.isFinite(renewedExpiry) || renewedExpiry <= Date.now()) {
          throw new Error("Platform returned an invalid lease expiry");
        }
        if (renewedExpiry > permissionExpiresAt || renewedExpiry > permissionRuntimeEndsAt) {
          throw permissionGuard.recordViolation(
            "execution_lease_renewal",
            "Platform renewed the execution lease beyond its Permission Lease",
          );
        }
        leaseExpiresAt = renewedExpiry;
      } catch (error) {
        controller.abort(
          error instanceof PermissionViolationError
            ? error
            : new Error("Job lease could not be renewed", { cause: error }),
        );
        return;
      }
    }
  }

  private async reportPermissionViolation(
    job: JobEnvelope,
    error: PermissionViolationError,
    sequence: number,
    signal: AbortSignal,
  ): Promise<void> {
    const { violation } = error;
    const event: JobRunEvent = {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      eventId: randomUUID(),
      jobRunId: job.jobRunId,
      sequence,
      type: "PERMISSION_VIOLATION",
      message: truncateUtf8(redactSecrets(violation.reason), 16_384),
      createdAt: violation.recordedAt,
      data: {
        action: truncateUtf8(redactSecrets(violation.action), 256),
        permissionLeaseId: job.permissionLease.id,
        ...(violation.resource === undefined
          ? {}
          : { resource: truncateUtf8(redactSecrets(violation.resource), 2_048) }),
      },
    };
    await this.options.client.sendEvent(event, job.leaseToken, signal);
    this.options.onMessage?.(`[${event.type}] ${event.message}`);
  }

  private async watchControl(
    job: JobEnvelope,
    controller: AbortController,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      await sleep(this.options.controlPollIntervalMs ?? 2_000, signal);
      if (signal.aborted) return;
      let control;
      try {
        control = await this.options.client.getControl(job.jobRunId, job.leaseToken, signal);
      } catch (error) {
        controller.abort(new Error("Job control channel failed", { cause: error }));
        return;
      }
      if (control.cancelRequested) {
        controller.abort(new Error("Job cancellation requested by platform"));
        return;
      }
      if (new Date(control.leaseExpiresAt).getTime() <= Date.now()) {
        controller.abort(new Error("Job lease expired"));
        return;
      }
    }
  }
}

export function defaultWorkspaceRoot(configDirectory: string): string {
  return path.join(configDirectory, "jobs");
}

function validateArtifacts(
  artifacts: ProducedArtifact[],
  job: JobEnvelope,
  permissionGuard: PermissionGuard,
): void {
  if (artifacts.length > job.limits.maxArtifacts) {
    throw new Error("Executor produced too many artifacts");
  }
  for (const artifact of artifacts) {
    if (!job.limits.allowedMimeTypes.includes(artifact.mimeType)) {
      throw new Error(`Artifact MIME type ${artifact.mimeType} is not allowed`);
    }
    if (artifact.bytes.byteLength > job.permissionLease.scope.maxArtifactBytes) {
      throw permissionGuard.recordViolation(
        "upload_artifact",
        `Artifact ${artifact.fileName} exceeds the Permission Lease size limit`,
        artifact.fileName,
      );
    }
    if (artifact.bytes.byteLength > job.limits.maxArtifactBytes) {
      throw new Error(`Artifact ${artifact.fileName} exceeds the size limit`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(artifact.fileName)) {
      throw new Error("Artifact file name is invalid");
    }
  }
}

function redactEventData(data: Record<string, unknown>): Record<string, unknown> {
  try {
    const redacted = redactStructuredValue(data) as Record<string, unknown>;
    const serialized = JSON.stringify(redacted);
    if (Buffer.byteLength(serialized, "utf8") > 16_384) return { truncated: true };
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return { redacted: true };
  }
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new Error("Operation cancelled");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Operation cancelled"));
      },
      { once: true },
    );
  });
}
