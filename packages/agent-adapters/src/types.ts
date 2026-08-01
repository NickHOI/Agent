export type AgentEndpointType = "local-worker" | "webhook" | "demo" | "a2a";

export type AgentDiscoveryInput = {
  endpointUrl?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type DiscoveredAgent = {
  name: string;
  description: string;
  version: string;
  endpointType: AgentEndpointType;
  endpointUrl?: string | undefined;
  skills: string[];
  inputModes: string[];
  outputModes: string[];
  authentication: Record<string, unknown>;
  raw?: unknown;
};

export type AdapterValidationResult =
  | { valid: true; normalized: DiscoveredAgent }
  | { valid: false; errors: string[] };

export type CreateAgentTaskInput = {
  taskId: string;
  jobRunId: string;
  title: string;
  scopeSummary: string;
  desiredOutcome: string;
  acceptanceCriteria: Array<{ id: string; type: string; label: string; required: boolean }>;
  permissions: {
    modifyCode: boolean;
    createPullRequest: boolean;
  };
  callbackBaseUrl?: string | undefined;
  idempotencyKey: string;
};

export type AgentTaskReference = {
  providerTaskId: string;
  acceptedAt: string;
};

export type AgentTaskStatus = {
  providerTaskId: string;
  status: "queued" | "accepted" | "running" | "submitted" | "failed" | "cancelled";
  progress?: number | undefined;
  message?: string | undefined;
  updatedAt: string;
};

export type AgentTaskResult = {
  providerTaskId: string;
  status: "succeeded" | "failed" | "cancelled";
  summary: string;
  evidenceArtifactIds: string[];
  metadata: Record<string, unknown>;
};

export interface AgentProviderAdapter {
  readonly kind: AgentEndpointType;
  discover(input: AgentDiscoveryInput): Promise<DiscoveredAgent>;
  validate(candidate: unknown): Promise<AdapterValidationResult>;
  createTask(input: CreateAgentTaskInput): Promise<AgentTaskReference>;
  getTaskStatus(reference: AgentTaskReference): Promise<AgentTaskStatus>;
  cancelTask(reference: AgentTaskReference): Promise<void>;
  fetchResult(reference: AgentTaskReference): Promise<AgentTaskResult>;
}
