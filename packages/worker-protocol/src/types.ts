export const WORKER_PROTOCOL_VERSION = "1.0" as const;

export const WORKFLOW_TEMPLATE_IDS = [
  "DIAGNOSE_REPOSITORY",
  "BUILD_RESCUE",
  "TEST_AND_FIX",
  "FEATURE_COMPLETION",
  "PULL_REQUEST_VERIFICATION",
  "LAUNCH_READINESS",
] as const;

export type WorkflowTemplateId = (typeof WORKFLOW_TEMPLATE_IDS)[number];

export const SAFE_COMMAND_IDS = [
  "NPM_INSTALL_CI",
  "NPM_TEST",
  "NPM_BUILD",
  "NPM_LINT",
  "PNPM_INSTALL_FROZEN",
  "PNPM_TEST",
  "PNPM_BUILD",
  "PNPM_LINT",
  "YARN_INSTALL_IMMUTABLE",
  "YARN_TEST",
  "YARN_BUILD",
  "YARN_LINT",
  "CARGO_TEST",
  "CARGO_BUILD",
  "PYTHON_PYTEST",
  "GO_TEST",
  "SWIFT_TEST",
  "XCODEBUILD_TEST",
] as const;

export type SafeCommandId = (typeof SAFE_COMMAND_IDS)[number];
export type ExecutorKind = "demo" | "codex-cli";
export type WorkerStatus = "ONLINE" | "BUSY" | "OFFLINE" | "SUSPENDED";
export type OperatingSystem = "windows" | "macos" | "linux" | "unknown";

export type McpServerCapability = {
  name: string;
  transport: "stdio" | "sse" | "streamable-http" | "unknown";
  tools: string[];
  resources: string[];
  prompts: string[];
  authenticationRequired: boolean;
  installed: boolean;
};

export type WorkerCapabilities = {
  os: OperatingSystem;
  architecture: string;
  cpuCount: number;
  memoryBytes: number;
  freeDiskBytes: number;
  dockerAvailable: boolean;
  codexAvailable: boolean;
  gitAvailable: boolean;
  githubCliAvailable: boolean;
  supportedLanguages: string[];
  installedTools: string[];
  mcpServers: McpServerCapability[];
  executors: ExecutorKind[];
  maxConcurrentJobs: number;
};

export type PairWorkerRequest = {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  pairingCode: string;
  name: string;
  capabilities: WorkerCapabilities;
};

export type PairWorkerResponse = {
  workerId: string;
  workerToken: string;
  pairedAt: string;
  tokenExpiresAt?: string | undefined;
};

export type WorkerHeartbeat = {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  status: Exclude<WorkerStatus, "OFFLINE" | "SUSPENDED">;
  capabilities: WorkerCapabilities;
  activeJobRunIds: string[];
  sentAt: string;
};

export type JobLimits = {
  timeoutMs: number;
  maxLogBytes: number;
  maxArtifactBytes: number;
  maxArtifacts: number;
  allowedMimeTypes: string[];
  allowedNetworkDomains: string[];
};

export type JobPermissions = {
  modifyCode: boolean;
  createPullRequest: boolean;
  humanApprovalRequired: boolean;
};

export type AcceptanceCheckType =
  | "COMMAND_EXIT"
  | "TEST"
  | "BUILD"
  | "GITHUB_CHECK"
  | "FILE_EXISTS"
  | "DIFF"
  | "PULL_REQUEST"
  | "URL_HEALTH"
  | "SCREENSHOT"
  | "HUMAN_APPROVAL";

export type AcceptanceCheck = {
  id: string;
  type: AcceptanceCheckType;
  required: boolean;
  label: string;
  config: Record<string, unknown>;
};

export type JobEnvelope = {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  taskId: string;
  assignmentId: string;
  providerAcceptedAt: string;
  jobRunId: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  executor: {
    kind: ExecutorKind;
    model?: string | undefined;
  };
  workflow: {
    id: WorkflowTemplateId;
    version: 1;
    allowedCommandIds: SafeCommandId[];
  };
  task: {
    title: string;
    problemDescription: string;
    desiredOutcome: string;
    scopeSummary: string;
    acceptanceChecks: AcceptanceCheck[];
  };
  repository: {
    mode: "demo" | "github-app";
    owner: string;
    name: string;
    targetBranch: string;
    commitSha?: string | undefined;
    archiveUrl?: string | undefined;
  };
  permissions: JobPermissions;
  limits: JobLimits;
};

export type JobRunEventType =
  | "WORKSPACE_PREPARED"
  | "EXECUTOR_STARTED"
  | "PROGRESS"
  | "LOG"
  | "FILE_CHANGED"
  | "TEST_RESULT"
  | "BUILD_RESULT"
  | "ARTIFACT_CREATED"
  | "EXECUTOR_FINISHED"
  | "EXECUTOR_FAILED"
  | "CANCELLED"
  | "CLEANUP_FINISHED";

export type JobRunEvent = {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  eventId: string;
  jobRunId: string;
  sequence: number;
  type: JobRunEventType;
  message: string;
  progress?: number | undefined;
  data?: Record<string, unknown> | undefined;
  createdAt: string;
};

export type CommandExecutionRecord = {
  commandId: SafeCommandId;
  exitCode: number;
  startedAt: string;
  endedAt: string;
  stdout?: string | undefined;
  stderr?: string | undefined;
};

export type TestSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
};

export type ProducedArtifact = {
  artifactType:
    | "GIT_DIFF"
    | "BUILD_LOG"
    | "TEST_LOG"
    | "TEST_RESULT"
    | "SCREENSHOT"
    | "EXECUTOR_RESULT"
    | "OTHER";
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type ExecutionResult = {
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  startedAt: string;
  endedAt: string;
  exitCode: number;
  commitShaBefore?: string | undefined;
  commitShaAfter?: string | undefined;
  gitDiff: string;
  changedFiles: string[];
  commandsRun: CommandExecutionRecord[];
  tests?: TestSummary | undefined;
  buildSucceeded?: boolean | undefined;
  pullRequestUrl?: string | undefined;
  artifacts: ProducedArtifact[];
};

export type UploadedArtifact = {
  artifactId: string;
  artifactType: ProducedArtifact["artifactType"];
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
};

export type SubmitJobRunRequest = {
  protocolVersion: typeof WORKER_PROTOCOL_VERSION;
  leaseToken: string;
  result: Omit<ExecutionResult, "artifacts">;
  artifacts: UploadedArtifact[];
};

export type JobControlResponse = {
  cancelRequested: boolean;
  leaseExpiresAt: string;
};
