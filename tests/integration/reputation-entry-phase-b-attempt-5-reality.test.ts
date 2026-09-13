import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertReputationEntryCandidateJobV2Integrity } from "../../apps/web/src/server/reputation-entry-pilot/delivery-outcome-evidence";
import {
  persistablePilotOutcomeV2,
  ReputationEntryPilotOrchestrator,
  type ReputationEntryPilotOutcomeV2,
  type ReputationEntryPilotSource,
  type ReputationEntryV2PolicySelection,
} from "../../apps/web/src/server/reputation-entry-pilot/orchestrator";
import { ReputationEntryDurableStore } from "../../apps/web/src/server/reputation-entry-pilot/durable-store";
import { REPUTATION_ENTRY_PILOT } from "../../apps/web/src/server/reputation-entry-pilot/work-contract";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const attemptId = "PHASE_B_ATTEMPT_5";
const batchRecordId = "phase-b-attempt-5-v2-batch";
const preflightPath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5-preflight.json");
const identityPath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5-working-tree-identity.txt");
const evidencePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5-evidence.json");
const databasePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5.sqlite");
const historicalMarkerPath = path.join(resultDirectory, "reputation-entry-pilot-attempt-1-recovered.json");
const running = process.env.RUN_REPUTATION_ENTRY_PHASE_B_ATTEMPT_5 === "true";
const existingEvidence = existsSync(evidencePath) && existsSync(databasePath);
const sources: [ReputationEntryPilotSource, ReputationEntryPilotSource] = [
  {
    taskType: "TEST_AND_FIX",
    taskDefinitionVersion: 3,
    branch: "donelayer/repair/reputation-async-retry-v3",
    commitSha: "abf1bc277a7c27a4b50ab32033cf5d3ef8ee7728",
  },
  {
    taskType: "BUILD_RESCUE",
    taskDefinitionVersion: 3,
    branch: "donelayer/repair/reputation-path-alias-v3",
    commitSha: "746fa8ba7cef938a6245be3952e97f8697dfd2ca",
  },
];
const policies: ReputationEntryV2PolicySelection = {
  TEST_AND_FIX: "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
  BUILD_RESCUE: "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
};

describe("Phase B Attempt 5 V2 live corpus collection", () => {
  it.skipIf(!running)("runs exactly two V2 Jobs after the retained Attempt 5 preflight passes", async () => {
    await mkdir(resultDirectory, { recursive: true });
    if (existsSync(evidencePath) || existsSync(databasePath)) {
      throw new Error("REPUTATION_ENTRY_PHASE_B_ATTEMPT_5_ALREADY_EXISTS");
    }
    const preflight = retainedPreflight();
    const doneLayerIdentity = {
      headCommit: requiredEnvironmentValue("REPUTATION_ENTRY_HEAD_COMMIT", /^[a-f0-9]{40}$/),
      workingTreeSha256: requiredEnvironmentValue("REPUTATION_ENTRY_WORKTREE_SHA256", /^[a-f0-9]{64}$/),
    };
    const workingTreeIdentity = fileIdentity(identityPath);
    const historicalBefore = historicalIdentity();
    const store = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath });
    let outcome: ReputationEntryPilotOutcomeV2;
    try {
      outcome = await new ReputationEntryPilotOrchestrator(store, {
        attemptId,
        batchRecordId,
      }).runV2(sources, policies);
    } catch (error) {
      store.close();
      const failureEvidence = {
        gate: REPUTATION_ENTRY_PILOT,
        attemptId,
        classification: "FAIL_BLOCKED_DURING_LIVE_LIFECYCLE",
        capturedAt: new Date().toISOString(),
        sources,
        policies,
        doneLayerIdentity,
        workingTreeIdentity,
        preflight: fileIdentity(preflightPath),
        historicalBefore,
        historicalAfter: historicalIdentity(),
        durableDatabase: existsSync(databasePath) ? fileIdentity(databasePath) : null,
        failure: safeFailure(error),
        missingEvidenceWasNotReconstructed: true,
        canonicalReputationStarted: false,
        canonicalJobsAdded: 0,
      };
      await writeEvidence(failureEvidence);
      throw error;
    }
    store.close();

    const evidence = {
      gate: REPUTATION_ENTRY_PILOT,
      attemptId,
      classification: outcome.decision === "PASS" ? "PASS_PENDING_OWNER_CLASSIFICATION" : "PARTIAL",
      capturedAt: new Date().toISOString(),
      host: { hostname: hostname(), os: `${platform()} ${release()}`, nodeVersion: process.version },
      doneLayerIdentity,
      workingTreeIdentity,
      sources,
      policies,
      preflight,
      preflightEvidence: fileIdentity(preflightPath),
      historicalBefore,
      historicalAfter: historicalIdentity(),
      durableDatabase: fileIdentity(databasePath),
      proofBoundary: {
        canonicalReputationStarted: false,
        canonicalJobsAdded: 0,
        candidateJobsCreated: 2,
        pullRequestsCreated: 0,
        mergesPerformed: 0,
        deploymentsPerformed: 0,
        paymentsPerformed: 0,
        blockchainWritesPerformed: 0,
        durableLifecyclePersistence: true,
        attempt4Reused: false,
        fixtureCommitsReusedAfterExactPreflight: true,
      },
      outcome: persistablePilotOutcomeV2(outcome),
    };
    await writeEvidence(evidence);
    validateOutcome(outcome);
    expect(evidence.historicalAfter).toEqual(historicalBefore);
  }, 20 * 60 * 1_000);

  it.skipIf(!existingEvidence)("recomputes retained Attempt 5 V2 lifecycle evidence offline", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      gate: string;
      attemptId: string;
      outcome: ReputationEntryPilotOutcomeV2;
    };
    expect(evidence.gate).toBe(REPUTATION_ENTRY_PILOT);
    expect(evidence.attemptId).toBe(attemptId);
    validateOutcome(evidence.outcome);
    const store = new ReputationEntryDurableStore(databasePath, {
      historicalMarkerPath,
      readOnly: true,
    });
    try {
      const verification = store.verifyAll();
      expect(verification.valid).toBe(true);
      expect(verification.jobCount).toBe(2);
      expect(store.getRecord("PILOT_OUTCOME", batchRecordId, 2)?.payload).toMatchObject({
        schemaVersion: 2,
        attemptId,
        decision: evidence.outcome.decision,
      });
      for (const job of evidence.outcome.jobs) {
        const recovery = store.recoverJob(job.jobId);
        expect(recovery.integrityValid).toBe(true);
        expect(recovery.recordTypes).toEqual(expect.arrayContaining([
          "JOB_IDENTITY",
          "SOURCE_IDENTITY",
          "WORK_CONTRACT",
          "AUTHORITY_LEASE_ISSUED",
          "EXECUTION_IDENTITY",
          "AGENT_MODEL_REQUEST",
          "AGENT_MODEL_RUN",
          "REPAIR_SANDBOX_CLEANUP",
          "VERIFIER_RESULT",
          "VERIFIER_SANDBOX_CLEANUP",
          "AUTHORITY_LEASE_REVOKED",
          "DELIVERY_OUTCOME_EVALUATION",
          "EVIDENCE_BUNDLE_FINAL",
          "EVIDENCE_LEDGER_FINAL",
          "VERIFIED_JOB_RECEIPT",
          "PILOT_OUTCOME",
        ]));
        expect(store.getRecord("WORK_CONTRACT", job.contract.taskId, 2)?.payload).toEqual(job.contract);
        expect(store.getRecord("DELIVERY_OUTCOME_EVALUATION", `${job.jobId}:delivery-outcome`, 1)?.payload)
          .toEqual(job.outcomeEvaluation);
        expect(store.getRecord("VERIFIED_JOB_RECEIPT", job.receipt.id, 2)?.payload).toEqual(job.receipt);
        expect(() => assertReputationEntryCandidateJobV2Integrity(job)).not.toThrow();
      }
    } finally {
      store.close();
    }
    expect(readFileSync(evidencePath, "utf8")).not.toMatch(secretPattern());
  });
});

function validateOutcome(outcome: ReputationEntryPilotOutcomeV2): void {
  expect(outcome).toMatchObject({
    schemaVersion: 2,
    gate: REPUTATION_ENTRY_PILOT,
    attemptId,
    candidateStatus: "REPUTATION_ENTRY_CANDIDATE",
    corpus: {
      candidateJobCount: 2,
      canonicalQualifyingJobCountAdded: 0,
      taskTypes: ["TEST_AND_FIX", "BUILD_RESCUE"],
      identityContinuity: true,
      remainingGapBeforeOwnerPromotion: 20,
    },
    limits: {
      modelRequestLimit: 16,
      sandboxLimit: 4,
      sandboxesCreated: 4,
      deterministicCurrencyCapEnforcedByProvider: false,
      zeroPriceModelsOnly: true,
    },
  });
  expect(outcome.decision).toBe(outcome.corpus.eligibleCandidateJobCount === 2 ? "PASS" : "PARTIAL");
  expect(outcome.corpus.projectedGapAfterPromotion).toBe(20 - outcome.corpus.eligibleCandidateJobCount);
  expect(outcome.limits.modelRequestsUsed).toBeLessThanOrEqual(16);
  expect(outcome.jobs).toHaveLength(2);
  outcome.jobs.forEach((job) => {
    expect(() => assertReputationEntryCandidateJobV2Integrity(job)).not.toThrow();
    expect(job.contract.schemaVersion).toBe(2);
    expect(job.contract.deliveryOutcomePolicy.policy).toBe("INDEPENDENT_ACCEPTANCE_SUFFICIENT");
    expect(job.candidateEligible).toBe(job.outcomeEvaluation.deliveryOutcome === "VERIFIED_DELIVERY");
    expect(job.receipt.document.canonicalQualification.counted).toBe(false);
    expect(job.receipt.document.canonicalQualification.reputationEntered).toBe(false);
    expect(job.repairSandbox.cleanup.cleanupVerified).toBe(true);
    expect(job.independentVerification.cleanup.cleanupVerified).toBe(true);
    expect(job.terminalLease.status).toBe("REVOKED");
  });
  expect(outcome.jobs[0].agentProfile.profileSha256).toBe(outcome.jobs[1].agentProfile.profileSha256);
  expect(outcome.jobs[0].contract.commitSha).not.toBe(outcome.jobs[1].contract.commitSha);
  expect(outcome.jobs[0].contract.workContractSha256).not.toBe(outcome.jobs[1].contract.workContractSha256);
  expect(outcome.jobs[0].executionIdentity.executionId).not.toBe(outcome.jobs[1].executionIdentity.executionId);
  expect(outcome.jobs[0].independentVerification.sandboxId).not.toBe(outcome.jobs[0].repairSandbox.sandboxId);
  expect(outcome.jobs[1].independentVerification.sandboxId).not.toBe(outcome.jobs[1].repairSandbox.sandboxId);
}

function retainedPreflight() {
  if (!existsSync(preflightPath)) throw new Error("PHASE_B_ATTEMPT_5_PREFLIGHT_MISSING");
  const evidence = JSON.parse(readFileSync(preflightPath, "utf8"));
  expect(evidence).toMatchObject({
    attemptId,
    sources,
    preflight: {
      attemptId,
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
    },
    jobLifecycleStateCreated: false,
    modelRequestsPerformed: 0,
    managedSandboxesCreated: 0,
    externalMutationPerformedByPreflight: false,
  });
  expect(JSON.stringify(evidence)).not.toMatch(secretPattern());
  return evidence;
}

function historicalIdentity() {
  const artifacts = [
    path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-4.sqlite"),
    path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-4-evidence.json"),
    path.join(resultDirectory, "reputation-entry-phase-b-attempt-3.sqlite"),
    path.join(resultDirectory, "reputation-entry-phase-b-attempt-3-evidence.json"),
    path.join(resultDirectory, "reputation-entry-phase-b-attempt-3-source-preflight.json"),
    path.join(resultDirectory, "reputation-entry-phase-b-attempt-3-working-tree-identity.txt"),
    path.join(resultDirectory, "reputation-entry-phase-b-attempt-4-preflight.json"),
    path.join(workspaceRoot, "REPUTATION_ENTRY_PHASE_B_ATTEMPT_4_BLOCKED.md"),
    path.join(workspaceRoot, "VERIFIED_DELIVERY_V2_LIVE_ORCHESTRATOR_PRELIVE_REPORT.md"),
  ];
  return artifacts.map(fileIdentity);
}

async function writeEvidence(evidence: unknown): Promise<void> {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  expect(serialized).not.toMatch(secretPattern());
  await writeFile(evidencePath, serialized, "utf8");
}

function fileIdentity(filePath: string) {
  const bytes = readFileSync(filePath);
  return {
    fileName: path.basename(filePath),
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: message.split(":", 1)[0]!.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 100) || "UNKNOWN_FAILURE",
    message: message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 500),
  };
}

function requiredEnvironmentValue(name: string, pattern: RegExp): string {
  const value = process.env[name]?.trim() ?? "";
  if (!pattern.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function secretPattern(): RegExp {
  return /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\/i;
}
