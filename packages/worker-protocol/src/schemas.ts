import { z } from "zod";

import {
  SAFE_COMMAND_IDS,
  WORKER_PROTOCOL_VERSION,
  WORKFLOW_TEMPLATE_IDS,
} from "./types";
import { isCommandAllowed } from "./workflows";

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
  memoryBytes: z.number().int().nonnegative(),
  freeDiskBytes: z.number().int().nonnegative(),
  dockerAvailable: z.boolean(),
  codexAvailable: z.boolean(),
  gitAvailable: z.boolean(),
  githubCliAvailable: z.boolean(),
  supportedLanguages: z.array(nonEmpty),
  installedTools: z.array(nonEmpty),
  mcpServers: z.array(mcpServerCapabilitySchema),
  executors: z.array(z.enum(["demo", "codex-cli"])),
  maxConcurrentJobs: z.number().int().min(1).max(32),
});

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
  ]),
  required: z.boolean(),
  label: nonEmpty,
  config: z.record(z.string(), z.unknown()),
});

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
    executor: z.object({
      kind: z.enum(["demo", "codex-cli"]),
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
    repository: z.object({
      mode: z.enum(["demo", "github-app"]),
      owner: nonEmpty,
      name: nonEmpty,
      targetBranch: nonEmpty,
      commitSha: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
      archiveUrl: z.string().url().optional(),
    }),
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
    if (job.repository.mode === "github-app" && !job.repository.archiveUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repository", "archiveUrl"],
        message: "GitHub App jobs require a short-lived repository archive URL",
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
    "EXECUTOR_STARTED",
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
