import "server-only";

import { BETA_GATE_3_PRODUCT_REMOTE_URL } from "@donelayer/worker-protocol";

import { BETA_GATE_3_CANONICAL_WORKFLOW } from "../verified-work-execution/contract";
import type { CanonicalPreparedExecution } from "../verified-work-execution/lifecycle";
import {
  SupabaseVerifiedWorkExecutionPersistence,
  type FinalizeVerifiedWorkExecutionRequest,
  type VerifiedWorkArtifactWrite,
  type VerifiedWorkLedgerWrite,
} from "../verified-work-execution/persistence";
import {
  parseBetaGate3PreparedLifecycle,
  type BetaGate3PreparedLifecycle,
} from "./contract";

export type BetaGate3PrepareRequest = {
  ownerAuthUserId: string;
  taskId: string;
  contractId: string;
  contractSha256: string;
  authorityId: string;
  authorityScopeSha256: string;
  sourceCommit: string;
};

export type BetaGate3ArtifactWrite = VerifiedWorkArtifactWrite;
export type BetaGate3LedgerWrite = VerifiedWorkLedgerWrite;

export type BetaGate3FinalizeRequest = Omit<
  FinalizeVerifiedWorkExecutionRequest,
  "contractId" | "contractSha256" | "authorityId" | "authorityScopeSha256" | "envelopeSha256"
>;

export type BetaGate3FinalizedLifecycle = {
  finalized: true;
  replayed: boolean;
  taskId: string;
  jobRunId: string;
  permissionLeaseId: string;
  verificationRunId: string;
  receiptId: string;
  receiptPublicId: string;
  receiptSha256: string;
  evidenceChainSha256: string;
  finalStatus: "COMPLETED";
  deliveryOutcome: "VERIFIED_DELIVERY";
  finishedAt: string;
};

export class SupabaseBetaGate3Persistence {
  private prepared: CanonicalPreparedExecution | null = null;
  private preparedOwnerAuthUserId: string | null = null;

  constructor(
    private readonly canonical = new SupabaseVerifiedWorkExecutionPersistence(),
  ) {}

  async prepare(request: BetaGate3PrepareRequest): Promise<BetaGate3PreparedLifecycle> {
    const prepared = await this.canonical.prepare({
      ownerAuthUserId: request.ownerAuthUserId,
      taskId: request.taskId,
      contractId: request.contractId,
      contractSha256: request.contractSha256,
      authorityId: request.authorityId,
      authorityScopeSha256: request.authorityScopeSha256,
      sourceRepository: BETA_GATE_3_PRODUCT_REMOTE_URL,
      sourceCommit: request.sourceCommit,
      sourceTree: null,
      workflow: BETA_GATE_3_CANONICAL_WORKFLOW,
    });
    if (prepared.reused) throw new Error("BETA_GATE_3_EXISTING_EXECUTION_REQUIRES_OPERATOR_REVIEW");
    this.prepared = prepared;
    this.preparedOwnerAuthUserId = request.ownerAuthUserId;
    return parseBetaGate3PreparedLifecycle({
      ...prepared,
      sourceCommit: prepared.source.commitSha,
    });
  }

  async finalize(request: BetaGate3FinalizeRequest): Promise<BetaGate3FinalizedLifecycle> {
    const prepared = this.requirePrepared(request.taskId, request.jobRunId);
    return this.canonical.finalize({
      ...request,
      jobResult: {
        ...request.jobResult,
        canonicalEnvelopeSha256: prepared.envelopeSha256,
        contractSha256: prepared.contractSha256,
        authorityScopeSha256: prepared.authorityScopeSha256,
        requiredEvidenceComplete: true,
        unresolvedPolicyViolations: [],
      },
      contractId: prepared.contractId,
      contractSha256: prepared.contractSha256,
      authorityId: prepared.authorityId,
      authorityScopeSha256: prepared.authorityScopeSha256,
      envelopeSha256: prepared.envelopeSha256,
    });
  }

  async failClosed(request: {
    taskId: string;
    jobRunId: string;
    failureCode: string;
    executionOutcome: "FAILED" | "INCONCLUSIVE" | "TIMEOUT" | "PROVIDER_FAILURE";
  }): Promise<void> {
    const prepared = this.requirePrepared(request.taskId, request.jobRunId);
    if (!this.preparedOwnerAuthUserId) throw new Error("BETA_GATE_3_OWNER_BINDING_MISSING");
    await this.canonical.failClosed({
      ownerAuthUserId: this.preparedOwnerAuthUserId,
      taskId: request.taskId,
      jobRunId: request.jobRunId,
      contractId: prepared.contractId,
      authorityId: prepared.authorityId,
      envelopeSha256: prepared.envelopeSha256,
      failureCode: request.failureCode,
      failureReason: request.failureCode,
      executionOutcome: request.executionOutcome,
    });
  }

  private requirePrepared(taskId: string, jobRunId: string): CanonicalPreparedExecution {
    if (!this.prepared || this.prepared.taskId !== taskId || this.prepared.jobRunId !== jobRunId) {
      throw new Error("BETA_GATE_3_CANONICAL_PREPARATION_MISSING");
    }
    return this.prepared;
  }
}
