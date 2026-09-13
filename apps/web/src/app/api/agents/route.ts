import { z } from "zod";
import { agentIdentityReference } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { createMarketplaceAgentWithIdentity } from "@/server/agent-identity/persistence";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { hasSupabaseRole } from "@/server/supabase-auth";
import { createWorkspaceAgent } from "@/server/trust-workspace";

const schema = z.object({
  name: z.string().trim().min(3).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  description: z.string().trim().min(20).max(5000),
  skills: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
  taskTypes: z.array(z.enum(["DIAGNOSE_REPOSITORY", "BUILD_RESCUE", "TEST_AND_FIX", "FEATURE_COMPLETION", "PULL_REQUEST_VERIFICATION", "LAUNCH_READINESS"])).min(1),
  languages: z.array(z.string().trim().min(1).max(100)).max(30),
  operatingSystems: z.array(z.enum(["WINDOWS", "MACOS", "LINUX"])).min(1),
  tools: z.array(z.string().trim().min(1).max(100)).max(50),
  requiredMcpServers: z.array(z.string().trim().min(1).max(200)).max(30),
  pricingModel: z.enum(["FIXED", "HOURLY", "FROM"]),
  basePriceCents: z.number().int().min(0).max(100_000_000),
  endpointType: z.enum(["LOCAL_WORKER", "WEBHOOK", "A2A"]),
  endpointUrl: z.string().url().nullable(),
  authenticationType: z.enum(["NONE", "HMAC", "API_KEY", "OAUTH", "A2A_METADATA"]),
  inputModes: z.array(z.string().min(1)).max(20),
  outputModes: z.array(z.string().min(1)).max(20)
}).strict().superRefine((value, context) => {
  if (value.endpointType !== "LOCAL_WORKER" && !value.endpointUrl) context.addIssue({ code: "custom", path: ["endpointUrl"], message: "Remote agents require an HTTPS endpoint." });
  if (value.endpointUrl && !value.endpointUrl.startsWith("https://")) context.addIssue({ code: "custom", path: ["endpointUrl"], message: "Agent endpoints must use HTTPS." });
});

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "agent-create", 10);
  if (rateError) return rateError;
  const actor = await getActor();
  const workspaceProvider = process.env.APP_MODE === "supabase" && actor
    ? await hasSupabaseRole("PROVIDER")
    : false;
  if (!actor || (actor.role !== "PROVIDER" && !workspaceProvider)) {
    return noStoreJson({ error: "Agent controller access required." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Agent validation failed.", issues: parsed.error.issues }, { status: 400 });
  try {
    const created = process.env.APP_MODE === "supabase"
      ? await createWorkspaceAgent(actor, parsed.data)
      : await createMarketplaceAgentWithIdentity(actor, parsed.data);
    return noStoreJson({
      agentId: created.agentId,
      slug: created.slug,
      ...(process.env.APP_MODE !== "supabase" && "identity" in created
        ? { identity: agentIdentityReference(created.identity) }
        : {}),
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create Agent.";
    if (message === "AGENT_IDENTITY_PERSISTENCE_UNAVAILABLE" || message === "AGENT_CREATE_FAILED") {
      return noStoreJson({ error: "Agent persistence is unavailable." }, { status: 503 });
    }
    if (message === "AGENT_SLUG_CONFLICT") {
      return noStoreJson({ error: "Agent slug is already in use." }, { status: 409 });
    }
    if (message === "AGENT_IDENTITY_ACCESS_DENIED") {
      return noStoreJson({ error: "Provider access required." }, { status: 403 });
    }
    if (message === "WORKSPACE_AGENT_CREATE_FAILED") {
      return noStoreJson({ error: "Unable to create this Agent." }, { status: 400 });
    }
    return noStoreJson({ error: message }, { status: 400 });
  }
}
