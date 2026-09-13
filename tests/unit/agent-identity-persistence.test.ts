import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  DemoStore,
  createExternalIdentityReference,
} from "@donelayer/database";
import { assertAgentIdentityAccess } from "../../apps/web/src/server/agent-identity/marketplace-agent-identity";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable Marketplace Agent identities", () => {
  it("creates the Marketplace Agent and its first hashed identity in one store transaction", async () => {
    const { store, databasePath } = await createStore();
    const agent = store.createAgent(agentInput("persistent-agent"));
    const profileV1 = store.getAgentIdentityProfile(agent.id);

    expect(profileV1).toMatchObject({
      agentId: agent.id,
      revision: 1,
      displayName: agent.name,
      status: "ACTIVE",
      controller: {
        accountId: agent.providerId,
        assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
        legallyVerified: false,
      },
      previousProfileSha256: null,
    });
    expect(profileV1?.declaredCapabilities).toEqual(expect.arrayContaining(["TypeScript", "TEST_AND_FIX"]));
    expect(profileV1?.profileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(store.verifyAgentIdentityStore()).toMatchObject({ valid: true, externalIdentityCount: 0 });

    store.close();
    const reopened = new DemoStore(databasePath);
    expect(reopened.getAgentIdentityProfile(agent.id)).toEqual(profileV1);
    expect(reopened.verifyAgentIdentityStore().valid).toBe(true);
    reopened.close();
  });

  it("appends revisions, preserves historical meaning, and rejects stale or post-revocation writes", async () => {
    const { store } = await createStore();
    const agent = store.createAgent(agentInput("revision-agent"));
    const profileV1 = store.getAgentIdentityProfile(agent.id)!;
    const profileV2 = store.reviseAgentIdentity({
      agentId: agent.id,
      expectedRevision: 1,
      patch: { displayName: "Revision Agent Two", declaredCapabilities: ["React", "TypeScript"] },
    });

    expect(profileV2).toMatchObject({ revision: 2, previousProfileSha256: profileV1.profileSha256 });
    expect(store.getAgentIdentityProfile(agent.id, 1)).toEqual(profileV1);
    expect(store.listAgentIdentityHistory(agent.id)).toEqual([profileV1, profileV2]);
    expect(() => store.reviseAgentIdentity({
      agentId: agent.id,
      expectedRevision: 1,
      patch: { displayName: "Stale" },
    })).toThrow("AGENT_IDENTITY_STALE_REVISION");

    const revoked = store.reviseAgentIdentity({
      agentId: agent.id,
      expectedRevision: 2,
      patch: { status: "REVOKED" },
    });
    expect(revoked.revision).toBe(3);
    expect(() => store.reviseAgentIdentity({
      agentId: agent.id,
      expectedRevision: 3,
      patch: { displayName: "Forbidden" },
    })).toThrow("AGENT_IDENTITY_REVOKED_TERMINAL");
    store.close();
  });

  it("keeps one external identity bound to one Agent across restarts", async () => {
    const { store, databasePath } = await createStore();
    const first = store.createAgent(agentInput("external-first"));
    const second = store.createAgent(agentInput("external-second"));
    const reference = externalReference();
    const linked = store.linkAgentExternalIdentity({
      agentId: first.id,
      expectedRevision: 1,
      reference,
    });

    expect(linked.externalIdentities).toEqual([reference]);
    expect(store.verifyAgentIdentityStore()).toMatchObject({ valid: true, externalIdentityCount: 1 });
    store.close();

    const reopened = new DemoStore(databasePath);
    expect(() => reopened.linkAgentExternalIdentity({
      agentId: second.id,
      expectedRevision: 1,
      reference,
    })).toThrow("EXTERNAL_IDENTITY_CONFLICT");
    expect(() => reopened.linkAgentExternalIdentity({
      agentId: first.id,
      expectedRevision: 2,
      reference,
    })).toThrow("EXTERNAL_IDENTITY_DUPLICATE");
    reopened.close();
  });

  it("enforces append-only SQL records and detects a deliberately bypassed tamper", async () => {
    const { store, databasePath } = await createStore();
    const agent = store.createAgent(agentInput("tamper-agent"));
    const database = databaseOf(store);
    expect(() => database.prepare(
      "UPDATE agent_identity_profiles SET profile_json='{}' WHERE agent_id=? AND revision=1",
    ).run(agent.id)).toThrow(/append-only/i);
    expect(() => database.prepare(
      "DELETE FROM agent_identity_profiles WHERE agent_id=? AND revision=1",
    ).run(agent.id)).toThrow(/cannot be deleted/i);
    store.close();

    const tamper = new DatabaseSync(databasePath);
    tamper.exec("DROP TRIGGER trg_agent_identity_profile_no_update");
    tamper.prepare("UPDATE agent_identity_profiles SET profile_json='{}' WHERE agent_id=? AND revision=1").run(agent.id);
    tamper.close();

    const reopened = new DemoStore(databasePath);
    expect(() => reopened.getAgentIdentityProfile(agent.id)).toThrow();
    expect(reopened.verifyAgentIdentityStore().valid).toBe(false);
    reopened.close();
  });

  it("limits identity reads and writes to the controller while allowing admin read-only review", async () => {
    const { store } = await createStore();
    const agent = store.createAgent(agentInput("access-agent"));
    const owner = { id: agent.providerId, name: "Provider", role: "PROVIDER" as const };
    const other = { id: "provider-other", name: "Other", role: "PROVIDER" as const };
    const admin = { id: "admin-demo", name: "Admin", role: "ADMIN" as const };

    expect(() => assertAgentIdentityAccess(owner, agent, "READ")).not.toThrow();
    expect(() => assertAgentIdentityAccess(owner, agent, "WRITE")).not.toThrow();
    expect(() => assertAgentIdentityAccess(admin, agent, "READ")).not.toThrow();
    expect(() => assertAgentIdentityAccess(admin, agent, "WRITE")).toThrow("AGENT_IDENTITY_ACCESS_DENIED");
    expect(() => assertAgentIdentityAccess(other, agent, "READ")).toThrow("AGENT_IDENTITY_ACCESS_DENIED");
    store.close();
  });

  it("creates a durable identity for platform-managed Agents in the same operation", async () => {
    const { store } = await createStore();
    const aggregate = store.createManagedSandboxTask();
    const agent = aggregate.agent!;
    const identity = store.getAgentIdentityProfile(agent.id);

    expect(identity).toMatchObject({
      agentId: agent.id,
      revision: 1,
      controller: { accountId: agent.providerId },
      runtimeReferences: [{
        system: "DONE_LAYER",
        identifier: `marketplace-agent:${agent.id}`,
        verificationLevel: "OBSERVED",
      }],
    });
    expect(store.verifyAgentIdentityStore().valid).toBe(true);
    store.close();
  });
});

async function createStore(): Promise<{ store: DemoStore; databasePath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "donelayer-agent-identity-"));
  roots.push(root);
  const databasePath = path.join(root, "donelayer.sqlite");
  return { store: new DemoStore(databasePath), databasePath };
}

function agentInput(slug: string): Parameters<DemoStore["createAgent"]>[0] {
  return {
    providerId: "provider-alpha",
    providerName: "Provider Alpha",
    name: slug.split("-").map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`).join(" "),
    slug,
    description: "A genuine Marketplace Agent profile used to exercise durable identity persistence.",
    skills: ["TypeScript"],
    taskTypes: ["TEST_AND_FIX"],
    languages: ["TypeScript"],
    operatingSystems: ["LINUX"],
    tools: ["Git", "Node.js"],
    requiredMcpServers: [],
    pricingModel: "FIXED",
    basePriceCents: 20_000,
    endpointType: "LOCAL_WORKER",
    endpointUrl: null,
    authenticationType: "NONE",
    inputModes: ["application/json"],
    outputModes: ["text/x-diff"],
  };
}

function externalReference() {
  return createExternalIdentityReference({
    system: "HOL_UAID",
    namespace: "hcs-14",
    network: "testnet",
    identifier: "uaid:durable-identity-test",
    verificationLevel: "DECLARED",
    verificationMethod: null,
    evidenceSha256: null,
    linkedAt: "2026-09-08T10:00:00.000Z",
    verifiedAt: null,
  });
}

function databaseOf(store: DemoStore): DatabaseSync {
  return (store as unknown as { db: DatabaseSync }).db;
}
