import { createHash } from "node:crypto";

import { permissionScopeSchema } from "@donelayer/worker-protocol";
import { z } from "zod";

import type {
  EvidenceLedgerEntryRecord,
  EvidenceLedgerVerification,
  PublicJobReceipt,
  JobReceiptRecord,
  PermissionScope,
  TaskContractDocument,
} from "./types";

const nonEmpty = z.string().trim().min(1);

export const taskContractDocumentSchema = z.object({
  taskId: nonEmpty,
  taskType: nonEmpty,
  desiredOutcome: nonEmpty,
  deliverables: z.array(nonEmpty).min(1).max(100),
  allowedWorkflow: nonEmpty,
  allowedActions: z.array(nonEmpty).min(1).max(100),
  forbiddenActions: z.array(nonEmpty).min(1).max(100),
  acceptanceChecks: z.array(z.object({
    id: nonEmpty,
    label: nonEmpty,
    required: z.boolean(),
    type: nonEmpty,
    config: z.record(z.string(), z.unknown()),
  }).strict()).min(1).max(100),
  requiredEvidence: z.array(nonEmpty).min(1).max(100),
  budgetLimit: z.object({ currency: nonEmpty, maxAmount: z.number().nonnegative() }).strict(),
  timeLimitSeconds: z.number().int().positive().max(4 * 60 * 60),
  privacyClassification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
  humanApprovalRequirements: z.array(nonEmpty).max(100),
  failureConditions: z.array(nonEmpty).min(1).max(100),
  contractVersion: z.number().int().positive(),
}).strict();

export function parseTaskContractDocument(value: unknown): TaskContractDocument {
  return taskContractDocumentSchema.parse(value) as TaskContractDocument;
}

export function parsePermissionScope(value: unknown): PermissionScope {
  return permissionScopeSchema.parse(value);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function computeEvidenceLedgerEntryHash(entry: {
  sequenceNumber: number;
  entryType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  createdAt: string;
}): string {
  return sha256Canonical({
    sequenceNumber: entry.sequenceNumber,
    entryType: entry.entryType,
    sourceRecordType: entry.sourceRecordType,
    sourceRecordId: entry.sourceRecordId,
    payloadSha256: entry.payloadSha256,
    previousEntrySha256: entry.previousEntrySha256,
    createdAt: entry.createdAt,
  });
}

export function verifyEvidenceLedgerEntries(
  entries: EvidenceLedgerEntryRecord[],
): EvidenceLedgerVerification {
  let previous: string | null = null;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const expectedSequence = index + 1;
    if (entry.sequenceNumber !== expectedSequence) {
      return invalid(entries.length, previous, entry.sequenceNumber, "Evidence sequence is not contiguous");
    }
    if (entry.previousEntrySha256 !== previous) {
      return invalid(entries.length, previous, entry.sequenceNumber, "Previous entry hash does not match");
    }
    const expectedHash = computeEvidenceLedgerEntryHash(entry);
    if (expectedHash !== entry.entrySha256) {
      return invalid(entries.length, previous, entry.sequenceNumber, "Evidence entry hash does not match its fields");
    }
    previous = entry.entrySha256;
  }
  return {
    valid: true,
    entryCount: entries.length,
    chainSha256: previous,
    invalidSequence: null,
    reason: null,
  };
}

export function computeReceiptSha256(receipt: JobReceiptRecord["receipt"]): string {
  return sha256Canonical(receipt);
}

export function toPublicJobReceipt(
  record: JobReceiptRecord,
  entries: EvidenceLedgerEntryRecord[],
  disputed = false,
): PublicJobReceipt {
  const ledger = verifyEvidenceLedgerEntries(entries);
  const artifact = record.receipt.whatHappened.artifacts[0];
  const receiptHashValid = computeReceiptSha256(record.receipt) === record.receiptSha256;
  const resultMatchesDocument = record.result === record.receipt.finalResult;
  const documentedLedgerAnchored =
    record.receipt.howVerified.evidenceLedger.valid &&
    record.receipt.howVerified.evidenceLedger.chainSha256 === record.evidenceChainSha256;
  const receiptEntry = entries.find(
    (entry) =>
      entry.entryType === "RECEIPT_CREATED" &&
      entry.sourceRecordType === "job_receipt" &&
      entry.sourceRecordId === record.id,
  );
  const receiptEntryAnchored =
    ledger.valid &&
    entries.at(-1)?.id === receiptEntry?.id &&
    receiptEntry?.previousEntrySha256 === record.evidenceChainSha256 &&
    receiptEntry.payloadSha256 === record.receiptSha256;
  const materialization = record.receipt.whatHappened.repositoryMaterialization;
  const managedSandbox = record.receipt.whatHappened.managedSandbox;
  const buildTest = record.receipt.whatHappened.buildTest;
  const agentRepair = record.receipt.whatHappened.agentRepair;
  return {
    publicReceiptId: record.receiptPublicId,
    taskType: record.receipt.receiptType === "REPOSITORY_MATERIALIZATION_VERIFICATION"
      ? "Repository Materialization Verification"
      : record.receipt.receiptType === "MANAGED_REMOTE_SANDBOX_VERIFICATION"
        ? "Managed Remote Sandbox Verification"
        : record.receipt.receiptType === "REAL_BUILD_TEST_MANAGED_SANDBOX_VERIFICATION"
          ? "Real Build and Test Verification"
          : record.receipt.receiptType === "AGENT_REPAIR_MANAGED_SANDBOX_VERIFICATION"
            ? "Agent Repair in Managed Sandbox Verification"
          : "Worker Infrastructure Verification",
    agentIdentity: record.receipt.whoExecuted.agentPublicIdentity,
    workerIdentity: record.receipt.whoExecuted.workerPublicIdentity,
    contractSha256: record.receipt.whatWasAgreed.contractSha256,
    evidenceChainSha256: record.evidenceChainSha256,
    artifactSha256: agentRepair?.patchSha256 ?? buildTest?.sourcePackageSha256 ?? managedSandbox?.artifactSha256 ?? materialization?.artifactSha256 ?? artifact?.sha256 ?? "",
    verificationSummary: record.receipt.howVerified.checks
      .map((check) => `${check.id}: ${check.status}`)
      .join(", "),
    result: record.receipt.finalResult,
    createdAt: record.createdAt,
    verificationStatus:
      receiptHashValid &&
      receiptEntryAnchored &&
      resultMatchesDocument &&
      documentedLedgerAnchored
        ? "VALID"
        : "INVALID",
    invalidated: record.invalidatedAt !== null,
    disputed,
    ...(materialization
      ? {
          repository: {
            remoteUrl: materialization.remoteUrl,
            branch: materialization.branch,
            workerCommitSha: materialization.workerCommitSha,
            independentRemoteCommitSha: materialization.independentRemoteCommitSha,
            manifestSha256: materialization.manifestSha256,
            fileCount: materialization.fileCount,
          },
        }
      : {}),
    ...(managedSandbox
      ? {
          managedSandbox: {
            provider: managedSandbox.provider,
            sandboxIdentity: managedSandbox.providerSandboxId,
            isolationModel: managedSandbox.isolationModel,
            lifecycleMode: managedSandbox.lifecycleMode,
            runtime: managedSandbox.runtime,
            region: managedSandbox.region,
            networkPolicy: managedSandbox.networkPolicy,
            exitCode: managedSandbox.exitCode,
            networkProbeBlocked: managedSandbox.networkProbeBlocked,
            cleanupVerified: managedSandbox.cleanupVerified,
            localHostExecutionUsed: managedSandbox.localHostExecutionUsed,
            localDockerUsed: managedSandbox.localDockerUsed,
            persistentSnapshotCreated: managedSandbox.persistentSnapshotCreated,
          },
        }
      : {}),
    ...(buildTest
      ? {
          buildTest: {
            sourceManifestSha256: buildTest.sourceManifestSha256,
            sourcePackageSha256: buildTest.sourcePackageSha256,
            nodeVersion: buildTest.nodeVersion,
            npmVersion: buildTest.npmVersion,
            install: publicCommandSummary(buildTest.install),
            build: publicCommandSummary(buildTest.build),
            test: publicCommandSummary(buildTest.test),
            testRunner: buildTest.testRunner,
            totalTests: buildTest.totalTests,
            passedTests: buildTest.passedTests,
            failedTests: buildTest.failedTests,
            statisticsStatus: buildTest.statisticsStatus,
            sourceMutationDetected: buildTest.sourceMutationDetected,
            networkViolationCount: buildTest.networkViolationCount,
            permissionViolationCount: buildTest.permissionViolationCount,
            providerPayoutReleased: buildTest.providerPayoutReleased,
          },
        }
      : {}),
    ...(agentRepair ? { agentRepair: { ...agentRepair, modifiedFiles: [...agentRepair.modifiedFiles] } } : {}),
    scopeDisclaimer: record.receipt.receiptType === "REPOSITORY_MATERIALIZATION_VERIFICATION"
      ? "This receipt verifies repository materialization only. It does not verify that the repository builds, tests pass, or the software is correct."
      : record.receipt.receiptType === "MANAGED_REMOTE_SANDBOX_VERIFICATION"
        ? "This receipt verifies a platform-controlled smoke workload executed in a managed remote sandbox. It does not verify repository code, build success, test success, software correctness, or production-grade multi-tenant security."
        : record.receipt.receiptType === "REAL_BUILD_TEST_MANAGED_SANDBOX_VERIFICATION"
          ? "This receipt records a real build and test execution for the specified repository commit. The receipt is cryptographically consistent, but the task result is FAILED because one or more required automated tests did not pass."
          : record.receipt.receiptType === "AGENT_REPAIR_MANAGED_SANDBOX_VERIFICATION"
            ? "This receipt verifies a bounded Agent repair executed through Vercel AI Gateway controlled tools in one non-persistent managed Sandbox. It does not claim Git delivery or independent downstream verification."
          : "This receipt verifies a Worker infrastructure workflow. It is not a customer coding task receipt.",
  };
}

function publicCommandSummary(
  command: NonNullable<JobReceiptRecord["receipt"]["whatHappened"]["buildTest"]>["install"],
): NonNullable<PublicJobReceipt["buildTest"]>["install"] {
  return {
    command: command.command,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    status: command.status,
    stdoutArtifact: {
      fileName: command.stdoutArtifact.fileName,
      sha256: command.stdoutArtifact.sha256,
    },
    stderrArtifact: {
      fileName: command.stderrArtifact.fileName,
      sha256: command.stderrArtifact.sha256,
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new Error(`Canonical JSON does not support ${typeof value}`);
}

function invalid(
  entryCount: number,
  chainSha256: string | null,
  invalidSequence: number,
  reason: string,
): EvidenceLedgerVerification {
  return { valid: false, entryCount, chainSha256, invalidSequence, reason };
}
