import { describe, expect, it } from "vitest";

import {
  assertRealJobClassificationRecordIntegrity,
  classifyRealJob,
  createRealJobAuditQueueEntry,
  createRealJobClassificationRecord,
  decideExternalRealJobAuditBatch,
  recordExternalRealJobAuditDecision,
  type RealJobClassificationInput,
} from "../../apps/web/src/server/reputation-entry-pilot/real-job-classification";

const hash = "a".repeat(64);

describe("real Job classification policy", () => {
  it("automatically excludes a verified benchmark Fixture without owner review", () => {
    expect(classifyRealJob(job({ fixture: true, intentionallyManufacturedForTestingOrCorpus: true }))).toEqual({
      policy: "REAL_JOB_CLASSIFICATION_POLICY_V1",
      state: "BENCHMARK_FIXTURE",
      automaticClassification: "BENCHMARK_FIXTURE_VERIFIED_JOB",
      proposedAcceptedClassification: null,
      queueDisposition: "EXCLUDE",
      externalAuditRequired: false,
      canonicalCountContribution: 0,
      reasons: ["BENCHMARK_OR_FIXTURE_PURPOSE", "MANUFACTURED_FOR_TESTING_OR_CORPUS"],
    });
  });

  it("preserves a non-verified benchmark attempt as excluded", () => {
    expect(classifyRealJob(job({
      fixture: true,
      intentionallyManufacturedForTestingOrCorpus: true,
      deliveryOutcome: "INCONCLUSIVE",
      verificationOutcome: "NO_DELIVERABLE",
    }))).toMatchObject({
      state: "BENCHMARK_FIXTURE",
      automaticClassification: "NON_VERIFIED_BENCHMARK_ATTEMPT",
      canonicalCountContribution: 0,
    });
  });

  it("does not promote owner-requested work that would not exist without the corpus goal", () => {
    expect(classifyRealJob(job({
      origin: "OWNER",
      taskExistedIndependentlyOfReputation: false,
      usefulWithoutReputation: false,
    }))).toMatchObject({
      state: "BENCHMARK_FIXTURE",
      automaticClassification: "BENCHMARK_FIXTURE_VERIFIED_JOB",
      reasons: ["WORK_WOULD_NOT_BE_NEEDED_WITHOUT_REPUTATION_OR_CORPUS_GOAL"],
    });
  });

  it("classifies a clearly real owner Job as provisional with zero canonical contribution", () => {
    const result = classifyRealJob(job({ origin: "OWNER" }));
    expect(result).toMatchObject({
      state: "PROVISIONAL_REAL_JOB",
      proposedAcceptedClassification: "OWNER_REAL_VERIFIED_JOB",
      queueDisposition: "ENQUEUE",
      externalAuditRequired: true,
      canonicalCountContribution: 0,
    });
  });

  it("classifies a clearly real external Job as provisional", () => {
    expect(classifyRealJob(job({ origin: "EXTERNAL" }))).toMatchObject({
      state: "PROVISIONAL_REAL_JOB",
      proposedAcceptedClassification: "EXTERNAL_REAL_VERIFIED_JOB",
      canonicalCountContribution: 0,
    });
  });

  it("excludes a real-looking Job that lacks verified delivery or the full trust lifecycle", () => {
    expect(classifyRealJob(job({ deliveryOutcome: "FAILED", verificationOutcome: "FAILED" }))).toMatchObject({
      state: "NOT_VERIFIED",
      canonicalCountContribution: 0,
    });
    expect(classifyRealJob(job({ fullTrustLifecycleComplete: false }))).toMatchObject({
      state: "NOT_VERIFIED",
      reasons: ["FULL_TRUST_LIFECYCLE_INCOMPLETE"],
    });
  });

  it("queues genuinely ambiguous evidence without counting it", () => {
    const record = createRealJobClassificationRecord(job({
      origin: "UNKNOWN",
      taskExistedIndependentlyOfReputation: null,
      usefulWithoutReputation: null,
    }), "2026-09-06T01:00:00.000Z");
    expect(record.decision).toMatchObject({
      state: "AMBIGUOUS",
      queueDisposition: "ENQUEUE",
      canonicalCountContribution: 0,
    });
    expect(createRealJobAuditQueueEntry(record, "Requirement origin is not yet independently documented"))
      .toMatchObject({ preliminaryClassification: "AMBIGUOUS", jobId: "job-1" });
  });

  it("permits canonical contribution only after an accepted external audit", () => {
    const record = createRealJobClassificationRecord(job({ origin: "OWNER" }), "2026-09-06T01:00:00.000Z");
    assertRealJobClassificationRecordIntegrity(record);
    expect(recordExternalRealJobAuditDecision({
      record,
      auditDecision: "ACCEPT",
      auditedAt: "2026-09-06T02:00:00.000Z",
      auditAuthorityReference: "owner-audit-batch-1",
    })).toMatchObject({
      finalClassification: "OWNER_REAL_VERIFIED_JOB",
      canonicalCountContribution: 1,
    });
    expect(recordExternalRealJobAuditDecision({
      record,
      auditDecision: "REJECT",
      auditedAt: "2026-09-06T02:00:00.000Z",
      auditAuthorityReference: "owner-audit-batch-1",
    })).toMatchObject({ finalClassification: null, canonicalCountContribution: 0 });
  });

  it("refuses to externally promote benchmark and tampered records", () => {
    const benchmark = createRealJobClassificationRecord(job({ fixture: true }), "2026-09-06T01:00:00.000Z");
    expect(() => recordExternalRealJobAuditDecision({
      record: benchmark,
      auditDecision: "ACCEPT",
      auditedAt: "2026-09-06T02:00:00.000Z",
      auditAuthorityReference: "owner-audit-batch-1",
    })).toThrow("ONLY_PROVISIONAL_REAL_JOB_CAN_RECEIVE_CANONICAL_AUDIT_DECISION");
    const tampered = structuredClone(benchmark);
    tampered.input.fixture = false;
    expect(() => assertRealJobClassificationRecordIntegrity(tampered)).toThrow("REAL_JOB_CLASSIFICATION_RECORD_INVALID");
  });

  it("fails closed on unknown runtime values and extra fields", () => {
    expect(() => classifyRealJob({ ...job(), origin: "PARTNER" } as unknown as RealJobClassificationInput))
      .toThrow("REAL_JOB_ORIGIN_INVALID");
    expect(() => classifyRealJob({ ...job(), deliveryOutcome: "SUCCESS" } as unknown as RealJobClassificationInput))
      .toThrow("REAL_JOB_DELIVERY_OUTCOME_INVALID");
    expect(() => classifyRealJob({ ...job(), unexpected: true } as unknown as RealJobClassificationInput))
      .toThrow("REAL_JOB_CLASSIFICATION_INPUT_INVALID");
    expect(() => classifyRealJob({
      ...job(),
      hashes: { ...job().hashes, extra: hash },
    } as unknown as RealJobClassificationInput)).toThrow("REAL_JOB_CLASSIFICATION_HASH_SET_INVALID");
  });

  it("rejects unknown external audit decisions and malformed trigger inputs", () => {
    const record = createRealJobClassificationRecord(job(), "2026-09-06T01:00:00.000Z");
    expect(() => recordExternalRealJobAuditDecision({
      record,
      auditDecision: "AUTO_ACCEPT" as "ACCEPT",
      auditedAt: "2026-09-06T02:00:00.000Z",
      auditAuthorityReference: "owner-audit-batch-1",
    })).toThrow("REAL_JOB_EXTERNAL_AUDIT_DECISION_INVALID");
    expect(() => decideExternalRealJobAuditBatch({
      provisionalSincePreviousAudit: 0,
      pendingProvisionalRealJobs: 0,
      canonicalRealVerifiedJobCount: 0,
      majorCanonicalMilestoneCompleted: "false" as unknown as boolean,
      blockingAmbiguity: false,
    })).toThrow("REAL_JOB_AUDIT_INPUT_INVALID");
  });

  it("triggers external audit only at the approved batch boundaries", () => {
    expect(decideExternalRealJobAuditBatch({
      provisionalSincePreviousAudit: 4,
      pendingProvisionalRealJobs: 4,
      canonicalRealVerifiedJobCount: 0,
      majorCanonicalMilestoneCompleted: false,
      blockingAmbiguity: false,
    })).toEqual({ decision: "CONTINUE", reasons: [] });
    expect(decideExternalRealJobAuditBatch({
      provisionalSincePreviousAudit: 5,
      pendingProvisionalRealJobs: 5,
      canonicalRealVerifiedJobCount: 0,
      majorCanonicalMilestoneCompleted: false,
      blockingAmbiguity: false,
    }).decision).toBe("OWNER_DECISION_REQUIRED_EXTERNAL_REAL_JOB_AUDIT_BATCH");
    expect(decideExternalRealJobAuditBatch({
      provisionalSincePreviousAudit: 1,
      pendingProvisionalRealJobs: 1,
      canonicalRealVerifiedJobCount: 19,
      majorCanonicalMilestoneCompleted: false,
      blockingAmbiguity: false,
    }).reasons).toContain("CANONICAL_THRESHOLD_WOULD_OTHERWISE_APPEAR_REACHED");
    expect(decideExternalRealJobAuditBatch({
      provisionalSincePreviousAudit: 0,
      pendingProvisionalRealJobs: 0,
      canonicalRealVerifiedJobCount: 0,
      majorCanonicalMilestoneCompleted: true,
      blockingAmbiguity: false,
    }).reasons).toContain("MAJOR_CANONICAL_MILESTONE_COMPLETED");
  });
});

function job(overrides: Partial<RealJobClassificationInput> = {}): RealJobClassificationInput {
  return {
    jobId: "job-1",
    taskDescription: "Fix a real production defect",
    requirementSource: "owner roadmap requirement",
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
      workContractSha256: hash,
      evidenceBundleSha256: hash,
      receiptSha256: hash,
    },
    ...overrides,
  };
}
