import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  canonicalJson,
  computeEvidenceLedgerEntryHash,
  type SemanticVerificationReceiptSummary,
  type PublicJobReceipt,
} from "@donelayer/database";

import {
  SEMANTIC_VERIFICATION_GATE,
  assertSemanticContractIntegrity,
  createVerifiedWorkEvidenceBundle,
  inspectRepositoryTestOracle,
  type ContractAssertionRun,
  type SemanticTaskContract,
  type SemanticVerificationOutcome,
  type TestOracleInspection,
  type VerifiedWorkEvidenceBundle,
} from "./semantic-contract";

export type SemanticReviewLedgerEntry = {
  id: string;
  sequenceNumber: number;
  entryType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  entrySha256: string;
  createdAt: string;
};

export type SemanticReviewReceipt = {
  schemaVersion: 1;
  receiptType: "SEMANTIC_VERIFICATION_REVIEW";
  publicReceiptId: string;
  gate: typeof SEMANTIC_VERIFICATION_GATE;
  contractSha256: string;
  finalResult: SemanticVerificationOutcome;
  semanticVerification: SemanticVerificationReceiptSummary;
  evidenceBundle: VerifiedWorkEvidenceBundle;
  testOracleInspection: TestOracleInspection;
  contractAssertionRun: ContractAssertionRun | null;
  historicalReceipt: {
    receiptId: string;
    publicReceiptId: string;
    receiptSha256: string;
    evidenceChainSha256: string;
    integrity: "VALID";
    executionEvidence: "VALID";
    testConformity: "PASSED";
    deliveryIntegrity: "VALID";
    semanticReview: "SPEC_TEST_CONFLICT_DISCOVERED";
    overallSemanticDeliveryStatus: "SUPERSEDED";
  } | null;
  evidenceLedger: { valid: boolean; entryCount: number; chainSha256: string | null };
  issuedAt: string;
};

export type SemanticReviewOutcome = {
  runId: string;
  gate: typeof SEMANTIC_VERIFICATION_GATE;
  contract: SemanticTaskContract;
  contractSha256: string;
  status: SemanticVerificationOutcome;
  agentCallCount: number;
  sandboxRepairAttemptCount: number;
  payoutReleased: false;
  testOracleInspection: TestOracleInspection;
  contractAssertionRun: ContractAssertionRun | null;
  ledgerEntries: SemanticReviewLedgerEntry[];
  ledgerVerification: { valid: boolean; entryCount: number; chainSha256: string | null };
  receipt: {
    id: string;
    publicReceiptId: string;
    result: SemanticVerificationOutcome;
    receiptSha256: string;
    evidenceChainSha256: string;
    document: SemanticReviewReceipt;
  };
  publicReceipt: PublicJobReceipt;
};

export function reviewSemanticContract(input: {
  contract: SemanticTaskContract;
  files: Array<{ filePath: string; content: string }>;
  contractAssertionRun?: ContractAssertionRun | null;
  executionIntegrity?: "VALID" | "INVALID" | "NOT_RUN";
  repositoryTests?: "PASSED" | "FAILED" | "NOT_RUN";
  deliveryIntegrity?: "VALID" | "INVALID" | "NOT_RUN";
  testsModified?: boolean;
  acceptanceCriteriaModified?: boolean;
  agentCallCount?: number;
  sandboxRepairAttemptCount?: number;
  historicalReceipt?: SemanticReviewReceipt["historicalReceipt"];
}): SemanticReviewOutcome {
  assertSemanticContractIntegrity(input.contract);
  const runId = randomUUID();
  const contractSha256 = digest(canonicalJson(input.contract));
  const inspection = inspectRepositoryTestOracle({ contract: input.contract, files: input.files });
  const contractRun = input.contractAssertionRun ?? null;
  const agentCallCount = input.agentCallCount ?? 0;
  const sandboxRepairAttemptCount = input.sandboxRepairAttemptCount ?? 0;
  const ledger = new SemanticReviewLedger();
  ledger.append("CONTRACT_ASSERTIONS_LOCKED", "semantic_task_contract", input.contract.taskId, {
    contractSha256,
    assertionsSha256: input.contract.assertionsSha256,
    assertionCount: input.contract.assertions.length,
  }, input.contract.lockedAt);
  ledger.append("TEST_ORACLE_INSPECTED", "repository_test_oracle", input.contract.commitSha, inspection);
  if (inspection.outcome === "SPEC_TEST_CONFLICT") {
    ledger.append("SPEC_TEST_CONFLICT_DETECTED", "semantic_review", runId, {
      conflicts: inspection.conflicts,
      agentCallCount,
      sandboxRepairAttemptCount,
      payoutReleased: false,
    });
    ledger.append("ENGINEERING_REVIEW_REQUIRED", "semantic_review", runId, {
      reason: "Repository tests conflict with the authoritative locked Contract assertions.",
    });
  } else if (inspection.outcome === "CONTRACT_VERIFIED" && contractRun) {
    ledger.append("SEMANTIC_VERIFICATION_STARTED", "semantic_review", runId, {
      assertionsSha256: contractRun.assertionsSha256,
    });
    for (const result of contractRun.results) {
      ledger.append(
        result.status === "PASSED" ? "CONTRACT_ASSERTION_PASSED" : "CONTRACT_ASSERTION_FAILED",
        "contract_assertion",
        result.assertionId,
        result,
      );
    }
    if (contractRun.failed === 0) {
      ledger.append("SEMANTIC_VERIFICATION_PASSED", "semantic_review", runId, {
        passed: contractRun.passed,
        failed: contractRun.failed,
      });
    } else {
      ledger.append("ENGINEERING_REVIEW_REQUIRED", "semantic_review", runId, {
        reason: "One or more independent Contract assertions failed.",
      });
    }
  } else if (inspection.outcome !== "CONTRACT_VERIFIED") {
    ledger.append("ENGINEERING_REVIEW_REQUIRED", "semantic_review", runId, {
      reason: inspection.summary,
    });
  }
  if (input.historicalReceipt) {
    ledger.append("RECEIPT_SUPERSEDED", "job_receipt", input.historicalReceipt.receiptId, input.historicalReceipt);
  }

  const summary = semanticSummary({
    inspection,
    contractRun,
    executionIntegrity: input.executionIntegrity ?? "VALID",
    repositoryTests: input.repositoryTests ?? "NOT_RUN",
    deliveryIntegrity: input.deliveryIntegrity ?? "NOT_RUN",
    testsModified: input.testsModified ?? false,
    acceptanceCriteriaModified: input.acceptanceCriteriaModified ?? false,
    agentCallCount,
    sandboxRepairAttemptCount,
    historicalReceipt: input.historicalReceipt ?? null,
  });
  const evidenceBundle = createVerifiedWorkEvidenceBundle({
    contract: input.contract,
    agentReported: input.historicalReceipt || agentCallCount > 0 ? "REPORTED" : "NOT_REPORTED",
    independentlyVerified: summary.overall,
    dimensions: {
      executionIntegrity: summary.executionIntegrity,
      testConformity: summary.testConformity,
      contractConformity: summary.contractConformity,
      deliveryIntegrity: summary.deliveryIntegrity,
    },
    evidence: [
      { kind: "WORK_CONTRACT", sha256: contractSha256 },
      { kind: "PERMISSION_DECISION", sha256: digest(canonicalJson(input.contract.permissionPolicy)) },
      { kind: "TEST_ORACLE_INSPECTION", sha256: digest(canonicalJson(inspection)) },
      ...(input.historicalReceipt
        ? [{ kind: "HISTORICAL_RECEIPT" as const, sha256: input.historicalReceipt.receiptSha256 }]
        : []),
    ],
  });
  ledger.append("EVIDENCE_BUNDLE_CREATED", "verified_work_evidence_bundle", evidenceBundle.bundleSha256, {
    bundleSha256: evidenceBundle.bundleSha256,
    workContractSha256: evidenceBundle.workContractSha256,
    outcome: evidenceBundle.completion.independentlyVerified,
  }, evidenceBundle.createdAt);
  const preReceiptLedger = ledger.verify();
  const receiptId = randomUUID();
  const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
  const document: SemanticReviewReceipt = {
    schemaVersion: 1,
    receiptType: "SEMANTIC_VERIFICATION_REVIEW",
    publicReceiptId,
    gate: SEMANTIC_VERIFICATION_GATE,
    contractSha256,
    finalResult: inspection.outcome,
    semanticVerification: summary,
    evidenceBundle,
    testOracleInspection: inspection,
    contractAssertionRun: contractRun,
    historicalReceipt: input.historicalReceipt ?? null,
    evidenceLedger: preReceiptLedger,
    issuedAt: new Date().toISOString(),
  };
  const receiptSha256 = digest(canonicalJson(document));
  ledger.append("RECEIPT_CREATED", "semantic_review_receipt", receiptId, {
    receiptSha256,
    evidenceChainSha256: preReceiptLedger.chainSha256,
  }, document.issuedAt);
  const ledgerVerification = ledger.verify();
  const publicReceipt: PublicJobReceipt = {
    publicReceiptId,
    taskType: "Semantic Verification Review",
    agentIdentity: "NON_AI_DETERMINISTIC_VERIFIER",
    workerIdentity: "DoneLayer Server-side Orchestrator",
    contractSha256,
    evidenceChainSha256: preReceiptLedger.chainSha256!,
    artifactSha256: evidenceBundle.bundleSha256,
    verificationSummary: inspection.summary,
    result: inspection.outcome,
    createdAt: document.issuedAt,
    verificationStatus: ledgerVerification.valid &&
      ledger.entries.at(-1)?.previousEntrySha256 === preReceiptLedger.chainSha256 &&
      ledger.entries.at(-1)?.payloadSha256 === digest(canonicalJson({ receiptSha256, evidenceChainSha256: preReceiptLedger.chainSha256 }))
      ? "VALID"
      : "INVALID",
    invalidated: false,
    disputed: false,
    semanticVerification: summary,
    scopeDisclaimer: inspection.outcome === "SPEC_TEST_CONFLICT"
      ? "Receipt integrity and historical execution evidence may remain valid, but repository tests conflict with the locked Task Contract. No Agent repair or payout is authorized."
      : "This semantic review compares repository tests with locked structured Contract assertions. It does not use an LLM as the sole semantic judge.",
  };
  return {
    runId,
    gate: SEMANTIC_VERIFICATION_GATE,
    contract: input.contract,
    contractSha256,
    status: inspection.outcome,
    agentCallCount,
    sandboxRepairAttemptCount,
    payoutReleased: false,
    testOracleInspection: inspection,
    contractAssertionRun: contractRun,
    ledgerEntries: ledger.entries,
    ledgerVerification,
    receipt: {
      id: receiptId,
      publicReceiptId,
      result: inspection.outcome,
      receiptSha256,
      evidenceChainSha256: preReceiptLedger.chainSha256!,
      document,
    },
    publicReceipt,
  };
}

export function historicalReceiptSupersession(input: {
  receiptId: string;
  publicReceiptId: string;
  receiptSha256: string;
  evidenceChainSha256: string;
}): NonNullable<SemanticReviewReceipt["historicalReceipt"]> {
  for (const [label, value] of Object.entries(input)) {
    if (!value) throw new Error(`Historical Receipt ${label} is required`);
  }
  if (!/^[a-f0-9]{64}$/.test(input.receiptSha256) || !/^[a-f0-9]{64}$/.test(input.evidenceChainSha256)) {
    throw new Error("Historical Receipt hashes are invalid");
  }
  return {
    ...input,
    integrity: "VALID",
    executionEvidence: "VALID",
    testConformity: "PASSED",
    deliveryIntegrity: "VALID",
    semanticReview: "SPEC_TEST_CONFLICT_DISCOVERED",
    overallSemanticDeliveryStatus: "SUPERSEDED",
  };
}

function semanticSummary(input: {
  inspection: TestOracleInspection;
  contractRun: ContractAssertionRun | null;
  executionIntegrity: "VALID" | "INVALID" | "NOT_RUN";
  repositoryTests: "PASSED" | "FAILED" | "NOT_RUN";
  deliveryIntegrity: "VALID" | "INVALID" | "NOT_RUN";
  testsModified: boolean;
  acceptanceCriteriaModified: boolean;
  agentCallCount: number;
  sandboxRepairAttemptCount: number;
  historicalReceipt: SemanticReviewReceipt["historicalReceipt"];
}): SemanticVerificationReceiptSummary {
  const conflict = input.inspection.outcome === "SPEC_TEST_CONFLICT";
  const contractFailed = Boolean(input.contractRun && input.contractRun.failed > 0);
  const contractVerified = input.inspection.outcome === "CONTRACT_VERIFIED" && Boolean(input.contractRun && input.contractRun.failed === 0);
  const overall = input.historicalReceipt
    ? "SUPERSEDED" as const
    : conflict || input.inspection.outcome !== "CONTRACT_VERIFIED"
      ? "ENGINEERING_REVIEW_REQUIRED" as const
      : contractVerified && input.repositoryTests === "PASSED" && input.deliveryIntegrity === "VALID" && input.executionIntegrity === "VALID"
        ? "ENGINEERING_REVIEW_REQUIRED" as const
        : "FAILED" as const;
  return {
    outcome: input.inspection.outcome,
    executionIntegrity: input.executionIntegrity,
    testConformity: conflict ? "CONFLICT" : input.repositoryTests,
    contractConformity: conflict
      ? "CONFLICT"
      : input.inspection.outcome !== "CONTRACT_VERIFIED"
        ? "REVIEW_REQUIRED"
        : contractFailed
          ? "FAILED"
          : contractVerified
            ? "VERIFIED"
            : "NOT_RUN",
    deliveryIntegrity: input.deliveryIntegrity,
    overall,
    assertionsSha256: input.inspection.assertionsSha256,
    repositoryTestExpectationCount: input.inspection.expectations.length,
    contractAssertionPassedCount: input.contractRun?.passed ?? 0,
    contractAssertionFailedCount: input.contractRun?.failed ?? 0,
    testsModified: input.testsModified,
    acceptanceCriteriaModified: input.acceptanceCriteriaModified,
    agentCallCount: input.agentCallCount,
    sandboxRepairAttemptCount: input.sandboxRepairAttemptCount,
    payoutReleased: false,
    ...(input.historicalReceipt ? { supersedesReceiptId: input.historicalReceipt.receiptId } : {}),
  };
}

class SemanticReviewLedger {
  readonly entries: SemanticReviewLedgerEntry[] = [];

  append(entryType: string, sourceRecordType: string, sourceRecordId: string, payload: unknown, createdAt = new Date().toISOString()): void {
    const previousEntrySha256 = this.entries.at(-1)?.entrySha256 ?? null;
    const entry: SemanticReviewLedgerEntry = {
      id: randomUUID(),
      sequenceNumber: this.entries.length + 1,
      entryType,
      sourceRecordType,
      sourceRecordId,
      payloadSha256: digest(canonicalJson(payload)),
      previousEntrySha256,
      entrySha256: "",
      createdAt,
    };
    entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
    this.entries.push(entry);
  }

  verify(): { valid: boolean; entryCount: number; chainSha256: string | null } {
    let previous: string | null = null;
    for (let index = 0; index < this.entries.length; index += 1) {
      const entry = this.entries[index]!;
      if (entry.sequenceNumber !== index + 1 || entry.previousEntrySha256 !== previous || computeEvidenceLedgerEntryHash(entry) !== entry.entrySha256) {
        return { valid: false, entryCount: this.entries.length, chainSha256: previous };
      }
      previous = entry.entrySha256;
    }
    return { valid: true, entryCount: this.entries.length, chainSha256: previous };
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
