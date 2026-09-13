import { getActor } from "@/server/auth";
import { noStoreJson } from "@/server/http-security";
import { createSupabaseUserClient } from "@/server/supabase-auth";

export async function GET(_request: Request, context: { params: Promise<{ receiptId: string }> }) {
  if (process.env.APP_MODE !== "supabase") {
    return noStoreJson({ error: "Workspace Receipt download is unavailable in Demo mode." }, { status: 404 });
  }
  const actor = await getActor();
  if (!actor) return noStoreJson({ error: "Authentication required." }, { status: 401 });
  const { receiptId } = await context.params;
  const client = await createSupabaseUserClient();
  const { data, error } = await client
    .from("job_receipts")
    .select("id, receipt_public_id, result, receipt_json, receipt_sha256, evidence_chain_sha256, created_at, invalidated_at, invalidation_reason")
    .eq("id", receiptId)
    .maybeSingle();
  if (error || !data) return noStoreJson({ error: "Receipt not found." }, { status: 404 });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="donelayer-receipt-${receiptId}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
