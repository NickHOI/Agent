import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(path.join(root, "supabase/migrations/20260909131617_beta_gate_2_trust_workspace_v1.sql"), "utf8");
const bootstrapFix = readFileSync(path.join(root, "supabase/migrations/20260909160114_beta_gate_2_workspace_bootstrap_fix_v1.sql"), "utf8");
const postgrestRetryFix = readFileSync(path.join(root, "supabase/migrations/20260912094119_beta_gate_3_postgrest_retry_fix_v1.sql"), "utf8");
const auth = readFileSync(path.join(root, "apps/web/src/server/supabase-auth.ts"), "utf8");
const proxy = readFileSync(path.join(root, "apps/web/src/proxy.ts"), "utf8");
const workspace = readFileSync(path.join(root, "apps/web/src/server/trust-workspace.ts"), "utf8");
const detail = readFileSync(path.join(root, "apps/web/src/components/tasks/workspace-work-detail.tsx"), "utf8");
const mobileNavigation = readFileSync(path.join(root, "apps/web/src/components/mobile-navigation.tsx"), "utf8");

describe("Beta Gate 2 Trust Workspace contract", () => {
  it("bootstraps only the authenticated subject into bounded Beta roles", () => {
    expect(migration).toContain("auth_user_id uuid := auth.uid()");
    expect(migration).toContain("values (target_profile_id, 'CUSTOMER'), (target_profile_id, 'PROVIDER')");
    expect(migration).toContain("WORKSPACE_AUTHENTICATION_REQUIRED");
    expect(migration).not.toContain("raw_user_meta_data");
    expect(migration).not.toContain("user_metadata");
    expect(bootstrapFix).toContain("actor_auth_user_id uuid := auth.uid()");
    expect(bootstrapFix).toContain("create or replace function public.rpc_bootstrap_beta_workspace");
    expect(bootstrapFix).toContain("create or replace function public.rpc_create_beta_workspace_work");
    expect(bootstrapFix).toContain("create or replace function public.rpc_approve_beta_workspace_authority");
    expect(bootstrapFix).toContain("where profile.auth_user_id = actor_auth_user_id");
    expect(bootstrapFix).not.toContain("where profile.auth_user_id = auth_user_id");
    expect(bootstrapFix).toContain("to authenticated");
  });

  it("keeps writes behind authenticated RPC and owner predicates", () => {
    expect(migration).toContain("revoke all on function public.rpc_create_beta_workspace_work(jsonb)");
    expect(migration).toContain("grant execute on function public.rpc_create_beta_workspace_work(jsonb) to authenticated");
    expect(migration).toContain("and private.owns_agent(agent.id)");
    expect(migration).toContain("and private.is_task_customer(task.id)");
    expect(migration).toContain("workspace_authority_reviews_participant_select");
    expect(migration).not.toMatch(/grant\s+(insert|update|delete|all)\s+on\s+public\.workspace_authority_reviews\s+to\s+authenticated/i);
    expect(migration).toContain("allowed_path.value ~ '(^/|\\\\|(^|/)\\.\\.(/|$))'");
    expect(migration).toContain("profile.profile_document ->> 'status' = 'ACTIVE'");
    expect(migration).toContain("WORKSPACE_AGENT_PROFILE_INVALID");
    expect(migration).toContain("jsonb_array_length(p_profile -> 'externalIdentities') <> 0");
    expect(migration).toContain("is distinct from 'workspace-agent:' || (p_agent ->> 'id')");
    expect(migration).not.toContain("grant execute on function public.rpc_append_beta_workspace_agent_identity(jsonb) to authenticated");
    expect(migration).toContain("WORKSPACE_AGENT_INPUT_INVALID");
    expect(migration).toContain("jsonb_array_length(p_agent -> 'skills') not between 1 and 50");
    expect(migration).toContain("coalesce(p_agent ->> 'endpointUrl', '') !~ '^https://[^[:space:]]+$'");
  });

  it("locks Work and appends immutable Authority evidence", () => {
    expect(migration).toContain("WORKSPACE_LOCKED_WORK_IMMUTABLE");
    expect(migration).toContain("workspace_locked_work_content_guard");
    expect(migration).toContain("workspace_authority_reviews_append_only_update");
    expect(migration).toContain("workspace_authority_reviews_append_only_delete");
    expect(migration).toContain("WORKSPACE_CONTRACT_STALE");
    expect(migration).toContain("TASK_SCOPED_AUTHORITY_DECISION_V1");
  });

  it("returns stale Authority decisions without triggering PostgREST serialization retries", () => {
    expect(postgrestRetryFix).toContain("create or replace function public.rpc_approve_beta_workspace_authority");
    expect(postgrestRetryFix).toContain("actor_auth_user_id uuid := auth.uid()");
    expect(postgrestRetryFix).toContain("and private.is_task_customer(task.id)");
    expect(postgrestRetryFix).toContain("WORKSPACE_CONTRACT_STALE' using errcode = 'P0001'");
    expect(postgrestRetryFix).toContain("WORKSPACE_AUTHORITY_ALREADY_DECIDED' using errcode = 'P0001'");
    expect(postgrestRetryFix).not.toContain("errcode = '40001'");
    expect(postgrestRetryFix).not.toMatch(/grant\s+(insert|update|delete|all)\s+on\s+public\.workspace_authority_reviews\s+to\s+authenticated/i);
  });

  it("does not manufacture execution, Evidence, a Lease, or a Receipt", () => {
    const start = migration.indexOf("create or replace function public.rpc_create_beta_workspace_work");
    const end = migration.indexOf("create or replace function public.rpc_approve_beta_workspace_authority");
    const workFunction = migration.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(workFunction).not.toMatch(/insert into public\.(job_runs|permission_leases|evidence_ledger_entries|job_receipts)/);
    expect(migration).toContain("'permissionLeaseStatus', 'NOT_ISSUED'");
    expect(migration).toContain("'sourceCommitStatus', 'NOT_RESOLVED'");
    expect(detail).toContain("No Receipt issued");
    expect(detail).toContain("No Permission Lease has been issued");
  });

  it("uses real Supabase SSR Auth and validates Receipt integrity before presentation", () => {
    expect(auth).toContain("client.auth.getUser()");
    expect(auth).toContain("profile_roles(role)");
    expect(proxy).toContain("client.auth.getClaims()");
    expect(proxy).toContain("Cache-Control");
    expect(workspace).toContain("sha256Canonical(document)");
    expect(workspace).toContain("verifyEvidenceLedgerEntries(ledger)");
    expect(detail).toContain("Receipt integrity failed");
  });

  it("renders the three accepted outcome dimensions separately", () => {
    expect(detail).toContain('label="Execution"');
    expect(detail).toContain('label="Independent verification"');
    expect(detail).toContain('label="Delivery"');
  });

  it("renders the mobile navigation outside the sticky backdrop containing block", () => {
    expect(mobileNavigation).toContain('import { createPortal } from "react-dom"');
    expect(mobileNavigation).toContain("), document.body) : null}");
    expect(mobileNavigation).toContain('className="fixed inset-0 z-50 lg:hidden"');
  });
});
