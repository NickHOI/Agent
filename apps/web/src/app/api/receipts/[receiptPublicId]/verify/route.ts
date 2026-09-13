import { getDemoStore } from "@donelayer/database";
import { readGatePublicReceipt } from "@/server/gate-public-receipt";
import { noStoreJson } from "@/server/http-security";
import { toPublicReceiptView } from "@/server/public-receipt-view";
import { enforceRateLimit } from "@/server/rate-limit";
import { readWorkspacePublicReceipt } from "@/server/workspace-public-receipt";

export async function GET(request: Request, context: { params: Promise<{ receiptPublicId: string }> }) {
  const rateError = enforceRateLimit(request, "receipt-verify", 60);
  if (rateError) return rateError;
  const { receiptPublicId } = await context.params;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(receiptPublicId)) return noStoreJson({ error: "Receipt not found." }, { status: 404 });
  try {
    const receipt = getDemoStore().getPublicJobReceipt(receiptPublicId)
      ?? readGatePublicReceipt(receiptPublicId)
      ?? await readWorkspacePublicReceipt(receiptPublicId);
    if (!receipt) return noStoreJson({ error: "Receipt not found." }, { status: 404 });
    return noStoreJson(toPublicReceiptView(receipt));
  } catch {
    return noStoreJson({ error: "Receipt not found." }, { status: 404 });
  }
}
