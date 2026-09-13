import { randomBytes } from "node:crypto";

import { canonicalJson, sha256Canonical } from "./trust-foundation";

export const AGENT_IDENTITY_GATE = "AGENT_IDENTITY_AND_INTEROPERABILITY_V1_DESIGN_AND_EVIDENCE_GATE" as const;
export const AGENT_IDENTITY_PROFILE_TYPE = "AGENT_IDENTITY_PROFILE_V1" as const;
export const AGENT_IDENTITY_GATE_AGENT_ID = "agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5" as const;

export type AgentIdentityStatus = "ACTIVE" | "DISABLED" | "REVOKED";
export type ExternalIdentityVerificationLevel = "DECLARED" | "OBSERVED" | "VERIFIED";
export type ExternalIdentitySystem = "ERC_8004" | "HOL_UAID" | "A2A_AGENT_CARD" | "PROVIDER_RUNTIME" | "OTHER";

export type AgentIdentityReference = {
  agentId: string;
  profileRevision: number;
  profileSha256: string;
};

export type AgentController = {
  controllerType: "PLATFORM_ACCOUNT";
  accountType: "USER" | "ORGANIZATION" | "SERVICE_ACCOUNT";
  accountId: string;
  relationship: "CONTROLS";
  assurance: "PLATFORM_ACCOUNT_RELATIONSHIP";
  legallyVerified: false;
};

export type AgentRuntimeReference = {
  system: "DONE_LAYER" | "VERCEL_AI_GATEWAY" | "EXTERNAL_PROVIDER";
  identifier: string;
  verificationLevel: "DECLARED" | "OBSERVED";
};

export type ExternalAgentIdentityReference = {
  referenceVersion: 1;
  system: ExternalIdentitySystem;
  namespace: string;
  network: string | null;
  identifier: string;
  verificationLevel: ExternalIdentityVerificationLevel;
  verificationMethod: string | null;
  evidenceSha256: string | null;
  linkedAt: string;
  verifiedAt: string | null;
};

export type AgentIdentityProfile = {
  schemaVersion: 1;
  profileType: typeof AGENT_IDENTITY_PROFILE_TYPE;
  agentId: string;
  revision: number;
  displayName: string;
  status: AgentIdentityStatus;
  controller: AgentController;
  declaredCapabilities: string[];
  runtimeReferences: AgentRuntimeReference[];
  externalIdentities: ExternalAgentIdentityReference[];
  createdAt: string;
  updatedAt: string;
  previousProfileSha256: string | null;
  profileSha256: string;
};

export type AgentIdentityReceiptBinding = AgentIdentityReference & {
  displayNameAtExecution: string;
  statusAtExecution: "ACTIVE";
  controllerAtExecution: AgentController;
};

type AgentIdentityProfilePatch = Partial<Pick<
  AgentIdentityProfile,
  "displayName" | "status" | "declaredCapabilities" | "runtimeReferences" | "externalIdentities"
>>;

export function generateAgentId(): string {
  return `agt_${randomBytes(18).toString("base64url")}`;
}

export function agentIdentityReference(profile: AgentIdentityProfile): AgentIdentityReference {
  assertAgentIdentityProfileIntegrity(profile);
  return {
    agentId: profile.agentId,
    profileRevision: profile.revision,
    profileSha256: profile.profileSha256,
  };
}

export function agentIdentityReceiptBinding(profile: AgentIdentityProfile): AgentIdentityReceiptBinding {
  assertAgentIdentityProfileUsable(profile);
  return {
    ...agentIdentityReference(profile),
    displayNameAtExecution: profile.displayName,
    statusAtExecution: "ACTIVE",
    controllerAtExecution: structuredClone(profile.controller),
  };
}

export function createAgentIdentityProfile(input: {
  agentId?: string;
  displayName: string;
  controller: AgentController;
  declaredCapabilities?: string[];
  runtimeReferences?: AgentRuntimeReference[];
  externalIdentities?: ExternalAgentIdentityReference[];
  createdAt?: string;
}): AgentIdentityProfile {
  const createdAt = validTimestamp(input.createdAt ?? new Date().toISOString(), "Agent profile creation time");
  const body: Omit<AgentIdentityProfile, "profileSha256"> = {
    schemaVersion: 1,
    profileType: AGENT_IDENTITY_PROFILE_TYPE,
    agentId: validAgentId(input.agentId ?? generateAgentId()),
    revision: 1,
    displayName: requiredText(input.displayName, "Agent display name"),
    status: "ACTIVE",
    controller: validController(input.controller),
    declaredCapabilities: normalizedValues(input.declaredCapabilities ?? []),
    runtimeReferences: normalizedRuntimeReferences(input.runtimeReferences ?? []),
    externalIdentities: normalizedExternalIdentities(input.externalIdentities ?? []),
    createdAt,
    updatedAt: createdAt,
    previousProfileSha256: null,
  };
  const profile = { ...body, profileSha256: sha256Canonical(body) };
  assertAgentIdentityProfileIntegrity(profile);
  return profile;
}

export function reviseAgentIdentityProfile(input: {
  current: AgentIdentityProfile;
  expectedRevision: number;
  patch: AgentIdentityProfilePatch;
  updatedAt?: string;
}): AgentIdentityProfile {
  assertAgentIdentityProfileIntegrity(input.current);
  if (input.current.revision !== input.expectedRevision) throw new Error("AGENT_IDENTITY_STALE_REVISION");
  if (input.current.status === "REVOKED") throw new Error("AGENT_IDENTITY_REVOKED_TERMINAL");
  const updatedAt = validTimestamp(input.updatedAt ?? new Date().toISOString(), "Agent profile update time");
  if (Date.parse(updatedAt) <= Date.parse(input.current.updatedAt)) throw new Error("AGENT_IDENTITY_REVISION_TIME_INVALID");
  const nextStatus = input.patch.status ?? input.current.status;
  if (input.current.status === "DISABLED" && nextStatus === "ACTIVE") {
    throw new Error("AGENT_IDENTITY_REENABLE_REQUIRES_SEPARATE_POLICY");
  }
  const body: Omit<AgentIdentityProfile, "profileSha256"> = {
    schemaVersion: 1,
    profileType: AGENT_IDENTITY_PROFILE_TYPE,
    agentId: input.current.agentId,
    revision: input.current.revision + 1,
    displayName: requiredText(input.patch.displayName ?? input.current.displayName, "Agent display name"),
    status: nextStatus,
    controller: structuredClone(input.current.controller),
    declaredCapabilities: normalizedValues(input.patch.declaredCapabilities ?? input.current.declaredCapabilities),
    runtimeReferences: normalizedRuntimeReferences(input.patch.runtimeReferences ?? input.current.runtimeReferences),
    externalIdentities: normalizedExternalIdentities(input.patch.externalIdentities ?? input.current.externalIdentities),
    createdAt: input.current.createdAt,
    updatedAt,
    previousProfileSha256: input.current.profileSha256,
  };
  const profile = { ...body, profileSha256: sha256Canonical(body) };
  assertAgentIdentityProfileIntegrity(profile);
  return profile;
}

export function assertAgentIdentityProfileIntegrity(profile: AgentIdentityProfile): void {
  const { profileSha256, ...body } = profile;
  if (
    profile.schemaVersion !== 1 ||
    profile.profileType !== AGENT_IDENTITY_PROFILE_TYPE ||
    !Number.isSafeInteger(profile.revision) ||
    profile.revision < 1 ||
    !/^[a-f0-9]{64}$/.test(profileSha256) ||
    sha256Canonical(body) !== profileSha256 ||
    (profile.revision === 1) !== (profile.previousProfileSha256 === null) ||
    (profile.previousProfileSha256 !== null && !/^[a-f0-9]{64}$/.test(profile.previousProfileSha256)) ||
    Date.parse(profile.updatedAt) < Date.parse(profile.createdAt)
  ) throw new Error("AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED");
  validAgentId(profile.agentId);
  requiredText(profile.displayName, "Agent display name");
  validTimestamp(profile.createdAt, "Agent profile creation time");
  validTimestamp(profile.updatedAt, "Agent profile update time");
  validController(profile.controller);
  if (canonicalJson(profile.declaredCapabilities) !== canonicalJson(normalizedValues(profile.declaredCapabilities))) {
    throw new Error("AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED");
  }
  if (canonicalJson(profile.runtimeReferences) !== canonicalJson(normalizedRuntimeReferences(profile.runtimeReferences))) {
    throw new Error("AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED");
  }
  if (canonicalJson(profile.externalIdentities) !== canonicalJson(normalizedExternalIdentities(profile.externalIdentities))) {
    throw new Error("AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED");
  }
}

export function assertAgentIdentityProfileUsable(profile: AgentIdentityProfile): void {
  assertAgentIdentityProfileIntegrity(profile);
  if (profile.status !== "ACTIVE") throw new Error(`AGENT_IDENTITY_${profile.status}`);
}

export function assertAgentIdentityReference(
  reference: AgentIdentityReference,
  expected?: AgentIdentityProfile | AgentIdentityReference,
): void {
  validAgentId(reference.agentId);
  if (!Number.isSafeInteger(reference.profileRevision) || reference.profileRevision < 1 || !/^[a-f0-9]{64}$/.test(reference.profileSha256)) {
    throw new Error("AGENT_IDENTITY_REFERENCE_INVALID");
  }
  if (expected) {
    const expectedReference = "profileSha256" in expected && "revision" in expected
      ? agentIdentityReference(expected)
      : expected;
    if (canonicalJson(reference) !== canonicalJson(expectedReference)) throw new Error("AGENT_IDENTITY_REFERENCE_MISMATCH");
  }
}

export function createExternalIdentityReference(input: Omit<ExternalAgentIdentityReference, "referenceVersion">): ExternalAgentIdentityReference {
  return validExternalIdentityReference({ referenceVersion: 1, ...input });
}

export function assertExternalIdentityVerified(reference: ExternalAgentIdentityReference): void {
  const valid = validExternalIdentityReference(reference);
  if (valid.verificationLevel !== "VERIFIED") throw new Error("EXTERNAL_IDENTITY_NOT_VERIFIED");
}

export class AgentIdentityRegistry {
  private readonly histories = new Map<string, AgentIdentityProfile[]>();
  private readonly externalOwners = new Map<string, string>();

  register(profile: AgentIdentityProfile): AgentIdentityProfile {
    assertAgentIdentityProfileIntegrity(profile);
    if (profile.revision !== 1 || this.histories.has(profile.agentId)) throw new Error("AGENT_IDENTITY_ALREADY_EXISTS");
    this.assertExternalOwnership(profile.agentId, profile.externalIdentities);
    this.histories.set(profile.agentId, [structuredClone(profile)]);
    this.rememberExternalOwnership(profile.agentId, profile.externalIdentities);
    return structuredClone(profile);
  }

  current(agentId: string): AgentIdentityProfile {
    validAgentId(agentId);
    const profile = this.histories.get(agentId)?.at(-1);
    if (!profile) throw new Error("AGENT_IDENTITY_UNKNOWN");
    return structuredClone(profile);
  }

  revision(agentId: string, revision: number): AgentIdentityProfile {
    const profile = this.histories.get(validAgentId(agentId))?.find((item) => item.revision === revision);
    if (!profile) throw new Error("AGENT_IDENTITY_REVISION_UNKNOWN");
    return structuredClone(profile);
  }

  revise(agentId: string, expectedRevision: number, patch: AgentIdentityProfilePatch, updatedAt?: string): AgentIdentityProfile {
    const next = reviseAgentIdentityProfile({
      current: this.current(agentId),
      expectedRevision,
      patch,
      ...(updatedAt ? { updatedAt } : {}),
    });
    this.assertExternalOwnership(agentId, next.externalIdentities);
    this.histories.get(agentId)!.push(structuredClone(next));
    this.rememberExternalOwnership(agentId, next.externalIdentities);
    return structuredClone(next);
  }

  linkExternalIdentity(agentId: string, expectedRevision: number, reference: ExternalAgentIdentityReference, updatedAt?: string): AgentIdentityProfile {
    const current = this.current(agentId);
    const normalized = validExternalIdentityReference(reference);
    const key = agentExternalIdentityKey(normalized);
    if (current.externalIdentities.some((item) => agentExternalIdentityKey(item) === key)) throw new Error("EXTERNAL_IDENTITY_DUPLICATE");
    return this.revise(agentId, expectedRevision, {
      externalIdentities: [...current.externalIdentities, normalized],
    }, updatedAt);
  }

  private assertExternalOwnership(agentId: string, references: ExternalAgentIdentityReference[]): void {
    for (const reference of references) {
      const owner = this.externalOwners.get(agentExternalIdentityKey(reference));
      if (owner && owner !== agentId) throw new Error("EXTERNAL_IDENTITY_CONFLICT");
    }
  }

  private rememberExternalOwnership(agentId: string, references: ExternalAgentIdentityReference[]): void {
    for (const reference of references) this.externalOwners.set(agentExternalIdentityKey(reference), agentId);
  }
}

function normalizedRuntimeReferences(references: AgentRuntimeReference[]): AgentRuntimeReference[] {
  const normalized = references.map((reference) => ({
    system: reference.system,
    identifier: requiredText(reference.identifier, "Runtime identifier"),
    verificationLevel: reference.verificationLevel,
  }));
  if (new Set(normalized.map((item) => `${item.system}:${item.identifier}`)).size !== normalized.length) {
    throw new Error("AGENT_RUNTIME_REFERENCE_DUPLICATE");
  }
  return normalized.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function normalizedExternalIdentities(references: ExternalAgentIdentityReference[]): ExternalAgentIdentityReference[] {
  const normalized = references.map(validExternalIdentityReference);
  if (new Set(normalized.map(agentExternalIdentityKey)).size !== normalized.length) throw new Error("EXTERNAL_IDENTITY_DUPLICATE");
  return normalized.sort((left, right) => agentExternalIdentityKey(left).localeCompare(agentExternalIdentityKey(right)));
}

function validExternalIdentityReference(reference: ExternalAgentIdentityReference): ExternalAgentIdentityReference {
  const namespace = requiredText(reference.namespace, "External identity namespace");
  const identifier = requiredText(reference.identifier, "External identity identifier");
  const linkedAt = validTimestamp(reference.linkedAt, "External identity linkage time");
  if (reference.referenceVersion !== 1) throw new Error("EXTERNAL_IDENTITY_VERSION_UNSUPPORTED");
  if (reference.system === "ERC_8004") {
    if (!/^eip155:[1-9][0-9]*:0x[a-fA-F0-9]{40}$/.test(namespace) || !/^(0|[1-9][0-9]*)$/.test(identifier)) {
      throw new Error("EXTERNAL_IDENTITY_IDENTIFIER_INVALID");
    }
  } else if (reference.system === "HOL_UAID") {
    if (namespace !== "hcs-14" || !/^(?:uaid|did:uaid):[A-Za-z0-9._:;=%-]{4,500}$/.test(identifier)) {
      throw new Error("EXTERNAL_IDENTITY_IDENTIFIER_INVALID");
    }
  } else if (reference.system === "A2A_AGENT_CARD") {
    try {
      const url = new URL(identifier);
      if (url.protocol !== "https:") throw new Error();
    } catch {
      throw new Error("EXTERNAL_IDENTITY_IDENTIFIER_INVALID");
    }
  } else if (!/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,499}$/.test(identifier)) {
    throw new Error("EXTERNAL_IDENTITY_IDENTIFIER_INVALID");
  }
  if (reference.verificationLevel === "VERIFIED") {
    if (!reference.verificationMethod?.trim() || !reference.evidenceSha256?.match(/^[a-f0-9]{64}$/) || !reference.verifiedAt) {
      throw new Error("EXTERNAL_IDENTITY_VERIFICATION_EVIDENCE_REQUIRED");
    }
    validTimestamp(reference.verifiedAt, "External identity verification time");
  } else if (reference.verifiedAt !== null) {
    throw new Error("EXTERNAL_IDENTITY_VERIFICATION_LEVEL_MISMATCH");
  }
  return {
    referenceVersion: 1,
    system: reference.system,
    namespace,
    network: reference.network === null ? null : requiredText(reference.network, "External identity network"),
    identifier,
    verificationLevel: reference.verificationLevel,
    verificationMethod: reference.verificationMethod?.trim() || null,
    evidenceSha256: reference.evidenceSha256,
    linkedAt,
    verifiedAt: reference.verifiedAt,
  };
}

export function agentExternalIdentityKey(reference: ExternalAgentIdentityReference): string {
  return [reference.system, reference.namespace.toLowerCase(), reference.network?.toLowerCase() ?? "", reference.identifier.toLowerCase()].join(":");
}

function normalizedValues(values: string[]): string[] {
  return [...new Set(values.map((value) => requiredText(value, "Agent capability")))].sort();
}

function validController(controller: AgentController): AgentController {
  if (
    controller.controllerType !== "PLATFORM_ACCOUNT" ||
    controller.relationship !== "CONTROLS" ||
    controller.assurance !== "PLATFORM_ACCOUNT_RELATIONSHIP" ||
    controller.legallyVerified !== false
  ) throw new Error("AGENT_CONTROLLER_INVALID");
  return { ...controller, accountId: requiredText(controller.accountId, "Controller account ID") };
}

function validAgentId(value: string): string {
  const v1Id = /^agt_[A-Za-z0-9_-]{20,64}$/;
  const legacyOpaqueUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  const legacyMarketplaceId = /^agent-[a-z0-9]+(?:-[a-z0-9]+){1,7}$/;
  if (!v1Id.test(value) && !legacyOpaqueUuid.test(value) && !legacyMarketplaceId.test(value)) {
    throw new Error("AGENT_IDENTITY_ID_INVALID");
  }
  return value;
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function validTimestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
  return value;
}
