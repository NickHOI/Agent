import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDemoStore } from "@donelayer/database";
import { Brand } from "@/components/brand";
import { PublicReceiptClient } from "@/components/receipts/public-receipt-client";
import { readGatePublicReceipt } from "@/server/gate-public-receipt";
import { toPublicReceiptView } from "@/server/public-receipt-view";
import { readWorkspacePublicReceipt } from "@/server/workspace-public-receipt";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify receipt",
  description: "Verify a hash-verifiable DoneLayer execution receipt."
};

export default async function PublicReceiptPage({ params }: { params: Promise<{ receiptPublicId: string }> }) {
  const { receiptPublicId } = await params;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(receiptPublicId)) notFound();
  let receipt;
  try {
    receipt = getDemoStore().getPublicJobReceipt(receiptPublicId)
      ?? readGatePublicReceipt(receiptPublicId)
      ?? await readWorkspacePublicReceipt(receiptPublicId);
  } catch {
    notFound();
  }
  if (!receipt) notFound();

  return (
    <div className="min-h-screen bg-[#090a0c]">
      <header className="border-b border-[#2a2e36] bg-[#0d0f13]">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
          <Brand />
        </div>
      </header>
      <PublicReceiptClient initial={toPublicReceiptView(receipt)} />
    </div>
  );
}
