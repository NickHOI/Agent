import { sha256Canonical } from "@donelayer/database";

import {
  VercelAIGatewayAgentProvider,
  inspectVercelOidcToken,
  type VercelOidcProjectBinding,
  type VercelOidcStructuralAudit,
} from "../agent-execution/vercel-ai-gateway-provider";
import type { AgentExecutionProvider, AgentProviderAvailability } from "../agent-execution/provider";
import { materializeVerifiedSourcePackage } from "../managed-sandbox/repository-source";
import {
  runReputationEntrySourcePreflight,
  type ReputationEntrySourcePreflightEvidence,
} from "./source-preflight";
import type { ReputationEntryPilotSource } from "./orchestrator";

export const REPUTATION_ENTRY_PHASE_B_PREFLIGHT = "PHASE_B_SOURCE_AND_PROVIDER_PREFLIGHT_V1" as const;

export type ReputationEntryPhaseBPreflightEvidence = {
  preflight: typeof REPUTATION_ENTRY_PHASE_B_PREFLIGHT;
  attemptId: string;
  status: "PASS" | "BLOCKED";
  startedAt: string;
  completedAt: string;
  source: ReputationEntrySourcePreflightEvidence;
  oidc: VercelOidcStructuralAudit | null;
  provider: {
    checkType: "READ_ONLY_NON_MODEL_CATALOG_PREFLIGHT";
    availability: AgentProviderAvailability | null;
    modelRequestsPerformed: false;
    externalMutationPerformed: false;
  };
  checks: {
    oidcStructurallyValid: boolean;
    oidcBoundToLinkedProject: boolean;
    oidcNotExpired: boolean;
    gatewayCatalogAvailable: boolean;
    exactCommitsMaterialized: boolean;
    temporaryWorkspacesCleaned: boolean;
    externalMutationPerformed: false;
    jobLifecycleStateCreated: false;
  };
  failure: { stage: "SOURCE" | "OIDC" | "PROVIDER"; code: string; message: string } | null;
  evidenceSha256: string;
};

export async function runReputationEntryPhaseBPreflight(input: {
  attemptId: string;
  sources: ReputationEntryPilotSource[];
  linkedProject: VercelOidcProjectBinding;
  oidcToken?: string;
  provider?: AgentExecutionProvider;
  materialize?: typeof materializeVerifiedSourcePackage;
  startedAt?: string;
}): Promise<ReputationEntryPhaseBPreflightEvidence> {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const source = await runReputationEntrySourcePreflight({
    attemptId: input.attemptId,
    sources: input.sources,
    startedAt,
    ...(input.materialize ? { materialize: input.materialize } : {}),
  });
  let oidc: VercelOidcStructuralAudit | null = null;
  let availability: AgentProviderAvailability | null = null;
  let failure: ReputationEntryPhaseBPreflightEvidence["failure"] = null;

  if (source.status !== "PASS") {
    failure = {
      stage: "SOURCE",
      code: source.failure?.stage ?? "SOURCE_PREFLIGHT_BLOCKED",
      message: source.failure?.message ?? "Source preflight did not materialize both approved commits",
    };
  } else {
    try {
      oidc = inspectVercelOidcToken(input.oidcToken ?? process.env.VERCEL_OIDC_TOKEN, input.linkedProject, startedAt);
    } catch (error) {
      failure = safeFailure("OIDC", error);
    }
  }

  if (!failure) {
    availability = await (input.provider ?? new VercelAIGatewayAgentProvider()).checkAvailability();
    if (!availability.available || availability.authentication !== "VERCEL_OIDC" || !availability.credits) {
      failure = {
        stage: "PROVIDER",
        code: availability.errorCode ?? "AI_GATEWAY_PREFLIGHT_BLOCKED",
        message: availability.errorMessage ?? "AI Gateway catalog preflight did not pass",
      };
    }
  }

  const body = {
    preflight: REPUTATION_ENTRY_PHASE_B_PREFLIGHT,
    attemptId: input.attemptId,
    status: failure ? "BLOCKED" as const : "PASS" as const,
    startedAt,
    completedAt: new Date().toISOString(),
    source,
    oidc,
    provider: {
      checkType: "READ_ONLY_NON_MODEL_CATALOG_PREFLIGHT" as const,
      availability,
      modelRequestsPerformed: false as const,
      externalMutationPerformed: false as const,
    },
    checks: {
      oidcStructurallyValid: oidc?.structurallyValid === true,
      oidcBoundToLinkedProject: oidc?.boundToLinkedProject === true,
      oidcNotExpired: oidc?.notExpired === true,
      gatewayCatalogAvailable: availability?.available === true,
      exactCommitsMaterialized: source.checks.exactCommitsMaterialized,
      temporaryWorkspacesCleaned: source.checks.temporaryWorkspacesCleaned,
      externalMutationPerformed: false as const,
      jobLifecycleStateCreated: false as const,
    },
    failure,
  };
  return { ...body, evidenceSha256: sha256Canonical(body) };
}

function safeFailure(stage: "OIDC" | "PROVIDER", error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    stage,
    code: message.split(":", 1)[0]!.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 100) || "UNKNOWN_FAILURE",
    message: message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 500),
  };
}
