import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

const schema = z.object({ action: z.enum(["SUSPEND_WORKER", "SUSPEND_AGENT", "REMATCH_TASK"]), resourceId: z.string().min(1).max(128) }).strict();

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "admin-action", 30);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || actor.role !== "ADMIN") return noStoreJson({ error: "Admin access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid Admin action." }, { status: 400 });
  try {
    const store = getDemoStore();
    if (parsed.data.action === "SUSPEND_WORKER") store.adminSuspendWorker(parsed.data.resourceId, actor.id);
    if (parsed.data.action === "SUSPEND_AGENT") store.adminSuspendAgent(parsed.data.resourceId, actor.id);
    if (parsed.data.action === "REMATCH_TASK") store.adminRematchTask(parsed.data.resourceId, actor.id);
    return noStoreJson({ ok: true });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Admin action failed." }, { status: 409 });
  }
}
