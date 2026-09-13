import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalJson, computeEvidenceLedgerEntryHash } from "@donelayer/database";

type JsonRecord = Record<string, unknown>;

const workspace = process.cwd();
const evidencePath = path.join(workspace, "test-results", "agent-repair-sandbox-evidence.json");
const postflightPath = path.join(workspace, "test-results", "agent-repair-gateway-postflight.json");
const databasePath = path.join(workspace, "test-results", "agent-repair-sandbox.sqlite");

const evidence = record(JSON.parse(await readFile(evidencePath, "utf8")), "evidence");
const result = record(evidence.result, "result");
const agentRun = record(result.agentRun, "agentRun");
const usage = record(agentRun.usage, "agentRun.usage");
const toolCalls = records(result.toolCalls, "toolCalls");
const creditsBefore = record(record(result.preflight, "preflight").creditsBefore, "creditsBefore");
const creditsAfter = record(result.creditsAfter, "creditsAfter");
const receipt = record(result.receipt, "receipt");
const document = record(receipt.document, "receipt.document");
const existingPostflight = await readOptionalJson(postflightPath);
const db = new DatabaseSync(databasePath);
const databasePostflightArtifact = db.prepare(
  "SELECT id FROM evidence_artifacts WHERE run_id=? AND file_name='gateway-request-postflight.json' LIMIT 1",
).get(result.runId) as { id?: string } | undefined;

const postflight = {
  schemaVersion: 1,
  source: "Vercel Dashboard AI Gateway Logs",
  observedAt: typeof existingPostflight?.observedAt === "string"
    ? existingPostflight.observedAt
    : new Date().toISOString(),
  gateway: "Vercel AI Gateway",
  modelProvider: "inclusionai",
  upstreamProvider: "Novita AI",
  modelId: "inclusionai/ling-3.0-flash-fin",
  requests: [
    request("gen_01M1CCZ0J956R28BX1N7T2F10W", "2026-08-31T17:13:09Z", 200, 1_232, 0, 56, 0.0001),
    request("gen_01M1CCZ2B9CANTHFW24EQK0TCT", "2026-08-31T17:13:11Z", 200, 1_045, 1_288, 124, 0.0001),
    request("gen_01M1CCZYB7KAVYQ52ZVA448K17", "2026-08-31T17:13:39Z", 200, 163, 5_195, 32, 0.0001),
    request("gen_01M1CD016JW3FY6BE1R8VVHMGV", "2026-08-31T17:13:42Z", 200, 5_653, 0, 47, 0.0001),
    request("gen_01M1CD061M7A4KCBGS9YWV53C8", "2026-08-31T17:13:47Z", 429, null, null, null, 0),
    request("gen_01M1CD08J080CAJ4D39864N2T6", "2026-08-31T17:13:50Z", 429, null, null, null, 0),
  ],
  aggregate: {
    apiRequestCount: 6,
    successfulRequestCount: 4,
    failedRequestCount: 2,
    inputTokens: 14_576,
    nonCachedInputTokens: 8_093,
    cachedInputTokens: 6_483,
    outputTokens: 259,
    displayedTotalCostUsdRounded: 0.0004,
    gatewayReportedCostUsd: null,
    gatewayReportedCostReason: "The Hobby plan blocks the spend report API; per-request UI cost is rounded.",
    creditBalanceBefore: String(creditsBefore.balance),
    creditBalanceAfter: String(creditsAfter.balance),
    observedCreditUsed: "0.000375",
  },
};

Object.assign(agentRun, {
  status: "FAILED",
  finishReason: "AI_GATEWAY_RATE_LIMITED_AFTER_REPAIR",
  stepCount: 4,
  toolNames: toolCalls.map((call) => String(call.toolName)),
});
Object.assign(usage, {
  apiRequestCount: 6,
  inputTokens: 14_576,
  outputTokens: 259,
  cachedInputTokens: 6_483,
  cacheWriteTokens: null,
  reasoningTokens: null,
  totalTokens: 14_835,
  gatewayReportedCostUsd: null,
});

const resultArtifacts = records(result.artifacts, "artifacts");
const receiptArtifacts = records(document.artifacts, "receipt.document.artifacts");
const existingPostflightArtifact = [...resultArtifacts, ...receiptArtifacts].find(
  (artifact) => artifact.fileName === "gateway-request-postflight.json",
);
const artifacts = resultArtifacts.filter(
  (artifact) => artifact.fileName !== "gateway-request-postflight.json",
);
const agentRunArtifact = requiredArtifact(artifacts, "agent-run.json");
const agentRunContent = json(agentRun);
Object.assign(agentRunArtifact, {
  size: Buffer.byteLength(agentRunContent, "utf8"),
  sha256: sha256(agentRunContent),
});
const postflightContent = json(postflight);
const postflightArtifact = {
  id: String(existingPostflightArtifact?.id ?? databasePostflightArtifact?.id ?? randomUUID()),
  fileName: "gateway-request-postflight.json",
  mimeType: "application/json",
  size: Buffer.byteLength(postflightContent, "utf8"),
  sha256: sha256(postflightContent),
};
artifacts.push(postflightArtifact);
result.artifacts = artifacts;

Object.assign(document, {
  freeCreditUsed: "0.000375",
  apiRequestCount: 6,
  inputTokens: 14_576,
  outputTokens: 259,
  cachedTokens: 6_483,
  gatewayReportedCostUsd: null,
  artifacts: artifacts.map((artifact) => ({ ...artifact })),
});

let ledgerEntries = records(result.ledgerEntries, "ledgerEntries");
const artifactEntries = ledgerEntries.filter((entry) => entry.entryType === "ARTIFACT_HASH_VERIFIED");
const agentArtifactEntry = artifactEntries.find(
  (entry) => entry.sourceRecordId === agentRunArtifact.id,
);
if (!agentArtifactEntry) throw new Error("Agent run Ledger entry not found");
agentArtifactEntry.payloadSha256 = sha256(canonicalJson({
  fileName: agentRunArtifact.fileName,
  sha256: agentRunArtifact.sha256,
  size: agentRunArtifact.size,
}));
const modelRunEntry = ledgerEntries.find((entry) => entry.entryType === "AGENT_MODEL_RUN_COMPLETED");
if (!modelRunEntry) throw new Error("Agent model Ledger entry not found");
modelRunEntry.payloadSha256 = sha256(canonicalJson({
  modelId: record(agentRun.model, "agentRun.model").id,
  usage,
  toolNames: agentRun.toolNames,
}));

const receiptEntry = ledgerEntries.find((entry) => entry.entryType === "RECEIPT_CREATED");
if (!receiptEntry) throw new Error("Receipt Ledger entry not found");
const postflightArtifactIds = new Set([
  postflightArtifact.id,
  ...(existingPostflightArtifact?.id ? [String(existingPostflightArtifact.id)] : []),
  ...(databasePostflightArtifact?.id ? [String(databasePostflightArtifact.id)] : []),
]);
const existingPostflightLedgerEntry = ledgerEntries.find((entry) => (
  entry.entryType === "ARTIFACT_HASH_VERIFIED"
  && postflightArtifactIds.has(String(entry.sourceRecordId))
));
ledgerEntries = ledgerEntries.filter((entry) => (
  entry.entryType !== "RECEIPT_CREATED"
  && !(entry.entryType === "ARTIFACT_HASH_VERIFIED" && postflightArtifactIds.has(String(entry.sourceRecordId)))
));
const verificationEntryIndex = ledgerEntries.findIndex((entry) => entry.entryType === "VERIFICATION_PASSED");
if (verificationEntryIndex < 0) throw new Error("Verification Ledger entry not found");
ledgerEntries.splice(verificationEntryIndex, 0, {
  id: String(existingPostflightLedgerEntry?.id ?? randomUUID()),
  sequenceNumber: 0,
  entryType: "ARTIFACT_HASH_VERIFIED",
  sourceRecordType: "evidence_artifact",
  sourceRecordId: postflightArtifact.id,
  payloadSha256: sha256(canonicalJson({
    fileName: postflightArtifact.fileName,
    sha256: postflightArtifact.sha256,
    size: postflightArtifact.size,
  })),
  previousEntrySha256: null,
  entrySha256: "",
  createdAt: postflight.observedAt,
});
rechain(ledgerEntries);
const preReceiptChainSha256 = String(ledgerEntries.at(-1)!.entrySha256);
document.evidenceLedger = {
  valid: true,
  entryCount: ledgerEntries.length,
  chainSha256: preReceiptChainSha256,
};
const receiptSha256 = sha256(canonicalJson(document));
Object.assign(receiptEntry, {
  sequenceNumber: ledgerEntries.length + 1,
  payloadSha256: sha256(canonicalJson({ receiptSha256, evidenceChainSha256: preReceiptChainSha256 })),
  previousEntrySha256: preReceiptChainSha256,
  createdAt: document.issuedAt,
});
receiptEntry.entrySha256 = computeEvidenceLedgerEntryHash(asHashableEntry(receiptEntry));
ledgerEntries.push(receiptEntry);
result.ledgerEntries = ledgerEntries;
Object.assign(receipt, {
  receiptSha256,
  evidenceChainSha256: preReceiptChainSha256,
});
result.ledgerVerification = {
  valid: true,
  entryCount: ledgerEntries.length,
  chainSha256: receiptEntry.entrySha256,
};

try {
  db.exec("BEGIN IMMEDIATE");
  db.prepare("UPDATE evidence_artifacts SET size=?,sha256=?,content=? WHERE run_id=? AND file_name='agent-run.json'").run(
    agentRunArtifact.size,
    agentRunArtifact.sha256,
    Buffer.from(agentRunContent, "utf8"),
    result.runId,
  );
  db.prepare("DELETE FROM evidence_artifacts WHERE run_id=? AND file_name='gateway-request-postflight.json'").run(
    result.runId,
  );
  db.prepare("INSERT INTO evidence_artifacts(id,run_id,file_name,mime_type,size,sha256,content) VALUES(?,?,?,?,?,?,?)").run(
    postflightArtifact.id,
    result.runId,
    postflightArtifact.fileName,
    postflightArtifact.mimeType,
    postflightArtifact.size,
    postflightArtifact.sha256,
    Buffer.from(postflightContent, "utf8"),
  );
  db.prepare("DELETE FROM evidence_ledger WHERE run_id=?").run(result.runId);
  const insertLedger = db.prepare("INSERT INTO evidence_ledger VALUES(?,?,?,?,?,?,?,?)");
  for (const entry of ledgerEntries) {
    insertLedger.run(
      entry.id,
      result.runId,
      entry.sequenceNumber,
      entry.entryType,
      entry.payloadSha256,
      entry.previousEntrySha256,
      entry.entrySha256,
      JSON.stringify(entry),
    );
  }
  db.prepare("UPDATE job_receipts SET receipt_sha256=?,evidence_chain_sha256=?,receipt_json=? WHERE id=?").run(
    receiptSha256,
    preReceiptChainSha256,
    JSON.stringify(document),
    receipt.id,
  );
  db.prepare("UPDATE agent_repair_runs SET result_json=? WHERE id=?").run(
    JSON.stringify(result),
    result.runId,
  );
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

await writeFile(postflightPath, postflightContent, "utf8");
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

function request(
  generationId: string,
  startedAt: string,
  status: number,
  nonCachedInputTokens: number | null,
  cachedInputTokens: number | null,
  outputTokens: number | null,
  displayedCostUsd: number,
) {
  return {
    generationId,
    startedAt,
    status,
    nonCachedInputTokens,
    cachedInputTokens,
    inputTokens: nonCachedInputTokens === null ? null : nonCachedInputTokens + (cachedInputTokens ?? 0),
    outputTokens,
    displayedCostUsd,
  };
}

function rechain(entries: JsonRecord[]): void {
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    entry.sequenceNumber = index + 1;
    entry.previousEntrySha256 = previous;
    entry.entrySha256 = computeEvidenceLedgerEntryHash(asHashableEntry(entry));
    previous = String(entry.entrySha256);
  });
}

function asHashableEntry(entry: JsonRecord) {
  return {
    sequenceNumber: Number(entry.sequenceNumber),
    entryType: String(entry.entryType),
    sourceRecordType: String(entry.sourceRecordType),
    sourceRecordId: String(entry.sourceRecordId),
    payloadSha256: String(entry.payloadSha256),
    previousEntrySha256: entry.previousEntrySha256 === null ? null : String(entry.previousEntrySha256),
    createdAt: String(entry.createdAt),
  };
}

function requiredArtifact(artifacts: JsonRecord[], fileName: string): JsonRecord {
  const artifact = artifacts.find((candidate) => candidate.fileName === fileName);
  if (!artifact) throw new Error(`Artifact ${fileName} not found`);
  return artifact;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is not an object`);
  return value as JsonRecord;
}

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  value.forEach((item, index) => record(item, `${label}[${index}]`));
  return value as JsonRecord[];
}

async function readOptionalJson(filePath: string): Promise<JsonRecord | null> {
  try {
    return record(JSON.parse(await readFile(filePath, "utf8")), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
