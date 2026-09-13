import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Canonical } from "@donelayer/database";

import {
  REAL_JOB_CLASSIFICATION_POLICY,
  assertRealJobClassificationRecordIntegrity,
  createRealJobClassificationRecord,
  type RealJobClassificationInput,
} from "../apps/web/src/server/reputation-entry-pilot/real-job-classification";
import type { ReputationEntryPilotOutcomeV2 } from "../apps/web/src/server/reputation-entry-pilot/orchestrator";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const sourceEvidencePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5-evidence.json");
const databasePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5.sqlite");
const outputPath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5-owner-classification.json");
const classifiedAt = new Date().toISOString();

const expectedSourceEvidenceSha256 = "98ca89e1d4bd0216570d82e95f197470d8a7b51f616b84ba29589b19df3f104b";
const expectedDatabaseSha256 = "1d87f2c84a0e6ab7445131208630201ca5b4fd2d1065c93c037bbfdf4ba349bf";
const sourceEvidenceSha256 = fileSha256(sourceEvidencePath);
const databaseSha256 = fileSha256(databasePath);
if (sourceEvidenceSha256 !== expectedSourceEvidenceSha256 || databaseSha256 !== expectedDatabaseSha256) {
  throw new Error("ATTEMPT_5_SOURCE_EVIDENCE_IDENTITY_CHANGED");
}

const sourceEvidence = JSON.parse(readFileSync(sourceEvidencePath, "utf8")) as {
  attemptId: string;
  outcome: ReputationEntryPilotOutcomeV2;
};
if (sourceEvidence.attemptId !== "PHASE_B_ATTEMPT_5") throw new Error("ATTEMPT_5_SOURCE_EVIDENCE_INVALID");

const testAndFix = sourceEvidence.outcome.jobs.find((job) => job.contract.taskType === "TEST_AND_FIX");
const buildRescue = sourceEvidence.outcome.jobs.find((job) => job.contract.taskType === "BUILD_RESCUE");
if (!testAndFix || !buildRescue) throw new Error("ATTEMPT_5_JOB_SET_INVALID");

const records = [
  createRealJobClassificationRecord(classificationInput(
    testAndFix,
    "Fix the intentionally introduced async retry off-by-one defect",
  ), classifiedAt),
  createRealJobClassificationRecord(classificationInput(
    buildRescue,
    "Repair the intentionally introduced path-alias build defect",
  ), classifiedAt),
];
for (const record of records) assertRealJobClassificationRecordIntegrity(record);
if (
  records[0]?.decision.automaticClassification !== "BENCHMARK_FIXTURE_VERIFIED_JOB" ||
  records[1]?.decision.automaticClassification !== "NON_VERIFIED_BENCHMARK_ATTEMPT" ||
  records.some((record) => record.decision.canonicalCountContribution !== 0)
) throw new Error("ATTEMPT_5_OWNER_CLASSIFICATION_INVALID");

const body = {
  schemaVersion: 1 as const,
  evidenceType: "ATTEMPT_5_OWNER_REAL_JOB_CLASSIFICATION_V1" as const,
  attemptId: "PHASE_B_ATTEMPT_5" as const,
  classifiedAt,
  decisionAuthority: "OWNER" as const,
  ownerDecision: "DO_NOT_COUNT" as const,
  policy: REAL_JOB_CLASSIFICATION_POLICY,
  sourceEvidence: {
    evidenceJsonSha256: sourceEvidenceSha256,
    databaseSha256,
  },
  records,
  auditQueue: {
    provisionalRealJobsAdded: 0,
    ambiguousJobsAdded: 0,
  },
  corpus: {
    canonicalRealVerifiedJobCountBefore: 0,
    canonicalCountContribution: 0,
    canonicalRealVerifiedJobCountAfter: 0,
    remainingGap: 20,
    qualifyingTaskTypes: [] as string[],
    reputationStarted: false,
  },
  historicalAttemptEvidenceMutated: false,
};
const artifact = { ...body, evidenceSha256: sha256Canonical(body) };
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
if (secretPattern().test(serialized)) throw new Error("ATTEMPT_5_CLASSIFICATION_CREDENTIAL_LEAK_DETECTED");
await writeFile(outputPath, serialized, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${outputPath}\n${artifact.evidenceSha256}\n`);

function classificationInput(
  job: ReputationEntryPilotOutcomeV2["jobs"][number],
  taskDescription: string,
): RealJobClassificationInput {
  return {
    jobId: job.jobId,
    taskDescription,
    requirementSource: "Controlled Autopilot Phase B Attempt 5 corpus-collection authorization",
    origin: "OWNER",
    agentId: job.agentProfile.agentId,
    deliveryOutcome: job.outcomeEvaluation.deliveryOutcome,
    executionOutcome: job.outcomeEvaluation.executionOutcome,
    executionFailureAttribution: job.outcomeEvaluation.executionFailureAttribution,
    verificationOutcome: job.outcomeEvaluation.independentVerificationOutcome,
    deliveryOutcomePolicy: job.outcomeEvaluation.deliveryOutcomePolicy.policy,
    fullTrustLifecycleComplete: job.terminalLease.status === "REVOKED" &&
      job.repairSandbox.cleanup.cleanupVerified &&
      job.independentVerification.cleanup.cleanupVerified &&
      job.ledgerVerification.valid,
    requiredEvidenceCompleteAndValid: job.outcomeEvaluation.trustChecks.requiredEvidenceComplete,
    demo: false,
    seed: false,
    fixture: true,
    intentionallyManufacturedForTestingOrCorpus: true,
    taskExistedIndependentlyOfReputation: false,
    usefulWithoutReputation: false,
    hashes: {
      workContractSha256: job.contract.workContractSha256,
      evidenceBundleSha256: job.evidenceBundle.bundleSha256,
      receiptSha256: job.receipt.receiptSha256,
    },
  };
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function secretPattern(): RegExp {
  return /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\/i;
}
