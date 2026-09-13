import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseCommandClient } from "../supabase-auth";
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
  jobRunId: string;
  workerId: string;
  workerLeaseId: string;
  permissionLeaseId: string;
};

export type BetaGate3ArtifactWrite = {
  id: string;
  artifactType: "PATCH" | "TEST_LOG" | "VERIFICATION_REPORT" | "OTHER";
  fileName: string;
  mimeType: "text/plain" | "application/json";
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  metadata: Record<string, unknown>;
};

export type BetaGate3LedgerWrite = {
  id: string;
  taskId: string;
  jobRunId: string;
  sequenceNumber: number;
  entryType: string;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  entrySha256: string;
  createdAt: string;
};

export type BetaGate3FinalizeRequest = {
  ownerAuthUserId: string;
  taskId: string;
  jobRunId: string;
  workerId: string;
  workerLeaseId: string;
  permissionLeaseId: string;
  patchSha256: string;
  changedFiles: string[];
  jobResult: Record<string, unknown>;
  artifacts: BetaGate3ArtifactWrite[];
  verification: {
    id: string;
    verifierVersion: string;
    startedAt: string;
    finishedAt: string;
    summary: string;
    metadata: Record<string, unknown>;
    checks: Array<{
      id: string;
      acceptanceCheckId: string;
      status: "PASSED";
      summary: string;
      expected: Record<string, unknown>;
      actual: Record<string, unknown>;
    }>;
  };
  ledgerEntries: BetaGate3LedgerWrite[];
  receipt: {
    id: string;
    publicId: string;
    sha256: string;
    evidenceChainSha256: string;
    document: Record<string, unknown>;
  };
};

export type BetaGate3FinalizedLifecycle = {
  finalized: true;
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
  constructor(private readonly client: SupabaseClient = createSupabaseCommandClient()) {}

  async prepare(request: BetaGate3PrepareRequest): Promise<BetaGate3PreparedLifecycle> {
    const { data, error } = await this.client.rpc("rpc_prepare_beta_gate_3_job", {
      p_request: request,
    });
    if (error) throw new Error(`BETA_GATE_3_PREPARE_FAILED:${safeCode(error.message)}`);
    return parseBetaGate3PreparedLifecycle(data);
  }

  async finalize(request: BetaGate3FinalizeRequest): Promise<BetaGate3FinalizedLifecycle> {
    const { data, error } = await this.client.rpc("rpc_finalize_beta_gate_3_job", {
      p_result: request,
    });
    if (error) throw new Error(`BETA_GATE_3_FINALIZE_FAILED:${safeCode(error.message)}`);
    const value = recordOf(data) as Partial<BetaGate3FinalizedLifecycle>;
    if (
      value.finalized !== true ||
      value.taskId !== request.taskId ||
      value.jobRunId !== request.jobRunId ||
      value.permissionLeaseId !== request.permissionLeaseId ||
      value.receiptId !== request.receipt.id ||
      value.receiptPublicId !== request.receipt.publicId ||
      value.receiptSha256 !== request.receipt.sha256 ||
      value.evidenceChainSha256 !== request.receipt.evidenceChainSha256 ||
      value.finalStatus !== "COMPLETED" ||
      value.deliveryOutcome !== "VERIFIED_DELIVERY"
    ) throw new Error("BETA_GATE_3_FINALIZE_RESPONSE_INVALID");
    return value as BetaGate3FinalizedLifecycle;
  }

  async failClosed(request: {
    taskId: string;
    jobRunId: string;
    failureCode: string;
    executionOutcome: "FAILED" | "INCONCLUSIVE" | "TIMEOUT" | "PROVIDER_FAILURE";
  }): Promise<void> {
    const { data, error } = await this.client.rpc("rpc_fail_beta_gate_3_job", {
      p_failure: request,
    });
    if (error || recordOf(data).failedClosed !== true) {
      throw new Error(`BETA_GATE_3_FAIL_CLOSED_PERSISTENCE_FAILED:${safeCode(error?.message ?? "invalid response")}`);
    }
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeCode(value: string): string {
  return value.split(":", 1)[0]!.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 120);
}
