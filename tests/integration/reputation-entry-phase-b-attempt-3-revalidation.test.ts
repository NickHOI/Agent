import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  REPUTATION_ENTRY_CANDIDATE_STATUS_SEMANTICS,
  assertReputationEntryCandidateJobIntegrity,
  isVerifiedReputationEntryCandidateResult,
} from "../../apps/web/src/server/reputation-entry-pilot/candidate-evidence";
import {
  ReputationEntryDurableStore,
  assertDurableRecordIntegrity,
} from "../../apps/web/src/server/reputation-entry-pilot/durable-store";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const databasePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-3.sqlite");
const evidencePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-3-evidence.json");
const historicalMarkerPath = path.join(resultDirectory, "reputation-entry-pilot-attempt-1-recovered.json");
const expectedDatabaseSha256 = "30da49af05e27b7c29e07015d3eaf705809cef74000481ed78f58125e1e7fb37";
const hasEvidence = [databasePath, evidencePath, historicalMarkerPath].every(existsSync);

describe("immutable Phase B Attempt 3 read-only revalidation", () => {
  it.skipIf(!hasEvidence)("validates lifecycle integrity without changing outcomes or historical bytes", () => {
    const before = fileSha256(databasePath);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const store = new ReputationEntryDurableStore(databasePath, {
      historicalMarkerPath,
      readOnly: true,
    });
    try {
      expect(store.verifyAll()).toEqual({
        valid: true,
        recordCount: 79,
        lifecycleEntryCount: 76,
        jobCount: 2,
        historicalMarkerSha256: "5d90116229342b94fa9ef935e2c5780d2a0655143ec121db78b8c58176fd598f",
      });
      expect(evidence.outcome).toMatchObject({
        decision: "PARTIAL",
        candidateStatus: "REPUTATION_ENTRY_CANDIDATE",
        corpus: {
          verifiedCandidateJobCount: 0,
          canonicalQualifyingJobCountAdded: 0,
        },
      });
      expect(REPUTATION_ENTRY_CANDIDATE_STATUS_SEMANTICS).toBe("CANDIDATE_COLLECTION_WORKFLOW_MEMBERSHIP_ONLY");

      for (const job of evidence.outcome.jobs) {
        assertReputationEntryCandidateJobIntegrity(job);
        const recovery = store.recoverJob(job.jobId);
        expect(recovery.integrityValid).toBe(true);
        expect(recovery.lifecycleChainSha256).toEqual(expect.any(String));

        const modelRunV1 = store.getRecord("AGENT_MODEL_RUN", `${job.jobId}:model-run`, 1)!;
        const modelRunV2 = store.getRecord("AGENT_MODEL_RUN", `${job.jobId}:model-run`, 2)!;
        expect(modelRunV1.recordVersion).toBe(1);
        expect(modelRunV2.recordVersion).toBe(2);
        expect(modelRunV1.payload).toMatchObject({ status: "REQUESTED", maxSteps: 8, maxOutputTokens: 4_096, providerRetryLimit: 1 });
        expect(modelRunV2.payload).toEqual(job.agentRun);
        expect(() => assertDurableRecordIntegrity(modelRunV1)).not.toThrow();
        expect(() => assertDurableRecordIntegrity(modelRunV2)).not.toThrow();

        expect(store.getRecord("WORK_CONTRACT", job.contract.taskId)?.payload).toEqual(job.contract);
        expect(store.getRecord("AUTHORITY_LEASE_ISSUED", job.issuedLease.id)?.payload).toEqual(job.issuedLease);
        expect(store.getRecord("AUTHORITY_LEASE_REVOKED", job.terminalLease.id, 2)?.payload).toEqual(job.terminalLease);
        expect(store.getRecord("EVIDENCE_BUNDLE_FINAL", job.evidenceBundle.bundleSha256)?.payload).toEqual(job.evidenceBundle);
        expect(store.getRecord("EVIDENCE_LEDGER_FINAL", `${job.jobId}:ledger`)?.payload).toEqual({
          entries: job.ledgerEntries,
          verification: job.ledgerVerification,
        });
        expect(store.getRecord("VERIFIED_JOB_RECEIPT", job.receipt.id)?.payload).toEqual(job.receipt);

        const modelRequestRecords = recovery.records.filter((record) => record.recordType === "AGENT_MODEL_REQUEST");
        expect(modelRequestRecords).toHaveLength(job.agentRun.usage.apiRequestCount);
        expect(recovery.records.find((record) => record.recordType === "REPAIR_SANDBOX_CLEANUP")?.payload).toMatchObject({
          finalProviderState: "stopped",
          snapshotCreated: false,
          cleanupVerified: true,
        });
        expect(recovery.records.find((record) => record.recordType === "VERIFIER_SANDBOX_CLEANUP")?.payload).toMatchObject({
          finalProviderState: "stopped",
          snapshotCreated: false,
          cleanupVerified: true,
        });
        expect(isVerifiedReputationEntryCandidateResult(job.result)).toBe(false);
        expect(job.receipt.document.canonicalQualification.counted).toBe(false);
      }

      expect(evidence.outcome.jobs.map((job: { result: string }) => job.result)).toEqual(["FAILED", "INCONCLUSIVE"]);
      expect(evidence.outcome.jobs.map((job: { receipt: { result: string } }) => job.receipt.result)).toEqual(["FAILED", "INCONCLUSIVE"]);
      expect(() => store.appendRecord({ recordType: "PILOT_OUTCOME", recordId: "forbidden", payload: {} })).toThrow("REPUTATION_ENTRY_DURABLE_STORE_READ_ONLY");
    } finally {
      store.close();
    }

    const after = fileSha256(databasePath);
    expect(before).toBe(expectedDatabaseSha256);
    expect(after).toBe(expectedDatabaseSha256);
    expect(existsSync(`${databasePath}-wal`)).toBe(false);
    expect(existsSync(`${databasePath}-shm`)).toBe(false);
  });
});

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
