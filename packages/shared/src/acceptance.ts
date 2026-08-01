import { z } from "zod";

export const acceptanceCheckTypes = [
  "COMMAND_EXIT",
  "TEST",
  "BUILD",
  "GITHUB_CHECK",
  "DIFF",
  "FILE_EXISTS",
  "PULL_REQUEST",
  "URL_HEALTH",
  "SCREENSHOT",
  "HUMAN_APPROVAL",
] as const;

export const evidenceTypes = [
  "COMMAND",
  "TEST",
  "BUILD",
  "GITHUB_CHECK",
  "DIFF",
  "FILE_MANIFEST",
  "PULL_REQUEST",
  "URL_HEALTH",
  "ARTIFACT",
  "HUMAN_APPROVAL",
] as const;

export const evidenceArtifactTypes = [
  "BUILD_LOG",
  "TEST_LOG",
  "GIT_DIFF",
  "SCREENSHOT",
  "REPORT",
  "OTHER",
] as const;

export const approvalActorKinds = ["CUSTOMER", "ADMIN"] as const;

export const safeRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => {
    const normalized = value.replaceAll("\\", "/");
    const segments = normalized.split("/");

    return (
      !normalized.startsWith("/") &&
      !/^[a-zA-Z]:\//.test(normalized) &&
      !normalized.includes("\0") &&
      !segments.includes("..")
    );
  }, "Path must stay within the job workspace");

const acceptanceCheckBaseSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(200),
  required: z.boolean().default(true),
});

export const commandExitCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("COMMAND_EXIT"),
  commandId: z.string().trim().min(1).max(128),
  allowedExitCodes: z.array(z.number().int()).min(1).default([0]),
});

export const testCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("TEST"),
  minimumTotal: z.number().int().nonnegative().default(1),
  minimumPassed: z.number().int().nonnegative().default(1),
  maximumFailed: z.number().int().nonnegative().default(0),
});

export const buildCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("BUILD"),
  commandId: z.string().trim().min(1).max(128).optional(),
});

export const githubCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("GITHUB_CHECK"),
  checkName: z.string().trim().min(1).max(255),
  repository: z.string().trim().min(1).max(500).optional(),
});

export const diffCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("DIFF"),
  minimumChangedFiles: z.number().int().positive().default(1),
  requireNonEmptyPatch: z.boolean().default(true),
});

export const fileExistsCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("FILE_EXISTS"),
  path: safeRelativePathSchema,
});

export const pullRequestCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("PULL_REQUEST"),
  targetBranch: z.string().trim().min(1).max(255).optional(),
  allowedStates: z
    .array(z.enum(["OPEN", "MERGED"]))
    .min(1)
    .default(["OPEN", "MERGED"]),
});

export const urlHealthCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("URL_HEALTH"),
  url: z.url(),
  allowedStatuses: z
    .array(z.number().int().min(100).max(599))
    .min(1)
    .default([200]),
});

export const screenshotCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("SCREENSHOT"),
  fileName: z.string().trim().min(1).max(255).optional(),
  minimumCount: z.number().int().positive().default(1),
});

export const humanApprovalCheckSchema = acceptanceCheckBaseSchema.extend({
  type: z.literal("HUMAN_APPROVAL"),
  approverKind: z.enum(approvalActorKinds),
  allowAdminOverride: z.boolean().default(true),
});

export const acceptanceCheckSchema = z.discriminatedUnion("type", [
  commandExitCheckSchema,
  testCheckSchema,
  buildCheckSchema,
  githubCheckSchema,
  diffCheckSchema,
  fileExistsCheckSchema,
  pullRequestCheckSchema,
  urlHealthCheckSchema,
  screenshotCheckSchema,
  humanApprovalCheckSchema,
]);

const evidenceBaseSchema = z.object({
  id: z.string().trim().min(1).max(128),
  createdAt: z.iso.datetime({ offset: true }),
  jobRunId: z.string().trim().min(1).max(128),
  workerId: z.string().trim().min(1).max(128),
});

export const commandEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("COMMAND"),
  commandId: z.string().trim().min(1).max(128),
  exitCode: z.number().int(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
});

export const testEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("TEST"),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative().default(0),
});

export const buildEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("BUILD"),
  commandId: z.string().trim().min(1).max(128).optional(),
  success: z.boolean(),
  exitCode: z.number().int(),
});

export const githubCheckEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("GITHUB_CHECK"),
  checkName: z.string().trim().min(1).max(255),
  repository: z.string().trim().min(1).max(500).optional(),
  status: z.enum(["SUCCESS", "FAILURE", "PENDING"]),
  commitSha: z.string().regex(/^[a-fA-F0-9]{7,64}$/).optional(),
});

export const diffEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("DIFF"),
  patch: z.string(),
  changedFiles: z.array(safeRelativePathSchema),
});

export const fileManifestEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("FILE_MANIFEST"),
  paths: z.array(safeRelativePathSchema),
});

export const pullRequestEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("PULL_REQUEST"),
  url: z.url(),
  number: z.number().int().positive(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  targetBranch: z.string().trim().min(1).max(255),
});

export const urlHealthEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("URL_HEALTH"),
  url: z.url(),
  status: z.number().int().min(100).max(599),
});

export const artifactEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("ARTIFACT"),
  artifactType: z.enum(evidenceArtifactTypes),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storagePath: safeRelativePathSchema,
});

export const humanApprovalEvidenceSchema = evidenceBaseSchema.extend({
  type: z.literal("HUMAN_APPROVAL"),
  actorKind: z.enum(approvalActorKinds),
  actorId: z.string().trim().min(1).max(128),
  approved: z.boolean(),
  approvedAt: z.iso.datetime({ offset: true }),
});

export const evidenceSchema = z.discriminatedUnion("type", [
  commandEvidenceSchema,
  testEvidenceSchema,
  buildEvidenceSchema,
  githubCheckEvidenceSchema,
  diffEvidenceSchema,
  fileManifestEvidenceSchema,
  pullRequestEvidenceSchema,
  urlHealthEvidenceSchema,
  artifactEvidenceSchema,
  humanApprovalEvidenceSchema,
]);

export const evidencePackSchema = z.object({
  taskId: z.string().trim().min(1).max(128),
  agentId: z.string().trim().min(1).max(128),
  workerId: z.string().trim().min(1).max(128),
  jobRunId: z.string().trim().min(1).max(128),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  commitShaBefore: z.string().regex(/^[a-fA-F0-9]{7,64}$/).optional(),
  commitShaAfter: z.string().regex(/^[a-fA-F0-9]{7,64}$/).optional(),
  evidence: z.array(evidenceSchema),
});

export type AcceptanceCheck = z.output<typeof acceptanceCheckSchema>;
export type AcceptanceCheckInput = z.input<typeof acceptanceCheckSchema>;
export type Evidence = z.output<typeof evidenceSchema>;
export type EvidenceInput = z.input<typeof evidenceSchema>;
export type EvidencePack = z.output<typeof evidencePackSchema>;
export type EvidencePackInput = z.input<typeof evidencePackSchema>;
