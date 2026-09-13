import { randomUUID } from "node:crypto";

import {
  WORKER_PROTOCOL_VERSION,
  jobControlResponseSchema,
  jobEnvelopeSchema,
  pairWorkerResponseSchema,
  redactSecrets,
  sha256,
  type ExecutionResult,
  type JobControlResponse,
  type JobEnvelope,
  type JobRunEvent,
  type PairWorkerRequest,
  type PairWorkerResponse,
  type ProducedArtifact,
  type SubmitJobRunRequest,
  type UploadedArtifact,
  type WorkerHeartbeat,
} from "@donelayer/worker-protocol";
import { z } from "zod";

const artifactInitResponseSchema = z.object({
  artifactId: z.string().uuid(),
  uploadUrl: z.string().min(1).max(2_048),
  uploadHeaders: z.record(z.string(), z.string()).default({}),
});

const artifactFinalizeResponseSchema = z.object({
  artifactId: z.string().uuid(),
  artifactType: z.enum([
    "GIT_DIFF",
    "BUILD_LOG",
    "TEST_LOG",
    "TEST_RESULT",
    "SCREENSHOT",
    "EXECUTOR_RESULT",
    "OTHER",
  ]),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export class WorkerApiClient {
  private readonly apiUrl: URL;

  constructor(
    apiUrl: string,
    private readonly identity?: { workerId: string; workerToken: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: {
      requestTimeoutMs?: number;
      artifactUploadTimeoutMs?: number;
      allowedArtifactUploadOrigins?: string[];
    } = {},
  ) {
    this.apiUrl = new URL(apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
    const apiHostname = this.apiUrl.hostname.replace(/^\[|\]$/g, "");
    const local = ["localhost", "127.0.0.1", "::1"].includes(apiHostname);
    if (this.apiUrl.protocol !== "https:" && !(local && this.apiUrl.protocol === "http:")) {
      throw new Error("Worker API must use HTTPS; HTTP is allowed only for local development");
    }
  }

  async pair(request: PairWorkerRequest, signal?: AbortSignal): Promise<PairWorkerResponse> {
    const response = await this.request("api/worker/pair", {
      method: "POST",
      body: request,
      ...(signal ? { signal } : {}),
      authenticated: false,
    });
    return pairWorkerResponseSchema.parse(response);
  }

  async heartbeat(heartbeat: WorkerHeartbeat, signal?: AbortSignal): Promise<void> {
    await this.request("api/worker/heartbeat", {
      method: "POST",
      body: heartbeat,
      signal,
    });
  }

  async claim(signal?: AbortSignal): Promise<JobEnvelope | null> {
    const response = await this.request("api/worker/jobs/claim", {
      method: "POST",
      body: { protocolVersion: WORKER_PROTOCOL_VERSION, availableSlots: 1 },
      signal,
      allowNoContent: true,
    });
    return response === null ? null : jobEnvelopeSchema.parse(response);
  }

  async renewLease(jobRunId: string, leaseToken: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request(`api/worker/job-runs/${encodeURIComponent(jobRunId)}/lease/renew`, {
      method: "POST",
      body: { protocolVersion: WORKER_PROTOCOL_VERSION, leaseToken },
      signal,
    });
    return z.object({ leaseExpiresAt: z.string().datetime({ offset: true }) }).parse(response).leaseExpiresAt;
  }

  async sendEvent(event: JobRunEvent, leaseToken: string, signal?: AbortSignal): Promise<void> {
    await this.request(`api/worker/job-runs/${encodeURIComponent(event.jobRunId)}/events`, {
      method: "POST",
      body: { ...event, leaseToken },
      signal,
    });
  }

  async getControl(jobRunId: string, leaseToken: string, signal?: AbortSignal): Promise<JobControlResponse> {
    const response = await this.request(
      `api/worker/job-runs/${encodeURIComponent(jobRunId)}/control`,
      {
        method: "POST",
        body: { protocolVersion: WORKER_PROTOCOL_VERSION, leaseToken },
        signal,
      },
    );
    return jobControlResponseSchema.parse(response);
  }

  async uploadArtifact(
    jobRunId: string,
    leaseToken: string,
    artifact: ProducedArtifact,
    signal?: AbortSignal,
  ): Promise<UploadedArtifact> {
    if (!this.identity) throw new Error("Worker is not paired");
    const digest = sha256(artifact.bytes);
    const initialized = artifactInitResponseSchema.parse(
      await this.request(`api/worker/job-runs/${encodeURIComponent(jobRunId)}/artifacts/init`, {
        method: "POST",
        body: {
          protocolVersion: WORKER_PROTOCOL_VERSION,
          leaseToken,
          artifactType: artifact.artifactType,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.bytes.byteLength,
          sha256: digest,
        },
        signal,
      }),
    );

    const uploadUrl = this.validateArtifactUploadUrl(initialized.uploadUrl, initialized.artifactId);
    const uploadTimeout = AbortSignal.timeout(this.options.artifactUploadTimeoutMs ?? 60_000);
    const uploadSignal = signal ? AbortSignal.any([signal, uploadTimeout]) : uploadTimeout;
    const uploadHeaders = new Headers(initialized.uploadHeaders);
    uploadHeaders.set("authorization", `Bearer ${this.identity.workerToken}`);
    uploadHeaders.set("content-type", artifact.mimeType);
    uploadHeaders.set("x-donelayer-lease-token", leaseToken);
    uploadHeaders.set("x-donelayer-worker-id", this.identity.workerId);
    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      body: Buffer.from(artifact.bytes),
      headers: uploadHeaders,
      redirect: "error",
      signal: uploadSignal,
    });
    if (!uploadResponse.ok) {
      throw new Error(`Artifact upload returned HTTP ${uploadResponse.status}`);
    }

    const finalized = await this.request(
      `api/worker/job-runs/${encodeURIComponent(jobRunId)}/artifacts/${encodeURIComponent(initialized.artifactId)}/finalize`,
      {
        method: "POST",
        body: { protocolVersion: WORKER_PROTOCOL_VERSION, leaseToken, sha256: digest },
        signal,
      },
    );
    const record = artifactFinalizeResponseSchema.parse(finalized);
    if (
      record.artifactId !== initialized.artifactId ||
      record.artifactType !== artifact.artifactType ||
      record.fileName !== artifact.fileName ||
      record.mimeType !== artifact.mimeType ||
      record.size !== artifact.bytes.byteLength ||
      record.sha256 !== digest
    ) {
      throw new Error("Platform returned inconsistent artifact metadata");
    }
    return record;
  }

  async submit(
    jobRunId: string,
    leaseToken: string,
    result: Omit<ExecutionResult, "artifacts">,
    artifacts: UploadedArtifact[],
    signal?: AbortSignal,
  ): Promise<void> {
    const body: SubmitJobRunRequest = {
      protocolVersion: WORKER_PROTOCOL_VERSION,
      leaseToken,
      result,
      artifacts,
    };
    await this.request(`api/worker/job-runs/${encodeURIComponent(jobRunId)}/submit`, {
      method: "POST",
      body,
      signal,
    });
  }

  async revoke(signal?: AbortSignal): Promise<void> {
    await this.request("api/worker/logout", { method: "POST", body: {}, signal });
  }

  private async request(
    pathname: string,
    options: {
      method: "GET" | "POST";
      body?: unknown;
      signal?: AbortSignal | undefined;
      authenticated?: boolean;
      allowNoContent?: boolean;
    },
  ): Promise<unknown> {
    const authenticated = options.authenticated ?? true;
    if (authenticated && !this.identity) {
      throw new Error("Worker is not paired");
    }
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "x-donelayer-request-id": randomUUID(),
      "x-donelayer-protocol": WORKER_PROTOCOL_VERSION,
    };
    if (authenticated && this.identity) {
      headers.authorization = `Bearer ${this.identity.workerToken}`;
      headers["x-donelayer-worker-id"] = this.identity.workerId;
    }
    const timeoutSignal = AbortSignal.timeout(this.options.requestTimeoutMs ?? 30_000);
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const response = await this.fetchImpl(new URL(pathname, this.apiUrl), {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: "error",
      signal: requestSignal,
    });
    if (options.allowNoContent && response.status === 204) return null;
    if (!response.ok) {
      const detail = redactSecrets(await readResponseTextLimited(response, 2_000));
      throw new Error(`DoneLayer API returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    if (response.status === 204) return null;
    const responseText = await readResponseTextLimited(response, 2 * 1024 * 1024);
    if (!responseText.trim()) return null;
    try {
      return JSON.parse(responseText);
    } catch {
      throw new Error("DoneLayer API returned invalid JSON");
    }
  }

  private validateArtifactUploadUrl(value: string, artifactId: string): URL {
    const url = new URL(value, this.apiUrl);
    if (url.username || url.password) {
      throw new Error("Artifact upload URL must not contain credentials");
    }
    const uploadHostname = url.hostname.replace(/^\[|\]$/g, "");
    const local = ["localhost", "127.0.0.1", "::1"].includes(uploadHostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
      throw new Error("Artifact upload URL must use HTTPS");
    }
    const configuredOrigins = [
      ...(this.options.allowedArtifactUploadOrigins ?? []),
      ...(process.env.DONELAYER_ARTIFACT_UPLOAD_ORIGINS ?? "").split(","),
    ]
      .map((origin) => origin.trim())
      .filter(Boolean);
    const allowedOrigins = new Set([this.apiUrl.origin]);
    for (const configuredOrigin of configuredOrigins) {
      const allowed = new URL(configuredOrigin);
      if (
        allowed.username ||
        allowed.password ||
        allowed.pathname !== "/" ||
        allowed.search ||
        allowed.hash
      ) {
        throw new Error("Artifact upload allowlist entries must be origins");
      }
      const allowedHostname = allowed.hostname.replace(/^\[|\]$/g, "");
      const allowedLocal = ["localhost", "127.0.0.1", "::1"].includes(allowedHostname);
      if (allowed.protocol !== "https:" && !(allowedLocal && allowed.protocol === "http:")) {
        throw new Error("Artifact upload origins must use HTTPS");
      }
      allowedOrigins.add(allowed.origin);
    }
    if (!allowedOrigins.has(url.origin)) {
      throw new Error("Artifact upload origin is not allowlisted");
    }
    const expectedPath = `/api/worker/uploads/${encodeURIComponent(artifactId)}`;
    if (url.pathname !== expectedPath || url.search || url.hash) {
      throw new Error("Artifact upload URL path is invalid");
    }
    return url;
  }
}

async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (remaining <= 0) break;
      chunks.push(value.subarray(0, remaining));
      total += Math.min(value.byteLength, remaining);
      if (value.byteLength > remaining) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}
