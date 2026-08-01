import { spawn } from "node:child_process";
import { statfs } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import path from "node:path";

import type {
  McpServerCapability,
  OperatingSystem,
  WorkerCapabilities,
} from "@donelayer/worker-protocol";

export type DoctorCheck = {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  capabilities: WorkerCapabilities;
  healthyForDemo: boolean;
  healthyForCodex: boolean;
};

export async function runDoctor(options: { apiUrl?: string; workspacePath?: string } = {}): Promise<DoctorReport> {
  const [git, docker, codex, githubCli, disk, network] = await Promise.all([
    probeCommand("git", ["--version"]),
    probeCommand("docker", ["info", "--format", "{{.ServerVersion}}"]),
    probeCommand("codex", ["--version"]),
    probeCommand("gh", ["--version"]),
    probeDisk(options.workspacePath ?? process.cwd()),
    options.apiUrl ? probeNetwork(options.apiUrl) : Promise.resolve({ ok: false, detail: "API URL not configured" }),
  ]);
  const mcpServers = readDeclaredMcpCapabilities();
  const supportedLanguages = await detectLanguages();
  const dockerAvailable = docker.ok;
  const codexAvailable = codex.ok;
  const gitAvailable = git.ok;
  const codexExecutorEnabled = process.env.DONELAYER_ENABLE_CODEX_EXECUTOR === "true";
  const healthyForCodex =
    dockerAvailable && codexAvailable && gitAvailable && codexExecutorEnabled;

  const capabilities: WorkerCapabilities = {
    os: currentOperatingSystem(),
    architecture: arch(),
    cpuCount: Math.max(1, cpus().length),
    memoryBytes: totalmem(),
    freeDiskBytes: disk.freeBytes,
    dockerAvailable,
    codexAvailable,
    gitAvailable,
    githubCliAvailable: githubCli.ok,
    supportedLanguages,
    installedTools: [
      git.ok ? "git" : null,
      docker.ok ? "docker" : null,
      codex.ok ? "codex" : null,
      githubCli.ok ? "gh" : null,
    ].filter((value): value is string => Boolean(value)),
    mcpServers,
    executors: healthyForCodex ? ["demo", "codex-cli"] : ["demo"],
    maxConcurrentJobs: 1,
  };

  const checks: DoctorCheck[] = [
    { name: "Node.js", status: "PASS", detail: process.version },
    { name: "Operating system", status: "PASS", detail: `${capabilities.os} ${capabilities.architecture}` },
    { name: "Git", status: git.ok ? "PASS" : "WARN", detail: git.detail },
    { name: "Docker", status: docker.ok ? "PASS" : "WARN", detail: docker.ok ? docker.detail : `${docker.detail}; real jobs disabled` },
    { name: "Codex CLI", status: codex.ok ? "PASS" : "WARN", detail: codex.ok ? codex.detail : `${codex.detail}; Codex executor disabled` },
    {
      name: "Codex execution",
      status: healthyForCodex ? "WARN" : "WARN",
      detail: healthyForCodex
        ? "Preview enabled; uses Codex workspace-write sandbox and requires provider approval"
        : "Disabled by default; set DONELAYER_ENABLE_CODEX_EXECUTOR=true only in a dedicated environment",
    },
    { name: "GitHub CLI", status: githubCli.ok ? "PASS" : "WARN", detail: githubCli.detail },
    { name: "Free disk", status: disk.freeBytes >= 1024 ** 3 ? "PASS" : "WARN", detail: disk.detail },
    { name: "Platform API", status: network.ok ? "PASS" : options.apiUrl ? "WARN" : "WARN", detail: network.detail },
    { name: "MCP servers", status: "PASS", detail: `${mcpServers.length} declared without uploading secrets` },
    { name: "Demo executor", status: "PASS", detail: "Available without Docker, Codex, GitHub, or MCP" },
  ];

  return { checks, capabilities, healthyForDemo: true, healthyForCodex };
}

async function probeCommand(command: string, args: string[]): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ ok: false, detail: error instanceof Error ? error.message : `${command} could not start` });
      return;
    }
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, detail: `${command} probe timed out` });
    }, 3_000);
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: error.message });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, detail: output.trim().split(/\r?\n/, 1)[0] || `exit code ${code ?? 1}` });
    });
  });
}

async function probeDisk(
  directory: string,
  fallbackUsed = false,
): Promise<{ freeBytes: number; detail: string }> {
  let candidate = path.resolve(directory);
  while (true) {
    try {
      const result = await statfs(candidate);
      const freeBytes = Number(result.bavail) * Number(result.bsize);
      return { freeBytes, detail: `${(freeBytes / 1024 ** 3).toFixed(1)} GiB available` };
    } catch (error) {
      if (!isMissingPath(error)) {
        if (!fallbackUsed && path.resolve(directory) !== path.resolve(process.cwd())) {
          return probeDisk(process.cwd(), true);
        }
        return { freeBytes: 0, detail: error instanceof Error ? error.message : "Unable to inspect disk" };
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) return { freeBytes: 0, detail: "Unable to find an existing parent directory" };
      candidate = parent;
    }
  }
}

async function probeNetwork(apiUrl: string): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(new URL("api/health", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`), {
      method: "GET",
      signal: controller.signal,
      redirect: "error",
    });
    return { ok: response.ok, detail: response.ok ? "Outbound connection succeeded" : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Connection failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function detectLanguages(): Promise<string[]> {
  const commands: Array<[string, string, string[]]> = [
    ["JavaScript/TypeScript", "node", ["--version"]],
    ["Python", "python", ["--version"]],
    ["Go", "go", ["version"]],
    ["Rust", "cargo", ["--version"]],
    ["Swift", "swift", ["--version"]],
  ];
  const results = await Promise.all(commands.map(async ([language, command, args]) => ({ language, probe: await probeCommand(command, args) })));
  return results.filter(({ probe }) => probe.ok).map(({ language }) => language);
}

function readDeclaredMcpCapabilities(): McpServerCapability[] {
  return (process.env.DONELAYER_MCP_SERVERS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      transport: "unknown",
      tools: [],
      resources: [],
      prompts: [],
      authenticationRequired: false,
      installed: true,
    }));
}

function currentOperatingSystem(): OperatingSystem {
  const value = platform();
  if (value === "win32") return "windows";
  if (value === "darwin") return "macos";
  if (value === "linux") return "linux";
  return "unknown";
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
