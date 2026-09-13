import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { Sandbox } from "@vercel/sandbox";
import {
  MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN,
  MANAGED_SANDBOX_EXECUTION_BACKEND,
  MANAGED_SANDBOX_PROVIDER,
  MANAGED_SANDBOX_RUNTIME,
  MANAGED_SANDBOX_SOURCE_PACKAGE_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE,
  MANAGED_SANDBOX_SOURCE_WORKDIR,
  MANAGED_SANDBOX_WORKDIR,
  REPOSITORY_MATERIALIZATION_BRANCH,
} from "@donelayer/worker-protocol";

import type { MaterializedSourcePackage } from "../managed-sandbox/repository-source";
import { assertSourcePackagePath, verifySourcePackage } from "../managed-sandbox/source-package";
import { managedBuildTestSourceRunner } from "../managed-sandbox/source-package-runner";
import {
  createContractAssertionRunner,
  parseContractAssertionRun,
  type ContractAssertionRun,
  type SemanticTaskContract,
} from "../semantic-verification/semantic-contract";
import type { TaskScopedAuthorityGuard } from "../task-scoped-authority/task-scoped-authority";

const require = createRequire(import.meta.url);
const sdkVersion = (require("@vercel/sandbox/package.json") as { version: string }).version;
const MAX_FILE_BYTES = 128 * 1024;
const MAX_PATCHED_FILES = 3;
const MAX_REPAIR_TESTS = 2;
const CONTRACT_ASSERTION_RUNNER_FILE = "contract-assertions.mjs";

type LiveSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

export type AgentRepairAuthorityGuard = Pick<
  TaskScopedAuthorityGuard,
  "assertSandboxAllowed" | "assertPatchAllowed" | "assertFixedTestsAllowed"
>;

export type AgentRepairTaskProfile = {
  taskType: "LEGACY_REPAIR" | "TEST_AND_FIX" | "BUILD_RESCUE" | "FEATURE_COMPLETION";
  primaryCommand: "npm test" | "npm run build" | "locked contract assertions";
  editableFiles: string[];
  sandboxPurpose?: "AGENT_REPAIR" | "INDEPENDENT_VERIFICATION";
  contractCheck?: BoundedContractCheck;
  installDependencies?: boolean;
  includeJobMetadataEnvironment?: boolean;
};

export type BoundedContractAssertion = {
  id: string;
  modulePath: string;
  exportName: string;
  args: unknown[];
  expected: unknown;
};

export type BoundedContractCheck = {
  assertions: BoundedContractAssertion[];
  assertionsSha256: string;
};

export type BoundedContractRun = {
  schemaVersion: 1;
  assertionsSha256: string;
  passed: number;
  failed: number;
  results: Array<{
    assertionId: string;
    args: unknown[];
    expected: unknown;
    actual: unknown;
    status: "PASSED" | "FAILED";
  }>;
};

const LEGACY_REPAIR_PROFILE: AgentRepairTaskProfile = {
  taskType: "LEGACY_REPAIR",
  primaryCommand: "npm test",
  editableFiles: ["src/add.ts"],
  sandboxPurpose: "AGENT_REPAIR",
};

export type RepairSandboxCommand = {
  commandId: string;
  command: string;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export type RepairSourceIntegrity = {
  checkedAt: string;
  baselineCommitSha: string;
  missing: string[];
  modified: Array<{ path: string; beforeSha256: string; afterSha256: string }>;
  added: string[];
  unauthorizedModified: string[];
};

export type RepairSandboxCleanup = {
  sandboxId: string;
  stopRequestedAt: string;
  stopConfirmedAt: string;
  finalProviderState: string;
  persistent: false;
  snapshotCreated: false;
  stillRunning: boolean;
  cleanupVerified: boolean;
  usage: {
    totalActiveCpuDurationMs: number | null;
    totalDurationMs: number | null;
    totalIngressBytes: number | null;
    totalEgressBytes: number | null;
    costUsd: null;
  };
};

export class VercelAgentRepairSandbox {
  private sandbox: LiveSandbox | null = null;
  private readonly baseline = new Map<string, Buffer>();
  private readonly patchedPaths = new Set<string>();
  private repairTestCount = 0;
  private baselineFailure: RepairSandboxCommand | null = null;

  constructor(
    private readonly runId: string,
    private readonly jobRunId: string,
    private readonly source: MaterializedSourcePackage,
    private readonly authorityGuard: AgentRepairAuthorityGuard | null = null,
    private readonly taskProfile: AgentRepairTaskProfile = LEGACY_REPAIR_PROFILE,
  ) {
    const verified = verifySourcePackage({
      sourcePackageBytes: source.sourcePackageBytes,
      sourcePackageManifestBytes: source.sourcePackageManifestBytes,
      expected: source.identity,
    });
    for (const file of verified.files) this.baseline.set(file.relativePath, Buffer.from(file.bytes));
    if (
      taskProfile.editableFiles.length < 1 ||
      taskProfile.editableFiles.some((filePath) => !this.baseline.has(filePath) || !isEditableAgentRepairPath(filePath, taskProfile.editableFiles))
    ) throw new Error("AGENT_REPAIR_TASK_PROFILE_INVALID");
    if (taskProfile.primaryCommand === "locked contract assertions") {
      assertBoundedContractCheck(taskProfile.contractCheck, taskProfile.editableFiles);
    } else if (taskProfile.contractCheck) {
      throw new Error("AGENT_REPAIR_TASK_PROFILE_INVALID");
    }
  }

  async start(): Promise<{
    sandboxId: string;
    runtime: string;
    region: string | null;
    networkPolicy: "deny-all";
    persistent: false;
    snapshot: false;
    sdkVersion: string;
    sourceVerification: Record<string, unknown>;
    install: RepairSandboxCommand;
    baselineTest: RepairSandboxCommand;
    baselineCommand: AgentRepairTaskProfile["primaryCommand"];
    taskType: AgentRepairTaskProfile["taskType"];
  }> {
    if (this.sandbox) throw new Error("AGENT_REPAIR_SANDBOX_ALREADY_STARTED");
    if (this.source.identity.branch !== REPOSITORY_MATERIALIZATION_BRANCH && !this.authorityGuard) {
      throw new Error("TASK_SCOPED_AUTHORITY_REQUIRED");
    }
    this.authorityGuard?.assertSandboxAllowed({
      purpose: this.taskProfile.sandboxPurpose ?? "AGENT_REPAIR",
      provider: MANAGED_SANDBOX_PROVIDER,
      executionBackend: MANAGED_SANDBOX_EXECUTION_BACKEND,
      requestedSandboxCount: 1,
    });
    const runner = managedBuildTestSourceRunner({
      identity: this.source.identity,
      buildScriptPresent: this.source.buildScriptPresent,
      allowedBranch: this.source.identity.branch,
    });
    const sandbox = await Sandbox.create({
      name: `donelayer-${(this.taskProfile.sandboxPurpose === "INDEPENDENT_VERIFICATION" ? "verify" : "agent-repair")}-${this.runId.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-").slice(0, 20)}`,
      runtime: MANAGED_SANDBOX_RUNTIME,
      timeout: 600_000,
      resources: { vcpus: 1 },
      networkPolicy: "deny-all",
      persistent: false,
      ports: [],
      env: this.taskProfile.includeJobMetadataEnvironment === false
        ? {}
        : {
            DONELAYER_JOB_ID: this.jobRunId,
            DONELAYER_SANDBOX_RUN_ID: this.runId,
          },
      tags: { owner: "donelayer", workflow: this.taskProfile.sandboxPurpose === "INDEPENDENT_VERIFICATION" ? "independent-verification-v1" : "agent-repair-v1" },
    });
    this.sandbox = sandbox;
    const session = sandbox.currentSession();
    if (sandbox.persistent || sandbox.routes.length !== 0 || session.networkPolicy !== "deny-all") {
      throw new Error("AGENT_REPAIR_SANDBOX_POLICY_MISMATCH");
    }
    await sandbox.writeFiles([
      { path: MANAGED_SANDBOX_SOURCE_PACKAGE_FILE, content: this.source.sourcePackageBytes, mode: 0o400 },
      { path: MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE, content: this.source.sourcePackageManifestBytes, mode: 0o400 },
      { path: MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE, content: runner, mode: 0o500 },
    ]);
    const prepare = await this.runFixed("prepare", "node", [
      `${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE}`,
      "prepare",
    ], MANAGED_SANDBOX_WORKDIR, 30_000);
    if (prepare.exitCode !== 0) throw new Error(`AGENT_REPAIR_SOURCE_PREPARE_FAILED: ${prepare.exitCode}`);
    const verificationBytes = await sandbox.readFileToBuffer({
      path: `${MANAGED_SANDBOX_WORKDIR}/source-package-verification.json`,
    });
    if (!verificationBytes) throw new Error("AGENT_REPAIR_SOURCE_VERIFICATION_MISSING");
    const sourceVerification = JSON.parse(verificationBytes.toString("utf8")) as Record<string, unknown>;

    if (this.taskProfile.contractCheck) {
      await sandbox.writeFiles([{
        path: `${MANAGED_SANDBOX_WORKDIR}/${CONTRACT_ASSERTION_RUNNER_FILE}`,
        content: Buffer.from(createBoundedContractRunner(this.taskProfile.contractCheck), "utf8"),
        mode: 0o500,
      }]);
    }

    let install: RepairSandboxCommand;
    if (this.taskProfile.installDependencies === false) {
      install = await this.runFixed(
        "dependency-install-not-required",
        "node",
        ["--version"],
        MANAGED_SANDBOX_SOURCE_WORKDIR,
        10_000,
      );
    } else {
      await session.update({ networkPolicy: { allow: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN] } });
      try {
        install = await this.runFixed(
          "install",
          "npm",
          ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
          MANAGED_SANDBOX_SOURCE_WORKDIR,
          120_000,
        );
      } finally {
        await session.update({ networkPolicy: "deny-all" });
      }
    }
    if (install.exitCode !== 0) throw new Error(`AGENT_REPAIR_INSTALL_FAILED: ${install.exitCode}`);
    const baselineTest = await this.runPrimary(
      this.taskProfile.primaryCommand === "npm test"
        ? "baseline-test"
        : this.taskProfile.primaryCommand === "npm run build"
          ? "baseline-build"
          : "baseline-contract-assertions",
    );
    if (baselineTest.exitCode === 0) throw new Error("AGENT_REPAIR_BASELINE_UNEXPECTED_PASS");
    this.baselineFailure = baselineTest;
    return {
      sandboxId: sandbox.name,
      runtime: sandbox.runtime ?? MANAGED_SANDBOX_RUNTIME,
      region: session.region || sandbox.region || null,
      networkPolicy: "deny-all",
      persistent: false,
      snapshot: false,
      sdkVersion,
      sourceVerification,
      install,
      baselineTest,
      baselineCommand: this.taskProfile.primaryCommand,
      taskType: this.taskProfile.taskType,
    };
  }

  listFiles(): Array<{ path: string; size: number; sha256: string; editable: boolean }> {
    this.required();
    return [...this.baseline.entries()].map(([path, bytes]) => ({
      path,
      size: bytes.byteLength,
      sha256: digest(bytes),
      editable: isEditableAgentRepairPath(path, this.taskProfile.editableFiles),
    }));
  }

  async readFile(path: string): Promise<{ path: string; content: string; sha256: string; size: number }> {
    const safePath = this.assertKnownPath(path);
    const bytes = await this.readSandboxFile(safePath);
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("AGENT_REPAIR_FILE_TOO_LARGE");
    return { path: safePath, content: bytes.toString("utf8"), sha256: digest(bytes), size: bytes.byteLength };
  }

  inspectTestFailure(): RepairSandboxCommand {
    if (!this.baselineFailure) throw new Error("AGENT_REPAIR_BASELINE_FAILURE_MISSING");
    return { ...this.baselineFailure };
  }

  async applyPatch(input: { path: string; expectedSha256: string; replacement: string }): Promise<{
    path: string;
    beforeSha256: string;
    afterSha256: string;
    size: number;
  }> {
    const safePath = this.assertKnownPath(input.path);
    this.authorityGuard?.assertPatchAllowed([safePath]);
    if (!isEditableAgentRepairPath(safePath, this.taskProfile.editableFiles)) throw new Error("AGENT_REPAIR_PATH_NOT_EDITABLE");
    if (!/^[a-f0-9]{64}$/.test(input.expectedSha256)) throw new Error("AGENT_REPAIR_EXPECTED_HASH_INVALID");
    const replacement = Buffer.from(input.replacement, "utf8");
    if (replacement.byteLength < 1 || replacement.byteLength > MAX_FILE_BYTES) throw new Error("AGENT_REPAIR_REPLACEMENT_SIZE_INVALID");
    if (!this.patchedPaths.has(safePath) && this.patchedPaths.size >= MAX_PATCHED_FILES) {
      throw new Error("AGENT_REPAIR_PATCH_FILE_LIMIT");
    }
    const before = await this.readSandboxFile(safePath);
    const beforeSha256 = digest(before);
    if (beforeSha256 !== input.expectedSha256) throw new Error("AGENT_REPAIR_STALE_FILE_HASH");
    await this.required().writeFiles([{
      path: `${MANAGED_SANDBOX_SOURCE_WORKDIR}/${safePath}`,
      content: replacement,
    }]);
    this.patchedPaths.add(safePath);
    return { path: safePath, beforeSha256, afterSha256: digest(replacement), size: replacement.byteLength };
  }

  async runTest(): Promise<RepairSandboxCommand> {
    this.authorityGuard?.assertFixedTestsAllowed();
    if (this.patchedPaths.size < 1) throw new Error("AGENT_REPAIR_TEST_REQUIRES_PATCH");
    if (this.repairTestCount >= MAX_REPAIR_TESTS) throw new Error("AGENT_REPAIR_TEST_LIMIT");
    this.repairTestCount += 1;
    return this.runPrimary(`repair-test-${this.repairTestCount}`);
  }

  async runBuild(): Promise<RepairSandboxCommand> {
    this.authorityGuard?.assertFixedTestsAllowed();
    if (!this.source.buildScriptPresent) throw new Error("AGENT_REPAIR_BUILD_NOT_PRESENT");
    if (this.patchedPaths.size < 1) throw new Error("AGENT_REPAIR_BUILD_REQUIRES_PATCH");
    return this.runFixed("repair-build", "npm", ["run", "build"], MANAGED_SANDBOX_SOURCE_WORKDIR, 60_000);
  }

  async getPatchedSourceFiles(): Promise<Array<{ path: string; content: string; sha256: string }>> {
    this.required();
    const files: Array<{ path: string; content: string; sha256: string }> = [];
    for (const filePath of [...this.patchedPaths].sort()) {
      const bytes = await this.readSandboxFile(filePath);
      files.push({ path: filePath, content: bytes.toString("utf8"), sha256: digest(bytes) });
    }
    return files;
  }

  async runContractAssertions(contract: SemanticTaskContract): Promise<{
    command: RepairSandboxCommand;
    result: ContractAssertionRun;
  }> {
    this.authorityGuard?.assertFixedTestsAllowed();
    const runner = createContractAssertionRunner(contract, { sourceRoot: "./source" });
    await this.required().writeFiles([{
      path: `${MANAGED_SANDBOX_WORKDIR}/${CONTRACT_ASSERTION_RUNNER_FILE}`,
      content: Buffer.from(runner, "utf8"),
      mode: 0o500,
    }]);
    const command = await this.runFixed(
      "independent-contract-assertions",
      "node",
      ["--experimental-strip-types", `${MANAGED_SANDBOX_WORKDIR}/${CONTRACT_ASSERTION_RUNNER_FILE}`],
      MANAGED_SANDBOX_WORKDIR,
      30_000,
    );
    const result = parseContractAssertionRun(command.stdout, contract);
    if (command.exitCode !== (result.failed === 0 ? 0 : 1)) throw new Error("CONTRACT_ASSERTION_EXIT_MISMATCH");
    return { command, result };
  }

  async getDiff(): Promise<{ patch: string; sha256: string; modifiedFiles: string[] }> {
    this.required();
    const pieces: string[] = [];
    const modifiedFiles: string[] = [];
    for (const path of [...this.patchedPaths].sort()) {
      const before = this.baseline.get(path)!;
      const after = await this.readSandboxFile(path);
      if (digest(before) === digest(after)) continue;
      modifiedFiles.push(path);
      pieces.push(wholeFilePatch(path, before.toString("utf8"), after.toString("utf8")));
    }
    const patch = pieces.join("");
    return { patch, sha256: digest(Buffer.from(patch, "utf8")), modifiedFiles };
  }

  async getSourceIntegrity(): Promise<RepairSourceIntegrity> {
    this.required();
    const missing: string[] = [];
    const modified: RepairSourceIntegrity["modified"] = [];
    for (const [path, before] of this.baseline) {
      try {
        const after = await this.readSandboxFile(path);
        const beforeSha256 = digest(before);
        const afterSha256 = digest(after);
        if (beforeSha256 !== afterSha256) modified.push({ path, beforeSha256, afterSha256 });
      } catch {
        missing.push(path);
      }
    }
    return {
      checkedAt: new Date().toISOString(),
      baselineCommitSha: this.source.materializerCommitSha,
      missing: missing.sort(),
      modified: modified.sort((left, right) => left.path.localeCompare(right.path)),
      added: [],
      unauthorizedModified: modified.filter((entry) => !this.patchedPaths.has(entry.path)).map((entry) => entry.path).sort(),
    };
  }

  async cleanup(): Promise<RepairSandboxCleanup> {
    const sandbox = this.required();
    const stopRequestedAt = new Date().toISOString();
    await sandbox.stop();
    const stopConfirmedAt = new Date().toISOString();
    const page = await Sandbox.list({ namePrefix: sandbox.name, sortBy: "name", sortOrder: "asc", limit: 10 });
    const observed = page.sandboxes.find((item) => item.name === sandbox.name);
    const finalProviderState = observed?.status ?? sandbox.status;
    const stillRunning = finalProviderState === "running" || finalProviderState === "pending" || finalProviderState === "stopping";
    const snapshotCreated = Boolean(observed?.currentSnapshotId || sandbox.currentSnapshotId);
    const cleanupVerified = !stillRunning && (observed?.persistent ?? sandbox.persistent) === false && !snapshotCreated;
    this.sandbox = null;
    return {
      sandboxId: sandbox.name,
      stopRequestedAt,
      stopConfirmedAt,
      finalProviderState,
      persistent: false,
      snapshotCreated: false,
      stillRunning,
      cleanupVerified,
      usage: observedUsage(observed ?? sandbox),
    };
  }

  async cleanupIfRunning(): Promise<RepairSandboxCleanup | null> {
    return this.sandbox ? this.cleanup() : null;
  }

  private required(): LiveSandbox {
    if (!this.sandbox) throw new Error("AGENT_REPAIR_SANDBOX_NOT_RUNNING");
    return this.sandbox;
  }

  private assertKnownPath(value: string): string {
    const safePath = assertSourcePackagePath(value);
    if (!this.baseline.has(safePath)) throw new Error("AGENT_REPAIR_PATH_NOT_IN_VERIFIED_SOURCE");
    return safePath;
  }

  private async readSandboxFile(path: string): Promise<Buffer> {
    const bytes = await this.required().readFileToBuffer({ path: `${MANAGED_SANDBOX_SOURCE_WORKDIR}/${path}` });
    if (!bytes) throw new Error("AGENT_REPAIR_FILE_MISSING");
    return bytes;
  }

  private async runFixed(
    label: string,
    cmd: "node" | "npm",
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<RepairSandboxCommand> {
    const startedAt = new Date().toISOString();
    const command = await this.required().runCommand({ cmd, args, cwd, timeoutMs });
    const stdout = bounded(await command.stdout());
    const stderr = bounded(await command.stderr());
    const finishedAt = new Date().toISOString();
    return {
      commandId: command.cmdId,
      command: label,
      exitCode: command.exitCode,
      startedAt,
      finishedAt,
      durationMs: command.durationMs ?? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      stdout,
      stderr,
    };
  }

  private runPrimary(label: string): Promise<RepairSandboxCommand> {
    if (this.taskProfile.primaryCommand === "locked contract assertions") {
      return this.runFixed(
        label,
        "node",
        ["--experimental-strip-types", `${MANAGED_SANDBOX_WORKDIR}/${CONTRACT_ASSERTION_RUNNER_FILE}`],
        MANAGED_SANDBOX_WORKDIR,
        30_000,
      );
    }
    return this.runFixed(
      label,
      "npm",
      this.taskProfile.primaryCommand === "npm test" ? ["test"] : ["run", "build"],
      MANAGED_SANDBOX_SOURCE_WORKDIR,
      60_000,
    );
  }
}

export function boundedContractAssertionsSha256(assertions: BoundedContractAssertion[]): string {
  return digest(Buffer.from(JSON.stringify(assertions), "utf8"));
}

export function parseBoundedContractRun(output: string, check: BoundedContractCheck): BoundedContractRun {
  assertBoundedContractCheck(check, [...new Set(check.assertions.map((item) => item.modulePath))]);
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  let parsed: unknown = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      parsed = JSON.parse(lines[index]!);
      break;
    } catch {
      // Fixed command chatter can precede the final structured result.
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AGENT_REPAIR_CONTRACT_RESULT_INVALID");
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    value.assertionsSha256 !== check.assertionsSha256 ||
    !Number.isSafeInteger(value.passed) ||
    !Number.isSafeInteger(value.failed) ||
    !Array.isArray(value.results) ||
    value.results.length !== check.assertions.length ||
    Number(value.passed) + Number(value.failed) !== check.assertions.length
  ) throw new Error("AGENT_REPAIR_CONTRACT_RESULT_INVALID");
  const expected = new Map(check.assertions.map((item) => [item.id, item]));
  const seen = new Set<string>();
  for (const raw of value.results) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AGENT_REPAIR_CONTRACT_RESULT_INVALID");
    const result = raw as Record<string, unknown>;
    const assertion = expected.get(String(result.assertionId));
    if (
      !assertion ||
      seen.has(assertion.id) ||
      JSON.stringify(result.args) !== JSON.stringify(assertion.args) ||
      JSON.stringify(result.expected) !== JSON.stringify(assertion.expected) ||
      (result.status !== "PASSED" && result.status !== "FAILED") ||
      (result.status === "PASSED" && JSON.stringify(result.actual) !== JSON.stringify(assertion.expected))
    ) throw new Error("AGENT_REPAIR_CONTRACT_RESULT_TAMPERED");
    seen.add(assertion.id);
  }
  return value as BoundedContractRun;
}

function assertBoundedContractCheck(
  check: BoundedContractCheck | undefined,
  editableFiles: string[],
): asserts check is BoundedContractCheck {
  if (
    !check ||
    check.assertions.length < 1 ||
    !/^[a-f0-9]{64}$/.test(check.assertionsSha256) ||
    boundedContractAssertionsSha256(check.assertions) !== check.assertionsSha256
  ) throw new Error("AGENT_REPAIR_CONTRACT_CHECK_INVALID");
  const ids = new Set<string>();
  for (const assertion of check.assertions) {
    if (
      !/^[a-z0-9][a-z0-9-]{0,79}$/.test(assertion.id) ||
      ids.has(assertion.id) ||
      !editableFiles.includes(assertion.modulePath) ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(assertion.exportName) ||
      JSON.stringify(assertion.args) === undefined ||
      JSON.stringify(assertion.expected) === undefined
    ) throw new Error("AGENT_REPAIR_CONTRACT_CHECK_INVALID");
    ids.add(assertion.id);
  }
}

function createBoundedContractRunner(check: BoundedContractCheck): string {
  assertBoundedContractCheck(check, [...new Set(check.assertions.map((item) => item.modulePath))]);
  const imports = [...new Map(check.assertions.map((item, index) => [
    `${item.modulePath}:${item.exportName}`,
    { modulePath: item.modulePath, exportName: item.exportName, localName: `target${index}` },
  ])).values()];
  const localByTarget = new Map(imports.map((item) => [`${item.modulePath}:${item.exportName}`, item.localName]));
  const assertions = check.assertions.map((item) => ({
    id: item.id,
    args: item.args,
    expected: item.expected,
    target: localByTarget.get(`${item.modulePath}:${item.exportName}`),
  }));
  return [
    ...imports.map((item) => `import { ${item.exportName} as ${item.localName} } from ${JSON.stringify(`./source/${item.modulePath}`)};`),
    `const assertionsSha256 = ${JSON.stringify(check.assertionsSha256)};`,
    `const assertions = ${JSON.stringify(assertions)};`,
    `const targets = { ${imports.map((item) => item.localName).join(", ")} };`,
    "const stable = (value) => JSON.stringify(value);",
    "const results = assertions.map((item) => {",
    "  const actual = targets[item.target](...item.args);",
    "  const status = stable(actual) === stable(item.expected) ? 'PASSED' : 'FAILED';",
    "  return { assertionId: item.id, args: item.args, expected: item.expected, actual, status };",
    "});",
    "const output = { schemaVersion: 1, assertionsSha256, passed: results.filter((item) => item.status === 'PASSED').length, failed: results.filter((item) => item.status === 'FAILED').length, results };",
    "console.log(JSON.stringify(output));",
    "if (output.failed > 0) process.exitCode = 1;",
    "",
  ].join("\n");
}

export function isEditableAgentRepairPath(path: string, allowedFiles?: string[]): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..") ||
    path.endsWith(".map") ||
    path.startsWith("tests/") ||
    path.startsWith("scripts/") ||
    path === "package.json" ||
    path === "package-lock.json"
  ) return false;
  return allowedFiles ? allowedFiles.includes(path) : path.startsWith("src/");
}

function bounded(value: string): string {
  if (Buffer.byteLength(value, "utf8") > 64 * 1024) throw new Error("AGENT_REPAIR_COMMAND_OUTPUT_LIMIT");
  return value;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function wholeFilePatch(path: string, before: string, after: string): string {
  const beforeLines = before.endsWith("\n") ? before.slice(0, -1).split("\n") : before.split("\n");
  const afterLines = after.endsWith("\n") ? after.slice(0, -1).split("\n") : after.split("\n");
  const oldCount = before === "" ? 0 : beforeLines.length;
  const newCount = after === "" ? 0 : afterLines.length;
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function observedUsage(sandbox: {
  totalActiveCpuDurationMs?: number | undefined;
  totalDurationMs?: number | undefined;
  totalIngressBytes?: number | undefined;
  totalEgressBytes?: number | undefined;
}): RepairSandboxCleanup["usage"] {
  return {
    totalActiveCpuDurationMs: sandbox.totalActiveCpuDurationMs ?? null,
    totalDurationMs: sandbox.totalDurationMs ?? null,
    totalIngressBytes: sandbox.totalIngressBytes ?? null,
    totalEgressBytes: sandbox.totalEgressBytes ?? null,
    costUsd: null,
  };
}
