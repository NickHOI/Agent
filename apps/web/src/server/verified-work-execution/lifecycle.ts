import { createHash } from "node:crypto";

import { canonicalJson, sha256Canonical, type AgentIdentityProfile } from "@donelayer/database";
import { permissionScopeSchema, type PermissionScope } from "@donelayer/worker-protocol";

import { canonicalWorkflowPolicy, type CanonicalSourceIdentity, type CanonicalWorkflow } from "./contract";

export type CanonicalPreparedExecution = {
  prepared: true;
  reused: boolean;
  startedAt: string;
  taskId: string;
  assignmentId: string;
  agentId: string;
  workerId: string;
  jobRunId: string;
  workerLeaseId: string;
  permissionLeaseId: string;
  contractId: string;
  contractVersion: number;
  contractSha256: string;
  contract: Record<string, unknown>;
  authorityId: string;
  authorityScopeSha256: string;
  authorityScope: Record<string, unknown>;
  permissionScope: PermissionScope;
  agentIdentity: AgentIdentityProfile;
  source: CanonicalSourceIdentity;
  workflow: CanonicalWorkflow;
  workflowSource: string;
  envelopeCanonical: string;
  envelopeSha256: string;
  idempotencyKey: string;
};

export type CanonicalFinalizationAssertionInput = {
  envelope: CanonicalPreparedExecution;
  taskId: string;
  jobRunId: string;
  contractId: string;
  contractSha256: string;
  authorityId: string;
  authorityScopeSha256: string;
  envelopeSha256: string;
  workerId: string;
  workerLeaseId: string;
  permissionLeaseId: string;
  jobStatus: "RUNNING" | "FAILED" | "SUCCEEDED";
  workerLeaseActive: boolean;
  permissionLeaseActive: boolean;
  permissionLeaseExpired: boolean;
  executionOutcome: "COMPLETED" | "FAILED" | "INCONCLUSIVE" | "TIMEOUT" | "PROVIDER_FAILURE";
  independentVerificationOutcome: "VERIFIED" | "FAILED" | "INCONCLUSIVE";
  deliveryOutcome: "VERIFIED_DELIVERY" | "FAILED" | "BLOCKED" | "INCONCLUSIVE";
  requiredEvidenceComplete: boolean;
  artifactCount: number;
  executionSandboxCleanupVerified: boolean;
  verifierSandboxCleanupVerified: boolean;
  unresolvedPolicyViolations: string[];
};

export function parseCanonicalPreparedExecution(value: unknown): CanonicalPreparedExecution {
  const prepared = recordOf(value) as Partial<CanonicalPreparedExecution>;
  const source = recordOf(prepared.source);
  const policy = typeof prepared.workflow === "string"
    ? canonicalWorkflowPolicy(prepared.workflow)
    : null;
  const permissionScope = permissionScopeSchema.parse(prepared.permissionScope);
  if (
    prepared.prepared !== true ||
    typeof prepared.reused !== "boolean" ||
    !validTime(prepared.startedAt) ||
    !isUuid(prepared.taskId) ||
    !isUuid(prepared.assignmentId) ||
    !isUuid(prepared.agentId) ||
    !isUuid(prepared.workerId) ||
    !isUuid(prepared.jobRunId) ||
    !isUuid(prepared.workerLeaseId) ||
    !isUuid(prepared.permissionLeaseId) ||
    !isUuid(prepared.contractId) ||
    !Number.isInteger(prepared.contractVersion) ||
    prepared.contractVersion! < 1 ||
    !isUuid(prepared.authorityId) ||
    !isSha256(prepared.contractSha256) ||
    !isSha256(prepared.authorityScopeSha256) ||
    typeof prepared.envelopeCanonical !== "string" ||
    !isSha256(prepared.envelopeSha256) ||
    !isSha256(prepared.idempotencyKey) ||
    !policy ||
    prepared.workflowSource !== policy.workflowSource ||
    typeof source.repository !== "string" ||
    !isCommit(source.commitSha) ||
    (source.treeSha !== null && !isCommit(source.treeSha)) ||
    (policy.exactTreeRequired && source.treeSha === null) ||
    !prepared.agentIdentity ||
    prepared.agentIdentity.agentId !== prepared.agentId
  ) throw new Error("CANONICAL_PREPARED_EXECUTION_INVALID");

  const expectedEnvelopeBody = {
    schemaVersion: 1,
    bindingType: "CANONICAL_VERIFIED_WORK_EXECUTION_V1",
    taskId: prepared.taskId,
    assignmentId: prepared.assignmentId,
    jobRunId: prepared.jobRunId,
    workerId: prepared.workerId,
    workerLeaseId: prepared.workerLeaseId,
    permissionLeaseId: prepared.permissionLeaseId,
    contract: {
      id: prepared.contractId,
      version: prepared.contractVersion,
      sha256: prepared.contractSha256,
    },
    authority: { id: prepared.authorityId, scopeSha256: prepared.authorityScopeSha256 },
    source: prepared.source,
    workflow: prepared.workflow,
    workflowSource: prepared.workflowSource,
    permissionScope,
    startedAt: prepared.startedAt,
  };
  let persistedEnvelope: unknown;
  try {
    persistedEnvelope = JSON.parse(prepared.envelopeCanonical);
  } catch {
    throw new Error("CANONICAL_EXECUTION_ENVELOPE_TAMPERED");
  }
  if (
    canonicalJson(persistedEnvelope) !== canonicalJson(expectedEnvelopeBody) ||
    createHash("sha256").update(prepared.envelopeCanonical, "utf8").digest("hex") !== prepared.envelopeSha256
  ) {
    throw new Error("CANONICAL_EXECUTION_ENVELOPE_TAMPERED");
  }
  return { ...prepared, permissionScope } as CanonicalPreparedExecution;
}

export function assertCanonicalFinalization(input: CanonicalFinalizationAssertionInput): void {
  const envelope = parseCanonicalPreparedExecution(input.envelope);
  if (
    input.taskId !== envelope.taskId ||
    input.jobRunId !== envelope.jobRunId ||
    input.contractId !== envelope.contractId ||
    input.contractSha256 !== envelope.contractSha256 ||
    input.authorityId !== envelope.authorityId ||
    input.authorityScopeSha256 !== envelope.authorityScopeSha256 ||
    input.envelopeSha256 !== envelope.envelopeSha256 ||
    input.workerId !== envelope.workerId ||
    input.workerLeaseId !== envelope.workerLeaseId ||
    input.permissionLeaseId !== envelope.permissionLeaseId
  ) throw new Error("CANONICAL_FINALIZATION_LINEAGE_MISMATCH");
  if (
    input.jobStatus !== "RUNNING" ||
    !input.workerLeaseActive ||
    !input.permissionLeaseActive ||
    input.permissionLeaseExpired
  ) throw new Error("CANONICAL_FINALIZATION_OWNERSHIP_INVALID");
  if (
    input.executionOutcome !== "COMPLETED" ||
    input.independentVerificationOutcome !== "VERIFIED" ||
    input.deliveryOutcome !== "VERIFIED_DELIVERY"
  ) throw new Error("CANONICAL_VERIFIED_DELIVERY_NOT_PROVEN");
  if (!input.requiredEvidenceComplete || input.artifactCount < 1) {
    throw new Error("CANONICAL_FINALIZATION_EVIDENCE_INCOMPLETE");
  }
  if (!input.executionSandboxCleanupVerified || !input.verifierSandboxCleanupVerified) {
    throw new Error("CANONICAL_FINALIZATION_CLEANUP_UNVERIFIED");
  }
  if (input.unresolvedPolicyViolations.length > 0) {
    throw new Error("CANONICAL_FINALIZATION_POLICY_VIOLATION");
  }
}

export function canonicalEnvelopeSha256(
  value: Omit<CanonicalPreparedExecution, "prepared" | "reused" | "contract" | "authorityScope" | "agentIdentity" | "envelopeCanonical" | "envelopeSha256" | "idempotencyKey">,
): string {
  return sha256Canonical({
    schemaVersion: 1,
    bindingType: "CANONICAL_VERIFIED_WORK_EXECUTION_V1",
    taskId: value.taskId,
    assignmentId: value.assignmentId,
    jobRunId: value.jobRunId,
    workerId: value.workerId,
    workerLeaseId: value.workerLeaseId,
    permissionLeaseId: value.permissionLeaseId,
    contract: { id: value.contractId, version: value.contractVersion, sha256: value.contractSha256 },
    authority: { id: value.authorityId, scopeSha256: value.authorityScopeSha256 },
    source: value.source,
    workflow: value.workflow,
    workflowSource: value.workflowSource,
    permissionScope: value.permissionScope,
    startedAt: value.startedAt,
  });
}

export function canonicalScopeEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
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
