import { describe, expect, it } from "vitest";
import { DemoStore } from "@donelayer/database";

describe("persisted demo lifecycle", () => {
  it("runs customer -> match -> provider -> worker -> evidence -> verification -> release", () => {
    const store = new DemoStore(":memory:");
    try {
      const task = store.createDemoTask();
      expect(task.status).toBe("DRAFT");
      let aggregate = store.getTaskAggregate(task.id);
      expect(aggregate.ledgerEntries.some((entry) => entry.entryType === "RESERVE")).toBe(true);

      for (let step = 0; step < 30 && aggregate.task.status !== "COMPLETED"; step += 1) {
        aggregate = store.advanceDemo(task.id);
      }

      expect(aggregate.task.status).toBe("COMPLETED");
      expect(aggregate.agent?.name).toBe("React Bug Fix Agent");
      expect(aggregate.worker?.name).toBe("Windows Worker 01");
      expect(aggregate.jobEvents.some((event) => event.kind === "TEST" && event.level === "SUCCESS")).toBe(true);
      expect(aggregate.evidence.length).toBeGreaterThanOrEqual(7);
      expect(aggregate.verificationResults.length).toBe(aggregate.task.acceptanceChecks.length);
      expect(aggregate.verificationResults.every((result) => result.status === "PASSED")).toBe(true);

      const releaseEntries = aggregate.ledgerEntries.filter((entry) => entry.transactionKey === `release:${task.id}`);
      expect(releaseEntries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
      expect(releaseEntries.find((entry) => entry.entryType === "RELEASE" && entry.amountCents > 0)?.amountCents).toBe(19_200);
      expect(releaseEntries.find((entry) => entry.entryType === "PLATFORM_FEE")?.amountCents).toBe(4_800);

      const eventTypes = aggregate.events.map((event) => event.eventType);
      expect(eventTypes).toContain("AGENT_MATCHED");
      expect(eventTypes).toContain("PROVIDER_ACCEPTED");
      expect(eventTypes).toContain("WORKER_CLAIMED");
      expect(eventTypes).toContain("VERIFICATION_PASSED");
      expect(eventTypes.at(-1)).toBe("CUSTOMER_ACCEPTED");
    } finally {
      store.close();
    }
  });

  it("refunds a reserved task without releasing provider earnings", () => {
    const store = new DemoStore(":memory:");
    try {
      const before = store.getWallet("customer-nick", "CUSTOMER");
      const task = store.createDemoTask();
      const reserved = store.getWallet("customer-nick", "CUSTOMER");
      expect(reserved.availableCents).toBe(before.availableCents - task.budgetCents);
      expect(reserved.reservedCents).toBe(before.reservedCents + task.budgetCents);

      store.refundTask(task.id, { kind: "CUSTOMER", id: "customer-nick" });
      const after = store.getWallet("customer-nick", "CUSTOMER");
      expect(after.availableCents).toBe(before.availableCents);
      expect(after.reservedCents).toBe(before.reservedCents);
      const aggregate = store.getTaskAggregate(task.id);
      expect(aggregate.ledgerEntries.filter((entry) => entry.transactionKey === `refund:${task.id}`).reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
    } finally {
      store.close();
    }
  });

  it("releases Worker capacity so two demos can complete sequentially", () => {
    const store = new DemoStore(":memory:");
    try {
      for (let run = 0; run < 2; run += 1) {
        const task = store.createDemoTask();
        let aggregate = store.getTaskAggregate(task.id);
        for (let step = 0; step < 30 && aggregate.task.status !== "COMPLETED"; step += 1) {
          aggregate = store.advanceDemo(task.id);
        }

        expect(aggregate.task.status).toBe("COMPLETED");
        expect(aggregate.worker).toMatchObject({ status: "ONLINE", activeJobs: 0 });
      }
    } finally {
      store.close();
    }
  });
});
