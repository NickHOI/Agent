import { randomBytes } from "node:crypto";

import { canonicalJson, sha256Canonical } from "@donelayer/database";

import {
  assertTaskScopedWorkContractIntegrity,
  assertTaskScopedPermissionLeaseIntegrity,
  type TaskScopedPermissionLease,
  type TaskScopedWorkContract,
} from "../task-scoped-authority/task-scoped-authority";
import {
  agentIdentityReceiptBinding,
  assertAgentIdentityReference,
  type AgentIdentityProfile,
  type AgentIdentityReceiptBinding,
} from "./agent-identity";

export const AGENT_EXECUTION_IDENTITY_TYPE = "AGENT_EXECUTION_IDENTITY_V1" as const;

export type AgentExecutionIdentity = {
  schemaVersion: 1;
  executionType: typeof AGENT_EXECUTION_IDENTITY_TYPE;
  executionId: string;
  agent: AgentIdentityReceiptBinding;
  workContract: {
    id: string;
    version: number;
    sha256: string;
  };
  authority: {
    leaseId: string;
    leaseVersion: number;
    authoritySha256: string;
  };
  jobRunId: string;
  executor: {
    executorId: string;
    executorType: "DONE_LAYER_SERVER_SIDE_ORCHESTRATOR";
  };
  runtime: {
    provider: string;
    modelId: string | null;
    sandboxProvider: string | null;
  };
  startedAt: string;
  executionSha256: string;
};

export function generateExecutionId(): string {
  return `exe_${randomBytes(18).toString("base64url")}`;
}

export function createAgentExecutionIdentity(input: {
  executionId?: string;
  profile: AgentIdentityProfile;
  contract: TaskScopedWorkContract;
  authorityLease: TaskScopedPermissionLease;
  executorId: string;
  runtime: AgentExecutionIdentity["runtime"];
  startedAt?: string;
}): AgentExecutionIdentity {
  const startedAt = validTimestamp(input.startedAt ?? new Date().toISOString());
  const body: Omit<AgentExecutionIdentity, "executionSha256"> = {
    schemaVersion: 1,
    executionType: AGENT_EXECUTION_IDENTITY_TYPE,
    executionId: validExecutionId(input.executionId ?? generateExecutionId()),
    agent: agentIdentityReceiptBinding(input.profile),
    workContract: {
      id: input.contract.taskId,
      version: input.contract.contractVersion,
      sha256: input.contract.workContractSha256,
    },
    authority: {
      leaseId: input.authorityLease.id,
      leaseVersion: input.authorityLease.version,
      authoritySha256: input.authorityLease.authoritySha256,
    },
    jobRunId: input.authorityLease.authority.subject.jobRunId,
    executor: {
      executorId: requiredText(input.executorId, "Execution executor ID"),
      executorType: "DONE_LAYER_SERVER_SIDE_ORCHESTRATOR",
    },
    runtime: {
      provider: requiredText(input.runtime.provider, "Execution runtime Provider"),
      modelId: input.runtime.modelId === null ? null : requiredText(input.runtime.modelId, "Execution model ID"),
      sandboxProvider: input.runtime.sandboxProvider === null
        ? null
        : requiredText(input.runtime.sandboxProvider, "Execution Sandbox Provider"),
    },
    startedAt,
  };
  const execution = { ...body, executionSha256: sha256Canonical(body) };
  assertAgentExecutionBinding({ execution, contract: input.contract, authorityLease: input.authorityLease });
  return execution;
}

export function assertAgentExecutionIdentityIntegrity(execution: AgentExecutionIdentity): void {
  const { executionSha256, ...body } = execution;
  if (
    execution.schemaVersion !== 1 ||
    execution.executionType !== AGENT_EXECUTION_IDENTITY_TYPE ||
    !/^[a-f0-9]{64}$/.test(executionSha256) ||
    sha256Canonical(body) !== executionSha256
  ) throw new Error("AGENT_EXECUTION_IDENTITY_TAMPERING_DETECTED");
  validExecutionId(execution.executionId);
  assertAgentIdentityReference(execution.agent);
  if (execution.agent.statusAtExecution !== "ACTIVE") throw new Error("AGENT_EXECUTION_IDENTITY_STATUS_INVALID");
  validTimestamp(execution.startedAt);
  requiredText(execution.jobRunId, "Execution Job Run ID");
  requiredText(execution.executor.executorId, "Execution executor ID");
  requiredText(execution.runtime.provider, "Execution runtime Provider");
}

export function assertAgentExecutionBinding(input: {
  execution: AgentExecutionIdentity;
  contract: TaskScopedWorkContract;
  authorityLease: TaskScopedPermissionLease;
}): void {
  assertAgentExecutionIdentityIntegrity(input.execution);
  assertTaskScopedWorkContractIntegrity(input.contract);
  assertTaskScopedPermissionLeaseIntegrity(input.authorityLease);
  const assignedAgent = input.contract.assignedAgent;
  const subject = input.authorityLease.authority.subject;
  if (!assignedAgent) throw new Error("AGENT_IDENTITY_CONTRACT_ASSIGNMENT_REQUIRED");
  if (
    canonicalJson({
      agentId: input.execution.agent.agentId,
      profileRevision: input.execution.agent.profileRevision,
      profileSha256: input.execution.agent.profileSha256,
    }) !== canonicalJson(assignedAgent) ||
    canonicalJson(subject.agentIdentity) !== canonicalJson(assignedAgent) ||
    subject.agentId !== assignedAgent.agentId ||
    subject.executionId !== input.execution.executionId ||
    subject.jobRunId !== input.execution.jobRunId ||
    subject.executorId !== input.execution.executor.executorId ||
    input.execution.workContract.id !== input.contract.taskId ||
    input.execution.workContract.version !== input.contract.contractVersion ||
    input.execution.workContract.sha256 !== input.contract.workContractSha256 ||
    input.execution.authority.leaseId !== input.authorityLease.id ||
    input.execution.authority.leaseVersion !== input.authorityLease.version ||
    input.execution.authority.authoritySha256 !== input.authorityLease.authoritySha256 ||
    Date.parse(input.execution.startedAt) < Date.parse(input.authorityLease.startsAt) ||
    Date.parse(input.execution.startedAt) >= Date.parse(input.authorityLease.expiresAt) ||
    input.authorityLease.status !== "ACTIVE"
  ) throw new Error("AGENT_EXECUTION_IDENTITY_BINDING_MISMATCH");
}

export function assertReceiptIdentityBinding(input: {
  receiptBinding: {
    agent: AgentIdentityReceiptBinding;
    executionId: string;
    executionSha256: string;
  };
  execution: AgentExecutionIdentity;
}): void {
  assertAgentExecutionIdentityIntegrity(input.execution);
  if (
    canonicalJson(input.receiptBinding.agent) !== canonicalJson(input.execution.agent) ||
    input.receiptBinding.executionId !== input.execution.executionId ||
    input.receiptBinding.executionSha256 !== input.execution.executionSha256
  ) throw new Error("AGENT_RECEIPT_IDENTITY_BINDING_MISMATCH");
}

function validExecutionId(value: string): string {
  if (!/^exe_[A-Za-z0-9_-]{20,64}$/.test(value)) throw new Error("AGENT_EXECUTION_ID_INVALID");
  return value;
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function validTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error("AGENT_EXECUTION_TIMESTAMP_INVALID");
  return value;
}
