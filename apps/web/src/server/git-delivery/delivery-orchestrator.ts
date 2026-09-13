import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  TestLedgerProvider,
  canonicalJson,
  computeEvidenceLedgerEntryHash,
  type PaymentDistribution,
  type PaymentProvider,
  type PublicJobReceipt,
} from "@donelayer/database";
import {
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  assertGitDeliveryBranch,
  repositoryFileManifestSchema,
  repositoryManifestSha256,
  type RepositoryFileManifest,
} from "@donelayer/worker-protocol";

import { IndependentDeliveryVerifier, type IndependentDeliveryVerification } from "./independent-delivery-verifier";
import {
  GIT_DELIVERY_AUTHENTICATION_MODE,
  type AppliedGitPatchEvidence,
  type GitCommitMetadata,
  type GitDeliveryProvider,
  type GitDeliveryWorkspace,
  type GitPullRequestEvidence,
  type GitPushEvidence,
  type GitRepositoryVerification,
} from "./provider";

export const GITHUB_DELIVERY_GATE = "GITHUB_PATCH_DELIVERY_AND_INDEPENDENT_VERIFICATION_GATE_V1" as const;
export const GITHUB_DELIVERY_CONTRACT = "GITHUB_PATCH_DELIVERY_VERIFY_V1" as const;
export const GITHUB_DELIVERY_EXPECTED_PATCH_SHA256 = "6e8679bbef6dbbba31f84ffb20b209df4d3fadfee81e58383e9926a70855c996" as const;
const SIMULATED_CHARGE_CENTS = 1_000;
const SIMULATED_CUSTOMER_ID = "github-delivery-gate-customer";
const SIMULATED_PROVIDER_ID = "github-delivery-gate-provider";

export type GitDeliveryLedgerEntry = {
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

export type GitDeliveryLedgerVerification = {
  valid: boolean;
  entryCount: number;
  chainSha256: string | null;
};

export type GitDeliveryArtifactRecord = {
  id: string;
  fileName: string;
  mimeType: "application/json" | "text/plain";
  size: number;
  sha256: string;
  content: string;
};

export type GitDeliveryContractDocument = {
  schemaVersion: 1;
  contractType: typeof GITHUB_DELIVERY_CONTRACT;
  status: "LOCKED";
  taskId: string;
  desiredOutcome: string;
  repository: "NickHOI/donelayer-build-rescue-fixture";
  remoteUrl: typeof REPOSITORY_MATERIALIZATION_REMOTE_URL;
  baseBranch: "main";
  allowedBaseCommit: string;
  allowedPatchSha256: typeof GITHUB_DELIVERY_EXPECTED_PATCH_SHA256;
  allowedActions: string[];
  forbiddenActions: string[];
  simulatedBudgetCents: 1000;
  lockedAt: string;
};

export type GitHubDeliveryReceiptDocument = {
  schemaVersion: 1;
  receiptType: "GITHUB_DELIVERY_AND_INDEPENDENT_VERIFICATION";
  publicReceiptId: string;
  gate: typeof GITHUB_DELIVERY_GATE;
  finalResult: "VERIFIED_DELIVERY" | GitDeliveryFailureCode;
  contract: {
    type: typeof GITHUB_DELIVERY_CONTRACT;
    status: "LOCKED";
    sha256: string;
  };
  originalRepair: {
    jobRunId: string;
    receiptId: string;
    publicReceiptId: string;
    provider: "VercelAIGatewayAgentProvider";
    modelProvider: string;
    modelId: string;
    authentication: "VERCEL_OIDC" | "AI_GATEWAY_API_KEY";
    freeCreditBalanceBefore: string;
    freeCreditUsed: string;
    freeCreditBalanceAfter: string;
    apiRequestCount: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    gatewayReportedCostUsd: null;
    patchSha256: string;
    repairedSourceSha256: string;
    sandboxId: string;
    baselineTestExitCode: 1;
    repairedTestExitCode: 0;
    toolCallCount: number;
    cleanupVerified: true;
    result: "VERIFIED";
    providerWarnings: string[];
  };
  githubDelivery: {
    repository: string;
    branch: string;
    baseCommit: string;
    deliveryCommit: string;
    parentCommit: string;
    changedFiles: string[];
    normalizedDiffSha256: string;
    deliveryDiffSha256: string;
    authenticationMode: typeof GIT_DELIVERY_AUTHENTICATION_MODE;
    push: GitPushEvidence;
    pullRequest: GitPullRequestEvidence;
  } | null;
  independentVerification: IndependentDeliveryVerification | null;
  payment: {
    mode: "SIMULATION_ONLY";
    state: "RELEASED" | "RESERVED" | "NOT_RESERVED";
    customerChargeCents: number;
    providerPayoutCents: number;
    platformFeeCents: number;
    releasedAt: string | null;
    authorizingReceiptId: string;
  };
  aiPolicy: {
    aiCalls: 0;
    aiGatewayUsageUsd: 0;
    violations: [];
  };
  artifacts: Array<{ id: string; fileName: string; mimeType: string; size: number; sha256: string }>;
  verificationChecks: Array<{ id: string; status: "PASSED" | "FAILED"; summary: string }>;
  evidenceLedger: GitDeliveryLedgerVerification;
  deliveryWorkspaceCleaned: boolean;
  failure: { code: GitDeliveryFailureCode; message: string } | null;
  issuedAt: string;
};

export type GitDeliveryFailureCode =
  | "DELIVERY_FAILED"
  | "PATCH_MISMATCH"
  | "REMOTE_COMMIT_MISMATCH"
  | "PR_CREATION_FAILED"
  | "INDEPENDENT_VERIFICATION_FAILED"
  | "TEST_TAMPERING_DETECTED"
  | "CLEANUP_FAILED"
  | "POLICY_VIOLATION";

export type GitHubDeliveryOutcome = {
  gate: typeof GITHUB_DELIVERY_GATE;
  runId: string;
  jobRunId: string;
  status: "VERIFIED_DELIVERY" | "FAILED";
  failureCode: GitDeliveryFailureCode | null;
  contract: GitDeliveryContractDocument;
  contractSha256: string;
  availability: Awaited<ReturnType<GitDeliveryProvider["checkAvailability"]>> | null;
  repair: GitHubDeliveryReceiptDocument["originalRepair"];
  repository: GitRepositoryVerification | null;
  deliveryBranch: string;
  patch: AppliedGitPatchEvidence | null;
  localCommit: GitCommitMetadata | null;
  remoteCommit: GitCommitMetadata | null;
  push: GitPushEvidence | null;
  pullRequest: GitPullRequestEvidence | null;
  deliveryDiff: { patch: string; sha256: string; semanticEquivalent: boolean } | null;
  independentVerification: IndependentDeliveryVerification | null;
  payment: GitHubDeliveryReceiptDocument["payment"];
  policyViolations: [];
  aiCallCount: 0;
  aiGatewayUsageUsd: 0;
  deliveryWorkspaceCleaned: boolean;
  artifacts: GitDeliveryArtifactRecord[];
  ledgerEntries: GitDeliveryLedgerEntry[];
  ledgerVerification: GitDeliveryLedgerVerification;
  receipt: {
    id: string;
    publicReceiptId: string;
    result: GitHubDeliveryReceiptDocument["finalResult"];
    receiptSha256: string;
    evidenceChainSha256: string;
    document: GitHubDeliveryReceiptDocument;
  };
  publicReceipt: PublicJobReceipt;
};

type DeliveryVerifier = Pick<IndependentDeliveryVerifier, "verify">;

export class GitHubDeliveryOrchestrator {
  constructor(
    private readonly provider: GitDeliveryProvider,
    private readonly verifier: DeliveryVerifier = new IndependentDeliveryVerifier(),
    private readonly paymentProvider: PaymentProvider = new TestLedgerProvider({ [SIMULATED_CUSTOMER_ID]: 10_000 }),
  ) {}

  async run(input: {
    repairEvidencePath?: string;
    repairPatchPath?: string;
    buildEvidencePath?: string;
  } = {}): Promise<GitHubDeliveryOutcome> {
    const runId = randomUUID();
    const jobRunId = randomUUID();
    const receiptId = randomUUID();
    const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
    const loaded = await loadInputs(input);
    const deliveryBranch = deriveDeliveryBranch(loaded.repair.jobRunId);
    const contract = createGitDeliveryContract({ taskId: runId, baseCommit: loaded.baseCommit });
    const contractSha256 = sha256(canonicalJson(contract));
    const ledger = new DeliveryEvidenceLedger();
    ledger.append("CONTRACT_LOCKED", "task_contract", runId, { contractSha256, contract });
    ledger.append("PERMISSION_GRANTED", "delivery_permission", runId, {
      allowedActions: contract.allowedActions,
      forbiddenActions: contract.forbiddenActions,
      repository: contract.repository,
      baseCommit: contract.allowedBaseCommit,
      patchSha256: contract.allowedPatchSha256,
    });

    let availability: GitHubDeliveryOutcome["availability"] = null;
    let repository: GitRepositoryVerification | null = null;
    let workspace: GitDeliveryWorkspace | null = null;
    let patchEvidence: AppliedGitPatchEvidence | null = null;
    let localCommit: GitCommitMetadata | null = null;
    let remoteCommit: GitCommitMetadata | null = null;
    let push: GitPushEvidence | null = null;
    let pullRequest: GitPullRequestEvidence | null = null;
    let remoteDiff: Awaited<ReturnType<GitDeliveryProvider["getDiff"]>> | null = null;
    let independentVerification: IndependentDeliveryVerification | null = null;
    let reservationCreated = false;
    let distribution: PaymentDistribution | null = null;
    let releasedAt: string | null = null;
    let verificationPassed = false;
    let deliveryWorkspaceCleaned = false;
    let failure: { code: GitDeliveryFailureCode; message: string } | null = null;

    try {
      availability = await this.provider.checkAvailability();
      if (!availability.available || availability.authenticationMode !== GIT_DELIVERY_AUTHENTICATION_MODE || !availability.accountLogin) {
        throw new Error(`DELIVERY_FAILED: ${availability.errorCode ?? "GitHub authentication unavailable"}`);
      }
      ledger.append("DELIVERY_PROVIDER_AVAILABLE", "git_delivery_provider", runId, availability, availability.checkedAt);
      repository = await this.provider.verifyRepository({
        remoteUrl: loaded.remoteUrl,
        expectedBaseCommit: loaded.baseCommit,
        baseBranch: "main",
      });
      ledger.append("REMOTE_REPOSITORY_VERIFIED", "github_repository", repository.repositoryId, repository, repository.verifiedAt);
      await this.paymentProvider.reserve({
        taskId: runId,
        customerId: SIMULATED_CUSTOMER_ID,
        amountCents: SIMULATED_CHARGE_CENTS,
      });
      reservationCreated = true;
      ledger.append("TEST_LEDGER_RESERVED", "test_ledger", runId, {
        mode: "SIMULATION_ONLY",
        customerId: SIMULATED_CUSTOMER_ID,
        amountCents: SIMULATED_CHARGE_CENTS,
      });
      workspace = await this.provider.createBranch({
        remoteUrl: loaded.remoteUrl,
        baseCommit: loaded.baseCommit,
        baseBranch: "main",
        deliveryBranch,
      });
      ledger.append("DELIVERY_BRANCH_PREPARED", "git_branch", deliveryBranch, {
        branch: deliveryBranch,
        baseCommit: loaded.baseCommit,
        existingRemoteCommit: workspace.existingRemoteCommit,
      });
      patchEvidence = await this.provider.applyPatch(workspace, {
        patch: loaded.patch,
        expectedPatchSha256: loaded.patchSha256,
        expectedBaseManifestSha256: loaded.baseManifestSha256,
        allowedChangedFiles: ["src/add.ts"],
      });
      ledger.append("VERIFIED_PATCH_APPLIED", "repair_patch", loaded.patchSha256, {
        patchSha256: patchEvidence.patchSha256,
        normalizedDiffSha256: patchEvidence.normalizedDiffSha256,
        changedFiles: patchEvidence.changedFiles,
      }, patchEvidence.appliedAt);
      localCommit = await this.provider.createCommit(workspace, {
        message: "fix: apply DoneLayer verified repair",
        accountLogin: availability.accountLogin,
        allowedChangedFiles: patchEvidence.changedFiles,
      });
      patchEvidence.deliveredManifest.commitSha = localCommit.commitSha;
      patchEvidence.deliveredManifestSha256 = repositoryManifestSha256(patchEvidence.deliveredManifest);
      ledger.append("DELIVERY_COMMIT_CREATED", "git_commit", localCommit.commitSha, localCommit, localCommit.committedAt);
      push = await this.provider.pushBranch(workspace, localCommit);
      ledger.append("DELIVERY_BRANCH_PUSHED", "git_push", localCommit.commitSha, push, push.pushedAt);
      remoteCommit = await this.provider.getCommitMetadata(repository.repository, localCommit.commitSha);
      assertMatchingCommit(localCommit, remoteCommit, loaded.baseCommit);
      ledger.append("REMOTE_COMMIT_VERIFIED", "github_commit", remoteCommit.commitSha, remoteCommit, remoteCommit.committedAt);
      const prBody = pullRequestBody({
        repairPublicReceiptId: loaded.repair.publicReceiptId,
        baseCommit: loaded.baseCommit,
        deliveryCommit: localCommit.commitSha,
        patchSha256: loaded.patchSha256,
        modifiedFiles: patchEvidence.changedFiles,
      });
      pullRequest = await this.provider.createPullRequest({
        repository: repository.repository,
        title: "DoneLayer verified repair",
        body: prBody,
        baseBranch: "main",
        headBranch: deliveryBranch,
      });
      assertPullRequest(pullRequest, prBody, loaded.baseCommit, localCommit.commitSha, deliveryBranch);
      ledger.append("PULL_REQUEST_CREATED", "github_pull_request", String(pullRequest.number), pullRequest, pullRequest.createdAt);
      remoteDiff = await this.provider.getDiff(repository.repository, pullRequest.number);
      ledger.append("DELIVERY_DIFF_RETRIEVED", "github_pull_request_diff", String(pullRequest.number), {
        sha256: remoteDiff.sha256,
        retrievedAt: remoteDiff.retrievedAt,
      }, remoteDiff.retrievedAt);
      independentVerification = await this.verifier.verify({
        jobRunId,
        remoteUrl: loaded.remoteUrl,
        deliveryBranch,
        deliveryCommitSha: localCommit.commitSha,
        baseCommitSha: loaded.baseCommit,
        baseManifest: loaded.baseManifest,
        expectedSourceChanges: patchEvidence.fileChanges.map((change) => ({ path: change.path, afterSha256: change.afterSha256 })),
        expectedTestScript: patchEvidence.testScriptBefore,
        repairSandboxId: loaded.repair.sandboxId,
      });
      ledger.append("INDEPENDENT_SOURCE_MATERIALIZED", "delivery_verifier", independentVerification.verifierRunId, independentVerification.source, independentVerification.verifiedAt);
      ledger.append("INDEPENDENT_TEST_PASSED", "managed_sandbox_command", independentVerification.test.commandId ?? independentVerification.verifierRunId, {
        exitCode: independentVerification.test.exitCode,
        statistics: independentVerification.testStatistics,
      }, independentVerification.test.finishedAt);
      ledger.append("TEST_TAMPERING_CHECK_PASSED", "delivery_verifier", independentVerification.verifierRunId, independentVerification.antiCheating, independentVerification.verifiedAt);
      ledger.append("VERIFICATION_SANDBOX_CLEANUP_VERIFIED", "managed_sandbox", independentVerification.sandbox.sandboxId, independentVerification.cleanup, independentVerification.cleanup.stopConfirmedAt);
      assertVerifiedDelivery({
        loaded,
        patchEvidence,
        localCommit,
        remoteCommit,
        push,
        pullRequest,
        independentVerification,
        remoteDiffPatch: remoteDiff.patch,
      });
      ledger.append("VERIFIED_DELIVERY", "github_delivery_run", runId, {
        commitSha: localCommit.commitSha,
        pullRequestNumber: pullRequest.number,
        sandboxId: independentVerification.sandbox.sandboxId,
        aiCallCount: 0,
        policyViolations: [],
      });
      verificationPassed = true;
    } catch (error) {
      failure = { code: classifyFailure(error), message: safeFailureMessage(error) };
      ledger.append(failure.code, "github_delivery_run", runId, failure);
    } finally {
      if (workspace) {
        try {
          await this.provider.cancelDelivery(workspace);
          deliveryWorkspaceCleaned = true;
          ledger.append("DELIVERY_WORKSPACE_CLEANED", "git_delivery_workspace", workspace.id, { cleaned: true });
        } catch (error) {
          deliveryWorkspaceCleaned = false;
          failure = { code: "CLEANUP_FAILED", message: safeFailureMessage(error) };
          ledger.append("CLEANUP_FAILED", "git_delivery_workspace", workspace.id, failure);
        }
      }
    }

    if (!failure && verificationPassed && deliveryWorkspaceCleaned) {
      try {
        distribution = await this.paymentProvider.release({ taskId: runId, providerId: SIMULATED_PROVIDER_ID });
        releasedAt = new Date().toISOString();
        ledger.append("TEST_LEDGER_RELEASED", "test_ledger", runId, {
          ...distribution,
          mode: "SIMULATION_ONLY",
          authorizingReceiptId: receiptId,
        }, releasedAt);
      } catch (error) {
        failure = { code: "DELIVERY_FAILED", message: safeFailureMessage(error) };
        ledger.append("DELIVERY_FAILED", "test_ledger", runId, failure);
      }
    }

    const status = !failure && independentVerification && distribution && deliveryWorkspaceCleaned
      ? "VERIFIED_DELIVERY" as const
      : "FAILED" as const;
    if (status === "FAILED" && !failure) failure = { code: "DELIVERY_FAILED", message: "Delivery ended without complete evidence" };
    const payment = {
      mode: "SIMULATION_ONLY" as const,
      state: distribution ? "RELEASED" as const : reservationCreated ? "RESERVED" as const : "NOT_RESERVED" as const,
      customerChargeCents: reservationCreated ? SIMULATED_CHARGE_CENTS : 0,
      providerPayoutCents: distribution?.providerCents ?? 0,
      platformFeeCents: distribution?.platformFeeCents ?? 0,
      releasedAt,
      authorizingReceiptId: receiptId,
    };
    const artifacts = buildArtifacts({
      contract,
      repair: loaded.repair,
      repository,
      deliveryBranch,
      patchEvidence,
      localCommit,
      remoteCommit,
      push,
      pullRequest,
      remoteDiff,
      independentVerification,
      payment,
      failure,
      deliveryWorkspaceCleaned,
    });
    assertNoCredentialLeak({ artifacts, failure });
    for (const artifact of artifacts) {
      ledger.append("ARTIFACT_HASH_VERIFIED", "evidence_artifact", artifact.id, {
        fileName: artifact.fileName,
        size: artifact.size,
        sha256: artifact.sha256,
      });
    }
    const preReceiptLedger = ledger.verify();
    const receiptDocument: GitHubDeliveryReceiptDocument = {
      schemaVersion: 1,
      receiptType: "GITHUB_DELIVERY_AND_INDEPENDENT_VERIFICATION",
      publicReceiptId,
      gate: GITHUB_DELIVERY_GATE,
      finalResult: status === "VERIFIED_DELIVERY" ? "VERIFIED_DELIVERY" : failure!.code,
      contract: { type: GITHUB_DELIVERY_CONTRACT, status: "LOCKED", sha256: contractSha256 },
      originalRepair: loaded.repair,
      githubDelivery: patchEvidence && localCommit && push && pullRequest && remoteDiff
        ? {
            repository: repository?.repository ?? "NickHOI/donelayer-build-rescue-fixture",
            branch: deliveryBranch,
            baseCommit: loaded.baseCommit,
            deliveryCommit: localCommit.commitSha,
            parentCommit: localCommit.parentCommitSha,
            changedFiles: patchEvidence.changedFiles,
            normalizedDiffSha256: patchEvidence.normalizedDiffSha256,
            deliveryDiffSha256: remoteDiff.sha256,
            authenticationMode: GIT_DELIVERY_AUTHENTICATION_MODE,
            push,
            pullRequest,
          }
        : null,
      independentVerification,
      payment,
      aiPolicy: { aiCalls: 0, aiGatewayUsageUsd: 0, violations: [] },
      artifacts: artifacts.map(({ content: _content, ...artifact }) => artifact),
      verificationChecks: verificationChecks(status, patchEvidence, pullRequest, independentVerification, payment, deliveryWorkspaceCleaned),
      evidenceLedger: preReceiptLedger,
      deliveryWorkspaceCleaned,
      failure,
      issuedAt: new Date().toISOString(),
    };
    const receiptSha256 = sha256(canonicalJson(receiptDocument));
    ledger.append("RECEIPT_CREATED", "job_receipt", receiptId, {
      receiptSha256,
      evidenceChainSha256: preReceiptLedger.chainSha256,
    }, receiptDocument.issuedAt);
    const ledgerVerification = ledger.verify();
    const publicReceipt = buildPublicReceipt({
      document: receiptDocument,
      receiptSha256,
      ledgerVerification,
      patchEvidence,
      independentVerification,
      pullRequest,
      localCommit,
      remoteDiff,
      loaded,
      payment,
    });
    return {
      gate: GITHUB_DELIVERY_GATE,
      runId,
      jobRunId,
      status,
      failureCode: failure?.code ?? null,
      contract,
      contractSha256,
      availability,
      repair: loaded.repair,
      repository,
      deliveryBranch,
      patch: patchEvidence,
      localCommit,
      remoteCommit,
      push,
      pullRequest,
      deliveryDiff: remoteDiff ? { patch: remoteDiff.patch, sha256: remoteDiff.sha256, semanticEquivalent: Boolean(independentVerification) } : null,
      independentVerification,
      payment,
      policyViolations: [],
      aiCallCount: 0,
      aiGatewayUsageUsd: 0,
      deliveryWorkspaceCleaned,
      artifacts,
      ledgerEntries: ledger.entries,
      ledgerVerification,
      receipt: {
        id: receiptId,
        publicReceiptId,
        result: receiptDocument.finalResult,
        receiptSha256,
        evidenceChainSha256: preReceiptLedger.chainSha256!,
        document: receiptDocument,
      },
      publicReceipt,
    };
  }
}

type LoadedInputs = {
  remoteUrl: typeof REPOSITORY_MATERIALIZATION_REMOTE_URL;
  baseCommit: string;
  baseManifest: RepositoryFileManifest;
  baseManifestSha256: string;
  patch: Buffer;
  patchSha256: string;
  repair: GitHubDeliveryReceiptDocument["originalRepair"];
};

async function loadInputs(input: {
  repairEvidencePath?: string;
  repairPatchPath?: string;
  buildEvidencePath?: string;
}): Promise<LoadedInputs> {
  const root = process.cwd();
  const repairEvidence = record(JSON.parse(await readFile(input.repairEvidencePath ?? path.join(root, "test-results", "agent-repair-sandbox-evidence.json"), "utf8")), "repair evidence");
  const repairResult = record(repairEvidence.result, "repair result");
  const repairSource = record(repairResult.source, "repair source");
  const repairPatch = record(repairResult.patch, "repair patch");
  const repairReceipt = record(repairResult.receipt, "repair Receipt");
  const repairDocument = record(repairReceipt.document, "repair Receipt document");
  const repairExecution = record(repairDocument.execution, "repair execution");
  const repairSummary = record(repairDocument.repair, "repair summary");
  const agentRun = record(repairResult.agentRun, "Agent run");
  const model = record(agentRun.model, "repair model");
  const sourceIntegrity = record(repairResult.sourceIntegrity, "repair Source integrity");
  const modified = records(sourceIntegrity.modified, "repair modified files");
  const buildEvidence = record(JSON.parse(await readFile(input.buildEvidencePath ?? path.join(root, "test-results", "real-build-test-sandbox-evidence.json"), "utf8")), "build evidence");
  const buildSource = record(record(buildEvidence.result, "build result").source, "build source");
  const baseCommit = requiredCommit(repairSource.materializerCommitSha, "persisted repair Base Commit");
  if (
    repairResult.status !== "VERIFIED" ||
    repairDocument.finalResult !== "VERIFIED" ||
    repairResult.publicReceipt && record(repairResult.publicReceipt, "repair public Receipt").verificationStatus !== "VALID" ||
    requiredCommit(repairSource.independentRemoteCommitSha, "independent repair Base Commit") !== baseCommit ||
    requiredCommit(buildSource.materializerCommitSha, "build Base Commit") !== baseCommit
  ) throw new Error("PERSISTED_REPAIR_EVIDENCE_INVALID");
  const patch = await readFile(input.repairPatchPath ?? path.join(root, "test-results", "agent-repair.patch"));
  const patchSha256 = sha256(patch);
  if (
    patchSha256 !== GITHUB_DELIVERY_EXPECTED_PATCH_SHA256 ||
    repairPatch.sha256 !== patchSha256 ||
    canonicalJson(repairPatch.modifiedFiles) !== canonicalJson(["src/add.ts"])
  ) throw new Error("PATCH_MISMATCH");
  const baseManifest = repositoryFileManifestSchema.parse({
    schemaVersion: 1,
    remoteUrl: buildSource.remoteUrl,
    branch: buildSource.branch,
    commitSha: baseCommit,
    files: buildSource.files,
  });
  const baseManifestSha256 = repositoryManifestSha256(baseManifest);
  if (baseManifestSha256 !== repairSource.repositoryManifestSha256 || baseManifestSha256 !== buildSource.repositoryManifestSha256) {
    throw new Error("DELIVERY_BASE_MANIFEST_MISMATCH");
  }
  const changed = modified.find((entry) => entry.path === "src/add.ts");
  if (!changed || modified.length !== 1) throw new Error("PERSISTED_REPAIR_SOURCE_BOUNDARY_INVALID");
  return {
    remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
    baseCommit,
    baseManifest,
    baseManifestSha256,
    patch,
    patchSha256,
    repair: {
      jobRunId: requiredString(repairResult.jobRunId, "repair Job ID"),
      receiptId: requiredString(repairReceipt.id, "repair Receipt ID"),
      publicReceiptId: requiredString(repairReceipt.publicReceiptId, "repair public Receipt ID"),
      provider: "VercelAIGatewayAgentProvider",
      modelProvider: requiredString(model.provider, "repair model provider"),
      modelId: requiredString(model.id, "repair model ID"),
      authentication: repairDocument.authentication === "AI_GATEWAY_API_KEY" ? "AI_GATEWAY_API_KEY" : "VERCEL_OIDC",
      freeCreditBalanceBefore: requiredString(repairDocument.freeCreditBalanceBefore, "repair credit balance before"),
      freeCreditUsed: requiredString(repairDocument.freeCreditUsed, "repair credit used"),
      freeCreditBalanceAfter: requiredString(repairDocument.freeCreditBalanceAfter, "repair credit balance after"),
      apiRequestCount: requiredNonNegativeInteger(repairDocument.apiRequestCount, "repair API request count"),
      inputTokens: requiredNonNegativeInteger(repairDocument.inputTokens, "repair input tokens"),
      outputTokens: requiredNonNegativeInteger(repairDocument.outputTokens, "repair output tokens"),
      cachedTokens: requiredNonNegativeInteger(repairDocument.cachedTokens, "repair cached tokens"),
      gatewayReportedCostUsd: null,
      patchSha256,
      repairedSourceSha256: requiredDigest(changed.afterSha256, "repaired Source hash"),
      sandboxId: requiredString(repairExecution.sandboxId, "repair Sandbox ID"),
      baselineTestExitCode: Number(repairSummary.baselineTestExitCode) === 1 ? 1 : (() => { throw new Error("Repair baseline evidence is invalid"); })(),
      repairedTestExitCode: Number(repairSummary.repairedTestExitCode) === 0 ? 0 : (() => { throw new Error("Repair test evidence is invalid"); })(),
      toolCallCount: requiredNonNegativeInteger(repairSummary.toolCallCount, "repair tool call count"),
      cleanupVerified: repairExecution.cleanupVerified === true ? true : (() => { throw new Error("Repair cleanup evidence is invalid"); })(),
      result: "VERIFIED",
      providerWarnings: agentRun.finishReason === "AI_GATEWAY_RATE_LIMITED_AFTER_REPAIR"
        ? ["AI_GATEWAY_RATE_LIMITED_AFTER_REPAIR"]
        : [],
    },
  };
}

export function deriveDeliveryBranch(repairJobRunId: string): string {
  const match = repairJobRunId.toLowerCase().match(/^([a-f0-9]{8}-[a-f0-9]{4})-/);
  if (!match) throw new Error("Repair Job ID cannot produce a deterministic delivery branch");
  return assertGitDeliveryBranch(`donelayer/repair/${match[1]}`);
}

export function createGitDeliveryContract(input: { taskId: string; baseCommit: string }): GitDeliveryContractDocument {
  return {
    schemaVersion: 1,
    contractType: GITHUB_DELIVERY_CONTRACT,
    status: "LOCKED",
    taskId: input.taskId,
    desiredOutcome: "Deliver the exact previously verified repair patch to a dedicated GitHub branch and Pull Request, then independently verify that exact remote commit from a clean managed sandbox.",
    repository: "NickHOI/donelayer-build-rescue-fixture",
    remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
    baseBranch: "main",
    allowedBaseCommit: requiredCommit(input.baseCommit, "Contract Base Commit"),
    allowedPatchSha256: GITHUB_DELIVERY_EXPECTED_PATCH_SHA256,
    allowedActions: [
      "verify_remote_repository", "create_delivery_branch", "apply_verified_patch", "create_commit",
      "push_delivery_branch", "create_pull_request", "read_pull_request", "independently_materialize_delivery_commit",
      "create_managed_verification_sandbox", "npm_ci", "npm_test", "collect_evidence", "stop_sandbox", "verify_cleanup",
    ],
    forbiddenActions: [
      "modify_main", "force_push", "merge_pull_request", "delete_remote_branch", "change_tests",
      "change_package_test_script", "modify_acceptance_criteria", "modify_repair_patch", "regenerate_patch",
      "AI_model_call", "production_deploy", "arbitrary_shell_from_user", "arbitrary_repository", "access_secret",
      "persistent_sandbox", "snapshot",
    ],
    simulatedBudgetCents: SIMULATED_CHARGE_CENTS,
    lockedAt: new Date().toISOString(),
  };
}

export function assertVerifiedDelivery(input: {
  loaded: LoadedInputs;
  patchEvidence: AppliedGitPatchEvidence;
  localCommit: GitCommitMetadata;
  remoteCommit: GitCommitMetadata;
  push: GitPushEvidence;
  pullRequest: GitPullRequestEvidence;
  independentVerification: IndependentDeliveryVerification;
  remoteDiffPatch: string;
}): void {
  if (
    input.patchEvidence.patchSha256 !== input.loaded.patchSha256 ||
    canonicalJson(input.patchEvidence.changedFiles) !== canonicalJson(["src/add.ts"]) ||
    !input.patchEvidence.testsUnchanged ||
    !input.patchEvidence.testScriptUnchanged ||
    !input.patchEvidence.testConfigurationUnchanged ||
    input.localCommit.parentCommitSha !== input.loaded.baseCommit ||
    input.remoteCommit.commitSha !== input.localCommit.commitSha ||
    input.push.remoteCommitSha !== input.localCommit.commitSha ||
    input.pullRequest.state !== "OPEN" || input.pullRequest.merged ||
    input.pullRequest.baseCommit !== input.loaded.baseCommit ||
    input.pullRequest.headCommit !== input.localCommit.commitSha ||
    input.independentVerification.source.deliveryCommitSha !== input.localCommit.commitSha ||
    input.independentVerification.source.parentCommitSha !== input.loaded.baseCommit ||
    input.independentVerification.test.exitCode !== 0 ||
    !input.independentVerification.antiCheating.testsUnchanged ||
    !input.independentVerification.antiCheating.testScriptUnchanged ||
    !input.independentVerification.cleanup.cleanupVerified ||
    input.independentVerification.aiCallCount !== 0 ||
    input.independentVerification.aiGatewayUsageUsd !== 0 ||
    !input.remoteDiffPatch.includes("diff --git a/src/add.ts b/src/add.ts")
  ) throw new Error("INDEPENDENT_VERIFICATION_FAILED");
}

function buildArtifacts(input: {
  contract: GitDeliveryContractDocument;
  repair: GitHubDeliveryReceiptDocument["originalRepair"];
  repository: GitRepositoryVerification | null;
  deliveryBranch: string;
  patchEvidence: AppliedGitPatchEvidence | null;
  localCommit: GitCommitMetadata | null;
  remoteCommit: GitCommitMetadata | null;
  push: GitPushEvidence | null;
  pullRequest: GitPullRequestEvidence | null;
  remoteDiff: Awaited<ReturnType<GitDeliveryProvider["getDiff"]>> | null;
  independentVerification: IndependentDeliveryVerification | null;
  payment: GitHubDeliveryReceiptDocument["payment"];
  failure: GitHubDeliveryReceiptDocument["failure"];
  deliveryWorkspaceCleaned: boolean;
}): GitDeliveryArtifactRecord[] {
  const values: Array<[string, GitDeliveryArtifactRecord["mimeType"], string]> = [
    ["task-contract.json", "application/json", json(input.contract)],
    ["delivery-permission.json", "application/json", json({ allowedActions: input.contract.allowedActions, forbiddenActions: input.contract.forbiddenActions })],
    ["repair-input.json", "application/json", json(input.repair)],
    ["github-delivery.json", "application/json", json({
      repository: input.repository,
      branch: input.deliveryBranch,
      commit: input.localCommit,
      remoteCommit: input.remoteCommit,
      push: input.push,
      pullRequest: input.pullRequest,
      authenticationMode: GIT_DELIVERY_AUTHENTICATION_MODE,
    })],
    ["local-delivery-diff.patch", "text/plain", input.patchEvidence?.actualDiff ?? ""],
    ["delivery-diff.patch", "text/plain", input.remoteDiff?.patch ?? ""],
    ["delivery-integrity.json", "application/json", json(input.patchEvidence)],
    ["independent-source.json", "application/json", json(input.independentVerification?.source ?? null)],
    ["independent-install-stdout.log", "text/plain", input.independentVerification?.install.stdout ?? ""],
    ["independent-install-stderr.log", "text/plain", input.independentVerification?.install.stderr || "\n"],
    ["independent-build.json", "application/json", json(input.independentVerification?.build ?? null)],
    ["independent-test-stdout.log", "text/plain", input.independentVerification?.test.stdout ?? ""],
    ["independent-test-stderr.log", "text/plain", input.independentVerification?.test.stderr || "\n"],
    ["independent-test-result.json", "application/json", json(input.independentVerification ? {
      command: input.independentVerification.test,
      statistics: input.independentVerification.testStatistics,
    } : null)],
    ["anti-cheating-verification.json", "application/json", json(input.independentVerification?.antiCheating ?? null)],
    ["independent-source-integrity.json", "application/json", json(input.independentVerification?.sourceIntegrity ?? null)],
    ["verification-sandbox-cleanup.json", "application/json", json(input.independentVerification?.cleanup ?? null)],
    ["test-ledger.json", "application/json", json(input.payment)],
    ["delivery-workspace-cleanup.json", "application/json", json({ cleaned: input.deliveryWorkspaceCleaned })],
    ["delivery-failure.json", "application/json", json(input.failure)],
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

function buildPublicReceipt(input: {
  document: GitHubDeliveryReceiptDocument;
  receiptSha256: string;
  ledgerVerification: GitDeliveryLedgerVerification;
  patchEvidence: AppliedGitPatchEvidence | null;
  independentVerification: IndependentDeliveryVerification | null;
  pullRequest: GitPullRequestEvidence | null;
  localCommit: GitCommitMetadata | null;
  remoteDiff: Awaited<ReturnType<GitDeliveryProvider["getDiff"]>> | null;
  loaded: LoadedInputs;
  payment: GitHubDeliveryReceiptDocument["payment"];
}): PublicJobReceipt {
  const valid = input.ledgerVerification.valid && input.document.evidenceLedger.valid;
  return {
    publicReceiptId: input.document.publicReceiptId,
    taskType: "GitHub Delivery and Independent Verification",
    agentIdentity: `${input.loaded.repair.provider} / ${input.loaded.repair.modelId}`,
    workerIdentity: input.independentVerification?.verifierType ?? "NON_AI_DETERMINISTIC_VERIFIER",
    contractSha256: input.document.contract.sha256,
    evidenceChainSha256: input.document.evidenceLedger.chainSha256 ?? "",
    artifactSha256: input.remoteDiff?.sha256 ?? input.receiptSha256,
    verificationSummary: input.document.finalResult === "VERIFIED_DELIVERY"
      ? "The exact verified repair was delivered to an open GitHub Pull Request and passed clean non-AI verification in a fresh managed Sandbox."
      : `Delivery failed with ${input.document.finalResult}.`,
    result: input.document.finalResult === "VERIFIED_DELIVERY" ? "VERIFIED_DELIVERY" : "FAILED",
    createdAt: input.document.issuedAt,
    verificationStatus: valid ? "VALID" : "INVALID",
    invalidated: false,
    disputed: false,
    ...(input.localCommit && input.patchEvidence
      ? {
          repository: {
            remoteUrl: input.loaded.remoteUrl,
            branch: input.document.githubDelivery?.branch ?? "",
            workerCommitSha: input.localCommit.commitSha,
            independentRemoteCommitSha: input.independentVerification?.source.independentRemoteCommitSha ?? input.localCommit.commitSha,
            manifestSha256: input.independentVerification?.source.manifestSha256 ?? input.patchEvidence.deliveredManifestSha256,
            fileCount: input.independentVerification?.source.fileCount ?? input.patchEvidence.deliveredManifest.files.length,
          },
        }
      : {}),
    ...(input.independentVerification
      ? {
          managedSandbox: {
            provider: "VERCEL_SANDBOX" as const,
            sandboxIdentity: input.independentVerification.sandbox.sandboxId,
            isolationModel: "REMOTE_MICROVM" as const,
            lifecycleMode: "NON_PERSISTENT" as const,
            runtime: input.independentVerification.sandbox.runtime,
            region: input.independentVerification.sandbox.region,
            networkPolicy: "deny-all" as const,
            exitCode: input.independentVerification.test.exitCode ?? -1,
            networkProbeBlocked: null,
            cleanupVerified: input.independentVerification.cleanup.cleanupVerified,
            localHostExecutionUsed: false as const,
            localDockerUsed: false as const,
            persistentSnapshotCreated: false as const,
          },
        }
      : {}),
    agentRepair: {
      gateway: "Vercel AI Gateway",
      modelProvider: input.loaded.repair.modelProvider,
      modelId: input.loaded.repair.modelId,
      agentProviderAdapter: "VercelAIGatewayAgentProvider",
      authentication: input.loaded.repair.authentication,
      freeCreditBalanceBefore: input.loaded.repair.freeCreditBalanceBefore,
      freeCreditUsed: input.loaded.repair.freeCreditUsed,
      freeCreditBalanceAfter: input.loaded.repair.freeCreditBalanceAfter,
      apiRequestCount: input.loaded.repair.apiRequestCount,
      inputTokens: input.loaded.repair.inputTokens,
      outputTokens: input.loaded.repair.outputTokens,
      cachedTokens: input.loaded.repair.cachedTokens,
      gatewayReportedCostUsd: null,
      baselineTestExitCode: 1,
      repairedTestExitCode: 0,
      patchSha256: input.loaded.patchSha256,
      modifiedFiles: ["src/add.ts"],
      toolCallCount: input.loaded.repair.toolCallCount,
      cleanupVerified: input.loaded.repair.cleanupVerified,
    },
    ...(input.document.githubDelivery && input.independentVerification && input.pullRequest && input.localCommit && input.remoteDiff
      ? {
          githubDelivery: {
            repairVerified: true,
            deliveredToGitHub: true,
            independentCleanVerification: "PASSED" as const,
            repository: input.document.githubDelivery.repository,
            deliveryBranch: input.document.githubDelivery.branch,
            deliveryCommitSha: input.localCommit.commitSha,
            parentCommitSha: input.localCommit.parentCommitSha,
            deliveryDiffSha256: input.remoteDiff.sha256,
            authenticationMode: GIT_DELIVERY_AUTHENTICATION_MODE,
            pullRequestNumber: input.pullRequest.number,
            pullRequestUrl: input.pullRequest.url,
            pullRequestState: input.pullRequest.state,
            merged: input.pullRequest.merged,
            verifierType: input.independentVerification.verifierType,
            verificationSandboxId: input.independentVerification.sandbox.sandboxId,
            installExitCode: input.independentVerification.install.exitCode ?? -1,
            buildStatus: input.independentVerification.build.status === "PASSED" ? "PASSED" as const : "NOT_PRESENT" as const,
            testExitCode: input.independentVerification.test.exitCode ?? -1,
            totalTests: input.independentVerification.testStatistics.total,
            passedTests: input.independentVerification.testStatistics.passed,
            failedTests: input.independentVerification.testStatistics.failed,
            testsUnchanged: input.independentVerification.antiCheating.testsUnchanged,
            testScriptUnchanged: input.independentVerification.antiCheating.testScriptUnchanged,
            policyViolationCount: 0,
            cleanupVerified: input.independentVerification.cleanup.cleanupVerified,
            paymentMode: "SIMULATION_ONLY" as const,
            testLedgerState: input.payment.state === "RELEASED" ? "RELEASED" as const : "RESERVED" as const,
            simulatedProviderPayoutCents: input.payment.providerPayoutCents,
            simulatedPlatformFeeCents: input.payment.platformFeeCents,
            aiCallCount: 0 as const,
            aiGatewayUsageUsd: 0 as const,
          },
        }
      : {}),
    scopeDisclaimer: "This Receipt verifies one exact owner-controlled Fixture repair delivery and clean managed-Sandbox test. The Pull Request is open and unmerged. Payment is simulated only; no real funds moved.",
  };
}

function verificationChecks(
  status: GitHubDeliveryOutcome["status"],
  patch: AppliedGitPatchEvidence | null,
  pullRequest: GitPullRequestEvidence | null,
  verification: IndependentDeliveryVerification | null,
  payment: GitHubDeliveryReceiptDocument["payment"],
  workspaceCleaned: boolean,
): GitHubDeliveryReceiptDocument["verificationChecks"] {
  const check = (id: string, passed: boolean, summary: string) => ({ id, status: passed ? "PASSED" as const : "FAILED" as const, summary });
  return [
    check("exact-patch-delivered", Boolean(patch?.patchSha256 === GITHUB_DELIVERY_EXPECTED_PATCH_SHA256), "The persisted repair patch was delivered without regeneration."),
    check("pull-request-open", Boolean(pullRequest?.state === "OPEN" && !pullRequest.merged), "The GitHub Pull Request is open and unmerged."),
    check("fresh-independent-verification", Boolean(verification?.result === "PASSED" && verification.test.exitCode === 0), "A fresh non-AI managed Sandbox passed npm test."),
    check("tests-unchanged", Boolean(verification?.antiCheating.testsUnchanged && verification.antiCheating.testScriptUnchanged), "Tests and the package test script match the Base Commit."),
    check("sandbox-cleanup", Boolean(verification?.cleanup.cleanupVerified), "The verification Sandbox stopped without persistence or Snapshot."),
    check("no-ai-calls", true, "This Gate made zero AI/model calls and used zero AI Gateway credit."),
    check("simulated-payment-release", status === "VERIFIED_DELIVERY" && payment.state === "RELEASED", "The Test Ledger released simulated payout only after verified delivery."),
    check("delivery-workspace-cleanup", workspaceCleaned, "The controlled local delivery workspace was removed."),
  ];
}

function pullRequestBody(input: {
  repairPublicReceiptId: string;
  baseCommit: string;
  deliveryCommit: string;
  patchSha256: string;
  modifiedFiles: string[];
}): string {
  return [
    "## DoneLayer verified repair",
    "",
    `Repair Receipt ID: ${input.repairPublicReceiptId}`,
    `Base Commit SHA: ${input.baseCommit}`,
    `Delivery Commit SHA: ${input.deliveryCommit}`,
    `Patch SHA-256: ${input.patchSha256}`,
    `Modified files: ${input.modifiedFiles.join(", ")}`,
    "Initial Test Result: FAILED",
    "Repair Sandbox Test Result: PASSED",
    "Independent Verification Status: PENDING",
    "",
    "This Pull Request was created by the owner-authorized DoneLayer development GitHub authentication boundary. It is intentionally unmerged.",
  ].join("\n");
}

function assertMatchingCommit(local: GitCommitMetadata, remote: GitCommitMetadata, baseCommit: string): void {
  if (
    local.commitSha !== remote.commitSha ||
    local.parentCommitSha !== baseCommit ||
    remote.parentCommitSha !== baseCommit ||
    local.message !== "fix: apply DoneLayer verified repair" ||
    remote.message !== local.message ||
    canonicalJson(local.changedFiles) !== canonicalJson(["src/add.ts"]) ||
    canonicalJson(remote.changedFiles) !== canonicalJson(["src/add.ts"])
  ) throw new Error("REMOTE_COMMIT_MISMATCH");
}

function assertPullRequest(
  pullRequest: GitPullRequestEvidence,
  expectedBody: string,
  baseCommit: string,
  deliveryCommit: string,
  deliveryBranch: string,
): void {
  if (
    pullRequest.title !== "DoneLayer verified repair" ||
    pullRequest.body !== expectedBody ||
    pullRequest.state !== "OPEN" ||
    pullRequest.merged ||
    pullRequest.baseBranch !== "main" ||
    pullRequest.headBranch !== deliveryBranch ||
    pullRequest.baseCommit !== baseCommit ||
    pullRequest.headCommit !== deliveryCommit
  ) throw new Error("PR_CREATION_FAILED");
}

class DeliveryEvidenceLedger {
  readonly entries: GitDeliveryLedgerEntry[] = [];

  append(entryType: string, sourceRecordType: string, sourceRecordId: string, payload: unknown, createdAt = new Date().toISOString()): void {
    const previousEntrySha256 = this.entries.at(-1)?.entrySha256 ?? null;
    const entry: GitDeliveryLedgerEntry = {
      id: randomUUID(),
      sequenceNumber: this.entries.length + 1,
      entryType,
      sourceRecordType,
      sourceRecordId,
      payloadSha256: sha256(canonicalJson(payload)),
      previousEntrySha256,
      entrySha256: "",
      createdAt,
    };
    entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
    this.entries.push(entry);
  }

  verify(): GitDeliveryLedgerVerification {
    let previous: string | null = null;
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index]!;
      if (
        entry.sequenceNumber !== index + 1 ||
        entry.previousEntrySha256 !== previous ||
        computeEvidenceLedgerEntryHash(entry) !== entry.entrySha256
      ) return { valid: false, entryCount: this.entries.length, chainSha256: previous };
      previous = entry.entrySha256;
    }
    return { valid: true, entryCount: this.entries.length, chainSha256: previous };
  }
}

function classifyFailure(error: unknown): GitDeliveryFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/PATCH_MISMATCH|BASE_MANIFEST_MISMATCH/i.test(message)) return "PATCH_MISMATCH";
  if (/REMOTE_COMMIT_MISMATCH|REMOTE_CHANGED|BASE_CHECKOUT_MISMATCH/i.test(message)) return "REMOTE_COMMIT_MISMATCH";
  if (/PR_CREATION_FAILED|PULL_REQUEST/i.test(message)) return "PR_CREATION_FAILED";
  if (/TEST_TAMPERING/i.test(message)) return "TEST_TAMPERING_DETECTED";
  if (/INDEPENDENT_VERIFICATION/i.test(message)) return "INDEPENDENT_VERIFICATION_FAILED";
  if (/CLEANUP/i.test(message)) return "CLEANUP_FAILED";
  if (/AI_|POLICY|FORBIDDEN/i.test(message)) return "POLICY_VIOLATION";
  return "DELIVERY_FAILED";
}

function safeFailureMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "[LOCAL_HOME]")
    .slice(0, 500);
}

function assertNoCredentialLeak(value: unknown): void {
  const text = JSON.stringify(value);
  if (/gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|C:\\Users\\/i.test(text)) {
    throw new Error("DELIVERY_CREDENTIAL_LEAK_DETECTED");
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function records(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value.map((entry, index) => record(entry, `${label}[${index}]`));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing`);
  return value;
}

function requiredCommit(value: unknown, label: string): string {
  const commit = requiredString(value, label).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error(`${label} is invalid`);
  return commit;
}

function requiredDigest(value: unknown, label: string): string {
  const digest = requiredString(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} is invalid`);
  return digest;
}

function requiredNonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} is invalid`);
  return number;
}

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
