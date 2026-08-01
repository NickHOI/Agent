import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

const decisionSchema = z.object({ decision: z.enum(["ACCEPT", "DECLINE", "LATER"]) }).strict();

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "provider-decision", 30);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || actor.role !== "PROVIDER") return noStoreJson({ error: "Provider access required." }, { status: 403 });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid provider decision." }, { status: 400 });
  const { taskId } = await context.params;
  try {
    const aggregate = getDemoStore().providerTaskDecision(taskId, actor.id, parsed.data.decision);
    return noStoreJson({ taskId, status: aggregate.task.status });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to record the decision." }, { status: 409 });
  }
}
