import { pairWorkerRequestSchema } from "@donelayer/worker-protocol";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
  const rateError = enforceRateLimit(request, "worker-pair", 8, 60_000);
  if (rateError) return rateError;
  const parsed = pairWorkerRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Pairing request is invalid." }, { status: 400 });
  try {
    const store = getDemoStore();
    const paired = store.pairWorker(parsed.data.pairingCode);
    store.heartbeat(paired.workerId, "ONLINE", { name: parsed.data.name });
    store.recordWorkerHeartbeat(
      paired.workerId,
      "ONLINE",
      parsed.data.capabilities,
      [],
      paired.pairedAt,
    );
    return noStoreJson({ workerId: paired.workerId, workerToken: paired.token, pairedAt: paired.pairedAt }, { status: 201 });
  } catch {
    return noStoreJson({ error: "Pairing code is invalid or expired." }, { status: 400 });
  }
}
