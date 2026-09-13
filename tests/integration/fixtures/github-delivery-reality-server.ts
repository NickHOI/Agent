import { hostname, platform, release } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import { GitHubDeliveryOrchestrator } from "../../../apps/web/src/server/git-delivery/delivery-orchestrator";
import { GitHubCliGitDeliveryProvider } from "../../../apps/web/src/server/git-delivery/github-cli-provider";

const databasePath = process.env.GITHUB_DELIVERY_REALITY_DB_PATH;
if (!databasePath) throw new Error("GITHUB_DELIVERY_REALITY_DB_PATH is required");

const orchestrator = new GitHubDeliveryOrchestrator(new GitHubCliGitDeliveryProvider());

process.on("message", (message: unknown) => {
  if (!message || typeof message !== "object") return;
  const kind = (message as { kind?: unknown }).kind;
  if (kind === "run") void runGate();
  if (kind === "shutdown") process.exit(0);
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
  aiModelsEnabled: false,
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
    send({
      kind: "error",
      errorCode: "GITHUB_DELIVERY_GATE_PROCESS_FAILED",
      message: sanitize(error instanceof Error ? error.message : String(error)),
      stack: null,
      completedAt: new Date().toISOString(),
    });
  }
}

function persistOutcome(outcome: Awaited<ReturnType<GitHubDeliveryOrchestrator["run"]>>): void {
  const database = new DatabaseSync(databasePath!);
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE github_delivery_runs (
        id TEXT PRIMARY KEY,
        job_run_id TEXT NOT NULL,
        gate TEXT NOT NULL,
        status TEXT NOT NULL,
        failure_code TEXT,
        delivery_branch TEXT NOT NULL,
        delivery_commit_sha TEXT,
        pull_request_number INTEGER,
        verification_sandbox_id TEXT,
        ai_call_count INTEGER NOT NULL CHECK(ai_call_count = 0),
        ai_gateway_usage_usd REAL NOT NULL CHECK(ai_gateway_usage_usd = 0),
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE task_contracts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        contract_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status = 'LOCKED'),
        contract_sha256 TEXT NOT NULL,
        contract_json TEXT NOT NULL
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
        entry_json TEXT NOT NULL,
        UNIQUE(run_id, sequence_number)
      );
      CREATE TABLE job_receipts (
        id TEXT PRIMARY KEY,
        public_receipt_id TEXT NOT NULL UNIQUE,
        run_id TEXT NOT NULL,
        result TEXT NOT NULL,
        receipt_sha256 TEXT NOT NULL,
        evidence_chain_sha256 TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        public_receipt_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE test_ledger_entries (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        state TEXT NOT NULL,
        customer_charge_cents INTEGER NOT NULL,
        provider_payout_cents INTEGER NOT NULL,
        platform_fee_cents INTEGER NOT NULL,
        receipt_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const safeOutcome = { ...outcome, artifacts: outcome.artifacts.map(({ content: _content, ...artifact }) => artifact) };
    database.prepare("INSERT INTO github_delivery_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      outcome.runId,
      outcome.jobRunId,
      outcome.gate,
      outcome.status,
      outcome.failureCode,
      outcome.deliveryBranch,
      outcome.localCommit?.commitSha ?? null,
      outcome.pullRequest?.number ?? null,
      outcome.independentVerification?.sandbox.sandboxId ?? null,
      outcome.aiCallCount,
      outcome.aiGatewayUsageUsd,
      JSON.stringify(safeOutcome),
      outcome.receipt.document.issuedAt,
    );
    database.prepare("INSERT INTO task_contracts VALUES(?,?,?,?,?,?)").run(
      outcome.contract.taskId,
      outcome.runId,
      outcome.contract.contractType,
      outcome.contract.status,
      outcome.contractSha256,
      JSON.stringify(outcome.contract),
    );
    const insertArtifact = database.prepare("INSERT INTO evidence_artifacts VALUES(?,?,?,?,?,?,?)");
    for (const artifact of outcome.artifacts) {
      insertArtifact.run(
        artifact.id,
        outcome.runId,
        artifact.fileName,
        artifact.mimeType,
        artifact.size,
        artifact.sha256,
        Buffer.from(artifact.content, "utf8"),
      );
    }
    const insertLedger = database.prepare("INSERT INTO evidence_ledger VALUES(?,?,?,?,?,?,?,?)");
    for (const entry of outcome.ledgerEntries) {
      insertLedger.run(
        entry.id,
        outcome.runId,
        entry.sequenceNumber,
        entry.entryType,
        entry.payloadSha256,
        entry.previousEntrySha256,
        entry.entrySha256,
        JSON.stringify(entry),
      );
    }
    database.prepare("INSERT INTO job_receipts VALUES(?,?,?,?,?,?,?,?,?)").run(
      outcome.receipt.id,
      outcome.receipt.publicReceiptId,
      outcome.runId,
      outcome.receipt.result,
      outcome.receipt.receiptSha256,
      outcome.receipt.evidenceChainSha256,
      JSON.stringify(outcome.receipt.document),
      JSON.stringify(outcome.publicReceipt),
      outcome.receipt.document.issuedAt,
    );
    database.prepare("INSERT INTO test_ledger_entries VALUES(?,?,?,?,?,?,?,?)").run(
      randomUUID(),
      outcome.runId,
      outcome.payment.state,
      outcome.payment.customerChargeCents,
      outcome.payment.providerPayoutCents,
      outcome.payment.platformFeeCents,
      outcome.payment.authorizingReceiptId,
      outcome.payment.releasedAt ?? outcome.receipt.document.issuedAt,
    );
  } finally {
    database.close();
  }
}

function sanitize(value: string): string {
  return value
    .replace(/(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "[LOCAL_HOME]")
    .slice(0, 500);
}

function send(message: unknown): void {
  process.send?.(message);
}
