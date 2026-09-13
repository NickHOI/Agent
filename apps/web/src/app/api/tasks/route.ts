import { getDemoStore } from "@donelayer/database";
import { createTaskInputSchema } from "@donelayer/shared";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { createWorkspaceWork, createWorkspaceWorkInputSchema } from "@/server/trust-workspace";

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "task-create", 15);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || actor.role !== "CUSTOMER") return noStoreJson({ error: "Customer access required." }, { status: 403 });
  if (process.env.APP_MODE === "supabase") {
    const parsed = createWorkspaceWorkInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return noStoreJson({ error: "Work validation failed.", issues: parsed.error.issues }, { status: 400 });
    }
    try {
      const work = await createWorkspaceWork(parsed.data);
      return noStoreJson({ taskId: work.taskId, status: "DRAFT" }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "WORKSPACE_WORK_CREATE_FAILED";
      if (message === "WORKSPACE_AGENT_ACCESS_DENIED") {
        return noStoreJson({ error: "The selected Agent is not available in this workspace." }, { status: 403 });
      }
      return noStoreJson({ error: "Unable to create this Work request." }, { status: 400 });
    }
  }
  const parsed = createTaskInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Task validation failed.", issues: parsed.error.issues }, { status: 400 });
  try {
    const task = getDemoStore().createTask(parsed.data, actor.id);
    return noStoreJson({ taskId: task.id, status: task.status }, { status: 201 });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to create task." }, { status: 400 });
  }
}
