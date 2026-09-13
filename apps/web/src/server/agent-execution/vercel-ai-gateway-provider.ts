import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { ToolLoopAgent, gateway, isStepCount, tool, wrapLanguageModel, type LanguageModelMiddleware, type ToolSet } from "ai";

import {
  AGENT_REPAIR_TOOL_NAMES,
  type AgentExecutionModel,
  type AgentExecutionProvider,
  type AgentGatewayCredits,
  type AgentProviderAvailability,
  type AgentProviderMetadata,
  type AgentRepairToolName,
  type AgentRunResult,
  type AgentRunUsage,
} from "./provider";

const require = createRequire(import.meta.url);
const aiSdkVersion = (require("ai/package.json") as { version: string }).version;
const PUBLIC_MODEL_CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

type GatewayClient = typeof gateway;

type PublicModel = {
  id: string;
  name: string;
  description?: string;
  type: string;
  context_window?: number;
  max_tokens?: number;
  tags?: string[];
  supported_parameters?: string[];
  pricing?: {
    input?: string;
    output?: string;
    input_cache_read?: string;
  };
};

type PublicCatalog = { data: PublicModel[] };

export type VercelOidcProjectBinding = {
  projectName: string;
  projectId: string;
  orgId: string;
  environment: "development";
};

export type VercelOidcStructuralAudit = {
  structurallyValid: true;
  boundToLinkedProject: true;
  notExpired: true;
  issuer: string;
  audience: string;
  subject: string;
  project: string;
  projectId: string;
  owner: string;
  ownerId: string;
  environment: "development";
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  checkedAt: string;
};

type StoredRun = {
  usage: AgentRunUsage | null;
  controller: AbortController;
};

export class VercelAIGatewayAgentProvider implements AgentExecutionProvider {
  private readonly runs = new Map<string, StoredRun>();
  private runsStarted = 0;

  constructor(
    private readonly gatewayClient: GatewayClient = gateway,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async checkAvailability(): Promise<AgentProviderAvailability> {
    const checkedAt = new Date().toISOString();
    try {
      const authentication = authenticationMode();
      if (authentication === "VERCEL_OIDC") assertUsableOidcToken(process.env.VERCEL_OIDC_TOKEN);
      const [credits, models] = await Promise.all([this.getCredits(), this.listEligibleModels()]);
      return {
        available: models.length > 0 && Number(credits.balance) > 0,
        checkedAt,
        adapter: "VercelAIGatewayAgentProvider",
        gateway: "Vercel AI Gateway",
        authentication,
        credits,
        eligibleModelCount: models.length,
        errorCode: models.length > 0 && Number(credits.balance) > 0 ? null : "AI_GATEWAY_FREE_USAGE_UNAVAILABLE",
        errorMessage: models.length > 0 && Number(credits.balance) > 0
          ? null
          : "AI Gateway requires a positive existing credit balance and a live zero-price tool-capable model.",
      };
    } catch (error) {
      return {
        available: false,
        checkedAt,
        adapter: "VercelAIGatewayAgentProvider",
        gateway: "Vercel AI Gateway",
        authentication: safeAuthenticationMode(),
        credits: null,
        eligibleModelCount: 0,
        errorCode: "AI_GATEWAY_AUTH_OR_CATALOG_UNAVAILABLE",
        errorMessage: safeErrorMessage(error),
      };
    }
  }

  async listEligibleModels(): Promise<AgentExecutionModel[]> {
    const [authenticated, publicCatalog] = await Promise.all([
      this.gatewayClient.getAvailableModels(),
      this.fetchPublicCatalog(),
    ]);
    const publicById = new Map(publicCatalog.data.map((model) => [model.id, model]));
    const models = authenticated.models.flatMap((model): AgentExecutionModel[] => {
      const publicModel = publicById.get(model.id);
      if (!publicModel || model.modelType !== "language" || publicModel.type !== "language") return [];
      const inputPrice = model.pricing?.input ?? publicModel.pricing?.input ?? "";
      const outputPrice = model.pricing?.output ?? publicModel.pricing?.output ?? "";
      const supportsTools = publicModel.tags?.includes("tool-use") === true &&
        publicModel.supported_parameters?.includes("tools") === true;
      const supportsReasoning = publicModel.tags?.includes("reasoning") === true;
      const isFree = Number(inputPrice) === 0 && Number(outputPrice) === 0;
      if (!supportsTools || !supportsReasoning || !isFree) return [];
      return [{
        id: model.id,
        name: model.name,
        provider: model.id.split("/")[0] || "unknown",
        type: "language",
        contextWindow: publicModel.context_window ?? 0,
        maxOutputTokens: publicModel.max_tokens ?? 0,
        pricing: {
          input: inputPrice,
          output: outputPrice,
          cachedInputTokens: model.pricing?.cachedInputTokens ?? publicModel.pricing?.input_cache_read ?? null,
        },
        supportsReasoning,
        supportsTools,
        isFree,
      }];
    });
    return models.sort((left, right) => modelPreference(left.id) - modelPreference(right.id) || left.id.localeCompare(right.id));
  }

  async createRun(input: Parameters<AgentExecutionProvider["createRun"]>[0]): Promise<AgentRunResult> {
    if (this.runsStarted >= 1) throw new Error("AGENT_REPAIR_LIVE_RUN_LIMIT: only one live Agent repair run is allowed");
    if (!input.model.isFree || !input.model.supportsTools || !input.model.supportsReasoning) {
      throw new Error("AI_GATEWAY_MODEL_INELIGIBLE: selected model is not a live free reasoning and tool-use model");
    }
    if (input.providerRetryLimit !== 1) throw new Error("AI_GATEWAY_RETRY_LIMIT: provider retry limit must be exactly one");
    if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > 12) {
      throw new Error("AI_GATEWAY_STEP_LIMIT: Agent steps must be between one and twelve");
    }
    const maxOutputTokens = input.maxOutputTokens ?? 8_192;
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 512 || maxOutputTokens > 8_192) {
      throw new Error("AI_GATEWAY_OUTPUT_LIMIT: Agent output tokens must be between 512 and 8192");
    }
    this.runsStarted += 1;
    const runId = randomUUID();
    const controller = new AbortController();
    this.runs.set(runId, { usage: null, controller });
    const startedAt = new Date().toISOString();
    const sdkTools = Object.fromEntries(AGENT_REPAIR_TOOL_NAMES.map((name) => {
      const definition = input.tools[name];
      return [name, tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: async (value) => definition.execute(value),
      })];
    })) as unknown as ToolSet;
    let apiRequestCount = 0;
    const requestCountingMiddleware: LanguageModelMiddleware = {
      wrapGenerate: async ({ doGenerate }) => {
        const requestSequence = apiRequestCount + 1;
        await input.onModelRequest?.({
          requestSequence,
          requestedAt: new Date().toISOString(),
          modelId: input.model.id,
          provider: input.model.provider,
          tag: input.tag,
        });
        apiRequestCount = requestSequence;
        return doGenerate();
      },
    };
    const agent = new ToolLoopAgent({
      model: wrapLanguageModel({
        model: this.gatewayClient(input.model.id),
        middleware: requestCountingMiddleware,
      }),
      instructions: input.instructions,
      tools: sdkTools,
      stopWhen: isStepCount(input.maxSteps),
      maxRetries: input.providerRetryLimit,
      maxOutputTokens: Math.min(maxOutputTokens, input.model.maxOutputTokens || maxOutputTokens),
      providerOptions: { gateway: { tags: [input.tag] } },
    });
    let result: Awaited<ReturnType<typeof agent.generate>>;
    try {
      result = await agent.generate({ prompt: input.prompt, abortSignal: controller.signal });
    } catch (error) {
      const usage: AgentRunUsage = {
        apiRequestCount,
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        gatewayReportedCostUsd: await this.reportedCost(input.tag),
      };
      this.runs.set(runId, { usage, controller });
      return {
        runId,
        status: controller.signal.aborted ? "CANCELLED" : "FAILED",
        model: input.model,
        text: "",
        finishReason: safeProviderFailureCode(error),
        stepCount: 0,
        toolNames: [],
        responseIds: [],
        usage,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
    }
    const usage: AgentRunUsage = {
      apiRequestCount,
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      cachedInputTokens: result.usage.inputTokenDetails.cacheReadTokens ?? null,
      cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens ?? null,
      reasoningTokens: result.usage.outputTokenDetails.reasoningTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null,
      gatewayReportedCostUsd: await this.reportedCost(input.tag),
    };
    this.runs.set(runId, { usage, controller });
    const toolNames = result.toolCalls
      .map((call) => call.toolName)
      .filter((name): name is AgentRepairToolName => isRepairToolName(name));
    return {
      runId,
      status: "COMPLETED",
      model: input.model,
      text: result.text,
      finishReason: result.finishReason,
      stepCount: result.steps.length,
      toolNames,
      responseIds: result.steps.map((step) => step.response.id).filter((value): value is string => typeof value === "string"),
      usage,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  async continueRun(): Promise<AgentRunResult> {
    throw new Error("AGENT_RUN_CONTINUATION_DISABLED: this bounded Gate permits one non-resumable run");
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error("AGENT_RUN_NOT_FOUND");
    run.controller.abort();
  }

  async getUsage(runId: string): Promise<AgentRunUsage | null> {
    return this.runs.get(runId)?.usage ?? null;
  }

  async getCredits(): Promise<AgentGatewayCredits> {
    const credits = await this.gatewayClient.getCredits();
    return { balance: credits.balance, totalUsed: credits.totalUsed ?? null };
  }

  getProviderMetadata(): AgentProviderMetadata {
    return {
      adapter: "VercelAIGatewayAgentProvider",
      gateway: "Vercel AI Gateway",
      sdkPackage: "ai",
      sdkVersion: aiSdkVersion,
      authentication: safeAuthenticationMode(),
      directOpenAIStatus: "DEFERRED_OPTIONAL",
    };
  }

  private async fetchPublicCatalog(): Promise<PublicCatalog> {
    const response = await this.fetchFn(PUBLIC_MODEL_CATALOG_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`AI_GATEWAY_MODEL_CATALOG_HTTP_${response.status}`);
    const value = await response.json() as PublicCatalog;
    if (!Array.isArray(value.data)) throw new Error("AI_GATEWAY_MODEL_CATALOG_INVALID");
    return value;
  }

  private async reportedCost(tag: string): Promise<number | null> {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const report = await this.gatewayClient.getSpendReport({ startDate: date, endDate: date, groupBy: "model", tags: [tag] });
      return report.results.reduce((total, row) => total + row.totalCost, 0);
    } catch {
      return null;
    }
  }
}

function authenticationMode(): "VERCEL_OIDC" | "AI_GATEWAY_API_KEY" {
  if (process.env.AI_GATEWAY_API_KEY) return "AI_GATEWAY_API_KEY";
  if (process.env.VERCEL_OIDC_TOKEN) return "VERCEL_OIDC";
  throw new Error("AI_GATEWAY_AUTH_MISSING: no server-side Gateway credential is available");
}

function safeAuthenticationMode(): AgentProviderMetadata["authentication"] {
  try { return authenticationMode(); } catch { return "UNAVAILABLE"; }
}

function assertUsableOidcToken(token: string | undefined): void {
  inspectVercelOidcToken(token, {
    projectName: "donelayer",
    projectId: requiredOidcClaim(token, "project_id"),
    orgId: requiredOidcClaim(token, "owner_id"),
    environment: "development",
  });
}

export function inspectVercelOidcToken(
  token: string | undefined,
  expected: VercelOidcProjectBinding,
  checkedAt = new Date().toISOString(),
): VercelOidcStructuralAudit {
  if (!token) throw new Error("AI_GATEWAY_OIDC_MISSING");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) throw new Error("AI_GATEWAY_OIDC_INVALID");
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as Record<string, unknown>;
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("AI_GATEWAY_OIDC_INVALID");
  }
  if (!header.alg || typeof header.alg !== "string") throw new Error("AI_GATEWAY_OIDC_INVALID");
  const project = stringClaim(claims, "project");
  const projectId = stringClaim(claims, "project_id");
  const owner = stringClaim(claims, "owner");
  const ownerId = stringClaim(claims, "owner_id");
  const environment = stringClaim(claims, "environment");
  const issuer = stringClaim(claims, "iss");
  const audience = stringClaim(claims, "aud");
  const subject = stringClaim(claims, "sub");
  const issuedAtSeconds = numberClaim(claims, "iat");
  const notBeforeSeconds = numberClaim(claims, "nbf");
  const expiresAtSeconds = numberClaim(claims, "exp");
  const checkedAtSeconds = Math.floor(new Date(checkedAt).getTime() / 1_000);
  if (!Number.isFinite(checkedAtSeconds)) throw new Error("AI_GATEWAY_OIDC_CHECK_TIME_INVALID");
  if (
    project !== expected.projectName ||
    projectId !== expected.projectId ||
    ownerId !== expected.orgId ||
    environment !== expected.environment ||
    !subject.includes(`project:${expected.projectName}:environment:${expected.environment}`)
  ) throw new Error("AI_GATEWAY_OIDC_WRONG_PROJECT");
  if (expiresAtSeconds <= checkedAtSeconds + 60 || notBeforeSeconds > checkedAtSeconds || issuedAtSeconds > checkedAtSeconds) {
    throw new Error("AI_GATEWAY_OIDC_EXPIRED_OR_NOT_ACTIVE");
  }
  return {
    structurallyValid: true,
    boundToLinkedProject: true,
    notExpired: true,
    issuer,
    audience,
    subject,
    project,
    projectId,
    owner,
    ownerId,
    environment: environment as "development",
    issuedAt: new Date(issuedAtSeconds * 1_000).toISOString(),
    notBefore: new Date(notBeforeSeconds * 1_000).toISOString(),
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    checkedAt,
  };
}

function requiredOidcClaim(token: string | undefined, name: string): string {
  if (!token) throw new Error("AI_GATEWAY_OIDC_MISSING");
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    return stringClaim(claims, name);
  } catch {
    throw new Error("AI_GATEWAY_OIDC_INVALID");
  }
}

function stringClaim(claims: Record<string, unknown>, name: string): string {
  const value = claims[name];
  if (typeof value !== "string" || value.length === 0) throw new Error("AI_GATEWAY_OIDC_INVALID");
  return value;
}

function numberClaim(claims: Record<string, unknown>, name: string): number {
  const value = claims[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("AI_GATEWAY_OIDC_INVALID");
  return value;
}

function isRepairToolName(value: string): value is AgentRepairToolName {
  return (AGENT_REPAIR_TOOL_NAMES as readonly string[]).includes(value);
}

function modelPreference(id: string): number {
  if (id === "minimax/minimax-m2.7-free") return 0;
  if (id === "inclusionai/ling-3.0-flash-fin") return 1;
  if (id === "poolside/laguna-s-2.1-free") return 2;
  if (id.includes("coder") && id.endsWith("-free")) return 2;
  return 10;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/(token|key)=\S+/gi, "$1=[REDACTED]").slice(0, 500);
}

function safeProviderFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/temporarily unavailable/i.test(message)) return "AI_GATEWAY_TEMPORARY_UNAVAILABLE";
  if (/rate limit/i.test(message)) return "AI_GATEWAY_RATE_LIMITED";
  if (/authentication|unauthorized/i.test(message)) return "AI_GATEWAY_AUTHENTICATION_FAILED";
  return "AI_GATEWAY_MODEL_REQUEST_FAILED";
}
