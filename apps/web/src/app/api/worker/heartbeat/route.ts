import { workerHeartbeatSchema } from "@donelayer/worker-protocol";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { authenticateWorkerRequest } from "@/server/worker-auth";

export async function POST(request: Request) {
  const rateError = enforceRateLimit(request, "worker-heartbeat", 120);
  if (rateError) return rateError;
  const worker = authenticateWorkerRequest(request);
  if (!worker) return noStoreJson({ error: "Worker authentication failed." }, { status: 401 });
  const parsed = workerHeartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Heartbeat payload is invalid." }, { status: 400 });
  const capabilities = parsed.data.capabilities;
  getDemoStore().heartbeat(worker.id, parsed.data.status, {
    os: capabilities.os === "macos" ? "MACOS" : capabilities.os === "linux" ? "LINUX" : capabilities.os === "windows" ? "WINDOWS" : worker.os,
    installedTools: capabilities.installedTools,
    mcpTools: capabilities.mcpServers.filter((server) => server.installed).flatMap((server) => server.tools.map((tool) => `${server.name}:${tool}`)),
    executors: capabilities.executors.map((executor) => executor === "codex-cli" ? "CODEX" : "DEMO"),
    maxConcurrentJobs: capabilities.maxConcurrentJobs,
    activeJobs: parsed.data.activeJobRunIds.length
  });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
