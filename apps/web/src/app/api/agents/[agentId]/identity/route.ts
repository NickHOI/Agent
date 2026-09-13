import { z } from "zod";

import { agentIdentityReference } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import {
  getMarketplaceAgentIdentity,
  reviseMarketplaceAgentIdentity,
} from "@/server/agent-identity/persistence";
import { enforceRateLimit } from "@/server/rate-limit";

const revisionSchema = z.coerce.number().int().positive();
const patchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "REVOKED"]).optional(),
  declaredCapabilities: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
}).strict().refine(
  (value) => value.displayName !== undefined || value.status !== undefined || value.declaredCapabilities !== undefined,
  { message: "At least one identity field must change." },
);

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const actor = await getActor();
  if (!actor) return noStoreJson({ error: "Authentication required." }, { status: 401 });
  const { agentId } = await context.params;
  try {
    const revisionValue = new URL(request.url).searchParams.get("revision");
    const revision = revisionValue === null ? undefined : revisionSchema.parse(revisionValue);
    const profile = await getMarketplaceAgentIdentity(actor, agentId, revision);
    if (!profile) return noStoreJson({ error: "Agent identity revision not found." }, { status: 404 });
    return noStoreJson({ profile, reference: agentIdentityReference(profile) });
  } catch (error) {
    return identityErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "agent-identity-revise", 20);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor) return noStoreJson({ error: "Authentication required." }, { status: 401 });
  const { agentId } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({ error: "Agent identity validation failed.", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const { expectedRevision } = parsed.data;
    const patch = {
      ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.declaredCapabilities !== undefined
        ? { declaredCapabilities: parsed.data.declaredCapabilities }
        : {}),
    };
    const profile = await reviseMarketplaceAgentIdentity({ actor, agentId, expectedRevision, patch });
    return noStoreJson({ profile, reference: agentIdentityReference(profile) });
  } catch (error) {
    return identityErrorResponse(error);
  }
}

function identityErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to access Agent identity.";
  if (message === "AGENT_IDENTITY_ACCESS_DENIED") {
    return noStoreJson({ error: "Agent identity access denied." }, { status: 403 });
  }
  if (message === "AGENT_IDENTITY_STALE_REVISION") {
    return noStoreJson({ error: "Agent identity revision is stale." }, { status: 409 });
  }
  if (message === "AGENT_IDENTITY_UNKNOWN" || message === "AGENT_IDENTITY_REVISION_UNKNOWN") {
    return noStoreJson({ error: "Agent identity revision not found." }, { status: 404 });
  }
  if (message === "AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE" || message === "AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED") {
    return noStoreJson({ error: "Agent identity persistence is unavailable." }, { status: 503 });
  }
  return noStoreJson({ error: message }, { status: 400 });
}
