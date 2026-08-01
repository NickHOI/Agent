import { z } from "zod";

import {
  assertSafeHttpsEndpoint,
  pinnedHttpsFetch,
  readResponseBodyLimited,
  resolveSafeHttpsEndpoint,
  type HostResolver,
} from "./network";
import type {
  AdapterValidationResult,
  AgentDiscoveryInput,
  AgentProviderAdapter,
  AgentTaskReference,
  AgentTaskResult,
  AgentTaskStatus,
  CreateAgentTaskInput,
  DiscoveredAgent,
} from "./types";

const a2aSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  examples: z.array(z.string()).optional(),
  inputModes: z.array(z.string()).optional(),
  outputModes: z.array(z.string()).optional(),
});

export const a2aAgentCardSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().default(""),
  url: z.string().url(),
  version: z.string().min(1).default("1.0.0"),
  capabilities: z.record(z.string(), z.unknown()).default({}),
  skills: z.array(a2aSkillSchema).default([]),
  defaultInputModes: z.array(z.string()).default(["text/plain"]),
  defaultOutputModes: z.array(z.string()).default(["text/plain"]),
  securitySchemes: z.record(z.string(), z.unknown()).optional(),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
});

export type A2AAgentCard = z.infer<typeof a2aAgentCardSchema>;

export async function importA2AAgentCard(
  cardUrl: string,
  options: {
    fetch?: typeof fetch;
    resolveHostname?: HostResolver;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<DiscoveredAgent> {
  const endpoint = await resolveSafeHttpsEndpoint(cardUrl, options.resolveHostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Agent Card request timed out")), options.timeoutMs ?? 8_000);
  try {
    const headers = { accept: "application/json", "user-agent": "DoneLayer-A2A-Importer/1.0" };
    const response = options.fetch
      ? await options.fetch(endpoint.url, {
          headers,
          redirect: "error",
          signal: controller.signal,
        })
      : await pinnedHttpsFetch(
          endpoint,
          { method: "GET", headers, signal: controller.signal },
          options.maxBytes ?? 512 * 1_024,
        );
    if (!response.ok) throw new Error(`Agent Card returned HTTP ${response.status}`);
    const maxBytes = options.maxBytes ?? 512 * 1_024;
    const body = await readResponseBodyLimited(response, maxBytes).catch((error) => {
      throw new Error("Agent Card is too large", { cause: error });
    });
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new Error("Agent Card is not valid JSON");
    }
    const card = a2aAgentCardSchema.parse(json);
    await assertSafeHttpsEndpoint(card.url, options.resolveHostname);
    return normalizeA2ACard(card);
  } finally {
    clearTimeout(timer);
  }
}

export async function tryImportA2AAgentCard(
  cardUrl: string,
  options: Parameters<typeof importA2AAgentCard>[1] = {},
): Promise<{ ok: true; agent: DiscoveredAgent } | { ok: false; error: string }> {
  try {
    return { ok: true, agent: await importA2AAgentCard(cardUrl, options) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Agent Card import failed" };
  }
}

export class A2AAdapter implements AgentProviderAdapter {
  readonly kind = "a2a" as const;

  constructor(private readonly options: Parameters<typeof importA2AAgentCard>[1] = {}) {}

  async discover(input: AgentDiscoveryInput): Promise<DiscoveredAgent> {
    if (!input.endpointUrl) throw new Error("An A2A Agent Card URL is required");
    return importA2AAgentCard(input.endpointUrl, this.options);
  }

  async validate(candidate: unknown): Promise<AdapterValidationResult> {
    const parsed = a2aAgentCardSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      };
    }
    try {
      await assertSafeHttpsEndpoint(parsed.data.url, this.options?.resolveHostname);
      return { valid: true, normalized: normalizeA2ACard(parsed.data) };
    } catch (error) {
      return { valid: false, errors: [error instanceof Error ? error.message : "Unsafe A2A endpoint"] };
    }
  }

  async createTask(_input: CreateAgentTaskInput): Promise<AgentTaskReference> {
    throw unsupported();
  }

  async getTaskStatus(_reference: AgentTaskReference): Promise<AgentTaskStatus> {
    throw unsupported();
  }

  async cancelTask(_reference: AgentTaskReference): Promise<void> {
    throw unsupported();
  }

  async fetchResult(_reference: AgentTaskReference): Promise<AgentTaskResult> {
    throw unsupported();
  }
}

function normalizeA2ACard(card: A2AAgentCard): DiscoveredAgent {
  return {
    name: card.name,
    description: card.description,
    version: card.version,
    endpointType: "a2a",
    endpointUrl: card.url,
    skills: card.skills.flatMap((skill) => [skill.id, skill.name, ...skill.tags]).filter(unique),
    inputModes: card.defaultInputModes,
    outputModes: card.defaultOutputModes,
    authentication: {
      securitySchemes: card.securitySchemes ?? {},
      security: card.security ?? [],
    },
    raw: card,
  };
}

function unique(value: string, index: number, array: string[]): boolean {
  return array.indexOf(value) === index;
}

function unsupported(): Error {
  return new Error("A2A task execution is not enabled in the MVP; Agent Card discovery is supported");
}
