import "server-only";

import { randomUUID } from "node:crypto";
import {
  assertAgentIdentityProfileIntegrity,
  createAgentIdentityProfile,
  sha256Canonical,
  verifyEvidenceLedgerEntries,
  type AgentIdentityProfile,
  type EvidenceLedgerEntryRecord,
} from "@donelayer/database";
import { z } from "zod";
import type { Actor } from "./auth";
import { createSupabaseUserClient } from "./supabase-auth";
import {
  normalizePersistedLedgerTimestamp,
  summarizeWorkspaceReceiptDocument,
} from "./workspace-history";

const taskTypes = [
  "DIAGNOSE_REPOSITORY",
  "BUILD_RESCUE",
  "TEST_AND_FIX",
  "FEATURE_COMPLETION",
  "PULL_REQUEST_VERIFICATION",
  "LAUNCH_READINESS",
] as const;

const deliveryPolicies = [
  "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
  "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
] as const;

export const createWorkspaceWorkInputSchema = z.object({
  title: z.string().trim().min(3).max(180),
  requestDescription: z.string().trim().min(10).max(20_000),
  desiredOutcome: z.string().trim().min(3).max(10_000),
  repositoryReference: z.string().trim().min(1).max(500),
  targetBranch: z.string().trim().min(1).max(255),
  taskType: z.enum(taskTypes),
  agentId: z.uuid(),
  acceptanceRequirements: z.array(z.string().trim().min(3).max(500)).min(1).max(20),
  allowedPaths: z.array(z.string().trim().min(1).max(240)).min(1).max(20),
  deliveryOutcomePolicy: z.enum(deliveryPolicies),
  securitySensitivity: z.enum(["LOW", "STANDARD", "HIGH"]),
  allowCodeChanges: z.boolean(),
  allowPullRequest: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.allowPullRequest && !value.allowCodeChanges) {
    context.addIssue({ code: "custom", path: ["allowPullRequest"], message: "Pull Request delivery requires code changes." });
  }
  for (const [index, path] of value.allowedPaths.entries()) {
    if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
      context.addIssue({ code: "custom", path: ["allowedPaths", index], message: "Use a safe repository-relative path." });
    }
  }
});

export type WorkspaceAgentCreateInput = {
  name: string;
  slug: string;
  description: string;
  skills: string[];
  taskTypes: typeof taskTypes[number][];
  languages: string[];
  operatingSystems: Array<"WINDOWS" | "MACOS" | "LINUX">;
  tools: string[];
  requiredMcpServers: string[];
  pricingModel: "FIXED" | "HOURLY" | "FROM";
  basePriceCents: number;
  endpointType: "LOCAL_WORKER" | "WEBHOOK" | "A2A";
  endpointUrl: string | null;
  authenticationType: "NONE" | "HMAC" | "API_KEY" | "OAUTH" | "A2A_METADATA";
  inputModes: string[];
  outputModes: string[];
};

export type WorkspaceAgent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  verificationStatus: string;
  availability: string;
  createdAt: string;
  skills: string[];
  taskTypes: string[];
  identity: {
    revision: number;
    profileSha256: string;
    status: string;
    controllerAccountId: string;
    controllerAssurance: string;
    legallyVerified: boolean;
  };
};

export type WorkspaceAuthority = {
  id: string;
  decision: string;
  allowedActions: string[];
  deniedActions: string[];
  allowedPaths: string[];
  repository: string;
  branch: string;
  maxRuntimeSeconds: number;
  sandboxProvider: string;
  executionBackend: string;
  networkPolicy: string;
  persistence: string;
  scopeSha256: string;
  decidedAt: string;
  permissionLeaseStatus: "NOT_ISSUED";
};

export type WorkspaceContract = {
  id: string;
  version: number;
  status: string;
  sha256: string;
  lockedAt: string;
  desiredOutcome: string;
  deliverables: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  allowedPaths: string[];
  requiredEvidence: string[];
  acceptanceChecks: Array<{ id: string; label: string; required: boolean }>;
  deliveryOutcomePolicy: typeof deliveryPolicies[number];
  sourceReference: { repository: string; branch: string; commitResolution: string };
  humanApprovalRequirements: string[];
};

export type WorkspaceReceipt = {
  id: string;
  publicId: string;
  result: string;
  schemaVersion: number | null;
  receiptType: string;
  createdAt: string;
  integrity: "VALID" | "INVALID";
  agentLabel: string;
  verifierLabel: string;
  sourceCommit: string | null;
  tests: string | null;
  build: string | null;
  executionOutcome: string | null;
  verificationOutcome: string | null;
  deliveryOutcome: string | null;
  historyStatus: "VERIFIED_WORK" | "VALID_RECEIPT_ONLY";
};

export type WorkspaceWork = {
  id: string;
  title: string;
  requestDescription: string;
  desiredOutcome: string;
  repository: string;
  targetBranch: string;
  taskType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  agent: WorkspaceAgent | null;
  contract: WorkspaceContract | null;
  authority: WorkspaceAuthority | null;
  execution: { state: string; detail: string; startedAt: string | null; finishedAt: string | null };
  verification: { state: string; detail: string; verifier: string | null };
  delivery: { state: string; detail: string };
  evidence: Array<{ label: string; value: string; tone: "neutral" | "success" | "warning" | "danger" }>;
  receipt: WorkspaceReceipt | null;
};

type Row = Record<string, unknown>;

export async function listWorkspaceAgents(actor: Actor): Promise<WorkspaceAgent[]> {
  const client = await createSupabaseUserClient();
  const { data: agents, error } = await client
    .from("agents")
    .select("id, slug, name, description, status, verification_status, availability, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error("WORKSPACE_AGENT_READ_FAILED");
  const rows = rowsOf(agents);
  if (!rows.length) return [];
  const ids = rows.map((row) => textOf(row.id));
  const [identitiesResult, skillsResult, typesResult] = await Promise.all([
    client.from("agent_identity_profiles").select("agent_id, revision, profile_sha256, profile_document").in("agent_id", ids).order("revision", { ascending: false }),
    client.from("agent_skills").select("agent_id, skill").in("agent_id", ids),
    client.from("agent_task_types").select("agent_id, task_type").in("agent_id", ids),
  ]);
  if (identitiesResult.error || skillsResult.error || typesResult.error) throw new Error("WORKSPACE_AGENT_READ_FAILED");

  const identities = rowsOf(identitiesResult.data);
  return rows.flatMap((row) => {
    const id = textOf(row.id);
    const identityRow = identities.find((identity) => textOf(identity.agent_id) === id);
    const identity = identityRow ? identityFromRow(identityRow) : null;
    if (!identity || identity.controllerAccountId !== actor.id) return [];
    return [{
      id,
      slug: textOf(row.slug),
      name: textOf(row.name),
      description: textOf(row.description),
      status: textOf(row.status),
      verificationStatus: textOf(row.verification_status),
      availability: textOf(row.availability),
      createdAt: textOf(row.created_at),
      skills: rowsOf(skillsResult.data).filter((item) => textOf(item.agent_id) === id).map((item) => textOf(item.skill)),
      taskTypes: rowsOf(typesResult.data).filter((item) => textOf(item.agent_id) === id).map((item) => textOf(item.task_type)),
      identity,
    }];
  });
}

export async function getWorkspaceAgent(actor: Actor, slug: string): Promise<WorkspaceAgent | null> {
  const agents = await listWorkspaceAgents(actor);
  return agents.find((agent) => agent.slug === slug) ?? null;
}

export async function createWorkspaceAgent(actor: Actor, input: WorkspaceAgentCreateInput) {
  const client = await createSupabaseUserClient();
  const agentId = randomUUID();
  const createdAt = new Date().toISOString();
  const identity = createAgentIdentityProfile({
    agentId,
    displayName: input.name,
    controller: {
      controllerType: "PLATFORM_ACCOUNT",
      accountType: "USER",
      accountId: actor.id,
      relationship: "CONTROLS",
      assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
      legallyVerified: false,
    },
    declaredCapabilities: [...input.skills, ...input.taskTypes],
    runtimeReferences: [{
      system: "DONE_LAYER",
      identifier: `workspace-agent:${agentId}`,
      verificationLevel: "OBSERVED",
    }],
    createdAt,
  });
  const { data, error } = await client.rpc("rpc_create_beta_workspace_agent", {
    p_agent: { id: agentId, createdAt, ...input },
    p_profile: identity,
  });
  if (error) throw mapWorkspaceError(error.message, "WORKSPACE_AGENT_CREATE_FAILED");
  const result = recordOf(data);
  if (textOf(result.agentId) !== agentId || textOf(result.slug) !== input.slug) {
    throw new Error("WORKSPACE_AGENT_CREATE_FAILED");
  }
  return { agentId, slug: input.slug };
}

export async function createWorkspaceWork(input: z.infer<typeof createWorkspaceWorkInputSchema>) {
  const client = await createSupabaseUserClient();
  const { data, error } = await client.rpc("rpc_create_beta_workspace_work", { p_work: input });
  if (error) throw mapWorkspaceError(error.message, "WORKSPACE_WORK_CREATE_FAILED");
  const result = recordOf(data);
  const taskId = textOf(result.taskId);
  if (!isUuid(taskId)) throw new Error("WORKSPACE_WORK_CREATE_FAILED");
  return { taskId };
}

export async function approveWorkspaceAuthority(input: {
  taskId: string;
  contractVersion: number;
  contractSha256: string;
}) {
  const client = await createSupabaseUserClient();
  const { data, error } = await client.rpc("rpc_approve_beta_workspace_authority", {
    p_task_id: input.taskId,
    p_expected_contract_version: input.contractVersion,
    p_expected_contract_sha256: input.contractSha256,
  });
  if (error) throw mapWorkspaceError(error.message, "WORKSPACE_AUTHORITY_APPROVAL_FAILED");
  return recordOf(data);
}

export async function listWorkspaceWorks(actor: Actor): Promise<WorkspaceWork[]> {
  const client = await createSupabaseUserClient();
  const { data, error } = await client
    .from("tasks")
    .select("id, title, problem_description, desired_outcome, repository_label, target_branch, category, status, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error("WORKSPACE_WORK_READ_FAILED");
  const tasks = rowsOf(data);
  if (!tasks.length) return [];
  const agents = await listWorkspaceAgents(actor);
  const relations = await loadWorkRelations(client, tasks.map((task) => textOf(task.id)));
  return tasks.map((task) => projectWork(task, agents, relations));
}

export async function getWorkspaceWork(actor: Actor, taskId: string): Promise<WorkspaceWork | null> {
  const client = await createSupabaseUserClient();
  const { data, error } = await client
    .from("tasks")
    .select("id, title, problem_description, desired_outcome, repository_label, target_branch, category, status, created_at, updated_at")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error("WORKSPACE_WORK_READ_FAILED");
  if (!data) return null;
  const agents = await listWorkspaceAgents(actor);
  const relations = await loadWorkRelations(client, [taskId]);
  return projectWork(recordOf(data), agents, relations);
}

type WorkRelations = {
  contracts: Row[];
  authority: Row[];
  assignments: Row[];
  jobs: Row[];
  verification: Row[];
  artifacts: Row[];
  ledger: Row[];
  receipts: Row[];
};

async function loadWorkRelations(client: Awaited<ReturnType<typeof createSupabaseUserClient>>, taskIds: string[]): Promise<WorkRelations> {
  const results = await Promise.all([
    client.from("task_contract_versions").select("id, task_id, version, status, contract_json, contract_sha256, locked_at, created_at").in("task_id", taskIds).order("version", { ascending: false }),
    client.from("workspace_authority_reviews").select("id, task_id, decision, scope_json, scope_sha256, decision_json, decided_at").in("task_id", taskIds).order("decided_at", { ascending: false }),
    client.from("task_assignments").select("id, task_id, agent_id, status, created_at").in("task_id", taskIds).order("created_at", { ascending: false }),
    client.from("job_runs").select("id, task_id, status, started_at, finished_at, commit_sha_before, commit_sha_after, failure_code, result, created_at").in("task_id", taskIds).order("created_at", { ascending: false }),
    client.from("verification_runs").select("id, task_id, status, verifier_version, required_check_count, passed_check_count, failed_check_count, summary, started_at, finished_at, created_at").in("task_id", taskIds).order("created_at", { ascending: false }),
    client.from("evidence_artifacts").select("id, task_id, artifact_type, file_name, mime_type, size_bytes, sha256, upload_status, verified_at, created_at").in("task_id", taskIds).order("created_at", { ascending: true }),
    client.from("evidence_ledger_entries").select("id, task_id, job_run_id, sequence_number, entry_type, source_record_type, source_record_id, payload_sha256, previous_entry_sha256, entry_sha256, created_at").in("task_id", taskIds).order("sequence_number", { ascending: true }),
    client.from("job_receipts").select("id, receipt_public_id, task_id, job_run_id, result, receipt_json, receipt_sha256, evidence_chain_sha256, created_at, invalidated_at, invalidation_reason").in("task_id", taskIds).order("created_at", { ascending: false }),
  ]);
  if (results.some((result) => result.error)) throw new Error("WORKSPACE_WORK_READ_FAILED");
  return {
    contracts: rowsOf(results[0].data),
    authority: rowsOf(results[1].data),
    assignments: rowsOf(results[2].data),
    jobs: rowsOf(results[3].data),
    verification: rowsOf(results[4].data),
    artifacts: rowsOf(results[5].data),
    ledger: rowsOf(results[6].data),
    receipts: rowsOf(results[7].data),
  };
}

function projectWork(task: Row, agents: WorkspaceAgent[], relations: WorkRelations): WorkspaceWork {
  const taskId = textOf(task.id);
  const contractRow = relations.contracts.find((row) => textOf(row.task_id) === taskId) ?? null;
  const authorityRow = relations.authority.find((row) => textOf(row.task_id) === taskId) ?? null;
  const assignmentRow = relations.assignments.find((row) => textOf(row.task_id) === taskId) ?? null;
  const jobRow = relations.jobs.find((row) => textOf(row.task_id) === taskId) ?? null;
  const verificationRow = relations.verification.find((row) => textOf(row.task_id) === taskId) ?? null;
  const receiptRow = relations.receipts.find((row) => textOf(row.task_id) === taskId) ?? null;
  const ledgerRows = relations.ledger.filter((row) => textOf(row.task_id) === taskId);
  const agent = agents.find((item) => item.id === textOf(assignmentRow?.agent_id)) ?? null;
  const contract = contractRow ? contractFromRow(contractRow) : null;
  const authority = authorityRow ? authorityFromRow(authorityRow) : null;
  const receipt = receiptRow ? receiptFromRow(receiptRow, ledgerRows) : null;
  const receiptDocument = recordOf(receiptRow?.receipt_json);
  const artifacts = relations.artifacts.filter((row) => textOf(row.task_id) === taskId);

  const executionState = jobRow ? textOf(jobRow.status) : "NOT_STARTED";
  const executionDetail = jobRow
    ? textOf(jobRow.failure_code) || `The latest Job Run is ${friendly(textOf(jobRow.status))}.`
    : authority
      ? "Authority is approved, but no Job Run has started."
      : "No execution is authorized or running.";
  const verificationState = receipt?.verificationOutcome
    || (verificationRow ? textOf(verificationRow.status) : "NOT_STARTED");
  const verificationDetail = verificationRow
    ? textOf(verificationRow.summary) || `${numberOf(verificationRow.passed_check_count)} of ${numberOf(verificationRow.required_check_count)} checks passed.`
    : "No independent verifier has run yet.";
  const deliveryState = receipt?.integrity === "INVALID"
    ? "INVALID_RECEIPT"
    : receipt?.deliveryOutcome || (receipt ? receipt.result : "NOT_DELIVERED");
  const deliveryDetail = receipt
    ? receipt.integrity === "VALID"
      ? "A durable Receipt is available for this delivery state."
      : "A Receipt record exists, but its integrity checks failed."
    : "No Verified Work Receipt has been issued.";

  const evidence: WorkspaceWork["evidence"] = [{
    label: "Source reference",
    value: `${textOf(task.repository_label)} on ${textOf(task.target_branch)}; exact commit must be resolved before a Permission Lease is issued.`,
    tone: "neutral",
  }];
  if (contract) evidence.push({
    label: "Locked acceptance",
    value: `${contract.acceptanceChecks.length} required Contract assertion${contract.acceptanceChecks.length === 1 ? "" : "s"}.`,
    tone: "success",
  });
  for (const artifact of artifacts) evidence.push({
    label: friendly(textOf(artifact.artifact_type)),
    value: `${textOf(artifact.file_name)} - ${friendly(textOf(artifact.upload_status))}${artifact.verified_at ? ` at ${textOf(artifact.verified_at)}` : ""}`,
    tone: textOf(artifact.upload_status) === "VERIFIED" ? "success" : "warning",
  });
  if (verificationRow) evidence.push({
    label: "Independent verifier",
    value: `${textOf(verificationRow.verifier_version)} reported ${friendly(textOf(verificationRow.status))}.`,
    tone: textOf(verificationRow.status) === "PASSED" ? "success" : "danger",
  });
  const buildTest = recordOf(recordOf(receiptDocument.whatHappened).buildTest);
  if (Object.keys(buildTest).length) {
    evidence.push({ label: "Build", value: commandSummary(buildTest.build), tone: commandTone(buildTest.build) });
    evidence.push({ label: "Tests", value: commandSummary(buildTest.test), tone: commandTone(buildTest.test) });
  }
  if (!jobRow) evidence.push({
    label: "Execution evidence",
    value: "Missing because execution has not started. No success is claimed.",
    tone: "warning",
  });

  return {
    id: taskId,
    title: textOf(task.title),
    requestDescription: textOf(task.problem_description),
    desiredOutcome: textOf(task.desired_outcome),
    repository: textOf(task.repository_label),
    targetBranch: textOf(task.target_branch),
    taskType: textOf(task.category),
    status: textOf(task.status),
    createdAt: textOf(task.created_at),
    updatedAt: textOf(task.updated_at),
    agent,
    contract,
    authority,
    execution: {
      state: executionState,
      detail: executionDetail,
      startedAt: jobRow ? nullableText(jobRow.started_at) : null,
      finishedAt: jobRow ? nullableText(jobRow.finished_at) : null,
    },
    verification: {
      state: verificationState,
      detail: verificationDetail,
      verifier: verificationRow ? textOf(verificationRow.verifier_version) : null,
    },
    delivery: { state: deliveryState, detail: deliveryDetail },
    evidence,
    receipt,
  };
}

function contractFromRow(row: Row): WorkspaceContract {
  const document = recordOf(row.contract_json);
  const policy = recordOf(document.deliveryOutcomePolicy);
  const source = recordOf(document.sourceReference);
  const authorityPolicy = recordOf(document.authorityPolicy);
  return {
    id: textOf(row.id),
    version: numberOf(row.version),
    status: textOf(row.status),
    sha256: textOf(row.contract_sha256),
    lockedAt: textOf(row.locked_at || row.created_at),
    desiredOutcome: textOf(document.desiredOutcome),
    deliverables: stringArray(document.deliverables),
    allowedActions: stringArray(document.allowedActions),
    forbiddenActions: stringArray(document.forbiddenActions),
    allowedPaths: stringArray(authorityPolicy.allowedPaths),
    requiredEvidence: stringArray(document.requiredEvidence),
    acceptanceChecks: rowsOf(document.acceptanceChecks).map((check) => ({
      id: textOf(check.id),
      label: textOf(check.label),
      required: check.required === true,
    })),
    deliveryOutcomePolicy: deliveryPolicies.includes(policy.policy as typeof deliveryPolicies[number])
      ? policy.policy as typeof deliveryPolicies[number]
      : "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
    sourceReference: {
      repository: textOf(source.repository),
      branch: textOf(source.branch),
      commitResolution: textOf(source.commitResolution),
    },
    humanApprovalRequirements: stringArray(document.humanApprovalRequirements),
  };
}

function authorityFromRow(row: Row): WorkspaceAuthority {
  const scope = recordOf(row.scope_json);
  const decision = recordOf(row.decision_json);
  return {
    id: textOf(row.id),
    decision: textOf(row.decision),
    allowedActions: stringArray(scope.allowedActions),
    deniedActions: stringArray(scope.deniedActions),
    allowedPaths: stringArray(scope.allowedPaths),
    repository: stringArray(scope.allowedRepositories)[0] ?? "Not recorded",
    branch: stringArray(scope.allowedBranches)[0] ?? "Not recorded",
    maxRuntimeSeconds: numberOf(scope.maxRuntimeSeconds),
    sandboxProvider: stringArray(scope.allowedSandboxProviders)[0] ?? "Not recorded",
    executionBackend: stringArray(scope.allowedExecutionBackends)[0] ?? "Not recorded",
    networkPolicy: textOf(scope.networkPolicy),
    persistence: textOf(scope.persistence),
    scopeSha256: textOf(row.scope_sha256),
    decidedAt: textOf(row.decided_at),
    permissionLeaseStatus: textOf(decision.permissionLeaseStatus) === "NOT_ISSUED" ? "NOT_ISSUED" : "NOT_ISSUED",
  };
}

function receiptFromRow(row: Row, ledgerRows: Row[]): WorkspaceReceipt {
  const document = recordOf(row.receipt_json);
  const summary = summarizeWorkspaceReceiptDocument(document);
  const ledger = ledgerRows.map((entry): EvidenceLedgerEntryRecord => ({
    id: textOf(entry.id),
    taskId: textOf(entry.task_id),
    jobRunId: textOf(entry.job_run_id),
    sequenceNumber: numberOf(entry.sequence_number),
    entryType: textOf(entry.entry_type) as EvidenceLedgerEntryRecord["entryType"],
    sourceRecordType: textOf(entry.source_record_type),
    sourceRecordId: textOf(entry.source_record_id),
    payloadSha256: textOf(entry.payload_sha256),
    previousEntrySha256: nullableText(entry.previous_entry_sha256),
    entrySha256: textOf(entry.entry_sha256),
    createdAt: normalizePersistedLedgerTimestamp(textOf(entry.created_at)),
  }));
  const chain = verifyEvidenceLedgerEntries(ledger);
  const receiptHashValid = sha256Canonical(document) === textOf(row.receipt_sha256);
  const receiptEntry = ledger.find((entry) => entry.entryType === "RECEIPT_CREATED" && entry.sourceRecordId === textOf(row.id));
  const receiptAnchorValid = Boolean(
    chain.valid
    && receiptEntry
    && ledger.at(-1)?.id === receiptEntry.id
    && receiptEntry.previousEntrySha256 === textOf(row.evidence_chain_sha256)
    && receiptEntry.payloadSha256 === textOf(row.receipt_sha256)
  );
  const documentedLedger = summary.documentedLedger;
  const documentedValid = documentedLedger.valid === true
    && textOf(documentedLedger.chainSha256) === textOf(row.evidence_chain_sha256);
  const resultMatchesDocument = summary.documentResult === null
    || summary.documentResult === textOf(row.result);
  const integrity = receiptHashValid
    && receiptAnchorValid
    && documentedValid
    && resultMatchesDocument
    && !row.invalidated_at
    ? "VALID"
    : "INVALID";
  return {
    id: textOf(row.id),
    publicId: textOf(row.receipt_public_id),
    result: textOf(row.result),
    schemaVersion: summary.schemaVersion,
    receiptType: summary.receiptType,
    createdAt: textOf(row.created_at),
    integrity,
    agentLabel: summary.agentLabel,
    verifierLabel: summary.verifierLabel,
    sourceCommit: summary.sourceCommit,
    tests: summary.tests,
    build: summary.build,
    executionOutcome: summary.executionOutcome,
    verificationOutcome: summary.verificationOutcome,
    deliveryOutcome: summary.deliveryOutcome,
    historyStatus: summary.historyStatus,
  };
}

function identityFromRow(row: Row): WorkspaceAgent["identity"] | null {
  const document = recordOf(row.profile_document) as AgentIdentityProfile;
  try {
    assertAgentIdentityProfileIntegrity(document);
  } catch {
    return null;
  }
  return {
    revision: numberOf(row.revision),
    profileSha256: textOf(row.profile_sha256),
    status: document.status,
    controllerAccountId: document.controller.accountId,
    controllerAssurance: document.controller.assurance,
    legallyVerified: document.controller.legallyVerified,
  };
}

function commandSummary(value: unknown): string {
  const command = recordOf(value);
  if (!Object.keys(command).length) return "Not present";
  const status = textOf(command.status) || (numberOf(command.exitCode) === 0 ? "PASSED" : "FAILED");
  return `${friendly(status)}${typeof command.exitCode === "number" ? ` (exit ${command.exitCode})` : ""}`;
}

function commandTone(value: unknown): "neutral" | "success" | "warning" | "danger" {
  const command = recordOf(value);
  const status = textOf(command.status);
  if (status === "PASSED" || command.exitCode === 0) return "success";
  if (status === "NOT_PRESENT") return "neutral";
  return "danger";
}

function mapWorkspaceError(message: string, fallback: string): Error {
  for (const code of [
    "WORKSPACE_AUTHENTICATION_REQUIRED",
    "WORKSPACE_AGENT_ACCESS_DENIED",
    "WORKSPACE_CONTRACT_STALE",
    "WORKSPACE_AUTHORITY_ALREADY_DECIDED",
    "AGENT_SLUG_CONFLICT",
  ]) {
    if (message.includes(code)) return new Error(code);
  }
  return new Error(fallback);
}

function recordOf(value: unknown): Row {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : {};
}

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(recordOf) : [];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function friendly(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function isUuid(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
