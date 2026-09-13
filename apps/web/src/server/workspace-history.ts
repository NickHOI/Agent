export type WorkspaceReceiptDocumentSummary = {
  schemaVersion: number | null;
  receiptType: string;
  executionOutcome: string | null;
  verificationOutcome: string | null;
  deliveryOutcome: string | null;
  documentResult: string | null;
  agentLabel: string;
  verifierLabel: string;
  sourceCommit: string | null;
  tests: string | null;
  build: string | null;
  documentedLedger: Record<string, unknown>;
  historyStatus: "VERIFIED_WORK" | "VALID_RECEIPT_ONLY";
};

const gateReceiptTypes = new Set([
  "WORKER_INFRASTRUCTURE_VERIFICATION",
  "REPOSITORY_MATERIALIZATION_VERIFICATION",
  "MANAGED_REMOTE_SANDBOX_VERIFICATION",
  "REAL_BUILD_TEST_MANAGED_SANDBOX_VERIFICATION",
  "AGENT_REPAIR_MANAGED_SANDBOX_VERIFICATION",
  "VERIFIED_JOB_RECEIPT_V1",
  "VERIFIED_JOB_RECEIPT_V2",
]);

const verifiedWorkReceiptTypes = new Set([
  "VERIFIED_WORK_RECEIPT_V2",
]);

export function summarizeWorkspaceReceiptDocument(value: unknown): WorkspaceReceiptDocumentSummary {
  const document = recordOf(value);
  const happened = recordOf(document.whatHappened);
  const executed = recordOf(document.whoExecuted);
  const verified = recordOf(document.howVerified);
  const publicOutcomes = recordOf(document.verifiedDeliveryOutcomes);
  const versionedOutcomes = recordOf(document.outcomes);
  const buildTest = recordOf(happened.buildTest);
  const receiptType = textOf(document.receiptType) || "Historical Receipt";
  const qualification = recordOf(document.canonicalQualification);
  const classification = recordOf(document.classification);
  const excluded = gateReceiptTypes.has(receiptType)
    || textOf(document.candidateStatus) === "REPUTATION_ENTRY_CANDIDATE"
    || Object.keys(qualification).length > 0
    || textOf(classification.realJobClassification) === "NOT_VERIFIED"
    || textOf(classification.reason) === "BETA_GATE_VALIDATION"
    || classification.reputationContribution === 0;

  return {
    schemaVersion: typeof document.schemaVersion === "number" ? document.schemaVersion : null,
    receiptType,
    executionOutcome: nullableText(publicOutcomes.executionOutcome)
      || nullableText(versionedOutcomes.execution),
    verificationOutcome: nullableText(publicOutcomes.independentVerificationOutcome)
      || nullableText(versionedOutcomes.independentVerification),
    deliveryOutcome: nullableText(publicOutcomes.deliveryOutcome)
      || nullableText(versionedOutcomes.delivery),
    documentResult: nullableText(document.finalResult)
      || nullableText(document.result)
      || nullableText(versionedOutcomes.delivery),
    agentLabel: textOf(executed.agentPublicIdentity)
      || textOf(executed.agentId)
      || "Recorded Agent",
    verifierLabel: textOf(verified.verifier)
      || textOf(document.verifier)
      || "DoneLayer independent verifier",
    sourceCommit: nullableText(happened.commitShaAfter)
      || nullableText(recordOf(happened.repositoryMaterialization).workerCommitSha),
    tests: Object.keys(buildTest).length ? commandSummary(buildTest.test) : null,
    build: Object.keys(buildTest).length ? commandSummary(buildTest.build) : null,
    documentedLedger: Object.keys(recordOf(verified.evidenceLedger)).length
      ? recordOf(verified.evidenceLedger)
      : recordOf(document.evidenceLedger),
    historyStatus: !excluded && verifiedWorkReceiptTypes.has(receiptType)
      ? "VERIFIED_WORK"
      : "VALID_RECEIPT_ONLY",
  };
}

export function normalizePersistedLedgerTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function commandSummary(value: unknown): string {
  const command = recordOf(value);
  if (!Object.keys(command).length) return "Not present";
  const exitCode = typeof command.exitCode === "number" ? command.exitCode : null;
  const status = textOf(command.status) || (exitCode === 0 ? "PASSED" : "FAILED");
  return `${human(status)}${exitCode === null ? "" : ` (exit ${exitCode})`}`;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function human(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
