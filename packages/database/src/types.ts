import type { AcceptanceCheck, TaskAnalysis, TaskStatus, TaskType } from "@donelayer/shared";
import type { PermissionScope as ProtocolPermissionScope, WorkerCapabilities } from "@donelayer/worker-protocol";

export interface AgentRecord {
  id: string;
  slug: string;
  name: string;
  version: string;
  providerId: string;
  providerName: string;
  description: string;
  skills: string[];
  taskTypes: TaskType[];
  languages: string[];
  operatingSystems: string[];
  tools: string[];
  requiredMcpServers: string[];
  pricingModel: "FIXED" | "HOURLY" | "FROM";
  basePriceCents: number;
  averageCompletionMinutes: number;
  completedTasks: number;
  verifiedSuccessRate: number;
  rating: number;
  workerStatus: "ONLINE" | "BUSY" | "OFFLINE";
  lastActiveAt: string;
  verificationStatus: "VERIFIED" | "PENDING" | "REJECTED" | "SUSPENDED";
  endpointType: "LOCAL_WORKER" | "PLATFORM_MANAGED" | "WEBHOOK" | "A2A" | "DEMO";
  endpointUrl: string | null;
  authenticationType: "NONE" | "HMAC" | "API_KEY" | "OAUTH" | "A2A_METADATA";
  inputModes: string[];
  outputModes: string[];
  acceptingTasks: boolean;
  recentFailures: number;
  currentWorkload: number;
  maxConcurrentJobs: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerRecord {
  id: string;
  providerId: string;
  name: string;
  status: "ONLINE" | "BUSY" | "OFFLINE" | "SUSPENDED";
  os: "WINDOWS" | "MACOS" | "LINUX";
  installedTools: string[];
  mcpTools: string[];
  executors: string[];
  maxConcurrentJobs: number;
  activeJobs: number;
  lastHeartbeatAt: string;
  tokenHash: string | null;
  tokenId: string | null;
  acceptingJobs: boolean;
  capabilitySnapshot?: WorkerCapabilities | null;
  capabilitySnapshotId?: string | null;
  createdAt: string;
  updatedAt: string;
  executionNodeType?: "LOCAL_WORKER" | "PLATFORM_MANAGED" | undefined;
}

export interface TaskRecord {
  id: string;
  customerId: string;
  title: string;
  problemDescription: string;
  desiredOutcome: string;
  repository: string;
  targetBranch: string;
  taskType:
    | TaskType
    | "REPOSITORY_MATERIALIZATION_V1"
    | "MANAGED_REMOTE_SANDBOX_SMOKE_V1"
    | "MANAGED_SANDBOX_TIMEOUT_PROBE_V1"
    | "REAL_BUILD_TEST_MANAGED_SANDBOX_V1";
  requiredSkills: string[];
  requiredOperatingSystem: string | null;
  requiredTools: string[];
  requiredMcpTools: string[];
  budgetCents: number;
  deadline: string;
  acceptanceChecks: AcceptanceCheck[];
  securitySensitivity: "LOW" | "MEDIUM" | "HIGH";
  allowCodeChanges: boolean;
  allowPullRequest: boolean;
  requiresHumanApproval: boolean;
  preferredAgentId: string | null;
  status: TaskStatus;
  version: number;
  analysis: TaskAnalysis | null;
  matchedAgentId: string | null;
  assignedWorkerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEventRecord {
  id: string;
  taskId: string;
  sequence: number;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus;
  actorKind: string;
  actorId: string;
  reason: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MatchRecord {
  id: string;
  taskId: string;
  agentId: string;
  workerId: string;
  rank: number;
  totalScore: number;
  components: Record<string, number>;
  reasons: string[];
  eligible: boolean;
  createdAt: string;
}

export interface AssignmentRecord {
  id: string;
  taskId: string;
  agentId: string;
  providerId: string;
  workerId: string;
  status: "OFFERED" | "ACCEPTED" | "DECLINED" | "COMPLETED";
  quoteCents: number;
  providerEarningCents: number;
  platformFeeCents: number;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobRunRecord {
  id: string;
  taskId: string;
  assignmentId: string;
  workerId: string;
  agentId: string;
  status: "QUEUED" | "RUNNING" | "SUBMITTED" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";
  executor: "DEMO" | "CODEX" | "WEBHOOK" | "WORKER_SMOKE" | "REPOSITORY_MATERIALIZER" | "MANAGED_SANDBOX";
  workflowTemplate:
    | TaskType
    | "WORKER_SMOKE_V1"
    | "REPOSITORY_MATERIALIZE_V1"
    | "MANAGED_REMOTE_SANDBOX_SMOKE_V1"
    | "MANAGED_SANDBOX_TIMEOUT_PROBE_V1"
    | "NODE_BUILD_TEST_MANAGED_SANDBOX_V1";
  executionBackendType: "LOCAL_WORKER" | "MANAGED_REMOTE_SANDBOX";
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  commitShaBefore: string | null;
  commitShaAfter: string | null;
  leaseId: string | null;
  leaseTokenHash: string | null;
  leaseExpiresAt: string | null;
  taskContractVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerCapabilitySnapshotRecord {
  id: string;
  workerId: string;
  capabilities: WorkerCapabilities;
  reportedAt: string;
  createdAt: string;
}

export interface WorkerHeartbeatRecord {
  id: string;
  workerId: string;
  status: "ONLINE" | "BUSY";
  activeJobRunIds: string[];
  sentAt: string;
  receivedAt: string;
  capabilitySnapshotId: string;
}

export interface JobCapabilityEvidenceRecord {
  jobRunId: string;
  snapshotId: string;
  capabilities: WorkerCapabilities;
  capturedAt: string;
}

export interface JobRunAttemptRecord {
  jobRunId: string;
  attemptNumber: number;
  supersedesJobRunId: string | null;
  terminalReason: string | null;
  leaseRevokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEventRecord {
  id: string;
  jobRunId: string;
  sequence: number;
  kind: "STATUS" | "LOG" | "PROGRESS" | "FILE_CHANGE" | "TEST" | "BUILD" | "EVIDENCE";
  level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EvidenceArtifactRecord {
  id: string;
  taskId: string;
  workerId: string;
  jobRunId: string;
  artifactType: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  claimedSha256?: string;
  serverSha256?: string;
  sandboxRunId?: string | null;
  storagePath: string;
  content: string;
  createdAt: string;
}

export interface VerificationResultRecord {
  id: string;
  taskId: string;
  jobRunId: string;
  checkId: string;
  checkType: string;
  status: "PASSED" | "FAILED" | "PENDING" | "ERROR";
  summary: string;
  observed: Record<string, unknown>;
  createdAt: string;
}

export type TaskContractStatus = "DRAFT" | "LOCKED" | "SUPERSEDED" | "CANCELLED";

export interface TaskContractDocument {
  taskId: string;
  taskType: string;
  desiredOutcome: string;
  deliverables: string[];
  allowedWorkflow: string;
  allowedActions: string[];
  forbiddenActions: string[];
  acceptanceChecks: Array<{
    id: string;
    label: string;
    required: boolean;
    type: string;
    config: Record<string, unknown>;
  }>;
  requiredEvidence: string[];
  budgetLimit: {
    currency: string;
    maxAmount: number;
  };
  timeLimitSeconds: number;
  privacyClassification: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  humanApprovalRequirements: string[];
  failureConditions: string[];
  contractVersion: number;
}

export interface TaskContractVersionRecord {
  id: string;
  taskId: string;
  version: number;
  status: TaskContractStatus;
  contract: TaskContractDocument;
  contractSha256: string;
  createdBy: string;
  createdAt: string;
  lockedAt: string | null;
  supersededAt: string | null;
}

export type PermissionLeaseStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "REVOKED" | "VIOLATED" | "COMPLETED";

export type PermissionScope = ProtocolPermissionScope;

export interface PermissionLeaseRecord {
  id: string;
  taskId: string;
  taskContractVersionId: string;
  jobRunId: string;
  agentId: string;
  workerId: string;
  version: number;
  status: PermissionLeaseStatus;
  scope: PermissionScope;
  startsAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
  createdBy: string;
}

export type EvidenceLedgerEntryType =
  | "CONTRACT_LOCKED"
  | "PERMISSION_GRANTED"
  | "JOB_CLAIMED"
  | "HEARTBEAT_RECORDED"
  | "EXECUTION_STARTED"
  | "REPOSITORY_CLONE_STARTED"
  | "REPOSITORY_CLONE_COMPLETED"
  | "REMOTE_METADATA_CAPTURED"
  | "FILE_MANIFEST_CREATED"
  | "ARTIFACT_CREATED"
  | "ARTIFACT_UPLOADED"
  | "ARTIFACT_HASH_VERIFIED"
  | "REMOTE_COMMIT_VERIFIED"
  | "REPOSITORY_VERIFIED"
  | "SOURCE_PACKAGE_CREATED"
  | "SOURCE_PACKAGE_VERIFIED"
  | "SOURCE_PACKAGE_UPLOADED"
  | "SOURCE_MANIFEST_VERIFIED"
  | "NETWORK_POLICY_UPDATED"
  | "DEPENDENCY_INSTALL_STARTED"
  | "DEPENDENCY_INSTALL_COMPLETED"
  | "BUILD_STARTED"
  | "BUILD_COMPLETED"
  | "TEST_STARTED"
  | "TEST_FAILED"
  | "SOURCE_INTEGRITY_VERIFIED"
  | "MANAGED_SANDBOX_REQUESTED"
  | "MANAGED_SANDBOX_CREATED"
  | "MANAGED_SANDBOX_POLICY_VERIFIED"
  | "MANAGED_SANDBOX_STARTED"
  | "NETWORK_PROBE_COMPLETED"
  | "MANAGED_SANDBOX_STOP_REQUESTED"
  | "MANAGED_SANDBOX_STOPPED"
  | "MANAGED_SANDBOX_CLEANUP_VERIFIED"
  | "TIMEOUT_TRIGGERED"
  | "STALE_RESULT_REJECTED"
  | "VERIFICATION_PASSED"
  | "VERIFICATION_FAILED"
  | "CONTRACT_ASSERTIONS_LOCKED"
  | "TEST_ORACLE_INSPECTED"
  | "SPEC_TEST_CONFLICT_DETECTED"
  | "SEMANTIC_VERIFICATION_STARTED"
  | "CONTRACT_ASSERTION_PASSED"
  | "CONTRACT_ASSERTION_FAILED"
  | "ENGINEERING_REVIEW_REQUIRED"
  | "SEMANTIC_VERIFICATION_PASSED"
  | "EVIDENCE_BUNDLE_CREATED"
  | "RECEIPT_SUPERSEDED"
  | "AUTHORITY_DECISION_RECORDED"
  | "PROTECTED_ACTION_ALLOWED"
  | "PROTECTED_ACTION_DENIED"
  | "PERMISSION_LEASE_REVOKED"
  | "AGENT_IDENTITY_CREATED"
  | "AGENT_PROFILE_REVISION_CREATED"
  | "EXTERNAL_IDENTITY_LINKED"
  | "AGENT_EXECUTION_IDENTITY_CREATED"
  | "IDENTITY_BINDING_VERIFIED"
  | "IDENTITY_BINDING_DENIED"
  | "PERMISSION_VIOLATION"
  | "WORKSPACE_CLEANED"
  | "RECEIPT_CREATED";

export interface EvidenceLedgerEntryRecord {
  id: string;
  taskId: string;
  jobRunId: string;
  sequenceNumber: number;
  entryType: EvidenceLedgerEntryType;
  sourceRecordType: string;
  sourceRecordId: string;
  payloadSha256: string;
  previousEntrySha256: string | null;
  entrySha256: string;
  createdAt: string;
}

export interface EvidenceLedgerVerification {
  valid: boolean;
  entryCount: number;
  chainSha256: string | null;
  invalidSequence: number | null;
  reason: string | null;
}

export type JobReceiptResult =
  | "VERIFIED"
  | "VERIFIED_DELIVERY"
  | "CONTRACT_VERIFIED"
  | "CONTRACT_VERIFIED_DELIVERY"
  | "SPEC_TEST_CONFLICT"
  | "TEST_ORACLE_SUSPECT"
  | "ACCEPTANCE_CRITERIA_CONFLICT"
  | "ENGINEERING_REVIEW_REQUIRED"
  | "SUPERSEDED"
  | "INVALIDATED_FOR_SEMANTIC_SUCCESS"
  | "PARTIALLY_VERIFIED"
  | "FAILED"
  | "UNVERIFIED"
  | "DISPUTED"
  | "PERMISSION_VIOLATION"
  | "INVALID_EVIDENCE_CHAIN";

export type BuildTestCommandStatus =
  | "PASSED"
  | "FAILED"
  | "NOT_PRESENT"
  | "TIMED_OUT"
  | "UNPARSABLE";

export interface ReceiptArtifactReference {
  fileName: string;
  sha256: string;
}

export interface BuildTestCommandSummary {
  command: string;
  exitCode: number | null;
  durationMs: number;
  status: BuildTestCommandStatus;
  stdoutArtifact: ReceiptArtifactReference;
  stderrArtifact: ReceiptArtifactReference;
}

export interface RealBuildTestReceiptSummary {
  sourceManifestSha256: string;
  sourcePackageSha256: string;
  nodeVersion: string;
  npmVersion: string;
  install: BuildTestCommandSummary;
  build: BuildTestCommandSummary;
  test: BuildTestCommandSummary;
  testRunner: string | null;
  totalTests: number | null;
  passedTests: number | null;
  failedTests: number | null;
  statisticsStatus: "PARSED" | "UNPARSABLE";
  sourceMutationDetected: boolean;
  networkViolationCount: number;
  permissionViolationCount: number;
  providerPayoutReleased: boolean;
}

export interface AgentRepairReceiptSummary {
  gateway: "Vercel AI Gateway";
  modelProvider: string;
  modelId: string;
  agentProviderAdapter: "VercelAIGatewayAgentProvider";
  authentication: "VERCEL_OIDC" | "AI_GATEWAY_API_KEY";
  freeCreditBalanceBefore: string;
  freeCreditUsed: string | null;
  freeCreditBalanceAfter: string;
  apiRequestCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  gatewayReportedCostUsd: number | null;
  baselineTestExitCode: number;
  repairedTestExitCode: number | null;
  patchSha256: string;
  modifiedFiles: string[];
  toolCallCount: number;
  cleanupVerified: boolean;
}

export interface GitHubDeliveryVerificationReceiptSummary {
  repairVerified: boolean;
  deliveredToGitHub: boolean;
  independentCleanVerification: "PASSED" | "FAILED";
  repository: string;
  deliveryBranch: string;
  deliveryCommitSha: string;
  parentCommitSha: string;
  deliveryDiffSha256: string;
  authenticationMode: "OWNER_DEVELOPMENT_GITHUB_AUTH";
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestState: "OPEN" | "CLOSED";
  merged: boolean;
  verifierType: "NON_AI_DETERMINISTIC_VERIFIER";
  verificationSandboxId: string;
  installExitCode: number;
  buildStatus: "PASSED" | "NOT_PRESENT";
  testExitCode: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  testsUnchanged: boolean;
  testScriptUnchanged: boolean;
  policyViolationCount: number;
  cleanupVerified: boolean;
  paymentMode: "SIMULATION_ONLY";
  testLedgerState: "RESERVED" | "RELEASED";
  simulatedProviderPayoutCents: number;
  simulatedPlatformFeeCents: number;
  aiCallCount: 0;
  aiGatewayUsageUsd: 0;
}

export interface SemanticVerificationReceiptSummary {
  outcome:
    | "CONTRACT_VERIFIED"
    | "SPEC_TEST_CONFLICT"
    | "TEST_ORACLE_SUSPECT"
    | "ACCEPTANCE_CRITERIA_CONFLICT"
    | "ENGINEERING_REVIEW_REQUIRED";
  executionIntegrity: "VALID" | "INVALID" | "NOT_RUN";
  testConformity: "PASSED" | "FAILED" | "CONFLICT" | "NOT_RUN";
  contractConformity: "VERIFIED" | "FAILED" | "CONFLICT" | "REVIEW_REQUIRED" | "NOT_RUN";
  deliveryIntegrity: "VALID" | "INVALID" | "NOT_RUN";
  overall: "VERIFIED_DELIVERY" | "ENGINEERING_REVIEW_REQUIRED" | "SUPERSEDED" | "FAILED";
  assertionsSha256: string;
  repositoryTestExpectationCount: number;
  contractAssertionPassedCount: number;
  contractAssertionFailedCount: number;
  testsModified: boolean;
  acceptanceCriteriaModified: boolean;
  agentCallCount: number;
  sandboxRepairAttemptCount: number;
  payoutReleased: boolean;
  supersedesReceiptId?: string | undefined;
}

export interface VerifiedDeliveryOutcomeReceiptSummary {
  executionOutcome: "COMPLETED" | "FAILED" | "INCONCLUSIVE" | "TIMEOUT" | "PROVIDER_FAILURE";
  executionFailureAttribution: "NOT_APPLICABLE" | "AGENT" | "MODEL_PROVIDER" | "INFRASTRUCTURE" | "UNKNOWN";
  independentVerificationOutcome: "VERIFIED" | "FAILED" | "INCONCLUSIVE" | "INVALID_EVIDENCE" | "NO_DELIVERABLE";
  deliveryOutcomePolicy: "EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED" | "INDEPENDENT_ACCEPTANCE_SUFFICIENT";
  deliveryOutcome: "VERIFIED_DELIVERY" | "FAILED" | "INCONCLUSIVE" | "BLOCKED";
  candidateEligible: boolean;
}

export interface VerifiedJobReceiptDocument {
  schemaVersion: 1;
  receiptType:
    | "WORKER_INFRASTRUCTURE_VERIFICATION"
    | "REPOSITORY_MATERIALIZATION_VERIFICATION"
    | "MANAGED_REMOTE_SANDBOX_VERIFICATION"
    | "REAL_BUILD_TEST_MANAGED_SANDBOX_VERIFICATION"
    | "AGENT_REPAIR_MANAGED_SANDBOX_VERIFICATION";
  claim: "Hash-verifiable DoneLayer execution receipt.";
  publicReceiptId: string;
  whoRequested: {
    customerReference: string;
    taskId: string;
    orderedAt: string;
  };
  whoExecuted: {
    agentId: string;
    agentPublicIdentity: string;
    agentVersion: string;
    providerId: string;
    workerId: string | null;
    workerPublicIdentity: string;
    workerVersion: string | null;
    capabilitySnapshot: WorkerCapabilities | null;
    runtime: string;
    os: string;
    processId?: number | undefined;
  };
  executionBackend?: {
    orchestrator: "DONE_LAYER_SERVER";
    executionBackendType: "MANAGED_REMOTE_SANDBOX";
    sandboxProvider: "VERCEL_SANDBOX";
    providerSandboxId: string;
    providerRequestId: string | null;
    isolationModel: "REMOTE_MICROVM";
    lifecycleMode: "NON_PERSISTENT";
    runtime: string;
    region: string | null;
  } | undefined;
  whatWasAgreed: {
    taskContractVersionId: string;
    contractVersion: number;
    contractSha256: string;
    desiredOutcome: string;
    deliverables: string[];
    acceptanceChecks: TaskContractDocument["acceptanceChecks"];
  };
  whatWasPermitted: {
    permissionLeaseId: string;
    allowedActions: string[];
    deniedActions: string[];
    effectiveAt: string;
    expiresAt: string;
    budgetLimit: TaskContractDocument["budgetLimit"];
    permissionViolations: string[];
  };
  whatHappened: {
    jobRunId: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    importantRunEvents: Array<{ type: string; createdAt: string }>;
    artifacts: Array<{ id: string; fileName: string; mimeType: string; size: number; sha256: string }>;
    workspaceCleaned: boolean;
    repositoryMaterialization?: {
      remoteUrl: string;
      branch: string;
      workerCommitSha: string;
      independentRemoteCommitSha: string;
      cloneExitCode: number;
      cloneDurationMs: number;
      fileCount: number;
      manifestSha256: string;
      artifactSha256: string;
      noRepositoryCodeExecuted: boolean;
    } | undefined;
    managedSandbox?: {
      sandboxRunId: string;
      provider: "VERCEL_SANDBOX";
      providerSandboxId: string;
      providerRequestId: string | null;
      isolationModel: "REMOTE_MICROVM";
      lifecycleMode: "NON_PERSISTENT";
      runtime: string;
      region: string | null;
      networkPolicy: "deny-all";
      allowedDomainCount: 0;
      allowedCidrCount: 0;
      runtimeLimitSeconds: number;
      exitCode: number;
      networkProbeBlocked: boolean | null;
      artifactSha256: string;
      cleanupVerified: boolean;
      finalProviderState: string;
      persistentSnapshotCreated: false;
      localHostExecutionUsed: false;
      localDockerUsed: false;
    } | undefined;
    buildTest?: RealBuildTestReceiptSummary | undefined;
    agentRepair?: AgentRepairReceiptSummary | undefined;
  };
  howVerified: {
    checks: Array<{ id: string; status: string; summary: string }>;
    workerSha256: string;
    serverSha256: string;
    evidenceLedger: EvidenceLedgerVerification;
    humanApproval: string | null;
  };
  finalResult: JobReceiptResult;
  issuedAt: string;
}

export interface JobReceiptRecord {
  id: string;
  receiptPublicId: string;
  taskId: string;
  jobRunId: string;
  taskContractVersionId: string;
  permissionLeaseId: string;
  result: JobReceiptResult;
  receipt: VerifiedJobReceiptDocument;
  receiptSha256: string;
  evidenceChainSha256: string;
  createdAt: string;
  invalidatedAt: string | null;
  invalidationReason: string | null;
}

export interface PublicJobReceipt {
  publicReceiptId: string;
  taskType:
    | "Worker Infrastructure Verification"
    | "Repository Materialization Verification"
    | "Managed Remote Sandbox Verification"
    | "Real Build and Test Verification"
    | "Agent Repair in Managed Sandbox Verification"
    | "GitHub Delivery and Independent Verification"
    | "Semantic Verification Review"
    | "Semantic Contract Verification and GitHub Delivery"
    | "Verified Delivery Outcome Policy Verification";
  agentIdentity: string;
  agentIdentityBinding?: {
    agentId: string;
    profileRevision: number;
    profileSha256: string;
    executionId: string;
    executionSha256: string;
    displayNameAtExecution: string;
  } | undefined;
  workerIdentity: string;
  contractSha256: string;
  evidenceChainSha256: string;
  artifactSha256: string;
  verificationSummary: string;
  result: JobReceiptResult;
  createdAt: string;
  verificationStatus: "VALID" | "INVALID";
  invalidated: boolean;
  disputed: boolean;
  repository?: {
    remoteUrl: string;
    branch: string;
    workerCommitSha: string;
    independentRemoteCommitSha: string;
    manifestSha256: string;
    fileCount: number;
  } | undefined;
  managedSandbox?: {
    provider: "VERCEL_SANDBOX";
    sandboxIdentity: string;
    isolationModel: "REMOTE_MICROVM";
    lifecycleMode: "NON_PERSISTENT";
    runtime: string;
    region: string | null;
    networkPolicy: "deny-all";
    exitCode: number;
    networkProbeBlocked: boolean | null;
    cleanupVerified: boolean;
    localHostExecutionUsed: false;
    localDockerUsed: false;
    persistentSnapshotCreated: false;
  } | undefined;
  buildTest?: RealBuildTestReceiptSummary | undefined;
  agentRepair?: AgentRepairReceiptSummary | undefined;
  githubDelivery?: GitHubDeliveryVerificationReceiptSummary | undefined;
  semanticVerification?: SemanticVerificationReceiptSummary | undefined;
  verifiedDeliveryOutcomes?: VerifiedDeliveryOutcomeReceiptSummary | undefined;
  scopeDisclaimer: string;
}

export type ManagedSandboxRunStatus =
  | "REQUESTED"
  | "CREATING"
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLING"
  | "STOPPED"
  | "DESTROYED"
  | "CLEANUP_UNVERIFIED";

export interface ManagedSandboxRunRecord {
  id: string;
  jobRunId: string;
  provider: "VERCEL_SANDBOX";
  providerSandboxId: string | null;
  providerRequestId: string | null;
  executionBackendType: "MANAGED_REMOTE_SANDBOX";
  isolationModel: "REMOTE_MICROVM";
  lifecycleMode: "NON_PERSISTENT";
  status: ManagedSandboxRunStatus;
  region: string | null;
  runtime: string;
  networkPolicy: Record<string, unknown>;
  limits: Record<string, unknown>;
  providerMetadata: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stoppedAt: string | null;
  destroyedAt: string | null;
  cleanupVerifiedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface LedgerEntryRecord {
  id: string;
  taskId: string | null;
  walletId: string;
  transactionKey: string;
  entryType: "RESERVE" | "RELEASE" | "REFUND" | "DISPUTE_HOLD" | "PLATFORM_FEE";
  amountCents: number;
  createdAt: string;
}

export interface WalletRecord {
  id: string;
  ownerId: string;
  kind: "CUSTOMER" | "PROVIDER" | "PLATFORM" | "ESCROW" | "DISPUTE";
  availableCents: number;
  reservedCents: number;
  pendingCents: number;
  updatedAt: string;
}

export interface DisputeRecord {
  id: string;
  taskId: string;
  openedBy: string;
  reason: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";
  heldAmountCents: number;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorKind: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  success: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProfileRecord {
  id: string;
  name: string;
  role: "CUSTOMER" | "PROVIDER" | "ADMIN";
  createdAt: string;
  updatedAt: string;
}

export interface TaskAggregate {
  task: TaskRecord;
  events: TaskEventRecord[];
  matches: Array<MatchRecord & { agent: AgentRecord }>;
  agent: AgentRecord | null;
  worker: WorkerRecord | null;
  assignment: AssignmentRecord | null;
  jobRun: JobRunRecord | null;
  jobAttempt?: JobRunAttemptRecord | null;
  capabilityEvidence?: JobCapabilityEvidenceRecord | null;
  jobEvents: JobEventRecord[];
  evidence: EvidenceArtifactRecord[];
  verificationResults: VerificationResultRecord[];
  taskContract: TaskContractVersionRecord | null;
  permissionLease: PermissionLeaseRecord | null;
  evidenceLedger: EvidenceLedgerEntryRecord[];
  evidenceLedgerVerification: EvidenceLedgerVerification;
  receipt: JobReceiptRecord | null;
  ledgerEntries: LedgerEntryRecord[];
}

export interface DashboardSnapshot {
  taskCounts: Record<string, number>;
  tasks: TaskRecord[];
  customerWallet: WalletRecord;
  providerWallet: WalletRecord;
  platformWallet: WalletRecord;
  agents: AgentRecord[];
  workers: WorkerRecord[];
}
