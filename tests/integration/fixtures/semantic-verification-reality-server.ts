import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname, platform, release } from "node:os";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { REPOSITORY_MATERIALIZATION_BRANCH, REAL_SOURCE_BUG_FIXTURE_BRANCH } from "@donelayer/worker-protocol";

import { AgentRepairOrchestrator } from "../../../apps/web/src/server/agent-execution/agent-repair-orchestrator";
import { VercelAIGatewayAgentProvider } from "../../../apps/web/src/server/agent-execution/vercel-ai-gateway-provider";
import { GitHubCliGitDeliveryProvider } from "../../../apps/web/src/server/git-delivery/github-cli-provider";
import { readGatePublicReceipt } from "../../../apps/web/src/server/gate-public-receipt";
import { SemanticDeliveryOrchestrator } from "../../../apps/web/src/server/semantic-verification/semantic-delivery-orchestrator";
import { VERIFIED_WORK_CONTRACT_GATE } from "../../../apps/web/src/server/semantic-verification/semantic-contract";
import { historicalReceiptSupersession, reviewSemanticContract } from "../../../apps/web/src/server/semantic-verification/semantic-review";
import { materializeSemanticSourcePreflight } from "../../../apps/web/src/server/semantic-verification/semantic-source";
import {
  decideTaskScopedAuthority,
  issueTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_AGENT_ID,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
} from "../../../apps/web/src/server/task-scoped-authority/task-scoped-authority";

const databasePath = requiredEnvironment("SEMANTIC_VERIFICATION_REALITY_DB_PATH");
const trueFixtureCommit = requiredCommit(requiredEnvironment("SEMANTIC_TRUE_FIXTURE_COMMIT"));
const workspaceRoot = process.cwd();
const historicalEvidencePath = path.join(workspaceRoot, "test-results", "github-delivery-independent-verify-evidence.json");

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
  doneLayerIdentity: {
    headCommit: process.env.SEMANTIC_DONELAYER_HEAD_COMMIT ?? "UNRECORDED",
    workingTreeSha256: process.env.SEMANTIC_DONELAYER_WORKTREE_SHA256 ?? "UNRECORDED",
  },
});

async function runGate(): Promise<void> {
  try {
    const original = await materializeSemanticSourcePreflight({
      branch: REPOSITORY_MATERIALIZATION_BRANCH,
      expectedCommitSha: "600f326ce373160eb5495aaef72230d4c9807e8f",
      taskId: "semantic-conflict-review-v1",
    });
    const conflict = reviewSemanticContract({ contract: original.contract, files: original.files });
    if (conflict.status !== "SPEC_TEST_CONFLICT" || conflict.agentCallCount !== 0 || conflict.sandboxRepairAttemptCount !== 0) {
      throw new Error("SPEC_TEST_CONFLICT_PRECONDITION_FAILED");
    }

    const historicalEvidence = record(JSON.parse(readFileSync(historicalEvidencePath, "utf8")), "historical evidence");
    const historicalResult = record(historicalEvidence.result, "historical result");
    const historicalReceipt = record(historicalResult.receipt, "historical Receipt");
    const historicalPublicId = requiredString(historicalReceipt.publicReceiptId, "historical public Receipt ID");
    process.env.DONELAYER_GATE_RECEIPT_EVIDENCE_PATH = historicalEvidencePath;
    const verifiedHistoricalPublicReceipt = readGatePublicReceipt(historicalPublicId);
    if (!verifiedHistoricalPublicReceipt || verifiedHistoricalPublicReceipt.verificationStatus !== "VALID") {
      throw new Error("HISTORICAL_RECEIPT_INTEGRITY_INVALID");
    }
    const historicalReview = reviewSemanticContract({
      contract: original.contract,
      files: original.files,
      repositoryTests: "PASSED",
      deliveryIntegrity: "VALID",
      historicalReceipt: historicalReceiptSupersession({
        receiptId: requiredString(historicalReceipt.id, "historical Receipt ID"),
        publicReceiptId: historicalPublicId,
        receiptSha256: requiredDigest(historicalReceipt.receiptSha256, "historical Receipt SHA-256"),
        evidenceChainSha256: requiredDigest(historicalReceipt.evidenceChainSha256, "historical Evidence chain SHA-256"),
      }),
    });

    const trueFixture = await materializeSemanticSourcePreflight({
      branch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
      expectedCommitSha: trueFixtureCommit,
      taskId: "semantic-true-source-bug-repair-v1",
    });
    if (trueFixture.inspection.outcome !== "CONTRACT_VERIFIED") throw new Error(`TRUE_FIXTURE_${trueFixture.inspection.outcome}`);
    const packageJson = JSON.parse(requiredFile(trueFixture.files, "package.json")) as { scripts?: { test?: unknown } };
    if (typeof packageJson.scripts?.test !== "string" || !packageJson.scripts.test.trim()) throw new Error("TRUE_FIXTURE_TEST_SCRIPT_INVALID");

    const authorityDecidedAt = new Date().toISOString();
    const authorityLease = issueTaskScopedPermissionLease(decideTaskScopedAuthority({
      contract: trueFixture.contract,
      subject: {
        agentId: TASK_SCOPED_AUTHORITY_AGENT_ID,
        executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
        jobRunId: randomUUID(),
      },
      durationSeconds: 600,
      decidedAt: authorityDecidedAt,
      approvals: [{
        action: "create_pull_request",
        decisionId: `owner-authority-gate-${randomUUID()}`,
        approverType: "OWNER",
        approverId: "owner-review",
        approvedAt: authorityDecidedAt,
      }],
    }));

    const repair = await new AgentRepairOrchestrator(new VercelAIGatewayAgentProvider()).run({
      branch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
      expectedCommitSha: trueFixtureCommit,
      semanticContract: trueFixture.contract,
      authorityLease,
    });
    if (repair.status !== "VERIFIED" || repair.receipt.result !== "CONTRACT_VERIFIED") {
      throw new Error("TRUE_FIXTURE_REPAIR_NOT_CONTRACT_VERIFIED");
    }
    const delivery = await new SemanticDeliveryOrchestrator(new GitHubCliGitDeliveryProvider()).run({
      repair,
      contract: trueFixture.contract,
      baseManifest: trueFixture.source.repositoryManifest,
      expectedTestScript: packageJson.scripts.test,
      authorityLease,
    });
    if (delivery.status !== "CONTRACT_VERIFIED_DELIVERY") {
      throw new Error(`${delivery.failureCode ?? "SEMANTIC_DELIVERY_FAILED"}: ${JSON.stringify(delivery.receipt.document.failure ?? null)}`);
    }

    const outcome = {
      conflict,
      historicalReview,
      trueFixture: {
        branch: trueFixture.source.identity.branch,
        commitSha: trueFixture.source.materializerCommitSha,
        independentRemoteCommitSha: trueFixture.source.independentRemoteCommitSha,
        sourceManifestSha256: trueFixture.source.repositoryManifestSha256,
        sourcePackageSha256: trueFixture.source.sourcePackageSha256,
        sourceFiles: trueFixture.source.repositoryManifest.files,
        contract: trueFixture.contract,
        inspection: trueFixture.inspection,
      },
      repair,
      delivery,
    };
    persistOutcome(outcome);
    send({ kind: "result", gate: VERIFIED_WORK_CONTRACT_GATE, completedAt: new Date().toISOString(), ...serializableOutcome(outcome) });
  } catch (error) {
    send({
      kind: "error",
      errorCode: classifyError(error),
      message: sanitize(error instanceof Error ? error.message : String(error)),
      stack: null,
      completedAt: new Date().toISOString(),
    });
  }
}

function persistOutcome(outcome: {
  conflict: ReturnType<typeof reviewSemanticContract>;
  historicalReview: ReturnType<typeof reviewSemanticContract>;
  trueFixture: Awaited<ReturnType<typeof materializeSemanticSourcePreflight>> extends infer _T ? Record<string, unknown> : never;
  repair: Awaited<ReturnType<AgentRepairOrchestrator["run"]>>;
  delivery: Awaited<ReturnType<SemanticDeliveryOrchestrator["run"]>>;
}): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE semantic_gate_runs (
        id TEXT PRIMARY KEY,
        gate TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_call_count INTEGER NOT NULL,
        sandbox_repair_attempt_count INTEGER NOT NULL,
        payout_released INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE task_contracts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status='LOCKED'),
        contract_sha256 TEXT NOT NULL,
        assertions_sha256 TEXT NOT NULL,
        contract_json TEXT NOT NULL
      );
      CREATE TABLE evidence_ledger (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence_number INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
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
        created_at TEXT NOT NULL
      );
      CREATE TABLE receipt_semantic_reviews (
        id TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL,
        review_contract_sha256 TEXT NOT NULL,
        outcome TEXT NOT NULL,
        overall_status TEXT NOT NULL,
        evidence_chain_sha256 TEXT NOT NULL,
        review_json TEXT NOT NULL,
        review_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TRIGGER receipt_semantic_reviews_no_update BEFORE UPDATE ON receipt_semantic_reviews BEGIN
        SELECT RAISE(ABORT, 'Receipt semantic reviews are append-only');
      END;
      CREATE TRIGGER receipt_semantic_reviews_no_delete BEFORE DELETE ON receipt_semantic_reviews BEGIN
        SELECT RAISE(ABORT, 'Receipt semantic reviews are append-only');
      END;
      CREATE TABLE test_ledger_entries (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        state TEXT NOT NULL,
        provider_payout_cents INTEGER NOT NULL,
        platform_fee_cents INTEGER NOT NULL,
        receipt_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    insertReview(database, outcome.conflict, "CONFLICT");
    insertReview(database, outcome.historicalReview, "HISTORICAL_REASSESSMENT");
    const repairJson = stripArtifactContent(outcome.repair);
    database.prepare("INSERT INTO semantic_gate_runs VALUES(?,?,?,?,?,?,?,?)").run(
      outcome.repair.runId,
      outcome.repair.gate,
      outcome.repair.receipt.result,
      outcome.repair.agentRun.usage.apiRequestCount,
      1,
      0,
      JSON.stringify(repairJson),
      outcome.repair.receipt.document.issuedAt,
    );
    insertLedger(database, outcome.repair.runId, outcome.repair.ledgerEntries);
    insertReceipt(database, outcome.repair.runId, outcome.repair.receipt);
    const deliveryJson = stripArtifactContent({ ...outcome.delivery, repair: { receipt: outcome.repair.receipt, patch: outcome.repair.patch } });
    database.prepare("INSERT INTO semantic_gate_runs VALUES(?,?,?,?,?,?,?,?)").run(
      outcome.delivery.runId,
      outcome.delivery.gate,
      outcome.delivery.status,
      0,
      0,
      outcome.delivery.payment.state === "RELEASED" ? 1 : 0,
      JSON.stringify(deliveryJson),
      String(outcome.delivery.receipt.document.issuedAt),
    );
    insertLedger(database, outcome.delivery.runId, outcome.delivery.ledgerEntries);
    insertReceipt(database, outcome.delivery.runId, outcome.delivery.receipt);
    database.prepare("INSERT INTO test_ledger_entries VALUES(?,?,?,?,?,?,?)").run(
      `ledger-${outcome.delivery.runId}`,
      outcome.delivery.runId,
      outcome.delivery.payment.state,
      outcome.delivery.payment.providerPayoutCents,
      outcome.delivery.payment.platformFeeCents,
      outcome.delivery.receipt.id,
      String(outcome.delivery.receipt.document.issuedAt),
    );
  } finally {
    database.close();
  }
}

function insertReview(database: DatabaseSync, review: ReturnType<typeof reviewSemanticContract>, kind: string): void {
  database.prepare("INSERT INTO semantic_gate_runs VALUES(?,?,?,?,?,?,?,?)").run(
    review.runId,
    `${review.gate}:${kind}`,
    review.receipt.document.semanticVerification.overall,
    review.agentCallCount,
    review.sandboxRepairAttemptCount,
    0,
    JSON.stringify(review),
    review.receipt.document.issuedAt,
  );
  database.prepare("INSERT INTO task_contracts VALUES(?,?,?,?,?,?)").run(
    `${kind}-${review.contract.taskId}`,
    review.runId,
    review.contract.status,
    review.contractSha256,
    review.contract.assertionsSha256,
    JSON.stringify(review.contract),
  );
  insertLedger(database, review.runId, review.ledgerEntries);
  insertReceipt(database, review.runId, review.receipt);
  const historical = review.receipt.document.historicalReceipt;
  if (historical) {
    const document = review.receipt.document;
    database.prepare("INSERT INTO receipt_semantic_reviews VALUES(?,?,?,?,?,?,?,?,?)").run(
      `review-${review.runId}`,
      historical.receiptId,
      review.contractSha256,
      document.finalResult,
      document.semanticVerification.overall,
      review.receipt.evidenceChainSha256,
      JSON.stringify(document),
      review.receipt.receiptSha256,
      document.issuedAt,
    );
  }
}

function insertLedger(database: DatabaseSync, runId: string, entries: Array<Record<string, unknown>> | Array<{ id: string; sequenceNumber: number; entryType: string; previousEntrySha256: string | null; entrySha256: string }>): void {
  const statement = database.prepare("INSERT INTO evidence_ledger VALUES(?,?,?,?,?,?,?)");
  for (const raw of entries) {
    const entry = raw as Record<string, unknown>;
    statement.run(
      String(entry.id),
      runId,
      Number(entry.sequenceNumber),
      String(entry.entryType),
      entry.previousEntrySha256 === null ? null : String(entry.previousEntrySha256),
      String(entry.entrySha256),
      JSON.stringify(entry),
    );
  }
}

function insertReceipt(database: DatabaseSync, runId: string, rawReceipt: { id: string; publicReceiptId: string; result: string; receiptSha256: string; evidenceChainSha256: string; document: unknown }): void {
  const document = record(rawReceipt.document, "Receipt document");
  database.prepare("INSERT INTO job_receipts VALUES(?,?,?,?,?,?,?,?)").run(
    rawReceipt.id,
    rawReceipt.publicReceiptId,
    runId,
    rawReceipt.result,
    rawReceipt.receiptSha256,
    rawReceipt.evidenceChainSha256,
    JSON.stringify(rawReceipt.document),
    String(document.issuedAt),
  );
}

function serializableOutcome(outcome: Record<string, unknown>): Record<string, unknown> {
  const value = stripArtifactContent(outcome) as Record<string, unknown>;
  const delivery = record(value.delivery, "delivery");
  delivery.repair = { receipt: record(value.repair, "repair").receipt };
  return value;
}

function stripArtifactContent<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "content" ? undefined : item)) as T;
}

function requiredFile(files: Array<{ filePath: string; content: string }>, filePath: string): string {
  const found = files.find((file) => file.filePath === filePath);
  if (!found) throw new Error(`Required Fixture file is missing: ${filePath}`);
  return found.content;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  const digest = requiredString(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} is invalid`);
  return digest;
}

function requiredCommit(value: string): string {
  const commit = value.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("SEMANTIC_TRUE_FIXTURE_COMMIT is invalid");
  return commit;
}

function classifyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/AI_GATEWAY_FREE_USAGE_UNAVAILABLE/.test(message)) return "AI_GATEWAY_FREE_USAGE_UNAVAILABLE";
  if (/VERCEL.*(?:AUTH|OIDC)|AUTHENTICATION|UNAUTHORIZED/i.test(message)) return "AUTHENTICATION_BLOCKED";
  if (/BILLING|CREDIT|PAYMENT_REQUIRED/i.test(message)) return "BILLING_BLOCKED";
  if (/GITHUB.*AUTH/i.test(message)) return "GITHUB_AUTHENTICATION_BLOCKED";
  return "SEMANTIC_VERIFICATION_GATE_FAILED";
}

function sanitize(value: string): string {
  return value
    .replace(/(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "[LOCAL_HOME]")
    .slice(0, 1_000);
}

function send(message: unknown): void { process.send?.(message); }
