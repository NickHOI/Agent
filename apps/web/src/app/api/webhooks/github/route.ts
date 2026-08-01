import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { verifyGithubWebhook } from "@/server/github-app";

export async function POST(request: Request) {
  const rateError = enforceRateLimit(request, "github-webhook", 180);
  if (rateError) return rateError;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return noStoreJson({ error: "GitHub App webhook is not configured." }, { status: 503 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 2 * 1024 * 1024) return noStoreJson({ error: "Webhook body is too large." }, { status: 413 });
  try {
    const verified = verifyGithubWebhook({ rawBody, signature: request.headers.get("x-hub-signature-256"), eventType: request.headers.get("x-github-event"), deliveryId: request.headers.get("x-github-delivery"), secret });
    const isNew = getDemoStore().recordWebhookReceipt("github", verified.deliveryId, verified.eventType, verified.bodySha256);
    return noStoreJson({ accepted: true, duplicate: !isNew });
  } catch {
    return noStoreJson({ error: "GitHub webhook verification failed." }, { status: 401 });
  }
}
