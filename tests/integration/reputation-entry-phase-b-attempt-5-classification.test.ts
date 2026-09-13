import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Canonical } from "@donelayer/database";
import { describe, expect, it } from "vitest";

import {
  assertRealJobClassificationRecordIntegrity,
  type RealJobClassificationRecord,
} from "../../apps/web/src/server/reputation-entry-pilot/real-job-classification";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const classificationPath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5-owner-classification.json");
const sourceEvidencePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5-evidence.json");
const databasePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5.sqlite");
const running = existsSync(classificationPath);

describe("Phase B Attempt 5 owner real-Job classification", () => {
  it.skipIf(!running)("preserves the Benchmark exclusion and zero canonical contribution", () => {
    const artifact = JSON.parse(readFileSync(classificationPath, "utf8")) as {
      schemaVersion: number;
      evidenceType: string;
      attemptId: string;
      ownerDecision: string;
      sourceEvidence: { evidenceJsonSha256: string; databaseSha256: string };
      records: RealJobClassificationRecord[];
      auditQueue: { provisionalRealJobsAdded: number; ambiguousJobsAdded: number };
      corpus: {
        canonicalRealVerifiedJobCountBefore: number;
        canonicalCountContribution: number;
        canonicalRealVerifiedJobCountAfter: number;
        remainingGap: number;
        qualifyingTaskTypes: string[];
        reputationStarted: boolean;
      };
      historicalAttemptEvidenceMutated: boolean;
      evidenceSha256: string;
    };
    const { evidenceSha256, ...body } = artifact;
    expect(evidenceSha256).toBe(sha256Canonical(body));
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      evidenceType: "ATTEMPT_5_OWNER_REAL_JOB_CLASSIFICATION_V1",
      attemptId: "PHASE_B_ATTEMPT_5",
      ownerDecision: "DO_NOT_COUNT",
      auditQueue: { provisionalRealJobsAdded: 0, ambiguousJobsAdded: 0 },
      corpus: {
        canonicalRealVerifiedJobCountBefore: 0,
        canonicalCountContribution: 0,
        canonicalRealVerifiedJobCountAfter: 0,
        remainingGap: 20,
        qualifyingTaskTypes: [],
        reputationStarted: false,
      },
      historicalAttemptEvidenceMutated: false,
    });
    expect(artifact.sourceEvidence).toEqual({
      evidenceJsonSha256: fileSha256(sourceEvidencePath),
      databaseSha256: fileSha256(databasePath),
    });
    expect(artifact.records).toHaveLength(2);
    artifact.records.forEach(assertRealJobClassificationRecordIntegrity);
    expect(artifact.records.map((record) => ({
      jobId: record.input.jobId,
      delivery: record.input.deliveryOutcome,
      state: record.decision.state,
      classification: record.decision.automaticClassification,
      count: record.decision.canonicalCountContribution,
    }))).toEqual([
      {
        jobId: "0e511627-1593-4963-8d5c-84d9953ff729",
        delivery: "VERIFIED_DELIVERY",
        state: "BENCHMARK_FIXTURE",
        classification: "BENCHMARK_FIXTURE_VERIFIED_JOB",
        count: 0,
      },
      {
        jobId: "940ce9ac-e6d7-419c-a198-07bf24620e4a",
        delivery: "INCONCLUSIVE",
        state: "BENCHMARK_FIXTURE",
        classification: "NON_VERIFIED_BENCHMARK_ATTEMPT",
        count: 0,
      },
    ]);
  });
});

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
