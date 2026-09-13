import { canonicalJson, sha256Canonical, type PublicJobReceipt } from "@donelayer/database";

import {
  REPUTATION_ENTRY_CANDIDATE_STATUS,
  REPUTATION_ENTRY_REQUIRED_EVIDENCE,
  assertReputationEntryWorkContractV2Integrity,
  evaluateReputationEntryDeliveryOutcome,
  type ReputationEntryTaskType,
  type ReputationEntryWorkContractV2,
} from "./work-contract";
import {
  verifyReputationEntryLedger,
  type ReputationEntryCandidateJob,
  type ReputationEntryLedgerVerification,
} from "./candidate-evidence";
import { assertAgentIdentityProfileIntegrity } from "../agent-identity/agent-identity";
import { assertAgentExecutionBinding } from "../agent-identity/execution-identity";
import {
  assertAuthorityDecisionIntegrity,
  assertTaskScopedPermissionLeaseIntegrity,
} from "../task-scoped-authority/task-scoped-authority";
import type {
  VerifiedDeliveryOutcomeEvaluation,
  VerifiedDeliveryOutcomePolicyV1,
  VerifiedDeliveryTrustChecks,
} from "../verified-delivery-outcome/policy";

export const VERIFIED_DELIVERY_OUTCOME_POLICY_GATE = "VERIFIED_DELIVERY_OUTCOME_POLICY_V1_DESIGN_AND_EVIDENCE_GATE" as const;
export const REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_TYPE = "REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2" as const;
export const REPUTATION_ENTRY_OUTCOME_RECEIPT_TYPE = "VERIFIED_JOB_RECEIPT_V2" as const;

export type ReputationEntryOutcomeEvidenceKind = (typeof REPUTATION_ENTRY_REQUIRED_EVIDENCE)[number];

export type VerifiedDeliveryEvidenceReference = {
  kind: ReputationEntryOutcomeEvidenceKind;
  sha256: string;
};

export type ReputationEntryOutcomeEvidenceBundleV2 = {
  schemaVersion: 2;
  bundleType: typeof REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_TYPE;
  workContract: {
    id: string;
    version: 2;
    sha256: string;
  };
  taskType: ReputationEntryTaskType;
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyV1;
  outcomes: {
    execution: VerifiedDeliveryOutcomeEvaluation["executionOutcome"];
    executionFailureAttribution: VerifiedDeliveryOutcomeEvaluation["executionFailureAttribution"];
    independentVerification: VerifiedDeliveryOutcomeEvaluation["independentVerificationOutcome"];
    delivery: VerifiedDeliveryOutcomeEvaluation["deliveryOutcome"];
  };
  trustChecks: VerifiedDeliveryTrustChecks;
  decisionReasons: VerifiedDeliveryOutcomeEvaluation["reasons"];
  projection: {
    required: ReputationEntryOutcomeEvidenceKind[];
    satisfied: ReputationEntryOutcomeEvidenceKind[];
    missing: ReputationEntryOutcomeEvidenceKind[];
    complete: boolean;
  };
  evidence: VerifiedDeliveryEvidenceReference[];
  createdAt: string;
  bundleSha256: string;
};

export type ReputationEntryOutcomeReceiptDocumentV2 = {
  schemaVersion: 2;
  receiptType: typeof REPUTATION_ENTRY_OUTCOME_RECEIPT_TYPE;
  gate: typeof VERIFIED_DELIVERY_OUTCOME_POLICY_GATE;
  publicReceiptId: string;
  candidateStatus: typeof REPUTATION_ENTRY_CANDIDATE_STATUS;
  workContract: ReputationEntryOutcomeEvidenceBundleV2["workContract"];
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyV1;
  outcomes: ReputationEntryOutcomeEvidenceBundleV2["outcomes"];
  trustChecks: VerifiedDeliveryTrustChecks;
  decisionReasons: VerifiedDeliveryOutcomeEvaluation["reasons"];
  evidenceBundle: {
    bundleType: typeof REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_TYPE;
    bundleSha256: string;
    complete: boolean;
  };
  canonicalQualification: {
    workflowMembership: typeof REPUTATION_ENTRY_CANDIDATE_STATUS;
    eligibilityBasis: "DELIVERY_OUTCOME";
    eligible: boolean;
    counted: false;
    reputationEntered: false;
  };
  evidenceLedger: ReputationEntryLedgerVerification;
  issuedAt: string;
};

export type ReputationEntryOutcomeReceiptV2 = {
  id: string;
  publicReceiptId: string;
  receiptSha256: string;
  evidenceChainSha256: string;
  document: ReputationEntryOutcomeReceiptDocumentV2;
};

export type ReputationEntryCandidateJobV2 = Omit<
  ReputationEntryCandidateJob,
  "result" | "contract" | "evidenceBundle" | "receipt"
> & {
  schemaVersion: 2;
  contract: ReputationEntryWorkContractV2;
  outcomeEvaluation: VerifiedDeliveryOutcomeEvaluation;
  candidateEligible: boolean;
  evidenceBundle: ReputationEntryOutcomeEvidenceBundleV2;
  receipt: ReputationEntryOutcomeReceiptV2;
  publicOutcomeSummary: NonNullable<PublicJobReceipt["verifiedDeliveryOutcomes"]>;
};

export function createReputationEntryOutcomeEvidenceBundleV2(input: {
  contract: ReputationEntryWorkContractV2;
  evaluation: VerifiedDeliveryOutcomeEvaluation;
  evidence: VerifiedDeliveryEvidenceReference[];
  createdAt: string;
}): ReputationEntryOutcomeEvidenceBundleV2 {
  assertReputationEntryWorkContractV2Integrity(input.contract);
  assertEvaluationMatchesContract(input.evaluation, input.contract);
  const evidence = [...input.evidence].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.sha256.localeCompare(right.sha256));
  const projection = evidenceProjection(input.contract, evidence);
  if (input.evaluation.trustChecks.requiredEvidenceComplete !== projection.complete) {
    throw new Error("VERIFIED_DELIVERY_EVIDENCE_COMPLETENESS_MISMATCH");
  }
  const body: Omit<ReputationEntryOutcomeEvidenceBundleV2, "bundleSha256"> = {
    schemaVersion: 2,
    bundleType: REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_TYPE,
    workContract: {
      id: input.contract.taskId,
      version: 2,
      sha256: input.contract.workContractSha256,
    },
    taskType: input.contract.taskType,
    deliveryOutcomePolicy: structuredClone(input.contract.deliveryOutcomePolicy),
    outcomes: outcomeProjection(input.evaluation),
    trustChecks: structuredClone(input.evaluation.trustChecks),
    decisionReasons: [...input.evaluation.reasons],
    projection,
    evidence,
    createdAt: validTimestamp(input.createdAt),
  };
  const bundle = { ...body, bundleSha256: sha256Canonical(body) };
  assertReputationEntryOutcomeEvidenceBundleV2Integrity(bundle, input.contract);
  return bundle;
}

export function assertReputationEntryOutcomeEvidenceBundleV2Integrity(
  bundle: ReputationEntryOutcomeEvidenceBundleV2,
  contract: ReputationEntryWorkContractV2,
): void {
  assertReputationEntryWorkContractV2Integrity(contract);
  const { bundleSha256, ...body } = bundle;
  const projection = evidenceProjection(contract, bundle.evidence);
  const evaluation = evaluationFromBundle(bundle, contract);
  const kinds = bundle.evidence.map((item) => item.kind);
  if (
    bundle.schemaVersion !== 2 ||
    bundle.bundleType !== REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_TYPE ||
    bundle.workContract.id !== contract.taskId ||
    bundle.workContract.version !== 2 ||
    bundle.workContract.sha256 !== contract.workContractSha256 ||
    bundle.taskType !== contract.taskType ||
    canonicalJson(bundle.deliveryOutcomePolicy) !== canonicalJson(contract.deliveryOutcomePolicy) ||
    canonicalJson(bundle.outcomes) !== canonicalJson(outcomeProjection(evaluation)) ||
    canonicalJson(bundle.decisionReasons) !== canonicalJson(evaluation.reasons) ||
    canonicalJson(bundle.projection) !== canonicalJson(projection) ||
    bundle.trustChecks.requiredEvidenceComplete !== projection.complete ||
    new Set(kinds).size !== kinds.length ||
    canonicalJson(bundle.evidence) !== canonicalJson([...bundle.evidence].sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.sha256.localeCompare(right.sha256))) ||
    bundle.evidence.some((item) => !/^[a-f0-9]{64}$/.test(item.sha256)) ||
    !Number.isFinite(Date.parse(bundle.createdAt)) ||
    sha256Canonical(body) !== bundleSha256 ||
    (bundle.outcomes.delivery === "VERIFIED_DELIVERY" && !bundle.projection.complete)
  ) throw new Error("REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2_TAMPERING_DETECTED");
}

export function createReputationEntryOutcomeReceiptV2(input: {
  id: string;
  publicReceiptId: string;
  contract: ReputationEntryWorkContractV2;
  bundle: ReputationEntryOutcomeEvidenceBundleV2;
  preReceiptLedger: ReputationEntryLedgerVerification;
  issuedAt: string;
}): ReputationEntryOutcomeReceiptV2 {
  assertReputationEntryOutcomeEvidenceBundleV2Integrity(input.bundle, input.contract);
  if (!input.id.trim() || !/^dlr_[A-Za-z0-9_-]+$/.test(input.publicReceiptId)) {
    throw new Error("REPUTATION_ENTRY_OUTCOME_RECEIPT_ID_INVALID");
  }
  if (!input.preReceiptLedger.valid || !input.preReceiptLedger.chainSha256) {
    throw new Error("REPUTATION_ENTRY_OUTCOME_LEDGER_INVALID");
  }
  const eligible = input.bundle.outcomes.delivery === "VERIFIED_DELIVERY";
  const document: ReputationEntryOutcomeReceiptDocumentV2 = {
    schemaVersion: 2,
    receiptType: REPUTATION_ENTRY_OUTCOME_RECEIPT_TYPE,
    gate: VERIFIED_DELIVERY_OUTCOME_POLICY_GATE,
    publicReceiptId: input.publicReceiptId,
    candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
    workContract: structuredClone(input.bundle.workContract),
    deliveryOutcomePolicy: structuredClone(input.bundle.deliveryOutcomePolicy),
    outcomes: structuredClone(input.bundle.outcomes),
    trustChecks: structuredClone(input.bundle.trustChecks),
    decisionReasons: [...input.bundle.decisionReasons],
    evidenceBundle: {
      bundleType: input.bundle.bundleType,
      bundleSha256: input.bundle.bundleSha256,
      complete: input.bundle.projection.complete,
    },
    canonicalQualification: {
      workflowMembership: REPUTATION_ENTRY_CANDIDATE_STATUS,
      eligibilityBasis: "DELIVERY_OUTCOME",
      eligible,
      counted: false,
      reputationEntered: false,
    },
    evidenceLedger: structuredClone(input.preReceiptLedger),
    issuedAt: validTimestamp(input.issuedAt),
  };
  const receipt = {
    id: input.id,
    publicReceiptId: input.publicReceiptId,
    receiptSha256: sha256Canonical(document),
    evidenceChainSha256: input.preReceiptLedger.chainSha256,
    document,
  };
  assertReputationEntryOutcomeReceiptV2Integrity(receipt, input.contract, input.bundle);
  return receipt;
}

export function assertReputationEntryOutcomeReceiptV2Integrity(
  receipt: ReputationEntryOutcomeReceiptV2,
  contract: ReputationEntryWorkContractV2,
  bundle: ReputationEntryOutcomeEvidenceBundleV2,
): void {
  assertReputationEntryOutcomeEvidenceBundleV2Integrity(bundle, contract);
  const eligible = bundle.outcomes.delivery === "VERIFIED_DELIVERY";
  const document = receipt.document;
  if (
    !receipt.id.trim() ||
    receipt.publicReceiptId !== document.publicReceiptId ||
    document.schemaVersion !== 2 ||
    document.receiptType !== REPUTATION_ENTRY_OUTCOME_RECEIPT_TYPE ||
    document.gate !== VERIFIED_DELIVERY_OUTCOME_POLICY_GATE ||
    document.candidateStatus !== REPUTATION_ENTRY_CANDIDATE_STATUS ||
    canonicalJson(document.workContract) !== canonicalJson(bundle.workContract) ||
    canonicalJson(document.deliveryOutcomePolicy) !== canonicalJson(contract.deliveryOutcomePolicy) ||
    canonicalJson(document.outcomes) !== canonicalJson(bundle.outcomes) ||
    canonicalJson(document.trustChecks) !== canonicalJson(bundle.trustChecks) ||
    canonicalJson(document.decisionReasons) !== canonicalJson(bundle.decisionReasons) ||
    document.evidenceBundle.bundleType !== bundle.bundleType ||
    document.evidenceBundle.bundleSha256 !== bundle.bundleSha256 ||
    document.evidenceBundle.complete !== bundle.projection.complete ||
    document.canonicalQualification.workflowMembership !== REPUTATION_ENTRY_CANDIDATE_STATUS ||
    document.canonicalQualification.eligibilityBasis !== "DELIVERY_OUTCOME" ||
    document.canonicalQualification.eligible !== eligible ||
    document.canonicalQualification.counted !== false ||
    document.canonicalQualification.reputationEntered !== false ||
    !document.evidenceLedger.valid ||
    document.evidenceLedger.chainSha256 !== receipt.evidenceChainSha256 ||
    !Number.isFinite(Date.parse(document.issuedAt)) ||
    sha256Canonical(document) !== receipt.receiptSha256
  ) throw new Error("REPUTATION_ENTRY_OUTCOME_RECEIPT_V2_TAMPERING_DETECTED");
}

export function assertReputationEntryCandidateJobV2Integrity(
  job: ReputationEntryCandidateJobV2,
): void {
  assertAgentIdentityProfileIntegrity(job.agentProfile);
  assertReputationEntryWorkContractV2Integrity(job.contract);
  assertAuthorityDecisionIntegrity(job.authorityDecision);
  assertTaskScopedPermissionLeaseIntegrity(job.issuedLease);
  assertTaskScopedPermissionLeaseIntegrity(job.terminalLease);
  assertAgentExecutionBinding({
    execution: job.executionIdentity,
    contract: job.contract,
    authorityLease: job.issuedLease,
  });
  assertEvaluationMatchesContract(job.outcomeEvaluation, job.contract);
  assertReputationEntryOutcomeEvidenceBundleV2Integrity(job.evidenceBundle, job.contract);
  assertReputationEntryOutcomeReceiptV2Integrity(job.receipt, job.contract, job.evidenceBundle);
  const ledger = verifyReputationEntryLedger(job.ledgerEntries);
  const receiptEntry = job.ledgerEntries.at(-1);
  const eligible = job.outcomeEvaluation.deliveryOutcome === "VERIFIED_DELIVERY";
  const expectedPublicSummary = toVerifiedDeliveryOutcomePublicSummary(job.receipt);
  if (
    job.schemaVersion !== 2 ||
    job.candidateStatus !== REPUTATION_ENTRY_CANDIDATE_STATUS ||
    job.terminalLease.status !== "REVOKED" ||
    canonicalJson(job.evidenceBundle.outcomes) !== canonicalJson(outcomeProjection(job.outcomeEvaluation)) ||
    job.candidateEligible !== eligible ||
    job.receipt.document.canonicalQualification.eligible !== eligible ||
    canonicalJson(job.publicOutcomeSummary) !== canonicalJson(expectedPublicSummary) ||
    !ledger.valid ||
    canonicalJson(ledger) !== canonicalJson(job.ledgerVerification) ||
    receiptEntry?.entryType !== "RECEIPT_CREATED" ||
    receiptEntry.previousEntrySha256 !== job.receipt.evidenceChainSha256 ||
    receiptEntry.payloadSha256 !== sha256Canonical({
      receiptSha256: job.receipt.receiptSha256,
      evidenceBundleSha256: job.evidenceBundle.bundleSha256,
      evidenceChainSha256: job.receipt.evidenceChainSha256,
    }) ||
    job.repairSandbox.sandboxId === job.independentVerification.sandboxId ||
    !job.repairSandbox.cleanup.cleanupVerified ||
    !job.independentVerification.cleanup.cleanupVerified
  ) throw new Error("REPUTATION_ENTRY_CANDIDATE_JOB_V2_TAMPERING_DETECTED");
}

export function verifiedDeliveryOutcomeLedgerPayload(
  evaluation: VerifiedDeliveryOutcomeEvaluation,
): {
  eventType: "DELIVERY_OUTCOME_EVALUATED_V1";
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyV1;
  outcomes: ReputationEntryOutcomeEvidenceBundleV2["outcomes"];
  trustChecks: VerifiedDeliveryTrustChecks;
  candidateEligible: boolean;
  reasons: VerifiedDeliveryOutcomeEvaluation["reasons"];
} {
  return {
    eventType: "DELIVERY_OUTCOME_EVALUATED_V1",
    deliveryOutcomePolicy: structuredClone(evaluation.deliveryOutcomePolicy),
    outcomes: outcomeProjection(evaluation),
    trustChecks: structuredClone(evaluation.trustChecks),
    candidateEligible: evaluation.candidateEligible,
    reasons: [...evaluation.reasons],
  };
}

export function toVerifiedDeliveryOutcomePublicSummary(
  receipt: ReputationEntryOutcomeReceiptV2,
): NonNullable<PublicJobReceipt["verifiedDeliveryOutcomes"]> {
  return {
    executionOutcome: receipt.document.outcomes.execution,
    executionFailureAttribution: receipt.document.outcomes.executionFailureAttribution,
    independentVerificationOutcome: receipt.document.outcomes.independentVerification,
    deliveryOutcomePolicy: receipt.document.deliveryOutcomePolicy.policy,
    deliveryOutcome: receipt.document.outcomes.delivery,
    candidateEligible: receipt.document.canonicalQualification.eligible,
  };
}

function assertEvaluationMatchesContract(
  evaluation: VerifiedDeliveryOutcomeEvaluation,
  contract: ReputationEntryWorkContractV2,
): void {
  const recomputed = evaluateReputationEntryDeliveryOutcome({
    contract,
    executionOutcome: evaluation.executionOutcome,
    executionFailureAttribution: evaluation.executionFailureAttribution,
    independentVerificationOutcome: evaluation.independentVerificationOutcome,
    trustChecks: evaluation.trustChecks,
  });
  if (canonicalJson(recomputed) !== canonicalJson(evaluation)) {
    throw new Error("VERIFIED_DELIVERY_OUTCOME_EVALUATION_TAMPERING_DETECTED");
  }
}

function evaluationFromBundle(
  bundle: ReputationEntryOutcomeEvidenceBundleV2,
  contract: ReputationEntryWorkContractV2,
): VerifiedDeliveryOutcomeEvaluation {
  return evaluateReputationEntryDeliveryOutcome({
    contract,
    executionOutcome: bundle.outcomes.execution,
    executionFailureAttribution: bundle.outcomes.executionFailureAttribution,
    independentVerificationOutcome: bundle.outcomes.independentVerification,
    trustChecks: bundle.trustChecks,
  });
}

function outcomeProjection(
  evaluation: VerifiedDeliveryOutcomeEvaluation,
): ReputationEntryOutcomeEvidenceBundleV2["outcomes"] {
  return {
    execution: evaluation.executionOutcome,
    executionFailureAttribution: evaluation.executionFailureAttribution,
    independentVerification: evaluation.independentVerificationOutcome,
    delivery: evaluation.deliveryOutcome,
  };
}

function evidenceProjection(
  contract: ReputationEntryWorkContractV2,
  evidence: VerifiedDeliveryEvidenceReference[],
): ReputationEntryOutcomeEvidenceBundleV2["projection"] {
  const required = contract.evidencePolicy.required.filter(
    (kind): kind is ReputationEntryOutcomeEvidenceKind =>
      kind !== "EVIDENCE_LEDGER" && kind !== "VERIFIED_JOB_RECEIPT",
  );
  const kinds = new Set(evidence.map((item) => item.kind));
  const satisfied = required.filter((kind) => kinds.has(kind));
  const missing = required.filter((kind) => !kinds.has(kind));
  return { required, satisfied, missing, complete: missing.length === 0 };
}

function validTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error("VERIFIED_DELIVERY_OUTCOME_TIMESTAMP_INVALID");
  return value;
}
