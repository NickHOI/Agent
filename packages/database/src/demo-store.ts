import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { rankCandidates } from "@donelayer/matching";
import { evaluateProofOfDone, getEvidenceDigest } from "@donelayer/proof-of-done";
import {
  createTaskInputSchema,
  type Actor,
  type CreateTaskInput,
  type EvidenceInput,
  type TaskAnalysis,
  type TaskStatus
} from "@donelayer/shared";
import { validateTransition } from "@donelayer/task-state-machine";
import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  MANAGED_SANDBOX_ALLOWED_ACTIONS,
  MANAGED_SANDBOX_ARTIFACTS,
  MANAGED_SANDBOX_BUILD_TEST_ALLOWED_ACTIONS,
  MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS,
  MANAGED_SANDBOX_BUILD_TEST_DENIED_ACTIONS,
  MANAGED_SANDBOX_DENIED_ACTIONS,
  MANAGED_SANDBOX_EXECUTION_BACKEND,
  MANAGED_SANDBOX_ISOLATION_MODEL,
  MANAGED_SANDBOX_LIFECYCLE_MODE,
  MANAGED_SANDBOX_PROVIDER,
  MANAGED_SANDBOX_RUNTIME,
  MANAGED_SANDBOX_SMOKE_FILE,
  MANAGED_SANDBOX_SMOKE_WORKFLOW,
  MANAGED_SANDBOX_TIMEOUT_WORKFLOW,
  NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW,
  REAL_BUILD_TEST_MANAGED_SANDBOX_TASK_TYPE,
  managedSandboxBuildTestSecurityProfile,
  managedSandboxBuildTestPermissionScope,
  managedSandboxPermissionScope,
  managedSandboxTimeoutPermissionScope,
  assertAllowlistedRepositoryUrl,
  canonicalRepositoryJson,
  repositoryFileManifestSchema,
  repositoryManifestSha256,
  repositoryMetadataSchema,
  workerCapabilitiesSchema,
  type WorkerCapabilities,
} from "@donelayer/worker-protocol";
import { demoAcceptanceChecks, createSeedAgents, createSeedWorkers } from "./seed-data";
import { demoSchemaSql } from "./schema";
import {
  agentExternalIdentityKey,
  assertAgentIdentityProfileIntegrity,
  createAgentIdentityProfile,
  reviseAgentIdentityProfile as buildAgentIdentityRevision,
  type AgentIdentityProfile,
  type ExternalAgentIdentityReference,
} from "./agent-identity";
import {
  independentlyResolveRemoteCommit,
  type RemoteCommitResolver,
  type RemoteCommitVerification,
} from "./repository-verifier";
import {
  canonicalJson,
  computeEvidenceLedgerEntryHash,
  computeReceiptSha256,
  parsePermissionScope,
  parseTaskContractDocument,
  sha256Canonical,
  toPublicJobReceipt,
  verifyEvidenceLedgerEntries,
} from "./trust-foundation";
import type {
  AgentRecord,
  AssignmentRecord,
  AuditLogRecord,
  BuildTestCommandSummary,
  DashboardSnapshot,
  DisputeRecord,
  EvidenceArtifactRecord,
  EvidenceLedgerEntryRecord,
  EvidenceLedgerEntryType,
  EvidenceLedgerVerification,
  JobCapabilityEvidenceRecord,
  JobEventRecord,
  JobReceiptRecord,
  JobReceiptResult,
  JobRunAttemptRecord,
  JobRunRecord,
  LedgerEntryRecord,
  MatchRecord,
  ManagedSandboxRunRecord,
  ManagedSandboxRunStatus,
  ProfileRecord,
  PublicJobReceipt,
  PermissionLeaseRecord,
  PermissionScope,
  TaskAggregate,
  TaskContractDocument,
  TaskContractStatus,
  TaskContractVersionRecord,
  TaskEventRecord,
  TaskRecord,
  VerificationResultRecord,
  WalletRecord,
  WorkerCapabilitySnapshotRecord,
  WorkerHeartbeatRecord,
  WorkerRecord
} from "./types";

type SqlRow = Record<string, unknown>;

export type AgentIdentityStoreVerification = {
  valid: boolean;
  agentCount: number;
  profileCount: number;
  externalIdentityCount: number;
};

const CUSTOMER_ID = "customer-nick";
const PROVIDER_ALPHA_ID = "provider-alpha";
const PLATFORM_ID = "platform";
const MANAGED_PROVIDER_ID = "platform-managed-provider";
const MANAGED_AGENT_ID = "30000000-0000-4000-8000-000000000001";
const MANAGED_EXECUTION_NODE_ID = "30000000-0000-4000-8000-000000000002";
const MANAGED_BUILD_TEST_AGENT_ID = "30000000-0000-4000-8000-000000000003";
const ESCROW_ID = "escrow";

const WORKER_SMOKE_ALLOWED_ACTIONS = [
  "create_job_workspace",
  "write_hello_txt",
  "calculate_sha256",
  "upload_artifact",
  "report_progress",
  "cleanup_workspace",
] as const;

const WORKER_SMOKE_FORBIDDEN_ACTIONS = [
  "network_access",
  "shell_execution_from_customer_input",
  "git_clone",
  "external_repository_access",
  "production_deployment",
  "file_access_outside_job_workspace",
] as const;

const WORKER_SMOKE_DENIED_ACTIONS = [
  "git",
  "network",
  "arbitrary_shell",
  "production_deploy",
  "delete_outside_workspace",
  "read_home_directory",
  "read_other_jobs",
  "read_credentials",
] as const;

const REPOSITORY_MATERIALIZATION_ALLOWED_ACTIONS = [
  "create_job_workspace",
  "connect_to_allowlisted_github_repository",
  "git_clone_allowlisted_repository",
  "read_git_metadata",
  "read_files_inside_job_workspace",
  "calculate_file_sha256",
  "create_file_manifest",
  "upload_artifact",
  "report_progress",
  "cleanup_workspace",
] as const;

const REPOSITORY_MATERIALIZATION_FORBIDDEN_ACTIONS = [
  "execute_repository_code",
  "npm_install",
  "npm_ci",
  "npm_test",
  "npm_build",
  "package_script_execution",
  "arbitrary_shell_from_customer_input",
  "clone_non_allowlisted_repository",
  "clone_submodules",
  "git_lfs_smudge",
  "use_local_repository_fallback",
  "read_home_directory",
  "read_credentials",
  "read_other_job_workspace",
  "production_deploy",
  "create_pull_request",
  "modify_remote_repository",
] as const;

const REPOSITORY_MATERIALIZATION_DENIED_ACTIONS = [
  "arbitrary_shell",
  "execute_repository_code",
  "npm_install",
  "npm_ci",
  "npm_test",
  "npm_build",
  "package_script_execution",
  "clone_other_repository",
  "clone_submodule",
  "git_lfs_smudge",
  "modify_remote",
  "push",
  "commit",
  "create_pull_request",
  "read_home_directory",
  "read_credentials",
  "read_other_jobs",
  "production_deploy",
] as const;

function now(): string {
  return new Date().toISOString();
}

function workerSmokeContract(taskId: string, version: number): TaskContractDocument {
  return {
    taskId,
    taskType: "WORKER_SMOKE_V1",
    desiredOutcome: "Prove that an independent Worker can create and upload a verified artifact.",
    deliverables: ["hello.txt"],
    allowedWorkflow: "WORKER_SMOKE_V1",
    allowedActions: [...WORKER_SMOKE_ALLOWED_ACTIONS],
    forbiddenActions: [...WORKER_SMOKE_FORBIDDEN_ACTIONS],
    acceptanceChecks: [
      { id: "worker-claimed", label: "Worker successfully claims the Job", required: true, type: "JOB_CLAIMED", config: {} },
      { id: "execution-lease", label: "Valid Execution Lease exists", required: true, type: "LEASE_ACTIVE", config: {} },
      { id: "hello-created", label: "hello.txt is created", required: true, type: "FILE_EXISTS", config: { path: "hello.txt" } },
      { id: "artifact-uploaded", label: "Artifact is uploaded", required: true, type: "ARTIFACT", config: { fileName: "hello.txt", mimeType: "text/plain" } },
      { id: "artifact-hash", label: "Worker SHA-256 matches Server SHA-256", required: true, type: "SHA256", config: { algorithm: "SHA-256" } },
      { id: "workspace-cleaned", label: "Workspace is cleaned", required: true, type: "WORKSPACE_CLEANED", config: {} },
      { id: "no-permission-violation", label: "No permission violation occurred", required: true, type: "PERMISSION", config: { requiredStatus: "COMPLETED" } },
    ],
    requiredEvidence: [
      "job claim",
      "Execution Lease",
      "hello.txt artifact",
      "Worker SHA-256",
      "Server SHA-256",
      "workspace cleanup event",
      "Permission Lease status",
    ],
    budgetLimit: { currency: "USD", maxAmount: 0 },
    timeLimitSeconds: 60,
    privacyClassification: "INTERNAL",
    humanApprovalRequirements: [],
    failureConditions: [
      "Worker cannot claim the assigned Job",
      "Execution or Permission Lease is invalid",
      "Artifact hash mismatch",
      "Workspace is not cleaned",
      "Any permission violation occurs",
    ],
    contractVersion: version,
  };
}

function workerSmokePermissionScope(): PermissionScope {
  return {
    allowedActions: [...WORKER_SMOKE_ALLOWED_ACTIONS],
    deniedActions: [...WORKER_SMOKE_DENIED_ACTIONS],
    allowedPaths: ["$JOB_WORKSPACE"],
    allowedDomains: [],
    maxArtifactBytes: 1024 * 1024,
    maxRuntimeSeconds: 60,
    maxApiBudget: 0,
    humanApprovalActions: [],
  };
}

function repositoryMaterializationContract(taskId: string, version: number): TaskContractDocument {
  return {
    taskId,
    taskType: "REPOSITORY_MATERIALIZATION_V1",
    desiredOutcome: "Prove that a real independent DoneLayer Worker can securely clone the allowlisted GitHub Repository, identify its exact remote, branch and commit, generate a cryptographic file manifest, upload the evidence, and clean the workspace without executing repository code.",
    deliverables: [
      "Clone Log",
      "Remote Metadata",
      "Branch",
      "Commit SHA",
      "File Manifest",
      "Manifest SHA-256",
      "Artifact SHA-256",
      "Workspace Cleanup Evidence",
      "Verified Job Receipt",
    ],
    allowedWorkflow: "REPOSITORY_MATERIALIZE_V1",
    allowedActions: [...REPOSITORY_MATERIALIZATION_ALLOWED_ACTIONS],
    forbiddenActions: [...REPOSITORY_MATERIALIZATION_FORBIDDEN_ACTIONS],
    acceptanceChecks: [
      { id: "worker-claimed", label: "Worker successfully claims the Job", required: true, type: "JOB_CLAIMED", config: {} },
      { id: "execution-lease", label: "Valid Execution Lease exists", required: true, type: "LEASE_ACTIVE", config: {} },
      { id: "permission-lease", label: "Valid Permission Lease exists", required: true, type: "PERMISSION", config: { requiredStatus: "COMPLETED" } },
      { id: "repository-url", label: "Repository URL exactly matches the allowlist", required: true, type: "GITHUB_CHECK", config: { remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL } },
      { id: "clone-exit", label: "Real Git clone exit code is zero", required: true, type: "COMMAND_EXIT", config: { executable: "git", operation: "clone", fileName: "clone-log.txt", mimeType: "text/plain" } },
      { id: "origin-url", label: "Origin URL matches the expected Remote", required: true, type: "GITHUB_CHECK", config: { remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL } },
      { id: "current-branch", label: "Current Branch is main", required: true, type: "GITHUB_CHECK", config: { branch: REPOSITORY_MATERIALIZATION_BRANCH } },
      { id: "remote-commit", label: "Worker Commit SHA matches the independently verified Remote Commit SHA", required: true, type: "GITHUB_CHECK", config: { branch: REPOSITORY_MATERIALIZATION_BRANCH } },
      { id: "file-manifest", label: "File Manifest is generated from real cloned files", required: true, type: "FILE_EXISTS", config: { fileName: "file-manifest.json", mimeType: "application/json" } },
      { id: "file-hashes", label: "Every manifest file has a real SHA-256", required: true, type: "SHA256", config: { algorithm: "SHA-256" } },
      { id: "manifest-hash", label: "Manifest SHA-256 is independently verifiable", required: true, type: "SHA256", config: { fileName: "file-manifest.json", mimeType: "application/json" } },
      { id: "no-code-executed", label: "No Repository code was executed", required: true, type: "PERMISSION", config: { expected: true } },
      { id: "no-permission-violation", label: "No Permission Violation occurred", required: true, type: "PERMISSION", config: { violationCount: 0 } },
      { id: "workspace-cleaned", label: "Workspace is cleaned after Evidence upload", required: true, type: "WORKSPACE_CLEANED", config: {} },
      { id: "ledger-chain", label: "Evidence Ledger chain is valid", required: true, type: "GITHUB_CHECK", config: {} },
      { id: "verified-receipt", label: "Verified Job Receipt is successfully produced", required: true, type: "GITHUB_CHECK", config: {} },
    ],
    requiredEvidence: [
      "job claim and Execution Lease",
      "Permission Lease",
      "real clone log",
      "repository metadata",
      "file manifest and per-file SHA-256",
      "Server artifact SHA-256 observations",
      "independent remote branch query",
      "workspace cleanup event",
      "Evidence Ledger chain",
    ],
    budgetLimit: { currency: "USD", maxAmount: 0 },
    timeLimitSeconds: 120,
    privacyClassification: "INTERNAL",
    humanApprovalRequirements: [],
    failureConditions: [
      "Worker cannot claim the assigned Job",
      "Execution or Permission Lease is invalid",
      "Repository or branch is outside the allowlist",
      "Git clone fails",
      "Worker and independent Remote Commit SHA differ",
      "Manifest or Artifact hash verification fails",
      "Workspace cleanup is not confirmed",
      "Any permission violation occurs",
      "Any repository code or package script is executed",
    ],
    contractVersion: version,
  };
}

function repositoryMaterializationPermissionScope(): PermissionScope {
  return {
    allowedActions: [...REPOSITORY_MATERIALIZATION_ALLOWED_ACTIONS],
    deniedActions: [...REPOSITORY_MATERIALIZATION_DENIED_ACTIONS],
    allowedPaths: ["$JOB_WORKSPACE"],
    allowedDomains: ["github.com"],
    allowedRepositories: [REPOSITORY_MATERIALIZATION_REMOTE_URL],
    allowedBranches: [REPOSITORY_MATERIALIZATION_BRANCH],
    maxArtifactBytes: 2 * 1024 * 1024,
    maxRuntimeSeconds: 120,
    maxApiBudget: 0,
    humanApprovalActions: [],
  };
}

function managedSandboxContract(
  taskId: string,
  version: number,
  workflow: typeof MANAGED_SANDBOX_SMOKE_WORKFLOW | typeof MANAGED_SANDBOX_TIMEOUT_WORKFLOW,
): TaskContractDocument {
  const smoke = workflow === MANAGED_SANDBOX_SMOKE_WORKFLOW;
  return {
    taskId,
    taskType: workflow,
    desiredOutcome: smoke
      ? "Prove that DoneLayer can execute a platform-controlled smoke workload inside a disposable, isolated Vercel Sandbox without installing Docker or executing code on the local Windows host."
      : "Prove that the DoneLayer Server-side Orchestrator enforces a real timeout and stops a disposable Vercel Sandbox.",
    deliverables: smoke
      ? [
          "Provider Availability Report",
          "Sandbox Provider Metadata",
          "Sandbox ID",
          "Sandbox Lifecycle Events",
          "Network Policy Snapshot",
          "Runtime Limit Snapshot",
          "stdout",
          "stderr",
          "Exit Code",
          "managed-sandbox-proof.json",
          "Artifact SHA-256",
          "Cleanup Evidence",
          "Verified Job Receipt",
        ]
      : ["Timeout Evidence", "Stop Evidence", "Cleanup Evidence"],
    allowedWorkflow: workflow,
    allowedActions: [...MANAGED_SANDBOX_ALLOWED_ACTIONS],
    forbiddenActions: [...MANAGED_SANDBOX_DENIED_ACTIONS],
    acceptanceChecks: smoke
      ? [
          { id: "provider-available", label: "Vercel Sandbox Provider is available", required: true, type: "PROVIDER", config: {} },
          { id: "server-orchestrated", label: "Server-side Orchestrator created the Sandbox", required: true, type: "ORCHESTRATOR", config: {} },
          { id: "remote-environment", label: "Execution environment is remote", required: true, type: "ISOLATION", config: { model: MANAGED_SANDBOX_ISOLATION_MODEL } },
          { id: "non-persistent", label: "Sandbox lifecycle is non-persistent", required: true, type: "LIFECYCLE", config: { persistent: false } },
          { id: "contract-locked", label: "Task Contract is locked", required: true, type: "CONTRACT", config: {} },
          { id: "permission-active", label: "Permission Lease is valid", required: true, type: "PERMISSION", config: {} },
          { id: "no-local-host", label: "No local Host execution fallback was used", required: true, type: "ISOLATION", config: { expected: false } },
          { id: "no-local-docker", label: "No local Docker execution was used", required: true, type: "ISOLATION", config: { expected: false } },
          { id: "no-customer-code", label: "No Customer or Repository code was used", required: true, type: "PERMISSION", config: {} },
          { id: "no-platform-credentials", label: "No Platform credentials were injected", required: true, type: "PERMISSION", config: {} },
          { id: "network-deny-all", label: "Provider network policy is deny-all", required: true, type: "NETWORK", config: { policy: "deny-all" } },
          { id: "network-probe", label: "Fixed external network probe is blocked", required: true, type: "NETWORK", config: {} },
          { id: "smoke-executed", label: "Fixed Smoke Program executed", required: true, type: "COMMAND_EXIT", config: { command: "node", exitCode: 0 } },
          { id: "provider-logs", label: "stdout, stderr and Exit Code came from Provider", required: true, type: "EVIDENCE", config: {} },
          { id: "proof-created", label: "managed-sandbox-proof.json was created", required: true, type: "FILE_EXISTS", config: { fileName: "managed-sandbox-proof.json" } },
          { id: "artifact-hash", label: "Server recomputed Artifact SHA-256", required: true, type: "SHA256", config: {} },
          { id: "timeout-policy", label: "Runtime timeout policy is set", required: true, type: "TIMEOUT", config: { seconds: 60 } },
          { id: "sandbox-stopped", label: "Sandbox is stopped after completion", required: true, type: "CLEANUP", config: {} },
          { id: "no-snapshot", label: "No persistent Snapshot was created", required: true, type: "LIFECYCLE", config: { snapshot: false } },
          { id: "ledger-valid", label: "Evidence Ledger chain is valid", required: true, type: "LEDGER", config: {} },
          { id: "no-violation", label: "No Permission Violation occurred", required: true, type: "PERMISSION", config: { violations: 0 } },
          { id: "receipt-created", label: "Verified Job Receipt was created", required: true, type: "RECEIPT", config: {} },
        ]
      : [
          { id: "timeout-triggered", label: "Real command timeout was triggered", required: true, type: "TIMEOUT", config: {} },
          { id: "sandbox-stopped", label: "Timed-out Sandbox stopped", required: true, type: "CLEANUP", config: {} },
          { id: "no-success-receipt", label: "Timeout probe creates no success Receipt", required: true, type: "RECEIPT", config: { expected: false } },
        ],
    requiredEvidence: smoke
      ? [...MANAGED_SANDBOX_ARTIFACTS]
      : ["TIMEOUT_TRIGGERED", "MANAGED_SANDBOX_STOPPED", "MANAGED_SANDBOX_CLEANUP_VERIFIED"],
    budgetLimit: { currency: "USD", maxAmount: 0 },
    timeLimitSeconds: smoke ? 60 : 10,
    privacyClassification: "INTERNAL",
    humanApprovalRequirements: [],
    failureConditions: [
      "Provider is unavailable or requires a billing action",
      "Permission Lease is inactive, expired, revoked, or mismatched",
      "Network policy is not deny-all",
      "Sandbox is persistent or creates a Snapshot",
      "Customer or Repository code is uploaded",
      "Platform credentials are exposed",
      "Local Host, local Docker, or Demo fallback is used",
      "Artifact hash, ownership, or Evidence Ledger verification fails",
      "Sandbox cleanup cannot be confirmed",
    ],
    contractVersion: version,
  };
}

type ManagedBuildTestSourceIdentity = {
  remoteUrl: typeof REPOSITORY_MATERIALIZATION_REMOTE_URL;
  branch: typeof REPOSITORY_MATERIALIZATION_BRANCH;
  commitSha: string;
  independentRemoteCommitSha: string;
  fileCount: number;
  manifestSha256: string;
  sourcePackageManifestSha256: string;
  sourcePackageSha256: string;
  sourcePackageBytes: number;
  buildScriptPresent: boolean;
  cloneStartedAt: string;
  cloneFinishedAt: string;
  cloneDurationMs: number;
  materializerWorkspaceCleaned: true;
};

type ManagedBuildTestCommandEvidence = BuildTestCommandSummary & {
  startedAt: string;
  finishedAt: string;
};

type ManagedBuildTestTestEvidence = ManagedBuildTestCommandEvidence & {
  testRunner: string | null;
  totalTests: number | null;
  passedTests: number | null;
  failedTests: number | null;
  statisticsStatus: "PARSED" | "UNPARSABLE";
};

type ManagedBuildTestSourceVerification = {
  schemaVersion: number;
  repositoryUrl: string;
  branch: string;
  commitSha: string;
  manifestSha256: string;
  sourcePackageManifestSha256: string;
  sourcePackageSha256: string;
  fileCount: number;
  totalSourceBytes: number;
  packageVerified: boolean;
  manifestVerified: boolean;
  commitVerified: boolean;
  extracted: boolean;
  nodeVersion: string;
  npmVersion: string;
  buildScriptPresent: boolean;
  installLifecycleScriptsPresent: boolean;
  verifiedAt: string;
};

type ManagedBuildTestSourceIntegrity = {
  schemaVersion: number;
  commitSha: string;
  manifestSha256: string;
  checkedFileCount: number;
  missing: string[];
  modified: string[];
  added: string[];
  sourceMutationDetected: boolean;
  verifiedAt: string;
};

function validateManagedBuildTestSourceIdentity(
  source: ManagedBuildTestSourceIdentity,
): ManagedBuildTestSourceIdentity {
  assertAllowlistedRepositoryUrl(source.remoteUrl);
  if (
    source.branch !== REPOSITORY_MATERIALIZATION_BRANCH ||
    !/^[a-f0-9]{40}$/.test(source.commitSha) ||
    source.independentRemoteCommitSha !== source.commitSha ||
    !Number.isSafeInteger(source.fileCount) ||
    source.fileCount < 1 ||
    source.fileCount > 1_000 ||
    !Number.isSafeInteger(source.sourcePackageBytes) ||
    source.sourcePackageBytes < 1 ||
    source.sourcePackageBytes > 8 * 1024 * 1024 ||
    ![source.manifestSha256, source.sourcePackageManifestSha256, source.sourcePackageSha256]
      .every((digest) => /^[a-f0-9]{64}$/.test(digest)) ||
    source.materializerWorkspaceCleaned !== true ||
    !Number.isFinite(Date.parse(source.cloneStartedAt)) ||
    !Number.isFinite(Date.parse(source.cloneFinishedAt)) ||
    Date.parse(source.cloneStartedAt) > Date.parse(source.cloneFinishedAt) ||
    !Number.isSafeInteger(source.cloneDurationMs) ||
    source.cloneDurationMs < 0
  ) {
    throw new Error("Managed build/test source identity is invalid");
  }
  return { ...source };
}

function managedBuildTestContract(
  taskId: string,
  version: number,
  source: ManagedBuildTestSourceIdentity,
): TaskContractDocument {
  return {
    taskId,
    taskType: REAL_BUILD_TEST_MANAGED_SANDBOX_TASK_TYPE,
    desiredOutcome: "Determine whether the exact verified Fixture Repository commit can install dependencies, build, and pass its automated tests inside a managed remote sandbox.",
    deliverables: [
      "Verified Repository identity",
      "Source Package and Source Package Manifest SHA-256",
      "Managed Sandbox lifecycle Evidence",
      "npm ci result and raw logs",
      "Build result and raw logs",
      "Test result and raw logs",
      "Post-execution Source integrity result",
      "Evidence Ledger",
      "Hash-verifiable FAILED Job Receipt",
    ],
    allowedWorkflow: NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW,
    allowedActions: [...MANAGED_SANDBOX_BUILD_TEST_ALLOWED_ACTIONS],
    forbiddenActions: [...MANAGED_SANDBOX_BUILD_TEST_DENIED_ACTIONS],
    acceptanceChecks: [
      { id: "exact-remote-commit", label: "Exact Remote Commit is independently verified", required: true, type: "GITHUB_CHECK", config: { remoteUrl: source.remoteUrl, branch: source.branch, commitSha: source.commitSha } },
      { id: "source-manifest-valid", label: "Source Manifest is valid", required: true, type: "SHA256", config: { sha256: source.sourcePackageManifestSha256 } },
      { id: "source-package-valid", label: "Source Package hash is valid", required: true, type: "SHA256", config: { sha256: source.sourcePackageSha256 } },
      { id: "sandbox-created", label: "Managed Sandbox is created", required: true, type: "PROVIDER", config: { provider: MANAGED_SANDBOX_PROVIDER } },
      { id: "no-local-host", label: "No Local Host workload execution is used", required: true, type: "ISOLATION", config: { expected: false } },
      { id: "no-local-docker", label: "No Local Docker execution is used", required: true, type: "ISOLATION", config: { expected: false } },
      { id: "source-uploaded", label: "Verified Source Package is uploaded", required: true, type: "EVIDENCE", config: {} },
      { id: "npm-ci-executed", label: "npm ci actually executes", required: true, type: "COMMAND_EXIT", config: { command: "npm ci --ignore-scripts --no-audit --no-fund", exitCode: 0 } },
      { id: "build-executed", label: "Build command executes if present", required: true, type: "COMMAND_EXIT", config: { command: source.buildScriptPresent ? "npm run build" : null, expectedStatus: source.buildScriptPresent ? "PASSED" : "NOT_PRESENT" } },
      { id: "test-executed", label: "Test command actually executes", required: true, type: "COMMAND_EXIT", config: { command: "npm test" } },
      { id: "provider-logs", label: "Real stdout and stderr are captured", required: true, type: "EVIDENCE", config: {} },
      { id: "real-exit-codes", label: "Real Provider Exit Codes are captured", required: true, type: "EVIDENCE", config: {} },
      { id: "test-failure-detected", label: "Test failure is correctly detected", required: true, type: "COMMAND_EXIT", config: { expectedNonZero: true } },
      { id: "job-not-successful", label: "Job is not marked successful", required: true, type: "STATE", config: { expected: "VERIFICATION_FAILED" } },
      { id: "no-source-repair", label: "No source repair occurs", required: true, type: "PERMISSION", config: { expected: true } },
      { id: "sandbox-stopped", label: "Sandbox is stopped and cleanup is verified", required: true, type: "CLEANUP", config: {} },
      { id: "ledger-valid", label: "Evidence Ledger chain is valid", required: true, type: "LEDGER", config: {} },
      { id: "failed-receipt", label: "Receipt records a FAILED result", required: true, type: "RECEIPT", config: { result: "FAILED", integrity: "VALID" } },
      { id: "automated-tests-pass", label: "All required automated tests pass", required: true, type: "COMMAND_EXIT", config: { command: "npm test", exitCode: 0 } },
    ],
    requiredEvidence: [
      "independent Remote Commit verification",
      "Source Package Manifest and hashes",
      "Provider Sandbox identity and policy transitions",
      "install/build/test command timestamps, exit codes, stdout and stderr",
      "post-execution Source File Manifest comparison",
      "Sandbox stop and cleanup verification",
      "Evidence Ledger chain",
      "FAILED Receipt hash and public projection",
    ],
    budgetLimit: { currency: "USD", maxAmount: 0 },
    timeLimitSeconds: 300,
    privacyClassification: "INTERNAL",
    humanApprovalRequirements: [],
    failureConditions: [
      "Repository or independently resolved Commit SHA differs from the locked source identity",
      "Source Package or Source Manifest hash differs",
      "Managed Sandbox Provider is unavailable or requires a billing action",
      "Any local Host, local Docker, Demo, or arbitrary-command fallback is attempted",
      "npm ci or build exits non-zero or times out",
      "npm test exits non-zero or times out",
      "Any original Source File is added, removed, or modified",
      "Any network or Permission violation occurs",
      "Sandbox stop or cleanup cannot be verified",
      "Evidence Ledger or Receipt integrity is invalid",
    ],
    contractVersion: version,
  };
}

type WorkerSubmissionResult = {
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  startedAt: string;
  endedAt: string;
  exitCode: number;
  commitShaBefore?: string;
  commitShaAfter?: string;
  gitDiff: string;
  changedFiles: string[];
  commandsRun: Array<{ commandId: string; exitCode: number; stdout?: string; stderr?: string }>;
  tests?: { total: number; passed: number; failed: number; skipped: number };
  buildSucceeded?: boolean;
  pullRequestUrl?: string;
  repositoryMaterialization?: {
    remoteUrl: string;
    branch: string;
    commitSha: string;
    cloneStartedAt: string;
    cloneFinishedAt: string;
    cloneExitCode: number;
    cloneDurationMs: number;
    cloneArguments: string[];
    cloneStdout: string;
    cloneStderr: string;
    fileCount: number;
    manifestSha256: string;
    noRepositoryCodeExecuted: true;
  };
};

type TaskContractDraftInput = Omit<TaskContractDocument, "taskId" | "contractVersion">;

function validateTaskContractDocument(document: TaskContractDocument): void {
  if (!document.taskId.trim() || !document.taskType.trim() || !document.desiredOutcome.trim()) {
    throw new Error("Task Contract identity and desired outcome are required.");
  }
  if (!Number.isSafeInteger(document.contractVersion) || document.contractVersion < 1) {
    throw new Error("Task Contract version must be a positive integer.");
  }
  if (!document.deliverables.length || !document.acceptanceChecks.length || !document.requiredEvidence.length) {
    throw new Error("Task Contract deliverables, acceptance checks, and required evidence are required.");
  }
  if (!document.allowedActions.length || !document.forbiddenActions.length) {
    throw new Error("Task Contract allowed and forbidden actions are required.");
  }
  if (!Number.isSafeInteger(document.timeLimitSeconds) || document.timeLimitSeconds < 1) {
    throw new Error("Task Contract time limit is invalid.");
  }
  if (!Number.isFinite(document.budgetLimit.maxAmount) || document.budgetLimit.maxAmount < 0) {
    throw new Error("Task Contract budget limit is invalid.");
  }
}

function validatePermissionScope(scope: PermissionScope): void {
  if (!scope.allowedActions.length || !scope.deniedActions.length || !scope.allowedPaths.length) {
    throw new Error("Permission Lease action and path scopes are required.");
  }
  if (!Number.isSafeInteger(scope.maxArtifactBytes) || scope.maxArtifactBytes < 1) {
    throw new Error("Permission Lease artifact limit is invalid.");
  }
  if (!Number.isSafeInteger(scope.maxRuntimeSeconds) || scope.maxRuntimeSeconds < 1) {
    throw new Error("Permission Lease runtime limit is invalid.");
  }
  if (!Number.isFinite(scope.maxApiBudget) || scope.maxApiBudget < 0) {
    throw new Error("Permission Lease API budget is invalid.");
  }
}

function workspaceRoot(): string {
  let current = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string };
        if (manifest.name === "donelayer") return current;
      } catch {
        // Keep walking toward the workspace root.
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

function resolveDatabasePath(configured?: string): string {
  if (configured === ":memory:") return configured;
  const value = configured ?? process.env.DEMO_DATABASE_PATH ?? ".data/donelayer.sqlite";
  return resolve(workspaceRoot(), value);
}

function parseJson<T>(value: unknown): T {
  if (typeof value !== "string") throw new Error("Expected a JSON database column.");
  return JSON.parse(value) as T;
}

function bool(value: unknown): boolean {
  return value === 1 || value === true;
}

function number(value: unknown): number {
  if (typeof value !== "number") throw new Error("Expected a numeric database column.");
  return value;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a text database column.");
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function pairingPepper(): string {
  return process.env.DEMO_SESSION_SECRET ?? "donelayer-local-pairing-pepper-not-for-production";
}

function pairingDigest(code: string): string {
  return createHmac("sha256", pairingPepper()).update(code.toUpperCase()).digest("hex");
}

function workerTokenDigest(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureEvidenceLedgerEntryTypes(db: DatabaseSync): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='evidence_ledger_entries'").get() as { sql?: unknown } | undefined;
  const sql = typeof row?.sql === "string" ? row.sql : "";
  if (sql.includes("SOURCE_PACKAGE_CREATED")) return;
  db.exec(`
    DROP TRIGGER IF EXISTS trg_evidence_ledger_no_update;
    DROP TRIGGER IF EXISTS trg_evidence_ledger_no_delete;
    CREATE TABLE evidence_ledger_entries_v3 (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
      sequence_number INTEGER NOT NULL CHECK(sequence_number > 0),
      entry_type TEXT NOT NULL CHECK(entry_type IN (
        'CONTRACT_LOCKED','PERMISSION_GRANTED','JOB_CLAIMED','HEARTBEAT_RECORDED',
        'EXECUTION_STARTED','REPOSITORY_CLONE_STARTED','REPOSITORY_CLONE_COMPLETED',
        'REMOTE_METADATA_CAPTURED','FILE_MANIFEST_CREATED',
        'ARTIFACT_CREATED','ARTIFACT_UPLOADED','ARTIFACT_HASH_VERIFIED','REMOTE_COMMIT_VERIFIED',
        'REPOSITORY_VERIFIED','SOURCE_PACKAGE_CREATED','SOURCE_PACKAGE_VERIFIED',
        'SOURCE_PACKAGE_UPLOADED','SOURCE_MANIFEST_VERIFIED','NETWORK_POLICY_UPDATED',
        'DEPENDENCY_INSTALL_STARTED','DEPENDENCY_INSTALL_COMPLETED','BUILD_STARTED','BUILD_COMPLETED',
        'TEST_STARTED','TEST_FAILED','SOURCE_INTEGRITY_VERIFIED',
        'MANAGED_SANDBOX_REQUESTED','MANAGED_SANDBOX_CREATED','MANAGED_SANDBOX_POLICY_VERIFIED',
        'MANAGED_SANDBOX_STARTED','NETWORK_PROBE_COMPLETED','MANAGED_SANDBOX_STOP_REQUESTED',
        'MANAGED_SANDBOX_STOPPED','MANAGED_SANDBOX_CLEANUP_VERIFIED','TIMEOUT_TRIGGERED','STALE_RESULT_REJECTED',
        'VERIFICATION_PASSED','VERIFICATION_FAILED','PERMISSION_VIOLATION',
        'WORKSPACE_CLEANED','RECEIPT_CREATED'
      )),
      source_record_type TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
      previous_entry_sha256 TEXT CHECK(previous_entry_sha256 IS NULL OR length(previous_entry_sha256) = 64),
      entry_sha256 TEXT NOT NULL CHECK(length(entry_sha256) = 64),
      created_at TEXT NOT NULL,
      UNIQUE(job_run_id, sequence_number),
      UNIQUE(job_run_id, entry_sha256)
    );
    INSERT INTO evidence_ledger_entries_v3
      SELECT id,task_id,job_run_id,sequence_number,entry_type,source_record_type,source_record_id,payload_sha256,previous_entry_sha256,entry_sha256,created_at
      FROM evidence_ledger_entries;
    DROP TABLE evidence_ledger_entries;
    ALTER TABLE evidence_ledger_entries_v3 RENAME TO evidence_ledger_entries;
    CREATE INDEX idx_evidence_ledger_job ON evidence_ledger_entries(job_run_id, sequence_number);
    CREATE TRIGGER trg_evidence_ledger_no_update
    BEFORE UPDATE ON evidence_ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'Evidence Ledger entries are append-only');
    END;
    CREATE TRIGGER trg_evidence_ledger_no_delete
    BEFORE DELETE ON evidence_ledger_entries
    BEGIN
      SELECT RAISE(ABORT, 'Evidence Ledger entries are append-only');
    END;
  `);
}

function normalizeWorkerTools(capabilities: WorkerCapabilities): string[] {
  const names = new Set<string>();
  const displayNames: Record<string, string> = {
    node: "Node.js",
    npm: "npm",
    git: "Git",
    docker: "Docker",
    codex: "Codex CLI",
    gh: "GitHub CLI",
  };
  for (const tool of capabilities.installedTools) {
    names.add(displayNames[tool.toLowerCase()] ?? tool);
  }
  if (capabilities.nodeVersion) names.add("Node.js");
  if (capabilities.gitAvailable) names.add("Git");
  if (capabilities.dockerAvailable) names.add("Docker");
  if (capabilities.codexAvailable) names.add("Codex CLI");
  if (capabilities.githubCliAvailable) names.add("GitHub CLI");
  return [...names];
}

function demoTaskInput(): CreateTaskInput {
  return createTaskInputSchema.parse({
    title: "Fix failing authentication tests in a sample repository",
    problemDescription: "Authentication tests fail after the session timeout logic was changed. Diagnose the repository and repair only the scoped test and session implementation.",
    desiredOutcome: "All authentication tests pass, the production build succeeds and an evidence pack shows the exact diff and test counts.",
    repository: "demo://sample-org/react-auth",
    targetBranch: "main",
    taskType: "TEST_AND_FIX",
    requiredSkills: ["React", "TypeScript", "Authentication"],
    requiredOperatingSystem: "WINDOWS",
    requiredTools: ["Git", "Node.js", "npm"],
    requiredMcpTools: [],
    budgetCents: 24000,
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    acceptanceChecks: demoAcceptanceChecks,
    securitySensitivity: "MEDIUM",
    allowCodeChanges: true,
    allowPullRequest: true,
    requiresHumanApproval: true,
    preferredAgentId: null
  });
}

function analyzeTask(input: CreateTaskInput): TaskAnalysis {
  const suggestedBudgetCents = Math.max(12000, Math.round(input.budgetCents * 0.9));
  return {
    scopeSummary: `Repair the scoped ${input.taskType.toLowerCase().replaceAll("_", " ")} task in ${input.repository} without expanding repository access.`,
    requiredCapabilities: [...new Set([...input.requiredSkills, ...input.requiredTools])],
    suggestedTaskTemplate: input.taskType,
    riskLevel: input.securitySensitivity,
    suggestedVerificationChecks: input.acceptanceChecks,
    suggestedBudgetCents,
    estimatedDurationHours: input.taskType === "FEATURE_COMPLETION" ? 12 : 6
  };
}

function mapAgent(row: SqlRow): AgentRecord {
  const data = parseJson<AgentRecord>(row.data_json);
  return { ...data, id: string(row.id), slug: string(row.slug), providerId: string(row.provider_id), createdAt: string(row.created_at), updatedAt: string(row.updated_at) };
}

function mapAgentIdentityProfile(row: SqlRow): AgentIdentityProfile {
  const profile = parseJson<AgentIdentityProfile>(row.profile_json);
  assertAgentIdentityProfileIntegrity(profile);
  if (
    profile.agentId !== string(row.agent_id) ||
    profile.revision !== number(row.revision) ||
    profile.profileSha256 !== string(row.profile_sha256) ||
    profile.previousProfileSha256 !== nullableString(row.previous_profile_sha256) ||
    profile.controller.accountId !== string(row.controller_account_id) ||
    profile.updatedAt !== string(row.created_at) ||
    canonicalJson(profile) !== string(row.profile_json)
  ) throw new Error("AGENT_IDENTITY_PERSISTED_PROFILE_MISMATCH");
  return profile;
}

function mapWorker(row: SqlRow): WorkerRecord {
  const data = parseJson<WorkerRecord>(row.data_json);
  return {
    ...data,
    id: string(row.id),
    providerId: string(row.provider_id),
    status: string(row.status) as WorkerRecord["status"],
    tokenHash: nullableString(row.token_hash),
    tokenId: nullableString(row.token_id),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapCapabilitySnapshot(row: SqlRow): WorkerCapabilitySnapshotRecord {
  return {
    id: string(row.id),
    workerId: string(row.worker_id),
    capabilities: workerCapabilitiesSchema.parse(parseJson<unknown>(row.capabilities_json)),
    reportedAt: string(row.reported_at),
    createdAt: string(row.created_at),
  };
}

function mapWorkerHeartbeat(row: SqlRow): WorkerHeartbeatRecord {
  return {
    id: string(row.id),
    workerId: string(row.worker_id),
    status: string(row.status) as WorkerHeartbeatRecord["status"],
    activeJobRunIds: parseJson<string[]>(row.active_job_run_ids_json),
    sentAt: string(row.sent_at),
    receivedAt: string(row.received_at),
    capabilitySnapshotId: string(row.capability_snapshot_id),
  };
}

function mapJobCapabilityEvidence(row: SqlRow): JobCapabilityEvidenceRecord {
  return {
    jobRunId: string(row.job_run_id),
    snapshotId: string(row.snapshot_id),
    capabilities: workerCapabilitiesSchema.parse(parseJson<unknown>(row.capabilities_json)),
    capturedAt: string(row.captured_at),
  };
}

function mapJobAttempt(row: SqlRow): JobRunAttemptRecord {
  return {
    jobRunId: string(row.job_run_id),
    attemptNumber: number(row.attempt_number),
    supersedesJobRunId: nullableString(row.supersedes_job_run_id),
    terminalReason: nullableString(row.terminal_reason),
    leaseRevokedAt: nullableString(row.lease_revoked_at),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at),
  };
}

function mapTaskContract(row: SqlRow): TaskContractVersionRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    version: number(row.version),
    status: string(row.status) as TaskContractStatus,
    contract: parseTaskContractDocument(parseJson<unknown>(row.contract_json)),
    contractSha256: string(row.contract_sha256),
    createdBy: string(row.created_by),
    createdAt: string(row.created_at),
    lockedAt: nullableString(row.locked_at),
    supersededAt: nullableString(row.superseded_at),
  };
}

function mapPermissionLease(row: SqlRow): PermissionLeaseRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    taskContractVersionId: string(row.task_contract_version_id),
    jobRunId: string(row.job_run_id),
    agentId: string(row.agent_id),
    workerId: string(row.worker_id),
    version: number(row.version),
    status: string(row.status) as PermissionLeaseRecord["status"],
    scope: parsePermissionScope(parseJson<unknown>(row.scope_json)),
    startsAt: nullableString(row.starts_at),
    expiresAt: nullableString(row.expires_at),
    revokedAt: nullableString(row.revoked_at),
    revokeReason: nullableString(row.revoke_reason),
    createdAt: string(row.created_at),
    createdBy: string(row.created_by),
  };
}

function mapEvidenceLedgerEntry(row: SqlRow): EvidenceLedgerEntryRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    jobRunId: string(row.job_run_id),
    sequenceNumber: number(row.sequence_number),
    entryType: string(row.entry_type) as EvidenceLedgerEntryType,
    sourceRecordType: string(row.source_record_type),
    sourceRecordId: string(row.source_record_id),
    payloadSha256: string(row.payload_sha256),
    previousEntrySha256: nullableString(row.previous_entry_sha256),
    entrySha256: string(row.entry_sha256),
    createdAt: string(row.created_at),
  };
}

function mapJobReceipt(row: SqlRow): JobReceiptRecord {
  return {
    id: string(row.id),
    receiptPublicId: string(row.receipt_public_id),
    taskId: string(row.task_id),
    jobRunId: string(row.job_run_id),
    taskContractVersionId: string(row.task_contract_version_id),
    permissionLeaseId: string(row.permission_lease_id),
    result: string(row.result) as JobReceiptResult,
    receipt: parseJson<JobReceiptRecord["receipt"]>(row.receipt_json),
    receiptSha256: string(row.receipt_sha256),
    evidenceChainSha256: string(row.evidence_chain_sha256),
    createdAt: string(row.created_at),
    invalidatedAt: nullableString(row.invalidated_at),
    invalidationReason: nullableString(row.invalidation_reason),
  };
}

function mapTask(row: SqlRow): TaskRecord {
  const data = parseJson<TaskRecord>(row.data_json);
  return {
    ...data,
    id: string(row.id),
    customerId: string(row.customer_id),
    status: string(row.status) as TaskStatus,
    version: number(row.version),
    matchedAgentId: nullableString(row.matched_agent_id),
    assignedWorkerId: nullableString(row.assigned_worker_id),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapTaskEvent(row: SqlRow): TaskEventRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    sequence: number(row.sequence),
    fromStatus: nullableString(row.from_status) as TaskStatus | null,
    toStatus: string(row.to_status) as TaskStatus,
    actorKind: string(row.actor_kind),
    actorId: string(row.actor_id),
    reason: string(row.reason),
    eventType: string(row.event_type),
    payload: parseJson<Record<string, unknown>>(row.payload_json),
    createdAt: string(row.created_at)
  };
}

function mapMatch(row: SqlRow): MatchRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    agentId: string(row.agent_id),
    workerId: string(row.worker_id),
    rank: number(row.rank),
    totalScore: number(row.total_score),
    eligible: bool(row.eligible),
    components: parseJson<Record<string, number>>(row.components_json),
    reasons: parseJson<string[]>(row.reasons_json),
    createdAt: string(row.created_at)
  };
}

function mapAssignment(row: SqlRow): AssignmentRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    agentId: string(row.agent_id),
    providerId: string(row.provider_id),
    workerId: string(row.worker_id),
    status: string(row.status) as AssignmentRecord["status"],
    quoteCents: number(row.quote_cents),
    providerEarningCents: number(row.provider_earning_cents),
    platformFeeCents: number(row.platform_fee_cents),
    acceptedAt: nullableString(row.accepted_at),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapJobRun(row: SqlRow): JobRunRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    assignmentId: string(row.assignment_id),
    workerId: string(row.worker_id),
    agentId: string(row.agent_id),
    status: string(row.status) as JobRunRecord["status"],
    executor: string(row.executor) as JobRunRecord["executor"],
    workflowTemplate: string(row.workflow_template) as JobRunRecord["workflowTemplate"],
    executionBackendType: string(row.execution_backend_type ?? "LOCAL_WORKER") as JobRunRecord["executionBackendType"],
    startedAt: nullableString(row.started_at),
    endedAt: nullableString(row.ended_at),
    exitCode: typeof row.exit_code === "number" ? row.exit_code : null,
    commitShaBefore: nullableString(row.commit_sha_before),
    commitShaAfter: nullableString(row.commit_sha_after),
    leaseId: nullableString(row.lease_id),
    leaseTokenHash: nullableString(row.lease_token_hash),
    leaseExpiresAt: nullableString(row.lease_expires_at),
    taskContractVersionId: nullableString(row.task_contract_version_id),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapManagedSandboxRun(row: SqlRow): ManagedSandboxRunRecord {
  return {
    id: string(row.id),
    jobRunId: string(row.job_run_id),
    provider: string(row.provider) as ManagedSandboxRunRecord["provider"],
    providerSandboxId: nullableString(row.provider_sandbox_id),
    providerRequestId: nullableString(row.provider_request_id),
    executionBackendType: string(row.execution_backend_type) as ManagedSandboxRunRecord["executionBackendType"],
    isolationModel: string(row.isolation_model) as ManagedSandboxRunRecord["isolationModel"],
    lifecycleMode: string(row.lifecycle_mode) as ManagedSandboxRunRecord["lifecycleMode"],
    status: string(row.status) as ManagedSandboxRunStatus,
    region: nullableString(row.region),
    runtime: string(row.runtime),
    networkPolicy: parseJson<Record<string, unknown>>(row.network_policy_json),
    limits: parseJson<Record<string, unknown>>(row.limits_json),
    providerMetadata: parseJson<Record<string, unknown>>(row.provider_metadata_json),
    createdAt: string(row.created_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    stoppedAt: nullableString(row.stopped_at),
    destroyedAt: nullableString(row.destroyed_at),
    cleanupVerifiedAt: nullableString(row.cleanup_verified_at),
    failureCode: nullableString(row.failure_code),
    failureMessage: nullableString(row.failure_message),
  };
}

function mapJobEvent(row: SqlRow): JobEventRecord {
  return {
    id: string(row.id),
    jobRunId: string(row.job_run_id),
    sequence: number(row.sequence),
    kind: string(row.kind) as JobEventRecord["kind"],
    level: string(row.level) as JobEventRecord["level"],
    message: string(row.message),
    payload: parseJson<Record<string, unknown>>(row.payload_json),
    createdAt: string(row.created_at)
  };
}

function mapArtifact(row: SqlRow): EvidenceArtifactRecord {
  const artifact: EvidenceArtifactRecord = {
    id: string(row.id),
    taskId: string(row.task_id),
    workerId: string(row.worker_id),
    jobRunId: string(row.job_run_id),
    artifactType: string(row.artifact_type),
    fileName: string(row.file_name),
    mimeType: string(row.mime_type),
    size: number(row.size),
    sha256: string(row.sha256),
    storagePath: string(row.storage_path),
    content: string(row.content),
    createdAt: string(row.created_at)
  };
  if (typeof row.claimed_sha256 === "string") artifact.claimedSha256 = row.claimed_sha256;
  if (typeof row.server_sha256 === "string") artifact.serverSha256 = row.server_sha256;
  if (typeof row.sandbox_run_id === "string") artifact.sandboxRunId = row.sandbox_run_id;
  return artifact;
}

function mapVerification(row: SqlRow): VerificationResultRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    jobRunId: string(row.job_run_id),
    checkId: string(row.check_id),
    checkType: string(row.check_type),
    status: string(row.status) as VerificationResultRecord["status"],
    summary: string(row.summary),
    observed: parseJson<Record<string, unknown>>(row.observed_json),
    createdAt: string(row.created_at)
  };
}

function mapWallet(row: SqlRow): WalletRecord {
  return {
    id: string(row.id),
    ownerId: string(row.owner_id),
    kind: string(row.kind) as WalletRecord["kind"],
    availableCents: number(row.available_cents),
    reservedCents: number(row.reserved_cents),
    pendingCents: number(row.pending_cents),
    updatedAt: string(row.updated_at)
  };
}

function mapLedger(row: SqlRow): LedgerEntryRecord {
  return {
    id: string(row.id),
    taskId: nullableString(row.task_id),
    walletId: string(row.wallet_id),
    transactionKey: string(row.transaction_key),
    entryType: string(row.entry_type) as LedgerEntryRecord["entryType"],
    amountCents: number(row.amount_cents),
    createdAt: string(row.created_at)
  };
}

function mapDispute(row: SqlRow): DisputeRecord {
  return {
    id: string(row.id),
    taskId: string(row.task_id),
    openedBy: string(row.opened_by),
    reason: string(row.reason),
    status: string(row.status) as DisputeRecord["status"],
    heldAmountCents: number(row.held_amount_cents),
    resolution: nullableString(row.resolution),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at)
  };
}

function mapAudit(row: SqlRow): AuditLogRecord {
  return {
    id: string(row.id),
    actorKind: string(row.actor_kind),
    actorId: string(row.actor_id),
    action: string(row.action),
    resourceType: string(row.resource_type),
    resourceId: string(row.resource_id),
    success: bool(row.success),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json),
    createdAt: string(row.created_at)
  };
}

export class DemoStore {
  readonly databasePath: string;
  private readonly db: DatabaseSync;
  private transactionDepth = 0;
  private readonly leaseDurationMs: number;
  private readonly pairingCodeTtlMs: number;
  private readonly artifactUploadTtlMs: number;
  private readonly heartbeatTtlMs: number;
  private readonly remoteCommitResolver: RemoteCommitResolver;

  constructor(
    databasePath?: string,
    options: {
      leaseDurationMs?: number;
      pairingCodeTtlMs?: number;
      artifactUploadTtlMs?: number;
      heartbeatTtlMs?: number;
      remoteCommitResolver?: RemoteCommitResolver;
    } = {},
  ) {
    this.databasePath = resolveDatabasePath(databasePath);
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    this.pairingCodeTtlMs = options.pairingCodeTtlMs ?? 10 * 60_000;
    this.artifactUploadTtlMs = options.artifactUploadTtlMs ?? 5 * 60_000;
    this.heartbeatTtlMs = options.heartbeatTtlMs ?? 90_000;
    this.remoteCommitResolver = options.remoteCommitResolver ?? independentlyResolveRemoteCommit;
    if (this.leaseDurationMs < 250) throw new Error("Lease duration must be at least 250 ms.");
    if (this.pairingCodeTtlMs < 0) throw new Error("Pairing code TTL cannot be negative.");
    if (this.artifactUploadTtlMs < 250) throw new Error("Artifact upload TTL must be at least 250 ms.");
    if (this.heartbeatTtlMs < this.leaseDurationMs) throw new Error("Heartbeat TTL cannot be shorter than the lease duration.");
    if (this.databasePath !== ":memory:") mkdirSync(dirname(this.databasePath), { recursive: true });
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec(demoSchemaSql);
    ensureEvidenceLedgerEntryTypes(this.db);
    ensureColumn(
      this.db,
      "job_runs",
      "task_contract_version_id",
      "TEXT REFERENCES task_contract_versions(id)",
    );
    ensureColumn(
      this.db,
      "job_runs",
      "execution_backend_type",
      "TEXT NOT NULL DEFAULT 'LOCAL_WORKER' CHECK(execution_backend_type IN ('LOCAL_WORKER','MANAGED_REMOTE_SANDBOX'))",
    );
    ensureColumn(this.db, "evidence_artifacts", "claimed_sha256", "TEXT CHECK(claimed_sha256 IS NULL OR length(claimed_sha256) = 64)");
    ensureColumn(this.db, "evidence_artifacts", "server_sha256", "TEXT CHECK(server_sha256 IS NULL OR length(server_sha256) = 64)");
    ensureColumn(this.db, "evidence_artifacts", "sandbox_run_id", "TEXT REFERENCES managed_sandbox_runs(id)");
    this.seed();
    this.ensureAgentIdentityProfiles();
    this.reconcileWorkerCapacity();
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(operation: () => T): T {
    if (this.transactionDepth > 0) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private rows(sql: string, ...parameters: Array<string | number | null>): SqlRow[] {
    return this.db.prepare(sql).all(...parameters) as SqlRow[];
  }

  private row(sql: string, ...parameters: Array<string | number | null>): SqlRow | undefined {
    return this.db.prepare(sql).get(...parameters) as SqlRow | undefined;
  }

  private seed(): void {
    const existing = this.row("SELECT id FROM profiles LIMIT 1");
    if (existing) return;
    const timestamp = now();
    this.transaction(() => {
      const profiles = [
        [CUSTOMER_ID, "Nick Demo", "CUSTOMER"],
        [PROVIDER_ALPHA_ID, "Provider Alpha", "PROVIDER"],
        ["provider-beta", "Provider Beta", "PROVIDER"],
        ["admin-demo", "DoneLayer Admin", "ADMIN"]
      ] as const;
      const insertProfile = this.db.prepare("INSERT INTO profiles(id,name,role,created_at,updated_at) VALUES(?,?,?,?,?)");
      for (const profile of profiles) insertProfile.run(profile[0], profile[1], profile[2], timestamp, timestamp);

      const insertAgent = this.db.prepare("INSERT INTO agents(id,slug,provider_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)");
      for (const agent of createSeedAgents(timestamp)) {
        insertAgent.run(agent.id, agent.slug, agent.providerId, JSON.stringify(agent), timestamp, timestamp);
      }

      const insertWorker = this.db.prepare("INSERT INTO worker_nodes(id,provider_id,status,token_hash,token_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
      for (const worker of createSeedWorkers(timestamp)) {
        insertWorker.run(worker.id, worker.providerId, worker.status, null, null, JSON.stringify(worker), timestamp, timestamp);
      }

      const wallets = [
        ["wallet-customer", CUSTOMER_ID, "CUSTOMER", 2500000],
        ["wallet-provider-alpha", PROVIDER_ALPHA_ID, "PROVIDER", 624000],
        ["wallet-platform", PLATFORM_ID, "PLATFORM", 188000],
        ["wallet-escrow", ESCROW_ID, "ESCROW", 0],
        ["wallet-dispute", "dispute", "DISPUTE", 0]
      ] as const;
      const insertWallet = this.db.prepare("INSERT INTO test_wallets(id,owner_id,kind,available_cents,reserved_cents,pending_cents,created_at,updated_at) VALUES(?,?,?,?,0,0,?,?)");
      for (const wallet of wallets) insertWallet.run(wallet[0], wallet[1], wallet[2], wallet[3], timestamp, timestamp);
    });

    const sample = this.createTask(demoTaskInput(), CUSTOMER_ID, "10000000-0000-4000-8000-000000000001");
    let current = sample;
    for (let step = 0; step < 20 && current.status !== "CUSTOMER_REVIEW"; step += 1) {
      current = this.advanceDemo(current.id).task;
    }
    const offerInput = demoTaskInput();
    offerInput.title = "Diagnose a failing checkout build";
    offerInput.problemDescription = "A demo checkout application no longer builds after a dependency update. Identify the bounded dependency or configuration failure and provide a launch-readiness report.";
    offerInput.desiredOutcome = "The root cause is documented, the approved build workflow exits successfully and the changed files are recorded.";
    offerInput.repository = "demo://sample-org/checkout-web";
    offerInput.taskType = "BUILD_RESCUE";
    offerInput.requiredSkills = ["React", "TypeScript"];
    const offered = this.createTask(offerInput, CUSTOMER_ID, "10000000-0000-4000-8000-000000000002");
    current = offered;
    for (let step = 0; step < 10 && current.status !== "AWAITING_PROVIDER"; step += 1) {
      current = this.advanceDemo(current.id).task;
    }
  }

  private ensureAgentIdentityProfiles(): void {
    const missing = this.rows(`
      SELECT agents.* FROM agents
      LEFT JOIN agent_identity_profiles identity ON identity.agent_id=agents.id
      WHERE identity.agent_id IS NULL
      ORDER BY agents.created_at, agents.id
    `).map(mapAgent);
    if (!missing.length) return;
    this.transaction(() => {
      for (const agent of missing) {
        this.ensureAgentIdentityProfile(agent, "EXISTING_MARKETPLACE_AGENT", {
          kind: "SYSTEM",
          id: "agent-identity-migration",
        });
      }
    });
  }

  private ensureAgentIdentityProfile(
    agent: AgentRecord,
    source: string,
    actor: Actor,
  ): AgentIdentityProfile {
    const existing = this.getAgentIdentityProfile(agent.id);
    if (existing) return existing;
    const profile = this.createInitialAgentIdentityProfile(agent);
    this.insertAgentIdentityProfile(profile);
    this.insertAudit(
      actor,
      "AGENT_IDENTITY_REGISTERED",
      "agent_identity_profile",
      `${profile.agentId}:${profile.revision}`,
      { profileSha256: profile.profileSha256, source },
    );
    return profile;
  }

  private createInitialAgentIdentityProfile(agent: AgentRecord): AgentIdentityProfile {
    return createAgentIdentityProfile({
      agentId: agent.id,
      displayName: agent.name,
      controller: {
        controllerType: "PLATFORM_ACCOUNT",
        accountType: "USER",
        accountId: agent.providerId,
        relationship: "CONTROLS",
        assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
        legallyVerified: false,
      },
      declaredCapabilities: [...agent.skills, ...agent.taskTypes],
      runtimeReferences: [{
        system: "DONE_LAYER",
        identifier: `marketplace-agent:${agent.id}`,
        verificationLevel: "OBSERVED",
      }],
      createdAt: agent.createdAt,
    });
  }

  private insertAgentIdentityProfile(profile: AgentIdentityProfile): void {
    assertAgentIdentityProfileIntegrity(profile);
    const agent = this.getAgentById(profile.agentId);
    if (!agent) throw new Error("AGENT_IDENTITY_MARKETPLACE_AGENT_UNKNOWN");
    if (agent.providerId !== profile.controller.accountId) throw new Error("AGENT_IDENTITY_CONTROLLER_MISMATCH");
    for (const reference of profile.externalIdentities) {
      const key = agentExternalIdentityKey(reference);
      const owner = this.row("SELECT agent_id FROM agent_external_identity_owners WHERE identity_key=?", key);
      if (owner && string(owner.agent_id) !== profile.agentId) throw new Error("EXTERNAL_IDENTITY_CONFLICT");
    }
    this.db.prepare(`
      INSERT INTO agent_identity_profiles(
        agent_id,revision,profile_sha256,previous_profile_sha256,
        controller_account_id,profile_json,created_at
      ) VALUES(?,?,?,?,?,?,?)
    `).run(
      profile.agentId,
      profile.revision,
      profile.profileSha256,
      profile.previousProfileSha256,
      profile.controller.accountId,
      canonicalJson(profile),
      profile.updatedAt,
    );
    for (const reference of profile.externalIdentities) {
      const key = agentExternalIdentityKey(reference);
      if (!this.row("SELECT identity_key FROM agent_external_identity_owners WHERE identity_key=?", key)) {
        this.db.prepare(`
          INSERT INTO agent_external_identity_owners(identity_key,agent_id,first_profile_revision,created_at)
          VALUES(?,?,?,?)
        `).run(key, profile.agentId, profile.revision, profile.updatedAt);
      }
    }
  }

  private nextAgentIdentityRevisionTime(current: AgentIdentityProfile, requested?: string): string {
    if (requested) return requested;
    const observed = Date.now();
    const minimum = Date.parse(current.updatedAt) + 1;
    return new Date(Math.max(observed, minimum)).toISOString();
  }

  listAgents(): AgentRecord[] {
    return this.rows("SELECT * FROM agents ORDER BY json_extract(data_json, '$.verifiedSuccessRate') DESC").map(mapAgent);
  }

  getAgentById(id: string): AgentRecord | null {
    const found = this.row("SELECT * FROM agents WHERE id = ?", id);
    return found ? mapAgent(found) : null;
  }

  getAgentBySlug(slug: string): AgentRecord | null {
    const found = this.row("SELECT * FROM agents WHERE slug = ?", slug);
    return found ? mapAgent(found) : null;
  }

  getAgentIdentityProfile(agentId: string, revision?: number): AgentIdentityProfile | null {
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
      throw new Error("AGENT_IDENTITY_REVISION_INVALID");
    }
    const found = revision === undefined
      ? this.row("SELECT * FROM agent_identity_profiles WHERE agent_id=? ORDER BY revision DESC LIMIT 1", agentId)
      : this.row("SELECT * FROM agent_identity_profiles WHERE agent_id=? AND revision=?", agentId, revision);
    return found ? structuredClone(mapAgentIdentityProfile(found)) : null;
  }

  listAgentIdentityHistory(agentId: string): AgentIdentityProfile[] {
    return this.rows("SELECT * FROM agent_identity_profiles WHERE agent_id=? ORDER BY revision", agentId)
      .map(mapAgentIdentityProfile)
      .map((profile) => structuredClone(profile));
  }

  listAgentIdentityProfiles(controllerAccountId?: string): AgentIdentityProfile[] {
    const sql = `
      SELECT profile.* FROM agent_identity_profiles profile
      JOIN (
        SELECT agent_id, MAX(revision) AS revision
        FROM agent_identity_profiles
        GROUP BY agent_id
      ) current ON current.agent_id=profile.agent_id AND current.revision=profile.revision
      ${controllerAccountId ? "WHERE profile.controller_account_id=?" : ""}
      ORDER BY profile.agent_id
    `;
    const rows = controllerAccountId ? this.rows(sql, controllerAccountId) : this.rows(sql);
    return rows.map(mapAgentIdentityProfile).map((profile) => structuredClone(profile));
  }

  reviseAgentIdentity(input: {
    agentId: string;
    expectedRevision: number;
    patch: Partial<Pick<AgentIdentityProfile, "displayName" | "status" | "declaredCapabilities" | "runtimeReferences">>;
    updatedAt?: string;
  }): AgentIdentityProfile {
    return this.transaction(() => {
      const current = this.getAgentIdentityProfile(input.agentId);
      if (!current) throw new Error("AGENT_IDENTITY_UNKNOWN");
      const next = buildAgentIdentityRevision({
        current,
        expectedRevision: input.expectedRevision,
        patch: input.patch,
        updatedAt: this.nextAgentIdentityRevisionTime(current, input.updatedAt),
      });
      this.insertAgentIdentityProfile(next);
      this.insertAudit(
        { kind: "PROVIDER", id: next.controller.accountId },
        "AGENT_IDENTITY_REVISED",
        "agent_identity_profile",
        `${next.agentId}:${next.revision}`,
        { profileSha256: next.profileSha256, previousProfileSha256: next.previousProfileSha256, status: next.status },
      );
      return structuredClone(next);
    });
  }

  linkAgentExternalIdentity(input: {
    agentId: string;
    expectedRevision: number;
    reference: ExternalAgentIdentityReference;
    updatedAt?: string;
  }): AgentIdentityProfile {
    return this.transaction(() => {
      const current = this.getAgentIdentityProfile(input.agentId);
      if (!current) throw new Error("AGENT_IDENTITY_UNKNOWN");
      const key = agentExternalIdentityKey(input.reference);
      if (current.externalIdentities.some((reference) => agentExternalIdentityKey(reference) === key)) {
        throw new Error("EXTERNAL_IDENTITY_DUPLICATE");
      }
      const owner = this.row("SELECT agent_id FROM agent_external_identity_owners WHERE identity_key=?", key);
      if (owner && string(owner.agent_id) !== input.agentId) throw new Error("EXTERNAL_IDENTITY_CONFLICT");
      const next = buildAgentIdentityRevision({
        current,
        expectedRevision: input.expectedRevision,
        patch: { externalIdentities: [...current.externalIdentities, input.reference] },
        updatedAt: this.nextAgentIdentityRevisionTime(current, input.updatedAt),
      });
      this.insertAgentIdentityProfile(next);
      this.insertAudit(
        { kind: "PROVIDER", id: next.controller.accountId },
        "AGENT_EXTERNAL_IDENTITY_LINKED",
        "agent_identity_profile",
        `${next.agentId}:${next.revision}`,
        { identityKeySha256: sha256Canonical(key), profileSha256: next.profileSha256 },
      );
      return structuredClone(next);
    });
  }

  verifyAgentIdentityStore(): AgentIdentityStoreVerification {
    const agentCount = number(this.row("SELECT COUNT(*) AS count FROM agents")?.count);
    const rows = this.rows("SELECT * FROM agent_identity_profiles ORDER BY agent_id, revision");
    const expectedOwners = new Map<string, string>();
    const latestRevision = new Map<string, AgentIdentityProfile>();
    let valid = rows.length >= agentCount;
    for (const row of rows) {
      try {
        const profile = mapAgentIdentityProfile(row);
        const previous = latestRevision.get(profile.agentId);
        if (
          profile.revision !== (previous?.revision ?? 0) + 1 ||
          profile.previousProfileSha256 !== (previous?.profileSha256 ?? null) ||
          previous && profile.createdAt !== previous.createdAt
        ) valid = false;
        latestRevision.set(profile.agentId, profile);
        for (const reference of profile.externalIdentities) {
          const key = agentExternalIdentityKey(reference);
          const owner = expectedOwners.get(key);
          if (owner && owner !== profile.agentId) valid = false;
          expectedOwners.set(key, profile.agentId);
        }
      } catch {
        valid = false;
      }
    }
    if (latestRevision.size !== agentCount) valid = false;
    const ownerRows = this.rows("SELECT identity_key,agent_id FROM agent_external_identity_owners ORDER BY identity_key");
    if (ownerRows.length !== expectedOwners.size) valid = false;
    for (const row of ownerRows) {
      if (expectedOwners.get(string(row.identity_key)) !== string(row.agent_id)) valid = false;
    }
    return {
      valid,
      agentCount,
      profileCount: rows.length,
      externalIdentityCount: ownerRows.length,
    };
  }

  listWorkers(providerId?: string): WorkerRecord[] {
    const found = providerId
      ? this.rows("SELECT * FROM worker_nodes WHERE provider_id = ? ORDER BY created_at", providerId)
      : this.rows("SELECT * FROM worker_nodes ORDER BY created_at");
    return found.map(mapWorker);
  }

  getWorker(id: string): WorkerRecord | null {
    const found = this.row("SELECT * FROM worker_nodes WHERE id = ?", id);
    return found ? mapWorker(found) : null;
  }

  listTasks(customerId?: string): TaskRecord[] {
    const found = customerId
      ? this.rows("SELECT * FROM tasks WHERE customer_id = ? ORDER BY updated_at DESC", customerId)
      : this.rows("SELECT * FROM tasks ORDER BY updated_at DESC");
    return found.map(mapTask);
  }

  getTask(id: string): TaskRecord | null {
    const found = this.row("SELECT * FROM tasks WHERE id = ?", id);
    return found ? mapTask(found) : null;
  }

  createTask(inputValue: CreateTaskInput, customerId = CUSTOMER_ID, id = randomUUID()): TaskRecord {
    const input = createTaskInputSchema.parse(inputValue);
    const timestamp = now();
    const task: TaskRecord = {
      id,
      customerId,
      title: input.title,
      problemDescription: input.problemDescription,
      desiredOutcome: input.desiredOutcome,
      repository: input.repository,
      targetBranch: input.targetBranch,
      taskType: input.taskType,
      requiredSkills: input.requiredSkills,
      requiredOperatingSystem: input.requiredOperatingSystem,
      requiredTools: input.requiredTools,
      requiredMcpTools: input.requiredMcpTools,
      budgetCents: input.budgetCents,
      deadline: input.deadline,
      acceptanceChecks: input.acceptanceChecks,
      securitySensitivity: input.securitySensitivity,
      allowCodeChanges: input.allowCodeChanges,
      allowPullRequest: input.allowPullRequest,
      requiresHumanApproval: input.requiresHumanApproval,
      preferredAgentId: input.preferredAgentId,
      status: "DRAFT",
      version: 0,
      analysis: null,
      matchedAgentId: null,
      assignedWorkerId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    return this.transaction(() => {
      this.db.prepare("INSERT INTO tasks(id,customer_id,status,version,matched_agent_id,assigned_worker_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        task.id,
        task.customerId,
        task.status,
        task.version,
        null,
        null,
        JSON.stringify(task),
        timestamp,
        timestamp
      );
      this.insertTaskEvent(task.id, null, "DRAFT", { kind: "CUSTOMER", id: customerId }, "Task draft created", "TASK_CREATED");
      this.reserve(task.id, customerId, task.budgetCents);
      return task;
    });
  }

  createDemoTask(): TaskRecord {
    return this.createTask(demoTaskInput());
  }

  createTaskContractDraft(
    taskId: string,
    input: TaskContractDraftInput,
    createdBy: string,
  ): TaskContractVersionRecord {
    return this.transaction(() => {
      if (!this.getTask(taskId)) throw new Error("Task not found.");
      const versionRow = this.row(
        "SELECT COALESCE(MAX(version),0)+1 AS next_version FROM task_contract_versions WHERE task_id=?",
        taskId,
      );
      const version = versionRow ? number(versionRow.next_version) : 1;
      const contract: TaskContractDocument = { ...input, taskId, contractVersion: version };
      validateTaskContractDocument(contract);
      const id = randomUUID();
      const timestamp = now();
      const contractJson = canonicalJson(contract);
      const contractSha256 = sha256Canonical(contract);
      this.db.prepare(
        "INSERT INTO task_contract_versions(id,task_id,version,status,contract_json,contract_sha256,created_by,created_at,locked_at,superseded_at) VALUES(?,?,?,'DRAFT',?,?,?,?,NULL,NULL)",
      ).run(id, taskId, version, contractJson, contractSha256, createdBy, timestamp);
      this.insertAudit(
        { kind: "SYSTEM", id: createdBy },
        "TASK_CONTRACT_DRAFT_CREATED",
        "task_contract_version",
        id,
        { taskId, version, contractSha256 },
      );
      return this.getTaskContractVersion(id)!;
    });
  }

  updateTaskContractDraft(
    contractId: string,
    input: TaskContractDraftInput,
    actorId: string,
  ): TaskContractVersionRecord {
    return this.transaction(() => {
      const current = this.getTaskContractVersion(contractId);
      if (!current) throw new Error("Task Contract was not found.");
      if (current.status !== "DRAFT") throw new Error("Locked Task Contracts cannot be modified directly.");
      const contract: TaskContractDocument = {
        ...input,
        taskId: current.taskId,
        contractVersion: current.version,
      };
      validateTaskContractDocument(contract);
      const contractSha256 = sha256Canonical(contract);
      this.db.prepare("UPDATE task_contract_versions SET contract_json=?, contract_sha256=? WHERE id=? AND status='DRAFT'").run(
        canonicalJson(contract),
        contractSha256,
        contractId,
      );
      this.insertAudit(
        { kind: "SYSTEM", id: actorId },
        "TASK_CONTRACT_DRAFT_UPDATED",
        "task_contract_version",
        contractId,
        { contractSha256 },
      );
      return this.getTaskContractVersion(contractId)!;
    });
  }

  createTaskContractRevision(
    lockedContractId: string,
    input: TaskContractDraftInput,
    actorId: string,
  ): TaskContractVersionRecord {
    const locked = this.getTaskContractVersion(lockedContractId);
    if (!locked || (locked.status !== "LOCKED" && locked.status !== "SUPERSEDED")) {
      throw new Error("Only a locked Task Contract can be revised.");
    }
    return this.createTaskContractDraft(locked.taskId, input, actorId);
  }

  lockTaskContract(contractId: string, actorId: string): TaskContractVersionRecord {
    return this.transaction(() => {
      const contract = this.getTaskContractVersion(contractId);
      if (!contract) throw new Error("Task Contract was not found.");
      if (contract.status !== "DRAFT") throw new Error("Only a DRAFT Task Contract can be locked.");
      if (sha256Canonical(contract.contract) !== contract.contractSha256) {
        throw new Error("Task Contract hash does not match its canonical document.");
      }
      const timestamp = now();
      const previousLocked = this.getLockedTaskContract(contract.taskId);
      this.db.prepare("UPDATE task_contract_versions SET status='SUPERSEDED', superseded_at=? WHERE task_id=? AND status='LOCKED'").run(
        timestamp,
        contract.taskId,
      );
      if (previousLocked) {
        this.insertAudit(
          { kind: "SYSTEM", id: actorId },
          "TASK_CONTRACT_SUPERSEDED",
          "task_contract_version",
          previousLocked.id,
          { taskId: contract.taskId, supersededBy: contract.id },
        );
      }
      const locked = this.db.prepare("UPDATE task_contract_versions SET status='LOCKED', locked_at=? WHERE id=? AND status='DRAFT'").run(
        timestamp,
        contractId,
      );
      if (Number(locked.changes) !== 1) throw new Error("Task Contract lock lost its version fence.");
      this.insertAudit(
        { kind: "SYSTEM", id: actorId },
        "TASK_CONTRACT_LOCKED",
        "task_contract_version",
        contractId,
        { taskId: contract.taskId, version: contract.version, contractSha256: contract.contractSha256 },
      );
      return this.getTaskContractVersion(contractId)!;
    });
  }

  getTaskContractVersion(contractId: string): TaskContractVersionRecord | null {
    const found = this.row("SELECT * FROM task_contract_versions WHERE id=?", contractId);
    return found ? mapTaskContract(found) : null;
  }

  getLockedTaskContract(taskId: string): TaskContractVersionRecord | null {
    const found = this.row(
      "SELECT * FROM task_contract_versions WHERE task_id=? AND status='LOCKED' ORDER BY version DESC LIMIT 1",
      taskId,
    );
    return found ? mapTaskContract(found) : null;
  }

  createPermissionLeaseForJob(
    jobRunId: string,
    scope: PermissionScope,
    createdBy: string,
  ): PermissionLeaseRecord {
    return this.transaction(() => {
      validatePermissionScope(scope);
      const job = this.getJobRun(jobRunId);
      if (!job) throw new Error("Job run not found.");
      if (!job.taskContractVersionId) throw new Error("Job Run has no Task Contract Version.");
      const contract = this.getTaskContractVersion(job.taskContractVersionId);
      if (!contract || contract.status !== "LOCKED") throw new Error("Permission Lease requires a locked Task Contract.");
      const contractActions = new Set(contract.contract.allowedActions);
      if (scope.allowedActions.some((action) => !contractActions.has(action))) {
        throw new Error("Permission Lease cannot grant actions outside the locked Task Contract.");
      }
      if (scope.allowedActions.some((action) => scope.deniedActions.includes(action))) {
        throw new Error("Permission Lease cannot both allow and deny the same action.");
      }
      if (scope.maxRuntimeSeconds > contract.contract.timeLimitSeconds) {
        throw new Error("Permission Lease runtime exceeds the locked Task Contract.");
      }
      if (scope.maxApiBudget > contract.contract.budgetLimit.maxAmount) {
        throw new Error("Permission Lease budget exceeds the locked Task Contract.");
      }
      const nextRow = this.row(
        "SELECT COALESCE(MAX(version),0)+1 AS next_version FROM permission_leases WHERE task_id=? AND task_contract_version_id=?",
        job.taskId,
        contract.id,
      );
      const version = nextRow ? number(nextRow.next_version) : 1;
      const id = randomUUID();
      const timestamp = now();
      this.db.prepare(
        "INSERT INTO permission_leases(id,task_id,task_contract_version_id,job_run_id,agent_id,worker_id,version,status,scope_json,starts_at,expires_at,revoked_at,revoke_reason,created_at,created_by) VALUES(?,?,?,?,?,?,?,'PENDING',?,NULL,NULL,NULL,NULL,?,?)",
      ).run(
        id,
        job.taskId,
        contract.id,
        jobRunId,
        job.agentId,
        job.workerId,
        version,
        canonicalJson(scope),
        timestamp,
        createdBy,
      );
      this.insertAudit(
        { kind: "SYSTEM", id: createdBy },
        "PERMISSION_LEASE_CREATED",
        "permission_lease",
        id,
        { jobRunId, taskContractVersionId: contract.id, version },
      );
      return this.getPermissionLease(id)!;
    });
  }

  getPermissionLease(permissionLeaseId: string): PermissionLeaseRecord | null {
    const found = this.row("SELECT * FROM permission_leases WHERE id=?", permissionLeaseId);
    return found ? mapPermissionLease(found) : null;
  }

  getPermissionLeaseForJob(jobRunId: string): PermissionLeaseRecord | null {
    const found = this.row(
      "SELECT * FROM permission_leases WHERE job_run_id=? ORDER BY version DESC LIMIT 1",
      jobRunId,
    );
    return found ? mapPermissionLease(found) : null;
  }

  revokePermissionLease(permissionLeaseId: string, adminId: string, reason: string): PermissionLeaseRecord {
    return this.transaction(() => {
      const lease = this.getPermissionLease(permissionLeaseId);
      if (!lease) throw new Error("Permission Lease was not found.");
      if (lease.status !== "PENDING" && lease.status !== "ACTIVE") {
        throw new Error("Terminal Permission Lease cannot be revoked.");
      }
      const timestamp = now();
      const terminalExpiresAt = lease.expiresAt ?? new Date(Date.parse(timestamp) + 1_000).toISOString();
      this.db.prepare("UPDATE permission_leases SET status='REVOKED', starts_at=COALESCE(starts_at,?), expires_at=COALESCE(expires_at,?), revoked_at=?, revoke_reason=? WHERE id=? AND status IN ('PENDING','ACTIVE')").run(
        timestamp,
        terminalExpiresAt,
        timestamp,
        reason.trim().slice(0, 1000) || "Revoked by Admin",
        permissionLeaseId,
      );
      this.insertAudit(
        { kind: "ADMIN", id: adminId },
        "PERMISSION_LEASE_REVOKED",
        "permission_lease",
        permissionLeaseId,
        { jobRunId: lease.jobRunId, reason },
      );
      return this.getPermissionLease(permissionLeaseId)!;
    });
  }

  assertPermissionActionAllowed(
    jobRunId: string,
    workerId: string,
    action: string,
  ): PermissionLeaseRecord {
    const lease = this.assertPermissionLeaseActive(jobRunId, workerId);
    if (lease.scope.deniedActions.includes(action) || !lease.scope.allowedActions.includes(action)) {
      throw new Error(`Action ${action} is not allowed by the Permission Lease.`);
    }
    return lease;
  }

  assertPermissionLeaseActive(jobRunId: string, workerId: string): PermissionLeaseRecord {
    const lease = this.getPermissionLeaseForJob(jobRunId);
    if (!lease || lease.workerId !== workerId) throw new Error("Permission Lease does not belong to this Worker Job.");
    const expiresAt = lease.expiresAt ? Date.parse(lease.expiresAt) : Number.NaN;
    if (lease.status === "ACTIVE" && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
      this.db.prepare("UPDATE permission_leases SET status='EXPIRED' WHERE id=? AND status='ACTIVE'").run(lease.id);
      throw new Error("Permission Lease has expired.");
    }
    if (lease.status !== "ACTIVE" || !lease.startsAt || !lease.expiresAt) {
      throw new Error(`Permission Lease is ${lease.status.toLowerCase()}.`);
    }
    return lease;
  }

  recordPermissionViolation(
    jobRunId: string,
    workerId: string,
    action: string,
    reason: string,
    resource?: string,
  ): PermissionLeaseRecord {
    return this.transaction(() => {
      const lease = this.getPermissionLeaseForJob(jobRunId);
      if (!lease || lease.workerId !== workerId) throw new Error("Permission Lease does not belong to this Worker Job.");
      if (lease.status !== "PENDING" && lease.status !== "ACTIVE") {
        throw new Error(`Permission Lease is already ${lease.status.toLowerCase()}.`);
      }
      const wasActive = lease.status === "ACTIVE";
      const timestamp = now();
      const terminalExpiresAt = lease.expiresAt ?? new Date(Date.parse(timestamp) + 1_000).toISOString();
      this.db.prepare("UPDATE permission_leases SET status='VIOLATED', starts_at=COALESCE(starts_at,?), expires_at=COALESCE(expires_at,?), revoked_at=?, revoke_reason=? WHERE id=? AND status IN ('PENDING','ACTIVE')").run(
        timestamp,
        terminalExpiresAt,
        timestamp,
        reason.slice(0, 1000),
        lease.id,
      );
      const event = this.appendJobEvent(
        jobRunId,
        "STATUS",
        "ERROR",
        "Permission Lease violation blocked Worker operation",
        { action, reason, ...(resource === undefined ? {} : { resource }) },
      );
      this.appendEvidenceLedgerEntry(jobRunId, "PERMISSION_VIOLATION", "job_run_event", event.id, {
        action,
        reason,
        ...(resource === undefined ? {} : { resource }),
      });
      this.insertAudit(
        { kind: "WORKER", id: workerId },
        "PERMISSION_VIOLATION",
        "permission_lease",
        lease.id,
        { jobRunId, action, reason },
      );
      const violatedLease = this.getPermissionLease(lease.id)!;
      if (wasActive) {
        const job = this.getJobRun(jobRunId);
        let task = job ? this.getTask(job.taskId) : null;
        if (job?.status === "RUNNING" && task?.status === "RUNNING") {
          this.db.prepare("UPDATE job_runs SET status='FAILED', ended_at=?, lease_expires_at=?, updated_at=? WHERE id=? AND status='RUNNING'").run(
            timestamp,
            timestamp,
            timestamp,
            jobRunId,
          );
          this.db.prepare("UPDATE job_run_attempts SET terminal_reason='PERMISSION_VIOLATION', lease_revoked_at=?, updated_at=? WHERE job_run_id=?").run(
            timestamp,
            timestamp,
            jobRunId,
          );
          task = this.transitionUnsafe(task, "SUBMITTED", { kind: "WORKER", id: workerId }, "Worker reported a blocked Permission Lease violation", "PERMISSION_VIOLATION_SUBMITTED");
          task = this.transitionUnsafe(task, "VERIFYING", { kind: "SYSTEM", id: "permission-verifier" }, "Server verified the Permission Lease violation evidence", "PERMISSION_VIOLATION_VERIFYING");
          const contract = job.taskContractVersionId ? this.getTaskContractVersion(job.taskContractVersionId) : null;
          if (contract) {
            for (const check of contract.contract.acceptanceChecks) {
              const failed = check.id === "no-permission-violation";
              this.db.prepare("INSERT INTO verification_results(id,task_id,job_run_id,check_id,check_type,status,summary,observed_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(
                randomUUID(),
                task.id,
                jobRunId,
                check.id,
                check.type,
                failed ? "FAILED" : "PENDING",
                failed ? "Permission Lease violation was recorded" : "Check was not completed after the Permission Lease violation",
                canonicalJson(failed ? { action, reason, resource: resource ?? null } : {}),
                timestamp,
                timestamp,
              );
            }
          }
          const verificationEvent = this.appendJobEvent(jobRunId, "STATUS", "ERROR", "Permission violation prevented VERIFIED completion", { permissionLeaseId: lease.id });
          this.appendEvidenceLedgerEntry(jobRunId, "VERIFICATION_FAILED", "job_run_event", verificationEvent.id, {
            result: "PERMISSION_VIOLATION",
            permissionLeaseId: lease.id,
          }, timestamp);
          task = this.transitionUnsafe(task, "VERIFICATION_FAILED", { kind: "SYSTEM", id: "permission-verifier" }, "Permission violation prevents a VERIFIED result", "PERMISSION_VIOLATION_VERIFIED");
          if (contract) this.createPermissionViolationReceipt(task, this.getJobRun(jobRunId)!, contract, violatedLease, timestamp, reason);
          this.reconcileWorkerCapacity(workerId);
        }
      }
      return violatedLease;
    });
  }

  appendEvidenceLedgerEntry(
    jobRunId: string,
    entryType: EvidenceLedgerEntryType,
    sourceRecordType: string,
    sourceRecordId: string,
    payload: unknown,
    createdAt = now(),
    payloadSha256Override?: string,
  ): EvidenceLedgerEntryRecord {
    return this.transaction(() => {
      const job = this.getJobRun(jobRunId);
      if (!job) throw new Error("Job run not found for Evidence Ledger entry.");
      const latest = this.row(
        "SELECT * FROM evidence_ledger_entries WHERE job_run_id=? ORDER BY sequence_number DESC LIMIT 1",
        jobRunId,
      );
      const sequenceNumber = latest ? number(latest.sequence_number) + 1 : 1;
      const previousEntrySha256 = latest ? string(latest.entry_sha256) : null;
      const computedPayloadSha256 = sha256Canonical(payload);
      if (payloadSha256Override && payloadSha256Override !== computedPayloadSha256) {
        throw new Error("Evidence payload SHA-256 does not match its canonical payload.");
      }
      const payloadSha256 = payloadSha256Override ?? computedPayloadSha256;
      if (!/^[a-f0-9]{64}$/.test(payloadSha256)) throw new Error("Evidence payload SHA-256 is invalid.");
      const entrySha256 = computeEvidenceLedgerEntryHash({
        sequenceNumber,
        entryType,
        sourceRecordType,
        sourceRecordId,
        payloadSha256,
        previousEntrySha256,
        createdAt,
      });
      const id = randomUUID();
      this.db.prepare(
        "INSERT INTO evidence_ledger_entries(id,task_id,job_run_id,sequence_number,entry_type,source_record_type,source_record_id,payload_sha256,previous_entry_sha256,entry_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        job.taskId,
        jobRunId,
        sequenceNumber,
        entryType,
        sourceRecordType,
        sourceRecordId,
        payloadSha256,
        previousEntrySha256,
        entrySha256,
        createdAt,
      );
      return this.listEvidenceLedgerEntries(jobRunId).at(-1)!;
    });
  }

  listEvidenceLedgerEntries(jobRunId: string): EvidenceLedgerEntryRecord[] {
    return this.rows(
      "SELECT * FROM evidence_ledger_entries WHERE job_run_id=? ORDER BY sequence_number",
      jobRunId,
    ).map(mapEvidenceLedgerEntry);
  }

  verifyLedgerChain(jobRunId: string): EvidenceLedgerVerification {
    return verifyEvidenceLedgerEntries(this.listEvidenceLedgerEntries(jobRunId));
  }

  getJobReceiptByJobRun(jobRunId: string): JobReceiptRecord | null {
    const found = this.row("SELECT * FROM job_receipts WHERE job_run_id=?", jobRunId);
    return found ? mapJobReceipt(found) : null;
  }

  getJobReceiptByPublicId(receiptPublicId: string): JobReceiptRecord | null {
    const found = this.row("SELECT * FROM job_receipts WHERE receipt_public_id=?", receiptPublicId);
    return found ? mapJobReceipt(found) : null;
  }

  getPublicJobReceipt(receiptPublicId: string): PublicJobReceipt | null {
    const receipt = this.getJobReceiptByPublicId(receiptPublicId);
    if (!receipt) return null;
    const disputed = Boolean(this.row(
      "SELECT id FROM disputes WHERE task_id=? AND status IN ('OPEN','UNDER_REVIEW') LIMIT 1",
      receipt.taskId,
    ));
    return toPublicJobReceipt(receipt, this.listEvidenceLedgerEntries(receipt.jobRunId), disputed);
  }

  invalidateJobReceipt(receiptId: string, adminId: string, reason: string): JobReceiptRecord {
    return this.transaction(() => {
      const found = this.row("SELECT * FROM job_receipts WHERE id=?", receiptId);
      if (!found) throw new Error("Verified Job Receipt was not found.");
      const receipt = mapJobReceipt(found);
      if (receipt.invalidatedAt) throw new Error("Verified Job Receipt is already invalidated.");
      const timestamp = now();
      const invalidationReason = reason.trim().slice(0, 1000);
      if (!invalidationReason) throw new Error("Receipt invalidation requires a reason.");
      this.db.prepare("UPDATE job_receipts SET invalidated_at=?, invalidation_reason=? WHERE id=? AND invalidated_at IS NULL").run(
        timestamp,
        invalidationReason,
        receiptId,
      );
      this.insertAudit(
        { kind: "ADMIN", id: adminId },
        "JOB_RECEIPT_INVALIDATED",
        "job_receipt",
        receiptId,
        { taskId: receipt.taskId, jobRunId: receipt.jobRunId },
      );
      return this.getJobReceiptByJobRun(receipt.jobRunId)!;
    });
  }

  private activatePermissionLeaseForJob(jobRunId: string, timestamp = now()): PermissionLeaseRecord {
    const lease = this.getPermissionLeaseForJob(jobRunId);
    if (!lease || lease.status !== "PENDING") throw new Error("Job has no pending Permission Lease.");
    const expiresAt = new Date(Date.parse(timestamp) + lease.scope.maxRuntimeSeconds * 1000).toISOString();
    const activated = this.db.prepare("UPDATE permission_leases SET status='ACTIVE', starts_at=?, expires_at=? WHERE id=? AND status='PENDING'").run(
      timestamp,
      expiresAt,
      lease.id,
    );
    if (Number(activated.changes) !== 1) throw new Error("Permission Lease activation lost its state fence.");
    const active = this.getPermissionLease(lease.id)!;
    this.appendEvidenceLedgerEntry(jobRunId, "PERMISSION_GRANTED", "permission_lease", active.id, {
      version: active.version,
      startsAt: active.startsAt,
      expiresAt: active.expiresAt,
      scope: active.scope,
    });
    this.insertAudit(
      { kind: "SYSTEM", id: "permission-service" },
      "PERMISSION_LEASE_ACTIVATED",
      "permission_lease",
      active.id,
      { jobRunId, expiresAt },
    );
    return active;
  }

  createWorkerSmokeTask(workerId: string): TaskAggregate {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker not found.");
      const agentRow = this.row(
        "SELECT * FROM agents WHERE provider_id=? ORDER BY created_at, id LIMIT 1",
        worker.providerId,
      );
      if (!agentRow) throw new Error("Worker provider has no server-owned Agent identity.");
      const agent = mapAgent(agentRow);
      const timestamp = now();
      const task: TaskRecord = {
        id: randomUUID(),
        customerId: CUSTOMER_ID,
        title: "Worker reality smoke test",
        problemDescription: "Run the server allowlisted WORKER_SMOKE_V1 workflow without repository or shell access.",
        desiredOutcome: "Upload a real hello.txt artifact whose bytes and SHA-256 are independently verified by the server.",
        repository: "worker-smoke://none",
        targetBranch: "none",
        taskType: "DIAGNOSE_REPOSITORY",
        requiredSkills: [],
        requiredOperatingSystem: null,
        requiredTools: ["Node.js"],
        requiredMcpTools: [],
        budgetCents: 0,
        deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
        acceptanceChecks: [
          {
            id: "worker-smoke-hello",
            type: "FILE_EXISTS",
            title: "A verified hello.txt artifact exists",
            required: true,
            path: "hello.txt",
          },
        ],
        securitySensitivity: "LOW",
        allowCodeChanges: false,
        allowPullRequest: false,
        requiresHumanApproval: false,
        preferredAgentId: agent.id,
        status: "DRAFT",
        version: 0,
        analysis: {
          scopeSummary: "Create hello.txt with Node.js fs APIs and upload it through the fenced artifact protocol.",
          requiredCapabilities: ["Node.js", "WORKER_SMOKE_V1"],
          suggestedTaskTemplate: "WORKER_SMOKE_V1",
          riskLevel: "LOW",
          suggestedVerificationChecks: [
            {
              id: "worker-smoke-hello",
              type: "FILE_EXISTS",
              title: "A verified hello.txt artifact exists",
              required: true,
              path: "hello.txt",
            },
          ],
          suggestedBudgetCents: 0,
          estimatedDurationHours: 0.01,
        },
        matchedAgentId: agent.id,
        assignedWorkerId: worker.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.db.prepare("INSERT INTO tasks(id,customer_id,status,version,matched_agent_id,assigned_worker_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        task.id,
        task.customerId,
        task.status,
        task.version,
        agent.id,
        worker.id,
        JSON.stringify(task),
        timestamp,
        timestamp,
      );
      const smokeContractDocument = workerSmokeContract(task.id, 1);
      const { taskId: _taskId, contractVersion: _contractVersion, ...smokeContractInput } = smokeContractDocument;
      const contractDraft = this.createTaskContractDraft(task.id, smokeContractInput, "worker-reality-gate");
      const contract = this.lockTaskContract(contractDraft.id, "worker-reality-gate");
      this.insertTaskEvent(task.id, null, "DRAFT", { kind: "SYSTEM", id: "worker-reality-gate" }, "Server created an allowlisted Worker smoke task", "WORKER_SMOKE_CREATED");
      let current = this.transitionUnsafe(task, "PUBLISHED", { kind: "ADMIN", id: "worker-reality-gate" }, "Server published the fixed smoke definition", "WORKER_SMOKE_PUBLISHED");
      current = this.transitionUnsafe(current, "ANALYZING", { kind: "SYSTEM", id: "worker-reality-gate" }, "Server validated the fixed workflow definition", "WORKER_SMOKE_ANALYZING");
      current = this.transitionUnsafe(current, "MATCHING", { kind: "SYSTEM", id: "worker-reality-gate" }, "Server selected the explicitly paired Worker capability", "WORKER_SMOKE_MATCHING");
      current = this.transitionUnsafe(current, "MATCHED", { kind: "SYSTEM", id: "worker-reality-gate" }, "Server bound the fixed task to the requested Worker", "WORKER_SMOKE_MATCHED");
      current = this.transitionUnsafe(current, "AWAITING_PROVIDER", { kind: "SYSTEM", id: "worker-reality-gate" }, "Server prepared the fixed assignment", "WORKER_SMOKE_OFFERED");

      const assignmentId = randomUUID();
      this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,'ACCEPTED',0,0,0,?,?,?)").run(
        assignmentId,
        task.id,
        agent.id,
        worker.providerId,
        worker.id,
        timestamp,
        timestamp,
        timestamp,
      );
      this.transitionUnsafe(current, "ASSIGNED", { kind: "ADMIN", id: "worker-reality-gate" }, "Server accepted the non-billable fixed smoke assignment", "WORKER_SMOKE_ASSIGNED");
      const jobRunId = randomUUID();
      this.db.prepare("INSERT INTO job_runs(id,task_id,assignment_id,worker_id,agent_id,status,executor,workflow_template,task_contract_version_id,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED','WORKER_SMOKE','WORKER_SMOKE_V1',?,?,?)").run(
        jobRunId,
        task.id,
        assignmentId,
        worker.id,
        agent.id,
        contract.id,
        timestamp,
        timestamp,
      );
      this.db.prepare("INSERT INTO job_run_attempts(job_run_id,attempt_number,supersedes_job_run_id,terminal_reason,lease_revoked_at,created_at,updated_at) VALUES(?,1,NULL,NULL,NULL,?,?)").run(
        jobRunId,
        timestamp,
        timestamp,
      );
      this.createPermissionLeaseForJob(jobRunId, workerSmokePermissionScope(), "worker-reality-gate");
      this.appendEvidenceLedgerEntry(jobRunId, "CONTRACT_LOCKED", "task_contract_version", contract.id, {
        contractVersion: contract.version,
        contractSha256: contract.contractSha256,
      }, contract.lockedAt ?? timestamp);
      this.appendJobEvent(jobRunId, "STATUS", "INFO", "Server queued WORKER_SMOKE_V1", { workerId });
      return this.getTaskAggregate(task.id);
    });
  }

  createRepositoryMaterializationTask(workerId: string): TaskAggregate {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker not found.");
      const capabilitySnapshot = this.getLatestWorkerCapabilitySnapshot(workerId);
      if (
        !capabilitySnapshot?.capabilities.gitAvailable ||
        !capabilitySnapshot.capabilities.executors.includes("repository-materializer")
      ) {
        throw new Error("Worker has not reported the real Git repository materializer capability.");
      }
      const agentRow = this.row(
        "SELECT * FROM agents WHERE provider_id=? ORDER BY created_at, id LIMIT 1",
        worker.providerId,
      );
      if (!agentRow) throw new Error("Worker provider has no server-owned Agent identity.");
      const agent = mapAgent(agentRow);
      const timestamp = now();
      const task: TaskRecord = {
        id: randomUUID(),
        customerId: CUSTOMER_ID,
        title: "Repository materialization reality gate",
        problemDescription: "Clone only the server allowlisted public fixture and produce repository metadata plus a cryptographic file manifest without executing repository code.",
        desiredOutcome: "Prove a real independent Worker can materialize the exact GitHub Remote, verify its commit independently, upload evidence, and clean its workspace.",
        repository: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        targetBranch: REPOSITORY_MATERIALIZATION_BRANCH,
        taskType: "REPOSITORY_MATERIALIZATION_V1",
        requiredSkills: [],
        requiredOperatingSystem: null,
        requiredTools: ["Node.js", "Git"],
        requiredMcpTools: [],
        budgetCents: 0,
        deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
        acceptanceChecks: [{
          id: "repository-manifest",
          type: "FILE_EXISTS",
          title: "A verified repository file manifest exists",
          required: true,
          path: "file-manifest.json",
        }],
        securitySensitivity: "LOW",
        allowCodeChanges: false,
        allowPullRequest: false,
        requiresHumanApproval: false,
        preferredAgentId: agent.id,
        status: "DRAFT",
        version: 0,
        analysis: {
          scopeSummary: "Clone the single server allowlisted public GitHub repository and hash its working-tree files without executing them.",
          requiredCapabilities: ["Node.js", "Git", "REPOSITORY_MATERIALIZE_V1"],
          suggestedTaskTemplate: "DIAGNOSE_REPOSITORY",
          riskLevel: "LOW",
          suggestedVerificationChecks: [{
            id: "repository-manifest",
            type: "FILE_EXISTS",
            title: "A verified repository file manifest exists",
            required: true,
            path: "file-manifest.json",
          }],
          suggestedBudgetCents: 0,
          estimatedDurationHours: 0.02,
        },
        matchedAgentId: agent.id,
        assignedWorkerId: worker.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.db.prepare("INSERT INTO tasks(id,customer_id,status,version,matched_agent_id,assigned_worker_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        task.id,
        task.customerId,
        task.status,
        task.version,
        agent.id,
        worker.id,
        JSON.stringify(task),
        timestamp,
        timestamp,
      );
      const contractDocument = repositoryMaterializationContract(task.id, 1);
      const { taskId: _taskId, contractVersion: _contractVersion, ...contractInput } = contractDocument;
      const draft = this.createTaskContractDraft(task.id, contractInput, "repository-reality-gate");
      const contract = this.lockTaskContract(draft.id, "repository-reality-gate");
      this.insertTaskEvent(task.id, null, "DRAFT", { kind: "SYSTEM", id: "repository-reality-gate" }, "Server created the fixed repository materialization Task", "REPOSITORY_MATERIALIZATION_CREATED");
      let current = this.transitionUnsafe(task, "PUBLISHED", { kind: "ADMIN", id: "repository-reality-gate" }, "Server published the fixed allowlisted repository definition", "REPOSITORY_MATERIALIZATION_PUBLISHED");
      current = this.transitionUnsafe(current, "ANALYZING", { kind: "SYSTEM", id: "repository-reality-gate" }, "Server validated the fixed workflow and repository policy", "REPOSITORY_MATERIALIZATION_ANALYZING");
      current = this.transitionUnsafe(current, "MATCHING", { kind: "SYSTEM", id: "repository-reality-gate" }, "Server selected the explicitly paired repository materializer capability", "REPOSITORY_MATERIALIZATION_MATCHING");
      current = this.transitionUnsafe(current, "MATCHED", { kind: "SYSTEM", id: "repository-reality-gate" }, "Server bound the fixed Task to the requested Worker", "REPOSITORY_MATERIALIZATION_MATCHED");
      current = this.transitionUnsafe(current, "AWAITING_PROVIDER", { kind: "SYSTEM", id: "repository-reality-gate" }, "Server prepared the non-billable fixed assignment", "REPOSITORY_MATERIALIZATION_OFFERED");

      const assignmentId = randomUUID();
      this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,'ACCEPTED',0,0,0,?,?,?)").run(
        assignmentId,
        task.id,
        agent.id,
        worker.providerId,
        worker.id,
        timestamp,
        timestamp,
        timestamp,
      );
      this.transitionUnsafe(current, "ASSIGNED", { kind: "ADMIN", id: "repository-reality-gate" }, "Server accepted the fixed repository materialization assignment", "REPOSITORY_MATERIALIZATION_ASSIGNED");
      const jobRunId = randomUUID();
      this.db.prepare("INSERT INTO job_runs(id,task_id,assignment_id,worker_id,agent_id,status,executor,workflow_template,task_contract_version_id,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED','REPOSITORY_MATERIALIZER','REPOSITORY_MATERIALIZE_V1',?,?,?)").run(
        jobRunId,
        task.id,
        assignmentId,
        worker.id,
        agent.id,
        contract.id,
        timestamp,
        timestamp,
      );
      this.db.prepare("INSERT INTO job_run_attempts(job_run_id,attempt_number,supersedes_job_run_id,terminal_reason,lease_revoked_at,created_at,updated_at) VALUES(?,1,NULL,NULL,NULL,?,?)").run(
        jobRunId,
        timestamp,
        timestamp,
      );
      this.createPermissionLeaseForJob(jobRunId, repositoryMaterializationPermissionScope(), "repository-reality-gate");
      this.appendEvidenceLedgerEntry(jobRunId, "CONTRACT_LOCKED", "task_contract_version", contract.id, {
        contractVersion: contract.version,
        contractSha256: contract.contractSha256,
      }, contract.lockedAt ?? timestamp);
      this.appendJobEvent(jobRunId, "STATUS", "INFO", "Server queued REPOSITORY_MATERIALIZE_V1", {
        workerId,
        remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        branch: REPOSITORY_MATERIALIZATION_BRANCH,
      });
      return this.getTaskAggregate(task.id);
    });
  }

  createManagedSandboxTask(
    workflow: typeof MANAGED_SANDBOX_SMOKE_WORKFLOW | typeof MANAGED_SANDBOX_TIMEOUT_WORKFLOW = MANAGED_SANDBOX_SMOKE_WORKFLOW,
  ): TaskAggregate {
    return this.transaction(() => {
      const { agent, worker } = this.ensureManagedExecutionIdentities();
      const timestamp = now();
      const smoke = workflow === MANAGED_SANDBOX_SMOKE_WORKFLOW;
      const task: TaskRecord = {
        id: randomUUID(),
        customerId: CUSTOMER_ID,
        title: smoke ? "Managed remote sandbox reality gate" : "Managed sandbox timeout probe",
        problemDescription: smoke
          ? "Run only the DoneLayer platform-controlled smoke program in a disposable Vercel Sandbox."
          : "Run only the DoneLayer platform-controlled timeout program in a disposable Vercel Sandbox.",
        desiredOutcome: managedSandboxContract("pending", 1, workflow).desiredOutcome,
        repository: "",
        targetBranch: "",
        taskType: workflow,
        requiredSkills: [],
        requiredOperatingSystem: null,
        requiredTools: ["Vercel Sandbox"],
        requiredMcpTools: [],
        budgetCents: 0,
        deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
        acceptanceChecks: smoke
          ? [{
              id: "managed-sandbox-proof",
              type: "FILE_EXISTS",
              title: "A verified managed sandbox proof exists",
              required: true,
              path: "managed-sandbox-proof.json",
            }]
          : [{
              id: "managed-sandbox-timeout",
              type: "COMMAND_EXIT",
              title: "The fixed command is timed out",
              required: true,
              commandId: "MANAGED_SANDBOX_TIMEOUT_PROBE_V1",
              allowedExitCodes: [124, 137],
            }],
        securitySensitivity: "LOW",
        allowCodeChanges: false,
        allowPullRequest: false,
        requiresHumanApproval: false,
        preferredAgentId: agent.id,
        status: "DRAFT",
        version: 0,
        analysis: {
          scopeSummary: smoke
            ? "Execute one fixed smoke command with deny-all networking in a non-persistent remote microVM."
            : "Execute one fixed blocking command and enforce a short real timeout plus cleanup.",
          requiredCapabilities: ["MANAGED_REMOTE_SANDBOX", "VERCEL_SANDBOX"],
          suggestedTaskTemplate: "LAUNCH_READINESS",
          riskLevel: "LOW",
          suggestedVerificationChecks: [],
          suggestedBudgetCents: 0,
          estimatedDurationHours: 0.02,
        },
        matchedAgentId: agent.id,
        assignedWorkerId: worker.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.db.prepare("INSERT INTO tasks(id,customer_id,status,version,matched_agent_id,assigned_worker_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        task.id, task.customerId, task.status, task.version, agent.id, worker.id, JSON.stringify(task), timestamp, timestamp,
      );
      const contractDocument = managedSandboxContract(task.id, 1, workflow);
      const { taskId: _taskId, contractVersion: _contractVersion, ...contractInput } = contractDocument;
      const draft = this.createTaskContractDraft(task.id, contractInput, "managed-sandbox-gate");
      const contract = this.lockTaskContract(draft.id, "managed-sandbox-gate");
      this.insertTaskEvent(task.id, null, "DRAFT", { kind: "SYSTEM", id: "managed-sandbox-gate" }, "Server created the fixed Managed Sandbox Task", "MANAGED_SANDBOX_TASK_CREATED");
      let current = this.transitionUnsafe(task, "PUBLISHED", { kind: "ADMIN", id: "managed-sandbox-gate" }, "Server published the fixed Managed Sandbox definition", "MANAGED_SANDBOX_TASK_PUBLISHED");
      current = this.transitionUnsafe(current, "ANALYZING", { kind: "SYSTEM", id: "managed-sandbox-gate" }, "Server validated the fixed Managed Sandbox policy", "MANAGED_SANDBOX_TASK_ANALYZING");
      current = this.transitionUnsafe(current, "MATCHING", { kind: "SYSTEM", id: "managed-sandbox-gate" }, "Server selected the Platform Managed Execution Node", "MANAGED_SANDBOX_TASK_MATCHING");
      current = this.transitionUnsafe(current, "MATCHED", { kind: "SYSTEM", id: "managed-sandbox-gate" }, "Server bound the Task to platform-managed orchestration", "MANAGED_SANDBOX_TASK_MATCHED");
      current = this.transitionUnsafe(current, "AWAITING_PROVIDER", { kind: "SYSTEM", id: "managed-sandbox-gate" }, "Server prepared the non-billable fixed assignment", "MANAGED_SANDBOX_TASK_OFFERED");
      const assignmentId = randomUUID();
      this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,'ACCEPTED',0,0,0,?,?,?)").run(
        assignmentId, task.id, agent.id, MANAGED_PROVIDER_ID, worker.id, timestamp, timestamp, timestamp,
      );
      this.transitionUnsafe(current, "ASSIGNED", { kind: "ADMIN", id: "managed-sandbox-gate" }, "Server accepted the fixed platform-managed assignment", "MANAGED_SANDBOX_TASK_ASSIGNED");
      const jobRunId = randomUUID();
      this.db.prepare("INSERT INTO job_runs(id,task_id,assignment_id,worker_id,agent_id,status,executor,workflow_template,execution_backend_type,task_contract_version_id,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED','MANAGED_SANDBOX',?,'MANAGED_REMOTE_SANDBOX',?,?,?)").run(
        jobRunId, task.id, assignmentId, worker.id, agent.id, workflow, contract.id, timestamp, timestamp,
      );
      this.db.prepare("INSERT INTO job_run_attempts(job_run_id,attempt_number,supersedes_job_run_id,terminal_reason,lease_revoked_at,created_at,updated_at) VALUES(?,1,NULL,NULL,NULL,?,?)").run(jobRunId, timestamp, timestamp);
      this.createPermissionLeaseForJob(
        jobRunId,
        smoke ? managedSandboxPermissionScope() : managedSandboxTimeoutPermissionScope(),
        "managed-sandbox-gate",
      );
      this.appendEvidenceLedgerEntry(jobRunId, "CONTRACT_LOCKED", "task_contract_version", contract.id, {
        contractVersion: contract.version,
        contractSha256: contract.contractSha256,
        executionBackendType: MANAGED_SANDBOX_EXECUTION_BACKEND,
      }, contract.lockedAt ?? timestamp);
      const sandboxRunId = randomUUID();
      const scope = smoke ? managedSandboxPermissionScope() : managedSandboxTimeoutPermissionScope();
      this.db.prepare("INSERT INTO managed_sandbox_runs(id,job_run_id,provider,provider_sandbox_id,provider_request_id,execution_backend_type,isolation_model,lifecycle_mode,status,region,runtime,network_policy_json,limits_json,provider_metadata_json,created_at,started_at,finished_at,stopped_at,destroyed_at,cleanup_verified_at,failure_code,failure_message,updated_at) VALUES(?,?,?,NULL,NULL,?,?,?,'REQUESTED',NULL,?,'{\"mode\":\"deny-all\",\"allowedDomains\":[],\"allowedCidrs\":[]}',?,'{}',?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?)").run(
        sandboxRunId,
        jobRunId,
        MANAGED_SANDBOX_PROVIDER,
        MANAGED_SANDBOX_EXECUTION_BACKEND,
        MANAGED_SANDBOX_ISOLATION_MODEL,
        MANAGED_SANDBOX_LIFECYCLE_MODE,
        MANAGED_SANDBOX_RUNTIME,
        canonicalJson({
          maxSandboxes: scope.maxSandboxes,
          maxRuntimeSeconds: scope.maxRuntimeSeconds,
          maxCommands: scope.maxCommands,
          maxArtifactBytes: scope.maxArtifactBytes,
          maxStdoutBytes: scope.maxStdoutBytes,
          maxStderrBytes: scope.maxStderrBytes,
          persistence: scope.persistence,
        }),
        timestamp,
        timestamp,
      );
      this.appendJobEvent(jobRunId, "STATUS", "INFO", `Server queued ${workflow}`, {
        executionBackendType: MANAGED_SANDBOX_EXECUTION_BACKEND,
        sandboxRunId,
      });
      return this.getTaskAggregate(task.id);
    });
  }

  createManagedBuildTestTask(sourceInput: ManagedBuildTestSourceIdentity): TaskAggregate {
    return this.transaction(() => {
      const source = validateManagedBuildTestSourceIdentity(sourceInput);
      const { agent, worker } = this.ensureManagedBuildTestExecutionIdentities();
      const timestamp = now();
      const task: TaskRecord = {
        id: randomUUID(),
        customerId: CUSTOMER_ID,
        title: "Real build and test in managed sandbox gate",
        problemDescription: "Execute the exact independently verified fixture commit in one non-persistent Vercel Sandbox and preserve the intentional test failure as real evidence.",
        desiredOutcome: managedBuildTestContract("pending", 1, source).desiredOutcome,
        repository: source.remoteUrl,
        targetBranch: source.branch,
        taskType: REAL_BUILD_TEST_MANAGED_SANDBOX_TASK_TYPE,
        requiredSkills: ["Node.js build and test verification"],
        requiredOperatingSystem: "LINUX",
        requiredTools: ["Vercel Sandbox", "Node.js", "npm"],
        requiredMcpTools: [],
        budgetCents: 0,
        deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
        acceptanceChecks: [{
          id: "failed-build-test-receipt",
          type: "GITHUB_CHECK",
          title: "A hash-verifiable FAILED build/test Receipt exists",
          required: true,
          checkName: "failed-build-test-receipt",
        }],
        securitySensitivity: "MEDIUM",
        allowCodeChanges: false,
        allowPullRequest: false,
        requiresHumanApproval: false,
        preferredAgentId: agent.id,
        status: "DRAFT",
        version: 0,
        analysis: {
          scopeSummary: "Install, build, and test only the exact verified fixture commit in a managed remote microVM; do not repair source.",
          requiredCapabilities: ["MANAGED_REMOTE_SANDBOX", "VERCEL_SANDBOX", NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW],
          suggestedTaskTemplate: "LAUNCH_READINESS",
          riskLevel: "MEDIUM",
          suggestedVerificationChecks: [],
          suggestedBudgetCents: 0,
          estimatedDurationHours: 0.08,
        },
        matchedAgentId: agent.id,
        assignedWorkerId: worker.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.db.prepare("INSERT INTO tasks(id,customer_id,status,version,matched_agent_id,assigned_worker_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        task.id, task.customerId, task.status, task.version, agent.id, worker.id, JSON.stringify(task), timestamp, timestamp,
      );
      const contractDocument = managedBuildTestContract(task.id, 1, source);
      const { taskId: _taskId, contractVersion: _contractVersion, ...contractInput } = contractDocument;
      const draft = this.createTaskContractDraft(task.id, contractInput, "managed-build-test-gate");
      const contract = this.lockTaskContract(draft.id, "managed-build-test-gate");
      this.insertTaskEvent(task.id, null, "DRAFT", { kind: "SYSTEM", id: "managed-build-test-gate" }, "Server created the fixed real build/test Task", "MANAGED_BUILD_TEST_TASK_CREATED");
      let current = this.transitionUnsafe(task, "PUBLISHED", { kind: "ADMIN", id: "managed-build-test-gate" }, "Server published the exact verified Fixture identity", "MANAGED_BUILD_TEST_TASK_PUBLISHED");
      current = this.transitionUnsafe(current, "ANALYZING", { kind: "SYSTEM", id: "managed-build-test-gate" }, "Server validated the Source Package and fixed workflow", "MANAGED_BUILD_TEST_TASK_ANALYZING");
      current = this.transitionUnsafe(current, "MATCHING", { kind: "SYSTEM", id: "managed-build-test-gate" }, "Server selected the Platform Managed Execution Node", "MANAGED_BUILD_TEST_TASK_MATCHING");
      current = this.transitionUnsafe(current, "MATCHED", { kind: "SYSTEM", id: "managed-build-test-gate" }, "Server bound the Task to the fixed managed execution capability", "MANAGED_BUILD_TEST_TASK_MATCHED");
      current = this.transitionUnsafe(current, "AWAITING_PROVIDER", { kind: "SYSTEM", id: "managed-build-test-gate" }, "Server prepared the zero-dollar Test Ledger assignment", "MANAGED_BUILD_TEST_TASK_OFFERED");
      const assignmentId = randomUUID();
      this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,'ACCEPTED',0,0,0,?,?,?)").run(
        assignmentId, task.id, agent.id, MANAGED_PROVIDER_ID, worker.id, timestamp, timestamp, timestamp,
      );
      this.transitionUnsafe(current, "ASSIGNED", { kind: "ADMIN", id: "managed-build-test-gate" }, "Server accepted the fixed non-billable managed assignment", "MANAGED_BUILD_TEST_TASK_ASSIGNED");
      const jobRunId = randomUUID();
      this.db.prepare("INSERT INTO job_runs(id,task_id,assignment_id,worker_id,agent_id,status,executor,workflow_template,execution_backend_type,task_contract_version_id,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED','MANAGED_SANDBOX',?,'MANAGED_REMOTE_SANDBOX',?,?,?)").run(
        jobRunId, task.id, assignmentId, worker.id, agent.id, NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW, contract.id, timestamp, timestamp,
      );
      this.db.prepare("INSERT INTO job_run_attempts(job_run_id,attempt_number,supersedes_job_run_id,terminal_reason,lease_revoked_at,created_at,updated_at) VALUES(?,1,NULL,NULL,NULL,?,?)").run(jobRunId, timestamp, timestamp);
      const scope = managedSandboxBuildTestPermissionScope(source.commitSha, source.buildScriptPresent);
      this.createPermissionLeaseForJob(jobRunId, scope, "managed-build-test-gate");
      this.appendEvidenceLedgerEntry(jobRunId, "CONTRACT_LOCKED", "task_contract_version", contract.id, {
        contractVersion: contract.version,
        contractSha256: contract.contractSha256,
        executionBackendType: MANAGED_SANDBOX_EXECUTION_BACKEND,
        allowedCommitSha: source.commitSha,
      }, contract.lockedAt ?? timestamp);
      const sandboxRunId = randomUUID();
      this.db.prepare("INSERT INTO managed_sandbox_runs(id,job_run_id,provider,provider_sandbox_id,provider_request_id,execution_backend_type,isolation_model,lifecycle_mode,status,region,runtime,network_policy_json,limits_json,provider_metadata_json,created_at,started_at,finished_at,stopped_at,destroyed_at,cleanup_verified_at,failure_code,failure_message,updated_at) VALUES(?,?,?,NULL,NULL,?,?,?,'REQUESTED',NULL,?,?,?, ?,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?)").run(
        sandboxRunId,
        jobRunId,
        MANAGED_SANDBOX_PROVIDER,
        MANAGED_SANDBOX_EXECUTION_BACKEND,
        MANAGED_SANDBOX_ISOLATION_MODEL,
        MANAGED_SANDBOX_LIFECYCLE_MODE,
        MANAGED_SANDBOX_RUNTIME,
        canonicalJson({ mode: "deny-all", allowedDomains: [], allowedCidrs: [], installAllowedDomains: ["registry.npmjs.org"] }),
        canonicalJson({
          maxSandboxes: scope.maxSandboxes,
          maxRuntimeSeconds: scope.maxRuntimeSeconds,
          maxCommands: scope.maxCommands,
          maxArtifactBytes: scope.maxArtifactBytes,
          maxStdoutBytes: scope.maxStdoutBytes,
          maxStderrBytes: scope.maxStderrBytes,
          persistence: scope.persistence,
        }),
        canonicalJson({ source }),
        timestamp,
        timestamp,
      );
      this.appendJobEvent(jobRunId, "STATUS", "INFO", `Server queued ${NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW}`, {
        executionBackendType: MANAGED_SANDBOX_EXECUTION_BACKEND,
        sandboxRunId,
        commitSha: source.commitSha,
      });
      return this.getTaskAggregate(task.id);
    });
  }

  getManagedSandboxRun(id: string): ManagedSandboxRunRecord | null {
    const row = this.row("SELECT * FROM managed_sandbox_runs WHERE id=?", id);
    return row ? mapManagedSandboxRun(row) : null;
  }

  getManagedSandboxRunForJob(jobRunId: string): ManagedSandboxRunRecord | null {
    const row = this.row("SELECT * FROM managed_sandbox_runs WHERE job_run_id=?", jobRunId);
    return row ? mapManagedSandboxRun(row) : null;
  }

  listManagedSandboxRuns(): ManagedSandboxRunRecord[] {
    return this.rows("SELECT * FROM managed_sandbox_runs ORDER BY created_at,rowid").map(mapManagedSandboxRun);
  }

  startManagedSandboxJob(jobRunId: string): {
    task: TaskRecord;
    job: JobRunRecord;
    permission: PermissionLeaseRecord;
    run: ManagedSandboxRunRecord;
  } {
    return this.transaction(() => {
      const job = this.getJobRun(jobRunId);
      if (!job || job.executor !== "MANAGED_SANDBOX" || job.status !== "QUEUED") throw new Error("Managed Sandbox Job is not queued");
      const run = this.getManagedSandboxRunForJob(jobRunId);
      if (!run || run.status !== "REQUESTED") throw new Error("Managed Sandbox Run is not requested");
      const timestamp = now();
      const permission = this.activatePermissionLeaseForJob(jobRunId, timestamp);
      this.db.prepare("UPDATE job_runs SET status='RUNNING',started_at=?,updated_at=? WHERE id=? AND status='QUEUED'").run(timestamp, timestamp, job.id);
      this.db.prepare("UPDATE managed_sandbox_runs SET status='CREATING',updated_at=? WHERE id=? AND status='REQUESTED'").run(timestamp, run.id);
      if (job.workflowTemplate === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW) {
        const source = validateManagedBuildTestSourceIdentity(
          run.providerMetadata.source as ManagedBuildTestSourceIdentity,
        );
        this.appendEvidenceLedgerEntry(job.id, "REPOSITORY_VERIFIED", "managed_sandbox_run", run.id, {
          remoteUrl: source.remoteUrl,
          branch: source.branch,
          materializerCommitSha: source.commitSha,
          independentRemoteCommitSha: source.independentRemoteCommitSha,
          exactMatch: true,
        }, timestamp);
        this.appendEvidenceLedgerEntry(job.id, "SOURCE_PACKAGE_CREATED", "managed_sandbox_run", run.id, {
          fileCount: source.fileCount,
          sourcePackageBytes: source.sourcePackageBytes,
          manifestSha256: source.manifestSha256,
          sourcePackageManifestSha256: source.sourcePackageManifestSha256,
          sourcePackageSha256: source.sourcePackageSha256,
          materializerWorkspaceCleaned: true,
        }, timestamp);
        this.appendEvidenceLedgerEntry(job.id, "SOURCE_PACKAGE_VERIFIED", "managed_sandbox_run", run.id, {
          commitSha: source.commitSha,
          sourcePackageManifestSha256: source.sourcePackageManifestSha256,
          sourcePackageSha256: source.sourcePackageSha256,
          serverVerifiedBeforeExecution: true,
        }, timestamp);
      }
      this.appendEvidenceLedgerEntry(job.id, "MANAGED_SANDBOX_REQUESTED", "managed_sandbox_run", run.id, {
        provider: run.provider,
        executionBackendType: run.executionBackendType,
        isolationModel: run.isolationModel,
        lifecycleMode: run.lifecycleMode,
      }, timestamp);
      this.appendJobEvent(job.id, "STATUS", "INFO", "Server-side Orchestrator requested a Managed Sandbox", { sandboxRunId: run.id, provider: run.provider });
      const task = this.getTask(job.taskId);
      if (!task) throw new Error("Managed Sandbox Task not found");
      const runningTask = this.transitionUnsafe(task, "RUNNING", { kind: "SYSTEM", id: "managed-sandbox-orchestrator" }, "Server-side Orchestrator started managed execution", "MANAGED_SANDBOX_JOB_STARTED");
      return { task: runningTask, job: this.getJobRun(job.id)!, permission, run: this.getManagedSandboxRun(run.id)! };
    });
  }

  markManagedSandboxCreated(input: {
    runId: string;
    providerSandboxId: string;
    providerRequestId: string | null;
    region: string | null;
    inspection: Record<string, unknown>;
    providerMetadata: Record<string, unknown>;
  }): ManagedSandboxRunRecord {
    return this.transaction(() => {
      const run = this.requiredManagedSandboxRun(input.runId, "CREATING");
      const job = this.getJobRun(run.jobRunId)!;
      if (!input.providerSandboxId.trim()) throw new Error("Provider Sandbox ID is required");
      const timestamp = now();
      this.db.prepare("UPDATE managed_sandbox_runs SET provider_sandbox_id=?,provider_request_id=?,region=?,provider_metadata_json=?,status='READY',updated_at=? WHERE id=? AND status='CREATING'").run(
        input.providerSandboxId,
        input.providerRequestId,
        input.region,
        canonicalJson({ ...run.providerMetadata, ...input.providerMetadata, createInspection: input.inspection }),
        timestamp,
        run.id,
      );
      this.appendEvidenceLedgerEntry(job.id, "MANAGED_SANDBOX_CREATED", "managed_sandbox_run", run.id, {
        providerSandboxId: input.providerSandboxId,
        providerRequestId: input.providerRequestId,
        region: input.region,
      }, timestamp);
      this.appendJobEvent(job.id, "STATUS", "SUCCESS", "Vercel Sandbox was created", { sandboxRunId: run.id, providerSandboxId: input.providerSandboxId, region: input.region });
      return this.getManagedSandboxRun(run.id)!;
    });
  }

  markManagedSandboxPolicyVerified(runId: string, policy: Record<string, unknown>): ManagedSandboxRunRecord {
    return this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "READY");
      const permission = this.assertPermissionLeaseActive(run.jobRunId, MANAGED_EXECUTION_NODE_ID);
      const timestamp = now();
      this.db.prepare("UPDATE managed_sandbox_runs SET status='RUNNING',started_at=?,network_policy_json=?,updated_at=? WHERE id=? AND status='READY'").run(
        timestamp, canonicalJson(policy), timestamp, run.id,
      );
      this.appendEvidenceLedgerEntry(run.jobRunId, "MANAGED_SANDBOX_POLICY_VERIFIED", "managed_sandbox_run", run.id, { policy, permissionLeaseId: permission.id }, timestamp);
      this.appendEvidenceLedgerEntry(run.jobRunId, "MANAGED_SANDBOX_STARTED", "managed_sandbox_run", run.id, { providerSandboxId: run.providerSandboxId, startedAt: timestamp }, timestamp);
      this.appendEvidenceLedgerEntry(run.jobRunId, "EXECUTION_STARTED", "managed_sandbox_run", run.id, { workflow: this.getJobRun(run.jobRunId)!.workflowTemplate }, timestamp);
      this.appendJobEvent(run.jobRunId, "STATUS", "SUCCESS", "Managed Sandbox policy was verified before execution", { policy });
      return this.getManagedSandboxRun(run.id)!;
    });
  }

  recordManagedSandboxNetworkProbe(runId: string, proof: Record<string, unknown>): void {
    this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "RUNNING");
      this.assertPermissionLeaseActive(run.jobRunId, MANAGED_EXECUTION_NODE_ID);
      const probe = proof.networkProbe as Record<string, unknown> | undefined;
      if (probe?.blocked !== true) throw new Error("Managed Sandbox network probe was not blocked");
      const timestamp = now();
      this.appendEvidenceLedgerEntry(run.jobRunId, "NETWORK_PROBE_COMPLETED", "managed_sandbox_run", run.id, { blocked: true, outcome: probe.outcome }, timestamp);
      this.appendJobEvent(run.jobRunId, "EVIDENCE", "SUCCESS", "Provider-enforced deny-all network probe was blocked", { blocked: true });
    });
  }

  recordManagedBuildTestSourceUploaded(runId: string, verification: {
    commitSha: string;
    manifestSha256: string;
    sourcePackageManifestSha256: string;
    sourcePackageSha256: string;
    packageVerified: boolean;
    manifestVerified: boolean;
    commitVerified: boolean;
    extracted: boolean;
    nodeVersion: string;
    npmVersion: string;
    buildScriptPresent: boolean;
  }): void {
    this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "RUNNING");
      const job = this.getJobRun(run.jobRunId)!;
      if (job.workflowTemplate !== NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW) {
        throw new Error("Source Package Evidence is limited to the build/test workflow");
      }
      this.assertPermissionLeaseActive(job.id, MANAGED_EXECUTION_NODE_ID);
      const source = validateManagedBuildTestSourceIdentity(
        run.providerMetadata.source as ManagedBuildTestSourceIdentity,
      );
      if (
        verification.commitSha !== source.commitSha ||
        verification.manifestSha256 !== source.manifestSha256 ||
        verification.sourcePackageManifestSha256 !== source.sourcePackageManifestSha256 ||
        verification.sourcePackageSha256 !== source.sourcePackageSha256 ||
        verification.packageVerified !== true ||
        verification.manifestVerified !== true ||
        verification.commitVerified !== true ||
        verification.extracted !== true ||
        verification.buildScriptPresent !== source.buildScriptPresent ||
        !/^v24\./.test(verification.nodeVersion) ||
        !/^\d+\.\d+\.\d+/.test(verification.npmVersion)
      ) {
        throw new Error("Sandbox Source Package verification does not match the locked source identity");
      }
      const timestamp = now();
      this.appendEvidenceLedgerEntry(job.id, "SOURCE_PACKAGE_UPLOADED", "managed_sandbox_run", run.id, {
        sourcePackageSha256: source.sourcePackageSha256,
        providerSandboxId: run.providerSandboxId,
      }, timestamp);
      this.appendEvidenceLedgerEntry(job.id, "SOURCE_MANIFEST_VERIFIED", "managed_sandbox_run", run.id, {
        commitSha: source.commitSha,
        manifestSha256: source.manifestSha256,
        sourcePackageManifestSha256: source.sourcePackageManifestSha256,
        nodeVersion: verification.nodeVersion,
        npmVersion: verification.npmVersion,
      }, timestamp);
      this.appendJobEvent(job.id, "EVIDENCE", "SUCCESS", "Sandbox verified and extracted the exact Source Package", {
        commitSha: source.commitSha,
        sourcePackageSha256: source.sourcePackageSha256,
      });
    });
  }

  recordManagedBuildTestNetworkPolicy(runId: string, input: {
    phase: "INSTALL" | "FINAL";
    mode: "custom" | "deny-all";
    allowedDomains: string[];
    allowedCidrs: string[];
    observedAt: string;
  }): void {
    this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "RUNNING");
      const job = this.getJobRun(run.jobRunId)!;
      if (job.workflowTemplate !== NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW) {
        throw new Error("Staged network policy is limited to the build/test workflow");
      }
      this.assertPermissionLeaseActive(job.id, MANAGED_EXECUTION_NODE_ID);
      const expected = input.phase === "INSTALL"
        ? { mode: "custom", allowedDomains: ["registry.npmjs.org"], allowedCidrs: [] }
        : { mode: "deny-all", allowedDomains: [], allowedCidrs: [] };
      if (
        input.mode !== expected.mode ||
        JSON.stringify(input.allowedDomains) !== JSON.stringify(expected.allowedDomains) ||
        JSON.stringify(input.allowedCidrs) !== JSON.stringify(expected.allowedCidrs) ||
        !Number.isFinite(Date.parse(input.observedAt))
      ) {
        throw new Error("Observed network policy does not match the locked phase policy");
      }
      this.db.prepare("UPDATE managed_sandbox_runs SET network_policy_json=json_set(network_policy_json,?,json(?)),updated_at=? WHERE id=?").run(
        input.phase === "INSTALL" ? "$.install" : "$.final",
        canonicalJson({ mode: input.mode, allowedDomains: input.allowedDomains, allowedCidrs: input.allowedCidrs, observedAt: input.observedAt }),
        input.observedAt,
        run.id,
      );
      this.appendEvidenceLedgerEntry(job.id, "NETWORK_POLICY_UPDATED", "managed_sandbox_run", run.id, {
        phase: input.phase,
        mode: input.mode,
        allowedDomains: input.allowedDomains,
        allowedCidrs: input.allowedCidrs,
      }, input.observedAt);
    });
  }

  recordManagedBuildTestCommand(runId: string, input: {
    phase: "install" | "build" | "test";
    command: string;
    exitCode: number;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  }): void {
    this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "RUNNING");
      const job = this.getJobRun(run.jobRunId)!;
      if (job.workflowTemplate !== NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW) {
        throw new Error("Build/Test command Evidence is limited to the build/test workflow");
      }
      this.assertPermissionLeaseActive(job.id, MANAGED_EXECUTION_NODE_ID);
      const expectedCommand = input.phase === "install"
        ? "npm ci --ignore-scripts --no-audit --no-fund"
        : input.phase === "build"
          ? "npm run build"
          : "npm test";
      if (
        input.command !== expectedCommand ||
        !Number.isInteger(input.exitCode) ||
        !Number.isFinite(Date.parse(input.startedAt)) ||
        !Number.isFinite(Date.parse(input.finishedAt)) ||
        Date.parse(input.finishedAt) < Date.parse(input.startedAt) ||
        !Number.isSafeInteger(input.durationMs) ||
        input.durationMs < 0
      ) {
        throw new Error("Build/Test command Evidence is invalid");
      }
      const startType: EvidenceLedgerEntryType = input.phase === "install"
        ? "DEPENDENCY_INSTALL_STARTED"
        : input.phase === "build"
          ? "BUILD_STARTED"
          : "TEST_STARTED";
      const finishType: EvidenceLedgerEntryType = input.phase === "install"
        ? "DEPENDENCY_INSTALL_COMPLETED"
        : input.phase === "build"
          ? "BUILD_COMPLETED"
          : "TEST_FAILED";
      if ((input.phase === "install" || input.phase === "build") && input.exitCode !== 0) {
        throw new Error(`${expectedCommand} did not succeed`);
      }
      if (input.phase === "test" && input.exitCode === 0) {
        throw new Error("The intentionally broken fixture unexpectedly passed its tests");
      }
      this.appendEvidenceLedgerEntry(job.id, startType, "managed_sandbox_run", run.id, {
        command: expectedCommand,
        startedAt: input.startedAt,
      }, input.startedAt);
      this.appendEvidenceLedgerEntry(job.id, finishType, "managed_sandbox_run", run.id, {
        command: expectedCommand,
        exitCode: input.exitCode,
        finishedAt: input.finishedAt,
        durationMs: input.durationMs,
      }, input.finishedAt);
      if (input.phase === "test") {
        this.db.prepare("UPDATE managed_sandbox_runs SET failure_code='TEST_FAILED',failure_message='Required automated tests exited non-zero',updated_at=? WHERE id=? AND status='RUNNING'").run(
          input.finishedAt,
          run.id,
        );
      }
    });
  }

  recordManagedBuildTestSourceIntegrity(runId: string, input: {
    commitSha: string;
    manifestSha256: string;
    checkedFileCount: number;
    sourceMutationDetected: boolean;
    missing: string[];
    modified: string[];
    added: string[];
    verifiedAt: string;
  }): void {
    this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "RUNNING");
      const job = this.getJobRun(run.jobRunId)!;
      const source = validateManagedBuildTestSourceIdentity(
        run.providerMetadata.source as ManagedBuildTestSourceIdentity,
      );
      this.assertPermissionLeaseActive(job.id, MANAGED_EXECUTION_NODE_ID);
      if (
        job.workflowTemplate !== NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW ||
        input.commitSha !== source.commitSha ||
        input.manifestSha256 !== source.manifestSha256 ||
        input.checkedFileCount !== source.fileCount ||
        input.sourceMutationDetected !== false ||
        input.missing.length !== 0 ||
        input.modified.length !== 0 ||
        input.added.length !== 0 ||
        !Number.isFinite(Date.parse(input.verifiedAt))
      ) {
        throw new Error("SOURCE_MUTATION_DETECTED: post-execution Source Manifest differs");
      }
      this.appendEvidenceLedgerEntry(job.id, "SOURCE_INTEGRITY_VERIFIED", "managed_sandbox_run", run.id, {
        commitSha: input.commitSha,
        manifestSha256: input.manifestSha256,
        checkedFileCount: input.checkedFileCount,
        sourceMutationDetected: false,
      }, input.verifiedAt);
    });
  }

  persistManagedSandboxArtifact(input: {
    runId: string;
    artifactType: string;
    fileName: string;
    mimeType: "application/json" | "text/plain";
    content: Buffer;
    claimedSha256: string;
  }): EvidenceArtifactRecord {
    return this.transaction(() => {
      const run = this.getManagedSandboxRun(input.runId);
      if (!run || !["RUNNING", "STOPPED", "DESTROYED"].includes(run.status)) throw new Error("Managed Sandbox Run cannot accept artifacts");
      const job = this.getJobRun(run.jobRunId);
      if (!job) throw new Error("Managed Sandbox Job not found");
      const permission = this.assertPermissionLeaseActive(job.id, MANAGED_EXECUTION_NODE_ID);
      const allowedArtifacts = job.workflowTemplate === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW
        ? MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS as readonly string[]
        : MANAGED_SANDBOX_ARTIFACTS as readonly string[];
      if (!allowedArtifacts.includes(input.fileName)) throw new Error("Managed Sandbox artifact filename is not allowlisted");
      const size = input.content.byteLength;
      if (size < 1 || size > permission.scope.maxArtifactBytes) throw new Error("Managed Sandbox artifact size is invalid");
      const serverSha256 = createHash("sha256").update(input.content).digest("hex");
      if (!safeEqualHex(serverSha256, input.claimedSha256)) throw new Error("Managed Sandbox artifact SHA-256 mismatch");
      const timestamp = now();
      const artifactId = randomUUID();
      const content = input.content.toString("utf8");
      this.db.prepare("INSERT INTO evidence_artifacts(id,task_id,worker_id,job_run_id,artifact_type,file_name,mime_type,size,sha256,storage_path,content,claimed_sha256,server_sha256,sandbox_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        artifactId,
        job.taskId,
        MANAGED_EXECUTION_NODE_ID,
        job.id,
        input.artifactType,
        input.fileName,
        input.mimeType,
        size,
        serverSha256,
        `managed-sandbox://${run.id}/${artifactId}/${input.fileName}`,
        content,
        input.claimedSha256,
        serverSha256,
        run.id,
        timestamp,
        timestamp,
      );
      const evidence = { artifactId, sandboxRunId: run.id, fileName: input.fileName, mimeType: input.mimeType, size, claimedSha256: input.claimedSha256, serverSha256 };
      this.appendEvidenceLedgerEntry(job.id, "ARTIFACT_CREATED", "evidence_artifact", artifactId, evidence, timestamp);
      this.appendEvidenceLedgerEntry(job.id, "ARTIFACT_UPLOADED", "evidence_artifact", artifactId, evidence, timestamp);
      this.appendEvidenceLedgerEntry(job.id, "ARTIFACT_HASH_VERIFIED", "evidence_artifact", artifactId, evidence, timestamp);
      this.appendJobEvent(job.id, "EVIDENCE", "SUCCESS", "Server persisted and rehashed a Managed Sandbox Artifact", evidence);
      const artifact = this.row("SELECT * FROM evidence_artifacts WHERE id=?", artifactId);
      return mapArtifact(artifact!);
    });
  }

  markManagedSandboxStopRequested(runId: string, requestedAt: string): void {
    this.transaction(() => {
      const run = this.getManagedSandboxRun(runId);
      if (!run || !["CREATING", "READY", "RUNNING", "TIMED_OUT", "FAILED"].includes(run.status)) throw new Error("Managed Sandbox cannot be stopped from its current state");
      this.appendEvidenceLedgerEntry(run.jobRunId, "MANAGED_SANDBOX_STOP_REQUESTED", "managed_sandbox_run", run.id, { requestedAt }, requestedAt);
      this.appendJobEvent(run.jobRunId, "STATUS", "INFO", "Orchestrator requested Sandbox stop", { requestedAt });
    });
  }

  markManagedSandboxStopped(runId: string, input: {
    stopConfirmedAt: string;
    finalProviderState: string;
    cleanupVerified: boolean;
    persistent: boolean;
    snapshotCreated: boolean;
    stillRunning: boolean;
  }): ManagedSandboxRunRecord {
    return this.transaction(() => {
      const run = this.getManagedSandboxRun(runId);
      if (!run) throw new Error("Managed Sandbox Run not found");
      const clean = input.cleanupVerified && !input.stillRunning && !input.persistent && !input.snapshotCreated;
      const status: ManagedSandboxRunStatus = clean ? "DESTROYED" : "CLEANUP_UNVERIFIED";
      this.db.prepare("UPDATE managed_sandbox_runs SET status=?,finished_at=COALESCE(finished_at,?),stopped_at=?,destroyed_at=?,cleanup_verified_at=?,failure_code=CASE WHEN ? THEN failure_code ELSE 'CLEANUP_UNVERIFIED' END,failure_message=CASE WHEN ? THEN failure_message ELSE 'Provider lifecycle cleanup could not be verified' END,provider_metadata_json=json_set(provider_metadata_json,'$.finalProviderState',?),updated_at=? WHERE id=?").run(
        status,
        input.stopConfirmedAt,
        input.stopConfirmedAt,
        clean ? input.stopConfirmedAt : null,
        clean ? input.stopConfirmedAt : null,
        clean ? 1 : 0,
        clean ? 1 : 0,
        input.finalProviderState,
        input.stopConfirmedAt,
        run.id,
      );
      this.appendEvidenceLedgerEntry(run.jobRunId, "MANAGED_SANDBOX_STOPPED", "managed_sandbox_run", run.id, { stopConfirmedAt: input.stopConfirmedAt, finalProviderState: input.finalProviderState }, input.stopConfirmedAt);
      if (clean) {
        this.appendEvidenceLedgerEntry(run.jobRunId, "MANAGED_SANDBOX_CLEANUP_VERIFIED", "managed_sandbox_run", run.id, { cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false }, input.stopConfirmedAt);
      }
      this.appendJobEvent(run.jobRunId, "STATUS", clean ? "SUCCESS" : "ERROR", clean ? "Managed Sandbox cleanup was verified" : "Managed Sandbox cleanup could not be verified", { ...input });
      return this.getManagedSandboxRun(run.id)!;
    });
  }

  recordManagedSandboxTimeout(runId: string, timeoutAt: string, errorMessage: string): void {
    this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "RUNNING");
      this.db.prepare("UPDATE managed_sandbox_runs SET status='TIMED_OUT',finished_at=?,failure_code='TIMEOUT_TRIGGERED',failure_message=?,updated_at=? WHERE id=? AND status='RUNNING'").run(timeoutAt, errorMessage.slice(0, 1000), timeoutAt, run.id);
      this.appendEvidenceLedgerEntry(run.jobRunId, "TIMEOUT_TRIGGERED", "managed_sandbox_run", run.id, { timeoutAt, error: errorMessage.slice(0, 500) }, timeoutAt);
      this.appendJobEvent(run.jobRunId, "STATUS", "ERROR", "Managed Sandbox command timeout triggered", { timeoutAt });
    });
  }

  completeManagedSandboxTimeout(runId: string): TaskAggregate {
    return this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "DESTROYED");
      if (run.failureCode !== "TIMEOUT_TRIGGERED") throw new Error("Timeout evidence is missing");
      const job = this.getJobRun(run.jobRunId)!;
      const permission = this.getPermissionLeaseForJob(job.id);
      if (!permission || permission.status !== "ACTIVE" || permission.workerId !== MANAGED_EXECUTION_NODE_ID) {
        throw new Error("Timeout cleanup requires the original Managed Execution Permission Lease");
      }
      const timestamp = now();
      const completed = this.db.prepare("UPDATE permission_leases SET status='COMPLETED' WHERE id=? AND status='ACTIVE'").run(permission.id);
      if (Number(completed.changes) !== 1) throw new Error("Timeout Permission completion lost its state fence");
      this.db.prepare("UPDATE job_runs SET status='FAILED',ended_at=?,exit_code=NULL,updated_at=? WHERE id=? AND status='RUNNING'").run(timestamp, timestamp, job.id);
      this.db.prepare("UPDATE job_run_attempts SET terminal_reason='TIMED_OUT',lease_revoked_at=?,updated_at=? WHERE job_run_id=?").run(timestamp, timestamp, job.id);
      let task = this.getTask(job.taskId)!;
      task = this.transitionUnsafe(task, "SUBMITTED", { kind: "ADMIN", id: "managed-sandbox-orchestrator" }, "Orchestrator submitted real timeout and cleanup Evidence", "MANAGED_SANDBOX_TIMEOUT_SUBMITTED");
      task = this.transitionUnsafe(task, "VERIFYING", { kind: "SYSTEM", id: "managed-sandbox-verifier" }, "Server verified timeout lifecycle evidence", "MANAGED_SANDBOX_TIMEOUT_VERIFYING");
      this.appendEvidenceLedgerEntry(job.id, "VERIFICATION_FAILED", "managed_sandbox_run", run.id, { expectedTimeout: true, verifiedSuccessReceiptCreated: false }, timestamp);
      task = this.transitionUnsafe(task, "VERIFICATION_FAILED", { kind: "SYSTEM", id: "managed-sandbox-verifier" }, "Timeout probe correctly cannot produce a successful Receipt", "MANAGED_SANDBOX_TIMEOUT_VERIFIED");
      return this.getTaskAggregate(task.id);
    });
  }

  completeManagedSandboxSmoke(input: {
    runId: string;
    command: { exitCode: number; startedAt: string; finishedAt: string; durationMs: number };
  }): TaskAggregate {
    return this.transaction(() => {
      const run = this.requiredManagedSandboxRun(input.runId, "DESTROYED");
      const job = this.getJobRun(run.jobRunId);
      if (!job || job.workflowTemplate !== MANAGED_SANDBOX_SMOKE_WORKFLOW || job.status !== "RUNNING") {
        throw new Error("Managed Sandbox smoke Job is not running");
      }
      const task = this.getTask(job.taskId);
      const contract = job.taskContractVersionId ? this.getTaskContractVersion(job.taskContractVersionId) : null;
      const permission = this.assertPermissionLeaseActive(job.id, MANAGED_EXECUTION_NODE_ID);
      if (!task || !contract || contract.status !== "LOCKED") throw new Error("Managed Sandbox Contract binding is invalid");
      if (input.command.exitCode !== 0) throw new Error("Managed Sandbox smoke command did not exit successfully");
      const aggregate = this.getTaskAggregate(task.id);
      const artifacts = aggregate.evidence.filter((artifact) => artifact.sandboxRunId === run.id);
      const byName = new Map(artifacts.map((artifact) => [artifact.fileName, artifact]));
      for (const fileName of MANAGED_SANDBOX_ARTIFACTS) {
        if (!byName.has(fileName)) throw new Error(`Managed Sandbox Artifact ${fileName} is missing`);
      }
      const proofArtifact = byName.get("managed-sandbox-proof.json")!;
      if (!proofArtifact.claimedSha256 || !proofArtifact.serverSha256 || !safeEqualHex(proofArtifact.claimedSha256, proofArtifact.serverSha256)) {
        throw new Error("Managed Sandbox proof SHA-256 was not independently matched");
      }
      const proof = parseJson<Record<string, unknown>>(proofArtifact.content);
      const network = proof.networkProbe as Record<string, unknown> | undefined;
      const exposure = proof.localHostExposure as Record<string, unknown> | undefined;
      if (
        proof.jobId !== job.id ||
        proof.sandboxRunId !== run.id ||
        proof.provider !== MANAGED_SANDBOX_PROVIDER ||
        proof.platform !== "linux" ||
        proof.cwd !== "/vercel/sandbox" ||
        network?.blocked !== true ||
        exposure?.repositoryGitPresent !== false ||
        exposure?.repositoryAgentRulesPresent !== false ||
        exposure?.repositoryPackagePresent !== false ||
        exposure?.localEnvironmentFilePresent !== false ||
        exposure?.windowsDriveMountPresent !== false ||
        !Array.isArray(exposure?.credentialLikeEnvironmentNames) ||
        exposure.credentialLikeEnvironmentNames.length !== 0
      ) {
        throw new Error("Managed Sandbox proof failed isolation verification");
      }
      if (run.networkPolicy.mode !== "deny-all" || run.lifecycleMode !== "NON_PERSISTENT") {
        throw new Error("Managed Sandbox persisted policy is not fail-closed");
      }
      const violation = this.row("SELECT id FROM evidence_ledger_entries WHERE job_run_id=? AND entry_type='PERMISSION_VIOLATION' LIMIT 1", job.id);
      if (violation) throw new Error("Permission violation prevents a Managed Sandbox Receipt");
      const timestamp = now();
      this.db.prepare("UPDATE job_runs SET status='SUBMITTED',ended_at=?,exit_code=0,updated_at=? WHERE id=? AND status='RUNNING'").run(input.command.finishedAt, timestamp, job.id);
      let current = this.transitionUnsafe(task, "SUBMITTED", { kind: "ADMIN", id: "managed-sandbox-orchestrator" }, "Server-side Orchestrator submitted real remote Sandbox Evidence", "MANAGED_SANDBOX_SUBMITTED");
      current = this.transitionUnsafe(current, "VERIFYING", { kind: "SYSTEM", id: "managed-sandbox-verifier" }, "Server started Managed Sandbox policy, Artifact, lifecycle and Ledger verification", "MANAGED_SANDBOX_VERIFYING");
      const completed = this.db.prepare("UPDATE permission_leases SET status='COMPLETED' WHERE id=? AND status='ACTIVE'").run(permission.id);
      if (Number(completed.changes) !== 1) throw new Error("Managed Sandbox Permission completion lost its state fence");
      const completedPermission = this.getPermissionLease(permission.id)!;
      const preVerificationLedger = this.verifyLedgerChain(job.id);
      if (!preVerificationLedger.valid) throw new Error("Managed Sandbox Evidence Ledger is invalid before verification");
      const observed: Record<string, Record<string, unknown>> = {
        "provider-available": { provider: run.provider, available: true },
        "server-orchestrated": { orchestrator: "DONE_LAYER_SERVER", sandboxRunId: run.id },
        "remote-environment": { isolationModel: run.isolationModel, localHostExecutionUsed: false },
        "non-persistent": { lifecycleMode: run.lifecycleMode, persistent: false },
        "contract-locked": { contractId: contract.id, status: contract.status, sha256: contract.contractSha256 },
        "permission-active": { permissionLeaseId: completedPermission.id, status: completedPermission.status },
        "no-local-host": { localHostExecutionUsed: false },
        "no-local-docker": { localDockerUsed: false },
        "no-customer-code": { repository: null, uploadedFiles: [MANAGED_SANDBOX_SMOKE_FILE] },
        "no-platform-credentials": { credentialLikeEnvironmentNames: [] },
        "network-deny-all": { policy: run.networkPolicy.mode, allowedDomains: [], allowedCidrs: [] },
        "network-probe": { blocked: true, outcome: network.outcome },
        "smoke-executed": { command: "node", exitCode: input.command.exitCode, durationMs: input.command.durationMs },
        "provider-logs": { stdoutArtifactId: byName.get("managed-sandbox-stdout.log")!.id, stderrArtifactId: byName.get("managed-sandbox-stderr.log")!.id },
        "proof-created": { artifactId: proofArtifact.id, size: proofArtifact.size },
        "artifact-hash": { claimedSha256: proofArtifact.claimedSha256, serverSha256: proofArtifact.serverSha256, matched: true },
        "timeout-policy": { runtimeLimitSeconds: permission.scope.maxRuntimeSeconds },
        "sandbox-stopped": { cleanupVerified: true, finalProviderState: run.providerMetadata.finalProviderState },
        "no-snapshot": { persistentSnapshotCreated: false },
        "ledger-valid": { ...preVerificationLedger },
        "no-violation": { violationCount: 0 },
        "receipt-created": { receiptEligible: true },
      };
      for (const check of contract.contract.acceptanceChecks) {
        const value = observed[check.id];
        if (!value) throw new Error(`Unsupported Managed Sandbox check ${check.id}`);
        this.db.prepare("INSERT INTO verification_results(id,task_id,job_run_id,check_id,check_type,status,summary,observed_json,created_at,updated_at) VALUES(?,?,?,?,?,'PASSED',?,?,?,?)").run(
          randomUUID(), task.id, job.id, check.id, check.type, check.label, canonicalJson(value), timestamp, timestamp,
        );
      }
      const verificationResults = this.rows("SELECT * FROM verification_results WHERE job_run_id=? ORDER BY created_at,rowid", job.id).map(mapVerification);
      this.appendEvidenceLedgerEntry(job.id, "VERIFICATION_PASSED", "verification_batch", job.id, {
        contractSha256: contract.contractSha256,
        checks: verificationResults.map((result) => ({ id: result.checkId, status: result.status })),
        artifactSha256: proofArtifact.serverSha256,
        cleanupVerified: true,
        localHostExecutionUsed: false,
        localDockerUsed: false,
        persistentSnapshotCreated: false,
      }, timestamp);
      this.createManagedSandboxReceipt({
        task: current,
        job: this.getJobRun(job.id)!,
        contract,
        permission: completedPermission,
        run,
        artifacts,
        proof,
        proofArtifact,
        verificationResults,
        command: input.command,
      });
      current = this.transitionUnsafe(current, "VERIFICATION_PASSED", { kind: "SYSTEM", id: "managed-sandbox-verifier" }, "Remote policy, command, Artifact, hash, cleanup and Ledger Evidence all passed", "MANAGED_SANDBOX_VERIFIED");
      current = this.transitionUnsafe(current, "CUSTOMER_REVIEW", { kind: "SYSTEM", id: "managed-sandbox-verifier" }, "Fixed infrastructure Gate requires no frontend mutation", "MANAGED_SANDBOX_REVIEW_READY");
      current = this.transitionUnsafe(current, "COMPLETED", { kind: "ADMIN", id: "managed-sandbox-gate" }, "Server-side state machine completed the verified Managed Sandbox Task", "MANAGED_SANDBOX_COMPLETED");
      this.db.prepare("UPDATE job_runs SET status='SUCCEEDED',updated_at=? WHERE id=?").run(timestamp, job.id);
      this.db.prepare("UPDATE job_run_attempts SET terminal_reason='SUCCEEDED',lease_revoked_at=?,updated_at=? WHERE job_run_id=?").run(timestamp, timestamp, job.id);
      this.db.prepare("UPDATE task_assignments SET status='COMPLETED',updated_at=? WHERE id=?").run(timestamp, job.assignmentId);
      return this.getTaskAggregate(current.id);
    });
  }

  completeManagedBuildTest(runId: string): TaskAggregate {
    return this.transaction(() => {
      const run = this.requiredManagedSandboxRun(runId, "DESTROYED");
      const job = this.getJobRun(run.jobRunId);
      if (!job || job.workflowTemplate !== NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW || job.status !== "RUNNING") {
        throw new Error("Managed build/test Job is not running");
      }
      if (run.failureCode !== "TEST_FAILED") throw new Error("Managed build/test Run does not contain a real failed test");
      const task = this.getTask(job.taskId);
      const contract = job.taskContractVersionId ? this.getTaskContractVersion(job.taskContractVersionId) : null;
      const permission = this.assertPermissionLeaseActive(job.id, MANAGED_EXECUTION_NODE_ID);
      if (!task || !contract || contract.status !== "LOCKED") throw new Error("Managed build/test Contract binding is invalid");
      const source = validateManagedBuildTestSourceIdentity(
        run.providerMetadata.source as ManagedBuildTestSourceIdentity,
      );
      const aggregate = this.getTaskAggregate(task.id);
      const artifacts = aggregate.evidence.filter((artifact) => artifact.sandboxRunId === run.id);
      const byName = new Map(artifacts.map((artifact) => [artifact.fileName, artifact]));
      for (const fileName of MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS) {
        if (!byName.has(fileName)) throw new Error(`Managed build/test Artifact ${fileName} is missing`);
      }
      if (
        artifacts.length !== MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS.length ||
        byName.size !== MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS.length
      ) {
        throw new Error("Managed build/test Artifacts must contain the exact allowlisted set once");
      }
      for (const artifact of artifacts) {
        if (!artifact.claimedSha256 || !artifact.serverSha256 || !safeEqualHex(artifact.claimedSha256, artifact.serverSha256)) {
          throw new Error(`Managed build/test Artifact ${artifact.fileName} failed SHA-256 verification`);
        }
      }
      const sourceManifestArtifact = byName.get("source-package-manifest.json")!;
      if (!safeEqualHex(sourceManifestArtifact.serverSha256!, source.sourcePackageManifestSha256)) {
        throw new Error("Persisted Source Package Manifest hash differs from the locked source identity");
      }
      const sourceVerification = parseArtifactJson<ManagedBuildTestSourceVerification>(
        byName.get("source-package-verification.json")!,
      );
      const sourceIntegrity = parseArtifactJson<ManagedBuildTestSourceIntegrity>(
        byName.get("source-integrity-result.json")!,
      );
      const install = parseManagedBuildTestCommandArtifact(byName.get("install-result.json")!);
      const build = parseManagedBuildTestCommandArtifact(byName.get("build-result.json")!);
      const test = parseManagedBuildTestTestArtifact(byName.get("test-result.json")!);
      validateCommandArtifactReferences(install, byName);
      validateCommandArtifactReferences(build, byName);
      validateCommandArtifactReferences(test, byName);
      validateManagedBuildTestContextArtifacts({ byName, source, run });
      if (
        sourceVerification.schemaVersion !== 1 ||
        sourceVerification.repositoryUrl !== source.remoteUrl ||
        sourceVerification.branch !== source.branch ||
        sourceVerification.commitSha !== source.commitSha ||
        sourceVerification.manifestSha256 !== source.manifestSha256 ||
        sourceVerification.sourcePackageManifestSha256 !== source.sourcePackageManifestSha256 ||
        sourceVerification.sourcePackageSha256 !== source.sourcePackageSha256 ||
        sourceVerification.fileCount !== source.fileCount ||
        sourceVerification.packageVerified !== true ||
        sourceVerification.manifestVerified !== true ||
        sourceVerification.commitVerified !== true ||
        sourceVerification.extracted !== true ||
        sourceVerification.buildScriptPresent !== source.buildScriptPresent ||
        sourceVerification.installLifecycleScriptsPresent !== false ||
        !/^v24\./.test(sourceVerification.nodeVersion) ||
        !/^\d+\.\d+\.\d+/.test(sourceVerification.npmVersion)
      ) {
        throw new Error("Source Package verification Artifact is invalid");
      }
      if (
        sourceIntegrity.schemaVersion !== 1 ||
        sourceIntegrity.commitSha !== source.commitSha ||
        sourceIntegrity.manifestSha256 !== source.manifestSha256 ||
        sourceIntegrity.checkedFileCount !== source.fileCount ||
        sourceIntegrity.sourceMutationDetected !== false ||
        sourceIntegrity.missing.length !== 0 ||
        sourceIntegrity.modified.length !== 0 ||
        sourceIntegrity.added.length !== 0
      ) {
        throw new Error("SOURCE_MUTATION_DETECTED: Source integrity Artifact is invalid");
      }
      if (
        install.command !== "npm ci --ignore-scripts --no-audit --no-fund" ||
        install.exitCode !== 0 ||
        install.status !== "PASSED"
      ) throw new Error("Dependency installation Evidence did not pass");
      if (source.buildScriptPresent) {
        if (build.command !== "npm run build" || build.exitCode !== 0 || build.status !== "PASSED") {
          throw new Error("Build Evidence did not pass");
        }
      } else if (build.status !== "NOT_PRESENT" || build.exitCode !== null) {
        throw new Error("Build Evidence must be NOT_PRESENT when no build script exists");
      }
      if (test.command !== "npm test" || test.exitCode === null || test.exitCode === 0 || test.status !== "FAILED") {
        throw new Error("Test Evidence did not preserve the real non-zero exit");
      }
      if (test.statisticsStatus === "PARSED") {
        if (
          test.testRunner !== "node:test" ||
          test.totalTests === null || test.passedTests === null || test.failedTests === null ||
          test.totalTests !== test.passedTests + test.failedTests ||
          test.failedTests < 1
        ) throw new Error("Parsed test statistics are inconsistent");
      } else if (test.totalTests !== null || test.passedTests !== null || test.failedTests !== null) {
        throw new Error("Unparsable test statistics must remain null");
      }
      if (
        run.networkPolicy.final === undefined ||
        (run.networkPolicy.final as Record<string, unknown>).mode !== "deny-all" ||
        run.lifecycleMode !== "NON_PERSISTENT"
      ) throw new Error("Build and test did not run under the final deny-all policy");
      if (this.row("SELECT id FROM evidence_ledger_entries WHERE job_run_id=? AND entry_type='PERMISSION_VIOLATION' LIMIT 1", job.id)) {
        throw new Error("Permission violation prevents a managed build/test Receipt");
      }
      if (this.row("SELECT id FROM test_ledger_entries WHERE task_id=? AND entry_type='RELEASE' LIMIT 1", task.id)) {
        throw new Error("Failed verification cannot release Test Ledger Provider earnings");
      }

      const timestamp = now();
      const submitted = this.db.prepare("UPDATE job_runs SET status='SUBMITTED',ended_at=?,exit_code=?,updated_at=? WHERE id=? AND status='RUNNING'").run(
        test.finishedAt,
        test.exitCode,
        timestamp,
        job.id,
      );
      if (Number(submitted.changes) !== 1) throw new Error("Managed build/test Job submission lost its state fence");
      let current = this.transitionUnsafe(task, "SUBMITTED", { kind: "ADMIN", id: "managed-build-test-orchestrator" }, "Orchestrator submitted real install, build, failed-test, Source integrity, and cleanup Evidence", "MANAGED_BUILD_TEST_SUBMITTED");
      current = this.transitionUnsafe(current, "VERIFYING", { kind: "SYSTEM", id: "managed-build-test-verifier" }, "Server started independent Contract, hash, command, Source integrity, lifecycle, and Ledger verification", "MANAGED_BUILD_TEST_VERIFYING");
      const completedPermissionResult = this.db.prepare("UPDATE permission_leases SET status='COMPLETED' WHERE id=? AND status='ACTIVE'").run(permission.id);
      if (Number(completedPermissionResult.changes) !== 1) throw new Error("Managed build/test Permission completion lost its state fence");
      const completedPermission = this.getPermissionLease(permission.id)!;
      const preVerificationLedger = this.verifyLedgerChain(job.id);
      if (!preVerificationLedger.valid) throw new Error("Managed build/test Evidence Ledger is invalid before verification");

      const observed: Record<string, Record<string, unknown>> = {
        "exact-remote-commit": { materializerCommitSha: source.commitSha, independentRemoteCommitSha: source.independentRemoteCommitSha, matched: true },
        "source-manifest-valid": { sourcePackageManifestSha256: source.sourcePackageManifestSha256, artifactSha256: sourceManifestArtifact.serverSha256, matched: true },
        "source-package-valid": { sourcePackageSha256: source.sourcePackageSha256, sandboxVerified: true },
        "sandbox-created": { provider: run.provider, providerSandboxId: run.providerSandboxId },
        "no-local-host": { localHostWorkloadExecutionUsed: false },
        "no-local-docker": { localDockerUsed: false },
        "source-uploaded": { sourcePackageSha256: source.sourcePackageSha256, extracted: true },
        "npm-ci-executed": { exitCode: install.exitCode, status: install.status },
        "build-executed": { exitCode: build.exitCode, status: build.status },
        "test-executed": { exitCode: test.exitCode, status: test.status },
        "provider-logs": { install: install.stdoutArtifact.fileName, build: build.stdoutArtifact.fileName, test: test.stdoutArtifact.fileName },
        "real-exit-codes": { install: install.exitCode, build: build.exitCode, test: test.exitCode },
        "test-failure-detected": { exitCode: test.exitCode, failed: true },
        "job-not-successful": { finalTaskStatus: "VERIFICATION_FAILED", finalJobStatus: "FAILED" },
        "no-source-repair": { codexRepairUsed: false, sourceMutationDetected: false },
        "sandbox-stopped": { cleanupVerified: true, finalProviderState: run.providerMetadata.finalProviderState },
        "ledger-valid": { ...preVerificationLedger },
        "failed-receipt": { result: "FAILED", expectedIntegrity: "VALID" },
        "automated-tests-pass": { exitCode: test.exitCode, passed: false },
      };
      for (const check of contract.contract.acceptanceChecks) {
        const value = observed[check.id];
        if (!value) throw new Error(`Unsupported managed build/test check ${check.id}`);
        const status = check.id === "automated-tests-pass" ? "FAILED" : "PASSED";
        this.db.prepare("INSERT INTO verification_results(id,task_id,job_run_id,check_id,check_type,status,summary,observed_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(
          randomUUID(), task.id, job.id, check.id, check.type, status, check.label, canonicalJson(value), timestamp, timestamp,
        );
      }
      const verificationResults = this.rows("SELECT * FROM verification_results WHERE job_run_id=? ORDER BY created_at,rowid", job.id).map(mapVerification);
      this.appendEvidenceLedgerEntry(job.id, "VERIFICATION_FAILED", "verification_batch", job.id, {
        contractSha256: contract.contractSha256,
        checks: verificationResults.map((result) => ({ id: result.checkId, status: result.status })),
        installExitCode: install.exitCode,
        buildExitCode: build.exitCode,
        testExitCode: test.exitCode,
        sourceMutationDetected: false,
        cleanupVerified: true,
        providerPayoutReleased: false,
        result: "FAILED",
      }, timestamp);
      const failedLedger = this.verifyLedgerChain(job.id);
      if (!failedLedger.valid || !failedLedger.chainSha256) throw new Error("Managed build/test failure Ledger is invalid");
      this.createManagedBuildTestReceipt({
        task: current,
        job: this.getJobRun(job.id)!,
        contract,
        permission: completedPermission,
        run,
        source,
        sourceVerification,
        sourceIntegrity,
        install,
        build,
        test,
        artifacts,
        verificationResults,
        ledger: failedLedger,
      });
      current = this.transitionUnsafe(current, "VERIFICATION_FAILED", { kind: "SYSTEM", id: "managed-build-test-verifier" }, "Required automated tests exited non-zero; Receipt integrity remains independently verifiable", "MANAGED_BUILD_TEST_VERIFICATION_FAILED");
      this.db.prepare("UPDATE job_runs SET status='FAILED',updated_at=? WHERE id=? AND status='SUBMITTED'").run(timestamp, job.id);
      this.db.prepare("UPDATE job_run_attempts SET terminal_reason='VERIFICATION_FAILED',lease_revoked_at=?,updated_at=? WHERE job_run_id=?").run(timestamp, timestamp, job.id);
      return this.getTaskAggregate(current.id);
    });
  }

  private createManagedBuildTestReceipt(input: {
    task: TaskRecord;
    job: JobRunRecord;
    contract: TaskContractVersionRecord;
    permission: PermissionLeaseRecord;
    run: ManagedSandboxRunRecord;
    source: ManagedBuildTestSourceIdentity;
    sourceVerification: ManagedBuildTestSourceVerification;
    sourceIntegrity: ManagedBuildTestSourceIntegrity;
    install: ManagedBuildTestCommandEvidence;
    build: ManagedBuildTestCommandEvidence;
    test: ManagedBuildTestTestEvidence;
    artifacts: EvidenceArtifactRecord[];
    verificationResults: VerificationResultRecord[];
    ledger: EvidenceLedgerVerification;
  }): JobReceiptRecord {
    if (
      input.permission.status !== "COMPLETED" ||
      input.run.status !== "DESTROYED" ||
      !input.ledger.valid ||
      !input.ledger.chainSha256 ||
      input.test.exitCode === null ||
      input.test.exitCode === 0 ||
      input.test.status !== "FAILED" ||
      input.sourceIntegrity.sourceMutationDetected
    ) throw new Error("FAILED build/test Receipt prerequisites are incomplete");
    const entries = this.listEvidenceLedgerEntries(input.job.id);
    const expectedOrder: EvidenceLedgerEntryType[] = [
      "CONTRACT_LOCKED",
      "PERMISSION_GRANTED",
      "REPOSITORY_VERIFIED",
      "SOURCE_PACKAGE_CREATED",
      "SOURCE_PACKAGE_VERIFIED",
      "MANAGED_SANDBOX_REQUESTED",
      "MANAGED_SANDBOX_CREATED",
      "MANAGED_SANDBOX_POLICY_VERIFIED",
      "MANAGED_SANDBOX_STARTED",
      "EXECUTION_STARTED",
      "SOURCE_PACKAGE_UPLOADED",
      "SOURCE_MANIFEST_VERIFIED",
      "NETWORK_POLICY_UPDATED",
      "DEPENDENCY_INSTALL_STARTED",
      "DEPENDENCY_INSTALL_COMPLETED",
      ...(input.source.buildScriptPresent ? ["BUILD_STARTED", "BUILD_COMPLETED"] as EvidenceLedgerEntryType[] : []),
      "TEST_STARTED",
      "TEST_FAILED",
      "SOURCE_INTEGRITY_VERIFIED",
      "MANAGED_SANDBOX_STOP_REQUESTED",
      "MANAGED_SANDBOX_STOPPED",
      "MANAGED_SANDBOX_CLEANUP_VERIFIED",
      "ARTIFACT_UPLOADED",
      "ARTIFACT_HASH_VERIFIED",
      "VERIFICATION_FAILED",
    ];
    let cursor = -1;
    for (const type of expectedOrder) {
      cursor = entries.findIndex((entry, index) => index > cursor && entry.entryType === type);
      if (cursor < 0) throw new Error(`FAILED build/test Receipt is missing ordered Evidence ${type}`);
    }
    if (entries.some((entry) => entry.entryType === "PERMISSION_VIOLATION" || entry.entryType === "VERIFICATION_PASSED")) {
      throw new Error("FAILED build/test Receipt contains incompatible Evidence");
    }
    const byName = new Map(input.artifacts.map((artifact) => [artifact.fileName, artifact]));
    const repositoryArtifact = byName.get("repository-materialization.json")!;
    const testArtifact = byName.get("test-result.json")!;
    const sourceManifestArtifact = byName.get("source-package-manifest.json")!;
    const issuedAt = now();
    const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
    const startedAt = input.install.startedAt;
    const finishedAt = input.sourceIntegrity.verifiedAt;
    const document: JobReceiptRecord["receipt"] = {
      schemaVersion: 1,
      receiptType: "REAL_BUILD_TEST_MANAGED_SANDBOX_VERIFICATION",
      claim: "Hash-verifiable DoneLayer execution receipt.",
      publicReceiptId,
      whoRequested: { customerReference: input.task.customerId, taskId: input.task.id, orderedAt: input.task.createdAt },
      whoExecuted: {
        agentId: MANAGED_BUILD_TEST_AGENT_ID,
        agentPublicIdentity: "DoneLayer Managed Build and Test Agent",
        agentVersion: "1.0.0",
        providerId: MANAGED_PROVIDER_ID,
        workerId: null,
        workerPublicIdentity: "DoneLayer Server-side Sandbox Orchestrator (no local workload Worker)",
        workerVersion: null,
        capabilitySnapshot: null,
        runtime: input.sourceVerification.nodeVersion,
        os: "linux",
      },
      executionBackend: {
        orchestrator: "DONE_LAYER_SERVER",
        executionBackendType: "MANAGED_REMOTE_SANDBOX",
        sandboxProvider: "VERCEL_SANDBOX",
        providerSandboxId: input.run.providerSandboxId!,
        providerRequestId: input.run.providerRequestId,
        isolationModel: "REMOTE_MICROVM",
        lifecycleMode: "NON_PERSISTENT",
        runtime: input.run.runtime,
        region: input.run.region,
      },
      whatWasAgreed: {
        taskContractVersionId: input.contract.id,
        contractVersion: input.contract.version,
        contractSha256: input.contract.contractSha256,
        desiredOutcome: input.contract.contract.desiredOutcome,
        deliverables: input.contract.contract.deliverables,
        acceptanceChecks: input.contract.contract.acceptanceChecks,
      },
      whatWasPermitted: {
        permissionLeaseId: input.permission.id,
        allowedActions: input.permission.scope.allowedActions,
        deniedActions: input.permission.scope.deniedActions,
        effectiveAt: input.permission.startsAt!,
        expiresAt: input.permission.expiresAt!,
        budgetLimit: input.contract.contract.budgetLimit,
        permissionViolations: [],
      },
      whatHappened: {
        jobRunId: input.job.id,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
        importantRunEvents: entries.map((entry) => ({ type: entry.entryType, createdAt: entry.createdAt })),
        artifacts: input.artifacts.map((artifact) => ({ id: artifact.id, fileName: artifact.fileName, mimeType: artifact.mimeType, size: artifact.size, sha256: artifact.serverSha256 ?? artifact.sha256 })),
        workspaceCleaned: true,
        repositoryMaterialization: {
          remoteUrl: input.source.remoteUrl,
          branch: input.source.branch,
          workerCommitSha: input.source.commitSha,
          independentRemoteCommitSha: input.source.independentRemoteCommitSha,
          cloneExitCode: 0,
          cloneDurationMs: input.source.cloneDurationMs,
          fileCount: input.source.fileCount,
          manifestSha256: input.source.manifestSha256,
          artifactSha256: repositoryArtifact.serverSha256!,
          noRepositoryCodeExecuted: false,
        },
        managedSandbox: {
          sandboxRunId: input.run.id,
          provider: "VERCEL_SANDBOX",
          providerSandboxId: input.run.providerSandboxId!,
          providerRequestId: input.run.providerRequestId,
          isolationModel: "REMOTE_MICROVM",
          lifecycleMode: "NON_PERSISTENT",
          runtime: input.run.runtime,
          region: input.run.region,
          networkPolicy: "deny-all",
          allowedDomainCount: 0,
          allowedCidrCount: 0,
          runtimeLimitSeconds: input.permission.scope.maxRuntimeSeconds,
          exitCode: input.test.exitCode,
          networkProbeBlocked: null,
          artifactSha256: testArtifact.serverSha256!,
          cleanupVerified: true,
          finalProviderState: String(input.run.providerMetadata.finalProviderState ?? "stopped"),
          persistentSnapshotCreated: false,
          localHostExecutionUsed: false,
          localDockerUsed: false,
        },
        buildTest: {
          sourceManifestSha256: input.source.sourcePackageManifestSha256,
          sourcePackageSha256: input.source.sourcePackageSha256,
          nodeVersion: input.sourceVerification.nodeVersion,
          npmVersion: input.sourceVerification.npmVersion,
          install: receiptCommandSummary(input.install),
          build: receiptCommandSummary(input.build),
          test: receiptCommandSummary(input.test),
          testRunner: input.test.testRunner,
          totalTests: input.test.totalTests,
          passedTests: input.test.passedTests,
          failedTests: input.test.failedTests,
          statisticsStatus: input.test.statisticsStatus,
          sourceMutationDetected: false,
          networkViolationCount: 0,
          permissionViolationCount: 0,
          providerPayoutReleased: false,
        },
      },
      howVerified: {
        checks: input.verificationResults.map((check) => ({ id: check.checkId, status: check.status, summary: check.summary })),
        workerSha256: sourceManifestArtifact.claimedSha256!,
        serverSha256: sourceManifestArtifact.serverSha256!,
        evidenceLedger: input.ledger,
        humanApproval: null,
      },
      finalResult: "FAILED",
      issuedAt,
    };
    return this.persistJobReceipt({
      taskId: input.task.id,
      jobRunId: input.job.id,
      taskContractVersionId: input.contract.id,
      permissionLeaseId: input.permission.id,
      result: "FAILED",
      document,
      evidenceChainSha256: input.ledger.chainSha256,
      createdAt: issuedAt,
    });
  }

  failManagedSandboxRun(runId: string, failureCode: string, failureMessage: string): void {
    this.transaction(() => {
      const run = this.getManagedSandboxRun(runId);
      if (!run) throw new Error("Managed Sandbox Run not found");
      const timestamp = now();
      this.db.prepare("UPDATE managed_sandbox_runs SET status='FAILED',failure_code=?,failure_message=?,finished_at=?,updated_at=? WHERE id=? AND status IN ('REQUESTED','CREATING','READY','RUNNING')").run(
        failureCode.slice(0, 100), failureMessage.slice(0, 1000), timestamp, timestamp, run.id,
      );
      this.appendJobEvent(run.jobRunId, "STATUS", "ERROR", "Managed Sandbox provider execution failed", { failureCode, failureMessage: failureMessage.slice(0, 500) });
    });
  }

  private createManagedSandboxReceipt(input: {
    task: TaskRecord;
    job: JobRunRecord;
    contract: TaskContractVersionRecord;
    permission: PermissionLeaseRecord;
    run: ManagedSandboxRunRecord;
    artifacts: EvidenceArtifactRecord[];
    proof: Record<string, unknown>;
    proofArtifact: EvidenceArtifactRecord;
    verificationResults: VerificationResultRecord[];
    command: { exitCode: number; startedAt: string; finishedAt: string; durationMs: number };
  }): JobReceiptRecord {
    if (input.permission.status !== "COMPLETED" || input.run.status !== "DESTROYED") {
      throw new Error("Managed Sandbox Receipt requires completed Permission and verified cleanup");
    }
    if (input.contract.contract.acceptanceChecks.some((check) => check.required && input.verificationResults.find((result) => result.checkId === check.id)?.status !== "PASSED")) {
      throw new Error("Managed Sandbox Receipt requires every Contract check to pass");
    }
    const entries = this.listEvidenceLedgerEntries(input.job.id);
    const expected: EvidenceLedgerEntryType[] = [
      "CONTRACT_LOCKED",
      "PERMISSION_GRANTED",
      "MANAGED_SANDBOX_REQUESTED",
      "MANAGED_SANDBOX_CREATED",
      "MANAGED_SANDBOX_POLICY_VERIFIED",
      "MANAGED_SANDBOX_STARTED",
      "EXECUTION_STARTED",
      "NETWORK_PROBE_COMPLETED",
      "ARTIFACT_CREATED",
      "ARTIFACT_UPLOADED",
      "ARTIFACT_HASH_VERIFIED",
      "MANAGED_SANDBOX_STOP_REQUESTED",
      "MANAGED_SANDBOX_STOPPED",
      "MANAGED_SANDBOX_CLEANUP_VERIFIED",
      "VERIFICATION_PASSED",
    ];
    let cursor = -1;
    for (const type of expected) {
      cursor = entries.findIndex((entry, index) => index > cursor && entry.entryType === type);
      if (cursor < 0) throw new Error(`Managed Sandbox Receipt is missing ordered Evidence ${type}`);
    }
    if (entries.some((entry) => entry.entryType === "PERMISSION_VIOLATION")) throw new Error("Permission violation prevents a Managed Sandbox Receipt");
    const ledger = verifyEvidenceLedgerEntries(entries);
    if (!ledger.valid || !ledger.chainSha256) throw new Error("Managed Sandbox Evidence Ledger is invalid");
    const issuedAt = now();
    const publicReceiptId = `dlr_${randomBytes(18).toString("base64url")}`;
    const document: JobReceiptRecord["receipt"] = {
      schemaVersion: 1,
      receiptType: "MANAGED_REMOTE_SANDBOX_VERIFICATION",
      claim: "Hash-verifiable DoneLayer execution receipt.",
      publicReceiptId,
      whoRequested: { customerReference: input.task.customerId, taskId: input.task.id, orderedAt: input.task.createdAt },
      whoExecuted: {
        agentId: MANAGED_AGENT_ID,
        agentPublicIdentity: "DoneLayer Managed Sandbox Smoke Agent",
        agentVersion: "1.0.0",
        providerId: MANAGED_PROVIDER_ID,
        workerId: null,
        workerPublicIdentity: "DoneLayer Server-side Sandbox Orchestrator (no local Worker)",
        workerVersion: null,
        capabilitySnapshot: null,
        runtime: input.run.runtime,
        os: String(input.proof.platform),
      },
      executionBackend: {
        orchestrator: "DONE_LAYER_SERVER",
        executionBackendType: "MANAGED_REMOTE_SANDBOX",
        sandboxProvider: "VERCEL_SANDBOX",
        providerSandboxId: input.run.providerSandboxId!,
        providerRequestId: input.run.providerRequestId,
        isolationModel: "REMOTE_MICROVM",
        lifecycleMode: "NON_PERSISTENT",
        runtime: input.run.runtime,
        region: input.run.region,
      },
      whatWasAgreed: {
        taskContractVersionId: input.contract.id,
        contractVersion: input.contract.version,
        contractSha256: input.contract.contractSha256,
        desiredOutcome: input.contract.contract.desiredOutcome,
        deliverables: input.contract.contract.deliverables,
        acceptanceChecks: input.contract.contract.acceptanceChecks,
      },
      whatWasPermitted: {
        permissionLeaseId: input.permission.id,
        allowedActions: input.permission.scope.allowedActions,
        deniedActions: input.permission.scope.deniedActions,
        effectiveAt: input.permission.startsAt!,
        expiresAt: input.permission.expiresAt!,
        budgetLimit: input.contract.contract.budgetLimit,
        permissionViolations: [],
      },
      whatHappened: {
        jobRunId: input.job.id,
        startedAt: input.command.startedAt,
        finishedAt: input.command.finishedAt,
        durationMs: input.command.durationMs,
        importantRunEvents: entries.map((entry) => ({ type: entry.entryType, createdAt: entry.createdAt })),
        artifacts: input.artifacts.map((artifact) => ({ id: artifact.id, fileName: artifact.fileName, mimeType: artifact.mimeType, size: artifact.size, sha256: artifact.serverSha256 ?? artifact.sha256 })),
        workspaceCleaned: true,
        managedSandbox: {
          sandboxRunId: input.run.id,
          provider: "VERCEL_SANDBOX",
          providerSandboxId: input.run.providerSandboxId!,
          providerRequestId: input.run.providerRequestId,
          isolationModel: "REMOTE_MICROVM",
          lifecycleMode: "NON_PERSISTENT",
          runtime: input.run.runtime,
          region: input.run.region,
          networkPolicy: "deny-all",
          allowedDomainCount: 0,
          allowedCidrCount: 0,
          runtimeLimitSeconds: input.permission.scope.maxRuntimeSeconds,
          exitCode: input.command.exitCode,
          networkProbeBlocked: true,
          artifactSha256: input.proofArtifact.serverSha256!,
          cleanupVerified: true,
          finalProviderState: String(input.run.providerMetadata.finalProviderState ?? "stopped"),
          persistentSnapshotCreated: false,
          localHostExecutionUsed: false,
          localDockerUsed: false,
        },
      },
      howVerified: {
        checks: input.verificationResults.map((check) => ({ id: check.checkId, status: check.status, summary: check.summary })),
        workerSha256: input.proofArtifact.claimedSha256!,
        serverSha256: input.proofArtifact.serverSha256!,
        evidenceLedger: ledger,
        humanApproval: null,
      },
      finalResult: "VERIFIED",
      issuedAt,
    };
    return this.persistJobReceipt({
      taskId: input.task.id,
      jobRunId: input.job.id,
      taskContractVersionId: input.contract.id,
      permissionLeaseId: input.permission.id,
      result: "VERIFIED",
      document,
      evidenceChainSha256: ledger.chainSha256,
      createdAt: issuedAt,
    });
  }

  private ensureManagedExecutionIdentities(): { agent: AgentRecord; worker: WorkerRecord } {
    return this.transaction(() => {
      const timestamp = now();
      this.db.prepare("INSERT OR IGNORE INTO profiles(id,name,role,created_at,updated_at) VALUES(?,?,'PROVIDER',?,?)").run(MANAGED_PROVIDER_ID, "DoneLayer Platform Managed Execution", timestamp, timestamp);
      const agent: AgentRecord = {
      id: MANAGED_AGENT_ID,
      slug: "managed-sandbox-smoke-agent",
      name: "DoneLayer Managed Sandbox Smoke Agent",
      version: "1.0.0",
      providerId: MANAGED_PROVIDER_ID,
      providerName: "DoneLayer Platform",
      description: "Server-owned Agent identity for the fixed Managed Sandbox infrastructure verification only.",
      skills: ["Managed Sandbox Verification"],
      taskTypes: [],
      languages: ["JavaScript"],
      operatingSystems: ["LINUX"],
      tools: ["Vercel Sandbox"],
      requiredMcpServers: [],
      pricingModel: "FIXED",
      basePriceCents: 0,
      averageCompletionMinutes: 1,
      completedTasks: 0,
      verifiedSuccessRate: 0,
      rating: 0,
      workerStatus: "ONLINE",
      lastActiveAt: timestamp,
      verificationStatus: "VERIFIED",
      endpointType: "PLATFORM_MANAGED",
      endpointUrl: null,
      authenticationType: "NONE",
      inputModes: ["platform-controlled"],
      outputModes: ["evidence"],
      acceptingTasks: false,
      recentFailures: 0,
      currentWorkload: 0,
      maxConcurrentJobs: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      };
      this.db.prepare("INSERT OR IGNORE INTO agents(id,slug,provider_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(agent.id, agent.slug, agent.providerId, JSON.stringify(agent), timestamp, timestamp);
      const persistedAgent = this.getAgentById(agent.id)!;
      this.ensureAgentIdentityProfile(persistedAgent, "MANAGED_SANDBOX_AGENT", { kind: "SYSTEM", id: "managed-sandbox" });
      const worker: WorkerRecord = {
      id: MANAGED_EXECUTION_NODE_ID,
      providerId: MANAGED_PROVIDER_ID,
      name: "DoneLayer Platform Managed Execution Node",
      status: "ONLINE",
      os: "LINUX",
      installedTools: ["Vercel Sandbox"],
      mcpTools: [],
      executors: ["managed-sandbox"],
      maxConcurrentJobs: 1,
      activeJobs: 0,
      lastHeartbeatAt: timestamp,
      tokenHash: null,
      tokenId: null,
      acceptingJobs: false,
      capabilitySnapshot: null,
      capabilitySnapshotId: null,
      executionNodeType: "PLATFORM_MANAGED",
      createdAt: timestamp,
      updatedAt: timestamp,
      };
      this.db.prepare("INSERT OR IGNORE INTO worker_nodes(id,provider_id,status,token_hash,token_id,data_json,created_at,updated_at) VALUES(?,?,?,NULL,NULL,?,?,?)").run(worker.id, worker.providerId, worker.status, JSON.stringify(worker), timestamp, timestamp);
      return { agent: persistedAgent, worker: this.getWorker(worker.id)! };
    });
  }

  private ensureManagedBuildTestExecutionIdentities(): { agent: AgentRecord; worker: WorkerRecord } {
    return this.transaction(() => {
      const { worker } = this.ensureManagedExecutionIdentities();
      const timestamp = now();
      const agent: AgentRecord = {
      id: MANAGED_BUILD_TEST_AGENT_ID,
      slug: "managed-sandbox-build-test-agent",
      name: "DoneLayer Managed Build and Test Agent",
      version: "1.0.0",
      providerId: MANAGED_PROVIDER_ID,
      providerName: "DoneLayer Platform",
      description: "Server-owned Agent identity for exact-commit build and test verification in a managed remote sandbox.",
      skills: ["Managed Sandbox Build", "Managed Sandbox Test", "Evidence Verification"],
      taskTypes: [],
      languages: ["JavaScript", "TypeScript"],
      operatingSystems: ["LINUX"],
      tools: ["Vercel Sandbox", "Node.js", "npm"],
      requiredMcpServers: [],
      pricingModel: "FIXED",
      basePriceCents: 0,
      averageCompletionMinutes: 5,
      completedTasks: 0,
      verifiedSuccessRate: 0,
      rating: 0,
      workerStatus: "ONLINE",
      lastActiveAt: timestamp,
      verificationStatus: "VERIFIED",
      endpointType: "PLATFORM_MANAGED",
      endpointUrl: null,
      authenticationType: "NONE",
      inputModes: ["verified-source-package"],
      outputModes: ["build-test-evidence"],
      acceptingTasks: false,
      recentFailures: 0,
      currentWorkload: 0,
      maxConcurrentJobs: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      };
      this.db.prepare("INSERT OR IGNORE INTO agents(id,slug,provider_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(
        agent.id, agent.slug, agent.providerId, JSON.stringify(agent), timestamp, timestamp,
      );
      const persistedAgent = this.getAgentById(agent.id)!;
      this.ensureAgentIdentityProfile(persistedAgent, "MANAGED_BUILD_TEST_AGENT", { kind: "SYSTEM", id: "managed-build-test" });
      return { agent: persistedAgent, worker };
    });
  }

  private requiredManagedSandboxRun(id: string, status: ManagedSandboxRunStatus): ManagedSandboxRunRecord {
    const run = this.getManagedSandboxRun(id);
    if (!run || run.status !== status) throw new Error(`Managed Sandbox Run must be ${status}`);
    return run;
  }

  private insertTaskEvent(
    taskId: string,
    fromStatus: TaskStatus | null,
    toStatus: TaskStatus,
    actor: Actor,
    reason: string,
    eventType: string,
    payload: Record<string, unknown> = {}
  ): TaskEventRecord {
    const timestamp = now();
    const sequenceRow = this.row("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM task_events WHERE task_id = ?", taskId);
    const sequence = sequenceRow ? number(sequenceRow.next_sequence) : 1;
    const event: TaskEventRecord = {
      id: randomUUID(),
      taskId,
      sequence,
      fromStatus,
      toStatus,
      actorKind: actor.kind,
      actorId: actor.id,
      reason,
      eventType,
      payload,
      createdAt: timestamp
    };
    this.db.prepare("INSERT INTO task_events(id,task_id,sequence,from_status,to_status,actor_kind,actor_id,reason,event_type,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
      event.id,
      taskId,
      sequence,
      fromStatus,
      toStatus,
      actor.kind,
      actor.id,
      reason,
      eventType,
      JSON.stringify(payload),
      timestamp,
      timestamp
    );
    this.insertAudit(actor, eventType, "task", taskId, payload);
    return event;
  }

  private insertAudit(actor: Actor, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown> = {}): void {
    const timestamp = now();
    this.db.prepare("INSERT INTO audit_logs(id,actor_kind,actor_id,action,resource_type,resource_id,success,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)").run(
      randomUUID(),
      actor.kind,
      actor.id,
      action,
      resourceType,
      resourceId,
      JSON.stringify(metadata),
      timestamp,
      timestamp
    );
  }

  private transitionUnsafe(task: TaskRecord, to: TaskStatus, actor: Actor, reason: string, eventType: string): TaskRecord {
    const assignment = this.getLatestAssignment(task.id);
    const agent = task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null;
    const providerId = assignment?.providerId ?? agent?.providerId;
    const workerId = assignment?.workerId ?? task.assignedWorkerId ?? undefined;
    validateTransition({
      from: task.status,
      to,
      actor,
      reason,
      context: {
        customerId: task.customerId,
        ...(providerId ? { providerId } : {}),
        ...(workerId ? { workerId } : {})
      }
    });
    const timestamp = now();
    this.db.prepare("UPDATE tasks SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").run(to, timestamp, task.id, task.version);
    this.insertTaskEvent(task.id, task.status, to, actor, reason, eventType);
    const updated = this.getTask(task.id);
    if (!updated) throw new Error("Task disappeared during transition.");
    return updated;
  }

  transitionTask(taskId: string, to: TaskStatus, actor: Actor, reason: string, eventType = "STATUS_CHANGED"): TaskRecord {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      return this.transitionUnsafe(task, to, actor, reason, eventType);
    });
  }

  private setAnalysis(task: TaskRecord): void {
    const analysis = analyzeTask({
      title: task.title,
      problemDescription: task.problemDescription,
      desiredOutcome: task.desiredOutcome,
      repository: task.repository,
      targetBranch: task.targetBranch,
      taskType: task.taskType === "REPOSITORY_MATERIALIZATION_V1"
        ? "DIAGNOSE_REPOSITORY"
        : task.taskType === MANAGED_SANDBOX_SMOKE_WORKFLOW || task.taskType === MANAGED_SANDBOX_TIMEOUT_WORKFLOW || task.taskType === "REAL_BUILD_TEST_MANAGED_SANDBOX_V1"
          ? "LAUNCH_READINESS"
          : task.taskType,
      requiredSkills: task.requiredSkills,
      requiredOperatingSystem: task.requiredOperatingSystem as "ANY" | "WINDOWS" | "MACOS" | "LINUX" | null,
      requiredTools: task.requiredTools,
      requiredMcpTools: task.requiredMcpTools,
      budgetCents: task.budgetCents,
      deadline: task.deadline,
      acceptanceChecks: task.acceptanceChecks,
      securitySensitivity: task.securitySensitivity,
      allowCodeChanges: task.allowCodeChanges,
      allowPullRequest: task.allowPullRequest,
      requiresHumanApproval: task.requiresHumanApproval,
      preferredAgentId: task.preferredAgentId
    });
    const data = { ...task, analysis };
    this.db.prepare("UPDATE tasks SET data_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), now(), task.id);
  }

  private matchTask(task: TaskRecord): MatchRecord[] {
    this.reconcileWorkerCapacity();
    const agents = this.listAgents();
    const workers = this.listWorkers();
    const timestamp = now();

    const candidates = agents.flatMap((agent) =>
      workers
        .filter((worker) => worker.providerId === agent.providerId)
        .map((worker) => ({
          agent: {
            id: agent.id,
            name: agent.name,
            providerId: agent.providerId,
            providerName: agent.providerName,
            skills: agent.skills,
            taskTypes: agent.taskTypes,
            supportedOperatingSystems: agent.operatingSystems as Array<"ANY" | "WINDOWS" | "MACOS" | "LINUX">,
            supportedTools: agent.tools,
            supportedMcpTools: agent.requiredMcpServers,
            minimumPriceCents: agent.basePriceCents,
            acceptingTasks: agent.acceptingTasks,
            verificationStatus: agent.verificationStatus,
            verifiedSuccessRate: agent.verifiedSuccessRate,
            averageCompletionHours: Math.max(agent.averageCompletionMinutes / 60, 0.1),
            recentFailures: agent.recentFailures,
            recentRuns: Math.max(10, agent.completedTasks)
          },
          worker: {
            id: worker.id,
            status: worker.status,
            operatingSystem: worker.os,
            installedTools: worker.installedTools,
            installedMcpTools: worker.mcpTools,
            lastHeartbeatAt: worker.lastHeartbeatAt,
            activeJobs: worker.activeJobs,
            maxConcurrentJobs: worker.maxConcurrentJobs
          }
        }))
    );

    const ranked = rankCandidates(
      {
        id: task.id,
        taskType: task.taskType === "REPOSITORY_MATERIALIZATION_V1"
          ? "DIAGNOSE_REPOSITORY"
          : task.taskType === MANAGED_SANDBOX_SMOKE_WORKFLOW || task.taskType === MANAGED_SANDBOX_TIMEOUT_WORKFLOW || task.taskType === "REAL_BUILD_TEST_MANAGED_SANDBOX_V1"
            ? "LAUNCH_READINESS"
            : task.taskType,
        requiredSkills: task.requiredSkills,
        requiredOperatingSystem: task.requiredOperatingSystem as "ANY" | "WINDOWS" | "MACOS" | "LINUX" | null,
        requiredTools: task.requiredTools,
        requiredMcpTools: task.requiredMcpTools,
        budgetCents: task.budgetCents,
        expectedDurationHours: task.analysis?.estimatedDurationHours ?? 6
      },
      candidates,
      { now: new Date(timestamp) }
    );

    this.db.prepare("DELETE FROM task_matches WHERE task_id = ?").run(task.id);
    const insert = this.db.prepare("INSERT INTO task_matches(id,task_id,agent_id,worker_id,rank,total_score,eligible,components_json,reasons_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    const records: MatchRecord[] = [];
    ranked.matches.forEach((match, index) => {
      const record: MatchRecord = {
        id: randomUUID(),
        taskId: task.id,
        agentId: match.candidate.agent.id,
        workerId: match.candidate.worker.id,
        rank: index + 1,
        totalScore: match.score,
        components: { ...match.breakdown },
        reasons: [match.reason],
        eligible: true,
        createdAt: timestamp
      };
      insert.run(record.id, record.taskId, record.agentId, record.workerId, record.rank, record.totalScore, 1, JSON.stringify(record.components), JSON.stringify(record.reasons), timestamp, timestamp);
      records.push(record);
    });

    if (task.preferredAgentId) {
      records.sort((left, right) => Number(right.agentId === task.preferredAgentId) - Number(left.agentId === task.preferredAgentId) || left.rank - right.rank);
      records.forEach((record, index) => {
        record.rank = index + 1;
        this.db.prepare("UPDATE task_matches SET rank=? WHERE id=?").run(record.rank, record.id);
      });
    }
    const top = records[0];
    if (!top) throw new Error("No eligible agent matches this task.");
    this.db.prepare("UPDATE tasks SET matched_agent_id = ?, assigned_worker_id = ?, updated_at = ? WHERE id = ?").run(top.agentId, top.workerId, timestamp, task.id);
    return records;
  }

  private getLatestAssignment(taskId: string): AssignmentRecord | null {
    const found = this.row("SELECT * FROM task_assignments WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", taskId);
    return found ? mapAssignment(found) : null;
  }

  private getLatestJob(taskId: string): JobRunRecord | null {
    const found = this.row("SELECT * FROM job_runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", taskId);
    return found ? mapJobRun(found) : null;
  }

  private acceptAssignment(task: TaskRecord): TaskRecord {
    const agent = task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null;
    const match = this.row("SELECT * FROM task_matches WHERE task_id = ? AND rank = 1", task.id);
    if (!agent || !match) throw new Error("Task has no selected match.");
    const workerId = string(match.worker_id);
    const timestamp = now();
    const assignment: AssignmentRecord = {
      id: randomUUID(),
      taskId: task.id,
      agentId: agent.id,
      providerId: agent.providerId,
      workerId,
      status: "ACCEPTED",
      quoteCents: task.budgetCents,
      providerEarningCents: Math.round(task.budgetCents * 0.8),
      platformFeeCents: task.budgetCents - Math.round(task.budgetCents * 0.8),
      acceptedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(
      assignment.id,
      assignment.taskId,
      assignment.agentId,
      assignment.providerId,
      assignment.workerId,
      assignment.status,
      assignment.quoteCents,
      assignment.providerEarningCents,
      assignment.platformFeeCents,
      assignment.acceptedAt,
      timestamp,
      timestamp
    );
    const jobId = randomUUID();
    this.db.prepare("INSERT INTO job_runs(id,task_id,assignment_id,worker_id,agent_id,status,executor,workflow_template,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED','DEMO',?,?,?)").run(
      jobId,
      task.id,
      assignment.id,
      workerId,
      agent.id,
      task.taskType,
      timestamp,
      timestamp
    );
    return this.transitionUnsafe(task, "ASSIGNED", { kind: "PROVIDER", id: agent.providerId }, "Provider reviewed the scope and accepted the task", "PROVIDER_ACCEPTED");
  }

  private appendJobEvent(jobRunId: string, kind: JobEventRecord["kind"], level: JobEventRecord["level"], message: string, payload: Record<string, unknown> = {}): JobEventRecord {
    const sequenceRow = this.row("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM job_run_events WHERE job_run_id = ?", jobRunId);
    const sequence = sequenceRow ? number(sequenceRow.next_sequence) : 1;
    const timestamp = now();
    const event: JobEventRecord = { id: randomUUID(), jobRunId, sequence, kind, level, message, payload, createdAt: timestamp };
    this.db.prepare("INSERT INTO job_run_events(id,job_run_id,sequence,kind,level,message,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
      event.id,
      jobRunId,
      sequence,
      kind,
      level,
      message.slice(0, 8000),
      JSON.stringify(payload),
      timestamp,
      timestamp
    );
    return event;
  }

  private reconcileWorkerCapacity(workerId?: string): void {
    const timestamp = now();
    const workers = workerId ? [this.getWorker(workerId)].filter((worker): worker is WorkerRecord => worker !== null) : this.listWorkers();
    for (const worker of workers) {
      const activeRow = this.row(
        "SELECT COUNT(*) AS count FROM job_runs WHERE worker_id=? AND status='RUNNING' AND lease_expires_at>?",
        worker.id,
        timestamp
      );
      const activeJobs = activeRow ? number(activeRow.count) : 0;
      const heartbeatFresh = Date.parse(worker.lastHeartbeatAt) > Date.now() - this.heartbeatTtlMs;
      const status: WorkerRecord["status"] =
        worker.status === "SUSPENDED"
          ? "SUSPENDED"
          : worker.tokenHash && !heartbeatFresh
            ? "OFFLINE"
            : worker.status === "OFFLINE" && !worker.tokenHash
              ? "OFFLINE"
          : activeJobs > 0
            ? "BUSY"
            : "ONLINE";
      if (worker.activeJobs === activeJobs && worker.status === status) continue;
      const updated: WorkerRecord = { ...worker, activeJobs, status, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET status=?, data_json=?, updated_at=? WHERE id=?").run(status, JSON.stringify(updated), timestamp, worker.id);
    }
  }

  private claimJob(task: TaskRecord): { task: TaskRecord; leaseToken: string } {
    const job = this.getLatestJob(task.id);
    if (!job || job.status !== "QUEUED") throw new Error("No queued job is available.");
    const contract = job.taskContractVersionId ? this.getTaskContractVersion(job.taskContractVersionId) : null;
    if (
      ["WORKER_SMOKE_V1", "REPOSITORY_MATERIALIZE_V1"].includes(job.workflowTemplate) &&
      (!contract || !["LOCKED", "SUPERSEDED"].includes(contract.status))
    ) {
      throw new Error("Trusted Worker Job is not bound to an immutable Task Contract.");
    }
    const pendingPermission = this.getPermissionLeaseForJob(job.id);
    if (job.taskContractVersionId && (!pendingPermission || pendingPermission.status !== "PENDING")) {
      throw new Error("Job has no pending Permission Lease.");
    }
    const capabilitySnapshot = this.getLatestWorkerCapabilitySnapshot(job.workerId);
    if (["WORKER_SMOKE_V1", "REPOSITORY_MATERIALIZE_V1"].includes(job.workflowTemplate) && !capabilitySnapshot) {
      throw new Error("Worker has not reported a capability snapshot.");
    }
    const timestamp = now();
    const leaseId = randomBytes(8).toString("hex");
    const leaseSecret = randomBytes(32).toString("base64url");
    const leaseToken = `dls_${leaseId}.${leaseSecret}`;
    const permissionLease = pendingPermission ? this.activatePermissionLeaseForJob(job.id, timestamp) : null;
    const permissionExpiresAt = permissionLease?.expiresAt ? Date.parse(permissionLease.expiresAt) : Number.POSITIVE_INFINITY;
    const leaseExpiresAt = new Date(Math.min(Date.parse(timestamp) + this.leaseDurationMs, permissionExpiresAt)).toISOString();
    const claimed = this.db.prepare("UPDATE job_runs SET status='RUNNING', started_at=?, lease_id=?, lease_token_hash=?, lease_expires_at=?, commit_sha_before=NULL, updated_at=? WHERE id=? AND status='QUEUED' AND worker_id=?").run(
      timestamp,
      leaseId,
      workerTokenDigest(leaseSecret),
      leaseExpiresAt,
      timestamp,
      job.id,
      job.workerId,
    );
    if (Number(claimed.changes) !== 1) throw new Error("Job claim lost its ownership fence.");
    if (capabilitySnapshot) {
      this.db.prepare("INSERT INTO job_capability_evidence(job_run_id,snapshot_id,capabilities_json,captured_at) VALUES(?,?,?,?)").run(
        job.id,
        capabilitySnapshot.id,
        JSON.stringify(capabilitySnapshot.capabilities),
        timestamp,
      );
    }
    const worker = this.getWorker(job.workerId);
    if (worker) {
      const updated = { ...worker, status: "BUSY" as const, activeJobs: worker.activeJobs + 1, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET status='BUSY', data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(updated), timestamp, worker.id);
    }
    const claimEvent = this.appendJobEvent(job.id, "STATUS", "INFO", "Worker claimed the accepted job", { leaseId, leaseExpiresAt, executor: job.executor });
    if (contract) {
      this.appendEvidenceLedgerEntry(job.id, "JOB_CLAIMED", "job_run_event", claimEvent.id, {
        workerId: job.workerId,
        executionLeaseId: leaseId,
        executionLeaseExpiresAt: leaseExpiresAt,
        permissionLeaseId: permissionLease?.id,
        contractSha256: contract.contractSha256,
      }, timestamp);
    }
    return { task: this.transitionUnsafe(task, "RUNNING", { kind: "WORKER", id: job.workerId }, "Worker claimed the job with an active lease", "WORKER_CLAIMED"), leaseToken };
  }

  private insertArtifact(task: TaskRecord, job: JobRunRecord, artifactType: string, fileName: string, mimeType: string, content: string): EvidenceArtifactRecord {
    const digest = getEvidenceDigest(content);
    const timestamp = now();
    const artifact: EvidenceArtifactRecord = {
      id: randomUUID(),
      taskId: task.id,
      workerId: job.workerId,
      jobRunId: job.id,
      artifactType,
      fileName,
      mimeType,
      size: digest.size,
      sha256: digest.sha256,
      storagePath: `task/${task.id}/job/${job.id}/${randomUUID()}-${fileName}`,
      content,
      createdAt: timestamp
    };
    this.db.prepare("INSERT INTO evidence_artifacts(id,task_id,worker_id,job_run_id,artifact_type,file_name,mime_type,size,sha256,storage_path,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      artifact.id,
      artifact.taskId,
      artifact.workerId,
      artifact.jobRunId,
      artifact.artifactType,
      artifact.fileName,
      artifact.mimeType,
      artifact.size,
      artifact.sha256,
      artifact.storagePath,
      artifact.content,
      timestamp,
      timestamp
    );
    return artifact;
  }

  private generateDemoEvidence(task: TaskRecord, job: JobRunRecord): void {
    const existing = this.row("SELECT id FROM evidence_artifacts WHERE job_run_id = ? LIMIT 1", job.id);
    if (existing) return;
    const command = { commandId: "NPM_TEST", exitCode: 0, stdout: "12 tests passed", stderr: "" };
    const tests = { total: 12, passed: 12, failed: 0, skipped: 0 };
    const build = { commandId: "NPM_BUILD", success: true, exitCode: 0 };
    const diff = {
      patch: "diff --git a/src/auth/session.ts b/src/auth/session.ts\n- return elapsed > ttl\n+ return elapsed >= ttl",
      changedFiles: ["src/auth/session.ts", "src/auth/session.test.ts", "CHANGELOG.md"]
    };
    const manifest = { paths: ["src/auth/session.ts", "src/auth/session.test.ts", "package.json"] };
    this.insertArtifact(task, job, "COMMAND_RESULT", "npm-test.json", "application/json", JSON.stringify(command));
    this.insertArtifact(task, job, "TEST_RESULT", "test-results.json", "application/json", JSON.stringify(tests));
    this.insertArtifact(task, job, "BUILD_RESULT", "build-result.json", "application/json", JSON.stringify(build));
    this.insertArtifact(task, job, "GIT_DIFF", "changes.diff", "text/x-diff", JSON.stringify(diff));
    this.insertArtifact(task, job, "FILE_MANIFEST", "file-manifest.json", "application/json", JSON.stringify(manifest));
    this.insertArtifact(task, job, "SCREENSHOT", "test-report.png", "image/png", "SIMULATED_PNG_EVIDENCE_FOR_DEMO_MODE");
    this.appendJobEvent(job.id, "EVIDENCE", "SUCCESS", "Evidence pack uploaded and artifact hashes calculated", { artifacts: 6 });
  }

  private runJobStep(task: TaskRecord): TaskRecord {
    const job = this.getLatestJob(task.id);
    if (!job) throw new Error("Running task has no job run.");
    const countRow = this.row("SELECT COUNT(*) AS count FROM job_run_events WHERE job_run_id = ?", job.id);
    const count = countRow ? number(countRow.count) : 0;
    if (count <= 1) {
      this.appendJobEvent(job.id, "LOG", "INFO", "Created an isolated one-time demo workspace");
      this.appendJobEvent(job.id, "PROGRESS", "INFO", "Repository inspected; reproducing authentication failures", { percent: 28 });
      return task;
    }
    if (count <= 3) {
      this.appendJobEvent(job.id, "FILE_CHANGE", "INFO", "Adjusted session timeout boundary and strengthened its regression test", { files: ["src/auth/session.ts", "src/auth/session.test.ts"] });
      this.appendJobEvent(job.id, "TEST", "SUCCESS", "Authentication suite completed: 12 passed, 0 failed", { total: 12, passed: 12, failed: 0 });
      this.appendJobEvent(job.id, "BUILD", "SUCCESS", "Production build completed with exit code 0", { exitCode: 0 });
      this.generateDemoEvidence(task, job);
      return task;
    }

    const timestamp = now();
    this.db.prepare("UPDATE job_runs SET status='SUBMITTED', ended_at=?, exit_code=0, commit_sha_after=?, updated_at=? WHERE id=?").run(timestamp, "c73a1e52", timestamp, job.id);
    this.reconcileWorkerCapacity(job.workerId);
    this.appendJobEvent(job.id, "STATUS", "SUCCESS", "Demo executor submitted a structured result", { exitCode: 0, changedFiles: 3 });
    return this.transitionUnsafe(task, "SUBMITTED", { kind: "WORKER", id: job.workerId }, "Worker submitted logs, patch and evidence", "EVIDENCE_SUBMITTED");
  }

  private artifactsToEvidence(task: TaskRecord, job: JobRunRecord): EvidenceInput[] {
    const artifacts = this.rows("SELECT * FROM evidence_artifacts WHERE job_run_id = ? ORDER BY created_at", job.id).map(mapArtifact);
    return artifacts.map((artifact): EvidenceInput => {
      const base = { id: artifact.id, createdAt: artifact.createdAt, jobRunId: job.id, workerId: job.workerId };
      const structured = artifact.mimeType === "application/json" || artifact.artifactType === "GIT_DIFF" ? (JSON.parse(artifact.content) as Record<string, unknown>) : {};
      switch (artifact.artifactType) {
        case "COMMAND_RESULT":
          return { ...base, type: "COMMAND", commandId: String(structured.commandId), exitCode: Number(structured.exitCode), stdout: String(structured.stdout ?? ""), stderr: String(structured.stderr ?? "") };
        case "TEST_RESULT":
          return { ...base, type: "TEST", total: Number(structured.total), passed: Number(structured.passed), failed: Number(structured.failed), skipped: Number(structured.skipped) };
        case "BUILD_RESULT":
          return { ...base, type: "BUILD", commandId: String(structured.commandId), success: Boolean(structured.success), exitCode: Number(structured.exitCode) };
        case "GITHUB_CHECK_RESULT":
          return {
            ...base,
            type: "GITHUB_CHECK",
            checkName: String(structured.checkName),
            repository: structured.repository ? String(structured.repository) : undefined,
            status: String(structured.status) as "SUCCESS" | "FAILURE" | "PENDING",
            commitSha: structured.commitSha ? String(structured.commitSha) : undefined
          };
        case "GIT_DIFF":
          return { ...base, type: "DIFF", patch: String(structured.patch), changedFiles: structured.changedFiles as string[] };
        case "FILE_MANIFEST":
          return { ...base, type: "FILE_MANIFEST", paths: structured.paths as string[] };
        case "PULL_REQUEST":
          return { ...base, type: "PULL_REQUEST", url: String(structured.url), number: Number(structured.number), state: String(structured.state) as "OPEN" | "CLOSED" | "MERGED", targetBranch: String(structured.targetBranch) };
        case "HUMAN_APPROVAL":
          return { ...base, type: "HUMAN_APPROVAL", actorKind: "CUSTOMER", actorId: task.customerId, approved: true, approvedAt: artifact.createdAt };
        default:
          return {
            ...base,
            type: "ARTIFACT",
            artifactType: artifact.artifactType === "SCREENSHOT" ? "SCREENSHOT" : "OTHER",
            fileName: artifact.fileName,
            mimeType: artifact.mimeType,
            size: artifact.size,
            sha256: artifact.sha256,
            storagePath: artifact.storagePath
          };
      }
    });
  }

  private verifyTask(task: TaskRecord): TaskRecord {
    const job = this.getLatestJob(task.id);
    if (!job) throw new Error("Submitted task has no job run.");
    const approvalExists = this.row("SELECT id FROM evidence_artifacts WHERE job_run_id=? AND artifact_type='HUMAN_APPROVAL'", job.id);
    if (!approvalExists) {
      this.insertArtifact(task, job, "HUMAN_APPROVAL", "customer-approval.json", "application/json", JSON.stringify({ actorKind: "CUSTOMER", actorId: task.customerId, approved: true }));
    }
    const proof = evaluateProofOfDone(task.acceptanceChecks, this.artifactsToEvidence(task, job));
    const timestamp = now();
    this.db.prepare("DELETE FROM verification_results WHERE task_id = ? AND job_run_id = ?").run(task.id, job.id);
    const insert = this.db.prepare("INSERT INTO verification_results(id,task_id,job_run_id,check_id,check_type,status,summary,observed_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
    for (const result of proof.results) {
      insert.run(
        randomUUID(),
        task.id,
        job.id,
        result.checkId,
        result.checkType,
        result.passed ? "PASSED" : "FAILED",
        result.message,
        JSON.stringify({ evidenceIds: result.evidenceIds, required: result.required }),
        timestamp,
        timestamp
      );
    }
    if (proof.passed) {
      this.db.prepare("UPDATE job_runs SET status='SUCCEEDED', updated_at=? WHERE id=?").run(timestamp, job.id);
      return this.transitionUnsafe(task, "VERIFICATION_PASSED", { kind: "SYSTEM", id: "proof-of-done" }, "Every required acceptance check passed independently", "VERIFICATION_PASSED");
    }
    return this.transitionUnsafe(task, "VERIFICATION_FAILED", { kind: "SYSTEM", id: "proof-of-done" }, "One or more required acceptance checks failed", "VERIFICATION_FAILED");
  }

  advanceDemo(taskId: string): TaskAggregate {
    return this.transaction(() => {
      let task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      switch (task.status) {
        case "DRAFT":
          task = this.transitionUnsafe(task, "PUBLISHED", { kind: "CUSTOMER", id: task.customerId }, "Customer published the reviewed task scope", "TASK_PUBLISHED");
          break;
        case "PUBLISHED":
          task = this.transitionUnsafe(task, "ANALYZING", { kind: "SYSTEM", id: "task-analyzer" }, "Rule-based analyzer started", "ANALYSIS_STARTED");
          break;
        case "ANALYZING":
          this.setAnalysis(task);
          task = this.getTask(task.id) ?? task;
          task = this.transitionUnsafe(task, "MATCHING", { kind: "SYSTEM", id: "task-analyzer" }, "Scope, capabilities, risk and verification checks were analyzed", "ANALYSIS_COMPLETED");
          break;
        case "MATCHING": {
          const matches = this.matchTask(task);
          task = this.getTask(task.id) ?? task;
          task = this.transitionUnsafe(task, "MATCHED", { kind: "SYSTEM", id: "matching-engine" }, `Ranked ${matches.length} eligible agent candidates`, "AGENT_MATCHED");
          break;
        }
        case "MATCHED":
          task = this.transitionUnsafe(task, "AWAITING_PROVIDER", { kind: "SYSTEM", id: "dispatch" }, "Top-ranked agent received a privacy-scoped offer", "OFFER_SENT");
          break;
        case "AWAITING_PROVIDER":
          task = this.acceptAssignment(task);
          break;
        case "ASSIGNED":
          task = this.claimJob(task).task;
          break;
        case "RUNNING":
          task = this.runJobStep(task);
          break;
        case "SUBMITTED":
          task = this.transitionUnsafe(task, "VERIFYING", { kind: "SYSTEM", id: "proof-of-done" }, "Independent verifier started against immutable evidence", "VERIFICATION_STARTED");
          break;
        case "VERIFYING":
          task = this.verifyTask(task);
          break;
        case "VERIFICATION_PASSED":
          task = this.transitionUnsafe(task, "CUSTOMER_REVIEW", { kind: "SYSTEM", id: "proof-of-done" }, "Verified evidence pack is ready for customer review", "CUSTOMER_REVIEW_REQUESTED");
          break;
        case "CUSTOMER_REVIEW":
          task = this.completeAndRelease(task);
          break;
        default:
          break;
      }
      return this.getTaskAggregate(task.id);
    });
  }

  private reserve(taskId: string, customerId: string, amountCents: number): void {
    const key = `reserve:${taskId}`;
    if (this.row("SELECT id FROM test_ledger_entries WHERE transaction_key = ? LIMIT 1", key)) return;
    const customer = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='CUSTOMER'", customerId);
    const escrow = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='ESCROW'", ESCROW_ID);
    if (!customer || !escrow || number(customer.available_cents) < amountCents) throw new Error("Insufficient test balance.");
    const timestamp = now();
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents-?, reserved_cents=reserved_cents+?, updated_at=? WHERE id=?").run(amountCents, amountCents, timestamp, string(customer.id));
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, updated_at=? WHERE id=?").run(amountCents, timestamp, string(escrow.id));
    this.insertLedger(taskId, string(customer.id), key, "RESERVE", -amountCents);
    this.insertLedger(taskId, string(escrow.id), key, "RESERVE", amountCents);
  }

  private insertLedger(taskId: string, walletId: string, transactionKey: string, entryType: LedgerEntryRecord["entryType"], amountCents: number): void {
    const timestamp = now();
    this.db.prepare("INSERT INTO test_ledger_entries(id,task_id,wallet_id,transaction_key,entry_type,amount_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(
      randomUUID(),
      taskId,
      walletId,
      transactionKey,
      entryType,
      amountCents,
      timestamp,
      timestamp
    );
  }

  private release(task: TaskRecord): void {
    const key = `release:${task.id}`;
    if (this.row("SELECT id FROM test_ledger_entries WHERE transaction_key=? LIMIT 1", key)) return;
    const providerAmount = Math.round(task.budgetCents * 0.8);
    const fee = task.budgetCents - providerAmount;
    const customer = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='CUSTOMER'", task.customerId);
    const provider = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='PROVIDER'", PROVIDER_ALPHA_ID);
    const platform = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='PLATFORM'", PLATFORM_ID);
    const escrow = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='ESCROW'", ESCROW_ID);
    if (!customer || !provider || !platform || !escrow || number(escrow.available_cents) < task.budgetCents) throw new Error("Ledger invariant failed during release.");
    const timestamp = now();
    this.db.prepare("UPDATE test_wallets SET reserved_cents=reserved_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(customer.id));
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(escrow.id));
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, updated_at=? WHERE id=?").run(providerAmount, timestamp, string(provider.id));
    this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, updated_at=? WHERE id=?").run(fee, timestamp, string(platform.id));
    this.insertLedger(task.id, string(escrow.id), key, "RELEASE", -task.budgetCents);
    this.insertLedger(task.id, string(provider.id), key, "RELEASE", providerAmount);
    this.insertLedger(task.id, string(platform.id), key, "PLATFORM_FEE", fee);
  }

  private completeAndRelease(task: TaskRecord): TaskRecord {
    const failed = this.row("SELECT id FROM verification_results WHERE task_id=? AND status!='PASSED' LIMIT 1", task.id);
    const requiredCount = task.acceptanceChecks.filter((check) => check.required).length;
    const passedRow = this.row("SELECT COUNT(*) AS count FROM verification_results WHERE task_id=? AND status='PASSED'", task.id);
    if (failed || !passedRow || number(passedRow.count) < requiredCount) throw new Error("Task cannot complete before every required check passes.");
    this.release(task);
    const assignment = this.getLatestAssignment(task.id);
    if (assignment) this.db.prepare("UPDATE task_assignments SET status='COMPLETED', updated_at=? WHERE id=?").run(now(), assignment.id);
    return this.transitionUnsafe(task, "COMPLETED", { kind: "CUSTOMER", id: task.customerId }, "Customer accepted the verified delivery and released the test ledger", "CUSTOMER_ACCEPTED");
  }

  refundTask(taskId: string, actor: Actor): void {
    this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      if (actor.kind !== "CUSTOMER" && actor.kind !== "ADMIN") throw new Error("Only the customer or admin may refund a task.");
      const key = `refund:${task.id}`;
      if (this.row("SELECT id FROM test_ledger_entries WHERE transaction_key=? LIMIT 1", key)) return;
      const customer = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='CUSTOMER'", task.customerId);
      const escrow = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='ESCROW'", ESCROW_ID);
      if (!customer || !escrow || number(escrow.available_cents) < task.budgetCents) throw new Error("No reserved amount is available to refund.");
      const timestamp = now();
      this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, reserved_cents=reserved_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, task.budgetCents, timestamp, string(customer.id));
      this.db.prepare("UPDATE test_wallets SET available_cents=available_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(escrow.id));
      this.insertLedger(task.id, string(escrow.id), key, "REFUND", -task.budgetCents);
      this.insertLedger(task.id, string(customer.id), key, "REFUND", task.budgetCents);
    });
  }

  openDispute(taskId: string, actor: Actor, reason: string): DisputeRecord {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      if (actor.kind !== "ADMIN" && (actor.kind !== "CUSTOMER" || actor.id !== task.customerId)) throw new Error("Only the task customer or Admin may open a dispute.");
      if (task.status !== "CUSTOMER_REVIEW" && task.status !== "VERIFICATION_FAILED") throw new Error("A dispute can be opened only during customer review or after failed verification.");
      const existing = this.row("SELECT * FROM disputes WHERE task_id=? AND status IN ('OPEN','UNDER_REVIEW')", taskId);
      if (existing) return mapDispute(existing);
      const cleanReason = reason.trim();
      if (cleanReason.length < 10 || cleanReason.length > 5000) throw new Error("Provide a dispute reason between 10 and 5000 characters.");
      const key = `hold:${task.id}`;
      const escrow = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind='ESCROW'", ESCROW_ID);
      const hold = this.row("SELECT * FROM test_wallets WHERE kind='DISPUTE' LIMIT 1");
      if (!escrow || !hold || number(escrow.available_cents) < task.budgetCents) throw new Error("Reserved funds are not available for dispute hold.");
      const timestamp = now();
      this.db.prepare("UPDATE test_wallets SET available_cents=available_cents-?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(escrow.id));
      this.db.prepare("UPDATE test_wallets SET available_cents=available_cents+?, updated_at=? WHERE id=?").run(task.budgetCents, timestamp, string(hold.id));
      this.insertLedger(task.id, string(escrow.id), key, "DISPUTE_HOLD", -task.budgetCents);
      this.insertLedger(task.id, string(hold.id), key, "DISPUTE_HOLD", task.budgetCents);
      const dispute: DisputeRecord = { id: randomUUID(), taskId, openedBy: actor.id, reason: cleanReason, status: "OPEN", heldAmountCents: task.budgetCents, resolution: null, createdAt: timestamp, updatedAt: timestamp };
      this.db.prepare("INSERT INTO disputes(id,task_id,opened_by,reason,status,held_amount_cents,resolution,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?,?)").run(dispute.id, taskId, actor.id, cleanReason, dispute.status, dispute.heldAmountCents, timestamp, timestamp);
      const receipt = this.row("SELECT id FROM job_receipts WHERE task_id=? AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1", taskId);
      if (receipt) {
        this.db.prepare("UPDATE job_receipts SET invalidated_at=?, invalidation_reason='Task dispute opened' WHERE id=? AND invalidated_at IS NULL").run(
          timestamp,
          string(receipt.id),
        );
        this.insertAudit(actor, "JOB_RECEIPT_INVALIDATED", "job_receipt", string(receipt.id), { taskId, disputeId: dispute.id });
      }
      this.transitionUnsafe(task, "DISPUTED", actor, "Customer opened a dispute and funds moved to dispute hold", "DISPUTE_OPENED");
      return dispute;
    });
  }

  listDisputes(): DisputeRecord[] {
    return this.rows("SELECT * FROM disputes ORDER BY created_at DESC").map(mapDispute);
  }

  listAuditLogs(limit = 100): AuditLogRecord[] {
    return this.rows("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?", Math.max(1, Math.min(500, limit))).map(mapAudit);
  }

  recordWebhookReceipt(source: string, deliveryId: string, eventType: string, bodySha256: string): boolean {
    return this.transaction(() => {
      if (this.row("SELECT id FROM webhook_receipts WHERE source=? AND delivery_id=?", source, deliveryId)) return false;
      const timestamp = now();
      this.db.prepare("INSERT INTO webhook_receipts(id,source,delivery_id,event_type,body_sha256,verified,processed,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)").run(randomUUID(), source, deliveryId, eventType, bodySha256, timestamp, timestamp);
      this.insertAudit({ kind: "SYSTEM", id: source }, "WEBHOOK_ACCEPTED", "webhook_delivery", deliveryId, { eventType, bodySha256 });
      return true;
    });
  }

  recordAgentCallback(agentId: string, jobRunId: string, callbackType: "status" | "result" | "error", payload: Record<string, unknown>): void {
    this.transaction(() => {
      const job = this.getJobRun(jobRunId);
      if (!job || job.agentId !== agentId) throw new Error("Callback does not belong to this Agent job.");
      const level: JobEventRecord["level"] = callbackType === "error" ? "ERROR" : callbackType === "result" ? "SUCCESS" : "INFO";
      const message = typeof payload.message === "string" ? payload.message : typeof payload.summary === "string" ? payload.summary : `Webhook Agent ${callbackType} callback received`;
      this.appendJobEvent(jobRunId, callbackType === "status" ? "PROGRESS" : "STATUS", level, message, { source: "WEBHOOK_AGENT", ...payload });
      this.insertAudit({ kind: "SYSTEM", id: `webhook-agent:${agentId}` }, "AGENT_CALLBACK_RECORDED", "job_run", jobRunId, { callbackType });
    });
  }

  listProfiles(): ProfileRecord[] {
    return this.rows("SELECT * FROM profiles ORDER BY created_at").map((row) => ({
      id: string(row.id),
      name: string(row.name),
      role: string(row.role) as ProfileRecord["role"],
      createdAt: string(row.created_at),
      updatedAt: string(row.updated_at)
    }));
  }

  adminSuspendWorker(workerId: string, adminId: string): WorkerRecord {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker not found.");
      const timestamp = now();
      const updated: WorkerRecord = { ...worker, status: "SUSPENDED", acceptingJobs: false, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET status='SUSPENDED', data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(updated), timestamp, workerId);
      this.insertAudit({ kind: "ADMIN", id: adminId }, "WORKER_SUSPENDED", "worker", workerId);
      return updated;
    });
  }

  adminSuspendAgent(agentId: string, adminId: string): AgentRecord {
    return this.transaction(() => {
      const agent = this.getAgentById(agentId);
      if (!agent) throw new Error("Agent not found.");
      const timestamp = now();
      const updated: AgentRecord = { ...agent, verificationStatus: "SUSPENDED", acceptingTasks: false, updatedAt: timestamp };
      this.db.prepare("UPDATE agents SET data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(updated), timestamp, agentId);
      this.insertAudit({ kind: "ADMIN", id: adminId }, "AGENT_SUSPENDED", "agent", agentId);
      return updated;
    });
  }

  adminRematchTask(taskId: string, adminId: string): TaskRecord {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) throw new Error("Task not found.");
      if (task.status !== "MATCHED" && task.status !== "AWAITING_PROVIDER" && task.status !== "ASSIGNED") throw new Error("Task cannot be rematched from its current state.");
      this.db.prepare("DELETE FROM task_matches WHERE task_id=?").run(taskId);
      this.db.prepare("UPDATE tasks SET matched_agent_id=NULL, assigned_worker_id=NULL, updated_at=? WHERE id=?").run(now(), taskId);
      return this.transitionUnsafe(task, "MATCHING", { kind: "ADMIN", id: adminId }, "Admin requested manual rematching", "ADMIN_REMATCHED");
    });
  }

  getTaskAggregate(taskId: string): TaskAggregate {
    const task = this.getTask(taskId);
    if (!task) throw new Error("Task not found.");
    const matchRows = this.rows("SELECT * FROM task_matches WHERE task_id=? ORDER BY rank", taskId).map(mapMatch);
    const matches = matchRows.flatMap((match) => {
      const agent = this.getAgentById(match.agentId);
      return agent ? [{ ...match, agent }] : [];
    });
    const assignment = this.getLatestAssignment(taskId);
    const jobRun = this.getLatestJob(taskId);
    const taskContract = jobRun?.taskContractVersionId
      ? this.getTaskContractVersion(jobRun.taskContractVersionId)
      : this.getLockedTaskContract(taskId);
    const permissionLease = jobRun ? this.getPermissionLeaseForJob(jobRun.id) : null;
    const evidenceLedger = jobRun ? this.listEvidenceLedgerEntries(jobRun.id) : [];
    return {
      task,
      events: this.rows("SELECT * FROM task_events WHERE task_id=? ORDER BY sequence", taskId).map(mapTaskEvent),
      matches,
      agent: task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null,
      worker: task.assignedWorkerId ? this.getWorker(task.assignedWorkerId) : null,
      assignment,
      jobRun,
      jobAttempt: jobRun ? this.getJobRunAttempt(jobRun.id) : null,
      capabilityEvidence: jobRun ? this.getJobCapabilityEvidence(jobRun.id) : null,
      jobEvents: jobRun ? this.rows("SELECT * FROM job_run_events WHERE job_run_id=? ORDER BY sequence", jobRun.id).map(mapJobEvent) : [],
      evidence: jobRun ? this.rows(
        `SELECT e.*,COALESCE(u.expected_sha256,e.claimed_sha256) AS claimed_sha256,COALESCE(o.server_sha256,e.server_sha256) AS server_sha256
         FROM evidence_artifacts e
         LEFT JOIN artifact_uploads u ON u.id=e.id
         LEFT JOIN artifact_upload_observations o ON o.artifact_id=e.id
         WHERE e.job_run_id=?
         ORDER BY e.created_at`,
        jobRun.id,
      ).map(mapArtifact) : [],
      verificationResults: jobRun ? this.rows("SELECT * FROM verification_results WHERE job_run_id=? ORDER BY created_at", jobRun.id).map(mapVerification) : [],
      taskContract,
      permissionLease,
      evidenceLedger,
      evidenceLedgerVerification: verifyEvidenceLedgerEntries(evidenceLedger),
      receipt: jobRun ? this.getJobReceiptByJobRun(jobRun.id) : null,
      ledgerEntries: this.rows("SELECT * FROM test_ledger_entries WHERE task_id=? ORDER BY created_at", taskId).map(mapLedger)
    };
  }

  getWallet(ownerId: string, kind: WalletRecord["kind"]): WalletRecord {
    const found = this.row("SELECT * FROM test_wallets WHERE owner_id=? AND kind=?", ownerId, kind);
    if (!found) throw new Error("Wallet not found.");
    return mapWallet(found);
  }

  listAssignments(providerId?: string): AssignmentRecord[] {
    const found = providerId
      ? this.rows("SELECT * FROM task_assignments WHERE provider_id=? ORDER BY created_at DESC", providerId)
      : this.rows("SELECT * FROM task_assignments ORDER BY created_at DESC");
    return found.map(mapAssignment);
  }

  getJobRun(jobId: string): JobRunRecord | null {
    const found = this.row("SELECT * FROM job_runs WHERE id=?", jobId);
    return found ? mapJobRun(found) : null;
  }

  getJobRunAttempt(jobRunId: string): JobRunAttemptRecord | null {
    const found = this.row("SELECT * FROM job_run_attempts WHERE job_run_id=?", jobRunId);
    return found ? mapJobAttempt(found) : null;
  }

  getJobCapabilityEvidence(jobRunId: string): JobCapabilityEvidenceRecord | null {
    const found = this.row("SELECT * FROM job_capability_evidence WHERE job_run_id=?", jobRunId);
    return found ? mapJobCapabilityEvidence(found) : null;
  }

  getLatestWorkerCapabilitySnapshot(workerId: string): WorkerCapabilitySnapshotRecord | null {
    const found = this.row(
      "SELECT * FROM worker_capability_snapshots WHERE worker_id=? ORDER BY reported_at DESC, rowid DESC LIMIT 1",
      workerId,
    );
    return found ? mapCapabilitySnapshot(found) : null;
  }

  listWorkerHeartbeats(workerId: string): WorkerHeartbeatRecord[] {
    return this.rows(
      "SELECT * FROM worker_heartbeats WHERE worker_id=? ORDER BY received_at, rowid",
      workerId,
    ).map(mapWorkerHeartbeat);
  }

  listJobRuns(providerId?: string): JobRunRecord[] {
    const found = providerId
      ? this.rows("SELECT j.* FROM job_runs j JOIN task_assignments a ON a.id=j.assignment_id WHERE a.provider_id=? ORDER BY j.created_at DESC", providerId)
      : this.rows("SELECT * FROM job_runs ORDER BY created_at DESC");
    return found.map(mapJobRun);
  }

  listProviderTasks(providerId: string): TaskRecord[] {
    return this.listTasks().filter((task) => {
      if (!task.matchedAgentId) return false;
      return this.getAgentById(task.matchedAgentId)?.providerId === providerId;
    });
  }

  acceptTaskAsProvider(taskId: string, providerId: string): TaskAggregate {
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task || task.status !== "AWAITING_PROVIDER") throw new Error("Task is not awaiting provider acceptance.");
      const agent = task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null;
      if (!agent || agent.providerId !== providerId) throw new Error("This task is not offered to your provider account.");
      this.acceptAssignment(task);
      return this.getTaskAggregate(taskId);
    });
  }

  providerTaskDecision(taskId: string, providerId: string, decision: "ACCEPT" | "DECLINE" | "LATER"): TaskAggregate {
    if (decision === "ACCEPT") return this.acceptTaskAsProvider(taskId, providerId);
    return this.transaction(() => {
      const task = this.getTask(taskId);
      if (!task || task.status !== "AWAITING_PROVIDER") throw new Error("Task is not awaiting a provider decision.");
      const agent = task.matchedAgentId ? this.getAgentById(task.matchedAgentId) : null;
      const match = this.row("SELECT * FROM task_matches WHERE task_id=? AND rank=1", taskId);
      if (!agent || !match || agent.providerId !== providerId) throw new Error("This offer is not assigned to your provider account.");
      if (decision === "LATER") {
        this.insertTaskEvent(task.id, task.status, task.status, { kind: "PROVIDER", id: providerId }, "Provider scheduled the offer for later review", "PROVIDER_DEFERRED");
        return this.getTaskAggregate(taskId);
      }
      const timestamp = now();
      this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,'DECLINED',?,?,?,NULL,?,?)").run(
        randomUUID(),
        task.id,
        agent.id,
        providerId,
        string(match.worker_id),
        task.budgetCents,
        Math.round(task.budgetCents * 0.8),
        task.budgetCents - Math.round(task.budgetCents * 0.8),
        timestamp,
        timestamp
      );
      this.transitionUnsafe(task, "MATCHING", { kind: "PROVIDER", id: providerId }, "Provider declined the task offer", "PROVIDER_DECLINED");
      return this.getTaskAggregate(taskId);
    });
  }

  createWorker(providerId: string, name: string, os: WorkerRecord["os"]): WorkerRecord {
    return this.transaction(() => {
      const timestamp = now();
      const worker: WorkerRecord = {
        id: randomUUID(),
        providerId,
        name: name.trim().slice(0, 100) || "New Worker",
        status: "OFFLINE",
        os,
        installedTools: [],
        mcpTools: [],
        executors: ["DEMO"],
        maxConcurrentJobs: 1,
        activeJobs: 0,
        lastHeartbeatAt: timestamp,
        tokenHash: null,
        tokenId: null,
        acceptingJobs: true,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.db.prepare("INSERT INTO worker_nodes(id,provider_id,status,token_hash,token_id,data_json,created_at,updated_at) VALUES(?,?,?,NULL,NULL,?,?,?)").run(
        worker.id,
        providerId,
        worker.status,
        JSON.stringify(worker),
        timestamp,
        timestamp
      );
      this.insertAudit({ kind: "PROVIDER", id: providerId }, "WORKER_CREATED", "worker", worker.id, { os });
      return worker;
    });
  }

  createAgent(input: {
    providerId: string;
    providerName: string;
    name: string;
    slug: string;
    description: string;
    skills: string[];
    taskTypes: AgentRecord["taskTypes"];
    languages: string[];
    operatingSystems: string[];
    tools: string[];
    requiredMcpServers: string[];
    pricingModel: AgentRecord["pricingModel"];
    basePriceCents: number;
    endpointType: AgentRecord["endpointType"];
    endpointUrl: string | null;
    authenticationType: AgentRecord["authenticationType"];
    inputModes: string[];
    outputModes: string[];
  }): AgentRecord {
    return this.transaction(() => {
      if (this.getAgentBySlug(input.slug)) throw new Error("Agent slug is already in use.");
      const timestamp = now();
      const agent: AgentRecord = {
        id: randomUUID(),
        slug: input.slug,
        name: input.name,
        version: "1.0.0",
        providerId: input.providerId,
        providerName: input.providerName,
        description: input.description,
        skills: input.skills,
        taskTypes: input.taskTypes,
        languages: input.languages,
        operatingSystems: input.operatingSystems,
        tools: input.tools,
        requiredMcpServers: input.requiredMcpServers,
        pricingModel: input.pricingModel,
        basePriceCents: input.basePriceCents,
        averageCompletionMinutes: 120,
        completedTasks: 0,
        verifiedSuccessRate: 0,
        rating: 0,
        workerStatus: "OFFLINE",
        lastActiveAt: timestamp,
        verificationStatus: "PENDING",
        endpointType: input.endpointType,
        endpointUrl: input.endpointUrl,
        authenticationType: input.authenticationType,
        inputModes: input.inputModes,
        outputModes: input.outputModes,
        acceptingTasks: false,
        recentFailures: 0,
        currentWorkload: 0,
        maxConcurrentJobs: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.db.prepare("INSERT INTO agents(id,slug,provider_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(agent.id, agent.slug, agent.providerId, JSON.stringify(agent), timestamp, timestamp);
      const identity = this.createInitialAgentIdentityProfile(agent);
      this.insertAgentIdentityProfile(identity);
      this.insertAudit({ kind: "PROVIDER", id: input.providerId }, "AGENT_CREATED", "agent", agent.id, { endpointType: input.endpointType });
      this.insertAudit(
        { kind: "PROVIDER", id: input.providerId },
        "AGENT_IDENTITY_REGISTERED",
        "agent_identity_profile",
        `${identity.agentId}:${identity.revision}`,
        { profileSha256: identity.profileSha256, source: "AGENT_CREATION" },
      );
      return agent;
    });
  }

  getDashboardSnapshot(): DashboardSnapshot {
    const tasks = this.listTasks();
    const taskCounts: Record<string, number> = {};
    for (const task of tasks) taskCounts[task.status] = (taskCounts[task.status] ?? 0) + 1;
    return {
      taskCounts,
      tasks,
      customerWallet: this.getWallet(CUSTOMER_ID, "CUSTOMER"),
      providerWallet: this.getWallet(PROVIDER_ALPHA_ID, "PROVIDER"),
      platformWallet: this.getWallet(PLATFORM_ID, "PLATFORM"),
      agents: this.listAgents(),
      workers: this.listWorkers()
    };
  }

  createPairingCode(workerId: string, providerId: string): { code: string; expiresAt: string } {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker || worker.providerId !== providerId) throw new Error("Worker not found for this provider.");
      const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
      const bytes = randomBytes(12);
      const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
      const code = `DL-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
      const expiresAt = new Date(Date.now() + this.pairingCodeTtlMs).toISOString();
      const timestamp = now();
      this.db.prepare("INSERT INTO worker_pairing_codes(id,worker_id,code_hash,expires_at,consumed_at,attempts,created_at,updated_at) VALUES(?,?,?,?,NULL,0,?,?)").run(
        randomUUID(),
        workerId,
        pairingDigest(code),
        expiresAt,
        timestamp,
        timestamp
      );
      this.insertAudit({ kind: "PROVIDER", id: providerId }, "PAIRING_CODE_CREATED", "worker", workerId, { expiresAt });
      return { code, expiresAt };
    });
  }

  pairWorker(code: string): { workerId: string; token: string; pairedAt: string } {
    return this.transaction(() => {
      const digest = pairingDigest(code);
      const pairing = this.row("SELECT * FROM worker_pairing_codes WHERE code_hash=?", digest);
      if (!pairing || nullableString(pairing.consumed_at) || Date.parse(string(pairing.expires_at)) <= Date.now() || number(pairing.attempts) >= 5) {
        if (pairing) this.db.prepare("UPDATE worker_pairing_codes SET attempts=attempts+1, updated_at=? WHERE id=?").run(now(), string(pairing.id));
        throw new Error("Pairing code is invalid or expired.");
      }
      const workerId = string(pairing.worker_id);
      const tokenId = randomBytes(8).toString("hex");
      const secret = randomBytes(32).toString("base64url");
      const token = `dwk_${tokenId}.${secret}`;
      const timestamp = now();
      this.db.prepare("UPDATE worker_pairing_codes SET consumed_at=?, updated_at=? WHERE id=?").run(timestamp, timestamp, string(pairing.id));
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker no longer exists.");
      const updated: WorkerRecord = { ...worker, tokenHash: workerTokenDigest(secret), tokenId, status: "ONLINE", lastHeartbeatAt: timestamp, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET token_hash=?, token_id=?, status='ONLINE', data_json=?, updated_at=? WHERE id=?").run(updated.tokenHash, tokenId, JSON.stringify(updated), timestamp, workerId);
      this.insertAudit({ kind: "WORKER", id: workerId }, "WORKER_PAIRED", "worker", workerId);
      return { workerId, token, pairedAt: timestamp };
    });
  }

  authenticateWorker(token: string): WorkerRecord | null {
    const match = /^dwk_([a-f0-9]{16})\.([A-Za-z0-9_-]{40,})$/.exec(token);
    if (!match?.[1] || !match[2]) return null;
    const found = this.row("SELECT * FROM worker_nodes WHERE token_id=?", match[1]);
    if (!found) return null;
    const worker = mapWorker(found);
    const actual = workerTokenDigest(match[2]);
    return worker.tokenHash && safeEqualHex(worker.tokenHash, actual) ? worker : null;
  }

  private validateJobLease(jobRunId: string, workerId: string, leaseToken: string): JobRunRecord {
    const match = /^dls_([a-f0-9]{16})\.([A-Za-z0-9_-]{40,})$/.exec(leaseToken);
    const job = this.getJobRun(jobRunId);
    if (!match?.[1] || !match[2] || !job || job.workerId !== workerId || job.leaseId !== match[1] || !job.leaseTokenHash) throw new Error("Job lease is invalid.");
    if (!safeEqualHex(job.leaseTokenHash, workerTokenDigest(match[2]))) throw new Error("Job lease is invalid.");
    if (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new Error("Job lease has expired.");
    if (job.status !== "RUNNING") throw new Error("Job run is not active.");
    const attempt = this.getJobRunAttempt(jobRunId);
    if (attempt?.leaseRevokedAt) throw new Error("Job lease has been revoked.");
    if (job.taskContractVersionId) this.assertPermissionLeaseActive(jobRunId, workerId);
    return job;
  }

  renewJobLease(jobRunId: string, workerId: string, leaseToken: string): string {
    return this.transaction(() => {
      const job = this.validateJobLease(jobRunId, workerId, leaseToken);
      const permissionLease = job.taskContractVersionId
        ? this.assertPermissionLeaseActive(jobRunId, workerId)
        : null;
      const permissionExpiresAt = permissionLease?.expiresAt
        ? Date.parse(permissionLease.expiresAt)
        : Number.POSITIVE_INFINITY;
      const leaseExpiresAt = new Date(Math.min(Date.now() + this.leaseDurationMs, permissionExpiresAt)).toISOString();
      const renewed = this.db.prepare("UPDATE job_runs SET lease_expires_at=?, updated_at=? WHERE id=? AND status='RUNNING' AND lease_id=? AND lease_expires_at>?").run(
        leaseExpiresAt,
        now(),
        jobRunId,
        job.leaseId,
        now(),
      );
      if (Number(renewed.changes) !== 1) throw new Error("Job lease renewal lost its ownership fence.");
      return leaseExpiresAt;
    });
  }

  getJobControl(jobRunId: string, workerId: string, leaseToken: string): { cancelRequested: boolean; leaseExpiresAt: string } {
    const job = this.validateJobLease(jobRunId, workerId, leaseToken);
    return { cancelRequested: false, leaseExpiresAt: job.leaseExpiresAt ?? new Date().toISOString() };
  }

  appendWorkerProtocolEvent(
    jobRunId: string,
    workerId: string,
    leaseToken: string,
    event: { eventId: string; type: string; message: string; progress?: number; data?: Record<string, unknown>; createdAt: string }
  ): void {
    this.transaction(() => {
      const job = this.validateJobLease(jobRunId, workerId, leaseToken);
      if (this.row("SELECT id FROM job_run_events WHERE id=?", event.eventId)) return;
      if (event.type === "PERMISSION_VIOLATION") {
        const action = typeof event.data?.action === "string" ? event.data.action : "unknown";
        const reason = typeof event.data?.reason === "string" ? event.data.reason : event.message;
        const resource = typeof event.data?.resource === "string" ? event.data.resource : undefined;
        this.recordPermissionViolation(jobRunId, workerId, action, reason, resource);
        return;
      }
      const action = event.type === "WORKSPACE_PREPARED"
        ? "create_job_workspace"
        : event.type === "REPOSITORY_CLONE_STARTED" || event.type === "REPOSITORY_CLONE_COMPLETED"
          ? "git_clone_allowlisted_repository"
          : event.type === "REMOTE_METADATA_CAPTURED"
            ? "read_git_metadata"
            : event.type === "FILE_MANIFEST_CREATED"
              ? "create_file_manifest"
              : event.type === "ARTIFACT_CREATED"
                ? job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1" ? "upload_artifact" : "write_hello_txt"
                : event.type === "CLEANUP_FINISHED"
                  ? "cleanup_workspace"
                  : "report_progress";
      this.assertPermissionActionAllowed(jobRunId, workerId, action);
      const sequenceRow = this.row("SELECT COALESCE(MAX(sequence),0)+1 AS next_sequence FROM job_run_events WHERE job_run_id=?", jobRunId);
      const sequence = sequenceRow ? number(sequenceRow.next_sequence) : 1;
      const kind: JobEventRecord["kind"] = event.type === "TEST_RESULT" ? "TEST" : event.type === "BUILD_RESULT" ? "BUILD" : event.type === "FILE_CHANGED" ? "FILE_CHANGE" : event.type === "PROGRESS" ? "PROGRESS" : event.type === "ARTIFACT_CREATED" ? "EVIDENCE" : event.type === "LOG" ? "LOG" : "STATUS";
      const level: JobEventRecord["level"] = event.type.includes("FAILED") ? "ERROR" : event.type === "EXECUTOR_FINISHED" || event.type === "TEST_RESULT" || event.type === "BUILD_RESULT" ? "SUCCESS" : "INFO";
      this.db.prepare("INSERT INTO job_run_events(id,job_run_id,sequence,kind,level,message,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(
        event.eventId,
        jobRunId,
        sequence,
        kind,
        level,
        event.message.slice(0, 16_384),
        JSON.stringify({ eventType: event.type, progress: event.progress, data: event.data ?? {} }),
        event.createdAt,
        now()
      );
      const ledgerType: EvidenceLedgerEntryType | null = event.type === "EXECUTOR_STARTED"
        ? "EXECUTION_STARTED"
        : event.type === "REPOSITORY_CLONE_STARTED"
          ? "REPOSITORY_CLONE_STARTED"
          : event.type === "REPOSITORY_CLONE_COMPLETED"
            ? "REPOSITORY_CLONE_COMPLETED"
            : event.type === "REMOTE_METADATA_CAPTURED"
              ? "REMOTE_METADATA_CAPTURED"
              : event.type === "FILE_MANIFEST_CREATED"
                ? "FILE_MANIFEST_CREATED"
        : event.type === "ARTIFACT_CREATED"
          ? "ARTIFACT_CREATED"
          : event.type === "CLEANUP_FINISHED"
            ? "WORKSPACE_CLEANED"
            : null;
      if (ledgerType) {
        this.appendEvidenceLedgerEntry(jobRunId, ledgerType, "job_run_event", event.eventId, {
          eventType: event.type,
          createdAt: event.createdAt,
        }, event.createdAt);
        if (event.type === "EXECUTOR_STARTED" && !this.row(
          "SELECT id FROM evidence_ledger_entries WHERE job_run_id=? AND entry_type='HEARTBEAT_RECORDED' LIMIT 1",
          jobRunId,
        )) {
          const heartbeat = this.listWorkerHeartbeats(workerId)
            .reverse()
            .find((item) => item.activeJobRunIds.includes(jobRunId));
          if (heartbeat) {
            this.appendEvidenceLedgerEntry(jobRunId, "HEARTBEAT_RECORDED", "worker_heartbeat", heartbeat.id, {
              workerId,
              sentAt: heartbeat.sentAt,
              receivedAt: heartbeat.receivedAt,
              capabilitySnapshotId: heartbeat.capabilitySnapshotId,
            }, event.createdAt);
          }
        }
      }
      if (event.type === "CLEANUP_FINISHED" && job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1") {
        const failure = this.row(
          "SELECT id FROM job_run_events WHERE job_run_id=? AND json_extract(payload_json,'$.eventType')='EXECUTOR_FAILED' LIMIT 1",
          jobRunId,
        );
        if (failure) this.finalizeRepositoryMaterializationFailure(job, workerId, event.eventId);
      }
    });
  }

  private finalizeRepositoryMaterializationFailure(
    job: JobRunRecord,
    workerId: string,
    cleanupEventId: string,
  ): void {
    const task = this.getTask(job.taskId);
    if (!task || task.status !== "RUNNING" || job.status !== "RUNNING") return;
    const timestamp = now();
    const permission = this.getPermissionLeaseForJob(job.id);
    if (permission?.status === "ACTIVE") {
      this.db.prepare("UPDATE permission_leases SET status='REVOKED', revoked_at=?, revoke_reason=? WHERE id=? AND status='ACTIVE'").run(
        timestamp,
        "Repository materialization execution failed",
        permission.id,
      );
    }
    const failed = this.db.prepare("UPDATE job_runs SET status='FAILED', ended_at=?, lease_expires_at=?, updated_at=? WHERE id=? AND status='RUNNING'").run(
      timestamp,
      timestamp,
      timestamp,
      job.id,
    );
    if (Number(failed.changes) !== 1) return;
    this.db.prepare("UPDATE job_run_attempts SET terminal_reason='EXECUTOR_FAILED', lease_revoked_at=?, updated_at=? WHERE job_run_id=?").run(
      timestamp,
      timestamp,
      job.id,
    );
    const verificationEvent = this.appendJobEvent(
      job.id,
      "STATUS",
      "ERROR",
      "Repository materialization failed without Demo fallback",
      { cleanupEventId, noDemoFallback: true },
    );
    this.appendEvidenceLedgerEntry(job.id, "VERIFICATION_FAILED", "job_run_event", verificationEvent.id, {
      result: "FAILED",
      noDemoFallback: true,
      workspaceCleaned: true,
    }, timestamp);
    let failedTask = this.transitionUnsafe(task, "SUBMITTED", { kind: "WORKER", id: workerId }, "Worker reported a failed repository materialization attempt", "REPOSITORY_MATERIALIZATION_FAILED_SUBMISSION");
    failedTask = this.transitionUnsafe(failedTask, "VERIFYING", { kind: "SYSTEM", id: "repository-reality-verifier" }, "Server verified the failed attempt and cleanup evidence", "REPOSITORY_MATERIALIZATION_FAILURE_VERIFYING");
    this.transitionUnsafe(failedTask, "VERIFICATION_FAILED", { kind: "SYSTEM", id: "repository-reality-verifier" }, "Repository materialization failure cannot produce a VERIFIED Receipt", "REPOSITORY_MATERIALIZATION_FAILED");
    this.reconcileWorkerCapacity(workerId);
  }

  initializeArtifactUpload(
    jobRunId: string,
    workerId: string,
    leaseToken: string,
    metadata: { artifactType: string; fileName: string; mimeType: string; size: number; sha256: string }
  ): { artifactId: string; uploadToken: string; expiresAt: string } {
    return this.transaction(() => {
      const job = this.validateJobLease(jobRunId, workerId, leaseToken);
      const permission = job.taskContractVersionId
        ? this.assertPermissionActionAllowed(jobRunId, workerId, "upload_artifact")
        : null;
      const allowedTypes = new Set(["text/plain", "text/x-diff", "application/json", "image/png", "image/jpeg", "image/webp"]);
      if (!allowedTypes.has(metadata.mimeType)) throw new Error("Artifact MIME type is not allowed.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(metadata.fileName)) throw new Error("Artifact file name is invalid.");
      const maxArtifactBytes = permission?.scope.maxArtifactBytes ?? 10 * 1024 * 1024;
      if (!Number.isInteger(metadata.size) || metadata.size < 0 || metadata.size > maxArtifactBytes) throw new Error("Artifact size exceeds the Permission Lease limit.");
      if (!/^[a-f0-9]{64}$/.test(metadata.sha256)) throw new Error("Artifact SHA-256 is invalid.");
      if (
        job.workflowTemplate === "WORKER_SMOKE_V1" &&
        (metadata.artifactType !== "OTHER" || metadata.fileName !== "hello.txt" || metadata.mimeType !== "text/plain")
      ) {
        throw new Error("WORKER_SMOKE_V1 only accepts the allowlisted hello.txt artifact.");
      }
      if (
        job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1" &&
        ![
          "OTHER|clone-log.txt|text/plain",
          "OTHER|repository-metadata.json|application/json",
          "OTHER|file-manifest.json|application/json",
        ].includes(`${metadata.artifactType}|${metadata.fileName}|${metadata.mimeType}`)
      ) {
        throw new Error("REPOSITORY_MATERIALIZE_V1 only accepts its three allowlisted Evidence artifacts.");
      }
      const maxArtifacts = job.workflowTemplate === "WORKER_SMOKE_V1"
        ? 1
        : job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1"
          ? 3
          : 20;
      const uploadCount = this.row("SELECT COUNT(*) AS count FROM artifact_uploads WHERE job_run_id=? AND status!='EXPIRED'", jobRunId);
      if (uploadCount && number(uploadCount.count) >= maxArtifacts) throw new Error("Job artifact limit has been reached.");
      const artifactId = randomUUID();
      const uploadToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Math.min(Date.now() + this.artifactUploadTtlMs, Date.parse(job.leaseExpiresAt!))).toISOString();
      const timestamp = now();
      this.db.prepare("INSERT INTO artifact_uploads(id,job_run_id,worker_id,artifact_type,file_name,mime_type,expected_size,expected_sha256,upload_token_hash,content_base64,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,'PENDING',?,?,?)").run(
        artifactId,
        jobRunId,
        workerId,
        metadata.artifactType,
        metadata.fileName,
        metadata.mimeType,
        metadata.size,
        metadata.sha256,
        workerTokenDigest(uploadToken),
        expiresAt,
        timestamp,
        timestamp
      );
      return { artifactId, uploadToken, expiresAt };
    });
  }

  receiveArtifactUpload(
    artifactId: string,
    uploadToken: string,
    workerId: string,
    leaseToken: string,
    receivedMimeType: string,
    bytes: Uint8Array,
  ): void {
    this.transaction(() => {
      const upload = this.row("SELECT * FROM artifact_uploads WHERE id=?", artifactId);
      if (!upload || !["PENDING", "UPLOADED"].includes(string(upload.status)) || Date.parse(string(upload.expires_at)) <= Date.now()) throw new Error("Artifact upload is unavailable or expired.");
      const jobRunId = string(upload.job_run_id);
      const job = this.validateJobLease(jobRunId, workerId, leaseToken);
      if (job.taskContractVersionId) this.assertPermissionActionAllowed(jobRunId, workerId, "upload_artifact");
      if (string(upload.worker_id) !== workerId) throw new Error("Artifact upload does not belong to this Worker.");
      if (!safeEqualHex(string(upload.upload_token_hash), workerTokenDigest(uploadToken))) throw new Error("Artifact upload token is invalid.");
      const normalizedMimeType = receivedMimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (normalizedMimeType !== string(upload.mime_type).toLowerCase()) throw new Error("Artifact MIME type does not match the initialized upload.");
      if (bytes.byteLength !== number(upload.expected_size)) throw new Error("Artifact size does not match the signed request.");
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (!safeEqualHex(digest, string(upload.expected_sha256))) throw new Error("Artifact hash does not match the signed request.");
      const mimeType = string(upload.mime_type);
      if (mimeType === "image/png" && !(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) throw new Error("PNG signature is invalid.");
      if (mimeType === "application/json") {
        try {
          JSON.parse(Buffer.from(bytes).toString("utf8"));
        } catch {
          throw new Error("JSON artifact content is invalid.");
        }
      }
      if (string(upload.status) === "UPLOADED") {
        const existing = this.row("SELECT * FROM artifact_upload_observations WHERE artifact_id=?", artifactId);
        if (existing && safeEqualHex(string(existing.server_sha256), digest)) return;
        throw new Error("Artifact upload has already received different bytes.");
      }
      this.db.prepare("UPDATE artifact_uploads SET content_base64=?, status='UPLOADED', updated_at=? WHERE id=?").run(Buffer.from(bytes).toString("base64"), now(), artifactId);
      this.db.prepare("INSERT INTO artifact_upload_observations(artifact_id,server_sha256,received_mime_type,received_at) VALUES(?,?,?,?)").run(
        artifactId,
        digest,
        normalizedMimeType,
        now(),
      );
    });
  }

  finalizeArtifactUpload(jobRunId: string, workerId: string, leaseToken: string, artifactId: string, suppliedSha256: string): EvidenceArtifactRecord {
    return this.transaction(() => {
      const job = this.validateJobLease(jobRunId, workerId, leaseToken);
      if (job.taskContractVersionId) {
        this.assertPermissionActionAllowed(
          jobRunId,
          workerId,
          job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1"
            ? "calculate_file_sha256"
            : "calculate_sha256",
        );
        this.assertPermissionActionAllowed(jobRunId, workerId, "upload_artifact");
      }
      const upload = this.row("SELECT * FROM artifact_uploads WHERE id=? AND job_run_id=? AND worker_id=?", artifactId, jobRunId, workerId);
      if (!upload || string(upload.status) !== "UPLOADED" || !upload.content_base64) throw new Error("Artifact upload is not ready to finalize.");
      if (!safeEqualHex(string(upload.expected_sha256), suppliedSha256)) throw new Error("Artifact finalize hash does not match.");
      const bytes = Buffer.from(string(upload.content_base64), "base64");
      const serverDigest = createHash("sha256").update(bytes).digest("hex");
      const observation = this.row("SELECT * FROM artifact_upload_observations WHERE artifact_id=?", artifactId);
      if (!observation || !safeEqualHex(string(observation.server_sha256), serverDigest)) throw new Error("Server artifact hash observation is missing or inconsistent.");
      if (!safeEqualHex(string(upload.expected_sha256), serverDigest)) throw new Error("Server artifact hash does not match the Worker claim.");
      const content = string(upload.mime_type).startsWith("image/") ? string(upload.content_base64) : bytes.toString("utf8");
      const timestamp = now();
      const taskRow = this.row("SELECT task_id FROM job_runs WHERE id=?", jobRunId);
      if (!taskRow) throw new Error("Task for artifact was not found.");
      const artifact: EvidenceArtifactRecord = {
        id: artifactId,
        taskId: string(taskRow.task_id),
        workerId,
        jobRunId,
        artifactType: string(upload.artifact_type),
        fileName: string(upload.file_name),
        mimeType: string(upload.mime_type),
        size: bytes.byteLength,
        sha256: serverDigest,
        claimedSha256: string(upload.expected_sha256),
        serverSha256: serverDigest,
        storagePath: `task/${string(taskRow.task_id)}/job/${jobRunId}/${artifactId}-${string(upload.file_name)}`,
        content,
        createdAt: timestamp
      };
      this.db.prepare("INSERT INTO evidence_artifacts(id,task_id,worker_id,job_run_id,artifact_type,file_name,mime_type,size,sha256,storage_path,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
        artifact.id,
        artifact.taskId,
        artifact.workerId,
        artifact.jobRunId,
        artifact.artifactType,
        artifact.fileName,
        artifact.mimeType,
        artifact.size,
        artifact.sha256,
        artifact.storagePath,
        artifact.content,
        timestamp,
        timestamp
      );
      this.db.prepare("UPDATE artifact_uploads SET status='FINALIZED', updated_at=? WHERE id=?").run(timestamp, artifactId);
      if (job.taskContractVersionId) {
        this.appendEvidenceLedgerEntry(jobRunId, "ARTIFACT_UPLOADED", "evidence_artifact", artifact.id, {
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.size,
          workerSha256: artifact.claimedSha256,
        }, timestamp);
        this.appendEvidenceLedgerEntry(jobRunId, "ARTIFACT_HASH_VERIFIED", "evidence_artifact", artifact.id, {
          workerSha256: artifact.claimedSha256,
          serverSha256: artifact.serverSha256,
          matched: true,
        }, timestamp);
        if (
          job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1" &&
          artifact.fileName === "file-manifest.json"
        ) {
          this.verifyRepositoryManifestAndRemote(job, artifact, timestamp);
        }
      }
      return artifact;
    });
  }

  private verifyRepositoryManifestAndRemote(
    job: JobRunRecord,
    artifact: EvidenceArtifactRecord,
    verifiedAt: string,
  ): RemoteCommitVerification {
    const task = this.getTask(job.taskId);
    if (!task) throw new Error("Repository materialization Task was not found.");
    const allowedRemote = assertAllowlistedRepositoryUrl(task.repository);
    if (task.targetBranch !== REPOSITORY_MATERIALIZATION_BRANCH) {
      throw new Error("Repository materialization Task branch is not allowlisted.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(artifact.content);
    } catch {
      throw new Error("File Manifest artifact is not valid JSON.");
    }
    const manifest = repositoryFileManifestSchema.parse(parsed);
    const canonicalManifest = canonicalRepositoryJson(manifest);
    if (canonicalManifest !== artifact.content) {
      throw new Error("File Manifest artifact is not canonically serialized.");
    }
    const manifestSha256 = repositoryManifestSha256(manifest);
    if (!safeEqualHex(manifestSha256, artifact.sha256)) {
      throw new Error("File Manifest SHA-256 does not match the Server artifact observation.");
    }
    if (
      manifest.remoteUrl !== allowedRemote ||
      manifest.branch !== task.targetBranch ||
      manifest.files.some((entry) => entry.relative_path.toLowerCase().split("/").includes(".git"))
    ) {
      throw new Error("File Manifest repository identity or paths are invalid.");
    }
    const remote = this.remoteCommitResolver(allowedRemote, task.targetBranch);
    if (
      remote.remoteUrl !== allowedRemote ||
      remote.branch !== task.targetBranch ||
      remote.exitCode !== 0 ||
      !safeEqualHex(remote.commitSha, manifest.commitSha)
    ) {
      throw new Error("Worker Commit SHA does not match the independently verified Remote Commit SHA.");
    }
    const source = this.appendJobEvent(
      job.id,
      "EVIDENCE",
      "SUCCESS",
      "Server independently verified the Remote branch commit",
      {
        verificationKind: "REMOTE_COMMIT",
        remoteUrl: allowedRemote,
        branch: task.targetBranch,
        workerCommitSha: manifest.commitSha,
        independentRemoteCommitSha: remote.commitSha,
        remoteQueryExitCode: remote.exitCode,
        manifestSha256,
        verifiedAt: remote.verifiedAt,
      },
    );
    this.appendEvidenceLedgerEntry(job.id, "REMOTE_COMMIT_VERIFIED", "job_run_event", source.id, source.payload, verifiedAt);
    return remote;
  }

  private createWorkerSmokeReceipt(input: {
    task: TaskRecord;
    job: JobRunRecord;
    contract: TaskContractVersionRecord;
    permission: PermissionLeaseRecord;
    artifact: EvidenceArtifactRecord;
    capabilityEvidence: JobCapabilityEvidenceRecord;
    verificationResults: VerificationResultRecord[];
    startedAt: string;
    endedAt: string;
  }): JobReceiptRecord {
    if (this.getJobReceiptByJobRun(input.job.id)) throw new Error("Job already has a Verified Job Receipt.");
    const agent = this.getAgentById(input.job.agentId);
    const worker = this.getWorker(input.job.workerId);
    if (!agent || !worker) throw new Error("Receipt execution identities are missing.");
    const requiredCheckIds = input.contract.contract.acceptanceChecks
      .filter((check) => check.required)
      .map((check) => check.id);
    const checksById = new Map(input.verificationResults.map((check) => [check.checkId, check]));
    if (requiredCheckIds.some((checkId) => checksById.get(checkId)?.status !== "PASSED")) {
      throw new Error("Verified Job Receipt requires every required Contract check to pass.");
    }
    if (input.permission.status !== "COMPLETED" || input.permission.revokedAt || input.permission.revokeReason) {
      throw new Error("Verified Job Receipt requires a completed Permission Lease without violations.");
    }
    const ledgerEntries = this.listEvidenceLedgerEntries(input.job.id);
    const expectedOrder: EvidenceLedgerEntryType[] = [
      "CONTRACT_LOCKED",
      "PERMISSION_GRANTED",
      "JOB_CLAIMED",
      "EXECUTION_STARTED",
      "HEARTBEAT_RECORDED",
      "ARTIFACT_CREATED",
      "ARTIFACT_UPLOADED",
      "ARTIFACT_HASH_VERIFIED",
      "WORKSPACE_CLEANED",
      "VERIFICATION_PASSED",
    ];
    let lastIndex = -1;
    for (const entryType of expectedOrder) {
      const index = ledgerEntries.findIndex((entry, candidateIndex) => candidateIndex > lastIndex && entry.entryType === entryType);
      if (index < 0) throw new Error(`Verified Job Receipt is missing ordered Evidence entry ${entryType}.`);
      lastIndex = index;
    }
    if (ledgerEntries.some((entry) => entry.entryType === "PERMISSION_VIOLATION")) {
      throw new Error("Permission violations prevent a VERIFIED receipt.");
    }
    const ledgerVerification = verifyEvidenceLedgerEntries(ledgerEntries);
    if (!ledgerVerification.valid || !ledgerVerification.chainSha256) {
      throw new Error("Evidence Ledger chain is invalid.");
    }
    const startedMs = Date.parse(input.startedAt);
    const endedMs = Date.parse(input.endedAt);
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs) {
      throw new Error("Receipt execution timestamps are invalid.");
    }
    const issuedAt = now();
    const receiptPublicId = `dlr_${randomBytes(18).toString("base64url")}`;
    const document: JobReceiptRecord["receipt"] = {
      schemaVersion: 1,
      receiptType: "WORKER_INFRASTRUCTURE_VERIFICATION",
      claim: "Hash-verifiable DoneLayer execution receipt.",
      publicReceiptId: receiptPublicId,
      whoRequested: {
        customerReference: input.task.customerId,
        taskId: input.task.id,
        orderedAt: input.task.createdAt,
      },
      whoExecuted: {
        agentId: agent.id,
        agentPublicIdentity: "DoneLayer Worker Smoke Agent",
        agentVersion: agent.version,
        providerId: agent.providerId,
        workerId: worker.id,
        workerPublicIdentity: worker.name,
        workerVersion: input.capabilityEvidence.capabilities.workerVersion,
        capabilitySnapshot: input.capabilityEvidence.capabilities,
        runtime: input.capabilityEvidence.capabilities.nodeVersion,
        os: input.capabilityEvidence.capabilities.os,
      },
      whatWasAgreed: {
        taskContractVersionId: input.contract.id,
        contractVersion: input.contract.version,
        contractSha256: input.contract.contractSha256,
        desiredOutcome: input.contract.contract.desiredOutcome,
        deliverables: input.contract.contract.deliverables,
        acceptanceChecks: input.contract.contract.acceptanceChecks,
      },
      whatWasPermitted: {
        permissionLeaseId: input.permission.id,
        allowedActions: input.permission.scope.allowedActions,
        deniedActions: input.permission.scope.deniedActions,
        effectiveAt: input.permission.startsAt!,
        expiresAt: input.permission.expiresAt!,
        budgetLimit: input.contract.contract.budgetLimit,
        permissionViolations: [],
      },
      whatHappened: {
        jobRunId: input.job.id,
        startedAt: input.startedAt,
        finishedAt: input.endedAt,
        durationMs: endedMs - startedMs,
        importantRunEvents: ledgerEntries.map((entry) => ({ type: entry.entryType, createdAt: entry.createdAt })),
        artifacts: [{
          id: input.artifact.id,
          fileName: input.artifact.fileName,
          mimeType: input.artifact.mimeType,
          size: input.artifact.size,
          sha256: input.artifact.sha256,
        }],
        workspaceCleaned: true,
      },
      howVerified: {
        checks: input.verificationResults.map((check) => ({
          id: check.checkId,
          status: check.status,
          summary: check.summary,
        })),
        workerSha256: input.artifact.claimedSha256 ?? input.artifact.sha256,
        serverSha256: input.artifact.serverSha256 ?? input.artifact.sha256,
        evidenceLedger: ledgerVerification,
        humanApproval: null,
      },
      finalResult: "VERIFIED",
      issuedAt,
    };
    return this.persistJobReceipt({
      taskId: input.task.id,
      jobRunId: input.job.id,
      taskContractVersionId: input.contract.id,
      permissionLeaseId: input.permission.id,
      result: "VERIFIED",
      document,
      evidenceChainSha256: ledgerVerification.chainSha256,
      createdAt: issuedAt,
    });
  }

  private persistJobReceipt(input: {
    taskId: string;
    jobRunId: string;
    taskContractVersionId: string;
    permissionLeaseId: string;
    result: JobReceiptResult;
    document: JobReceiptRecord["receipt"];
    evidenceChainSha256: string;
    createdAt: string;
  }): JobReceiptRecord {
    if (this.getJobReceiptByJobRun(input.jobRunId)) throw new Error("Job already has a Verified Job Receipt.");
    if (input.document.finalResult !== input.result) throw new Error("Receipt result does not match its document.");
    if (
      input.document.howVerified.evidenceLedger.chainSha256 !== input.evidenceChainSha256 ||
      input.document.howVerified.evidenceLedger.valid !== true
    ) {
      throw new Error("Receipt Evidence Ledger anchor does not match its document.");
    }
    const receiptSha256 = computeReceiptSha256(input.document);
    const id = randomUUID();
    this.db.prepare(
      "INSERT INTO job_receipts(id,receipt_public_id,task_id,job_run_id,task_contract_version_id,permission_lease_id,result,receipt_json,receipt_sha256,evidence_chain_sha256,created_at,invalidated_at,invalidation_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)",
    ).run(
      id,
      input.document.publicReceiptId,
      input.taskId,
      input.jobRunId,
      input.taskContractVersionId,
      input.permissionLeaseId,
      input.result,
      canonicalJson(input.document),
      receiptSha256,
      input.evidenceChainSha256,
      input.createdAt,
    );
    this.appendEvidenceLedgerEntry(
      input.jobRunId,
      "RECEIPT_CREATED",
      "job_receipt",
      id,
      input.document,
      input.createdAt,
      receiptSha256,
    );
    this.insertAudit(
      { kind: "SYSTEM", id: "receipt-service" },
      "JOB_RECEIPT_CREATED",
      "job_receipt",
      id,
      { jobRunId: input.jobRunId, result: input.result, receiptSha256 },
    );
    return this.getJobReceiptByJobRun(input.jobRunId)!;
  }

  private createPermissionViolationReceipt(
    task: TaskRecord,
    job: JobRunRecord,
    contract: TaskContractVersionRecord,
    permission: PermissionLeaseRecord,
    issuedAt: string,
    violationReason: string,
  ): JobReceiptRecord {
    const agent = this.getAgentById(job.agentId);
    const worker = this.getWorker(job.workerId);
    const capabilityEvidence = this.getJobCapabilityEvidence(job.id);
    if (!agent || !worker || !capabilityEvidence || !permission.startsAt || !permission.expiresAt) {
      throw new Error("Permission violation Receipt identities or capability evidence are missing.");
    }
    const ledgerEntries = this.listEvidenceLedgerEntries(job.id);
    const ledgerVerification = verifyEvidenceLedgerEntries(ledgerEntries);
    if (!ledgerVerification.valid || !ledgerVerification.chainSha256) {
      throw new Error("Permission violation Receipt requires a valid Evidence Ledger chain.");
    }
    const verificationResults = this.rows(
      "SELECT * FROM verification_results WHERE job_run_id=? ORDER BY created_at, rowid",
      job.id,
    ).map(mapVerification);
    const artifacts = this.rows(
      `SELECT e.*,u.expected_sha256 AS claimed_sha256,o.server_sha256 AS server_sha256
       FROM evidence_artifacts e
       LEFT JOIN artifact_uploads u ON u.id=e.id
       LEFT JOIN artifact_upload_observations o ON o.artifact_id=e.id
       WHERE e.job_run_id=? ORDER BY e.created_at, e.rowid`,
      job.id,
    ).map(mapArtifact);
    const startedAt = job.startedAt ?? issuedAt;
    const startedMs = Date.parse(startedAt);
    const endedMs = Date.parse(issuedAt);
    const primaryArtifact = artifacts[0];
    const receiptPublicId = `dlr_${randomBytes(18).toString("base64url")}`;
    const document: JobReceiptRecord["receipt"] = {
      schemaVersion: 1,
      receiptType: job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1"
        ? "REPOSITORY_MATERIALIZATION_VERIFICATION"
        : "WORKER_INFRASTRUCTURE_VERIFICATION",
      claim: "Hash-verifiable DoneLayer execution receipt.",
      publicReceiptId: receiptPublicId,
      whoRequested: {
        customerReference: task.customerId,
        taskId: task.id,
        orderedAt: task.createdAt,
      },
      whoExecuted: {
        agentId: agent.id,
        agentPublicIdentity: job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1"
          ? "DoneLayer Repository Materialization Agent"
          : "DoneLayer Worker Smoke Agent",
        agentVersion: agent.version,
        providerId: agent.providerId,
        workerId: worker.id,
        workerPublicIdentity: worker.name,
        workerVersion: capabilityEvidence.capabilities.workerVersion,
        capabilitySnapshot: capabilityEvidence.capabilities,
        runtime: capabilityEvidence.capabilities.nodeVersion,
        os: capabilityEvidence.capabilities.os,
        processId: capabilityEvidence.capabilities.processId,
      },
      whatWasAgreed: {
        taskContractVersionId: contract.id,
        contractVersion: contract.version,
        contractSha256: contract.contractSha256,
        desiredOutcome: contract.contract.desiredOutcome,
        deliverables: contract.contract.deliverables,
        acceptanceChecks: contract.contract.acceptanceChecks,
      },
      whatWasPermitted: {
        permissionLeaseId: permission.id,
        allowedActions: permission.scope.allowedActions,
        deniedActions: permission.scope.deniedActions,
        effectiveAt: permission.startsAt,
        expiresAt: permission.expiresAt,
        budgetLimit: contract.contract.budgetLimit,
        permissionViolations: [violationReason],
      },
      whatHappened: {
        jobRunId: job.id,
        startedAt,
        finishedAt: issuedAt,
        durationMs: Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : 0,
        importantRunEvents: ledgerEntries.map((entry) => ({ type: entry.entryType, createdAt: entry.createdAt })),
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.size,
          sha256: artifact.sha256,
        })),
        workspaceCleaned: ledgerEntries.some((entry) => entry.entryType === "WORKSPACE_CLEANED"),
      },
      howVerified: {
        checks: verificationResults.map((check) => ({ id: check.checkId, status: check.status, summary: check.summary })),
        workerSha256: primaryArtifact?.claimedSha256 ?? "",
        serverSha256: primaryArtifact?.serverSha256 ?? "",
        evidenceLedger: ledgerVerification,
        humanApproval: null,
      },
      finalResult: "PERMISSION_VIOLATION",
      issuedAt,
    };
    return this.persistJobReceipt({
      taskId: task.id,
      jobRunId: job.id,
      taskContractVersionId: contract.id,
      permissionLeaseId: permission.id,
      result: "PERMISSION_VIOLATION",
      document,
      evidenceChainSha256: ledgerVerification.chainSha256,
      createdAt: issuedAt,
    });
  }

  private completeRepositoryMaterializationJob(input: {
    job: JobRunRecord;
    task: TaskRecord;
    workerId: string;
    result: WorkerSubmissionResult;
    submittedArtifacts: Array<{
      artifactId: string;
      artifactType: string;
      fileName: string;
      mimeType: string;
      size: number;
      sha256: string;
    }>;
    persistedArtifacts: EvidenceArtifactRecord[];
  }): TaskAggregate {
    const { job, workerId, result } = input;
    let task = input.task;
    if (!job.taskContractVersionId) throw new Error("Repository materialization Job has no Task Contract binding.");
    const contract = this.getTaskContractVersion(job.taskContractVersionId);
    const permission = this.getPermissionLeaseForJob(job.id);
    if (!contract || !["LOCKED", "SUPERSEDED"].includes(contract.status)) {
      throw new Error("Repository materialization Task Contract is unavailable.");
    }
    if (!permission || permission.status !== "ACTIVE" || permission.workerId !== workerId) {
      throw new Error("Repository materialization Permission Lease is not active.");
    }
    if (
      permission.scope.allowedRepositories?.length !== 1 ||
      permission.scope.allowedRepositories[0] !== REPOSITORY_MATERIALIZATION_REMOTE_URL ||
      permission.scope.allowedBranches?.length !== 1 ||
      permission.scope.allowedBranches[0] !== REPOSITORY_MATERIALIZATION_BRANCH ||
      permission.scope.allowedDomains.length !== 1 ||
      permission.scope.allowedDomains[0] !== "github.com"
    ) {
      throw new Error("Repository materialization Permission Lease does not match the fixed allowlist.");
    }
    if (input.submittedArtifacts.length !== 3 || input.persistedArtifacts.length !== 3) {
      throw new Error("Repository materialization requires exactly three finalized Evidence artifacts.");
    }
    const byName = new Map(input.persistedArtifacts.map((artifact) => [artifact.fileName, artifact]));
    const cloneLog = byName.get("clone-log.txt");
    const metadataArtifact = byName.get("repository-metadata.json");
    const manifestArtifact = byName.get("file-manifest.json");
    if (
      cloneLog?.mimeType !== "text/plain" ||
      metadataArtifact?.mimeType !== "application/json" ||
      manifestArtifact?.mimeType !== "application/json" ||
      [...byName.values()].some((artifact) => artifact.artifactType !== "OTHER")
    ) {
      throw new Error("Repository materialization Evidence artifact set is invalid.");
    }
    const metadata = repositoryMetadataSchema.parse(JSON.parse(metadataArtifact.content) as unknown);
    const manifest = repositoryFileManifestSchema.parse(JSON.parse(manifestArtifact.content) as unknown);
    if (
      canonicalRepositoryJson(metadata) !== metadataArtifact.content ||
      canonicalRepositoryJson(manifest) !== manifestArtifact.content
    ) {
      throw new Error("Repository Evidence JSON is not canonically serialized.");
    }
    const manifestSha256 = repositoryManifestSha256(manifest);
    if (!safeEqualHex(manifestSha256, manifestArtifact.sha256)) {
      throw new Error("Manifest SHA-256 does not match the Server artifact hash.");
    }
    const materialization = result.repositoryMaterialization;
    if (!materialization) throw new Error("Repository materialization structured result is missing.");
    if (
      metadata.workerId !== workerId ||
      metadata.jobRunId !== job.id ||
      metadata.remoteUrl !== task.repository ||
      metadata.branch !== task.targetBranch ||
      metadata.commitSha !== manifest.commitSha ||
      metadata.cloneExitCode !== 0 ||
      metadata.cloneStartedAt !== materialization.cloneStartedAt ||
      metadata.cloneFinishedAt !== materialization.cloneFinishedAt ||
      metadata.cloneDurationMs !== materialization.cloneDurationMs ||
      materialization.remoteUrl !== metadata.remoteUrl ||
      materialization.branch !== metadata.branch ||
      materialization.commitSha !== metadata.commitSha ||
      materialization.cloneExitCode !== 0 ||
      materialization.fileCount !== manifest.files.length ||
      materialization.manifestSha256 !== manifestSha256 ||
      materialization.noRepositoryCodeExecuted !== true
    ) {
      throw new Error("Repository materialization Worker result does not match canonical Evidence.");
    }
    const fixedCloneArguments = materialization.cloneArguments;
    if (
      fixedCloneArguments.at(-2) !== REPOSITORY_MATERIALIZATION_REMOTE_URL ||
      !fixedCloneArguments.includes("--no-recurse-submodules") ||
      !fixedCloneArguments.includes("--single-branch") ||
      !fixedCloneArguments.includes("--no-tags") ||
      !fixedCloneArguments.includes("http.followRedirects=false") ||
      fixedCloneArguments.includes("--recurse-submodules")
    ) {
      throw new Error("Repository materialization clone arguments are not the fixed safe command.");
    }
    if (
      result.commandsRun.length !== 0 ||
      result.gitDiff !== "" ||
      result.changedFiles.length !== 0 ||
      result.commitShaBefore !== undefined ||
      result.commitShaAfter !== undefined ||
      result.tests !== undefined ||
      result.buildSucceeded !== undefined ||
      result.pullRequestUrl !== undefined
    ) {
      throw new Error("Repository materialization result contains repository execution or modification claims.");
    }
    if (
      !cloneLog.content.includes(`Arguments: ${JSON.stringify(materialization.cloneArguments)}`) ||
      !cloneLog.content.includes(`Exit Code: ${materialization.cloneExitCode}`) ||
      !cloneLog.content.includes(materialization.cloneStdout) ||
      !cloneLog.content.includes(materialization.cloneStderr)
    ) {
      throw new Error("Clone Log does not match the structured Git clone result.");
    }
    const remoteEventRow = this.row(
      "SELECT * FROM job_run_events WHERE job_run_id=? AND json_extract(payload_json,'$.verificationKind')='REMOTE_COMMIT' ORDER BY sequence DESC LIMIT 1",
      job.id,
    );
    if (!remoteEventRow) throw new Error("Independent Remote Commit verification evidence is missing.");
    const remoteEvent = mapJobEvent(remoteEventRow);
    const workerCommitSha = string(remoteEvent.payload.workerCommitSha).toLowerCase();
    const independentRemoteCommitSha = string(remoteEvent.payload.independentRemoteCommitSha).toLowerCase();
    if (
      !safeEqualHex(workerCommitSha, metadata.commitSha) ||
      !safeEqualHex(independentRemoteCommitSha, metadata.commitSha) ||
      remoteEvent.payload.remoteUrl !== task.repository ||
      remoteEvent.payload.branch !== task.targetBranch
    ) {
      throw new Error("Worker and independently verified Remote Commit SHA do not match.");
    }
    const cleanupRow = this.row(
      "SELECT * FROM job_run_events WHERE job_run_id=? AND json_extract(payload_json,'$.eventType')='CLEANUP_FINISHED' ORDER BY sequence DESC LIMIT 1",
      job.id,
    );
    if (!cleanupRow) throw new Error("Worker workspace cleanup was not confirmed before submission.");
    const violation = this.row("SELECT id FROM evidence_ledger_entries WHERE job_run_id=? AND entry_type='PERMISSION_VIOLATION' LIMIT 1", job.id);
    if (violation) throw new Error("Permission violation prevents repository materialization completion.");
    const capabilityEvidence = this.getJobCapabilityEvidence(job.id);
    if (!capabilityEvidence) throw new Error("Repository materialization capability evidence is missing.");
    if (
      !capabilityEvidence.capabilities.gitAvailable ||
      !capabilityEvidence.capabilities.executors.includes("repository-materializer")
    ) {
      throw new Error("Claim-time capability snapshot cannot run the repository materializer.");
    }
    const timestamp = now();
    this.db.prepare("UPDATE job_runs SET status='SUBMITTED', ended_at=?, exit_code=0, commit_sha_before=?, commit_sha_after=?, updated_at=? WHERE id=? AND status='RUNNING'").run(
      result.endedAt,
      metadata.commitSha,
      metadata.commitSha,
      timestamp,
      job.id,
    );
    this.appendJobEvent(job.id, "STATUS", "SUCCESS", "Server accepted the fenced REPOSITORY_MATERIALIZE_V1 result", {
      remoteUrl: metadata.remoteUrl,
      branch: metadata.branch,
      commitSha: metadata.commitSha,
      manifestSha256,
      noRepositoryCodeExecuted: true,
    });
    task = this.transitionUnsafe(task, "SUBMITTED", { kind: "WORKER", id: workerId }, "Worker submitted real repository materialization Evidence", "REPOSITORY_MATERIALIZATION_SUBMITTED");
    task = this.transitionUnsafe(task, "VERIFYING", { kind: "SYSTEM", id: "repository-reality-verifier" }, "Server started independent Remote Commit, Manifest, Artifact, Permission and Ledger verification", "REPOSITORY_MATERIALIZATION_VERIFYING");
    const permissionCompleted = this.db.prepare("UPDATE permission_leases SET status='COMPLETED' WHERE id=? AND status='ACTIVE'").run(permission.id);
    if (Number(permissionCompleted.changes) !== 1) throw new Error("Permission Lease completion lost its state fence.");
    const completedPermission = this.getPermissionLease(permission.id)!;
    this.insertAudit(
      { kind: "SYSTEM", id: "permission-service" },
      "PERMISSION_LEASE_COMPLETED",
      "permission_lease",
      completedPermission.id,
      { jobRunId: job.id },
    );
    const ledgerBeforeVerification = this.verifyLedgerChain(job.id);
    if (!ledgerBeforeVerification.valid) throw new Error("Evidence Ledger chain is invalid before verification.");
    const cleanup = mapJobEvent(cleanupRow);
    const observedByCheckId: Record<string, Record<string, unknown>> = {
      "worker-claimed": { workerId, jobRunId: job.id, executionLeaseId: job.leaseId, executionLeaseExpiresAt: job.leaseExpiresAt },
      "execution-lease": { executionLeaseId: job.leaseId, validAt: timestamp, expiresAt: job.leaseExpiresAt },
      "permission-lease": { permissionLeaseId: completedPermission.id, status: completedPermission.status },
      "repository-url": { remoteUrl: metadata.remoteUrl, allowlisted: true },
      "clone-exit": { executable: "git", exitCode: metadata.cloneExitCode, arguments: fixedCloneArguments },
      "origin-url": { expected: task.repository, observed: metadata.remoteUrl, matched: true },
      "current-branch": { expected: task.targetBranch, observed: metadata.branch, matched: true },
      "remote-commit": { workerCommitSha, independentRemoteCommitSha, matched: true },
      "file-manifest": { artifactId: manifestArtifact.id, fileCount: manifest.files.length },
      "file-hashes": { fileCount: manifest.files.length, allSha256Valid: true },
      "manifest-hash": { workerSha256: manifestArtifact.claimedSha256, serverSha256: manifestArtifact.serverSha256, manifestSha256, matched: true },
      "no-code-executed": { noRepositoryCodeExecuted: true, safeCommandRecordCount: result.commandsRun.length },
      "no-permission-violation": { permissionLeaseId: completedPermission.id, status: completedPermission.status, violationCount: 0 },
      "workspace-cleaned": { cleanupEventId: cleanup.id, confirmed: true },
      "ledger-chain": { ...ledgerBeforeVerification },
      "verified-receipt": { receiptEligible: true },
    };
    for (const check of contract.contract.acceptanceChecks) {
      const observed = observedByCheckId[check.id];
      if (!observed) throw new Error(`Unsupported REPOSITORY_MATERIALIZE_V1 Contract check ${check.id}.`);
      this.db.prepare("INSERT INTO verification_results(id,task_id,job_run_id,check_id,check_type,status,summary,observed_json,created_at,updated_at) VALUES(?,?,?,?,?,'PASSED',?,?,?,?)").run(
        randomUUID(),
        task.id,
        job.id,
        check.id,
        check.type,
        check.label,
        canonicalJson(observed),
        timestamp,
        timestamp,
      );
    }
    const verificationResults = this.rows(
      "SELECT * FROM verification_results WHERE job_run_id=? ORDER BY created_at, rowid",
      job.id,
    ).map(mapVerification);
    this.appendEvidenceLedgerEntry(job.id, "VERIFICATION_PASSED", "verification_batch", job.id, {
      contractSha256: contract.contractSha256,
      checks: verificationResults.map((check) => ({ id: check.checkId, status: check.status })),
      workerCommitSha,
      independentRemoteCommitSha,
      manifestSha256,
      workerArtifactSha256: manifestArtifact.claimedSha256,
      serverArtifactSha256: manifestArtifact.serverSha256,
      noRepositoryCodeExecuted: true,
    }, timestamp);
    this.createRepositoryMaterializationReceipt({
      task,
      job: this.getJobRun(job.id)!,
      contract,
      permission: completedPermission,
      artifacts: input.persistedArtifacts,
      manifestArtifact,
      capabilityEvidence,
      verificationResults,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      materialization,
      independentRemoteCommitSha,
    });
    task = this.transitionUnsafe(task, "VERIFICATION_PASSED", { kind: "SYSTEM", id: "repository-reality-verifier" }, "Remote Commit, Manifest, Artifact, Permission, cleanup and Ledger evidence all matched", "REPOSITORY_MATERIALIZATION_VERIFIED");
    task = this.transitionUnsafe(task, "CUSTOMER_REVIEW", { kind: "SYSTEM", id: "repository-reality-verifier" }, "Fixed repository materialization Gate requires no frontend state mutation", "REPOSITORY_MATERIALIZATION_REVIEW_READY");
    task = this.transitionUnsafe(task, "COMPLETED", { kind: "ADMIN", id: "repository-reality-gate" }, "Server-side state machine completed the verified repository materialization Task", "REPOSITORY_MATERIALIZATION_COMPLETED");
    this.db.prepare("UPDATE job_runs SET status='SUCCEEDED', updated_at=? WHERE id=?").run(timestamp, job.id);
    this.db.prepare("UPDATE job_run_attempts SET terminal_reason='SUCCEEDED', lease_revoked_at=?, updated_at=? WHERE job_run_id=?").run(timestamp, timestamp, job.id);
    this.db.prepare("UPDATE task_assignments SET status='COMPLETED', updated_at=? WHERE id=?").run(timestamp, job.assignmentId);
    this.reconcileWorkerCapacity(workerId);
    return this.getTaskAggregate(task.id);
  }

  private createRepositoryMaterializationReceipt(input: {
    task: TaskRecord;
    job: JobRunRecord;
    contract: TaskContractVersionRecord;
    permission: PermissionLeaseRecord;
    artifacts: EvidenceArtifactRecord[];
    manifestArtifact: EvidenceArtifactRecord;
    capabilityEvidence: JobCapabilityEvidenceRecord;
    verificationResults: VerificationResultRecord[];
    startedAt: string;
    endedAt: string;
    materialization: NonNullable<WorkerSubmissionResult["repositoryMaterialization"]>;
    independentRemoteCommitSha: string;
  }): JobReceiptRecord {
    if (this.getJobReceiptByJobRun(input.job.id)) throw new Error("Job already has a Verified Job Receipt.");
    const agent = this.getAgentById(input.job.agentId);
    const worker = this.getWorker(input.job.workerId);
    if (!agent || !worker) throw new Error("Receipt execution identities are missing.");
    const requiredCheckIds = input.contract.contract.acceptanceChecks.filter((check) => check.required).map((check) => check.id);
    const checksById = new Map(input.verificationResults.map((check) => [check.checkId, check]));
    if (requiredCheckIds.some((checkId) => checksById.get(checkId)?.status !== "PASSED")) {
      throw new Error("Repository Receipt requires every required Contract check to pass.");
    }
    if (input.permission.status !== "COMPLETED" || input.permission.revokedAt || input.permission.revokeReason) {
      throw new Error("Repository Receipt requires a completed Permission Lease without violations.");
    }
    const ledgerEntries = this.listEvidenceLedgerEntries(input.job.id);
    const expectedOrder: EvidenceLedgerEntryType[] = [
      "CONTRACT_LOCKED",
      "PERMISSION_GRANTED",
      "JOB_CLAIMED",
      "EXECUTION_STARTED",
      "HEARTBEAT_RECORDED",
      "REPOSITORY_CLONE_STARTED",
      "REPOSITORY_CLONE_COMPLETED",
      "REMOTE_METADATA_CAPTURED",
      "FILE_MANIFEST_CREATED",
      "ARTIFACT_CREATED",
      "ARTIFACT_UPLOADED",
      "ARTIFACT_HASH_VERIFIED",
      "REMOTE_COMMIT_VERIFIED",
      "WORKSPACE_CLEANED",
      "VERIFICATION_PASSED",
    ];
    let lastIndex = -1;
    for (const entryType of expectedOrder) {
      const index = ledgerEntries.findIndex((entry, candidateIndex) => candidateIndex > lastIndex && entry.entryType === entryType);
      if (index < 0) throw new Error(`Repository Receipt is missing ordered Evidence entry ${entryType}.`);
      lastIndex = index;
    }
    if (ledgerEntries.some((entry) => entry.entryType === "PERMISSION_VIOLATION")) {
      throw new Error("Permission violations prevent a VERIFIED Repository Receipt.");
    }
    const ledgerVerification = verifyEvidenceLedgerEntries(ledgerEntries);
    if (!ledgerVerification.valid || !ledgerVerification.chainSha256) {
      throw new Error("Repository Receipt Evidence Ledger chain is invalid.");
    }
    const startedMs = Date.parse(input.startedAt);
    const endedMs = Date.parse(input.endedAt);
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs) {
      throw new Error("Repository Receipt execution timestamps are invalid.");
    }
    const issuedAt = now();
    const receiptPublicId = `dlr_${randomBytes(18).toString("base64url")}`;
    const document: JobReceiptRecord["receipt"] = {
      schemaVersion: 1,
      receiptType: "REPOSITORY_MATERIALIZATION_VERIFICATION",
      claim: "Hash-verifiable DoneLayer execution receipt.",
      publicReceiptId: receiptPublicId,
      whoRequested: {
        customerReference: input.task.customerId,
        taskId: input.task.id,
        orderedAt: input.task.createdAt,
      },
      whoExecuted: {
        agentId: agent.id,
        agentPublicIdentity: "DoneLayer Repository Materialization Agent",
        agentVersion: agent.version,
        providerId: agent.providerId,
        workerId: worker.id,
        workerPublicIdentity: worker.name,
        workerVersion: input.capabilityEvidence.capabilities.workerVersion,
        capabilitySnapshot: input.capabilityEvidence.capabilities,
        runtime: input.capabilityEvidence.capabilities.nodeVersion,
        os: input.capabilityEvidence.capabilities.os,
        processId: input.capabilityEvidence.capabilities.processId,
      },
      whatWasAgreed: {
        taskContractVersionId: input.contract.id,
        contractVersion: input.contract.version,
        contractSha256: input.contract.contractSha256,
        desiredOutcome: input.contract.contract.desiredOutcome,
        deliverables: input.contract.contract.deliverables,
        acceptanceChecks: input.contract.contract.acceptanceChecks,
      },
      whatWasPermitted: {
        permissionLeaseId: input.permission.id,
        allowedActions: input.permission.scope.allowedActions,
        deniedActions: input.permission.scope.deniedActions,
        effectiveAt: input.permission.startsAt!,
        expiresAt: input.permission.expiresAt!,
        budgetLimit: input.contract.contract.budgetLimit,
        permissionViolations: [],
      },
      whatHappened: {
        jobRunId: input.job.id,
        startedAt: input.startedAt,
        finishedAt: input.endedAt,
        durationMs: endedMs - startedMs,
        importantRunEvents: ledgerEntries.map((entry) => ({ type: entry.entryType, createdAt: entry.createdAt })),
        artifacts: input.artifacts.map((artifact) => ({
          id: artifact.id,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.size,
          sha256: artifact.sha256,
        })),
        workspaceCleaned: true,
        repositoryMaterialization: {
          remoteUrl: input.materialization.remoteUrl,
          branch: input.materialization.branch,
          workerCommitSha: input.materialization.commitSha,
          independentRemoteCommitSha: input.independentRemoteCommitSha,
          cloneExitCode: input.materialization.cloneExitCode,
          cloneDurationMs: input.materialization.cloneDurationMs,
          fileCount: input.materialization.fileCount,
          manifestSha256: input.materialization.manifestSha256,
          artifactSha256: input.manifestArtifact.serverSha256 ?? input.manifestArtifact.sha256,
          noRepositoryCodeExecuted: input.materialization.noRepositoryCodeExecuted,
        },
      },
      howVerified: {
        checks: input.verificationResults.map((check) => ({ id: check.checkId, status: check.status, summary: check.summary })),
        workerSha256: input.manifestArtifact.claimedSha256 ?? input.manifestArtifact.sha256,
        serverSha256: input.manifestArtifact.serverSha256 ?? input.manifestArtifact.sha256,
        evidenceLedger: ledgerVerification,
        humanApproval: null,
      },
      finalResult: "VERIFIED",
      issuedAt,
    };
    return this.persistJobReceipt({
      taskId: input.task.id,
      jobRunId: input.job.id,
      taskContractVersionId: input.contract.id,
      permissionLeaseId: input.permission.id,
      result: "VERIFIED",
      document,
      evidenceChainSha256: ledgerVerification.chainSha256,
      createdAt: issuedAt,
    });
  }

  submitWorkerJob(
    jobRunId: string,
    workerId: string,
    leaseToken: string,
    result: WorkerSubmissionResult,
    submittedArtifacts: Array<{
      artifactId: string;
      artifactType: string;
      fileName: string;
      mimeType: string;
      size: number;
      sha256: string;
    }> = [],
  ): TaskAggregate {
    return this.transaction(() => {
      const job = this.validateJobLease(jobRunId, workerId, leaseToken);
      if (job.taskContractVersionId) this.assertPermissionActionAllowed(jobRunId, workerId, "report_progress");
      let task = this.getTask(job.taskId);
      if (!task || task.status !== "RUNNING") throw new Error("Task is not running.");
      if (result.status !== "succeeded" || result.exitCode !== 0) throw new Error("Failed or cancelled Worker results cannot be submitted as done.");
      const persistedArtifacts = this.rows("SELECT * FROM evidence_artifacts WHERE job_run_id=? AND worker_id=? ORDER BY created_at, rowid", jobRunId, workerId).map(mapArtifact);
      const persistedById = new Map(persistedArtifacts.map((artifact) => [artifact.id, artifact]));
      if (new Set(submittedArtifacts.map((artifact) => artifact.artifactId)).size !== submittedArtifacts.length) throw new Error("Submitted artifacts contain duplicate IDs.");
      for (const submitted of submittedArtifacts) {
        const persisted = persistedById.get(submitted.artifactId);
        if (
          !persisted ||
          persisted.artifactType !== submitted.artifactType ||
          persisted.fileName !== submitted.fileName ||
          persisted.mimeType !== submitted.mimeType ||
          persisted.size !== submitted.size ||
          !safeEqualHex(persisted.sha256, submitted.sha256)
        ) {
          throw new Error("Submitted artifact metadata does not match canonical Server evidence.");
        }
      }
      if (job.workflowTemplate === "REPOSITORY_MATERIALIZE_V1") {
        return this.completeRepositoryMaterializationJob({
          job,
          task,
          workerId,
          result,
          submittedArtifacts,
          persistedArtifacts,
        });
      }
      if (job.workflowTemplate === "WORKER_SMOKE_V1") {
        if (!job.taskContractVersionId) throw new Error("WORKER_SMOKE_V1 Job has no Task Contract binding.");
        const contract = this.getTaskContractVersion(job.taskContractVersionId);
        const permission = this.getPermissionLeaseForJob(jobRunId);
        if (!contract || !["LOCKED", "SUPERSEDED"].includes(contract.status)) throw new Error("WORKER_SMOKE_V1 Task Contract is unavailable.");
        if (!permission || permission.status !== "ACTIVE" || permission.workerId !== workerId) throw new Error("WORKER_SMOKE_V1 Permission Lease is not active.");
        if (submittedArtifacts.length !== 1 || persistedArtifacts.length !== 1) throw new Error("WORKER_SMOKE_V1 requires exactly one finalized artifact.");
        const artifact = persistedArtifacts[0]!;
        if (artifact.artifactType !== "OTHER" || artifact.fileName !== "hello.txt" || artifact.mimeType !== "text/plain") {
          throw new Error("WORKER_SMOKE_V1 requires the allowlisted hello.txt artifact.");
        }
        const serverDigest = createHash("sha256").update(Buffer.from(artifact.content, "utf8")).digest("hex");
        if (!safeEqualHex(serverDigest, artifact.sha256)) throw new Error("Persisted hello.txt SHA-256 verification failed.");
        const capabilityEvidence = this.getJobCapabilityEvidence(jobRunId);
        if (!capabilityEvidence) throw new Error("Job capability evidence is missing.");
        const expectedPlatform = capabilityEvidence.capabilities.os === "windows"
          ? "win32"
          : capabilityEvidence.capabilities.os === "macos"
            ? "darwin"
            : capabilityEvidence.capabilities.os;
        const fields = new Map(
          artifact.content
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
              const separator = line.indexOf(": ");
              return separator > 0 ? [line.slice(0, separator), line.slice(separator + 2)] as const : [line, ""] as const;
            }),
        );
        if (fields.get("Job ID") !== jobRunId || fields.get("Worker ID") !== workerId) throw new Error("hello.txt ownership fields do not match the active Job Lease.");
        if (fields.get("Worker OS") !== expectedPlatform) throw new Error("hello.txt Worker OS does not match the captured capability snapshot.");
        const startedAt = Date.parse(fields.get("Started At") ?? "");
        const finishedAt = Date.parse(fields.get("Finished At") ?? "");
        if (
          !Number.isFinite(startedAt) ||
          !Number.isFinite(finishedAt) ||
          finishedAt < startedAt ||
          fields.get("Started At") !== result.startedAt ||
          fields.get("Finished At") !== result.endedAt
        ) throw new Error("hello.txt execution timestamps are invalid.");
        if (
          result.commandsRun.length !== 0 ||
          result.gitDiff !== "" ||
          result.changedFiles.length !== 1 ||
          result.changedFiles[0] !== "hello.txt" ||
          result.commitShaBefore !== undefined ||
          result.commitShaAfter !== undefined ||
          result.tests !== undefined ||
          result.buildSucceeded !== undefined ||
          result.pullRequestUrl !== undefined
        ) {
          throw new Error("WORKER_SMOKE_V1 result contains non-allowlisted execution claims.");
        }
        const cleanup = this.row("SELECT id FROM job_run_events WHERE job_run_id=? AND json_extract(payload_json,'$.eventType')='CLEANUP_FINISHED' LIMIT 1", jobRunId);
        if (!cleanup) throw new Error("Worker workspace cleanup was not confirmed before submission.");
        const violation = this.row("SELECT id FROM evidence_ledger_entries WHERE job_run_id=? AND entry_type='PERMISSION_VIOLATION' LIMIT 1", jobRunId);
        if (violation) throw new Error("Permission violation prevents WORKER_SMOKE_V1 completion.");
        const timestamp = now();
        this.db.prepare("UPDATE job_runs SET status='SUBMITTED', ended_at=?, exit_code=0, commit_sha_before=NULL, commit_sha_after=NULL, updated_at=? WHERE id=? AND status='RUNNING'").run(
          result.endedAt,
          timestamp,
          jobRunId,
        );
        this.appendJobEvent(jobRunId, "STATUS", "SUCCESS", "Server accepted the fenced WORKER_SMOKE_V1 result", { artifactId: artifact.id, serverSha256: serverDigest });
        task = this.transitionUnsafe(task, "SUBMITTED", { kind: "WORKER", id: workerId }, "Worker submitted the real hello.txt artifact", "WORKER_SMOKE_SUBMITTED");
        task = this.transitionUnsafe(task, "VERIFYING", { kind: "SYSTEM", id: "worker-reality-verifier" }, "Server started independent SHA-256 and ownership verification", "WORKER_SMOKE_VERIFYING");
        const permissionCompleted = this.db.prepare("UPDATE permission_leases SET status='COMPLETED' WHERE id=? AND status='ACTIVE'").run(permission.id);
        if (Number(permissionCompleted.changes) !== 1) throw new Error("Permission Lease completion lost its state fence.");
        const completedPermission = this.getPermissionLease(permission.id)!;
        this.insertAudit(
          { kind: "SYSTEM", id: "permission-service" },
          "PERMISSION_LEASE_COMPLETED",
          "permission_lease",
          completedPermission.id,
          { jobRunId },
        );
        const observedByCheckId: Record<string, Record<string, unknown>> = {
          "worker-claimed": {
            workerId,
            jobRunId,
            executionLeaseId: job.leaseId,
            executionLeaseExpiresAt: job.leaseExpiresAt,
          },
          "execution-lease": {
            executionLeaseId: job.leaseId,
            validAt: timestamp,
            expiresAt: job.leaseExpiresAt,
          },
          "hello-created": {
            artifactId: artifact.id,
            fileName: artifact.fileName,
            size: artifact.size,
          },
          "artifact-uploaded": {
            artifactId: artifact.id,
            fileName: artifact.fileName,
            mimeType: artifact.mimeType,
            size: artifact.size,
          },
          "artifact-hash": {
            workerSha256: submittedArtifacts[0]!.sha256,
            serverSha256: serverDigest,
            matched: true,
          },
          "workspace-cleaned": {
            cleanupEventId: string(cleanup.id),
            confirmed: true,
          },
          "no-permission-violation": {
            permissionLeaseId: completedPermission.id,
            status: completedPermission.status,
            violationCount: 0,
          },
        };
        for (const check of contract.contract.acceptanceChecks) {
          const observed = observedByCheckId[check.id];
          if (!observed) throw new Error(`Unsupported WORKER_SMOKE_V1 Contract check ${check.id}.`);
          this.db.prepare("INSERT INTO verification_results(id,task_id,job_run_id,check_id,check_type,status,summary,observed_json,created_at,updated_at) VALUES(?,?,?,?,?,'PASSED',?,?,?,?)").run(
            randomUUID(),
            task.id,
            jobRunId,
            check.id,
            check.type,
            check.label,
            canonicalJson(observed),
            timestamp,
            timestamp,
          );
        }
        const verificationResults = this.rows(
          "SELECT * FROM verification_results WHERE job_run_id=? ORDER BY created_at, rowid",
          jobRunId,
        ).map(mapVerification);
        this.appendEvidenceLedgerEntry(jobRunId, "VERIFICATION_PASSED", "verification_batch", jobRunId, {
          contractSha256: contract.contractSha256,
          checks: verificationResults.map((check) => ({ id: check.checkId, status: check.status })),
          workerSha256: submittedArtifacts[0]!.sha256,
          serverSha256: serverDigest,
        }, timestamp);
        this.createWorkerSmokeReceipt({
          task,
          job: this.getJobRun(jobRunId)!,
          contract,
          permission: completedPermission,
          artifact,
          capabilityEvidence,
          verificationResults,
          startedAt: result.startedAt,
          endedAt: result.endedAt,
        });
        task = this.transitionUnsafe(task, "VERIFICATION_PASSED", { kind: "SYSTEM", id: "worker-reality-verifier" }, "Server hash, ownership, MIME, size and capability evidence all matched", "WORKER_SMOKE_VERIFIED");
        task = this.transitionUnsafe(task, "CUSTOMER_REVIEW", { kind: "SYSTEM", id: "worker-reality-verifier" }, "Fixed smoke verification requires no frontend action", "WORKER_SMOKE_REVIEW_READY");
        task = this.transitionUnsafe(task, "COMPLETED", { kind: "ADMIN", id: "worker-reality-gate" }, "Server-side state machine completed the verified fixed smoke task", "WORKER_SMOKE_COMPLETED");
        this.db.prepare("UPDATE job_runs SET status='SUCCEEDED', updated_at=? WHERE id=?").run(timestamp, jobRunId);
        this.db.prepare("UPDATE job_run_attempts SET terminal_reason='SUCCEEDED', lease_revoked_at=?, updated_at=? WHERE job_run_id=?").run(timestamp, timestamp, jobRunId);
        this.db.prepare("UPDATE task_assignments SET status='COMPLETED', updated_at=? WHERE id=?").run(timestamp, job.assignmentId);
        this.reconcileWorkerCapacity(workerId);
        return this.getTaskAggregate(task.id);
      }
      for (const command of result.commandsRun) this.insertArtifact(task, job, "COMMAND_RESULT", `${command.commandId.toLowerCase()}.json`, "application/json", JSON.stringify(command));
      if (result.tests) this.insertArtifact(task, job, "TEST_RESULT", "structured-tests.json", "application/json", JSON.stringify(result.tests));
      this.insertArtifact(task, job, "BUILD_RESULT", "structured-build.json", "application/json", JSON.stringify({ commandId: "NPM_BUILD", success: result.buildSucceeded === true, exitCode: result.buildSucceeded ? 0 : 1 }));
      this.insertArtifact(task, job, "GIT_DIFF", "structured-changes.diff", "text/x-diff", JSON.stringify({ patch: result.gitDiff, changedFiles: result.changedFiles }));
      this.insertArtifact(task, job, "FILE_MANIFEST", "structured-files.json", "application/json", JSON.stringify({ paths: result.changedFiles }));
      if (result.pullRequestUrl) this.insertArtifact(task, job, "PULL_REQUEST", "pull-request.json", "application/json", JSON.stringify({ url: result.pullRequestUrl, number: 42, state: "OPEN", targetBranch: task.targetBranch }));
      const timestamp = now();
      this.db.prepare("UPDATE job_runs SET status='SUBMITTED', ended_at=?, exit_code=?, commit_sha_before=?, commit_sha_after=?, lease_expires_at=?, updated_at=? WHERE id=?").run(
        result.endedAt,
        result.exitCode,
        result.commitShaBefore ?? null,
        result.commitShaAfter ?? null,
        timestamp,
        timestamp,
        jobRunId
      );
      this.appendJobEvent(jobRunId, "STATUS", "SUCCESS", "Worker submitted a structured execution result", { summary: result.summary, exitCode: result.exitCode });
      this.transitionUnsafe(task, "SUBMITTED", { kind: "WORKER", id: workerId }, "Worker submitted signed artifacts and a structured result", "EVIDENCE_SUBMITTED");
      this.reconcileWorkerCapacity(workerId);
      return this.getTaskAggregate(task.id);
    });
  }

  revokeWorkerToken(workerId: string): void {
    this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) return;
      const updated = { ...worker, tokenHash: null, tokenId: null, status: "OFFLINE" as const, updatedAt: now() };
      this.db.prepare("UPDATE worker_nodes SET token_hash=NULL, token_id=NULL, status='OFFLINE', data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(updated), now(), workerId);
    });
  }

  recordWorkerHeartbeat(
    workerId: string,
    status: "ONLINE" | "BUSY",
    capabilitiesValue: WorkerCapabilities,
    activeJobRunIds: string[],
    sentAt: string,
  ): WorkerRecord {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker not found.");
      const capabilities = workerCapabilitiesSchema.parse(capabilitiesValue);
      const timestamp = now();
      if (Date.parse(sentAt) > Date.now() + 5 * 60_000) throw new Error("Worker heartbeat timestamp is in the future.");
      for (const jobRunId of activeJobRunIds) {
        const activeJob = this.getJobRun(jobRunId);
        if (!activeJob || activeJob.workerId !== workerId) {
          throw new Error("Heartbeat contains a Job not owned by this Worker.");
        }
      }
      const snapshotId = randomUUID();
      const heartbeatId = randomUUID();
      this.db.prepare("INSERT INTO worker_capability_snapshots(id,worker_id,capabilities_json,reported_at,created_at) VALUES(?,?,?,?,?)").run(
        snapshotId,
        workerId,
        JSON.stringify(capabilities),
        sentAt,
        timestamp,
      );
      this.db.prepare("INSERT INTO worker_heartbeats(id,worker_id,status,active_job_run_ids_json,sent_at,received_at,capability_snapshot_id) VALUES(?,?,?,?,?,?,?)").run(
        heartbeatId,
        workerId,
        status,
        JSON.stringify(activeJobRunIds),
        sentAt,
        timestamp,
        snapshotId,
      );
      const normalizedTools = normalizeWorkerTools(capabilities);
      const updated: WorkerRecord = {
        ...worker,
        os: capabilities.os === "macos" ? "MACOS" : capabilities.os === "linux" ? "LINUX" : capabilities.os === "windows" ? "WINDOWS" : worker.os,
        installedTools: normalizedTools,
        mcpTools: capabilities.mcpServers.filter((server) => server.installed).flatMap((server) => server.tools.map((tool) => `${server.name}:${tool}`)),
        executors: capabilities.executors.map((executor) => executor === "worker-smoke"
          ? "WORKER_SMOKE"
          : executor === "repository-materializer"
            ? "REPOSITORY_MATERIALIZER"
            : executor === "codex-cli"
              ? "CODEX"
              : "DEMO"),
        maxConcurrentJobs: capabilities.maxConcurrentJobs,
        activeJobs: activeJobRunIds.length,
        capabilitySnapshot: capabilities,
        capabilitySnapshotId: snapshotId,
        id: worker.id,
        providerId: worker.providerId,
        tokenHash: worker.tokenHash,
        tokenId: worker.tokenId,
        status,
        lastHeartbeatAt: timestamp,
        updatedAt: timestamp,
      };
      this.db.prepare("UPDATE worker_nodes SET status=?, data_json=?, updated_at=? WHERE id=?").run(status, JSON.stringify(updated), timestamp, workerId);
      for (const jobRunId of activeJobRunIds) {
        const activeJob = this.getJobRun(jobRunId)!;
        if (
          activeJob.status === "RUNNING" &&
          activeJob.taskContractVersionId &&
          activeJob.leaseExpiresAt &&
          Date.parse(activeJob.leaseExpiresAt) > Date.now() &&
          this.row(
            "SELECT id FROM evidence_ledger_entries WHERE job_run_id=? AND entry_type='EXECUTION_STARTED' LIMIT 1",
            jobRunId,
          )
        ) {
          this.assertPermissionLeaseActive(jobRunId, workerId);
          this.appendEvidenceLedgerEntry(jobRunId, "HEARTBEAT_RECORDED", "worker_heartbeat", heartbeatId, {
            workerId,
            sentAt,
            receivedAt: timestamp,
            capabilitySnapshotId: snapshotId,
          }, timestamp);
        }
      }
      return updated;
    });
  }

  heartbeat(workerId: string, status: "ONLINE" | "BUSY", capabilities?: Partial<WorkerRecord>): WorkerRecord {
    return this.transaction(() => {
      const worker = this.getWorker(workerId);
      if (!worker) throw new Error("Worker not found.");
      const timestamp = now();
      const updated: WorkerRecord = { ...worker, ...capabilities, id: worker.id, providerId: worker.providerId, tokenHash: worker.tokenHash, tokenId: worker.tokenId, status, lastHeartbeatAt: timestamp, updatedAt: timestamp };
      this.db.prepare("UPDATE worker_nodes SET status=?, data_json=?, updated_at=? WHERE id=?").run(status, JSON.stringify(updated), timestamp, workerId);
      return updated;
    });
  }

  private recoverExpiredTrustedLeasesFor(replacementWorkerId: string): number {
    const replacement = this.getWorker(replacementWorkerId);
    const replacementSnapshot = this.getLatestWorkerCapabilitySnapshot(replacementWorkerId);
    if (
      !replacement ||
      !replacement.acceptingJobs ||
      replacement.status === "SUSPENDED" ||
      !replacement.tokenHash ||
      !replacementSnapshot
    ) {
      return 0;
    }
    const timestamp = now();
    const expiredRows = this.rows(
      `SELECT j.id
       FROM job_runs j
       JOIN task_assignments a ON a.id=j.assignment_id
       WHERE j.status='RUNNING'
         AND j.workflow_template IN ('WORKER_SMOKE_V1','REPOSITORY_MATERIALIZE_V1')
         AND j.lease_expires_at<=?
         AND j.worker_id<>?
         AND a.provider_id=?
       ORDER BY j.created_at, j.rowid`,
      timestamp,
      replacementWorkerId,
      replacement.providerId,
    );
    let recovered = 0;
    for (const row of expiredRows) {
      const expiredJob = this.getJobRun(string(row.id));
      if (!expiredJob) continue;
      const requiredExecutor = expiredJob.executor === "REPOSITORY_MATERIALIZER"
        ? "repository-materializer"
        : "worker-smoke";
      if (!replacementSnapshot.capabilities.executors.includes(requiredExecutor)) continue;
      const task = this.getTask(expiredJob.taskId);
      const oldAssignment = this.row("SELECT * FROM task_assignments WHERE id=?", expiredJob.assignmentId);
      if (!task || task.status !== "RUNNING" || !oldAssignment) continue;
      const fenced = this.db.prepare("UPDATE job_runs SET status='EXPIRED', ended_at=?, updated_at=? WHERE id=? AND status='RUNNING' AND lease_expires_at<=?").run(
        timestamp,
        timestamp,
        expiredJob.id,
        timestamp,
      );
      if (Number(fenced.changes) !== 1) continue;
      this.db.prepare("UPDATE job_run_attempts SET terminal_reason='LEASE_EXPIRED', lease_revoked_at=?, updated_at=? WHERE job_run_id=?").run(
        timestamp,
        timestamp,
        expiredJob.id,
      );
      const expiredPermission = this.getPermissionLeaseForJob(expiredJob.id);
      if (expiredPermission?.status === "ACTIVE") {
        this.db.prepare("UPDATE permission_leases SET status='REVOKED', revoked_at=?, revoke_reason=? WHERE id=? AND status='ACTIVE'").run(
          timestamp,
          "Execution Lease expired during recovery",
          expiredPermission.id,
        );
        this.insertAudit(
          { kind: "SYSTEM", id: "lease-recovery" },
          "PERMISSION_LEASE_REVOKED",
          "permission_lease",
          expiredPermission.id,
          { jobRunId: expiredJob.id, reason: "Execution Lease expired during recovery" },
        );
      }
      this.db.prepare("UPDATE artifact_uploads SET status='EXPIRED', updated_at=? WHERE job_run_id=? AND status IN ('PENDING','UPLOADED')").run(
        timestamp,
        expiredJob.id,
      );
      this.appendJobEvent(expiredJob.id, "STATUS", "ERROR", "Lease expired; this attempt was fenced and returned for reassignment", { leaseId: expiredJob.leaseId });
      const oldWorker = this.getWorker(expiredJob.workerId);
      if (oldWorker) {
        const offline: WorkerRecord = { ...oldWorker, status: "OFFLINE", activeJobs: 0, updatedAt: timestamp };
        this.db.prepare("UPDATE worker_nodes SET status='OFFLINE', data_json=?, updated_at=? WHERE id=?").run(JSON.stringify(offline), timestamp, oldWorker.id);
      }

      let reassignedTask = this.transitionUnsafe(
        task,
        "ASSIGNED",
        { kind: "SYSTEM", id: "lease-recovery" },
        "The Worker lease expired and the task became eligible for reassignment",
        "WORKER_LEASE_EXPIRED",
      );
      reassignedTask = { ...reassignedTask, assignedWorkerId: replacementWorkerId, updatedAt: timestamp };
      this.db.prepare("UPDATE tasks SET assigned_worker_id=?, data_json=?, updated_at=? WHERE id=?").run(
        replacementWorkerId,
        JSON.stringify(reassignedTask),
        timestamp,
        task.id,
      );
      const newAssignmentId = randomUUID();
      this.db.prepare("INSERT INTO task_assignments(id,task_id,agent_id,provider_id,worker_id,status,quote_cents,provider_earning_cents,platform_fee_cents,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,'ACCEPTED',0,0,0,?,?,?)").run(
        newAssignmentId,
        task.id,
        expiredJob.agentId,
        replacement.providerId,
        replacementWorkerId,
        timestamp,
        timestamp,
        timestamp,
      );
      const newJobRunId = randomUUID();
      if (!expiredJob.taskContractVersionId) throw new Error("Expired trusted Worker Job has no Task Contract binding.");
      const recoveredContract = this.getTaskContractVersion(expiredJob.taskContractVersionId);
      if (!recoveredContract || !["LOCKED", "SUPERSEDED"].includes(recoveredContract.status)) {
        throw new Error("Expired trusted Worker Job has an invalid Task Contract binding.");
      }
      this.db.prepare("INSERT INTO job_runs(id,task_id,assignment_id,worker_id,agent_id,status,executor,workflow_template,task_contract_version_id,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',?,?,?,?,?)").run(
        newJobRunId,
        task.id,
        newAssignmentId,
        replacementWorkerId,
        expiredJob.agentId,
        expiredJob.executor,
        expiredJob.workflowTemplate,
        recoveredContract.id,
        timestamp,
        timestamp,
      );
      const previousAttempt = this.getJobRunAttempt(expiredJob.id)?.attemptNumber ?? 1;
      this.db.prepare("INSERT INTO job_run_attempts(job_run_id,attempt_number,supersedes_job_run_id,terminal_reason,lease_revoked_at,created_at,updated_at) VALUES(?,?,?,NULL,NULL,?,?)").run(
        newJobRunId,
        previousAttempt + 1,
        expiredJob.id,
        timestamp,
        timestamp,
      );
      this.createPermissionLeaseForJob(
        newJobRunId,
        expiredPermission?.scope ?? (expiredJob.workflowTemplate === "REPOSITORY_MATERIALIZE_V1"
          ? repositoryMaterializationPermissionScope()
          : workerSmokePermissionScope()),
        "lease-recovery",
      );
      this.appendEvidenceLedgerEntry(newJobRunId, "CONTRACT_LOCKED", "task_contract_version", recoveredContract.id, {
        contractVersion: recoveredContract.version,
        contractSha256: recoveredContract.contractSha256,
        recoveredFromJobRunId: expiredJob.id,
      }, timestamp);
      this.appendJobEvent(newJobRunId, "STATUS", "INFO", "Server queued a replacement attempt after Lease expiry", { supersedesJobRunId: expiredJob.id, workerId: replacementWorkerId });
      recovered += 1;
    }
    return recovered;
  }

  getClaimCandidate(workerId: string): TaskAggregate | null {
    return this.transaction(() => {
      this.recoverExpiredTrustedLeasesFor(workerId);
      const found = this.row("SELECT t.id FROM tasks t JOIN job_runs j ON j.task_id=t.id WHERE j.worker_id=? AND j.status='QUEUED' AND t.status='ASSIGNED' ORDER BY j.created_at, j.rowid LIMIT 1", workerId);
      return found ? this.getTaskAggregate(string(found.id)) : null;
    });
  }

  claimAssignedJob(workerId: string, expectedJobRunId?: string): { aggregate: TaskAggregate; leaseToken: string } | null {
    return this.transaction(() => {
      this.recoverExpiredTrustedLeasesFor(workerId);
      const found = expectedJobRunId
        ? this.row("SELECT t.id,j.id AS job_run_id FROM tasks t JOIN job_runs j ON j.task_id=t.id WHERE j.worker_id=? AND j.id=? AND j.status='QUEUED' AND t.status='ASSIGNED'", workerId, expectedJobRunId)
        : this.row("SELECT t.id,j.id AS job_run_id FROM tasks t JOIN job_runs j ON j.task_id=t.id WHERE j.worker_id=? AND j.status='QUEUED' AND t.status='ASSIGNED' ORDER BY j.created_at, j.rowid LIMIT 1", workerId);
      if (!found) return null;
      const task = this.getTask(string(found.id));
      if (!task) return null;
      const latest = this.getLatestJob(task.id);
      if (!latest || latest.id !== string(found.job_run_id)) throw new Error("Claim candidate changed before Lease creation.");
      const claimed = this.claimJob(task);
      return { aggregate: this.getTaskAggregate(task.id), leaseToken: claimed.leaseToken };
    });
  }
}

function parseArtifactJson<T>(artifact: EvidenceArtifactRecord): T {
  if (artifact.mimeType !== "application/json") throw new Error(`${artifact.fileName} is not a JSON Artifact`);
  try {
    return JSON.parse(artifact.content) as T;
  } catch {
    throw new Error(`${artifact.fileName} contains invalid JSON`);
  }
}

function validateManagedBuildTestContextArtifacts(input: {
  byName: Map<string, EvidenceArtifactRecord>;
  source: ManagedBuildTestSourceIdentity;
  run: ManagedSandboxRunRecord;
}): void {
  const { byName, source, run } = input;
  const repository = parseArtifactJson<Record<string, unknown>>(byName.get("repository-materialization.json")!);
  assertArtifactKeys(repository, [
    "branch", "clone", "fileCount", "independentRemoteCommitSha", "manifestSha256",
    "materializerCommitSha", "materializerWorkspaceCleaned", "noRepositoryCodeExecuted",
    "remoteUrl", "remoteVerifiedAt", "schemaVersion",
  ], "Repository materialization Artifact");
  const clone = artifactRecord(repository.clone, "Repository clone Evidence");
  assertArtifactKeys(clone, ["durationMs", "exitCode", "finishedAt", "startedAt", "stderr", "stdout"], "Repository clone Evidence");
  if (
    repository.schemaVersion !== 1 ||
    repository.remoteUrl !== source.remoteUrl ||
    repository.branch !== source.branch ||
    repository.materializerCommitSha !== source.commitSha ||
    repository.independentRemoteCommitSha !== source.independentRemoteCommitSha ||
    repository.fileCount !== source.fileCount ||
    repository.manifestSha256 !== source.manifestSha256 ||
    repository.noRepositoryCodeExecuted !== true ||
    repository.materializerWorkspaceCleaned !== true ||
    clone.startedAt !== source.cloneStartedAt ||
    clone.finishedAt !== source.cloneFinishedAt ||
    clone.durationMs !== source.cloneDurationMs ||
    clone.exitCode !== 0 ||
    typeof clone.stdout !== "string" ||
    typeof clone.stderr !== "string" ||
    !isArtifactTimestamp(repository.remoteVerifiedAt) ||
    Date.parse(String(repository.remoteVerifiedAt)) < Date.parse(source.cloneFinishedAt) ||
    /(?:[A-Za-z]:[\\/](?:Users|Documents)|\/(?:Users|home)\/)/i.test(`${clone.stdout}\n${clone.stderr}`)
  ) {
    throw new Error("Repository materialization Artifact does not match the locked source identity");
  }

  const sourceMetadata = parseArtifactJson<Record<string, unknown>>(byName.get("source-package-metadata.json")!);
  assertArtifactKeys(sourceMetadata, [
    "format", "repositoryManifestSha256", "schemaVersion", "sourcePackageBytes",
    "sourcePackageManifestSha256", "sourcePackageSha256",
  ], "Source Package metadata Artifact");
  if (
    sourceMetadata.schemaVersion !== 1 ||
    sourceMetadata.format !== "DONELAYER_SOURCE_PACKAGE_JSON_V1" ||
    sourceMetadata.sourcePackageBytes !== source.sourcePackageBytes ||
    sourceMetadata.sourcePackageSha256 !== source.sourcePackageSha256 ||
    sourceMetadata.sourcePackageManifestSha256 !== source.sourcePackageManifestSha256 ||
    sourceMetadata.repositoryManifestSha256 !== source.manifestSha256
  ) {
    throw new Error("Source Package metadata Artifact does not match the locked source identity");
  }

  const provider = parseArtifactJson<Record<string, unknown>>(byName.get("managed-build-test-provider.json")!);
  assertArtifactKeys(provider, ["availability", "inspection", "metadata"], "Managed build/test Provider Artifact");
  const availability = artifactRecord(provider.availability, "Provider availability Evidence");
  const metadata = artifactRecord(provider.metadata, "Provider metadata Evidence");
  const inspection = artifactRecord(provider.inspection, "Provider inspection Evidence");
  assertArtifactKeys(availability, ["authentication", "available", "checkedAt", "errorCode", "errorMessage", "provider"], "Provider availability Evidence");
  assertArtifactKeys(metadata, ["authentication", "provider", "sdkPackage", "sdkVersion"], "Provider metadata Evidence");
  assertArtifactKeys(inspection, [
    "allowedCidrs", "allowedDomains", "createdAt", "currentSnapshotId", "cwd", "image",
    "memoryMb", "networkPolicy", "persistent", "portCount", "provider", "region", "runtime",
    "sandboxId", "sessionId", "sourceSnapshotId", "status", "statusUpdatedAt", "timeoutMs", "vcpus",
  ], "Provider inspection Evidence");
  const persistedInspection = artifactRecord(run.providerMetadata.createInspection, "Persisted Provider inspection");
  const expectedProviderMetadata = {
    provider: run.providerMetadata.provider,
    sdkPackage: run.providerMetadata.sdkPackage,
    sdkVersion: run.providerMetadata.sdkVersion,
    authentication: run.providerMetadata.authentication,
  };
  if (
    availability.available !== true ||
    availability.provider !== MANAGED_SANDBOX_PROVIDER ||
    availability.authentication !== "VERCEL_OIDC_DEVELOPMENT" ||
    availability.errorCode !== null ||
    availability.errorMessage !== null ||
    !isArtifactTimestamp(availability.checkedAt) ||
    metadata.provider !== MANAGED_SANDBOX_PROVIDER ||
    metadata.sdkPackage !== "@vercel/sandbox" ||
    typeof metadata.sdkVersion !== "string" ||
    !metadata.sdkVersion ||
    metadata.authentication !== "VERCEL_OIDC_DEVELOPMENT" ||
    canonicalJson(metadata) !== canonicalJson(expectedProviderMetadata) ||
    canonicalJson(inspection) !== canonicalJson(persistedInspection) ||
    inspection.provider !== MANAGED_SANDBOX_PROVIDER ||
    inspection.sandboxId !== run.providerSandboxId ||
    typeof inspection.sessionId !== "string" ||
    !inspection.sessionId ||
    inspection.region !== run.region ||
    inspection.runtime !== run.runtime ||
    inspection.persistent !== false ||
    inspection.networkPolicy !== "deny-all" ||
    canonicalJson(inspection.allowedDomains) !== "[]" ||
    canonicalJson(inspection.allowedCidrs) !== "[]" ||
    inspection.portCount !== 0 ||
    inspection.sourceSnapshotId !== null ||
    inspection.currentSnapshotId !== null ||
    inspection.cwd !== "/vercel/sandbox"
  ) {
    throw new Error("Managed build/test Provider Artifact does not match the persisted Sandbox Run");
  }

  const profile = parseArtifactJson<Record<string, unknown>>(byName.get("managed-build-test-policy.json")!);
  const expectedProfile = managedSandboxBuildTestSecurityProfile(source.commitSha, source.buildScriptPresent);
  if (canonicalJson(profile) !== canonicalJson(expectedProfile)) {
    throw new Error("Managed build/test policy Artifact does not match the locked security profile");
  }

  const cleanup = parseArtifactJson<Record<string, unknown>>(byName.get("managed-build-test-cleanup.json")!);
  assertArtifactKeys(cleanup, [
    "cleanupVerified", "finalProviderState", "persistent", "sandboxId", "snapshotCreated",
    "stillRunning", "stopConfirmedAt", "stopRequestedAt", "usage",
  ], "Managed build/test cleanup Artifact");
  const usage = artifactRecord(cleanup.usage, "Managed build/test Provider usage Evidence");
  assertArtifactKeys(usage, [
    "costUsd", "totalActiveCpuDurationMs", "totalDurationMs", "totalEgressBytes", "totalIngressBytes",
  ], "Managed build/test Provider usage Evidence");
  const nullableNonNegativeNumber = (value: unknown) => value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (
    cleanup.sandboxId !== run.providerSandboxId ||
    !isArtifactTimestamp(cleanup.stopRequestedAt) ||
    !isArtifactTimestamp(cleanup.stopConfirmedAt) ||
    Date.parse(String(cleanup.stopConfirmedAt)) < Date.parse(String(cleanup.stopRequestedAt)) ||
    cleanup.stopConfirmedAt !== run.stoppedAt ||
    cleanup.stopConfirmedAt !== run.destroyedAt ||
    cleanup.stopConfirmedAt !== run.cleanupVerifiedAt ||
    cleanup.finalProviderState !== run.providerMetadata.finalProviderState ||
    cleanup.persistent !== false ||
    cleanup.snapshotCreated !== false ||
    cleanup.stillRunning !== false ||
    cleanup.cleanupVerified !== true ||
    !nullableNonNegativeNumber(usage.totalActiveCpuDurationMs) ||
    !nullableNonNegativeNumber(usage.totalDurationMs) ||
    !nullableNonNegativeNumber(usage.totalIngressBytes) ||
    !nullableNonNegativeNumber(usage.totalEgressBytes) ||
    usage.costUsd !== null
  ) {
    throw new Error("Managed build/test cleanup Artifact does not match verified Provider cleanup");
  }

  const lifecycle = parseArtifactJson<Record<string, unknown>>(byName.get("managed-build-test-lifecycle.json")!);
  assertArtifactKeys(lifecycle, [
    "build", "cleanup", "created", "finalNetworkPolicy", "install", "installNetworkPolicy", "test",
  ], "Managed build/test lifecycle Artifact");
  const installResult = parseArtifactJson<Record<string, unknown>>(byName.get("install-result.json")!);
  const buildResult = parseArtifactJson<Record<string, unknown>>(byName.get("build-result.json")!);
  const testResult = parseArtifactJson<Record<string, unknown>>(byName.get("test-result.json")!);
  assertArtifactKeys(installResult, [
    "command", "commandId", "durationMs", "exitCode", "finishedAt", "startedAt", "status",
    "stderrArtifact", "stdoutArtifact",
  ], "Install result Artifact");
  assertArtifactKeys(buildResult, [
    "command", "commandId", "durationMs", "exitCode", "finishedAt", "startedAt", "status",
    "stderrArtifact", "stdoutArtifact",
  ], "Build result Artifact");
  assertArtifactKeys(testResult, [
    "command", "commandId", "durationMs", "exitCode", "failedTests", "finishedAt", "passedTests",
    "startedAt", "statisticsStatus", "status", "stderrArtifact", "stdoutArtifact", "testRunner", "totalTests",
  ], "Test result Artifact");
  const installPolicy = artifactRecord(run.networkPolicy.install, "Persisted install network policy");
  const finalPolicy = artifactRecord(run.networkPolicy.final, "Persisted final network policy");
  for (const [label, policy] of [["Install", installPolicy], ["Final", finalPolicy]] as const) {
    assertArtifactKeys(policy, ["allowedCidrs", "allowedDomains", "mode", "observedAt"], `${label} network policy Evidence`);
    if (!isArtifactTimestamp(policy.observedAt)) throw new Error(`${label} network policy timestamp is invalid`);
  }
  if (
    canonicalJson(lifecycle.created) !== canonicalJson(inspection) ||
    canonicalJson(lifecycle.installNetworkPolicy) !== canonicalJson(installPolicy) ||
    canonicalJson(lifecycle.finalNetworkPolicy) !== canonicalJson(finalPolicy) ||
    canonicalJson(lifecycle.install) !== canonicalJson(installResult) ||
    canonicalJson(lifecycle.build) !== canonicalJson(buildResult) ||
    canonicalJson(lifecycle.test) !== canonicalJson(testResult) ||
    canonicalJson(lifecycle.cleanup) !== canonicalJson(cleanup)
  ) {
    throw new Error("Managed build/test lifecycle Artifact is not cross-bound to its Provider Evidence");
  }
}

function artifactRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertArtifactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) throw new Error(`${label} contains unsupported or missing fields`);
}

function isArtifactTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseManagedBuildTestCommandArtifact(
  artifact: EvidenceArtifactRecord,
): ManagedBuildTestCommandEvidence {
  const value = parseArtifactJson<Record<string, unknown>>(artifact);
  const status = value.status;
  const stdoutArtifact = parseReceiptArtifactReference(value.stdoutArtifact, "stdout");
  const stderrArtifact = parseReceiptArtifactReference(value.stderrArtifact, "stderr");
  if (
    typeof value.command !== "string" ||
    (typeof value.exitCode !== "number" && value.exitCode !== null) ||
    !Number.isInteger(value.exitCode) && value.exitCode !== null ||
    typeof value.durationMs !== "number" ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    typeof value.startedAt !== "string" ||
    typeof value.finishedAt !== "string" ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !Number.isFinite(Date.parse(value.finishedAt)) ||
    Date.parse(value.finishedAt) < Date.parse(value.startedAt) ||
    !["PASSED", "FAILED", "NOT_PRESENT", "TIMED_OUT", "UNPARSABLE"].includes(String(status))
  ) throw new Error(`${artifact.fileName} contains invalid command Evidence`);
  return {
    command: value.command,
    exitCode: value.exitCode as number | null,
    durationMs: value.durationMs,
    status: status as BuildTestCommandSummary["status"],
    stdoutArtifact,
    stderrArtifact,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
  };
}

function parseManagedBuildTestTestArtifact(
  artifact: EvidenceArtifactRecord,
): ManagedBuildTestTestEvidence {
  const command = parseManagedBuildTestCommandArtifact(artifact);
  const value = parseArtifactJson<Record<string, unknown>>(artifact);
  const statisticsStatus = value.statisticsStatus;
  const nullableCount = (candidate: unknown, name: string): number | null => {
    if (candidate === null) return null;
    if (!Number.isSafeInteger(candidate) || Number(candidate) < 0) throw new Error(`${artifact.fileName} contains invalid ${name}`);
    return Number(candidate);
  };
  if (
    statisticsStatus !== "PARSED" && statisticsStatus !== "UNPARSABLE" ||
    value.testRunner !== null && typeof value.testRunner !== "string"
  ) throw new Error(`${artifact.fileName} contains invalid test statistics`);
  return {
    ...command,
    testRunner: value.testRunner as string | null,
    totalTests: nullableCount(value.totalTests, "totalTests"),
    passedTests: nullableCount(value.passedTests, "passedTests"),
    failedTests: nullableCount(value.failedTests, "failedTests"),
    statisticsStatus,
  };
}

function parseReceiptArtifactReference(value: unknown, label: string): {
  fileName: string;
  sha256: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Command ${label} Artifact reference is invalid`);
  }
  const reference = value as Record<string, unknown>;
  if (
    typeof reference.fileName !== "string" ||
    typeof reference.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(reference.sha256)
  ) throw new Error(`Command ${label} Artifact reference is invalid`);
  return { fileName: reference.fileName, sha256: reference.sha256 };
}

function validateCommandArtifactReferences(
  command: ManagedBuildTestCommandEvidence,
  byName: Map<string, EvidenceArtifactRecord>,
): void {
  const prefix = command.command.startsWith("npm ci")
    ? "install"
    : command.command === "npm run build"
      ? "build"
      : command.command === "npm test"
        ? "test"
        : command.status === "NOT_PRESENT"
          ? "build"
          : null;
  if (!prefix) throw new Error("Command Artifact uses an unsupported fixed command");
  if (
    command.stdoutArtifact.fileName !== `${prefix}-stdout.log` ||
    command.stderrArtifact.fileName !== `${prefix}-stderr.log`
  ) throw new Error("Command Artifact references unexpected log filenames");
  for (const reference of [command.stdoutArtifact, command.stderrArtifact]) {
    const artifact = byName.get(reference.fileName);
    if (!artifact?.serverSha256 || !safeEqualHex(artifact.serverSha256, reference.sha256)) {
      throw new Error(`Command log Artifact ${reference.fileName} hash mismatch`);
    }
  }
}

function receiptCommandSummary(command: ManagedBuildTestCommandEvidence): BuildTestCommandSummary {
  return {
    command: command.command,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    status: command.status,
    stdoutArtifact: { ...command.stdoutArtifact },
    stderrArtifact: { ...command.stderrArtifact },
  };
}

type GlobalStore = typeof globalThis & { __doneLayerDemoStore?: DemoStore };

export function getDemoStore(): DemoStore {
  const shared = globalThis as GlobalStore;
  shared.__doneLayerDemoStore ??= new DemoStore(undefined, {
    leaseDurationMs: positiveEnvironmentInteger("DONELAYER_WORKER_LEASE_TTL_MS") ?? 60_000,
    artifactUploadTtlMs: positiveEnvironmentInteger("DONELAYER_ARTIFACT_UPLOAD_TTL_MS") ?? 5 * 60_000,
    heartbeatTtlMs: positiveEnvironmentInteger("DONELAYER_WORKER_HEARTBEAT_TTL_MS") ?? 90_000,
  });
  return shared.__doneLayerDemoStore;
}

function positiveEnvironmentInteger(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export const demoIds = {
  customer: CUSTOMER_ID,
  providerAlpha: PROVIDER_ALPHA_ID,
  platform: PLATFORM_ID,
  escrow: ESCROW_ID
} as const;
