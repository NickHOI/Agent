import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const evidencePath = path.resolve("test-results/managed-sandbox-reality-evidence.json");

describe("persisted Managed Sandbox Reality Evidence", () => {
  it.skipIf(!existsSync(evidencePath))("proves the real smoke and timeout Provider lifecycle", () => {
    const raw = readFileSync(evidencePath, "utf8");
    const evidence = JSON.parse(raw) as Record<string, unknown>;
    const result = evidence.result as Record<string, unknown>;
    const server = evidence.server as Record<string, unknown>;
    const smoke = result.smoke as Record<string, unknown>;
    const timeout = result.timeout as Record<string, unknown>;
    const smokeRun = smoke.sandboxRun as Record<string, unknown>;
    const timeoutRun = timeout.sandboxRun as Record<string, unknown>;
    const smokeTask = smoke.task as Record<string, unknown>;
    const timeoutTask = timeout.task as Record<string, unknown>;
    const proof = smoke.proof as Record<string, unknown>;
    const networkProbe = proof.networkProbe as Record<string, unknown>;
    const exposure = proof.localHostExposure as Record<string, unknown>;
    const smokeCleanup = smoke.cleanup as Record<string, unknown>;
    const timeoutCleanup = timeout.cleanup as Record<string, unknown>;
    const smokeLedger = smoke.ledgerVerification as Record<string, unknown>;
    const timeoutLedger = timeout.ledgerVerification as Record<string, unknown>;
    const receipt = smoke.receipt as Record<string, unknown>;
    const publicReceipt = smoke.publicReceipt as Record<string, unknown>;
    const artifacts = smoke.artifacts as Array<Record<string, unknown>>;

    expect(server.pid).toEqual(expect.any(Number));
    expect(Number(server.pid)).toBeGreaterThan(0);
    expect(result.kind).toBe("result");
    expect(smokeTask).toMatchObject({ type: "MANAGED_REMOTE_SANDBOX_SMOKE_V1", status: "COMPLETED" });
    expect(smokeRun).toMatchObject({ provider: "VERCEL_SANDBOX", executionBackendType: "MANAGED_REMOTE_SANDBOX", isolationModel: "REMOTE_MICROVM", lifecycleMode: "NON_PERSISTENT", status: "DESTROYED" });
    expect((smokeRun.networkPolicy as Record<string, unknown>)).toMatchObject({ mode: "deny-all", allowedDomains: [], allowedCidrs: [], persistent: false, snapshot: false, localHostExecution: false, localDockerExecution: false });
    expect(networkProbe).toMatchObject({ blocked: true, outcome: "blocked" });
    expect(exposure).toMatchObject({ repositoryGitPresent: false, repositoryAgentRulesPresent: false, repositoryPackagePresent: false, localEnvironmentFilePresent: false, windowsDriveMountPresent: false, credentialLikeEnvironmentNames: [] });
    expect(smoke.proofClaimedSha256).toBe(smoke.proofServerSha256);
    expect(artifacts.map((artifact) => artifact.fileName).sort()).toEqual([
      "managed-sandbox-cleanup.json",
      "managed-sandbox-lifecycle.json",
      "managed-sandbox-policy.json",
      "managed-sandbox-proof.json",
      "managed-sandbox-provider.json",
      "managed-sandbox-stderr.log",
      "managed-sandbox-stdout.log",
    ]);
    expect(artifacts.every((artifact) => artifact.claimedSha256 === artifact.serverSha256)).toBe(true);
    expect(smokeCleanup).toMatchObject({ finalProviderState: "stopped", cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
    expect(smokeLedger).toMatchObject({ valid: true, entryCount: 34 });
    expect((smoke.verificationResults as unknown[])).toHaveLength(22);
    expect(receipt).toMatchObject({ result: "VERIFIED" });
    expect(publicReceipt).toMatchObject({ taskType: "Managed Remote Sandbox Verification", result: "VERIFIED", verificationStatus: "VALID" });

    expect(timeoutTask).toMatchObject({ type: "MANAGED_SANDBOX_TIMEOUT_PROBE_V1", status: "VERIFICATION_FAILED" });
    expect(timeoutRun).toMatchObject({ status: "DESTROYED", failureCode: "TIMEOUT_TRIGGERED" });
    expect(timeout.timeoutEvidence).toMatch(/exit 137.*1504 ms/i);
    expect(timeoutCleanup).toMatchObject({ finalProviderState: "stopped", cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
    expect(timeoutLedger).toMatchObject({ valid: true, entryCount: 12 });
    expect(timeout.receiptCreated).toBe(false);

    expect(raw).not.toMatch(/VERCEL_OIDC_TOKEN|Bearer\s+[A-Za-z0-9._-]+|C:\\Users\\user|\.env\.local/i);
  });
});
