import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DemoStore,
  createAgentIdentityProfile,
  createExternalIdentityReference,
} from "@donelayer/database";
import {
  SupabaseAgentIdentityRepository,
  createMarketplaceAgentWithIdentity,
  getMarketplaceAgentIdentity,
  reviseMarketplaceAgentIdentity,
  type MarketplaceAgentCreateInput,
} from "@/server/agent-identity/persistence";

const authUserId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";

describe("Supabase Agent Identity persistence", () => {
  it("creates the marketplace Agent and hash-bound identity in one command", async () => {
    const read = rpcClient(() => ({ data: null, error: null }));
    const command = rpcClient((_name, parameters) => ({
      data: {
        agentId: (parameters.p_agent as Record<string, unknown>).id,
        slug: (parameters.p_agent as Record<string, unknown>).slug,
        profile: parameters.p_profile,
      },
      error: null,
    }));
    const repository = new SupabaseAgentIdentityRepository(read.client, command.client, authUserId);

    const created = await repository.createAgent(agentInput());

    expect(created.slug).toBe("production-persistence-agent");
    expect(created.identity.agentId).toBe(created.agentId);
    expect(created.identity.controller.accountId).toBe(authUserId);
    expect(created.identity.declaredCapabilities).toEqual(["FEATURE_COMPLETION", "Postgres"]);
    expect(command.rpc).toHaveBeenCalledOnce();
    expect(command.rpc.mock.calls[0]?.[0]).toBe("rpc_create_agent_with_identity");
  });

  it("reads a historical revision through the RLS-bound read command", async () => {
    const profile = initialProfile();
    const read = rpcClient(() => ({ data: profile, error: null }));
    const repository = new SupabaseAgentIdentityRepository(read.client, null, authUserId);

    await expect(repository.get(agentId, 1)).resolves.toEqual(profile);
    expect(read.rpc).toHaveBeenCalledWith("rpc_get_agent_identity", {
      p_agent_id: agentId,
      p_revision: 1,
    });
  });

  it("builds and verifies the next hash-chained revision before accepting the RPC result", async () => {
    const current = initialProfile();
    const read = rpcClient(() => ({ data: current, error: null }));
    const command = rpcClient((_name, parameters) => ({ data: parameters.p_profile, error: null }));
    const repository = new SupabaseAgentIdentityRepository(read.client, command.client, authUserId);

    const revised = await repository.revise(agentId, 1, { displayName: "Production Identity V2" });

    expect(revised.revision).toBe(2);
    expect(revised.previousProfileSha256).toBe(current.profileSha256);
    expect(revised.displayName).toBe("Production Identity V2");
    expect(command.rpc).toHaveBeenCalledWith("rpc_append_agent_identity_revision", {
      p_auth_user_id: authUserId,
      p_profile: revised,
    });
  });

  it("preserves external identity claims and maps ownership conflicts deterministically", async () => {
    const current = initialProfile();
    const reference = createExternalIdentityReference({
      system: "HOL_UAID",
      namespace: "hcs-14",
      network: "testnet",
      identifier: "uaid:production-persistence-agent",
      verificationLevel: "DECLARED",
      verificationMethod: null,
      evidenceSha256: null,
      linkedAt: new Date(Date.parse(current.updatedAt) + 1).toISOString(),
      verifiedAt: null,
    });
    const read = rpcClient(() => ({ data: current, error: null }));
    const command = rpcClient(() => ({
      data: null,
      error: { code: "23505", message: "EXTERNAL_IDENTITY_CONFLICT" },
    }));
    const repository = new SupabaseAgentIdentityRepository(read.client, command.client, authUserId);

    await expect(repository.linkExternalIdentity(agentId, 1, reference)).rejects.toThrow("EXTERNAL_IDENTITY_CONFLICT");
  });

  it("fails closed for corrupt stored documents, stale database races, and absent command credentials", async () => {
    const current = initialProfile();
    const tampered = { ...current, displayName: "Tampered without a new hash" };
    const corruptRead = rpcClient(() => ({ data: tampered, error: null }));
    const readOnly = new SupabaseAgentIdentityRepository(corruptRead.client, null, authUserId);
    await expect(readOnly.get(agentId)).rejects.toThrow("AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED");

    const validRead = rpcClient(() => ({ data: current, error: null }));
    await expect(
      new SupabaseAgentIdentityRepository(validRead.client, null, authUserId)
        .revise(agentId, 1, { displayName: "No command client" }),
    ).rejects.toThrow("AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE");

    const staleCommand = rpcClient(() => ({
      data: null,
      error: { code: "23514", message: "AGENT_IDENTITY_REVISION_CHAIN_INVALID" },
    }));
    await expect(
      new SupabaseAgentIdentityRepository(validRead.client, staleCommand.client, authUserId)
        .revise(agentId, 1, { displayName: "Lost race" }),
    ).rejects.toThrow("AGENT_IDENTITY_STALE_REVISION");
  });

  it("preserves the accepted SQLite behavior when Supabase mode is disabled", async () => {
    const shared = globalThis as typeof globalThis & { __doneLayerDemoStore?: DemoStore };
    const previousStore = shared.__doneLayerDemoStore;
    const previousMode = process.env.APP_MODE;
    const store = new DemoStore(":memory:");
    shared.__doneLayerDemoStore = store;
    delete process.env.APP_MODE;
    const actor = { id: "provider-alpha", name: "Provider Alpha", role: "PROVIDER" as const };
    try {
      const created = await createMarketplaceAgentWithIdentity(actor, agentInput());
      const current = await getMarketplaceAgentIdentity(actor, created.agentId);
      const revised = await reviseMarketplaceAgentIdentity({
        actor,
        agentId: created.agentId,
        expectedRevision: 1,
        patch: { displayName: "SQLite Compatibility V2" },
      });

      expect(current?.profileSha256).toBe(created.identity.profileSha256);
      expect(revised.revision).toBe(2);
      expect(revised.previousProfileSha256).toBe(created.identity.profileSha256);
    } finally {
      store.close();
      if (previousStore) shared.__doneLayerDemoStore = previousStore;
      else delete shared.__doneLayerDemoStore;
      if (previousMode === undefined) delete process.env.APP_MODE;
      else process.env.APP_MODE = previousMode;
    }
  });
});

function initialProfile() {
  return createAgentIdentityProfile({
    agentId,
    displayName: "Production Identity",
    controller: {
      controllerType: "PLATFORM_ACCOUNT",
      accountType: "USER",
      accountId: authUserId,
      relationship: "CONTROLS",
      assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
      legallyVerified: false,
    },
    declaredCapabilities: ["FEATURE_COMPLETION", "Postgres"],
    runtimeReferences: [{
      system: "DONE_LAYER",
      identifier: `marketplace-agent:${agentId}`,
      verificationLevel: "OBSERVED",
    }],
    createdAt: "2026-09-08T10:00:00.000Z",
  });
}

function agentInput(): MarketplaceAgentCreateInput {
  return {
    name: "Production Persistence Agent",
    slug: "production-persistence-agent",
    description: "Persists Agent Identity revisions atomically in the production data model.",
    skills: ["Postgres"],
    taskTypes: ["FEATURE_COMPLETION"],
    languages: ["TypeScript"],
    operatingSystems: ["LINUX"],
    tools: ["Node.js"],
    requiredMcpServers: [],
    pricingModel: "FIXED",
    basePriceCents: 25_000,
    endpointType: "LOCAL_WORKER",
    endpointUrl: null,
    authenticationType: "NONE",
    inputModes: ["application/json"],
    outputModes: ["application/json"],
  };
}

function rpcClient(handler: (
  name: string,
  parameters: Record<string, unknown>,
) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const rpc = vi.fn(async (name: string, parameters: Record<string, unknown>) => handler(name, parameters));
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}
