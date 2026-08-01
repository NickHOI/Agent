import { z } from "zod";
import { tryImportA2AAgentCard } from "@donelayer/agent-adapters";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

const schema = z.object({ url: z.string().url().refine((value) => value.startsWith("https://"), "Agent Card URL must use HTTPS") }).strict();

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "agent-card-import", 8);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || actor.role !== "PROVIDER") return noStoreJson({ error: "Provider access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Enter a valid HTTPS Agent Card URL." }, { status: 400 });
  const result = await tryImportA2AAgentCard(parsed.data.url);
  if (!result.ok) return noStoreJson({ error: result.error }, { status: 422 });
  return noStoreJson(result.agent);
}
