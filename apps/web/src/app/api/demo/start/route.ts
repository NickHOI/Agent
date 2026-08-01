import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "demo-start", 10);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || (actor.role !== "CUSTOMER" && actor.role !== "ADMIN")) return noStoreJson({ error: "Customer access required." }, { status: 403 });
  try {
    const task = getDemoStore().createDemoTask();
    return noStoreJson({ taskId: task.id, status: task.status }, { status: 201 });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to create demo task." }, { status: 400 });
  }
}
