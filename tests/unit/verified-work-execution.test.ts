import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson, createAgentIdentityProfile } from "@donelayer/database";
import type { PermissionScope } from "@donelayer/worker-protocol";
import {
  GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
  precheckVerifiedWorkExecution,
  type CanonicalExecutionPrecheckInput,
} from "../../apps/web/src/server/verified-work-execution/contract";
import {
  assertCanonicalFinalization,
  parseCanonicalPreparedExecution,
  type CanonicalPreparedExecution,
} from "../../apps/web/src/server/verified-work-execution/lifecycle";

describe("canonical verified-work execution boundary", () => {
  it("passes the approved Gate 4A synthetic dry-run with zero side effects", () => {
    const result = precheckVerifiedWorkExecution(fixture({ mode: "DRY_RUN", contractStatus: "DRAFT" }));
    expect(result).toMatchObject({
      result: "CANONICAL_EXECUTION_PRECHECK_PASS",
      workflow: GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
      jobCreated: false,
      modelRequests: 0,
      sandboxRuns: 0,
      corpusContribution: 0,
      reputationCalculations: 0,
    });
  });

  const rejectionCases: Array<[string, FixtureOverrides, string]> = [
    ["unlocked Contract", { contractStatus: "DRAFT" }, "CANONICAL_CONTRACT_NOT_LOCKED"],
    ["wrong Contract hash", { requestedContractSha256: "a".repeat(64) }, "CANONICAL_CONTRACT_HASH_MISMATCH"],
    ["wrong Authority", { requestedAuthorityId: "29a12586-594b-4ed5-8f48-2fd8297a2344" }, "CANONICAL_AUTHORITY_LINEAGE_MISMATCH"],
    ["wrong Authority hash", { requestedAuthorityScopeSha256: "b".repeat(64) }, "CANONICAL_AUTHORITY_HASH_MISMATCH"],
    ["Contract and Authority lineage mismatch", { authorityContractId: "52b3fb5c-0cbd-4aaa-96e1-6adb46ba0486" }, "CANONICAL_AUTHORITY_LINEAGE_MISMATCH"],
    ["wrong source Commit", { requestedCommit: "c".repeat(40) }, "CANONICAL_SOURCE_MISMATCH"],
    ["unauthorized file", { requestedFiles: ["package.json"] }, "CANONICAL_FILE_SCOPE_MISMATCH"],
    ["unsupported workflow", { requestedWorkflow: "ARBITRARY_SHELL" }, "CANONICAL_WORKFLOW_UNSUPPORTED"],
    ["anonymous actor", { actorAuthUserId: null }, "CANONICAL_EXECUTION_AUTHENTICATION_REQUIRED"],
    ["cross-account actor", { actorAuthUserId: "cf8629ff-285d-4a79-96ca-30b765d11296" }, "CANONICAL_EXECUTION_OWNER_MISMATCH"],
  ];

  it.each(rejectionCases)("rejects %s", (_label, overrides, code) => {
    expect(() => precheckVerifiedWorkExecution(fixture(overrides))).toThrow(code);
  });

  it("binds the immutable prepared envelope and rejects tampering", () => {
    const prepared = preparedFixture();
    expect(parseCanonicalPreparedExecution(prepared)).toMatchObject({ prepared: true, reused: false });
    expect(() => parseCanonicalPreparedExecution({ ...prepared, source: { ...prepared.source, commitSha: "f".repeat(40) } }))
      .toThrow("CANONICAL_EXECUTION_ENVELOPE_TAMPERED");
  });

  it("requires exact finalization lineage and independent verification", () => {
    const prepared = preparedFixture();
    const valid = finalizationFixture(prepared);
    expect(() => assertCanonicalFinalization(valid)).not.toThrow();
    expect(() => assertCanonicalFinalization({ ...valid, contractSha256: "d".repeat(64) }))
      .toThrow("CANONICAL_FINALIZATION_LINEAGE_MISMATCH");
    expect(() => assertCanonicalFinalization({ ...valid, independentVerificationOutcome: "FAILED" }))
      .toThrow("CANONICAL_VERIFIED_DELIVERY_NOT_PROVEN");
    expect(() => assertCanonicalFinalization({ ...valid, unresolvedPolicyViolations: ["FILE_SCOPE"] }))
      .toThrow("CANONICAL_FINALIZATION_POLICY_VIOLATION");
  });

  it("deduplicates repeated and concurrent preparation and handles stale retries deterministically", async () => {
    const store = new InMemoryPreparationBoundary();
    const input = fixture();
    const repeated = await Promise.all([store.prepare(input), store.prepare(input), store.prepare(input)]);
    expect(new Set(repeated.map((entry) => entry.jobRunId)).size).toBe(1);
    expect(store.jobCount).toBe(1);
    expect(repeated.filter((entry) => entry.reused)).toHaveLength(2);

    const stale = await store.prepare(input);
    expect(stale).toMatchObject({ jobRunId: repeated[0]!.jobRunId, reused: true });
    expect(store.jobCount).toBe(1);
    expect(store.receiptCount).toBe(0);
    expect(store.ledgerCount).toBe(0);
  });

  it("makes failure idempotent and requires new Work instead of retrying a terminal Job", async () => {
    const store = new InMemoryPreparationBoundary();
    const input = fixture();
    const prepared = await store.prepare(input);
    expect(store.fail(prepared.jobRunId, "EXECUTOR_FAILED")).toEqual({ replayed: false });
    expect(store.fail(prepared.jobRunId, "EXECUTOR_FAILED")).toEqual({ replayed: true });
    expect(store.failureEventCount).toBe(1);
    await expect(store.prepare(input)).rejects.toThrow("CANONICAL_EXECUTION_TERMINAL_FAILURE_REQUIRES_NEW_WORK");
    expect(store.jobCount).toBe(1);
    expect(store.corpusContribution).toBe(0);
    expect(store.reputationCalculations).toBe(0);
  });
});

type FixtureOverrides = {
  mode?: "DRY_RUN" | "EXECUTE";
  contractStatus?: "DRAFT" | "LOCKED";
  requestedContractSha256?: string;
  requestedAuthorityId?: string;
  requestedAuthorityScopeSha256?: string;
  authorityContractId?: string;
  requestedCommit?: string;
  requestedFiles?: string[];
  requestedWorkflow?: string;
  actorAuthUserId?: string | null;
};

function fixture(overrides: FixtureOverrides = {}): CanonicalExecutionPrecheckInput {
  const workId = "5c1a26c7-f803-48b1-aead-9beb1398ace1";
  const contractId = "37a83635-ee8e-4bef-ab7e-720d753a3b11";
  const authorityId = "dd6b74de-eb5f-43fe-a82f-a0339ffafdb7";
  const ownerAuthUserId = "2a711405-a417-4f47-b39e-80e3169fc3f7";
  const contractSha256 = "b2a9189c76c29ca6081288c4083f92353be60dc9772877a383f8ce29c01fb9ab";
  const authorityScopeSha256 = "341ebb78f90ac8595ed018971c63a74246b573a8ae5a62d6cd47ed9e6f3744b2";
  const source = {
    repository: "https://github.com/NickHOI/Agent.git",
    commitSha: "1".repeat(40),
    treeSha: "2".repeat(40),
  };
  const files = [
    "apps/web/src/app/api/workspace/receipts/[receiptId]/download/route.ts",
    "apps/web/src/server/workspace-public-receipt-projection.ts",
    "apps/web/src/server/workspace-public-receipt.ts",
  ];
  const actions = ["collect_evidence", "create_patch", "independently_verify", "read_source", "run_locked_verification"];
  const limits = {
    maxArtifactBytes: 2 * 1024 * 1024,
    maxRuntimeSeconds: 600,
    maxSandboxes: 2,
    maxCommands: 10,
    maxStdoutBytes: 256 * 1024,
    maxStderrBytes: 256 * 1024,
    maxApiBudget: 0,
  };
  return {
    mode: overrides.mode ?? "EXECUTE",
    actorAuthUserId: overrides.actorAuthUserId === undefined ? ownerAuthUserId : overrides.actorAuthUserId,
    ownerAuthUserId,
    workId,
    contract: {
      id: contractId,
      workId,
      status: overrides.contractStatus ?? "LOCKED",
      sha256: contractSha256,
      workflow: GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
      source,
      allowedFiles: files,
      allowedActions: actions,
      allowedDomains: ["registry.npmjs.org"],
      limits,
      networkPolicy: "deny-all",
      persistence: "none",
      deliveryOutcomePolicy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
    },
    authority: {
      id: authorityId,
      workId,
      contractId: overrides.authorityContractId ?? contractId,
      decision: "APPROVED",
      scopeSha256: authorityScopeSha256,
      allowedRepositories: [source.repository],
      allowedCommitShas: [source.commitSha],
      allowedTreeShas: [source.treeSha],
      allowedFiles: files,
      allowedActions: actions,
      allowedDomains: ["registry.npmjs.org"],
      allowedWorkflows: [GATE_4A_EXTERNAL_REVIEW_WORKFLOW],
      limits,
      networkPolicy: "deny-all",
      persistence: "none",
    },
    requestedContractSha256: overrides.requestedContractSha256 ?? contractSha256,
    requestedAuthorityId: overrides.requestedAuthorityId ?? authorityId,
    requestedAuthorityScopeSha256: overrides.requestedAuthorityScopeSha256 ?? authorityScopeSha256,
    requestedSource: { ...source, commitSha: overrides.requestedCommit ?? source.commitSha },
    requestedWorkflow: overrides.requestedWorkflow ?? GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
    requestedFiles: overrides.requestedFiles ?? files,
  };
}

function preparedFixture(): CanonicalPreparedExecution {
  const startedAt = "2026-09-14T12:00:00.000Z";
  const permissionScope: PermissionScope = {
    allowedActions: ["read_source", "create_patch", "independently_verify"],
    deniedActions: ["production_deploy"],
    allowedPaths: ["$JOB_WORKSPACE"],
    allowedDomains: [],
    allowedRepositories: ["https://github.com/NickHOI/Agent.git"],
    allowedBranches: ["codex/gate-4a-canonical-orchestration-baseline"],
    allowedCommitShas: ["1".repeat(40)],
    allowedTreeShas: ["2".repeat(40)],
    allowedSandboxProviders: ["VERCEL_SANDBOX"],
    allowedExecutionBackends: ["MANAGED_REMOTE_SANDBOX"],
    allowedWorkflows: [GATE_4A_EXTERNAL_REVIEW_WORKFLOW],
    allowedFiles: ["apps/web/src/server/workspace-public-receipt.ts"],
    allowedEnvironmentVariables: [],
    maxArtifactBytes: 2 * 1024 * 1024,
    maxRuntimeSeconds: 600,
    maxApiBudget: 0,
    maxSandboxes: 2,
    maxCommands: 10,
    maxStdoutBytes: 256 * 1024,
    maxStderrBytes: 256 * 1024,
    networkPolicy: "deny-all",
    persistence: "none",
    humanApprovalActions: [],
  };
  const base = {
    startedAt,
    taskId: "5c1a26c7-f803-48b1-aead-9beb1398ace1",
    assignmentId: "3ab7951a-dfd0-41b1-84f9-cd8ad57c256a",
    agentId: "ab2b64ee-841a-45e9-b46b-72551665241d",
    workerId: "d3ba8a95-7556-461e-971f-d502f0f49a23",
    jobRunId: "7d0521b1-ae8e-44f9-ae0c-d6d741f11193",
    workerLeaseId: "9cd05736-970a-4ad2-8cef-c18854b7c0bb",
    permissionLeaseId: "42bfb550-2418-475c-94a1-9b5aacd2fb24",
    contractId: "37a83635-ee8e-4bef-ab7e-720d753a3b11",
    contractVersion: 2,
    contractSha256: "3".repeat(64),
    authorityId: "dd6b74de-eb5f-43fe-a82f-a0339ffafdb7",
    authorityScopeSha256: "4".repeat(64),
    source: {
      repository: "https://github.com/NickHOI/Agent.git",
      commitSha: "1".repeat(40),
      treeSha: "2".repeat(40),
    },
    workflow: GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
    workflowSource: "SERVER_REGISTRY:GATE_4A_EXTERNAL_REVIEW_EXPORT_BUNDLE_V1",
    permissionScope,
  } as const;
  const envelopeBody = {
    schemaVersion: 1,
    bindingType: "CANONICAL_VERIFIED_WORK_EXECUTION_V1",
    taskId: base.taskId,
    assignmentId: base.assignmentId,
    jobRunId: base.jobRunId,
    workerId: base.workerId,
    workerLeaseId: base.workerLeaseId,
    permissionLeaseId: base.permissionLeaseId,
    contract: { id: base.contractId, version: base.contractVersion, sha256: base.contractSha256 },
    authority: { id: base.authorityId, scopeSha256: base.authorityScopeSha256 },
    source: base.source,
    workflow: base.workflow,
    workflowSource: base.workflowSource,
    permissionScope,
    startedAt,
  };
  const envelopeCanonical = canonicalJson(envelopeBody);
  return {
    prepared: true,
    reused: false,
    ...base,
    contract: {},
    authorityScope: {},
    agentIdentity: createAgentIdentityProfile({
      agentId: base.agentId,
      displayName: "Canonical Worker",
      controller: {
        controllerType: "PLATFORM_ACCOUNT",
        accountType: "USER",
        accountId: "2a711405-a417-4f47-b39e-80e3169fc3f7",
        relationship: "CONTROLS",
        assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
        legallyVerified: false,
      },
      declaredCapabilities: ["FEATURE_IMPLEMENTATION"],
      createdAt: startedAt,
    }),
    envelopeCanonical,
    envelopeSha256: createHash("sha256").update(envelopeCanonical, "utf8").digest("hex"),
    idempotencyKey: "5".repeat(64),
  };
}

function finalizationFixture(envelope: CanonicalPreparedExecution) {
  return {
    envelope,
    taskId: envelope.taskId,
    jobRunId: envelope.jobRunId,
    contractId: envelope.contractId,
    contractSha256: envelope.contractSha256,
    authorityId: envelope.authorityId,
    authorityScopeSha256: envelope.authorityScopeSha256,
    envelopeSha256: envelope.envelopeSha256,
    workerId: envelope.workerId,
    workerLeaseId: envelope.workerLeaseId,
    permissionLeaseId: envelope.permissionLeaseId,
    jobStatus: "RUNNING" as const,
    workerLeaseActive: true,
    permissionLeaseActive: true,
    permissionLeaseExpired: false,
    executionOutcome: "COMPLETED" as const,
    independentVerificationOutcome: "VERIFIED" as const,
    deliveryOutcome: "VERIFIED_DELIVERY" as const,
    requiredEvidenceComplete: true,
    artifactCount: 3,
    executionSandboxCleanupVerified: true,
    verifierSandboxCleanupVerified: true,
    unresolvedPolicyViolations: [],
  };
}

class InMemoryPreparationBoundary {
  private readonly records = new Map<string, { jobRunId: string; status: "RUNNING" | "FAILED"; failureCode?: string }>();
  private nextJob = 1;
  failureEventCount = 0;
  receiptCount = 0;
  ledgerCount = 0;
  corpusContribution = 0;
  reputationCalculations = 0;

  get jobCount(): number {
    return this.records.size;
  }

  async prepare(input: CanonicalExecutionPrecheckInput): Promise<{ jobRunId: string; reused: boolean }> {
    const check = precheckVerifiedWorkExecution(input);
    await Promise.resolve();
    const existing = this.records.get(check.envelopeSha256);
    if (existing?.status === "FAILED") throw new Error("CANONICAL_EXECUTION_TERMINAL_FAILURE_REQUIRES_NEW_WORK");
    if (existing) return { jobRunId: existing.jobRunId, reused: true };
    const jobRunId = `job-${this.nextJob++}`;
    this.records.set(check.envelopeSha256, { jobRunId, status: "RUNNING" });
    return { jobRunId, reused: false };
  }

  fail(jobRunId: string, failureCode: string): { replayed: boolean } {
    const record = [...this.records.values()].find((entry) => entry.jobRunId === jobRunId);
    if (!record) throw new Error("CANONICAL_JOB_NOT_FOUND");
    if (record.status === "FAILED") {
      if (record.failureCode !== failureCode) throw new Error("CANONICAL_FAILURE_REPLAY_MISMATCH");
      return { replayed: true };
    }
    record.status = "FAILED";
    record.failureCode = failureCode;
    this.failureEventCount += 1;
    return { replayed: false };
  }
}
