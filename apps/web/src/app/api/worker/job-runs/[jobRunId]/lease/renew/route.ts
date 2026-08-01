import { leaseRequestSchema } from "@donelayer/worker-protocol";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { authenticateWorkerRequest } from "@/server/worker-auth";

export async function POST(request: Request, context: { params: Promise<{ jobRunId: string }> }) {
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const parsed = leaseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Lease request is invalid." }, { status: 400 });
  const { jobRunId } = await context.params;
  try {
    const leaseExpiresAt = getDemoStore().renewJobLease(jobRunId, worker.id, parsed.data.leaseToken);
    return noStoreJson({ leaseExpiresAt });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Lease renewal failed." }, { status: 409 });
  }
}
