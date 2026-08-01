import { createTaskInputSchema } from "@donelayer/shared";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { getTaskAnalyzer } from "@/server/task-analyzers";

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "task-analyze", 20);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || (actor.role !== "CUSTOMER" && actor.role !== "ADMIN")) return noStoreJson({ error: "Customer access required." }, { status: 403 });
  const parsed = createTaskInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Task requirements are incomplete.", issues: parsed.error.issues }, { status: 400 });
  const analysis = await getTaskAnalyzer().analyze(parsed.data);
  return noStoreJson(analysis);
}
