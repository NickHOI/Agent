import {
  WORKER_PROTOCOL_VERSION,
  claimJobRequestSchema,
  jobEnvelopeSchema,
  type AcceptanceCheck as WireCheck,
  type JobEnvelope,
  type SafeCommandId,
} from "@donelayer/worker-protocol";
import { getDemoStore, type TaskAggregate } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { resolveRepositoryEnvelope } from "@/server/repository-envelope";
import { authenticateWorkerRequest } from "@/server/worker-auth";

function allowedCommands(taskType: string): SafeCommandId[] {
  if (taskType === "WORKER_SMOKE_V1" || taskType === "REPOSITORY_MATERIALIZE_V1") return [];
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
  const store = getDemoStore();
  try {
    const candidate = store.getClaimCandidate(worker.id);
    if (!candidate) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    const candidateJob = candidate.jobRun;
    if (!candidateJob) throw new Error("Claim candidate has no queued Job.");
    const requiredExecutor = executorKind(candidateJob.executor);
    if (!worker.capabilitySnapshot?.executors.includes(requiredExecutor)) {
      throw new Error(`Worker did not report the ${requiredExecutor} executor capability.`);
    }
    validateClaimCandidate(candidate, worker.id);

    const claimed = store.claimAssignedJob(worker.id, candidateJob.id);
    if (!claimed) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    const claimedJob = claimed.aggregate.jobRun;
    if (!claimedJob?.leaseExpiresAt) throw new Error("Claimed Job has no active Lease.");
    return noStoreJson(buildEnvelope(claimed.aggregate, worker.id, claimed.leaseToken, claimedJob.leaseExpiresAt));
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Job claim failed." }, { status: 409 });
  }
}

function buildEnvelope(
  aggregate: TaskAggregate,
  workerId: string,
  leaseToken: string,
  leaseExpiresAt: string,
): JobEnvelope {
  const task = aggregate.task;
  const assignment = aggregate.assignment;
  const job = aggregate.jobRun;
  const contract = aggregate.taskContract;
  const permissionLease = aggregate.permissionLease;
  if (!assignment?.acceptedAt || !job) throw new Error("Claimed Job is missing verified Server assignment.");
  if (!contract || job.taskContractVersionId !== contract.id || !["LOCKED", "SUPERSEDED"].includes(contract.status)) {
    throw new Error("Claimed Job is missing its immutable Task Contract.");
  }
  if (!permissionLease || permissionLease.status !== "ACTIVE" || !permissionLease.startsAt || !permissionLease.expiresAt) {
    throw new Error("Claimed Job is missing its active Permission Lease.");
  }
  if (assignment.workerId !== workerId || job.workerId !== workerId || task.assignedWorkerId !== workerId) {
    throw new Error("Claimed Job ownership does not match this Worker.");
  }
  if (
    permissionLease.jobRunId !== job.id ||
    permissionLease.workerId !== workerId ||
    permissionLease.agentId !== job.agentId ||
    permissionLease.taskContractVersionId !== contract.id
  ) throw new Error("Permission Lease binding does not match the claimed Job.");
  const workflowId = contract.contract.allowedWorkflow;
  if (workflowId !== job.workflowTemplate) throw new Error("Job workflow does not match the locked Task Contract.");
  const acceptanceChecks: WireCheck[] = contract.contract.acceptanceChecks as WireCheck[];
  const smoke = workflowId === "WORKER_SMOKE_V1";
  const repository = resolveRepositoryEnvelope({
    repository: task.repository,
    targetBranch: task.targetBranch,
    customerId: task.customerId,
    workflowId,
  });
  const artifactMimeTypes = contract.contract.acceptanceChecks
    .flatMap((check) => typeof check.config.mimeType === "string" ? [check.config.mimeType] : []);
  return jobEnvelopeSchema.parse({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    taskId: task.id,
    assignmentId: assignment.id,
    jobRunId: job.id,
    workerId,
    leaseToken,
    leaseExpiresAt,
    taskContract: {
      id: contract.id,
      version: contract.version,
      sha256: contract.contractSha256,
    },
    permissionLease: {
      id: permissionLease.id,
      version: permissionLease.version,
      status: permissionLease.status,
      startsAt: permissionLease.startsAt,
      expiresAt: permissionLease.expiresAt,
      scope: permissionLease.scope,
    },
    providerAcceptedAt: assignment.acceptedAt,
    executor: { kind: executorKind(job.executor) },
    workflow: { id: workflowId, version: 1, allowedCommandIds: allowedCommands(workflowId) },
    task: {
      title: task.title,
      problemDescription: task.problemDescription,
      desiredOutcome: contract.contract.desiredOutcome,
      scopeSummary: `${contract.contract.taskType}: ${contract.contract.deliverables.join(", ")}`,
      acceptanceChecks,
    },
    repository,
    permissions: {
      modifyCode: permissionLease.scope.allowedActions.includes("modify_code"),
      createPullRequest: permissionLease.scope.allowedActions.includes("create_pull_request"),
      humanApprovalRequired: contract.contract.humanApprovalRequirements.length > 0,
    },
    limits: {
      timeoutMs: Math.min(contract.contract.timeLimitSeconds, permissionLease.scope.maxRuntimeSeconds) * 1000,
      maxLogBytes: smoke ? 128 * 1024 : 1_000_000,
      maxArtifactBytes: permissionLease.scope.maxArtifactBytes,
      maxArtifacts: Math.max(1, contract.contract.deliverables.length),
      allowedMimeTypes: artifactMimeTypes.length ? [...new Set(artifactMimeTypes)] : ["application/octet-stream"],
      allowedNetworkDomains: permissionLease.scope.allowedDomains,
    },
  });
}

function validateClaimCandidate(aggregate: TaskAggregate, workerId: string): void {
  const { task, assignment, jobRun, taskContract, permissionLease } = aggregate;
  if (!assignment?.acceptedAt || !jobRun) throw new Error("Claim candidate is missing a Server assignment.");
  if (assignment.workerId !== workerId || jobRun.workerId !== workerId || task.assignedWorkerId !== workerId) {
    throw new Error("Claim candidate ownership does not match this Worker.");
  }
  resolveRepositoryEnvelope({
    repository: task.repository,
    targetBranch: task.targetBranch,
    customerId: task.customerId,
    workflowId: jobRun.workflowTemplate,
  });
  if (!taskContract || taskContract.status !== "LOCKED" || jobRun.taskContractVersionId !== taskContract.id) {
    throw new Error("Claim candidate has no locked Task Contract.");
  }
  if (
    !permissionLease ||
    permissionLease.status !== "PENDING" ||
    permissionLease.jobRunId !== jobRun.id ||
    permissionLease.workerId !== workerId ||
    permissionLease.taskContractVersionId !== taskContract.id
  ) throw new Error("Claim candidate has no correctly bound pending Permission Lease.");
  if (taskContract.contract.allowedWorkflow !== jobRun.workflowTemplate) {
    throw new Error("Claim candidate workflow differs from its locked Task Contract.");
  }
}

function executorKind(executor: string): JobEnvelope["executor"]["kind"] {
  if (executor === "WORKER_SMOKE") return "worker-smoke";
  if (executor === "REPOSITORY_MATERIALIZER") return "repository-materializer";
  if (executor === "CODEX") return "codex-cli";
  return "demo";
}
