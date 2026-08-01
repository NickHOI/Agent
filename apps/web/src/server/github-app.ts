import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const allowedEvents = new Set(["push", "pull_request", "check_run", "workflow_run"]);

export interface VerifiedGithubWebhook {
  eventType: string;
  deliveryId: string;
  bodySha256: string;
  payload: unknown;
}

export function verifyGithubWebhook(input: {
  rawBody: string;
  signature: string | null;
  eventType: string | null;
  deliveryId: string | null;
  secret: string;
}): VerifiedGithubWebhook {
  if (!input.eventType || !allowedEvents.has(input.eventType)) throw new Error("Unsupported GitHub event type.");
  if (!input.deliveryId || !/^[A-Za-z0-9-]{8,100}$/.test(input.deliveryId)) throw new Error("GitHub delivery identifier is missing.");
  if (!input.signature?.startsWith("sha256=")) throw new Error("GitHub webhook signature is missing.");
  const suppliedHex = input.signature.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) throw new Error("GitHub webhook signature is invalid.");
  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest();
  const supplied = Buffer.from(suppliedHex, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("GitHub webhook signature is invalid.");
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    throw new Error("GitHub webhook body is not valid JSON.");
  }
  return { eventType: input.eventType, deliveryId: input.deliveryId, bodySha256: createHash("sha256").update(input.rawBody).digest("hex"), payload };
}

export class GithubAppAdapter {
  readonly configured: boolean;
  constructor(private readonly configuration = {
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET
  }) {
    this.configured = Boolean(configuration.appId && configuration.privateKey && configuration.webhookSecret);
  }

  getMinimumPermissions() {
    return {
      metadata: "read",
      contents: "read",
      pullRequests: "read",
      checks: "read",
      actions: "read",
      optionalWrite: ["contents", "pull_requests"]
    } as const;
  }

  assertConfigured(): void {
    if (!this.configured) throw new Error("GitHub App is not configured; use Demo Repository mode.");
  }
}
