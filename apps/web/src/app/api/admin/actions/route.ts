import { z } from "zod";
import { getDemoStore } from "@donelayer/database";
import { getActor } from "@/server/auth";
import { assertSameOrigin, noStoreJson } from "@/server/http-security";
import { enforceRateLimit } from "@/server/rate-limit";

const schema = z.object({
  action: z.enum(["SUSPEND_WORKER", "SUSPEND_AGENT", "REMATCH_TASK", "REVOKE_PERMISSION_LEASE", "INVALIDATE_JOB_RECEIPT"]),
  resourceId: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, context) => {
  if ((value.action === "REVOKE_PERMISSION_LEASE" || value.action === "INVALIDATE_JOB_RECEIPT") && !value.reason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Revocation reason is required" });
  }
});

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const rateError = enforceRateLimit(request, "admin-action", 30);
  if (rateError) return rateError;
  const actor = await getActor();
  if (!actor || actor.role !== "ADMIN") return noStoreJson({ error: "Admin access required." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid Admin action." }, { status: 400 });
  try {
    const store = getDemoStore();
    if (parsed.data.action === "SUSPEND_WORKER") store.adminSuspendWorker(parsed.data.resourceId, actor.id);
    if (parsed.data.action === "SUSPEND_AGENT") store.adminSuspendAgent(parsed.data.resourceId, actor.id);
    if (parsed.data.action === "REMATCH_TASK") store.adminRematchTask(parsed.data.resourceId, actor.id);
    if (parsed.data.action === "REVOKE_PERMISSION_LEASE") {
      store.revokePermissionLease(parsed.data.resourceId, actor.id, parsed.data.reason!);
    }
    if (parsed.data.action === "INVALIDATE_JOB_RECEIPT") {
      store.invalidateJobReceipt(parsed.data.resourceId, actor.id, parsed.data.reason!);
    }
    return noStoreJson({ ok: true });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Admin action failed." }, { status: 409 });
  }
}
