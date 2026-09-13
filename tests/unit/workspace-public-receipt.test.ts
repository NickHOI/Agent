import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeEvidenceLedgerEntryHash,
  sha256Canonical,
} from "@donelayer/database";
import { projectWorkspacePublicReceipt } from "../../apps/web/src/server/workspace-public-receipt-projection";

describe("Supabase public Receipt projection", () => {
  it("verifies a persisted Gate 3 Ledger after PostgreSQL normalizes UTC offsets", () => {
    const fixture = receiptFixture();
    const projected = projectWorkspacePublicReceipt(fixture.receipt, fixture.ledger, false);

    expect(projected).toMatchObject({
      publicReceiptId: fixture.receipt.receipt_public_id,
      result: "VERIFIED_DELIVERY",
      verificationStatus: "VALID",
      disputed: false,
      verifiedDeliveryOutcomes: {
        executionOutcome: "COMPLETED",
        independentVerificationOutcome: "VERIFIED",
        deliveryOutcome: "VERIFIED_DELIVERY",
        candidateEligible: false,
      },
    });
  });

  it("fails closed when a persisted Ledger field is tampered", () => {
    const fixture = receiptFixture();
    fixture.ledger[0]!.source_record_id = randomUUID();

    expect(projectWorkspacePublicReceipt(fixture.receipt, fixture.ledger, false)?.verificationStatus)
      .toBe("INVALID");
  });
});

function receiptFixture() {
  const taskId = randomUUID();
  const jobRunId = randomUUID();
  const receiptId = randomUUID();
  const firstCreatedAt = "2026-09-13T14:02:03.456Z";
  const firstBody = {
    sequenceNumber: 1,
    entryType: "CONTRACT_LOCKED",
    sourceRecordType: "task_contract_version",
    sourceRecordId: randomUUID(),
    payloadSha256: "a".repeat(64),
    previousEntrySha256: null,
    createdAt: firstCreatedAt,
  };
  const firstSha256 = computeEvidenceLedgerEntryHash(firstBody);
  const document = {
    schemaVersion: 2,
    receiptType: "VERIFIED_WORK_RECEIPT_V2",
    finalResult: "VERIFIED_DELIVERY",
    whatWasAgreed: { workContract: { sha256: "b".repeat(64) } },
    whoExecuted: {
      agentPublicIdentity: "Gate 3 Agent",
      executorId: "done-layer-server-side-orchestrator",
    },
    whatHappened: { authorizedPatch: { sha256: "c".repeat(64) } },
    howVerified: {
      evidenceLedger: { valid: true, entryCount: 1, chainSha256: firstSha256 },
    },
    verifiedDeliveryOutcomes: {
      executionOutcome: "COMPLETED",
      executionFailureAttribution: "NOT_APPLICABLE",
      independentVerificationOutcome: "VERIFIED",
      deliveryOutcome: "VERIFIED_DELIVERY",
    },
    classification: {
      realJobClassification: "NOT_VERIFIED",
      reputationContribution: 0,
      reason: "BETA_GATE_VALIDATION",
    },
  };
  const receiptSha256 = sha256Canonical(document);
  const receiptCreatedAt = "2026-09-13T14:02:04.456Z";
  const receiptBody = {
    sequenceNumber: 2,
    entryType: "RECEIPT_CREATED",
    sourceRecordType: "job_receipt",
    sourceRecordId: receiptId,
    payloadSha256: receiptSha256,
    previousEntrySha256: firstSha256,
    createdAt: receiptCreatedAt,
  };
  const receiptEntrySha256 = computeEvidenceLedgerEntryHash(receiptBody);

  return {
    receipt: {
      id: receiptId,
      receipt_public_id: "dlr_test_public_receipt",
      task_id: taskId,
      job_run_id: jobRunId,
      result: "VERIFIED_DELIVERY",
      receipt_json: document,
      receipt_sha256: receiptSha256,
      evidence_chain_sha256: firstSha256,
      created_at: receiptCreatedAt.replace("Z", "+00:00"),
      invalidated_at: null,
    },
    ledger: [
      {
        id: randomUUID(),
        task_id: taskId,
        job_run_id: jobRunId,
        sequence_number: 1,
        entry_type: firstBody.entryType,
        source_record_type: firstBody.sourceRecordType,
        source_record_id: firstBody.sourceRecordId,
        payload_sha256: firstBody.payloadSha256,
        previous_entry_sha256: null,
        entry_sha256: firstSha256,
        created_at: firstCreatedAt.replace("Z", "+00:00"),
      },
      {
        id: randomUUID(),
        task_id: taskId,
        job_run_id: jobRunId,
        sequence_number: 2,
        entry_type: receiptBody.entryType,
        source_record_type: receiptBody.sourceRecordType,
        source_record_id: receiptBody.sourceRecordId,
        payload_sha256: receiptBody.payloadSha256,
        previous_entry_sha256: firstSha256,
        entry_sha256: receiptEntrySha256,
        created_at: receiptCreatedAt.replace("Z", "+00:00"),
      },
    ],
  };
}
