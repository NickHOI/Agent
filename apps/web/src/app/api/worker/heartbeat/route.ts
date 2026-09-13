import { workerHeartbeatSchema } from "@donelayer/worker-protocol";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { authenticateWorkerRequest } from "@/server/worker-auth";

export async function POST(request: Request) {
  const rateError = enforceRateLimit(request, "worker-heartbeat", 120);
  if (rateError) return rateError;
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const parsed = workerHeartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Heartbeat payload is invalid." }, { status: 400 });
  getDemoStore().recordWorkerHeartbeat(
    worker.id,
    parsed.data.status,
    parsed.data.capabilities,
    parsed.data.activeJobRunIds,
    parsed.data.sentAt,
  );
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
