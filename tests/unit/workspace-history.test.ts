import { describe, expect, it } from "vitest";
import {
  normalizePersistedLedgerTimestamp,
  summarizeWorkspaceReceiptDocument,
} from "../../apps/web/src/server/workspace-history";

describe("Trust Workspace historical Receipt projection", () => {
  it("keeps a historical V1 Receipt readable without counting Gate evidence as Verified Work", () => {
    const summary = summarizeWorkspaceReceiptDocument({
      schemaVersion: 1,
      receiptType: "AGENT_REPAIR_MANAGED_SANDBOX_VERIFICATION",
      finalResult: "VERIFIED",
      whoExecuted: {
        agentPublicIdentity: "Fixture Repair Agent",
      },
      whatHappened: {
        repositoryMaterialization: { workerCommitSha: "a".repeat(40) },
        buildTest: {
          build: { status: "NOT_PRESENT" },
          test: { status: "PASSED", exitCode: 0 },
        },
      },
      howVerified: {
        verifier: "NON_AI_DETERMINISTIC_VERIFIER",
        evidenceLedger: { valid: true, chainSha256: "b".repeat(64) },
      },
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.documentResult).toBe("VERIFIED");
    expect(summary.agentLabel).toBe("Fixture Repair Agent");
    expect(summary.tests).toBe("Passed (exit 0)");
    expect(summary.historyStatus).toBe("VALID_RECEIPT_ONLY");
  });

  it("maps V2 execution, verification, and delivery independently", () => {
    const summary = summarizeWorkspaceReceiptDocument({
      schemaVersion: 2,
      receiptType: "VERIFIED_JOB_RECEIPT_V2",
      candidateStatus: "REPUTATION_ENTRY_CANDIDATE",
      deliveryOutcomePolicy: {
        schemaVersion: 1,
        policyVersion: 1,
        policy: "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
      },
      outcomes: {
        execution: "FAILED",
        executionFailureAttribution: "MODEL_PROVIDER",
        independentVerification: "VERIFIED",
        delivery: "VERIFIED_DELIVERY",
      },
      evidenceLedger: { valid: true, chainSha256: "c".repeat(64) },
      canonicalQualification: {
        eligible: true,
        counted: false,
        reputationEntered: false,
      },
    });

    expect(summary.executionOutcome).toBe("FAILED");
    expect(summary.verificationOutcome).toBe("VERIFIED");
    expect(summary.deliveryOutcome).toBe("VERIFIED_DELIVERY");
    expect(summary.documentResult).toBe("VERIFIED_DELIVERY");
    expect(summary.historyStatus).toBe("VALID_RECEIPT_ONLY");
  });

  it("accepts a future customer Receipt family as Verified Work history without guessing missing fields", () => {
    const summary = summarizeWorkspaceReceiptDocument({
      schemaVersion: 2,
      receiptType: "VERIFIED_WORK_RECEIPT_V2",
      outcomes: {
        execution: "COMPLETED",
        independentVerification: "VERIFIED",
        delivery: "VERIFIED_DELIVERY",
      },
      evidenceLedger: { valid: true, chainSha256: "d".repeat(64) },
    });

    expect(summary.historyStatus).toBe("VERIFIED_WORK");
    expect(summary.agentLabel).toBe("Recorded Agent");
    expect(summary.verifierLabel).toBe("DoneLayer independent verifier");
  });

  it("keeps Beta Gate validation Receipts out of Verified Work history", () => {
    const summary = summarizeWorkspaceReceiptDocument({
      schemaVersion: 2,
      receiptType: "VERIFIED_WORK_RECEIPT_V2",
      finalResult: "VERIFIED_DELIVERY",
      classification: {
        realJobClassification: "NOT_VERIFIED",
        reputationContribution: 0,
        reason: "BETA_GATE_VALIDATION",
      },
    });

    expect(summary.historyStatus).toBe("VALID_RECEIPT_ONLY");
  });

  it("normalizes equivalent PostgreSQL UTC timestamps before Ledger verification", () => {
    expect(normalizePersistedLedgerTimestamp("2026-09-13T14:02:03.456+00:00"))
      .toBe("2026-09-13T14:02:03.456Z");
    expect(normalizePersistedLedgerTimestamp("not-a-time")).toBe("not-a-time");
  });

  it("fails closed for an unknown Receipt family", () => {
    const summary = summarizeWorkspaceReceiptDocument({
      schemaVersion: 2,
      receiptType: "UNRECOGNIZED_RECEIPT_V2",
      outcomes: {
        execution: "COMPLETED",
        independentVerification: "VERIFIED",
        delivery: "VERIFIED_DELIVERY",
      },
      evidenceLedger: { valid: true, chainSha256: "e".repeat(64) },
    });

    expect(summary.historyStatus).toBe("VALID_RECEIPT_ONLY");
  });

  it.each([
    "DEMO_VERIFIED_WORK_RECEIPT_V2",
    "SEED_VERIFIED_WORK_RECEIPT_V2",
  ])("keeps %s out of Verified Work history", (receiptType) => {
    const summary = summarizeWorkspaceReceiptDocument({
      schemaVersion: 2,
      receiptType,
      outcomes: {
        execution: "COMPLETED",
        independentVerification: "VERIFIED",
        delivery: "VERIFIED_DELIVERY",
      },
      evidenceLedger: { valid: true, chainSha256: "f".repeat(64) },
    });

    expect(summary.historyStatus).toBe("VALID_RECEIPT_ONLY");
  });
});
