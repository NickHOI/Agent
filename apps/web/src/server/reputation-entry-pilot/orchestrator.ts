import { randomUUID } from "node:crypto";

import { sha256Canonical } from "@donelayer/database";
import {
  MANAGED_SANDBOX_PROVIDER,
} from "@donelayer/worker-protocol";

import {
  agentIdentityReference,
  createAgentIdentityProfile,
  type AgentIdentityProfile,
} from "../agent-identity/agent-identity";
import {
  createAgentExecutionIdentity,
  generateExecutionId,
} from "../agent-identity/execution-identity";
import type { AgentExecutionProvider, AgentRunResult } from "../agent-execution/provider";
import {
  createAgentRepairTools,
  type AgentRepairToolSandbox,
} from "../agent-execution/repair-tools";
import { VercelAIGatewayAgentProvider } from "../agent-execution/vercel-ai-gateway-provider";
import {
  VercelAgentRepairSandbox,
  type AgentRepairTaskProfile,
  type RepairSandboxCleanup,
  type RepairSandboxCommand,
  type RepairSourceIntegrity,
} from "../agent-execution/vercel-agent-repair-sandbox";
import {
  materializeVerifiedSourcePackage,
  sourceMaterializationFailureEvidence,
  type MaterializedSourcePackage,
} from "../managed-sandbox/repository-source";
import {
  decideTaskScopedAuthority,
  issueTaskScopedPermissionLease,
  requireTaskScopedAuthorityGuard,
  revokeTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
  TASK_SCOPED_AUTHORITY_ISSUER,
  type TaskScopedAuthorityDecision,
  type TaskScopedAuthorityGuard,
  type TaskScopedAuthorityOperationEvidence,
  type TaskScopedPermissionLease,
} from "../task-scoped-authority/task-scoped-authority";
import {
  appendReputationEntryLedger,
  assertReputationEntryCandidateJobIntegrity,
  createReputationEntryArtifact,
  createReputationEntryEvidenceBundle,
  createReputationEntryReceipt,
  isVerifiedReputationEntryCandidateResult,
  reputationEntrySecretPattern,
  verifyReputationEntryLedger,
  type IndependentVerificationEvidence,
  type ReputationEntryArtifact,
  type ReputationEntryCandidateJob,
  type ReputationEntryLedgerEntry,
  type ReputationEntryResult,
} from "./candidate-evidence";
import {
  assertReputationEntryCandidateJobV2Integrity,
  createReputationEntryOutcomeEvidenceBundleV2,
  createReputationEntryOutcomeReceiptV2,
  toVerifiedDeliveryOutcomePublicSummary,
  verifiedDeliveryOutcomeLedgerPayload,
  type ReputationEntryCandidateJobV2,
  type ReputationEntryOutcomeEvidenceBundleV2,
} from "./delivery-outcome-evidence";
import {
  REPUTATION_ENTRY_CANDIDATE_STATUS,
  REPUTATION_ENTRY_PILOT,
  assertReputationEntryWorkContractIntegrity,
  createReputationEntryWorkContract,
  createReputationEntryWorkContractV2,
  evaluateReputationEntryDeliveryOutcome,
  reputationEntryTaskDefinition,
  reputationEntryTaskDefinitionVersion,
  type ReputationEntryTaskType,
  type ReputationEntryWorkContract,
  type ReputationEntryWorkContractV2,
} from "./work-contract";
import {
  ReputationEntryDurableStore,
  type DurableRecordType,
} from "./durable-store";
import {
  VERIFIED_DELIVERY_OUTCOME_POLICIES,
  type AgentExecutionOutcome,
  type ExecutionFailureAttribution,
  type IndependentWorkVerificationOutcome,
  type VerifiedDeliveryOutcomeEvaluation,
  type VerifiedDeliveryOutcomePolicyName,
  type VerifiedDeliveryTrustChecks,
} from "../verified-delivery-outcome/policy";

export const REPUTATION_ENTRY_MODEL_REQUEST_LIMIT = 16;
export const REPUTATION_ENTRY_SANDBOX_LIMIT = 4;
export const REPUTATION_ENTRY_DECLARED_MODEL_SPEND_CAP_USD = 0.10;
const MAX_MODEL_STEPS_PER_JOB = 8;
const MAX_OUTPUT_TOKENS_PER_JOB = 4_096;

export type ReputationEntryPilotSource = {
  taskType: ReputationEntryTaskType;
  taskDefinitionVersion?: number;
  branch: string;
  commitSha: string;
};

export type ReputationEntryPilotOutcome = {
  gate: typeof REPUTATION_ENTRY_PILOT;
  attemptId: string;
  decision: "PASS" | "PARTIAL";
  candidateStatus: typeof REPUTATION_ENTRY_CANDIDATE_STATUS;
  agentProfile: AgentIdentityProfile;
  jobs: [ReputationEntryCandidateJob, ReputationEntryCandidateJob];
  corpus: {
    candidateJobCount: 2;
    verifiedCandidateJobCount: number;
    canonicalQualifyingJobCountAdded: 0;
    taskTypes: ReputationEntryTaskType[];
    identityContinuity: boolean;
    remainingGapBeforeOwnerPromotion: 20;
    projectedGapAfterPromotion: number;
  };
  limits: {
    modelRequestLimit: typeof REPUTATION_ENTRY_MODEL_REQUEST_LIMIT;
    modelRequestsUsed: number;
    maxOutputTokensPerJob: number;
    declaredModelSpendCapUsd: typeof REPUTATION_ENTRY_DECLARED_MODEL_SPEND_CAP_USD;
    deterministicCurrencyCapEnforcedByProvider: false;
    zeroPriceModelsOnly: true;
    gatewayReportedCostUsd: number | null;
    sandboxLimit: typeof REPUTATION_ENTRY_SANDBOX_LIMIT;
    sandboxesCreated: number;
  };
  externalEffects: {
    fixtureBranchesRead: string[];
    pullRequestsCreated: 0;
    mergesPerformed: 0;
    deploymentsPerformed: 0;
    paymentsPerformed: 0;
    blockchainWritesPerformed: 0;
  };
  proposedQualificationDefinition: string[];
  recommendation: "ACCEPT_DEFINITION_AND_PROMOTE_VERIFIED_CANDIDATES" | "DO_NOT_PROMOTE";
  completedAt: string;
};

export type ReputationEntryV2PolicySelection = Record<
  ReputationEntryTaskType,
  VerifiedDeliveryOutcomePolicyName
>;

export type ReputationEntryPilotOutcomeV2 = {
  schemaVersion: 2;
  gate: typeof REPUTATION_ENTRY_PILOT;
  attemptId: string;
  decision: "PASS" | "PARTIAL";
  candidateStatus: typeof REPUTATION_ENTRY_CANDIDATE_STATUS;
  agentProfile: AgentIdentityProfile;
  jobs: [ReputationEntryCandidateJobV2, ReputationEntryCandidateJobV2];
  corpus: {
    candidateJobCount: 2;
    eligibleCandidateJobCount: number;
    canonicalQualifyingJobCountAdded: 0;
    taskTypes: ReputationEntryTaskType[];
    identityContinuity: boolean;
    remainingGapBeforeOwnerPromotion: 20;
    projectedGapAfterPromotion: number;
  };
  limits: ReputationEntryPilotOutcome["limits"];
  externalEffects: ReputationEntryPilotOutcome["externalEffects"];
  completedAt: string;
};

export type ReputationEntrySandboxController = AgentRepairToolSandbox & Pick<
  VercelAgentRepairSandbox,
  "start" | "cleanupIfRunning" | "getPatchedSourceFiles"
>;

export type ReputationEntryOrchestratorDependencies = {
  materializeSource?: typeof materializeVerifiedSourcePackage;
  createSandbox?: (input: {
    runId: string;
    jobRunId: string;
    source: MaterializedSourcePackage;
    authorityGuard: TaskScopedAuthorityGuard;
    taskProfile: AgentRepairTaskProfile;
  }) => ReputationEntrySandboxController;
};

type ContractConfiguration =
  | { contractVersion: 1 }
  | { contractVersion: 2; deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyName };

export class ReputationEntryPilotOrchestrator {
  private readonly attemptId: string;
  private readonly batchRecordId: string;
  private readonly materializeSource: typeof materializeVerifiedSourcePackage;
  private readonly createSandbox: NonNullable<ReputationEntryOrchestratorDependencies["createSandbox"]>;

  constructor(
    private readonly durableStore: ReputationEntryDurableStore,
    options: { attemptId?: string; batchRecordId?: string } = {},
    private readonly providerFactory: () => AgentExecutionProvider = () => new VercelAIGatewayAgentProvider(),
    dependencies: ReputationEntryOrchestratorDependencies = {},
  ) {
    this.attemptId = requiredAttemptId(options.attemptId ?? "PHASE_B_ATTEMPT_1");
    this.batchRecordId = requiredText(options.batchRecordId ?? "replacement-phase-b-batch", "Batch record ID");
    this.materializeSource = dependencies.materializeSource ?? materializeVerifiedSourcePackage;
    this.createSandbox = dependencies.createSandbox ?? ((input) => new VercelAgentRepairSandbox(
      input.runId,
      input.jobRunId,
      input.source,
      input.authorityGuard,
      input.taskProfile,
    ));
  }

  async run(sources: ReputationEntryPilotSource[]): Promise<ReputationEntryPilotOutcome> {
    assertPilotSources(sources);
    const runState = { modelRequestsUsed: 0 };
    const agentProfile = createAgentIdentityProfile({
      displayName: "DoneLayer Replacement Corpus Agent",
      controller: {
        controllerType: "PLATFORM_ACCOUNT",
        accountType: "USER",
        accountId: "owner-controlled-replacement-corpus-phase-b",
        relationship: "CONTROLS",
        assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
        legallyVerified: false,
      },
      declaredCapabilities: ["BUILD_RESCUE", "TEST_AND_FIX"],
      runtimeReferences: [{
        system: "VERCEL_AI_GATEWAY",
        identifier: "VercelAIGatewayAgentProvider",
        verificationLevel: "OBSERVED",
      }],
    });
    this.persist(null, "AGENT_PROFILE", `${agentProfile.agentId}:${agentProfile.revision}`, agentProfile, agentProfile.createdAt);
    this.persist(null, "PILOT_OUTCOME", this.batchRecordId, {
      status: "STARTED",
      gate: REPUTATION_ENTRY_PILOT,
      attemptId: this.attemptId,
      candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
      authorizedJobCount: 2,
      canonicalQualifyingJobCountAdded: 0,
    }, agentProfile.createdAt, 1);

    const first = await this.runJob(agentProfile, sources[0]!, 1, runState, { contractVersion: 1 }) as ReputationEntryCandidateJob;
    const second = await this.runJob(agentProfile, sources[1]!, 2, runState, { contractVersion: 1 }) as ReputationEntryCandidateJob;
    const jobs: [ReputationEntryCandidateJob, ReputationEntryCandidateJob] = [first, second];
    for (const job of jobs) assertReputationEntryCandidateJobIntegrity(job);

    const uniqueFields = ["sourceCommitSha", "defectClass", "oracleSha256", "workContractSha256", "authoritySha256", "executionId"] as const;
    for (const field of uniqueFields) {
      if (jobs[0].evidenceBundle.uniqueness[field] === jobs[1].evidenceBundle.uniqueness[field]) {
        throw new Error(`REPUTATION_ENTRY_DUPLICATE_${field.toUpperCase()}`);
      }
    }
    const modelRequestsUsed = jobs.reduce((total, job) => total + job.agentRun.usage.apiRequestCount, 0);
    if (modelRequestsUsed > REPUTATION_ENTRY_MODEL_REQUEST_LIMIT) throw new Error("REPUTATION_ENTRY_MODEL_REQUEST_LIMIT_EXCEEDED");
    if (modelRequestsUsed !== runState.modelRequestsUsed) throw new Error("REPUTATION_ENTRY_MODEL_REQUEST_PERSISTENCE_MISMATCH");
    const sandboxesCreated = jobs.length * 2;
    if (sandboxesCreated > REPUTATION_ENTRY_SANDBOX_LIMIT) throw new Error("REPUTATION_ENTRY_SANDBOX_LIMIT_EXCEEDED");
    const reportedCosts = jobs.map((job) => job.agentRun.usage.gatewayReportedCostUsd);
    const gatewayReportedCostUsd = reportedCosts.every((cost): cost is number => cost !== null)
      ? reportedCosts.reduce((total, cost) => total + cost, 0)
      : null;
    const verifiedCandidateJobCount = jobs.filter((job) => isVerifiedReputationEntryCandidateResult(job.result)).length;
    const decision = verifiedCandidateJobCount === 2 ? "PASS" as const : "PARTIAL" as const;
    const outcome: ReputationEntryPilotOutcome = {
      gate: REPUTATION_ENTRY_PILOT,
      attemptId: this.attemptId,
      decision,
      candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
      agentProfile,
      jobs,
      corpus: {
        candidateJobCount: 2,
        verifiedCandidateJobCount,
        canonicalQualifyingJobCountAdded: 0,
        taskTypes: jobs.map((job) => job.contract.taskType),
        identityContinuity: jobs.every((job) =>
          job.executionIdentity.agent.agentId === agentProfile.agentId &&
          job.executionIdentity.agent.profileRevision === agentProfile.revision &&
          job.executionIdentity.agent.profileSha256 === agentProfile.profileSha256),
        remainingGapBeforeOwnerPromotion: 20,
        projectedGapAfterPromotion: 20 - verifiedCandidateJobCount,
      },
      limits: {
        modelRequestLimit: REPUTATION_ENTRY_MODEL_REQUEST_LIMIT,
        modelRequestsUsed,
        maxOutputTokensPerJob: MAX_OUTPUT_TOKENS_PER_JOB,
        declaredModelSpendCapUsd: REPUTATION_ENTRY_DECLARED_MODEL_SPEND_CAP_USD,
        deterministicCurrencyCapEnforcedByProvider: false,
        zeroPriceModelsOnly: true,
        gatewayReportedCostUsd,
        sandboxLimit: REPUTATION_ENTRY_SANDBOX_LIMIT,
        sandboxesCreated,
      },
      externalEffects: {
        fixtureBranchesRead: jobs.map((job) => job.contract.branch),
        pullRequestsCreated: 0,
        mergesPerformed: 0,
        deploymentsPerformed: 0,
        paymentsPerformed: 0,
        blockchainWritesPerformed: 0,
      },
      proposedQualificationDefinition: proposedQualificationDefinition(),
      recommendation: decision === "PASS" ? "ACCEPT_DEFINITION_AND_PROMOTE_VERIFIED_CANDIDATES" : "DO_NOT_PROMOTE",
      completedAt: new Date().toISOString(),
    };
    assertPilotOutcome(outcome);
    this.persist(null, "PILOT_OUTCOME", this.batchRecordId, persistablePilotOutcome(outcome), outcome.completedAt, 2);
    return outcome;
  }

  async runV2(
    sources: ReputationEntryPilotSource[],
    policies: ReputationEntryV2PolicySelection,
  ): Promise<ReputationEntryPilotOutcomeV2> {
    assertPilotSources(sources);
    assertV2PolicySelection(policies);
    const runState = { modelRequestsUsed: 0 };
    const agentProfile = createAgentIdentityProfile({
      displayName: "DoneLayer V2 Replacement Corpus Agent",
      controller: {
        controllerType: "PLATFORM_ACCOUNT",
        accountType: "USER",
        accountId: "owner-controlled-replacement-corpus-phase-b-v2",
        relationship: "CONTROLS",
        assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
        legallyVerified: false,
      },
      declaredCapabilities: ["BUILD_RESCUE", "TEST_AND_FIX"],
      runtimeReferences: [{
        system: "VERCEL_AI_GATEWAY",
        identifier: "VercelAIGatewayAgentProvider",
        verificationLevel: "OBSERVED",
      }],
    });
    this.persist(null, "AGENT_PROFILE", `${agentProfile.agentId}:${agentProfile.revision}`, agentProfile, agentProfile.createdAt);
    this.persist(null, "PILOT_OUTCOME", this.batchRecordId, {
      schemaVersion: 2,
      status: "STARTED",
      gate: REPUTATION_ENTRY_PILOT,
      attemptId: this.attemptId,
      candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
      authorizedJobCount: 2,
      deliveryOutcomePolicies: policies,
      canonicalQualifyingJobCountAdded: 0,
    }, agentProfile.createdAt, 1);

    const first = await this.runJob(agentProfile, sources[0]!, 1, runState, {
      contractVersion: 2,
      deliveryOutcomePolicy: policies.TEST_AND_FIX,
    }) as ReputationEntryCandidateJobV2;
    const second = await this.runJob(agentProfile, sources[1]!, 2, runState, {
      contractVersion: 2,
      deliveryOutcomePolicy: policies.BUILD_RESCUE,
    }) as ReputationEntryCandidateJobV2;
    const jobs: [ReputationEntryCandidateJobV2, ReputationEntryCandidateJobV2] = [first, second];
    for (const job of jobs) assertReputationEntryCandidateJobV2Integrity(job);

    if (
      jobs[0].contract.commitSha === jobs[1].contract.commitSha ||
      jobs[0].contract.taskType === jobs[1].contract.taskType ||
      jobs[0].contract.workContractSha256 === jobs[1].contract.workContractSha256 ||
      jobs[0].issuedLease.authoritySha256 === jobs[1].issuedLease.authoritySha256 ||
      jobs[0].executionIdentity.executionId === jobs[1].executionIdentity.executionId
    ) throw new Error("REPUTATION_ENTRY_V2_DUPLICATE_JOB_IDENTITY");

    const modelRequestsUsed = jobs.reduce((total, job) => total + job.agentRun.usage.apiRequestCount, 0);
    if (modelRequestsUsed > REPUTATION_ENTRY_MODEL_REQUEST_LIMIT) throw new Error("REPUTATION_ENTRY_MODEL_REQUEST_LIMIT_EXCEEDED");
    if (modelRequestsUsed !== runState.modelRequestsUsed) throw new Error("REPUTATION_ENTRY_MODEL_REQUEST_PERSISTENCE_MISMATCH");
    const sandboxesCreated = jobs.length * 2;
    if (sandboxesCreated > REPUTATION_ENTRY_SANDBOX_LIMIT) throw new Error("REPUTATION_ENTRY_SANDBOX_LIMIT_EXCEEDED");
    const reportedCosts = jobs.map((job) => job.agentRun.usage.gatewayReportedCostUsd);
    const gatewayReportedCostUsd = reportedCosts.every((cost): cost is number => cost !== null)
      ? reportedCosts.reduce((total, cost) => total + cost, 0)
      : null;
    const eligibleCandidateJobCount = jobs.filter((job) => job.candidateEligible).length;
    const decision = eligibleCandidateJobCount === 2 ? "PASS" as const : "PARTIAL" as const;
    const outcome: ReputationEntryPilotOutcomeV2 = {
      schemaVersion: 2,
      gate: REPUTATION_ENTRY_PILOT,
      attemptId: this.attemptId,
      decision,
      candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
      agentProfile,
      jobs,
      corpus: {
        candidateJobCount: 2,
        eligibleCandidateJobCount,
        canonicalQualifyingJobCountAdded: 0,
        taskTypes: jobs.map((job) => job.contract.taskType),
        identityContinuity: jobs.every((job) =>
          job.executionIdentity.agent.agentId === agentProfile.agentId &&
          job.executionIdentity.agent.profileRevision === agentProfile.revision &&
          job.executionIdentity.agent.profileSha256 === agentProfile.profileSha256),
        remainingGapBeforeOwnerPromotion: 20,
        projectedGapAfterPromotion: 20 - eligibleCandidateJobCount,
      },
      limits: {
        modelRequestLimit: REPUTATION_ENTRY_MODEL_REQUEST_LIMIT,
        modelRequestsUsed,
        maxOutputTokensPerJob: MAX_OUTPUT_TOKENS_PER_JOB,
        declaredModelSpendCapUsd: REPUTATION_ENTRY_DECLARED_MODEL_SPEND_CAP_USD,
        deterministicCurrencyCapEnforcedByProvider: false,
        zeroPriceModelsOnly: true,
        gatewayReportedCostUsd,
        sandboxLimit: REPUTATION_ENTRY_SANDBOX_LIMIT,
        sandboxesCreated,
      },
      externalEffects: {
        fixtureBranchesRead: jobs.map((job) => job.contract.branch),
        pullRequestsCreated: 0,
        mergesPerformed: 0,
        deploymentsPerformed: 0,
        paymentsPerformed: 0,
        blockchainWritesPerformed: 0,
      },
      completedAt: new Date().toISOString(),
    };
    assertPilotOutcomeV2(outcome);
    this.persist(null, "PILOT_OUTCOME", this.batchRecordId, persistablePilotOutcomeV2(outcome), outcome.completedAt, 2);
    return outcome;
  }

  private async runJob(
    profile: AgentIdentityProfile,
    requestedSource: ReputationEntryPilotSource,
    ordinal: number,
    runState: { modelRequestsUsed: number },
    configuration: ContractConfiguration,
  ): Promise<ReputationEntryCandidateJob | ReputationEntryCandidateJobV2> {
    const jobId = randomUUID();
    const lifecycle: {
      issuedLease: TaskScopedPermissionLease | null;
      terminalLease: (TaskScopedPermissionLease & { status: "REVOKED" }) | null;
      stage: string;
    } = { issuedLease: null, terminalLease: null, stage: "JOB_CREATED" };
    this.persist(jobId, "JOB_IDENTITY", jobId, {
      jobId,
      attemptId: this.attemptId,
      ordinal,
      taskType: requestedSource.taskType,
      candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
      requestedSource,
    });
    try {
      return await this.executeJob(profile, requestedSource, ordinal, jobId, lifecycle, runState, configuration);
    } catch (error) {
      if (lifecycle.issuedLease && !lifecycle.terminalLease) {
        lifecycle.terminalLease = revokeTaskScopedPermissionLease({
          lease: lifecycle.issuedLease,
          revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
          reason: `Replacement corpus Job stopped fail-closed during ${lifecycle.stage}`,
        });
        this.persist(jobId, "AUTHORITY_LEASE_REVOKED", lifecycle.terminalLease.id, lifecycle.terminalLease, lifecycle.terminalLease.revokedAt ?? undefined, 2);
      }
      this.persist(jobId, "PILOT_OUTCOME", `${jobId}:partial`, {
        status: "PARTIAL_FAILURE",
        attemptId: this.attemptId,
        stage: lifecycle.stage,
        failureCode: safeFailureCode(error),
        sourceMaterializationFailure: lifecycle.stage === "SOURCE_MATERIALIZATION"
          ? sourceMaterializationFailureEvidence(error)
          : null,
        authorityLeaseFinalState: lifecycle.terminalLease?.status ?? null,
        missingEvidenceWasNotReconstructed: true,
      });
      throw error;
    }
  }

  private async executeJob(
    profile: AgentIdentityProfile,
    requestedSource: ReputationEntryPilotSource,
    ordinal: number,
    jobId: string,
    lifecycle: {
      issuedLease: TaskScopedPermissionLease | null;
      terminalLease: (TaskScopedPermissionLease & { status: "REVOKED" }) | null;
      stage: string;
    },
    runState: { modelRequestsUsed: number },
    configuration: ContractConfiguration,
  ): Promise<ReputationEntryCandidateJob | ReputationEntryCandidateJobV2> {
    lifecycle.stage = "SOURCE_MATERIALIZATION";
    const source = await this.materializeSource({
      branch: requestedSource.branch,
      expectedCommitSha: requestedSource.commitSha,
      allowedDeliveryBranch: requestedSource.branch,
    });
    this.persist(jobId, "SOURCE_IDENTITY", `${jobId}:source`, durableSourceIdentity(source));
    lifecycle.stage = "WORK_CONTRACT";
    const contractInput = {
      taskId: `reputation-entry-${ordinal}-${jobId}`,
      taskType: requestedSource.taskType,
      assignedAgent: agentIdentityReference(profile),
      source: {
        branch: source.identity.branch,
        commitSha: source.identity.commitSha,
        manifestSha256: source.repositoryManifestSha256,
        files: source.repositoryManifest.files,
      },
      ...(requestedSource.taskDefinitionVersion === undefined
        ? {}
        : { taskDefinitionVersion: requestedSource.taskDefinitionVersion }),
    };
    const contract: ReputationEntryWorkContract | ReputationEntryWorkContractV2 = configuration.contractVersion === 2
      ? createReputationEntryWorkContractV2({
          ...contractInput,
          deliveryOutcomePolicy: configuration.deliveryOutcomePolicy,
        })
      : createReputationEntryWorkContract(contractInput);
    if (contract.schemaVersion === 1) assertReputationEntryWorkContractIntegrity(contract);
    this.persist(jobId, "WORK_CONTRACT", contract.taskId, contract, contract.lockedAt, contract.schemaVersion);

    lifecycle.stage = "PROVIDER_PREFLIGHT";
    const provider = this.providerFactory();
    const availability = await provider.checkAvailability();
    if (!availability.available || !availability.credits || availability.authentication === "UNAVAILABLE") {
      throw new Error(`${availability.errorCode ?? "AI_GATEWAY_UNAVAILABLE"}: ${availability.errorMessage ?? "preflight failed"}`);
    }
    const models = await provider.listEligibleModels();
    const model = models[0];
    if (!model || !model.isFree || Number(model.pricing.input) !== 0 || Number(model.pricing.output) !== 0) {
      throw new Error("REPUTATION_ENTRY_ZERO_PRICE_MODEL_UNAVAILABLE");
    }
    this.persist(jobId, "EVIDENCE_BUNDLE_INTERMEDIATE", `${jobId}:provider-preflight`, {
      stage: "PROVIDER_PREFLIGHT_PASSED",
      availability,
      selectedModel: model,
    }, undefined, 1);
    const executionId = generateExecutionId();
    const jobRunId = randomUUID();
    const decidedAt = new Date().toISOString();
    const authorityDecision = decideTaskScopedAuthority({
      contract,
      subject: {
        agentId: profile.agentId,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        jobRunId,
        agentIdentity: agentIdentityReference(profile),
        executionId,
      },
      durationSeconds: 600,
      decidedAt,
      approvals: [],
    });
    const issuedLease = issueTaskScopedPermissionLease(authorityDecision);
    lifecycle.issuedLease = issuedLease;
    this.persist(jobId, "AUTHORITY_LEASE_ISSUED", issuedLease.id, issuedLease, issuedLease.startsAt);
    const executionIdentity = createAgentExecutionIdentity({
      executionId,
      profile,
      contract,
      authorityLease: issuedLease,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      runtime: {
        provider: "Vercel AI Gateway",
        modelId: model.id,
        sandboxProvider: MANAGED_SANDBOX_PROVIDER,
      },
    });
    this.persist(jobId, "EXECUTION_IDENTITY", executionIdentity.executionId, executionIdentity, executionIdentity.startedAt);
    this.persist(jobId, "EVIDENCE_BUNDLE_INTERMEDIATE", `${jobId}:authorized`, {
      stage: "AUTHORIZED",
      jobId,
      executionId,
      agent: agentIdentityReference(profile),
      workContract: { id: contract.taskId, version: contract.contractVersion, sha256: contract.workContractSha256 },
      authority: { leaseId: issuedLease.id, sha256: issuedLease.authoritySha256, status: issuedLease.status },
      source: durableSourceIdentity(source),
    }, executionIdentity.startedAt, 1);
    const authorityOperations: TaskScopedAuthorityOperationEvidence[] = [];
    const authorityGuard = requireTaskScopedAuthorityGuard(issuedLease, {
      contract,
      subject: issuedLease.authority.subject,
      onDecision: (operation) => {
        const evidence = { ...operation, sequence: authorityOperations.length + 1 };
        authorityOperations.push(evidence);
        this.persist(jobId, "EVIDENCE_BUNDLE_INTERMEDIATE", `${jobId}:authority-operation:${evidence.sequence}`, evidence, evidence.recordedAt);
      },
    });
    authorityGuard.assertRepositoryReadAllowed({
      remoteUrl: contract.remoteUrl,
      baseRef: contract.branch,
      commitSha: contract.commitSha,
    });

    const taskDefinition = contract.taskDefinition
      ? reputationEntryTaskDefinitionVersion(contract.taskType, contract.taskDefinition.version)
      : reputationEntryTaskDefinition(contract.taskType);
    const taskProfile: AgentRepairTaskProfile = {
      taskType: contract.taskType,
      primaryCommand: contract.acceptanceCriteria.commands.find((command) => command.role === "PRIMARY")!.command,
      editableFiles: taskDefinition.editableFiles,
      sandboxPurpose: "AGENT_REPAIR",
    };
    const repairController = this.createSandbox({ runId: jobId, jobRunId, source, authorityGuard, taskProfile });
    let repairStart: Awaited<ReturnType<ReputationEntrySandboxController["start"]>> | null = null;
    let repairCleanup: RepairSandboxCleanup | null = null;
    let toolSet: ReturnType<typeof createAgentRepairTools> | null = null;
    let agentRun: ReputationEntryCandidateJob["agentRun"] | null = null;
    let patch = { patch: "", sha256: sha256Canonical(""), modifiedFiles: [] as string[] };
    let patchedFiles: Array<{ path: string; content: string; sha256: string }> = [];
    let repairSourceIntegrity: RepairSourceIntegrity | null = null;
    const modelRequestsBeforeJob = runState.modelRequestsUsed;
    lifecycle.stage = "AGENT_REPAIR_SANDBOX";
    try {
      repairStart = await repairController.start();
      this.persist(jobId, "AGENT_SANDBOX_STARTED", repairStart.sandboxId, repairStart);
      this.persist(jobId, "BASELINE_FAILURE", repairStart.baselineTest.commandId, repairStart.baselineTest, repairStart.baselineTest.finishedAt);
      authorityGuard.assertActionAllowedWithEvidence("inspect_baseline_failure");
      toolSet = createAgentRepairTools(repairController, (call) => {
        this.persist(jobId, "AGENT_TOOL_CALL", `${jobId}:${call.sequence}`, call, call.finishedAt);
      });
      this.persist(jobId, "AGENT_MODEL_RUN", `${jobId}:model-run`, {
        status: "REQUESTED",
        model,
        maxSteps: MAX_MODEL_STEPS_PER_JOB,
        maxOutputTokens: MAX_OUTPUT_TOKENS_PER_JOB,
        providerRetryLimit: 1,
      }, undefined, 1);
      lifecycle.stage = "AGENT_MODEL_RUN";
      agentRun = await provider.createRun({
        model,
        instructions: agentInstructions(contract.taskType),
        prompt: agentPrompt(contract, repairStart.baselineTest),
        tools: toolSet.tools,
        maxSteps: MAX_MODEL_STEPS_PER_JOB,
        maxOutputTokens: MAX_OUTPUT_TOKENS_PER_JOB,
        providerRetryLimit: 1,
        tag: `donelayer-reputation-entry-${jobId}`,
        onModelRequest: (request) => {
          if (runState.modelRequestsUsed >= REPUTATION_ENTRY_MODEL_REQUEST_LIMIT) {
            throw new Error("REPUTATION_ENTRY_MODEL_REQUEST_LIMIT_EXCEEDED");
          }
          runState.modelRequestsUsed += 1;
          this.persist(jobId, "AGENT_MODEL_REQUEST", `${jobId}:model-request:${request.requestSequence}`, {
            ...request,
            attemptId: this.attemptId,
            jobId,
            cumulativeAttemptRequestCount: runState.modelRequestsUsed,
          }, request.requestedAt);
        },
      });
      if (agentRun.usage.apiRequestCount !== runState.modelRequestsUsed - modelRequestsBeforeJob) {
        throw new Error("REPUTATION_ENTRY_MODEL_REQUEST_PERSISTENCE_MISMATCH");
      }
      this.persist(jobId, "AGENT_MODEL_RUN", `${jobId}:model-run`, agentRun, agentRun.finishedAt, 2);
      patch = await repairController.getDiff();
      this.persist(jobId, "SOURCE_PATCH", `${jobId}:patch`, patch);
      patchedFiles = await repairController.getPatchedSourceFiles();
      repairSourceIntegrity = await repairController.getSourceIntegrity();
      this.persist(jobId, "REPAIR_SOURCE_INTEGRITY", `${jobId}:repair-source-integrity`, repairSourceIntegrity, repairSourceIntegrity.checkedAt);
    } finally {
      repairCleanup = await repairController.cleanupIfRunning();
      if (repairCleanup) {
        this.persist(jobId, "REPAIR_SANDBOX_CLEANUP", repairCleanup.sandboxId, repairCleanup, repairCleanup.stopConfirmedAt);
      }
    }
    if (!repairStart || !repairCleanup || !toolSet || !agentRun || !repairSourceIntegrity) {
      throw new Error("REPUTATION_ENTRY_AGENT_EXECUTION_INCOMPLETE");
    }

    lifecycle.stage = "INDEPENDENT_VERIFICATION";
    const independentVerification = await runIndependentVerification({
      jobId,
      jobRunId,
      source,
      contract,
      authorityGuard,
      createSandbox: this.createSandbox,
      repairSandboxId: repairStart.sandboxId,
      agentPatch: patch,
      patchedFiles,
      persist: (recordType, recordId, payload, createdAt) => this.persist(jobId, recordType, recordId, payload, createdAt),
    });
    const terminalLease = revokeTaskScopedPermissionLease({
      lease: issuedLease,
      revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
      reason: "Bounded Reputation entry candidate Job concluded; no continuing authority is permitted",
    });
    lifecycle.terminalLease = terminalLease;
    this.persist(jobId, "AUTHORITY_LEASE_REVOKED", terminalLease.id, terminalLease, terminalLease.revokedAt ?? undefined, 2);
    const artifacts = createArtifacts({
      profile,
      executionIdentity,
      contract,
      authorityDecision,
      issuedLease,
      terminalLease,
      authorityOperations,
      source,
      repairStart,
      repairCleanup,
      agentRun,
      toolCalls: toolSet.calls,
      patch,
      repairSourceIntegrity,
      independentVerification,
    });

    if (contract.schemaVersion === 2) {
      const outcomeEvaluation = evaluateV2LiveOrchestratorDelivery({
        contract,
        agentRun,
        patch,
        allowedFiles: taskDefinition.editableFiles,
        repairSourceIntegrity,
        independentVerification,
        authorityDecision,
        terminalLease,
        authorityOperations,
        repairSandboxId: repairStart.sandboxId,
        repairCleanup,
        artifacts,
      });
      this.persist(
        jobId,
        "DELIVERY_OUTCOME_EVALUATION",
        `${jobId}:delivery-outcome`,
        outcomeEvaluation,
        terminalLease.revokedAt ?? undefined,
        1,
      );
      const evidenceBundle = createReputationEntryOutcomeEvidenceBundleV2({
        contract,
        evaluation: outcomeEvaluation,
        evidence: artifacts.map((artifact) => ({ kind: artifact.evidenceKind, sha256: artifact.sha256 })),
        createdAt: new Date().toISOString(),
      });
      this.persist(jobId, "EVIDENCE_ARTIFACTS", `${jobId}:artifacts`, artifacts);
      this.persist(jobId, "EVIDENCE_BUNDLE_FINAL", evidenceBundle.bundleSha256, evidenceBundle, evidenceBundle.createdAt, 2);
      const ledgerEntries = buildLedgerV2({
        jobId,
        profile,
        contract,
        authorityDecision,
        issuedLease,
        terminalLease,
        executionIdentity,
        source,
        repairStart,
        repairCleanup,
        agentRun,
        toolCalls: toolSet.calls,
        patch,
        independentVerification,
        authorityOperations,
        artifacts,
        evidenceBundle,
        outcomeEvaluation,
      });
      const preReceiptLedger = verifyReputationEntryLedger(ledgerEntries);
      const receipt = createReputationEntryOutcomeReceiptV2({
        id: randomUUID(),
        publicReceiptId: `dlr_${randomUUID().replaceAll("-", "")}`,
        contract,
        bundle: evidenceBundle,
        preReceiptLedger,
        issuedAt: new Date().toISOString(),
      });
      appendReputationEntryLedger(ledgerEntries, {
        entryType: "RECEIPT_CREATED",
        sourceRecordType: "verified_job_receipt",
        sourceRecordId: receipt.id,
        payload: {
          receiptSha256: receipt.receiptSha256,
          evidenceBundleSha256: evidenceBundle.bundleSha256,
          evidenceChainSha256: receipt.evidenceChainSha256,
        },
        createdAt: receipt.document.issuedAt,
      });
      const ledgerVerification = verifyReputationEntryLedger(ledgerEntries);
      const job: ReputationEntryCandidateJobV2 = {
        schemaVersion: 2,
        jobId,
        candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
        agentProfile: profile,
        contract,
        authorityDecision,
        issuedLease,
        terminalLease,
        executionIdentity,
        source,
        agentRun,
        toolCalls: [...toolSet.calls],
        authorityOperations,
        patch,
        repairSourceIntegrity,
        repairSandbox: { sandboxId: repairStart.sandboxId, baseline: repairStart.baselineTest, cleanup: repairCleanup },
        independentVerification,
        artifacts,
        outcomeEvaluation,
        candidateEligible: outcomeEvaluation.deliveryOutcome === "VERIFIED_DELIVERY",
        evidenceBundle,
        ledgerEntries,
        ledgerVerification,
        receipt,
        publicOutcomeSummary: toVerifiedDeliveryOutcomePublicSummary(receipt),
      };
      assertReputationEntryCandidateJobV2Integrity(job);
      this.persist(jobId, "EVIDENCE_LEDGER_FINAL", `${jobId}:ledger`, {
        entries: ledgerEntries,
        verification: ledgerVerification,
      });
      this.persist(jobId, "VERIFIED_JOB_RECEIPT", receipt.id, receipt, receipt.document.issuedAt, 2);
      this.persist(jobId, "PILOT_OUTCOME", `${jobId}:candidate-outcome`, persistableJobV2(job), receipt.document.issuedAt, 2);
      return job;
    }

    const agentPrimary = contract.taskType === "TEST_AND_FIX" ? toolSet.getLastRepairTest() : toolSet.getLastBuild();
    const agentActionComplete = agentRun.status === "COMPLETED" &&
      agentPrimary?.exitCode === 0 &&
      patch.modifiedFiles.length > 0 &&
      sameValues(patch.modifiedFiles, taskDefinition.editableFiles) &&
      repairSourceIntegrity.missing.length === 0 &&
      repairSourceIntegrity.added.length === 0 &&
      repairSourceIntegrity.unauthorizedModified.length === 0 &&
      toolSet.calls.some((call) => call.toolName === "get_diff" && call.success) &&
      toolSet.calls.some((call) => call.toolName === "get_source_integrity" && call.success);
    const result: ReputationEntryResult = agentActionComplete && independentVerification.verified
      ? "VERIFIED"
      : patch.modifiedFiles.length > 0 && independentVerification.commands.length > 0
        ? "FAILED"
        : "INCONCLUSIVE";
    const evidenceBundle = createReputationEntryEvidenceBundle({
      jobId,
      result,
      contract,
      profile,
      execution: executionIdentity,
      terminalLease,
      source,
      agentRun,
      toolCalls: toolSet.calls,
      repairSandboxId: repairStart.sandboxId,
      independentVerification,
      repairCleanup,
      artifacts,
    });
    this.persist(jobId, "EVIDENCE_ARTIFACTS", `${jobId}:artifacts`, artifacts);
    this.persist(jobId, "EVIDENCE_BUNDLE_FINAL", evidenceBundle.bundleSha256, evidenceBundle, evidenceBundle.createdAt);
    const ledgerEntries = buildLedger({
      jobId,
      profile,
      contract,
      authorityDecision,
      issuedLease,
      terminalLease,
      executionIdentity,
      source,
      repairStart,
      repairCleanup,
      agentRun,
      toolCalls: toolSet.calls,
      patch,
      independentVerification,
      authorityOperations,
      artifacts,
      evidenceBundle,
      result,
    });
    const preReceiptLedger = verifyReputationEntryLedger(ledgerEntries);
    const receipt = createReputationEntryReceipt({
      result,
      contract,
      execution: executionIdentity,
      terminalLease,
      authorityOperations,
      bundle: evidenceBundle,
      agentRun,
      preReceiptLedger,
    });
    appendReputationEntryLedger(ledgerEntries, {
      entryType: "RECEIPT_CREATED",
      sourceRecordType: "verified_job_receipt",
      sourceRecordId: receipt.id,
      payload: {
        receiptSha256: receipt.receiptSha256,
        evidenceBundleSha256: evidenceBundle.bundleSha256,
        evidenceChainSha256: receipt.evidenceChainSha256,
      },
      createdAt: receipt.document.issuedAt,
    });
    const ledgerVerification = verifyReputationEntryLedger(ledgerEntries);
    const job: ReputationEntryCandidateJob = {
      jobId,
      candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
      result,
      agentProfile: profile,
      contract,
      authorityDecision,
      issuedLease,
      terminalLease,
      executionIdentity,
      source,
      agentRun,
      toolCalls: [...toolSet.calls],
      authorityOperations,
      patch,
      repairSourceIntegrity,
      repairSandbox: { sandboxId: repairStart.sandboxId, baseline: repairStart.baselineTest, cleanup: repairCleanup },
      independentVerification,
      artifacts,
      evidenceBundle,
      ledgerEntries,
      ledgerVerification,
      receipt,
    };
    assertReputationEntryCandidateJobIntegrity(job);
    this.persist(jobId, "EVIDENCE_LEDGER_FINAL", `${jobId}:ledger`, {
      entries: ledgerEntries,
      verification: ledgerVerification,
    });
    this.persist(jobId, "VERIFIED_JOB_RECEIPT", receipt.id, receipt, receipt.document.issuedAt);
    this.persist(jobId, "PILOT_OUTCOME", `${jobId}:candidate-outcome`, persistableJob(job), receipt.document.issuedAt);
    return job;
  }

  private persist(
    jobId: string | null,
    recordType: DurableRecordType,
    recordId: string,
    payload: unknown,
    createdAt?: string,
    recordVersion = 1,
  ): void {
    this.durableStore.appendRecord({ jobId, recordType, recordId, recordVersion, payload, ...(createdAt ? { createdAt } : {}) });
  }
}

async function runIndependentVerification(input: {
  jobId: string;
  jobRunId: string;
  source: MaterializedSourcePackage;
  contract: ReputationEntryWorkContract | ReputationEntryWorkContractV2;
  authorityGuard: TaskScopedAuthorityGuard;
  createSandbox: NonNullable<ReputationEntryOrchestratorDependencies["createSandbox"]>;
  repairSandboxId: string;
  agentPatch: ReputationEntryCandidateJob["patch"];
  patchedFiles: Array<{ path: string; content: string; sha256: string }>;
  persist: (recordType: DurableRecordType, recordId: string, payload: unknown, createdAt?: string) => void;
}): Promise<IndependentVerificationEvidence> {
  const profile: AgentRepairTaskProfile = {
    taskType: input.contract.taskType,
    primaryCommand: input.contract.acceptanceCriteria.commands.find((command) => command.role === "PRIMARY")!.command,
    editableFiles: input.contract.authorityPolicy!.allowedFiles,
    sandboxPurpose: "INDEPENDENT_VERIFICATION",
  };
  const controller = input.createSandbox({
    runId: `${input.jobId}-verify`,
    jobRunId: input.jobRunId,
    source: input.source,
    authorityGuard: input.authorityGuard,
    taskProfile: profile,
  });
  let started: Awaited<ReturnType<ReputationEntrySandboxController["start"]>> | null = null;
  let cleanup: RepairSandboxCleanup | null = null;
  const commands: RepairSandboxCommand[] = [];
  const oracleFiles: IndependentVerificationEvidence["oracleFiles"] = [];
  let verifierPatch = { patch: "", sha256: sha256Canonical(""), modifiedFiles: [] as string[] };
  let sourceIntegrity: RepairSourceIntegrity | null = null;
  try {
    started = await controller.start();
    input.persist("VERIFIER_SANDBOX_STARTED", started.sandboxId, started);
    const beforeHashes = new Map(input.source.repositoryManifest.files.map((file) => [file.relative_path, file.sha256]));
    for (const file of input.patchedFiles) {
      await controller.applyPatch({
        path: file.path,
        expectedSha256: beforeHashes.get(file.path) ?? "",
        replacement: file.content,
      });
    }
    for (const oracle of input.contract.acceptanceCriteria.protectedOracleFiles) {
      const observed = await controller.readFile(oracle.path);
      oracleFiles.push({
        path: oracle.path,
        expectedSha256: oracle.sha256,
        observedSha256: observed.sha256,
        valid: oracle.sha256 === observed.sha256,
      });
    }
    if (input.patchedFiles.length > 0) {
      for (const command of input.contract.acceptanceCriteria.commands) {
        const result = command.command === "npm test" ? await controller.runTest() : await controller.runBuild();
        commands.push(result);
        input.persist("VERIFIER_COMMAND", result.commandId, result, result.finishedAt);
      }
    }
    verifierPatch = await controller.getDiff();
    sourceIntegrity = await controller.getSourceIntegrity();
  } finally {
    cleanup = await controller.cleanupIfRunning();
    if (cleanup) input.persist("VERIFIER_SANDBOX_CLEANUP", cleanup.sandboxId, cleanup, cleanup.stopConfirmedAt);
  }
  if (!started || !cleanup || !sourceIntegrity) throw new Error("REPUTATION_ENTRY_INDEPENDENT_VERIFICATION_INCOMPLETE");
  const matchesAgentPatch = verifierPatch.sha256 === input.agentPatch.sha256 && sameValues(verifierPatch.modifiedFiles, input.agentPatch.modifiedFiles);
  const verified = started.sandboxId !== input.repairSandboxId &&
    started.baselineTest.exitCode !== 0 &&
    commands.length === input.contract.acceptanceCriteria.commands.length &&
    commands.every((command) => command.exitCode === 0) &&
    oracleFiles.every((file) => file.valid) &&
    matchesAgentPatch &&
    sourceIntegrity.missing.length === 0 &&
    sourceIntegrity.added.length === 0 &&
    sourceIntegrity.unauthorizedModified.length === 0 &&
    cleanup.cleanupVerified &&
    cleanup.snapshotCreated === false;
  const evidence = {
    sandboxId: started.sandboxId,
    repairSandboxId: input.repairSandboxId,
    freshSandbox: started.sandboxId !== input.repairSandboxId,
    baseline: started.baselineTest,
    commands,
    oracleFiles,
    patchSha256: verifierPatch.sha256,
    matchesAgentPatch,
    sourceIntegrity,
    cleanup,
    verified,
  };
  input.persist("VERIFIER_RESULT", `${input.jobId}:independent-verification`, evidence, cleanup.stopConfirmedAt);
  return evidence;
}

function createArtifacts(input: {
  profile: ReputationEntryCandidateJob["agentProfile"];
  executionIdentity: ReputationEntryCandidateJob["executionIdentity"];
  contract: ReputationEntryWorkContract | ReputationEntryWorkContractV2;
  authorityDecision: ReputationEntryCandidateJob["authorityDecision"];
  issuedLease: ReputationEntryCandidateJob["issuedLease"];
  terminalLease: ReputationEntryCandidateJob["terminalLease"];
  authorityOperations: ReputationEntryCandidateJob["authorityOperations"];
  source: ReputationEntryCandidateJob["source"];
  repairStart: Awaited<ReturnType<ReputationEntrySandboxController["start"]>>;
  repairCleanup: RepairSandboxCleanup;
  agentRun: ReputationEntryCandidateJob["agentRun"];
  toolCalls: ReputationEntryCandidateJob["toolCalls"];
  patch: ReputationEntryCandidateJob["patch"];
  repairSourceIntegrity: ReputationEntryCandidateJob["repairSourceIntegrity"];
  independentVerification: IndependentVerificationEvidence;
}): ReputationEntryArtifact[] {
  const artifacts = [
    createReputationEntryArtifact("AGENT_IDENTITY", "agent-identity.json", input.profile),
    createReputationEntryArtifact("EXECUTION_IDENTITY", "execution-identity.json", input.executionIdentity),
    createReputationEntryArtifact("WORK_CONTRACT", "work-contract.json", input.contract),
    createReputationEntryArtifact("TASK_SCOPED_AUTHORITY", "task-scoped-authority.json", {
      decision: input.authorityDecision,
      issuedLease: input.issuedLease,
      terminalLease: input.terminalLease,
      operations: input.authorityOperations,
    }),
    createReputationEntryArtifact("SOURCE_IDENTITY", "source-identity.json", {
      remoteUrl: input.source.identity.remoteUrl,
      branch: input.source.identity.branch,
      commitSha: input.source.identity.commitSha,
      repositoryManifestSha256: input.source.repositoryManifestSha256,
      sourcePackageSha256: input.source.sourcePackageSha256,
      files: input.source.repositoryManifest.files,
      materializerWorkspaceCleaned: input.source.materializerWorkspaceCleaned,
    }),
    createReputationEntryArtifact("BASELINE_FAILURE", "baseline-failure.json", input.repairStart.baselineTest),
    createReputationEntryArtifact("AGENT_MODEL_RUN", "agent-model-run.json", input.agentRun),
    createReputationEntryArtifact("AGENT_TOOL_ACTIONS", "agent-tool-actions.json", input.toolCalls),
    createReputationEntryArtifact("SOURCE_CHANGE", "agent.patch", input.patch.patch, "text/plain"),
    createReputationEntryArtifact("FRESH_INDEPENDENT_VERIFICATION", "independent-verification.json", input.independentVerification),
    createReputationEntryArtifact("LEASE_TERMINAL_STATE", "lease-terminal-state.json", input.terminalLease),
    createReputationEntryArtifact("SANDBOX_CLEANUP", "sandbox-cleanup.json", {
      repair: input.repairCleanup,
      verifier: input.independentVerification.cleanup,
      repairSourceIntegrity: input.repairSourceIntegrity,
    }),
  ];
  assertNoCredentialLeak(artifacts);
  artifacts.push(createReputationEntryArtifact("CREDENTIAL_SCAN", "credential-scan.json", {
    passed: true,
    scannedArtifactCount: artifacts.length,
  }));
  assertNoCredentialLeak(artifacts);
  return artifacts;
}

export function evaluateV2LiveOrchestratorDelivery(input: {
  contract: ReputationEntryWorkContractV2;
  agentRun: AgentRunResult;
  patch: ReputationEntryCandidateJob["patch"];
  allowedFiles: string[];
  repairSourceIntegrity: RepairSourceIntegrity;
  independentVerification: IndependentVerificationEvidence;
  authorityDecision: TaskScopedAuthorityDecision;
  terminalLease: TaskScopedPermissionLease & { status: "REVOKED" };
  authorityOperations: TaskScopedAuthorityOperationEvidence[];
  repairSandboxId: string;
  repairCleanup: RepairSandboxCleanup;
  artifacts: ReputationEntryArtifact[];
}): VerifiedDeliveryOutcomeEvaluation {
  const { executionOutcome, executionFailureAttribution } = executionOutcomeFromAgentRun(input.agentRun);
  const independentVerificationOutcome = verificationOutcomeFromEvidence(
    input.independentVerification,
    input.contract.acceptanceCriteria.commands.length,
    input.patch.modifiedFiles.length > 0,
  );
  const requiredEvidence = input.contract.evidencePolicy.required.filter(
    (kind) => kind !== "EVIDENCE_LEDGER" && kind !== "VERIFIED_JOB_RECEIPT",
  );
  const artifactKinds = new Set<string>(input.artifacts.map((artifact) => artifact.evidenceKind));
  const cleanRepairSource = cleanSourceIntegrity(input.repairSourceIntegrity, input.contract.commitSha);
  const cleanVerifierSource = cleanSourceIntegrity(input.independentVerification.sourceIntegrity, input.contract.commitSha);
  const authorizedDeliverableExists = input.patch.modifiedFiles.length > 0 &&
    sameValues(input.patch.modifiedFiles, input.allowedFiles) &&
    input.patch.patch.length > 0;
  const authorityValid = input.authorityDecision.decision === "APPROVED" &&
    input.authorityDecision.workContract.id === input.contract.taskId &&
    input.authorityDecision.workContract.version === input.contract.contractVersion &&
    input.authorityDecision.workContract.sha256 === input.contract.workContractSha256 &&
    input.terminalLease.status === "REVOKED" &&
    input.terminalLease.authority.workContract.sha256 === input.contract.workContractSha256 &&
    input.authorityOperations.length > 0 &&
    input.authorityOperations.every((operation) =>
      operation.decision === "ALLOWED" && operation.authoritySha256 === input.terminalLease.authoritySha256);
  const cleanupValid = cleanupIsValid(input.repairCleanup) && cleanupIsValid(input.independentVerification.cleanup);
  const trustChecks: VerifiedDeliveryTrustChecks = {
    authorizedDeliverableExists,
    requiredEvidenceComplete: requiredEvidence.every((kind) => artifactKinds.has(kind)),
    sourceIntegrityValid: cleanRepairSource && cleanVerifierSource,
    authorityValid,
    provenanceValid: input.independentVerification.freshSandbox &&
      input.independentVerification.sandboxId !== input.repairSandboxId &&
      input.independentVerification.repairSandboxId === input.repairSandboxId &&
      input.independentVerification.matchesAgentPatch &&
      input.independentVerification.patchSha256 === input.patch.sha256,
    lifecycleIntegrityValid: input.terminalLease.status === "REVOKED" && cleanupValid,
    cleanupValid,
    externalEffectsPolicyValid: Object.values(input.contract.externalEffectsPolicy).every((value) => value === "FORBIDDEN") &&
      !input.repairCleanup.snapshotCreated &&
      !input.independentVerification.cleanup.snapshotCreated,
  };
  return evaluateReputationEntryDeliveryOutcome({
    contract: input.contract,
    executionOutcome,
    executionFailureAttribution,
    independentVerificationOutcome,
    trustChecks,
  });
}

function executionOutcomeFromAgentRun(agentRun: AgentRunResult): {
  executionOutcome: AgentExecutionOutcome;
  executionFailureAttribution: ExecutionFailureAttribution;
} {
  if (agentRun.status === "COMPLETED") {
    return { executionOutcome: "COMPLETED", executionFailureAttribution: "NOT_APPLICABLE" };
  }
  if (agentRun.status === "CANCELLED") {
    return { executionOutcome: "INCONCLUSIVE", executionFailureAttribution: "UNKNOWN" };
  }
  if (/timeout|timed out/i.test(agentRun.finishReason)) {
    return { executionOutcome: "TIMEOUT", executionFailureAttribution: "INFRASTRUCTURE" };
  }
  if (/gateway|provider|rate.?limit|upstream/i.test(agentRun.finishReason)) {
    return { executionOutcome: "PROVIDER_FAILURE", executionFailureAttribution: "MODEL_PROVIDER" };
  }
  return { executionOutcome: "FAILED", executionFailureAttribution: "AGENT" };
}

function verificationOutcomeFromEvidence(
  evidence: IndependentVerificationEvidence,
  expectedCommandCount: number,
  deliverableExists: boolean,
): IndependentWorkVerificationOutcome {
  if (!deliverableExists) return "NO_DELIVERABLE";
  if (evidence.verified) return "VERIFIED";
  if (
    !evidence.freshSandbox ||
    !evidence.matchesAgentPatch ||
    evidence.oracleFiles.some((file) => !file.valid) ||
    evidence.sourceIntegrity.missing.length > 0 ||
    evidence.sourceIntegrity.added.length > 0 ||
    evidence.sourceIntegrity.unauthorizedModified.length > 0
  ) return "INVALID_EVIDENCE";
  if (evidence.commands.length === expectedCommandCount && evidence.commands.some((command) => command.exitCode !== 0)) {
    return "FAILED";
  }
  return "INCONCLUSIVE";
}

function cleanSourceIntegrity(integrity: RepairSourceIntegrity, commitSha: string): boolean {
  return integrity.baselineCommitSha === commitSha &&
    integrity.missing.length === 0 &&
    integrity.added.length === 0 &&
    integrity.unauthorizedModified.length === 0;
}

function cleanupIsValid(cleanup: RepairSandboxCleanup): boolean {
  return cleanup.cleanupVerified &&
    cleanup.persistent === false &&
    cleanup.snapshotCreated === false &&
    cleanup.stillRunning === false;
}

function buildLedgerV2(input: {
  jobId: string;
  profile: ReputationEntryCandidateJobV2["agentProfile"];
  contract: ReputationEntryWorkContractV2;
  authorityDecision: ReputationEntryCandidateJobV2["authorityDecision"];
  issuedLease: ReputationEntryCandidateJobV2["issuedLease"];
  terminalLease: ReputationEntryCandidateJobV2["terminalLease"];
  executionIdentity: ReputationEntryCandidateJobV2["executionIdentity"];
  source: ReputationEntryCandidateJobV2["source"];
  repairStart: Awaited<ReturnType<ReputationEntrySandboxController["start"]>>;
  repairCleanup: RepairSandboxCleanup;
  agentRun: ReputationEntryCandidateJobV2["agentRun"];
  toolCalls: ReputationEntryCandidateJobV2["toolCalls"];
  patch: ReputationEntryCandidateJobV2["patch"];
  independentVerification: IndependentVerificationEvidence;
  authorityOperations: ReputationEntryCandidateJobV2["authorityOperations"];
  artifacts: ReputationEntryArtifact[];
  evidenceBundle: ReputationEntryOutcomeEvidenceBundleV2;
  outcomeEvaluation: VerifiedDeliveryOutcomeEvaluation;
}): ReputationEntryLedgerEntry[] {
  const entries: ReputationEntryLedgerEntry[] = [];
  const append = (entryType: string, sourceRecordType: string, sourceRecordId: string, payload: unknown, createdAt?: string) =>
    appendReputationEntryLedger(entries, { entryType, sourceRecordType, sourceRecordId, payload, ...(createdAt ? { createdAt } : {}) });
  append("AGENT_IDENTITY_BOUND", "agent_identity", input.profile.agentId, input.profile, input.profile.updatedAt);
  append("WORK_CONTRACT_LOCKED", "work_contract", input.contract.taskId, input.contract, input.contract.lockedAt);
  append("AUTHORITY_DECIDED", "authority_decision", input.authorityDecision.decisionId, input.authorityDecision, input.authorityDecision.decidedAt);
  append("PERMISSION_LEASE_ISSUED", "permission_lease", input.issuedLease.id, input.issuedLease, input.issuedLease.startsAt);
  append("EXECUTION_IDENTITY_CREATED", "execution_identity", input.executionIdentity.executionId, input.executionIdentity, input.executionIdentity.startedAt);
  append("SOURCE_PACKAGE_VERIFIED", "source_package", input.source.sourcePackageSha256, {
    commitSha: input.source.identity.commitSha,
    manifestSha256: input.source.repositoryManifestSha256,
    sourcePackageSha256: input.source.sourcePackageSha256,
  });
  append("AGENT_SANDBOX_CREATED", "managed_sandbox", input.repairStart.sandboxId, { persistent: false, snapshot: false, networkPolicy: "deny-all" });
  append("BASELINE_FAILURE_OBSERVED", "managed_sandbox_command", input.repairStart.baselineTest.commandId, input.repairStart.baselineTest);
  append("AGENT_MODEL_RUN_COMPLETED", "agent_run", input.agentRun.runId, input.agentRun, input.agentRun.finishedAt);
  for (const call of input.toolCalls) append("AGENT_TOOL_CALLED", "agent_tool_call", `${input.jobId}:${call.sequence}`, call, call.finishedAt);
  append("SOURCE_PATCH_COLLECTED", "source_patch", input.patch.sha256, { sha256: input.patch.sha256, modifiedFiles: input.patch.modifiedFiles });
  append("AGENT_SANDBOX_CLEANUP_VERIFIED", "managed_sandbox", input.repairStart.sandboxId, input.repairCleanup, input.repairCleanup.stopConfirmedAt);
  append("INDEPENDENT_VERIFIER_COMPLETED", "independent_verification", input.independentVerification.sandboxId, input.independentVerification, input.independentVerification.cleanup.stopConfirmedAt);
  for (const operation of input.authorityOperations) {
    append(operation.decision === "ALLOWED" ? "PROTECTED_ACTION_ALLOWED" : "PROTECTED_ACTION_DENIED", "authority_operation", `${input.jobId}:${operation.sequence}`, operation, operation.recordedAt);
  }
  append("PERMISSION_LEASE_REVOKED", "permission_lease", input.terminalLease.id, input.terminalLease, input.terminalLease.revokedAt ?? undefined);
  for (const artifact of input.artifacts) {
    append("ARTIFACT_HASH_VERIFIED", "evidence_artifact", artifact.id, {
      evidenceKind: artifact.evidenceKind,
      fileName: artifact.fileName,
      size: artifact.size,
      sha256: artifact.sha256,
    });
  }
  append("DELIVERY_OUTCOME_EVALUATED", "delivery_outcome_evaluation", `${input.jobId}:delivery-outcome`, verifiedDeliveryOutcomeLedgerPayload(input.outcomeEvaluation));
  append("EVIDENCE_BUNDLE_CREATED", "evidence_bundle", input.evidenceBundle.bundleSha256, {
    bundleSha256: input.evidenceBundle.bundleSha256,
    complete: input.evidenceBundle.projection.complete,
    outcomes: input.evidenceBundle.outcomes,
  }, input.evidenceBundle.createdAt);
  append(
    input.outcomeEvaluation.candidateEligible ? "CANDIDATE_ELIGIBLE" : "CANDIDATE_NOT_ELIGIBLE",
    "candidate_job",
    input.jobId,
    {
      candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
      executionOutcome: input.outcomeEvaluation.executionOutcome,
      independentVerificationOutcome: input.outcomeEvaluation.independentVerificationOutcome,
      deliveryOutcome: input.outcomeEvaluation.deliveryOutcome,
      candidateEligible: input.outcomeEvaluation.candidateEligible,
      canonicalCounted: false,
    },
  );
  return entries;
}

function buildLedger(input: {
  jobId: string;
  profile: ReputationEntryCandidateJob["agentProfile"];
  contract: ReputationEntryCandidateJob["contract"];
  authorityDecision: ReputationEntryCandidateJob["authorityDecision"];
  issuedLease: ReputationEntryCandidateJob["issuedLease"];
  terminalLease: ReputationEntryCandidateJob["terminalLease"];
  executionIdentity: ReputationEntryCandidateJob["executionIdentity"];
  source: ReputationEntryCandidateJob["source"];
  repairStart: Awaited<ReturnType<VercelAgentRepairSandbox["start"]>>;
  repairCleanup: RepairSandboxCleanup;
  agentRun: ReputationEntryCandidateJob["agentRun"];
  toolCalls: ReputationEntryCandidateJob["toolCalls"];
  patch: ReputationEntryCandidateJob["patch"];
  independentVerification: IndependentVerificationEvidence;
  authorityOperations: ReputationEntryCandidateJob["authorityOperations"];
  artifacts: ReputationEntryArtifact[];
  evidenceBundle: ReputationEntryCandidateJob["evidenceBundle"];
  result: ReputationEntryResult;
}): ReputationEntryLedgerEntry[] {
  const entries: ReputationEntryLedgerEntry[] = [];
  const append = (entryType: string, sourceRecordType: string, sourceRecordId: string, payload: unknown, createdAt?: string) =>
    appendReputationEntryLedger(entries, { entryType, sourceRecordType, sourceRecordId, payload, ...(createdAt ? { createdAt } : {}) });
  append("AGENT_IDENTITY_BOUND", "agent_identity", input.profile.agentId, input.profile, input.profile.updatedAt);
  append("WORK_CONTRACT_LOCKED", "work_contract", input.contract.taskId, input.contract, input.contract.lockedAt);
  append("AUTHORITY_DECIDED", "authority_decision", input.authorityDecision.decisionId, input.authorityDecision, input.authorityDecision.decidedAt);
  append("PERMISSION_LEASE_ISSUED", "permission_lease", input.issuedLease.id, input.issuedLease, input.issuedLease.startsAt);
  append("EXECUTION_IDENTITY_CREATED", "execution_identity", input.executionIdentity.executionId, input.executionIdentity, input.executionIdentity.startedAt);
  append("SOURCE_PACKAGE_VERIFIED", "source_package", input.source.sourcePackageSha256, {
    commitSha: input.source.identity.commitSha,
    manifestSha256: input.source.repositoryManifestSha256,
    sourcePackageSha256: input.source.sourcePackageSha256,
  });
  append("AGENT_SANDBOX_CREATED", "managed_sandbox", input.repairStart.sandboxId, { persistent: false, snapshot: false, networkPolicy: "deny-all" });
  append("BASELINE_FAILURE_OBSERVED", "managed_sandbox_command", input.repairStart.baselineTest.commandId, input.repairStart.baselineTest);
  append("AGENT_MODEL_RUN_COMPLETED", "agent_run", input.agentRun.runId, input.agentRun, input.agentRun.finishedAt);
  for (const call of input.toolCalls) append("AGENT_TOOL_CALLED", "agent_tool_call", `${input.jobId}:${call.sequence}`, call, call.finishedAt);
  append("SOURCE_PATCH_COLLECTED", "source_patch", input.patch.sha256, { sha256: input.patch.sha256, modifiedFiles: input.patch.modifiedFiles });
  append("AGENT_SANDBOX_CLEANUP_VERIFIED", "managed_sandbox", input.repairStart.sandboxId, input.repairCleanup, input.repairCleanup.stopConfirmedAt);
  append("INDEPENDENT_VERIFIER_COMPLETED", "independent_verification", input.independentVerification.sandboxId, input.independentVerification, input.independentVerification.cleanup.stopConfirmedAt);
  for (const operation of input.authorityOperations) {
    append(operation.decision === "ALLOWED" ? "PROTECTED_ACTION_ALLOWED" : "PROTECTED_ACTION_DENIED", "authority_operation", `${input.jobId}:${operation.sequence}`, operation, operation.recordedAt);
  }
  append("PERMISSION_LEASE_REVOKED", "permission_lease", input.terminalLease.id, input.terminalLease, input.terminalLease.revokedAt ?? undefined);
  for (const artifact of input.artifacts) {
    append("ARTIFACT_HASH_VERIFIED", "evidence_artifact", artifact.id, {
      evidenceKind: artifact.evidenceKind,
      fileName: artifact.fileName,
      size: artifact.size,
      sha256: artifact.sha256,
    });
  }
  append("EVIDENCE_BUNDLE_CREATED", "evidence_bundle", input.evidenceBundle.bundleSha256, {
    bundleSha256: input.evidenceBundle.bundleSha256,
    complete: input.evidenceBundle.projection.complete,
    result: input.result,
  }, input.evidenceBundle.createdAt);
  append(input.result === "VERIFIED" ? "CANDIDATE_VERIFIED" : "CANDIDATE_NOT_VERIFIED", "candidate_job", input.jobId, {
    candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
    result: input.result,
    canonicalCounted: false,
  });
  return entries;
}

function agentInstructions(taskType: ReputationEntryTaskType): string {
  const primary = taskType === "TEST_AND_FIX" ? "run_test" : "run_build";
  const supporting = taskType === "BUILD_RESCUE" ? " Then run_test to guard existing internal behavior." : "";
  return `You are one DoneLayer Agent operating under a locked Work Contract and task-scoped Permission Lease. Work only through the supplied tools. First list files and inspect the captured baseline failure. Read the protected oracle and the exact editable source file. Diagnose the real defect, apply the smallest change only to the editable file, run ${primary}.${supporting} Finish by calling get_diff and get_source_integrity. Never modify tests, build verifiers, manifests, lockfiles, acceptance criteria, or any file marked non-editable. Do not request shell, network, credentials, Git, Pull Requests, deployments, payments, or external side effects.`;
}

function agentPrompt(
  contract: ReputationEntryWorkContract | ReputationEntryWorkContractV2,
  baseline: RepairSandboxCommand,
): string {
  return [
    `Task type: ${contract.taskType}`,
    `Specification: ${contract.specification}`,
    `Desired outcome: ${contract.desiredOutcome}`,
    `Editable files: ${contract.authorityPolicy!.allowedFiles.join(", ")}`,
    `Locked verification commands: ${contract.acceptanceCriteria.commands.map((command) => command.command).join(" then ")}`,
    `Exact source: ${contract.branch}@${contract.commitSha}`,
    `Baseline command ${baseline.command} exited ${baseline.exitCode}.`,
  ].join("\n");
}

function proposedQualificationDefinition(): string[] {
  return [
    "The Job is a genuine non-Demo Agent execution with a unique task outcome, not a duplicated fixture replay.",
    "A versioned LOCKED Work Contract names the exact source, protected oracle, acceptance commands, Agent profile revision, and evidence requirements.",
    "A task-scoped Permission Lease binds the same Agent, execution, Contract, repository, commit, files, Sandbox providers, actions, and resource limits.",
    "The Agent uses only controlled tools inside a nonpersistent managed Sandbox and cannot modify the protected oracle.",
    "A different fresh nonpersistent managed Sandbox independently reconstructs the exact source, applies the recorded patch, and runs every locked acceptance command.",
    "The immutable Evidence Bundle is complete, hash-valid, credential-clean, and linked to a valid append-only Evidence Ledger and Receipt.",
    "Both Sandboxes are stopped, no snapshots exist, and all external effects are explicitly disclosed.",
    "The candidate is counted only after Owner acceptance of this definition and an explicit promotion decision; candidate creation alone never changes canonical corpus totals.",
  ];
}

function assertPilotSources(sources: ReputationEntryPilotSource[]): asserts sources is [ReputationEntryPilotSource, ReputationEntryPilotSource] {
  if (
    sources.length !== 2 ||
    sources[0]?.taskType !== "TEST_AND_FIX" ||
    sources[1]?.taskType !== "BUILD_RESCUE" ||
    sources.some((source) =>
      !/^donelayer\/repair\/[a-z0-9](?:[a-z0-9-]{0,62})$/.test(source.branch) ||
      !/^[a-f0-9]{40}$/.test(source.commitSha) ||
      (source.taskDefinitionVersion !== undefined &&
        (!Number.isSafeInteger(source.taskDefinitionVersion) || source.taskDefinitionVersion < 1))) ||
    sources[0].branch === sources[1].branch ||
    sources[0].commitSha === sources[1].commitSha
  ) throw new Error("REPUTATION_ENTRY_PILOT_SOURCE_SET_INVALID");
}

function assertV2PolicySelection(policies: ReputationEntryV2PolicySelection): void {
  const keys = Object.keys(policies).sort();
  if (
    keys.join(",") !== "BUILD_RESCUE,TEST_AND_FIX" ||
    !VERIFIED_DELIVERY_OUTCOME_POLICIES.includes(policies.TEST_AND_FIX) ||
    !VERIFIED_DELIVERY_OUTCOME_POLICIES.includes(policies.BUILD_RESCUE)
  ) throw new Error("REPUTATION_ENTRY_V2_POLICY_SELECTION_INVALID");
}

function assertPilotOutcome(outcome: ReputationEntryPilotOutcome): void {
  const serialized = JSON.stringify(serializablePilotOutcome(outcome));
  if (
    outcome.jobs.length !== 2 ||
    !/^PHASE_B_ATTEMPT_[1-9][0-9]*$/.test(outcome.attemptId) ||
    outcome.corpus.candidateJobCount !== 2 ||
    outcome.corpus.canonicalQualifyingJobCountAdded !== 0 ||
    !outcome.corpus.identityContinuity ||
    outcome.limits.modelRequestsUsed > outcome.limits.modelRequestLimit ||
    outcome.limits.sandboxesCreated !== 4 ||
    outcome.externalEffects.pullRequestsCreated !== 0 ||
    outcome.externalEffects.mergesPerformed !== 0 ||
    outcome.externalEffects.deploymentsPerformed !== 0 ||
    outcome.externalEffects.paymentsPerformed !== 0 ||
    outcome.externalEffects.blockchainWritesPerformed !== 0 ||
    reputationEntrySecretPattern().test(serialized)
  ) throw new Error("REPUTATION_ENTRY_PILOT_INTEGRITY_INVALID");
}

function assertPilotOutcomeV2(outcome: ReputationEntryPilotOutcomeV2): void {
  const serialized = JSON.stringify(serializablePilotOutcomeV2(outcome));
  const eligibleCount = outcome.jobs.filter(
    (job) => job.outcomeEvaluation.deliveryOutcome === "VERIFIED_DELIVERY",
  ).length;
  if (
    outcome.schemaVersion !== 2 ||
    outcome.jobs.length !== 2 ||
    !/^PHASE_B_ATTEMPT_[1-9][0-9]*$/.test(outcome.attemptId) ||
    outcome.corpus.candidateJobCount !== 2 ||
    outcome.corpus.eligibleCandidateJobCount !== eligibleCount ||
    outcome.corpus.canonicalQualifyingJobCountAdded !== 0 ||
    !outcome.corpus.identityContinuity ||
    outcome.jobs.some((job) => job.candidateEligible !== (job.outcomeEvaluation.deliveryOutcome === "VERIFIED_DELIVERY")) ||
    outcome.limits.modelRequestsUsed > outcome.limits.modelRequestLimit ||
    outcome.limits.sandboxesCreated !== 4 ||
    outcome.externalEffects.pullRequestsCreated !== 0 ||
    outcome.externalEffects.mergesPerformed !== 0 ||
    outcome.externalEffects.deploymentsPerformed !== 0 ||
    outcome.externalEffects.paymentsPerformed !== 0 ||
    outcome.externalEffects.blockchainWritesPerformed !== 0 ||
    reputationEntrySecretPattern().test(serialized)
  ) throw new Error("REPUTATION_ENTRY_PILOT_V2_INTEGRITY_INVALID");
}

function requiredAttemptId(value: string): string {
  if (!/^PHASE_B_ATTEMPT_[1-9][0-9]*$/.test(value)) throw new Error("REPUTATION_ENTRY_ATTEMPT_ID_INVALID");
  return value;
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

export function serializablePilotOutcome(outcome: ReputationEntryPilotOutcome): ReputationEntryPilotOutcome {
  return JSON.parse(JSON.stringify(outcome, (key, value) =>
    key === "content" || key === "sourcePackageBytes" || key === "sourcePackageManifestBytes" ? undefined : value)) as ReputationEntryPilotOutcome;
}

export function serializablePilotOutcomeV2(outcome: ReputationEntryPilotOutcomeV2): ReputationEntryPilotOutcomeV2 {
  return JSON.parse(JSON.stringify(outcome, (key, value) =>
    key === "content" || key === "sourcePackageBytes" || key === "sourcePackageManifestBytes" ? undefined : value)) as ReputationEntryPilotOutcomeV2;
}

export function persistablePilotOutcome(outcome: ReputationEntryPilotOutcome): ReputationEntryPilotOutcome {
  return JSON.parse(JSON.stringify(outcome, (key, value) =>
    key === "sourcePackageBytes" || key === "sourcePackageManifestBytes" ? undefined : value)) as ReputationEntryPilotOutcome;
}

export function persistablePilotOutcomeV2(outcome: ReputationEntryPilotOutcomeV2): ReputationEntryPilotOutcomeV2 {
  return JSON.parse(JSON.stringify(outcome, (key, value) =>
    key === "sourcePackageBytes" || key === "sourcePackageManifestBytes" ? undefined : value)) as ReputationEntryPilotOutcomeV2;
}

function persistableJob(job: ReputationEntryCandidateJob): ReputationEntryCandidateJob {
  return JSON.parse(JSON.stringify(job, (key, value) =>
    key === "sourcePackageBytes" || key === "sourcePackageManifestBytes" ? undefined : value)) as ReputationEntryCandidateJob;
}

function persistableJobV2(job: ReputationEntryCandidateJobV2): ReputationEntryCandidateJobV2 {
  return JSON.parse(JSON.stringify(job, (key, value) =>
    key === "sourcePackageBytes" || key === "sourcePackageManifestBytes" ? undefined : value)) as ReputationEntryCandidateJobV2;
}

function durableSourceIdentity(source: ReputationEntryCandidateJob["source"]): Record<string, unknown> {
  return {
    identity: source.identity,
    repositoryManifest: source.repositoryManifest,
    repositoryManifestSha256: source.repositoryManifestSha256,
    sourcePackageSha256: source.sourcePackageSha256,
    materializerCommitSha: source.materializerCommitSha,
    independentRemoteCommitSha: source.independentRemoteCommitSha,
    parentCommitSha: source.parentCommitSha,
    sourceFileCount: source.sourceFileCount,
    buildScriptPresent: source.buildScriptPresent,
    testScriptPresent: source.testScriptPresent,
    installLifecycleScriptsPresent: source.installLifecycleScriptsPresent,
    clone: source.clone,
    remoteVerifiedAt: source.remoteVerifiedAt,
    materializerWorkspaceCleaned: source.materializerWorkspaceCleaned,
  };
}

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(":", 1)[0]!.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 100) || "UNKNOWN_FAILURE";
}

function assertNoCredentialLeak(value: unknown): void {
  if (reputationEntrySecretPattern().test(JSON.stringify(value))) throw new Error("REPUTATION_ENTRY_CREDENTIAL_LEAK_DETECTED");
}

function sameValues(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
