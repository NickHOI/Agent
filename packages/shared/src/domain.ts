import { z } from "zod";

import { acceptanceCheckSchema } from "./acceptance";

export const taskStatuses = [
  "DRAFT",
  "PUBLISHED",
  "ANALYZING",
  "MATCHING",
  "MATCHED",
  "AWAITING_PROVIDER",
  "ASSIGNED",
  "RUNNING",
  "SUBMITTED",
  "VERIFYING",
  "VERIFICATION_PASSED",
  "VERIFICATION_FAILED",
  "CUSTOMER_REVIEW",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
] as const;

export const actorKinds = [
  "CUSTOMER",
  "PROVIDER",
  "WORKER",
  "ADMIN",
  "SYSTEM",
] as const;

export const taskTypes = [
  "DIAGNOSE_REPOSITORY",
  "BUILD_RESCUE",
  "TEST_AND_FIX",
  "FEATURE_COMPLETION",
  "PULL_REQUEST_VERIFICATION",
  "LAUNCH_READINESS",
] as const;

export const operatingSystems = ["ANY", "WINDOWS", "MACOS", "LINUX"] as const;
export const workerStatuses = ["ONLINE", "BUSY", "OFFLINE", "SUSPENDED"] as const;
export const agentVerificationStatuses = [
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
] as const;
export const securitySensitivityLevels = ["LOW", "MEDIUM", "HIGH"] as const;

export const taskStatusSchema = z.enum(taskStatuses);
export const actorKindSchema = z.enum(actorKinds);
export const taskTypeSchema = z.enum(taskTypes);
export const operatingSystemSchema = z.enum(operatingSystems);
export const workerStatusSchema = z.enum(workerStatuses);
export const agentVerificationStatusSchema = z.enum(agentVerificationStatuses);
export const securitySensitivitySchema = z.enum(securitySensitivityLevels);

export const actorSchema = z.object({
  kind: actorKindSchema,
  id: z.string().trim().min(1).max(128),
});

export const taskSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(128),
  status: taskStatusSchema,
  version: z.number().int().nonnegative(),
  customerId: z.string().trim().min(1).max(128),
});

export const taskMatchingProfileSchema = z.object({
  id: z.string().trim().min(1).max(128),
  taskType: taskTypeSchema,
  requiredSkills: z.array(z.string().trim().min(1).max(100)).default([]),
  requiredOperatingSystem: operatingSystemSchema.nullable().default(null),
  requiredTools: z.array(z.string().trim().min(1).max(100)).default([]),
  requiredMcpTools: z.array(z.string().trim().min(1).max(200)).default([]),
  budgetCents: z.number().int().nonnegative(),
  expectedDurationHours: z.number().positive().max(720).optional(),
});

export const matchableAgentSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  providerId: z.string().trim().min(1).max(128),
  providerName: z.string().trim().min(1).max(120),
  skills: z.array(z.string().trim().min(1).max(100)),
  taskTypes: z.array(taskTypeSchema),
  supportedOperatingSystems: z.array(operatingSystemSchema),
  supportedTools: z.array(z.string().trim().min(1).max(100)),
  supportedMcpTools: z.array(z.string().trim().min(1).max(200)).default([]),
  minimumPriceCents: z.number().int().nonnegative(),
  acceptingTasks: z.boolean(),
  verificationStatus: agentVerificationStatusSchema,
  verifiedSuccessRate: z.number().min(0).max(1),
  averageCompletionHours: z.number().positive().max(10_000),
  recentFailures: z.number().int().nonnegative(),
  recentRuns: z.number().int().nonnegative(),
});

export const matchableWorkerSchema = z.object({
  id: z.string().trim().min(1).max(128),
  status: workerStatusSchema,
  operatingSystem: operatingSystemSchema,
  installedTools: z.array(z.string().trim().min(1).max(100)),
  installedMcpTools: z.array(z.string().trim().min(1).max(200)).default([]),
  lastHeartbeatAt: z.iso.datetime({ offset: true }),
  activeJobs: z.number().int().nonnegative(),
  maxConcurrentJobs: z.number().int().positive(),
});

export const matchCandidateSchema = z.object({
  agent: matchableAgentSchema,
  worker: matchableWorkerSchema,
});

export const createTaskInputSchema = z.object({
  title: z.string().trim().min(3).max(160),
  problemDescription: z.string().trim().min(10).max(20_000),
  desiredOutcome: z.string().trim().min(3).max(10_000),
  repository: z.string().trim().min(1).max(500),
  targetBranch: z.string().trim().min(1).max(255),
  taskType: taskTypeSchema,
  requiredSkills: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  requiredOperatingSystem: operatingSystemSchema.nullable().default(null),
  requiredTools: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  requiredMcpTools: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  budgetCents: z.number().int().positive(),
  deadline: z.iso.datetime({ offset: true }),
  acceptanceChecks: z.array(acceptanceCheckSchema).min(1).max(30),
  securitySensitivity: securitySensitivitySchema,
  allowCodeChanges: z.boolean(),
  allowPullRequest: z.boolean(),
  requiresHumanApproval: z.boolean(),
  preferredAgentId: z.string().trim().min(1).max(128).nullable().default(null),
});

export const taskAnalysisSchema = z.object({
  scopeSummary: z.string().trim().min(1).max(5_000),
  requiredCapabilities: z.array(z.string().trim().min(1).max(200)),
  suggestedTaskTemplate: z.string().trim().min(1).max(128),
  riskLevel: securitySensitivitySchema,
  suggestedVerificationChecks: z.array(acceptanceCheckSchema),
  suggestedBudgetCents: z.number().int().positive(),
  estimatedDurationHours: z.number().positive().max(720),
});

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ActorKind = z.infer<typeof actorKindSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type TaskType = z.infer<typeof taskTypeSchema>;
export type OperatingSystem = z.infer<typeof operatingSystemSchema>;
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
export type TaskMatchingProfile = z.output<typeof taskMatchingProfileSchema>;
export type MatchCandidate = z.output<typeof matchCandidateSchema>;
export type CreateTaskInput = z.output<typeof createTaskInputSchema>;
export type TaskAnalysis = z.output<typeof taskAnalysisSchema>;

export interface TaskAnalyzer {
  analyze(input: CreateTaskInput): Promise<TaskAnalysis>;
}
