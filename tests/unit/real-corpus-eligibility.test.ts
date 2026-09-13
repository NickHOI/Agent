import { describe, expect, it } from "vitest";

import {
  assertRealCorpusProjectionIntegrity,
  projectRealCorpus,
  type RealCorpusCandidate,
} from "../../apps/web/src/server/reputation-entry-pilot/real-corpus-eligibility";
import {
  createRealJobClassificationRecord,
  recordExternalRealJobAuditDecision,
  type RealJobClassificationInput,
} from "../../apps/web/src/server/reputation-entry-pilot/real-job-classification";

describe("real corpus eligibility projection", () => {
  it("counts one externally accepted active real Job", () => {
    const projection = projectRealCorpus([candidate(1)]);

    expect(projection).toMatchObject({
      policy: "REAL_CORPUS_ELIGIBILITY_RULES_V1",
      canonicalRealVerifiedJobCount: 1,
      activeTaskTypes: ["TEST_AND_FIX"],
      idempotentReplayCount: 0,
      quarantinedEntryCount: 0,
    });
    expect(projection.entries[0]).toMatchObject({
      status: "ACTIVE",
      canonicalCountContribution: 1,
    });
    expect(projection.projectionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertRealCorpusProjectionIntegrity(projection)).not.toThrow();
  });

  it("collapses an exact replay without incrementing the active count", () => {
    const first = candidate(1);
    const projection = projectRealCorpus([first, structuredClone(first)]);

    expect(projection.canonicalRealVerifiedJobCount).toBe(1);
    expect(projection.idempotentReplayCount).toBe(1);
    expect(projection.entries[1]).toMatchObject({
      status: "IDEMPOTENT_REPLAY",
      canonicalCountContribution: 0,
      reasons: ["EXACT_CANDIDATE_REPLAY"],
    });
  });

  it("quarantines conflicting accepted entries that reuse a corpus identity", () => {
    const first = candidate(1);
    const second = candidate(2, { requirementIdentitySha256: first.requirementIdentitySha256 });
    const projection = projectRealCorpus([first, second]);

    expect(projection.canonicalRealVerifiedJobCount).toBe(0);
    expect(projection.quarantinedEntryCount).toBe(2);
    expect(projection.entries.every((entry) => entry.status === "QUARANTINED")).toBe(true);
  });

  it.each([
    [{ receiptIntegrityValid: false }, "EXCLUDED", "RECEIPT_INTEGRITY_INVALID"],
    [{ taskTypeBoundInWorkContract: false }, "EXCLUDED", "TASK_TYPE_NOT_BOUND_BEFORE_EXECUTION"],
    [{ corpusStatus: "REVOKED" }, "EXCLUDED", "CORPUS_ENTRY_REVOKED"],
    [{ corpusStatus: "SUPERSEDED" }, "EXCLUDED", "CORPUS_ENTRY_SUPERSEDED"],
    [{ contaminationStatus: "QUARANTINED" }, "QUARANTINED", "CONTAMINATION_REVIEW_PENDING"],
    [{ contaminationStatus: "CONFIRMED" }, "EXCLUDED", "CONTAMINATION_CONFIRMED"],
  ] as const)("fails closed for inactive or unsafe corpus state %#", (override, status, reason) => {
    const projection = projectRealCorpus([candidate(1, override)]);

    expect(projection.canonicalRealVerifiedJobCount).toBe(0);
    expect(projection.entries[0]).toMatchObject({ status, canonicalCountContribution: 0 });
    expect(projection.entries[0]?.reasons).toContain(reason);
  });

  it("reports only task types represented by active unique entries", () => {
    const projection = projectRealCorpus([
      candidate(1),
      candidate(2, { taskType: "BUILD_RESCUE" }),
      candidate(3, { corpusStatus: "REVOKED", taskType: "DATABASE_MIGRATION" }),
    ]);

    expect(projection.canonicalRealVerifiedJobCount).toBe(2);
    expect(projection.activeTaskTypes).toEqual(["BUILD_RESCUE", "TEST_AND_FIX"]);
  });

  it("rejects a tampered external audit decision", () => {
    const input = candidate(1);
    input.auditDecision.finalClassification = "EXTERNAL_REAL_VERIFIED_JOB";

    expect(() => projectRealCorpus([input])).toThrow("REAL_CORPUS_AUDIT_DECISION_INVALID");
  });

  it("rejects a tampered corpus projection", () => {
    const projection = projectRealCorpus([candidate(1)]);
    projection.canonicalRealVerifiedJobCount = 2;

    expect(() => assertRealCorpusProjectionIntegrity(projection)).toThrow("REAL_CORPUS_PROJECTION_INVALID");
  });
});

function candidate(
  sequence: number,
  overrides: Partial<RealCorpusCandidate> = {},
): RealCorpusCandidate {
  const classificationRecord = createRealJobClassificationRecord(
    job(sequence),
    `2026-09-13T01:00:${String(sequence).padStart(2, "0")}.000Z`,
  );
  const auditDecision = recordExternalRealJobAuditDecision({
    record: classificationRecord,
    auditDecision: "ACCEPT",
    auditedAt: `2026-09-13T02:00:${String(sequence).padStart(2, "0")}.000Z`,
    auditAuthorityReference: `external-audit-${sequence}`,
  });
  return {
    classificationRecord,
    auditDecision,
    taskType: "TEST_AND_FIX",
    taskTypeBoundInWorkContract: true,
    requirementIdentitySha256: digest(sequence, "b"),
    deliveryIdentitySha256: digest(sequence, "c"),
    receiptIntegrityValid: true,
    corpusStatus: "ACTIVE",
    contaminationStatus: "CLEAR",
    ...overrides,
  };
}

function job(sequence: number): RealJobClassificationInput {
  return {
    jobId: `job-${sequence}`,
    taskDescription: `Fix independently required defect ${sequence}`,
    requirementSource: `owner-roadmap-item-${sequence}`,
    origin: "OWNER",
    agentId: "agt_test",
    deliveryOutcome: "VERIFIED_DELIVERY",
    executionOutcome: "COMPLETED",
    executionFailureAttribution: "NOT_APPLICABLE",
    verificationOutcome: "VERIFIED",
    deliveryOutcomePolicy: "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
    fullTrustLifecycleComplete: true,
    requiredEvidenceCompleteAndValid: true,
    demo: false,
    seed: false,
    fixture: false,
    intentionallyManufacturedForTestingOrCorpus: false,
    taskExistedIndependentlyOfReputation: true,
    usefulWithoutReputation: true,
    hashes: {
      workContractSha256: digest(sequence, "d"),
      evidenceBundleSha256: digest(sequence, "e"),
      receiptSha256: digest(sequence, "f"),
    },
  };
}

function digest(sequence: number, character: string): string {
  return `${sequence.toString(16).padStart(2, "0")}${character.repeat(62)}`;
}
