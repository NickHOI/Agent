import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalJson, computeEvidenceLedgerEntryHash } from "@donelayer/database";
import {
  assertSemanticContractIntegrity,
  assertVerifiedWorkEvidenceBundleIntegrity,
  createAdditionSemanticContract,
  createContractAssertionRunner,
  createVerifiedWorkEvidenceBundle,
  inspectRepositoryTestOracle,
  parseContractAssertionRun,
} from "../../apps/web/src/server/semantic-verification/semantic-contract";
import {
  historicalReceiptSupersession,
  reviewSemanticContract,
} from "../../apps/web/src/server/semantic-verification/semantic-review";

const commitSha = "600f326ce373160eb5495aaef72230d4c9807e8f";

describe("Semantic Verification / Spec-Test Conflict V1", () => {
  it("detects the exact locked Contract conflict before repair and releases no payout", () => {
    const contract = createAdditionSemanticContract({ taskId: "semantic-conflict", branch: "main", commitSha });
    const files = [{
      filePath: "tests/add.test.ts",
      content: [
        'import assert from "node:assert/strict";',
        'import { add } from "../src/add.ts";',
        "assert.equal(add(2, 3), 5);",
        "assert.equal(add(2, 2), 5);",
        "assert.equal(add(0, 0), 0);",
        "assert.equal(add(-1, 1), 0);",
      ].join("\n"),
    }];

    const outcome = reviewSemanticContract({ contract, files });

    expect(outcome).toMatchObject({
      status: "SPEC_TEST_CONFLICT",
      agentCallCount: 0,
      sandboxRepairAttemptCount: 0,
      payoutReleased: false,
    });
    expect(outcome.testOracleInspection.conflicts).toEqual([expect.objectContaining({
      assertionId: "add-2-2",
      expected: 4,
      repositoryExpected: 5,
    })]);
    expect(outcome.receipt.document.semanticVerification).toMatchObject({
      executionIntegrity: "VALID",
      testConformity: "CONFLICT",
      contractConformity: "CONFLICT",
      deliveryIntegrity: "NOT_RUN",
      overall: "ENGINEERING_REVIEW_REQUIRED",
      payoutReleased: false,
    });
    expect(outcome.ledgerEntries.map((entry) => entry.entryType)).toEqual(expect.arrayContaining([
      "CONTRACT_ASSERTIONS_LOCKED",
      "TEST_ORACLE_INSPECTED",
      "SPEC_TEST_CONFLICT_DETECTED",
      "ENGINEERING_REVIEW_REQUIRED",
      "EVIDENCE_BUNDLE_CREATED",
      "RECEIPT_CREATED",
    ]));
    expect(outcome.receipt.document.evidenceBundle).toMatchObject({
      completion: { agentReported: "NOT_REPORTED", independentlyVerified: "ENGINEERING_REVIEW_REQUIRED" },
      projection: { complete: false },
    });
    expect(outcome.publicReceipt.artifactSha256).toBe(outcome.receipt.document.evidenceBundle.bundleSha256);
    expectLedger(outcome.ledgerEntries);
  });

  it("treats passing repository tests as insufficient when independent Contract assertions fail", () => {
    const contract = createAdditionSemanticContract({ taskId: "test-pass-insufficient", branch: "fixture/real-source-bug-v1", commitSha });
    const files = [{ filePath: "tests/add.test.ts", content: correctTests() }];
    const contractRun = parseContractAssertionRun(JSON.stringify({
      schemaVersion: 1,
      assertionsSha256: contract.assertionsSha256,
      passed: 3,
      failed: 1,
      results: contract.assertions.map((assertion) => ({
        assertionId: assertion.id,
        args: assertion.args,
        expected: assertion.expected,
        actual: assertion.id === "add-2-2" ? 5 : assertion.expected,
        status: assertion.id === "add-2-2" ? "FAILED" : "PASSED",
      })),
    }), contract);

    const outcome = reviewSemanticContract({
      contract,
      files,
      contractAssertionRun: contractRun,
      repositoryTests: "PASSED",
      deliveryIntegrity: "VALID",
    });

    expect(outcome.receipt.document.semanticVerification).toMatchObject({
      testConformity: "PASSED",
      contractConformity: "FAILED",
      overall: "FAILED",
    });
  });

  it("accepts a complete Contract assertion pass without overstating it as a verified delivery", () => {
    const contract = createAdditionSemanticContract({ taskId: "contract-pass", branch: "fixture/real-source-bug-v1", commitSha });
    const inspection = inspectRepositoryTestOracle({ contract, files: [{ filePath: "tests/add.test.ts", content: correctTests() }] });
    expect(inspection).toMatchObject({ outcome: "CONTRACT_VERIFIED", conflicts: [], missingAssertionIds: [] });

    const run = parseContractAssertionRun(JSON.stringify({
      schemaVersion: 1,
      assertionsSha256: contract.assertionsSha256,
      passed: 4,
      failed: 0,
      results: contract.assertions.map((assertion) => ({
        assertionId: assertion.id,
        args: assertion.args,
        expected: assertion.expected,
        actual: assertion.expected,
        status: "PASSED",
      })),
    }), contract);
    const outcome = reviewSemanticContract({
      contract,
      files: [{ filePath: "tests/add.test.ts", content: correctTests() }],
      contractAssertionRun: run,
      repositoryTests: "PASSED",
      deliveryIntegrity: "VALID",
      agentCallCount: 4,
      sandboxRepairAttemptCount: 1,
    });
    expect(outcome.receipt.document.semanticVerification).toMatchObject({
      outcome: "CONTRACT_VERIFIED",
      testConformity: "PASSED",
      contractConformity: "VERIFIED",
      deliveryIntegrity: "VALID",
      overall: "ENGINEERING_REVIEW_REQUIRED",
    });
    expect(outcome.receipt.document.evidenceBundle.projection).toMatchObject({ complete: false });
  });

  it("fails closed when locked assertions or assertion results are tampered", () => {
    const contract = createAdditionSemanticContract({ taskId: "tamper", branch: "main", commitSha });
    contract.assertions[1]!.expected = 5;
    expect(() => assertSemanticContractIntegrity(contract)).toThrow("CONTRACT_ASSERTION_TAMPERING_DETECTED");

    const clean = createAdditionSemanticContract({ taskId: "tamper-result", branch: "main", commitSha });
    expect(() => parseContractAssertionRun(JSON.stringify({
      schemaVersion: 1,
      assertionsSha256: clean.assertionsSha256,
      passed: 4,
      failed: 0,
      results: clean.assertions.map((assertion) => ({
        assertionId: assertion.id,
        args: assertion.args,
        expected: assertion.expected,
        actual: assertion.id === "add-2-2" ? 5 : assertion.expected,
        status: "PASSED",
      })),
    }), clean)).toThrow("CONTRACT_ASSERTION_RESULT_TAMPERING_DETECTED");

    const wholeContract = createAdditionSemanticContract({ taskId: "tamper-contract", branch: "main", commitSha });
    wholeContract.permissionPolicy.allowedActions.push("merge_pull_request");
    expect(() => assertSemanticContractIntegrity(wholeContract)).toThrow("CONTRACT_ASSERTION_TAMPERING_DETECTED");
  });

  it("requires a complete, independently bound Evidence Bundle before verified delivery", () => {
    const contract = createAdditionSemanticContract({ taskId: "evidence-bundle", branch: "fixture/real-source-bug-v1", commitSha });
    const dimensions = {
      executionIntegrity: "VALID" as const,
      testConformity: "PASSED" as const,
      contractConformity: "VERIFIED" as const,
      deliveryIntegrity: "VALID" as const,
    };
    const completeEvidence = [
      { kind: "WORK_CONTRACT" as const, sha256: "1".repeat(64) },
      { kind: "PERMISSION_DECISION" as const, sha256: "2".repeat(64) },
      { kind: "SOURCE_MANIFEST" as const, sha256: "3".repeat(64) },
      { kind: "AGENT_REPAIR_RECEIPT" as const, sha256: "4".repeat(64) },
      { kind: "REPAIR_PATCH" as const, sha256: "5".repeat(64) },
      { kind: "DELIVERY_DIFF" as const, sha256: "6".repeat(64) },
      { kind: "INDEPENDENT_VERIFICATION" as const, sha256: "7".repeat(64) },
    ];
    const bundle = createVerifiedWorkEvidenceBundle({
      contract,
      agentReported: "REPORTED",
      independentlyVerified: "VERIFIED_DELIVERY",
      dimensions,
      evidence: completeEvidence,
    });
    expect(bundle.projection).toMatchObject({ complete: true, missing: [] });
    expect(() => assertVerifiedWorkEvidenceBundleIntegrity(bundle, contract)).not.toThrow();

    const tampered = structuredClone(bundle);
    tampered.evidence[0]!.sha256 = "f".repeat(64);
    expect(() => assertVerifiedWorkEvidenceBundleIntegrity(tampered, contract)).toThrow("VERIFIED_WORK_EVIDENCE_BUNDLE_TAMPERING_DETECTED");
    expect(() => createVerifiedWorkEvidenceBundle({
      contract,
      agentReported: "NOT_REPORTED",
      independentlyVerified: "VERIFIED_DELIVERY",
      dimensions,
      evidence: completeEvidence,
    })).toThrow("VERIFIED_WORK_EVIDENCE_BUNDLE_TAMPERING_DETECTED");
    expect(() => createVerifiedWorkEvidenceBundle({
      contract,
      agentReported: "REPORTED",
      independentlyVerified: "VERIFIED_DELIVERY",
      dimensions,
      evidence: completeEvidence.filter((item) => item.kind !== "INDEPENDENT_VERIFICATION"),
    })).toThrow("VERIFIED_WORK_EVIDENCE_BUNDLE_TAMPERING_DETECTED");
  });

  it("records historical semantic supersession without changing Receipt integrity", () => {
    const contract = createAdditionSemanticContract({ taskId: "historical-review", branch: "main", commitSha });
    const historical = historicalReceiptSupersession({
      receiptId: "historical-receipt-id",
      publicReceiptId: "dlr_MdFiAU6qEBFAGtLKILBMfV5s",
      receiptSha256: "a".repeat(64),
      evidenceChainSha256: "b".repeat(64),
    });
    const outcome = reviewSemanticContract({
      contract,
      files: [{ filePath: "tests/add.test.ts", content: correctTests().replace("add(2, 2), 4", "add(2, 2), 5") }],
      repositoryTests: "PASSED",
      deliveryIntegrity: "VALID",
      historicalReceipt: historical,
    });
    expect(outcome.receipt.document.historicalReceipt).toMatchObject({
      integrity: "VALID",
      executionEvidence: "VALID",
      testConformity: "PASSED",
      semanticReview: "SPEC_TEST_CONFLICT_DISCOVERED",
      overallSemanticDeliveryStatus: "SUPERSEDED",
    });
    expect(outcome.receipt.document.semanticVerification.overall).toBe("SUPERSEDED");
    expect(outcome.ledgerEntries.some((entry) => entry.entryType === "RECEIPT_SUPERSEDED")).toBe(true);
  });

  it("generates a deterministic, source-only independent assertion runner", () => {
    const contract = createAdditionSemanticContract({ taskId: "runner", branch: "main", commitSha });
    const runner = createContractAssertionRunner(contract);
    expect(runner).toContain('import { add } from "./src/add.ts";');
    expect(runner).toContain(contract.assertionsSha256);
    expect(runner).not.toMatch(/tests\/|setTimeout|expected patch|600f326/);
  });
});

function correctTests(): string {
  return [
    'import assert from "node:assert/strict";',
    'import { add } from "../src/add.ts";',
    "assert.equal(add(2, 3), 5);",
    "assert.equal(add(2, 2), 4);",
    "assert.equal(add(0, 0), 0);",
    "assert.equal(add(-1, 1), 0);",
  ].join("\n");
}

function expectLedger(entries: Array<{
  sequenceNumber: number;
  entryType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  entrySha256: string;
  createdAt: string;
}>): void {
  let previous: string | null = null;
  for (const [index, entry] of entries.entries()) {
    expect(entry.sequenceNumber).toBe(index + 1);
    expect(entry.previousEntrySha256).toBe(previous);
    expect(entry.entrySha256).toBe(computeEvidenceLedgerEntryHash(entry));
    previous = entry.entrySha256;
  }
  expect(previous).toMatch(/^[a-f0-9]{64}$/);
  expect(createHash("sha256").update(canonicalJson(entries.at(-1))).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
}
