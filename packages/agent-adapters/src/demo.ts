import { randomUUID } from "node:crypto";

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

export class DemoAgentAdapter implements AgentProviderAdapter {
  readonly kind = "demo" as const;
  private readonly tasks = new Map<string, { status: AgentTaskStatus; input: CreateAgentTaskInput }>();
  private readonly idempotencyKeys = new Map<string, string>();

  async discover(_input: AgentDiscoveryInput): Promise<DiscoveredAgent> {
    return {
      name: "DoneLayer Demo Agent",
      description: "Deterministic executor for the complete Proof-of-Done demo lifecycle.",
      version: "1.0.0",
      endpointType: "demo",
      skills: ["repository-diagnosis", "test-fixing", "build-verification"],
      inputModes: ["application/json"],
      outputModes: ["application/json", "text/plain"],
      authentication: { type: "internal-demo" },
    };
  }

  async validate(_candidate: unknown): Promise<AdapterValidationResult> {
    return { valid: true, normalized: await this.discover({}) };
  }

  async createTask(input: CreateAgentTaskInput): Promise<AgentTaskReference> {
    const existingId = this.idempotencyKeys.get(input.idempotencyKey);
    if (existingId) {
      const existing = this.requireTask(existingId);
      return { providerTaskId: existingId, acceptedAt: existing.status.updatedAt };
    }
    const providerTaskId = `demo_${randomUUID()}`;
    const acceptedAt = new Date().toISOString();
    this.tasks.set(providerTaskId, {
      input,
      status: { providerTaskId, status: "accepted", progress: 0, updatedAt: acceptedAt },
    });
    this.idempotencyKeys.set(input.idempotencyKey, providerTaskId);
    return { providerTaskId, acceptedAt };
  }

  async getTaskStatus(reference: AgentTaskReference): Promise<AgentTaskStatus> {
    const task = this.requireTask(reference.providerTaskId);
    if (task.status.status === "accepted") {
      task.status = {
        ...task.status,
        status: "running",
        progress: 50,
        message: "Demo executor is producing evidence",
        updatedAt: new Date().toISOString(),
      };
    } else if (task.status.status === "running") {
      task.status = {
        ...task.status,
        status: "submitted",
        progress: 100,
        message: "Demo evidence submitted",
        updatedAt: new Date().toISOString(),
      };
    }
    return { ...task.status };
  }

  async cancelTask(reference: AgentTaskReference): Promise<void> {
    const task = this.requireTask(reference.providerTaskId);
    task.status = { ...task.status, status: "cancelled", updatedAt: new Date().toISOString() };
  }

  async fetchResult(reference: AgentTaskReference): Promise<AgentTaskResult> {
    const task = this.requireTask(reference.providerTaskId);
    if (task.status.status !== "submitted") {
      throw new Error("Demo task has not submitted a result yet");
    }
    return {
      providerTaskId: reference.providerTaskId,
      status: "succeeded",
      summary: `Completed: ${task.input.title}`,
      evidenceArtifactIds: [],
      metadata: { demo: true, jobRunId: task.input.jobRunId },
    };
  }

  private requireTask(providerTaskId: string) {
    const task = this.tasks.get(providerTaskId);
    if (!task) throw new Error("Demo task was not found");
    return task;
  }
}
