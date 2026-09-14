import "server-only";

import { BetaGate3Orchestrator, type BetaGate3Outcome } from "../beta-gate-3/orchestrator";
import {
  BETA_GATE_3_CANONICAL_WORKFLOW,
  GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
  canonicalWorkflowPolicy,
} from "./contract";

export type CanonicalOrchestrationInput = {
  ownerAuthUserId: string;
  taskId: string;
  contractId: string;
  contractSha256: string;
  authorityId: string;
  authorityScopeSha256: string;
  workflow: string;
};

export async function runCanonicalVerifiedWorkExecution(
  input: CanonicalOrchestrationInput,
): Promise<BetaGate3Outcome> {
  const policy = canonicalWorkflowPolicy(input.workflow);
  switch (policy.workflow) {
    case BETA_GATE_3_CANONICAL_WORKFLOW:
      return new BetaGate3Orchestrator().run(input);
    case GATE_4A_EXTERNAL_REVIEW_WORKFLOW:
      throw new Error("GATE_4A_WORKFLOW_PRECHECK_ONLY_UNTIL_OWNER_EXECUTION_APPROVAL");
  }
}
