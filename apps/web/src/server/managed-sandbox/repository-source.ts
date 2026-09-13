import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  independentlyResolveDeliveryRemoteCommit,
  independentlyResolveRemoteCommit,
  independentlyResolveScenarioRemoteCommit,
} from "@donelayer/database";
import {
  BETA_GATE_3_PRODUCT_BRANCH,
  BETA_GATE_3_PRODUCT_REMOTE_URL,
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  assertAllowlistedRepositoryUrl,
  assertBetaGate3ProductRepositoryUrl,
  assertGitDeliveryBranch,
  assertFixtureScenarioBranch,
  REAL_SOURCE_BUG_FIXTURE_BRANCH,
  assertRepositoryRelativePath,
  repositoryFileManifestSchema,
  repositoryManifestSha256,
  type RepositoryFileManifest,
} from "@donelayer/worker-protocol";

import {
  createSourcePackage,
  type CreatedSourcePackage,
} from "./source-package";

const MAX_GIT_OUTPUT_BYTES = 512 * 1024;
const IGNORED_OS_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

type GitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SourceMaterializationFailureEvidence = {
  errorType: "SOURCE_MATERIALIZATION_FAILURE";
  stage: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message: string;
  materializerWorkspaceCleaned: boolean | null;
};

export class SourceMaterializationError extends Error {
  readonly errorType = "SOURCE_MATERIALIZATION_FAILURE" as const;
  materializerWorkspaceCleaned: boolean | null = null;

  constructor(
    readonly stage: string,
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SourceMaterializationError";
  }
}

export type MaterializedSourcePackage = CreatedSourcePackage & {
  repositoryManifest: RepositoryFileManifest;
  repositoryManifestSha256: string;
  materializerCommitSha: string;
  independentRemoteCommitSha: string;
  parentCommitSha: string | null;
  sourceFileCount: number;
  buildScriptPresent: boolean;
  testScriptPresent: true;
  installLifecycleScriptsPresent: false;
  clone: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    exitCode: 0;
    stdout: string;
    stderr: string;
  };
  remoteVerifiedAt: string;
  materializerWorkspaceCleaned: true;
};

export async function materializeVerifiedSourcePackage(input: {
  sourceBoundary?: "FIXTURE" | "BETA_GATE_3_PRODUCT_MAIN";
  remoteUrl?: string;
  branch?: string;
  expectedCommitSha?: string;
  expectedParentCommitSha?: string;
  allowedDeliveryBranch?: string;
  allowedScenarioBranch?: string;
  signal?: AbortSignal;
} = {}): Promise<MaterializedSourcePackage> {
  const productSource = input.sourceBoundary === "BETA_GATE_3_PRODUCT_MAIN";
  const remoteUrl = productSource
    ? assertBetaGate3ProductRepositoryUrl(input.remoteUrl ?? BETA_GATE_3_PRODUCT_REMOTE_URL)
    : assertAllowlistedRepositoryUrl(input.remoteUrl ?? REPOSITORY_MATERIALIZATION_REMOTE_URL);
  const branch = input.branch ?? (productSource ? BETA_GATE_3_PRODUCT_BRANCH : REPOSITORY_MATERIALIZATION_BRANCH);
  if (productSource && branch !== BETA_GATE_3_PRODUCT_BRANCH) {
    throw new Error("Beta Gate 3 product materialization requires the exact main branch");
  }
  if (!productSource && branch !== REPOSITORY_MATERIALIZATION_BRANCH) {
    if (branch === REAL_SOURCE_BUG_FIXTURE_BRANCH) {
      assertFixtureScenarioBranch(branch);
      if (input.allowedScenarioBranch !== branch) throw new Error("Source materializer requires the exact approved Fixture scenario branch");
    } else {
      assertGitDeliveryBranch(branch);
      if (input.allowedDeliveryBranch !== branch) throw new Error("Source materializer requires the exact approved delivery branch");
    }
  }
  const expectedCommitSha = input.expectedCommitSha?.toLowerCase();
  if (expectedCommitSha && !/^[a-f0-9]{40}$/.test(expectedCommitSha)) {
    throw new Error("Expected Source Commit SHA is invalid");
  }
  const expectedParentCommitSha = input.expectedParentCommitSha?.toLowerCase();
  if (expectedParentCommitSha && !/^[a-f0-9]{40}$/.test(expectedParentCommitSha)) {
    throw new Error("Expected Source parent Commit SHA is invalid");
  }
  const signal = input.signal ?? new AbortController().signal;
  const materializerRoot = await mkdtemp(path.join(tmpdir(), "donelayer-build-source-"));
  assertDisposableRoot(materializerRoot);
  const repositoryRoot = path.join(materializerRoot, "repository");
  const isolatedHome = path.join(materializerRoot, "home");
  const hooksDirectory = path.join(materializerRoot, "empty-hooks");
  const templatesDirectory = path.join(materializerRoot, "empty-templates");
  const gitConfig = path.join(isolatedHome, ".gitconfig");
  let result: Omit<MaterializedSourcePackage, "materializerWorkspaceCleaned"> | null = null;
  let failure: SourceMaterializationError | null = null;
  let stage = "MATERIALIZER_INITIALIZATION";

  try {
    await Promise.all([
      mkdir(isolatedHome, { recursive: true, mode: 0o700 }),
      mkdir(hooksDirectory, { recursive: true, mode: 0o700 }),
      mkdir(templatesDirectory, { recursive: true, mode: 0o700 }),
    ]);
    await writeFile(gitConfig, "", { encoding: "utf8", mode: 0o600 });
    const environment = isolatedGitEnvironment(isolatedHome, gitConfig);
    const cloneArgs = [
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
      branch,
      "--no-tags",
      remoteUrl,
      repositoryRoot,
    ];
    const cloneStartedAt = new Date().toISOString();
    const cloneStartedMs = Date.now();
    stage = "GIT_CLONE";
    const clone = await runGit(cloneArgs, materializerRoot, environment, signal);
    const cloneFinishedAt = new Date().toISOString();
    const cloneDurationMs = Math.max(0, Date.now() - cloneStartedMs);
    if (clone.exitCode !== 0) {
      failure = new SourceMaterializationError(
        stage,
        clone.exitCode,
        sanitize(clone.stdout, materializerRoot),
        sanitize(clone.stderr, materializerRoot),
        `Git clone failed with exit code ${clone.exitCode}: ${sanitize(clone.stderr, materializerRoot) || "no stderr"}`,
      );
      throw failure;
    }

    stage = "REPOSITORY_IDENTITY";
    const [originResult, branchResult, commitResult] = await Promise.all([
      runGit(["remote", "get-url", "origin"], repositoryRoot, environment, signal),
      runGit(["branch", "--show-current"], repositoryRoot, environment, signal),
      runGit(["rev-parse", "HEAD"], repositoryRoot, environment, signal),
    ]);
    const origin = requiredGitValue("git remote get-url origin", originResult);
    const observedBranch = requiredGitValue("git branch --show-current", branchResult);
    const materializerCommitSha = requiredGitValue("git rev-parse HEAD", commitResult).toLowerCase();
    if (productSource) assertBetaGate3ProductRepositoryUrl(origin);
    else assertAllowlistedRepositoryUrl(origin);
    if (observedBranch !== branch || !/^[a-f0-9]{40}$/.test(materializerCommitSha)) {
      throw new Error("Materialized Repository identity is invalid");
    }
    const parentCommitSha = expectedParentCommitSha
      ? requiredGitValue("git rev-parse HEAD^", await runGit(["rev-parse", "HEAD^"], repositoryRoot, environment, signal)).toLowerCase()
      : null;
    if (expectedParentCommitSha && parentCommitSha !== expectedParentCommitSha) {
      throw new Error("SOURCE_PARENT_COMMIT_MISMATCH");
    }

    stage = "REMOTE_COMMIT_RESOLUTION";
    const remote = productSource
      ? await independentlyResolveProductRemoteCommit(
          BETA_GATE_3_PRODUCT_REMOTE_URL,
          BETA_GATE_3_PRODUCT_BRANCH,
          materializerRoot,
          environment,
          signal,
        )
      : branch === REPOSITORY_MATERIALIZATION_BRANCH
        ? independentlyResolveRemoteCommit(remoteUrl, branch)
        : branch === REAL_SOURCE_BUG_FIXTURE_BRANCH
          ? independentlyResolveScenarioRemoteCommit(remoteUrl, branch)
          : independentlyResolveDeliveryRemoteCommit(remoteUrl, branch);
    if (remote.commitSha !== materializerCommitSha) {
      throw new Error("Materializer Commit SHA does not match the independently resolved Remote main Commit SHA");
    }
    if (expectedCommitSha && remote.commitSha !== expectedCommitSha) {
      throw new Error(`SOURCE_COMMIT_CHANGED: Remote main is ${remote.commitSha}, expected ${expectedCommitSha}`);
    }

    stage = "SOURCE_PACKAGING";
    const files = await createManifestEntries(repositoryRoot, signal);
    const repositoryManifest = repositoryFileManifestSchema.parse({
      schemaVersion: 1,
      remoteUrl: origin,
      branch: observedBranch,
      commitSha: materializerCommitSha,
      files,
    });
    const created = await createSourcePackage({ repositoryRoot, repositoryManifest });
    if (
      created.identity.commitSha !== remote.commitSha ||
      created.identity.manifestSha256 !== repositoryManifestSha256(repositoryManifest)
    ) {
      throw new Error("Source Package identity does not match the verified Repository manifest");
    }

    const fixture = inspectManagedBuildTestPackageJson(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
    result = {
      ...created,
      repositoryManifest,
      repositoryManifestSha256: repositoryManifestSha256(repositoryManifest),
      materializerCommitSha,
      independentRemoteCommitSha: remote.commitSha,
      parentCommitSha,
      sourceFileCount: files.length,
      buildScriptPresent: fixture.buildScriptPresent,
      testScriptPresent: true,
      installLifecycleScriptsPresent: false,
      clone: {
        startedAt: cloneStartedAt,
        finishedAt: cloneFinishedAt,
        durationMs: cloneDurationMs,
        exitCode: 0,
        stdout: sanitize(clone.stdout, materializerRoot),
        stderr: sanitize(clone.stderr, materializerRoot),
      },
      remoteVerifiedAt: remote.verifiedAt,
    };
  } catch (error) {
    failure ??= new SourceMaterializationError(
      stage,
      null,
      "",
      "",
      sanitize(error instanceof Error ? error.message : String(error), materializerRoot),
      error,
    );
    throw failure;
  } finally {
    assertDisposableRoot(materializerRoot);
    await rm(materializerRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    if (failure) failure.materializerWorkspaceCleaned = !existsSync(materializerRoot);
  }

  if (!result || existsSync(materializerRoot)) {
    throw new Error("Source materializer workspace cleanup was not verified");
  }
  return { ...result, materializerWorkspaceCleaned: true };
}

async function independentlyResolveProductRemoteCommit(
  remoteUrl: typeof BETA_GATE_3_PRODUCT_REMOTE_URL,
  branch: typeof BETA_GATE_3_PRODUCT_BRANCH,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<{ commitSha: string; verifiedAt: string }> {
  const result = await runGit([
    "-c",
    "http.followRedirects=false",
    "-c",
    "credential.helper=",
    "ls-remote",
    "--exit-code",
    "--heads",
    remoteUrl,
    `refs/heads/${branch}`,
  ], cwd, environment, signal);
  if (result.exitCode !== 0) {
    throw new Error(`Independent product Source resolution failed with exit code ${result.exitCode}`);
  }
  const match = result.stdout.trim().match(/^([a-f0-9]{40})\s+refs\/heads\/main$/);
  if (!match) throw new Error("Independent product Source resolution returned invalid output");
  return { commitSha: match[1]!, verifiedAt: new Date().toISOString() };
}

export function sourceMaterializationFailureEvidence(error: unknown): SourceMaterializationFailureEvidence {
  if (error instanceof SourceMaterializationError) {
    return {
      errorType: error.errorType,
      stage: error.stage,
      exitCode: error.exitCode,
      stdout: error.stdout,
      stderr: error.stderr,
      message: error.message,
      materializerWorkspaceCleaned: error.materializerWorkspaceCleaned,
    };
  }
  return {
    errorType: "SOURCE_MATERIALIZATION_FAILURE",
    stage: "UNKNOWN",
    exitCode: null,
    stdout: "",
    stderr: "",
    message: error instanceof Error ? error.message : String(error),
    materializerWorkspaceCleaned: null,
  };
}

async function createManifestEntries(
  repositoryRootInput: string,
  signal: AbortSignal,
): Promise<RepositoryFileManifest["files"]> {
  const repositoryRoot = await realpath(repositoryRootInput);
  const entries: RepositoryFileManifest["files"] = [];

  async function visit(directory: string): Promise<void> {
    if (signal.aborted) throw signal.reason ?? new Error("Repository manifest cancelled");
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (child.name === ".git" || IGNORED_OS_FILES.has(child.name)) continue;
      const absolutePath = path.join(directory, child.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) throw new Error(`Repository symlink is forbidden: ${child.name}`);
      if (metadata.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!metadata.isFile()) throw new Error(`Unsupported repository entry: ${child.name}`);
      const resolved = await realpath(absolutePath);
      const relative = path.relative(repositoryRoot, resolved);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error("Repository file resolved outside the cloned workspace");
      }
      const relativePath = assertRepositoryRelativePath(relative.split(path.sep).join("/"));
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

export function inspectManagedBuildTestPackageJson(text: string): {
  buildScriptPresent: boolean;
} {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Fixture package.json is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fixture package.json is invalid");
  }
  const scripts = (value as Record<string, unknown>).scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    throw new Error("Fixture package.json must define scripts");
  }
  const commands = scripts as Record<string, unknown>;
  if (typeof commands.test !== "string" || !commands.test.trim()) {
    throw new Error("Fixture package.json must define a test script");
  }
  const installLifecycle = ["preinstall", "install", "postinstall", "prepare"].filter(
    (name) => typeof commands[name] === "string" && (commands[name] as string).trim().length > 0,
  );
  if (installLifecycle.length > 0) {
    throw new Error(`Fixture requires forbidden install lifecycle scripts: ${installLifecycle.join(", ")}`);
  }
  return {
    buildScriptPresent: typeof commands.build === "string" && commands.build.trim().length > 0,
  };
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
    const collect = (current: Buffer, chunk: Buffer) => current.byteLength >= MAX_GIT_OUTPUT_BYTES
      ? current
      : Buffer.concat([current, chunk.subarray(0, MAX_GIT_OUTPUT_BYTES - current.byteLength)]);
    child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); });
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
      resolve({ exitCode: code ?? 1, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") });
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
    ) environment[key] = value;
  }
  return environment;
}

function sanitize(value: string, materializerRoot: string): string {
  return value
    .replaceAll(materializerRoot, "<MATERIALIZER_WORKSPACE>")
    .replaceAll(materializerRoot.replaceAll("\\", "/"), "<MATERIALIZER_WORKSPACE>")
    .trim();
}

function assertDisposableRoot(candidate: string): void {
  const resolvedTemp = path.resolve(tmpdir());
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedTemp, resolvedCandidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Source materializer cleanup target escaped the system temp directory");
  }
}
