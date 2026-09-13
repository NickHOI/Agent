import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import { AGENT_REPAIR_TOOL_NAMES, DirectOpenAIAgentProvider, type AgentExecutionTool } from "../../apps/web/src/server/agent-execution/provider";
import { isEditableAgentRepairPath } from "../../apps/web/src/server/agent-execution/vercel-agent-repair-sandbox";
import { VercelAIGatewayAgentProvider, inspectVercelOidcToken } from "../../apps/web/src/server/agent-execution/vercel-ai-gateway-provider";
import { toPublicReceiptView } from "../../apps/web/src/server/public-receipt-view";

const originalOidc = process.env.VERCEL_OIDC_TOKEN;
const originalGatewayKey = process.env.AI_GATEWAY_API_KEY;

beforeEach(() => {
  delete process.env.AI_GATEWAY_API_KEY;
  process.env.VERCEL_OIDC_TOKEN = unsignedOidc({
    iss: "https://oidc.vercel.com/nickhois-projects",
    aud: "https://vercel.com/nickhois-projects",
    sub: "owner:nickhois-projects:project:donelayer:environment:development",
    project: "donelayer",
    project_id: "prj_donelayer",
    owner: "nickhois-projects",
    owner_id: "team_nickhois",
    environment: "development",
    iat: Math.floor(Date.now() / 1000) - 60,
    nbf: Math.floor(Date.now() / 1000) - 60,
    exp: Math.floor(Date.now() / 1000) + 3_600,
  });
});

afterEach(() => {
  restoreEnvironment("VERCEL_OIDC_TOKEN", originalOidc);
  restoreEnvironment("AI_GATEWAY_API_KEY", originalGatewayKey);
});

describe("Agent execution providers", () => {
  it("audits the OIDC structure, exact linked project binding, and expiry without retaining the token", () => {
    const checkedAt = "2026-09-04T14:00:00.000Z";
    const token = unsignedOidc({
      iss: "https://oidc.vercel.com/nickhois-projects",
      aud: "https://vercel.com/nickhois-projects",
      sub: "owner:nickhois-projects:project:donelayer:environment:development",
      project: "donelayer",
      project_id: "prj_donelayer",
      owner: "nickhois-projects",
      owner_id: "team_nickhois",
      environment: "development",
      iat: 1_788_528_400,
      nbf: 1_788_528_400,
      exp: 1_788_571_600,
    });
    const audit = inspectVercelOidcToken(token, {
      projectName: "donelayer",
      projectId: "prj_donelayer",
      orgId: "team_nickhois",
      environment: "development",
    }, checkedAt);

    expect(audit).toMatchObject({
      structurallyValid: true,
      boundToLinkedProject: true,
      notExpired: true,
      project: "donelayer",
      projectId: "prj_donelayer",
      ownerId: "team_nickhois",
      environment: "development",
    });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it("rejects an otherwise current OIDC token bound to another project", () => {
    const token = unsignedOidc({
      iss: "https://oidc.vercel.com/nickhois-projects",
      aud: "https://vercel.com/nickhois-projects",
      sub: "owner:nickhois-projects:project:other:environment:development",
      project: "other",
      project_id: "prj_other",
      owner: "nickhois-projects",
      owner_id: "team_nickhois",
      environment: "development",
      iat: 1_788_528_400,
      nbf: 1_788_528_400,
      exp: 1_788_571_600,
    });

    expect(() => inspectVercelOidcToken(token, {
      projectName: "donelayer",
      projectId: "prj_donelayer",
      orgId: "team_nickhois",
      environment: "development",
    }, "2026-09-04T14:00:00.000Z")).toThrow("AI_GATEWAY_OIDC_WRONG_PROJECT");
  });

  it("intersects the authenticated and public live catalogs and prefers a free tool-capable coding model", async () => {
    const provider = providerFixture("5");
    const models = await provider.listEligibleModels();

    expect(models.map((model) => model.id)).toEqual([
      "inclusionai/ling-3.0-flash-fin",
      "poolside/laguna-s-2.1-free",
    ]);
    expect(models.every((model) => model.isFree && model.supportsTools && model.supportsReasoning)).toBe(true);
    await expect(provider.checkAvailability()).resolves.toMatchObject({
      available: true,
      authentication: "VERCEL_OIDC",
      credits: { balance: "5", totalUsed: "0" },
      eligibleModelCount: 2,
    });
  });

  it("fails closed before a model request when the existing credit balance is empty", async () => {
    await expect(providerFixture("0").checkAvailability()).resolves.toMatchObject({
      available: false,
      errorCode: "AI_GATEWAY_FREE_USAGE_UNAVAILABLE",
    });
  });

  it("keeps direct OpenAI as an explicit deferred optional adapter", async () => {
    const provider = new DirectOpenAIAgentProvider();
    await expect(provider.checkAvailability()).resolves.toMatchObject({
      available: false,
      adapter: "DirectOpenAIAgentProvider",
      errorCode: "DIRECT_OPENAI_DEFERRED",
    });
    expect(provider.getProviderMetadata().directOpenAIStatus).toBe("DEFERRED_OPTIONAL");
  });

  it("returns a bounded failed run when the model provider exhausts the one allowed retry", async () => {
    const mockModel = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({
          message: "Service temporarily unavailable. Please try again shortly.",
          url: "https://example.invalid/model",
          requestBodyValues: {},
          statusCode: 503,
          responseHeaders: { "retry-after": "0" },
        });
      },
    });
    const gatewayClient = Object.assign(
      () => mockModel,
      {
        getCredits: async () => ({ balance: "5", totalUsed: "0" }),
        getAvailableModels: async () => ({ models: [] }),
        getSpendReport: async () => ({ results: [] }),
      },
    );
    const provider = new VercelAIGatewayAgentProvider(gatewayClient as never, fetch);
    const modelRequests: Array<{ requestSequence: number; requestedAt: string }> = [];
    const emptyTool: AgentExecutionTool = {
      description: "test",
      inputSchema: z.object({}).strict(),
      execute: async () => ({}),
    };
    const tools = Object.fromEntries(AGENT_REPAIR_TOOL_NAMES.map((name) => [name, emptyTool])) as Record<(typeof AGENT_REPAIR_TOOL_NAMES)[number], AgentExecutionTool>;
    const result = await provider.createRun({
      model: {
        id: "poolside/laguna-s-2.1-free",
        name: "Laguna S 2.1 Free",
        provider: "poolside",
        type: "language",
        contextWindow: 256_000,
        maxOutputTokens: 32_768,
        pricing: { input: "0", output: "0", cachedInputTokens: "0" },
        supportsReasoning: true,
        supportsTools: true,
        isFree: true,
      },
      instructions: "Use no tools.",
      prompt: "Fail in a controlled way.",
      tools,
      maxSteps: 1,
      providerRetryLimit: 1,
      tag: "unit-test",
      onModelRequest: (request) => {
        modelRequests.push({ requestSequence: request.requestSequence, requestedAt: request.requestedAt });
      },
    });

    expect(result).toMatchObject({
      status: "FAILED",
      finishReason: "AI_GATEWAY_TEMPORARY_UNAVAILABLE",
      usage: { apiRequestCount: 2 },
      toolNames: [],
    });
    expect(modelRequests.map((request) => request.requestSequence)).toEqual([1, 2]);
    expect(modelRequests.every((request) => !Number.isNaN(Date.parse(request.requestedAt)))).toBe(true);
  });
});

describe("Agent repair security boundaries", () => {
  it("allows existing source files but denies tests, manifests, lockfiles, maps, and traversal", () => {
    expect(isEditableAgentRepairPath("src/add.ts")).toBe(true);
    expect(isEditableAgentRepairPath("src/nested/value.js")).toBe(true);
    expect(isEditableAgentRepairPath("tests/add.test.ts")).toBe(false);
    expect(isEditableAgentRepairPath("package.json")).toBe(false);
    expect(isEditableAgentRepairPath("package-lock.json")).toBe(false);
    expect(isEditableAgentRepairPath("src/add.js.map")).toBe(false);
    expect(isEditableAgentRepairPath("../src/add.ts")).toBe(false);
    expect(isEditableAgentRepairPath("tsconfig.build.json", ["tsconfig.build.json"])).toBe(true);
    expect(isEditableAgentRepairPath("tsconfig.build.json", ["src/add.ts"])).toBe(false);
    expect(isEditableAgentRepairPath("package.json", ["package.json"])).toBe(false);
    expect(isEditableAgentRepairPath("scripts/verify.mjs", ["scripts/verify.mjs"])).toBe(false);
  });

  it("whitelists Agent repair fields in the public Receipt view", () => {
    const receipt = toPublicReceiptView({
      publicReceiptId: "dlr_agent_repair",
      taskType: "Agent Repair in Managed Sandbox Verification",
      agentIdentity: "DoneLayer Repair Agent",
      workerIdentity: "DoneLayer Server",
      contractSha256: "a".repeat(64),
      evidenceChainSha256: "b".repeat(64),
      artifactSha256: "c".repeat(64),
      verificationSummary: "repaired-test-passed: PASSED",
      result: "VERIFIED",
      createdAt: new Date().toISOString(),
      verificationStatus: "VALID",
      invalidated: false,
      disputed: false,
      agentRepair: {
        gateway: "Vercel AI Gateway",
        modelProvider: "poolside",
        modelId: "poolside/laguna-s-2.1-free",
        agentProviderAdapter: "VercelAIGatewayAgentProvider",
        authentication: "VERCEL_OIDC",
        freeCreditBalanceBefore: "5",
        freeCreditUsed: "0",
        freeCreditBalanceAfter: "5",
        apiRequestCount: 4,
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        gatewayReportedCostUsd: 0,
        baselineTestExitCode: 1,
        repairedTestExitCode: 0,
        patchSha256: "d".repeat(64),
        modifiedFiles: ["src/add.ts"],
        toolCallCount: 8,
        cleanupVerified: true,
      },
      scopeDisclaimer: "Bounded Agent repair only.",
    });
    expect(receipt.agentRepair).toMatchObject({
      gateway: "Vercel AI Gateway",
      modelProvider: "poolside",
      modelId: "poolside/laguna-s-2.1-free",
      agentProviderAdapter: "VercelAIGatewayAgentProvider",
    });
    expect(JSON.stringify(receipt)).not.toMatch(/VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|Bearer\s+[A-Za-z0-9._-]+|secret/i);
  });
});

function providerFixture(balance: string): VercelAIGatewayAgentProvider {
  const gatewayClient = Object.assign(
    () => { throw new Error("Model calls are forbidden in provider preflight tests"); },
    {
      getCredits: async () => ({ balance, totalUsed: "0" }),
      getAvailableModels: async () => ({
        models: [
          model("poolside/laguna-s-2.1-free", "Laguna S 2.1 Free", "0", "0"),
          model("inclusionai/ling-3.0-flash-fin", "Ling 3 Flash", "0", "0"),
          model("paid/coder", "Paid Coder", "0.0001", "0.0002"),
        ],
      }),
      getSpendReport: async () => ({ results: [] }),
    },
  );
  const publicCatalog = {
    data: [
      publicModel("poolside/laguna-s-2.1-free", ["reasoning", "tool-use", "free"]),
      publicModel("inclusionai/ling-3.0-flash-fin", ["reasoning", "tool-use", "free"]),
      publicModel("paid/coder", ["reasoning", "tool-use"]),
    ],
  };
  return new VercelAIGatewayAgentProvider(
    gatewayClient as never,
    async () => new Response(JSON.stringify(publicCatalog), { status: 200, headers: { "content-type": "application/json" } }),
  );
}

function model(id: string, name: string, input: string, output: string) {
  return {
    id,
    name,
    modelType: "language",
    pricing: { input, output },
    specification: { specificationVersion: "v4", provider: "gateway", modelId: id },
  };
}

function publicModel(id: string, tags: string[]) {
  return {
    id,
    name: id,
    type: "language",
    context_window: 256_000,
    max_tokens: 32_768,
    tags,
    supported_parameters: ["tools", "tool_choice", "reasoning"],
    pricing: { input: id.startsWith("paid/") ? "0.0001" : "0", output: id.startsWith("paid/") ? "0.0002" : "0" },
  };
}

function unsignedOidc(payload: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test`;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
