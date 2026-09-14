import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  computeEvidenceLedgerEntryHash,
  sha256Canonical,
  verifyEvidenceLedgerEntries,
  type EvidenceLedgerEntryRecord,
} from "@donelayer/database";
import {
  BETA_GATE_3_PRODUCT_BRANCH,
  BETA_GATE_3_PRODUCT_REMOTE_URL,
} from "@donelayer/worker-protocol";

import { createAgentRepairTools, type AgentRepairToolCallEvidence } from "../agent-execution/repair-tools";
import type { AgentGatewayCredits, AgentRunResult } from "../agent-execution/provider";
import {
  VercelAgentRepairSandbox,
  parseBoundedContractRun,
  type BoundedContractRun,
  type RepairSandboxCleanup,
  type RepairSandboxCommand,
  type RepairSourceIntegrity,
} from "../agent-execution/vercel-agent-repair-sandbox";
import { VercelAIGatewayAgentProvider } from "../agent-execution/vercel-ai-gateway-provider";
import { materializeVerifiedSourcePackage } from "../managed-sandbox/repository-source";
import {
  evaluateVerifiedDeliveryOutcome,
  type VerifiedDeliveryOutcomeEvaluation,
} from "../verified-delivery-outcome/policy";
import {
  BETA_GATE_3_EDITABLE_FILE,
  BETA_GATE_3_EXECUTOR_ID,
  BETA_GATE_3_RECEIPT_TYPE,
  BetaGate3AuthorityGuard,
  betaGate3TaskProfile,
  createBetaGate3ExecutionBinding,
  type BetaGate3AuthorityOperation,
  type BetaGate3ExecutionBinding,
  type BetaGate3PreparedLifecycle,
} from "./contract";
import {
  SupabaseBetaGate3Persistence,
  type BetaGate3ArtifactWrite,
  type BetaGate3FinalizeRequest,
  type BetaGate3FinalizedLifecycle,
  type BetaGate3LedgerWrite,
} from "./persistence";

export const BETA_GATE_3_GATE = "BETA_GATE_3_REAL_END_TO_END_VERIFIED_WORK" as const;

export type BetaGate3RunInput = {
  ownerAuthUserId: string;
  taskId: string;
  contractId: string;
  contractSha256: string;
  authorityId: string;
  authorityScopeSha256: string;
};

export type BetaGate3Outcome = {
  gate: typeof BETA_GATE_3_GATE;
  taskId: string;
  jobRunId: string;
  status: "VERIFIED_DELIVERY";
  binding: BetaGate3ExecutionBinding;
  source: {
    remoteUrl: string;
    branch: string;
    commitSha: string;
    manifestSha256: string;
    sourcePackageSha256: string;
    materializerWorkspaceCleaned: true;
  };
  model: {
    gateway: "Vercel AI Gateway";
    modelId: string;
    provider: string;
    authentication: "VERCEL_OIDC" | "AI_GATEWAY_API_KEY";
    creditsBefore: AgentGatewayCredits;
    creditsAfter: AgentGatewayCredits;
    run: AgentRunResult;
  };
  authorityOperations: BetaGate3AuthorityOperation[];
  patch: { patch: string; sha256: string; modifiedFiles: string[] };
  execution: {
    baseline: RepairSandboxCommand;
    contractRun: BoundedContractRun;
    sourceIntegrity: RepairSourceIntegrity;
    cleanup: RepairSandboxCleanup;
    toolCalls: AgentRepairToolCallEvidence[];
  };
  verification: {
    baseline: RepairSandboxCommand;
    contractRun: BoundedContractRun;
    sourceIntegrity: RepairSourceIntegrity;
    cleanup: RepairSandboxCleanup;
  };
  outcomes: VerifiedDeliveryOutcomeEvaluation;
  evidenceBundle: Record<string, unknown>;
  ledger: { valid: true; entryCount: number; chainSha256: string };
  receipt: {
    id: string;
    publicId: string;
    sha256: string;
    evidenceChainSha256: string;
    document: Record<string, unknown>;
  };
  persisted: BetaGate3FinalizedLifecycle;
};

export class BetaGate3Orchestrator {
  private started = false;

  constructor(
    private readonly persistence = new SupabaseBetaGate3Persistence(),
    private readonly agentProvider = new VercelAIGatewayAgentProvider(),
  ) {}

  async run(input: BetaGate3RunInput): Promise<BetaGate3Outcome> {
    if (this.started) throw new Error("BETA_GATE_3_ONE_JOB_LIMIT");
    this.started = true;

    const availability = await this.agentProvider.checkAvailability();
    if (!availability.available || !availability.credits || availability.authentication === "UNAVAILABLE") {
      throw new Error(`${availability.errorCode ?? "AI_GATEWAY_UNAVAILABLE"}:${availability.errorMessage ?? "unavailable"}`);
    }
    const models = await this.agentProvider.listEligibleModels();
    const model = models[0];
    if (!model) throw new Error("AI_GATEWAY_FREE_USAGE_UNAVAILABLE");
    const creditsBefore = await this.agentProvider.getCredits();
    if (Number(creditsBefore.balance) <= 0) throw new Error("AI_GATEWAY_FREE_USAGE_UNAVAILABLE");

    const source = await materializeVerifiedSourcePackage({
      sourceBoundary: "BETA_GATE_3_PRODUCT_MAIN",
      remoteUrl: BETA_GATE_3_PRODUCT_REMOTE_URL,
      branch: BETA_GATE_3_PRODUCT_BRANCH,
    });
    const prepared = await this.persistence.prepare({
      ...input,
      sourceCommit: source.materializerCommitSha,
    });
    const binding = createBetaGate3ExecutionBinding(prepared);
    const authorityOperations: BetaGate3AuthorityOperation[] = [];
    const guard = new BetaGate3AuthorityGuard(binding, prepared.permissionScope, authorityOperations);
    guard.assertRepositoryReadAllowed({
      remoteUrl: source.identity.remoteUrl,
      baseRef: source.identity.branch,
      commitSha: source.identity.commitSha,
    });

    const executionProfile = betaGate3TaskProfile("AGENT_REPAIR");
    const verifierProfile = betaGate3TaskProfile("INDEPENDENT_VERIFICATION");
    const executionSandbox = new VercelAgentRepairSandbox(
      `gate3-exec-${binding.jobRunId}`,
      binding.jobRunId,
      source,
      guard,
      executionProfile,
    );
    const verifierSandbox = new VercelAgentRepairSandbox(
      `gate3-verify-${binding.jobRunId}`,
      binding.jobRunId,
      source,
      guard,
      verifierProfile,
    );

    let executionStarted: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>> | null = null;
    let executionCleanup: RepairSandboxCleanup | null = null;
    let verifierStarted: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>> | null = null;
    let verifierCleanup: RepairSandboxCleanup | null = null;
    try {
      executionStarted = await executionSandbox.start();
      guard.assertActionAllowedWithEvidence("create_patch");
      const repairTools = createAgentRepairTools(executionSandbox);
      const agentRun = await this.agentProvider.createRun({
        model,
        instructions: agentInstructions(),
        prompt: agentPrompt(source.materializerCommitSha, executionStarted.baselineTest),
        tools: repairTools.tools,
        maxSteps: 10,
        maxOutputTokens: 4096,
        providerRetryLimit: 1,
        tag: `donelayer-beta-gate-3-${binding.jobRunId}`,
      });
      const executionCommand = repairTools.getLastRepairTest();
      const patchedFiles = await executionSandbox.getPatchedSourceFiles();
      const patch = await executionSandbox.getDiff();
      const executionIntegrity = await executionSandbox.getSourceIntegrity();
      if (
        agentRun.status !== "COMPLETED" ||
        agentRun.usage.apiRequestCount < 1 ||
        !repairTools.calls.some((call) => call.success && call.toolName === "apply_patch") ||
        !repairTools.calls.some((call) => call.success && call.toolName === "run_test") ||
        !executionCommand || executionCommand.exitCode !== 0 ||
        patchedFiles.length !== 1 ||
        patch.modifiedFiles.length !== 1 ||
        patch.modifiedFiles[0] !== BETA_GATE_3_EDITABLE_FILE ||
        executionIntegrity.missing.length !== 0 ||
        executionIntegrity.unauthorizedModified.length !== 0
      ) throw new Error("BETA_GATE_3_AGENT_DELIVERABLE_INVALID");
      const executionContractRun = parseBoundedContractRun(
        executionCommand.stdout,
        executionProfile.contractCheck!,
      );
      if (executionContractRun.failed !== 0) throw new Error("BETA_GATE_3_EXECUTION_ASSERTIONS_FAILED");
      executionCleanup = await executionSandbox.cleanup();
      if (!executionCleanup.cleanupVerified) throw new Error("BETA_GATE_3_EXECUTION_CLEANUP_FAILED");

      verifierStarted = await verifierSandbox.start();
      const sourceManifestEntry = source.repositoryManifest.files.find(
        (entry) => entry.relative_path === BETA_GATE_3_EDITABLE_FILE,
      );
      if (!sourceManifestEntry) throw new Error("BETA_GATE_3_SOURCE_FILE_MISSING");
      await verifierSandbox.applyPatch({
        path: BETA_GATE_3_EDITABLE_FILE,
        expectedSha256: sourceManifestEntry.sha256,
        replacement: patchedFiles[0]!.content,
      });
      const verifierCommand = await verifierSandbox.runTest();
      const verifierContractRun = parseBoundedContractRun(
        verifierCommand.stdout,
        verifierProfile.contractCheck!,
      );
      const verifierPatch = await verifierSandbox.getDiff();
      const verifierIntegrity = await verifierSandbox.getSourceIntegrity();
      verifierCleanup = await verifierSandbox.cleanup();
      const independentVerified =
        verifierStarted.baselineTest.exitCode !== 0 &&
        verifierCommand.exitCode === 0 &&
        verifierContractRun.failed === 0 &&
        verifierPatch.sha256 === patch.sha256 &&
        verifierPatch.modifiedFiles.length === 1 &&
        verifierIntegrity.missing.length === 0 &&
        verifierIntegrity.unauthorizedModified.length === 0 &&
        verifierCleanup.cleanupVerified;

      const outcomes = evaluateVerifiedDeliveryOutcome({
        deliveryOutcomePolicy: {
          schemaVersion: 1,
          policyVersion: 1,
          policy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
        },
        executionOutcome: "COMPLETED",
        executionFailureAttribution: "NOT_APPLICABLE",
        independentVerificationOutcome: independentVerified ? "VERIFIED" : "FAILED",
        trustChecks: {
          authorizedDeliverableExists: patch.modifiedFiles.length === 1,
          requiredEvidenceComplete: independentVerified,
          sourceIntegrityValid: executionIntegrity.unauthorizedModified.length === 0 && verifierIntegrity.unauthorizedModified.length === 0,
          authorityValid: authorityOperations.every((operation) => operation.decision === "ALLOWED"),
          provenanceValid: binding.agent.agentId === prepared.agentId,
          lifecycleIntegrityValid: prepared.prepared === true,
          cleanupValid: executionCleanup.cleanupVerified && verifierCleanup.cleanupVerified,
          externalEffectsPolicyValid: true,
        },
      });
      if (outcomes.deliveryOutcome !== "VERIFIED_DELIVERY") {
        throw new Error(`BETA_GATE_3_MODEL_C_${outcomes.deliveryOutcome}`);
      }

      const receiptId = randomUUID();
      const receiptPublicId = `dlr_${randomBytes(18).toString("base64url")}`;
      const evidenceBundle = createEvidenceBundle({
        binding,
        patch,
        executionStarted,
        executionCommand,
        executionContractRun,
        executionIntegrity,
        executionCleanup,
        agentRun,
        toolCalls: repairTools.calls,
        verifierStarted,
        verifierCommand,
        verifierContractRun,
        verifierIntegrity,
        verifierCleanup,
        outcomes,
        receiptId,
      });
      const artifacts = createArtifacts(binding, patch.patch, {
        binding,
        model: { id: model.id, provider: model.provider, run: agentRun },
        baseline: executionStarted.baselineTest,
        command: executionCommand,
        contractRun: executionContractRun,
        sourceIntegrity: executionIntegrity,
        cleanup: executionCleanup,
        toolCalls: repairTools.calls,
      }, {
        baseline: verifierStarted.baselineTest,
        command: verifierCommand,
        contractRun: verifierContractRun,
        patchSha256: verifierPatch.sha256,
        sourceIntegrity: verifierIntegrity,
        cleanup: verifierCleanup,
      }, evidenceBundle);
      const ledger = createLedger({
        binding,
        artifacts,
        patch,
        executionStarted,
        executionCommand,
        executionCleanup,
        verifierStarted,
        verifierCommand,
        verifierCleanup,
        receiptId,
      });
      const preReceipt = verifyEvidenceLedgerEntries(ledger as EvidenceLedgerEntryRecord[]);
      if (!preReceipt.valid || !preReceipt.chainSha256) throw new Error("BETA_GATE_3_LEDGER_INVALID");
      const creditsAfter = await this.agentProvider.getCredits();
      const receiptDocument = createReceiptDocument({
        binding,
        prepared,
        source,
        agentRun,
        creditsBefore,
        creditsAfter,
        patch,
        artifacts,
        outcomes,
        evidenceBundle,
        preReceipt: {
          valid: true,
          entryCount: preReceipt.entryCount,
          chainSha256: preReceipt.chainSha256,
        },
        verifierCommand,
        executionCleanup,
        verifierCleanup,
      });
      assertNoCredentialLeak(receiptDocument);
      const receiptSha256 = sha256Canonical(receiptDocument);
      appendLedger(ledger, binding, "RECEIPT_CREATED", "job_receipt", receiptId, receiptSha256);
      const finalLedger = verifyEvidenceLedgerEntries(ledger as EvidenceLedgerEntryRecord[]);
      if (!finalLedger.valid || !finalLedger.chainSha256) throw new Error("BETA_GATE_3_FINAL_LEDGER_INVALID");
      const receipt = {
        id: receiptId,
        publicId: receiptPublicId,
        sha256: receiptSha256,
        evidenceChainSha256: preReceipt.chainSha256,
        document: receiptDocument,
      };

      const acceptanceChecks = arrayOfRecords(prepared.contract.acceptanceChecks);
      const finalizeRequest: BetaGate3FinalizeRequest = {
        ownerAuthUserId: input.ownerAuthUserId,
        taskId: binding.taskId,
        jobRunId: binding.jobRunId,
        workerId: binding.workerId,
        workerLeaseId: binding.workerLeaseId,
        permissionLeaseId: binding.permissionLeaseId,
        patchSha256: patch.sha256,
        changedFiles: patch.modifiedFiles,
        jobResult: {
          executionOutcome: outcomes.executionOutcome,
          independentVerificationOutcome: outcomes.independentVerificationOutcome,
          deliveryOutcome: outcomes.deliveryOutcome,
          bindingSha256: binding.bindingSha256,
          patchSha256: patch.sha256,
          executionSandboxCleanupVerified: executionCleanup.cleanupVerified,
          verifierSandboxCleanupVerified: verifierCleanup.cleanupVerified,
        },
        artifacts,
        verification: {
          id: randomUUID(),
          verifierVersion: "DoneLayer Fresh Sandbox Verifier V1",
          startedAt: verifierStarted.baselineTest.startedAt,
          finishedAt: verifierCleanup.stopConfirmedAt,
          summary: "Fresh isolated verifier passed every locked Contract assertion and reproduced the exact authorized patch.",
          metadata: {
            sandboxId: verifierStarted.sandboxId,
            patchSha256: verifierPatch.sha256,
            cleanupVerified: verifierCleanup.cleanupVerified,
            assertionResult: verifierContractRun,
          },
          checks: acceptanceChecks.map((check) => ({
            id: randomUUID(),
            acceptanceCheckId: requiredString(check.id, "acceptance check id"),
            status: "PASSED" as const,
            summary: requiredString(check.label, "acceptance check label"),
            expected: { statement: check.label },
            actual: { assertionRun: verifierContractRun, patchSha256: verifierPatch.sha256 },
          })),
        },
        ledgerEntries: ledger,
        receipt,
      };
      assertNoCredentialLeak(finalizeRequest);
      const persisted = await this.persistence.finalize(finalizeRequest);

      return {
        gate: BETA_GATE_3_GATE,
        taskId: binding.taskId,
        jobRunId: binding.jobRunId,
        status: "VERIFIED_DELIVERY",
        binding,
        source: {
          remoteUrl: source.identity.remoteUrl,
          branch: source.identity.branch,
          commitSha: source.identity.commitSha,
          manifestSha256: source.repositoryManifestSha256,
          sourcePackageSha256: source.sourcePackageSha256,
          materializerWorkspaceCleaned: source.materializerWorkspaceCleaned,
        },
        model: {
          gateway: "Vercel AI Gateway",
          modelId: model.id,
          provider: model.provider,
          authentication: availability.authentication,
          creditsBefore,
          creditsAfter,
          run: agentRun,
        },
        authorityOperations,
        patch,
        execution: {
          baseline: executionStarted.baselineTest,
          contractRun: executionContractRun,
          sourceIntegrity: executionIntegrity,
          cleanup: executionCleanup,
          toolCalls: repairTools.calls,
        },
        verification: {
          baseline: verifierStarted.baselineTest,
          contractRun: verifierContractRun,
          sourceIntegrity: verifierIntegrity,
          cleanup: verifierCleanup,
        },
        outcomes,
        evidenceBundle,
        ledger: { valid: true, entryCount: finalLedger.entryCount, chainSha256: finalLedger.chainSha256 },
        receipt,
        persisted,
      };
    } catch (error) {
      const cleanupErrors: string[] = [];
      for (const sandbox of [executionSandbox, verifierSandbox]) {
        try {
          await sandbox.cleanupIfRunning();
        } catch (cleanupError) {
          cleanupErrors.push(safeError(cleanupError));
        }
      }
      try {
        await this.persistence.failClosed({
          taskId: binding.taskId,
          jobRunId: binding.jobRunId,
          failureCode: failureCode(error),
          executionOutcome: /PROVIDER|GATEWAY|MODEL/i.test(safeError(error)) ? "PROVIDER_FAILURE" : "FAILED",
        });
      } catch (persistenceError) {
        cleanupErrors.push(safeError(persistenceError));
      }
      throw new Error(`${safeError(error)}${cleanupErrors.length ? `;FAIL_CLOSED:${cleanupErrors.join(",")}` : ""}`);
    }
  }
}

function agentInstructions(): string {
  return [
    "You are the bounded DoneLayer Agent for one real Feature Completion Work Contract.",
    "Use only the supplied tools. Do not propose or request broader access.",
    `Read and modify only ${BETA_GATE_3_EDITABLE_FILE}.`,
    "Fix invalid or blank relative-time inputs so they return exactly Unknown time.",
    "Preserve all valid-input behavior. Run the locked test after applying the patch.",
    "Do not modify tests, configuration, dependencies, manifests, or any other file.",
  ].join(" ");
}

function agentPrompt(commitSha: string, baseline: RepairSandboxCommand): string {
  return `Source ${BETA_GATE_3_PRODUCT_REMOTE_URL}@${commitSha} is immutable except for ${BETA_GATE_3_EDITABLE_FILE}. The locked baseline command failed with exit ${baseline.exitCode}. Read that file, apply the smallest complete fix, run the locked test, and report completion.`;
}

function createEvidenceBundle(input: {
  binding: BetaGate3ExecutionBinding;
  patch: { sha256: string; modifiedFiles: string[] };
  executionStarted: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>>;
  executionCommand: RepairSandboxCommand;
  executionContractRun: BoundedContractRun;
  executionIntegrity: RepairSourceIntegrity;
  executionCleanup: RepairSandboxCleanup;
  agentRun: AgentRunResult;
  toolCalls: AgentRepairToolCallEvidence[];
  verifierStarted: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>>;
  verifierCommand: RepairSandboxCommand;
  verifierContractRun: BoundedContractRun;
  verifierIntegrity: RepairSourceIntegrity;
  verifierCleanup: RepairSandboxCleanup;
  outcomes: VerifiedDeliveryOutcomeEvaluation;
  receiptId: string;
}): Record<string, unknown> {
  const required = [
    "AGENT_IDENTITY", "WORK_CONTRACT", "TASK_SCOPED_AUTHORITY", "SOURCE_IDENTITY",
    "EXECUTION_RESULT", "TEST_AND_BUILD_RESULT", "CONTRACT_ASSERTIONS",
    "FRESH_INDEPENDENT_VERIFICATION", "PROVENANCE", "VERIFIED_WORK_RECEIPT",
  ];
  const body = {
    schemaVersion: 1,
    bundleType: "BETA_GATE_3_VERIFIED_WORK_EVIDENCE_BUNDLE_V1",
    taskId: input.binding.taskId,
    jobRunId: input.binding.jobRunId,
    bindingSha256: input.binding.bindingSha256,
    workContract: input.binding.workContract,
    authority: input.binding.authority,
    source: input.binding.source,
    execution: {
      sandboxId: input.executionStarted.sandboxId,
      modelRunId: input.agentRun.runId,
      apiRequestCount: input.agentRun.usage.apiRequestCount,
      toolCalls: input.toolCalls,
      assertionCommand: input.executionCommand,
      assertions: input.executionContractRun,
      sourceIntegrity: input.executionIntegrity,
      cleanup: input.executionCleanup,
    },
    independentVerification: {
      sandboxId: input.verifierStarted.sandboxId,
      assertionCommand: input.verifierCommand,
      assertions: input.verifierContractRun,
      sourceIntegrity: input.verifierIntegrity,
      cleanup: input.verifierCleanup,
    },
    deliverable: input.patch,
    outcomes: input.outcomes,
    receiptProjection: { receiptId: input.receiptId, issuedAtomicallyWithBundle: true },
    projection: { required, satisfied: required, missing: [], complete: true },
    createdAt: new Date().toISOString(),
  };
  return { ...body, bundleSha256: sha256Canonical(body) };
}

function createArtifacts(
  binding: BetaGate3ExecutionBinding,
  patch: string,
  execution: Record<string, unknown>,
  verification: Record<string, unknown>,
  evidenceBundle: Record<string, unknown>,
): BetaGate3ArtifactWrite[] {
  const values: Array<{
    artifactType: BetaGate3ArtifactWrite["artifactType"];
    fileName: string;
    mimeType: BetaGate3ArtifactWrite["mimeType"];
    content: string;
    metadata: Record<string, unknown>;
  }> = [
    { artifactType: "PATCH", fileName: "format-relative-time.patch", mimeType: "text/plain", content: patch, metadata: { patch } },
    { artifactType: "TEST_LOG", fileName: "execution-evidence.json", mimeType: "application/json", content: json(execution), metadata: { document: execution } },
    { artifactType: "VERIFICATION_REPORT", fileName: "independent-verification.json", mimeType: "application/json", content: json(verification), metadata: { document: verification } },
    { artifactType: "OTHER", fileName: "evidence-bundle.json", mimeType: "application/json", content: json(evidenceBundle), metadata: { document: evidenceBundle } },
  ];
  return values.map((value) => {
    const id = randomUUID();
    return {
      id,
      artifactType: value.artifactType,
      fileName: value.fileName,
      mimeType: value.mimeType,
      sizeBytes: Buffer.byteLength(value.content, "utf8"),
      sha256: sha256(value.content),
      storagePath: `beta-gate-3/${binding.taskId}/${binding.jobRunId}/${id}/${value.fileName}`,
      metadata: value.metadata,
    };
  });
}

function createLedger(input: {
  binding: BetaGate3ExecutionBinding;
  artifacts: BetaGate3ArtifactWrite[];
  patch: { sha256: string; modifiedFiles: string[] };
  executionStarted: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>>;
  executionCommand: RepairSandboxCommand;
  executionCleanup: RepairSandboxCleanup;
  verifierStarted: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>>;
  verifierCommand: RepairSandboxCommand;
  verifierCleanup: RepairSandboxCleanup;
  receiptId: string;
}): BetaGate3LedgerWrite[] {
  const entries: BetaGate3LedgerWrite[] = [];
  appendLedger(entries, input.binding, "CONTRACT_LOCKED", "task_contract_version", input.binding.workContract.id, input.binding.workContract);
  appendLedger(entries, input.binding, "PERMISSION_GRANTED", "permission_lease", input.binding.permissionLeaseId, { bindingSha256: input.binding.bindingSha256 });
  appendLedger(entries, input.binding, "JOB_CLAIMED", "job_run", input.binding.jobRunId, { workerId: input.binding.workerId });
  appendLedger(entries, input.binding, "SOURCE_PACKAGE_VERIFIED", "source_commit", input.binding.source.commitSha, input.binding.source);
  appendLedger(entries, input.binding, "EXECUTION_STARTED", "managed_sandbox", input.executionStarted.sandboxId, { purpose: "AGENT_REPAIR", persistent: false, networkPolicy: "deny-all" });
  appendLedger(entries, input.binding, "TEST_FAILED", "managed_sandbox_command", input.executionStarted.baselineTest.commandId, commandPayload(input.executionStarted.baselineTest));
  appendLedger(entries, input.binding, "TEST_STARTED", "managed_sandbox_command", input.executionCommand.commandId, commandPayload(input.executionCommand));
  appendLedger(entries, input.binding, "SOURCE_INTEGRITY_VERIFIED", "repair_patch", input.patch.sha256, input.patch);
  appendLedger(entries, input.binding, "MANAGED_SANDBOX_CLEANUP_VERIFIED", "managed_sandbox", input.executionStarted.sandboxId, input.executionCleanup);
  appendLedger(entries, input.binding, "MANAGED_SANDBOX_CREATED", "managed_sandbox", input.verifierStarted.sandboxId, { purpose: "INDEPENDENT_VERIFICATION", persistent: false, networkPolicy: "deny-all" });
  appendLedger(entries, input.binding, "TEST_STARTED", "managed_sandbox_command", input.verifierCommand.commandId, commandPayload(input.verifierCommand));
  appendLedger(entries, input.binding, "VERIFICATION_PASSED", "verification_run", input.binding.jobRunId, { exitCode: input.verifierCommand.exitCode, patchSha256: input.patch.sha256 });
  appendLedger(entries, input.binding, "MANAGED_SANDBOX_CLEANUP_VERIFIED", "managed_sandbox", input.verifierStarted.sandboxId, input.verifierCleanup);
  for (const artifact of input.artifacts) {
    appendLedger(entries, input.binding, "ARTIFACT_HASH_VERIFIED", "evidence_artifact", artifact.id, { sha256: artifact.sha256, sizeBytes: artifact.sizeBytes });
  }
  return entries;
}

function appendLedger(
  entries: BetaGate3LedgerWrite[],
  binding: BetaGate3ExecutionBinding,
  entryType: string,
  sourceRecordType: string,
  sourceRecordId: string,
  payload: unknown,
  createdAt = new Date().toISOString(),
): void {
  const entry: BetaGate3LedgerWrite = {
    id: randomUUID(),
    taskId: binding.taskId,
    jobRunId: binding.jobRunId,
    sequenceNumber: entries.length + 1,
    entryType,
    sourceRecordType,
    sourceRecordId,
    payloadSha256: typeof payload === "string" && /^[a-f0-9]{64}$/.test(payload)
      ? payload
      : sha256Canonical(payload),
    previousEntrySha256: entries.at(-1)?.entrySha256 ?? null,
    entrySha256: "",
    createdAt,
  };
  entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
  entries.push(entry);
}

function createReceiptDocument(input: {
  binding: BetaGate3ExecutionBinding;
  prepared: BetaGate3PreparedLifecycle;
  source: Awaited<ReturnType<typeof materializeVerifiedSourcePackage>>;
  agentRun: AgentRunResult;
  creditsBefore: AgentGatewayCredits;
  creditsAfter: AgentGatewayCredits;
  patch: { sha256: string; modifiedFiles: string[] };
  artifacts: BetaGate3ArtifactWrite[];
  outcomes: VerifiedDeliveryOutcomeEvaluation;
  evidenceBundle: Record<string, unknown>;
  preReceipt: { valid: true; entryCount: number; chainSha256: string };
  verifierCommand: RepairSandboxCommand;
  executionCleanup: RepairSandboxCleanup;
  verifierCleanup: RepairSandboxCleanup;
}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    receiptType: BETA_GATE_3_RECEIPT_TYPE,
    gate: BETA_GATE_3_GATE,
    finalResult: "VERIFIED_DELIVERY",
    whatWasAgreed: {
      taskId: input.binding.taskId,
      workContract: input.binding.workContract,
      authority: input.binding.authority,
      source: input.binding.source,
      assertionsSha256: input.binding.assertionsSha256,
    },
    whoExecuted: {
      agentPublicIdentity: input.prepared.agentIdentity.displayName,
      agentId: input.binding.agent.agentId,
      agentIdentity: input.binding.agent,
      executorId: BETA_GATE_3_EXECUTOR_ID,
      workerId: input.binding.workerId,
    },
    whatHappened: {
      jobRunId: input.binding.jobRunId,
      commitShaAfter: input.source.identity.commitSha,
      authorizedPatch: input.patch,
      buildTest: {
        build: { command: "not required by locked Contract", status: "NOT_REQUIRED", exitCode: null },
        test: { command: "locked contract assertions", status: "PASSED", exitCode: input.verifierCommand.exitCode },
      },
      artifacts: input.artifacts.map(({ metadata: _metadata, ...artifact }) => artifact),
      externalEffects: { pullRequest: false, merge: false, deployment: false, payment: false, blockchain: false },
    },
    howVerified: {
      verifier: "DoneLayer Fresh Sandbox Verifier V1",
      deterministicAssertions: true,
      evidenceBundleSha256: input.evidenceBundle.bundleSha256,
      evidenceLedger: input.preReceipt,
      executionSandboxCleanupVerified: input.executionCleanup.cleanupVerified,
      verifierSandboxCleanupVerified: input.verifierCleanup.cleanupVerified,
    },
    verifiedDeliveryOutcomes: {
      executionOutcome: input.outcomes.executionOutcome,
      executionFailureAttribution: input.outcomes.executionFailureAttribution,
      independentVerificationOutcome: input.outcomes.independentVerificationOutcome,
      deliveryOutcome: input.outcomes.deliveryOutcome,
      modelCReasons: input.outcomes.reasons,
    },
    modelUsage: {
      gateway: "Vercel AI Gateway",
      modelId: input.agentRun.model.id,
      modelProvider: input.agentRun.model.provider,
      authentication: "VERCEL_OIDC",
      apiRequestCount: input.agentRun.usage.apiRequestCount,
      inputTokens: input.agentRun.usage.inputTokens,
      outputTokens: input.agentRun.usage.outputTokens,
      gatewayReportedCostUsd: input.agentRun.usage.gatewayReportedCostUsd,
      creditsBefore: input.creditsBefore,
      creditsAfter: input.creditsAfter,
    },
    classification: {
      realJobClassification: "NOT_VERIFIED",
      reputationContribution: 0,
      canonicalContribution: 0,
      reason: "BETA_GATE_VALIDATION",
    },
    issuedAt: new Date().toISOString(),
  };
}

function commandPayload(command: RepairSandboxCommand): Record<string, unknown> {
  return {
    commandId: command.commandId,
    command: command.command,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    stdoutSha256: sha256(command.stdout),
    stderrSha256: sha256(command.stderr),
  };
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`BETA_GATE_3_${label.toUpperCase().replaceAll(" ", "_")}_MISSING`);
  return value;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertNoCredentialLeak(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/sb_secret_|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|Bearer\s+[A-Za-z0-9._-]+|\.env\.local|C:\\Users\\/i.test(serialized)) {
    throw new Error("BETA_GATE_3_CREDENTIAL_OR_PATH_LEAK_DETECTED");
  }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function failureCode(error: unknown): string {
  return safeError(error).split(":", 1)[0]!.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 100) || "BETA_GATE_3_FAILED";
}
