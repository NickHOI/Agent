import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { WorkerApiClient } from "../../apps/worker/src/client.js";

describe("Worker outbound API client", () => {
  it("allows HTTP only for local development", () => {
    expect(() => new WorkerApiClient("http://localhost:3000")).not.toThrow();
    expect(() => new WorkerApiClient("http://platform.example.com")).toThrow(/must use HTTPS/);
    expect(() => new WorkerApiClient("https://platform.example.com")).not.toThrow();
  });

  it("authenticates outbound claims without putting the token in the URL", async () => {
    const workerId = randomUUID();
    const token = "worker-token-that-is-at-least-thirty-two-characters";
    let capturedUrl = "";
    let capturedHeaders = new Headers();
    const client = new WorkerApiClient(
      "https://platform.example.com",
      { workerId, workerToken: token },
      async (input, init) => {
        capturedUrl = input.toString();
        capturedHeaders = new Headers(init?.headers);
        return new Response(null, { status: 204 });
      },
    );

    await expect(client.claim()).resolves.toBeNull();
    expect(capturedUrl).toBe("https://platform.example.com/api/worker/jobs/claim");
    expect(capturedUrl).not.toContain(token);
    expect(capturedHeaders.get("authorization")).toBe(`Bearer ${token}`);
    expect(capturedHeaders.get("x-donelayer-worker-id")).toBe(workerId);
  });

  it("does not send authorization while exchanging a pairing code", async () => {
    const workerId = randomUUID();
    let capturedHeaders = new Headers();
    const client = new WorkerApiClient("https://platform.example.com", undefined, async (_input, init) => {
      capturedHeaders = new Headers(init?.headers);
      return Response.json({
        workerId,
        workerToken: "new-worker-token-that-is-at-least-thirty-two-characters",
        pairedAt: "2026-07-31T12:00:00.000Z",
      });
    });
    await client.pair({
      protocolVersion: "1.0",
      pairingCode: "ABCD-EFGH-IJKL",
      name: "Test Worker",
      capabilities: {
        os: "linux",
        architecture: "x64",
        cpuCount: 4,
        nodeVersion: "v24.15.0",
        npmVersion: "11.0.0",
        workerVersion: "0.1.0",
        processId: 1234,
        memoryBytes: 8_000_000_000,
        availableMemoryBytes: 4_000_000_000,
        freeDiskBytes: 20_000_000_000,
        dockerAvailable: false,
        codexAvailable: false,
        gitAvailable: true,
        githubCliAvailable: false,
        supportedLanguages: ["JavaScript/TypeScript"],
        installedTools: ["git"],
        mcpServers: [],
        executors: ["demo"],
        maxConcurrentJobs: 1,
      },
    });
    expect(capturedHeaders.has("authorization")).toBe(false);
  });

  it("uploads to a relative same-origin URL with Worker and lease authentication", async () => {
    const workerId = randomUUID();
    const artifactId = randomUUID();
    const workerToken = "worker-token-that-is-at-least-thirty-two-characters";
    const leaseToken = "lease-token-that-is-at-least-thirty-two-characters";
    const bytes = new TextEncoder().encode("{}");
    const digest = createHash("sha256").update(bytes).digest("hex");
    let uploadUrl = "";
    let uploadHeaders = new Headers();
    let uploadBody: BodyInit | null | undefined;
    const client = new WorkerApiClient(
      "https://platform.example.com",
      { workerId, workerToken },
      async (input, init) => {
        const url = input.toString();
        if (url.endsWith("/artifacts/init")) {
          return Response.json({
            artifactId,
            uploadUrl: `/api/worker/uploads/${artifactId}`,
            uploadHeaders: {
              authorization: "Bearer server-value-must-not-win",
              "content-type": "application/octet-stream",
              "x-donelayer-upload-token": "scoped-upload-token",
            },
          });
        }
        if (init?.method === "PUT") {
          uploadUrl = url;
          uploadHeaders = new Headers(init.headers);
          uploadBody = init.body;
          return new Response(null, { status: 204 });
        }
        return Response.json({
          artifactId,
          artifactType: "TEST_RESULT",
          fileName: "test-results.json",
          mimeType: "application/json",
          size: bytes.byteLength,
          sha256: digest,
        });
      },
    );

    await expect(
      client.uploadArtifact(
        randomUUID(),
        leaseToken,
        {
          artifactType: "TEST_RESULT",
          fileName: "test-results.json",
          mimeType: "application/json",
          bytes,
        },
      ),
    ).resolves.toMatchObject({ artifactId, sha256: digest });
    expect(uploadUrl).toBe(`https://platform.example.com/api/worker/uploads/${artifactId}`);
    expect(uploadHeaders.get("authorization")).toBe(`Bearer ${workerToken}`);
    expect(uploadHeaders.get("content-type")).toBe("application/json");
    expect(uploadHeaders.get("x-donelayer-lease-token")).toBe(leaseToken);
    expect(uploadHeaders.get("x-donelayer-upload-token")).toBe("scoped-upload-token");
    expect(uploadHeaders.get("x-donelayer-worker-id")).toBe(workerId);
    expect(Buffer.from(uploadBody as Uint8Array)).toEqual(Buffer.from(bytes));
  });

  it("rejects artifact uploads to a different port on the API host", async () => {
    const workerId = randomUUID();
    const artifactId = randomUUID();
    const client = new WorkerApiClient(
      "https://platform.example.com",
      { workerId, workerToken: "worker-token-that-is-at-least-thirty-two-characters" },
      async () =>
        Response.json({
          artifactId,
          uploadUrl: `https://platform.example.com:444/api/worker/uploads/${artifactId}`,
          uploadHeaders: {},
        }),
    );
    await expect(
      client.uploadArtifact(
        randomUUID(),
        "lease-token-that-is-at-least-thirty-two-characters",
        {
          artifactType: "TEST_RESULT",
          fileName: "test-results.json",
          mimeType: "application/json",
          bytes: new TextEncoder().encode("{}"),
        },
      ),
    ).rejects.toThrow(/origin is not allowlisted/);
  });

  it("rejects a same-origin URL outside the scoped upload path", async () => {
    const workerId = randomUUID();
    const artifactId = randomUUID();
    const client = new WorkerApiClient(
      "https://platform.example.com",
      { workerId, workerToken: "worker-token-that-is-at-least-thirty-two-characters" },
      async () =>
        Response.json({
          artifactId,
          uploadUrl: `https://platform.example.com/api/worker/not-uploads/${artifactId}`,
          uploadHeaders: {},
        }),
    );
    await expect(
      client.uploadArtifact(
        randomUUID(),
        "lease-token-that-is-at-least-thirty-two-characters",
        {
          artifactType: "TEST_RESULT",
          fileName: "test-results.json",
          mimeType: "application/json",
          bytes: new TextEncoder().encode("{}"),
        },
      ),
    ).rejects.toThrow(/path is invalid/);
  });

  it("applies a deadline even when the caller does not provide a signal", async () => {
    const client = new WorkerApiClient(
      "https://platform.example.com",
      {
        workerId: randomUUID(),
        workerToken: "worker-token-that-is-at-least-thirty-two-characters",
      },
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new Error("aborted")),
            { once: true },
          );
        }),
      { requestTimeoutMs: 5 },
    );
    await expect(client.claim()).rejects.toBeDefined();
  });
});
