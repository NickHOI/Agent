import { arch } from "node:os";

import { describe, expect, it } from "vitest";

import { workerCapabilitiesSchema } from "@donelayer/worker-protocol";
import {
  WORKER_MAX_CONCURRENT_JOBS,
  runDoctor,
} from "../../apps/worker/src/doctor.js";

describe("Worker capability detection", () => {
  it("reports the real Node process, memory, tools, and active executor", async () => {
    const report = await runDoctor({ workspacePath: process.cwd() });
    const capabilities = report.capabilities;

    expect(workerCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
    expect(capabilities.nodeVersion).toBe(process.version);
    expect(capabilities.workerVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(capabilities.processId).toBe(process.pid);
    expect(capabilities.architecture).toBe(arch());
    expect(capabilities.memoryBytes).toBeGreaterThan(0);
    expect(capabilities.availableMemoryBytes).toBeGreaterThanOrEqual(0);
    expect(capabilities.availableMemoryBytes).toBeLessThanOrEqual(capabilities.memoryBytes);
    expect(capabilities.freeDiskBytes).toBeGreaterThan(0);
    expect(capabilities.installedTools).toContain("node");
    expect(capabilities.npmVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(capabilities.installedTools).toContain("npm");
    expect(capabilities.executors).toEqual(
      capabilities.gitAvailable
        ? ["worker-smoke", "repository-materializer"]
        : ["worker-smoke"],
    );
    expect(capabilities.maxConcurrentJobs).toBe(WORKER_MAX_CONCURRENT_JOBS);
    expect(capabilities.mcpServers).toEqual([]);
    expect(report.healthyForSmoke).toBe(true);
    expect(report.healthyForDemo).toBe(false);
    expect(report.healthyForCodex).toBe(false);
  });

  it("rejects a capability snapshot whose available memory exceeds total memory", async () => {
    const capabilities = (await runDoctor({ workspacePath: process.cwd() })).capabilities;
    expect(workerCapabilitiesSchema.safeParse({
      ...capabilities,
      availableMemoryBytes: capabilities.memoryBytes + 1,
    }).success).toBe(false);
  });
});
