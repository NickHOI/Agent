import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Canonical, type PublicJobReceipt } from "@donelayer/database";

import {
  agentIdentityReference,
  createAgentIdentityProfile,
} from "../../apps/web/src/server/agent-identity/agent-identity";
import {
  appendReputationEntryLedger,
  verifyReputationEntryLedger,
  type ReputationEntryLedgerEntry,
} from "../../apps/web/src/server/reputation-entry-pilot/candidate-evidence";
import {
  assertReputationEntryOutcomeEvidenceBundleV2Integrity,
  assertReputationEntryOutcomeReceiptV2Integrity,
  createReputationEntryOutcomeEvidenceBundleV2,
  createReputationEntryOutcomeReceiptV2,
  toVerifiedDeliveryOutcomePublicSummary,
  verifiedDeliveryOutcomeLedgerPayload,
} from "../../apps/web/src/server/reputation-entry-pilot/delivery-outcome-evidence";
import {
  REPUTATION_ENTRY_CANDIDATE_STATUS,
  REPUTATION_ENTRY_REQUIRED_EVIDENCE,
  assertReputationEntryWorkContractIntegrity,
  assertReputationEntryWorkContractV2Integrity,
  createReputationEntryWorkContract,
  createReputationEntryWorkContractV2,
  evaluateReputationEntryDeliveryOutcome,
  reputationEntryTaskDefinitionVersion,
  type ReputationEntryWorkContractV2,
} from "../../apps/web/src/server/reputation-entry-pilot/work-contract";
import { toPublicReceiptView } from "../../apps/web/src/server/public-receipt-view";
import {
  assertVerifiedDeliveryOutcomePolicy,
  isVerifiedDeliveryCandidate,
  type AgentExecutionOutcome,
  type ExecutionFailureAttribution,
  type IndependentWorkVerificationOutcome,
  type VerifiedDeliveryOutcomePolicyName,
  type VerifiedDeliveryTrustChecks,
} from "../../apps/web/src/server/verified-delivery-outcome/policy";

const lockedAt = "2026-09-05T01:00:00.000Z";
const profile = createAgentIdentityProfile({
  displayName: "Outcome Policy Test Agent",
  controller: {
    controllerType: "PLATFORM_ACCOUNT",
    accountType: "USER",
    accountId: "owner-outcome-policy-tests",
    relationship: "CONTROLS",
    assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
    legallyVerified: false,
  },
  declaredCapabilities: ["TEST_AND_FIX"],
  createdAt: "2026-09-05T00:59:00.000Z",
});

const passingTrustChecks: VerifiedDeliveryTrustChecks = {
  authorizedDeliverableExists: true,
  requiredEvidenceComplete: true,
  sourceIntegrityValid: true,
  authorityValid: true,
  provenanceValid: true,
  lifecycleIntegrityValid: true,
  cleanupValid: true,
  externalEffectsPolicyValid: true,
};

describe("Verified Delivery Outcome Policy V1", () => {
  it("maps COMPLETED plus VERIFIED to VERIFIED_DELIVERY under the strict policy", () => {
    expect(decide("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED", {
      executionOutcome: "COMPLETED",
      independentVerificationOutcome: "VERIFIED",
    })).toMatchObject({
      executionOutcome: "COMPLETED",
      independentVerificationOutcome: "VERIFIED",
      deliveryOutcome: "VERIFIED_DELIVERY",
      candidateEligible: true,
    });
  });

  it("does not verify FAILED execution under the strict policy even when work verifies", () => {
    expect(decide("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED", {
      executionOutcome: "FAILED",
      independentVerificationOutcome: "VERIFIED",
    })).toMatchObject({
      executionOutcome: "FAILED",
      independentVerificationOutcome: "VERIFIED",
      deliveryOutcome: "FAILED",
      candidateEligible: false,
      reasons: ["EXECUTION_COMPLETION_REQUIRED"],
    });
  });

  it("verifies FAILED execution under the locked independent-acceptance policy", () => {
    expect(decide("INDEPENDENT_ACCEPTANCE_SUFFICIENT", {
      executionOutcome: "FAILED",
      independentVerificationOutcome: "VERIFIED",
    })).toMatchObject({
      deliveryOutcomePolicy: { policy: "INDEPENDENT_ACCEPTANCE_SUFFICIENT" },
      executionOutcome: "FAILED",
      independentVerificationOutcome: "VERIFIED",
      deliveryOutcome: "VERIFIED_DELIVERY",
      candidateEligible: true,
    });
  });

  it("keeps an inconclusive execution with no deliverable non-verified", () => {
    const evaluation = decide("INDEPENDENT_ACCEPTANCE_SUFFICIENT", {
      executionOutcome: "INCONCLUSIVE",
      independentVerificationOutcome: "NO_DELIVERABLE",
      trustChecks: { ...passingTrustChecks, authorizedDeliverableExists: false },
    });
    expect(evaluation).toMatchObject({
      deliveryOutcome: "INCONCLUSIVE",
      candidateEligible: false,
      reasons: ["NO_AUTHORIZED_DELIVERABLE"],
    });
  });

  it("does not verify COMPLETED execution when independent verification fails", () => {
    expect(decide("INDEPENDENT_ACCEPTANCE_SUFFICIENT", {
      executionOutcome: "COMPLETED",
      independentVerificationOutcome: "FAILED",
    })).toMatchObject({ deliveryOutcome: "FAILED", candidateEligible: false });
  });

  it("does not verify COMPLETED execution when independent verification is inconclusive", () => {
    expect(decide("INDEPENDENT_ACCEPTANCE_SUFFICIENT", {
      executionOutcome: "COMPLETED",
      independentVerificationOutcome: "INCONCLUSIVE",
    })).toMatchObject({ deliveryOutcome: "INCONCLUSIVE", candidateEligible: false });
  });

  it("blocks verified work when Authority is invalid", () => {
    expect(decide("INDEPENDENT_ACCEPTANCE_SUFFICIENT", {
      trustChecks: { ...passingTrustChecks, authorityValid: false },
    })).toMatchObject({ deliveryOutcome: "BLOCKED", reasons: ["AUTHORITY_INVALID"] });
  });

  it("blocks verified work when required evidence is missing and projects that gap truthfully", () => {
    const contract = outcomeContract("INDEPENDENT_ACCEPTANCE_SUFFICIENT", "missing-evidence");
    const evaluation = evaluate(contract, {
      trustChecks: { ...passingTrustChecks, requiredEvidenceComplete: false },
    });
    const references = allEvidence().slice(1);
    const bundle = createReputationEntryOutcomeEvidenceBundleV2({ contract, evaluation, evidence: references, createdAt: lockedAt });

    expect(evaluation).toMatchObject({ deliveryOutcome: "BLOCKED", reasons: ["REQUIRED_EVIDENCE_INCOMPLETE"] });
    expect(bundle.projection).toMatchObject({ complete: false, missing: [REPUTATION_ENTRY_REQUIRED_EVIDENCE[0]] });
    expect(() => assertReputationEntryOutcomeEvidenceBundleV2Integrity(bundle, contract)).not.toThrow();
  });

  it.each([
    ["sourceIntegrityValid", "SOURCE_INTEGRITY_INVALID"],
    ["provenanceValid", "PROVENANCE_INVALID"],
    ["lifecycleIntegrityValid", "LIFECYCLE_INTEGRITY_INVALID"],
  ] as const)("blocks verified work when %s fails", (check, reason) => {
    expect(decide("INDEPENDENT_ACCEPTANCE_SUFFICIENT", {
      trustChecks: { ...passingTrustChecks, [check]: false },
    })).toMatchObject({ deliveryOutcome: "BLOCKED", reasons: [reason] });
  });

  it.each([
    ["cleanupValid", "CLEANUP_INVALID"],
    ["externalEffectsPolicyValid", "EXTERNAL_EFFECT_POLICY_INVALID"],
  ] as const)("blocks verified work when %s fails", (check, reason) => {
    expect(decide("INDEPENDENT_ACCEPTANCE_SUFFICIENT", {
      trustChecks: { ...passingTrustChecks, [check]: false },
    })).toMatchObject({ deliveryOutcome: "BLOCKED", reasons: [reason] });
  });

  it("detects hash-covered policy tampering", () => {
    const contract = outcomeContract("INDEPENDENT_ACCEPTANCE_SUFFICIENT", "policy-tamper");
    const tampered = structuredClone(contract);
    tampered.deliveryOutcomePolicy.policy = "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED";

    expect(() => assertReputationEntryWorkContractV2Integrity(tampered)).toThrow(/TAMPERING/);
  });

  it("fails closed for missing or unknown policy versions even after re-hashing", () => {
    const contract = outcomeContract("INDEPENDENT_ACCEPTANCE_SUFFICIENT", "policy-version");
    const missing = structuredClone(contract) as unknown as Record<string, unknown> & { workContractSha256: string };
    delete missing.deliveryOutcomePolicy;
    const unknown = structuredClone(contract) as unknown as {
      workContractSha256: string;
      deliveryOutcomePolicy: { schemaVersion: 1; policyVersion: number; policy: "INDEPENDENT_ACCEPTANCE_SUFFICIENT" };
    };
    unknown.deliveryOutcomePolicy.policyVersion = 999;

    expect(() => assertReputationEntryWorkContractV2Integrity(rehash(missing) as unknown as ReputationEntryWorkContractV2)).toThrow();
    expect(() => assertReputationEntryWorkContractV2Integrity(rehash(unknown) as unknown as ReputationEntryWorkContractV2)).toThrow(/POLICY_UNSUPPORTED/);
    expect(() => assertVerifiedDeliveryOutcomePolicy(unknown.deliveryOutcomePolicy as never)).toThrow(/POLICY_UNSUPPORTED/);
  });

  it("preserves historical V1 semantics and refuses to apply V2 policy evaluation", () => {
    const historical = historicalContract();
    const before = canonicalJson(historical);
    const beforeHash = historical.workContractSha256;

    expect(() => assertReputationEntryWorkContractIntegrity(historical)).not.toThrow();
    expect("deliveryOutcomePolicy" in historical).toBe(false);
    expect(() => evaluateReputationEntryDeliveryOutcome({
      contract: historical as unknown as ReputationEntryWorkContractV2,
      executionOutcome: "FAILED",
      executionFailureAttribution: "UNKNOWN",
      independentVerificationOutcome: "VERIFIED",
      trustChecks: passingTrustChecks,
    })).toThrow();
    expect(canonicalJson(historical)).toBe(before);
    expect(historical.workContractSha256).toBe(beforeHash);
  });

  it("binds policy in the locked Contract independently of mutable task-definition copies", () => {
    const contract = outcomeContract("INDEPENDENT_ACCEPTANCE_SUFFICIENT", "template-independence");
    const strict = outcomeContract("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED", "template-independence-strict");
    const definitionCopy = reputationEntryTaskDefinitionVersion("TEST_AND_FIX", 2);
    definitionCopy.specification = "Mutable authoring copy";

    expect(contract.deliveryOutcomePolicy.policy).toBe("INDEPENDENT_ACCEPTANCE_SUFFICIENT");
    expect(strict.deliveryOutcomePolicy.policy).toBe("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED");
    expect(contract.workContractSha256).not.toBe(strict.workContractSha256);
    expect(() => assertReputationEntryWorkContractV2Integrity(contract)).not.toThrow();
  });

  it("preserves failed execution in Evidence, Ledger, Receipt, and public view when delivery verifies", () => {
    const contract = outcomeContract("INDEPENDENT_ACCEPTANCE_SUFFICIENT", "truthful-receipt");
    const evaluation = evaluate(contract, {
      executionOutcome: "FAILED",
      executionFailureAttribution: "MODEL_PROVIDER",
      independentVerificationOutcome: "VERIFIED",
    });
    const bundle = createReputationEntryOutcomeEvidenceBundleV2({
      contract,
      evaluation,
      evidence: allEvidence(),
      createdAt: lockedAt,
    });
    const ledgerEntries: ReputationEntryLedgerEntry[] = [];
    appendReputationEntryLedger(ledgerEntries, {
      entryType: "DELIVERY_OUTCOME_EVALUATED",
      sourceRecordType: "delivery_outcome_evaluation",
      sourceRecordId: contract.taskId,
      payload: verifiedDeliveryOutcomeLedgerPayload(evaluation),
      createdAt: lockedAt,
    });
    const preReceiptLedger = verifyReputationEntryLedger(ledgerEntries);
    const receipt = createReputationEntryOutcomeReceiptV2({
      id: "outcome-policy-receipt-v2",
      publicReceiptId: "dlr_outcome_policy_v2",
      contract,
      bundle,
      preReceiptLedger,
      issuedAt: "2026-09-05T01:01:00.000Z",
    });
    const publicSummary = toVerifiedDeliveryOutcomePublicSummary(receipt);
    const publicReceipt = toPublicReceiptView({
      publicReceiptId: receipt.publicReceiptId,
      taskType: "Verified Delivery Outcome Policy Verification",
      agentIdentity: "Outcome Policy Test Agent",
      workerIdentity: "DoneLayer deterministic evaluator",
      contractSha256: contract.workContractSha256,
      evidenceChainSha256: receipt.evidenceChainSha256,
      artifactSha256: bundle.bundleSha256,
      verificationSummary: "The locked delivery policy was evaluated independently from Agent execution status.",
      result: "VERIFIED_DELIVERY",
      createdAt: receipt.document.issuedAt,
      verificationStatus: "VALID",
      invalidated: false,
      disputed: false,
      verifiedDeliveryOutcomes: publicSummary,
      scopeDisclaimer: "This deterministic Gate does not constitute a live corpus Job or Reputation entry.",
    } satisfies PublicJobReceipt);

    expect(bundle.outcomes).toEqual({
      execution: "FAILED",
      executionFailureAttribution: "MODEL_PROVIDER",
      independentVerification: "VERIFIED",
      delivery: "VERIFIED_DELIVERY",
    });
    expect(verifiedDeliveryOutcomeLedgerPayload(evaluation).outcomes).toEqual(bundle.outcomes);
    expect(receipt.document).toMatchObject({
      outcomes: bundle.outcomes,
      canonicalQualification: {
        workflowMembership: REPUTATION_ENTRY_CANDIDATE_STATUS,
        eligibilityBasis: "DELIVERY_OUTCOME",
        eligible: true,
        counted: false,
        reputationEntered: false,
      },
    });
    expect(publicReceipt).toMatchObject({
      result: "VERIFIED_DELIVERY",
      verifiedDeliveryOutcomes: {
        executionOutcome: "FAILED",
        independentVerificationOutcome: "VERIFIED",
        deliveryOutcomePolicy: "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
        deliveryOutcome: "VERIFIED_DELIVERY",
        candidateEligible: true,
      },
    });
    expect(() => assertReputationEntryOutcomeReceiptV2Integrity(receipt, contract, bundle)).not.toThrow();

    const tampered = structuredClone(receipt);
    tampered.document.outcomes.execution = "COMPLETED";
    expect(() => assertReputationEntryOutcomeReceiptV2Integrity(tampered, contract, bundle)).toThrow(/TAMPERING/);
  });

  it("bases candidate eligibility on delivery outcome rather than workflow membership", () => {
    const verified = decide("INDEPENDENT_ACCEPTANCE_SUFFICIENT", { executionOutcome: "FAILED" });
    const denied = decide("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED", { executionOutcome: "FAILED" });

    expect(REPUTATION_ENTRY_CANDIDATE_STATUS).toBe("REPUTATION_ENTRY_CANDIDATE");
    expect(isVerifiedDeliveryCandidate(verified.deliveryOutcome)).toBe(true);
    expect(isVerifiedDeliveryCandidate(denied.deliveryOutcome)).toBe(false);
    expect(verified.candidateEligible).toBe(true);
    expect(denied.candidateEligible).toBe(false);
  });
});

function decide(
  policy: VerifiedDeliveryOutcomePolicyName,
  overrides: {
    executionOutcome?: AgentExecutionOutcome;
    executionFailureAttribution?: ExecutionFailureAttribution;
    independentVerificationOutcome?: IndependentWorkVerificationOutcome;
    trustChecks?: VerifiedDeliveryTrustChecks;
  } = {},
) {
  return evaluate(outcomeContract(policy, `vector-${policy.toLowerCase()}`), overrides);
}

function evaluate(
  contract: ReputationEntryWorkContractV2,
  overrides: {
    executionOutcome?: AgentExecutionOutcome;
    executionFailureAttribution?: ExecutionFailureAttribution;
    independentVerificationOutcome?: IndependentWorkVerificationOutcome;
    trustChecks?: VerifiedDeliveryTrustChecks;
  } = {},
) {
  const executionOutcome = overrides.executionOutcome ?? "COMPLETED";
  return evaluateReputationEntryDeliveryOutcome({
    contract,
    executionOutcome,
    executionFailureAttribution: overrides.executionFailureAttribution ??
      (executionOutcome === "COMPLETED" ? "NOT_APPLICABLE" : "UNKNOWN"),
    independentVerificationOutcome: overrides.independentVerificationOutcome ?? "VERIFIED",
    trustChecks: overrides.trustChecks ?? passingTrustChecks,
  });
}

function outcomeContract(
  policy: VerifiedDeliveryOutcomePolicyName,
  suffix: string,
): ReputationEntryWorkContractV2 {
  return createReputationEntryWorkContractV2({
    taskId: `outcome-policy-${suffix}`,
    taskType: "TEST_AND_FIX",
    assignedAgent: agentIdentityReference(profile),
    source: source(),
    deliveryOutcomePolicy: policy,
    taskDefinitionVersion: 2,
    lockedAt,
  });
}

function historicalContract() {
  return createReputationEntryWorkContract({
    taskId: "historical-v1-control",
    taskType: "TEST_AND_FIX",
    assignedAgent: agentIdentityReference(profile),
    source: source(),
    taskDefinitionVersion: 2,
    lockedAt,
  });
}

function source() {
  const files = [
    { relative_path: "src/order-state.ts", sha256: "1".repeat(64) },
    { relative_path: "tests/order-state.test.ts", sha256: "2".repeat(64) },
  ];
  return {
    branch: "donelayer/repair/outcome-policy-v1",
    commitSha: "3".repeat(40),
    manifestSha256: sha256Canonical(files),
    files,
  };
}

function allEvidence() {
  return REPUTATION_ENTRY_REQUIRED_EVIDENCE
    .filter((kind) => kind !== "EVIDENCE_LEDGER" && kind !== "VERIFIED_JOB_RECEIPT")
    .map((kind) => ({ kind, sha256: sha256Canonical({ kind }) }));
}

function rehash<T extends { workContractSha256: string }>(contract: T): T {
  const { workContractSha256: _workContractSha256, ...body } = contract;
  return { ...body, workContractSha256: sha256Canonical(body) } as T;
}
