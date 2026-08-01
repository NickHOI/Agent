import { getDemoStore, type WorkerRecord } from "@donelayer/database";

export function authenticateWorkerRequest(request: Request): WorkerRecord | null {
  const authorization = request.headers.get("authorization");
  const workerId = request.headers.get("x-donelayer-worker-id");
  if (!authorization?.startsWith("Bearer ") || !workerId) return null;
  const worker = getDemoStore().authenticateWorker(authorization.slice(7));
  return worker?.id === workerId && worker.status !== "SUSPENDED" ? worker : null;
}
