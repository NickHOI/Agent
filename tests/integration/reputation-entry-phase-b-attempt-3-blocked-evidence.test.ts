import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { canonicalJson, computeEvidenceLedgerEntryHash, sha256Canonical } from "@donelayer/database";
import { describe, expect, it } from "vitest";

import { assertReputationEntryCandidateJobIntegrity } from "../../apps/web/src/server/reputation-entry-pilot/candidate-evidence";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const evidencePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-3-evidence.json");
const preflightPath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-3-source-preflight.json");
const databasePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-3.sqlite");
const reportPath = path.join(workspaceRoot, "REPUTATION_ENTRY_PHASE_B_ATTEMPT_3_BLOCKED.md");
const hasEvidence = [evidencePath, preflightPath, databasePath, reportPath].every(existsSync);

type LifecycleRow = {
  id: string;
  job_id: string;
  sequence_number: number;
  entry_type: string;
  source_record_type: string;
  source_record_id: string;
  payload_sha256: string;
  previous_entry_sha256: string | null;
  entry_sha256: string;
  created_at: string;
};

describe("Phase B Attempt 3 retained blocked evidence", () => {
  it.skipIf(!hasEvidence)("preserves the partial outcome and distinguishes valid Job evidence from the durable verifier blocker", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const preflight = JSON.parse(readFileSync(preflightPath, "utf8"));

    expect(preflight).toMatchObject({
      attemptId: "PHASE_B_ATTEMPT_3",
      status: "PASS",
      checks: {
        oidcStructurallyValid: true,
        oidcBoundToLinkedProject: true,
        oidcNotExpired: true,
        gatewayCatalogAvailable: true,
        exactCommitsMaterialized: true,
        temporaryWorkspacesCleaned: true,
        externalMutationPerformed: false,
        jobLifecycleStateCreated: false,
      },
      provider: { modelRequestsPerformed: false, externalMutationPerformed: false },
    });
    expect(evidence.outcome).toMatchObject({
      attemptId: "PHASE_B_ATTEMPT_3",
      decision: "PARTIAL",
      candidateStatus: "REPUTATION_ENTRY_CANDIDATE",
      corpus: { verifiedCandidateJobCount: 0, canonicalQualifyingJobCountAdded: 0, remainingGapBeforeOwnerPromotion: 20 },
      limits: { modelRequestsUsed: 9, modelRequestLimit: 16, sandboxesCreated: 4, sandboxLimit: 4 },
    });
    expect(evidence.outcome.jobs.map((job: { result: string }) => job.result)).toEqual(["FAILED", "INCONCLUSIVE"]);
    for (const job of evidence.outcome.jobs) {
      expect(() => assertReputationEntryCandidateJobIntegrity(job)).not.toThrow();
      expect(job.evidenceBundle.projection).toMatchObject({ complete: true, missing: [] });
      expect(job.ledgerVerification.valid).toBe(true);
      expect(job.terminalLease.status).toBe("REVOKED");
      expect(job.repairSandbox.cleanup).toMatchObject({ finalProviderState: "stopped", snapshotCreated: false, cleanupVerified: true });
      expect(job.independentVerification.cleanup).toMatchObject({ finalProviderState: "stopped", snapshotCreated: false, cleanupVerified: true });
      expect(job.receipt.document.canonicalQualification.counted).toBe(false);
    }

    const databaseUrl = pathToFileURL(databasePath);
    databaseUrl.searchParams.set("immutable", "1");
    const database = new DatabaseSync(databaseUrl, { readOnly: true });
    try {
      const records = database.prepare("SELECT * FROM durable_records ORDER BY rowid").all() as Array<Record<string, unknown>>;
      expect(records).toHaveLength(79);
      for (const record of records) {
        const payload = JSON.parse(String(record.payload_json));
        expect(canonicalJson(payload)).toBe(record.payload_json);
        expect(sha256Canonical(payload)).toBe(record.payload_sha256);
      }
      const duplicates = database.prepare(`
        SELECT job_id,record_type,record_id,COUNT(*) AS versions,GROUP_CONCAT(record_version) AS record_versions
        FROM durable_records WHERE job_id IS NOT NULL
        GROUP BY job_id,record_type,record_id HAVING COUNT(*) > 1 ORDER BY job_id
      `).all();
      expect(duplicates).toHaveLength(2);
      expect(duplicates).toEqual(expect.arrayContaining([
        expect.objectContaining({ record_type: "AGENT_MODEL_RUN", versions: 2, record_versions: "1,2" }),
      ]));

      const jobs = database.prepare("SELECT DISTINCT job_id FROM durable_lifecycle ORDER BY job_id").all() as Array<{ job_id: string }>;
      const versionAware = jobs.map(({ job_id }) => verifyLifecycle(database, job_id));
      expect(versionAware).toEqual(expect.arrayContaining([
        expect.objectContaining({ entryCount: 47, cryptographicChainValid: true, exactPayloadBindingValid: true }),
        expect.objectContaining({ entryCount: 29, cryptographicChainValid: true, exactPayloadBindingValid: true }),
      ]));
      expect(versionAware.every((result) => result.legacyTypeAndIdBindingValid === false)).toBe(true);
    } finally {
      database.close();
    }

    for (const identity of Object.values(evidence.historicalEvidenceBefore) as Array<{ fileName: string; sha256: string }>) {
      const retained = readFileSync(path.join(identity.fileName.endsWith(".md") ? workspaceRoot : resultDirectory, identity.fileName));
      expect(createHash("sha256").update(retained).digest("hex")).toBe(identity.sha256);
    }
    expect(JSON.stringify({ evidence, preflight })).not.toMatch(/gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\user/i);
  });
});

function verifyLifecycle(database: DatabaseSync, jobId: string) {
  const lifecycle = database.prepare("SELECT * FROM durable_lifecycle WHERE job_id=? ORDER BY sequence_number").all(jobId) as unknown as LifecycleRow[];
  const records = database.prepare("SELECT record_type,record_id,payload_sha256 FROM durable_records WHERE job_id=?").all(jobId) as Array<{
    record_type: string;
    record_id: string;
    payload_sha256: string;
  }>;
  const legacy = new Map(records.map((record) => [`${record.record_type}:${record.record_id}`, record.payload_sha256]));
  const exact = new Set(records.map((record) => `${record.record_type}:${record.record_id}:${record.payload_sha256}`));
  let previous: string | null = null;
  let cryptographicChainValid = true;
  let exactPayloadBindingValid = true;
  let legacyTypeAndIdBindingValid = true;
  for (const [index, row] of lifecycle.entries()) {
    const entry = {
      id: row.id,
      jobId: row.job_id,
      sequenceNumber: row.sequence_number,
      entryType: row.entry_type,
      sourceRecordType: row.source_record_type,
      sourceRecordId: row.source_record_id,
      payloadSha256: row.payload_sha256,
      previousEntrySha256: row.previous_entry_sha256,
      entrySha256: row.entry_sha256,
      createdAt: row.created_at,
    };
    cryptographicChainValid &&= entry.sequenceNumber === index + 1 &&
      entry.previousEntrySha256 === previous &&
      computeEvidenceLedgerEntryHash(entry) === entry.entrySha256;
    exactPayloadBindingValid &&= exact.has(`${entry.sourceRecordType}:${entry.sourceRecordId}:${entry.payloadSha256}`);
    legacyTypeAndIdBindingValid &&= legacy.get(`${entry.sourceRecordType}:${entry.sourceRecordId}`) === entry.payloadSha256;
    previous = entry.entrySha256;
  }
  return { jobId, entryCount: lifecycle.length, cryptographicChainValid, exactPayloadBindingValid, legacyTypeAndIdBindingValid, head: previous };
}
