import { timingSafeEqual } from "node:crypto";

import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";

const requestSchema = z.object({
  workflowId: z.literal("REPOSITORY_MATERIALIZE_V1"),
  workerId: z.string().uuid(),
}).strict();

export async function POST(request: Request) {
  const configuredToken = process.env.REPOSITORY_REALITY_GATE_TOKEN;
  const authorization = request.headers.get("authorization");
  if (
    !configuredToken ||
    configuredToken.length < 32 ||
    !authorization?.startsWith("Bearer ") ||
    !tokensEqual(authorization.slice(7), configuredToken)
  ) {
    return noStoreJson({ error: "Repository reality gate is disabled." }, { status: 404 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({ error: "Only REPOSITORY_MATERIALIZE_V1 may be created by this endpoint." }, { status: 400 });
  }
  try {
    const aggregate = getDemoStore().createRepositoryMaterializationTask(parsed.data.workerId);
    return noStoreJson({
      taskId: aggregate.task.id,
      jobRunId: aggregate.jobRun?.id,
      workerId: aggregate.task.assignedWorkerId,
      workflowId: aggregate.jobRun?.workflowTemplate,
      taskState: aggregate.task.status,
      taskContractId: aggregate.taskContract?.id,
      permissionLeaseId: aggregate.permissionLease?.id,
    }, { status: 201 });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to create repository materialization Task." }, { status: 409 });
  }
}

function tokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
