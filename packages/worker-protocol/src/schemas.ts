import { z } from "zod";

import {
  SAFE_COMMAND_IDS,
  WORKER_PROTOCOL_VERSION,
  WORKFLOW_TEMPLATE_IDS,
} from "./types";
import { isCommandAllowed } from "./workflows";
import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_NAME,
  REPOSITORY_MATERIALIZATION_OWNER,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
} from "./repository-materialization";

const isoDate = z.string().datetime({ offset: true });
const nonEmpty = z.string().trim().min(1);

export const mcpServerCapabilitySchema = z.object({
  name: nonEmpty,
  transport: z.enum(["stdio", "sse", "streamable-http", "unknown"]),
  tools: z.array(nonEmpty),
  resources: z.array(nonEmpty),
  prompts: z.array(nonEmpty),
  authenticationRequired: z.boolean(),
  installed: z.boolean(),
});

export const workerCapabilitiesSchema = z.object({
  os: z.enum(["windows", "macos", "linux", "unknown"]),
  architecture: nonEmpty,
  cpuCount: z.number().int().positive(),
  nodeVersion: nonEmpty,
  npmVersion: nonEmpty.nullable(),
  workerVersion: nonEmpty,
  processId: z.number().int().positive(),
  memoryBytes: z.number().int().nonnegative(),
  availableMemoryBytes: z.number().int().nonnegative(),
  freeDiskBytes: z.number().int().nonnegative(),
  dockerAvailable: z.boolean(),
  codexAvailable: z.boolean(),
  gitAvailable: z.boolean(),
  githubCliAvailable: z.boolean(),
  supportedLanguages: z.array(nonEmpty),
  installedTools: z.array(nonEmpty),
  mcpServers: z.array(mcpServerCapabilitySchema),
  executors: z.array(z.enum(["worker-smoke", "repository-materializer", "demo", "codex-cli"])),
  maxConcurrentJobs: z.number().int().min(1).max(32),
}).superRefine((capabilities, context) => {
  if (capabilities.availableMemoryBytes > capabilities.memoryBytes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["availableMemoryBytes"],
      message: "Available memory cannot exceed total memory",
    });
  }
});

export const permissionScopeSchema = z.object({
  allowedActions: z.array(nonEmpty).min(1).max(100),
  deniedActions: z.array(nonEmpty).min(1).max(100),
  allowedPaths: z.array(nonEmpty).min(1).max(100),
  allowedDomains: z.array(nonEmpty).max(100),
  allowedRepositories: z.array(nonEmpty).max(20).optional(),
  allowedBranches: z.array(nonEmpty).max(20).optional(),
  allowedCommitShas: z.array(z.string().regex(/^[a-f0-9]{40}$/)).max(20).optional(),
  allowedSandboxProviders: z.array(nonEmpty).max(10).optional(),
  allowedExecutionBackends: z.array(nonEmpty).max(10).optional(),
  allowedWorkflows: z.array(nonEmpty).max(20).optional(),
  allowedFiles: z.array(nonEmpty).max(20).optional(),
  allowedEnvironmentVariables: z.array(nonEmpty).max(20).optional(),
  maxArtifactBytes: z.number().int().positive().max(100 * 1024 * 1024),
  maxRuntimeSeconds: z.number().int().positive().max(4 * 60 * 60),
  maxApiBudget: z.number().nonnegative().max(1_000_000),
  maxSandboxes: z.number().int().positive().max(3).optional(),
  maxCommands: z.number().int().positive().max(10).optional(),
  maxStdoutBytes: z.number().int().positive().max(10 * 1024 * 1024).optional(),
  maxStderrBytes: z.number().int().positive().max(10 * 1024 * 1024).optional(),
  networkPolicy: z.literal("deny-all").optional(),
  persistence: z.literal("none").optional(),
  humanApprovalActions: z.array(nonEmpty).max(100),
}).strict();

export const pairWorkerRequestSchema = z.object({
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  pairingCode: z.string().trim().min(6).max(128),
  name: z.string().trim().min(2).max(100),
  capabilities: workerCapabilitiesSchema,
});

export const pairWorkerResponseSchema = z.object({
  workerId: z.string().uuid(),
  workerToken: z.string().min(32),
  pairedAt: isoDate,
  tokenExpiresAt: isoDate.optional(),
});

export const workerHeartbeatSchema = z.object({
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  status: z.enum(["ONLINE", "BUSY"]),
  capabilities: workerCapabilitiesSchema,
  activeJobRunIds: z.array(z.string().uuid()).max(32),
  sentAt: isoDate,
});

export const claimJobRequestSchema = z.object({
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  availableSlots: z.number().int().min(1).max(32),
});

export const leaseRequestSchema = z.object({
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  leaseToken: z.string().min(32),
});

const acceptanceCheckSchema = z.object({
  id: nonEmpty,
  type: z.enum([
    "COMMAND_EXIT",
    "TEST",
    "BUILD",
    "GITHUB_CHECK",
    "FILE_EXISTS",
    "DIFF",
    "PULL_REQUEST",
    "URL_HEALTH",
    "SCREENSHOT",
    "HUMAN_APPROVAL",
    "JOB_CLAIMED",
    "LEASE_ACTIVE",
    "ARTIFACT",
    "SHA256",
    "WORKSPACE_CLEANED",
    "PERMISSION",
  ]),
  required: z.boolean(),
  label: nonEmpty,
  config: z.record(z.string(), z.unknown()),
});

const repositoryOwner = z.string().min(1).max(100).regex(
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/,
  "Repository owner is invalid",
);
const repositoryName = z.string().min(1).max(100).regex(
  /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/,
  "Repository name is invalid",
);
const targetBranch = z.string().min(1).max(255).superRefine((branch, context) => {
  if (
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{") ||
    /[\\~^:?*[\x00-\x20\x7f]/.test(branch)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Target branch is invalid" });
  }
});
const repositorySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({
    mode: z.literal("allowlisted-github"),
    remoteUrl: z.literal(REPOSITORY_MATERIALIZATION_REMOTE_URL),
    owner: z.literal(REPOSITORY_MATERIALIZATION_OWNER),
    name: z.literal(REPOSITORY_MATERIALIZATION_NAME),
    targetBranch: z.literal(REPOSITORY_MATERIALIZATION_BRANCH),
  }).strict(),
  z.object({
    mode: z.literal("demo"),
    owner: repositoryOwner,
    name: repositoryName,
    targetBranch,
  }).strict(),
  z.object({
    mode: z.literal("github-app"),
    repositoryId: z.string().uuid(),
    owner: repositoryOwner,
    name: repositoryName,
    targetBranch,
    commitSha: z.string().regex(/^[a-f0-9]{40}$/i),
    archiveUrl: z.url().refine((value) => new URL(value).protocol === "https:", {
      message: "Repository archive URL must use HTTPS",
    }),
  }).strict(),
]);

export const jobEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
    taskId: z.string().uuid(),
    assignmentId: z.string().uuid(),
    providerAcceptedAt: isoDate,
    jobRunId: z.string().uuid(),
    workerId: z.string().uuid(),
    leaseToken: z.string().min(32),
    leaseExpiresAt: isoDate,
    taskContract: z.object({
      id: z.string().uuid(),
      version: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
    permissionLease: z.object({
      id: z.string().uuid(),
      version: z.number().int().positive(),
      status: z.literal("ACTIVE"),
      startsAt: isoDate,
      expiresAt: isoDate,
      scope: permissionScopeSchema,
    }).strict(),
    executor: z.object({
      kind: z.enum(["worker-smoke", "repository-materializer", "demo", "codex-cli"]),
      model: nonEmpty.optional(),
    }),
    workflow: z.object({
      id: z.enum(WORKFLOW_TEMPLATE_IDS),
      version: z.literal(1),
      allowedCommandIds: z.array(z.enum(SAFE_COMMAND_IDS)).max(SAFE_COMMAND_IDS.length),
    }),
    task: z.object({
      title: nonEmpty.max(200),
      problemDescription: nonEmpty.max(20_000),
      desiredOutcome: nonEmpty.max(10_000),
      scopeSummary: nonEmpty.max(5_000),
      acceptanceChecks: z.array(acceptanceCheckSchema).max(50),
    }),
    repository: repositorySchema,
    permissions: z.object({
      modifyCode: z.boolean(),
      createPullRequest: z.boolean(),
      humanApprovalRequired: z.boolean(),
    }),
    limits: z.object({
      timeoutMs: z.number().int().min(1_000).max(4 * 60 * 60 * 1_000),
      maxLogBytes: z.number().int().min(1_024).max(50 * 1024 * 1024),
      maxArtifactBytes: z.number().int().min(1_024).max(100 * 1024 * 1024),
      maxArtifacts: z.number().int().min(1).max(100),
      allowedMimeTypes: z.array(nonEmpty).max(50),
      allowedNetworkDomains: z.array(nonEmpty).max(100),
    }),
  })
  .superRefine((job, context) => {
    for (const [index, commandId] of job.workflow.allowedCommandIds.entries()) {
      if (!isCommandAllowed(job.workflow.id, commandId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workflow", "allowedCommandIds", index],
          message: `${commandId} is not allowed by ${job.workflow.id}`,
        });
      }
    }
    if (job.workflow.id === "WORKER_SMOKE_V1" && job.executor.kind !== "worker-smoke") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executor", "kind"],
        message: "WORKER_SMOKE_V1 requires the Worker smoke executor",
      });
    }
    if (job.workflow.id === "WORKER_SMOKE_V1" && job.repository.mode !== "none") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repository", "mode"],
        message: "WORKER_SMOKE_V1 cannot use a repository",
      });
    }
    if (job.executor.kind === "worker-smoke" && job.workflow.id !== "WORKER_SMOKE_V1") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workflow", "id"],
        message: "Worker smoke executor only accepts WORKER_SMOKE_V1",
      });
    }
    if (
      job.workflow.id === "REPOSITORY_MATERIALIZE_V1" &&
      (job.executor.kind !== "repository-materializer" || job.repository.mode !== "allowlisted-github")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repository", "mode"],
        message: "REPOSITORY_MATERIALIZE_V1 requires the allowlisted repository materializer",
      });
    }
    if (job.workflow.id === "REPOSITORY_MATERIALIZE_V1") {
      if (
        JSON.stringify(job.permissionLease.scope.allowedRepositories) !==
        JSON.stringify([REPOSITORY_MATERIALIZATION_REMOTE_URL])
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["permissionLease", "scope", "allowedRepositories"],
          message: "Repository Permission Lease must contain only the fixed allowlist URL",
        });
      }
      if (
        JSON.stringify(job.permissionLease.scope.allowedBranches) !==
        JSON.stringify([REPOSITORY_MATERIALIZATION_BRANCH])
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["permissionLease", "scope", "allowedBranches"],
          message: "Repository Permission Lease must contain only main",
        });
      }
      if (
        job.permissionLease.scope.allowedDomains.length !== 1 ||
        job.permissionLease.scope.allowedDomains[0]?.toLowerCase() !== "github.com"
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["permissionLease", "scope", "allowedDomains"],
          message: "Repository Permission Lease must contain only github.com",
        });
      }
    }
    if (
      job.executor.kind === "repository-materializer" &&
      job.workflow.id !== "REPOSITORY_MATERIALIZE_V1"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workflow", "id"],
        message: "Repository materializer only accepts REPOSITORY_MATERIALIZE_V1",
      });
    }
    if (Date.parse(job.leaseExpiresAt) > Date.parse(job.permissionLease.expiresAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leaseExpiresAt"],
        message: "Execution Lease cannot outlive the Permission Lease",
      });
    }
    if (job.limits.maxArtifactBytes !== job.permissionLease.scope.maxArtifactBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limits", "maxArtifactBytes"],
        message: "Job artifact limit must be derived from the Permission Lease",
      });
    }
    if (
      JSON.stringify([...job.limits.allowedNetworkDomains].sort()) !==
      JSON.stringify([...job.permissionLease.scope.allowedDomains].sort())
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["limits", "allowedNetworkDomains"],
        message: "Job network domains must be derived from the Permission Lease",
      });
    }
  });

export const jobRunEventSchema = z.object({
  protocolVersion: z.literal(WORKER_PROTOCOL_VERSION),
  eventId: z.string().uuid(),
  jobRunId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  type: z.enum([
    "WORKSPACE_PREPARED",
    "PERMISSION_VIOLATION",
    "EXECUTOR_STARTED",
    "REPOSITORY_CLONE_STARTED",
    "REPOSITORY_CLONE_COMPLETED",
    "REMOTE_METADATA_CAPTURED",
    "FILE_MANIFEST_CREATED",
    "PROGRESS",
    "LOG",
    "FILE_CHANGED",
    "TEST_RESULT",
    "BUILD_RESULT",
    "ARTIFACT_CREATED",
    "EXECUTOR_FINISHED",
    "EXECUTOR_FAILED",
    "CANCELLED",
    "CLEANUP_FINISHED",
  ]),
  message: z.string().max(16_384),
  progress: z.number().min(0).max(100).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  createdAt: isoDate,
});

export const jobControlResponseSchema = z.object({
  cancelRequested: z.boolean(),
  leaseExpiresAt: isoDate,
});
