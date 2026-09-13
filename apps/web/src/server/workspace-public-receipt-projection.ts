import {
  sha256Canonical,
  verifyEvidenceLedgerEntries,
  type EvidenceLedgerEntryRecord,
  type JobReceiptResult,
  type PublicJobReceipt,
} from "@donelayer/database";

import {
  normalizePersistedLedgerTimestamp,
  summarizeWorkspaceReceiptDocument,
} from "./workspace-history";

export type WorkspaceReceiptRow = Record<string, unknown>;

export function projectWorkspacePublicReceipt(
  receipt: WorkspaceReceiptRow,
  ledgerRows: WorkspaceReceiptRow[],
  disputed: boolean,
): PublicJobReceipt | null {
  const document = recordOf(receipt.receipt_json);
  if (
    textOf(receipt.receipt_public_id).length < 8
    || textOf(document.receiptType) !== "VERIFIED_WORK_RECEIPT_V2"
    || textOf(receipt.result) !== "VERIFIED_DELIVERY"
  ) return null;

  const ledger = ledgerRows.map((entry): EvidenceLedgerEntryRecord => ({
    id: textOf(entry.id),
    taskId: textOf(entry.task_id),
    jobRunId: textOf(entry.job_run_id),
    sequenceNumber: numberOf(entry.sequence_number),
    entryType: textOf(entry.entry_type) as EvidenceLedgerEntryRecord["entryType"],
    sourceRecordType: textOf(entry.source_record_type),
    sourceRecordId: textOf(entry.source_record_id),
    payloadSha256: textOf(entry.payload_sha256),
    previousEntrySha256: nullableText(entry.previous_entry_sha256),
    entrySha256: textOf(entry.entry_sha256),
    createdAt: normalizePersistedLedgerTimestamp(textOf(entry.created_at)),
  }));
  const chain = verifyEvidenceLedgerEntries(ledger);
  const receiptHashValid = sha256Canonical(document) === textOf(receipt.receipt_sha256);
  const receiptEntry = ledger.find((entry) => (
    entry.entryType === "RECEIPT_CREATED"
    && entry.sourceRecordType === "job_receipt"
    && entry.sourceRecordId === textOf(receipt.id)
  ));
  const receiptAnchorValid = Boolean(
    chain.valid
    && receiptEntry
    && ledger.at(-1)?.id === receiptEntry.id
    && receiptEntry.previousEntrySha256 === textOf(receipt.evidence_chain_sha256)
    && receiptEntry.payloadSha256 === textOf(receipt.receipt_sha256)
  );
  const summary = summarizeWorkspaceReceiptDocument(document);
  const documentedLedger = summary.documentedLedger;
  const documentedValid = documentedLedger.valid === true
    && textOf(documentedLedger.chainSha256) === textOf(receipt.evidence_chain_sha256);
  const resultMatchesDocument = summary.documentResult === textOf(receipt.result);
  const outcomes = recordOf(document.verifiedDeliveryOutcomes);
  const outcomesValid = textOf(outcomes.executionOutcome) === "COMPLETED"
    && textOf(outcomes.executionFailureAttribution) === "NOT_APPLICABLE"
    && textOf(outcomes.independentVerificationOutcome) === "VERIFIED"
    && textOf(outcomes.deliveryOutcome) === "VERIFIED_DELIVERY";
  const verificationStatus = receiptHashValid
    && receiptAnchorValid
    && documentedValid
    && resultMatchesDocument
    && outcomesValid
    && !receipt.invalidated_at
    ? "VALID"
    : "INVALID";

  const agreed = recordOf(document.whatWasAgreed);
  const workContract = recordOf(agreed.workContract);
  const executed = recordOf(document.whoExecuted);
  const happened = recordOf(document.whatHappened);
  const authorizedPatch = recordOf(happened.authorizedPatch);
  const result = textOf(receipt.result) as JobReceiptResult;
  return {
    publicReceiptId: textOf(receipt.receipt_public_id),
    taskType: "Verified Delivery Outcome Policy Verification",
    agentIdentity: textOf(executed.agentPublicIdentity) || "Recorded Agent",
    workerIdentity: textOf(executed.executorId) || textOf(executed.workerId) || "DoneLayer server-side orchestrator",
    contractSha256: textOf(workContract.sha256),
    evidenceChainSha256: textOf(receipt.evidence_chain_sha256),
    artifactSha256: textOf(authorizedPatch.sha256),
    verificationSummary: "A fresh isolated verifier passed every locked Contract assertion.",
    result,
    createdAt: normalizePersistedLedgerTimestamp(textOf(receipt.created_at)),
    verificationStatus,
    invalidated: Boolean(receipt.invalidated_at),
    disputed,
    verifiedDeliveryOutcomes: {
      executionOutcome: textOf(outcomes.executionOutcome) as "COMPLETED",
      executionFailureAttribution: textOf(outcomes.executionFailureAttribution) as "NOT_APPLICABLE",
      independentVerificationOutcome: textOf(outcomes.independentVerificationOutcome) as "VERIFIED",
      deliveryOutcomePolicy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
      deliveryOutcome: textOf(outcomes.deliveryOutcome) as "VERIFIED_DELIVERY",
      candidateEligible: false,
    },
    scopeDisclaimer: "This Receipt verifies one bounded Beta Gate validation Job and contributes zero to Reputation.",
  };
}

function recordOf(value: unknown): WorkspaceReceiptRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as WorkspaceReceiptRow
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
