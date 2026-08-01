import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SIGNATURE_VERSION = "v1" as const;
export const WEBHOOK_MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type WebhookSignatureInput = {
  timestamp: string;
  nonce: string;
  deliveryId: string;
  event: string;
  rawBody: string | Uint8Array;
};

export type ReplayStore = {
  consume(scope: string, nonce: string, expiresAt: Date): Promise<boolean>;
};

export type WebhookDeliveryStore = {
  consume(scope: string, deliveryId: string, expiresAt: Date): Promise<boolean>;
};

export class MemoryReplayStore implements ReplayStore {
  private readonly nonces = new Map<string, number>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly maxEntries = 10_000,
  ) {}

  async consume(scope: string, nonce: string, expiresAt: Date): Promise<boolean> {
    const now = this.now().getTime();
    for (const [key, expiry] of this.nonces) {
      if (expiry <= now) this.nonces.delete(key);
    }
    const key = `${scope}:${nonce}`;
    if (this.nonces.has(key)) return false;
    if (this.nonces.size >= this.maxEntries) {
      throw new Error("Webhook replay store capacity exceeded");
    }
    this.nonces.set(key, expiresAt.getTime());
    return true;
  }
}

export class MemoryWebhookDeliveryStore implements WebhookDeliveryStore {
  private readonly deliveries = new Map<string, number>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly maxEntries = 10_000,
  ) {}

  async consume(scope: string, deliveryId: string, expiresAt: Date): Promise<boolean> {
    const now = this.now().getTime();
    for (const [existingKey, expiry] of this.deliveries) {
      if (expiry <= now) this.deliveries.delete(existingKey);
    }
    const key = `${scope}:${deliveryId}`;
    if (this.deliveries.has(key)) return false;
    if (this.deliveries.size >= this.maxEntries) {
      throw new Error("Webhook delivery store capacity exceeded");
    }
    this.deliveries.set(key, expiresAt.getTime());
    return true;
  }
}

export function createWebhookNonce(): string {
  return randomBytes(18).toString("base64url");
}

export function canonicalWebhookPayload(input: WebhookSignatureInput): Buffer {
  const prefix = Buffer.from(
    `${WEBHOOK_SIGNATURE_VERSION}\n${input.timestamp}\n${input.nonce}\n${input.deliveryId}\n${input.event}\n`,
    "utf8",
  );
  const body =
    typeof input.rawBody === "string" ? Buffer.from(input.rawBody, "utf8") : Buffer.from(input.rawBody);
  return Buffer.concat([prefix, body]);
}

export function signWebhook(secret: string, input: WebhookSignatureInput): string {
  assertWebhookSecret(secret);
  const digest = createHmac("sha256", secret).update(canonicalWebhookPayload(input)).digest("hex");
  return `${WEBHOOK_SIGNATURE_VERSION}=${digest}`;
}

export async function verifyWebhookSignature(options: {
  secret: string;
  input: WebhookSignatureInput;
  signature: string;
  replayStore: ReplayStore;
  replayScope: string;
  now?: Date;
  maxClockSkewMs?: number;
}): Promise<void> {
  const now = options.now ?? new Date();
  const maxClockSkewMs = options.maxClockSkewMs ?? WEBHOOK_MAX_CLOCK_SKEW_MS;
  const timestampSeconds = Number(options.input.timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) {
    throw new Error("Webhook timestamp is invalid");
  }
  const timestampMs = timestampSeconds * 1_000;
  if (Math.abs(now.getTime() - timestampMs) > maxClockSkewMs) {
    throw new Error("Webhook timestamp is outside the allowed clock skew");
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(options.input.nonce)) {
    throw new Error("Webhook nonce is invalid");
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(options.input.deliveryId)) {
    throw new Error("Webhook delivery ID is invalid");
  }

  const expected = signWebhook(options.secret, options.input);
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(options.signature, "utf8");
  if (expectedBytes.length !== actualBytes.length || !timingSafeEqual(expectedBytes, actualBytes)) {
    throw new Error("Webhook signature is invalid");
  }

  const consumed = await options.replayStore.consume(
    options.replayScope,
    options.input.nonce,
    new Date(timestampMs + maxClockSkewMs),
  );
  if (!consumed) {
    throw new Error("Webhook nonce has already been used");
  }
}

export async function verifySignedWebhookRequest(options: {
  secret: string;
  rawBody: string | Uint8Array;
  headers: Headers | Record<string, string | undefined>;
  replayStore: ReplayStore;
  deliveryStore: WebhookDeliveryStore;
  replayScope: string;
  now?: Date;
}): Promise<{ deliveryId: string; event: string; duplicateDelivery: boolean }> {
  const timestamp = readHeader(options.headers, "x-donelayer-timestamp");
  const nonce = readHeader(options.headers, "x-donelayer-nonce");
  const deliveryId = readHeader(options.headers, "x-donelayer-delivery");
  const signature = readHeader(options.headers, "x-donelayer-signature");
  const event = readHeader(options.headers, "x-donelayer-event");
  if (!timestamp || !nonce || !deliveryId || !signature || !event) {
    throw new Error("Required DoneLayer webhook headers are missing");
  }
  await verifyWebhookSignature({
    secret: options.secret,
    input: { timestamp, nonce, deliveryId, event, rawBody: options.rawBody },
    signature,
    replayStore: options.replayStore,
    replayScope: options.replayScope,
    ...(options.now ? { now: options.now } : {}),
  });
  const referenceNow = options.now ?? new Date();
  const isNewDelivery = await options.deliveryStore.consume(
    options.replayScope,
    deliveryId,
    new Date(referenceNow.getTime() + 24 * 60 * 60 * 1_000),
  );
  return { deliveryId, event, duplicateDelivery: !isNewDelivery };
}

function assertWebhookSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Webhook secret must contain at least 32 bytes");
  }
}

function readHeader(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1];
}
