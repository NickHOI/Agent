import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  TestLedgerProvider,
  canonicalJson,
  computeEvidenceLedgerEntryHash,
  type PaymentDistribution,
  type PaymentProvider,
  type PublicJobReceipt,
  type SemanticVerificationReceiptSummary,
} from "@donelayer/database";
import {
  REAL_SOURCE_BUG_FIXTURE_BRANCH,
  type RepositoryFileManifest,
} from "@donelayer/worker-protocol";

import type { AgentRepairOutcome } from "../agent-execution/agent-repair-orchestrator";
import { assertAgentExecutionBinding } from "../agent-identity/execution-identity";
import { IndependentDeliveryVerifier, type IndependentDeliveryVerification } from "../git-delivery/independent-delivery-verifier";
import {
  GIT_DELIVERY_AUTHENTICATION_MODE,
  type AppliedGitPatchEvidence,
  type GitCommitMetadata,
  type GitDeliveryProvider,
  type GitDeliveryWorkspace,
  type GitPullRequestEvidence,
} from "../git-delivery/provider";
import {
  requireTaskScopedAuthorityGuard,
  revokeTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_AGENT_ID,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
  TASK_SCOPED_AUTHORITY_ISSUER,
  type TaskScopedAuthorityOperationEvidence,
  type TaskScopedPermissionLease,
} from "../task-scoped-authority/task-scoped-authority";
import {
  assertSemanticContractIntegrity,
  createVerifiedWorkEvidenceBundle,
  type SemanticTaskContract,
  type VerifiedWorkEvidenceBundle,
} from "./semantic-contract";

export const SEMANTIC_DELIVERY_GATE = "SEMANTIC_CONTRACT_VERIFIED_DELIVERY_V1" as const;
const CUSTOMER_ID = "semantic-delivery-gate-customer";
const PROVIDER_ID = "semantic-delivery-gate-provider";
const CHARGE_CENTS = 1_000;

type LedgerEntry = {
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

type Artifact = {
  id: string;
  fileName: string;
  mimeType: "application/json" | "text/plain";
  size: number;
  sha256: string;
  content: string;
};

export type SemanticDeliveryFailureCode =
  | "DELIVERY_FAILED"
  | "PATCH_MISMATCH"
  | "TEST_TAMPERING_DETECTED"
  | "CONTRACT_ASSERTION_FAILED"
  | "INDEPENDENT_VERIFICATION_FAILED"
  | "CLEANUP_FAILED";

export type SemanticDeliveryOutcome = {
  gate: typeof SEMANTIC_DELIVERY_GATE;
  runId: string;
  jobRunId: string;
  status: "CONTRACT_VERIFIED_DELIVERY" | "FAILED";
  failureCode: SemanticDeliveryFailureCode | null;
  contract: SemanticTaskContract;
  contractSha256: string;
  repair: AgentRepairOutcome;
  deliveryBranch: string;
  repository: Awaited<ReturnType<GitDeliveryProvider["verifyRepository"]>> | null;
  patch: AppliedGitPatchEvidence | null;
  localCommit: GitCommitMetadata | null;
  remoteCommit: GitCommitMetadata | null;
  pullRequest: GitPullRequestEvidence | null;
  deliveryDiff: { patch: string; sha256: string } | null;
  independentVerification: IndependentDeliveryVerification | null;
  payment: {
    mode: "SIMULATION_ONLY";
    state: "NOT_RESERVED" | "RESERVED" | "RELEASED";
    customerChargeCents: number;
    providerPayoutCents: number;
    platformFeeCents: number;
    releasedAt: string | null;
  };
  semanticVerification: SemanticVerificationReceiptSummary;
  evidenceBundle: VerifiedWorkEvidenceBundle;
  authority: {
    issuedLease: TaskScopedPermissionLease;
    finalLease: TaskScopedPermissionLease | null;
    operations: TaskScopedAuthorityOperationEvidence[];
  };
  deliveryWorkspaceCleaned: boolean;
  artifacts: Artifact[];
  ledgerEntries: LedgerEntry[];
  ledgerVerification: { valid: boolean; entryCount: number; chainSha256: string | null };
  receipt: {
    id: string;
    publicReceiptId: string;
    result: "CONTRACT_VERIFIED_DELIVERY" | "FAILED";
    receiptSha256: string;
    evidenceChainSha256: string;
    document: Record<string, unknown>;
  };
  publicReceipt: PublicJobReceipt;
};

type Verifier = Pick<IndependentDeliveryVerifier, "verify">;

export class SemanticDeliveryOrchestrator {
  constructor(
    private readonly provider: GitDeliveryProvider,
    private readonly verifier: Verifier = new IndependentDeliveryVerifier(),
    private readonly paymentProvider: PaymentProvider = new TestLedgerProvider({ [CUSTOMER_ID]: 10_000 }),
  ) {}

  async run(input: {
    repair: AgentRepairOutcome;
    contract: SemanticTaskContract;
    baseManifest: RepositoryFileManifest;
    expectedTestScript: string;
    authorityLease: TaskScopedPermissionLease;
  }): Promise<SemanticDeliveryOutcome> {
    assertSemanticDeliveryInput(input);
    const runId = randomUUID();
    const jobRunId = input.authorityLease.authority.subject.jobRunId;
    const receiptId = randomUUID();
    const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
    const contractSha256 = digest(canonicalJson(input.contract));
    const deliveryBranch = deriveSemanticDeliveryBranch(input.repair.jobRunId);
    const ledger = new Ledger();
    ledger.append("CONTRACT_ASSERTIONS_LOCKED", "semantic_task_contract", input.contract.taskId, {
      contractSha256,
      assertionsSha256: input.contract.assertionsSha256,
      assertionCount: input.contract.assertions.length,
    }, input.contract.lockedAt);
    ledger.append("PERMISSION_GRANTED", "permission_lease", input.authorityLease.id, {
      leaseId: input.authorityLease.id,
      version: input.authorityLease.version,
      authoritySha256: input.authorityLease.authoritySha256,
      workContract: input.authorityLease.authority.workContract,
      subject: input.authorityLease.authority.subject,
      startsAt: input.authorityLease.startsAt,
      expiresAt: input.authorityLease.expiresAt,
    });
    if (input.repair.executionIdentity) {
      ledger.append("IDENTITY_BINDING_VERIFIED", "agent_execution_identity", input.repair.executionIdentity.executionId, {
        agent: input.repair.executionIdentity.agent,
        executionSha256: input.repair.executionIdentity.executionSha256,
      }, input.repair.executionIdentity.startedAt);
    }
    const repairAuthority = input.repair.authority;
    if (!repairAuthority) throw new Error("SEMANTIC_DELIVERY_INPUT_INVALID");
    const authorityOperations: TaskScopedAuthorityOperationEvidence[] = [];
    const authorityGuard = requireTaskScopedAuthorityGuard(input.authorityLease, {
      contract: input.contract,
      subject: {
        agentId: input.contract.assignedAgent?.agentId ?? TASK_SCOPED_AUTHORITY_AGENT_ID,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        jobRunId,
        ...(input.contract.assignedAgent ? { agentIdentity: input.contract.assignedAgent } : {}),
        ...(input.repair.executionIdentity ? { executionId: input.repair.executionIdentity.executionId } : {}),
      },
      alreadyUsedSandboxCount: repairAuthority.operations.filter((operation) => (
        operation.operation === "managed-sandbox-create" && operation.decision === "ALLOWED"
      )).length,
      onDecision: (operation) => {
        const evidence = { ...operation, sequence: authorityOperations.length + 1 };
        authorityOperations.push(evidence);
        ledger.append(
          evidence.decision === "ALLOWED" ? "PROTECTED_ACTION_ALLOWED" : "PROTECTED_ACTION_DENIED",
          "task_scoped_authority_operation",
          `${runId}:${evidence.sequence}`,
          evidence,
          evidence.recordedAt,
        );
      },
    });
    authorityGuard.assertRepositoryReadAllowed({
      remoteUrl: input.contract.remoteUrl,
      baseRef: input.contract.branch,
      commitSha: input.contract.commitSha,
    });

    let workspace: GitDeliveryWorkspace | null = null;
    let repository: SemanticDeliveryOutcome["repository"] = null;
    let patch: AppliedGitPatchEvidence | null = null;
    let localCommit: GitCommitMetadata | null = null;
    let remoteCommit: GitCommitMetadata | null = null;
    let pullRequest: GitPullRequestEvidence | null = null;
    let deliveryDiff: SemanticDeliveryOutcome["deliveryDiff"] = null;
    let independentVerification: IndependentDeliveryVerification | null = null;
    let deliveryWorkspaceCleaned = false;
    let reservationCreated = false;
    let distribution: PaymentDistribution | null = null;
    let releasedAt: string | null = null;
    let failure: { code: SemanticDeliveryFailureCode; message: string } | null = null;
    let finalAuthorityLease: TaskScopedPermissionLease | null = null;

    try {
      const availability = await this.provider.checkAvailability();
      if (!availability.available || !availability.accountLogin || availability.authenticationMode !== GIT_DELIVERY_AUTHENTICATION_MODE) {
        throw new Error("DELIVERY_FAILED: GitHub authentication unavailable");
      }
      ledger.append("DELIVERY_PROVIDER_AVAILABLE", "git_delivery_provider", runId, availability, availability.checkedAt);
      repository = await this.provider.verifyRepository({
        remoteUrl: input.contract.remoteUrl,
        expectedBaseCommit: input.contract.commitSha,
        baseBranch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
      });
      ledger.append("REMOTE_REPOSITORY_VERIFIED", "github_repository", repository.repositoryId, repository, repository.verifiedAt);
      await this.paymentProvider.reserve({ taskId: runId, customerId: CUSTOMER_ID, amountCents: CHARGE_CENTS });
      reservationCreated = true;
      ledger.append("TEST_LEDGER_RESERVED", "test_ledger", runId, { mode: "SIMULATION_ONLY", amountCents: CHARGE_CENTS });
      authorityGuard.assertDeliveryBranchAllowed(deliveryBranch);
      workspace = await this.provider.createBranch({
        remoteUrl: input.contract.remoteUrl,
        baseCommit: input.contract.commitSha,
        baseBranch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
        deliveryBranch,
      });
      ledger.append("DELIVERY_BRANCH_PREPARED", "git_branch", deliveryBranch, { baseCommit: input.contract.commitSha });
      authorityGuard.assertPatchAllowed(input.repair.patch.modifiedFiles);
      patch = await this.provider.applyPatch(workspace, {
        patch: Buffer.from(input.repair.patch.patch, "utf8"),
        expectedPatchSha256: input.repair.patch.sha256,
        expectedBaseManifestSha256: input.repair.source.repositoryManifestSha256,
        allowedChangedFiles: input.repair.patch.modifiedFiles,
      });
      ledger.append("VERIFIED_PATCH_APPLIED", "repair_patch", patch.patchSha256, patch, patch.appliedAt);
      localCommit = await this.provider.createCommit(workspace, {
        message: "fix: apply DoneLayer verified repair",
        accountLogin: availability.accountLogin,
        allowedChangedFiles: patch.changedFiles,
      });
      ledger.append("DELIVERY_COMMIT_CREATED", "git_commit", localCommit.commitSha, localCommit, localCommit.committedAt);
      const push = await this.provider.pushBranch(workspace, localCommit);
      ledger.append("DELIVERY_BRANCH_PUSHED", "git_push", localCommit.commitSha, push, push.pushedAt);
      remoteCommit = await this.provider.getCommitMetadata(repository.repository, localCommit.commitSha);
      if (
        localCommit.parentCommitSha !== input.contract.commitSha ||
        remoteCommit.commitSha !== localCommit.commitSha ||
        remoteCommit.parentCommitSha !== input.contract.commitSha ||
        canonicalJson(remoteCommit.changedFiles) !== canonicalJson(patch.changedFiles)
      ) throw new Error("DELIVERY_FAILED: Remote Commit metadata mismatch");
      ledger.append("REMOTE_COMMIT_VERIFIED", "github_commit", remoteCommit.commitSha, remoteCommit, remoteCommit.committedAt);
      const body = pullRequestBody({ contractSha256, repair: input.repair, deliveryCommit: localCommit.commitSha });
      authorityGuard.assertPullRequestCreateAllowed({
        remoteUrl: input.contract.remoteUrl,
        baseRef: input.contract.branch,
        headBranch: deliveryBranch,
      });
      pullRequest = await this.provider.createPullRequest({
        repository: repository.repository,
        title: "DoneLayer verified repair",
        body,
        baseBranch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
        headBranch: deliveryBranch,
      });
      if (
        pullRequest.state !== "OPEN" || pullRequest.merged ||
        pullRequest.baseBranch !== REAL_SOURCE_BUG_FIXTURE_BRANCH ||
        pullRequest.headBranch !== deliveryBranch ||
        pullRequest.baseCommit !== input.contract.commitSha ||
        pullRequest.headCommit !== localCommit.commitSha ||
        pullRequest.body !== body
      ) throw new Error("DELIVERY_FAILED: Pull Request metadata mismatch");
      ledger.append("PULL_REQUEST_CREATED", "github_pull_request", String(pullRequest.number), pullRequest, pullRequest.createdAt);
      deliveryDiff = await this.provider.getDiff(repository.repository, pullRequest.number);
      ledger.append("DELIVERY_DIFF_RETRIEVED", "github_pull_request_diff", String(pullRequest.number), { sha256: deliveryDiff.sha256 });
      authorityGuard.assertSandboxAllowed({
        purpose: "INDEPENDENT_VERIFICATION",
        provider: "VERCEL_SANDBOX",
        executionBackend: "MANAGED_REMOTE_SANDBOX",
        requestedSandboxCount: 1,
      });
      independentVerification = await this.verifier.verify({
        jobRunId,
        remoteUrl: input.contract.remoteUrl,
        deliveryBranch,
        deliveryCommitSha: localCommit.commitSha,
        baseCommitSha: input.contract.commitSha,
        baseManifest: input.baseManifest,
        expectedSourceChanges: patch.fileChanges.map((change) => ({ path: change.path, afterSha256: change.afterSha256 })),
        expectedTestScript: input.expectedTestScript,
        repairSandboxId: input.repair.sandbox.sandboxId,
        semanticContract: input.contract,
      });
      if (
        independentVerification.test.exitCode !== 0 ||
        independentVerification.contractAssertions?.result.failed !== 0 ||
        !independentVerification.antiCheating.testsUnchanged ||
        !independentVerification.antiCheating.testScriptUnchanged ||
        !independentVerification.antiCheating.testConfigurationUnchanged ||
        !independentVerification.cleanup.cleanupVerified
      ) throw new Error("INDEPENDENT_VERIFICATION_FAILED");
      ledger.append("INDEPENDENT_TEST_PASSED", "managed_sandbox_command", independentVerification.test.commandId ?? jobRunId, independentVerification.test);
      for (const result of independentVerification.contractAssertions.result.results) {
        ledger.append(result.status === "PASSED" ? "CONTRACT_ASSERTION_PASSED" : "CONTRACT_ASSERTION_FAILED", "contract_assertion", result.assertionId, result);
      }
      ledger.append("SEMANTIC_VERIFICATION_PASSED", "semantic_verification", runId, independentVerification.contractAssertions.result);
      ledger.append("VERIFIED_DELIVERY", "semantic_delivery", runId, {
        commitSha: localCommit.commitSha,
        pullRequestNumber: pullRequest.number,
        repositoryTests: "PASSED",
        contractAssertions: "PASSED",
      });
    } catch (error) {
      failure = { code: classifyFailure(error), message: safeMessage(error) };
      ledger.append(failure.code, "semantic_delivery", runId, failure);
    } finally {
      if (workspace) {
        try {
          await this.provider.cancelDelivery(workspace);
          deliveryWorkspaceCleaned = true;
          ledger.append("DELIVERY_WORKSPACE_CLEANED", "git_delivery_workspace", workspace.id, { cleaned: true });
        } catch (error) {
          failure = { code: "CLEANUP_FAILED", message: safeMessage(error) };
          ledger.append("CLEANUP_FAILED", "git_delivery_workspace", workspace.id, failure);
        }
      }
    }

    try {
      finalAuthorityLease = revokeTaskScopedPermissionLease({
        lease: input.authorityLease,
        revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
        reason: failure ? `Semantic delivery ended: ${failure.code}` : "Contract-verified delivery and cleanup completed",
      });
      ledger.append("PERMISSION_LEASE_REVOKED", "permission_lease", finalAuthorityLease.id, {
        authoritySha256: finalAuthorityLease.authoritySha256,
        status: finalAuthorityLease.status,
        revokedAt: finalAuthorityLease.revokedAt,
        reason: finalAuthorityLease.revocationReason,
      }, finalAuthorityLease.revokedAt!);
    } catch (error) {
      failure = { code: "DELIVERY_FAILED", message: safeMessage(error) };
      ledger.append("DELIVERY_FAILED", "permission_lease", input.authorityLease.id, failure);
    }

    const eligibleForRelease = !failure && Boolean(independentVerification) && deliveryWorkspaceCleaned && finalAuthorityLease?.status === "REVOKED";
    if (eligibleForRelease) {
      distribution = await this.paymentProvider.release({ taskId: runId, providerId: PROVIDER_ID });
      releasedAt = new Date().toISOString();
      ledger.append("TEST_LEDGER_RELEASED", "test_ledger", runId, { ...distribution, mode: "SIMULATION_ONLY", authorizingReceiptId: receiptId }, releasedAt);
    }
    const status = eligibleForRelease && distribution ? "CONTRACT_VERIFIED_DELIVERY" as const : "FAILED" as const;
    const payment = {
      mode: "SIMULATION_ONLY" as const,
      state: distribution ? "RELEASED" as const : reservationCreated ? "RESERVED" as const : "NOT_RESERVED" as const,
      customerChargeCents: reservationCreated ? CHARGE_CENTS : 0,
      providerPayoutCents: distribution?.providerCents ?? 0,
      platformFeeCents: distribution?.platformFeeCents ?? 0,
      releasedAt,
    };
    const assertionRun = independentVerification?.contractAssertions?.result ?? input.repair.contractAssertionRun;
    const semanticVerification: SemanticVerificationReceiptSummary = {
      outcome: status === "CONTRACT_VERIFIED_DELIVERY" ? "CONTRACT_VERIFIED" : failure?.code === "CONTRACT_ASSERTION_FAILED" ? "ENGINEERING_REVIEW_REQUIRED" : "ENGINEERING_REVIEW_REQUIRED",
      executionIntegrity: status === "CONTRACT_VERIFIED_DELIVERY" ? "VALID" : "INVALID",
      testConformity: independentVerification?.test.exitCode === 0 ? "PASSED" : "FAILED",
      contractConformity: assertionRun?.failed === 0 ? "VERIFIED" : assertionRun ? "FAILED" : "NOT_RUN",
      deliveryIntegrity: status === "CONTRACT_VERIFIED_DELIVERY" ? "VALID" : localCommit ? "INVALID" : "NOT_RUN",
      overall: status === "CONTRACT_VERIFIED_DELIVERY" ? "VERIFIED_DELIVERY" : "FAILED",
      assertionsSha256: input.contract.assertionsSha256,
      repositoryTestExpectationCount: input.repair.semanticPreflight?.expectations.length ?? 0,
      contractAssertionPassedCount: assertionRun?.passed ?? 0,
      contractAssertionFailedCount: assertionRun?.failed ?? 0,
      testsModified: patch ? !patch.testsUnchanged : false,
      acceptanceCriteriaModified: false,
      agentCallCount: input.repair.agentRun.usage.apiRequestCount,
      sandboxRepairAttemptCount: 1,
      payoutReleased: payment.state === "RELEASED",
    };
    const evidenceBundle = createVerifiedWorkEvidenceBundle({
      contract: input.contract,
      agentReported: "REPORTED",
      independentlyVerified: semanticVerification.overall,
      dimensions: {
        executionIntegrity: semanticVerification.executionIntegrity,
        testConformity: semanticVerification.testConformity,
        contractConformity: semanticVerification.contractConformity,
        deliveryIntegrity: semanticVerification.deliveryIntegrity,
      },
      evidence: [
        { kind: "WORK_CONTRACT", sha256: contractSha256 },
        { kind: "PERMISSION_DECISION", sha256: input.authorityLease.authoritySha256 },
        { kind: "SOURCE_MANIFEST", sha256: input.repair.source.repositoryManifestSha256 },
        { kind: "AGENT_REPAIR_RECEIPT", sha256: input.repair.receipt.receiptSha256 },
        { kind: "REPAIR_PATCH", sha256: input.repair.patch.sha256 },
        ...(deliveryDiff ? [{ kind: "DELIVERY_DIFF" as const, sha256: deliveryDiff.sha256 }] : []),
        ...(independentVerification
          ? [{ kind: "INDEPENDENT_VERIFICATION" as const, sha256: digest(canonicalJson(independentVerification)) }]
          : []),
      ],
    });
    ledger.append("EVIDENCE_BUNDLE_CREATED", "verified_work_evidence_bundle", evidenceBundle.bundleSha256, {
      bundleSha256: evidenceBundle.bundleSha256,
      workContractSha256: evidenceBundle.workContractSha256,
      outcome: evidenceBundle.completion.independentlyVerified,
    }, evidenceBundle.createdAt);
    const artifacts = buildArtifacts({ contract: input.contract, evidenceBundle, authorityLease: input.authorityLease, finalAuthorityLease, authorityOperations, repair: input.repair, patch, localCommit, remoteCommit, pullRequest, deliveryDiff, independentVerification, payment, failure });
    for (const artifact of artifacts) ledger.append("ARTIFACT_HASH_VERIFIED", "evidence_artifact", artifact.id, { fileName: artifact.fileName, sha256: artifact.sha256, size: artifact.size });
    const preReceipt = ledger.verify();
    const document: Record<string, unknown> = {
      schemaVersion: 1,
      receiptType: "SEMANTIC_CONTRACT_VERIFIED_DELIVERY",
      publicReceiptId,
      gate: SEMANTIC_DELIVERY_GATE,
      finalResult: status,
      contract: { sha256: contractSha256, assertionsSha256: input.contract.assertionsSha256, status: "LOCKED" },
      repairReceipt: { id: input.repair.receipt.id, sha256: input.repair.receipt.receiptSha256, result: input.repair.receipt.result },
      semanticVerification,
      evidenceBundle,
      authority: {
        leaseId: input.authorityLease.id,
        version: input.authorityLease.version,
        authoritySha256: input.authorityLease.authoritySha256,
        workContract: input.authorityLease.authority.workContract,
        subject: input.authorityLease.authority.subject,
        operations: authorityOperations,
        terminalStatus: finalAuthorityLease?.status ?? "UNRESOLVED",
        revokedAt: finalAuthorityLease?.revokedAt ?? null,
      },
      ...(input.repair.executionIdentity
        ? {
            identity: {
              agent: input.repair.executionIdentity.agent,
              executionId: input.repair.executionIdentity.executionId,
              executionSha256: input.repair.executionIdentity.executionSha256,
            },
          }
        : {}),
      githubDelivery: { branch: deliveryBranch, commit: localCommit, remoteCommit, pullRequest, diffSha256: deliveryDiff?.sha256 ?? null },
      independentVerification,
      payment,
      artifacts: artifacts.map(({ content: _content, ...artifact }) => artifact),
      evidenceLedger: preReceipt,
      failure,
      issuedAt: new Date().toISOString(),
    };
    const receiptSha256 = digest(canonicalJson(document));
    ledger.append("RECEIPT_CREATED", "job_receipt", receiptId, { receiptSha256, evidenceChainSha256: preReceipt.chainSha256 }, String(document.issuedAt));
    const ledgerVerification = ledger.verify();
    const receipt = { id: receiptId, publicReceiptId, result: status, receiptSha256, evidenceChainSha256: preReceipt.chainSha256!, document };
    const publicReceipt = buildPublicReceipt({ input, receipt, contractSha256, semanticVerification, evidenceBundle, patch, localCommit, pullRequest, deliveryDiff, independentVerification, payment, ledgerVerification });
    return {
      gate: SEMANTIC_DELIVERY_GATE,
      runId,
      jobRunId,
      status,
      failureCode: failure?.code ?? null,
      contract: input.contract,
      contractSha256,
      repair: input.repair,
      deliveryBranch,
      repository,
      patch,
      localCommit,
      remoteCommit,
      pullRequest,
      deliveryDiff,
      independentVerification,
      payment,
      semanticVerification,
      evidenceBundle,
      authority: {
        issuedLease: input.authorityLease,
        finalLease: finalAuthorityLease!,
        operations: authorityOperations,
      },
      deliveryWorkspaceCleaned,
      artifacts,
      ledgerEntries: ledger.entries,
      ledgerVerification,
      receipt,
      publicReceipt,
    };
  }
}

function assertSemanticDeliveryInput(input: {
  repair: AgentRepairOutcome;
  contract: SemanticTaskContract;
  baseManifest: RepositoryFileManifest;
  expectedTestScript: string;
  authorityLease: TaskScopedPermissionLease;
}): void {
  assertSemanticContractIntegrity(input.contract);
  if (input.contract.assignedAgent) {
    if (!input.repair.executionIdentity) throw new Error("AGENT_EXECUTION_IDENTITY_REQUIRED");
    assertAgentExecutionBinding({
      execution: input.repair.executionIdentity,
      contract: input.contract,
      authorityLease: input.authorityLease,
    });
  }
  if (
    input.contract.branch !== REAL_SOURCE_BUG_FIXTURE_BRANCH ||
    input.repair.source.branch !== input.contract.branch ||
    input.repair.source.materializerCommitSha !== input.contract.commitSha ||
    input.repair.receipt.result !== "CONTRACT_VERIFIED" ||
    input.repair.repairedTest?.exitCode !== 0 ||
    input.repair.contractAssertionRun?.failed !== 0 ||
    !input.repair.authority ||
    input.repair.authority.authoritySha256 !== input.authorityLease.authoritySha256 ||
    input.repair.authority.workContractSha256 !== input.contract.workContractSha256 ||
    input.repair.patch.modifiedFiles.length < 1 ||
    input.repair.patch.modifiedFiles.some((filePath) => !filePath.startsWith("src/")) ||
    input.baseManifest.commitSha !== input.contract.commitSha ||
    input.baseManifest.branch !== input.contract.branch ||
    !input.expectedTestScript.trim()
  ) throw new Error("SEMANTIC_DELIVERY_INPUT_INVALID");
}

function deriveSemanticDeliveryBranch(jobRunId: string): string {
  const compact = jobRunId.toLowerCase().replaceAll(/[^a-f0-9]/g, "").slice(0, 12);
  if (compact.length !== 12) throw new Error("SEMANTIC_DELIVERY_JOB_ID_INVALID");
  return `donelayer/repair/${compact}`;
}

function pullRequestBody(input: { contractSha256: string; repair: AgentRepairOutcome; deliveryCommit: string }): string {
  return [
    "## DoneLayer contract-verified repair",
    "",
    `Semantic Contract SHA-256: ${input.contractSha256}`,
    `Contract assertions SHA-256: ${input.repair.contractAssertionRun!.assertionsSha256}`,
    `Repair Receipt ID: ${input.repair.receipt.publicReceiptId}`,
    `Fixture Commit SHA: ${input.repair.source.materializerCommitSha}`,
    `Delivery Commit SHA: ${input.deliveryCommit}`,
    `Patch SHA-256: ${input.repair.patch.sha256}`,
    `Modified files: ${input.repair.patch.modifiedFiles.join(", ")}`,
    "Repository tests: PASSED in repair Sandbox",
    "Independent Contract assertions: PASSED in repair Sandbox",
    "Fresh independent delivery verification: PENDING",
    "",
    "This Pull Request is owner-authorized, intentionally unmerged, and targets the isolated true-source-bug Fixture branch.",
  ].join("\n");
}

function buildArtifacts(input: {
  contract: SemanticTaskContract;
  evidenceBundle: VerifiedWorkEvidenceBundle;
  authorityLease: TaskScopedPermissionLease;
  finalAuthorityLease: TaskScopedPermissionLease | null;
  authorityOperations: TaskScopedAuthorityOperationEvidence[];
  repair: AgentRepairOutcome;
  patch: AppliedGitPatchEvidence | null;
  localCommit: GitCommitMetadata | null;
  remoteCommit: GitCommitMetadata | null;
  pullRequest: GitPullRequestEvidence | null;
  deliveryDiff: SemanticDeliveryOutcome["deliveryDiff"];
  independentVerification: IndependentDeliveryVerification | null;
  payment: SemanticDeliveryOutcome["payment"];
  failure: { code: SemanticDeliveryFailureCode; message: string } | null;
}): Artifact[] {
  const values: Array<[string, Artifact["mimeType"], string]> = [
    ["semantic-task-contract.json", "application/json", json(input.contract)],
    ["verified-work-evidence-bundle.json", "application/json", json(input.evidenceBundle)],
    ["task-scoped-authority.json", "application/json", json({
      issuedLease: input.authorityLease,
      finalLease: input.finalAuthorityLease,
      operations: input.authorityOperations,
    })],
    ["semantic-repair-receipt-reference.json", "application/json", json({ id: input.repair.receipt.id, sha256: input.repair.receipt.receiptSha256 })],
    ["semantic-delivery-integrity.json", "application/json", json(input.patch)],
    ["semantic-github-delivery.json", "application/json", json({ localCommit: input.localCommit, remoteCommit: input.remoteCommit, pullRequest: input.pullRequest })],
    ["semantic-delivery-diff.patch", "text/plain", input.deliveryDiff?.patch ?? ""],
    ["independent-repository-test.json", "application/json", json(input.independentVerification?.test ?? null)],
    ["independent-contract-assertions.json", "application/json", json(input.independentVerification?.contractAssertions ?? null)],
    ["independent-anti-tampering.json", "application/json", json(input.independentVerification?.antiCheating ?? null)],
    ["independent-cleanup.json", "application/json", json(input.independentVerification?.cleanup ?? null)],
    ["semantic-test-ledger.json", "application/json", json(input.payment)],
    ["semantic-delivery-failure.json", "application/json", json(input.failure)],
  ];
  return values.map(([fileName, mimeType, content]) => ({ id: randomUUID(), fileName, mimeType, size: Buffer.byteLength(content, "utf8"), sha256: digest(content), content }));
}

function buildPublicReceipt(input: {
  input: { repair: AgentRepairOutcome; contract: SemanticTaskContract };
  receipt: SemanticDeliveryOutcome["receipt"];
  contractSha256: string;
  semanticVerification: SemanticVerificationReceiptSummary;
  evidenceBundle: VerifiedWorkEvidenceBundle;
  patch: AppliedGitPatchEvidence | null;
  localCommit: GitCommitMetadata | null;
  pullRequest: GitPullRequestEvidence | null;
  deliveryDiff: SemanticDeliveryOutcome["deliveryDiff"];
  independentVerification: IndependentDeliveryVerification | null;
  payment: SemanticDeliveryOutcome["payment"];
  ledgerVerification: { valid: boolean; entryCount: number; chainSha256: string | null };
}): PublicJobReceipt {
  const verification = input.independentVerification;
  return {
    publicReceiptId: input.receipt.publicReceiptId,
    taskType: "Semantic Contract Verification and GitHub Delivery",
    agentIdentity: input.input.repair.executionIdentity
      ? input.input.repair.executionIdentity.agent.displayNameAtExecution
      : `VercelAIGatewayAgentProvider / ${input.input.repair.agentRun.model.id}`,
    ...(input.input.repair.executionIdentity
      ? {
          agentIdentityBinding: {
            agentId: input.input.repair.executionIdentity.agent.agentId,
            profileRevision: input.input.repair.executionIdentity.agent.profileRevision,
            profileSha256: input.input.repair.executionIdentity.agent.profileSha256,
            executionId: input.input.repair.executionIdentity.executionId,
            executionSha256: input.input.repair.executionIdentity.executionSha256,
            displayNameAtExecution: input.input.repair.executionIdentity.agent.displayNameAtExecution,
          },
        }
      : {}),
    workerIdentity: "DoneLayer Server-side Orchestrator / NON_AI_DETERMINISTIC_VERIFIER",
    contractSha256: input.contractSha256,
    evidenceChainSha256: input.receipt.evidenceChainSha256,
    artifactSha256: input.evidenceBundle.bundleSha256,
    verificationSummary: input.semanticVerification.overall === "VERIFIED_DELIVERY"
      ? "Execution, repository tests, locked Contract assertions, delivery, and fresh verification all passed."
      : "Semantic delivery did not satisfy every required verification dimension.",
    result: input.receipt.result,
    createdAt: String(input.receipt.document.issuedAt),
    verificationStatus: input.ledgerVerification.valid ? "VALID" : "INVALID",
    invalidated: false,
    disputed: false,
    semanticVerification: input.semanticVerification,
    ...(verification && input.localCommit && input.pullRequest && input.deliveryDiff
      ? {
          githubDelivery: {
            repairVerified: true,
            deliveredToGitHub: true,
            independentCleanVerification: "PASSED" as const,
            repository: "NickHOI/donelayer-build-rescue-fixture",
            deliveryBranch: input.pullRequest.headBranch,
            deliveryCommitSha: input.localCommit.commitSha,
            parentCommitSha: input.localCommit.parentCommitSha,
            deliveryDiffSha256: input.deliveryDiff.sha256,
            authenticationMode: GIT_DELIVERY_AUTHENTICATION_MODE,
            pullRequestNumber: input.pullRequest.number,
            pullRequestUrl: input.pullRequest.url,
            pullRequestState: input.pullRequest.state,
            merged: input.pullRequest.merged,
            verifierType: verification.verifierType,
            verificationSandboxId: verification.sandbox.sandboxId,
            installExitCode: verification.install.exitCode ?? -1,
            buildStatus: verification.build.status === "PASSED" ? "PASSED" as const : "NOT_PRESENT" as const,
            testExitCode: verification.test.exitCode ?? -1,
            totalTests: verification.testStatistics.total,
            passedTests: verification.testStatistics.passed,
            failedTests: verification.testStatistics.failed,
            testsUnchanged: verification.antiCheating.testsUnchanged,
            testScriptUnchanged: verification.antiCheating.testScriptUnchanged,
            policyViolationCount: 0,
            cleanupVerified: verification.cleanup.cleanupVerified,
            paymentMode: "SIMULATION_ONLY" as const,
            testLedgerState: input.payment.state === "RELEASED" ? "RELEASED" as const : "RESERVED" as const,
            simulatedProviderPayoutCents: input.payment.providerPayoutCents,
            simulatedPlatformFeeCents: input.payment.platformFeeCents,
            aiCallCount: 0 as const,
            aiGatewayUsageUsd: 0 as const,
          },
        }
      : {}),
    scopeDisclaimer: "This Receipt is limited to one owner-controlled true-source-bug Fixture Commit. Repository tests and independent locked Contract assertions passed in separate managed Sandboxes. The Pull Request is open and unmerged. Payment is simulated only.",
  };
}

class Ledger {
  readonly entries: LedgerEntry[] = [];

  append(entryType: string, sourceRecordType: string, sourceRecordId: string, payload: unknown, createdAt = new Date().toISOString()): void {
    const previousEntrySha256 = this.entries.at(-1)?.entrySha256 ?? null;
    const entry: LedgerEntry = { id: randomUUID(), sequenceNumber: this.entries.length + 1, entryType, sourceRecordType, sourceRecordId, payloadSha256: digest(canonicalJson(payload)), previousEntrySha256, entrySha256: "", createdAt };
    entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
    this.entries.push(entry);
  }

  verify(): { valid: boolean; entryCount: number; chainSha256: string | null } {
    let previous: string | null = null;
    for (const [index, entry] of this.entries.entries()) {
      if (entry.sequenceNumber !== index + 1 || entry.previousEntrySha256 !== previous || computeEvidenceLedgerEntryHash(entry) !== entry.entrySha256) {
        return { valid: false, entryCount: this.entries.length, chainSha256: previous };
      }
      previous = entry.entrySha256;
    }
    return { valid: true, entryCount: this.entries.length, chainSha256: previous };
  }
}

function classifyFailure(error: unknown): SemanticDeliveryFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/TEST_TAMPERING/.test(message)) return "TEST_TAMPERING_DETECTED";
  if (/CONTRACT/.test(message)) return "CONTRACT_ASSERTION_FAILED";
  if (/PATCH/.test(message)) return "PATCH_MISMATCH";
  if (/INDEPENDENT/.test(message)) return "INDEPENDENT_VERIFICATION_FAILED";
  if (/CLEANUP/.test(message)) return "CLEANUP_FAILED";
  return "DELIVERY_FAILED";
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "[LOCAL_HOME]")
    .slice(0, 500);
}

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
