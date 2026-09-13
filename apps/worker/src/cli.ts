#!/usr/bin/env node
import { hostname } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

import { WORKER_PROTOCOL_VERSION, redactSecrets } from "@donelayer/worker-protocol";

import { WorkerApiClient } from "./client.js";
import { WorkerConfigStore } from "./config.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { WorkerSmokeExecutor } from "./executors/worker-smoke.js";
import { RepositoryMaterializerExecutor } from "./executors/repository-materializer.js";
import { WorkerRuntime, defaultWorkspaceRoot } from "./runtime.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command = "help", ...args] = argv;
  const flags = parseFlags(args);
  const configStore = new WorkerConfigStore(flags.get("config-dir"));

  switch (command) {
    case "setup":
      return setup(configStore, flags);
    case "start":
      return start(configStore, flags);
    case "status":
      return status(configStore, flags);
    case "logout":
      return logout(configStore);
    case "doctor":
      return doctor(configStore, flags);
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function setup(store: WorkerConfigStore, flags: Map<string, string>): Promise<number> {
  const apiUrl = flags.get("api-url") ?? process.env.DONELAYER_API_URL ?? "http://localhost:3000";
  assertPlatformApiUrl(apiUrl);
  let pairingCode = flags.get("code") ?? process.env.DONELAYER_PAIRING_CODE;
  if (!pairingCode) {
    if (!input.isTTY) throw new Error("Pairing code is required; pass --code in non-interactive mode");
    const prompt = createInterface({ input, output });
    try {
      pairingCode = (await prompt.question("Pairing code: ")).trim();
    } finally {
      prompt.close();
    }
  }
  const report = await runDoctor({ apiUrl, workspacePath: store.directory });
  const client = new WorkerApiClient(apiUrl);
  const name = flags.get("name") ?? `Worker on ${hostname()}`;
  const paired = await client.pair({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    pairingCode,
    name,
    capabilities: report.capabilities,
  });
  await store.save(
    {
      apiUrl,
      workerId: paired.workerId,
      name,
      pairedAt: paired.pairedAt,
      pollIntervalMs: numberFlag(flags, "poll-ms", 2_000),
    },
    paired.workerToken,
  );
  output.write(`Paired Worker ${name} (${paired.workerId}).\n`);
  output.write("Credential storage: local development file with private permissions. Use an OS keychain provider in production.\n");
  return 0;
}

async function start(store: WorkerConfigStore, flags: Map<string, string>): Promise<number> {
  const config = await store.loadConfig();
  const workerToken = await store.loadToken();
  if (!config || !workerToken) throw new Error("Worker is not paired. Run doneworker setup first.");
  const report = await runDoctor({ apiUrl: config.apiUrl, workspacePath: store.directory });
  const client = new WorkerApiClient(config.apiUrl, { workerId: config.workerId, workerToken });
  const runtime = new WorkerRuntime({
    client,
    config,
    capabilities: report.capabilities,
    workspaceRoot: defaultWorkspaceRoot(store.directory),
    executors: [new WorkerSmokeExecutor(), new RepositoryMaterializerExecutor()],
    onMessage: (message) => output.write(`${message}\n`),
  });
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Worker stopped"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  output.write(`Worker ${config.name} is polling ${config.apiUrl} using outbound requests only.\n`);
  try {
    await runtime.start({ signal: controller.signal, once: booleanFlag(flags, "once") });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  return 0;
}

async function status(store: WorkerConfigStore, flags: Map<string, string>): Promise<number> {
  const config = await store.loadConfig();
  const tokenStored = Boolean(await store.loadToken());
  const document = config
    ? {
        paired: true,
        workerId: config.workerId,
        name: config.name,
        apiUrl: config.apiUrl,
        pairedAt: config.pairedAt,
        tokenStored,
        credentialStore: store.usesDevelopmentCredentialStore ? "development-file" : "os-keychain",
      }
    : { paired: false, tokenStored: false };
  if (booleanFlag(flags, "json")) output.write(`${JSON.stringify(document, null, 2)}\n`);
  else if (config) {
    output.write(`Worker: ${config.name}\nID: ${config.workerId}\nPlatform: ${config.apiUrl}\nPaired: ${config.pairedAt}\nToken stored: ${tokenStored ? "yes" : "no"}\n`);
  } else output.write("Worker is not paired.\n");
  return config && tokenStored ? 0 : 1;
}

async function logout(store: WorkerConfigStore): Promise<number> {
  const config = await store.loadConfig();
  const workerToken = await store.loadToken();
  if (config && workerToken) {
    const client = new WorkerApiClient(config.apiUrl, { workerId: config.workerId, workerToken });
    await client.revoke().catch(() => {
      output.write("Warning: platform revocation could not be confirmed; revoke this Worker in the Provider dashboard.\n");
    });
  }
  await store.clear();
  output.write("Worker credentials removed.\n");
  return 0;
}

async function doctor(store: WorkerConfigStore, flags: Map<string, string>): Promise<number> {
  const config = await store.loadConfig();
  const apiUrl = flags.get("api-url") ?? config?.apiUrl;
  const report = await runDoctor({
    ...(apiUrl ? { apiUrl } : {}),
    workspacePath: store.directory,
  });
  if (booleanFlag(flags, "json")) output.write(`${JSON.stringify(report, null, 2)}\n`);
  else printDoctor(report);
  return booleanFlag(flags, "strict") && !report.healthyForSmoke ? 1 : 0;
}

function printDoctor(report: DoctorReport): void {
  for (const check of report.checks) {
    output.write(`${check.status.padEnd(4)}  ${check.name.padEnd(18)} ${check.detail}\n`);
  }
  output.write(`\nAvailable executors: ${report.capabilities.executors.join(", ")}\n`);
}

function parseFlags(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith("--")) throw new Error(`Unexpected argument: ${token ?? ""}`);
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (!rawKey) throw new Error("Flag name is empty");
    const next = args[index + 1];
    if (inlineValue !== undefined) result.set(rawKey, inlineValue);
    else if (next && !next.startsWith("--")) {
      result.set(rawKey, next);
      index += 1;
    } else result.set(rawKey, "true");
  }
  return result;
}

function booleanFlag(flags: Map<string, string>, name: string): boolean {
  return ["true", "1", "yes"].includes((flags.get(name) ?? "false").toLowerCase());
}

function numberFlag(flags: Map<string, string>, name: string, fallback: number): number {
  const value = flags.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`--${name} must be an integer`);
  return parsed;
}

function assertPlatformApiUrl(value: string): void {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "::1"].includes(
    url.hostname.replace(/^\[|\]$/g, ""),
  );
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Worker platform URL must use HTTPS; HTTP is allowed only for local development");
  }
}

function printHelp(): void {
  output.write(
    [
      "DoneLayer Worker CLI",
      "",
      "Commands:",
      "  doneworker setup  --api-url <url> [--code <pairing-code>] [--name <name>]",
      "  doneworker start  [--once]",
      "  doneworker status [--json]",
      "  doneworker doctor [--json] [--strict]",
      "  doneworker logout",
      "",
      "All platform connections are outbound. The Worker never opens an inbound port.",
      "",
    ].join("\n"),
  );
}

const invokedDirectly = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${redactSecrets(error instanceof Error ? error.message : "Worker failed")}\n`);
      process.exitCode = 1;
    });
}
