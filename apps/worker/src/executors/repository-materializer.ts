import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  assertAllowlistedRepositoryUrl,
  assertRepositoryRelativePath,
  canonicalRepositoryJson,
  repositoryFileManifestSchema,
  repositoryManifestSha256,
  repositoryMetadataSchema,
  type ExecutionResult,
  type ProducedArtifact,
  type RepositoryFileManifest,
} from "@donelayer/worker-protocol";

import type { ExecutionContext, JobExecutor } from "./types.js";

const MAX_GIT_OUTPUT_BYTES = 512 * 1024;
const IGNORED_OS_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

type GitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export class RepositoryMaterializerExecutor implements JobExecutor {
  readonly kind = "repository-materializer" as const;

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const { job, permissionGuard, workdir, signal } = context;
    if (
      job.workflow.id !== "REPOSITORY_MATERIALIZE_V1" ||
      job.repository.mode !== "allowlisted-github"
    ) {
      throw new Error("Repository materializer only accepts REPOSITORY_MATERIALIZE_V1");
    }

    const remoteUrl = assertAllowlistedRepositoryUrl(job.repository.remoteUrl);
    if (job.repository.targetBranch !== REPOSITORY_MATERIALIZATION_BRANCH) {
      throw permissionGuard.recordViolation(
        "git_clone_allowlisted_repository",
        "Repository branch is not allowlisted",
        job.repository.targetBranch,
      );
    }
    permissionGuard.assertActionAllowed("connect_to_allowlisted_github_repository");
    permissionGuard.assertActionAllowed("git_clone_allowlisted_repository");
    permissionGuard.assertRepositoryAllowed(remoteUrl, job.repository.targetBranch);
    permissionGuard.assertDomainAllowed(remoteUrl);

    const repositoryDirectory = path.join(workdir, "repository");
    const evidenceDirectory = path.join(workdir, "evidence");
    const isolatedHome = path.join(workdir, ".isolated-home");
    const hooksDirectory = path.join(workdir, ".empty-hooks");
    const templatesDirectory = path.join(workdir, ".empty-templates");
    const globalGitConfig = path.join(isolatedHome, ".gitconfig");
    for (const candidate of [repositoryDirectory, evidenceDirectory, isolatedHome, hooksDirectory, templatesDirectory]) {
      permissionGuard.assertPathAllowed(candidate);
    }
    await Promise.all([
      mkdir(evidenceDirectory, { recursive: true, mode: 0o700 }),
      mkdir(isolatedHome, { recursive: true, mode: 0o700 }),
      mkdir(hooksDirectory, { recursive: true, mode: 0o700 }),
      mkdir(templatesDirectory, { recursive: true, mode: 0o700 }),
    ]);
    permissionGuard.assertPathAllowed(globalGitConfig);
    await writeFile(globalGitConfig, "", { encoding: "utf8", mode: 0o600 });

    const gitEnvironment = isolatedGitEnvironment(isolatedHome, globalGitConfig);
    const cloneArguments = [
      "-c",
      "http.followRedirects=false",
      "-c",
      "credential.helper=",
      "-c",
      `core.hooksPath=${hooksDirectory}`,
      "-c",
      `init.templateDir=${templatesDirectory}`,
      "clone",
      "--no-recurse-submodules",
      "--single-branch",
      "--branch",
      REPOSITORY_MATERIALIZATION_BRANCH,
      "--no-tags",
      remoteUrl,
      repositoryDirectory,
    ];
    const cloneStartedAt = new Date().toISOString();
    const cloneStartedMs = Date.now();
    await context.emit({
      type: "EXECUTOR_STARTED",
      message: "REPOSITORY_MATERIALIZE_V1 started",
      progress: 5,
    });
    await context.emit({
      type: "REPOSITORY_CLONE_STARTED",
      message: "Allowlisted GitHub clone started",
      progress: 10,
      data: { remoteUrl, branch: REPOSITORY_MATERIALIZATION_BRANCH, executable: "git", args: cloneArguments },
    });

    const clone = await runGit(cloneArguments, workdir, gitEnvironment, signal);
    const cloneFinishedAt = new Date().toISOString();
    const cloneDurationMs = Math.max(0, Date.now() - cloneStartedMs);
    await context.emit({
      type: "REPOSITORY_CLONE_COMPLETED",
      message: clone.exitCode === 0 ? "Allowlisted GitHub clone completed" : "Allowlisted GitHub clone failed",
      progress: 35,
      data: {
        exitCode: clone.exitCode,
        cloneStartedAt,
        cloneFinishedAt,
        cloneDurationMs,
        stdout: clone.stdout,
        stderr: clone.stderr,
      },
    });
    if (clone.exitCode !== 0) {
      throw new Error(`Git clone failed with exit code ${clone.exitCode}: ${clone.stderr.trim() || "no stderr"}`);
    }

    permissionGuard.assertActionAllowed("read_git_metadata");
    permissionGuard.assertPathAllowed(repositoryDirectory);
    const [originResult, branchResult, commitResult] = await Promise.all([
      runGit(["remote", "get-url", "origin"], repositoryDirectory, gitEnvironment, signal),
      runGit(["branch", "--show-current"], repositoryDirectory, gitEnvironment, signal),
      runGit(["rev-parse", "HEAD"], repositoryDirectory, gitEnvironment, signal),
    ]);
    const origin = requiredGitValue("git remote get-url origin", originResult);
    const branch = requiredGitValue("git branch --show-current", branchResult);
    const commitSha = requiredGitValue("git rev-parse HEAD", commitResult).toLowerCase();
    assertAllowlistedRepositoryUrl(origin);
    if (branch !== REPOSITORY_MATERIALIZATION_BRANCH) throw new Error("Cloned branch does not match the allowlist");
    if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error("Cloned commit SHA is invalid");
    await context.emit({
      type: "REMOTE_METADATA_CAPTURED",
      message: "Repository origin, branch, and commit captured",
      progress: 50,
      data: { remoteUrl: origin, branch, commitSha },
    });

    permissionGuard.assertActionAllowed("read_files_inside_job_workspace");
    permissionGuard.assertActionAllowed("calculate_file_sha256");
    permissionGuard.assertActionAllowed("create_file_manifest");
    const files = await createManifestEntries(repositoryDirectory, permissionGuard, signal);
    const manifest: RepositoryFileManifest = repositoryFileManifestSchema.parse({
      schemaVersion: 1,
      remoteUrl: origin,
      branch,
      commitSha,
      files,
    });
    const manifestJson = canonicalRepositoryJson(manifest);
    const manifestSha256 = repositoryManifestSha256(manifest);
    const metadata = repositoryMetadataSchema.parse({
      schemaVersion: 1,
      remoteUrl: origin,
      branch,
      commitSha,
      cloneStartedAt,
      cloneFinishedAt,
      cloneExitCode: clone.exitCode,
      cloneDurationMs,
      workerId: job.workerId,
      jobRunId: job.jobRunId,
    });
    const metadataJson = canonicalRepositoryJson(metadata);
    const cloneLog = [
      "Executable: git",
      `Arguments: ${JSON.stringify(cloneArguments)}`,
      `Started At: ${cloneStartedAt}`,
      `Finished At: ${cloneFinishedAt}`,
      `Duration Ms: ${cloneDurationMs}`,
      `Exit Code: ${clone.exitCode}`,
      "--- stdout ---",
      clone.stdout,
      "--- stderr ---",
      clone.stderr,
      "",
    ].join("\n");
    const evidenceFiles = [
      ["clone-log.txt", cloneLog],
      ["repository-metadata.json", metadataJson],
      ["file-manifest.json", manifestJson],
    ] as const;
    for (const [fileName, content] of evidenceFiles) {
      const filePath = path.join(evidenceDirectory, fileName);
      permissionGuard.assertPathAllowed(filePath);
      await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
    }
    await context.emit({
      type: "FILE_MANIFEST_CREATED",
      message: "Cryptographic repository file manifest created",
      progress: 70,
      data: { fileCount: files.length, manifestSha256 },
    });

    const artifacts: ProducedArtifact[] = [
      { artifactType: "OTHER", fileName: "clone-log.txt", mimeType: "text/plain", bytes: Buffer.from(cloneLog, "utf8") },
      { artifactType: "OTHER", fileName: "repository-metadata.json", mimeType: "application/json", bytes: Buffer.from(metadataJson, "utf8") },
      { artifactType: "OTHER", fileName: "file-manifest.json", mimeType: "application/json", bytes: Buffer.from(manifestJson, "utf8") },
    ];
    const endedAt = new Date().toISOString();
    await context.emit({
      type: "EXECUTOR_FINISHED",
      message: "REPOSITORY_MATERIALIZE_V1 completed without executing repository code",
      progress: 85,
      data: { fileCount: files.length, manifestSha256, noRepositoryCodeExecuted: true },
    });

    return {
      status: "succeeded",
      summary: "Allowlisted repository cloned and cryptographic evidence created without executing repository code",
      startedAt: cloneStartedAt,
      endedAt,
      exitCode: 0,
      gitDiff: "",
      changedFiles: [],
      commandsRun: [],
      repositoryMaterialization: {
        remoteUrl: origin,
        branch,
        commitSha,
        cloneStartedAt,
        cloneFinishedAt,
        cloneExitCode: clone.exitCode,
        cloneDurationMs,
        cloneArguments,
        cloneStdout: clone.stdout,
        cloneStderr: clone.stderr,
        fileCount: files.length,
        manifestSha256,
        noRepositoryCodeExecuted: true,
      },
      artifacts,
    };
  }
}

async function createManifestEntries(
  repositoryDirectory: string,
  permissionGuard: ExecutionContext["permissionGuard"],
  signal: AbortSignal,
): Promise<RepositoryFileManifest["files"]> {
  const repositoryRoot = await realpath(repositoryDirectory);
  const entries: RepositoryFileManifest["files"] = [];

  async function visit(directory: string): Promise<void> {
    if (signal.aborted) throw signal.reason ?? new Error("Repository manifest cancelled");
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (child.name === ".git" || IGNORED_OS_FILES.has(child.name)) continue;
      const absolutePath = path.join(directory, child.name);
      permissionGuard.assertPathAllowed(absolutePath);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) throw new Error(`Repository symlink is not allowed in V1: ${child.name}`);
      if (metadata.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!metadata.isFile()) throw new Error(`Unsupported repository entry type: ${child.name}`);
      const resolved = await realpath(absolutePath);
      const relativeToRoot = path.relative(repositoryRoot, resolved);
      if (!relativeToRoot || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
        throw new Error("Repository file resolved outside the cloned workspace");
      }
      const relativePath = assertRepositoryRelativePath(relativeToRoot.split(path.sep).join("/"));
      const bytes = await readFile(resolved);
      entries.push({
        relative_path: relativePath,
        size_bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }

  await visit(repositoryRoot);
  entries.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return entries;
}

function requiredGitValue(command: string, result: GitResult): string {
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed with exit code ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`);
  }
  const value = result.stdout.trim();
  if (!value || value.includes("\n") || value.includes("\r")) throw new Error(`${command} returned invalid output`);
  return value;
}

function runGit(
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("Git operation cancelled"));
      return;
    }
    const child = spawn("git", args, {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    const collect = (current: Buffer, chunk: Buffer): Buffer => {
      if (current.byteLength >= MAX_GIT_OUTPUT_BYTES) return current;
      return Buffer.concat([current, chunk.subarray(0, MAX_GIT_OUTPUT_BYTES - current.byteLength)]);
    };
    child.stdout.on("data", (chunk: Buffer) => (stdout = collect(stdout, chunk)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = collect(stderr, chunk)));
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        reject(signal.reason ?? new Error("Git operation cancelled"));
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });
  });
}

function isolatedGitEnvironment(home: string, globalConfig: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GCM_INTERACTIVE: "Never",
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
