import { hostname, platform, release } from "node:os";

import { DemoStore } from "@donelayer/database";
import { ManagedSandboxOrchestrator } from "../../../apps/web/src/server/managed-sandbox/orchestrator";
import { VercelSandboxProvider } from "../../../apps/web/src/server/managed-sandbox/vercel-provider";

type RunRequest = { kind: "run" };
type ShutdownRequest = { kind: "shutdown" };

const databasePath = process.env.MANAGED_BUILD_TEST_REALITY_DB_PATH;
if (!databasePath) throw new Error("MANAGED_BUILD_TEST_REALITY_DB_PATH is required");

const store = new DemoStore(databasePath);
const provider = new VercelSandboxProvider();
const orchestrator = new ManagedSandboxOrchestrator(store, provider);

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
  startedAt: new Date().toISOString(),
  host: hostname(),
  os: `${platform()} ${release()}`,
  nodeVersion: process.version,
});

async function runGate(): Promise<void> {
  try {
    const outcome = await orchestrator.runBuildTest();
    send({
      kind: "result",
      completedAt: new Date().toISOString(),
      providerMetadata: provider.getProviderMetadata(),
      task: {
        id: outcome.aggregate.task.id,
        type: outcome.aggregate.task.taskType,
        status: outcome.aggregate.task.status,
      },
      contract: outcome.aggregate.taskContract,
      permissionLease: outcome.aggregate.permissionLease,
      jobRun: outcome.aggregate.jobRun,
      sandboxRun: outcome.sandboxRun,
      source: {
        remoteUrl: outcome.source.repositoryManifest.remoteUrl,
        branch: outcome.source.repositoryManifest.branch,
        materializerCommitSha: outcome.source.materializerCommitSha,
        independentRemoteCommitSha: outcome.source.independentRemoteCommitSha,
        sourceFileCount: outcome.source.sourceFileCount,
        repositoryManifestSha256: outcome.source.repositoryManifestSha256,
        sourcePackageManifestSha256: outcome.source.sourcePackageManifestSha256,
        sourcePackageSha256: outcome.source.sourcePackageSha256,
        sourcePackageBytes: outcome.source.sourcePackageBytes.byteLength,
        buildScriptPresent: outcome.source.buildScriptPresent,
        installLifecycleScriptsPresent: outcome.source.installLifecycleScriptsPresent,
        clone: outcome.source.clone,
        remoteVerifiedAt: outcome.source.remoteVerifiedAt,
        materializerWorkspaceCleaned: outcome.source.materializerWorkspaceCleaned,
        files: outcome.source.repositoryManifest.files,
      },
      providerInspection: outcome.createdInspection,
      installNetworkPolicy: outcome.installNetworkPolicy,
      finalNetworkPolicy: outcome.finalNetworkPolicy,
      sourceVerification: outcome.sourceVerification,
      install: outcome.install,
      build: outcome.build,
      test: outcome.test,
      sourceIntegrity: outcome.sourceIntegrity,
      cleanup: outcome.cleanup,
      artifacts: outcome.artifacts.map((artifact) => ({
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
      ledgerEntries: outcome.aggregate.evidenceLedger,
      ledgerVerification: outcome.aggregate.evidenceLedgerVerification,
      verificationResults: outcome.aggregate.verificationResults,
      testLedgerEntries: outcome.aggregate.ledgerEntries,
      receipt: {
        id: outcome.receipt.id,
        publicReceiptId: outcome.receipt.receiptPublicId,
        receiptSha256: outcome.receipt.receiptSha256,
        evidenceChainSha256: outcome.receipt.evidenceChainSha256,
        result: outcome.receipt.result,
        document: outcome.receipt.receipt,
        createdAt: outcome.receipt.createdAt,
      },
      publicReceipt: outcome.publicReceipt,
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
