import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260914125905_gate_4a_canonical_execution_prerequisite_v1.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("Gate 4A-P canonical orchestration persistence contract", () => {
  it("keeps every mutation boundary server-only and anonymous/cross-account fail closed", () => {
    for (const name of [
      "prepare_verified_work_execution",
      "finalize_verified_work_execution",
      "fail_verified_work_execution",
    ]) {
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.${name}\\(jsonb\\) from public, anon, authenticated`,
        "i",
      ));
      expect(migration).toMatch(new RegExp(
        `grant execute on function public\\.${name}\\(jsonb\\) to service_role`,
        "i",
      ));
      expect(migration).not.toMatch(new RegExp(
        `grant execute on function public\\.${name}\\(jsonb\\) to (?:anon|authenticated)`,
        "i",
      ));
    }
    expect(migration).toContain("profile.auth_user_id = owner_auth_user_id");
    expect(migration).toContain("CANONICAL_EXECUTION_OWNER_MISMATCH");
  });

  it("binds one immutable envelope to exact Contract, Authority, Source, workflow, Job, and Leases", () => {
    expect(migration).toContain("create table public.verified_work_execution_envelopes");
    expect(migration).toContain("before update on public.verified_work_execution_envelopes");
    expect(migration).toContain("before delete on public.verified_work_execution_envelopes");
    expect(migration).toContain("contract.status <> 'LOCKED'");
    expect(migration).toContain("CANONICAL_CONTRACT_HASH_MISMATCH");
    expect(migration).toContain("CANONICAL_AUTHORITY_HASH_MISMATCH");
    expect(migration).toContain("CANONICAL_AUTHORITY_LINEAGE_MISMATCH");
    expect(migration).toContain("source_document ->> 'commitSha'");
    expect(migration).toContain("source_document ->> 'treeSha'");
    expect(migration).toContain("allowedCommitShas");
    expect(migration).toContain("allowedTreeShas");
    expect(migration).toContain("private.verified_workflow_policy(workflow_key)");
    expect(migration).toContain("CANONICAL_WORKFLOW_UNSUPPORTED");
    expect(migration).toContain("permission_scope_json");
    expect(migration).toContain("execution_policy_snapshot");
    expect(migration).toContain("envelope_canonical_text");
    expect(migration).toContain("unique (task_id, idempotency_key)");
  });

  it("serializes preparation with a Work row lock and returns one deterministic retry result", () => {
    expect(migration).toMatch(/where task\.id = prepare_execution\.task_id\s+for update/i);
    expect(migration).toContain("'reused', true");
    expect(migration).toContain("CANONICAL_ACTIVE_JOB_ALREADY_EXISTS");
    expect(migration).toContain("CANONICAL_EXECUTION_TERMINAL_FAILURE_REQUIRES_NEW_WORK");
    expect(migration).toContain("CANONICAL_EXECUTION_RETRY_REQUIRES_NEW_WORK");
    expect(migration).not.toMatch(/p_request\s*->>\s*'(?:jobRunId|workerId|workerLeaseId|permissionLeaseId|allowedFiles|allowedActions|networkPolicy)'/i);
  });

  it("requires exact active ownership, evidence, cleanup, and independent verification before finalization", () => {
    for (const value of [
      "CANONICAL_FINALIZATION_LINEAGE_MISMATCH",
      "CANONICAL_FINALIZATION_OWNERSHIP_INVALID",
      "CANONICAL_VERIFIED_DELIVERY_NOT_PROVEN",
      "CANONICAL_CHANGED_FILE_OUTSIDE_AUTHORITY",
      "CANONICAL_ACCEPTANCE_NOT_VERIFIED",
      "CANONICAL_EVIDENCE_LEDGER_INVALID",
      "CANONICAL_RECEIPT_ANCHOR_INVALID",
    ]) expect(migration).toContain(value);
    expect(migration).toContain("independentVerificationOutcome");
    expect(migration).toContain("requiredEvidenceComplete");
    expect(migration).toContain("executionSandboxCleanupVerified");
    expect(migration).toContain("verifierSandboxCleanupVerified");
    expect(migration).toContain("unresolvedPolicyViolations");
    expect(migration).toContain("target_permission.scope_json <> target_envelope.permission_scope_json");
  });

  it("makes failure append-only, idempotent, lease-closing, and unable to replace success", () => {
    expect(migration).toContain("'EXECUTION_FAILED'");
    expect(migration).toContain("'replayed', true");
    expect(migration).toContain("CANONICAL_FAILURE_REPLAY_MISMATCH");
    expect(migration).toContain("CANONICAL_FAILURE_CANNOT_REPLACE_SUCCESS");
    expect(migration).toMatch(/update public\.permission_leases as permission set status = 'REVOKED'/i);
    expect(migration).toMatch(/update public\.worker_job_leases as worker_lease\s+set status = 'RELEASED'/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.(?:evidence|job_run_events|job_receipts)/i);
  });

  it("records the required canonical audit events in existing infrastructure", () => {
    for (const event of [
      "EXECUTION_PREPARE_REQUESTED",
      "CONTRACT_VERIFIED",
      "AUTHORITY_VERIFIED",
      "SOURCE_VERIFIED",
      "WORKFLOW_VERIFIED",
      "JOB_CREATED",
      "LEASE_CREATED",
      "EXECUTION_FINALIZED",
      "EXECUTION_FAILED",
    ]) expect(migration).toContain(`'${event}'`);
    expect(migration).toContain("insert into public.job_run_events");
    expect(migration).toContain("canonical_job_run_events_append_only_update");
    expect(migration).toContain("canonical_job_run_events_append_only_delete");
  });

  it("does not add corpus, Reputation, payment, identity, or candidate feature persistence", () => {
    expect(migration).not.toMatch(/create table .*?(?:reputation|corpus|payment|passport|erc|x402)/i);
    expect(migration).not.toMatch(/(?:insert into|update) public\.(?:real_job_corpus|reputation|payments?)/i);
    expect(migration).not.toContain("bundleManifestSha256");
    expect(migration).not.toContain("verifyExternalReviewBundleV1");
    expect(migration).not.toContain("PRIVATE_EXTERNAL_REVIEW_BUNDLE");
  });

  it("preserves historical Beta Gate 3 migration and zero-contribution classification", () => {
    expect(fileSha256("supabase/migrations/20260912170840_beta_gate_3_real_execution_v1.sql"))
      .toBe("13be3169cd3cb2001b4b83faf20cf1b6fc9b8c19c3b4c4d797103d9738d32606");
    const orchestrator = readFileSync(path.resolve("apps/web/src/server/beta-gate-3/orchestrator.ts"), "utf8");
    expect(orchestrator).toContain('realJobClassification: "NOT_VERIFIED"');
    expect(orchestrator).toContain('reason: "BETA_GATE_VALIDATION"');
    expect(orchestrator).toContain("reputationContribution: 0");
    expect(orchestrator).toContain("canonicalContribution: 0");
    expect(migration).toContain("BETA_GATE_3_CLASSIFICATION_IMMUTABLE");
    for (const name of [
      "rpc_prepare_beta_gate_3_job",
      "rpc_finalize_beta_gate_3_job",
      "rpc_fail_beta_gate_3_job",
    ]) expect(migration).toMatch(new RegExp(
      `revoke execute on function public\\.${name}\\(jsonb\\) from service_role`,
      "i",
    ));
  });

  it("leaves the three approved candidate implementation files byte-for-byte unchanged", () => {
    expect(fileSha256("apps/web/src/server/workspace-public-receipt-projection.ts"))
      .toBe("a24fd644547fecc2023ea15917bdd9ac3ecb56b19e9214636cbb5573884dd506");
    expect(fileSha256("apps/web/src/server/workspace-public-receipt.ts"))
      .toBe("1af1c7cb953003cbee2932cc6d1bae5189378197f81dafb2c9042c9b7fc54971");
    expect(fileSha256("apps/web/src/app/api/workspace/receipts/[receiptId]/download/route.ts"))
      .toBe("02c80309d9a02e481b91d93e0ad5442c160e02f8320a384a6f559b9371765b74");
  });

  it("routes execution through the canonical registry and keeps Gate 4A precheck-only", () => {
    const route = readFileSync(path.resolve("apps/web/src/app/api/tasks/[taskId]/execute/route.ts"), "utf8");
    const canonical = readFileSync(path.resolve("apps/web/src/server/verified-work-execution/orchestrator.ts"), "utf8");
    expect(route).toContain("runCanonicalVerifiedWorkExecution");
    expect(route).not.toContain('from "@/server/beta-gate-3/orchestrator"');
    expect(canonical).toContain("GATE_4A_WORKFLOW_PRECHECK_ONLY_UNTIL_OWNER_EXECUTION_APPROVAL");
  });
});

function fileSha256(relativePath: string): string {
  return createHash("sha256").update(readFileSync(path.resolve(relativePath))).digest("hex");
}
