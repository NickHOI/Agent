import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { canOperateTask } from "@/server/authorization";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "demo-step", 120);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor) return noStoreJson({ error: "Authentication required." }, { status: 401 });
  const { taskId } = await context.params;
  try {
    const current = getDemoStore().getTaskAggregate(taskId);
    if (!canOperateTask(actor, current)) return noStoreJson({ error: "You cannot operate this task." }, { status: 403 });
    const aggregate = getDemoStore().advanceDemo(taskId);
    return noStoreJson(aggregate);
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to advance demo." }, { status: 409 });
  }
}
