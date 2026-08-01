import { z } from "zod";
import { jobRunEventSchema } from "@donelayer/worker-protocol";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { authenticateWorkerRequest } from "@/server/worker-auth";

const schema = jobRunEventSchema.extend({ leaseToken: z.string().min(32) });

export async function POST(request: Request, context: { params: Promise<{ jobRunId: string }> }) {
  const rateError = enforceRateLimit(request, "worker-event", 600);
  if (rateError) return rateError;
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Job event is invalid." }, { status: 400 });
  const { jobRunId } = await context.params;
  if (parsed.data.jobRunId !== jobRunId) return noStoreJson({ error: "Job event target mismatch." }, { status: 400 });
  try {
    getDemoStore().appendWorkerProtocolEvent(jobRunId, worker.id, parsed.data.leaseToken, {
      eventId: parsed.data.eventId,
      type: parsed.data.type,
      message: parsed.data.message,
      createdAt: parsed.data.createdAt,
      ...(parsed.data.progress === undefined ? {} : { progress: parsed.data.progress }),
      ...(parsed.data.data === undefined ? {} : { data: parsed.data.data })
    });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to record job event." }, { status: 409 });
  }
}
