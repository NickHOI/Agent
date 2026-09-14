import { getActor } from "@/server/auth";
import { noStoreJson } from "@/server/http-security";
import { getWorkspaceWork } from "@/server/trust-workspace";
import { runCanonicalVerifiedWorkExecution } from "@/server/verified-work-execution/orchestrator";

export const maxDuration = 800;

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (process.env.APP_MODE !== "supabase") {
    return noStoreJson({ error: "Verified Work execution is unavailable in Demo mode." }, { status: 404 });
  }
  const actor = await getActor();
  if (!actor) return noStoreJson({ error: "Authentication required." }, { status: 401 });
  if (actor.role !== "CUSTOMER") {
    return noStoreJson({ error: "Only the Work owner may start this execution." }, { status: 403 });
  }
  const { taskId } = await context.params;
  const work = await getWorkspaceWork(actor, taskId);
  if (!work) return noStoreJson({ error: "Work not found." }, { status: 404 });
  if (
    work.status !== "PUBLISHED" ||
    !work.contract ||
    work.contract.version < 1 ||
    work.contract.status !== "LOCKED" ||
    !work.authority ||
    work.authority.decision !== "APPROVED" ||
    work.execution.state !== "NOT_STARTED"
  ) {
    return noStoreJson({ error: "Work is not at the approved canonical execution boundary." }, { status: 409 });
  }
  try {
    const outcome = await runCanonicalVerifiedWorkExecution({
      ownerAuthUserId: actor.id,
      taskId: work.id,
      contractId: work.contract.id,
      contractSha256: work.contract.sha256,
      authorityId: work.authority.id,
      authorityScopeSha256: work.authority.scopeSha256,
      workflow: work.contract.allowedWorkflow,
    });
    return noStoreJson({
      taskId: outcome.taskId,
      jobRunId: outcome.jobRunId,
      status: outcome.status,
      executionOutcome: outcome.outcomes.executionOutcome,
      independentVerificationOutcome: outcome.outcomes.independentVerificationOutcome,
      deliveryOutcome: outcome.outcomes.deliveryOutcome,
      receiptId: outcome.receipt.id,
      receiptPublicId: outcome.receipt.publicId,
      receiptSha256: outcome.receipt.sha256,
      evidenceChainSha256: outcome.receipt.evidenceChainSha256,
      executionSandboxCleanupVerified: outcome.execution.cleanup.cleanupVerified,
      verifierSandboxCleanupVerified: outcome.verification.cleanup.cleanupVerified,
    });
  } catch (error) {
    return noStoreJson({ error: safeExecutionError(error) }, { status: 502 });
  }
}

function safeExecutionError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}
