import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { authenticateWorkerRequest } from "@/server/worker-auth";

const schema = z.object({ protocolVersion: z.literal("1.0"), leaseToken: z.string().min(32), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export async function POST(request: Request, context: { params: Promise<{ jobRunId: string; artifactId: string }> }) {
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Artifact finalize request is invalid." }, { status: 400 });
  const { jobRunId, artifactId } = await context.params;
  try {
    const artifact = getDemoStore().finalizeArtifactUpload(jobRunId, worker.id, parsed.data.leaseToken, artifactId, parsed.data.sha256);
    return noStoreJson({ artifactId: artifact.id, artifactType: artifact.artifactType, fileName: artifact.fileName, mimeType: artifact.mimeType, size: artifact.size, sha256: artifact.sha256 });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Artifact finalize failed." }, { status: 409 });
  }
}
