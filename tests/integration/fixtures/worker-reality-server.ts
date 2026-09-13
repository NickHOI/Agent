import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { DemoStore, type TaskAggregate, type TaskRecord } from "@donelayer/database";

import * as heartbeatRoute from "../../../apps/web/src/app/api/worker/heartbeat/route.js";
import * as claimRoute from "../../../apps/web/src/app/api/worker/jobs/claim/route.js";
import * as logoutRoute from "../../../apps/web/src/app/api/worker/logout/route.js";
import * as pairRoute from "../../../apps/web/src/app/api/worker/pair/route.js";
import * as artifactFinalizeRoute from "../../../apps/web/src/app/api/worker/job-runs/[jobRunId]/artifacts/[artifactId]/finalize/route.js";
import * as artifactInitRoute from "../../../apps/web/src/app/api/worker/job-runs/[jobRunId]/artifacts/init/route.js";
import * as controlRoute from "../../../apps/web/src/app/api/worker/job-runs/[jobRunId]/control/route.js";
import * as eventsRoute from "../../../apps/web/src/app/api/worker/job-runs/[jobRunId]/events/route.js";
import * as renewRoute from "../../../apps/web/src/app/api/worker/job-runs/[jobRunId]/lease/renew/route.js";
import * as submitRoute from "../../../apps/web/src/app/api/worker/job-runs/[jobRunId]/submit/route.js";
import * as uploadRoute from "../../../apps/web/src/app/api/worker/uploads/[artifactId]/route.js";

type RealityStore = DemoStore & {
  createWorkerSmokeTask(workerId: string): TaskRecord | TaskAggregate;
  createRepositoryMaterializationTask(workerId: string): TaskRecord | TaskAggregate;
};

type RouteContext = { params: Promise<Record<string, string>> };
type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>;

type RpcRequest = {
  kind: "rpc";
  requestId: string;
  operation:
    | "createPairingCode"
    | "createWorkerSmokeTask"
    | "createRepositoryMaterializationTask"
    | "getTaskAggregate"
    | "getJobCapabilityEvidence"
    | "getJobRunAttempt"
    | "getPermissionLeaseForJob"
    | "getJobReceiptByJobRun"
    | "getPublicJobReceipt"
    | "getLatestWorkerCapabilitySnapshot"
    | "getWorker"
    | "listWorkerHeartbeats"
    | "listJobRuns"
    | "shutdown";
  input?: Record<string, unknown>;
};

type RpcResponse = {
  kind: "rpc-result";
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

const hostname = "127.0.0.1";
const leaseDurationMs = Number(process.env.WORKER_REALITY_LEASE_TTL_MS ?? 5_000);
const store = new DemoStore(undefined, {
  leaseDurationMs,
  heartbeatTtlMs: Math.max(leaseDurationMs, 30_000),
}) as RealityStore;
(globalThis as typeof globalThis & { __doneLayerDemoStore?: DemoStore }).__doneLayerDemoStore = store;

const server = createServer((incoming, outgoing) => {
  handleHttpRequest(incoming, outgoing).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unhandled test server error";
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(JSON.stringify({ error: message }));
  });
});

process.on("message", (message: unknown) => {
  if (!isRpcRequest(message)) return;
  void handleRpc(message);
});

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

server.listen(0, hostname, () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Worker reality server did not receive a TCP port");
  }
  send({ kind: "ready", apiUrl: `http://${hostname}:${address.port}`, pid: process.pid });
});

async function handleHttpRequest(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  const method = incoming.method ?? "GET";
  const host = incoming.headers.host ?? hostname;
  const url = new URL(incoming.url ?? "/", `http://${host}`);

  if (method === "GET" && url.pathname === "/api/health") {
    await writeFetchResponse(outgoing, Response.json({ status: "ok" }));
    return;
  }

  const request = await toFetchRequest(incoming, url);
  const routed = route(method, url.pathname);
  if (!routed) {
    await writeFetchResponse(outgoing, Response.json({ error: "Not found" }, { status: 404 }));
    return;
  }

  const response = await routed.handler(request, { params: Promise.resolve(routed.params) });
  await writeFetchResponse(outgoing, response);
}

function route(
  method: string,
  pathname: string,
): { handler: RouteHandler; params: Record<string, string> } | null {
  if (method === "POST" && pathname === "/api/worker/pair") {
    return { handler: pairRoute.POST as RouteHandler, params: {} };
  }
  if (method === "POST" && pathname === "/api/worker/heartbeat") {
    return { handler: heartbeatRoute.POST as RouteHandler, params: {} };
  }
  if (method === "POST" && pathname === "/api/worker/jobs/claim") {
    return { handler: claimRoute.POST as RouteHandler, params: {} };
  }
  if (method === "POST" && pathname === "/api/worker/logout") {
    return { handler: logoutRoute.POST as RouteHandler, params: {} };
  }

  const jobRunMatch = /^\/api\/worker\/job-runs\/([^/]+)\/(.+)$/.exec(pathname);
  if (jobRunMatch?.[1] && jobRunMatch[2]) {
    const jobRunId = decodeURIComponent(jobRunMatch[1]);
    const suffix = jobRunMatch[2];
    if (method === "POST" && suffix === "lease/renew") {
      return { handler: renewRoute.POST as unknown as RouteHandler, params: { jobRunId } };
    }
    if (method === "POST" && suffix === "control") {
      return { handler: controlRoute.POST as unknown as RouteHandler, params: { jobRunId } };
    }
    if (method === "POST" && suffix === "events") {
      return { handler: eventsRoute.POST as unknown as RouteHandler, params: { jobRunId } };
    }
    if (method === "POST" && suffix === "artifacts/init") {
      return { handler: artifactInitRoute.POST as unknown as RouteHandler, params: { jobRunId } };
    }
    if (method === "POST" && suffix === "submit") {
      return { handler: submitRoute.POST as unknown as RouteHandler, params: { jobRunId } };
    }
    const finalizeMatch = /^artifacts\/([^/]+)\/finalize$/.exec(suffix);
    if (method === "POST" && finalizeMatch?.[1]) {
      return {
        handler: artifactFinalizeRoute.POST as unknown as RouteHandler,
        params: { jobRunId, artifactId: decodeURIComponent(finalizeMatch[1]) },
      };
    }
  }

  const uploadMatch = /^\/api\/worker\/uploads\/([^/]+)$/.exec(pathname);
  if (method === "PUT" && uploadMatch?.[1]) {
    return {
      handler: uploadRoute.PUT as RouteHandler,
      params: { artifactId: decodeURIComponent(uploadMatch[1]) },
    };
  }
  return null;
}

async function toFetchRequest(incoming: IncomingMessage, url: URL): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const init: RequestInit = { method: incoming.method ?? "GET", headers };
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    const bytes = await readIncomingBody(incoming, 12 * 1024 * 1024);
    init.body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }
  return new Request(url, init);
}

async function readIncomingBody(incoming: IncomingMessage, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.byteLength;
    if (size > limit) throw new Error("Test server request body exceeded its limit");
    chunks.push(bytes);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function writeFetchResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

async function handleRpc(request: RpcRequest): Promise<void> {
  try {
    const input = request.input ?? {};
    let value: unknown;
    switch (request.operation) {
      case "createPairingCode":
        value = store.createPairingCode(requiredString(input, "workerId"), requiredString(input, "providerId"));
        break;
      case "createWorkerSmokeTask":
        value = store.createWorkerSmokeTask(requiredString(input, "workerId"));
        break;
      case "createRepositoryMaterializationTask":
        value = store.createRepositoryMaterializationTask(requiredString(input, "workerId"));
        break;
      case "getTaskAggregate":
        value = store.getTaskAggregate(requiredString(input, "taskId"));
        break;
      case "getJobCapabilityEvidence":
        value = store.getJobCapabilityEvidence(requiredString(input, "jobRunId"));
        break;
      case "getJobRunAttempt":
        value = store.getJobRunAttempt(requiredString(input, "jobRunId"));
        break;
      case "getPermissionLeaseForJob":
        value = store.getPermissionLeaseForJob(requiredString(input, "jobRunId"));
        break;
      case "getJobReceiptByJobRun":
        value = store.getJobReceiptByJobRun(requiredString(input, "jobRunId"));
        break;
      case "getPublicJobReceipt":
        value = store.getPublicJobReceipt(requiredString(input, "receiptPublicId"));
        break;
      case "getLatestWorkerCapabilitySnapshot":
        value = store.getLatestWorkerCapabilitySnapshot(requiredString(input, "workerId"));
        break;
      case "getWorker":
        value = store.getWorker(requiredString(input, "workerId"));
        break;
      case "listWorkerHeartbeats":
        value = store.listWorkerHeartbeats(requiredString(input, "workerId"));
        break;
      case "listJobRuns":
        value = store.listJobRuns();
        break;
      case "shutdown":
        value = { stopped: true };
        break;
    }
    respond({ kind: "rpc-result", requestId: request.requestId, ok: true, value });
    if (request.operation === "shutdown") await shutdown();
  } catch (error) {
    respond({
      kind: "rpc-result",
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server fixture failure",
    });
  }
}

function requiredString(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || !value) throw new Error(`RPC field ${name} is required`);
  return value;
}

function isRpcRequest(value: unknown): value is RpcRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "rpc" &&
      "requestId" in value &&
      typeof value.requestId === "string" &&
      "operation" in value &&
      typeof value.operation === "string",
  );
}

function respond(response: RpcResponse): void {
  send(response);
}

function send(message: unknown): void {
  if (process.connected) process.send?.(message);
}

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  store.close();
  process.disconnect?.();
}
