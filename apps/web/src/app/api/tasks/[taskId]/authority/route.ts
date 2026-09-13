import { z } from "zod";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";
import { approveWorkspaceAuthority } from "@/server/trust-workspace";

const inputSchema = z.object({
  contractVersion: z.number().int().positive(),
  contractSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (process.env.APP_MODE !== "supabase") {
    return noStoreJson({ error: "Workspace Authority is unavailable in Demo mode." }, { status: 404 });
  }
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "authority-approve", 12);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || actor.role !== "CUSTOMER") return noStoreJson({ error: "Customer access required." }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Authority approval request is invalid." }, { status: 400 });
  const { taskId } = await context.params;
  try {
    const result = await approveWorkspaceAuthority({ taskId, ...parsed.data });
    return noStoreJson(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKSPACE_AUTHORITY_APPROVAL_FAILED";
    if (message === "WORKSPACE_CONTRACT_STALE" || message === "WORKSPACE_AUTHORITY_ALREADY_DECIDED") {
      return noStoreJson({ error: "This Contract changed or Authority was already decided. Reload before continuing." }, { status: 409 });
    }
    if (message === "WORKSPACE_AGENT_ACCESS_DENIED") {
      return noStoreJson({ error: "The selected Agent is no longer controlled by this workspace." }, { status: 403 });
    }
    return noStoreJson({ error: "Unable to record Authority approval." }, { status: 400 });
  }
}
