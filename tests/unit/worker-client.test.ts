import { randomUUID } from "node:crypto";

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
        memoryBytes: 8_000_000_000,
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

  it("rejects artifact uploads to a host outside the configured allowlist", async () => {
    const workerId = randomUUID();
    const client = new WorkerApiClient(
      "https://platform.example.com",
      { workerId, workerToken: "worker-token-that-is-at-least-thirty-two-characters" },
      async () =>
        Response.json({
          artifactId: randomUUID(),
          uploadUrl: "https://untrusted-upload.example.net/object",
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
    ).rejects.toThrow(/not allowlisted/);
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
