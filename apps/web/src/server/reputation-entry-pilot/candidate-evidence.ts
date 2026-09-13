import { createHash, randomBytes, randomUUID } from "node:crypto";

import { canonicalJson, computeEvidenceLedgerEntryHash, sha256Canonical } from "@donelayer/database";

import {
  assertAgentIdentityProfileIntegrity,
  type AgentIdentityProfile,
} from "../agent-identity/agent-identity";
import {
  assertAgentExecutionBinding,
  assertReceiptIdentityBinding,
  type AgentExecutionIdentity,
} from "../agent-identity/execution-identity";
import type { AgentRepairToolCallEvidence } from "../agent-execution/repair-tools";
import type { AgentRunResult } from "../agent-execution/provider";
import type {
  RepairSandboxCleanup,
  RepairSandboxCommand,
  RepairSourceIntegrity,
} from "../agent-execution/vercel-agent-repair-sandbox";
import type { MaterializedSourcePackage } from "../managed-sandbox/repository-source";
import {
  assertAuthorityDecisionIntegrity,
  assertTaskScopedPermissionLeaseIntegrity,
  type TaskScopedAuthorityDecision,
  type TaskScopedAuthorityOperationEvidence,
  type TaskScopedPermissionLease,
} from "../task-scoped-authority/task-scoped-authority";
import {
  REPUTATION_ENTRY_CANDIDATE_STATUS,
  REPUTATION_ENTRY_PILOT,
  REPUTATION_ENTRY_REQUIRED_EVIDENCE,
  assertReputationEntryWorkContractIntegrity,
  type ReputationEntryTaskType,
  type ReputationEntryWorkContract,
} from "./work-contract";

export const REPUTATION_ENTRY_EVIDENCE_BUNDLE_TYPE = "REPUTATION_ENTRY_CANDIDATE_EVIDENCE_BUNDLE_V1" as const;
export const REPUTATION_ENTRY_RECEIPT_TYPE = "VERIFIED_JOB_RECEIPT_V1" as const;
export const REPUTATION_ENTRY_CANDIDATE_STATUS_SEMANTICS = "CANDIDATE_COLLECTION_WORKFLOW_MEMBERSHIP_ONLY" as const;

export type ReputationEntryResult = "VERIFIED" | "FAILED" | "INCONCLUSIVE";
export type ReputationEntryEvidenceKind = (typeof REPUTATION_ENTRY_REQUIRED_EVIDENCE)[number];

export function isVerifiedReputationEntryCandidateResult(result: ReputationEntryResult): boolean {
  return result === "VERIFIED";
}

export type ReputationEntryArtifact = {
  id: string;
  evidenceKind: ReputationEntryEvidenceKind;
  fileName: string;
  mimeType: "application/json" | "text/plain";
  size: number;
  sha256: string;
  content: string;
};

export type ReputationEntryLedgerEntry = {
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

export type ReputationEntryLedgerVerification = {
  valid: boolean;
  entryCount: number;
  chainSha256: string | null;
};

export type IndependentVerificationEvidence = {
  sandboxId: string;
  repairSandboxId: string;
  freshSandbox: boolean;
  baseline: RepairSandboxCommand;
  commands: RepairSandboxCommand[];
  oracleFiles: Array<{ path: string; expectedSha256: string; observedSha256: string; valid: boolean }>;
  patchSha256: string;
  matchesAgentPatch: boolean;
  sourceIntegrity: RepairSourceIntegrity;
  cleanup: RepairSandboxCleanup;
  verified: boolean;
};

export type ReputationEntryEvidenceBundle = {
  schemaVersion: 1;
  bundleType: typeof REPUTATION_ENTRY_EVIDENCE_BUNDLE_TYPE;
  candidateStatus: typeof REPUTATION_ENTRY_CANDIDATE_STATUS;
  jobId: string;
  taskType: ReputationEntryTaskType;
  result: ReputationEntryResult;
  uniqueness: {
    sourceCommitSha: string;
    defectClass: "STATE_TRANSITION_BEHAVIOR" | "TYPESCRIPT_BUILD_CONFIGURATION";
    oracleSha256: string;
    workContractSha256: string;
    authoritySha256: string;
    executionId: string;
  };
  identity: {
    agentId: string;
    profileRevision: number;
    profileSha256: string;
    executionId: string;
    executionSha256: string;
  };
  workContract: { id: string; version: number; sha256: string };
  authority: { leaseId: string; version: number; authoritySha256: string; terminalStatus: "REVOKED" };
  source: {
    remoteUrl: string;
    branch: string;
    commitSha: string;
    manifestSha256: string;
    sourcePackageSha256: string;
  };
  agentExecution: {
    runId: string;
    status: AgentRunResult["status"];
    modelId: string;
    apiRequestCount: number;
    toolCallCount: number;
    repairSandboxId: string;
  };
  independentVerification: {
    verifierSandboxId: string;
    freshSandbox: boolean;
    verified: boolean;
  };
  cleanup: {
    repairSandbox: boolean;
    verifierSandbox: boolean;
    snapshotsCreated: false;
  };
  credentialScan: { passed: true; artifactCount: number };
  projection: {
    required: ReputationEntryEvidenceKind[];
    satisfied: ReputationEntryEvidenceKind[];
    missing: ReputationEntryEvidenceKind[];
    complete: boolean;
  };
  evidence: Array<{ kind: ReputationEntryEvidenceKind; artifactId: string; sha256: string }>;
  createdAt: string;
  bundleSha256: string;
};

export type ReputationEntryReceiptDocument = {
  schemaVersion: 1;
  receiptType: typeof REPUTATION_ENTRY_RECEIPT_TYPE;
  gate: typeof REPUTATION_ENTRY_PILOT;
  publicReceiptId: string;
  candidateStatus: typeof REPUTATION_ENTRY_CANDIDATE_STATUS;
  result: ReputationEntryResult;
  canonicalQualification: {
    counted: false;
    requiresOwnerDefinitionAcceptance: true;
    requiresExplicitPromotion: true;
  };
  taskType: ReputationEntryTaskType;
  identity: {
    agent: AgentExecutionIdentity["agent"];
    executionId: string;
    executionSha256: string;
  };
  workContract: { id: string; version: number; sha256: string };
  authority: {
    leaseId: string;
    leaseVersion: number;
    authoritySha256: string;
    terminalStatus: "REVOKED";
    operationCount: number;
  };
  source: ReputationEntryEvidenceBundle["source"];
  execution: {
    backend: "MANAGED_REMOTE_SANDBOX";
    sandboxProvider: "VERCEL_SANDBOX";
    agentSandboxId: string;
    verifierSandboxId: string;
    independentVerifier: true;
    localHostExecutionUsed: false;
    localDockerUsed: false;
    networkPolicy: "deny-all";
  };
  evidenceBundle: {
    bundleType: typeof REPUTATION_ENTRY_EVIDENCE_BUNDLE_TYPE;
    bundleSha256: string;
    complete: boolean;
  };
  modelUsage: AgentRunResult["usage"];
  cleanup: ReputationEntryEvidenceBundle["cleanup"];
  externalEffects: {
    fixtureBranchRead: true;
    pullRequestCreated: false;
    mergePerformed: false;
    deploymentPerformed: false;
    paymentPerformed: false;
    blockchainWritePerformed: false;
  };
  evidenceLedger: ReputationEntryLedgerVerification;
  issuedAt: string;
};

export type ReputationEntryCandidateJob = {
  jobId: string;
  candidateStatus: typeof REPUTATION_ENTRY_CANDIDATE_STATUS;
  result: ReputationEntryResult;
  agentProfile: AgentIdentityProfile;
  contract: ReputationEntryWorkContract;
  authorityDecision: TaskScopedAuthorityDecision;
  issuedLease: TaskScopedPermissionLease;
  terminalLease: TaskScopedPermissionLease & { status: "REVOKED" };
  executionIdentity: AgentExecutionIdentity;
  source: MaterializedSourcePackage;
  agentRun: AgentRunResult;
  toolCalls: AgentRepairToolCallEvidence[];
  authorityOperations: TaskScopedAuthorityOperationEvidence[];
  patch: { patch: string; sha256: string; modifiedFiles: string[] };
  repairSourceIntegrity: RepairSourceIntegrity;
  repairSandbox: { sandboxId: string; baseline: RepairSandboxCommand; cleanup: RepairSandboxCleanup };
  independentVerification: IndependentVerificationEvidence;
  artifacts: ReputationEntryArtifact[];
  evidenceBundle: ReputationEntryEvidenceBundle;
  ledgerEntries: ReputationEntryLedgerEntry[];
  ledgerVerification: ReputationEntryLedgerVerification;
  receipt: {
    id: string;
    publicReceiptId: string;
    result: ReputationEntryResult;
    receiptSha256: string;
    evidenceChainSha256: string;
    document: ReputationEntryReceiptDocument;
  };
};

const BUNDLE_REQUIRED = REPUTATION_ENTRY_REQUIRED_EVIDENCE.filter(
  (kind) => kind !== "EVIDENCE_LEDGER" && kind !== "VERIFIED_JOB_RECEIPT",
);

export function createReputationEntryArtifact(
  evidenceKind: ReputationEntryEvidenceKind,
  fileName: string,
  payload: unknown,
  mimeType: ReputationEntryArtifact["mimeType"] = "application/json",
): ReputationEntryArtifact {
  const content = typeof payload === "string" ? payload : `${JSON.stringify(payload, null, 2)}\n`;
  return {
    id: randomUUID(),
    evidenceKind,
    fileName,
    mimeType,
    size: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
    content,
  };
}

export function createReputationEntryEvidenceBundle(input: {
  jobId: string;
  result: ReputationEntryResult;
  contract: ReputationEntryWorkContract;
  profile: AgentIdentityProfile;
  execution: AgentExecutionIdentity;
  terminalLease: TaskScopedPermissionLease & { status: "REVOKED" };
  source: MaterializedSourcePackage;
  agentRun: AgentRunResult;
  toolCalls: AgentRepairToolCallEvidence[];
  repairSandboxId: string;
  independentVerification: IndependentVerificationEvidence;
  repairCleanup: RepairSandboxCleanup;
  artifacts: ReputationEntryArtifact[];
  createdAt?: string;
}): ReputationEntryEvidenceBundle {
  const kinds = new Set(input.artifacts.map((artifact) => artifact.evidenceKind));
  const required = [...BUNDLE_REQUIRED];
  const satisfied = required.filter((kind) => kinds.has(kind));
  const missing = required.filter((kind) => !kinds.has(kind));
  const oracleSha256 = sha256Canonical(input.contract.acceptanceCriteria.protectedOracleFiles);
  const body: Omit<ReputationEntryEvidenceBundle, "bundleSha256"> = {
    schemaVersion: 1,
    bundleType: REPUTATION_ENTRY_EVIDENCE_BUNDLE_TYPE,
    candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
    jobId: input.jobId,
    taskType: input.contract.taskType,
    result: input.result,
    uniqueness: {
      sourceCommitSha: input.contract.commitSha,
      defectClass: input.contract.taskType === "TEST_AND_FIX" ? "STATE_TRANSITION_BEHAVIOR" : "TYPESCRIPT_BUILD_CONFIGURATION",
      oracleSha256,
      workContractSha256: input.contract.workContractSha256,
      authoritySha256: input.terminalLease.authoritySha256,
      executionId: input.execution.executionId,
    },
    identity: {
      agentId: input.profile.agentId,
      profileRevision: input.profile.revision,
      profileSha256: input.profile.profileSha256,
      executionId: input.execution.executionId,
      executionSha256: input.execution.executionSha256,
    },
    workContract: {
      id: input.contract.taskId,
      version: input.contract.contractVersion,
      sha256: input.contract.workContractSha256,
    },
    authority: {
      leaseId: input.terminalLease.id,
      version: input.terminalLease.version,
      authoritySha256: input.terminalLease.authoritySha256,
      terminalStatus: "REVOKED",
    },
    source: {
      remoteUrl: input.source.identity.remoteUrl,
      branch: input.source.identity.branch,
      commitSha: input.source.identity.commitSha,
      manifestSha256: input.source.repositoryManifestSha256,
      sourcePackageSha256: input.source.sourcePackageSha256,
    },
    agentExecution: {
      runId: input.agentRun.runId,
      status: input.agentRun.status,
      modelId: input.agentRun.model.id,
      apiRequestCount: input.agentRun.usage.apiRequestCount,
      toolCallCount: input.toolCalls.length,
      repairSandboxId: input.repairSandboxId,
    },
    independentVerification: {
      verifierSandboxId: input.independentVerification.sandboxId,
      freshSandbox: input.independentVerification.freshSandbox,
      verified: input.independentVerification.verified,
    },
    cleanup: {
      repairSandbox: input.repairCleanup.cleanupVerified,
      verifierSandbox: input.independentVerification.cleanup.cleanupVerified,
      snapshotsCreated: false,
    },
    credentialScan: { passed: true, artifactCount: input.artifacts.length },
    projection: { required, satisfied, missing, complete: missing.length === 0 },
    evidence: input.artifacts
      .map((artifact) => ({ kind: artifact.evidenceKind, artifactId: artifact.id, sha256: artifact.sha256 }))
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const bundle = { ...body, bundleSha256: sha256Canonical(body) };
  assertReputationEntryEvidenceBundleIntegrity(bundle, input.artifacts);
  return bundle;
}

export function assertReputationEntryEvidenceBundleIntegrity(
  bundle: ReputationEntryEvidenceBundle,
  artifacts: ReputationEntryArtifact[],
): void {
  const { bundleSha256, ...body } = bundle;
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  if (
    bundle.schemaVersion !== 1 ||
    bundle.bundleType !== REPUTATION_ENTRY_EVIDENCE_BUNDLE_TYPE ||
    bundle.candidateStatus !== REPUTATION_ENTRY_CANDIDATE_STATUS ||
    sha256Canonical(body) !== bundleSha256 ||
    !bundle.projection.complete ||
    bundle.projection.missing.length !== 0 ||
    bundle.cleanup.repairSandbox !== true ||
    bundle.cleanup.verifierSandbox !== true ||
    bundle.cleanup.snapshotsCreated !== false ||
    bundle.independentVerification.freshSandbox !== true ||
    bundle.evidence.some((reference) => artifactById.get(reference.artifactId)?.sha256 !== reference.sha256) ||
    artifacts.some((artifact) => artifact.size !== Buffer.byteLength(artifact.content, "utf8") || artifact.sha256 !== sha256(artifact.content))
  ) throw new Error("REPUTATION_ENTRY_EVIDENCE_BUNDLE_TAMPERING_DETECTED");
}

export function appendReputationEntryLedger(
  entries: ReputationEntryLedgerEntry[],
  input: { entryType: string; sourceRecordType: string; sourceRecordId: string; payload: unknown; createdAt?: string },
): ReputationEntryLedgerEntry {
  const body = {
    id: randomUUID(),
    sequenceNumber: entries.length + 1,
    entryType: input.entryType,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: input.sourceRecordId,
    payloadSha256: sha256(canonicalJson(input.payload)),
    previousEntrySha256: entries.at(-1)?.entrySha256 ?? null,
    entrySha256: "",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  body.entrySha256 = computeEvidenceLedgerEntryHash(body);
  entries.push(body);
  return body;
}

export function verifyReputationEntryLedger(entries: ReputationEntryLedgerEntry[]): ReputationEntryLedgerVerification {
  let previous: string | null = null;
  for (const [index, entry] of entries.entries()) {
    if (
      entry.sequenceNumber !== index + 1 ||
      entry.previousEntrySha256 !== previous ||
      computeEvidenceLedgerEntryHash(entry) !== entry.entrySha256
    ) return { valid: false, entryCount: entries.length, chainSha256: previous };
    previous = entry.entrySha256;
  }
  return { valid: true, entryCount: entries.length, chainSha256: previous };
}

export function createReputationEntryReceipt(input: {
  result: ReputationEntryResult;
  contract: ReputationEntryWorkContract;
  execution: AgentExecutionIdentity;
  terminalLease: TaskScopedPermissionLease & { status: "REVOKED" };
  authorityOperations: TaskScopedAuthorityOperationEvidence[];
  bundle: ReputationEntryEvidenceBundle;
  agentRun: AgentRunResult;
  preReceiptLedger: ReputationEntryLedgerVerification;
  issuedAt?: string;
}): ReputationEntryCandidateJob["receipt"] {
  if (!input.preReceiptLedger.valid || !input.preReceiptLedger.chainSha256) throw new Error("REPUTATION_ENTRY_LEDGER_INVALID");
  const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
  const document: ReputationEntryReceiptDocument = {
    schemaVersion: 1,
    receiptType: REPUTATION_ENTRY_RECEIPT_TYPE,
    gate: REPUTATION_ENTRY_PILOT,
    publicReceiptId,
    candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
    result: input.result,
    canonicalQualification: {
      counted: false,
      requiresOwnerDefinitionAcceptance: true,
      requiresExplicitPromotion: true,
    },
    taskType: input.contract.taskType,
    identity: {
      agent: structuredClone(input.execution.agent),
      executionId: input.execution.executionId,
      executionSha256: input.execution.executionSha256,
    },
    workContract: {
      id: input.contract.taskId,
      version: input.contract.contractVersion,
      sha256: input.contract.workContractSha256,
    },
    authority: {
      leaseId: input.terminalLease.id,
      leaseVersion: input.terminalLease.version,
      authoritySha256: input.terminalLease.authoritySha256,
      terminalStatus: "REVOKED",
      operationCount: input.authorityOperations.length,
    },
    source: structuredClone(input.bundle.source),
    execution: {
      backend: "MANAGED_REMOTE_SANDBOX",
      sandboxProvider: "VERCEL_SANDBOX",
      agentSandboxId: input.bundle.agentExecution.repairSandboxId,
      verifierSandboxId: input.bundle.independentVerification.verifierSandboxId,
      independentVerifier: true,
      localHostExecutionUsed: false,
      localDockerUsed: false,
      networkPolicy: "deny-all",
    },
    evidenceBundle: {
      bundleType: REPUTATION_ENTRY_EVIDENCE_BUNDLE_TYPE,
      bundleSha256: input.bundle.bundleSha256,
      complete: input.bundle.projection.complete,
    },
    modelUsage: structuredClone(input.agentRun.usage),
    cleanup: structuredClone(input.bundle.cleanup),
    externalEffects: {
      fixtureBranchRead: true,
      pullRequestCreated: false,
      mergePerformed: false,
      deploymentPerformed: false,
      paymentPerformed: false,
      blockchainWritePerformed: false,
    },
    evidenceLedger: input.preReceiptLedger,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
  const receiptSha256 = sha256(canonicalJson(document));
  return {
    id: randomUUID(),
    publicReceiptId,
    result: input.result,
    receiptSha256,
    evidenceChainSha256: input.preReceiptLedger.chainSha256,
    document,
  };
}

export function assertReputationEntryCandidateJobIntegrity(job: ReputationEntryCandidateJob): void {
  assertAgentIdentityProfileIntegrity(job.agentProfile);
  assertReputationEntryWorkContractIntegrity(job.contract);
  assertAuthorityDecisionIntegrity(job.authorityDecision);
  assertTaskScopedPermissionLeaseIntegrity(job.issuedLease);
  assertTaskScopedPermissionLeaseIntegrity(job.terminalLease);
  assertAgentExecutionBinding({ execution: job.executionIdentity, contract: job.contract, authorityLease: job.issuedLease });
  assertReceiptIdentityBinding({ receiptBinding: job.receipt.document.identity, execution: job.executionIdentity });
  assertReputationEntryEvidenceBundleIntegrity(job.evidenceBundle, job.artifacts);
  const finalLedger = verifyReputationEntryLedger(job.ledgerEntries);
  const receiptEntry = job.ledgerEntries.at(-1);
  if (
    job.candidateStatus !== REPUTATION_ENTRY_CANDIDATE_STATUS ||
    job.terminalLease.status !== "REVOKED" ||
    job.receipt.document.canonicalQualification.counted !== false ||
    sha256(canonicalJson(job.receipt.document)) !== job.receipt.receiptSha256 ||
    !finalLedger.valid ||
    finalLedger.chainSha256 !== job.ledgerVerification.chainSha256 ||
    receiptEntry?.entryType !== "RECEIPT_CREATED" ||
    receiptEntry.previousEntrySha256 !== job.receipt.evidenceChainSha256 ||
    receiptEntry.payloadSha256 !== sha256(canonicalJson({
      receiptSha256: job.receipt.receiptSha256,
      evidenceBundleSha256: job.evidenceBundle.bundleSha256,
      evidenceChainSha256: job.receipt.evidenceChainSha256,
    })) ||
    job.repairSandbox.sandboxId === job.independentVerification.sandboxId ||
    !job.repairSandbox.cleanup.cleanupVerified ||
    !job.independentVerification.cleanup.cleanupVerified ||
    job.receipt.document.externalEffects.pullRequestCreated ||
    job.receipt.document.externalEffects.mergePerformed ||
    job.receipt.document.externalEffects.deploymentPerformed ||
    job.receipt.document.externalEffects.paymentPerformed ||
    job.receipt.document.externalEffects.blockchainWritePerformed
  ) throw new Error("REPUTATION_ENTRY_CANDIDATE_JOB_TAMPERING_DETECTED");
}

export function reputationEntrySecretPattern(): RegExp {
  return /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\/i;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
