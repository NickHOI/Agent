import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { canViewTask } from "@/server/authorization";
import { noStoreJson } from "@/server/http-security";
import { toTaskViewAggregate } from "@/server/task-view";
import { getWorkspaceWork } from "@/server/trust-workspace";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const actor = await getActor();
  if (!actor) return noStoreJson({ error: "Authentication required." }, { status: 401 });
  const { taskId } = await context.params;
  if (process.env.APP_MODE === "supabase") {
    try {
      const work = await getWorkspaceWork(actor, taskId);
      return work ? noStoreJson(work) : noStoreJson({ error: "Work not found." }, { status: 404 });
    } catch {
      return noStoreJson({ error: "Work not found." }, { status: 404 });
    }
  }
  try {
    const aggregate = getDemoStore().getTaskAggregate(taskId);
    if (!canViewTask(actor, aggregate)) return noStoreJson({ error: "Task not found." }, { status: 404 });
    return noStoreJson(toTaskViewAggregate(aggregate));
  } catch {
    return noStoreJson({ error: "Task not found." }, { status: 404 });
  }
}
