import "server-only";

import type { PublicJobReceipt } from "@donelayer/database";

import { createSupabaseCommandClient } from "./supabase-auth";
import {
  projectWorkspacePublicReceipt,
  type WorkspaceReceiptRow,
} from "./workspace-public-receipt-projection";

type Row = WorkspaceReceiptRow;

export async function readWorkspacePublicReceipt(publicReceiptId: string): Promise<PublicJobReceipt | null> {
  if (process.env.APP_MODE !== "supabase") return null;
  const client = createSupabaseCommandClient();
  const receiptResult = await client
    .from("job_receipts")
    .select("id, receipt_public_id, task_id, job_run_id, result, receipt_json, receipt_sha256, evidence_chain_sha256, created_at, invalidated_at")
    .eq("receipt_public_id", publicReceiptId)
    .maybeSingle();
  if (receiptResult.error || !receiptResult.data) return null;
  const receipt = recordOf(receiptResult.data);
  const [ledgerResult, disputesResult] = await Promise.all([
    client
      .from("evidence_ledger_entries")
      .select("id, task_id, job_run_id, sequence_number, entry_type, source_record_type, source_record_id, payload_sha256, previous_entry_sha256, entry_sha256, created_at")
      .eq("job_run_id", textOf(receipt.job_run_id))
      .order("sequence_number", { ascending: true }),
    client
      .from("disputes")
      .select("status")
      .eq("task_id", textOf(receipt.task_id))
      .in("status", ["OPEN", "UNDER_REVIEW"]),
  ]);
  if (ledgerResult.error || disputesResult.error) return null;
  return projectWorkspacePublicReceipt(
    receipt,
    rowsOf(ledgerResult.data),
    rowsOf(disputesResult.data).length > 0,
  );
}

function recordOf(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(recordOf) : [];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}
