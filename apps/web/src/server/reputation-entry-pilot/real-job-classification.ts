import { sha256Canonical } from "@donelayer/database";

import type {
  AgentExecutionOutcome,
  ContractDeliveryOutcome,
  ExecutionFailureAttribution,
  IndependentWorkVerificationOutcome,
  VerifiedDeliveryOutcomePolicyName,
} from "../verified-delivery-outcome/policy";

export const REAL_JOB_CLASSIFICATION_POLICY = "REAL_JOB_CLASSIFICATION_POLICY_V1" as const;
export const EXTERNAL_REAL_JOB_AUDIT_BATCH_SIZE = 5 as const;
export const CANONICAL_REAL_VERIFIED_JOB_THRESHOLD = 20 as const;

export const REAL_JOB_PRELIMINARY_STATES = [
  "BENCHMARK_FIXTURE",
  "NOT_VERIFIED",
  "PROVISIONAL_REAL_JOB",
  "AMBIGUOUS",
] as const;

export type RealJobPreliminaryState = typeof REAL_JOB_PRELIMINARY_STATES[number];
export type RealJobOrigin = "OWNER" | "EXTERNAL" | "UNKNOWN";
export type RealJobFinalClassification =
  | "BENCHMARK_FIXTURE_VERIFIED_JOB"
  | "NON_VERIFIED_BENCHMARK_ATTEMPT"
  | "NOT_VERIFIED"
  | "OWNER_REAL_VERIFIED_JOB"
  | "EXTERNAL_REAL_VERIFIED_JOB";

export type RealJobClassificationInput = {
  jobId: string;
  taskDescription: string;
  requirementSource: string;
  origin: RealJobOrigin;
  agentId: string;
  deliveryOutcome: ContractDeliveryOutcome;
  executionOutcome: AgentExecutionOutcome;
  executionFailureAttribution: ExecutionFailureAttribution;
  verificationOutcome: IndependentWorkVerificationOutcome;
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyName;
  fullTrustLifecycleComplete: boolean;
  requiredEvidenceCompleteAndValid: boolean;
  demo: boolean;
  seed: boolean;
  fixture: boolean;
  intentionallyManufacturedForTestingOrCorpus: boolean;
  taskExistedIndependentlyOfReputation: boolean | null;
  usefulWithoutReputation: boolean | null;
  hashes: {
    workContractSha256: string;
    evidenceBundleSha256: string;
    receiptSha256: string;
  };
};

export type RealJobPreliminaryDecision = {
  policy: typeof REAL_JOB_CLASSIFICATION_POLICY;
  state: RealJobPreliminaryState;
  automaticClassification: RealJobFinalClassification | null;
  proposedAcceptedClassification: Extract<
    RealJobFinalClassification,
    "OWNER_REAL_VERIFIED_JOB" | "EXTERNAL_REAL_VERIFIED_JOB"
  > | null;
  queueDisposition: "EXCLUDE" | "ENQUEUE";
  externalAuditRequired: boolean;
  canonicalCountContribution: 0;
  reasons: string[];
};

export type RealJobClassificationRecord = {
  schemaVersion: 1;
  recordType: "REAL_JOB_CLASSIFICATION_RECORD_V1";
  classifiedAt: string;
  input: RealJobClassificationInput;
  decision: RealJobPreliminaryDecision;
  classificationSha256: string;
};

export type RealJobAuditQueueEntry = {
  jobId: string;
  taskDescription: string;
  independentNeedRationale: string;
  requirementSource: string;
  agentId: string;
  deliveryOutcome: ContractDeliveryOutcome;
  executionOutcome: AgentExecutionOutcome;
  verificationOutcome: IndependentWorkVerificationOutcome;
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyName;
  fullTrustLifecycleComplete: boolean;
  demoSeedFixtureStatus: string;
  intentionallyManufacturedForTestingOrCorpus: boolean;
  preliminaryClassification: Extract<RealJobPreliminaryState, "PROVISIONAL_REAL_JOB" | "AMBIGUOUS">;
  proposedAcceptedClassification: RealJobPreliminaryDecision["proposedAcceptedClassification"];
  workContractSha256: string;
  evidenceBundleSha256: string;
  receiptSha256: string;
  classificationSha256: string;
};

export type ExternalRealJobAuditDecision = {
  jobId: string;
  auditDecision: "ACCEPT" | "REJECT";
  auditedAt: string;
  auditAuthorityReference: string;
  finalClassification: Extract<
    RealJobFinalClassification,
    "OWNER_REAL_VERIFIED_JOB" | "EXTERNAL_REAL_VERIFIED_JOB"
  > | null;
  canonicalCountContribution: 0 | 1;
};

export function classifyRealJob(input: RealJobClassificationInput): RealJobPreliminaryDecision {
  assertInput(input);
  const benchmarkReasons = benchmarkSignals(input);
  if (benchmarkReasons.length > 0) {
    return decision({
      state: "BENCHMARK_FIXTURE",
      automaticClassification: input.deliveryOutcome === "VERIFIED_DELIVERY"
        ? "BENCHMARK_FIXTURE_VERIFIED_JOB"
        : "NON_VERIFIED_BENCHMARK_ATTEMPT",
      queueDisposition: "EXCLUDE",
      externalAuditRequired: false,
      reasons: benchmarkReasons,
    });
  }

  if (input.deliveryOutcome !== "VERIFIED_DELIVERY") {
    return decision({
      state: "NOT_VERIFIED",
      automaticClassification: "NOT_VERIFIED",
      queueDisposition: "EXCLUDE",
      externalAuditRequired: false,
      reasons: ["DELIVERY_OUTCOME_NOT_VERIFIED_DELIVERY"],
    });
  }

  if (!input.fullTrustLifecycleComplete || !input.requiredEvidenceCompleteAndValid) {
    return decision({
      state: "NOT_VERIFIED",
      automaticClassification: "NOT_VERIFIED",
      queueDisposition: "EXCLUDE",
      externalAuditRequired: false,
      reasons: [
        ...(!input.fullTrustLifecycleComplete ? ["FULL_TRUST_LIFECYCLE_INCOMPLETE"] : []),
        ...(!input.requiredEvidenceCompleteAndValid ? ["REQUIRED_EVIDENCE_INCOMPLETE_OR_INVALID"] : []),
      ],
    });
  }

  if (
    input.taskExistedIndependentlyOfReputation === false ||
    input.usefulWithoutReputation === false
  ) {
    return decision({
      state: "BENCHMARK_FIXTURE",
      automaticClassification: "BENCHMARK_FIXTURE_VERIFIED_JOB",
      queueDisposition: "EXCLUDE",
      externalAuditRequired: false,
      reasons: ["WORK_WOULD_NOT_BE_NEEDED_WITHOUT_REPUTATION_OR_CORPUS_GOAL"],
    });
  }

  if (
    input.origin === "UNKNOWN" ||
    input.taskExistedIndependentlyOfReputation === null ||
    input.usefulWithoutReputation === null
  ) {
    return decision({
      state: "AMBIGUOUS",
      automaticClassification: null,
      queueDisposition: "ENQUEUE",
      externalAuditRequired: true,
      reasons: ["REAL_WORK_INDEPENDENCE_NOT_OBJECTIVELY_PROVEN"],
    });
  }

  return decision({
    state: "PROVISIONAL_REAL_JOB",
    automaticClassification: null,
    proposedAcceptedClassification: input.origin === "OWNER"
      ? "OWNER_REAL_VERIFIED_JOB"
      : "EXTERNAL_REAL_VERIFIED_JOB",
    queueDisposition: "ENQUEUE",
    externalAuditRequired: true,
    reasons: ["REAL_WORK_CRITERIA_PROVISIONALLY_SATISFIED", "EXTERNAL_AUDIT_REQUIRED_BEFORE_CANONICAL_COUNT"],
  });
}

export function createRealJobClassificationRecord(
  input: RealJobClassificationInput,
  classifiedAt: string,
): RealJobClassificationRecord {
  requiredIsoTimestamp(classifiedAt, "classifiedAt");
  const body = {
    schemaVersion: 1 as const,
    recordType: "REAL_JOB_CLASSIFICATION_RECORD_V1" as const,
    classifiedAt,
    input,
    decision: classifyRealJob(input),
  };
  return { ...body, classificationSha256: sha256Canonical(body) };
}

export function assertRealJobClassificationRecordIntegrity(record: RealJobClassificationRecord): void {
  const { classificationSha256, ...body } = record;
  if (
    !sameKeys(record, ["classificationSha256", "classifiedAt", "decision", "input", "recordType", "schemaVersion"]) ||
    record.schemaVersion !== 1 ||
    record.recordType !== "REAL_JOB_CLASSIFICATION_RECORD_V1" ||
    classificationSha256 !== sha256Canonical(body) ||
    sha256Canonical(record.decision) !== sha256Canonical(classifyRealJob(record.input))
  ) throw new Error("REAL_JOB_CLASSIFICATION_RECORD_INVALID");
  requiredIsoTimestamp(record.classifiedAt, "classifiedAt");
}

export function createRealJobAuditQueueEntry(
  record: RealJobClassificationRecord,
  independentNeedRationale: string,
): RealJobAuditQueueEntry {
  assertRealJobClassificationRecordIntegrity(record);
  if (record.decision.queueDisposition !== "ENQUEUE") {
    throw new Error("REAL_JOB_CLASSIFICATION_NOT_AUDIT_QUEUE_ELIGIBLE");
  }
  const preliminaryClassification = record.decision.state;
  if (preliminaryClassification !== "PROVISIONAL_REAL_JOB" && preliminaryClassification !== "AMBIGUOUS") {
    throw new Error("REAL_JOB_CLASSIFICATION_NOT_AUDIT_QUEUE_ELIGIBLE");
  }
  return {
    jobId: record.input.jobId,
    taskDescription: record.input.taskDescription,
    independentNeedRationale: requiredText(independentNeedRationale, "independentNeedRationale"),
    requirementSource: record.input.requirementSource,
    agentId: record.input.agentId,
    deliveryOutcome: record.input.deliveryOutcome,
    executionOutcome: record.input.executionOutcome,
    verificationOutcome: record.input.verificationOutcome,
    deliveryOutcomePolicy: record.input.deliveryOutcomePolicy,
    fullTrustLifecycleComplete: record.input.fullTrustLifecycleComplete,
    demoSeedFixtureStatus: record.input.demo
      ? "DEMO"
      : record.input.seed
        ? "SEED"
        : record.input.fixture
          ? "FIXTURE"
          : "NONE",
    intentionallyManufacturedForTestingOrCorpus: record.input.intentionallyManufacturedForTestingOrCorpus,
    preliminaryClassification,
    proposedAcceptedClassification: record.decision.proposedAcceptedClassification,
    workContractSha256: record.input.hashes.workContractSha256,
    evidenceBundleSha256: record.input.hashes.evidenceBundleSha256,
    receiptSha256: record.input.hashes.receiptSha256,
    classificationSha256: record.classificationSha256,
  };
}

export function recordExternalRealJobAuditDecision(input: {
  record: RealJobClassificationRecord;
  auditDecision: "ACCEPT" | "REJECT";
  auditedAt: string;
  auditAuthorityReference: string;
}): ExternalRealJobAuditDecision {
  assertRealJobClassificationRecordIntegrity(input.record);
  if (input.auditDecision !== "ACCEPT" && input.auditDecision !== "REJECT") {
    throw new Error("REAL_JOB_EXTERNAL_AUDIT_DECISION_INVALID");
  }
  if (input.record.decision.state !== "PROVISIONAL_REAL_JOB") {
    throw new Error("ONLY_PROVISIONAL_REAL_JOB_CAN_RECEIVE_CANONICAL_AUDIT_DECISION");
  }
  requiredIsoTimestamp(input.auditedAt, "auditedAt");
  requiredText(input.auditAuthorityReference, "auditAuthorityReference");
  const accepted = input.auditDecision === "ACCEPT";
  return {
    jobId: input.record.input.jobId,
    auditDecision: input.auditDecision,
    auditedAt: input.auditedAt,
    auditAuthorityReference: input.auditAuthorityReference,
    finalClassification: accepted ? input.record.decision.proposedAcceptedClassification : null,
    canonicalCountContribution: accepted ? 1 : 0,
  };
}

export function decideExternalRealJobAuditBatch(input: {
  provisionalSincePreviousAudit: number;
  pendingProvisionalRealJobs: number;
  canonicalRealVerifiedJobCount: number;
  majorCanonicalMilestoneCompleted: boolean;
  blockingAmbiguity: boolean;
}): {
  decision: "CONTINUE" | "OWNER_DECISION_REQUIRED_EXTERNAL_REAL_JOB_AUDIT_BATCH";
  reasons: string[];
} {
  if (!sameKeys(input, [
    "blockingAmbiguity",
    "canonicalRealVerifiedJobCount",
    "majorCanonicalMilestoneCompleted",
    "pendingProvisionalRealJobs",
    "provisionalSincePreviousAudit",
  ])) throw new Error("REAL_JOB_AUDIT_INPUT_INVALID");
  if (
    typeof input.majorCanonicalMilestoneCompleted !== "boolean" ||
    typeof input.blockingAmbiguity !== "boolean"
  ) throw new Error("REAL_JOB_AUDIT_INPUT_INVALID");
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`REAL_JOB_AUDIT_${name.toUpperCase()}_INVALID`);
    }
  }
  const reasons = [
    ...(input.provisionalSincePreviousAudit >= EXTERNAL_REAL_JOB_AUDIT_BATCH_SIZE
      ? ["FIVE_PROVISIONAL_REAL_JOBS_ACCUMULATED"]
      : []),
    ...(input.majorCanonicalMilestoneCompleted ? ["MAJOR_CANONICAL_MILESTONE_COMPLETED"] : []),
    ...(input.canonicalRealVerifiedJobCount + input.pendingProvisionalRealJobs >= CANONICAL_REAL_VERIFIED_JOB_THRESHOLD
      ? ["CANONICAL_THRESHOLD_WOULD_OTHERWISE_APPEAR_REACHED"]
      : []),
    ...(input.blockingAmbiguity ? ["AMBIGUITY_AFFECTS_SAFETY_TRUST_OR_NEXT_EXECUTION"] : []),
  ];
  return {
    decision: reasons.length > 0
      ? "OWNER_DECISION_REQUIRED_EXTERNAL_REAL_JOB_AUDIT_BATCH"
      : "CONTINUE",
    reasons,
  };
}

function benchmarkSignals(input: RealJobClassificationInput): string[] {
  return [
    ...(input.demo ? ["DEMO_EXCLUDED"] : []),
    ...(input.seed ? ["SEED_EXCLUDED"] : []),
    ...(input.fixture ? ["BENCHMARK_OR_FIXTURE_PURPOSE"] : []),
    ...(input.intentionallyManufacturedForTestingOrCorpus ? ["MANUFACTURED_FOR_TESTING_OR_CORPUS"] : []),
  ];
}

function decision(input: {
  state: RealJobPreliminaryState;
  automaticClassification: RealJobFinalClassification | null;
  proposedAcceptedClassification?: RealJobPreliminaryDecision["proposedAcceptedClassification"];
  queueDisposition: "EXCLUDE" | "ENQUEUE";
  externalAuditRequired: boolean;
  reasons: string[];
}): RealJobPreliminaryDecision {
  return {
    policy: REAL_JOB_CLASSIFICATION_POLICY,
    state: input.state,
    automaticClassification: input.automaticClassification,
    proposedAcceptedClassification: input.proposedAcceptedClassification ?? null,
    queueDisposition: input.queueDisposition,
    externalAuditRequired: input.externalAuditRequired,
    canonicalCountContribution: 0,
    reasons: input.reasons,
  };
}

function assertInput(input: RealJobClassificationInput): void {
  if (!sameKeys(input, [
    "agentId",
    "deliveryOutcome",
    "deliveryOutcomePolicy",
    "demo",
    "executionFailureAttribution",
    "executionOutcome",
    "fixture",
    "fullTrustLifecycleComplete",
    "hashes",
    "intentionallyManufacturedForTestingOrCorpus",
    "jobId",
    "origin",
    "requiredEvidenceCompleteAndValid",
    "requirementSource",
    "seed",
    "taskDescription",
    "taskExistedIndependentlyOfReputation",
    "usefulWithoutReputation",
    "verificationOutcome",
  ])) throw new Error("REAL_JOB_CLASSIFICATION_INPUT_INVALID");
  requiredText(input.jobId, "jobId");
  requiredText(input.taskDescription, "taskDescription");
  requiredText(input.requirementSource, "requirementSource");
  requiredText(input.agentId, "agentId");
  if (!(["OWNER", "EXTERNAL", "UNKNOWN"] as const).includes(input.origin)) {
    throw new Error("REAL_JOB_ORIGIN_INVALID");
  }
  if (!(["VERIFIED_DELIVERY", "FAILED", "INCONCLUSIVE", "BLOCKED"] as const).includes(input.deliveryOutcome)) {
    throw new Error("REAL_JOB_DELIVERY_OUTCOME_INVALID");
  }
  if (!(["COMPLETED", "FAILED", "INCONCLUSIVE", "TIMEOUT", "PROVIDER_FAILURE"] as const).includes(input.executionOutcome)) {
    throw new Error("REAL_JOB_EXECUTION_OUTCOME_INVALID");
  }
  if (!(["NOT_APPLICABLE", "AGENT", "MODEL_PROVIDER", "INFRASTRUCTURE", "UNKNOWN"] as const).includes(input.executionFailureAttribution)) {
    throw new Error("REAL_JOB_EXECUTION_FAILURE_ATTRIBUTION_INVALID");
  }
  if (!(["VERIFIED", "FAILED", "INCONCLUSIVE", "INVALID_EVIDENCE", "NO_DELIVERABLE"] as const).includes(input.verificationOutcome)) {
    throw new Error("REAL_JOB_VERIFICATION_OUTCOME_INVALID");
  }
  if (!(["EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED", "INDEPENDENT_ACCEPTANCE_SUFFICIENT"] as const).includes(input.deliveryOutcomePolicy)) {
    throw new Error("REAL_JOB_DELIVERY_POLICY_INVALID");
  }
  const booleanValues = [
    input.fullTrustLifecycleComplete,
    input.requiredEvidenceCompleteAndValid,
    input.demo,
    input.seed,
    input.fixture,
    input.intentionallyManufacturedForTestingOrCorpus,
  ];
  if (booleanValues.some((value) => typeof value !== "boolean")) {
    throw new Error("REAL_JOB_CLASSIFICATION_BOOLEAN_INVALID");
  }
  if (
    ![true, false, null].includes(input.taskExistedIndependentlyOfReputation) ||
    ![true, false, null].includes(input.usefulWithoutReputation)
  ) throw new Error("REAL_JOB_CLASSIFICATION_INDEPENDENCE_INVALID");
  if (!sameKeys(input.hashes, ["evidenceBundleSha256", "receiptSha256", "workContractSha256"])) {
    throw new Error("REAL_JOB_CLASSIFICATION_HASH_SET_INVALID");
  }
  for (const [name, value] of Object.entries(input.hashes)) {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`REAL_JOB_${name.toUpperCase()}_INVALID`);
  }
}

function requiredText(value: string, name: string): string {
  if (!value.trim()) throw new Error(`REAL_JOB_${name.toUpperCase()}_REQUIRED`);
  return value.trim();
}

function requiredIsoTimestamp(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`REAL_JOB_${name.toUpperCase()}_INVALID`);
  }
}

function sameKeys(value: object, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}
