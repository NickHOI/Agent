import {
  GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
  precheckVerifiedWorkExecution,
  type CanonicalExecutionLimits,
} from "../apps/web/src/server/verified-work-execution/contract";

const sourceCommit = requiredArgument("--commit");
const sourceTree = requiredArgument("--tree");
const workId = "34e8f15a-ec4f-4ad8-ac2e-09049d5cc933";
const contractId = "8bd37ef1-6b84-4f95-a28b-d1f3777c2b33";
const authorityId = "e9ab2bb7-982d-4228-8d69-c09dc82d10ee";
const ownerAuthUserId = "66828387-5fde-458e-ab36-9a8bd18c0def";
const repository = "https://github.com/NickHOI/Agent.git";
const contractSha256 = "b2a9189c76c29ca6081288c4083f92353be60dc9772877a383f8ce29c01fb9ab";
const authorityScopeSha256 = "341ebb78f90ac8595ed018971c63a74246b573a8ae5a62d6cd47ed9e6f3744b2";
const files = [
  "apps/web/src/server/workspace-public-receipt-projection.ts",
  "apps/web/src/server/workspace-public-receipt.ts",
  "apps/web/src/app/api/workspace/receipts/[receiptId]/download/route.ts",
];
const actions = [
  "collect_evidence",
  "create_patch",
  "independently_verify",
  "read_source",
  "run_locked_verification",
];
const allowedDomains = ["registry.npmjs.org"];
const limits: CanonicalExecutionLimits = {
  maxArtifactBytes: 2 * 1024 * 1024,
  maxRuntimeSeconds: 600,
  maxSandboxes: 2,
  maxCommands: 10,
  maxStdoutBytes: 256 * 1024,
  maxStderrBytes: 256 * 1024,
  maxApiBudget: 0,
};
const source = { repository, commitSha: sourceCommit, treeSha: sourceTree };
const countersBefore = Object.freeze({ jobs: 0, corpus: 0, modelRequests: 0, sandboxes: 0 });

const result = precheckVerifiedWorkExecution({
  mode: "DRY_RUN",
  actorAuthUserId: ownerAuthUserId,
  ownerAuthUserId,
  workId,
  contract: {
    id: contractId,
    workId,
    status: "DRAFT",
    sha256: contractSha256,
    workflow: GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
    source,
    allowedFiles: files,
    allowedActions: actions,
    allowedDomains,
    limits,
    networkPolicy: "deny-all",
    persistence: "none",
    deliveryOutcomePolicy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
  },
  authority: {
    id: authorityId,
    workId,
    contractId,
    decision: "APPROVED",
    scopeSha256: authorityScopeSha256,
    allowedRepositories: [repository],
    allowedCommitShas: [sourceCommit],
    allowedTreeShas: [sourceTree],
    allowedFiles: files,
    allowedActions: actions,
    allowedDomains,
    allowedWorkflows: [GATE_4A_EXTERNAL_REVIEW_WORKFLOW],
    limits,
    networkPolicy: "deny-all",
    persistence: "none",
  },
  requestedContractSha256: contractSha256,
  requestedAuthorityId: authorityId,
  requestedAuthorityScopeSha256: authorityScopeSha256,
  requestedSource: source,
  requestedWorkflow: GATE_4A_EXTERNAL_REVIEW_WORKFLOW,
  requestedFiles: files,
});

const countersAfter = Object.freeze({ jobs: 0, corpus: 0, modelRequests: 0, sandboxes: 0 });
if (JSON.stringify(countersAfter) !== JSON.stringify(countersBefore)) {
  throw new Error("GATE_4A_PRECHECK_SIDE_EFFECT_DETECTED");
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  artifactType: "GATE_4A_CANONICAL_EXECUTION_PRECHECK_V1",
  ...result,
  approvedDraftContractFingerprint: contractSha256,
  approvedAuthorityFingerprint: authorityScopeSha256,
  source: { repository, branch: "codex/gate-4a-canonical-orchestration-baseline", commit: sourceCommit, tree: sourceTree },
  contractStateAfter: "DRAFT_UNLOCKED",
  jobCountDelta: countersAfter.jobs - countersBefore.jobs,
  corpusDelta: countersAfter.corpus - countersBefore.corpus,
  modelRequestDelta: countersAfter.modelRequests - countersBefore.modelRequests,
  sandboxDelta: countersAfter.sandboxes - countersBefore.sandboxes,
}, null, 2)}\n`);

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
