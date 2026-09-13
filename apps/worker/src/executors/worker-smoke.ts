import { readFile, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import path from "node:path";

import type { ExecutionResult } from "@donelayer/worker-protocol";

import type { ExecutionContext, JobExecutor } from "./types.js";

export class WorkerSmokeExecutor implements JobExecutor {
  readonly kind = "worker-smoke" as const;

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    assertNotAborted(context.signal);
    if (context.job.workflow.id !== "WORKER_SMOKE_V1" || context.job.repository.mode !== "none") {
      throw new Error("WorkerSmokeExecutor only accepts repository-free WORKER_SMOKE_V1 jobs");
    }

    const startedAt = new Date().toISOString();
    await context.emit({
      type: "EXECUTOR_STARTED",
      message: "WORKER_SMOKE_V1 started",
      progress: 10,
    });

    assertNotAborted(context.signal);
    context.permissionGuard.assertBudgetAvailable(0);
    context.permissionGuard.assertActionAllowed("write_hello_txt");
    const finishedAt = new Date().toISOString();
    const content = [
      `Job ID: ${context.job.jobRunId}`,
      `Worker ID: ${context.job.workerId}`,
      `Started At: ${startedAt}`,
      `Finished At: ${finishedAt}`,
      `Worker OS: ${platform()}`,
      "",
    ].join("\n");
    const artifactPath = path.join(context.workdir, "hello.txt");
    context.permissionGuard.assertPathAllowed(artifactPath);
    await writeFile(artifactPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const bytes = await readFile(artifactPath);
    assertNotAborted(context.signal);

    await context.emit({
      type: "FILE_CHANGED",
      message: "Created hello.txt with Worker execution evidence",
      progress: 80,
      data: { path: "hello.txt", size: bytes.byteLength },
    });
    await context.emit({
      type: "EXECUTOR_FINISHED",
      message: "WORKER_SMOKE_V1 completed",
      progress: 100,
    });

    return {
      status: "succeeded",
      summary: "Created hello.txt using the independent Worker process.",
      startedAt,
      endedAt: finishedAt,
      exitCode: 0,
      gitDiff: "",
      changedFiles: ["hello.txt"],
      commandsRun: [],
      artifacts: [
        {
          artifactType: "OTHER",
          fileName: "hello.txt",
          mimeType: "text/plain",
          bytes,
        },
      ],
    };
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("Worker smoke execution cancelled");
}
