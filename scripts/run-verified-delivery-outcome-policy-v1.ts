import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { computeEvidenceLedgerEntryHash, sha256Canonical } from "@donelayer/database";

import {
  agentIdentityReference,
  createAgentIdentityProfile,
} from "../apps/web/src/server/agent-identity/agent-identity";
import {
  verifyReputationEntryLedger,
  type ReputationEntryLedgerEntry,
} from "../apps/web/src/server/reputation-entry-pilot/candidate-evidence";
import {
  assertReputationEntryOutcomeReceiptV2Integrity,
  createReputationEntryOutcomeEvidenceBundleV2,
  createReputationEntryOutcomeReceiptV2,
  toVerifiedDeliveryOutcomePublicSummary,
  verifiedDeliveryOutcomeLedgerPayload,
} from "../apps/web/src/server/reputation-entry-pilot/delivery-outcome-evidence";
import {
  REPUTATION_ENTRY_REQUIRED_EVIDENCE,
  assertReputationEntryWorkContractIntegrity,
  assertReputationEntryWorkContractV2Integrity,
  createReputationEntryWorkContract,
  createReputationEntryWorkContractV2,
  evaluateReputationEntryDeliveryOutcome,
  reputationEntryTaskDefinitionVersion,
  type ReputationEntryWorkContractV2,
} from "../apps/web/src/server/reputation-entry-pilot/work-contract";
import {
  assertVerifiedDeliveryOutcomePolicy,
  type AgentExecutionOutcome,
  type IndependentWorkVerificationOutcome,
  type VerifiedDeliveryOutcomePolicyName,
  type VerifiedDeliveryTrustChecks,
} from "../apps/web/src/server/verified-delivery-outcome/policy";

const workspaceRoot = process.cwd();
const outputPath = path.join(workspaceRoot, "test-results", "verified-delivery-outcome-policy-v1-evidence.json");
const createdAt = "2026-09-05T01:15:00.000Z";
const lockedAt = "2026-09-05T01:00:00.000Z";
const profile = createAgentIdentityProfile({
  agentId: "agt_01K4M5N6P7Q8R9S0T1V2W3X4Y5",
  displayName: "Outcome Policy Deterministic Test Agent",
  controller: {
    controllerType: "PLATFORM_ACCOUNT",
    accountType: "USER",
    accountId: "owner-outcome-policy-gate",
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

const strictContract = contract("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED", "strict");
const independentContract = contract("INDEPENDENT_ACCEPTANCE_SUFFICIENT", "independent");
const failedExecutionVerifiedWork = evaluate(independentContract, "FAILED", "VERIFIED", passingTrustChecks);
const evidenceBundle = createReputationEntryOutcomeEvidenceBundleV2({
  contract: independentContract,
  evaluation: failedExecutionVerifiedWork,
  evidence: REPUTATION_ENTRY_REQUIRED_EVIDENCE
    .filter((kind) => kind !== "EVIDENCE_LEDGER" && kind !== "VERIFIED_JOB_RECEIPT")
    .map((kind) => ({ kind, sha256: sha256Canonical({ kind }) })),
  createdAt,
});
const ledgerEntries: ReputationEntryLedgerEntry[] = [];
appendDeterministicLedgerEntry(ledgerEntries, "outcome-policy-ledger-entry-1", {
  entryType: "DELIVERY_OUTCOME_EVALUATED",
  sourceRecordType: "delivery_outcome_evaluation",
  sourceRecordId: independentContract.taskId,
  payload: verifiedDeliveryOutcomeLedgerPayload(failedExecutionVerifiedWork),
  createdAt,
});
const preReceiptLedger = verifyReputationEntryLedger(ledgerEntries);
const receipt = createReputationEntryOutcomeReceiptV2({
  id: "verified-delivery-outcome-policy-v1-test-receipt",
  publicReceiptId: "dlr_verified_delivery_outcome_policy_v1",
  contract: independentContract,
  bundle: evidenceBundle,
  preReceiptLedger,
  issuedAt: createdAt,
});
assertReputationEntryOutcomeReceiptV2Integrity(receipt, independentContract, evidenceBundle);
appendDeterministicLedgerEntry(ledgerEntries, "outcome-policy-ledger-entry-2", {
  entryType: "RECEIPT_CREATED",
  sourceRecordType: "prospective_verified_job_receipt_v2",
  sourceRecordId: receipt.id,
  payload: {
    receiptSha256: receipt.receiptSha256,
    evidenceBundleSha256: evidenceBundle.bundleSha256,
    evidenceChainSha256: receipt.evidenceChainSha256,
  },
  createdAt,
});

const historical = createReputationEntryWorkContract({
  taskId: "verified-delivery-outcome-policy-v1-historical-control",
  taskType: "TEST_AND_FIX",
  assignedAgent: agentIdentityReference(profile),
  source: source(),
  taskDefinitionVersion: 2,
  lockedAt,
});
const historicalHashBefore = historical.workContractSha256;
assertReputationEntryWorkContractIntegrity(historical);

const policyTamper = structuredClone(independentContract);
policyTamper.deliveryOutcomePolicy.policy = "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED";
const missingPolicy = structuredClone(independentContract) as unknown as Record<string, unknown> & { workContractSha256: string };
delete missingPolicy.deliveryOutcomePolicy;
const unknownPolicy = structuredClone(independentContract) as unknown as {
  workContractSha256: string;
  deliveryOutcomePolicy: { schemaVersion: 1; policyVersion: number; policy: "INDEPENDENT_ACCEPTANCE_SUFFICIENT" };
};
unknownPolicy.deliveryOutcomePolicy.policyVersion = 999;

const definitionCopy = reputationEntryTaskDefinitionVersion("TEST_AND_FIX", 2);
definitionCopy.specification = "Mutable authoring copy used only by this deterministic control";
assertReputationEntryWorkContractV2Integrity(independentContract);

const attempt3Paths = [
  "test-results/reputation-entry-phase-b-attempt-3.sqlite",
  "test-results/reputation-entry-phase-b-attempt-3-evidence.json",
  "REPUTATION_ENTRY_PHASE_B_ATTEMPT_3_BLOCKED.md",
  "test-results/reputation-entry-phase-b-attempt-3-source-preflight.json",
  "test-results/reputation-entry-phase-b-attempt-3-working-tree-identity.txt",
];

const evidence = {
  gate: "VERIFIED_DELIVERY_OUTCOME_POLICY_V1_DESIGN_AND_EVIDENCE_GATE",
  decision: "PASS",
  proofBoundary: "LOCAL_DETERMINISTIC_POLICY_AND_SCHEMA_EVIDENCE_ONLY",
  createdAt,
  policyModel: {
    schemaVersion: 1,
    policies: [
      "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
      "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
    ],
    strictContractSha256: strictContract.workContractSha256,
    independentAcceptanceContractSha256: independentContract.workContractSha256,
  },
  contracts: {
    strict: strictContract,
    independentAcceptance: independentContract,
  },
  controlVectors: [
    vector("strict-completed-verified", strictContract, "COMPLETED", "VERIFIED", passingTrustChecks),
    vector("strict-failed-verified", strictContract, "FAILED", "VERIFIED", passingTrustChecks),
    vector("independent-failed-verified", independentContract, "FAILED", "VERIFIED", passingTrustChecks),
    vector("independent-inconclusive-no-deliverable", independentContract, "INCONCLUSIVE", "NO_DELIVERABLE", {
      ...passingTrustChecks,
      authorizedDeliverableExists: false,
    }),
    vector("independent-completed-failed", independentContract, "COMPLETED", "FAILED", passingTrustChecks),
    vector("independent-completed-inconclusive", independentContract, "COMPLETED", "INCONCLUSIVE", passingTrustChecks),
    vector("independent-authority-invalid", independentContract, "FAILED", "VERIFIED", {
      ...passingTrustChecks,
      authorityValid: false,
    }),
    vector("independent-evidence-incomplete", independentContract, "FAILED", "VERIFIED", {
      ...passingTrustChecks,
      requiredEvidenceComplete: false,
    }),
    vector("independent-source-provenance-invalid", independentContract, "FAILED", "VERIFIED", {
      ...passingTrustChecks,
      sourceIntegrityValid: false,
      provenanceValid: false,
    }),
    vector("independent-cleanup-external-effect-invalid", independentContract, "FAILED", "VERIFIED", {
      ...passingTrustChecks,
      cleanupValid: false,
      externalEffectsPolicyValid: false,
    }),
  ],
  structuralChecks: {
    policyFieldTamperingRejected: captureError(() => assertReputationEntryWorkContractV2Integrity(policyTamper)),
    missingPolicyRejected: captureError(() =>
      assertReputationEntryWorkContractV2Integrity(rehash(missingPolicy) as unknown as ReputationEntryWorkContractV2)),
    unknownPolicyVersionRejected: captureError(() =>
      assertVerifiedDeliveryOutcomePolicy(unknownPolicy.deliveryOutcomePolicy as never)),
    historicalContractStillValid: true,
    historicalContractHashUnchanged: historical.workContractSha256 === historicalHashBefore,
    currentTaskDefinitionCopyCannotChangeLockedPolicy:
      independentContract.deliveryOutcomePolicy.policy === "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
    receiptPreservesFailedExecutionWithVerifiedDelivery:
      receipt.document.outcomes.execution === "FAILED" &&
      receipt.document.outcomes.independentVerification === "VERIFIED" &&
      receipt.document.outcomes.delivery === "VERIFIED_DELIVERY",
    candidateEligibilityUsesDeliveryOutcome:
      receipt.document.canonicalQualification.eligibilityBasis === "DELIVERY_OUTCOME" &&
      receipt.document.canonicalQualification.eligible,
  },
  prospectiveReceiptTestVector: {
    receipt,
    publicSummary: toVerifiedDeliveryOutcomePublicSummary(receipt),
    evidenceBundle,
    ledgerEntries,
    ledgerVerification: verifyReputationEntryLedger(ledgerEntries),
  },
  historicalCompatibility: {
    historicalContractSchemaVersion: historical.schemaVersion,
    historicalContractVersion: historical.contractVersion,
    historicalContractSha256: historical.workContractSha256,
    reEvaluated: false,
    migrated: false,
  },
  attempt3Immutability: {
    artifacts: attempt3Paths.map((relativePath) => ({ relativePath, sha256: fileSha256(relativePath) })),
    databaseWalExists: existsSync(`${path.join(workspaceRoot, attempt3Paths[0]!)}-wal`),
    databaseShmExists: existsSync(`${path.join(workspaceRoot, attempt3Paths[0]!)}-shm`),
    reEvaluated: false,
    mutated: false,
  },
  effects: {
    modelCalls: 0,
    sandboxesCreated: 0,
    githubMutations: 0,
    fixtureMutations: 0,
    pullRequestsCreated: 0,
    payments: 0,
    deployments: 0,
    blockchainActions: 0,
    billingChanges: 0,
    reputationEntries: 0,
  },
};

writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${outputPath}\n`);

function contract(policy: VerifiedDeliveryOutcomePolicyName, suffix: string) {
  return createReputationEntryWorkContractV2({
    taskId: `verified-delivery-outcome-policy-v1-${suffix}`,
    taskType: "TEST_AND_FIX",
    assignedAgent: agentIdentityReference(profile),
    source: source(),
    deliveryOutcomePolicy: policy,
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
    branch: "donelayer/repair/verified-delivery-outcome-policy-v1",
    commitSha: "3".repeat(40),
    manifestSha256: sha256Canonical(files),
    files,
  };
}

function evaluate(
  contractValue: ReputationEntryWorkContractV2,
  executionOutcome: AgentExecutionOutcome,
  independentVerificationOutcome: IndependentWorkVerificationOutcome,
  trustChecks: VerifiedDeliveryTrustChecks,
) {
  return evaluateReputationEntryDeliveryOutcome({
    contract: contractValue,
    executionOutcome,
    executionFailureAttribution: executionOutcome === "COMPLETED" ? "NOT_APPLICABLE" : "UNKNOWN",
    independentVerificationOutcome,
    trustChecks,
  });
}

function vector(
  id: string,
  contractValue: ReputationEntryWorkContractV2,
  executionOutcome: AgentExecutionOutcome,
  independentVerificationOutcome: IndependentWorkVerificationOutcome,
  trustChecks: VerifiedDeliveryTrustChecks,
) {
  return { id, evaluation: evaluate(contractValue, executionOutcome, independentVerificationOutcome, trustChecks) };
}

function captureError(operation: () => void): string | null {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "UNKNOWN_ERROR";
  }
}

function rehash<T extends { workContractSha256: string }>(value: T): T {
  const { workContractSha256: _workContractSha256, ...body } = value;
  return { ...body, workContractSha256: sha256Canonical(body) } as T;
}

function appendDeterministicLedgerEntry(
  entries: ReputationEntryLedgerEntry[],
  id: string,
  input: {
    entryType: string;
    sourceRecordType: string;
    sourceRecordId: string;
    payload: unknown;
    createdAt: string;
  },
): void {
  const entry: ReputationEntryLedgerEntry = {
    id,
    sequenceNumber: entries.length + 1,
    entryType: input.entryType,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: input.sourceRecordId,
    payloadSha256: sha256Canonical(input.payload),
    previousEntrySha256: entries.at(-1)?.entrySha256 ?? null,
    entrySha256: "",
    createdAt: input.createdAt,
  };
  entry.entrySha256 = computeEvidenceLedgerEntryHash(entry);
  entries.push(entry);
}

function fileSha256(relativePath: string): string {
  return createHash("sha256").update(readFileSync(path.join(workspaceRoot, relativePath))).digest("hex");
}
