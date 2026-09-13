import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Canonical } from "@donelayer/database";

import {
  agentIdentityReference,
  createAgentIdentityProfile,
} from "../../apps/web/src/server/agent-identity/agent-identity";
import {
  createAgentExecutionIdentity,
  generateExecutionId,
} from "../../apps/web/src/server/agent-identity/execution-identity";
import {
  assertReputationEntryWorkContractIntegrity,
  createReputationEntryWorkContract,
} from "../../apps/web/src/server/reputation-entry-pilot/work-contract";
import {
  REPUTATION_ENTRY_CANDIDATE_STATUS_SEMANTICS,
  isVerifiedReputationEntryCandidateResult,
} from "../../apps/web/src/server/reputation-entry-pilot/candidate-evidence";
import {
  decideTaskScopedAuthority,
  issueTaskScopedPermissionLease,
  revokeTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_ISSUER,
  taskScopedAuthorityScope,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority";

const profile = createAgentIdentityProfile({
  displayName: "Owner Pilot Agent",
  controller: {
    controllerType: "PLATFORM_ACCOUNT",
    accountType: "USER",
    accountId: "owner-test",
    relationship: "CONTROLS",
    assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
    legallyVerified: false,
  },
  declaredCapabilities: ["TEST_AND_FIX", "BUILD_RESCUE"],
  createdAt: "2026-09-03T20:00:00.000Z",
});

describe("Reputation entry candidate contracts", () => {
  it("treats candidateStatus as workflow metadata and requires VERIFIED for a verified candidate result", () => {
    expect(REPUTATION_ENTRY_CANDIDATE_STATUS_SEMANTICS).toBe("CANDIDATE_COLLECTION_WORKFLOW_MEMBERSHIP_ONLY");
    expect(isVerifiedReputationEntryCandidateResult("FAILED")).toBe(false);
    expect(isVerifiedReputationEntryCandidateResult("INCONCLUSIVE")).toBe(false);
    expect(isVerifiedReputationEntryCandidateResult("VERIFIED")).toBe(true);
  });

  it("compares command objects canonically while preserving array order", () => {
    const expected = [
      {
        id: "build",
        command: "npm",
        args: ["run", "build"],
        cwd: "workspace",
        expectedExitCode: 0,
        options: { environment: { CI: true, NODE_ENV: "test" }, timeoutSeconds: 60 },
      },
      { id: "test", command: "npm", args: ["test"], cwd: "workspace", expectedExitCode: 0 },
    ];
    const equivalentWithDifferentKeyOrder = [
      {
        options: { timeoutSeconds: 60, environment: { NODE_ENV: "test", CI: true } },
        expectedExitCode: 0,
        cwd: "workspace",
        args: ["run", "build"],
        command: "npm",
        id: "build",
      },
      { expectedExitCode: 0, cwd: "workspace", args: ["test"], command: "npm", id: "test" },
    ];
    const changed = (mutate: (commands: Array<Record<string, unknown>>) => void) => {
      const commands = structuredClone(expected) as Array<Record<string, unknown>>;
      mutate(commands);
      return commands;
    };

    expect(canonicalJson(equivalentWithDifferentKeyOrder)).toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { commands[0]!.command = "node"; }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { (commands[0]!.args as string[])[1] = "test"; }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { (commands[0]!.args as string[]).pop(); }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { (commands[0]!.args as string[]).push("--silent"); }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { commands[0]!.cwd = "other"; }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { delete commands[0]!.cwd; }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { commands[0]!.shell = true; }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { (commands[0]!.args as string[]).reverse(); }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => { commands.reverse(); }))).not.toBe(canonicalJson(expected));
    expect(canonicalJson(changed((commands) => {
      ((commands[0]!.options as Record<string, unknown>).environment as Record<string, unknown>).CI = false;
    }))).not.toBe(canonicalJson(expected));
  });

  it("accepts a persisted Contract whose object keys were canonically reordered", () => {
    const locked = contract("TEST_AND_FIX", "0".repeat(40), ["src/order-state.ts", "tests/order-state.test.ts"]);
    const reloaded = JSON.parse(canonicalJson(locked));

    expect(() => assertReputationEntryWorkContractIntegrity(reloaded)).not.toThrow();
  });

  it("locks two genuinely different task types to one active Agent profile revision", () => {
    const testContract = contract("TEST_AND_FIX", "1".repeat(40), [
      "src/order-state.ts",
      "tests/order-state.test.ts",
    ]);
    const buildContract = contract("BUILD_RESCUE", "2".repeat(40), [
      "scripts/verify-build-config.mjs",
      "src/runtime-config.ts",
      "tests/runtime-config.test.ts",
      "tsconfig.build.json",
    ]);

    expect(() => assertReputationEntryWorkContractIntegrity(testContract)).not.toThrow();
    expect(() => assertReputationEntryWorkContractIntegrity(buildContract)).not.toThrow();
    expect(testContract.assignedAgent).toEqual(buildContract.assignedAgent);
    expect(testContract.authorityPolicy?.allowedFiles).toEqual(["src/order-state.ts"]);
    expect(buildContract.authorityPolicy?.allowedFiles).toEqual(["tsconfig.build.json"]);
    expect(testContract.acceptanceCriteria.commands.map((item) => item.command)).toEqual(["npm test"]);
    expect(buildContract.acceptanceCriteria.commands.map((item) => item.command)).toEqual(["npm run build", "npm test"]);
    expect(testContract.workContractSha256).not.toBe(buildContract.workContractSha256);
  });

  it("binds execution identity and revokes the Lease after the Job", () => {
    const locked = contract("TEST_AND_FIX", "3".repeat(40), ["src/order-state.ts", "tests/order-state.test.ts"]);
    const executionId = generateExecutionId();
    const decision = decideTaskScopedAuthority({
      contract: locked,
      subject: {
        agentId: profile.agentId,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        jobRunId: "job-unit-reputation-entry",
        agentIdentity: agentIdentityReference(profile),
        executionId,
      },
      decidedAt: "2026-09-03T20:01:00.000Z",
    });
    const lease = issueTaskScopedPermissionLease(decision);
    const execution = createAgentExecutionIdentity({
      executionId,
      profile,
      contract: locked,
      authorityLease: lease,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      runtime: { provider: "unit", modelId: "unit-model", sandboxProvider: "VERCEL_SANDBOX" },
      startedAt: "2026-09-03T20:01:01.000Z",
    });
    const terminal = revokeTaskScopedPermissionLease({
      lease,
      revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
      reason: "Unit Job concluded",
      revokedAt: "2026-09-03T20:01:02.000Z",
    });

    expect(decision.decision).toBe("APPROVED");
    expect(execution.agent.profileSha256).toBe(profile.profileSha256);
    expect(terminal.status).toBe("REVOKED");
    expect(terminal.authoritySha256).toBe(lease.authoritySha256);
  });

  it("denies file-scope expansion and detects Contract tampering", () => {
    const locked = contract("TEST_AND_FIX", "4".repeat(40), ["src/order-state.ts", "tests/order-state.test.ts"]);
    const scope = taskScopedAuthorityScope(locked);
    const denied = decideTaskScopedAuthority({
      contract: locked,
      subject: {
        agentId: profile.agentId,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        jobRunId: "job-denied",
        agentIdentity: agentIdentityReference(profile),
        executionId: generateExecutionId(),
      },
      requestedScope: { ...scope, allowedFiles: [...(scope.allowedFiles ?? []), "tests/order-state.test.ts"] },
      decidedAt: "2026-09-03T20:02:00.000Z",
    });
    const tampered = structuredClone(locked);
    tampered.acceptanceCriteria.commands[0]!.command = "npm run build";

    expect(denied.decision).toBe("DENIED");
    expect(denied.reasons).toContain("File scope is not exact");
    expect(() => assertReputationEntryWorkContractIntegrity(tampered)).toThrow(/TAMPERING/);
  });
});

function contract(
  taskType: "TEST_AND_FIX" | "BUILD_RESCUE",
  commitSha: string,
  paths: string[],
) {
  const files = paths.map((relative_path, index) => ({
    relative_path,
    sha256: String(index + 1).repeat(64).slice(0, 64),
  }));
  return createReputationEntryWorkContract({
    taskId: `unit-${taskType.toLowerCase()}-${commitSha.slice(0, 4)}`,
    taskType,
    assignedAgent: agentIdentityReference(profile),
    taskDefinitionVersion: 2,
    source: {
      branch: taskType === "TEST_AND_FIX" ? "donelayer/repair/unit-test-fix" : "donelayer/repair/unit-build-rescue",
      commitSha,
      manifestSha256: sha256Canonical(files),
      files,
    },
    lockedAt: "2026-09-03T20:00:30.000Z",
  });
}
