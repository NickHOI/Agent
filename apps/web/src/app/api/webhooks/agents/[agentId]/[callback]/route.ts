import { createHash } from "node:crypto";
import {
  MemoryReplayStore,
  MemoryWebhookDeliveryStore,
  parseWebhookCallback,
  verifySignedWebhookRequest
} from "@donelayer/agent-adapters";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

const replayStore = new MemoryReplayStore();
const deliveryStore = new MemoryWebhookDeliveryStore();

export async function POST(request: Request, context: { params: Promise<{ agentId: string; callback: string }> }) {
  const rateError = enforceRateLimit(request, "agent-callback", 180);
  if (rateError) return rateError;
  const secret = process.env.WEBHOOK_AGENT_CALLBACK_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) return noStoreJson({ error: "Webhook Agent callbacks are not configured." }, { status: 503 });
  const { agentId, callback } = await context.params;
  if (callback !== "status" && callback !== "result" && callback !== "error") return noStoreJson({ error: "Unknown callback type." }, { status: 404 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 1024 * 1024) return noStoreJson({ error: "Callback body is too large." }, { status: 413 });
  try {
    const verified = await verifySignedWebhookRequest({ secret, rawBody, headers: request.headers, replayStore, deliveryStore, replayScope: `agent:${agentId}` });
    const parsed = parseWebhookCallback(rawBody);
    if (parsed.type !== callback || verified.event !== `agent.callback.${callback}`) throw new Error("Callback event type mismatch.");
    const store = getDemoStore();
    const isNew = store.recordWebhookReceipt(`agent:${agentId}`, verified.deliveryId, verified.event, createHash("sha256").update(rawBody).digest("hex"));
    if (isNew) store.recordAgentCallback(agentId, parsed.jobRunId, parsed.type, parsed as unknown as Record<string, unknown>);
    return noStoreJson({ accepted: true, duplicate: !isNew });
  } catch {
    return noStoreJson({ error: "Agent callback verification failed." }, { status: 401 });
  }
}
