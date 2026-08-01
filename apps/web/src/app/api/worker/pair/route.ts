import { pairWorkerRequestSchema } from "@donelayer/worker-protocol";
import { getDemoStore } from "@donelayer/database";
import { noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
  const rateError = enforceRateLimit(request, "worker-pair", 8, 60_000);
  if (rateError) return rateError;
  const parsed = pairWorkerRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Pairing request is invalid." }, { status: 400 });
  try {
    const store = getDemoStore();
    const paired = store.pairWorker(parsed.data.pairingCode);
    const capabilities = parsed.data.capabilities;
    const current = store.getWorker(paired.workerId);
    store.heartbeat(paired.workerId, "ONLINE", {
      name: parsed.data.name,
      os: capabilities.os === "macos" ? "MACOS" : capabilities.os === "linux" ? "LINUX" : capabilities.os === "windows" ? "WINDOWS" : current?.os ?? "WINDOWS",
      installedTools: capabilities.installedTools,
      mcpTools: capabilities.mcpServers.filter((server) => server.installed).flatMap((server) => server.tools.map((tool) => `${server.name}:${tool}`)),
      executors: capabilities.executors.map((executor) => executor === "codex-cli" ? "CODEX" : "DEMO"),
      maxConcurrentJobs: capabilities.maxConcurrentJobs
    });
    return noStoreJson({ workerId: paired.workerId, workerToken: paired.token, pairedAt: new Date().toISOString() }, { status: 201 });
  } catch {
    return noStoreJson({ error: "Pairing code is invalid or expired." }, { status: 400 });
  }
}
