import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { authenticateWorkerRequest } from "@/server/worker-auth";

const schema = z.object({
  protocolVersion: z.literal("1.0"),
  leaseToken: z.string().min(32),
  artifactType: z.enum(["GIT_DIFF", "BUILD_LOG", "TEST_LOG", "TEST_RESULT", "SCREENSHOT", "EXECUTOR_RESULT", "OTHER"]),
  fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/),
  mimeType: z.enum(["text/plain", "text/x-diff", "application/json", "image/png", "image/jpeg", "image/webp"]),
  size: z.number().int().min(0).max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export async function POST(request: Request, context: { params: Promise<{ jobRunId: string }> }) {
  const rateError = enforceRateLimit(request, "artifact-init", 100);
  if (rateError) return rateError;
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Artifact metadata is invalid." }, { status: 400 });
  const { jobRunId } = await context.params;
  try {
    const initialized = getDemoStore().initializeArtifactUpload(jobRunId, worker.id, parsed.data.leaseToken, parsed.data);
    const uploadUrl = new URL(`/api/worker/uploads/${initialized.artifactId}`, request.url).toString();
    return noStoreJson({ artifactId: initialized.artifactId, uploadUrl, uploadHeaders: { "x-donelayer-upload-token": initialized.uploadToken } }, { status: 201 });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Unable to initialize artifact." }, { status: 409 });
  }
}
