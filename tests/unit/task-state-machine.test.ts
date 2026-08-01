import { describe, expect, it } from "vitest";

import {
  TaskStateMachineError,
  canTransition,
  getAllowedTransitions,
  getAuthorizedActorKinds,
  taskTransitions,
  validateTransition,
} from "@donelayer/task-state-machine";

describe("task state machine", () => {
  it("allows an assigned provider to accept a matched task", () => {
    const decision = validateTransition({
      from: "AWAITING_PROVIDER",
      to: "ASSIGNED",
      actor: { kind: "PROVIDER", id: "provider-alpha" },
      context: { providerId: "provider-alpha" },
      reason: "Provider accepted the assignment",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("Provider accepted the assignment");
  });

  it("rejects the wrong provider even when the actor kind is valid", () => {
    try {
      validateTransition({
        from: "AWAITING_PROVIDER",
        to: "ASSIGNED",
        actor: { kind: "PROVIDER", id: "provider-beta" },
        context: { providerId: "provider-alpha" },
        reason: "Attempted claim",
      });
      throw new Error("Expected state-machine validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskStateMachineError);
      expect((error as TaskStateMachineError).code).toBe("ACTOR_ID_MISMATCH");
    }
  });

  it("never permits a task to skip verification and customer review", () => {
    expect(canTransition("RUNNING", "COMPLETED")).toBe(false);
    expect(canTransition("SUBMITTED", "COMPLETED")).toBe(false);
    expect(canTransition("VERIFICATION_PASSED", "COMPLETED")).toBe(false);
    expect(() =>
      validateTransition({
        from: "VERIFICATION_PASSED",
        to: "COMPLETED",
        actor: { kind: "CUSTOMER", id: "customer-1" },
        context: { customerId: "customer-1" },
        reason: "Skip customer review",
      }),
    ).toThrow(/cannot transition/i);
  });

  it("restricts completion to the owning customer or an admin", () => {
    expect(() =>
      validateTransition({
        from: "CUSTOMER_REVIEW",
        to: "COMPLETED",
        actor: { kind: "PROVIDER", id: "provider-alpha" },
        context: {
          customerId: "customer-1",
          providerId: "provider-alpha",
        },
        reason: "Provider attempted completion",
      }),
    ).toThrow(/cannot transition/i);
  });

  it("requires a reason and keeps terminal states terminal", () => {
    expect(() =>
      validateTransition({
        from: "DRAFT",
        to: "PUBLISHED",
        actor: { kind: "CUSTOMER", id: "customer-1" },
        context: { customerId: "customer-1" },
        reason: "   ",
      }),
    ).toThrow(/audit reason/i);

    expect(getAllowedTransitions("COMPLETED")).toEqual([]);
    expect(getAllowedTransitions("CANCELLED")).toEqual([]);
    expect(getAllowedTransitions("EXPIRED")).toEqual([]);
  });

  it("defines an actor guard for every legal transition", () => {
    for (const [from, destinations] of Object.entries(taskTransitions)) {
      for (const to of destinations) {
        expect(
          getAuthorizedActorKinds(
            from as keyof typeof taskTransitions,
            to,
          ),
          `${from} -> ${to}`,
        ).not.toHaveLength(0);
      }
    }
  });
});
