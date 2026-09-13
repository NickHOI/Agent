import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { toTaskViewAggregate } from "@/server/task-view";

const schema = z.object({ reason: z.string().trim().min(10).max(5000) }).strict();

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "dispute-open", 8);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || (actor.role !== "CUSTOMER" && actor.role !== "ADMIN")) return noStoreJson({ error: "Customer or Admin access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Provide a dispute reason of at least 10 characters." }, { status: 400 });
  const { taskId } = await context.params;
  try {
    const store = getDemoStore();
    const dispute = store.openDispute(taskId, { kind: actor.role, id: actor.id }, parsed.data.reason);
    return noStoreJson({ dispute, aggregate: toTaskViewAggregate(store.getTaskAggregate(taskId)) }, { status: 201 });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to open dispute." }, { status: 409 });
  }
}
