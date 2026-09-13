import { createHash, randomBytes, randomUUID } from "node:crypto";

import { canonicalJson, computeEvidenceLedgerEntryHash } from "@donelayer/database";
import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  REAL_SOURCE_BUG_FIXTURE_BRANCH,
} from "@donelayer/worker-protocol";

import {
  assertAgentExecutionBinding,
  type AgentExecutionIdentity,
} from "../agent-identity/execution-identity";
import { materializeVerifiedSourcePackage } from "../managed-sandbox/repository-source";
import { verifySourcePackage } from "../managed-sandbox/source-package";
import {
  assertSemanticContractIntegrity,
  inspectRepositoryTestOracle,
  type ContractAssertionRun,
  type SemanticTaskContract,
  type TestOracleInspection,
} from "../semantic-verification/semantic-contract";
import {
  requireTaskScopedAuthorityGuard,
  TASK_SCOPED_AUTHORITY_AGENT_ID,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
  type TaskScopedAuthorityOperationEvidence,
  type TaskScopedPermissionLease,
} from "../task-scoped-authority/task-scoped-authority";
import type {
  AgentExecutionModel,
  AgentExecutionProvider,
  AgentGatewayCredits,
  AgentRunResult,
} from "./provider";
import { createAgentRepairTools, type AgentRepairToolCallEvidence } from "./repair-tools";
import {
  VercelAgentRepairSandbox,
  type RepairSandboxCleanup,
  type RepairSandboxCommand,
  type RepairSourceIntegrity,
} from "./vercel-agent-repair-sandbox";

export const AGENT_REPAIR_GATE = "AGENT_REPAIR_IN_MANAGED_SANDBOX_GATE_V1" as const;
export const AGENT_REPAIR_FIXTURE_COMMIT = "600f326ce373160eb5495aaef72230d4c9807e8f" as const;

export type AgentRepairInput = {
  branch?: typeof REPOSITORY_MATERIALIZATION_BRANCH | typeof REAL_SOURCE_BUG_FIXTURE_BRANCH;
  expectedCommitSha?: string;
  semanticContract?: SemanticTaskContract;
  authorityLease?: TaskScopedPermissionLease;
  executionIdentity?: AgentExecutionIdentity;
};

export type AgentRepairArtifact = {
  id: string;
  fileName: string;
  mimeType: "application/json" | "text/plain";
  size: number;
  sha256: string;
  content: string;
};

export type AgentRepairLedgerEntry = {
  id: string;
  sequenceNumber: number;
  entryType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  entrySha256: string;
  createdAt: string;
};

export type AgentRepairLedgerVerification = {
  valid: boolean;
  entryCount: number;
  chainSha256: string | null;
};

export type AgentRepairReceipt = {
  schemaVersion: 1;
  receiptType: "AGENT_REPAIR_MANAGED_SANDBOX_VERIFICATION";
  publicReceiptId: string;
  gate: typeof AGENT_REPAIR_GATE;
  finalResult: "VERIFIED" | "CONTRACT_VERIFIED" | "FAILED";
  gateway: "Vercel AI Gateway";
  agentProviderAdapter: "VercelAIGatewayAgentProvider";
  authentication: "VERCEL_OIDC" | "AI_GATEWAY_API_KEY";
  modelProvider: string;
  modelId: string;
  freeCreditBalanceBefore: string;
  freeCreditUsed: string | null;
  freeCreditBalanceAfter: string;
  apiRequestCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  gatewayReportedCostUsd: number | null;
  source: {
    remoteUrl: string;
    branch: string;
    commitSha: string;
    manifestSha256: string;
    sourcePackageSha256: string;
  };
  execution: {
    orchestrator: "DONE_LAYER_SERVER";
    backend: "MANAGED_REMOTE_SANDBOX";
    sandboxProvider: "VERCEL_SANDBOX";
    sandboxId: string;
    networkPolicy: "deny-all";
    localHostExecutionUsed: false;
    localDockerUsed: false;
    cleanupVerified: boolean;
  };
  authority?: {
    leaseId: string;
    version: number;
    authoritySha256: string;
    workContract: TaskScopedPermissionLease["authority"]["workContract"];
    subject: TaskScopedPermissionLease["authority"]["subject"];
    operations: TaskScopedAuthorityOperationEvidence[];
  };
  identity?: {
    agent: AgentExecutionIdentity["agent"];
    executionId: string;
    executionSha256: string;
  };
  repair: {
    baselineTestExitCode: number;
    repairedTestExitCode: number | null;
    patchSha256: string;
    modifiedFiles: string[];
    toolCallCount: number;
    toolNames: string[];
    sourceIntegrity: RepairSourceIntegrity;
    semanticVerification: {
      testOracleInspection: TestOracleInspection;
      contractAssertionCommand: RepairSandboxCommand;
      contractAssertionRun: ContractAssertionRun;
    } | null;
  };
  artifacts: Array<{ id: string; fileName: string; mimeType: string; size: number; sha256: string }>;
  verificationChecks: Array<{ id: string; status: "PASSED" | "FAILED"; summary: string }>;
  evidenceLedger: AgentRepairLedgerVerification;
  issuedAt: string;
};

export type AgentRepairOutcome = {
  gate: typeof AGENT_REPAIR_GATE;
  runId: string;
  jobRunId: string;
  status: "VERIFIED" | "BOUNDED_FAILURE";
  preflight: {
    checkedAt: string;
    authentication: "VERCEL_OIDC" | "AI_GATEWAY_API_KEY";
    creditsBefore: AgentGatewayCredits;
    selectedModel: AgentExecutionModel;
    eligibleModels: AgentExecutionModel[];
  };
  source: {
    remoteUrl: string;
    branch: string;
    materializerCommitSha: string;
    independentRemoteCommitSha: string;
    repositoryManifestSha256: string;
    sourcePackageManifestSha256: string;
    sourcePackageSha256: string;
    sourceFileCount: number;
    buildScriptPresent: boolean;
    materializerWorkspaceCleaned: true;
  };
  semanticPreflight: TestOracleInspection | null;
  sandbox: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>>;
  agentRun: AgentRunResult;
  toolCalls: AgentRepairToolCallEvidence[];
  repairedTest: RepairSandboxCommand | null;
  build: RepairSandboxCommand | null;
  patch: { patch: string; sha256: string; modifiedFiles: string[] };
  sourceIntegrity: RepairSourceIntegrity;
  contractAssertionCommand: RepairSandboxCommand | null;
  contractAssertionRun: ContractAssertionRun | null;
  cleanup: RepairSandboxCleanup;
  creditsAfter: AgentGatewayCredits;
  artifacts: AgentRepairArtifact[];
  ledgerEntries: AgentRepairLedgerEntry[];
  ledgerVerification: AgentRepairLedgerVerification;
  receipt: {
    id: string;
    publicReceiptId: string;
    result: "VERIFIED" | "CONTRACT_VERIFIED" | "FAILED";
    receiptSha256: string;
    evidenceChainSha256: string;
    document: AgentRepairReceipt;
  };
  publicReceipt: {
    publicReceiptId: string;
    taskType: "Agent Repair in Managed Sandbox Verification";
    result: "VERIFIED" | "CONTRACT_VERIFIED" | "FAILED";
    verificationStatus: "VALID" | "INVALID";
    gateway: "Vercel AI Gateway";
    modelProvider: string;
    modelId: string;
    agentProviderAdapter: "VercelAIGatewayAgentProvider";
    cleanupVerified: boolean;
    patchSha256: string;
  };
  executionIdentity: AgentExecutionIdentity | null;
  authority: {
    leaseId: string;
    version: number;
    authoritySha256: string;
    workContractSha256: string;
    operations: TaskScopedAuthorityOperationEvidence[];
  } | null;
};

export class AgentRepairOrchestrator {
  private liveRuns = 0;

  constructor(private readonly agentProvider: AgentExecutionProvider) {}

  async run(input: AgentRepairInput = {}): Promise<AgentRepairOutcome> {
    if (this.liveRuns >= 1) throw new Error("AGENT_REPAIR_LIVE_RUN_LIMIT");
    const targetCommit = (input.expectedCommitSha ?? AGENT_REPAIR_FIXTURE_COMMIT).toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(targetCommit)) throw new Error("AGENT_REPAIR_SOURCE_COMMIT_INVALID");
    const targetBranch = input.branch ?? REPOSITORY_MATERIALIZATION_BRANCH;
    if (input.semanticContract?.assignedAgent) {
      if (!input.authorityLease) throw new Error("TASK_SCOPED_AUTHORITY_REQUIRED");
      if (!input.executionIdentity) throw new Error("AGENT_EXECUTION_IDENTITY_REQUIRED");
      assertAgentExecutionBinding({
        execution: input.executionIdentity,
        contract: input.semanticContract,
        authorityLease: input.authorityLease,
      });
    }
    const authorityOperations: TaskScopedAuthorityOperationEvidence[] = [];
    const authorityGuard = input.semanticContract
      ? requireTaskScopedAuthorityGuard(input.authorityLease, {
          contract: input.semanticContract,
          subject: {
            agentId: input.semanticContract.assignedAgent?.agentId ?? TASK_SCOPED_AUTHORITY_AGENT_ID,
            executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
            jobRunId: input.authorityLease?.authority.subject.jobRunId ?? "missing-authority",
            ...(input.semanticContract.assignedAgent ? { agentIdentity: input.semanticContract.assignedAgent } : {}),
            ...(input.executionIdentity ? { executionId: input.executionIdentity.executionId } : {}),
          },
          onDecision: (operation) => authorityOperations.push({ ...operation, sequence: authorityOperations.length + 1 }),
        })
      : null;
    authorityGuard?.assertRepositoryReadAllowed({
      remoteUrl: input.semanticContract!.remoteUrl,
      baseRef: targetBranch,
      commitSha: targetCommit,
    });
    const source = await materializeVerifiedSourcePackage({
      branch: targetBranch,
      expectedCommitSha: targetCommit,
      ...(targetBranch === REAL_SOURCE_BUG_FIXTURE_BRANCH ? { allowedScenarioBranch: targetBranch } : {}),
    });
    if (source.materializerCommitSha !== targetCommit || source.independentRemoteCommitSha !== targetCommit) {
      throw new Error("AGENT_REPAIR_SOURCE_IDENTITY_MISMATCH");
    }
    let semanticPreflight: TestOracleInspection | null = null;
    if (input.semanticContract) {
      assertSemanticContractIntegrity(input.semanticContract);
      if (input.semanticContract.commitSha !== targetCommit || input.semanticContract.branch !== targetBranch) {
        throw new Error("SEMANTIC_CONTRACT_SOURCE_IDENTITY_MISMATCH");
      }
      const verifiedSource = verifySourcePackage({
        sourcePackageBytes: source.sourcePackageBytes,
        sourcePackageManifestBytes: source.sourcePackageManifestBytes,
        expected: source.identity,
      });
      semanticPreflight = inspectRepositoryTestOracle({
        contract: input.semanticContract,
        files: verifiedSource.files.map((file) => ({ filePath: file.relativePath, content: file.bytes.toString("utf8") })),
      });
      if (semanticPreflight.outcome !== "CONTRACT_VERIFIED") {
        throw new Error(`SEMANTIC_PREFLIGHT_${semanticPreflight.outcome}: ${semanticPreflight.summary}`);
      }
    }
    const availability = await this.agentProvider.checkAvailability();
    if (!availability.available || !availability.credits || availability.authentication === "UNAVAILABLE") {
      throw new Error(`${availability.errorCode ?? "AI_GATEWAY_UNAVAILABLE"}: ${availability.errorMessage ?? "preflight failed"}`);
    }
    const eligibleModels = await this.agentProvider.listEligibleModels();
    const selectedModel = eligibleModels[0];
    if (!selectedModel) throw new Error("AI_GATEWAY_FREE_USAGE_UNAVAILABLE: no eligible free tool-capable model");
    const creditsBefore = await this.agentProvider.getCredits();
    if (Number(creditsBefore.balance) <= 0) throw new Error("AI_GATEWAY_FREE_USAGE_UNAVAILABLE: credit balance is not positive");
    this.liveRuns += 1;

    const runId = randomUUID();
    const jobRunId = input.authorityLease?.authority.subject.jobRunId ?? randomUUID();

    const sandboxController = new VercelAgentRepairSandbox(runId, jobRunId, source, authorityGuard);
    let sandbox: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>> | null = null;
    let cleanup: RepairSandboxCleanup | null = null;
    let agentRun: AgentRunResult | null = null;
    let toolCalls: AgentRepairToolCallEvidence[] = [];
    let repairedTest: RepairSandboxCommand | null = null;
    let build: RepairSandboxCommand | null = null;
    let patch = { patch: "", sha256: sha256(""), modifiedFiles: [] as string[] };
    let sourceIntegrity: RepairSourceIntegrity | null = null;
    let contractAssertionCommand: RepairSandboxCommand | null = null;
    let contractAssertionRun: ContractAssertionRun | null = null;
    let creditsAfter = creditsBefore;

    try {
      sandbox = await sandboxController.start();
      authorityGuard?.assertActionAllowedWithEvidence("modify_src_add");
      const repairTools = createAgentRepairTools(sandboxController);
      agentRun = await this.agentProvider.createRun({
        model: selectedModel,
        instructions: repairInstructions(),
        prompt: repairPrompt(source.materializerCommitSha, sandbox.baselineTest),
        tools: repairTools.tools,
        maxSteps: 12,
        providerRetryLimit: 1,
        tag: `donelayer-agent-repair-${runId}`,
      });
      toolCalls = [...repairTools.calls];
      repairedTest = repairTools.getLastRepairTest();
      patch = await sandboxController.getDiff();
      sourceIntegrity = await sandboxController.getSourceIntegrity();
      if (input.semanticContract && repairedTest?.exitCode === 0) {
        const semantic = await sandboxController.runContractAssertions(input.semanticContract);
        contractAssertionCommand = semantic.command;
        contractAssertionRun = semantic.result;
      }
      if (repairedTest?.exitCode === 0 && source.buildScriptPresent) build = await sandboxController.runBuild();
      creditsAfter = await this.agentProvider.getCredits();
    } finally {
      if (sandbox) cleanup = await sandboxController.cleanup();
    }

    if (!sandbox || !cleanup || !agentRun || !sourceIntegrity) {
      throw new Error("AGENT_REPAIR_INCOMPLETE: the bounded live run did not produce complete evidence");
    }
    const verified = repairedTest?.exitCode === 0 &&
      (!source.buildScriptPresent || build?.exitCode === 0) &&
      patch.modifiedFiles.length > 0 &&
      sourceIntegrity.missing.length === 0 &&
      sourceIntegrity.added.length === 0 &&
      sourceIntegrity.unauthorizedModified.length === 0 &&
      (!input.semanticContract || contractAssertionRun?.failed === 0) &&
      cleanup.cleanupVerified;
    const artifacts = buildArtifacts({ sandbox, agentRun, toolCalls, repairedTest, build, patch, sourceIntegrity, cleanup, creditsBefore, creditsAfter, semanticPreflight, contractAssertionCommand, contractAssertionRun });
    assertNoCredentialLeak({ agentRun, toolCalls, artifacts, cleanup });
    const ledgerEntries: AgentRepairLedgerEntry[] = [];
    const append = (entryType: string, sourceRecordType: string, sourceRecordId: string, payload: unknown, createdAt = new Date().toISOString()) => {
      const previousEntrySha256 = ledgerEntries.at(-1)?.entrySha256 ?? null;
      const entry = {
        id: randomUUID(),
        sequenceNumber: ledgerEntries.length + 1,
        entryType,
        sourceRecordType,
        sourceRecordId,
        payloadSha256: sha256(canonicalJson(payload)),
        previousEntrySha256,
        entrySha256: "",
        createdAt,
      };
      entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
      ledgerEntries.push(entry);
    };
    append("CONTRACT_LOCKED", "agent_repair_run", runId, { gate: AGENT_REPAIR_GATE, commitSha: targetCommit, branch: targetBranch });
    if (input.semanticContract && semanticPreflight) {
      append("CONTRACT_ASSERTIONS_LOCKED", "semantic_task_contract", input.semanticContract.taskId, {
        assertionsSha256: input.semanticContract.assertionsSha256,
        assertionCount: input.semanticContract.assertions.length,
      }, input.semanticContract.lockedAt);
      append("TEST_ORACLE_INSPECTED", "repository_test_oracle", targetCommit, semanticPreflight);
    }
    if (input.executionIdentity) {
      append("AGENT_EXECUTION_IDENTITY_CREATED", "agent_execution_identity", input.executionIdentity.executionId, input.executionIdentity, input.executionIdentity.startedAt);
      append("IDENTITY_BINDING_VERIFIED", "agent_identity", input.executionIdentity.agent.agentId, {
        agent: input.executionIdentity.agent,
        executionId: input.executionIdentity.executionId,
        executionSha256: input.executionIdentity.executionSha256,
      }, input.executionIdentity.startedAt);
    }
    append("PERMISSION_GRANTED", input.authorityLease ? "permission_lease" : "agent_repair_run", input.authorityLease?.id ?? runId, input.authorityLease
      ? {
          leaseId: input.authorityLease.id,
          version: input.authorityLease.version,
          authoritySha256: input.authorityLease.authoritySha256,
          workContract: input.authorityLease.authority.workContract,
          subject: input.authorityLease.authority.subject,
        }
      : { tools: Object.keys(createAgentRepairTools(sandboxController).tools), maxLiveRuns: 1, providerRetryLimit: 1 });
    for (const operation of authorityOperations) {
      append(operation.decision === "ALLOWED" ? "PROTECTED_ACTION_ALLOWED" : "PROTECTED_ACTION_DENIED", "task_scoped_authority_operation", `${runId}:${operation.sequence}`, operation, operation.recordedAt);
    }
    append("SOURCE_PACKAGE_VERIFIED", "source_package", source.sourcePackageSha256, { commitSha: source.materializerCommitSha, sourcePackageSha256: source.sourcePackageSha256 });
    append("MANAGED_SANDBOX_CREATED", "managed_sandbox", sandbox.sandboxId, { sandboxId: sandbox.sandboxId, networkPolicy: sandbox.networkPolicy, persistent: false });
    append("DEPENDENCY_INSTALL_COMPLETED", "managed_sandbox_command", sandbox.install.commandId, commandLedgerPayload(sandbox.install));
    append("BASELINE_TEST_FAILED", "managed_sandbox_command", sandbox.baselineTest.commandId, commandLedgerPayload(sandbox.baselineTest));
    append("AGENT_MODEL_RUN_COMPLETED", "agent_run", agentRun.runId, { modelId: agentRun.model.id, usage: agentRun.usage, toolNames: agentRun.toolNames });
    for (const call of toolCalls) append("AGENT_TOOL_CALLED", "agent_tool_call", `${runId}:${call.sequence}`, call, call.finishedAt);
    append(repairedTest?.exitCode === 0 ? "REPAIR_TEST_PASSED" : "REPAIR_TEST_FAILED", "managed_sandbox_command", repairedTest?.commandId ?? runId, repairedTest ? commandLedgerPayload(repairedTest) : { missing: true });
    append("PATCH_CREATED", "repair_patch", patch.sha256, { sha256: patch.sha256, modifiedFiles: patch.modifiedFiles });
    append("SOURCE_INTEGRITY_VERIFIED", "source_integrity", runId, sourceIntegrity, sourceIntegrity.checkedAt);
    if (contractAssertionRun) {
      append("SEMANTIC_VERIFICATION_STARTED", "semantic_verification", runId, { assertionsSha256: contractAssertionRun.assertionsSha256 });
      for (const assertion of contractAssertionRun.results) {
        append(assertion.status === "PASSED" ? "CONTRACT_ASSERTION_PASSED" : "CONTRACT_ASSERTION_FAILED", "contract_assertion", assertion.assertionId, assertion);
      }
      append(contractAssertionRun.failed === 0 ? "SEMANTIC_VERIFICATION_PASSED" : "ENGINEERING_REVIEW_REQUIRED", "semantic_verification", runId, contractAssertionRun);
    }
    append("MANAGED_SANDBOX_CLEANUP_VERIFIED", "managed_sandbox", sandbox.sandboxId, cleanup, cleanup.stopConfirmedAt);
    for (const artifact of artifacts) append("ARTIFACT_HASH_VERIFIED", "evidence_artifact", artifact.id, { fileName: artifact.fileName, sha256: artifact.sha256, size: artifact.size });
    append(verified ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED", "agent_repair_run", runId, { verified, cleanupVerified: cleanup.cleanupVerified, repairedTestExitCode: repairedTest?.exitCode ?? null });
    const preReceiptLedger = verifyLedger(ledgerEntries);
    const receiptId = randomUUID();
    const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
    const receiptDocument: AgentRepairReceipt = {
      schemaVersion: 1,
      receiptType: "AGENT_REPAIR_MANAGED_SANDBOX_VERIFICATION",
      publicReceiptId,
      gate: AGENT_REPAIR_GATE,
      finalResult: verified ? (input.semanticContract ? "CONTRACT_VERIFIED" : "VERIFIED") : "FAILED",
      gateway: "Vercel AI Gateway",
      agentProviderAdapter: "VercelAIGatewayAgentProvider",
      authentication: availability.authentication,
      modelProvider: selectedModel.provider,
      modelId: selectedModel.id,
      freeCreditBalanceBefore: creditsBefore.balance,
      freeCreditUsed: decimalDifference(creditsBefore.balance, creditsAfter.balance),
      freeCreditBalanceAfter: creditsAfter.balance,
      apiRequestCount: agentRun.usage.apiRequestCount,
      inputTokens: agentRun.usage.inputTokens,
      outputTokens: agentRun.usage.outputTokens,
      cachedTokens: agentRun.usage.cachedInputTokens,
      gatewayReportedCostUsd: agentRun.usage.gatewayReportedCostUsd,
      source: {
        remoteUrl: source.identity.remoteUrl,
        branch: source.identity.branch,
        commitSha: targetCommit,
        manifestSha256: source.repositoryManifestSha256,
        sourcePackageSha256: source.sourcePackageSha256,
      },
      execution: {
        orchestrator: "DONE_LAYER_SERVER",
        backend: "MANAGED_REMOTE_SANDBOX",
        sandboxProvider: "VERCEL_SANDBOX",
        sandboxId: sandbox.sandboxId,
        networkPolicy: "deny-all",
        localHostExecutionUsed: false,
        localDockerUsed: false,
        cleanupVerified: cleanup.cleanupVerified,
      },
      ...(input.authorityLease
        ? {
            authority: {
              leaseId: input.authorityLease.id,
              version: input.authorityLease.version,
              authoritySha256: input.authorityLease.authoritySha256,
              workContract: input.authorityLease.authority.workContract,
              subject: input.authorityLease.authority.subject,
              operations: authorityOperations,
            },
          }
        : {}),
      ...(input.executionIdentity
        ? {
            identity: {
              agent: input.executionIdentity.agent,
              executionId: input.executionIdentity.executionId,
              executionSha256: input.executionIdentity.executionSha256,
            },
          }
        : {}),
      repair: {
        baselineTestExitCode: sandbox.baselineTest.exitCode,
        repairedTestExitCode: repairedTest?.exitCode ?? null,
        patchSha256: patch.sha256,
        modifiedFiles: patch.modifiedFiles,
        toolCallCount: toolCalls.length,
        toolNames: toolCalls.map((call) => call.toolName),
        sourceIntegrity,
        semanticVerification: semanticPreflight && contractAssertionCommand && contractAssertionRun
          ? { testOracleInspection: semanticPreflight, contractAssertionCommand, contractAssertionRun }
          : null,
      },
      artifacts: artifacts.map(({ content: _content, ...artifact }) => artifact),
      verificationChecks: [
        check("baseline-test-failed", sandbox.baselineTest.exitCode !== 0, "The exact fixture failed before repair."),
        check("real-agent-tool-use", agentRun.usage.apiRequestCount > 0 && toolCalls.some((call) => call.toolName === "apply_patch"), "A live Gateway model used DoneLayer controlled tools."),
        check("repaired-test-passed", repairedTest?.exitCode === 0, "The repaired source passed npm test in the same Sandbox."),
        check("source-integrity-bounded", sourceIntegrity.unauthorizedModified.length === 0 && sourceIntegrity.missing.length === 0, "Only approved source paths changed."),
        ...(input.semanticContract
          ? [check("contract-assertions-passed", contractAssertionRun?.failed === 0, "Independent locked Contract assertions passed in the repair Sandbox.")]
          : []),
        check("sandbox-cleanup", cleanup.cleanupVerified, "The non-persistent Sandbox was stopped and cleanup was verified."),
      ],
      evidenceLedger: preReceiptLedger,
      issuedAt: new Date().toISOString(),
    };
    const receiptSha256 = sha256(canonicalJson(receiptDocument));
    append("RECEIPT_CREATED", "job_receipt", receiptId, { receiptSha256, evidenceChainSha256: preReceiptLedger.chainSha256 }, receiptDocument.issuedAt);
    const ledgerVerification = verifyLedger(ledgerEntries);
    const publicReceipt = {
      publicReceiptId,
      taskType: "Agent Repair in Managed Sandbox Verification" as const,
      result: receiptDocument.finalResult,
      verificationStatus: ledgerVerification.valid &&
        ledgerEntries.at(-1)?.previousEntrySha256 === preReceiptLedger.chainSha256 &&
        ledgerEntries.at(-1)?.payloadSha256 === sha256(canonicalJson({ receiptSha256, evidenceChainSha256: preReceiptLedger.chainSha256 }))
        ? "VALID" as const
        : "INVALID" as const,
      gateway: "Vercel AI Gateway" as const,
      modelProvider: selectedModel.provider,
      modelId: selectedModel.id,
      agentProviderAdapter: "VercelAIGatewayAgentProvider" as const,
      cleanupVerified: cleanup.cleanupVerified,
      patchSha256: patch.sha256,
    };
    return {
      gate: AGENT_REPAIR_GATE,
      runId,
      jobRunId,
      status: verified ? "VERIFIED" : "BOUNDED_FAILURE",
      preflight: { checkedAt: availability.checkedAt, authentication: availability.authentication, creditsBefore, selectedModel, eligibleModels },
      source: {
        remoteUrl: source.identity.remoteUrl,
        branch: source.identity.branch,
        materializerCommitSha: source.materializerCommitSha,
        independentRemoteCommitSha: source.independentRemoteCommitSha,
        repositoryManifestSha256: source.repositoryManifestSha256,
        sourcePackageManifestSha256: source.sourcePackageManifestSha256,
        sourcePackageSha256: source.sourcePackageSha256,
        sourceFileCount: source.sourceFileCount,
        buildScriptPresent: source.buildScriptPresent,
        materializerWorkspaceCleaned: source.materializerWorkspaceCleaned,
      },
      semanticPreflight,
      sandbox,
      agentRun,
      toolCalls,
      repairedTest,
      build,
      patch,
      sourceIntegrity,
      contractAssertionCommand,
      contractAssertionRun,
      cleanup,
      creditsAfter,
      artifacts,
      ledgerEntries,
      ledgerVerification,
      receipt: { id: receiptId, publicReceiptId, result: receiptDocument.finalResult, receiptSha256, evidenceChainSha256: preReceiptLedger.chainSha256!, document: receiptDocument },
      publicReceipt,
      executionIdentity: input.executionIdentity ?? null,
      authority: input.authorityLease
        ? {
            leaseId: input.authorityLease.id,
            version: input.authorityLease.version,
            authoritySha256: input.authorityLease.authoritySha256,
            workContractSha256: input.authorityLease.authority.workContract.sha256,
            operations: authorityOperations,
          }
        : null,
    };
  }
}

function repairInstructions(): string {
  return `You are the DoneLayer repair Agent for one bounded verification Gate. Work only through the supplied tools.
Required sequence: list_files, inspect_test_failure, read the relevant test and source files, apply_patch to an editable src/ file, run_test, then get_diff and get_source_integrity. If the first repaired test fails, inspect the output and use the one remaining repair test attempt. Do not edit tests, manifests, lockfiles, or documentation. Do not request shell access, network access, credentials, Git operations, commits, pushes, pull requests, or package changes. Stop after the repaired test passes and the diff and integrity evidence are collected.`;
}

function repairPrompt(commitSha: string, baseline: RepairSandboxCommand): string {
  return `Repair the exact verified fixture commit ${commitSha}. The baseline npm test exited ${baseline.exitCode}. Diagnose the actual failure with the tools, make the smallest source-only correction, and prove it with npm test.`;
}

function buildArtifacts(input: {
  sandbox: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>>;
  agentRun: AgentRunResult;
  toolCalls: AgentRepairToolCallEvidence[];
  repairedTest: RepairSandboxCommand | null;
  build: RepairSandboxCommand | null;
  patch: { patch: string; sha256: string; modifiedFiles: string[] };
  sourceIntegrity: RepairSourceIntegrity;
  cleanup: RepairSandboxCleanup;
  creditsBefore: AgentGatewayCredits;
  creditsAfter: AgentGatewayCredits;
  semanticPreflight: TestOracleInspection | null;
  contractAssertionCommand: RepairSandboxCommand | null;
  contractAssertionRun: ContractAssertionRun | null;
}): AgentRepairArtifact[] {
  const values: Array<[string, AgentRepairArtifact["mimeType"], string]> = [
    ["gateway-preflight.json", "application/json", json({ creditsBefore: input.creditsBefore, creditsAfter: input.creditsAfter, model: input.agentRun.model })],
    ["sandbox-source-verification.json", "application/json", json(input.sandbox.sourceVerification)],
    ["install-stdout.log", "text/plain", input.sandbox.install.stdout],
    ["install-stderr.log", "text/plain", input.sandbox.install.stderr || "\n"],
    ["baseline-test-stdout.log", "text/plain", input.sandbox.baselineTest.stdout],
    ["baseline-test-stderr.log", "text/plain", input.sandbox.baselineTest.stderr || "\n"],
    ["agent-run.json", "application/json", json(input.agentRun)],
    ["agent-tool-calls.json", "application/json", json(input.toolCalls)],
    ["repaired-test.json", "application/json", json(input.repairedTest)],
    ["repair.patch", "text/plain", input.patch.patch],
    ["source-integrity.json", "application/json", json(input.sourceIntegrity)],
    ...(input.semanticPreflight
      ? [["semantic-preflight.json", "application/json", json(input.semanticPreflight)] as [string, AgentRepairArtifact["mimeType"], string]]
      : []),
    ...(input.contractAssertionCommand
      ? [["contract-assertions-command.json", "application/json", json(input.contractAssertionCommand)] as [string, AgentRepairArtifact["mimeType"], string]]
      : []),
    ...(input.contractAssertionRun
      ? [["contract-assertions-result.json", "application/json", json(input.contractAssertionRun)] as [string, AgentRepairArtifact["mimeType"], string]]
      : []),
    ["sandbox-cleanup.json", "application/json", json(input.cleanup)],
    ...(input.build ? [["repair-build.json", "application/json", json(input.build)] as [string, AgentRepairArtifact["mimeType"], string]] : []),
  ];
  return values.map(([fileName, mimeType, content]) => ({
    id: randomUUID(),
    fileName,
    mimeType,
    size: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
    content,
  }));
}

function verifyLedger(entries: AgentRepairLedgerEntry[]): AgentRepairLedgerVerification {
  let previous: string | null = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.sequenceNumber !== index + 1 || entry.previousEntrySha256 !== previous || computeEvidenceLedgerEntryHash(entry) !== entry.entrySha256) {
      return { valid: false, entryCount: entries.length, chainSha256: previous };
    }
    previous = entry.entrySha256;
  }
  return { valid: true, entryCount: entries.length, chainSha256: previous };
}

function commandLedgerPayload(command: RepairSandboxCommand): Record<string, unknown> {
  return { commandId: command.commandId, command: command.command, exitCode: command.exitCode, durationMs: command.durationMs, stdoutSha256: sha256(command.stdout), stderrSha256: sha256(command.stderr) };
}

function check(id: string, passed: boolean, summary: string): AgentRepairReceipt["verificationChecks"][number] {
  return { id, status: passed ? "PASSED" : "FAILED", summary };
}

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

function decimalDifference(before: string, after: string): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(before) || !/^\d+(?:\.\d+)?$/.test(after)) return null;
  const scale = Math.max(before.split(".")[1]?.length ?? 0, after.split(".")[1]?.length ?? 0);
  const units = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  };
  const difference = units(before) - units(after);
  if (difference <= 0n) return "0";
  if (scale === 0) return difference.toString();
  const digits = difference.toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale) || "0";
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function assertNoCredentialLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|Bearer\s+[A-Za-z0-9._-]+|\.env\.local|C:\\Users\\/i.test(serialized)) {
    throw new Error("AGENT_REPAIR_CREDENTIAL_LEAK_DETECTED");
  }
}
