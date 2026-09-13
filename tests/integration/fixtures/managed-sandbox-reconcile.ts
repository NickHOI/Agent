import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DemoStore } from "@donelayer/database";
import { MANAGED_SANDBOX_SMOKE_WORKFLOW, MANAGED_SANDBOX_TIMEOUT_WORKFLOW } from "@donelayer/worker-protocol";
import type { ManagedSandboxHandle } from "../../../apps/web/src/server/managed-sandbox/provider";
import { VercelSandboxProvider } from "../../../apps/web/src/server/managed-sandbox/vercel-provider";

const workspace = process.cwd();
const databasePath = process.env.MANAGED_SANDBOX_REALITY_DB_PATH ?? path.join(workspace, "test-results", "managed-sandbox-reality.sqlite");
const evidencePath = process.env.MANAGED_SANDBOX_REALITY_EVIDENCE_PATH ?? path.join(workspace, "test-results", "managed-sandbox-reality-evidence.json");
const previous = JSON.parse(await readFile(evidencePath, "utf8")) as Record<string, unknown>;
const store = new DemoStore(databasePath);
const provider = new VercelSandboxProvider();

try {
  const availability = await provider.checkAvailability();
  if (!availability.available) throw new Error(`${availability.errorCode}: ${availability.errorMessage}`);
  const runs = store.listManagedSandboxRuns();
  const smokeRun = runs.find((run) => store.getJobRun(run.jobRunId)?.workflowTemplate === MANAGED_SANDBOX_SMOKE_WORKFLOW);
  const timeoutRun = runs.find((run) => store.getJobRun(run.jobRunId)?.workflowTemplate === MANAGED_SANDBOX_TIMEOUT_WORKFLOW);
  if (!smokeRun?.providerSandboxId || !timeoutRun?.providerSandboxId) throw new Error("Managed Sandbox persisted runs are incomplete");

  let timeoutCleanup;
  if (timeoutRun.status === "TIMED_OUT") {
    const stopRequest = [...store.listEvidenceLedgerEntries(timeoutRun.jobRunId)].reverse().find((entry) => entry.entryType === "MANAGED_SANDBOX_STOP_REQUESTED");
    if (!stopRequest) throw new Error("Timeout stop request Evidence is missing");
    const handle: ManagedSandboxHandle = { sandboxId: timeoutRun.providerSandboxId, runId: timeoutRun.id, jobRunId: timeoutRun.jobRunId };
    timeoutCleanup = await provider.observePreviouslyStoppedSandbox(handle, stopRequest.createdAt);
    if (!timeoutCleanup.cleanupVerified) throw new Error("Previously stopped timeout Sandbox cleanup is not verified");
    store.markManagedSandboxStopped(timeoutRun.id, timeoutCleanup);
    store.completeManagedSandboxTimeout(timeoutRun.id);
  }

  const finalSmokeRun = store.getManagedSandboxRun(smokeRun.id)!;
  const finalTimeoutRun = store.getManagedSandboxRun(timeoutRun.id)!;
  const smokeJob = store.getJobRun(finalSmokeRun.jobRunId)!;
  const timeoutJob = store.getJobRun(finalTimeoutRun.jobRunId)!;
  const smoke = store.getTaskAggregate(smokeJob.taskId);
  const timeout = store.getTaskAggregate(timeoutJob.taskId);
  const proofArtifact = smoke.evidence.find((artifact) => artifact.fileName === "managed-sandbox-proof.json");
  const lifecycleArtifact = smoke.evidence.find((artifact) => artifact.fileName === "managed-sandbox-lifecycle.json");
  const cleanupArtifact = smoke.evidence.find((artifact) => artifact.fileName === "managed-sandbox-cleanup.json");
  if (!proofArtifact || !lifecycleArtifact || !cleanupArtifact || !smoke.receipt) throw new Error("Smoke Evidence is incomplete");
  const proof = JSON.parse(proofArtifact.content) as Record<string, unknown>;
  const lifecycle = JSON.parse(lifecycleArtifact.content) as Record<string, unknown>;
  const smokeCleanup = JSON.parse(cleanupArtifact.content) as Record<string, unknown>;
  const publicReceipt = store.getPublicJobReceipt(smoke.receipt.receiptPublicId);
  if (!publicReceipt) throw new Error("Public Receipt projection is missing");

  const finalEvidence = {
    gate: "MANAGED_REMOTE_SANDBOX_GATE_V1",
    capturedAt: new Date().toISOString(),
    server: previous.server,
    reconciliation: {
      pid: process.pid,
      reconciledAt: new Date().toISOString(),
      method: "read-only Vercel lifecycle observation of the already stopped timeout Sandbox; no Sandbox creation or resume",
    },
    processOutput: { stdout: "", stderr: "" },
    result: {
      kind: "result",
      availability,
      providerMetadata: provider.getProviderMetadata(),
      smoke: {
        task: { id: smoke.task.id, type: smoke.task.taskType, status: smoke.task.status },
        contract: smoke.taskContract,
        permissionLease: smoke.permissionLease,
        jobRun: smoke.jobRun,
        sandboxRun: finalSmokeRun,
        providerInspection: finalSmokeRun.providerMetadata.createInspection,
        command: lifecycle.command,
        proof,
        proofClaimedSha256: proofArtifact.claimedSha256,
        proofServerSha256: proofArtifact.serverSha256,
        artifacts: smoke.evidence.filter((artifact) => artifact.sandboxRunId === finalSmokeRun.id).map((artifact) => ({
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
        providerStdout: smoke.evidence.find((artifact) => artifact.fileName === "managed-sandbox-stdout.log")?.content ?? "",
        providerStderr: smoke.evidence.find((artifact) => artifact.fileName === "managed-sandbox-stderr.log")?.content ?? "",
        ledgerEntries: smoke.evidenceLedger,
        ledgerVerification: smoke.evidenceLedgerVerification,
        verificationResults: smoke.verificationResults,
        cleanup: smokeCleanup,
        receipt: {
          id: smoke.receipt.id,
          publicReceiptId: smoke.receipt.receiptPublicId,
          receiptSha256: smoke.receipt.receiptSha256,
          evidenceChainSha256: smoke.receipt.evidenceChainSha256,
          result: smoke.receipt.result,
          document: smoke.receipt.receipt,
          createdAt: smoke.receipt.createdAt,
        },
        publicReceipt,
      },
      timeout: {
        task: { id: timeout.task.id, type: timeout.task.taskType, status: timeout.task.status },
        contract: timeout.taskContract,
        permissionLease: timeout.permissionLease,
        jobRun: timeout.jobRun,
        sandboxRun: finalTimeoutRun,
        providerInspection: finalTimeoutRun.providerMetadata.createInspection,
        cleanup: timeoutCleanup ?? {
          sandboxId: finalTimeoutRun.providerSandboxId,
          stopRequestedAt: [...store.listEvidenceLedgerEntries(finalTimeoutRun.jobRunId)].reverse().find((entry) => entry.entryType === "MANAGED_SANDBOX_STOP_REQUESTED")?.createdAt,
          stopConfirmedAt: finalTimeoutRun.stoppedAt,
          finalProviderState: finalTimeoutRun.providerMetadata.finalProviderState,
          cleanupVerified: finalTimeoutRun.cleanupVerifiedAt !== null,
        },
        timeoutAt: finalTimeoutRun.finishedAt,
        timeoutEvidence: finalTimeoutRun.failureMessage,
        ledgerEntries: timeout.evidenceLedger,
        ledgerVerification: timeout.evidenceLedgerVerification,
        receiptCreated: timeout.receipt !== null,
      },
    },
  };
  const serialized = JSON.stringify(finalEvidence, null, 2);
  if (/VERCEL_OIDC_TOKEN|Bearer\s+[A-Za-z0-9._-]+|C:\\Users\\user/i.test(serialized)) {
    throw new Error("Sensitive local or credential data reached the Managed Sandbox Evidence export");
  }
  await writeFile(evidencePath, `${serialized}\n`, "utf8");
  console.log(JSON.stringify({
    smokeTaskState: smoke.task.status,
    smokeReceiptResult: smoke.receipt.result,
    timeoutTaskState: timeout.task.status,
    timeoutReceiptCreated: timeout.receipt !== null,
    timeoutCleanupVerified: finalTimeoutRun.cleanupVerifiedAt !== null,
    evidencePath,
  }, null, 2));
} finally {
  store.close();
}
