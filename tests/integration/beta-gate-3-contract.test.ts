import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createAgentIdentityProfile } from "@donelayer/database";
import {
  BETA_GATE_3_PRODUCT_BRANCH,
  BETA_GATE_3_PRODUCT_REMOTE_URL,
  MANAGED_SANDBOX_EXECUTION_BACKEND,
  MANAGED_SANDBOX_PROVIDER,
  assertBetaGate3ProductRepositoryUrl,
  repositoryFileManifestSchema,
} from "@donelayer/worker-protocol";
import {
  boundedContractAssertionsSha256,
  parseBoundedContractRun,
} from "../../apps/web/src/server/agent-execution/vercel-agent-repair-sandbox";
import {
  BETA_GATE_3_EDITABLE_FILE,
  BetaGate3AuthorityGuard,
  betaGate3Assertions,
  createBetaGate3ExecutionBinding,
  parseBetaGate3PreparedLifecycle,
  type BetaGate3AuthorityOperation,
} from "../../apps/web/src/server/beta-gate-3/contract";
import { managedBuildTestSourceRunner } from "../../apps/web/src/server/managed-sandbox/source-package-runner";
import { evaluateVerifiedDeliveryOutcome } from "../../apps/web/src/server/verified-delivery-outcome/policy";

const migrationPath = path.resolve(
  "supabase/migrations/20260912170840_beta_gate_3_real_execution_v1.sql",
);

describe("Beta Gate 3 exact execution boundary", () => {
  it("adds only the exact owner product Source and keeps it on main", () => {
    expect(assertBetaGate3ProductRepositoryUrl(BETA_GATE_3_PRODUCT_REMOTE_URL)).toBe(
      BETA_GATE_3_PRODUCT_REMOTE_URL,
    );
    for (const value of [
      "https://github.com/NickHOI/Agent",
      "https://github.com/nickhoi/Agent.git",
      "https://github.com/NickHOI/Other.git",
      `${BETA_GATE_3_PRODUCT_REMOTE_URL}?token=bad`,
    ]) expect(() => assertBetaGate3ProductRepositoryUrl(value)).toThrow();

    const base = {
      schemaVersion: 1 as const,
      remoteUrl: BETA_GATE_3_PRODUCT_REMOTE_URL,
      branch: BETA_GATE_3_PRODUCT_BRANCH,
      commitSha: "a".repeat(40),
      files: [{ relative_path: BETA_GATE_3_EDITABLE_FILE, size_bytes: 10, sha256: "b".repeat(64) }],
    };
    expect(repositoryFileManifestSchema.safeParse(base).success).toBe(true);
    expect(repositoryFileManifestSchema.safeParse({ ...base, branch: "feature/unapproved" }).success).toBe(false);
  });

  it("generates the existing verified source runner for the exact product identity", () => {
    const runner = managedBuildTestSourceRunner({
      identity: {
        remoteUrl: BETA_GATE_3_PRODUCT_REMOTE_URL,
        branch: BETA_GATE_3_PRODUCT_BRANCH,
        commitSha: "a".repeat(40),
        manifestSha256: "b".repeat(64),
        sourcePackageSha256: "c".repeat(64),
        sourcePackageManifestSha256: "d".repeat(64),
      },
      buildScriptPresent: true,
      allowedBranch: BETA_GATE_3_PRODUCT_BRANCH,
    });
    expect(runner).toContain(BETA_GATE_3_PRODUCT_REMOTE_URL);
    expect(runner).toContain('credentialEnvironmentNames');
    expect(() => managedBuildTestSourceRunner({
      identity: {
        remoteUrl: "https://github.com/example/untrusted.git",
        branch: "main",
        commitSha: "a".repeat(40),
        manifestSha256: "b".repeat(64),
        sourcePackageSha256: "c".repeat(64),
        sourcePackageManifestSha256: "d".repeat(64),
      },
      buildScriptPresent: true,
      allowedBranch: "main",
    })).toThrow();
  });

  it("locks the deterministic assertions and rejects a tampered result", () => {
    const assertions = betaGate3Assertions();
    const check = {
      assertions,
      assertionsSha256: boundedContractAssertionsSha256(assertions),
    };
    const output = JSON.stringify({
      schemaVersion: 1,
      assertionsSha256: check.assertionsSha256,
      passed: 2,
      failed: 0,
      results: assertions.map((assertion) => ({
        assertionId: assertion.id,
        args: assertion.args,
        expected: assertion.expected,
        actual: assertion.expected,
        status: "PASSED",
      })),
    });
    expect(parseBoundedContractRun(output, check)).toMatchObject({ passed: 2, failed: 0 });
    expect(() => parseBoundedContractRun(output.replace("Unknown time", "anything"), check)).toThrow(/TAMPERED/);
  });

  it("binds the service-prepared lifecycle to one Job, Agent, commit, file, and two Sandboxes", () => {
    const prepared = parseBetaGate3PreparedLifecycle(preparedFixture());
    const binding = createBetaGate3ExecutionBinding(prepared);
    const operations: BetaGate3AuthorityOperation[] = [];
    const guard = new BetaGate3AuthorityGuard(binding, prepared.permissionScope, operations);
    const during = new Date(Date.parse(binding.startedAt) + 1_000);

    guard.assertRepositoryReadAllowed({
      remoteUrl: BETA_GATE_3_PRODUCT_REMOTE_URL,
      baseRef: BETA_GATE_3_PRODUCT_BRANCH,
      commitSha: binding.source.commitSha,
    }, during);
    guard.assertPatchAllowed([BETA_GATE_3_EDITABLE_FILE], during);
    guard.assertSandboxAllowed({
      purpose: "AGENT_REPAIR",
      provider: MANAGED_SANDBOX_PROVIDER,
      executionBackend: MANAGED_SANDBOX_EXECUTION_BACKEND,
    }, during);
    guard.assertSandboxAllowed({
      purpose: "INDEPENDENT_VERIFICATION",
      provider: MANAGED_SANDBOX_PROVIDER,
      executionBackend: MANAGED_SANDBOX_EXECUTION_BACKEND,
    }, during);
    expect(() => guard.assertSandboxAllowed({
      purpose: "INDEPENDENT_VERIFICATION",
      provider: MANAGED_SANDBOX_PROVIDER,
      executionBackend: MANAGED_SANDBOX_EXECUTION_BACKEND,
    }, during)).toThrow(/exceeds/i);
    expect(() => guard.assertPatchAllowed(["package.json"], during)).toThrow(/exact approved file/i);
  });

  it("keeps Model C fail closed for verifier rejection and missing Evidence", () => {
    const policy = { schemaVersion: 1 as const, policyVersion: 1 as const, policy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED" as const };
    const checks = {
      authorizedDeliverableExists: true,
      requiredEvidenceComplete: true,
      sourceIntegrityValid: true,
      authorityValid: true,
      provenanceValid: true,
      lifecycleIntegrityValid: true,
      cleanupValid: true,
      externalEffectsPolicyValid: true,
    };
    expect(evaluateVerifiedDeliveryOutcome({
      deliveryOutcomePolicy: policy,
      executionOutcome: "COMPLETED",
      executionFailureAttribution: "NOT_APPLICABLE",
      independentVerificationOutcome: "FAILED",
      trustChecks: checks,
    }).deliveryOutcome).toBe("FAILED");
    expect(evaluateVerifiedDeliveryOutcome({
      deliveryOutcomePolicy: policy,
      executionOutcome: "COMPLETED",
      executionFailureAttribution: "NOT_APPLICABLE",
      independentVerificationOutcome: "VERIFIED",
      trustChecks: { ...checks, requiredEvidenceComplete: false },
    }).deliveryOutcome).toBe("BLOCKED");
  });

  it("keeps prepare, finalize, and fail-closed persistence service-only", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("'AI_GATEWAY'");
    for (const name of [
      "rpc_prepare_beta_gate_3_job",
      "rpc_finalize_beta_gate_3_job",
      "rpc_fail_beta_gate_3_job",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(jsonb\\) from public, anon, authenticated`, "i"));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(jsonb\\) to service_role`, "i"));
    }
    expect(sql).not.toMatch(/grant execute on function public\.rpc_(?:prepare|finalize|fail)_beta_gate_3_job\(jsonb\) to (?:anon|authenticated)/i);
    expect(sql).not.toContain("40001");
  });
});

function preparedFixture() {
  const startedAt = new Date().toISOString();
  const agentId = "1645808d-abdb-4058-9ead-968b631ff515";
  const taskId = "3fb38afa-8181-4b7f-8432-55a6d6abedeb";
  const identity = createAgentIdentityProfile({
    agentId,
    displayName: "Gate 3 Agent",
    controller: {
      controllerType: "PLATFORM_ACCOUNT",
      accountType: "USER",
      accountId: "e5f41678-4619-4457-a256-74d1b2f4d551",
      relationship: "CONTROLS",
      assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
      legallyVerified: false,
    },
    declaredCapabilities: ["FEATURE_COMPLETION", "TypeScript"],
    createdAt: startedAt,
  });
  const scope = {
    allowedActions: ["read_source", "collect_evidence", "independently_verify", "create_patch", "run_locked_verification"],
    deniedActions: ["production_deploy"],
    allowedPaths: ["$JOB_WORKSPACE"],
    allowedDomains: [],
    allowedRepositories: [BETA_GATE_3_PRODUCT_REMOTE_URL],
    allowedBranches: [BETA_GATE_3_PRODUCT_BRANCH],
    allowedCommitShas: ["a".repeat(40)],
    allowedSandboxProviders: [MANAGED_SANDBOX_PROVIDER],
    allowedExecutionBackends: [MANAGED_SANDBOX_EXECUTION_BACKEND],
    allowedWorkflows: ["BETA_GATE_3_MANAGED_REMOTE_EXECUTION"],
    allowedFiles: [BETA_GATE_3_EDITABLE_FILE],
    allowedEnvironmentVariables: [],
    maxArtifactBytes: 2 * 1024 * 1024,
    maxRuntimeSeconds: 600,
    maxApiBudget: 0,
    maxSandboxes: 2,
    maxCommands: 10,
    maxStdoutBytes: 256 * 1024,
    maxStderrBytes: 256 * 1024,
    networkPolicy: "deny-all" as const,
    persistence: "none" as const,
    humanApprovalActions: [],
  };
  return {
    prepared: true,
    startedAt,
    taskId,
    assignmentId: "f5a32a18-6185-4471-8ef7-9733fe164008",
    agentId,
    workerId: "00000000-0000-4000-8000-000000000010",
    jobRunId: "00000000-0000-4000-8000-000000000011",
    workerLeaseId: "00000000-0000-4000-8000-000000000012",
    permissionLeaseId: "00000000-0000-4000-8000-000000000013",
    contractId: "85290581-a20f-453c-83bf-2724e1afae59",
    contractVersion: 2,
    contractSha256: "b".repeat(64),
    contract: {
      taskId,
      contractType: "VERIFIED_WORK_CONTRACT_V2",
      contractVersion: 2,
      allowedWorkflow: "BETA_GATE_3_MANAGED_REMOTE_EXECUTION",
      sourceReference: { repository: BETA_GATE_3_PRODUCT_REMOTE_URL, branch: "main", commitResolution: "REQUIRED_BEFORE_PERMISSION_LEASE" },
      authorityPolicy: { allowedPaths: [BETA_GATE_3_EDITABLE_FILE], networkPolicy: "deny-all", persistence: "none" },
      deliveryOutcomePolicy: { policy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED" },
    },
    authorityId: "773331ab-fc0d-46dc-a6a8-4b28125abde7",
    authorityScopeSha256: "c".repeat(64),
    authorityScope: {},
    permissionScope: scope,
    agentIdentity: identity,
    sourceCommit: "a".repeat(40),
  };
}
