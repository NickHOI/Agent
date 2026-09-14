import { canonicalJson, sha256Canonical } from "@donelayer/database";

export const BETA_GATE_3_CANONICAL_WORKFLOW = "BETA_GATE_3_MANAGED_REMOTE_EXECUTION" as const;
export const GATE_4A_EXTERNAL_REVIEW_WORKFLOW = "GATE_4A_EXTERNAL_REVIEW_EXPORT_BUNDLE_V1" as const;

export type CanonicalWorkflow =
  | typeof BETA_GATE_3_CANONICAL_WORKFLOW
  | typeof GATE_4A_EXTERNAL_REVIEW_WORKFLOW;

export type CanonicalWorkflowPolicy = {
  workflow: CanonicalWorkflow;
  workflowSource: string;
  executorType: "AI_GATEWAY";
  independentVerificationRequired: true;
  exactCommitRequired: true;
  exactTreeRequired: boolean;
  legacySourceResolution: boolean;
};

const WORKFLOW_POLICIES: Readonly<Record<CanonicalWorkflow, CanonicalWorkflowPolicy>> = Object.freeze({
  [BETA_GATE_3_CANONICAL_WORKFLOW]: Object.freeze({
    workflow: BETA_GATE_3_CANONICAL_WORKFLOW,
    workflowSource: "SERVER_REGISTRY:BETA_GATE_3_COMPATIBILITY_V1",
    executorType: "AI_GATEWAY",
    independentVerificationRequired: true,
    exactCommitRequired: true,
    exactTreeRequired: false,
    legacySourceResolution: true,
  }),
  [GATE_4A_EXTERNAL_REVIEW_WORKFLOW]: Object.freeze({
    workflow: GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
    workflowSource: "SERVER_REGISTRY:GATE_4A_EXTERNAL_REVIEW_EXPORT_BUNDLE_V1",
    executorType: "AI_GATEWAY",
    independentVerificationRequired: true,
    exactCommitRequired: true,
    exactTreeRequired: true,
    legacySourceResolution: false,
  }),
});

export type CanonicalSourceIdentity = {
  repository: string;
  commitSha: string;
  treeSha: string | null;
};

export type CanonicalExecutionLimits = {
  maxArtifactBytes: number;
  maxRuntimeSeconds: number;
  maxSandboxes: number;
  maxCommands: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxApiBudget: number;
};

export type CanonicalContractSnapshot = {
  id: string;
  workId: string;
  status: "DRAFT" | "LOCKED";
  sha256: string;
  workflow: string;
  source: CanonicalSourceIdentity;
  allowedFiles: string[];
  allowedActions: string[];
  allowedDomains: string[];
  limits: CanonicalExecutionLimits;
  networkPolicy: "deny-all";
  persistence: "none";
  deliveryOutcomePolicy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED";
};

export type CanonicalAuthoritySnapshot = {
  id: string;
  workId: string;
  contractId: string;
  decision: "APPROVED" | "DENIED";
  scopeSha256: string;
  allowedRepositories: string[];
  allowedCommitShas: string[];
  allowedTreeShas: string[];
  allowedFiles: string[];
  allowedActions: string[];
  allowedDomains: string[];
  allowedWorkflows: string[];
  limits: CanonicalExecutionLimits;
  networkPolicy: "deny-all";
  persistence: "none";
};

export type CanonicalExecutionPrecheckInput = {
  mode: "DRY_RUN" | "EXECUTE";
  actorAuthUserId: string | null;
  ownerAuthUserId: string;
  workId: string;
  contract: CanonicalContractSnapshot;
  authority: CanonicalAuthoritySnapshot;
  requestedContractSha256: string;
  requestedAuthorityId: string;
  requestedAuthorityScopeSha256: string;
  requestedSource: CanonicalSourceIdentity;
  requestedWorkflow: string;
  requestedFiles: string[];
};

export type CanonicalExecutionPrecheckPass = {
  result: "CANONICAL_EXECUTION_PRECHECK_PASS";
  mode: "DRY_RUN" | "EXECUTE";
  workflow: CanonicalWorkflow;
  workflowSource: string;
  envelopeSha256: string;
  jobCreated: false;
  modelRequests: 0;
  sandboxRuns: 0;
  corpusContribution: 0;
  reputationCalculations: 0;
};

export function canonicalWorkflowPolicy(value: string): CanonicalWorkflowPolicy {
  if (!isCanonicalWorkflow(value)) throw new Error("CANONICAL_WORKFLOW_UNSUPPORTED");
  return WORKFLOW_POLICIES[value];
}

export function supportedCanonicalWorkflows(): CanonicalWorkflow[] {
  return Object.keys(WORKFLOW_POLICIES) as CanonicalWorkflow[];
}

export function precheckVerifiedWorkExecution(
  input: CanonicalExecutionPrecheckInput,
): CanonicalExecutionPrecheckPass {
  if (!input.actorAuthUserId) throw new Error("CANONICAL_EXECUTION_AUTHENTICATION_REQUIRED");
  if (input.actorAuthUserId !== input.ownerAuthUserId) {
    throw new Error("CANONICAL_EXECUTION_OWNER_MISMATCH");
  }
  if (input.contract.workId !== input.workId) throw new Error("CANONICAL_CONTRACT_WORK_MISMATCH");
  if (input.mode === "EXECUTE" && input.contract.status !== "LOCKED") {
    throw new Error("CANONICAL_CONTRACT_NOT_LOCKED");
  }
  if (!isSha256(input.contract.sha256) || input.contract.sha256 !== input.requestedContractSha256) {
    throw new Error("CANONICAL_CONTRACT_HASH_MISMATCH");
  }
  if (
    input.authority.decision !== "APPROVED" ||
    input.authority.id !== input.requestedAuthorityId ||
    input.authority.workId !== input.workId ||
    input.authority.contractId !== input.contract.id
  ) throw new Error("CANONICAL_AUTHORITY_LINEAGE_MISMATCH");
  if (
    !isSha256(input.authority.scopeSha256) ||
    input.authority.scopeSha256 !== input.requestedAuthorityScopeSha256
  ) throw new Error("CANONICAL_AUTHORITY_HASH_MISMATCH");

  const policy = canonicalWorkflowPolicy(input.requestedWorkflow);
  if (
    input.contract.workflow !== policy.workflow ||
    !input.authority.allowedWorkflows.includes(policy.workflow)
  ) throw new Error("CANONICAL_WORKFLOW_MISMATCH");

  assertSourceIdentity(input.contract.source, policy);
  assertSourceIdentity(input.requestedSource, policy);
  if (canonicalJson(input.contract.source) !== canonicalJson(input.requestedSource)) {
    throw new Error("CANONICAL_SOURCE_MISMATCH");
  }
  if (
    !input.authority.allowedRepositories.includes(input.requestedSource.repository) ||
    !input.authority.allowedCommitShas.includes(input.requestedSource.commitSha) ||
    (policy.exactTreeRequired && !input.authority.allowedTreeShas.includes(input.requestedSource.treeSha!))
  ) throw new Error("CANONICAL_SOURCE_OUTSIDE_AUTHORITY");

  const contractFiles = normalizedFiles(input.contract.allowedFiles);
  const authorityFiles = normalizedFiles(input.authority.allowedFiles);
  const requestedFiles = normalizedFiles(input.requestedFiles);
  if (
    canonicalJson(contractFiles) !== canonicalJson(authorityFiles) ||
    canonicalJson(contractFiles) !== canonicalJson(requestedFiles)
  ) throw new Error("CANONICAL_FILE_SCOPE_MISMATCH");

  if (canonicalJson(normalizedStrings(input.contract.allowedActions)) !== canonicalJson(normalizedStrings(input.authority.allowedActions))) {
    throw new Error("CANONICAL_ACTION_SCOPE_MISMATCH");
  }
  if (canonicalJson(normalizedDomains(input.contract.allowedDomains)) !== canonicalJson(normalizedDomains(input.authority.allowedDomains))) {
    throw new Error("CANONICAL_NETWORK_SCOPE_MISMATCH");
  }
  if (
    input.contract.networkPolicy !== "deny-all" ||
    input.authority.networkPolicy !== input.contract.networkPolicy ||
    input.contract.persistence !== "none" ||
    input.authority.persistence !== input.contract.persistence
  ) throw new Error("CANONICAL_EXECUTION_POLICY_MISMATCH");
  assertLimits(input.contract.limits);
  assertLimits(input.authority.limits);
  if (canonicalJson(input.contract.limits) !== canonicalJson(input.authority.limits)) {
    throw new Error("CANONICAL_EXECUTION_LIMIT_MISMATCH");
  }
  if (input.contract.deliveryOutcomePolicy !== "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED") {
    throw new Error("CANONICAL_DELIVERY_POLICY_UNSUPPORTED");
  }

  const envelope = {
    schemaVersion: 1,
    bindingType: "CANONICAL_VERIFIED_WORK_EXECUTION_PRECHECK_V1",
    workId: input.workId,
    contract: { id: input.contract.id, sha256: input.contract.sha256 },
    authority: { id: input.authority.id, scopeSha256: input.authority.scopeSha256 },
    source: input.requestedSource,
    workflow: policy.workflow,
    workflowSource: policy.workflowSource,
    allowedFiles: contractFiles,
    allowedActions: normalizedStrings(input.contract.allowedActions),
    allowedDomains: normalizedDomains(input.contract.allowedDomains),
    limits: input.contract.limits,
    networkPolicy: input.contract.networkPolicy,
    persistence: input.contract.persistence,
    independentVerificationRequired: policy.independentVerificationRequired,
  };
  return {
    result: "CANONICAL_EXECUTION_PRECHECK_PASS",
    mode: input.mode,
    workflow: policy.workflow,
    workflowSource: policy.workflowSource,
    envelopeSha256: sha256Canonical(envelope),
    jobCreated: false,
    modelRequests: 0,
    sandboxRuns: 0,
    corpusContribution: 0,
    reputationCalculations: 0,
  };
}

function assertSourceIdentity(source: CanonicalSourceIdentity, policy: CanonicalWorkflowPolicy): void {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(source.repository)) {
    throw new Error("CANONICAL_SOURCE_REPOSITORY_INVALID");
  }
  if (!/^[a-f0-9]{40}$/.test(source.commitSha)) throw new Error("CANONICAL_SOURCE_COMMIT_INVALID");
  if (source.treeSha !== null && !/^[a-f0-9]{40}$/.test(source.treeSha)) {
    throw new Error("CANONICAL_SOURCE_TREE_INVALID");
  }
  if (policy.exactTreeRequired && source.treeSha === null) throw new Error("CANONICAL_SOURCE_TREE_REQUIRED");
}

function assertLimits(limits: CanonicalExecutionLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`CANONICAL_LIMIT_INVALID:${name}`);
  }
  if (
    limits.maxArtifactBytes < 1 ||
    limits.maxRuntimeSeconds < 1 ||
    limits.maxSandboxes < 1 ||
    limits.maxCommands < 1 ||
    limits.maxStdoutBytes < 1 ||
    limits.maxStderrBytes < 1
  ) throw new Error("CANONICAL_LIMIT_INVALID");
}

function normalizedFiles(files: string[]): string[] {
  const normalized = normalizedStrings(files);
  if (
    normalized.length < 1 ||
    normalized.some((file) => file.startsWith("/") || file.includes("\\") || file.split("/").includes(".."))
  ) throw new Error("CANONICAL_FILE_SCOPE_INVALID");
  return normalized;
}

function normalizedStrings(values: string[]): string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("CANONICAL_SCOPE_INVALID");
  }
  return [...new Set(values)].sort();
}

function normalizedDomains(values: string[]): string[] {
  const normalized = normalizedStrings(values.map((value) => value.toLowerCase()));
  if (normalized.some((value) => !/^[a-z0-9.-]+$/.test(value) || value.startsWith(".") || value.endsWith("."))) {
    throw new Error("CANONICAL_NETWORK_SCOPE_INVALID");
  }
  return normalized;
}

function isCanonicalWorkflow(value: string): value is CanonicalWorkflow {
  return Object.hasOwn(WORKFLOW_POLICIES, value);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
