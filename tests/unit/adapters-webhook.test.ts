import { describe, expect, it } from "vitest";

import {
  A2AAdapter,
  DemoAgentAdapter,
  MemoryReplayStore,
  MemoryWebhookDeliveryStore,
  SignedWebhookClient,
  canonicalWebhookPayload,
  importA2AAgentCard,
  isPrivateOrReservedAddress,
  resolveSafeHttpsEndpoint,
  signWebhook,
  tryImportA2AAgentCard,
  verifyWebhookSignature,
  verifySignedWebhookRequest,
} from "@donelayer/agent-adapters";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("Webhook adapters", () => {
  it("signs exact raw bytes and rejects replay or tampering", async () => {
    const input = {
      timestamp: "1785499200",
      nonce: "nonce_0123456789abcdef",
      deliveryId: "delivery_0123456789",
      event: "agent.task.created",
      rawBody: '{"task":"demo"}',
    };
    const signature = signWebhook(SECRET, input);
    const store = new MemoryReplayStore(() => new Date("2026-07-31T12:00:00.000Z"));

    expect(canonicalWebhookPayload(input).toString("utf8")).toContain(input.rawBody);
    await expect(
      verifyWebhookSignature({
        secret: SECRET,
        input,
        signature,
        replayStore: store,
        replayScope: "endpoint-one",
        now: new Date("2026-07-31T12:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyWebhookSignature({
        secret: SECRET,
        input,
        signature,
        replayStore: store,
        replayScope: "endpoint-one",
        now: new Date("2026-07-31T12:00:00.000Z"),
      }),
    ).rejects.toThrow(/already been used/);
    await expect(
      verifyWebhookSignature({
        secret: SECRET,
        input: { ...input, rawBody: '{"task":"tampered"}', nonce: "nonce_fedcba9876543210" },
        signature,
        replayStore: new MemoryReplayStore(),
        replayScope: "endpoint-one",
        now: new Date("2026-07-31T12:00:00.000Z"),
      }),
    ).rejects.toThrow(/signature is invalid/);
    await expect(
      verifyWebhookSignature({
        secret: SECRET,
        input: { ...input, event: "agent.task.cancelled", nonce: "nonce_eventtamper12345" },
        signature,
        replayStore: new MemoryReplayStore(),
        replayScope: "endpoint-one",
        now: new Date("2026-07-31T12:00:00.000Z"),
      }),
    ).rejects.toThrow(/signature is invalid/);
  });

  it("rejects stale timestamps", async () => {
    const input = {
      timestamp: "1785490000",
      nonce: "nonce_0123456789abcdef",
      deliveryId: "delivery_0123456789",
      event: "agent.task.created",
      rawBody: "{}",
    };
    await expect(
      verifyWebhookSignature({
        secret: SECRET,
        input,
        signature: signWebhook(SECRET, input),
        replayStore: new MemoryReplayStore(),
        replayScope: "endpoint-one",
        now: new Date("2026-07-31T12:00:00.000Z"),
      }),
    ).rejects.toThrow(/clock skew/);
  });

  it("treats a retried delivery with a fresh nonce as idempotent", async () => {
    const rawBody = '{"type":"status"}';
    const timestamp = "1785499200";
    const deliveryId = "delivery_0123456789";
    const replayStore = new MemoryReplayStore(() => new Date("2026-07-31T12:00:00.000Z"));
    const deliveryStore = new MemoryWebhookDeliveryStore(() => new Date("2026-07-31T12:00:00.000Z"));
    const headersFor = (nonce: string) => ({
      "x-donelayer-timestamp": timestamp,
      "x-donelayer-nonce": nonce,
      "x-donelayer-delivery": deliveryId,
      "x-donelayer-event": "agent.task.status",
      "x-donelayer-signature": signWebhook(SECRET, {
        timestamp,
        nonce,
        deliveryId,
        event: "agent.task.status",
        rawBody,
      }),
    });

    const first = await verifySignedWebhookRequest({
      secret: SECRET,
      rawBody,
      headers: headersFor("nonce_0123456789abcdef"),
      replayStore,
      deliveryStore,
      replayScope: "endpoint-one",
      now: new Date("2026-07-31T12:00:00.000Z"),
    });
    const retry = await verifySignedWebhookRequest({
      secret: SECRET,
      rawBody,
      headers: headersFor("nonce_fedcba9876543210"),
      replayStore,
      deliveryStore,
      replayScope: "endpoint-one",
      now: new Date("2026-07-31T12:00:00.000Z"),
    });
    expect(first.duplicateDelivery).toBe(false);
    expect(retry.duplicateDelivery).toBe(true);
  });

  it("retries transient responses with a stable delivery and fresh nonces", async () => {
    const requests: RequestInit[] = [];
    let attempt = 0;
    const client = new SignedWebhookClient({
      resolveHostname: async () => ["8.8.8.8"],
      sleep: async () => undefined,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
      nonce: () => `nonce_0123456789abcd${attempt}`,
      fetch: async (_url, init) => {
        requests.push(init ?? {});
        attempt += 1;
        return attempt === 1
          ? new Response("retry", { status: 500 })
          : Response.json({ ok: true });
      },
    });
    await expect(
      client.send<{ ok: boolean }>({
        endpointUrl: "https://agent.example.com/tasks",
        secret: SECRET,
        event: "agent.task.created",
        deliveryId: "delivery_0123456789",
        body: { taskId: "task-one" },
      }),
    ).resolves.toEqual({ ok: true });

    expect(requests).toHaveLength(2);
    const firstHeaders = new Headers(requests[0]?.headers);
    const secondHeaders = new Headers(requests[1]?.headers);
    expect(firstHeaders.get("x-donelayer-delivery")).toBe(secondHeaders.get("x-donelayer-delivery"));
    expect(firstHeaders.get("x-donelayer-nonce")).not.toBe(secondHeaders.get("x-donelayer-nonce"));
  });

  it("rejects private and IPv4-mapped IPv6 endpoints before dispatch", async () => {
    expect(isPrivateOrReservedAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateOrReservedAddress("::ffff:a00:1")).toBe(true);
    expect(isPrivateOrReservedAddress("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isPrivateOrReservedAddress("2606:4700:4700::1111")).toBe(false);
    await expect(
      resolveSafeHttpsEndpoint("https://agent.example.com", async () => ["10.0.0.8"]),
    ).rejects.toThrow(/private or reserved/);
  });

  it("imports and normalizes a valid A2A Agent Card without enabling execution", async () => {
    const card = {
      name: "Repository QA Agent",
      description: "Verifies repositories",
      url: "https://agent.example.com/a2a",
      version: "1.0.0",
      capabilities: {},
      skills: [{ id: "repo-qa", name: "Repository QA", description: "", tags: ["testing"] }],
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
      securitySchemes: { hmac: { type: "apiKey" } },
    };
    const agent = await importA2AAgentCard("https://agent.example.com/.well-known/agent-card.json", {
      resolveHostname: async () => ["8.8.8.8"],
      fetch: async () => Response.json(card),
    });
    expect(agent.name).toBe("Repository QA Agent");
    expect(agent.skills).toEqual(expect.arrayContaining(["repo-qa", "testing"]));

    const adapter = new A2AAdapter();
    await expect(
      adapter.createTask({
        taskId: "task",
        jobRunId: "run",
        title: "Test",
        scopeSummary: "Test",
        desiredOutcome: "Pass",
        acceptanceCriteria: [],
        permissions: { modifyCode: false, createPullRequest: false },
        idempotencyKey: "key",
      }),
    ).rejects.toThrow(/not enabled in the MVP/);
  });

  it("returns a clear result instead of throwing for a malformed Agent Card", async () => {
    const result = await tryImportA2AAgentCard("https://agent.example.com/card.json", {
      resolveHostname: async () => ["8.8.8.8"],
      fetch: async () => new Response("not-json", { status: 200 }),
    });
    expect(result).toEqual({ ok: false, error: "Agent Card is not valid JSON" });
  });

  it("runs the DemoAgentAdapter lifecycle without external services", async () => {
    const adapter = new DemoAgentAdapter();
    const input = {
      taskId: "task",
      jobRunId: "run",
      title: "Fix tests",
      scopeSummary: "Fix a scoped test",
      desiredOutcome: "Tests pass",
      acceptanceCriteria: [],
      permissions: { modifyCode: true, createPullRequest: false },
      idempotencyKey: "demo-key",
    };
    const reference = await adapter.createTask(input);
    expect(await adapter.createTask(input)).toEqual(reference);
    expect((await adapter.getTaskStatus(reference)).status).toBe("running");
    expect((await adapter.getTaskStatus(reference)).status).toBe("submitted");
    expect((await adapter.fetchResult(reference)).status).toBe("succeeded");
  });
});
