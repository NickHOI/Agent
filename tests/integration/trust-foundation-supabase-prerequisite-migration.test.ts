import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const migrationsDirectory = path.join(workspaceRoot, "supabase/migrations");
const prerequisiteName = "20260903080000_trust_foundation_prerequisite_v1.sql";
const prerequisite = readFileSync(path.join(migrationsDirectory, prerequisiteName), "utf8");
const securityHardeningName = "20260909055143_beta_gate_1_security_hardening_v1.sql";
const securityHardening = readFileSync(
  path.join(migrationsDirectory, securityHardeningName),
  "utf8",
);

const historicalMigrationHashes = new Map([
  [
    "20260731235500_initial_schema.sql",
    "36883b21e22bef69d415e479d09765621641d449e6de4a40416154fd4e26630a",
  ],
  [
    "20260903090000_semantic_verification_v1.sql",
    "f7d8ce4a14fa603b9d9f2e946fd7216f7b11c61920b21a3eb357ff08769b655d",
  ],
  [
    "20260908141623_agent_identity_production_persistence_v1.sql",
    "79e5d47bc0efe3565ce8448662c9192a50116423ae81993ade48b27268ffec64",
  ],
]);

const preSemanticReceiptResults = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "FAILED",
  "UNVERIFIED",
  "DISPUTED",
  "PERMISSION_VIOLATION",
  "INVALID_EVIDENCE_CHAIN",
];

const preSemanticLedgerEntryTypes = [
  "CONTRACT_LOCKED",
  "PERMISSION_GRANTED",
  "JOB_CLAIMED",
  "HEARTBEAT_RECORDED",
  "EXECUTION_STARTED",
  "REPOSITORY_CLONE_STARTED",
  "REPOSITORY_CLONE_COMPLETED",
  "REMOTE_METADATA_CAPTURED",
  "FILE_MANIFEST_CREATED",
  "ARTIFACT_CREATED",
  "ARTIFACT_UPLOADED",
  "ARTIFACT_HASH_VERIFIED",
  "REMOTE_COMMIT_VERIFIED",
  "REPOSITORY_VERIFIED",
  "SOURCE_PACKAGE_CREATED",
  "SOURCE_PACKAGE_VERIFIED",
  "SOURCE_PACKAGE_UPLOADED",
  "SOURCE_MANIFEST_VERIFIED",
  "NETWORK_POLICY_UPDATED",
  "DEPENDENCY_INSTALL_STARTED",
  "DEPENDENCY_INSTALL_COMPLETED",
  "BUILD_STARTED",
  "BUILD_COMPLETED",
  "TEST_STARTED",
  "TEST_FAILED",
  "SOURCE_INTEGRITY_VERIFIED",
  "MANAGED_SANDBOX_REQUESTED",
  "MANAGED_SANDBOX_CREATED",
  "MANAGED_SANDBOX_POLICY_VERIFIED",
  "MANAGED_SANDBOX_STARTED",
  "NETWORK_PROBE_COMPLETED",
  "MANAGED_SANDBOX_STOP_REQUESTED",
  "MANAGED_SANDBOX_STOPPED",
  "MANAGED_SANDBOX_CLEANUP_VERIFIED",
  "TIMEOUT_TRIGGERED",
  "STALE_RESULT_REJECTED",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "PERMISSION_VIOLATION",
  "WORKSPACE_CLEANED",
  "RECEIPT_CREATED",
];

describe("Trust Foundation Supabase prerequisite migration", () => {
  it("inserts one explicit prerequisite into the clean-install sequence", () => {
    const ordered = readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    expect(ordered).toEqual([
      "20260731235500_initial_schema.sql",
      prerequisiteName,
      "20260903090000_semantic_verification_v1.sql",
      "20260908141623_agent_identity_production_persistence_v1.sql",
      securityHardeningName,
      "20260909131617_beta_gate_2_trust_workspace_v1.sql",
      "20260909160114_beta_gate_2_workspace_bootstrap_fix_v1.sql",
      "20260912094119_beta_gate_3_postgrest_retry_fix_v1.sql",
      "20260912170840_beta_gate_3_real_execution_v1.sql",
      "20260914125905_gate_4a_canonical_execution_prerequisite_v1.sql",
    ]);
    expect(existsSync(path.join(
      migrationsDirectory,
      "20260909044503_trust_foundation_prerequisite_v1.sql",
    ))).toBe(false);
  });

  it("preserves every pre-existing historical migration byte-for-byte", () => {
    for (const [name, expected] of historicalMigrationHashes) {
      const actual = createHash("sha256")
        .update(readFileSync(path.join(migrationsDirectory, name)))
        .digest("hex");
      expect(actual, name).toBe(expected);
    }
  });

  it("hardens semantic review persistence without widening user access", () => {
    expect(securityHardening).toContain(
      "alter function public.prevent_receipt_semantic_review_mutation()",
    );
    expect(securityHardening).toContain("set search_path = pg_catalog");
    expect(securityHardening).toContain(
      "revoke all on function public.prevent_receipt_semantic_review_mutation()",
    );
    expect(securityHardening).toContain(
      "revoke all on public.receipt_semantic_reviews",
    );
    expect(securityHardening).toContain(
      "alter table public.receipt_semantic_reviews enable row level security",
    );
    expect(securityHardening).toMatch(
      /grant execute on function public\.prevent_receipt_semantic_review_mutation\(\)[\s\S]+to service_role;/i,
    );
    expect(securityHardening).toMatch(
      /grant all on public\.receipt_semantic_reviews[\s\S]+to service_role;/i,
    );
    expect(securityHardening).not.toMatch(/create policy/i);
    expect(securityHardening).not.toMatch(/grant [^;]+to (?:anon|authenticated)/is);
  });

  it("ports only the accepted Trust Foundation prerequisite boundary", () => {
    expect(prerequisite.match(/create table public\./g)).toHaveLength(4);
    for (const table of [
      "task_contract_versions",
      "permission_leases",
      "evidence_ledger_entries",
      "job_receipts",
    ]) {
      expect(prerequisite).toContain(`create table public.${table}`);
    }
    expect(prerequisite).toContain("add column task_contract_version_id uuid");
    expect(prerequisite).not.toContain("create table public.receipt_semantic_reviews");
    expect(prerequisite).not.toContain("agent_identity_profiles");
    expect(prerequisite).not.toContain("AGENT_PROFILE_REVISION_CREATED");
  });

  it("matches immutable pre-semantic Receipt and Ledger evidence", () => {
    const repositoryReality = openHistoricalDatabase("repository-reality.sqlite");
    const buildReality = openHistoricalDatabase("real-build-test-sandbox.sqlite");
    try {
      const historicalReceipt = tableSql(repositoryReality, "job_receipts");
      const historicalLedger = tableSql(buildReality, "evidence_ledger_entries");

      expect(quotedValues(checkExpression(historicalReceipt, "result")))
        .toEqual(preSemanticReceiptResults);
      expect(quotedValues(checkExpression(prerequisite, "result")))
        .toEqual(preSemanticReceiptResults);
      expect(quotedValues(checkExpression(historicalLedger, "entry_type")))
        .toEqual(preSemanticLedgerEntryTypes);
      expect(quotedValues(checkExpression(prerequisite, "entry_type")))
        .toEqual(preSemanticLedgerEntryTypes);
    } finally {
      repositoryReality.close();
      buildReality.close();
    }
  });

  it("preserves binding, append-only, invalidation, RLS, and service-only rules", () => {
    for (const trigger of [
      "trg_contract_locked_content_immutable",
      "trg_contract_status_guard",
      "trg_contract_no_delete",
      "trg_job_contract_binding_insert",
      "trg_job_contract_binding_update",
      "trg_permission_binding_insert",
      "trg_permission_binding_immutable",
      "trg_permission_status_guard",
      "trg_permission_dates_insert",
      "trg_permission_dates_update",
      "trg_permission_no_delete",
      "trg_evidence_ledger_no_update",
      "trg_evidence_ledger_no_delete",
      "trg_receipt_immutable_content",
      "trg_receipt_no_delete",
      "trg_receipt_invalidation_guard",
    ]) {
      expect(prerequisite).toContain(`create trigger ${trigger}`);
    }

    for (const table of [
      "task_contract_versions",
      "permission_leases",
      "evidence_ledger_entries",
      "job_receipts",
    ]) {
      expect(prerequisite).toContain(`alter table public.${table} enable row level security`);
      expect(prerequisite).toContain(`create policy ${table}_participant_select`);
    }

    expect(prerequisite).toContain("grant select on public.task_contract_versions");
    expect(prerequisite).toContain("to authenticated");
    expect(prerequisite).toContain("to service_role");
    expect(prerequisite).not.toMatch(/grant (?:insert|update|delete|all)[^;]+to authenticated/is);
    expect(prerequisite).not.toMatch(/grant [^;]+to anon/is);
  });
});

function openHistoricalDatabase(name: string): DatabaseSync {
  return new DatabaseSync(path.join(workspaceRoot, "test-results", name), { readOnly: true });
}

function tableSql(database: DatabaseSync, table: string): string {
  const row = database.prepare(
    "select sql from sqlite_master where type = 'table' and name = ?",
  ).get(table) as { sql?: unknown } | undefined;
  expect(typeof row?.sql).toBe("string");
  return String(row?.sql);
}

function checkExpression(sql: string, column: string): string {
  const match = new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([\\s\\S]*?)\\)\\s*\\)`, "i")
    .exec(sql);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

function quotedValues(sql: string): string[] {
  return Array.from(sql.matchAll(/'([^']+)'/g))
    .flatMap((match) => match[1] === undefined ? [] : [match[1]]);
}
