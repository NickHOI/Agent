import { z } from "zod";

import { agentIdentityReference, createExternalIdentityReference } from "@donelayer/database";
import { linkMarketplaceAgentExternalIdentity } from "@/server/agent-identity/persistence";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

const schema = z.object({
  expectedRevision: z.number().int().positive(),
  system: z.enum(["ERC_8004", "HOL_UAID", "A2A_AGENT_CARD", "PROVIDER_RUNTIME", "OTHER"]),
  namespace: z.string().trim().min(1).max(500),
  network: z.string().trim().min(1).max(200).nullable(),
  identifier: z.string().trim().min(1).max(500),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "agent-external-identity-link", 10);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor) return noStoreJson({ error: "Authentication required." }, { status: 401 });
  const { agentId } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({ error: "External identity validation failed.", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const { expectedRevision, ...identity } = parsed.data;
    const reference = createExternalIdentityReference({
      ...identity,
      verificationLevel: "DECLARED",
      verificationMethod: null,
      evidenceSha256: null,
      linkedAt: new Date().toISOString(),
      verifiedAt: null,
    });
    const profile = await linkMarketplaceAgentExternalIdentity({ actor, agentId, expectedRevision, reference });
    return noStoreJson({ profile, reference: agentIdentityReference(profile) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to link external identity.";
    if (message === "AGENT_IDENTITY_ACCESS_DENIED") {
      return noStoreJson({ error: "Agent identity access denied." }, { status: 403 });
    }
    if (
      message === "AGENT_IDENTITY_STALE_REVISION" ||
      message === "EXTERNAL_IDENTITY_CONFLICT" ||
      message === "EXTERNAL_IDENTITY_DUPLICATE"
    ) {
      return noStoreJson({ error: message }, { status: 409 });
    }
    if (message === "AGENT_IDENTITY_UNKNOWN") {
      return noStoreJson({ error: "Agent identity revision not found." }, { status: 404 });
    }
    if (message === "AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE" || message === "AGENT_IDENTITY_PROFILE_TAMPERING_DETECTED") {
      return noStoreJson({ error: "Agent identity persistence is unavailable." }, { status: 503 });
    }
    return noStoreJson({ error: message }, { status: 400 });
  }
}
