import { randomUUID } from "node:crypto";
import { z } from "zod";

import { sha256 } from "@donelayer/worker-protocol";

import {
  assertSafeHttpsEndpoint,
  pinnedHttpsFetch,
  readResponseBodyLimited,
  resolveSafeHttpsEndpoint,
  type HostResolver,
} from "./network";
import { createWebhookNonce, signWebhook } from "./hmac";
import type {
  AdapterValidationResult,
  AgentDiscoveryInput,
  AgentProviderAdapter,
  AgentTaskReference,
  AgentTaskResult,
  AgentTaskStatus,
  CreateAgentTaskInput,
  DiscoveredAgent,
} from "./types";

const webhookResponseSchema = z.object({
  providerTaskId: z.string().min(1).max(200),
  acceptedAt: z.string().datetime({ offset: true }),
});

const webhookStatusSchema = z.object({
  providerTaskId: z.string(),
  status: z.enum(["queued", "accepted", "running", "submitted", "failed", "cancelled"]),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().max(5_000).optional(),
  updatedAt: z.string().datetime({ offset: true }),
});

const webhookResultSchema = z.object({
  providerTaskId: z.string(),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  summary: z.string().max(20_000),
  evidenceArtifactIds: z.array(z.string()).max(100),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const webhookAgentCandidateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  version: z.string().min(1).max(100),
  skills: z.array(z.string().min(1)).max(200),
  inputModes: z.array(z.string().min(1)).max(50),
  outputModes: z.array(z.string().min(1)).max(50),
  authentication: z.record(z.string(), z.unknown()),
});

export const webhookCallbackSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    jobRunId: z.string().uuid(),
    providerTaskId: z.string().min(1),
    status: z.enum(["accepted", "running", "submitted", "cancelled"]),
    progress: z.number().min(0).max(100).optional(),
    message: z.string().max(5_000).optional(),
  }),
  z.object({
    type: z.literal("result"),
    jobRunId: z.string().uuid(),
    providerTaskId: z.string().min(1),
    summary: z.string().max(20_000),
    evidenceArtifactIds: z.array(z.string().uuid()).max(100),
  }),
  z.object({
    type: z.literal("error"),
    jobRunId: z.string().uuid(),
    providerTaskId: z.string().min(1),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(10_000),
    retryable: z.boolean(),
  }),
]);

export type WebhookCallback = z.infer<typeof webhookCallbackSchema>;

export function parseWebhookCallback(rawBody: string | Uint8Array): WebhookCallback {
  const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  try {
    return webhookCallbackSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Error("Webhook callback body is invalid", { cause: error });
  }
}

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export class SignedWebhookClient {
  constructor(
    private readonly options: {
      fetch?: FetchLike;
      resolveHostname?: HostResolver;
      sleep?: Sleep;
      now?: () => Date;
      nonce?: () => string;
      maxAttempts?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  async send<T>(request: {
    endpointUrl: string;
    secret: string;
    event: string;
    body: unknown;
    deliveryId?: string;
    signal?: AbortSignal;
  }): Promise<T> {
    let endpoint = await resolveSafeHttpsEndpoint(request.endpointUrl, this.options.resolveHostname);
    const sleep = this.options.sleep ?? abortableSleep;
    const deliveryId = request.deliveryId ?? randomUUID();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(deliveryId)) {
      throw new Error("Webhook delivery ID is invalid");
    }
    const rawBody = JSON.stringify(request.body);
    if (Buffer.byteLength(rawBody, "utf8") > 1024 * 1024) {
      throw new Error("Webhook request body is too large");
    }
    const maxAttempts = this.options.maxAttempts ?? 3;
    const timeoutMs = this.options.timeoutMs ?? 10_000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      endpoint = await resolveSafeHttpsEndpoint(endpoint.url.href, this.options.resolveHostname);
      const timestamp = Math.floor((this.options.now?.() ?? new Date()).getTime() / 1_000).toString();
      const nonce = (this.options.nonce ?? createWebhookNonce)();
      const signature = signWebhook(request.secret, {
        timestamp,
        nonce,
        deliveryId,
        event: request.event,
        rawBody,
      });
      const timeout = new AbortController();
      const timeoutHandle = setTimeout(() => timeout.abort(new Error("Webhook request timed out")), timeoutMs);
      const signal = combineAbortSignals(request.signal, timeout.signal);

      try {
        const headers = {
          "content-type": "application/json",
          "user-agent": "DoneLayer-Webhook/1.0",
          "x-donelayer-delivery": deliveryId,
          "x-donelayer-event": request.event,
          "x-donelayer-nonce": nonce,
          "x-donelayer-signature": signature,
          "x-donelayer-timestamp": timestamp,
        };
        const response = this.options.fetch
          ? await this.options.fetch(endpoint.url, {
              method: "POST",
              redirect: "error",
              ...(signal ? { signal } : {}),
              headers,
              body: rawBody,
            })
          : await pinnedHttpsFetch(
              endpoint,
              { method: "POST", headers, body: rawBody, ...(signal ? { signal } : {}) },
              1024 * 1024,
            );
        if (response.ok) {
          if (response.status === 204) return undefined as T;
          const responseBody = await readResponseBodyLimited(response, 1024 * 1024);
          try {
            return JSON.parse(responseBody) as T;
          } catch {
            throw new Error("Webhook returned invalid JSON");
          }
        }
        const responseError = new Error(`Webhook returned HTTP ${response.status}`);
        if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
          throw responseError;
        }
        lastError = responseError;
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        await sleep(retryAfter ?? retryDelay(attempt), request.signal);
      } catch (error) {
        if (request.signal?.aborted) throw request.signal.reason ?? error;
        const timedOut = timeout.signal.aborted;
        if (attempt === maxAttempts || (!timedOut && !isRetryableError(error))) throw error;
        lastError = error;
        await sleep(retryDelay(attempt), request.signal);
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Webhook delivery failed");
  }
}

export class WebhookAgentAdapter implements AgentProviderAdapter {
  readonly kind = "webhook" as const;

  constructor(
    private readonly configuration: {
      endpointUrl: string;
      secret: string;
      agent: Omit<DiscoveredAgent, "endpointType" | "endpointUrl">;
    },
    private readonly client = new SignedWebhookClient(),
  ) {}

  async discover(_input: AgentDiscoveryInput): Promise<DiscoveredAgent> {
    return {
      ...this.configuration.agent,
      endpointType: "webhook",
      endpointUrl: this.configuration.endpointUrl,
    };
  }

  async validate(candidate: unknown): Promise<AdapterValidationResult> {
    const parsed = webhookAgentCandidateSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    try {
      await assertSafeHttpsEndpoint(this.configuration.endpointUrl);
      return {
        valid: true,
        normalized: {
          ...parsed.data,
          endpointType: "webhook",
          endpointUrl: this.configuration.endpointUrl,
        },
      };
    } catch (error) {
      return { valid: false, errors: [error instanceof Error ? error.message : "Invalid webhook endpoint"] };
    }
  }

  async createTask(input: CreateAgentTaskInput): Promise<AgentTaskReference> {
    const response = await this.client.send<unknown>({
      endpointUrl: this.configuration.endpointUrl,
      secret: this.configuration.secret,
      event: "agent.task.created",
      deliveryId: normalizeWebhookDeliveryId(input.idempotencyKey),
      body: { schemaVersion: "1.0", task: input },
    });
    return webhookResponseSchema.parse(response);
  }

  async getTaskStatus(reference: AgentTaskReference): Promise<AgentTaskStatus> {
    const response = await this.client.send<unknown>({
      endpointUrl: this.configuration.endpointUrl,
      secret: this.configuration.secret,
      event: "agent.task.status.requested",
      body: { schemaVersion: "1.0", providerTaskId: reference.providerTaskId },
    });
    return webhookStatusSchema.parse(response);
  }

  async cancelTask(reference: AgentTaskReference): Promise<void> {
    await this.client.send<void>({
      endpointUrl: this.configuration.endpointUrl,
      secret: this.configuration.secret,
      event: "agent.task.cancelled",
      body: { schemaVersion: "1.0", providerTaskId: reference.providerTaskId },
    });
  }

  async fetchResult(reference: AgentTaskReference): Promise<AgentTaskResult> {
    const response = await this.client.send<unknown>({
      endpointUrl: this.configuration.endpointUrl,
      secret: this.configuration.secret,
      event: "agent.task.result.requested",
      body: { schemaVersion: "1.0", providerTaskId: reference.providerTaskId },
    });
    return webhookResultSchema.parse(response);
  }
}

export function normalizeWebhookDeliveryId(value: string): string {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : `dlv_${sha256(value)}`;
}

function retryDelay(attempt: number): number {
  return Math.min(4_000, 500 * 2 ** (attempt - 1));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1_000);
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /timed out|network|fetch/i.test(error.message));
}

function combineAbortSignals(left?: AbortSignal, right?: AbortSignal): AbortSignal | undefined {
  const signals = [left, right].filter((value): value is AbortSignal => Boolean(value));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

async function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Operation cancelled"));
      },
      { once: true },
    );
  });
}
