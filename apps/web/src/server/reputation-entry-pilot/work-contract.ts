import { canonicalJson, sha256Canonical } from "@donelayer/database";

import {
  assertAgentIdentityReference,
  type AgentIdentityReference,
} from "../agent-identity/agent-identity";
import {
  assertTaskScopedWorkContractIntegrity,
  type TaskScopedWorkContract,
} from "../task-scoped-authority/task-scoped-authority";
import {
  assertVerifiedDeliveryOutcomePolicy,
  createVerifiedDeliveryOutcomePolicy,
  evaluateVerifiedDeliveryOutcome,
  type AgentExecutionOutcome,
  type ExecutionFailureAttribution,
  type IndependentWorkVerificationOutcome,
  type VerifiedDeliveryOutcomeEvaluation,
  type VerifiedDeliveryOutcomePolicyName,
  type VerifiedDeliveryOutcomePolicyV1,
  type VerifiedDeliveryTrustChecks,
} from "../verified-delivery-outcome/policy";

export const REPUTATION_ENTRY_PILOT = "REPLACEMENT_TWO_JOB_REPUTATION_ENTRY_CORPUS_COLLECTION_PHASE_B_V1" as const;
export const REPUTATION_ENTRY_LEGACY_CONTRACT_VARIANT = "REPUTATION_ENTRY_CANDIDATE_V1" as const;
export const REPUTATION_ENTRY_CONTRACT_VARIANT = "REPUTATION_ENTRY_CANDIDATE_V2" as const;
export const REPUTATION_ENTRY_OUTCOME_CONTRACT_VARIANT = "REPUTATION_ENTRY_CANDIDATE_V3" as const;
export const REPUTATION_ENTRY_CANDIDATE_STATUS = "REPUTATION_ENTRY_CANDIDATE" as const;

export type ReputationEntryTaskType = "TEST_AND_FIX" | "BUILD_RESCUE";
export type LockedCommand = {
  id: string;
  role: "PRIMARY" | "SUPPORTING";
  command: "npm test" | "npm run build";
  expectedExitCode: 0;
};

export type ReputationEntryTaskDefinitionId = "REPUTATION_ENTRY_TEST_AND_FIX" | "REPUTATION_ENTRY_BUILD_RESCUE";
export type ReputationEntryTaskDefinition = {
  taskDefinitionId: ReputationEntryTaskDefinitionId;
  taskDefinitionVersion: number;
  taskType: ReputationEntryTaskType;
  specification: string;
  desiredOutcome: string;
  editableFiles: string[];
  oracleFiles: string[];
  commands: LockedCommand[];
  permissionPolicy: { allowedActions: string[]; forbiddenActions: string[] };
  authorityPolicy: {
    allowedWorkflows: string[];
    mutationAction: string;
    verificationAction: string;
    maxSandboxes: number;
    maxCommands: number;
  };
  evidencePolicy: {
    required: string[];
    independentVerifier: "FRESH_NONPERSISTENT_MANAGED_SANDBOX";
    agentReportedCompletionIsSufficient: false;
    incompleteOutcome: "INCONCLUSIVE";
  };
  externalEffectsPolicy: {
    pullRequest: "FORBIDDEN";
    merge: "FORBIDDEN";
    deployment: "FORBIDDEN";
    payment: "FORBIDDEN";
    blockchain: "FORBIDDEN";
    snapshots: "FORBIDDEN";
  };
  taskDefinitionSha256: string;
};

export type ReputationEntryTaskDefinitionReference = {
  id: ReputationEntryTaskDefinitionId;
  version: number;
  sha256: string;
};

export type ReputationEntryWorkContract = TaskScopedWorkContract & {
  schemaVersion: 1;
  contractVersion: 1;
  contractType: "VERIFIED_WORK_CONTRACT_V1";
  contractVariant: typeof REPUTATION_ENTRY_LEGACY_CONTRACT_VARIANT | typeof REPUTATION_ENTRY_CONTRACT_VARIANT;
  status: "LOCKED";
  candidateStatus: typeof REPUTATION_ENTRY_CANDIDATE_STATUS;
  taskType: ReputationEntryTaskType;
  taskDefinition?: ReputationEntryTaskDefinitionReference;
  specification: string;
  desiredOutcome: string;
  repository: "NickHOI/donelayer-build-rescue-fixture";
  remoteUrl: "https://github.com/NickHOI/donelayer-build-rescue-fixture.git";
  sourceIdentity: {
    branch: string;
    commitSha: string;
    manifestSha256: string;
    files: Array<{ path: string; sha256: string }>;
  };
  acceptanceCriteria: {
    authority: "OWNER_LOCKED_COMMAND_ORACLE";
    immutableAfterLock: true;
    baselineMustFail: true;
    protectedOracleFiles: Array<{ path: string; sha256: string }>;
    commands: LockedCommand[];
    commandsSha256: string;
  };
  evidencePolicy: {
    required: string[];
    independentVerifier: "FRESH_NONPERSISTENT_MANAGED_SANDBOX";
    agentReportedCompletionIsSufficient: false;
    incompleteOutcome: "INCONCLUSIVE";
  };
  externalEffectsPolicy: {
    pullRequest: "FORBIDDEN";
    merge: "FORBIDDEN";
    deployment: "FORBIDDEN";
    payment: "FORBIDDEN";
    blockchain: "FORBIDDEN";
    snapshots: "FORBIDDEN";
  };
  lockedAt: string;
};

export type ReputationEntryWorkContractV2 = Omit<
  ReputationEntryWorkContract,
  "schemaVersion" | "contractVersion" | "contractType" | "contractVariant" | "taskDefinition" | "deliveryOutcomePolicy"
> & {
  schemaVersion: 2;
  contractVersion: 2;
  contractType: "VERIFIED_WORK_CONTRACT_V2";
  contractVariant: typeof REPUTATION_ENTRY_OUTCOME_CONTRACT_VARIANT;
  taskDefinition: ReputationEntryTaskDefinitionReference;
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyV1;
};

export const REPUTATION_ENTRY_REQUIRED_EVIDENCE = [
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
] as const;

const SHARED_PERMISSION_POLICY = {
  allowedActions: [
    "collect_evidence",
    "create_managed_sandbox",
    "create_patch",
    "independently_verify",
    "inspect_baseline_failure",
    "modify_authorized_source",
    "read_source",
    "run_locked_verification",
  ],
  forbiddenActions: [
    "blockchain_write",
    "create_pull_request",
    "expand_production_credentials",
    "merge_pull_request",
    "modify_acceptance_criteria",
    "modify_protected_oracle",
    "production_deploy",
    "push_default_branch",
    "real_payment",
  ],
};

const SHARED_EVIDENCE_POLICY = {
  required: [...REPUTATION_ENTRY_REQUIRED_EVIDENCE],
  independentVerifier: "FRESH_NONPERSISTENT_MANAGED_SANDBOX" as const,
  agentReportedCompletionIsSufficient: false as const,
  incompleteOutcome: "INCONCLUSIVE" as const,
};

const SHARED_EXTERNAL_EFFECTS_POLICY = {
  pullRequest: "FORBIDDEN" as const,
  merge: "FORBIDDEN" as const,
  deployment: "FORBIDDEN" as const,
  payment: "FORBIDDEN" as const,
  blockchain: "FORBIDDEN" as const,
  snapshots: "FORBIDDEN" as const,
};

const TASK_DEFINITIONS = [
  createTaskDefinition({
    taskDefinitionId: "REPUTATION_ENTRY_TEST_AND_FIX",
    taskDefinitionVersion: 1,
    taskType: "TEST_AND_FIX",
    specification: "parsePort(input) accepts only a trimmed whole-decimal string representing an integer from 1 through 65535.",
    desiredOutcome: "Repair the validation defect without changing the locked tests, package metadata, or acceptance criteria.",
    editableFiles: ["src/parse-port.ts"],
    oracleFiles: ["tests/parse-port.test.ts"],
    commands: [{ id: "strict-port-parser-tests", role: "PRIMARY", command: "npm test", expectedExitCode: 0 }],
    allowedWorkflow: "TWO_JOB_REPUTATION_ENTRY_CORPUS_COLLECTION_PILOT_V1",
  }),
  createTaskDefinition({
    taskDefinitionId: "REPUTATION_ENTRY_BUILD_RESCUE",
    taskDefinitionVersion: 1,
    taskType: "BUILD_RESCUE",
    specification: "The package public entry point must export normalizeSlug under its declared API name while existing internal behavior remains passing.",
    desiredOutcome: "Repair the broken export surface without changing the build verifier, tests, package metadata, or implementation module.",
    editableFiles: ["src/index.ts"],
    oracleFiles: ["scripts/verify-package.mjs", "tests/slug.test.ts"],
    commands: [
      { id: "package-export-build", role: "PRIMARY", command: "npm run build", expectedExitCode: 0 },
      { id: "internal-module-regression", role: "SUPPORTING", command: "npm test", expectedExitCode: 0 },
    ],
    allowedWorkflow: "TWO_JOB_REPUTATION_ENTRY_CORPUS_COLLECTION_PILOT_V1",
  }),
  createTaskDefinition({
    taskDefinitionId: "REPUTATION_ENTRY_TEST_AND_FIX",
    taskDefinitionVersion: 2,
    taskType: "TEST_AND_FIX",
    specification: "transitionOrder(current, event) must enforce the locked order-state business rules, including PAYMENT_PENDING + CAPTURE_PAYMENT -> PAID before fulfillment is permitted.",
    desiredOutcome: "Repair the state-transition regression without changing the locked transition tests, package metadata, or acceptance criteria.",
    editableFiles: ["src/order-state.ts"],
    oracleFiles: ["tests/order-state.test.ts"],
    commands: [{ id: "order-state-transition-tests", role: "PRIMARY", command: "npm test", expectedExitCode: 0 }],
    allowedWorkflow: REPUTATION_ENTRY_PILOT,
  }),
  createTaskDefinition({
    taskDefinitionId: "REPUTATION_ENTRY_BUILD_RESCUE",
    taskDefinitionVersion: 2,
    taskType: "BUILD_RESCUE",
    specification: "The TypeScript build configuration must use NodeNext module resolution consistently with its NodeNext module target, declared source root, output directory, and locked include boundary.",
    desiredOutcome: "Repair the TypeScript build-configuration mismatch without changing the build verifier, runtime tests, package metadata, or implementation source.",
    editableFiles: ["tsconfig.build.json"],
    oracleFiles: ["scripts/verify-build-config.mjs", "tests/runtime-config.test.ts"],
    commands: [
      { id: "typescript-build-configuration", role: "PRIMARY", command: "npm run build", expectedExitCode: 0 },
      { id: "runtime-config-regression", role: "SUPPORTING", command: "npm test", expectedExitCode: 0 },
    ],
    allowedWorkflow: REPUTATION_ENTRY_PILOT,
  }),
  createTaskDefinition({
    taskDefinitionId: "REPUTATION_ENTRY_TEST_AND_FIX",
    taskDefinitionVersion: 3,
    taskType: "TEST_AND_FIX",
    specification: "retry(operation, maxRetries) must perform one initial asynchronous attempt plus at most maxRetries retries, number attempts from zero, stop at the first success, and rethrow the exact final error after exhaustion; maxRetries must be an integer from 0 through 3.",
    desiredOutcome: "Repair the asynchronous retry boundary without changing the locked retry tests, package metadata, or acceptance criteria.",
    editableFiles: ["src/retry.ts"],
    oracleFiles: ["tests/retry.test.ts"],
    commands: [{ id: "async-retry-behavior-tests", role: "PRIMARY", command: "npm test", expectedExitCode: 0 }],
    allowedWorkflow: REPUTATION_ENTRY_PILOT,
  }),
  createTaskDefinition({
    taskDefinitionId: "REPUTATION_ENTRY_BUILD_RESCUE",
    taskDefinitionVersion: 3,
    taskType: "BUILD_RESCUE",
    specification: "The TypeScript build configuration must map @shared/* exactly to src/shared/* while preserving the locked ES2022, ESNext, Bundler, rootDir, strict, noEmit, and source-include boundaries.",
    desiredOutcome: "Repair the build-time path-alias wiring without changing the build verifier, runtime test, package metadata, or implementation source.",
    editableFiles: ["tsconfig.build.json"],
    oracleFiles: ["scripts/verify-build-config.mjs", "tests/version.test.ts"],
    commands: [
      { id: "typescript-path-alias-build", role: "PRIMARY", command: "npm run build", expectedExitCode: 0 },
      { id: "shared-version-runtime-regression", role: "SUPPORTING", command: "npm test", expectedExitCode: 0 },
    ],
    allowedWorkflow: REPUTATION_ENTRY_PILOT,
  }),
] as const;

type SourceManifestInput = {
  branch: string;
  commitSha: string;
  manifestSha256: string;
  files: Array<{ relative_path: string; sha256: string }>;
};

export function createReputationEntryWorkContract(input: {
  taskId: string;
  taskType: ReputationEntryTaskType;
  assignedAgent: AgentIdentityReference;
  source: SourceManifestInput;
  taskDefinitionVersion?: number;
  lockedAt?: string;
}): ReputationEntryWorkContract {
  assertAgentIdentityReference(input.assignedAgent);
  const definition = resolveTaskDefinition(input.taskType, input.taskDefinitionVersion);
  const files = input.source.files
    .map((file) => ({ path: file.relative_path, sha256: file.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const oracleFiles = definition.oracleFiles.map((oraclePath) => {
    const source = files.find((file) => file.path === oraclePath);
    if (!source) throw new Error(`REPUTATION_ENTRY_ORACLE_FILE_MISSING: ${oraclePath}`);
    return { ...source };
  });
  for (const editablePath of definition.editableFiles) {
    if (!files.some((file) => file.path === editablePath)) {
      throw new Error(`REPUTATION_ENTRY_EDITABLE_FILE_MISSING: ${editablePath}`);
    }
    if (definition.oracleFiles.includes(editablePath)) {
      throw new Error(`REPUTATION_ENTRY_EDITABLE_FILE_IS_PROTECTED_ORACLE: ${editablePath}`);
    }
  }
  const commands = definition.commands.map((command) => ({ ...command }));
  const body: Omit<ReputationEntryWorkContract, "workContractSha256"> = {
    schemaVersion: 1,
    contractVersion: 1,
    contractType: "VERIFIED_WORK_CONTRACT_V1",
    contractVariant: REPUTATION_ENTRY_CONTRACT_VARIANT,
    status: "LOCKED",
    candidateStatus: REPUTATION_ENTRY_CANDIDATE_STATUS,
    taskId: requiredText(input.taskId, "Task ID"),
    taskType: input.taskType,
    taskDefinition: taskDefinitionReference(definition),
    assignedAgent: structuredClone(input.assignedAgent),
    specification: definition.specification,
    desiredOutcome: definition.desiredOutcome,
    repository: "NickHOI/donelayer-build-rescue-fixture",
    remoteUrl: "https://github.com/NickHOI/donelayer-build-rescue-fixture.git",
    branch: requiredText(input.source.branch, "Source branch"),
    commitSha: requiredCommit(input.source.commitSha),
    sourceIdentity: {
      branch: requiredText(input.source.branch, "Source branch"),
      commitSha: requiredCommit(input.source.commitSha),
      manifestSha256: requiredDigest(input.source.manifestSha256, "Source manifest SHA-256"),
      files,
    },
    acceptanceCriteria: {
      authority: "OWNER_LOCKED_COMMAND_ORACLE",
      immutableAfterLock: true,
      baselineMustFail: true,
      protectedOracleFiles: oracleFiles,
      commands,
      commandsSha256: sha256Canonical(commands),
    },
    permissionPolicy: structuredClone(definition.permissionPolicy),
    authorityPolicy: {
      allowedFiles: [...definition.editableFiles],
      ...structuredClone(definition.authorityPolicy),
    },
    evidencePolicy: structuredClone(definition.evidencePolicy),
    externalEffectsPolicy: structuredClone(definition.externalEffectsPolicy),
    lockedAt: input.lockedAt ?? new Date().toISOString(),
  };
  const contract = { ...body, workContractSha256: sha256Canonical(body) };
  assertReputationEntryWorkContractIntegrity(contract);
  return contract;
}

export function createReputationEntryWorkContractV2(input: {
  taskId: string;
  taskType: ReputationEntryTaskType;
  assignedAgent: AgentIdentityReference;
  source: SourceManifestInput;
  deliveryOutcomePolicy: VerifiedDeliveryOutcomePolicyName;
  taskDefinitionVersion?: number;
  lockedAt?: string;
}): ReputationEntryWorkContractV2 {
  const historicalShape = createReputationEntryWorkContract(input);
  if (!historicalShape.taskDefinition) throw new Error("REPUTATION_ENTRY_TASK_DEFINITION_REFERENCE_MISSING");
  const {
    schemaVersion: _schemaVersion,
    contractVersion: _contractVersion,
    contractType: _contractType,
    contractVariant: _contractVariant,
    workContractSha256: _workContractSha256,
    taskDefinition,
    ...shared
  } = historicalShape;
  const body: Omit<ReputationEntryWorkContractV2, "workContractSha256"> = {
    ...shared,
    schemaVersion: 2,
    contractVersion: 2,
    contractType: "VERIFIED_WORK_CONTRACT_V2",
    contractVariant: REPUTATION_ENTRY_OUTCOME_CONTRACT_VARIANT,
    taskDefinition,
    deliveryOutcomePolicy: createVerifiedDeliveryOutcomePolicy(input.deliveryOutcomePolicy),
  };
  const contract = { ...body, workContractSha256: sha256Canonical(body) };
  assertReputationEntryWorkContractV2Integrity(contract);
  return contract;
}

export function assertReputationEntryWorkContractIntegrity(contract: ReputationEntryWorkContract): void {
  assertTaskScopedWorkContractIntegrity(contract);
  const definition = resolveContractTaskDefinition(contract);
  if (
    contract.contractType !== "VERIFIED_WORK_CONTRACT_V1" ||
    ![REPUTATION_ENTRY_LEGACY_CONTRACT_VARIANT, REPUTATION_ENTRY_CONTRACT_VARIANT].includes(contract.contractVariant) ||
    contract.candidateStatus !== REPUTATION_ENTRY_CANDIDATE_STATUS ||
    contract.repository !== "NickHOI/donelayer-build-rescue-fixture" ||
    contract.remoteUrl !== "https://github.com/NickHOI/donelayer-build-rescue-fixture.git" ||
    contract.sourceIdentity.branch !== contract.branch ||
    contract.sourceIdentity.commitSha !== contract.commitSha ||
    contract.acceptanceCriteria.authority !== "OWNER_LOCKED_COMMAND_ORACLE" ||
    contract.acceptanceCriteria.immutableAfterLock !== true ||
    contract.acceptanceCriteria.baselineMustFail !== true ||
    sha256Canonical(contract.acceptanceCriteria.commands) !== contract.acceptanceCriteria.commandsSha256 ||
    canonicalJson(contractDefinitionBody(contract, definition.taskDefinitionId, definition.taskDefinitionVersion)) !==
      canonicalJson(taskDefinitionBody(definition)) ||
    !Number.isFinite(Date.parse(contract.lockedAt))
  ) throw new Error("REPUTATION_ENTRY_WORK_CONTRACT_TAMPERING_DETECTED");
  const files = new Map(contract.sourceIdentity.files.map((file) => [file.path, file.sha256]));
  if (
    files.size !== contract.sourceIdentity.files.length ||
    contract.sourceIdentity.files.some((file) => !safePath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) ||
    contract.acceptanceCriteria.protectedOracleFiles.length !== definition.oracleFiles.length ||
    contract.acceptanceCriteria.protectedOracleFiles.some((file, index) =>
      file.path !== definition.oracleFiles[index] || files.get(file.path) !== file.sha256)
  ) throw new Error("REPUTATION_ENTRY_SOURCE_ORACLE_INVALID");
}

export function assertReputationEntryWorkContractV2Integrity(contract: ReputationEntryWorkContractV2): void {
  assertTaskScopedWorkContractIntegrity(contract);
  assertVerifiedDeliveryOutcomePolicy(contract.deliveryOutcomePolicy);
  const definition = resolveContractTaskDefinition(contract);
  if (
    contract.contractType !== "VERIFIED_WORK_CONTRACT_V2" ||
    contract.contractVariant !== REPUTATION_ENTRY_OUTCOME_CONTRACT_VARIANT ||
    contract.candidateStatus !== REPUTATION_ENTRY_CANDIDATE_STATUS ||
    contract.repository !== "NickHOI/donelayer-build-rescue-fixture" ||
    contract.remoteUrl !== "https://github.com/NickHOI/donelayer-build-rescue-fixture.git" ||
    contract.sourceIdentity.branch !== contract.branch ||
    contract.sourceIdentity.commitSha !== contract.commitSha ||
    contract.acceptanceCriteria.authority !== "OWNER_LOCKED_COMMAND_ORACLE" ||
    contract.acceptanceCriteria.immutableAfterLock !== true ||
    contract.acceptanceCriteria.baselineMustFail !== true ||
    sha256Canonical(contract.acceptanceCriteria.commands) !== contract.acceptanceCriteria.commandsSha256 ||
    canonicalJson(contractDefinitionBody(contract, definition.taskDefinitionId, definition.taskDefinitionVersion)) !==
      canonicalJson(taskDefinitionBody(definition)) ||
    !Number.isFinite(Date.parse(contract.lockedAt))
  ) throw new Error("REPUTATION_ENTRY_WORK_CONTRACT_V2_TAMPERING_DETECTED");
  const files = new Map(contract.sourceIdentity.files.map((file) => [file.path, file.sha256]));
  if (
    files.size !== contract.sourceIdentity.files.length ||
    contract.sourceIdentity.files.some((file) => !safePath(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) ||
    contract.acceptanceCriteria.protectedOracleFiles.length !== definition.oracleFiles.length ||
    contract.acceptanceCriteria.protectedOracleFiles.some((file, index) =>
      file.path !== definition.oracleFiles[index] || files.get(file.path) !== file.sha256)
  ) throw new Error("REPUTATION_ENTRY_SOURCE_ORACLE_INVALID");
}

export function evaluateReputationEntryDeliveryOutcome(input: {
  contract: ReputationEntryWorkContractV2;
  executionOutcome: AgentExecutionOutcome;
  executionFailureAttribution: ExecutionFailureAttribution;
  independentVerificationOutcome: IndependentWorkVerificationOutcome;
  trustChecks: VerifiedDeliveryTrustChecks;
}): VerifiedDeliveryOutcomeEvaluation {
  assertReputationEntryWorkContractV2Integrity(input.contract);
  return evaluateVerifiedDeliveryOutcome({
    deliveryOutcomePolicy: input.contract.deliveryOutcomePolicy,
    executionOutcome: input.executionOutcome,
    executionFailureAttribution: input.executionFailureAttribution,
    independentVerificationOutcome: input.independentVerificationOutcome,
    trustChecks: input.trustChecks,
  });
}

export function reputationEntryTaskDefinition(taskType: ReputationEntryTaskType): ReputationEntryTaskDefinition {
  return structuredClone(resolveTaskDefinition(taskType));
}

export function reputationEntryTaskDefinitionVersion(
  taskType: ReputationEntryTaskType,
  version: number,
): ReputationEntryTaskDefinition {
  return structuredClone(resolveTaskDefinition(taskType, version));
}

export function assertReputationEntryTaskDefinitionIntegrity(definition: ReputationEntryTaskDefinition): void {
  const body = taskDefinitionBody(definition);
  if (
    !Number.isSafeInteger(definition.taskDefinitionVersion) ||
    definition.taskDefinitionVersion < 1 ||
    definition.taskDefinitionId !== taskDefinitionId(definition.taskType) ||
    definition.specification.trim().length === 0 ||
    definition.desiredOutcome.trim().length === 0 ||
    definition.editableFiles.length < 1 ||
    definition.oracleFiles.length < 1 ||
    definition.commands.length < 1 ||
    definition.editableFiles.some((filePath) => !safePath(filePath) || definition.oracleFiles.includes(filePath)) ||
    definition.oracleFiles.some((filePath) => !safePath(filePath)) ||
    new Set(definition.editableFiles).size !== definition.editableFiles.length ||
    new Set(definition.oracleFiles).size !== definition.oracleFiles.length ||
    definition.commands.some((command) =>
      !command.id.trim() ||
      !["PRIMARY", "SUPPORTING"].includes(command.role) ||
      !["npm test", "npm run build"].includes(command.command) ||
      command.expectedExitCode !== 0) ||
    definition.authorityPolicy.allowedWorkflows.length < 1 ||
    !/^[a-f0-9]{64}$/.test(definition.taskDefinitionSha256) ||
    sha256Canonical(body) !== definition.taskDefinitionSha256
  ) throw new Error("REPUTATION_ENTRY_TASK_DEFINITION_TAMPERING_DETECTED");
}

function createTaskDefinition(input: {
  taskDefinitionId: ReputationEntryTaskDefinitionId;
  taskDefinitionVersion: number;
  taskType: ReputationEntryTaskType;
  specification: string;
  desiredOutcome: string;
  editableFiles: string[];
  oracleFiles: string[];
  commands: LockedCommand[];
  allowedWorkflow: string;
}): ReputationEntryTaskDefinition {
  const body: Omit<ReputationEntryTaskDefinition, "taskDefinitionSha256"> = {
    taskDefinitionId: input.taskDefinitionId,
    taskDefinitionVersion: input.taskDefinitionVersion,
    taskType: input.taskType,
    specification: input.specification,
    desiredOutcome: input.desiredOutcome,
    editableFiles: [...input.editableFiles],
    oracleFiles: [...input.oracleFiles],
    commands: input.commands.map((command) => ({ ...command })),
    permissionPolicy: structuredClone(SHARED_PERMISSION_POLICY),
    authorityPolicy: {
      allowedWorkflows: [input.allowedWorkflow],
      mutationAction: "modify_authorized_source",
      verificationAction: "run_locked_verification",
      maxSandboxes: 2,
      maxCommands: 10,
    },
    evidencePolicy: structuredClone(SHARED_EVIDENCE_POLICY),
    externalEffectsPolicy: structuredClone(SHARED_EXTERNAL_EFFECTS_POLICY),
  };
  const definition = { ...body, taskDefinitionSha256: sha256Canonical(body) };
  assertReputationEntryTaskDefinitionIntegrity(definition);
  return definition;
}

function resolveTaskDefinition(
  taskType: ReputationEntryTaskType,
  version?: number,
): ReputationEntryTaskDefinition {
  const matches = TASK_DEFINITIONS.filter((definition) =>
    definition.taskType === taskType && (version === undefined || definition.taskDefinitionVersion === version));
  const resolved = version === undefined
    ? [...matches].sort((left, right) => right.taskDefinitionVersion - left.taskDefinitionVersion)[0]
    : matches[0];
  if (!resolved) throw new Error("REPUTATION_ENTRY_TASK_DEFINITION_UNKNOWN");
  assertReputationEntryTaskDefinitionIntegrity(resolved);
  return resolved;
}

function resolveContractTaskDefinition(
  contract: ReputationEntryWorkContract | ReputationEntryWorkContractV2,
): ReputationEntryTaskDefinition {
  if (
    contract.contractVariant === REPUTATION_ENTRY_CONTRACT_VARIANT ||
    contract.contractVariant === REPUTATION_ENTRY_OUTCOME_CONTRACT_VARIANT
  ) {
    if (!contract.taskDefinition) throw new Error("REPUTATION_ENTRY_TASK_DEFINITION_REFERENCE_MISSING");
    if (contract.taskDefinition.id !== taskDefinitionId(contract.taskType)) {
      throw new Error("REPUTATION_ENTRY_TASK_DEFINITION_REFERENCE_MISMATCH");
    }
    const definition = resolveTaskDefinition(contract.taskType, contract.taskDefinition.version);
    if (contract.taskDefinition.sha256 !== definition.taskDefinitionSha256) {
      throw new Error("REPUTATION_ENTRY_TASK_DEFINITION_REFERENCE_MISMATCH");
    }
    return definition;
  }
  if (contract.contractVariant !== REPUTATION_ENTRY_LEGACY_CONTRACT_VARIANT || contract.taskDefinition) {
    throw new Error("REPUTATION_ENTRY_TASK_DEFINITION_REFERENCE_INVALID");
  }
  const matching = TASK_DEFINITIONS.filter((definition) =>
    definition.taskType === contract.taskType &&
    canonicalJson(contractDefinitionBody(contract, definition.taskDefinitionId, definition.taskDefinitionVersion)) ===
      canonicalJson(taskDefinitionBody(definition)));
  if (matching.length !== 1) throw new Error("REPUTATION_ENTRY_WORK_CONTRACT_TAMPERING_DETECTED");
  return matching[0]!;
}

function contractDefinitionBody(
  contract: ReputationEntryWorkContract | ReputationEntryWorkContractV2,
  definitionId: ReputationEntryTaskDefinitionId,
  definitionVersion: number,
): Omit<ReputationEntryTaskDefinition, "taskDefinitionSha256"> {
  return {
    taskDefinitionId: definitionId,
    taskDefinitionVersion: definitionVersion,
    taskType: contract.taskType,
    specification: contract.specification,
    desiredOutcome: contract.desiredOutcome,
    editableFiles: [...(contract.authorityPolicy?.allowedFiles ?? [])],
    oracleFiles: contract.acceptanceCriteria.protectedOracleFiles.map((file) => file.path),
    commands: contract.acceptanceCriteria.commands.map((command) => ({ ...command })),
    permissionPolicy: structuredClone(contract.permissionPolicy),
    authorityPolicy: {
      allowedWorkflows: [...(contract.authorityPolicy?.allowedWorkflows ?? [])],
      mutationAction: contract.authorityPolicy?.mutationAction ?? "",
      verificationAction: contract.authorityPolicy?.verificationAction ?? "",
      maxSandboxes: contract.authorityPolicy?.maxSandboxes ?? 0,
      maxCommands: contract.authorityPolicy?.maxCommands ?? 0,
    },
    evidencePolicy: structuredClone(contract.evidencePolicy),
    externalEffectsPolicy: structuredClone(contract.externalEffectsPolicy),
  };
}

function taskDefinitionBody(
  definition: ReputationEntryTaskDefinition,
): Omit<ReputationEntryTaskDefinition, "taskDefinitionSha256"> {
  const { taskDefinitionSha256: _taskDefinitionSha256, ...body } = definition;
  return body;
}

function taskDefinitionReference(definition: ReputationEntryTaskDefinition): ReputationEntryTaskDefinitionReference {
  return {
    id: definition.taskDefinitionId,
    version: definition.taskDefinitionVersion,
    sha256: definition.taskDefinitionSha256,
  };
}

function taskDefinitionId(taskType: ReputationEntryTaskType): ReputationEntryTaskDefinitionId {
  return taskType === "TEST_AND_FIX" ? "REPUTATION_ENTRY_TEST_AND_FIX" : "REPUTATION_ENTRY_BUILD_RESCUE";
}

function requiredText(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function requiredCommit(value: string): string {
  const commit = value.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Source commit is invalid");
  return commit;
}

function requiredDigest(value: string, label: string): string {
  const digest = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`${label} is invalid`);
  return digest;
}

function safePath(value: string): boolean {
  return Boolean(value) && !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..");
}
