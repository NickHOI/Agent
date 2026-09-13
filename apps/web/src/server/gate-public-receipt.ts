import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  canonicalJson,
  computeEvidenceLedgerEntryHash,
  type PublicJobReceipt,
} from "@donelayer/database";

type JsonRecord = Record<string, unknown>;

export function readGatePublicReceipt(publicReceiptId: string): PublicJobReceipt | null {
  const evidencePath = process.env.DONELAYER_GATE_RECEIPT_EVIDENCE_PATH;
  if (!evidencePath) return null;
  try {
    const evidence = record(JSON.parse(readFileSync(evidencePath, "utf8")));
    const rootResult = record(evidence.result);
    const candidates = [
      rootResult,
      optionalRecord(rootResult.delivery),
      optionalRecord(rootResult.conflict),
      optionalRecord(rootResult.historicalReview),
      optionalRecord(rootResult.repair),
    ].filter((candidate): candidate is JsonRecord => candidate !== null);
    const result = candidates.find((candidate) => {
      const receipt = optionalRecord(candidate.receipt);
      const projected = optionalRecord(candidate.publicReceipt);
      return receipt?.publicReceiptId === publicReceiptId && projected?.publicReceiptId === publicReceiptId;
    });
    if (!result) return null;
    const receipt = record(result.receipt);
    const document = record(receipt.document);
    const ledgerEntries = records(result.ledgerEntries);
    const projected = record(result.publicReceipt) as unknown as PublicJobReceipt;
    if (document.publicReceiptId !== publicReceiptId) return null;
    const receiptSha256 = sha256(canonicalJson(document));
    let previous: string | null = null;
    let chainValid = true;
    for (let index = 0; index < ledgerEntries.length; index += 1) {
      const entry = ledgerEntries[index]!;
      const expected = computeEvidenceLedgerEntryHash({
        sequenceNumber: Number(entry.sequenceNumber),
        entryType: String(entry.entryType),
        sourceRecordType: String(entry.sourceRecordType),
        sourceRecordId: String(entry.sourceRecordId),
        payloadSha256: String(entry.payloadSha256),
        previousEntrySha256: previous,
        createdAt: String(entry.createdAt),
      });
      if (
        entry.sequenceNumber !== index + 1 ||
        entry.previousEntrySha256 !== previous ||
        entry.entrySha256 !== expected
      ) chainValid = false;
      previous = expected;
    }
    const receiptEntry = ledgerEntries.at(-1);
    const preReceiptEntry = ledgerEntries.at(-2);
    const evidenceLedger = record(document.evidenceLedger);
    const receiptAnchorValid = Boolean(
      receiptEntry?.entryType === "RECEIPT_CREATED" &&
      receiptEntry.previousEntrySha256 === preReceiptEntry?.entrySha256 &&
      evidenceLedger.chainSha256 === preReceiptEntry?.entrySha256 &&
      evidenceLedger.entryCount === ledgerEntries.length - 1 &&
      receipt.receiptSha256 === receiptSha256 &&
      receipt.evidenceChainSha256 === preReceiptEntry?.entrySha256 &&
      receiptEntry.payloadSha256 === sha256(canonicalJson({
        receiptSha256,
        evidenceChainSha256: preReceiptEntry?.entrySha256,
      })),
    );
    return {
      ...projected,
      verificationStatus: chainValid && receiptAnchorValid ? "VALID" : "INVALID",
    };
  } catch {
    return null;
  }
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Gate evidence object is invalid");
  return value as JsonRecord;
}

function optionalRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function records(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error("Gate evidence Ledger is invalid");
  return value.map(record);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
