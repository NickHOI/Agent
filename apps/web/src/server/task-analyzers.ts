import type { CreateTaskInput, TaskAnalysis, TaskAnalyzer } from "@donelayer/shared";

const durationByTemplate: Record<CreateTaskInput["taskType"], number> = {
  DIAGNOSE_REPOSITORY: 4,
  BUILD_RESCUE: 8,
  TEST_AND_FIX: 6,
  FEATURE_COMPLETION: 14,
  PULL_REQUEST_VERIFICATION: 4,
  LAUNCH_READINESS: 8
};

export class DemoTaskAnalyzer implements TaskAnalyzer {
  async analyze(input: CreateTaskInput): Promise<TaskAnalysis> {
    return {
      scopeSummary: `Complete a bounded ${input.taskType.toLowerCase().replaceAll("_", " ")} workflow for ${input.repository}.`,
      requiredCapabilities: [...new Set([...input.requiredSkills, ...input.requiredTools])],
      suggestedTaskTemplate: input.taskType,
      riskLevel: input.securitySensitivity,
      suggestedVerificationChecks: input.acceptanceChecks,
      suggestedBudgetCents: Math.max(10000, Math.round(input.budgetCents * 0.9)),
      estimatedDurationHours: durationByTemplate[input.taskType]
    };
  }
}

export class RuleBasedTaskAnalyzer implements TaskAnalyzer {
  async analyze(input: CreateTaskInput): Promise<TaskAnalysis> {
    const capabilities = [...new Set([...input.requiredSkills, ...input.requiredTools, ...(input.allowPullRequest ? ["GitHub pull requests"] : [])])];
    const highRisk = input.securitySensitivity === "HIGH" || input.requiredTools.some((tool) => /docker|xcode|deploy/i.test(tool));
    const riskLevel = highRisk ? "HIGH" : input.securitySensitivity;
    const baseline = input.taskType === "FEATURE_COMPLETION" ? 32000 : input.taskType === "LAUNCH_READINESS" ? 26000 : 18000;
    return {
      scopeSummary: `${input.title}. Work is limited to the selected repository and ${input.targetBranch} branch using the ${input.taskType} workflow template.`,
      requiredCapabilities: capabilities,
      suggestedTaskTemplate: input.taskType,
      riskLevel,
      suggestedVerificationChecks: input.acceptanceChecks,
      suggestedBudgetCents: Math.max(baseline, Math.min(input.budgetCents, Math.round(baseline * (1 + capabilities.length * 0.05)))),
      estimatedDurationHours: durationByTemplate[input.taskType] + (riskLevel === "HIGH" ? 2 : 0)
    };
  }
}

export class LLMTaskAnalyzer implements TaskAnalyzer {
  async analyze(_input: CreateTaskInput): Promise<TaskAnalysis> {
    throw new Error("LLMTaskAnalyzer is not configured. Use RuleBasedTaskAnalyzer or DemoTaskAnalyzer without an API key.");
  }
}

export function getTaskAnalyzer(): TaskAnalyzer {
  return process.env.TASK_ANALYZER === "demo" ? new DemoTaskAnalyzer() : new RuleBasedTaskAnalyzer();
}
