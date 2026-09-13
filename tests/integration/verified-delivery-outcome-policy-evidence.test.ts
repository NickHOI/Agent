import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  verifyReputationEntryLedger,
  type ReputationEntryLedgerEntry,
} from "../../apps/web/src/server/reputation-entry-pilot/candidate-evidence";
import {
  assertReputationEntryOutcomeEvidenceBundleV2Integrity,
  assertReputationEntryOutcomeReceiptV2Integrity,
  type ReputationEntryOutcomeEvidenceBundleV2,
  type ReputationEntryOutcomeReceiptV2,
} from "../../apps/web/src/server/reputation-entry-pilot/delivery-outcome-evidence";
import {
  assertReputationEntryWorkContractV2Integrity,
  type ReputationEntryWorkContractV2,
} from "../../apps/web/src/server/reputation-entry-pilot/work-contract";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidencePath = path.join(workspaceRoot, "test-results", "verified-delivery-outcome-policy-v1-evidence.json");
const hasEvidence = existsSync(evidencePath);

describe("Verified Delivery Outcome Policy V1 deterministic evidence", () => {
  it.skipIf(!hasEvidence)("replays Contract, outcome, Bundle, Receipt, ledger, and historical integrity", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      gate: string;
      decision: string;
      proofBoundary: string;
      contracts: {
        strict: ReputationEntryWorkContractV2;
        independentAcceptance: ReputationEntryWorkContractV2;
      };
      controlVectors: Array<{
        id: string;
        evaluation: {
          executionOutcome: string;
          independentVerificationOutcome: string;
          deliveryOutcome: string;
          candidateEligible: boolean;
        };
      }>;
      structuralChecks: Record<string, boolean | string | null>;
      prospectiveReceiptTestVector: {
        receipt: ReputationEntryOutcomeReceiptV2;
        evidenceBundle: ReputationEntryOutcomeEvidenceBundleV2;
        ledgerEntries: ReputationEntryLedgerEntry[];
        ledgerVerification: ReturnType<typeof verifyReputationEntryLedger>;
      };
      attempt3Immutability: {
        artifacts: Array<{ relativePath: string; sha256: string }>;
        databaseWalExists: boolean;
        databaseShmExists: boolean;
        reEvaluated: boolean;
        mutated: boolean;
      };
      effects: Record<string, number>;
    };

    expect(evidence).toMatchObject({
      gate: "VERIFIED_DELIVERY_OUTCOME_POLICY_V1_DESIGN_AND_EVIDENCE_GATE",
      decision: "PASS",
      proofBoundary: "LOCAL_DETERMINISTIC_POLICY_AND_SCHEMA_EVIDENCE_ONLY",
    });
    expect(() => assertReputationEntryWorkContractV2Integrity(evidence.contracts.strict)).not.toThrow();
    expect(() => assertReputationEntryWorkContractV2Integrity(evidence.contracts.independentAcceptance)).not.toThrow();
    expect(evidence.contracts.strict.deliveryOutcomePolicy.policy).toBe("EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED");
    expect(evidence.contracts.independentAcceptance.deliveryOutcomePolicy.policy).toBe("INDEPENDENT_ACCEPTANCE_SUFFICIENT");

    const byId = new Map(evidence.controlVectors.map((vector) => [vector.id, vector.evaluation]));
    expect(byId.get("strict-failed-verified")).toMatchObject({
      executionOutcome: "FAILED",
      independentVerificationOutcome: "VERIFIED",
      deliveryOutcome: "FAILED",
      candidateEligible: false,
    });
    expect(byId.get("independent-failed-verified")).toMatchObject({
      executionOutcome: "FAILED",
      independentVerificationOutcome: "VERIFIED",
      deliveryOutcome: "VERIFIED_DELIVERY",
      candidateEligible: true,
    });
    expect(byId.get("independent-inconclusive-no-deliverable")).toMatchObject({
      deliveryOutcome: "INCONCLUSIVE",
      candidateEligible: false,
    });

    const { evidenceBundle, receipt, ledgerEntries, ledgerVerification } = evidence.prospectiveReceiptTestVector;
    expect(() => assertReputationEntryOutcomeEvidenceBundleV2Integrity(
      evidenceBundle,
      evidence.contracts.independentAcceptance,
    )).not.toThrow();
    expect(() => assertReputationEntryOutcomeReceiptV2Integrity(
      receipt,
      evidence.contracts.independentAcceptance,
      evidenceBundle,
    )).not.toThrow();
    expect(verifyReputationEntryLedger(ledgerEntries)).toEqual(ledgerVerification);
    expect(ledgerVerification).toMatchObject({ valid: true, entryCount: 2 });
    expect(receipt.document.outcomes).toEqual({
      execution: "FAILED",
      executionFailureAttribution: "UNKNOWN",
      independentVerification: "VERIFIED",
      delivery: "VERIFIED_DELIVERY",
    });

    expect(evidence.structuralChecks).toMatchObject({
      historicalContractStillValid: true,
      historicalContractHashUnchanged: true,
      currentTaskDefinitionCopyCannotChangeLockedPolicy: true,
      receiptPreservesFailedExecutionWithVerifiedDelivery: true,
      candidateEligibilityUsesDeliveryOutcome: true,
    });
    expect(Object.values(evidence.effects).every((count) => count === 0)).toBe(true);
    expect(evidence.attempt3Immutability).toMatchObject({
      databaseWalExists: false,
      databaseShmExists: false,
      reEvaluated: false,
      mutated: false,
    });
    for (const artifact of evidence.attempt3Immutability.artifacts) {
      expect(fileSha256(path.join(workspaceRoot, artifact.relativePath))).toBe(artifact.sha256);
    }
    expect(JSON.stringify(evidence)).not.toMatch(
      /VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|Bearer\s+[A-Za-z0-9._-]+|\.env\.local|C:\\Users\\/i,
    );
  });
});

function fileSha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
