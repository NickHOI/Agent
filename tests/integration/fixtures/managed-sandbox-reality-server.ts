import { hostname, platform, release } from "node:os";

import { DemoStore } from "@donelayer/database";
import { ManagedSandboxOrchestrator } from "../../../apps/web/src/server/managed-sandbox/orchestrator";
import { VercelSandboxProvider } from "../../../apps/web/src/server/managed-sandbox/vercel-provider";

type RunRequest = { kind: "run" };
type ShutdownRequest = { kind: "shutdown" };

const databasePath = process.env.MANAGED_SANDBOX_REALITY_DB_PATH;
if (!databasePath) throw new Error("MANAGED_SANDBOX_REALITY_DB_PATH is required");

const store = new DemoStore(databasePath);
const provider = new VercelSandboxProvider();
const orchestrator = new ManagedSandboxOrchestrator(store, provider);
const serverStartedAt = new Date().toISOString();

process.on("message", (message: unknown) => {
  if (!message || typeof message !== "object") return;
  if ((message as RunRequest).kind === "run") void runGate();
  if ((message as ShutdownRequest).kind === "shutdown") shutdown();
});

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

send({
  kind: "ready",
  pid: process.pid,
  startedAt: serverStartedAt,
  host: hostname(),
  os: `${platform()} ${release()}`,
  nodeVersion: process.version,
});

async function runGate(): Promise<void> {
  try {
    const availability = await orchestrator.checkAvailability();
    if (!availability.available) throw new Error(`${availability.errorCode}: ${availability.errorMessage}`);
    const smoke = await orchestrator.runSmoke();
    const timeout = await orchestrator.runTimeoutProbe();
    send({
      kind: "result",
      completedAt: new Date().toISOString(),
      availability,
      providerMetadata: provider.getProviderMetadata(),
      smoke: {
        task: {
          id: smoke.aggregate.task.id,
          type: smoke.aggregate.task.taskType,
          status: smoke.aggregate.task.status,
        },
        contract: smoke.aggregate.taskContract,
        permissionLease: smoke.aggregate.permissionLease,
        jobRun: smoke.aggregate.jobRun,
        sandboxRun: smoke.sandboxRun,
        providerInspection: smoke.createdInspection,
        command: smoke.command,
        proof: smoke.proof,
        proofClaimedSha256: smoke.proofClaimedSha256,
        proofServerSha256: smoke.proofServerSha256,
        artifacts: smoke.artifacts.map((artifact) => ({
          id: artifact.id,
          jobRunId: artifact.jobRunId,
          workerId: artifact.workerId,
          sandboxRunId: artifact.sandboxRunId,
          artifactType: artifact.artifactType,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.size,
          claimedSha256: artifact.claimedSha256,
          serverSha256: artifact.serverSha256,
          createdAt: artifact.createdAt,
        })),
        ledgerEntries: smoke.aggregate.evidenceLedger,
        ledgerVerification: smoke.aggregate.evidenceLedgerVerification,
        verificationResults: smoke.aggregate.verificationResults,
        cleanup: smoke.cleanup,
        receipt: {
          id: smoke.receipt.id,
          publicReceiptId: smoke.receipt.receiptPublicId,
          receiptSha256: smoke.receipt.receiptSha256,
          evidenceChainSha256: smoke.receipt.evidenceChainSha256,
          result: smoke.receipt.result,
          document: smoke.receipt.receipt,
          createdAt: smoke.receipt.createdAt,
        },
        publicReceipt: smoke.publicReceipt,
      },
      timeout: {
        task: {
          id: timeout.aggregate.task.id,
          type: timeout.aggregate.task.taskType,
          status: timeout.aggregate.task.status,
        },
        contract: timeout.aggregate.taskContract,
        permissionLease: timeout.aggregate.permissionLease,
        jobRun: timeout.aggregate.jobRun,
        sandboxRun: timeout.sandboxRun,
        providerInspection: timeout.createdInspection,
        cleanup: timeout.cleanup,
        timeoutAt: timeout.timeoutAt,
        timeoutEvidence: timeout.timeoutEvidence,
        ledgerEntries: timeout.aggregate.evidenceLedger,
        ledgerVerification: timeout.aggregate.evidenceLedgerVerification,
        receiptCreated: timeout.aggregate.receipt !== null,
      },
    });
  } catch (error) {
    send({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      completedAt: new Date().toISOString(),
    });
  }
}

function shutdown(): void {
  store.close();
  process.exit(0);
}

function send(message: unknown): void {
  process.send?.(message);
}
