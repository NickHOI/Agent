import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { authenticateWorkerRequest } from "@/server/worker-auth";

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

export async function PUT(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  const rateError = enforceRateLimit(request, "artifact-put", 100);
  if (rateError) return rateError;
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const token = request.headers.get("x-donelayer-upload-token");
  if (!token || token.length < 40) return noStoreJson({ error: "Artifact upload token is missing." }, { status: 401 });
  const leaseToken = request.headers.get("x-donelayer-lease-token");
  if (!leaseToken || leaseToken.length < 32) return noStoreJson({ error: "Artifact Lease token is missing." }, { status: 401 });
  const mimeType = request.headers.get("content-type");
  if (!mimeType) return noStoreJson({ error: "Artifact MIME type is missing." }, { status: 400 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_ARTIFACT_BYTES) return noStoreJson({ error: "Artifact is too large." }, { status: 413 });
  const { artifactId } = await context.params;
  try {
    const bytes = await readBodyLimited(request, MAX_ARTIFACT_BYTES);
    getDemoStore().receiveArtifactUpload(artifactId, token, worker.id, leaseToken, mimeType, bytes);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Artifact upload failed." }, { status: 409 });
  }
}

async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Artifact is too large.");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
