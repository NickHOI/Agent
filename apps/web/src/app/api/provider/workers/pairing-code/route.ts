import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

const schema = z.union([
  z.object({ workerId: z.string().min(1) }).strict(),
  z.object({ name: z.string().trim().min(2).max(100), os: z.enum(["WINDOWS", "MACOS", "LINUX"]) }).strict()
]);

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "pairing-create", 10);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || actor.role !== "PROVIDER") return noStoreJson({ error: "Provider access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid Worker details." }, { status: 400 });
  try {
    const store = getDemoStore();
    const workerId = "workerId" in parsed.data ? parsed.data.workerId : store.createWorker(actor.id, parsed.data.name, parsed.data.os).id;
    const pairing = store.createPairingCode(workerId, actor.id);
    return noStoreJson({ workerId, ...pairing }, { status: 201 });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to create pairing code." }, { status: 400 });
  }
}
