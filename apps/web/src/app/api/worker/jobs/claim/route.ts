import { claimJobRequestSchema, type AcceptanceCheck as WireCheck, type SafeCommandId } from "@donelayer/worker-protocol";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { authenticateWorkerRequest } from "@/server/worker-auth";

function allowedCommands(taskType: string): SafeCommandId[] {
  if (taskType === "BUILD_RESCUE") return ["NPM_BUILD"];
  if (taskType === "TEST_AND_FIX") return ["NPM_TEST"];
  if (taskType === "LAUNCH_READINESS" || taskType === "PULL_REQUEST_VERIFICATION") return ["NPM_TEST", "NPM_BUILD", "NPM_LINT"];
  return ["NPM_TEST", "NPM_BUILD"];
}

export async function POST(request: Request) {
  const rateError = enforceRateLimit(request, "worker-claim", 120);
  if (rateError) return rateError;
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const parsed = claimJobRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Claim payload is invalid." }, { status: 400 });
  const claimed = getDemoStore().claimAssignedJob(worker.id);
  if (!claimed) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const { aggregate, leaseToken } = claimed;
  const task = aggregate.task;
  const assignment = aggregate.assignment;
  const job = aggregate.jobRun;
  if (!assignment || !assignment.acceptedAt || !job || !job.leaseExpiresAt) return noStoreJson({ error: "Claimed job is missing verified provider acceptance." }, { status: 409 });
  const repositoryPath = task.repository.replace("demo://", "").split("/");
  const acceptanceChecks: WireCheck[] = task.acceptanceChecks.map((check) => {
    const { id, type, title, required, ...config } = check;
    return { id, type, label: title, required, config };
  });
  return noStoreJson({
    protocolVersion: "1.0",
    taskId: task.id,
    assignmentId: assignment.id,
    jobRunId: job.id,
    workerId: worker.id,
    leaseToken,
    leaseExpiresAt: job.leaseExpiresAt,
    providerAcceptedAt: assignment.acceptedAt,
    executor: { kind: "demo" },
    workflow: { id: task.taskType, version: 1, allowedCommandIds: allowedCommands(task.taskType) },
    task: { title: task.title, problemDescription: task.problemDescription, desiredOutcome: task.desiredOutcome, scopeSummary: task.analysis?.scopeSummary ?? task.problemDescription, acceptanceChecks },
    repository: { mode: "demo", owner: repositoryPath[0] ?? "sample-org", name: repositoryPath[1] ?? "demo-repository", targetBranch: task.targetBranch },
    permissions: { modifyCode: task.allowCodeChanges, createPullRequest: task.allowPullRequest, humanApprovalRequired: task.requiresHumanApproval },
    limits: { timeoutMs: 30 * 60_000, maxLogBytes: 1_000_000, maxArtifactBytes: 10 * 1024 * 1024, maxArtifacts: 20, allowedMimeTypes: ["text/plain", "text/x-diff", "application/json", "image/png", "image/jpeg", "image/webp"], allowedNetworkDomains: [] }
  });
}
