import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseCommandClient } from "../supabase-auth";
import {
  parseCanonicalPreparedExecution,
  type CanonicalPreparedExecution,
} from "./lifecycle";

export type PrepareVerifiedWorkExecutionRequest = {
  ownerAuthUserId: string;
  taskId: string;
  contractId: string;
  contractSha256: string;
  authorityId: string;
  authorityScopeSha256: string;
  sourceRepository: string;
  sourceCommit: string;
  sourceTree: string | null;
  workflow: string;
};

export type VerifiedWorkArtifactWrite = {
  id: string;
  artifactType: "PATCH" | "TEST_LOG" | "VERIFICATION_REPORT" | "OTHER";
  fileName: string;
  mimeType: "text/plain" | "application/json";
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  metadata: Record<string, unknown>;
};

export type VerifiedWorkLedgerWrite = {
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

export type FinalizeVerifiedWorkExecutionRequest = {
  ownerAuthUserId: string;
  taskId: string;
  jobRunId: string;
  workerId: string;
  workerLeaseId: string;
  permissionLeaseId: string;
  contractId: string;
  contractSha256: string;
  authorityId: string;
  authorityScopeSha256: string;
  envelopeSha256: string;
  patchSha256: string;
  changedFiles: string[];
  jobResult: Record<string, unknown>;
  artifacts: VerifiedWorkArtifactWrite[];
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
  ledgerEntries: VerifiedWorkLedgerWrite[];
  receipt: {
    id: string;
    publicId: string;
    sha256: string;
    evidenceChainSha256: string;
    document: Record<string, unknown>;
  };
};

export type FinalizedVerifiedWorkExecution = {
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

export type FailVerifiedWorkExecutionRequest = {
  ownerAuthUserId: string;
  taskId: string;
  jobRunId: string;
  contractId: string;
  authorityId: string;
  envelopeSha256: string;
  failureCode: string;
  failureReason: string;
  executionOutcome: "FAILED" | "INCONCLUSIVE" | "TIMEOUT" | "PROVIDER_FAILURE";
};

export class SupabaseVerifiedWorkExecutionPersistence {
  constructor(private readonly client: SupabaseClient = createSupabaseCommandClient()) {}

  async prepare(request: PrepareVerifiedWorkExecutionRequest): Promise<CanonicalPreparedExecution> {
    const { data, error } = await this.client.rpc("prepare_verified_work_execution", {
      p_request: request,
    });
    if (error) throw new Error(`CANONICAL_EXECUTION_PREPARE_FAILED:${safeCode(error.message)}`);
    return parseCanonicalPreparedExecution(data);
  }

  async finalize(request: FinalizeVerifiedWorkExecutionRequest): Promise<FinalizedVerifiedWorkExecution> {
    const { data, error } = await this.client.rpc("finalize_verified_work_execution", {
      p_result: request,
    });
    if (error) throw new Error(`CANONICAL_EXECUTION_FINALIZE_FAILED:${safeCode(error.message)}`);
    const value = recordOf(data) as Partial<FinalizedVerifiedWorkExecution>;
    if (
      value.finalized !== true ||
      typeof value.replayed !== "boolean" ||
      value.taskId !== request.taskId ||
      value.jobRunId !== request.jobRunId ||
      value.permissionLeaseId !== request.permissionLeaseId ||
      value.receiptId !== request.receipt.id ||
      value.receiptPublicId !== request.receipt.publicId ||
      value.receiptSha256 !== request.receipt.sha256 ||
      value.evidenceChainSha256 !== request.receipt.evidenceChainSha256 ||
      value.finalStatus !== "COMPLETED" ||
      value.deliveryOutcome !== "VERIFIED_DELIVERY"
    ) throw new Error("CANONICAL_EXECUTION_FINALIZE_RESPONSE_INVALID");
    return value as FinalizedVerifiedWorkExecution;
  }

  async failClosed(request: FailVerifiedWorkExecutionRequest): Promise<{ replayed: boolean }> {
    const { data, error } = await this.client.rpc("fail_verified_work_execution", {
      p_failure: request,
    });
    const value = recordOf(data);
    if (error || value.failedClosed !== true || typeof value.replayed !== "boolean") {
      throw new Error(`CANONICAL_EXECUTION_FAIL_CLOSED_PERSISTENCE_FAILED:${safeCode(error?.message ?? "invalid response")}`);
    }
    return { replayed: value.replayed };
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
