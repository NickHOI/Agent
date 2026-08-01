import {
  matchCandidateSchema,
  taskMatchingProfileSchema,
  type MatchCandidate,
  type TaskMatchingProfile,
  type TaskType,
} from "@donelayer/shared";

export const matchingWeights = {
  skillMatch: 0.35,
  verifiedSuccessRate: 0.2,
  availability: 0.15,
  environmentMatch: 0.1,
  budgetFit: 0.1,
  averageSpeed: 0.05,
  recentReliability: 0.05,
} as const;

export const hardFilterReasonCodes = [
  "AGENT_NOT_ACCEPTING",
  "AGENT_NOT_ACTIVE",
  "TASK_TYPE_UNSUPPORTED",
  "NO_REQUIRED_SKILL_MATCH",
  "WORKER_NOT_ONLINE",
  "WORKER_HEARTBEAT_EXPIRED",
  "WORKER_AT_CAPACITY",
  "OPERATING_SYSTEM_MISMATCH",
  "REQUIRED_TOOL_MISSING",
  "REQUIRED_MCP_TOOL_MISSING",
  "BUDGET_EXCEEDED",
] as const;

export type HardFilterReasonCode = (typeof hardFilterReasonCodes)[number];

export interface HardFilterReason {
  code: HardFilterReasonCode;
  message: string;
  missing?: string[];
}

export interface MatchingBreakdown {
  skillMatch: number;
  verifiedSuccessRate: number;
  availability: number;
  environmentMatch: number;
  budgetFit: number;
  averageSpeed: number;
  recentReliability: number;
}

export interface EligibleMatch {
  candidate: MatchCandidate;
  score: number;
  breakdown: MatchingBreakdown;
  reason: string;
}

export interface RejectedMatch {
  candidate: MatchCandidate;
  reasons: HardFilterReason[];
}

export interface RankedMatches {
  matches: EligibleMatch[];
  rejections: RejectedMatch[];
}

export interface MatchingOptions {
  now: Date;
  heartbeatTtlMs?: number;
}

const categoryBenchmarksHours: Readonly<Record<TaskType, number>> = {
  DIAGNOSE_REPOSITORY: 4,
  BUILD_RESCUE: 8,
  TEST_AND_FIX: 8,
  FEATURE_COMPLETION: 16,
  PULL_REQUEST_VERIFICATION: 4,
  LAUNCH_READINESS: 6,
};

const DEFAULT_HEARTBEAT_TTL_MS = 90_000;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function normalizedSet(values: readonly string[]): Set<string> {
  return new Set(values.map(normalize));
}

function matchingValues(
  required: readonly string[],
  available: readonly string[],
): string[] {
  const availableSet = normalizedSet(available);
  return required.filter((value) => availableSet.has(normalize(value)));
}

function missingValues(
  required: readonly string[],
  available: readonly string[],
): string[] {
  const availableSet = normalizedSet(available);
  return required.filter((value) => !availableSet.has(normalize(value)));
}

function unique(values: readonly string[]): string[] {
  return [...new Map(values.map((value) => [normalize(value), value])).values()];
}

function coverage(required: readonly string[], available: readonly string[]): number {
  if (required.length === 0) {
    return 1;
  }

  return matchingValues(unique(required), available).length / unique(required).length;
}

function collectHardFilterReasons(
  task: TaskMatchingProfile,
  candidate: MatchCandidate,
  options: Required<MatchingOptions>,
): HardFilterReason[] {
  const reasons: HardFilterReason[] = [];
  const { agent, worker } = candidate;

  if (!agent.acceptingTasks) {
    reasons.push({
      code: "AGENT_NOT_ACCEPTING",
      message: "Agent is not accepting new tasks",
    });
  }

  if (
    agent.verificationStatus === "REJECTED" ||
    agent.verificationStatus === "SUSPENDED"
  ) {
    reasons.push({
      code: "AGENT_NOT_ACTIVE",
      message: `Agent verification status is ${agent.verificationStatus}`,
    });
  }

  if (!agent.taskTypes.includes(task.taskType)) {
    reasons.push({
      code: "TASK_TYPE_UNSUPPORTED",
      message: `Agent does not support ${task.taskType}`,
    });
  }

  if (
    task.requiredSkills.length > 0 &&
    matchingValues(task.requiredSkills, agent.skills).length === 0
  ) {
    reasons.push({
      code: "NO_REQUIRED_SKILL_MATCH",
      message: "Agent does not match any required skill",
      missing: unique(task.requiredSkills),
    });
  }

  if (worker.status !== "ONLINE" && worker.status !== "BUSY") {
    reasons.push({
      code: "WORKER_NOT_ONLINE",
      message: `Worker status is ${worker.status}`,
    });
  }

  const heartbeatAgeMs =
    options.now.getTime() - new Date(worker.lastHeartbeatAt).getTime();
  if (heartbeatAgeMs > options.heartbeatTtlMs) {
    reasons.push({
      code: "WORKER_HEARTBEAT_EXPIRED",
      message: "Worker heartbeat lease has expired",
    });
  }

  if (worker.activeJobs >= worker.maxConcurrentJobs) {
    reasons.push({
      code: "WORKER_AT_CAPACITY",
      message: "Worker has no free job slots",
    });
  }

  const requiredOperatingSystem = task.requiredOperatingSystem;
  if (requiredOperatingSystem && requiredOperatingSystem !== "ANY") {
    const agentSupportsOperatingSystem =
      agent.supportedOperatingSystems.includes("ANY") ||
      agent.supportedOperatingSystems.includes(requiredOperatingSystem);

    if (
      !agentSupportsOperatingSystem ||
      worker.operatingSystem !== requiredOperatingSystem
    ) {
      reasons.push({
        code: "OPERATING_SYSTEM_MISMATCH",
        message: `Task requires ${requiredOperatingSystem}`,
      });
    }
  }

  const missingAgentTools = missingValues(task.requiredTools, agent.supportedTools);
  const missingWorkerTools = missingValues(task.requiredTools, worker.installedTools);
  const missingTools = unique([...missingAgentTools, ...missingWorkerTools]);
  if (missingTools.length > 0) {
    reasons.push({
      code: "REQUIRED_TOOL_MISSING",
      message: `Required tools are unavailable: ${missingTools.join(", ")}`,
      missing: missingTools,
    });
  }

  const missingAgentMcpTools = missingValues(
    task.requiredMcpTools,
    agent.supportedMcpTools,
  );
  const missingWorkerMcpTools = missingValues(
    task.requiredMcpTools,
    worker.installedMcpTools,
  );
  const missingMcpTools = unique([
    ...missingAgentMcpTools,
    ...missingWorkerMcpTools,
  ]);
  if (missingMcpTools.length > 0) {
    reasons.push({
      code: "REQUIRED_MCP_TOOL_MISSING",
      message: `Required MCP tools are unavailable: ${missingMcpTools.join(", ")}`,
      missing: missingMcpTools,
    });
  }

  if (agent.minimumPriceCents > task.budgetCents) {
    reasons.push({
      code: "BUDGET_EXCEEDED",
      message: "Agent minimum price exceeds the task budget",
    });
  }

  return reasons;
}

function calculateBreakdown(
  task: TaskMatchingProfile,
  candidate: MatchCandidate,
): MatchingBreakdown {
  const { agent, worker } = candidate;
  const operatingSystemMatch =
    !task.requiredOperatingSystem ||
    task.requiredOperatingSystem === "ANY" ||
    (worker.operatingSystem === task.requiredOperatingSystem &&
      (agent.supportedOperatingSystems.includes("ANY") ||
        agent.supportedOperatingSystems.includes(task.requiredOperatingSystem)))
      ? 1
      : 0;
  const agentToolCoverage = coverage(task.requiredTools, agent.supportedTools);
  const workerToolCoverage = coverage(task.requiredTools, worker.installedTools);
  const agentMcpCoverage = coverage(
    task.requiredMcpTools,
    agent.supportedMcpTools,
  );
  const workerMcpCoverage = coverage(
    task.requiredMcpTools,
    worker.installedMcpTools,
  );
  const environmentMatch =
    (operatingSystemMatch +
      agentToolCoverage +
      workerToolCoverage +
      agentMcpCoverage +
      workerMcpCoverage) /
    5;
  const budgetFit =
    task.budgetCents === 0
      ? agent.minimumPriceCents === 0
        ? 1
        : 0
      : clamp(1 - 0.5 * (agent.minimumPriceCents / task.budgetCents));
  const expectedHours =
    task.expectedDurationHours ?? categoryBenchmarksHours[task.taskType];
  const recentReliability =
    agent.recentRuns === 0
      ? 0.5
      : clamp(1 - agent.recentFailures / agent.recentRuns);

  return {
    skillMatch: coverage(task.requiredSkills, agent.skills),
    verifiedSuccessRate: agent.verifiedSuccessRate,
    availability: clamp(
      (worker.maxConcurrentJobs - worker.activeJobs) / worker.maxConcurrentJobs,
    ),
    environmentMatch: clamp(environmentMatch),
    budgetFit,
    averageSpeed: clamp(expectedHours / agent.averageCompletionHours),
    recentReliability,
  };
}

function calculateScore(breakdown: MatchingBreakdown): number {
  const rawScore =
    breakdown.skillMatch * matchingWeights.skillMatch +
    breakdown.verifiedSuccessRate * matchingWeights.verifiedSuccessRate +
    breakdown.availability * matchingWeights.availability +
    breakdown.environmentMatch * matchingWeights.environmentMatch +
    breakdown.budgetFit * matchingWeights.budgetFit +
    breakdown.averageSpeed * matchingWeights.averageSpeed +
    breakdown.recentReliability * matchingWeights.recentReliability;

  return Math.round(rawScore * 10_000) / 100;
}

function explainMatch(
  task: TaskMatchingProfile,
  candidate: MatchCandidate,
): string {
  const facts: string[] = [];
  const matchedSkills = matchingValues(task.requiredSkills, candidate.agent.skills);

  if (matchedSkills.length > 0) {
    facts.push(`${matchedSkills.join(", ")} skills`);
  } else {
    facts.push(task.taskType.replaceAll("_", " ").toLocaleLowerCase("en-US"));
  }

  if (task.requiredOperatingSystem && task.requiredOperatingSystem !== "ANY") {
    facts.push(`${task.requiredOperatingSystem} environment`);
  }

  if (task.requiredTools.length > 0) {
    facts.push(`${task.requiredTools.join(", ")} tools`);
  }

  if (task.requiredMcpTools.length > 0) {
    facts.push(`${task.requiredMcpTools.join(", ")} MCP tools`);
  }

  facts.push(
    `${Math.round(candidate.agent.verifiedSuccessRate * 100)}% verified success rate`,
  );

  return `Recommended ${candidate.agent.name} because it matches ${facts.join(
    ", ",
  )}.`;
}

export function rankCandidates(
  taskInput: TaskMatchingProfile,
  candidateInputs: readonly MatchCandidate[],
  options: MatchingOptions,
): RankedMatches {
  const task = taskMatchingProfileSchema.parse(taskInput);
  const candidates = candidateInputs.map((candidate) =>
    matchCandidateSchema.parse(candidate),
  );
  const requiredOptions: Required<MatchingOptions> = {
    now: options.now,
    heartbeatTtlMs: options.heartbeatTtlMs ?? DEFAULT_HEARTBEAT_TTL_MS,
  };
  const matches: EligibleMatch[] = [];
  const rejections: RejectedMatch[] = [];

  for (const candidate of candidates) {
    const reasons = collectHardFilterReasons(task, candidate, requiredOptions);
    if (reasons.length > 0) {
      rejections.push({ candidate, reasons });
      continue;
    }

    const breakdown = calculateBreakdown(task, candidate);
    matches.push({
      candidate,
      breakdown,
      score: calculateScore(breakdown),
      reason: explainMatch(task, candidate),
    });
  }

  matches.sort(
    (left, right) =>
      right.score - left.score ||
      right.candidate.agent.verifiedSuccessRate -
        left.candidate.agent.verifiedSuccessRate ||
      left.candidate.agent.minimumPriceCents -
        right.candidate.agent.minimumPriceCents ||
      left.candidate.agent.id.localeCompare(right.candidate.agent.id),
  );

  return { matches, rejections };
}
