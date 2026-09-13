import { describe, expect, it } from "vitest";
import type { PublicJobReceipt, RealBuildTestReceiptSummary, TaskAggregate } from "@donelayer/database";
import { toPublicReceiptView } from "../../apps/web/src/server/public-receipt-view";
import { toTaskViewAggregate } from "../../apps/web/src/server/task-view";

describe("Trust Foundation view boundaries", () => {
  it("removes Worker credentials and local Artifact data from Task responses", () => {
    const aggregate = {
      worker: {
        tokenHash: "private-token-hash",
        tokenId: "private-token-id"
      },
      jobRun: {
        leaseTokenHash: "private-lease-token-hash"
      },
      evidence: [{ storagePath: "C:/private/job/hello.txt", content: "private artifact contents" }]
    } as TaskAggregate;

    const view = toTaskViewAggregate(aggregate);

    expect(view.worker?.tokenHash).toBeNull();
    expect(view.worker?.tokenId).toBeNull();
    expect(view.jobRun?.leaseTokenHash).toBeNull();
    expect(view.evidence[0]?.storagePath).toBe("[redacted]");
    expect(view.evidence[0]?.content).toBe("");
    expect(aggregate.worker?.tokenHash).toBe("private-token-hash");
  });

  it("copies only the public Receipt allowlist", () => {
    const command = {
      command: "npm test",
      exitCode: 1,
      durationMs: 100,
      status: "FAILED" as const,
      stdoutArtifact: { fileName: "test-stdout.log", sha256: "d".repeat(64) },
      stderrArtifact: { fileName: "test-stderr.log", sha256: "e".repeat(64) },
      rawStdout: "private raw output",
      localPath: "C:/private/job/test.log",
      artifactId: "private-artifact-id",
    };
    const buildTest = {
      sourceManifestSha256: "f".repeat(64),
      sourcePackageSha256: "1".repeat(64),
      nodeVersion: "v24.15.0",
      npmVersion: "11.5.1",
      install: { ...command, command: "npm ci --ignore-scripts --no-audit --no-fund", exitCode: 0, status: "PASSED" as const },
      build: { ...command, command: "npm run build", exitCode: 0, status: "PASSED" as const },
      test: command,
      testRunner: "node:test",
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      statisticsStatus: "PARSED" as const,
      sourceMutationDetected: false,
      networkViolationCount: 0,
      permissionViolationCount: 0,
      providerPayoutReleased: false,
      sandboxRunId: "private-sandbox-run-id",
    } satisfies RealBuildTestReceiptSummary & { sandboxRunId: string };
    const receipt: PublicJobReceipt & { token: string; localPath: string; customerId: string } = {
      publicReceiptId: "receipt-public-1",
      taskType: "Real Build and Test Verification",
      agentIdentity: "Worker Smoke Agent",
      workerIdentity: "Worker 1",
      contractSha256: "a".repeat(64),
      evidenceChainSha256: "b".repeat(64),
      artifactSha256: "c".repeat(64),
      verificationSummary: "All required checks passed.",
      result: "FAILED",
      createdAt: "2026-08-26T00:00:00.000Z",
      verificationStatus: "VALID",
      invalidated: false,
      disputed: false,
      buildTest,
      scopeDisclaimer: "This receipt records a real build and test execution.",
      token: "secret",
      localPath: "C:/private/job",
      customerId: "customer-private"
    };

    const view = toPublicReceiptView(receipt);

    expect(Object.keys(view).sort()).toEqual([
      "agentIdentity",
      "artifactSha256",
      "buildTest",
      "contractSha256",
      "createdAt",
      "disputed",
      "evidenceChainSha256",
      "invalidated",
      "publicReceiptId",
      "result",
      "scopeDisclaimer",
      "taskType",
      "verificationStatus",
      "verificationSummary",
      "workerIdentity"
    ]);
    expect(Object.keys(view.buildTest ?? {}).sort()).toEqual([
      "build",
      "failedTests",
      "install",
      "networkViolationCount",
      "nodeVersion",
      "npmVersion",
      "passedTests",
      "permissionViolationCount",
      "providerPayoutReleased",
      "sourceManifestSha256",
      "sourceMutationDetected",
      "sourcePackageSha256",
      "statisticsStatus",
      "test",
      "testRunner",
      "totalTests"
    ]);
    expect(Object.keys(view.buildTest?.test ?? {}).sort()).toEqual([
      "command",
      "durationMs",
      "exitCode",
      "status",
      "stderrArtifact",
      "stdoutArtifact"
    ]);
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(JSON.stringify(view)).not.toContain("C:/private");
    expect(JSON.stringify(view)).not.toContain("customer-private");
    expect(JSON.stringify(view)).not.toContain("private raw output");
    expect(JSON.stringify(view)).not.toContain("private-artifact-id");
    expect(JSON.stringify(view)).not.toContain("private-sandbox-run-id");
  });
});
