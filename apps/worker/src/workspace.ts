import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JobEnvelope } from "@donelayer/worker-protocol";

export class DisposableWorkspaceManager {
  constructor(private readonly root: string) {}

  async prepare(job: JobEnvelope): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const workdir = await mkdtemp(path.join(this.root, "job-"));
    if (job.repository.mode !== "demo") {
      await this.cleanup(workdir);
      throw new Error(
        "GitHub repository materialization is disabled in this Worker build; use Demo mode until the platform supplies a verified workspace bundle",
      );
    }
    try {
      await seedDemoRepository(workdir, job.executor.kind === "codex-cli");
      return workdir;
    } catch (error) {
      await this.cleanup(workdir).catch(() => undefined);
      throw error;
    }
  }

  async cleanup(workdir: string): Promise<void> {
    const root = path.resolve(this.root);
    const target = path.resolve(workdir);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Refusing to clean a path outside the Worker workspace root");
    }
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function seedDemoRepository(workdir: string, initializeGit: boolean): Promise<void> {
  await Promise.all([
    mkdir(path.join(workdir, "src", "auth"), { recursive: true }),
    mkdir(path.join(workdir, "tests", "auth"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(workdir, "package.json"),
      `${JSON.stringify({ name: "donelayer-demo-repository", private: true, scripts: { test: "node --test" } }, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(workdir, "src", "auth", "session.ts"),
      "export function isSessionValid(expiresAt: number, now: number): boolean {\n  return expiresAt < now;\n}\n",
      "utf8",
    ),
    writeFile(
      path.join(workdir, "tests", "auth", "session.test.ts"),
      "// Demo fixture. The DemoExecutor supplies deterministic evidence without executing this file.\n",
      "utf8",
    ),
    writeFile(path.join(workdir, "README.md"), "# DoneLayer demo repository\n", "utf8"),
  ]);
  if (initializeGit) {
    await runGit(workdir, ["init"]);
    await runGit(workdir, ["config", "user.name", "DoneLayer Demo Worker"]);
    await runGit(workdir, ["config", "user.email", "demo-worker@invalid.local"]);
    await runGit(workdir, ["add", "--all"]);
    await runGit(workdir, ["commit", "-m", "Seed demo repository"]);
  }
}

function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...minimalProcessEnvironment(),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Unable to initialize demo repository: ${stderr.trim() || `git exited ${code}`}`));
    });
  });
}

function minimalProcessEnvironment(): Record<string, string> & {
  NODE_ENV: "development" | "production" | "test";
} {
  const requestedNodeEnvironment = process.env.NODE_ENV;
  const environment: Record<string, string> & {
    NODE_ENV: "development" | "production" | "test";
  } = {
    NODE_ENV:
      requestedNodeEnvironment === "development" ||
      requestedNodeEnvironment === "test" ||
      requestedNodeEnvironment === "production"
        ? requestedNodeEnvironment
        : "production",
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP"].some(
        (allowed) => allowed.toLowerCase() === key.toLowerCase(),
      )
    ) {
      environment[key] = value;
    }
  }
  return environment;
}
