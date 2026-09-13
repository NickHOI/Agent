import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertReputationEntryCandidateJobIntegrity,
  type ReputationEntryCandidateJob,
} from "../../apps/web/src/server/reputation-entry-pilot/candidate-evidence";
import {
  persistablePilotOutcome,
  ReputationEntryPilotOrchestrator,
  type ReputationEntryPilotOutcome,
} from "../../apps/web/src/server/reputation-entry-pilot/orchestrator";
import { ReputationEntryDurableStore } from "../../apps/web/src/server/reputation-entry-pilot/durable-store";
import { runReputationEntryPhaseBPreflight } from "../../apps/web/src/server/reputation-entry-pilot/phase-b-preflight";
import { runReputationEntrySourcePreflight } from "../../apps/web/src/server/reputation-entry-pilot/source-preflight";
import { REPUTATION_ENTRY_PILOT } from "../../apps/web/src/server/reputation-entry-pilot/work-contract";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const runningAttempt3 = process.env.RUN_REPUTATION_ENTRY_PHASE_B_ATTEMPT_3 === "true";
const useAttempt3 = runningAttempt3;
const attemptId = useAttempt3 ? "PHASE_B_ATTEMPT_3" : "PHASE_B_ATTEMPT_2";
const attemptSlug = useAttempt3 ? "attempt-3" : "attempt-2";
const evidencePath = path.join(resultDirectory, `reputation-entry-phase-b-${attemptSlug}-evidence.json`);
const databasePath = path.join(resultDirectory, `reputation-entry-phase-b-${attemptSlug}.sqlite`);
const sourcePreflightPath = path.join(resultDirectory, `reputation-entry-phase-b-${attemptSlug}-source-preflight.json`);
const attemptMarkerPath = path.join(resultDirectory, "reputation-entry-pilot-attempt-1-recovered.json");
const phaseAPreflightPath = path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-4.sqlite");
const phaseAEvidencePath = path.join(resultDirectory, "reputation-entry-persistence-preflight-attempt-4-evidence.json");
const phaseBAttempt1DatabasePath = path.join(resultDirectory, "reputation-entry-replacement-phase-b.sqlite");
const phaseBAttempt1IdentityPath = path.join(resultDirectory, "reputation-entry-replacement-phase-b-working-tree-identity.txt");
const phaseBAttempt1ReportPath = path.join(workspaceRoot, "REPUTATION_ENTRY_PHASE_B_ATTEMPT_1_BLOCKED.md");
const phaseBAttempt2DatabasePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-2.sqlite");
const phaseBAttempt2SourcePreflightPath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-2-source-preflight.json");
const phaseBAttempt2IdentityPath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-2-working-tree-identity.txt");
const phaseBAttempt2ReportPath = path.join(workspaceRoot, "REPUTATION_ENTRY_PHASE_B_ATTEMPT_2_BLOCKED.md");
const persistEvidence = process.env.RUN_REPUTATION_ENTRY_PHASE_B_ATTEMPT_2 === "true" || runningAttempt3;
const existingEvidence = existsSync(evidencePath) && existsSync(databasePath);

describe("two-Job Reputation entry corpus collection pilot", () => {
  it.skipIf(!persistEvidence)("runs exactly two distinct candidate Jobs with fresh independent verification", async () => {
    await mkdir(resultDirectory, { recursive: true });
    if (existsSync(sourcePreflightPath) || existsSync(evidencePath) || existsSync(databasePath)) {
      throw new Error(`REPUTATION_ENTRY_${attemptId}_EVIDENCE_ALREADY_EXISTS: refusing to overwrite ${attemptId}`);
    }
    if (
      !existsSync(attemptMarkerPath) ||
      !existsSync(phaseAPreflightPath) ||
      !existsSync(phaseAEvidencePath) ||
      !existsSync(phaseBAttempt1DatabasePath) ||
      !existsSync(phaseBAttempt1IdentityPath) ||
      !existsSync(phaseBAttempt1ReportPath) ||
      (useAttempt3 && (
        !existsSync(phaseBAttempt2DatabasePath) ||
        !existsSync(phaseBAttempt2SourcePreflightPath) ||
        !existsSync(phaseBAttempt2IdentityPath) ||
        !existsSync(phaseBAttempt2ReportPath)
      ))
    ) {
      throw new Error("REPUTATION_ENTRY_ACCEPTED_HISTORY_MISSING");
    }
    const historicalEvidenceBefore = historicalEvidenceIdentity();
    const sources = [
      {
        taskType: "TEST_AND_FIX" as const,
        branch: "donelayer/repair/reputation-state-transition-v2",
        commitSha: requiredCommit("REPUTATION_TEST_AND_FIX_COMMIT"),
      },
      {
        taskType: "BUILD_RESCUE" as const,
        branch: "donelayer/repair/reputation-build-config-v2",
        commitSha: requiredCommit("REPUTATION_BUILD_RESCUE_COMMIT"),
      },
    ];
    const sourcePreflight = useAttempt3
      ? await runReputationEntryPhaseBPreflight({
        attemptId,
        sources,
        linkedProject: linkedVercelProject(),
      })
      : await runReputationEntrySourcePreflight({ attemptId, sources });
    const preflightSerialized = `${JSON.stringify(sourcePreflight, null, 2)}\n`;
    expect(preflightSerialized).not.toMatch(secretPattern());
    await writeFile(sourcePreflightPath, preflightSerialized, "utf8");
    if (sourcePreflight.status !== "PASS") {
      throw new Error(`${attemptId}_PREFLIGHT_BLOCKED: ${sourcePreflight.failure?.message ?? "unknown failure"}`);
    }
    if (useAttempt3 && "provider" in sourcePreflight) {
      expect(sourcePreflight.checks).toMatchObject({
        oidcStructurallyValid: true,
        oidcBoundToLinkedProject: true,
        oidcNotExpired: true,
        gatewayCatalogAvailable: true,
        exactCommitsMaterialized: true,
        temporaryWorkspacesCleaned: true,
        externalMutationPerformed: false,
        jobLifecycleStateCreated: false,
      });
      expect(sourcePreflight.source.results).toHaveLength(2);
      expect(sourcePreflight.provider).toMatchObject({
        checkType: "READ_ONLY_NON_MODEL_CATALOG_PREFLIGHT",
        modelRequestsPerformed: false,
        externalMutationPerformed: false,
      });
    } else if ("results" in sourcePreflight) {
      expect(sourcePreflight.results).toHaveLength(2);
      expect(sourcePreflight.checks).toEqual({
        exactRepositoryReachable: true,
        approvedRefsResolved: true,
        exactCommitsMaterialized: true,
        temporaryWorkspacesCleaned: true,
        remoteMutationPerformed: false,
      });
    } else {
      throw new Error(`${attemptId}_PREFLIGHT_SHAPE_INVALID`);
    }
    expect(existsSync(databasePath)).toBe(false);
    const store = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: attemptMarkerPath });
    let outcome: ReputationEntryPilotOutcome;
    try {
      outcome = await new ReputationEntryPilotOrchestrator(store, {
        attemptId,
        batchRecordId: `phase-b-${attemptSlug}-batch`,
      }).run(sources);
    } finally {
      store.close();
    }
    expect(historicalEvidenceIdentity()).toEqual(historicalEvidenceBefore);
    const evidence = {
      gate: REPUTATION_ENTRY_PILOT,
      attemptId,
      capturedAt: new Date().toISOString(),
      host: { hostname: hostname(), os: `${platform()} ${release()}`, nodeVersion: process.version },
      doneLayerIdentity: {
        headCommit: process.env.REPUTATION_ENTRY_HEAD_COMMIT ?? "UNRECORDED",
        workingTreeSha256: process.env.REPUTATION_ENTRY_WORKTREE_SHA256 ?? "UNRECORDED",
      },
      proofBoundary: {
        canonicalReputationStarted: false,
        canonicalJobsAdded: 0,
        candidateJobsCreated: 2,
        fixtureBranchesPrepared: 2,
        pullRequestsCreated: 0,
        mergesPerformed: 0,
        deploymentsPerformed: 0,
        paymentsPerformed: 0,
        blockchainWritesPerformed: 0,
        durableLifecyclePersistence: true,
        phaseAAttempt4Accepted: true,
        phaseBAttempt1HistoricalFailBlocked: true,
        phaseBAttempt2HistoricalFailBlocked: useAttempt3,
      },
      agentIdentityDecision: {
        previousAttemptAgentId: useAttempt3 ? "agt_y0YpqbaLJrNMZ9g2-t5ewPBe" : "agt_dcZX-ngYijOoEQF17VQJqPTc",
        previousAttemptProfileReused: false,
        reason: `${useAttempt3 ? "Attempt 2" : "Attempt 1"} stored the profile only inside its batch database; no independent durable platform registry proved a current non-superseded state.`,
      },
      sourcePreflight: fileIdentity(sourcePreflightPath),
      historicalEvidenceBefore,
      durableDatabase: fileIdentity(databasePath),
      outcome: persistablePilotOutcome(outcome),
    };
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    expect(serialized).not.toMatch(secretPattern());
    await writeFile(evidencePath, serialized, "utf8");
    validateOutcome(outcome);
  }, 20 * 60 * 1_000);

  it.skipIf(!persistEvidence && !existingEvidence)("recomputes the persisted candidate bundles, Ledgers, Receipts, and limits offline", () => {
    if (!existsSync(evidencePath) || !existsSync(databasePath)) return;
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as { gate: string; outcome: ReputationEntryPilotOutcome };
    expect(evidence.gate).toBe(REPUTATION_ENTRY_PILOT);
    expect(evidence.outcome.attemptId).toBe(attemptId);
    validateOutcome(evidence.outcome);
    const store = new ReputationEntryDurableStore(databasePath, { historicalMarkerPath: attemptMarkerPath });
    try {
      const verification = store.verifyAll();
      expect(verification.valid).toBe(true);
      expect(verification.jobCount).toBe(2);
      expect(store.getRecord("AGENT_PROFILE", `${evidence.outcome.agentProfile.agentId}:${evidence.outcome.agentProfile.revision}`)).not.toBeNull();
      expect(store.getRecord("PILOT_OUTCOME", `phase-b-${attemptSlug}-batch`, 2)?.payload).toMatchObject({
        gate: REPUTATION_ENTRY_PILOT,
        attemptId,
        decision: "PASS",
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
          "EVIDENCE_BUNDLE_INTERMEDIATE",
          "AGENT_SANDBOX_STARTED",
          "BASELINE_FAILURE",
          "AGENT_MODEL_REQUEST",
          "AGENT_MODEL_RUN",
          "AGENT_TOOL_CALL",
          "SOURCE_PATCH",
          "REPAIR_SOURCE_INTEGRITY",
          "REPAIR_SANDBOX_CLEANUP",
          "VERIFIER_SANDBOX_STARTED",
          "VERIFIER_COMMAND",
          "VERIFIER_RESULT",
          "VERIFIER_SANDBOX_CLEANUP",
          "AUTHORITY_LEASE_REVOKED",
          "EVIDENCE_ARTIFACTS",
          "EVIDENCE_BUNDLE_FINAL",
          "EVIDENCE_LEDGER_FINAL",
          "VERIFIED_JOB_RECEIPT",
          "PILOT_OUTCOME",
        ]));
        expect(store.getRecord("AUTHORITY_LEASE_REVOKED", job.terminalLease.id, 2)?.payload).toMatchObject({ status: "REVOKED" });
        expect(store.getRecord("VERIFIED_JOB_RECEIPT", job.receipt.id)?.payload).toMatchObject({ receiptSha256: job.receipt.receiptSha256 });
        const persisted = store.getRecord("PILOT_OUTCOME", `${job.jobId}:candidate-outcome`)?.payload as ReputationEntryCandidateJob;
        expect(() => assertReputationEntryCandidateJobIntegrity(persisted)).not.toThrow();
      }
    } finally {
      store.close();
    }
    expect(readFileSync(evidencePath, "utf8")).not.toMatch(secretPattern());
  });
});

function validateOutcome(outcome: ReputationEntryPilotOutcome): void {
  expect(outcome).toMatchObject({
    gate: REPUTATION_ENTRY_PILOT,
    attemptId,
    decision: "PASS",
    candidateStatus: "REPUTATION_ENTRY_CANDIDATE",
    corpus: {
      candidateJobCount: 2,
      verifiedCandidateJobCount: 2,
      canonicalQualifyingJobCountAdded: 0,
      taskTypes: ["TEST_AND_FIX", "BUILD_RESCUE"],
      identityContinuity: true,
      remainingGapBeforeOwnerPromotion: 20,
      projectedGapAfterPromotion: 18,
    },
    limits: {
      modelRequestLimit: 16,
      sandboxLimit: 4,
      sandboxesCreated: 4,
      deterministicCurrencyCapEnforcedByProvider: false,
      zeroPriceModelsOnly: true,
    },
  });
  expect(outcome.limits.modelRequestsUsed).toBeLessThanOrEqual(16);
  expect(outcome.jobs).toHaveLength(2);
  outcome.jobs.forEach((job) => {
    expect(() => assertReputationEntryCandidateJobIntegrity(job as ReputationEntryCandidateJob)).not.toThrow();
    expect(job.result).toBe("VERIFIED");
    expect(job.candidateStatus).toBe("REPUTATION_ENTRY_CANDIDATE");
    expect(job.receipt.document.canonicalQualification.counted).toBe(false);
    expect(job.independentVerification.freshSandbox).toBe(true);
    expect(job.independentVerification.verified).toBe(true);
    expect(job.repairSandbox.cleanup.cleanupVerified).toBe(true);
    expect(job.independentVerification.cleanup.cleanupVerified).toBe(true);
  });
  expect(outcome.jobs[0].agentProfile.profileSha256).toBe(outcome.jobs[1].agentProfile.profileSha256);
  expect(outcome.jobs[0].contract.commitSha).not.toBe(outcome.jobs[1].contract.commitSha);
  expect(outcome.jobs[0].contract.workContractSha256).not.toBe(outcome.jobs[1].contract.workContractSha256);
  expect(outcome.jobs[0].independentVerification.sandboxId).not.toBe(outcome.jobs[0].repairSandbox.sandboxId);
  expect(outcome.jobs[1].independentVerification.sandboxId).not.toBe(outcome.jobs[1].repairSandbox.sandboxId);
}

function requiredCommit(name: string): string {
  const value = process.env[name]?.toLowerCase() ?? "";
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

function secretPattern(): RegExp {
  return /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\user/i;
}

function historicalEvidenceIdentity() {
  const acceptedHistory = {
    failedPilotMarker: fileIdentity(attemptMarkerPath),
    acceptedPhaseADatabase: fileIdentity(phaseAPreflightPath),
    acceptedPhaseAEvidence: fileIdentity(phaseAEvidencePath),
    phaseBAttempt1Database: fileIdentity(phaseBAttempt1DatabasePath),
    phaseBAttempt1WorkingTreeIdentity: fileIdentity(phaseBAttempt1IdentityPath),
    phaseBAttempt1BlockerReport: fileIdentity(phaseBAttempt1ReportPath),
  };
  return useAttempt3 ? {
    ...acceptedHistory,
    phaseBAttempt2Database: fileIdentity(phaseBAttempt2DatabasePath),
    phaseBAttempt2SourcePreflight: fileIdentity(phaseBAttempt2SourcePreflightPath),
    phaseBAttempt2WorkingTreeIdentity: fileIdentity(phaseBAttempt2IdentityPath),
    phaseBAttempt2BlockerReport: fileIdentity(phaseBAttempt2ReportPath),
  } : acceptedHistory;
}

function linkedVercelProject() {
  const linked = JSON.parse(readFileSync(path.join(workspaceRoot, ".vercel", "project.json"), "utf8")) as {
    projectId?: string;
    orgId?: string;
    projectName?: string;
  };
  if (!linked.projectId || !linked.orgId || linked.projectName !== "donelayer") {
    throw new Error("PHASE_B_ATTEMPT_3_LINKED_PROJECT_INVALID");
  }
  return { projectName: linked.projectName, projectId: linked.projectId, orgId: linked.orgId, environment: "development" as const };
}

function fileIdentity(filePath: string): { fileName: string; size: number; sha256: string } {
  const bytes = readFileSync(filePath);
  return {
    fileName: path.basename(filePath),
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
