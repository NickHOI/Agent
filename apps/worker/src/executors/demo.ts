import {
  type CommandExecutionRecord,
  type ExecutionResult,
  type SafeCommandId,
} from "@donelayer/worker-protocol";

import type { ExecutionContext, JobExecutor } from "./types.js";

const encoder = new TextEncoder();

export class DemoExecutor implements JobExecutor {
  readonly kind = "demo" as const;

  constructor(
    private readonly options: {
      stepDelayMs?: number;
      now?: () => Date;
      sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    } = {},
  ) {}

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const now = this.options.now ?? (() => new Date());
    const sleep = this.options.sleep ?? abortableSleep;
    const delay = this.options.stepDelayMs ?? 180;
    const startedAt = now().toISOString();
    const commandId = chooseDemoCommand(context.job.workflow.allowedCommandIds);
    const canModify = context.job.permissions.modifyCode;
    const canCreatePullRequest = canModify && context.job.permissions.createPullRequest;
    const missingRequiredPermission = context.job.task.acceptanceChecks.some(
      (check) =>
        check.required &&
        ((check.type === "DIFF" && !canModify) ||
          (check.type === "PULL_REQUEST" && !canCreatePullRequest)),
    );

    await context.emit({ type: "EXECUTOR_STARTED", message: "Demo executor started", progress: 5 });
    await sleep(delay, context.signal);
    await context.emit({ type: "LOG", message: "Reproducing the failing authentication tests", progress: 20 });
    await sleep(delay, context.signal);
    if (canModify) {
      await context.emit({
        type: "FILE_CHANGED",
        message: "Updated session expiry handling in src/auth/session.ts",
        progress: 48,
        data: { path: "src/auth/session.ts" },
      });
    } else {
      await context.emit({
        type: "LOG",
        message: "Task is read-only; DemoExecutor did not modify repository files",
        progress: 48,
      });
    }
    await sleep(delay, context.signal);
    await context.emit({
      type: "TEST_RESULT",
      message: "Authentication test suite passed: 12 passed, 0 failed",
      progress: 78,
      data: { total: 12, passed: 12, failed: 0, skipped: 0, commandId },
    });
    await sleep(delay, context.signal);
    await context.emit({ type: "BUILD_RESULT", message: "Demo build completed successfully", progress: 92 });

    const endedAt = now().toISOString();
    const diff = canModify ? demoDiff() : "";
    const commandsRun: CommandExecutionRecord[] = commandId
      ? [{ commandId, exitCode: 0, startedAt, endedAt, stdout: "12 tests passed", stderr: "" }]
      : [];
    const resultDocument = JSON.stringify(
      { demo: true, exitCode: 0, tests: { total: 12, passed: 12, failed: 0, skipped: 0 } },
      null,
      2,
    );

    await context.emit({
      type: missingRequiredPermission ? "EXECUTOR_FAILED" : "EXECUTOR_FINISHED",
      message: missingRequiredPermission
        ? "Demo execution could not satisfy checks that require ungranted permissions"
        : "Demo execution completed",
      progress: 100,
    });
    return {
      status: missingRequiredPermission ? "failed" : "succeeded",
      summary: missingRequiredPermission
        ? "Verification requirements need repository or Pull Request permissions that were not granted."
        : canModify
          ? "Fixed authentication session expiry handling and verified all authentication tests."
          : "Verified the authentication tests without modifying repository files.",
      startedAt,
      endedAt,
      exitCode: missingRequiredPermission ? 1 : 0,
      commitShaBefore: "1111111111111111111111111111111111111111",
      commitShaAfter: canModify
        ? "2222222222222222222222222222222222222222"
        : "1111111111111111111111111111111111111111",
      gitDiff: diff,
      changedFiles: canModify ? ["src/auth/session.ts", "tests/auth/session.test.ts"] : [],
      commandsRun,
      tests: { total: 12, passed: 12, failed: 0, skipped: 0 },
      buildSucceeded: true,
      ...(canCreatePullRequest
        ? { pullRequestUrl: "https://github.com/donelayer/demo-repository/pull/42" }
        : {}),
      artifacts: [
        { artifactType: "GIT_DIFF", fileName: "changes.patch", mimeType: "text/x-diff", bytes: encoder.encode(diff) },
        { artifactType: "TEST_RESULT", fileName: "test-results.json", mimeType: "application/json", bytes: encoder.encode(resultDocument) },
        { artifactType: "TEST_LOG", fileName: "test.log", mimeType: "text/plain", bytes: encoder.encode("PASS auth/session.test.ts\nTests: 12 passed, 12 total\n") },
        { artifactType: "BUILD_LOG", fileName: "build.log", mimeType: "text/plain", bytes: encoder.encode("Build completed successfully\n") },
      ],
    };
  }
}

function chooseDemoCommand(allowed: SafeCommandId[]): SafeCommandId | undefined {
  return allowed.find((command) => /(?:TEST|PYTEST)/.test(command)) ?? allowed[0];
}

async function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new Error("Demo execution cancelled");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Demo execution cancelled"));
      },
      { once: true },
    );
  });
}

function demoDiff(): string {
  return [
    "diff --git a/src/auth/session.ts b/src/auth/session.ts",
    "index 7b801a1..3bf0410 100644",
    "--- a/src/auth/session.ts",
    "+++ b/src/auth/session.ts",
    "@@ -18,7 +18,7 @@ export function isSessionValid(session: Session, now: number) {",
    "-  return session.expiresAt < now;",
    "+  return session.expiresAt > now;",
    " }",
    "",
  ].join("\n");
}
