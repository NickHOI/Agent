import { noStoreJson } from "@/server/http-security";
import { authenticateWorkerRequest } from "@/server/worker-auth";
import { getDemoStore } from "@donelayer/database";

export async function POST(request: Request) {
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  getDemoStore().revokeWorkerToken(worker.id);
  return noStoreJson({ ok: true });
}
