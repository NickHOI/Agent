import { sha256Canonical } from "@donelayer/database";
import { z } from "zod";

const timestampSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)), "invalid timestamp");
const nonEmptySchema = z.string().min(1);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const nullableTokenCountSchema = z.number().int().nonnegative().nullable();
const reputationResultSchema = z.enum(["VERIFIED", "FAILED", "INCONCLUSIVE"]);
const taskTypeSchema = z.enum(["TEST_AND_FIX", "BUILD_RESCUE"]);
const evidenceKindSchema = z.enum([
  "AGENT_IDENTITY",
  "EXECUTION_IDENTITY",
  "WORK_CONTRACT",
  "TASK_SCOPED_AUTHORITY",
  "SOURCE_IDENTITY",
  "BASELINE_FAILURE",
  "AGENT_MODEL_RUN",
  "AGENT_TOOL_ACTIONS",
  "SOURCE_CHANGE",
  "FRESH_INDEPENDENT_VERIFICATION",
  "EVIDENCE_LEDGER",
  "VERIFIED_JOB_RECEIPT",
  "LEASE_TERMINAL_STATE",
  "SANDBOX_CLEANUP",
  "CREDENTIAL_SCAN",
]);
const deliveryOutcomePolicySchema = z.object({
  schemaVersion: z.literal(1),
  policyVersion: z.literal(1),
  policy: z.enum([
    "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED",
    "INDEPENDENT_ACCEPTANCE_SUFFICIENT",
  ]),
}).strict();
const deliveryOutcomesSchema = z.object({
  execution: z.enum(["COMPLETED", "FAILED", "INCONCLUSIVE", "TIMEOUT", "PROVIDER_FAILURE"]),
  executionFailureAttribution: z.enum(["NOT_APPLICABLE", "AGENT", "MODEL_PROVIDER", "INFRASTRUCTURE", "UNKNOWN"]),
  independentVerification: z.enum(["VERIFIED", "FAILED", "INCONCLUSIVE", "INVALID_EVIDENCE", "NO_DELIVERABLE"]),
  delivery: z.enum(["VERIFIED_DELIVERY", "FAILED", "INCONCLUSIVE", "BLOCKED"]),
}).strict();
const trustChecksSchema = z.object({
  authorizedDeliverableExists: z.boolean(),
  requiredEvidenceComplete: z.boolean(),
  sourceIntegrityValid: z.boolean(),
  authorityValid: z.boolean(),
  provenanceValid: z.boolean(),
  lifecycleIntegrityValid: z.boolean(),
  cleanupValid: z.boolean(),
  externalEffectsPolicyValid: z.boolean(),
}).strict();
const deliveryReasonSchema = z.enum([
  "DELIVERY_VERIFIED",
  "EXECUTION_COMPLETION_REQUIRED",
  "NO_AUTHORIZED_DELIVERABLE",
  "INDEPENDENT_ACCEPTANCE_FAILED",
  "INDEPENDENT_ACCEPTANCE_INCONCLUSIVE",
  "INDEPENDENT_EVIDENCE_INVALID",
  "REQUIRED_EVIDENCE_INCOMPLETE",
  "SOURCE_INTEGRITY_INVALID",
  "AUTHORITY_INVALID",
  "PROVENANCE_INVALID",
  "LIFECYCLE_INTEGRITY_INVALID",
  "CLEANUP_INVALID",
  "EXTERNAL_EFFECT_POLICY_INVALID",
]);
const deliveryOutcomeEvaluationV1Schema = z.object({
  schemaVersion: z.literal(1),
  evaluationType: z.literal("VERIFIED_DELIVERY_OUTCOME_EVALUATION_V1"),
  deliveryOutcomePolicy: deliveryOutcomePolicySchema,
  executionOutcome: deliveryOutcomesSchema.shape.execution,
  executionFailureAttribution: deliveryOutcomesSchema.shape.executionFailureAttribution,
  independentVerificationOutcome: deliveryOutcomesSchema.shape.independentVerification,
  deliveryOutcome: deliveryOutcomesSchema.shape.delivery,
  trustChecks: trustChecksSchema,
  candidateEligible: z.boolean(),
  reasons: z.array(deliveryReasonSchema).min(1),
}).strict();
const workContractV1Schema = z.object({
  schemaVersion: z.literal(1),
  contractVersion: z.literal(1),
  status: z.literal("LOCKED"),
  workContractSha256: digestSchema,
}).passthrough();
const workContractV2Schema = z.object({
  schemaVersion: z.literal(2),
  contractVersion: z.literal(2),
  contractType: z.literal("VERIFIED_WORK_CONTRACT_V2"),
  status: z.literal("LOCKED"),
  deliveryOutcomePolicy: deliveryOutcomePolicySchema,
  workContractSha256: digestSchema,
}).passthrough();

export const DURABLE_RECORD_SCHEMA_FAMILIES = [
  "PERSISTENCE_PREFLIGHT_V1",
  "REPUTATION_ENTRY_V1",
  "REPUTATION_ENTRY_OUTCOME_V2",
] as const;
export type DurableRecordSchemaFamily = (typeof DURABLE_RECORD_SCHEMA_FAMILIES)[number];

const persistencePreflightEvidenceBundleV1Schema = z.object({
  bundleType: z.literal("PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1"),
  jobId: nonEmptySchema,
  result: reputationResultSchema,
  intermediateRecovered: z.boolean(),
  verifierResultPersisted: z.boolean(),
  leaseStatus: z.enum(["ACTIVE", "EXPIRED", "REVOKED", "VIOLATED", "COMPLETED"]),
}).strict();
const persistencePreflightReceiptV1Schema = z.object({
  receiptType: z.literal("PERSISTENCE_PREFLIGHT_RECEIPT_V1"),
  jobId: nonEmptySchema,
  executionId: nonEmptySchema,
  workContractSha256: digestSchema,
  authoritySha256: digestSchema,
  bundleSha256: digestSchema,
  result: reputationResultSchema,
  candidateCounted: z.literal(false),
  receiptSha256: digestSchema,
}).strict().superRefine((receipt, context) => {
  const { receiptSha256, ...body } = receipt;
  if (sha256Canonical(body) !== receiptSha256) addHashIssue(context, ["receiptSha256"]);
});
const sourceReferenceSchema = z.object({
  remoteUrl: z.string().url(),
  branch: nonEmptySchema,
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  manifestSha256: digestSchema,
  sourcePackageSha256: digestSchema,
}).strict();
const cleanupProjectionSchema = z.object({
  repairSandbox: z.boolean(),
  verifierSandbox: z.boolean(),
  snapshotsCreated: z.literal(false),
}).strict();
const evidenceProjectionSchema = z.object({
  required: z.array(evidenceKindSchema),
  satisfied: z.array(evidenceKindSchema),
  missing: z.array(evidenceKindSchema),
  complete: z.boolean(),
}).strict();
const reputationEntryEvidenceBundleV1Schema = z.object({
  schemaVersion: z.literal(1),
  bundleType: z.literal("REPUTATION_ENTRY_CANDIDATE_EVIDENCE_BUNDLE_V1"),
  candidateStatus: z.literal("REPUTATION_ENTRY_CANDIDATE"),
  jobId: nonEmptySchema,
  taskType: taskTypeSchema,
  result: reputationResultSchema,
  uniqueness: z.object({
    sourceCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
    defectClass: z.enum(["STATE_TRANSITION_BEHAVIOR", "TYPESCRIPT_BUILD_CONFIGURATION"]),
    oracleSha256: digestSchema,
    workContractSha256: digestSchema,
    authoritySha256: digestSchema,
    executionId: nonEmptySchema,
  }).strict(),
  identity: z.object({
    agentId: nonEmptySchema,
    profileRevision: z.number().int().positive(),
    profileSha256: digestSchema,
    executionId: nonEmptySchema,
    executionSha256: digestSchema,
  }).strict(),
  workContract: z.object({ id: nonEmptySchema, version: z.literal(1), sha256: digestSchema }).strict(),
  authority: z.object({
    leaseId: nonEmptySchema,
    version: z.number().int().positive(),
    authoritySha256: digestSchema,
    terminalStatus: z.literal("REVOKED"),
  }).strict(),
  source: sourceReferenceSchema,
  agentExecution: z.object({
    runId: nonEmptySchema,
    status: z.enum(["COMPLETED", "CANCELLED", "FAILED"]),
    modelId: nonEmptySchema,
    apiRequestCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    repairSandboxId: nonEmptySchema,
  }).strict(),
  independentVerification: z.object({
    verifierSandboxId: nonEmptySchema,
    freshSandbox: z.boolean(),
    verified: z.boolean(),
  }).strict(),
  cleanup: cleanupProjectionSchema,
  credentialScan: z.object({ passed: z.literal(true), artifactCount: z.number().int().nonnegative() }).strict(),
  projection: evidenceProjectionSchema,
  evidence: z.array(z.object({ kind: evidenceKindSchema, artifactId: nonEmptySchema, sha256: digestSchema }).strict()),
  createdAt: timestampSchema,
  bundleSha256: digestSchema,
}).strict().superRefine((bundle, context) => {
  const { bundleSha256, ...body } = bundle;
  if (sha256Canonical(body) !== bundleSha256) addHashIssue(context, ["bundleSha256"]);
});
const workContractReferenceV2Schema = z.object({ id: nonEmptySchema, version: z.literal(2), sha256: digestSchema }).strict();
const reputationEntryOutcomeEvidenceBundleV2Schema = z.object({
  schemaVersion: z.literal(2),
  bundleType: z.literal("REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2"),
  workContract: workContractReferenceV2Schema,
  taskType: taskTypeSchema,
  deliveryOutcomePolicy: deliveryOutcomePolicySchema,
  outcomes: deliveryOutcomesSchema,
  trustChecks: trustChecksSchema,
  decisionReasons: z.array(deliveryReasonSchema).min(1),
  projection: evidenceProjectionSchema,
  evidence: z.array(z.object({ kind: evidenceKindSchema, sha256: digestSchema }).strict()),
  createdAt: timestampSchema,
  bundleSha256: digestSchema,
}).strict().superRefine((bundle, context) => {
  const { bundleSha256, ...body } = bundle;
  if (sha256Canonical(body) !== bundleSha256) addHashIssue(context, ["bundleSha256"]);
});
const usageSchema = z.object({
  apiRequestCount: z.number().int().nonnegative(),
  inputTokens: nullableTokenCountSchema,
  outputTokens: nullableTokenCountSchema,
  cachedInputTokens: nullableTokenCountSchema,
  cacheWriteTokens: nullableTokenCountSchema,
  reasoningTokens: nullableTokenCountSchema,
  totalTokens: nullableTokenCountSchema,
  gatewayReportedCostUsd: z.number().nonnegative().nullable(),
}).strict();
const ledgerVerificationSchema = z.object({
  valid: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  chainSha256: digestSchema.nullable(),
}).strict();
const agentReceiptBindingSchema = z.object({
  agentId: nonEmptySchema,
  profileRevision: z.number().int().positive(),
  profileSha256: digestSchema,
  displayNameAtExecution: nonEmptySchema,
  statusAtExecution: z.literal("ACTIVE"),
  controllerAtExecution: z.object({
    controllerType: z.literal("PLATFORM_ACCOUNT"),
    accountType: z.enum(["USER", "ORGANIZATION", "SERVICE_ACCOUNT"]),
    accountId: nonEmptySchema,
    relationship: z.literal("CONTROLS"),
    assurance: z.literal("PLATFORM_ACCOUNT_RELATIONSHIP"),
    legallyVerified: z.literal(false),
  }).strict(),
}).strict();
const reputationEntryReceiptDocumentV1Schema = z.object({
  schemaVersion: z.literal(1),
  receiptType: z.literal("VERIFIED_JOB_RECEIPT_V1"),
  gate: z.literal("REPLACEMENT_TWO_JOB_REPUTATION_ENTRY_CORPUS_COLLECTION_PHASE_B_V1"),
  publicReceiptId: z.string().regex(/^dlr_[A-Za-z0-9_-]+$/),
  candidateStatus: z.literal("REPUTATION_ENTRY_CANDIDATE"),
  result: reputationResultSchema,
  canonicalQualification: z.object({
    counted: z.literal(false),
    requiresOwnerDefinitionAcceptance: z.literal(true),
    requiresExplicitPromotion: z.literal(true),
  }).strict(),
  taskType: taskTypeSchema,
  identity: z.object({ agent: agentReceiptBindingSchema, executionId: nonEmptySchema, executionSha256: digestSchema }).strict(),
  workContract: z.object({ id: nonEmptySchema, version: z.literal(1), sha256: digestSchema }).strict(),
  authority: z.object({
    leaseId: nonEmptySchema,
    leaseVersion: z.number().int().positive(),
    authoritySha256: digestSchema,
    terminalStatus: z.literal("REVOKED"),
    operationCount: z.number().int().nonnegative(),
  }).strict(),
  source: sourceReferenceSchema,
  execution: z.object({
    backend: z.literal("MANAGED_REMOTE_SANDBOX"),
    sandboxProvider: z.literal("VERCEL_SANDBOX"),
    agentSandboxId: nonEmptySchema,
    verifierSandboxId: nonEmptySchema,
    independentVerifier: z.literal(true),
    localHostExecutionUsed: z.literal(false),
    localDockerUsed: z.literal(false),
    networkPolicy: z.literal("deny-all"),
  }).strict(),
  evidenceBundle: z.object({
    bundleType: z.literal("REPUTATION_ENTRY_CANDIDATE_EVIDENCE_BUNDLE_V1"),
    bundleSha256: digestSchema,
    complete: z.boolean(),
  }).strict(),
  modelUsage: usageSchema,
  cleanup: cleanupProjectionSchema,
  externalEffects: z.object({
    fixtureBranchRead: z.literal(true),
    pullRequestCreated: z.literal(false),
    mergePerformed: z.literal(false),
    deploymentPerformed: z.literal(false),
    paymentPerformed: z.literal(false),
    blockchainWritePerformed: z.literal(false),
  }).strict(),
  evidenceLedger: ledgerVerificationSchema,
  issuedAt: timestampSchema,
}).strict();
const reputationEntryReceiptV1Schema = z.object({
  id: nonEmptySchema,
  publicReceiptId: z.string().regex(/^dlr_[A-Za-z0-9_-]+$/),
  result: reputationResultSchema,
  receiptSha256: digestSchema,
  evidenceChainSha256: digestSchema,
  document: reputationEntryReceiptDocumentV1Schema,
}).strict().superRefine((receipt, context) => {
  if (
    sha256Canonical(receipt.document) !== receipt.receiptSha256 ||
    receipt.publicReceiptId !== receipt.document.publicReceiptId ||
    receipt.result !== receipt.document.result ||
    receipt.evidenceChainSha256 !== receipt.document.evidenceLedger.chainSha256
  ) addHashIssue(context, ["receiptSha256"]);
});
const reputationEntryOutcomeReceiptV2Schema = z.object({
  id: nonEmptySchema,
  publicReceiptId: z.string().regex(/^dlr_[A-Za-z0-9_-]+$/),
  receiptSha256: digestSchema,
  evidenceChainSha256: digestSchema,
  document: z.object({
    schemaVersion: z.literal(2),
    receiptType: z.literal("VERIFIED_JOB_RECEIPT_V2"),
    gate: z.literal("VERIFIED_DELIVERY_OUTCOME_POLICY_V1_DESIGN_AND_EVIDENCE_GATE"),
    publicReceiptId: z.string().regex(/^dlr_[A-Za-z0-9_-]+$/),
    candidateStatus: z.literal("REPUTATION_ENTRY_CANDIDATE"),
    workContract: workContractReferenceV2Schema,
    deliveryOutcomePolicy: deliveryOutcomePolicySchema,
    outcomes: deliveryOutcomesSchema,
    trustChecks: trustChecksSchema,
    decisionReasons: z.array(deliveryReasonSchema).min(1),
    evidenceBundle: z.object({
      bundleType: z.literal("REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2"),
      bundleSha256: digestSchema,
      complete: z.boolean(),
    }).strict(),
    canonicalQualification: z.object({
      workflowMembership: z.literal("REPUTATION_ENTRY_CANDIDATE"),
      eligibilityBasis: z.literal("DELIVERY_OUTCOME"),
      eligible: z.boolean(),
      counted: z.literal(false),
      reputationEntered: z.literal(false),
    }).strict(),
    evidenceLedger: ledgerVerificationSchema,
    issuedAt: timestampSchema,
  }).strict(),
}).strict().superRefine((receipt, context) => {
  if (
    sha256Canonical(receipt.document) !== receipt.receiptSha256 ||
    receipt.publicReceiptId !== receipt.document.publicReceiptId ||
    receipt.evidenceChainSha256 !== receipt.document.evidenceLedger.chainSha256
  ) addHashIssue(context, ["receiptSha256"]);
});

const agentExecutionModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
  type: z.literal("language"),
  contextWindow: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
  pricing: z.object({
    input: z.string(),
    output: z.string(),
    cachedInputTokens: z.string().nullable(),
  }).strict(),
  supportsReasoning: z.boolean(),
  supportsTools: z.boolean(),
  isFree: z.boolean(),
}).strict();

export const agentModelRunV1Schema = z.object({
  status: z.literal("REQUESTED"),
  model: agentExecutionModelSchema,
  maxSteps: z.number().int().min(1).max(12),
  maxOutputTokens: z.number().int().min(512).max(8_192),
  providerRetryLimit: z.literal(1),
}).strict();

export const agentModelRunV2Schema = z.object({
  runId: z.string().min(1),
  status: z.enum(["COMPLETED", "CANCELLED", "FAILED"]),
  model: agentExecutionModelSchema,
  text: z.string(),
  finishReason: z.string(),
  stepCount: z.number().int().nonnegative(),
  toolNames: z.array(z.enum([
    "list_files",
    "read_file",
    "inspect_test_failure",
    "apply_patch",
    "run_test",
    "run_build",
    "get_diff",
    "get_source_integrity",
  ])),
  responseIds: z.array(z.string()),
  usage: z.object({
    apiRequestCount: z.number().int().nonnegative(),
    inputTokens: nullableTokenCountSchema,
    outputTokens: nullableTokenCountSchema,
    cachedInputTokens: nullableTokenCountSchema,
    cacheWriteTokens: nullableTokenCountSchema,
    reasoningTokens: nullableTokenCountSchema,
    totalTokens: nullableTokenCountSchema,
    gatewayReportedCostUsd: z.number().nonnegative().nullable(),
  }).strict(),
  startedAt: timestampSchema,
  finishedAt: timestampSchema,
}).strict();

export type AgentModelRunV1 = z.infer<typeof agentModelRunV1Schema>;
export type AgentModelRunV2 = z.infer<typeof agentModelRunV2Schema>;

export function assertVersionedDurableRecordPayload(record: {
  recordType: string;
  recordVersion: number;
  payload: unknown;
}): void {
  if (record.recordType === "AGENT_MODEL_RUN") {
    if (record.recordVersion === 1) {
      parseVersion(agentModelRunV1Schema, record.payload, "DURABLE_AGENT_MODEL_RUN_V1_INVALID");
      return;
    }
    if (record.recordVersion === 2) {
      parseVersion(agentModelRunV2Schema, record.payload, "DURABLE_AGENT_MODEL_RUN_V2_INVALID");
      return;
    }
    throw new Error("DURABLE_AGENT_MODEL_RUN_VERSION_UNSUPPORTED");
  }
  if (record.recordType === "WORK_CONTRACT") {
    if (record.recordVersion === 1) parseVersion(workContractV1Schema, record.payload, "DURABLE_WORK_CONTRACT_V1_INVALID");
    else if (record.recordVersion === 2) parseVersion(workContractV2Schema, record.payload, "DURABLE_WORK_CONTRACT_V2_INVALID");
    else throw new Error("DURABLE_WORK_CONTRACT_VERSION_UNSUPPORTED");
    return;
  }
  if (record.recordType === "DELIVERY_OUTCOME_EVALUATION") {
    if (record.recordVersion !== 1) throw new Error("DURABLE_DELIVERY_OUTCOME_VERSION_UNSUPPORTED");
    parseVersion(deliveryOutcomeEvaluationV1Schema, record.payload, "DURABLE_DELIVERY_OUTCOME_V1_INVALID");
    return;
  }
  if (record.recordType === "EVIDENCE_BUNDLE_FINAL") {
    if (record.recordVersion !== 1 && record.recordVersion !== 2) {
      throw new Error("DURABLE_EVIDENCE_BUNDLE_VERSION_UNSUPPORTED");
    }
    const schemaFamily = identifyDurableRecordSchemaFamily(record);
    if (!schemaFamily) throw new Error("DURABLE_EVIDENCE_BUNDLE_SCHEMA_FAMILY_UNKNOWN");
    assertDurableRecordPayloadForSchemaFamily(record, schemaFamily);
    return;
  }
  if (record.recordType === "VERIFIED_JOB_RECEIPT") {
    if (record.recordVersion !== 1 && record.recordVersion !== 2) {
      throw new Error("DURABLE_JOB_RECEIPT_VERSION_UNSUPPORTED");
    }
    const schemaFamily = identifyDurableRecordSchemaFamily(record);
    if (!schemaFamily) throw new Error("DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_UNKNOWN");
    assertDurableRecordPayloadForSchemaFamily(record, schemaFamily);
  }
}

export function identifyDurableRecordSchemaFamily(record: {
  recordType: string;
  payload: unknown;
}): DurableRecordSchemaFamily | null {
  if (record.recordType === "EVIDENCE_BUNDLE_FINAL") {
    const payload = requiredObject(record.payload, "DURABLE_EVIDENCE_BUNDLE_SCHEMA_FAMILY_UNKNOWN");
    const discriminator = payload.bundleType;
    if (discriminator === "PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1") return "PERSISTENCE_PREFLIGHT_V1";
    if (discriminator === "REPUTATION_ENTRY_CANDIDATE_EVIDENCE_BUNDLE_V1") return "REPUTATION_ENTRY_V1";
    if (discriminator === "REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2") return "REPUTATION_ENTRY_OUTCOME_V2";
    throw new Error("DURABLE_EVIDENCE_BUNDLE_SCHEMA_FAMILY_UNKNOWN");
  }
  if (record.recordType === "VERIFIED_JOB_RECEIPT") {
    const payload = requiredObject(record.payload, "DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_UNKNOWN");
    const document = isObject(payload.document) ? payload.document : null;
    const hasTopLevelDiscriminator = Object.hasOwn(payload, "receiptType");
    const hasDocumentDiscriminator = document !== null && Object.hasOwn(document, "receiptType");
    if (hasTopLevelDiscriminator && hasDocumentDiscriminator) {
      throw new Error("DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_AMBIGUOUS");
    }
    if (hasTopLevelDiscriminator) {
      if (payload.receiptType === "PERSISTENCE_PREFLIGHT_RECEIPT_V1") return "PERSISTENCE_PREFLIGHT_V1";
      throw new Error("DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_UNKNOWN");
    }
    if (hasDocumentDiscriminator) {
      if (document!.receiptType === "VERIFIED_JOB_RECEIPT_V1") return "REPUTATION_ENTRY_V1";
      if (document!.receiptType === "VERIFIED_JOB_RECEIPT_V2") return "REPUTATION_ENTRY_OUTCOME_V2";
      throw new Error("DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_UNKNOWN");
    }
    throw new Error("DURABLE_JOB_RECEIPT_SCHEMA_FAMILY_UNKNOWN");
  }
  return null;
}

export function assertDurableRecordPayloadForSchemaFamily(
  record: { recordType: string; recordVersion: number; payload: unknown },
  expectedFamily: DurableRecordSchemaFamily,
): void {
  const observedFamily = identifyDurableRecordSchemaFamily(record);
  if (observedFamily !== expectedFamily) throw new Error("DURABLE_RECORD_SCHEMA_FAMILY_MISMATCH");
  const requiredVersion = expectedFamily === "REPUTATION_ENTRY_OUTCOME_V2" ? 2 : 1;
  if (record.recordVersion !== requiredVersion) throw new Error("DURABLE_RECORD_SCHEMA_FAMILY_VERSION_MISMATCH");

  if (record.recordType === "EVIDENCE_BUNDLE_FINAL") {
    if (expectedFamily === "PERSISTENCE_PREFLIGHT_V1") {
      parseVersion(persistencePreflightEvidenceBundleV1Schema, record.payload, "DURABLE_PERSISTENCE_PREFLIGHT_EVIDENCE_BUNDLE_V1_INVALID");
    } else if (expectedFamily === "REPUTATION_ENTRY_V1") {
      parseVersion(reputationEntryEvidenceBundleV1Schema, record.payload, "DURABLE_REPUTATION_ENTRY_EVIDENCE_BUNDLE_V1_INVALID");
    } else {
      parseVersion(reputationEntryOutcomeEvidenceBundleV2Schema, record.payload, "DURABLE_REPUTATION_ENTRY_OUTCOME_EVIDENCE_BUNDLE_V2_INVALID");
    }
    return;
  }
  if (record.recordType === "VERIFIED_JOB_RECEIPT") {
    if (expectedFamily === "PERSISTENCE_PREFLIGHT_V1") {
      parseVersion(persistencePreflightReceiptV1Schema, record.payload, "DURABLE_PERSISTENCE_PREFLIGHT_RECEIPT_V1_INVALID");
    } else if (expectedFamily === "REPUTATION_ENTRY_V1") {
      parseVersion(reputationEntryReceiptV1Schema, record.payload, "DURABLE_REPUTATION_ENTRY_RECEIPT_V1_INVALID");
    } else {
      parseVersion(reputationEntryOutcomeReceiptV2Schema, record.payload, "DURABLE_REPUTATION_ENTRY_OUTCOME_RECEIPT_V2_INVALID");
    }
    return;
  }
  throw new Error("DURABLE_RECORD_SCHEMA_FAMILY_NOT_APPLICABLE");
}

function parseVersion(schema: z.ZodType, payload: unknown, errorCode: string): void {
  const result = schema.safeParse(payload);
  if (!result.success) throw new Error(errorCode);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredObject(value: unknown, errorCode: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(errorCode);
  return value;
}

function addHashIssue(context: z.RefinementCtx, path: Array<string | number>): void {
  context.addIssue({ code: "custom", path, message: "canonical payload hash mismatch" });
}
