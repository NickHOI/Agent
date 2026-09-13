import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalJson, computeEvidenceLedgerEntryHash } from "@donelayer/database";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidencePath = path.join(workspaceRoot, "test-results", "agent-repair-sandbox-evidence.json");
const databasePath = path.join(workspaceRoot, "test-results", "agent-repair-sandbox.sqlite");
const patchPath = path.join(workspaceRoot, "test-results", "agent-repair.patch");
const postflightPath = path.join(workspaceRoot, "test-results", "agent-repair-gateway-postflight.json");
const hasEvidence = [evidencePath, databasePath, patchPath, postflightPath].every(existsSync);

type JsonRecord = Record<string, unknown>;

describe("Persisted Agent Repair managed Sandbox evidence", () => {
  it.skipIf(!hasEvidence)("proves the live repair, bounded source change, cleanup, and Receipt chain", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as JsonRecord;
    const result = record(evidence.result);
    const source = record(result.source);
    const sandbox = record(result.sandbox);
    const baselineTest = record(sandbox.baselineTest);
    const agentRun = record(result.agentRun);
    const usage = record(agentRun.usage);
    const toolCalls = records(result.toolCalls);
    const repairedTest = record(result.repairedTest);
    const repairPatch = record(result.patch);
    const integrity = record(result.sourceIntegrity);
    const cleanup = record(result.cleanup);
    const artifacts = records(result.artifacts);
    const ledgerEntries = records(result.ledgerEntries);
    const ledgerVerification = record(result.ledgerVerification);
    const receipt = record(result.receipt);
    const document = record(receipt.document);
    const publicReceipt = record(result.publicReceipt);
    const postflight = JSON.parse(readFileSync(postflightPath, "utf8")) as JsonRecord;
    const runId = String(result.runId);
    const receiptId = String(receipt.id);

    expect(evidence.gate).toBe("AGENT_REPAIR_IN_MANAGED_SANDBOX_GATE_V1");
    expect(result).toMatchObject({ kind: "result", status: "VERIFIED", build: null });
    expect(source).toMatchObject({
      materializerCommitSha: "600f326ce373160eb5495aaef72230d4c9807e8f",
      independentRemoteCommitSha: "600f326ce373160eb5495aaef72230d4c9807e8f",
      buildScriptPresent: false,
      materializerWorkspaceCleaned: true,
    });
    expect(sandbox).toMatchObject({ networkPolicy: "deny-all", persistent: false, snapshot: false });
    expect(baselineTest).toMatchObject({ command: "baseline-test", exitCode: 1 });

    expect(agentRun).toMatchObject({
      status: "FAILED",
      finishReason: "AI_GATEWAY_RATE_LIMITED_AFTER_REPAIR",
      stepCount: 4,
      model: { id: "inclusionai/ling-3.0-flash-fin", provider: "inclusionai", isFree: true },
    });
    expect(usage).toMatchObject({
      apiRequestCount: 6,
      inputTokens: 14_576,
      outputTokens: 259,
      cachedInputTokens: 6_483,
      totalTokens: 14_835,
      gatewayReportedCostUsd: null,
    });
    expect(toolCalls.map((call) => call.toolName)).toEqual([
      "list_files",
      "inspect_test_failure",
      "read_file",
      "read_file",
      "apply_patch",
      "run_test",
      "get_diff",
      "get_source_integrity",
    ]);
    expect(toolCalls.map((call) => call.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toolCalls.every((call) => call.success === true)).toBe(true);

    expect(repairedTest).toMatchObject({ command: "repair-test-1", exitCode: 0 });
    expect(repairPatch).toMatchObject({
      sha256: "6e8679bbef6dbbba31f84ffb20b209df4d3fadfee81e58383e9926a70855c996",
      modifiedFiles: ["src/add.ts"],
    });
    const patch = readFileSync(patchPath, "utf8");
    expect(sha256(patch)).toBe(repairPatch.sha256);
    expect(patch).toBe(repairPatch.patch);
    expect(integrity).toMatchObject({
      baselineCommitSha: "600f326ce373160eb5495aaef72230d4c9807e8f",
      missing: [],
      modified: [{ path: "src/add.ts" }],
      added: [],
      unauthorizedModified: [],
    });
    expect(cleanup).toMatchObject({
      finalProviderState: "stopped",
      persistent: false,
      snapshotCreated: false,
      stillRunning: false,
      cleanupVerified: true,
    });
    expect(result.creditsAfter).toMatchObject({ balance: "4.9994", totalUsed: "0.0006" });

    expect(artifacts).toHaveLength(13);
    expect(artifacts.filter((artifact) => artifact.fileName === "gateway-request-postflight.json")).toHaveLength(1);
    expect(postflight).toMatchObject({
      gateway: "Vercel AI Gateway",
      modelProvider: "inclusionai",
      upstreamProvider: "Novita AI",
      modelId: "inclusionai/ling-3.0-flash-fin",
      aggregate: {
        apiRequestCount: 6,
        successfulRequestCount: 4,
        failedRequestCount: 2,
        inputTokens: 14_576,
        cachedInputTokens: 6_483,
        outputTokens: 259,
        gatewayReportedCostUsd: null,
        creditBalanceBefore: "4.999775",
        creditBalanceAfter: "4.9994",
        observedCreditUsed: "0.000375",
      },
    });

    let previousEntrySha256: string | null = null;
    ledgerEntries.forEach((entry, index) => {
      expect(entry.sequenceNumber).toBe(index + 1);
      expect(entry.previousEntrySha256).toBe(previousEntrySha256);
      const entrySha256 = computeEvidenceLedgerEntryHash({
        sequenceNumber: Number(entry.sequenceNumber),
        entryType: String(entry.entryType),
        sourceRecordType: String(entry.sourceRecordType),
        sourceRecordId: String(entry.sourceRecordId),
        payloadSha256: String(entry.payloadSha256),
        previousEntrySha256,
        createdAt: String(entry.createdAt),
      });
      expect(entry.entrySha256).toBe(entrySha256);
      previousEntrySha256 = entrySha256;
    });
    expect(ledgerEntries).toHaveLength(34);
    expect(ledgerEntries.at(-1)?.entryType).toBe("RECEIPT_CREATED");
    expect(ledgerVerification).toEqual({ valid: true, entryCount: 34, chainSha256: previousEntrySha256 });
    expect(document.evidenceLedger).toEqual({
      valid: true,
      entryCount: 33,
      chainSha256: ledgerEntries.at(-2)?.entrySha256,
    });
    expect(receipt.receiptSha256).toBe(sha256(canonicalJson(document)));
    expect(receipt.evidenceChainSha256).toBe(ledgerEntries.at(-2)?.entrySha256);
    expect(publicReceipt).toMatchObject({
      publicReceiptId: "dlr_MdFiAU6qEBFAGtLKILBMfV5s",
      result: "VERIFIED",
      verificationStatus: "VALID",
      cleanupVerified: true,
      patchSha256: repairPatch.sha256,
    });

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const databaseArtifacts = database.prepare(
        "SELECT file_name,size,sha256,content FROM evidence_artifacts WHERE run_id=?",
      ).all(runId) as Array<{ file_name: string; size: number; sha256: string; content: Uint8Array }>;
      expect(databaseArtifacts).toHaveLength(13);
      expect(databaseArtifacts.every((artifact) => (
        artifact.size === artifact.content.byteLength && artifact.sha256 === sha256(artifact.content)
      ))).toBe(true);
      const databaseLedger = database.prepare(
        "SELECT sequence_number,entry_sha256 FROM evidence_ledger WHERE run_id=? ORDER BY sequence_number",
      ).all(runId) as Array<{ sequence_number: number; entry_sha256: string }>;
      expect(databaseLedger.map((entry) => entry.sequence_number)).toEqual(
        Array.from({ length: 34 }, (_, index) => index + 1),
      );
      expect(databaseLedger.map((entry) => entry.entry_sha256)).toEqual(
        ledgerEntries.map((entry) => entry.entrySha256),
      );
      const databaseReceipt = database.prepare(
        "SELECT receipt_sha256,evidence_chain_sha256,receipt_json FROM job_receipts WHERE id=?",
      ).get(receiptId) as { receipt_sha256: string; evidence_chain_sha256: string; receipt_json: string };
      expect(databaseReceipt).toEqual({
        receipt_sha256: receipt.receiptSha256,
        evidence_chain_sha256: receipt.evidenceChainSha256,
        receipt_json: JSON.stringify(document),
      });
    } finally {
      database.close();
    }

    expect(JSON.stringify(evidence)).not.toMatch(
      /VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|Bearer\s+[A-Za-z0-9._-]+|\.env\.local|C:\\Users\\/i,
    );
  });
});

function record(value: unknown): JsonRecord {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as JsonRecord;
}

function records(value: unknown): JsonRecord[] {
  expect(Array.isArray(value)).toBe(true);
  return value as JsonRecord[];
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
