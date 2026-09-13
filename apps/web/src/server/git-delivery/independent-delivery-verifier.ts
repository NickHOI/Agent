import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { Sandbox } from "@vercel/sandbox";
import { canonicalJson } from "@donelayer/database";
import {
  MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN,
  MANAGED_SANDBOX_RUNTIME,
  MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE,
  MANAGED_SANDBOX_SOURCE_WORKDIR,
  MANAGED_SANDBOX_WORKDIR,
  assertGitDeliveryBranch,
  type RepositoryFileManifest,
} from "@donelayer/worker-protocol";

import { materializeVerifiedSourcePackage } from "../managed-sandbox/repository-source";
import { managedBuildTestSourceRunner } from "../managed-sandbox/source-package-runner";
import { verifySourcePackage } from "../managed-sandbox/source-package";
import {
  createContractAssertionRunner,
  parseContractAssertionRun,
  type ContractAssertionRun,
  type SemanticTaskContract,
} from "../semantic-verification/semantic-contract";

const require = createRequire(import.meta.url);
const sdkVersion = (require("@vercel/sandbox/package.json") as { version: string }).version;

type LiveSandbox = Awaited<ReturnType<typeof Sandbox.create>>;

export type IndependentVerificationCommand = {
  commandId: string | null;
  command: "npm ci --ignore-scripts --no-audit --no-fund" | "npm run build" | "npm test" | "source-integrity" | "independent-contract-assertions";
  exitCode: number | null;
  status: "PASSED" | "FAILED" | "NOT_PRESENT" | "TIMED_OUT";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export type IndependentVerificationCleanup = {
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

export type IndependentDeliveryVerification = {
  verifierType: "NON_AI_DETERMINISTIC_VERIFIER";
  verifierRunId: string;
  verifiedAt: string;
  aiCallCount: 0;
  aiGatewayUsageUsd: 0;
  source: {
    remoteUrl: string;
    branch: string;
    deliveryCommitSha: string;
    independentRemoteCommitSha: string;
    parentCommitSha: string;
    manifestSha256: string;
    sourcePackageSha256: string;
    sourcePackageManifestSha256: string;
    fileCount: number;
    materializerWorkspaceCleaned: true;
  };
  antiCheating: {
    changedFiles: string[];
    testsManifestSha256Before: string;
    testsManifestSha256After: string;
    packageJsonSha256Before: string;
    packageJsonSha256After: string;
    testScriptBefore: string;
    testScriptAfter: string;
    testConfigurationSha256Before: string;
    testConfigurationSha256After: string;
    testsUnchanged: true;
    testScriptUnchanged: true;
    testConfigurationUnchanged: true;
    forbiddenTestMarkersAdded: false;
  };
  sandbox: {
    sandboxId: string;
    runtime: string;
    region: string | null;
    networkPolicy: "deny-all";
    persistent: false;
    snapshot: false;
    sdkVersion: string;
    sourceVerification: Record<string, unknown>;
  };
  install: IndependentVerificationCommand;
  build: IndependentVerificationCommand;
  test: IndependentVerificationCommand;
  contractAssertions: {
    command: IndependentVerificationCommand;
    result: ContractAssertionRun;
  } | null;
  sourceIntegrityCommand: IndependentVerificationCommand;
  sourceIntegrity: Record<string, unknown>;
  testStatistics: {
    status: "PARSED";
    runner: "node:test";
    total: number;
    passed: number;
    failed: number;
  };
  cleanup: IndependentVerificationCleanup;
  result: "PASSED";
};

export class IndependentDeliveryVerifier {
  async verify(input: {
    runId?: string;
    jobRunId: string;
    remoteUrl: string;
    deliveryBranch: string;
    deliveryCommitSha: string;
    baseCommitSha: string;
    baseManifest: RepositoryFileManifest;
    expectedSourceChanges: Array<{ path: string; afterSha256: string }>;
    expectedTestScript: string;
    repairSandboxId: string;
    semanticContract?: SemanticTaskContract;
  }): Promise<IndependentDeliveryVerification> {
    const verifierRunId = input.runId ?? randomUUID();
    const deliveryBranch = assertGitDeliveryBranch(input.deliveryBranch);
    const source = await materializeVerifiedSourcePackage({
      remoteUrl: input.remoteUrl,
      branch: deliveryBranch,
      allowedDeliveryBranch: deliveryBranch,
      expectedCommitSha: input.deliveryCommitSha,
      expectedParentCommitSha: input.baseCommitSha,
    });
    const verifiedSource = verifySourcePackage({
      sourcePackageBytes: source.sourcePackageBytes,
      sourcePackageManifestBytes: source.sourcePackageManifestBytes,
      expected: source.identity,
    });
    const packageJson = requiredSourceText(verifiedSource.files, "package.json");
    const testScriptAfter = parseTestScript(packageJson);
    const testSource = verifiedSource.files
      .filter((file) => file.relativePath.startsWith("tests/"))
      .map((file) => file.bytes.toString("utf8"))
      .join("\n");
    const forbiddenTestMarkersAdded = /\.(?:skip|only)\s*\(/.test(testSource);
    const antiCheating = verifySourceBoundary(
      input.baseManifest,
      source.repositoryManifest,
      input.expectedSourceChanges,
      input.expectedTestScript,
      testScriptAfter,
      forbiddenTestMarkersAdded,
    );
    const sandbox = new VerificationSandbox(verifierRunId, input.jobRunId, source, deliveryBranch, input.semanticContract ?? null);
    const execution = await sandbox.run();
    if (execution.sandbox.sandboxId === input.repairSandboxId) throw new Error("INDEPENDENT_VERIFICATION_REUSED_REPAIR_SANDBOX");
    if (
      execution.install.exitCode !== 0 ||
      (source.buildScriptPresent && execution.build.exitCode !== 0) ||
      execution.test.exitCode !== 0 ||
      (input.semanticContract && execution.contractAssertions?.result.failed !== 0) ||
      execution.sourceIntegrityCommand.exitCode !== 0 ||
      !execution.cleanup.cleanupVerified ||
      execution.sourceIntegrity.sourceMutationDetected !== false
    ) throw new Error("INDEPENDENT_VERIFICATION_FAILED");
    const testStatistics = parseTestStatistics(`${execution.test.stdout}\n${execution.test.stderr}`);
    if (testStatistics.failed !== 0 || testStatistics.passed !== testStatistics.total) {
      throw new Error("INDEPENDENT_VERIFICATION_FAILED: test statistics do not prove a complete pass");
    }
    return {
      verifierType: "NON_AI_DETERMINISTIC_VERIFIER",
      verifierRunId,
      verifiedAt: new Date().toISOString(),
      aiCallCount: 0,
      aiGatewayUsageUsd: 0,
      source: {
        remoteUrl: source.identity.remoteUrl,
        branch: source.identity.branch,
        deliveryCommitSha: source.materializerCommitSha,
        independentRemoteCommitSha: source.independentRemoteCommitSha,
        parentCommitSha: source.parentCommitSha!,
        manifestSha256: source.repositoryManifestSha256,
        sourcePackageSha256: source.sourcePackageSha256,
        sourcePackageManifestSha256: source.sourcePackageManifestSha256,
        fileCount: source.sourceFileCount,
        materializerWorkspaceCleaned: source.materializerWorkspaceCleaned,
      },
      antiCheating,
      sandbox: execution.sandbox,
      install: execution.install,
      build: execution.build,
      test: execution.test,
      contractAssertions: execution.contractAssertions,
      sourceIntegrityCommand: execution.sourceIntegrityCommand,
      sourceIntegrity: execution.sourceIntegrity,
      testStatistics,
      cleanup: execution.cleanup,
      result: "PASSED",
    };
  }
}

class VerificationSandbox {
  private sandbox: LiveSandbox | null = null;

  constructor(
    private readonly runId: string,
    private readonly jobRunId: string,
    private readonly source: Awaited<ReturnType<typeof materializeVerifiedSourcePackage>>,
    private readonly deliveryBranch: string,
    private readonly semanticContract: SemanticTaskContract | null,
  ) {}

  async run(): Promise<{
    sandbox: IndependentDeliveryVerification["sandbox"];
    install: IndependentVerificationCommand;
    build: IndependentVerificationCommand;
    test: IndependentVerificationCommand;
    contractAssertions: IndependentDeliveryVerification["contractAssertions"];
    sourceIntegrityCommand: IndependentVerificationCommand;
    sourceIntegrity: Record<string, unknown>;
    cleanup: IndependentVerificationCleanup;
  }> {
    let primaryError: unknown = null;
    let sandboxEvidence: IndependentDeliveryVerification["sandbox"] | null = null;
    let install: IndependentVerificationCommand | null = null;
    let build: IndependentVerificationCommand | null = null;
    let test: IndependentVerificationCommand | null = null;
    let contractAssertions: IndependentDeliveryVerification["contractAssertions"] = null;
    let sourceIntegrityCommand: IndependentVerificationCommand | null = null;
    let sourceIntegrity: Record<string, unknown> | null = null;
    let cleanup: IndependentVerificationCleanup | null = null;
    try {
      const sandbox = await Sandbox.create({
        name: `donelayer-delivery-verify-${this.runId.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-").slice(0, 22)}`,
        runtime: MANAGED_SANDBOX_RUNTIME,
        timeout: 300_000,
        resources: { vcpus: 1 },
        networkPolicy: "deny-all",
        persistent: false,
        ports: [],
        env: {
          DONELAYER_JOB_ID: this.jobRunId,
          DONELAYER_SANDBOX_RUN_ID: this.runId,
        },
        tags: { owner: "donelayer", workflow: "github-delivery-verify-v1" },
      });
      this.sandbox = sandbox;
      const session = sandbox.currentSession();
      if (sandbox.persistent || sandbox.routes.length !== 0 || session.networkPolicy !== "deny-all") {
        throw new Error("INDEPENDENT_VERIFICATION_SANDBOX_POLICY_MISMATCH");
      }
      const runner = managedBuildTestSourceRunner({
        identity: this.source.identity,
        buildScriptPresent: this.source.buildScriptPresent,
        allowedBranch: this.deliveryBranch,
      });
      await sandbox.writeFiles([
        { path: MANAGED_SANDBOX_SOURCE_PACKAGE_FILE, content: this.source.sourcePackageBytes, mode: 0o400 },
        { path: MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE, content: this.source.sourcePackageManifestBytes, mode: 0o400 },
        { path: MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE, content: runner, mode: 0o500 },
      ]);
      const prepare = await this.runFixed(
        "source-integrity",
        "node",
        [`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE}`, "prepare"],
        MANAGED_SANDBOX_WORKDIR,
        30_000,
      );
      if (prepare.exitCode !== 0) throw new Error("INDEPENDENT_SOURCE_PREPARE_FAILED");
      const verificationBytes = await sandbox.readFileToBuffer({ path: `${MANAGED_SANDBOX_WORKDIR}/source-package-verification.json` });
      if (!verificationBytes) throw new Error("INDEPENDENT_SOURCE_VERIFICATION_MISSING");
      const sourceVerification = JSON.parse(verificationBytes.toString("utf8")) as Record<string, unknown>;
      sandboxEvidence = {
        sandboxId: sandbox.name,
        runtime: sandbox.runtime ?? MANAGED_SANDBOX_RUNTIME,
        region: session.region || sandbox.region || null,
        networkPolicy: "deny-all",
        persistent: false,
        snapshot: false,
        sdkVersion,
        sourceVerification,
      };
      await session.update({ networkPolicy: { allow: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN] } });
      try {
        install = await this.runFixed(
          "npm ci --ignore-scripts --no-audit --no-fund",
          "npm",
          ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
          MANAGED_SANDBOX_SOURCE_WORKDIR,
          120_000,
        );
      } finally {
        await session.update({ networkPolicy: "deny-all" });
      }
      if (install.exitCode !== 0) throw new Error("INDEPENDENT_VERIFICATION_INSTALL_FAILED");
      build = this.source.buildScriptPresent
        ? await this.runFixed("npm run build", "npm", ["run", "build"], MANAGED_SANDBOX_SOURCE_WORKDIR, 60_000)
        : notPresentBuild();
      if (build.exitCode !== null && build.exitCode !== 0) throw new Error("INDEPENDENT_VERIFICATION_BUILD_FAILED");
      test = await this.runFixed("npm test", "npm", ["test"], MANAGED_SANDBOX_SOURCE_WORKDIR, 60_000);
      if (test.exitCode !== 0) throw new Error("INDEPENDENT_VERIFICATION_FAILED");
      if (this.semanticContract) {
        const runnerPath = `${MANAGED_SANDBOX_WORKDIR}/contract-assertions.mjs`;
        await sandbox.writeFiles([{
          path: runnerPath,
          content: Buffer.from(createContractAssertionRunner(this.semanticContract, { sourceRoot: "./source" }), "utf8"),
          mode: 0o500,
        }]);
        const command = await this.runFixed(
          "independent-contract-assertions",
          "node",
          ["--experimental-strip-types", runnerPath],
          MANAGED_SANDBOX_WORKDIR,
          30_000,
        );
        const result = parseContractAssertionRun(command.stdout, this.semanticContract);
        contractAssertions = { command, result };
        if (command.exitCode !== 0 || result.failed !== 0) throw new Error("INDEPENDENT_CONTRACT_VERIFICATION_FAILED");
      }
      sourceIntegrityCommand = await this.runFixed(
        "source-integrity",
        "node",
        [`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE}`, "verify"],
        MANAGED_SANDBOX_WORKDIR,
        30_000,
      );
      const integrityBytes = await sandbox.readFileToBuffer({ path: `${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE}` });
      if (!integrityBytes) throw new Error("INDEPENDENT_SOURCE_INTEGRITY_MISSING");
      sourceIntegrity = JSON.parse(integrityBytes.toString("utf8")) as Record<string, unknown>;
    } catch (error) {
      primaryError = error;
    } finally {
      if (this.sandbox) {
        try {
          cleanup = await this.cleanup();
        } catch (cleanupError) {
          primaryError ??= cleanupError;
        }
      }
    }
    if (primaryError) throw primaryError;
    if (!sandboxEvidence || !install || !build || !test || !sourceIntegrityCommand || !sourceIntegrity || !cleanup) {
      throw new Error("INDEPENDENT_VERIFICATION_EVIDENCE_INCOMPLETE");
    }
    return { sandbox: sandboxEvidence, install, build, test, contractAssertions, sourceIntegrityCommand, sourceIntegrity, cleanup };
  }

  private async runFixed(
    label: IndependentVerificationCommand["command"],
    cmd: "node" | "npm",
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<IndependentVerificationCommand> {
    const startedAt = new Date().toISOString();
    const command = await this.required().runCommand({ cmd, args, cwd, timeoutMs });
    const stdout = bounded(await command.stdout());
    const stderr = bounded(await command.stderr());
    const finishedAt = new Date().toISOString();
    const timedOut = command.exitCode === 124 || command.exitCode === 137;
    return {
      commandId: command.cmdId,
      command: label,
      exitCode: command.exitCode,
      status: timedOut ? "TIMED_OUT" : command.exitCode === 0 ? "PASSED" : "FAILED",
      startedAt,
      finishedAt,
      durationMs: command.durationMs ?? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      stdout,
      stderr,
    };
  }

  private async cleanup(): Promise<IndependentVerificationCleanup> {
    const sandbox = this.required();
    const stopRequestedAt = new Date().toISOString();
    await sandbox.stop();
    const stopConfirmedAt = new Date().toISOString();
    const page = await Sandbox.list({ namePrefix: sandbox.name, sortBy: "name", sortOrder: "asc", limit: 10 });
    const observed = page.sandboxes.find((item) => item.name === sandbox.name);
    const finalProviderState = observed?.status ?? sandbox.status;
    const stillRunning = ["running", "pending", "stopping"].includes(finalProviderState);
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
      usage: {
        totalActiveCpuDurationMs: observed?.totalActiveCpuDurationMs ?? sandbox.totalActiveCpuDurationMs ?? null,
        totalDurationMs: observed?.totalDurationMs ?? sandbox.totalDurationMs ?? null,
        totalIngressBytes: observed?.totalIngressBytes ?? sandbox.totalIngressBytes ?? null,
        totalEgressBytes: observed?.totalEgressBytes ?? sandbox.totalEgressBytes ?? null,
        costUsd: null,
      },
    };
  }

  private required(): LiveSandbox {
    if (!this.sandbox) throw new Error("INDEPENDENT_VERIFICATION_SANDBOX_NOT_RUNNING");
    return this.sandbox;
  }
}

function verifySourceBoundary(
  base: RepositoryFileManifest,
  delivered: RepositoryFileManifest,
  expectedSourceChanges: Array<{ path: string; afterSha256: string }>,
  testScriptBefore: string,
  testScriptAfter: string,
  forbiddenTestMarkersAdded: boolean,
): IndependentDeliveryVerification["antiCheating"] {
  const baseByPath = new Map(base.files.map((entry) => [entry.relative_path, entry]));
  const deliveredByPath = new Map(delivered.files.map((entry) => [entry.relative_path, entry]));
  const allPaths = [...new Set([...baseByPath.keys(), ...deliveredByPath.keys()])].sort();
  const changedFiles = allPaths.filter((filePath) => baseByPath.get(filePath)?.sha256 !== deliveredByPath.get(filePath)?.sha256);
  const expectedChanges = [...expectedSourceChanges].sort((left, right) => left.path.localeCompare(right.path));
  if (
    expectedChanges.length < 1 ||
    expectedChanges.some((change) => !change.path.startsWith("src/") || !/^[a-f0-9]{64}$/.test(change.afterSha256)) ||
    canonicalJson(changedFiles) !== canonicalJson(expectedChanges.map((change) => change.path)) ||
    expectedChanges.some((change) => deliveredByPath.get(change.path)?.sha256 !== change.afterSha256)
  ) throw new Error("DELIVERY_PATCH_MISMATCH");
  const baseTests = base.files.filter((entry) => entry.relative_path.startsWith("tests/"));
  const deliveredTests = delivered.files.filter((entry) => entry.relative_path.startsWith("tests/"));
  const testsManifestSha256Before = digest(canonicalJson(baseTests));
  const testsManifestSha256After = digest(canonicalJson(deliveredTests));
  const packageBefore = requiredEntry(base, "package.json");
  const packageAfter = requiredEntry(delivered, "package.json");
  const testConfigBefore = requiredEntry(base, "tsconfig.json");
  const testConfigAfter = requiredEntry(delivered, "tsconfig.json");
  if (
    testsManifestSha256Before !== testsManifestSha256After ||
    packageBefore.sha256 !== packageAfter.sha256 ||
    testConfigBefore.sha256 !== testConfigAfter.sha256 ||
    testScriptBefore !== testScriptAfter ||
    forbiddenTestMarkersAdded
  ) throw new Error("TEST_TAMPERING_DETECTED");
  return {
    changedFiles,
    testsManifestSha256Before,
    testsManifestSha256After,
    packageJsonSha256Before: packageBefore.sha256,
    packageJsonSha256After: packageAfter.sha256,
    testScriptBefore,
    testScriptAfter,
    testConfigurationSha256Before: testConfigBefore.sha256,
    testConfigurationSha256After: testConfigAfter.sha256,
    testsUnchanged: true,
    testScriptUnchanged: true,
    testConfigurationUnchanged: true,
    forbiddenTestMarkersAdded: false,
  };
}

function requiredEntry(manifest: RepositoryFileManifest, filePath: string) {
  const entry = manifest.files.find((candidate) => candidate.relative_path === filePath);
  if (!entry) throw new Error(`Required manifest entry is missing: ${filePath}`);
  return entry;
}

function requiredSourceText(
  files: Array<{ relativePath: string; bytes: Buffer }>,
  filePath: string,
): string {
  const file = files.find((candidate) => candidate.relativePath === filePath);
  if (!file) throw new Error(`Required Source file is missing: ${filePath}`);
  return file.bytes.toString("utf8");
}

function parseTestScript(text: string): string {
  const value = JSON.parse(text) as { scripts?: { test?: unknown } };
  if (typeof value.scripts?.test !== "string" || !value.scripts.test.trim()) {
    throw new Error("Fixture package.json test script is invalid");
  }
  return value.scripts.test;
}

function parseTestStatistics(output: string): IndependentDeliveryVerification["testStatistics"] {
  const count = (label: string): number | null => {
    const match = output.match(new RegExp(`^\\s*(?:#|\\u2139)\\s*${label}\\s+(\\d+)\\s*$`, "mu"));
    return match ? Number(match[1]) : null;
  };
  const total = count("tests");
  const passed = count("pass");
  const failed = count("fail");
  if (
    total === null || passed === null || failed === null ||
    !Number.isSafeInteger(total) || !Number.isSafeInteger(passed) || !Number.isSafeInteger(failed) ||
    total !== passed + failed
  ) throw new Error("INDEPENDENT_TEST_STATISTICS_UNPARSABLE");
  return { status: "PARSED", runner: "node:test", total, passed, failed };
}

function notPresentBuild(): IndependentVerificationCommand {
  const timestamp = new Date().toISOString();
  return {
    commandId: null,
    command: "npm run build",
    exitCode: null,
    status: "NOT_PRESENT",
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    stdout: "Build script is not present; no build command was executed.\n",
    stderr: "",
  };
}

function bounded(value: string): string {
  if (Buffer.byteLength(value, "utf8") > 64 * 1024) throw new Error("INDEPENDENT_VERIFICATION_OUTPUT_LIMIT");
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
