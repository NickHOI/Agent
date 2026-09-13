import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalJson, computeEvidenceLedgerEntryHash } from "@donelayer/database";

import { readGatePublicReceipt } from "../../apps/web/src/server/gate-public-receipt";
import {
  assertSemanticContractIntegrity,
  assertVerifiedWorkEvidenceBundleIntegrity,
  type SemanticTaskContract,
  type VerifiedWorkEvidenceBundle,
  VERIFIED_WORK_CONTRACT_GATE,
} from "../../apps/web/src/server/semantic-verification/semantic-contract";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidencePath = path.join(workspaceRoot, "test-results", "semantic-verification-real-evidence.json");
const databasePath = path.join(workspaceRoot, "test-results", "semantic-verification-reality.sqlite");
const repairPatchPath = path.join(workspaceRoot, "test-results", "semantic-true-repair.patch");
const deliveryDiffPath = path.join(workspaceRoot, "test-results", "semantic-delivery-diff.patch");
const firstFailurePath = path.join(workspaceRoot, "test-results", "verified-work-contract-v1-source-boundary-failure-evidence.json");
const hasEvidence = [evidencePath, databasePath, repairPatchPath, deliveryDiffPath].every(existsSync);

type JsonRecord = Record<string, unknown>;

describe("Persisted Verified Work Contract V1 evidence", () => {
  it.skipIf(!hasEvidence)("recomputes the Work Contract, Evidence Bundle, Receipt, ledger, and bounded real delivery", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as JsonRecord;
    const result = record(evidence.result);
    const conflict = record(result.conflict);
    const historical = record(result.historicalReview);
    const trueFixture = record(result.trueFixture);
    const contract = record(trueFixture.contract) as SemanticTaskContract;
    const repair = record(result.repair);
    const delivery = record(result.delivery);
    const independent = record(delivery.independentVerification);
    const bundle = record(delivery.evidenceBundle) as VerifiedWorkEvidenceBundle;
    const receipt = record(delivery.receipt);
    const receiptDocument = record(receipt.document);
    const pullRequest = record(delivery.pullRequest);

    expect(evidence.gate).toBe(VERIFIED_WORK_CONTRACT_GATE);
    expect(result.gate).toBe(VERIFIED_WORK_CONTRACT_GATE);
    expect(conflict).toMatchObject({
      status: "SPEC_TEST_CONFLICT",
      agentCallCount: 0,
      sandboxRepairAttemptCount: 0,
      payoutReleased: false,
    });
    expect(record(record(record(conflict.receipt).document).evidenceBundle)).toMatchObject({
      completion: { agentReported: "NOT_REPORTED", independentlyVerified: "ENGINEERING_REVIEW_REQUIRED" },
      projection: { complete: false },
    });
    expect(record(record(record(historical.receipt).document).semanticVerification).overall).toBe("SUPERSEDED");

    expect(() => assertSemanticContractIntegrity(contract)).not.toThrow();
    expect(contract).toMatchObject({
      contractType: "VERIFIED_WORK_CONTRACT_V1",
      status: "LOCKED",
      authoritativeOracle: "LOCKED_CONTRACT_ASSERTIONS",
      verificationPolicy: {
        deterministicVerifier: "NON_AI_DETERMINISTIC_VERIFIER",
        agentReportedCompletionIsSufficient: false,
        aiSoleJudgeAllowed: false,
      },
    });
    expect(trueFixture).toMatchObject({
      branch: "fixture/real-source-bug-v1",
      commitSha: "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00",
      independentRemoteCommitSha: "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00",
    });

    expect(repair).toMatchObject({ status: "VERIFIED" });
    expect(record(repair.receipt)).toMatchObject({ result: "CONTRACT_VERIFIED" });
    expect(Number(record(record(repair.agentRun).usage).apiRequestCount)).toBeGreaterThan(0);
    expect(record(repair.patch).modifiedFiles).toEqual(["src/add.ts"]);
    expect(sha256(readFileSync(repairPatchPath))).toBe(record(repair.patch).sha256);

    expect(delivery).toMatchObject({
      status: "CONTRACT_VERIFIED_DELIVERY",
      failureCode: null,
      deliveryWorkspaceCleaned: true,
      payment: { mode: "SIMULATION_ONLY", state: "RELEASED", providerPayoutCents: 800, platformFeeCents: 200 },
      semanticVerification: {
        executionIntegrity: "VALID",
        testConformity: "PASSED",
        contractConformity: "VERIFIED",
        deliveryIntegrity: "VALID",
        overall: "VERIFIED_DELIVERY",
      },
    });
    expect(pullRequest).toMatchObject({
      number: 2,
      state: "OPEN",
      merged: false,
      baseBranch: "fixture/real-source-bug-v1",
      headBranch: delivery.deliveryBranch,
    });
    expect(String(pullRequest.url)).toBe("https://github.com/NickHOI/donelayer-build-rescue-fixture/pull/2");
    expect(independent).toMatchObject({
      verifierType: "NON_AI_DETERMINISTIC_VERIFIER",
      test: { exitCode: 0, status: "PASSED" },
      contractAssertions: { result: { passed: 4, failed: 0 } },
      antiCheating: { testsUnchanged: true, testScriptUnchanged: true, testConfigurationUnchanged: true },
      cleanup: { cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false },
    });
    expect(record(independent.sandbox).sandboxId).not.toBe(record(repair.sandbox).sandboxId);
    expect(sha256(readFileSync(deliveryDiffPath))).toBe(record(delivery.deliveryDiff).sha256);

    expect(() => assertVerifiedWorkEvidenceBundleIntegrity(bundle, contract)).not.toThrow();
    expect(bundle).toMatchObject({
      bundleType: "VERIFIED_WORK_EVIDENCE_BUNDLE_V1",
      completion: { agentReported: "REPORTED", independentlyVerified: "VERIFIED_DELIVERY" },
      projection: { complete: true, missing: [] },
    });
    expect(record(delivery.publicReceipt).artifactSha256).toBe(bundle.bundleSha256);
    expect(receiptDocument.evidenceBundle).toEqual(bundle);
    expect(receipt.receiptSha256).toBe(sha256(canonicalJson(receiptDocument)));
    expectLedger(records(delivery.ledgerEntries), delivery.ledgerVerification);
    expect(records(delivery.ledgerEntries).map((entry) => entry.entryType)).toContain("EVIDENCE_BUNDLE_CREATED");

    process.env.DONELAYER_GATE_RECEIPT_EVIDENCE_PATH = evidencePath;
    expect(readGatePublicReceipt(String(receipt.publicReceiptId))).toMatchObject({
      verificationStatus: "VALID",
      result: "CONTRACT_VERIFIED_DELIVERY",
      artifactSha256: bundle.bundleSha256,
    });
    delete process.env.DONELAYER_GATE_RECEIPT_EVIDENCE_PATH;

    const database = new DatabaseSync(databasePath);
    try {
      expect((database.prepare("SELECT COUNT(*) count FROM semantic_gate_runs").get() as { count: number }).count).toBe(4);
      expect(database.prepare("SELECT state,provider_payout_cents,platform_fee_cents FROM test_ledger_entries").get()).toEqual({
        state: "RELEASED",
        provider_payout_cents: 800,
        platform_fee_cents: 200,
      });
      expect((database.prepare("SELECT COUNT(*) count FROM receipt_semantic_reviews WHERE overall_status='SUPERSEDED'").get() as { count: number }).count).toBe(1);
      expect(() => database.exec("UPDATE receipt_semantic_reviews SET overall_status='FAILED'")).toThrow("append-only");
      expect(() => database.exec("DELETE FROM receipt_semantic_reviews")).toThrow("append-only");
    } finally {
      database.close();
    }

    expect(JSON.stringify(evidence)).not.toMatch(
      /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\user/i,
    );
  });

  it.skipIf(!existsSync(firstFailurePath))("preserves the initial fail-closed source-boundary evidence", () => {
    const evidence = JSON.parse(readFileSync(firstFailurePath, "utf8")) as JsonRecord;
    expect(evidence.gate).toBe("SEMANTIC_VERIFICATION_SPEC_TEST_CONFLICT_V1");
    expect(record(evidence.result)).toMatchObject({
      kind: "error",
      errorCode: "SEMANTIC_VERIFICATION_GATE_FAILED",
      message: "Source runner branch is outside the approved boundary",
    });
  });
});

function expectLedger(entries: JsonRecord[], verificationValue: unknown): void {
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const hash = computeEvidenceLedgerEntryHash({
      sequenceNumber: Number(entry.sequenceNumber),
      entryType: String(entry.entryType),
      sourceRecordType: String(entry.sourceRecordType),
      sourceRecordId: String(entry.sourceRecordId),
      payloadSha256: String(entry.payloadSha256),
      previousEntrySha256: previous,
      createdAt: String(entry.createdAt),
    });
    expect(entry.sequenceNumber).toBe(index + 1);
    expect(entry.previousEntrySha256).toBe(previous);
    expect(entry.entrySha256).toBe(hash);
    previous = hash;
  });
  expect(verificationValue).toEqual({ valid: true, entryCount: entries.length, chainSha256: previous });
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected evidence object");
  return value as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error("Expected evidence array");
  return value.map(record);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
