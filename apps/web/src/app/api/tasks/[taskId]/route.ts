import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { canViewTask } from "@/server/authorization";
import { noStoreJson } from "@/server/http-security";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const actor = await getActor();
  if (!actor) return noStoreJson({ error: "Authentication required." }, { status: 401 });
  const { taskId } = await context.params;
  try {
    const aggregate = getDemoStore().getTaskAggregate(taskId);
    if (!canViewTask(actor, aggregate)) return noStoreJson({ error: "Task not found." }, { status: 404 });
    return noStoreJson(aggregate);
  } catch {
    return noStoreJson({ error: "Task not found." }, { status: 404 });
  }
}
