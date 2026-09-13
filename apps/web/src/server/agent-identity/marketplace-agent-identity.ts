import type { AgentRecord } from "@donelayer/database";

import type { Actor } from "../auth";

export function assertAgentIdentityAccess(
  actor: Actor,
  agent: AgentRecord,
  access: "READ" | "WRITE",
): void {
  if (access === "READ" && actor.role === "ADMIN") return;
  if (actor.role !== "PROVIDER" || actor.id !== agent.providerId) {
    throw new Error("AGENT_IDENTITY_ACCESS_DENIED");
  }
}
