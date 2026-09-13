import { hostname, platform, release } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { AgentRepairOrchestrator } from "../../../apps/web/src/server/agent-execution/agent-repair-orchestrator";
import { VercelAIGatewayAgentProvider } from "../../../apps/web/src/server/agent-execution/vercel-ai-gateway-provider";

type RunRequest = { kind: "run" };
type ShutdownRequest = { kind: "shutdown" };

const databasePath = process.env.AGENT_REPAIR_REALITY_DB_PATH;
if (!databasePath) throw new Error("AGENT_REPAIR_REALITY_DB_PATH is required");

const provider = new VercelAIGatewayAgentProvider();
const orchestrator = new AgentRepairOrchestrator(provider);

process.on("message", (message: unknown) => {
  if (!message || typeof message !== "object") return;
  if ((message as RunRequest).kind === "run") void runGate();
  if ((message as ShutdownRequest).kind === "shutdown") process.exit(0);
});
process.once("SIGTERM", () => process.exit(0));
process.once("SIGINT", () => process.exit(0));

send({
  kind: "ready",
  pid: process.pid,
  startedAt: new Date().toISOString(),
  host: hostname(),
  os: `${platform()} ${release()}`,
  nodeVersion: process.version,
});

async function runGate(): Promise<void> {
  try {
    const outcome = await orchestrator.run();
    persistOutcome(outcome);
    send({
      kind: "result",
      completedAt: new Date().toISOString(),
      ...outcome,
      artifacts: outcome.artifacts.map(({ content: _content, ...artifact }) => artifact),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({
      kind: "error",
      errorCode: /temporarily unavailable/i.test(message)
        ? "AI_GATEWAY_TEMPORARY_UNAVAILABLE"
        : "AGENT_REPAIR_GATE_FAILED",
      message: message.replace(/C:\\Users\\[^\\\s]+/gi, "[LOCAL_HOME]").slice(0, 500),
      stack: null,
      completedAt: new Date().toISOString(),
    });
  }
}

function persistOutcome(outcome: Awaited<ReturnType<AgentRepairOrchestrator["run"]>>): void {
  const db = new DatabaseSync(databasePath!);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE agent_repair_runs (
        id TEXT PRIMARY KEY,
        job_run_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        status TEXT NOT NULL,
        model_id TEXT NOT NULL,
        sandbox_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE evidence_artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        content BLOB NOT NULL
      );
      CREATE TABLE evidence_ledger (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        previous_entry_sha256 TEXT,
        entry_sha256 TEXT NOT NULL,
        entry_json TEXT NOT NULL
      );
      CREATE TABLE job_receipts (
        id TEXT PRIMARY KEY,
        public_receipt_id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        result TEXT NOT NULL,
        receipt_sha256 TEXT NOT NULL,
        evidence_chain_sha256 TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const safeOutcome = { ...outcome, artifacts: outcome.artifacts.map(({ content: _content, ...artifact }) => artifact) };
    db.prepare("INSERT INTO agent_repair_runs VALUES(?,?,?,?,?,?,?,?)").run(
      outcome.runId,
      outcome.jobRunId,
      outcome.gate,
      outcome.status,
      outcome.preflight.selectedModel.id,
      outcome.sandbox.sandboxId,
      JSON.stringify(safeOutcome),
      outcome.receipt.document.issuedAt,
    );
    const insertArtifact = db.prepare("INSERT INTO evidence_artifacts VALUES(?,?,?,?,?,?,?)");
    for (const artifact of outcome.artifacts) {
      insertArtifact.run(artifact.id, outcome.runId, artifact.fileName, artifact.mimeType, artifact.size, artifact.sha256, Buffer.from(artifact.content, "utf8"));
    }
    const insertLedger = db.prepare("INSERT INTO evidence_ledger VALUES(?,?,?,?,?,?,?,?)");
    for (const entry of outcome.ledgerEntries) {
      insertLedger.run(entry.id, outcome.runId, entry.sequenceNumber, entry.entryType, entry.payloadSha256, entry.previousEntrySha256, entry.entrySha256, JSON.stringify(entry));
    }
    db.prepare("INSERT INTO job_receipts VALUES(?,?,?,?,?,?,?,?)").run(
      outcome.receipt.id,
      outcome.receipt.publicReceiptId,
      outcome.runId,
      outcome.receipt.result,
      outcome.receipt.receiptSha256,
      outcome.receipt.evidenceChainSha256,
      JSON.stringify(outcome.receipt.document),
      outcome.receipt.document.issuedAt,
    );
  } finally {
    db.close();
  }
}

function send(message: unknown): void {
  process.send?.(message);
}
