import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const migrationPath = path.join(
  workspaceRoot,
  "supabase/migrations/20260908141623_agent_identity_production_persistence_v1.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("Agent Identity production persistence contract", () => {
  it("defines append-only profile history and immutable global external ownership", () => {
    expect(migration).toContain("create table public.agent_identity_profiles");
    expect(migration).toContain("primary key (agent_id, revision)");
    expect(migration).toContain("create table public.agent_external_identity_owners");
    expect(migration).toContain("identity_key text primary key");
    expect(migration).toContain("agent_identity_profiles_append_only");
    expect(migration).toContain("agent_external_identity_owners_append_only");
    expect(migration).toContain("AGENT_IDENTITY_REVISION_CHAIN_INVALID");
    expect(migration).toContain("AGENT_IDENTITY_CONTROLLER_MISMATCH");
    expect(migration).toContain("AGENT_EXTERNAL_IDENTITY_HISTORY_MUTATION");
    expect(migration).toContain("EXTERNAL_IDENTITY_CONFLICT");
  });

  it("keeps mutations behind service-role commands and reads behind RLS", () => {
    expect(migration).toContain("alter table public.agent_identity_profiles enable row level security");
    expect(migration).toContain("using ((select private.can_view_agent(agent_id)))");
    expect(migration).toContain("grant select on public.agent_identity_profiles to anon, authenticated");
    expect(migration).toContain("grant execute on function public.rpc_get_agent_identity(uuid, integer) to anon, authenticated");
    expect(migration).toContain("grant execute on function public.rpc_create_agent_with_identity(uuid, jsonb, jsonb) to service_role");
    expect(migration).toContain("grant execute on function public.rpc_append_agent_identity_revision(uuid, jsonb) to service_role");
    expect(migration).not.toMatch(/grant execute on function public\.rpc_(?:create_agent_with_identity|append_agent_identity_revision)[^;]+to authenticated/i);
  });

  it("creates an Agent and initial identity in one Postgres function transaction", () => {
    const functionBody = section(
      "create or replace function private.create_agent_with_identity",
      "create or replace function public.rpc_get_agent_identity",
    );
    expect(functionBody).toContain("insert into public.agents");
    expect(functionBody).toContain("insert into public.agent_skills");
    expect(functionBody).toContain("insert into public.agent_task_types");
    expect(functionBody).toContain("insert into public.agent_endpoints");
    expect(functionBody).toContain("perform private.append_agent_identity_profile");
    expect(functionBody).toContain("'AGENT_CREATED'");
  });

  it("routes runtime identity operations through the mode-aware adapter", () => {
    const routePaths = [
      "apps/web/src/app/api/agents/route.ts",
      "apps/web/src/app/api/agents/[agentId]/identity/route.ts",
      "apps/web/src/app/api/agents/[agentId]/identity/external-identities/route.ts",
    ];
    for (const routePath of routePaths) {
      const source = readFileSync(path.join(workspaceRoot, routePath), "utf8");
      expect(source).toContain("@/server/agent-identity/persistence");
      expect(source).not.toContain("getDemoStore");
    }
    const authSource = readFileSync(path.join(workspaceRoot, "apps/web/src/server/supabase-auth.ts"), "utf8");
    expect(authSource).toContain("SUPABASE_SECRET_KEY");
    expect(authSource).not.toContain("NEXT_PUBLIC_SUPABASE_SECRET_KEY");
  });
});

function section(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}
