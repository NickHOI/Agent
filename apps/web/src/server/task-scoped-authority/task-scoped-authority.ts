import { randomUUID } from "node:crypto";

import { canonicalJson, sha256Canonical } from "@donelayer/database";
import {
  MANAGED_SANDBOX_EXECUTION_BACKEND,
  MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN,
  MANAGED_SANDBOX_PROVIDER,
  PermissionGuard,
  permissionScopeSchema,
  type PermissionLeaseEnvelope,
  type PermissionScope,
} from "@donelayer/worker-protocol";

import {
  assertSemanticContractIntegrity,
  type SemanticTaskContract,
} from "../semantic-verification/semantic-contract";
import {
  assertAgentIdentityReference,
  type AgentIdentityReference,
} from "../agent-identity/agent-identity";
import {
  assertVerifiedDeliveryOutcomePolicy,
  type VerifiedDeliveryOutcomePolicyV1,
} from "../verified-delivery-outcome/policy";

export const TASK_SCOPED_AUTHORITY_GATE = "TASK_SCOPED_AGENT_AUTHORITY_V1_DESIGN_AND_EVIDENCE_GATE" as const;
export const TASK_SCOPED_AUTHORITY_TYPE = "TASK_SCOPED_AUTHORITY_V1" as const;
export const TASK_SCOPED_AUTHORITY_ISSUER = "DONE_LAYER_SERVER" as const;
export const TASK_SCOPED_AUTHORITY_DELIVERY_PREFIX = "donelayer/repair/" as const;
export const TASK_SCOPED_AUTHORITY_AGENT_ID = "vercel-ai-gateway-agent" as const;
export const TASK_SCOPED_AUTHORITY_EXECUTOR_ID = "done-layer-server-side-orchestrator" as const;

const MAX_AUTHORITY_DURATION_SECONDS = 600;
const TASK_SCOPED_ALLOWED_FILES = ["src/add.ts"] as const;
const TASK_SCOPED_UNSUPPORTED_ENFORCEMENT = [
  "ARBITRARY_CUSTOMER_REPOSITORIES",
  "DATABASE_ROW_OR_COLUMN_POLICY",
  "EXTERNAL_SERVICE_SECRET_BROKER",
  "MODEL_PROVIDER_REQUEST_BUDGET_ENFORCEMENT",
  "ORGANIZATION_DELEGATION",
  "PRODUCTION_CREDENTIAL_MINTING",
  "PRODUCTION_DEPLOYMENT_EXECUTION",
] as const;

export type TaskScopedWorkContract = {
  schemaVersion: number;
  contractVersion: number;
  contractType: string;
  status: "LOCKED";
  taskId: string;
  assignedAgent?: AgentIdentityReference;
  remoteUrl: string;
  branch: string;
  commitSha: string;
  permissionPolicy: {
    allowedActions: string[];
    forbiddenActions: string[];
  };
  authorityPolicy?: {
    allowedFiles: string[];
    allowedWorkflows: string[];
    mutationAction: string;
    verificationAction: string;
    maxSandboxes: number;
    maxCommands: number;
  };
  deliveryOutcomePolicy?: VerifiedDeliveryOutcomePolicyV1;
  workContractSha256: string;
};

export type TaskScopedAuthoritySubject = {
  agentId: string;
  executorId: string;
  jobRunId: string;
  agentIdentity?: AgentIdentityReference;
  executionId?: string;
};

export type TaskScopedAuthorityApproval = {
  action: "create_pull_request";
  decisionId: string;
  approverType: "OWNER";
  approverId: string;
  approvedAt: string;
};

export type TaskScopedAuthorityDecision = {
  schemaVersion: 1;
  decisionType: "TASK_SCOPED_AUTHORITY_DECISION_V1";
  decisionId: string;
  decision: "APPROVED" | "DENIED";
  workContract: {
    id: string;
    version: number;
    sha256: string;
  };
  requestedBy: {
    actorType: "PLATFORM" | "AGENT";
    actorId: string;
  };
  decidedBy: {
    actorType: "PLATFORM";
    actorId: typeof TASK_SCOPED_AUTHORITY_ISSUER;
  };
  subject: TaskScopedAuthoritySubject;
  requestedScope: PermissionScope;
  requestedScopeSha256: string;
  durationSeconds: number;
  approvals: TaskScopedAuthorityApproval[];
  reasons: string[];
  decidedAt: string;
  decisionSha256: string;
};

export type TaskScopedPermissionLeaseStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "VIOLATED" | "COMPLETED";

export type TaskScopedPermissionLease = Omit<PermissionLeaseEnvelope, "status"> & {
  status: TaskScopedPermissionLeaseStatus;
  authorityType: typeof TASK_SCOPED_AUTHORITY_TYPE;
  authority: {
    workContract: TaskScopedAuthorityDecision["workContract"];
    issuer: TaskScopedAuthorityDecision["decidedBy"];
    subject: TaskScopedAuthoritySubject;
    resources: {
      repository: string;
      baseRef: string;
      baseCommitSha: string;
      deliveryBranchPrefix: typeof TASK_SCOPED_AUTHORITY_DELIVERY_PREFIX;
      allowedFiles: string[];
      sandboxProviders: string[];
      executionBackends: string[];
    };
    approvalPolicy: {
      requiredActions: Array<"create_pull_request">;
      grants: TaskScopedAuthorityApproval[];
    };
    unsupportedEnforcement: string[];
    decisionId: string;
    decisionSha256: string;
  };
  authoritySha256: string;
  revokedAt: string | null;
  revocationReason: string | null;
};

export type TaskScopedAuthorityOperationEvidence = {
  sequence: number;
  operation: string;
  action: string;
  decision: "ALLOWED" | "DENIED";
  resource: string | null;
  reason: string;
  authoritySha256: string;
  recordedAt: string;
};

export function taskScopedAuthorityScope(contract: TaskScopedWorkContract): PermissionScope {
  assertTaskScopedWorkContractIntegrity(contract);
  const policy = resolvedAuthorityPolicy(contract);
  return permissionScopeSchema.parse({
    allowedActions: [...contract.permissionPolicy.allowedActions],
    deniedActions: [...contract.permissionPolicy.forbiddenActions],
    allowedPaths: ["$JOB_WORKSPACE"],
    allowedDomains: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN],
    allowedRepositories: [contract.remoteUrl],
    allowedBranches: [contract.branch],
    allowedCommitShas: [contract.commitSha],
    allowedSandboxProviders: [MANAGED_SANDBOX_PROVIDER],
    allowedExecutionBackends: [MANAGED_SANDBOX_EXECUTION_BACKEND],
    allowedWorkflows: policy.allowedWorkflows,
    allowedFiles: policy.allowedFiles,
    allowedEnvironmentVariables: ["DONELAYER_JOB_ID", "DONELAYER_SANDBOX_RUN_ID"],
    maxArtifactBytes: 2 * 1024 * 1024,
    maxRuntimeSeconds: MAX_AUTHORITY_DURATION_SECONDS,
    maxApiBudget: 0,
    maxSandboxes: policy.maxSandboxes,
    maxCommands: policy.maxCommands,
    maxStdoutBytes: 256 * 1024,
    maxStderrBytes: 256 * 1024,
    networkPolicy: "deny-all",
    persistence: "none",
    humanApprovalActions: ["create_pull_request"],
  });
}

export function decideTaskScopedAuthority(input: {
  contract: TaskScopedWorkContract;
  subject: TaskScopedAuthoritySubject;
  requestedBy?: TaskScopedAuthorityDecision["requestedBy"];
  requestedScope?: PermissionScope;
  durationSeconds?: number;
  approvals?: TaskScopedAuthorityApproval[];
  decidedAt?: string;
}): TaskScopedAuthorityDecision {
  assertTaskScopedWorkContractIntegrity(input.contract);
  const decidedAt = validTimestamp(input.decidedAt ?? new Date().toISOString(), "Authority decision time");
  const requestedBy = input.requestedBy ?? { actorType: "PLATFORM" as const, actorId: TASK_SCOPED_AUTHORITY_ISSUER };
  const requestedScope = permissionScopeSchema.parse(input.requestedScope ?? taskScopedAuthorityScope(input.contract));
  const durationSeconds = input.durationSeconds ?? MAX_AUTHORITY_DURATION_SECONDS;
  const approvals = [...(input.approvals ?? [])].sort((left, right) => left.decisionId.localeCompare(right.decisionId));
  const reasons = authorityDecisionReasons({
    contract: input.contract,
    subject: input.subject,
    requestedBy,
    requestedScope,
    durationSeconds,
    approvals,
  });
  const body: Omit<TaskScopedAuthorityDecision, "decisionSha256"> = {
    schemaVersion: 1,
    decisionType: "TASK_SCOPED_AUTHORITY_DECISION_V1",
    decisionId: randomUUID(),
    decision: reasons.length === 0 ? "APPROVED" : "DENIED",
    workContract: workContractReference(input.contract),
    requestedBy,
    decidedBy: { actorType: "PLATFORM", actorId: TASK_SCOPED_AUTHORITY_ISSUER },
    subject: validSubject(input.subject),
    requestedScope,
    requestedScopeSha256: sha256Canonical(requestedScope),
    durationSeconds,
    approvals,
    reasons,
    decidedAt,
  };
  return { ...body, decisionSha256: sha256Canonical(body) };
}

export function issueTaskScopedPermissionLease(
  decision: TaskScopedAuthorityDecision,
): TaskScopedPermissionLease {
  assertAuthorityDecisionIntegrity(decision);
  if (decision.decision !== "APPROVED") throw new Error("TASK_SCOPED_AUTHORITY_DECISION_DENIED");
  const startsAt = decision.decidedAt;
  const expiresAt = new Date(Date.parse(startsAt) + decision.durationSeconds * 1_000).toISOString();
  const leaseWithoutHash: Omit<TaskScopedPermissionLease, "authoritySha256"> = {
    id: randomUUID(),
    version: 1,
    status: "ACTIVE",
    startsAt,
    expiresAt,
    scope: decision.requestedScope,
    authorityType: TASK_SCOPED_AUTHORITY_TYPE,
    authority: {
      workContract: decision.workContract,
      issuer: decision.decidedBy,
      subject: decision.subject,
      resources: {
        repository: decision.requestedScope.allowedRepositories![0]!,
        baseRef: decision.requestedScope.allowedBranches![0]!,
        baseCommitSha: decision.requestedScope.allowedCommitShas![0]!,
        deliveryBranchPrefix: TASK_SCOPED_AUTHORITY_DELIVERY_PREFIX,
        allowedFiles: [...(decision.requestedScope.allowedFiles ?? [])],
        sandboxProviders: [...(decision.requestedScope.allowedSandboxProviders ?? [])],
        executionBackends: [...(decision.requestedScope.allowedExecutionBackends ?? [])],
      },
      approvalPolicy: {
        requiredActions: ["create_pull_request"],
        grants: decision.approvals,
      },
      unsupportedEnforcement: [...TASK_SCOPED_UNSUPPORTED_ENFORCEMENT],
      decisionId: decision.decisionId,
      decisionSha256: decision.decisionSha256,
    },
    revokedAt: null,
    revocationReason: null,
  };
  const lease = { ...leaseWithoutHash, authoritySha256: authoritySha256(leaseWithoutHash) };
  assertTaskScopedPermissionLeaseIntegrity(lease);
  return lease;
}

export function revokeTaskScopedPermissionLease(input: {
  lease: TaskScopedPermissionLease;
  revokedBy: typeof TASK_SCOPED_AUTHORITY_ISSUER;
  reason: string;
  revokedAt?: string;
}): TaskScopedPermissionLease & { status: "REVOKED" } {
  assertTaskScopedPermissionLeaseIntegrity(input.lease);
  if (input.lease.status !== "ACTIVE") throw new Error("TASK_SCOPED_AUTHORITY_TERMINAL");
  if (input.revokedBy !== TASK_SCOPED_AUTHORITY_ISSUER) throw new Error("TASK_SCOPED_AUTHORITY_ISSUER_INVALID");
  const reason = requiredText(input.reason, "Revocation reason");
  const revokedAt = validTimestamp(input.revokedAt ?? new Date().toISOString(), "Revocation time");
  if (Date.parse(revokedAt) < Date.parse(input.lease.startsAt)) throw new Error("TASK_SCOPED_AUTHORITY_REVOCATION_TIME_INVALID");
  const revoked = { ...input.lease, status: "REVOKED" as const, revokedAt, revocationReason: reason };
  assertTaskScopedPermissionLeaseIntegrity(revoked);
  return revoked;
}

export function completeTaskScopedPermissionLease(
  lease: TaskScopedPermissionLease,
): TaskScopedPermissionLease & { status: "COMPLETED" } {
  assertTaskScopedPermissionLeaseIntegrity(lease);
  if (lease.status !== "ACTIVE") throw new Error("TASK_SCOPED_AUTHORITY_TERMINAL");
  const completed = { ...lease, status: "COMPLETED" as const };
  assertTaskScopedPermissionLeaseIntegrity(completed);
  return completed;
}

export function assertAuthorityDecisionIntegrity(decision: TaskScopedAuthorityDecision): void {
  const { decisionSha256, ...body } = decision;
  if (
    decision.schemaVersion !== 1 ||
    decision.decisionType !== "TASK_SCOPED_AUTHORITY_DECISION_V1" ||
    !/^[a-f0-9]{64}$/.test(decision.requestedScopeSha256) ||
    decision.requestedScopeSha256 !== sha256Canonical(decision.requestedScope) ||
    decision.decidedBy.actorId !== TASK_SCOPED_AUTHORITY_ISSUER ||
    decision.decision !== (decision.reasons.length === 0 ? "APPROVED" : "DENIED") ||
    sha256Canonical(body) !== decisionSha256
  ) throw new Error("TASK_SCOPED_AUTHORITY_DECISION_TAMPERING_DETECTED");
  permissionScopeSchema.parse(decision.requestedScope);
  validSubject(decision.subject);
  validTimestamp(decision.decidedAt, "Authority decision time");
}

export function assertTaskScopedPermissionLeaseIntegrity(lease: TaskScopedPermissionLease): void {
  if (
    lease.authorityType !== TASK_SCOPED_AUTHORITY_TYPE ||
    lease.version !== 1 ||
    !["ACTIVE", "EXPIRED", "REVOKED", "VIOLATED", "COMPLETED"].includes(lease.status) ||
    !Number.isFinite(Date.parse(lease.startsAt)) ||
    !Number.isFinite(Date.parse(lease.expiresAt)) ||
    Date.parse(lease.expiresAt) <= Date.parse(lease.startsAt) ||
    lease.authority.issuer.actorId !== TASK_SCOPED_AUTHORITY_ISSUER ||
    lease.authority.resources.repository !== lease.scope.allowedRepositories?.[0] ||
    lease.authority.resources.baseRef !== lease.scope.allowedBranches?.[0] ||
    lease.authority.resources.baseCommitSha !== lease.scope.allowedCommitShas?.[0] ||
    canonicalJson(lease.authority.resources.allowedFiles) !== canonicalJson(lease.scope.allowedFiles) ||
    canonicalJson(lease.authority.resources.sandboxProviders) !== canonicalJson(lease.scope.allowedSandboxProviders) ||
    canonicalJson(lease.authority.resources.executionBackends) !== canonicalJson(lease.scope.allowedExecutionBackends) ||
    authoritySha256(lease) !== lease.authoritySha256 ||
    (lease.status === "REVOKED" && (!lease.revokedAt || !lease.revocationReason)) ||
    (lease.status !== "REVOKED" && (lease.revokedAt !== null || lease.revocationReason !== null))
  ) throw new Error("TASK_SCOPED_AUTHORITY_LEASE_TAMPERING_DETECTED");
  permissionScopeSchema.parse(lease.scope);
  validSubject(lease.authority.subject);
}

export class TaskScopedAuthorityGuard extends PermissionGuard {
  private sequence = 0;
  private sandboxesAuthorized: number;

  constructor(
    readonly authorityLease: TaskScopedPermissionLease,
    input: {
      contract: TaskScopedWorkContract;
      subject: TaskScopedAuthoritySubject;
      alreadyUsedSandboxCount?: number;
      onDecision?: (evidence: TaskScopedAuthorityOperationEvidence) => void;
    },
  ) {
    assertTaskScopedPermissionLeaseIntegrity(authorityLease);
    assertTaskScopedWorkContractIntegrity(input.contract);
    const policy = resolvedAuthorityPolicy(input.contract);
    const expectedContract = workContractReference(input.contract);
    const contractScopeReasons = authorityDecisionReasons({
      contract: input.contract,
      subject: input.subject,
      requestedBy: { actorType: "PLATFORM", actorId: TASK_SCOPED_AUTHORITY_ISSUER },
      requestedScope: authorityLease.scope,
      durationSeconds: Math.floor((Date.parse(authorityLease.expiresAt) - Date.parse(authorityLease.startsAt)) / 1_000),
      approvals: authorityLease.authority.approvalPolicy.grants,
    });
    if (
      canonicalJson(authorityLease.authority.workContract) !== canonicalJson(expectedContract) ||
      canonicalJson(authorityLease.authority.subject) !== canonicalJson(validSubject(input.subject)) ||
      contractScopeReasons.length > 0
    ) throw new Error("TASK_SCOPED_AUTHORITY_BINDING_MISMATCH");
    super(authorityLease as PermissionLeaseEnvelope);
    const alreadyUsedSandboxCount = input.alreadyUsedSandboxCount ?? 0;
    if (!Number.isSafeInteger(alreadyUsedSandboxCount) || alreadyUsedSandboxCount < 0) {
      throw new Error("TASK_SCOPED_AUTHORITY_SANDBOX_USAGE_INVALID");
    }
    this.sandboxesAuthorized = alreadyUsedSandboxCount;
    this.mutationAction = policy.mutationAction;
    this.verificationAction = policy.verificationAction;
    this.onDecision = input.onDecision;
  }

  private readonly onDecision: ((evidence: TaskScopedAuthorityOperationEvidence) => void) | undefined;
  private readonly mutationAction: string;
  private readonly verificationAction: string;

  assertRepositoryReadAllowed(input: { remoteUrl: string; baseRef: string; commitSha: string }, at = new Date()): void {
    this.check("repository-read", "read_source", `${input.remoteUrl}#${input.baseRef}@${input.commitSha}`, at, () => {
      super.assertRepositoryAllowed(input.remoteUrl, input.baseRef, at);
      if (!this.authorityLease.scope.allowedCommitShas?.includes(input.commitSha)) {
        throw this.recordViolation("read_source", "Commit is not allowed by this Permission Lease", input.commitSha);
      }
    });
  }

  assertDeliveryBranchAllowed(branch: string, at = new Date()): void {
    this.check("delivery-branch-create", "create_delivery_branch", branch, at, () => {
      const prefix = this.authorityLease.authority.resources.deliveryBranchPrefix;
      if (!branch.startsWith(prefix) || branch.length <= prefix.length || !/^donelayer\/repair\/[a-z0-9](?:[a-z0-9-]{0,62})$/.test(branch)) {
        throw this.recordViolation("create_delivery_branch", "Delivery branch is outside the granted namespace", branch);
      }
    });
  }

  assertPatchAllowed(files: string[], at = new Date()): void {
    const normalized = [...new Set(files)].sort();
    this.check("source-patch", "create_patch", normalized.join(","), at, () => {
      super.assertActionAllowed(this.mutationAction, at);
      if (
        normalized.length < 1 ||
        normalized.some((filePath) => !safeRepositoryPath(filePath) || !this.authorityLease.scope.allowedFiles?.includes(filePath))
      ) throw this.recordViolation("create_patch", "Patch contains a file outside the granted boundary", normalized.join(","));
    });
  }

  assertSandboxAllowed(input: {
    purpose: "AGENT_REPAIR" | "INDEPENDENT_VERIFICATION";
    provider: string;
    executionBackend: string;
    requestedSandboxCount?: number;
  }, at = new Date()): void {
    const action = input.purpose === "AGENT_REPAIR" ? this.mutationAction : this.verificationAction;
    this.check("managed-sandbox-create", action, `${input.provider}/${input.executionBackend}/${input.purpose}`, at, () => {
      const requested = input.requestedSandboxCount ?? 1;
      if (
        !this.authorityLease.scope.allowedSandboxProviders?.includes(input.provider) ||
        !this.authorityLease.scope.allowedExecutionBackends?.includes(input.executionBackend) ||
        !Number.isSafeInteger(requested) || requested < 1 || this.sandboxesAuthorized + requested > (this.authorityLease.scope.maxSandboxes ?? 0) ||
        this.authorityLease.scope.persistence !== "none" ||
        this.authorityLease.scope.networkPolicy !== "deny-all"
      ) throw this.recordViolation(action, "Sandbox request exceeds the task-scoped Permission Lease");
      this.sandboxesAuthorized += requested;
    });
  }

  assertFixedTestsAllowed(at = new Date()): void {
    this.check("fixed-tests", this.verificationAction, null, at, () => undefined);
  }

  assertPullRequestCreateAllowed(input: {
    remoteUrl: string;
    baseRef: string;
    headBranch: string;
  }, at = new Date()): void {
    this.check("pull-request-create", "create_pull_request", `${input.baseRef}<-${input.headBranch}`, at, () => {
      if (
        input.remoteUrl !== this.authorityLease.authority.resources.repository ||
        input.baseRef !== this.authorityLease.authority.resources.baseRef ||
        !input.headBranch.startsWith(this.authorityLease.authority.resources.deliveryBranchPrefix)
      ) throw this.recordViolation("create_pull_request", "Pull Request resources exceed the granted boundary");
      const approval = this.authorityLease.authority.approvalPolicy.grants.find((item) => item.action === "create_pull_request");
      if (!approval || Date.parse(approval.approvedAt) > at.getTime()) {
        throw this.recordViolation("create_pull_request", "Pull Request creation requires prior recorded Owner approval");
      }
    });
  }

  assertPullRequestMergeAllowed(at = new Date()): void {
    this.check("pull-request-merge", "merge_pull_request", null, at, () => undefined);
  }

  assertProductionDeploymentAllowed(at = new Date()): void {
    this.check("production-deployment", "production_deploy", null, at, () => undefined);
  }

  assertActionAllowedWithEvidence(action: string, at = new Date()): void {
    this.check("protected-action", action, null, at, () => undefined);
  }

  private check(
    operation: string,
    action: string,
    resource: string | null,
    at: Date,
    assertion: () => void,
  ): void {
    try {
      super.assertActionAllowed(action, at);
      assertion();
      this.record(operation, action, "ALLOWED", resource, "Permission Lease allowed the protected operation", at);
    } catch (error) {
      this.record(operation, action, "DENIED", resource, error instanceof Error ? error.message : String(error), at);
      throw error;
    }
  }

  private record(
    operation: string,
    action: string,
    decision: "ALLOWED" | "DENIED",
    resource: string | null,
    reason: string,
    at: Date,
  ): void {
    this.sequence += 1;
    this.onDecision?.({
      sequence: this.sequence,
      operation,
      action,
      decision,
      resource,
      reason,
      authoritySha256: this.authorityLease.authoritySha256,
      recordedAt: at.toISOString(),
    });
  }
}

export function requireTaskScopedAuthorityGuard(
  lease: TaskScopedPermissionLease | null | undefined,
  input: ConstructorParameters<typeof TaskScopedAuthorityGuard>[1],
): TaskScopedAuthorityGuard {
  if (!lease) throw new Error("TASK_SCOPED_AUTHORITY_REQUIRED");
  return new TaskScopedAuthorityGuard(lease, input);
}

function authorityDecisionReasons(input: {
  contract: TaskScopedWorkContract;
  subject: TaskScopedAuthoritySubject;
  requestedBy: TaskScopedAuthorityDecision["requestedBy"];
  requestedScope: PermissionScope;
  durationSeconds: number;
  approvals: TaskScopedAuthorityApproval[];
}): string[] {
  const reasons: string[] = [];
  let subject: TaskScopedAuthoritySubject | null = null;
  try { subject = validSubject(input.subject); } catch (error) { reasons.push(error instanceof Error ? error.message : String(error)); }
  if (input.requestedBy.actorType !== "PLATFORM" || input.requestedBy.actorId !== TASK_SCOPED_AUTHORITY_ISSUER) {
    reasons.push("Only the DoneLayer Server may issue task-scoped authority");
  }
  if (subject && (subject.agentId === TASK_SCOPED_AUTHORITY_ISSUER || subject.executorId === TASK_SCOPED_AUTHORITY_ISSUER)) {
    reasons.push("Authority issuer and recipient must be distinct");
  }
  if (input.contract.assignedAgent) {
    if (!subject?.agentIdentity || !subject.executionId) {
      reasons.push("Identity-aware Work Contract requires profile and execution bindings");
    } else {
      try { assertAgentIdentityReference(subject.agentIdentity, input.contract.assignedAgent); } catch { reasons.push("Authority Agent identity does not match the Work Contract assignment"); }
      if (subject.agentId !== input.contract.assignedAgent.agentId) reasons.push("Authority Agent ID does not match the Work Contract assignment");
    }
  }
  if (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds < 1 || input.durationSeconds > MAX_AUTHORITY_DURATION_SECONDS) {
    reasons.push("Authority duration exceeds the bounded V1 limit");
  }
  const scope = input.requestedScope;
  const policy = resolvedAuthorityPolicy(input.contract);
  const contractAllowed = new Set(input.contract.permissionPolicy.allowedActions);
  if (scope.allowedActions.length < 1 || scope.allowedActions.some((action) => !contractAllowed.has(action))) {
    reasons.push("Requested actions exceed the locked Work Contract");
  }
  if (scope.allowedActions.some((action) => scope.deniedActions.includes(action))) {
    reasons.push("Requested scope both allows and denies an action");
  }
  if (input.contract.permissionPolicy.forbiddenActions.some((action) => !scope.deniedActions.includes(action))) {
    reasons.push("Requested scope removes a locked Work Contract prohibition");
  }
  if (canonicalJson(scope.allowedRepositories) !== canonicalJson([input.contract.remoteUrl])) reasons.push("Repository scope is not exact");
  if (canonicalJson(scope.allowedBranches) !== canonicalJson([input.contract.branch])) reasons.push("Base ref scope is not exact");
  if (canonicalJson(scope.allowedCommitShas) !== canonicalJson([input.contract.commitSha])) reasons.push("Commit scope is not exact");
  if (canonicalJson(scope.allowedFiles) !== canonicalJson(policy.allowedFiles)) reasons.push("File scope is not exact");
  if (canonicalJson(scope.allowedWorkflows) !== canonicalJson(policy.allowedWorkflows)) reasons.push("Workflow scope is not exact");
  if (canonicalJson(scope.allowedSandboxProviders) !== canonicalJson([MANAGED_SANDBOX_PROVIDER])) reasons.push("Sandbox Provider scope is not exact");
  if (canonicalJson(scope.allowedExecutionBackends) !== canonicalJson([MANAGED_SANDBOX_EXECUTION_BACKEND])) reasons.push("Execution backend scope is not exact");
  if (
    scope.maxRuntimeSeconds > MAX_AUTHORITY_DURATION_SECONDS ||
    (scope.maxSandboxes ?? 0) > policy.maxSandboxes ||
    (scope.maxCommands ?? 0) > policy.maxCommands
  ) reasons.push("Requested resource limits exceed V1");
  if (scope.persistence !== "none" || scope.networkPolicy !== "deny-all") reasons.push("Sandbox safety policy is not fail closed");
  if (scope.allowedActions.includes("create_pull_request") && !scope.humanApprovalActions.includes("create_pull_request")) {
    reasons.push("Pull Request creation must retain Owner approval");
  }
  const approvalIds = new Set<string>();
  for (const approval of input.approvals) {
    if (
      approval.action !== "create_pull_request" ||
      !approval.decisionId.trim() ||
      !approval.approverId.trim() ||
      approval.approverId === subject?.agentId ||
      approval.approverId === subject?.executorId ||
      approvalIds.has(approval.decisionId) ||
      !Number.isFinite(Date.parse(approval.approvedAt))
    ) reasons.push("Approval evidence is invalid or self-approved");
    approvalIds.add(approval.decisionId);
  }
  return [...new Set(reasons)].sort();
}

function authoritySha256(lease: Omit<TaskScopedPermissionLease, "authoritySha256"> | TaskScopedPermissionLease): string {
  return sha256Canonical({
    id: lease.id,
    version: lease.version,
    startsAt: lease.startsAt,
    expiresAt: lease.expiresAt,
    scope: lease.scope,
    authorityType: lease.authorityType,
    authority: lease.authority,
  });
}

function workContractReference(contract: TaskScopedWorkContract): TaskScopedAuthorityDecision["workContract"] {
  return { id: contract.taskId, version: contract.contractVersion, sha256: contract.workContractSha256 };
}

export function assertTaskScopedWorkContractIntegrity(contract: TaskScopedWorkContract): void {
  const { workContractSha256, ...body } = contract;
  const historicalV1 = contract.schemaVersion === 1 &&
    contract.contractVersion === 1 &&
    contract.deliveryOutcomePolicy === undefined;
  const outcomeAwareV2 = contract.schemaVersion === 2 &&
    contract.contractVersion === 2 &&
    contract.deliveryOutcomePolicy !== undefined;
  if (
    (!historicalV1 && !outcomeAwareV2) ||
    contract.status !== "LOCKED" ||
    !contract.taskId.trim() ||
    !contract.remoteUrl.trim() ||
    !contract.branch.trim() ||
    !/^[a-f0-9]{40}$/.test(contract.commitSha) ||
    !/^[a-f0-9]{64}$/.test(workContractSha256) ||
    sha256Canonical(body) !== workContractSha256
  ) throw new Error("TASK_SCOPED_WORK_CONTRACT_TAMPERING_DETECTED");
  if (outcomeAwareV2) assertVerifiedDeliveryOutcomePolicy(contract.deliveryOutcomePolicy!);
  if (contract.assignedAgent) assertAgentIdentityReference(contract.assignedAgent);
  if (!contract.authorityPolicy) {
    assertSemanticContractIntegrity(contract as SemanticTaskContract);
    return;
  }
  const policy = contract.authorityPolicy;
  if (
    policy.allowedFiles.length < 1 ||
    policy.allowedFiles.some((filePath) => !safeRepositoryPath(filePath)) ||
    new Set(policy.allowedFiles).size !== policy.allowedFiles.length ||
    policy.allowedWorkflows.length < 1 ||
    policy.allowedWorkflows.some((workflow) => !workflow.trim()) ||
    !contract.permissionPolicy.allowedActions.includes(policy.mutationAction) ||
    !contract.permissionPolicy.allowedActions.includes(policy.verificationAction) ||
    !Number.isSafeInteger(policy.maxSandboxes) || policy.maxSandboxes < 1 || policy.maxSandboxes > 2 ||
    !Number.isSafeInteger(policy.maxCommands) || policy.maxCommands < 1 || policy.maxCommands > 10
  ) throw new Error("TASK_SCOPED_WORK_CONTRACT_AUTHORITY_POLICY_INVALID");
}

function resolvedAuthorityPolicy(contract: TaskScopedWorkContract): NonNullable<TaskScopedWorkContract["authorityPolicy"]> {
  return contract.authorityPolicy
    ? {
        ...contract.authorityPolicy,
        allowedFiles: [...contract.authorityPolicy.allowedFiles],
        allowedWorkflows: [...contract.authorityPolicy.allowedWorkflows],
      }
    : {
        allowedFiles: [...TASK_SCOPED_ALLOWED_FILES],
        allowedWorkflows: ["AGENT_REPAIR_IN_MANAGED_SANDBOX_GATE_V1", "SEMANTIC_CONTRACT_VERIFIED_DELIVERY_V1"],
        mutationAction: "modify_src_add",
        verificationAction: "run_fixed_tests",
        maxSandboxes: 2,
        maxCommands: 10,
      };
}

function validSubject(subject: TaskScopedAuthoritySubject): TaskScopedAuthoritySubject {
  const valid: TaskScopedAuthoritySubject = {
    agentId: requiredText(subject.agentId, "Authority Agent ID"),
    executorId: requiredText(subject.executorId, "Authority executor ID"),
    jobRunId: requiredText(subject.jobRunId, "Authority Job Run ID"),
  };
  if (subject.agentIdentity) {
    assertAgentIdentityReference(subject.agentIdentity);
    if (subject.agentIdentity.agentId !== valid.agentId) throw new Error("Authority Agent identity does not match Agent ID");
    valid.agentIdentity = structuredClone(subject.agentIdentity);
  }
  if (subject.executionId !== undefined) {
    if (!/^exe_[A-Za-z0-9_-]{20,64}$/.test(subject.executionId)) throw new Error("Authority execution ID is invalid");
    valid.executionId = subject.executionId;
  }
  return valid;
}

function safeRepositoryPath(value: string): boolean {
  return Boolean(value) && !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..");
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value;
}

function validTimestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
  return value;
}
