import type { TaskAggregate } from "@donelayer/database";

export function toTaskViewAggregate(aggregate: TaskAggregate): TaskAggregate {
  return {
    ...aggregate,
    events: (aggregate.events ?? []).map((event) => ({ ...event, payload: {} })),
    agent: aggregate.agent ? { ...aggregate.agent, endpointUrl: null } : null,
    worker: aggregate.worker
      ? {
          ...aggregate.worker,
          tokenHash: null,
          tokenId: null
        }
      : null,
    jobRun: aggregate.jobRun
      ? {
          ...aggregate.jobRun,
          leaseId: null,
          leaseTokenHash: null
        }
      : null,
    jobEvents: (aggregate.jobEvents ?? []).map((event) => ({ ...event, payload: {} })),
    evidence: aggregate.evidence.map((artifact) => ({
      ...artifact,
      storagePath: "[redacted]",
      content: ""
    }))
  };
}
