import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { sha256Canonical } from "@donelayer/database";
import {
  MANAGED_SANDBOX_EXECUTION_BACKEND,
  MANAGED_SANDBOX_PROVIDER,
} from "@donelayer/worker-protocol";

import type {
  AgentExecutionModel,
  AgentExecutionProvider,
  AgentRepairToolName,
  AgentRunResult,
} from "../../apps/web/src/server/agent-execution/provider";
import type {
  AgentRepairTaskProfile,
  RepairSandboxCleanup,
  RepairSandboxCommand,
  RepairSourceIntegrity,
} from "../../apps/web/src/server/agent-execution/vercel-agent-repair-sandbox";
import type { MaterializedSourcePackage } from "../../apps/web/src/server/managed-sandbox/repository-source";
import {
  assertReputationEntryCandidateJobV2Integrity,
} from "../../apps/web/src/server/reputation-entry-pilot/delivery-outcome-evidence";
import { ReputationEntryDurableStore } from "../../apps/web/src/server/reputation-entry-pilot/durable-store";
import {
  evaluateV2LiveOrchestratorDelivery,
  ReputationEntryPilotOrchestrator,
  type ReputationEntryPilotOutcome,
  type ReputationEntryPilotOutcomeV2,
  type ReputationEntryPilotSource,
  type ReputationEntryOrchestratorDependencies,
  type ReputationEntrySandboxController,
  type ReputationEntryV2PolicySelection,
} from "../../apps/web/src/server/reputation-entry-pilot/orchestrator";
import type { ReputationEntryCandidateJobV2 } from "../../apps/web/src/server/reputation-entry-pilot/delivery-outcome-evidence";
import type { TaskScopedAuthorityGuard } from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority";

type Scenario = {
  agentStatus: AgentRunResult["status"];
  makePatch: boolean;
  verificationPass: boolean;
};

const remoteUrl = "https://github.com/NickHOI/donelayer-build-rescue-fixture.git" as const;
const sources: [ReputationEntryPilotSource, ReputationEntryPilotSource] = [
  {
    taskType: "TEST_AND_FIX",
    taskDefinitionVersion: 2,
    branch: "donelayer/repair/reputation-state-transition-v2",
    commitSha: "1".repeat(40),
  },
  {
    taskType: "BUILD_RESCUE",
    taskDefinitionVersion: 2,
    branch: "donelayer/repair/reputation-build-config-v2",
    commitSha: "2".repeat(40),
  },
];
const sourceFiles: Record<string, Record<string, string>> = {
  [sources[0].branch]: {
    "package.json": "{\"scripts\":{\"test\":\"vitest run\"}}\n",
    "src/order-state.ts": "export const state = 'broken';\n",
    "tests/order-state.test.ts": "// locked order state oracle\n",
  },
  [sources[1].branch]: {
    "package.json": "{\"scripts\":{\"build\":\"tsc\",\"test\":\"vitest run\"}}\n",
    "scripts/verify-build-config.mjs": "// locked build oracle\n",
    "tests/runtime-config.test.ts": "// locked runtime oracle\n",
    "tsconfig.build.json": "{\"compilerOptions\":{\"moduleResolution\":\"node\"}}\n",
  },
};
const model: AgentExecutionModel = {
  id: "deterministic/no-network-model",
  name: "Deterministic no-network model adapter",
  provider: "test-only",
  type: "language",
  contextWindow: 8_192,
  maxOutputTokens: 4_096,
  pricing: { input: "0", output: "0", cachedInputTokens: "0" },
  supportsReasoning: false,
  supportsTools: true,
  isFree: true,
};
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("Verified Delivery V2 live orchestrator pre-live regression gate", () => {
  it("preserves execution, verification, and delivery outcomes through the real V2 lifecycle", async () => {
    const strict = policy("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED");
    const independent = policy("INDEPENDENT_ACCEPTANCE_SUFFICIENT");

    const strictRun = await runV2Batch(
      { agentStatus: "COMPLETED", makePatch: true, verificationPass: true },
      { agentStatus: "FAILED", makePatch: true, verificationPass: true },
      strict,
      91,
    );
    const strictCompleted = strictRun.outcome.jobs[0];
    const strictFailed = strictRun.outcome.jobs[1];
    expect(outcomes(strictCompleted)).toEqual(["COMPLETED", "VERIFIED", "VERIFIED_DELIVERY"]);
    expect(outcomes(strictFailed)).toEqual(["FAILED", "VERIFIED", "FAILED"]);

    const independentRun = await runV2Batch(
      { agentStatus: "FAILED", makePatch: true, verificationPass: true },
      { agentStatus: "CANCELLED", makePatch: false, verificationPass: true },
      independent,
      92,
    );
    const acceptedFailure = independentRun.outcome.jobs[0];
    const noDeliverable = independentRun.outcome.jobs[1];
    expect(outcomes(acceptedFailure)).toEqual(["FAILED", "VERIFIED", "VERIFIED_DELIVERY"]);
    expect(outcomes(noDeliverable)).toEqual(["INCONCLUSIVE", "NO_DELIVERABLE", "INCONCLUSIVE"]);
    expect(acceptedFailure.candidateEligible).toBe(true);
    expect(acceptedFailure.receipt.document.outcomes.execution).toBe("FAILED");
    expect(acceptedFailure.receipt.document.outcomes.delivery).toBe("VERIFIED_DELIVERY");
    expect(acceptedFailure.publicOutcomeSummary).toMatchObject({
      executionOutcome: "FAILED",
      independentVerificationOutcome: "VERIFIED",
      deliveryOutcome: "VERIFIED_DELIVERY",
      candidateEligible: true,
    });

    const verificationFailureRun = await runV2Batch(
      { agentStatus: "COMPLETED", makePatch: true, verificationPass: false },
      { agentStatus: "COMPLETED", makePatch: true, verificationPass: true },
      independent,
      93,
    );
    expect(outcomes(verificationFailureRun.outcome.jobs[0])).toEqual(["COMPLETED", "FAILED", "FAILED"]);

    for (const run of [strictRun, independentRun, verificationFailureRun]) {
      expect(run.outcome.limits.modelRequestsUsed).toBe(2);
      expect(run.outcome.limits.sandboxesCreated).toBe(4);
      expect(run.outcome.corpus.canonicalQualifyingJobCountAdded).toBe(0);
      for (const job of run.outcome.jobs) {
        expect(job.candidateEligible).toBe(job.outcomeEvaluation.deliveryOutcome === "VERIFIED_DELIVERY");
        expect(job.receipt.document.canonicalQualification.eligible).toBe(job.candidateEligible);
        expect(job.receipt.document.canonicalQualification.counted).toBe(false);
        expect(() => assertReputationEntryCandidateJobV2Integrity(job)).not.toThrow();
      }
    }

    const invalidAuthority = evaluateFromJob(strictCompleted, {
      authorityDecision: { ...strictCompleted.authorityDecision, decision: "DENIED" },
    });
    expect(invalidAuthority.deliveryOutcome).toBe("BLOCKED");
    expect(invalidAuthority.candidateEligible).toBe(false);
    expect(invalidAuthority.reasons).toContain("AUTHORITY_INVALID");

    const missingEvidence = evaluateFromJob(strictCompleted, {
      artifacts: strictCompleted.artifacts.filter((artifact) => artifact.evidenceKind !== "CREDENTIAL_SCAN"),
    });
    expect(missingEvidence.deliveryOutcome).toBe("BLOCKED");
    expect(missingEvidence.candidateEligible).toBe(false);
    expect(missingEvidence.reasons).toContain("REQUIRED_EVIDENCE_INCOMPLETE");

    await verifyReloadedV2(strictRun);
  }, 30_000);

  it("keeps the historical V1 completion rule unchanged", async () => {
    const run = await runV1Batch(
      { agentStatus: "FAILED", makePatch: true, verificationPass: true },
      { agentStatus: "COMPLETED", makePatch: true, verificationPass: true },
      94,
    );
    expect(run.jobs[0].agentRun.status).toBe("FAILED");
    expect(run.jobs[0].independentVerification.verified).toBe(true);
    expect(run.jobs[0].result).toBe("FAILED");
    expect(run.jobs[0].contract.schemaVersion).toBe(1);
    expect(run.jobs[0].receipt.document.schemaVersion).toBe(1);
  });
});

function policy(value: ReputationEntryV2PolicySelection["TEST_AND_FIX"]): ReputationEntryV2PolicySelection {
  return { TEST_AND_FIX: value, BUILD_RESCUE: value };
}

function outcomes(job: ReputationEntryCandidateJobV2): string[] {
  return [
    job.outcomeEvaluation.executionOutcome,
    job.outcomeEvaluation.independentVerificationOutcome,
    job.outcomeEvaluation.deliveryOutcome,
  ];
}

function evaluateFromJob(
  job: ReputationEntryCandidateJobV2,
  overrides: Partial<Parameters<typeof evaluateV2LiveOrchestratorDelivery>[0]>,
) {
  return evaluateV2LiveOrchestratorDelivery({
    contract: job.contract,
    agentRun: job.agentRun,
    patch: job.patch,
    allowedFiles: job.contract.authorityPolicy!.allowedFiles,
    repairSourceIntegrity: job.repairSourceIntegrity,
    independentVerification: job.independentVerification,
    authorityDecision: job.authorityDecision,
    terminalLease: job.terminalLease,
    authorityOperations: job.authorityOperations,
    repairSandboxId: job.repairSandbox.sandboxId,
    repairCleanup: job.repairSandbox.cleanup,
    artifacts: job.artifacts,
    ...overrides,
  });
}

async function runV2Batch(
  testScenario: Scenario,
  buildScenario: Scenario,
  policies: ReputationEntryV2PolicySelection,
  attempt: number,
): Promise<{ outcome: ReputationEntryPilotOutcomeV2; databasePath: string; markerPath: string }> {
  const root = await makeRoot();
  const databasePath = path.join(root, "v2.sqlite");
  const markerPath = path.join(root, "historical-marker.json");
  await writeFile(markerPath, "{\"historical\":true}\n", "utf8");
  const store = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: markerPath });
  const scenarios = [testScenario, buildScenario];
  let providerIndex = 0;
  const scenarioByTask = { TEST_AND_FIX: testScenario, BUILD_RESCUE: buildScenario } as const;
  try {
    const orchestrator = new ReputationEntryPilotOrchestrator(
      store,
      { attemptId: `PHASE_B_ATTEMPT_${attempt}`, batchRecordId: `pre-live-v2-${attempt}-${randomUUID()}` },
      () => new DeterministicProvider(scenarios[providerIndex++]!),
      deterministicDependencies(scenarioByTask),
    );
    const outcome = await orchestrator.runV2(sources, policies);
    expect(store.verifyAll().valid).toBe(true);
    return { outcome, databasePath, markerPath };
  } finally {
    store.close();
  }
}

async function runV1Batch(
  testScenario: Scenario,
  buildScenario: Scenario,
  attempt: number,
): Promise<ReputationEntryPilotOutcome> {
  const root = await makeRoot();
  const markerPath = path.join(root, "historical-marker.json");
  await writeFile(markerPath, "{\"historical\":true}\n", "utf8");
  const store = new ReputationEntryDurableStore(path.join(root, "v1.sqlite"), { historicalMarkerPath: markerPath });
  const scenarios = [testScenario, buildScenario];
  let providerIndex = 0;
  try {
    return await new ReputationEntryPilotOrchestrator(
      store,
      { attemptId: `PHASE_B_ATTEMPT_${attempt}`, batchRecordId: `pre-live-v1-${attempt}-${randomUUID()}` },
      () => new DeterministicProvider(scenarios[providerIndex++]!),
      deterministicDependencies({ TEST_AND_FIX: testScenario, BUILD_RESCUE: buildScenario }),
    ).run(sources);
  } finally {
    store.close();
  }
}

async function verifyReloadedV2(run: {
  outcome: ReputationEntryPilotOutcomeV2;
  databasePath: string;
  markerPath: string;
}): Promise<void> {
  const store = new ReputationEntryDurableStore(run.databasePath, {
    historicalMarkerPath: run.markerPath,
    readOnly: true,
  });
  try {
    expect(store.verifyAll().valid).toBe(true);
    for (const job of run.outcome.jobs) {
      const recovery = store.recoverJob(job.jobId);
      expect(recovery.integrityValid).toBe(true);
      expect(recovery.recordTypes).toEqual(expect.arrayContaining([
        "WORK_CONTRACT",
        "AGENT_MODEL_RUN",
        "VERIFIER_RESULT",
        "DELIVERY_OUTCOME_EVALUATION",
        "EVIDENCE_BUNDLE_FINAL",
        "EVIDENCE_LEDGER_FINAL",
        "VERIFIED_JOB_RECEIPT",
        "PILOT_OUTCOME",
      ]));
      expect(store.getRecord("WORK_CONTRACT", job.contract.taskId, 2)?.payload).toEqual(job.contract);
      expect(store.getRecord("DELIVERY_OUTCOME_EVALUATION", `${job.jobId}:delivery-outcome`, 1)?.payload).toEqual(job.outcomeEvaluation);
      expect(store.getRecord("EVIDENCE_BUNDLE_FINAL", job.evidenceBundle.bundleSha256, 2)?.payload).toEqual(job.evidenceBundle);
      expect(store.getRecord("VERIFIED_JOB_RECEIPT", job.receipt.id, 2)?.payload).toEqual(job.receipt);
      const persisted = store.getRecord("PILOT_OUTCOME", `${job.jobId}:candidate-outcome`, 2)?.payload as ReputationEntryCandidateJobV2;
      expect(() => assertReputationEntryCandidateJobV2Integrity(persisted)).not.toThrow();
      expect(persisted.outcomeEvaluation).toEqual(job.outcomeEvaluation);
      expect(persisted.candidateEligible).toBe(job.candidateEligible);
    }
  } finally {
    store.close();
  }
}

function deterministicDependencies(
  scenarios: Record<"TEST_AND_FIX" | "BUILD_RESCUE", Scenario>,
): ReputationEntryOrchestratorDependencies {
  return {
    materializeSource: async (input = {}) => {
      const approved = sources.find((source) => source.branch === input.branch);
      if (!approved || approved.commitSha !== input.expectedCommitSha) throw new Error("DETERMINISTIC_SOURCE_NOT_APPROVED");
      return materializedSource(approved);
    },
    createSandbox: (input: {
      runId: string;
      source: MaterializedSourcePackage;
      authorityGuard: TaskScopedAuthorityGuard;
      taskProfile: AgentRepairTaskProfile;
    }): ReputationEntrySandboxController => {
      if (
        input.taskProfile.taskType !== "TEST_AND_FIX" &&
        input.taskProfile.taskType !== "BUILD_RESCUE"
      ) throw new Error("DETERMINISTIC_TASK_UNSUPPORTED");
      return new DeterministicSandbox(
        input.runId,
        input.source,
        input.authorityGuard,
        input.taskProfile,
        scenarios[input.taskProfile.taskType],
      );
    },
  };
}

class DeterministicProvider implements AgentExecutionProvider {
  constructor(private readonly scenario: Scenario) {}

  async checkAvailability() {
    return {
      available: true,
      checkedAt: now(),
      adapter: "DeterministicProvider",
      gateway: "NO_NETWORK_TEST_ADAPTER",
      authentication: "VERCEL_OIDC" as const,
      credits: { balance: "0", totalUsed: "0" },
      eligibleModelCount: 1,
      errorCode: null,
      errorMessage: null,
    };
  }

  async listEligibleModels() { return [model]; }

  async createRun(input: Parameters<AgentExecutionProvider["createRun"]>[0]): Promise<AgentRunResult> {
    await input.onModelRequest?.({
      requestSequence: 1,
      requestedAt: now(),
      modelId: model.id,
      provider: model.provider,
      tag: input.tag,
    });
    const toolNames: AgentRepairToolName[] = [];
    const call = async <T>(name: AgentRepairToolName, value: unknown): Promise<T> => {
      toolNames.push(name);
      return await input.tools[name].execute(value) as T;
    };
    if (this.scenario.makePatch) {
      const listed = await call<{ files: Array<{ path: string; editable: boolean }> }>("list_files", {});
      await call("inspect_test_failure", {});
      const editable = listed.files.find((file) => file.editable);
      if (!editable) throw new Error("DETERMINISTIC_EDITABLE_FILE_MISSING");
      const before = await call<{ path: string; sha256: string }>("read_file", { path: editable.path });
      await call("apply_patch", {
        path: editable.path,
        expectedSha256: before.sha256,
        replacement: `// deterministic accepted repair for ${editable.path}\n`,
      });
      if (editable.path === "tsconfig.build.json") {
        await call("run_build", {});
        await call("run_test", {});
      } else {
        await call("run_test", {});
      }
      await call("get_diff", {});
      await call("get_source_integrity", {});
    }
    const timestamp = now();
    return {
      runId: randomUUID(),
      status: this.scenario.agentStatus,
      model,
      text: "deterministic pre-live adapter result",
      finishReason: this.scenario.agentStatus === "FAILED" ? "agent_error" : this.scenario.agentStatus.toLowerCase(),
      stepCount: toolNames.length,
      toolNames,
      responseIds: [randomUUID()],
      usage: {
        apiRequestCount: 1,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        gatewayReportedCostUsd: 0,
      },
      startedAt: timestamp,
      finishedAt: timestamp,
    };
  }

  async continueRun(): Promise<AgentRunResult> { throw new Error("NOT_USED"); }
  async cancelRun(): Promise<void> {}
  async getUsage() { return null; }
  async getCredits() { return { balance: "0", totalUsed: "0" }; }
  getProviderMetadata() {
    return {
      adapter: "DeterministicProvider",
      gateway: "NO_NETWORK_TEST_ADAPTER",
      sdkPackage: "none",
      sdkVersion: "test",
      authentication: "VERCEL_OIDC" as const,
      directOpenAIStatus: "DEFERRED_OPTIONAL" as const,
    };
  }
}

class DeterministicSandbox implements ReputationEntrySandboxController {
  private readonly files: Map<string, string>;
  private readonly baseline: Map<string, string>;
  private readonly patched = new Set<string>();
  private started = false;

  constructor(
    private readonly runId: string,
    private readonly source: MaterializedSourcePackage,
    private readonly authorityGuard: TaskScopedAuthorityGuard,
    private readonly taskProfile: AgentRepairTaskProfile,
    private readonly scenario: Scenario,
  ) {
    this.files = new Map(Object.entries(sourceFiles[source.identity.branch]!));
    this.baseline = new Map(this.files);
  }

  async start() {
    this.authorityGuard.assertSandboxAllowed({
      purpose: this.taskProfile.sandboxPurpose ?? "AGENT_REPAIR",
      provider: MANAGED_SANDBOX_PROVIDER,
      executionBackend: MANAGED_SANDBOX_EXECUTION_BACKEND,
    });
    this.started = true;
    return {
      sandboxId: `deterministic-${this.runId}`,
      runtime: "node22",
      region: "local-test",
      networkPolicy: "deny-all" as const,
      persistent: false as const,
      snapshot: false as const,
      sdkVersion: "test",
      sourceVerification: { verified: true },
      install: command(`${this.runId}-install`, "npm install", 0),
      baselineTest: command(`${this.runId}-baseline`, this.taskProfile.primaryCommand, 1),
      baselineCommand: this.taskProfile.primaryCommand,
      taskType: this.taskProfile.taskType,
    };
  }

  listFiles() {
    this.requireStarted();
    return [...this.files].map(([filePath, content]) => ({
      path: filePath,
      size: Buffer.byteLength(content),
      sha256: digest(content),
      editable: this.taskProfile.editableFiles.includes(filePath),
    }));
  }

  async readFile(filePath: string) {
    this.requireStarted();
    const content = this.files.get(filePath);
    if (content === undefined) throw new Error("DETERMINISTIC_FILE_MISSING");
    return { path: filePath, content, sha256: digest(content), size: Buffer.byteLength(content) };
  }

  inspectTestFailure() { return command(`${this.runId}-baseline`, this.taskProfile.primaryCommand, 1); }

  async applyPatch(input: { path: string; expectedSha256: string; replacement: string }) {
    this.requireStarted();
    this.authorityGuard.assertPatchAllowed([input.path]);
    const before = this.files.get(input.path);
    if (before === undefined || digest(before) !== input.expectedSha256) throw new Error("DETERMINISTIC_STALE_PATCH");
    this.files.set(input.path, input.replacement);
    this.patched.add(input.path);
    return {
      path: input.path,
      beforeSha256: digest(before),
      afterSha256: digest(input.replacement),
      size: Buffer.byteLength(input.replacement),
    };
  }

  async runTest() { return this.verificationCommand("npm test"); }
  async runBuild() { return this.verificationCommand("npm run build"); }

  async getDiff() {
    this.requireStarted();
    const modifiedFiles = [...this.patched].filter((filePath) => this.baseline.get(filePath) !== this.files.get(filePath)).sort();
    const patch = modifiedFiles.map((filePath) => wholeFilePatch(filePath, this.baseline.get(filePath)!, this.files.get(filePath)!)).join("");
    return { patch, sha256: digest(patch), modifiedFiles };
  }

  async getSourceIntegrity(): Promise<RepairSourceIntegrity> {
    this.requireStarted();
    const modified = [...this.baseline]
      .filter(([filePath, before]) => before !== this.files.get(filePath))
      .map(([filePath, before]) => ({ path: filePath, beforeSha256: digest(before), afterSha256: digest(this.files.get(filePath)!) }))
      .sort((left, right) => left.path.localeCompare(right.path));
    return {
      checkedAt: now(),
      baselineCommitSha: this.source.identity.commitSha,
      missing: [],
      modified,
      added: [],
      unauthorizedModified: modified.filter((item) => !this.taskProfile.editableFiles.includes(item.path)).map((item) => item.path),
    };
  }

  async getPatchedSourceFiles() {
    return Promise.all([...this.patched].sort().map(async (filePath) => {
      const file = await this.readFile(filePath);
      return { path: file.path, content: file.content, sha256: file.sha256 };
    }));
  }

  async cleanupIfRunning(): Promise<RepairSandboxCleanup | null> {
    if (!this.started) return null;
    this.started = false;
    const timestamp = now();
    return {
      sandboxId: `deterministic-${this.runId}`,
      stopRequestedAt: timestamp,
      stopConfirmedAt: timestamp,
      finalProviderState: "stopped",
      persistent: false,
      snapshotCreated: false,
      stillRunning: false,
      cleanupVerified: true,
      usage: {
        totalActiveCpuDurationMs: 0,
        totalDurationMs: 0,
        totalIngressBytes: 0,
        totalEgressBytes: 0,
        costUsd: null,
      },
    };
  }

  private async verificationCommand(commandName: string): Promise<RepairSandboxCommand> {
    this.requireStarted();
    this.authorityGuard.assertFixedTestsAllowed();
    const verifier = this.taskProfile.sandboxPurpose === "INDEPENDENT_VERIFICATION";
    const exitCode = verifier && !this.scenario.verificationPass ? 1 : 0;
    return command(`${this.runId}-${commandName.replaceAll(" ", "-")}`, commandName, exitCode);
  }

  private requireStarted(): void {
    if (!this.started) throw new Error("DETERMINISTIC_SANDBOX_NOT_STARTED");
  }
}

function materializedSource(source: ReputationEntryPilotSource): MaterializedSourcePackage {
  const files = Object.entries(sourceFiles[source.branch]!).map(([relative_path, content]) => ({
    relative_path,
    size_bytes: Buffer.byteLength(content),
    sha256: digest(content),
  })).sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  const repositoryManifest = {
    schemaVersion: 1 as const,
    remoteUrl,
    branch: source.branch,
    commitSha: source.commitSha,
    files,
  };
  const repositoryManifestSha256 = sha256Canonical(repositoryManifest);
  const sourcePackageSha256 = digest(`package:${source.commitSha}`);
  const sourcePackageManifestSha256 = digest(`manifest:${source.commitSha}`);
  return {
    sourcePackageBytes: Buffer.from("deterministic source package"),
    sourcePackageSha256,
    sourcePackageManifest: {
      schemaVersion: 1,
      format: "DONELAYER_SOURCE_PACKAGE_JSON_V1",
      remoteUrl,
      branch: source.branch,
      commitSha: source.commitSha,
      fileCount: files.length,
      totalSourceBytes: files.reduce((total, file) => total + file.size_bytes, 0),
      files,
      manifestSha256: repositoryManifestSha256,
      sourcePackageSha256,
    },
    sourcePackageManifestBytes: Buffer.from("deterministic source package manifest"),
    sourcePackageManifestSha256,
    identity: {
      remoteUrl,
      branch: source.branch,
      commitSha: source.commitSha,
      manifestSha256: repositoryManifestSha256,
      sourcePackageSha256,
      sourcePackageManifestSha256,
    },
    repositoryManifest,
    repositoryManifestSha256,
    materializerCommitSha: source.commitSha,
    independentRemoteCommitSha: source.commitSha,
    parentCommitSha: null,
    sourceFileCount: files.length,
    buildScriptPresent: source.taskType === "BUILD_RESCUE",
    testScriptPresent: true,
    installLifecycleScriptsPresent: false,
    clone: { startedAt: now(), finishedAt: now(), durationMs: 0, exitCode: 0, stdout: "", stderr: "" },
    remoteVerifiedAt: now(),
    materializerWorkspaceCleaned: true,
  };
}

function command(commandId: string, commandName: string, exitCode: number): RepairSandboxCommand {
  const timestamp = now();
  return {
    commandId,
    command: commandName,
    exitCode,
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: 0,
    stdout: exitCode === 0 ? "ok" : "expected deterministic failure",
    stderr: "",
  };
}

function wholeFilePatch(filePath: string, before: string, after: string): string {
  const beforeLines = before.endsWith("\n") ? before.slice(0, -1).split("\n") : before.split("\n");
  const afterLines = after.endsWith("\n") ? after.slice(0, -1).split("\n") : after.split("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "donelayer-v2-prelive-"));
  temporaryRoots.push(root);
  return root;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function now(): string {
  return new Date().toISOString();
}
