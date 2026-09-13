import type { z } from "zod";

export const AGENT_REPAIR_TOOL_NAMES = [
  "list_files",
  "read_file",
  "inspect_test_failure",
  "apply_patch",
  "run_test",
  "run_build",
  "get_diff",
  "get_source_integrity",
] as const;

export type AgentRepairToolName = (typeof AGENT_REPAIR_TOOL_NAMES)[number];

export type AgentExecutionTool = {
  description: string;
  inputSchema: z.ZodType;
  execute: (input: unknown) => Promise<unknown>;
};

export type AgentGatewayCredits = {
  balance: string;
  totalUsed: string | null;
};

export type AgentExecutionModel = {
  id: string;
  name: string;
  provider: string;
  type: "language";
  contextWindow: number;
  maxOutputTokens: number;
  pricing: {
    input: string;
    output: string;
    cachedInputTokens: string | null;
  };
  supportsReasoning: boolean;
  supportsTools: boolean;
  isFree: boolean;
};

export type AgentProviderAvailability = {
  available: boolean;
  checkedAt: string;
  adapter: string;
  gateway: string;
  authentication: "VERCEL_OIDC" | "AI_GATEWAY_API_KEY" | "UNAVAILABLE";
  credits: AgentGatewayCredits | null;
  eligibleModelCount: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type AgentRunUsage = {
  apiRequestCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  gatewayReportedCostUsd: number | null;
};

export type AgentModelRequestEvidence = {
  requestSequence: number;
  requestedAt: string;
  modelId: string;
  provider: string;
  tag: string;
};

export type AgentRunResult = {
  runId: string;
  status: "COMPLETED" | "CANCELLED" | "FAILED";
  model: AgentExecutionModel;
  text: string;
  finishReason: string;
  stepCount: number;
  toolNames: AgentRepairToolName[];
  responseIds: string[];
  usage: AgentRunUsage;
  startedAt: string;
  finishedAt: string;
};

export type AgentProviderMetadata = {
  adapter: string;
  gateway: string;
  sdkPackage: string;
  sdkVersion: string;
  authentication: "VERCEL_OIDC" | "AI_GATEWAY_API_KEY" | "UNAVAILABLE";
  directOpenAIStatus: "DEFERRED_OPTIONAL";
};

export interface AgentExecutionProvider {
  checkAvailability(): Promise<AgentProviderAvailability>;
  listEligibleModels(): Promise<AgentExecutionModel[]>;
  createRun(input: {
    model: AgentExecutionModel;
    instructions: string;
    prompt: string;
    tools: Record<AgentRepairToolName, AgentExecutionTool>;
    maxSteps: number;
    maxOutputTokens?: number;
    providerRetryLimit: 1;
    tag: string;
    onModelRequest?: (evidence: AgentModelRequestEvidence) => void | Promise<void>;
  }): Promise<AgentRunResult>;
  continueRun(runId: string): Promise<AgentRunResult>;
  cancelRun(runId: string): Promise<void>;
  getUsage(runId: string): Promise<AgentRunUsage | null>;
  getCredits(): Promise<AgentGatewayCredits>;
  getProviderMetadata(): AgentProviderMetadata;
}

export class DirectOpenAIAgentProvider implements AgentExecutionProvider {
  async checkAvailability(): Promise<AgentProviderAvailability> {
    return {
      available: false,
      checkedAt: new Date().toISOString(),
      adapter: "DirectOpenAIAgentProvider",
      gateway: "DIRECT_OPENAI_API",
      authentication: "UNAVAILABLE",
      credits: null,
      eligibleModelCount: 0,
      errorCode: "DIRECT_OPENAI_DEFERRED",
      errorMessage: "Direct OpenAI API access is an optional provider and is deferred for the MVP.",
    };
  }

  async listEligibleModels(): Promise<AgentExecutionModel[]> { return []; }
  async createRun(): Promise<AgentRunResult> { return this.deferred(); }
  async continueRun(): Promise<AgentRunResult> { return this.deferred(); }
  async cancelRun(): Promise<void> { return this.deferred(); }
  async getUsage(): Promise<AgentRunUsage | null> { return null; }
  async getCredits(): Promise<AgentGatewayCredits> { return this.deferred(); }

  getProviderMetadata(): AgentProviderMetadata {
    return {
      adapter: "DirectOpenAIAgentProvider",
      gateway: "DIRECT_OPENAI_API",
      sdkPackage: "not-installed",
      sdkVersion: "deferred",
      authentication: "UNAVAILABLE",
      directOpenAIStatus: "DEFERRED_OPTIONAL",
    };
  }

  private deferred(): never {
    throw new Error("DIRECT_OPENAI_DEFERRED: Direct OpenAI API access is not required for the MVP");
  }
}
