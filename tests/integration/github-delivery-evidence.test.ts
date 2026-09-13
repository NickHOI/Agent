import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalJson, computeEvidenceLedgerEntryHash } from "@donelayer/database";

import { readGatePublicReceipt } from "../../apps/web/src/server/gate-public-receipt";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidencePath = path.join(workspaceRoot, "test-results", "github-delivery-independent-verify-evidence.json");
const databasePath = path.join(workspaceRoot, "test-results", "github-delivery-independent-verify.sqlite");
const deliveryPath = path.join(workspaceRoot, "test-results", "github-delivery.json");
const diffPath = path.join(workspaceRoot, "test-results", "delivery-diff.patch");
const partialEvidencePath = path.join(workspaceRoot, "test-results", "github-delivery-partial-v1-evidence.json");
const hasEvidence = [evidencePath, databasePath, deliveryPath, diffPath].every(existsSync);

type JsonRecord = Record<string, unknown>;

describe("Persisted GitHub delivery and independent verification evidence", () => {
  it.skipIf(!hasEvidence)("recomputes the remote delivery, clean verification, Receipt, and simulated release evidence", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as JsonRecord;
    const result = record(evidence.result);
    const repair = record(result.repair);
    const repository = record(result.repository);
    const patch = record(result.patch);
    const localCommit = record(result.localCommit);
    const remoteCommit = record(result.remoteCommit);
    const push = record(result.push);
    const pullRequest = record(result.pullRequest);
    const deliveryDiff = record(result.deliveryDiff);
    const verification = record(result.independentVerification);
    const source = record(verification.source);
    const sandbox = record(verification.sandbox);
    const sourceVerification = record(sandbox.sourceVerification);
    const test = record(verification.test);
    const testStatistics = record(verification.testStatistics);
    const antiCheating = record(verification.antiCheating);
    const cleanup = record(verification.cleanup);
    const payment = record(result.payment);
    const artifacts = records(result.artifacts);
    const ledgerEntries = records(result.ledgerEntries);
    const receipt = record(result.receipt);
    const receiptDocument = record(receipt.document);
    const publicReceipt = record(result.publicReceipt);

    expect(evidence.gate).toBe("GITHUB_PATCH_DELIVERY_AND_INDEPENDENT_VERIFICATION_GATE_V1");
    expect(result).toMatchObject({
      status: "VERIFIED_DELIVERY",
      failureCode: null,
      aiCallCount: 0,
      aiGatewayUsageUsd: 0,
      policyViolations: [],
      deliveryWorkspaceCleaned: true,
    });
    expect(repair).toMatchObject({
      jobRunId: "ed564b18-8fa2-48d8-a307-1d0901e8b52f",
      publicReceiptId: "dlr_MdFiAU6qEBFAGtLKILBMfV5s",
      patchSha256: "6e8679bbef6dbbba31f84ffb20b209df4d3fadfee81e58383e9926a70855c996",
      result: "VERIFIED",
      providerWarnings: ["AI_GATEWAY_RATE_LIMITED_AFTER_REPAIR"],
    });
    expect(repository).toMatchObject({
      repositoryId: "1347598300",
      repository: "NickHOI/donelayer-build-rescue-fixture",
      baseBranch: "main",
      expectedBaseCommit: "600f326ce373160eb5495aaef72230d4c9807e8f",
      remoteBaseCommit: "600f326ce373160eb5495aaef72230d4c9807e8f",
      expectedCommitExists: true,
    });
    expect(result.deliveryBranch).toBe("donelayer/repair/ed564b18-8fa2");
    expect(patch).toMatchObject({
      patchSha256: repair.patchSha256,
      changedFiles: ["src/add.ts"],
      testsUnchanged: true,
      testScriptUnchanged: true,
      testConfigurationUnchanged: true,
      forbiddenTestMarkersAdded: false,
    });
    expect(localCommit).toMatchObject({
      commitSha: "466be67975a953a1ae3b5cfc41e80d42ee057164",
      parentCommitSha: repository.expectedBaseCommit,
      message: "fix: apply DoneLayer verified repair",
      changedFiles: ["src/add.ts"],
    });
    expect(remoteCommit).toMatchObject({ commitSha: localCommit.commitSha, parentCommitSha: localCommit.parentCommitSha, changedFiles: ["src/add.ts"] });
    expect(push).toMatchObject({ exitCode: 0, localCommitSha: localCommit.commitSha, remoteCommitSha: localCommit.commitSha });
    expect(pullRequest).toMatchObject({
      number: 1,
      state: "OPEN",
      merged: false,
      baseBranch: "main",
      headBranch: result.deliveryBranch,
      baseCommit: localCommit.parentCommitSha,
      headCommit: localCommit.commitSha,
    });
    expect(pullRequest.body).toContain("Independent Verification Status: PENDING");
    expect(deliveryDiff.semanticEquivalent).toBe(true);
    const diff = readFileSync(diffPath, "utf8");
    expect(sha256(diff)).toBe(deliveryDiff.sha256);
    expect(diff).toContain("diff --git a/src/add.ts b/src/add.ts");

    expect(verification).toMatchObject({ verifierType: "NON_AI_DETERMINISTIC_VERIFIER", aiCallCount: 0, aiGatewayUsageUsd: 0, result: "PASSED" });
    expect(source).toMatchObject({
      branch: result.deliveryBranch,
      deliveryCommitSha: localCommit.commitSha,
      independentRemoteCommitSha: localCommit.commitSha,
      parentCommitSha: localCommit.parentCommitSha,
      materializerWorkspaceCleaned: true,
    });
    expect(sandbox.sandboxId).not.toBe(repair.sandboxId);
    expect(sandbox).toMatchObject({ networkPolicy: "deny-all", persistent: false, snapshot: false });
    expect(sourceVerification).toMatchObject({ credentialEnvironmentNames: [], commitVerified: true, manifestVerified: true, packageVerified: true });
    expect(verification.install).toMatchObject({ exitCode: 0, status: "PASSED" });
    expect(verification.build).toMatchObject({ exitCode: null, status: "NOT_PRESENT" });
    expect(test).toMatchObject({ exitCode: 0, status: "PASSED" });
    expect(testStatistics).toEqual({ status: "PARSED", runner: "node:test", total: 2, passed: 2, failed: 0 });
    expect(antiCheating).toMatchObject({
      changedFiles: ["src/add.ts"],
      testsUnchanged: true,
      testScriptUnchanged: true,
      testConfigurationUnchanged: true,
      forbiddenTestMarkersAdded: false,
    });
    expect(antiCheating.testsManifestSha256Before).toBe(antiCheating.testsManifestSha256After);
    expect(antiCheating.packageJsonSha256Before).toBe(antiCheating.packageJsonSha256After);
    expect(cleanup).toMatchObject({ finalProviderState: "stopped", persistent: false, snapshotCreated: false, stillRunning: false, cleanupVerified: true });
    expect(payment).toMatchObject({ mode: "SIMULATION_ONLY", state: "RELEASED", customerChargeCents: 1000, providerPayoutCents: 800, platformFeeCents: 200 });

    expect(artifacts).toHaveLength(20);
    expect(artifacts.map((artifact) => artifact.fileName)).toEqual(expect.arrayContaining(["github-delivery.json", "delivery-diff.patch", "independent-test-result.json", "verification-sandbox-cleanup.json", "test-ledger.json"]));
    expectLedger(ledgerEntries, result.ledgerVerification);
    expect(ledgerEntries.at(-1)?.entryType).toBe("RECEIPT_CREATED");
    const eventTypes = ledgerEntries.map((entry) => entry.entryType);
    expect(eventTypes.indexOf("TEST_LEDGER_RELEASED")).toBeGreaterThan(eventTypes.indexOf("DELIVERY_WORKSPACE_CLEANED"));
    expect(eventTypes.indexOf("DELIVERY_WORKSPACE_CLEANED")).toBeGreaterThan(eventTypes.indexOf("VERIFIED_DELIVERY"));
    expect(receipt.receiptSha256).toBe(sha256(canonicalJson(receiptDocument)));
    expect(receiptDocument).toMatchObject({ finalResult: "VERIFIED_DELIVERY", payment: { state: "RELEASED" }, aiPolicy: { aiCalls: 0, aiGatewayUsageUsd: 0, violations: [] } });
    expect(publicReceipt).toMatchObject({
      result: "VERIFIED_DELIVERY",
      verificationStatus: "VALID",
      githubDelivery: {
        deliveredToGitHub: true,
        independentCleanVerification: "PASSED",
        pullRequestState: "OPEN",
        merged: false,
        testLedgerState: "RELEASED",
        aiCallCount: 0,
        aiGatewayUsageUsd: 0,
      },
    });

    process.env.DONELAYER_GATE_RECEIPT_EVIDENCE_PATH = evidencePath;
    expect(readGatePublicReceipt(String(receipt.publicReceiptId))).toMatchObject({ verificationStatus: "VALID", result: "VERIFIED_DELIVERY" });
    delete process.env.DONELAYER_GATE_RECEIPT_EVIDENCE_PATH;

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const databaseArtifacts = database.prepare("SELECT size,sha256,content FROM evidence_artifacts").all() as Array<{ size: number; sha256: string; content: Uint8Array }>;
      expect(databaseArtifacts).toHaveLength(20);
      expect(databaseArtifacts.every((artifact) => artifact.size === artifact.content.byteLength && artifact.sha256 === createHash("sha256").update(artifact.content).digest("hex"))).toBe(true);
      expect((database.prepare("SELECT COUNT(*) count FROM evidence_ledger").get() as { count: number }).count).toBe(ledgerEntries.length);
      expect(database.prepare("SELECT state,provider_payout_cents,platform_fee_cents FROM test_ledger_entries").get()).toEqual({ state: "RELEASED", provider_payout_cents: 800, platform_fee_cents: 200 });
    } finally {
      database.close();
    }
    expect(JSON.stringify(evidence)).not.toMatch(/gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\/i);
  });

  it.skipIf(!existsSync(partialEvidencePath))("preserves the disclosed pre-verifier partial Receipt without payout release", () => {
    const result = record((JSON.parse(readFileSync(partialEvidencePath, "utf8")) as JsonRecord).result);
    expect(result).toMatchObject({ status: "FAILED", failureCode: "PATCH_MISMATCH", independentVerification: null, deliveryWorkspaceCleaned: true });
    expect(result.payment).toMatchObject({ state: "RESERVED", providerPayoutCents: 0, platformFeeCents: 0 });
    const ledger = records(result.ledgerEntries);
    expectLedger(ledger, result.ledgerVerification);
    expect(ledger.some((entry) => entry.entryType === "TEST_LEDGER_RELEASED")).toBe(false);
    expect(result.receipt).toMatchObject({ result: "PATCH_MISMATCH" });
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
