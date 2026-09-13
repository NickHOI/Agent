import { describe, expect, it } from "vitest";

import {
  MANAGED_SANDBOX_EXECUTION_BACKEND,
  MANAGED_SANDBOX_PROVIDER,
} from "@donelayer/worker-protocol";

import { AgentRepairOrchestrator } from "../../apps/web/src/server/agent-execution/agent-repair-orchestrator";
import { DirectOpenAIAgentProvider } from "../../apps/web/src/server/agent-execution/provider";
import { createAdditionSemanticContract } from "../../apps/web/src/server/semantic-verification/semantic-contract";
import {
  assertTaskScopedAuthorityGateReceiptIntegrity,
  TaskScopedAuthorityGateOrchestrator,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority-gate";
import {
  assertTaskScopedPermissionLeaseIntegrity,
  decideTaskScopedAuthority,
  issueTaskScopedPermissionLease,
  requireTaskScopedAuthorityGuard,
  revokeTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_ISSUER,
  taskScopedAuthorityScope,
  TaskScopedAuthorityGuard,
  type TaskScopedAuthorityOperationEvidence,
  type TaskScopedAuthoritySubject,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority";

const commitSha = "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00";
const decidedAt = "2026-09-03T14:00:00.000Z";
const duringLease = new Date("2026-09-03T14:01:00.000Z");
const subject: TaskScopedAuthoritySubject = {
  agentId: "vercel-ai-gateway-agent",
  executorId: "done-layer-server-side-orchestrator",
  jobRunId: "authority-gate-job-v1",
};

describe("Task-scoped Agent Authority V1", () => {
  it("issues one finite Permission Lease bound to the exact Work Contract and recipient", () => {
    const contract = workContract("authority-happy-path");
    const decision = decideTaskScopedAuthority({
      contract,
      subject,
      decidedAt,
      approvals: [ownerApproval()],
    });
    const lease = issueTaskScopedPermissionLease(decision);
    const operations: TaskScopedAuthorityOperationEvidence[] = [];
    const guard = new TaskScopedAuthorityGuard(lease, {
      contract,
      subject,
      onDecision: (operation) => operations.push(operation),
    });

    expect(decision).toMatchObject({
      decision: "APPROVED",
      decidedBy: { actorType: "PLATFORM", actorId: TASK_SCOPED_AUTHORITY_ISSUER },
      workContract: { id: contract.taskId, version: 1, sha256: contract.workContractSha256 },
    });
    expect(lease).toMatchObject({
      status: "ACTIVE",
      version: 1,
      authorityType: "TASK_SCOPED_AUTHORITY_V1",
      authority: {
        workContract: decision.workContract,
        subject,
        resources: {
          repository: contract.remoteUrl,
          baseRef: contract.branch,
          baseCommitSha: contract.commitSha,
          deliveryBranchPrefix: "donelayer/repair/",
          allowedFiles: ["src/add.ts"],
        },
      },
    });
    expect(Date.parse(lease.expiresAt) - Date.parse(lease.startsAt)).toBe(600_000);
    expect(() => assertTaskScopedPermissionLeaseIntegrity(lease)).not.toThrow();

    guard.assertRepositoryReadAllowed({ remoteUrl: contract.remoteUrl, baseRef: contract.branch, commitSha }, duringLease);
    guard.assertDeliveryBranchAllowed("donelayer/repair/authority-v1", duringLease);
    guard.assertPatchAllowed(["src/add.ts"], duringLease);
    guard.assertSandboxAllowed({
      purpose: "AGENT_REPAIR",
      provider: MANAGED_SANDBOX_PROVIDER,
      executionBackend: MANAGED_SANDBOX_EXECUTION_BACKEND,
      requestedSandboxCount: 1,
    }, duringLease);
    guard.assertSandboxAllowed({
      purpose: "INDEPENDENT_VERIFICATION",
      provider: MANAGED_SANDBOX_PROVIDER,
      executionBackend: MANAGED_SANDBOX_EXECUTION_BACKEND,
      requestedSandboxCount: 1,
    }, duringLease);
    expect(() => guard.assertSandboxAllowed({
      purpose: "INDEPENDENT_VERIFICATION",
      provider: MANAGED_SANDBOX_PROVIDER,
      executionBackend: MANAGED_SANDBOX_EXECUTION_BACKEND,
      requestedSandboxCount: 1,
    }, duringLease)).toThrow(/exceeds/i);
    guard.assertFixedTestsAllowed(duringLease);
    guard.assertPullRequestCreateAllowed({
      remoteUrl: contract.remoteUrl,
      baseRef: contract.branch,
      headBranch: "donelayer/repair/authority-v1",
    }, duringLease);

    expect(operations).toHaveLength(8);
    expect(operations.filter((operation) => operation.decision === "ALLOWED")).toHaveLength(7);
    expect(operations.filter((operation) => operation.decision === "DENIED")).toHaveLength(1);
    expect(operations.every((operation) => operation.authoritySha256 === lease.authoritySha256)).toBe(true);
  });

  it("denies the wrong repository, base ref, Commit, delivery namespace, and file", () => {
    const contract = workContract("authority-resource-denials");
    const lease = issueTaskScopedPermissionLease(decideTaskScopedAuthority({ contract, subject, decidedAt }));
    const denied: TaskScopedAuthorityOperationEvidence[] = [];
    const guard = new TaskScopedAuthorityGuard(lease, {
      contract,
      subject,
      onDecision: (operation) => denied.push(operation),
    });

    expect(() => guard.assertRepositoryReadAllowed({
      remoteUrl: "https://github.com/NickHOI/other.git",
      baseRef: contract.branch,
      commitSha,
    }, duringLease)).toThrow(/Repository is not allowed/i);
    expect(() => guard.assertRepositoryReadAllowed({
      remoteUrl: contract.remoteUrl,
      baseRef: "main",
      commitSha,
    }, duringLease)).toThrow(/Branch is not allowed/i);
    expect(() => guard.assertRepositoryReadAllowed({
      remoteUrl: contract.remoteUrl,
      baseRef: contract.branch,
      commitSha: "1".repeat(40),
    }, duringLease)).toThrow(/Commit is not allowed/i);
    expect(() => guard.assertDeliveryBranchAllowed("main", duringLease)).toThrow(/namespace/i);
    expect(() => guard.assertPatchAllowed(["tests/add.test.ts"], duringLease)).toThrow(/file outside/i);
    expect(denied).toHaveLength(5);
    expect(denied.every((operation) => operation.decision === "DENIED")).toBe(true);
  });

  it("denies missing authority and reuse across a different Contract, Agent, executor, or Job", () => {
    const contract = workContract("authority-binding-a");
    const lease = issueTaskScopedPermissionLease(decideTaskScopedAuthority({ contract, subject, decidedAt }));

    expect(() => requireTaskScopedAuthorityGuard(null, { contract, subject })).toThrow("TASK_SCOPED_AUTHORITY_REQUIRED");
    expect(() => new TaskScopedAuthorityGuard(lease, {
      contract: workContract("authority-binding-b"),
      subject,
    })).toThrow("TASK_SCOPED_AUTHORITY_BINDING_MISMATCH");
    for (const changed of [
      { ...subject, agentId: "other-agent" },
      { ...subject, executorId: "other-executor" },
      { ...subject, jobRunId: "other-job" },
    ]) {
      expect(() => new TaskScopedAuthorityGuard(lease, { contract, subject: changed })).toThrow("TASK_SCOPED_AUTHORITY_BINDING_MISMATCH");
    }
  });

  it("blocks a Work Contract repair before source materialization when authority is missing", async () => {
    const contract = workContract("authority-required-before-source");
    await expect(new AgentRepairOrchestrator(new DirectOpenAIAgentProvider()).run({
      branch: "fixture/real-source-bug-v1",
      expectedCommitSha: commitSha,
      semanticContract: contract,
    })).rejects.toThrow("TASK_SCOPED_AUTHORITY_REQUIRED");
  });

  it("fails closed at expiry and after revocation, and terminal authority cannot reactivate", () => {
    const contract = workContract("authority-lifecycle");
    const active = issueTaskScopedPermissionLease(decideTaskScopedAuthority({ contract, subject, decidedAt }));
    const activeGuard = new TaskScopedAuthorityGuard(active, { contract, subject });
    expect(() => activeGuard.assertFixedTestsAllowed(new Date(active.expiresAt))).toThrow(/not active/i);

    const revoked = revokeTaskScopedPermissionLease({
      lease: active,
      revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
      reason: "Bounded Gate action completed",
      revokedAt: "2026-09-03T14:02:00.000Z",
    });
    expect(revoked).toMatchObject({ status: "REVOKED", revocationReason: "Bounded Gate action completed" });
    expect(() => new TaskScopedAuthorityGuard(revoked, { contract, subject }).assertFixedTestsAllowed(duringLease)).toThrow(/not active/i);
    expect(() => revokeTaskScopedPermissionLease({
      lease: revoked,
      revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
      reason: "Reactivate",
    })).toThrow("TASK_SCOPED_AUTHORITY_TERMINAL");
  });

  it("denies scope widening, mutation after issuance, and Agent self-authorization", () => {
    const contract = workContract("authority-widening");
    const widenedScope = taskScopedAuthorityScope(contract);
    widenedScope.allowedRepositories!.push("https://github.com/NickHOI/other.git");
    widenedScope.allowedActions.push("merge_pull_request");
    const denied = decideTaskScopedAuthority({ contract, subject, decidedAt, requestedScope: widenedScope });
    expect(denied).toMatchObject({ decision: "DENIED" });
    expect(denied.reasons).toEqual(expect.arrayContaining([
      "Repository scope is not exact",
      "Requested actions exceed the locked Work Contract",
    ]));
    expect(() => issueTaskScopedPermissionLease(denied)).toThrow("TASK_SCOPED_AUTHORITY_DECISION_DENIED");

    const lease = issueTaskScopedPermissionLease(decideTaskScopedAuthority({ contract, subject, decidedAt }));
    const tampered = structuredClone(lease);
    tampered.scope.allowedActions.push("merge_pull_request");
    expect(() => assertTaskScopedPermissionLeaseIntegrity(tampered)).toThrow("TASK_SCOPED_AUTHORITY_LEASE_TAMPERING_DETECTED");

    const selfAuthorized = decideTaskScopedAuthority({
      contract,
      subject,
      decidedAt,
      requestedBy: { actorType: "AGENT", actorId: subject.agentId },
    });
    expect(selfAuthorized).toMatchObject({ decision: "DENIED" });
    expect(selfAuthorized.reasons).toContain("Only the DoneLayer Server may issue task-scoped authority");
  });

  it("keeps PR creation approval separate and never infers merge or deployment authority", () => {
    const contract = workContract("authority-high-risk-actions");
    const lease = issueTaskScopedPermissionLease(decideTaskScopedAuthority({ contract, subject, decidedAt }));
    const guard = new TaskScopedAuthorityGuard(lease, { contract, subject });

    expect(() => guard.assertPullRequestCreateAllowed({
      remoteUrl: contract.remoteUrl,
      baseRef: contract.branch,
      headBranch: "donelayer/repair/authority-v1",
    }, duringLease)).toThrow(/requires prior recorded Owner approval/i);
    expect(() => guard.assertPullRequestMergeAllowed(duringLease)).toThrow(/explicitly denied/i);
    expect(() => guard.assertProductionDeploymentAllowed(duringLease)).toThrow(/explicitly denied/i);
    expect(() => guard.assertActionAllowedWithEvidence("unknown_action", duringLease)).toThrow(/not allowed/i);
  });

  it("binds one guarded repository read and all denial evidence into an authority Receipt", async () => {
    let repositoryReads = 0;
    const outcome = await new TaskScopedAuthorityGateOrchestrator({
      checkAvailability: async () => ({
        available: true,
        checkedAt: new Date().toISOString(),
        authenticationMode: "OWNER_DEVELOPMENT_GITHUB_AUTH",
        accountLogin: "NickHOI",
        gitVersion: "git version test",
        ghVersion: "gh version test",
        errorCode: null,
        errorMessage: null,
      }),
      verifyRepository: async (input) => {
        repositoryReads += 1;
        return {
          repositoryId: "fixture-repository-id",
          repository: "NickHOI/donelayer-build-rescue-fixture",
          remoteUrl: input.remoteUrl,
          baseBranch: input.baseBranch,
          expectedBaseCommit: input.expectedBaseCommit,
          remoteBaseCommit: input.expectedBaseCommit,
          expectedCommitExists: true,
          private: false,
          verifiedAt: new Date().toISOString(),
        };
      },
    }).run();

    expect(repositoryReads).toBe(1);
    expect(outcome).toMatchObject({
      status: "AUTHORITY_VERIFIED",
      decision: { decision: "APPROVED" },
      issuedLease: { status: "ACTIVE" },
      finalLease: { status: "REVOKED" },
      liveAction: { action: "READ_EXACT_FIXTURE_SOURCE_IDENTITY", mutating: false },
      receipt: { result: "AUTHORITY_VERIFIED" },
    });
    expect(outcome.protectedOperations.filter((operation) => operation.decision === "ALLOWED")).toHaveLength(1);
    expect(outcome.protectedOperations.filter((operation) => operation.decision === "DENIED")).toHaveLength(7);
    expect(outcome.ledgerEntries.map((entry) => entry.entryType)).toEqual(expect.arrayContaining([
      "AUTHORITY_DECISION_RECORDED",
      "PERMISSION_GRANTED",
      "PROTECTED_ACTION_ALLOWED",
      "PROTECTED_ACTION_DENIED",
      "PERMISSION_LEASE_REVOKED",
      "RECEIPT_CREATED",
    ]));
    expect(() => assertTaskScopedAuthorityGateReceiptIntegrity(outcome)).not.toThrow();
  });
});

function workContract(taskId: string) {
  return createAdditionSemanticContract({
    taskId,
    branch: "fixture/real-source-bug-v1",
    commitSha,
    lockedAt: "2026-09-03T13:59:00.000Z",
  });
}

function ownerApproval() {
  return {
    action: "create_pull_request" as const,
    decisionId: "owner-gate-approval-v1",
    approverType: "OWNER" as const,
    approverId: "owner-review",
    approvedAt: decidedAt,
  };
}
