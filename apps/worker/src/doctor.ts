import { spawn } from "node:child_process";
import { access, readFile, statfs } from "node:fs/promises";
import { arch, cpus, freemem, platform, totalmem } from "node:os";
import path from "node:path";

import type {
  OperatingSystem,
  WorkerCapabilities,
} from "@donelayer/worker-protocol";

export const WORKER_MAX_CONCURRENT_JOBS = 1;

export type DoctorCheck = {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  capabilities: WorkerCapabilities;
  healthyForSmoke: boolean;
  healthyForDemo: boolean;
  healthyForCodex: boolean;
};

export async function runDoctor(options: { apiUrl?: string; workspacePath?: string } = {}): Promise<DoctorReport> {
  const [git, docker, codex, githubCli, npm, disk, network, workerVersion] = await Promise.all([
    probeCommand("git", ["--version"]),
    probeCommand("docker", ["--version"]),
    probeCommand("codex", ["--version"]),
    probeCommand("gh", ["--version"]),
    probeNpm(),
    probeDisk(options.workspacePath ?? process.cwd()),
    options.apiUrl ? probeNetwork(options.apiUrl) : Promise.resolve({ ok: false, detail: "API URL not configured" }),
    readWorkerVersion(),
  ]);
  const supportedLanguages = await detectLanguages();
  const dockerAvailable = docker.ok;
  const codexAvailable = codex.ok;
  const gitAvailable = git.ok;
  const totalMemoryBytes = totalmem();
  const availableMemoryBytes = Math.min(totalMemoryBytes, freemem());

  const capabilities: WorkerCapabilities = {
    os: currentOperatingSystem(),
    architecture: arch(),
    cpuCount: Math.max(1, cpus().length),
    nodeVersion: process.version,
    npmVersion: npm.ok ? npm.detail : null,
    workerVersion,
    processId: process.pid,
    memoryBytes: totalMemoryBytes,
    availableMemoryBytes,
    freeDiskBytes: disk.freeBytes,
    dockerAvailable,
    codexAvailable,
    gitAvailable,
    githubCliAvailable: githubCli.ok,
    supportedLanguages,
    installedTools: [
      "node",
      npm.ok ? "npm" : null,
      git.ok ? "git" : null,
      docker.ok ? "docker" : null,
      codex.ok ? "codex" : null,
      githubCli.ok ? "gh" : null,
    ].filter((value): value is string => Boolean(value)),
    mcpServers: [],
    executors: gitAvailable
      ? ["worker-smoke", "repository-materializer"]
      : ["worker-smoke"],
    maxConcurrentJobs: WORKER_MAX_CONCURRENT_JOBS,
  };

  const checks: DoctorCheck[] = [
    { name: "Node.js", status: "PASS", detail: process.version },
    { name: "npm", status: npm.ok ? "PASS" : "WARN", detail: npm.detail },
    { name: "Worker process", status: "PASS", detail: `v${workerVersion}, PID ${process.pid}` },
    { name: "Operating system", status: "PASS", detail: `${capabilities.os} ${capabilities.architecture}` },
    { name: "Git", status: git.ok ? "PASS" : "WARN", detail: git.detail },
    { name: "Docker", status: docker.ok ? "PASS" : "WARN", detail: docker.detail },
    { name: "Codex CLI", status: codex.ok ? "PASS" : "WARN", detail: codex.detail },
    {
      name: "Codex execution",
      status: "WARN",
      detail: "Paused by the Worker Reality Gate",
    },
    { name: "GitHub CLI", status: githubCli.ok ? "PASS" : "WARN", detail: githubCli.detail },
    { name: "Free disk", status: disk.freeBytes >= 1024 ** 3 ? "PASS" : "WARN", detail: disk.detail },
    { name: "Platform API", status: network.ok ? "PASS" : options.apiUrl ? "WARN" : "WARN", detail: network.detail },
    { name: "Worker smoke", status: "PASS", detail: "Available without repository, shell, Codex, or MCP access" },
    {
      name: "Repository materializer",
      status: gitAvailable ? "PASS" : "WARN",
      detail: gitAvailable
        ? "Available for the single server allowlisted GitHub repository"
        : "Unavailable because Git was not detected",
    },
  ];

  return {
    checks,
    capabilities,
    healthyForSmoke: true,
    healthyForDemo: false,
    healthyForCodex: false,
  };
}

async function probeNpm(): Promise<{ ok: boolean; detail: string }> {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate);
      return probeCommand(process.execPath, [candidate, "--version"]);
    } catch {
      // Try the next known npm CLI location.
    }
  }
  return probeCommand(platform() === "win32" ? "npm.cmd" : "npm", ["--version"]);
}

async function readWorkerVersion(): Promise<string> {
  const parsed: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (!parsed || typeof parsed !== "object" || !("version" in parsed) || typeof parsed.version !== "string" || !parsed.version.trim()) {
    throw new Error("Worker package version is unavailable");
  }
  return parsed.version;
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
