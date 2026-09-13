export const VERIFIED_DELIVERY_OUTCOME_POLICY_SCHEMA_VERSION = 1 as const;
export const VERIFIED_DELIVERY_OUTCOME_POLICY_VERSION = 1 as const;

export const VERIFIED_DELIVERY_OUTCOME_POLICIES = [
  "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
  "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
] as const;

export const VERIFIED_DELIVERY_TRUST_CHECKS = [
  "authorizedDeliverableExists",
  "requiredEvidenceComplete",
  "sourceIntegrityValid",
  "authorityValid",
  "provenanceValid",
  "lifecycleIntegrityValid",
  "cleanupValid",
  "externalEffectsPolicyValid",
] as const;

export type VerifiedDeliveryOutcomePolicyName = (typeof VERIFIED_DELIVERY_OUTCOME_POLICIES)[number];

export type VerifiedDeliveryOutcomePolicyV1 = {
  schemaVersion: typeof VERIFIED_DELIVERY_OUTCOME_POLICY_SCHEMA_VERSION;
  policyVersion: typeof VERIFIED_DELIVERY_OUTCOME_POLICY_VERSION;
  policy: VerifiedDeliveryOutcomePolicyName;
};

export type AgentExecutionOutcome =
  | "COMPLETED"
  | "FAILED"
  | "INCONCLUSIVE"
  | "TIMEOUT"
  | "PROVIDER_FAILURE";

export type ExecutionFailureAttribution =
  | "NOT_APPLICABLE"
  | "AGENT"
  | "MODEL_PROVIDER"
  | "INFRASTRUCTURE"
  | "UNKNOWN";

export type IndependentWorkVerificationOutcome =
  | "VERIFIED"
  | "FAILED"
  | "INCONCLUSIVE"
  | "INVALID_EVIDENCE"
  | "NO_DELIVERABLE";

export type ContractDeliveryOutcome =
  | "VERIFIED_DELIVERY"
  | "FAILED"
  | "INCONCLUSIVE"
  | "BLOCKED";

export type VerifiedDeliveryTrustChecks = Record<(typeof VERIFIED_DELIVERY_TRUST_CHECKS)[number], boolean>;

export type VerifiedDeliveryDecisionReason =
  | "DELIVERY_VERIFIED"
  | "EXECUTION_COMPLETION_REQUIRED"
  | "NO_AUTHORIZED_DELIVERABLE"
  | "INDEPENDENT_ACCEPTANCE_FAILED"
  | "INDEPENDENT_ACCEPTANCE_INCONCLUSIVE"
  | "INDEPENDENT_EVIDENCE_INVALID"
  | "REQUIRED_EVIDENCE_INCOMPLETE"
  | "SOURCE_INTEGRITY_INVALID"
  | "AUTHORITY_INVALID"
  | "PROVENANCE_INVALID"
  | "LIFECYCLE_INTEGRITY_INVALID"
  | "CLEANUP_INVALID"
  | "EXTERNAL_EFFECT_POLICY_INVALID";

export type VerifiedDeliveryOutcomeEvaluation = {
  schemaVersion: 1;
  evaluationType: "VERIFIED_DELIVERY_OUTCOME_EVALUATION_V1";
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyV1;
  executionOutcome: AgentExecutionOutcome;
  executionFailureAttribution: ExecutionFailureAttribution;
  independentVerificationOutcome: IndependentWorkVerificationOutcome;
  deliveryOutcome: ContractDeliveryOutcome;
  trustChecks: VerifiedDeliveryTrustChecks;
  candidateEligible: boolean;
  reasons: VerifiedDeliveryDecisionReason[];
};

export function createVerifiedDeliveryOutcomePolicy(
  policy: VerifiedDeliveryOutcomePolicyName,
): VerifiedDeliveryOutcomePolicyV1 {
  const value = {
    schemaVersion: VERIFIED_DELIVERY_OUTCOME_POLICY_SCHEMA_VERSION,
    policyVersion: VERIFIED_DELIVERY_OUTCOME_POLICY_VERSION,
    policy,
  };
  assertVerifiedDeliveryOutcomePolicy(value);
  return value;
}

export function assertVerifiedDeliveryOutcomePolicy(
  policy: VerifiedDeliveryOutcomePolicyV1,
): void {
  const keys = Object.keys(policy).sort();
  if (
    keys.join(",") !== "policy,policyVersion,schemaVersion" ||
    policy.schemaVersion !== VERIFIED_DELIVERY_OUTCOME_POLICY_SCHEMA_VERSION ||
    policy.policyVersion !== VERIFIED_DELIVERY_OUTCOME_POLICY_VERSION ||
    !VERIFIED_DELIVERY_OUTCOME_POLICIES.includes(policy.policy)
  ) throw new Error("VERIFIED_DELIVERY_OUTCOME_POLICY_UNSUPPORTED");
}

export function evaluateVerifiedDeliveryOutcome(input: {
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyV1;
  executionOutcome: AgentExecutionOutcome;
  executionFailureAttribution: ExecutionFailureAttribution;
  independentVerificationOutcome: IndependentWorkVerificationOutcome;
  trustChecks: VerifiedDeliveryTrustChecks;
}): VerifiedDeliveryOutcomeEvaluation {
  assertVerifiedDeliveryOutcomePolicy(input.deliveryOutcomePolicy);
  assertOutcomeInputs(input);

  const blockedReasons = trustFailureReasons(input.trustChecks);
  let deliveryOutcome: ContractDeliveryOutcome;
  let reasons: VerifiedDeliveryDecisionReason[];

  if (
    !input.trustChecks.authorizedDeliverableExists ||
    input.independentVerificationOutcome === "NO_DELIVERABLE"
  ) {
    deliveryOutcome = "INCONCLUSIVE";
    reasons = ["NO_AUTHORIZED_DELIVERABLE"];
  } else if (input.independentVerificationOutcome === "INVALID_EVIDENCE") {
    deliveryOutcome = "BLOCKED";
    reasons = ["INDEPENDENT_EVIDENCE_INVALID"];
  } else if (blockedReasons.length > 0) {
    deliveryOutcome = "BLOCKED";
    reasons = blockedReasons;
  } else if (input.independentVerificationOutcome === "FAILED") {
    deliveryOutcome = "FAILED";
    reasons = ["INDEPENDENT_ACCEPTANCE_FAILED"];
  } else if (input.independentVerificationOutcome === "INCONCLUSIVE") {
    deliveryOutcome = "INCONCLUSIVE";
    reasons = ["INDEPENDENT_ACCEPTANCE_INCONCLUSIVE"];
  } else if (
    input.deliveryOutcomePolicy.policy === "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED" &&
    input.executionOutcome !== "COMPLETED"
  ) {
    deliveryOutcome = input.executionOutcome === "FAILED" ? "FAILED" : "INCONCLUSIVE";
    reasons = ["EXECUTION_COMPLETION_REQUIRED"];
  } else {
    deliveryOutcome = "VERIFIED_DELIVERY";
    reasons = ["DELIVERY_VERIFIED"];
  }

  return {
    schemaVersion: 1,
    evaluationType: "VERIFIED_DELIVERY_OUTCOME_EVALUATION_V1",
    deliveryOutcomePolicy: structuredClone(input.deliveryOutcomePolicy),
    executionOutcome: input.executionOutcome,
    executionFailureAttribution: input.executionFailureAttribution,
    independentVerificationOutcome: input.independentVerificationOutcome,
    deliveryOutcome,
    trustChecks: structuredClone(input.trustChecks),
    candidateEligible: deliveryOutcome === "VERIFIED_DELIVERY",
    reasons,
  };
}

export function isVerifiedDeliveryCandidate(
  deliveryOutcome: ContractDeliveryOutcome,
): boolean {
  return deliveryOutcome === "VERIFIED_DELIVERY";
}

function assertOutcomeInputs(input: {
  executionOutcome: AgentExecutionOutcome;
  executionFailureAttribution: ExecutionFailureAttribution;
  independentVerificationOutcome: IndependentWorkVerificationOutcome;
  trustChecks: VerifiedDeliveryTrustChecks;
}): void {
  const executionOutcomes: AgentExecutionOutcome[] = ["COMPLETED", "FAILED", "INCONCLUSIVE", "TIMEOUT", "PROVIDER_FAILURE"];
  const attributions: ExecutionFailureAttribution[] = ["NOT_APPLICABLE", "AGENT", "MODEL_PROVIDER", "INFRASTRUCTURE", "UNKNOWN"];
  const verificationOutcomes: IndependentWorkVerificationOutcome[] = ["VERIFIED", "FAILED", "INCONCLUSIVE", "INVALID_EVIDENCE", "NO_DELIVERABLE"];
  const trustKeys = Object.keys(input.trustChecks).sort();
  const expectedTrustKeys = [...VERIFIED_DELIVERY_TRUST_CHECKS].sort();
  if (
    !executionOutcomes.includes(input.executionOutcome) ||
    !attributions.includes(input.executionFailureAttribution) ||
    !verificationOutcomes.includes(input.independentVerificationOutcome) ||
    trustKeys.join(",") !== expectedTrustKeys.join(",") ||
    expectedTrustKeys.some((key) => typeof input.trustChecks[key] !== "boolean") ||
    (input.executionOutcome === "COMPLETED") !== (input.executionFailureAttribution === "NOT_APPLICABLE")
  ) throw new Error("VERIFIED_DELIVERY_OUTCOME_INPUT_INVALID");
}

function trustFailureReasons(checks: VerifiedDeliveryTrustChecks): VerifiedDeliveryDecisionReason[] {
  const reasons: VerifiedDeliveryDecisionReason[] = [];
  if (!checks.requiredEvidenceComplete) reasons.push("REQUIRED_EVIDENCE_INCOMPLETE");
  if (!checks.sourceIntegrityValid) reasons.push("SOURCE_INTEGRITY_INVALID");
  if (!checks.authorityValid) reasons.push("AUTHORITY_INVALID");
  if (!checks.provenanceValid) reasons.push("PROVENANCE_INVALID");
  if (!checks.lifecycleIntegrityValid) reasons.push("LIFECYCLE_INTEGRITY_INVALID");
  if (!checks.cleanupValid) reasons.push("CLEANUP_INVALID");
  if (!checks.externalEffectsPolicyValid) reasons.push("EXTERNAL_EFFECT_POLICY_INVALID");
  return reasons;
}
