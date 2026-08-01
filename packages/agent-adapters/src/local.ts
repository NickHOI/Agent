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

export type LocalWorkerGateway = {
  enqueue(input: CreateAgentTaskInput): Promise<AgentTaskReference>;
  status(reference: AgentTaskReference): Promise<AgentTaskStatus>;
  cancel(reference: AgentTaskReference): Promise<void>;
  result(reference: AgentTaskReference): Promise<AgentTaskResult>;
};

export class LocalWorkerAdapter implements AgentProviderAdapter {
  readonly kind = "local-worker" as const;

  constructor(
    private readonly agent: Omit<DiscoveredAgent, "endpointType">,
    private readonly gateway: LocalWorkerGateway,
  ) {}

  async discover(_input: AgentDiscoveryInput): Promise<DiscoveredAgent> {
    return { ...this.agent, endpointType: "local-worker" };
  }

  async validate(_candidate: unknown): Promise<AdapterValidationResult> {
    const normalized = await this.discover({});
    const errors = [normalized.name, normalized.description, normalized.version].filter((value) => !value);
    return errors.length > 0
      ? { valid: false, errors: ["Local Worker agent requires a name, description, and version"] }
      : { valid: true, normalized };
  }

  createTask(input: CreateAgentTaskInput): Promise<AgentTaskReference> {
    return this.gateway.enqueue(input);
  }

  getTaskStatus(reference: AgentTaskReference): Promise<AgentTaskStatus> {
    return this.gateway.status(reference);
  }

  cancelTask(reference: AgentTaskReference): Promise<void> {
    return this.gateway.cancel(reference);
  }

  fetchResult(reference: AgentTaskReference): Promise<AgentTaskResult> {
    return this.gateway.result(reference);
  }
}
