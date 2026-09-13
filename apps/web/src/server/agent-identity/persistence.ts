import "server-only";

import { randomUUID } from "node:crypto";

import {
  agentExternalIdentityKey,
  assertAgentIdentityProfileIntegrity,
  assertAgentIdentityReference,
  createAgentIdentityProfile,
  getDemoStore,
  reviseAgentIdentityProfile,
  type AgentIdentityProfile,
  type ExternalAgentIdentityReference,
} from "@donelayer/database";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "../auth";
import { createSupabaseCommandClient, createSupabaseUserClient } from "../supabase-auth";
import { assertAgentIdentityAccess } from "./marketplace-agent-identity";

export type MarketplaceAgentCreateInput = {
  name: string;
  slug: string;
  description: string;
  skills: string[];
  taskTypes: Array<
    | "DIAGNOSE_REPOSITORY"
    | "BUILD_RESCUE"
    | "TEST_AND_FIX"
    | "FEATURE_COMPLETION"
    | "PULL_REQUEST_VERIFICATION"
    | "LAUNCH_READINESS"
  >;
  languages: string[];
  operatingSystems: Array<"WINDOWS" | "MACOS" | "LINUX">;
  tools: string[];
  requiredMcpServers: string[];
  pricingModel: "FIXED" | "HOURLY" | "FROM";
  basePriceCents: number;
  endpointType: "LOCAL_WORKER" | "WEBHOOK" | "A2A";
  endpointUrl: string | null;
  authenticationType: "NONE" | "HMAC" | "API_KEY" | "OAUTH" | "A2A_METADATA";
  inputModes: string[];
  outputModes: string[];
};

type IdentityPatch = Partial<Pick<
  AgentIdentityProfile,
  "displayName" | "status" | "declaredCapabilities" | "runtimeReferences"
>>;

type AgentCreateResult = {
  agentId: string;
  slug: string;
  identity: AgentIdentityProfile;
};

type RpcError = { message?: string; code?: string; details?: string; hint?: string };

export class SupabaseAgentIdentityRepository {
  constructor(
    private readonly readClient: SupabaseClient,
    private readonly commandClient: SupabaseClient | null,
    private readonly authUserId: string,
  ) {
    if (!isUuid(authUserId)) throw new Error("AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE");
  }

  async get(agentId: string, revision?: number): Promise<AgentIdentityProfile | null> {
    const { data, error } = await this.readClient.rpc("rpc_get_agent_identity", {
      p_agent_id: agentId,
      p_revision: revision ?? null,
    });
    if (error) throwMappedPersistenceError(error, "AGENT_IDENTITY_READ_FAILED");
    if (data === null) return null;
    const profile = parseProfile(data);
    if (profile.agentId !== agentId || (revision !== undefined && profile.revision !== revision)) {
      throw new Error("AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED");
    }
    return profile;
  }

  async createAgent(input: MarketplaceAgentCreateInput): Promise<AgentCreateResult> {
    const commandClient = this.requireCommandClient();
    const agentId = randomUUID();
    const createdAt = new Date().toISOString();
    const identity = createAgentIdentityProfile({
      agentId,
      displayName: input.name,
      controller: {
        controllerType: "PLATFORM_ACCOUNT",
        accountType: "USER",
        accountId: this.authUserId,
        relationship: "CONTROLS",
        assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
        legallyVerified: false,
      },
      declaredCapabilities: [...input.skills, ...input.taskTypes],
      runtimeReferences: [{
        system: "DONE_LAYER",
        identifier: `marketplace-agent:${agentId}`,
        verificationLevel: "OBSERVED",
      }],
      createdAt,
    });
    const { data, error } = await commandClient.rpc("rpc_create_agent_with_identity", {
      p_auth_user_id: this.authUserId,
      p_agent: { id: agentId, createdAt, ...input },
      p_profile: identity,
    });
    if (error) throwMappedPersistenceError(error, "AGENT_CREATE_FAILED");
    if (!isRecord(data) || data.agentId !== agentId || data.slug !== input.slug) {
      throw new Error("AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE");
    }
    const persisted = parseProfile(data.profile);
    assertAgentIdentityReference(
      { agentId: persisted.agentId, profileRevision: persisted.revision, profileSha256: persisted.profileSha256 },
      identity,
    );
    return { agentId, slug: input.slug, identity: persisted };
  }

  async revise(agentId: string, expectedRevision: number, patch: IdentityPatch): Promise<AgentIdentityProfile> {
    const current = await this.get(agentId);
    if (!current) throw new Error("AGENT_IDENTITY_UNKNOWN");
    const next = reviseAgentIdentityProfile({
      current,
      expectedRevision,
      patch,
      updatedAt: nextRevisionTimestamp(current),
    });
    return this.append(next);
  }

  async linkExternalIdentity(
    agentId: string,
    expectedRevision: number,
    reference: ExternalAgentIdentityReference,
  ): Promise<AgentIdentityProfile> {
    const current = await this.get(agentId);
    if (!current) throw new Error("AGENT_IDENTITY_UNKNOWN");
    const identityKey = agentExternalIdentityKey(reference);
    if (current.externalIdentities.some((item) => agentExternalIdentityKey(item) === identityKey)) {
      throw new Error("EXTERNAL_IDENTITY_DUPLICATE");
    }
    const next = reviseAgentIdentityProfile({
      current,
      expectedRevision,
      patch: { externalIdentities: [...current.externalIdentities, reference] },
      updatedAt: nextRevisionTimestamp(current),
    });
    return this.append(next);
  }

  private async append(next: AgentIdentityProfile): Promise<AgentIdentityProfile> {
    const { data, error } = await this.requireCommandClient().rpc("rpc_append_agent_identity_revision", {
      p_auth_user_id: this.authUserId,
      p_profile: next,
    });
    if (error) throwMappedPersistenceError(error, "AGENT_IDENTITY_WRITE_FAILED");
    const persisted = parseProfile(data);
    assertAgentIdentityReference(
      { agentId: persisted.agentId, profileRevision: persisted.revision, profileSha256: persisted.profileSha256 },
      next,
    );
    return persisted;
  }

  private requireCommandClient(): SupabaseClient {
    if (!this.commandClient) throw new Error("AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE");
    return this.commandClient;
  }
}

export async function createMarketplaceAgentWithIdentity(
  actor: Actor,
  input: MarketplaceAgentCreateInput,
): Promise<AgentCreateResult> {
  if (process.env.APP_MODE === "supabase") {
    return (await createSupabaseRepository(actor, true)).createAgent(input);
  }
  const store = getDemoStore();
  const agent = store.createAgent({ ...input, providerId: actor.id, providerName: actor.name });
  const identity = store.getAgentIdentityProfile(agent.id);
  if (!identity) throw new Error("Agent identity transaction did not persist a profile.");
  return { agentId: agent.id, slug: agent.slug, identity };
}

export async function getMarketplaceAgentIdentity(
  actor: Actor,
  agentId: string,
  revision?: number,
): Promise<AgentIdentityProfile | null> {
  if (process.env.APP_MODE === "supabase") {
    return (await createSupabaseRepository(actor, false)).get(agentId, revision);
  }
  const store = getDemoStore();
  const agent = store.getAgentById(agentId);
  if (!agent) return null;
  assertAgentIdentityAccess(actor, agent, "READ");
  return store.getAgentIdentityProfile(agentId, revision);
}

export async function reviseMarketplaceAgentIdentity(input: {
  actor: Actor;
  agentId: string;
  expectedRevision: number;
  patch: IdentityPatch;
}): Promise<AgentIdentityProfile> {
  if (process.env.APP_MODE === "supabase") {
    return (await createSupabaseRepository(input.actor, true)).revise(
      input.agentId,
      input.expectedRevision,
      input.patch,
    );
  }
  const store = getDemoStore();
  const agent = store.getAgentById(input.agentId);
  if (!agent) throw new Error("AGENT_IDENTITY_UNKNOWN");
  assertAgentIdentityAccess(input.actor, agent, "WRITE");
  return store.reviseAgentIdentity({
    agentId: input.agentId,
    expectedRevision: input.expectedRevision,
    patch: input.patch,
  });
}

export async function linkMarketplaceAgentExternalIdentity(input: {
  actor: Actor;
  agentId: string;
  expectedRevision: number;
  reference: ExternalAgentIdentityReference;
}): Promise<AgentIdentityProfile> {
  if (process.env.APP_MODE === "supabase") {
    return (await createSupabaseRepository(input.actor, true)).linkExternalIdentity(
      input.agentId,
      input.expectedRevision,
      input.reference,
    );
  }
  const store = getDemoStore();
  const agent = store.getAgentById(input.agentId);
  if (!agent) throw new Error("AGENT_IDENTITY_UNKNOWN");
  assertAgentIdentityAccess(input.actor, agent, "WRITE");
  return store.linkAgentExternalIdentity({
    agentId: input.agentId,
    expectedRevision: input.expectedRevision,
    reference: input.reference,
  });
}

async function createSupabaseRepository(actor: Actor, withCommands: boolean) {
  const readClient = await createSupabaseUserClient();
  const commandClient = withCommands ? createSupabaseCommandClient() : null;
  return new SupabaseAgentIdentityRepository(readClient, commandClient, actor.id);
}

function parseProfile(value: unknown): AgentIdentityProfile {
  if (!isRecord(value)) throw new Error("AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED");
  const profile = structuredClone(value) as AgentIdentityProfile;
  assertAgentIdentityProfileIntegrity(profile);
  return profile;
}

function nextRevisionTimestamp(current: AgentIdentityProfile): string {
  return new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
}

function throwMappedPersistenceError(error: RpcError, fallback: string): never {
  const text = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  const knownCodes = [
    "AGENT_IDENTITY_ACCESS_DENIED",
    "AGENT_CREATE_PROVIDER_ACCESS_DENIED",
    "AGENT_IDENTITY_REVOKED_TERMINAL",
    "AGENT_IDENTITY_REENABLE_REQUIRES_SEPARATE_POLICY",
    "AGENT_IDENTITY_CONTROLLER_MISMATCH",
    "EXTERNAL_IDENTITY_DUPLICATE",
    "EXTERNAL_IDENTITY_CONFLICT",
  ];
  for (const code of knownCodes) {
    if (text.includes(code)) {
      throw new Error(code === "AGENT_CREATE_PROVIDER_ACCESS_DENIED" ? "AGENT_IDENTITY_ACCESS_DENIED" : code);
    }
  }
  if (text.includes("AGENT_IDENTITY_REVISION_CHAIN_INVALID") || text.includes("agent_identity_profiles_pkey")) {
    throw new Error("AGENT_IDENTITY_STALE_REVISION");
  }
  if (text.includes("agents_slug_key")) throw new Error("AGENT_SLUG_CONFLICT");
  if (error.code === "42501") throw new Error("AGENT_IDENTITY_ACCESS_DENIED");
  throw new Error(fallback === "AGENT_CREATE_FAILED" ? fallback : "AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
