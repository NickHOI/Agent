import { randomBytes, randomUUID } from "node:crypto";

import {
  canonicalJson,
  computeEvidenceLedgerEntryHash,
  sha256Canonical,
} from "@donelayer/database";

import type { GitDeliveryProvider } from "../git-delivery/provider";
import { createAdditionSemanticContract } from "../semantic-verification/semantic-contract";
import {
  decideTaskScopedAuthority,
  issueTaskScopedPermissionLease,
  revokeTaskScopedPermissionLease,
  TASK_SCOPED_AUTHORITY_GATE,
  TASK_SCOPED_AUTHORITY_AGENT_ID,
  TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
  TASK_SCOPED_AUTHORITY_ISSUER,
  TaskScopedAuthorityGuard,
  type TaskScopedAuthorityDecision,
  type TaskScopedAuthorityOperationEvidence,
  type TaskScopedAuthoritySubject,
  type TaskScopedPermissionLease,
} from "./task-scoped-authority";

const FIXTURE_BRANCH = "fixture/real-source-bug-v1" as const;
const FIXTURE_COMMIT = "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00";

type RepositoryVerifier = Pick<GitDeliveryProvider, "checkAvailability" | "verifyRepository">;

type AuthorityLedgerEntry = {
  id: string;
  sequenceNumber: number;
  entryType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  entrySha256: string;
  createdAt: string;
};

export type TaskScopedAuthorityGateOutcome = {
  gate: typeof TASK_SCOPED_AUTHORITY_GATE;
  runId: string;
  status: "AUTHORITY_VERIFIED";
  contract: ReturnType<typeof createAdditionSemanticContract>;
  decision: TaskScopedAuthorityDecision;
  issuedLease: TaskScopedPermissionLease;
  finalLease: TaskScopedPermissionLease;
  protectedOperations: TaskScopedAuthorityOperationEvidence[];
  liveAction: {
    action: "READ_EXACT_FIXTURE_SOURCE_IDENTITY";
    mutating: false;
    providerAuthentication: "OWNER_DEVELOPMENT_GITHUB_AUTH";
    repository: Awaited<ReturnType<RepositoryVerifier["verifyRepository"]>>;
  };
  unsupportedEnforcement: string[];
  ledgerEntries: AuthorityLedgerEntry[];
  ledgerVerification: { valid: boolean; entryCount: number; chainSha256: string | null };
  receipt: {
    id: string;
    publicReceiptId: string;
    result: "AUTHORITY_VERIFIED";
    receiptSha256: string;
    evidenceChainSha256: string;
    document: Record<string, unknown>;
  };
};

export class TaskScopedAuthorityGateOrchestrator {
  constructor(private readonly repositoryVerifier: RepositoryVerifier) {}

  async run(): Promise<TaskScopedAuthorityGateOutcome> {
    const runId = randomUUID();
    const jobRunId = randomUUID();
    const startedAt = new Date().toISOString();
    const contract = createAdditionSemanticContract({
      taskId: `task-scoped-authority-${runId}`,
      branch: FIXTURE_BRANCH,
      commitSha: FIXTURE_COMMIT,
      lockedAt: startedAt,
    });
    const subject: TaskScopedAuthoritySubject = {
      agentId: TASK_SCOPED_AUTHORITY_AGENT_ID,
      executorId: TASK_SCOPED_AUTHORITY_EXECUTOR_ID,
      jobRunId,
    };
    const decision = decideTaskScopedAuthority({
      contract,
      subject,
      durationSeconds: 300,
      decidedAt: startedAt,
    });
    const issuedLease = issueTaskScopedPermissionLease(decision);
    const protectedOperations: TaskScopedAuthorityOperationEvidence[] = [];
    const recordOperation = (operation: TaskScopedAuthorityOperationEvidence): void => {
      protectedOperations.push({ ...operation, sequence: protectedOperations.length + 1 });
    };
    const guard = new TaskScopedAuthorityGuard(issuedLease, {
      contract,
      subject,
      onDecision: recordOperation,
    });
    const exactRepository = {
      remoteUrl: contract.remoteUrl,
      baseRef: contract.branch,
      commitSha: contract.commitSha,
    };

    guard.assertRepositoryReadAllowed(exactRepository);
    const availability = await this.repositoryVerifier.checkAvailability();
    if (
      !availability.available ||
      availability.authenticationMode !== "OWNER_DEVELOPMENT_GITHUB_AUTH" ||
      !availability.accountLogin
    ) throw new Error(`${availability.errorCode ?? "GITHUB_AUTHENTICATION_BLOCKED"}: ${availability.errorMessage ?? "GitHub authentication unavailable"}`);
    const repository = await this.repositoryVerifier.verifyRepository({
      remoteUrl: contract.remoteUrl,
      expectedBaseCommit: contract.commitSha,
      baseBranch: FIXTURE_BRANCH,
    });
    if (
      repository.remoteUrl !== contract.remoteUrl ||
      repository.baseBranch !== contract.branch ||
      repository.expectedBaseCommit !== contract.commitSha ||
      repository.remoteBaseCommit !== contract.commitSha ||
      !repository.expectedCommitExists
    ) throw new Error("TASK_SCOPED_AUTHORITY_REMOTE_IDENTITY_MISMATCH");

    expectDenied(() => guard.assertRepositoryReadAllowed({ ...exactRepository, remoteUrl: "https://github.com/NickHOI/other.git" }));
    expectDenied(() => guard.assertRepositoryReadAllowed({ ...exactRepository, baseRef: "main" }));
    expectDenied(() => guard.assertActionAllowedWithEvidence("delete_remote_branch"));
    expectDenied(() => guard.assertPullRequestCreateAllowed({
      remoteUrl: contract.remoteUrl,
      baseRef: contract.branch,
      headBranch: "donelayer/repair/authority-gate",
    }));
    expectDenied(() => guard.assertPullRequestMergeAllowed());
    expectDenied(() => guard.assertProductionDeploymentAllowed());

    const finalLease = revokeTaskScopedPermissionLease({
      lease: issuedLease,
      revokedBy: TASK_SCOPED_AUTHORITY_ISSUER,
      reason: "The single bounded read-only Gate action completed",
    });
    const revokedGuard = new TaskScopedAuthorityGuard(finalLease, {
      contract,
      subject,
      onDecision: recordOperation,
    });
    expectDenied(() => revokedGuard.assertRepositoryReadAllowed(exactRepository));

    if (
      protectedOperations.filter((operation) => operation.decision === "ALLOWED").length !== 1 ||
      protectedOperations.filter((operation) => operation.decision === "DENIED").length !== 7 ||
      protectedOperations.some((operation) => operation.authoritySha256 !== issuedLease.authoritySha256)
    ) throw new Error("TASK_SCOPED_AUTHORITY_OPERATION_EVIDENCE_INCOMPLETE");

    const liveAction = {
      action: "READ_EXACT_FIXTURE_SOURCE_IDENTITY" as const,
      mutating: false as const,
      providerAuthentication: "OWNER_DEVELOPMENT_GITHUB_AUTH" as const,
      repository,
    };
    const ledger = new AuthorityLedger();
    ledger.append("CONTRACT_LOCKED", "verified_work_contract", contract.taskId, {
      version: contract.contractVersion,
      workContractSha256: contract.workContractSha256,
    }, contract.lockedAt);
    ledger.append("AUTHORITY_DECISION_RECORDED", "authority_decision", decision.decisionId, decision, decision.decidedAt);
    ledger.append("PERMISSION_GRANTED", "permission_lease", issuedLease.id, {
      version: issuedLease.version,
      authoritySha256: issuedLease.authoritySha256,
      workContract: issuedLease.authority.workContract,
      subject: issuedLease.authority.subject,
      scope: issuedLease.scope,
      startsAt: issuedLease.startsAt,
      expiresAt: issuedLease.expiresAt,
    }, issuedLease.startsAt);
    for (const operation of protectedOperations) {
      ledger.append(
        operation.decision === "ALLOWED" ? "PROTECTED_ACTION_ALLOWED" : "PROTECTED_ACTION_DENIED",
        "task_scoped_authority_operation",
        `${runId}:${operation.sequence}`,
        operation,
        operation.recordedAt,
      );
    }
    ledger.append("REMOTE_REPOSITORY_VERIFIED", "github_repository", repository.repositoryId, liveAction, repository.verifiedAt);
    ledger.append("PERMISSION_LEASE_REVOKED", "permission_lease", finalLease.id, {
      authoritySha256: finalLease.authoritySha256,
      status: finalLease.status,
      revokedAt: finalLease.revokedAt,
      reason: finalLease.revocationReason,
    }, finalLease.revokedAt!);

    const preReceipt = ledger.verify();
    if (!preReceipt.valid || !preReceipt.chainSha256) throw new Error("TASK_SCOPED_AUTHORITY_LEDGER_INVALID");
    const receiptId = randomUUID();
    const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
    const document: Record<string, unknown> = {
      schemaVersion: 1,
      receiptType: "TASK_SCOPED_AUTHORITY_VERIFICATION",
      publicReceiptId,
      gate: TASK_SCOPED_AUTHORITY_GATE,
      finalResult: "AUTHORITY_VERIFIED",
      workContract: decision.workContract,
      authority: {
        leaseId: issuedLease.id,
        version: issuedLease.version,
        authoritySha256: issuedLease.authoritySha256,
        decisionId: decision.decisionId,
        decisionSha256: decision.decisionSha256,
        issuer: issuedLease.authority.issuer,
        subject: issuedLease.authority.subject,
        scope: issuedLease.scope,
        startsAt: issuedLease.startsAt,
        expiresAt: issuedLease.expiresAt,
        terminalStatus: finalLease.status,
        revokedAt: finalLease.revokedAt,
        revocationReason: finalLease.revocationReason,
      },
      liveAction,
      protectedOperations,
      unsupportedEnforcement: issuedLease.authority.unsupportedEnforcement,
      evidenceLedger: preReceipt,
      issuedAt: new Date().toISOString(),
    };
    const receiptSha256 = sha256Canonical(document);
    ledger.append("RECEIPT_CREATED", "authority_receipt", receiptId, {
      receiptSha256,
      evidenceChainSha256: preReceipt.chainSha256,
    }, String(document.issuedAt));
    const ledgerVerification = ledger.verify();
    if (!ledgerVerification.valid) throw new Error("TASK_SCOPED_AUTHORITY_LEDGER_INVALID");

    return {
      gate: TASK_SCOPED_AUTHORITY_GATE,
      runId,
      status: "AUTHORITY_VERIFIED",
      contract,
      decision,
      issuedLease,
      finalLease,
      protectedOperations,
      liveAction,
      unsupportedEnforcement: issuedLease.authority.unsupportedEnforcement,
      ledgerEntries: ledger.entries,
      ledgerVerification,
      receipt: {
        id: receiptId,
        publicReceiptId,
        result: "AUTHORITY_VERIFIED",
        receiptSha256,
        evidenceChainSha256: preReceipt.chainSha256,
        document,
      },
    };
  }
}

class AuthorityLedger {
  readonly entries: AuthorityLedgerEntry[] = [];

  append(entryType: string, sourceRecordType: string, sourceRecordId: string, payload: unknown, createdAt = new Date().toISOString()): void {
    const previousEntrySha256 = this.entries.at(-1)?.entrySha256 ?? null;
    const entry: AuthorityLedgerEntry = {
      id: randomUUID(),
      sequenceNumber: this.entries.length + 1,
      entryType,
      sourceRecordType,
      sourceRecordId,
      payloadSha256: sha256Canonical(payload),
      previousEntrySha256,
      entrySha256: "",
      createdAt,
    };
    entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
    this.entries.push(entry);
  }

  verify(): { valid: boolean; entryCount: number; chainSha256: string | null } {
    let previous: string | null = null;
    for (const [index, entry] of this.entries.entries()) {
      if (
        entry.sequenceNumber !== index + 1 ||
        entry.previousEntrySha256 !== previous ||
        computeEvidenceLedgerEntryHash(entry) !== entry.entrySha256
      ) return { valid: false, entryCount: this.entries.length, chainSha256: previous };
      previous = entry.entrySha256;
    }
    return { valid: true, entryCount: this.entries.length, chainSha256: previous };
  }
}

function expectDenied(operation: () => void): void {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error("TASK_SCOPED_AUTHORITY_NEGATIVE_PROBE_UNEXPECTEDLY_ALLOWED");
}

export function assertTaskScopedAuthorityGateReceiptIntegrity(outcome: TaskScopedAuthorityGateOutcome): void {
  const { receipt } = outcome;
  if (
    outcome.gate !== TASK_SCOPED_AUTHORITY_GATE ||
    outcome.status !== "AUTHORITY_VERIFIED" ||
    receipt.result !== "AUTHORITY_VERIFIED" ||
    sha256Canonical(receipt.document) !== receipt.receiptSha256 ||
    receipt.document.evidenceLedger === undefined ||
    receipt.evidenceChainSha256 !== (receipt.document.evidenceLedger as { chainSha256?: unknown }).chainSha256 ||
    !outcome.ledgerVerification.valid ||
    outcome.ledgerEntries.at(-1)?.previousEntrySha256 !== receipt.evidenceChainSha256 ||
    outcome.ledgerEntries.at(-1)?.payloadSha256 !== sha256Canonical({
      receiptSha256: receipt.receiptSha256,
      evidenceChainSha256: receipt.evidenceChainSha256,
    }) ||
    canonicalJson(receipt.document.workContract) !== canonicalJson(outcome.decision.workContract)
  ) throw new Error("TASK_SCOPED_AUTHORITY_RECEIPT_TAMPERING_DETECTED");
}
