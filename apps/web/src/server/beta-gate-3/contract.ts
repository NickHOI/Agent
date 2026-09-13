import { randomUUID } from "node:crypto";

import {
  assertAgentIdentityProfileIntegrity,
  agentIdentityReference,
  canonicalJson,
  sha256Canonical,
  type AgentIdentityProfile,
  type AgentIdentityReference,
} from "@donelayer/database";
import {
  BETA_GATE_3_PRODUCT_BRANCH,
  BETA_GATE_3_PRODUCT_REMOTE_URL,
  MANAGED_SANDBOX_EXECUTION_BACKEND,
  MANAGED_SANDBOX_PROVIDER,
  PermissionGuard,
  permissionScopeSchema,
  type PermissionLeaseEnvelope,
  type PermissionScope,
} from "@donelayer/worker-protocol";

import {
  boundedContractAssertionsSha256,
  type AgentRepairTaskProfile,
  type BoundedContractAssertion,
} from "../agent-execution/vercel-agent-repair-sandbox";

export const BETA_GATE_3_WORKFLOW = "BETA_GATE_3_MANAGED_REMOTE_EXECUTION" as const;
export const BETA_GATE_3_EDITABLE_FILE = "apps/web/src/lib/format.ts" as const;
export const BETA_GATE_3_EXECUTOR_ID = "done-layer-server-side-orchestrator" as const;
export const BETA_GATE_3_RECEIPT_TYPE = "VERIFIED_WORK_RECEIPT_V2" as const;

export const BETA_GATE_3_WORK_INPUT = Object.freeze({
  title: "Handle invalid timestamps in relative-time formatting",
  requestDescription:
    "The product relative-time formatter emits an invalid NaN-based label for malformed or blank timestamps. Return a clear Unknown time label for invalid input while preserving valid relative-time behavior.",
  desiredOutcome:
    "formatRelativeTime returns Unknown time for malformed or blank timestamps, with the change limited to apps/web/src/lib/format.ts.",
  repositoryReference: BETA_GATE_3_PRODUCT_REMOTE_URL,
  targetBranch: BETA_GATE_3_PRODUCT_BRANCH,
  taskType: "FEATURE_COMPLETION" as const,
  acceptanceRequirements: [
    "formatRelativeTime('not-a-date') returns Unknown time",
    "formatRelativeTime('') returns Unknown time",
  ],
  allowedPaths: [BETA_GATE_3_EDITABLE_FILE],
  deliveryOutcomePolicy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED" as const,
  securitySensitivity: "LOW" as const,
  allowCodeChanges: true,
  allowPullRequest: false,
});

export type BetaGate3PreparedLifecycle = {
  prepared: true;
  startedAt: string;
  taskId: string;
  assignmentId: string;
  agentId: string;
  workerId: string;
  jobRunId: string;
  workerLeaseId: string;
  permissionLeaseId: string;
  contractId: string;
  contractVersion: 2;
  contractSha256: string;
  contract: Record<string, unknown>;
  authorityId: string;
  authorityScopeSha256: string;
  authorityScope: Record<string, unknown>;
  permissionScope: PermissionScope;
  agentIdentity: AgentIdentityProfile;
  sourceCommit: string;
};

export type BetaGate3ExecutionBinding = {
  schemaVersion: 1;
  bindingType: "BETA_GATE_3_EXECUTION_BINDING_V1";
  taskId: string;
  assignmentId: string;
  jobRunId: string;
  workerId: string;
  workerLeaseId: string;
  permissionLeaseId: string;
  workContract: { id: string; version: 2; sha256: string };
  authority: { id: string; scopeSha256: string };
  agent: AgentIdentityReference;
  source: {
    remoteUrl: typeof BETA_GATE_3_PRODUCT_REMOTE_URL;
    branch: typeof BETA_GATE_3_PRODUCT_BRANCH;
    commitSha: string;
  };
  assertionsSha256: string;
  startedAt: string;
  expiresAt: string;
  bindingSha256: string;
};

export type BetaGate3AuthorityOperation = {
  sequence: number;
  operation: string;
  action: string;
  decision: "ALLOWED" | "DENIED";
  resource: string | null;
  reason: string;
  bindingSha256: string;
  recordedAt: string;
};

export function betaGate3Assertions(): BoundedContractAssertion[] {
  return [
    {
      id: "invalid-date-is-unknown",
      modulePath: BETA_GATE_3_EDITABLE_FILE,
      exportName: "formatRelativeTime",
      args: ["not-a-date"],
      expected: "Unknown time",
    },
    {
      id: "blank-date-is-unknown",
      modulePath: BETA_GATE_3_EDITABLE_FILE,
      exportName: "formatRelativeTime",
      args: [""],
      expected: "Unknown time",
    },
  ];
}

export function betaGate3TaskProfile(
  sandboxPurpose: "AGENT_REPAIR" | "INDEPENDENT_VERIFICATION",
): AgentRepairTaskProfile {
  const assertions = betaGate3Assertions();
  return {
    taskType: "FEATURE_COMPLETION",
    primaryCommand: "locked contract assertions",
    editableFiles: [BETA_GATE_3_EDITABLE_FILE],
    sandboxPurpose,
    contractCheck: {
      assertions,
      assertionsSha256: boundedContractAssertionsSha256(assertions),
    },
    installDependencies: false,
    includeJobMetadataEnvironment: false,
  };
}

export function parseBetaGate3PreparedLifecycle(value: unknown): BetaGate3PreparedLifecycle {
  const prepared = recordOf(value) as Partial<BetaGate3PreparedLifecycle>;
  const contract = recordOf(prepared.contract);
  const source = recordOf(contract.sourceReference);
  const authorityPolicy = recordOf(contract.authorityPolicy);
  const deliveryPolicy = recordOf(contract.deliveryOutcomePolicy);
  const identity = prepared.agentIdentity as AgentIdentityProfile;
  const permissionScope = permissionScopeSchema.parse(prepared.permissionScope);
  assertAgentIdentityProfileIntegrity(identity);
  if (
    prepared.prepared !== true ||
    prepared.contractVersion !== 2 ||
    !isUuid(prepared.taskId) ||
    !isUuid(prepared.assignmentId) ||
    !isUuid(prepared.agentId) ||
    !isUuid(prepared.workerId) ||
    !isUuid(prepared.jobRunId) ||
    !isUuid(prepared.workerLeaseId) ||
    !isUuid(prepared.permissionLeaseId) ||
    !isUuid(prepared.contractId) ||
    !isUuid(prepared.authorityId) ||
    !isSha256(prepared.contractSha256) ||
    !isSha256(prepared.authorityScopeSha256) ||
    !isCommit(prepared.sourceCommit) ||
    !validTime(prepared.startedAt) ||
    prepared.agentId !== identity.agentId ||
    contract.taskId !== prepared.taskId ||
    contract.contractType !== "VERIFIED_WORK_CONTRACT_V2" ||
    contract.contractVersion !== 2 ||
    contract.allowedWorkflow !== BETA_GATE_3_WORKFLOW ||
    source.repository !== BETA_GATE_3_PRODUCT_REMOTE_URL ||
    source.branch !== BETA_GATE_3_PRODUCT_BRANCH ||
    source.commitResolution !== "REQUIRED_BEFORE_PERMISSION_LEASE" ||
    authorityPolicy.networkPolicy !== "deny-all" ||
    authorityPolicy.persistence !== "none" ||
    deliveryPolicy.policy !== "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED" ||
    canonicalJson(authorityPolicy.allowedPaths) !== canonicalJson([BETA_GATE_3_EDITABLE_FILE]) ||
    canonicalJson(permissionScope.allowedRepositories) !== canonicalJson([BETA_GATE_3_PRODUCT_REMOTE_URL]) ||
    canonicalJson(permissionScope.allowedBranches) !== canonicalJson([BETA_GATE_3_PRODUCT_BRANCH]) ||
    canonicalJson(permissionScope.allowedCommitShas) !== canonicalJson([prepared.sourceCommit]) ||
    canonicalJson(permissionScope.allowedFiles) !== canonicalJson([BETA_GATE_3_EDITABLE_FILE]) ||
    permissionScope.networkPolicy !== "deny-all" ||
    permissionScope.persistence !== "none" ||
    permissionScope.maxSandboxes !== 2 ||
    permissionScope.allowedEnvironmentVariables?.length !== 0
  ) throw new Error("BETA_GATE_3_PREPARED_LIFECYCLE_INVALID");
  return prepared as BetaGate3PreparedLifecycle;
}

export function createBetaGate3ExecutionBinding(
  preparedInput: BetaGate3PreparedLifecycle,
): BetaGate3ExecutionBinding {
  const prepared = parseBetaGate3PreparedLifecycle(preparedInput);
  const body: Omit<BetaGate3ExecutionBinding, "bindingSha256"> = {
    schemaVersion: 1,
    bindingType: "BETA_GATE_3_EXECUTION_BINDING_V1",
    taskId: prepared.taskId,
    assignmentId: prepared.assignmentId,
    jobRunId: prepared.jobRunId,
    workerId: prepared.workerId,
    workerLeaseId: prepared.workerLeaseId,
    permissionLeaseId: prepared.permissionLeaseId,
    workContract: {
      id: prepared.contractId,
      version: prepared.contractVersion,
      sha256: prepared.contractSha256,
    },
    authority: { id: prepared.authorityId, scopeSha256: prepared.authorityScopeSha256 },
    agent: agentIdentityReference(prepared.agentIdentity),
    source: {
      remoteUrl: BETA_GATE_3_PRODUCT_REMOTE_URL,
      branch: BETA_GATE_3_PRODUCT_BRANCH,
      commitSha: prepared.sourceCommit,
    },
    assertionsSha256: betaGate3TaskProfile("AGENT_REPAIR").contractCheck!.assertionsSha256,
    startedAt: prepared.startedAt,
    expiresAt: new Date(Date.parse(prepared.startedAt) + 600_000).toISOString(),
  };
  const binding = { ...body, bindingSha256: sha256Canonical(body) };
  assertBetaGate3ExecutionBinding(binding);
  return binding;
}

export function assertBetaGate3ExecutionBinding(binding: BetaGate3ExecutionBinding): void {
  const { bindingSha256, ...body } = binding;
  if (
    binding.schemaVersion !== 1 ||
    binding.bindingType !== "BETA_GATE_3_EXECUTION_BINDING_V1" ||
    !isUuid(binding.taskId) ||
    !isUuid(binding.jobRunId) ||
    !isSha256(binding.workContract.sha256) ||
    !isSha256(binding.authority.scopeSha256) ||
    !isCommit(binding.source.commitSha) ||
    binding.source.remoteUrl !== BETA_GATE_3_PRODUCT_REMOTE_URL ||
    binding.source.branch !== BETA_GATE_3_PRODUCT_BRANCH ||
    binding.assertionsSha256 !== betaGate3TaskProfile("AGENT_REPAIR").contractCheck!.assertionsSha256 ||
    Date.parse(binding.expiresAt) - Date.parse(binding.startedAt) !== 600_000 ||
    sha256Canonical(body) !== bindingSha256
  ) throw new Error("BETA_GATE_3_EXECUTION_BINDING_TAMPERED");
}

export class BetaGate3AuthorityGuard extends PermissionGuard {
  private sequence = 0;
  private sandboxCount = 0;

  constructor(
    readonly binding: BetaGate3ExecutionBinding,
    scope: PermissionScope,
    private readonly operations: BetaGate3AuthorityOperation[],
  ) {
    assertBetaGate3ExecutionBinding(binding);
    const parsed = permissionScopeSchema.parse(scope);
    const lease: PermissionLeaseEnvelope = {
      id: binding.permissionLeaseId,
      version: 1,
      status: "ACTIVE",
      startsAt: binding.startedAt,
      expiresAt: binding.expiresAt,
      scope: parsed,
    };
    super(lease);
    if (
      canonicalJson(parsed.allowedRepositories) !== canonicalJson([binding.source.remoteUrl]) ||
      canonicalJson(parsed.allowedBranches) !== canonicalJson([binding.source.branch]) ||
      canonicalJson(parsed.allowedCommitShas) !== canonicalJson([binding.source.commitSha]) ||
      canonicalJson(parsed.allowedFiles) !== canonicalJson([BETA_GATE_3_EDITABLE_FILE]) ||
      parsed.networkPolicy !== "deny-all" ||
      parsed.persistence !== "none" ||
      parsed.maxSandboxes !== 2 ||
      parsed.allowedEnvironmentVariables?.length !== 0
    ) throw new Error("BETA_GATE_3_PERMISSION_SCOPE_MISMATCH");
  }

  assertRepositoryReadAllowed(input: { remoteUrl: string; baseRef: string; commitSha: string }, at = new Date()): void {
    this.check("repository-read", "read_source", `${input.remoteUrl}#${input.baseRef}@${input.commitSha}`, at, () => {
      super.assertRepositoryAllowed(input.remoteUrl, input.baseRef, at);
      if (!this.lease.scope.allowedCommitShas?.includes(input.commitSha)) {
        throw this.recordViolation("read_source", "Commit is outside the Permission Lease", input.commitSha);
      }
    });
  }

  assertPatchAllowed(files: string[], at = new Date()): void {
    const normalized = [...new Set(files)].sort();
    this.check("source-patch", "create_patch", normalized.join(","), at, () => {
      if (canonicalJson(normalized) !== canonicalJson([BETA_GATE_3_EDITABLE_FILE])) {
        throw this.recordViolation("create_patch", "Patch is outside the exact approved file", normalized.join(","));
      }
    });
  }

  assertSandboxAllowed(input: {
    purpose: "AGENT_REPAIR" | "INDEPENDENT_VERIFICATION";
    provider: string;
    executionBackend: string;
    requestedSandboxCount?: number;
  }, at = new Date()): void {
    const action = input.purpose === "AGENT_REPAIR" ? "create_patch" : "independently_verify";
    this.check("managed-sandbox-create", action, input.purpose, at, () => {
      const count = input.requestedSandboxCount ?? 1;
      if (
        input.provider !== MANAGED_SANDBOX_PROVIDER ||
        input.executionBackend !== MANAGED_SANDBOX_EXECUTION_BACKEND ||
        count !== 1 ||
        this.sandboxCount + count > 2
      ) throw this.recordViolation(action, "Sandbox request exceeds the exact Permission Lease");
      this.sandboxCount += count;
    });
  }

  assertFixedTestsAllowed(at = new Date()): void {
    this.check("locked-contract-assertions", "run_locked_verification", null, at, () => undefined);
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
    this.operations.push({
      sequence: this.sequence,
      operation,
      action,
      decision,
      resource,
      reason,
      bindingSha256: this.binding.bindingSha256,
      recordedAt: at.toISOString(),
    });
  }
}

export function betaGate3LifecycleIds() {
  return {
    jobRunId: randomUUID(),
    workerId: randomUUID(),
    workerLeaseId: randomUUID(),
    permissionLeaseId: randomUUID(),
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isCommit(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
