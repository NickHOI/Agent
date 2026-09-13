import { randomUUID } from "node:crypto";

import { WORKER_PROTOCOL_VERSION, type JobEnvelope } from "@donelayer/worker-protocol";

import { WorkerApiClient } from "../../../apps/worker/src/client.js";
import { main as workerCliMain } from "../../../apps/worker/src/cli.js";
import { WorkerConfigStore } from "../../../apps/worker/src/config.js";
import { runDoctor } from "../../../apps/worker/src/doctor.js";

type ChildMode = "pair" | "pair-and-run" | "start" | "claim-and-exit" | "stale-attempt";

type StaleAttemptCommand = {
  kind: "stale-attempt";
  job: JobEnvelope;
};

async function run(): Promise<void> {
  const mode = requiredEnvironment("REALITY_CHILD_MODE") as ChildMode;
  const apiUrl = requiredEnvironment("REALITY_API_URL");
  const configDirectory = requiredEnvironment("REALITY_CONFIG_DIR");
  const workerName = process.env.REALITY_WORKER_NAME?.trim() || `Reality Worker ${process.pid}`;

  if (mode === "pair" || mode === "pair-and-run") {
    const pairingCode = requiredEnvironment("REALITY_PAIRING_CODE");
    const setupCode = await workerCliMain([
      "setup",
      "--api-url",
      apiUrl,
      "--code",
      pairingCode,
      "--name",
      workerName,
      "--config-dir",
      configDirectory,
      "--poll-ms",
      "500",
    ]);
    if (setupCode !== 0) throw new Error(`Worker setup exited ${setupCode}`);
    send({ kind: "paired", pid: process.pid, config: await loadIdentity(configDirectory) });
    if (mode === "pair") return;
  }

  if (mode === "pair-and-run" || mode === "start") {
    const startCode = await workerCliMain(["start", "--once", "--config-dir", configDirectory]);
    if (startCode !== 0) throw new Error(`Worker start exited ${startCode}`);
    send({ kind: "run-finished", pid: process.pid, config: await loadIdentity(configDirectory) });
    return;
  }

  if (mode === "claim-and-exit") {
    const { client, config } = await authenticatedClient(configDirectory);
    const report = await runDoctor({ apiUrl, workspacePath: configDirectory });
    await client.heartbeat({
      protocolVersion: WORKER_PROTOCOL_VERSION,
      status: "ONLINE",
      capabilities: report.capabilities,
      activeJobRunIds: [],
      sentAt: new Date().toISOString(),
    });
    const job = await client.claim();
    send({ kind: "claim-result", pid: process.pid, config, job });
    return;
  }

  if (mode === "stale-attempt") {
    send({ kind: "ready-for-stale-attempt", pid: process.pid });
    const command = await receiveStaleAttemptCommand();
    const { client } = await authenticatedClient(configDirectory);
    const attempts = {
      renew: await rejected(() => client.renewLease(command.job.jobRunId, command.job.leaseToken)),
      event: await rejected(() =>
        client.sendEvent(
          {
            protocolVersion: WORKER_PROTOCOL_VERSION,
            eventId: randomUUID(),
            jobRunId: command.job.jobRunId,
            sequence: 999,
            type: "LOG",
            message: "Stale Worker result must be fenced",
            createdAt: new Date().toISOString(),
          },
          command.job.leaseToken,
        ),
      ),
      artifact: await rejected(() =>
        client.uploadArtifact(command.job.jobRunId, command.job.leaseToken, {
          artifactType: "OTHER",
          fileName: "stale-result.txt",
          mimeType: "text/plain",
          bytes: new TextEncoder().encode(`stale result for ${command.job.jobRunId}\n`),
        }),
      ),
      submit: await rejected(() =>
        client.submit(
          command.job.jobRunId,
          command.job.leaseToken,
          {
            status: "succeeded",
            summary: "Stale result that the Server must reject",
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            exitCode: 0,
            gitDiff: "",
            changedFiles: [],
            commandsRun: [],
          },
          [],
        ),
      ),
    };
    send({ kind: "stale-attempt-result", pid: process.pid, attempts });
    return;
  }

  throw new Error(`Unsupported Worker reality child mode: ${mode}`);
}

async function authenticatedClient(configDirectory: string): Promise<{
  client: WorkerApiClient;
  config: NonNullable<Awaited<ReturnType<WorkerConfigStore["loadConfig"]>>>;
}> {
  const store = new WorkerConfigStore(configDirectory);
  const config = await store.loadConfig();
  const workerToken = await store.loadToken();
  if (!config || !workerToken) throw new Error("Worker fixture is not paired");
  return {
    config,
    client: new WorkerApiClient(config.apiUrl, { workerId: config.workerId, workerToken }),
  };
}

async function loadIdentity(configDirectory: string): Promise<unknown> {
  const store = new WorkerConfigStore(configDirectory);
  const config = await store.loadConfig();
  if (!config) throw new Error("Worker config was not persisted after pairing");
  return config;
}

async function rejected(operation: () => Promise<unknown>): Promise<{ rejected: boolean; error?: string }> {
  try {
    await operation();
    return { rejected: false };
  } catch (error) {
    return { rejected: true, error: error instanceof Error ? error.message : "Unknown rejection" };
  }
}

function receiveStaleAttemptCommand(): Promise<StaleAttemptCommand> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.off("message", onMessage);
      reject(new Error("Timed out waiting for stale-attempt IPC command"));
    }, 10_000);
    const onMessage = (message: unknown) => {
      if (!isStaleAttemptCommand(message)) return;
      clearTimeout(timeout);
      process.off("message", onMessage);
      resolve(message);
    };
    process.on("message", onMessage);
  });
}

function isStaleAttemptCommand(value: unknown): value is StaleAttemptCommand {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "stale-attempt" &&
      "job" in value &&
      value.job &&
      typeof value.job === "object",
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function send(message: unknown): void {
  if (process.connected) process.send?.(message);
}

run()
  .then(() => {
    process.disconnect?.();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Worker reality child failed";
    send({ kind: "fatal", pid: process.pid, error: message });
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    process.disconnect?.();
  });
