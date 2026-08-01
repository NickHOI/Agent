import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

export async function PUT(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  const rateError = enforceRateLimit(request, "artifact-put", 100);
  if (rateError) return rateError;
  const token = request.headers.get("x-donelayer-upload-token");
  if (!token || token.length < 40) return noStoreJson({ error: "Artifact upload token is missing." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 10 * 1024 * 1024) return noStoreJson({ error: "Artifact is too large." }, { status: 413 });
  const { artifactId } = await context.params;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 10 * 1024 * 1024) return noStoreJson({ error: "Artifact is too large." }, { status: 413 });
    getDemoStore().receiveArtifactUpload(artifactId, token, bytes);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Artifact upload failed." }, { status: 409 });
  }
}
