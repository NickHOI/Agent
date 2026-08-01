import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { authenticateWorkerRequest } from "@/server/worker-auth";

const commandSchema = z.object({
  commandId: z.enum(["NPM_INSTALL_CI", "NPM_TEST", "NPM_BUILD", "NPM_LINT", "PNPM_INSTALL_FROZEN", "PNPM_TEST", "PNPM_BUILD", "PNPM_LINT", "YARN_INSTALL_IMMUTABLE", "YARN_TEST", "YARN_BUILD", "YARN_LINT", "CARGO_TEST", "CARGO_BUILD", "PYTHON_PYTEST", "GO_TEST", "SWIFT_TEST", "XCODEBUILD_TEST"]),
  exitCode: z.number().int(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  stdout: z.string().max(1_000_000).optional(),
  stderr: z.string().max(1_000_000).optional()
});

const schema = z.object({
  protocolVersion: z.literal("1.0"),
  leaseToken: z.string().min(32),
  result: z.object({
    status: z.enum(["succeeded", "failed", "cancelled"]),
    summary: z.string().min(1).max(10_000),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    exitCode: z.number().int(),
    commitShaBefore: z.string().regex(/^[a-f0-9]{7,40}$/i).optional(),
    commitShaAfter: z.string().regex(/^[a-f0-9]{7,40}$/i).optional(),
    gitDiff: z.string().max(2_000_000),
    changedFiles: z.array(z.string().min(1).max(500)).max(1000),
    commandsRun: z.array(commandSchema).max(100),
    tests: z.object({ total: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }).optional(),
    buildSucceeded: z.boolean().optional(),
    pullRequestUrl: z.string().url().optional()
  }).strict(),
  artifacts: z.array(z.object({ artifactId: z.string().uuid(), artifactType: z.string(), fileName: z.string(), mimeType: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(100)
}).strict();

export async function POST(request: Request, context: { params: Promise<{ jobRunId: string }> }) {
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Structured job result is invalid." }, { status: 400 });
  const { jobRunId } = await context.params;
  try {
    const store = getDemoStore();
    const job = store.getJobRun(jobRunId);
    if (!job) throw new Error("Job run not found.");
    const aggregate = store.getTaskAggregate(job.taskId);
    const artifactIds = new Set(aggregate.evidence.filter((artifact) => artifact.workerId === worker.id && artifact.jobRunId === jobRunId).map((artifact) => artifact.id));
    if (parsed.data.artifacts.some((artifact) => !artifactIds.has(artifact.artifactId))) throw new Error("Submitted artifact does not belong to this Worker lease.");
    const result = parsed.data.result;
    const updated = store.submitWorkerJob(jobRunId, worker.id, parsed.data.leaseToken, {
      status: result.status,
      summary: result.summary,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      exitCode: result.exitCode,
      gitDiff: result.gitDiff,
      changedFiles: result.changedFiles,
      commandsRun: result.commandsRun.map((command) => ({
        commandId: command.commandId,
        exitCode: command.exitCode,
        ...(command.stdout === undefined ? {} : { stdout: command.stdout }),
        ...(command.stderr === undefined ? {} : { stderr: command.stderr })
      })),
      ...(result.commitShaBefore === undefined ? {} : { commitShaBefore: result.commitShaBefore }),
      ...(result.commitShaAfter === undefined ? {} : { commitShaAfter: result.commitShaAfter }),
      ...(result.tests === undefined ? {} : { tests: result.tests }),
      ...(result.buildSucceeded === undefined ? {} : { buildSucceeded: result.buildSucceeded }),
      ...(result.pullRequestUrl === undefined ? {} : { pullRequestUrl: result.pullRequestUrl })
    });
    return noStoreJson({ taskId: updated.task.id, status: updated.task.status });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Job submission failed." }, { status: 409 });
  }
}
