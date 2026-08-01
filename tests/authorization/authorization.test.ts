import { describe, expect, it } from "vitest";
import { DemoStore } from "@donelayer/database";
import { canViewTask } from "../../apps/web/src/server/authorization";

describe("server authorization boundaries", () => {
  it("prevents another customer from viewing a private task", () => {
    const store = new DemoStore(":memory:");
    try {
      const task = store.createDemoTask();
      const aggregate = store.getTaskAggregate(task.id);
      expect(canViewTask({ id: "customer-other", name: "Other", role: "CUSTOMER" }, aggregate)).toBe(false);
      expect(canViewTask({ id: "customer-nick", name: "Nick", role: "CUSTOMER" }, aggregate)).toBe(true);
    } finally {
      store.close();
    }
  });

  it("prevents a Worker from claiming an unassigned job", () => {
    const store = new DemoStore(":memory:");
    try {
      expect(store.claimAssignedJob("20000000-0000-4000-8000-000000000001")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("rejects direct attempts to force COMPLETED", () => {
    const store = new DemoStore(":memory:");
    try {
      const task = store.createDemoTask();
      expect(() => store.transitionTask(task.id, "COMPLETED", { kind: "CUSTOMER", id: "customer-nick" }, "Bypass verification")).toThrow(/cannot transition/i);
    } finally {
      store.close();
    }
  });

  it("rejects evidence initialization from a different Worker", () => {
    const store = new DemoStore(":memory:");
    try {
      const offer = store.getTask("10000000-0000-4000-8000-000000000002");
      expect(offer?.status).toBe("AWAITING_PROVIDER");
      store.acceptTaskAsProvider(offer!.id, "provider-alpha");
      const assigned = store.getTaskAggregate(offer!.id);
      const workerId = assigned.assignment!.workerId;
      const claimed = store.claimAssignedJob(workerId);
      expect(claimed).not.toBeNull();
      expect(() => store.initializeArtifactUpload(
        claimed!.aggregate.jobRun!.id,
        "20000000-0000-4000-8000-000000000001",
        claimed!.leaseToken,
        { artifactType: "TEST_LOG", fileName: "test.log", mimeType: "text/plain", size: 4, sha256: "0".repeat(64) }
      )).toThrow(/lease is invalid/i);
    } finally {
      store.close();
    }
  });
});
