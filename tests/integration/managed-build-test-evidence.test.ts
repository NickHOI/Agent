import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS,
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
} from "@donelayer/worker-protocol";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidencePath = path.join(workspaceRoot, "test-results", "real-build-test-sandbox-evidence.json");
const hasEvidence = existsSync(evidencePath);

describe("Persisted Real Build and Test Managed Sandbox Evidence", () => {
  it.skipIf(!hasEvidence)("remains independently consistent after the live gate process exits", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      gate: string;
      processOutput: { stdout: string; stderr: string };
      result: Record<string, unknown>;
    };
    const result = evidence.result;
    const source = result.source as Record<string, unknown>;
    const task = result.task as Record<string, unknown>;
    const sandboxRun = result.sandboxRun as Record<string, unknown>;
    const install = result.install as Record<string, unknown>;
    const build = result.build as Record<string, unknown>;
    const test = result.test as Record<string, unknown>;
    const sourceIntegrity = result.sourceIntegrity as Record<string, unknown>;
    const cleanup = result.cleanup as Record<string, unknown>;
    const artifacts = result.artifacts as Array<Record<string, unknown>>;
    const ledger = result.ledgerVerification as Record<string, unknown>;
    const ledgerEntries = result.ledgerEntries as Array<Record<string, unknown>>;
    const testLedgerEntries = result.testLedgerEntries as Array<Record<string, unknown>>;
    const receipt = result.receipt as Record<string, unknown>;
    const publicReceipt = result.publicReceipt as Record<string, unknown>;

    expect(evidence.gate).toBe("REAL_BUILD_AND_TEST_IN_MANAGED_SANDBOX_GATE_V1");
    expect(result.kind).toBe("result");
    expect(task).toMatchObject({ type: "REAL_BUILD_TEST_MANAGED_SANDBOX_V1", status: "VERIFICATION_FAILED" });
    expect(source).toMatchObject({
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: REPOSITORY_MATERIALIZATION_BRANCH,
      materializerWorkspaceCleaned: true,
      installLifecycleScriptsPresent: false,
    });
    expect(source.materializerCommitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(source.materializerCommitSha).toBe(source.independentRemoteCommitSha);
    expect(source.repositoryManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.sourcePackageManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.sourcePackageSha256).toMatch(/^[a-f0-9]{64}$/);

    expect(sandboxRun).toMatchObject({
      status: "DESTROYED",
      failureCode: "TEST_FAILED",
      executionBackendType: "MANAGED_REMOTE_SANDBOX",
      lifecycleMode: "NON_PERSISTENT",
    });
    expect(install).toMatchObject({ command: "npm ci --ignore-scripts --no-audit --no-fund", exitCode: 0, status: "PASSED" });
    if (source.buildScriptPresent) {
      expect(build).toMatchObject({ command: "npm run build", exitCode: 0, status: "PASSED" });
    } else {
      expect(build).toMatchObject({ command: "npm run build", exitCode: null, status: "NOT_PRESENT" });
    }
    expect(test.command).toBe("npm test");
    expect(test.status).toBe("FAILED");
    expect(Number(test.exitCode)).not.toBe(0);
    expect(sourceIntegrity).toMatchObject({ sourceMutationDetected: false, missing: [], modified: [], added: [] });
    expect(cleanup).toMatchObject({ cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });

    expect(artifacts.map((artifact) => artifact.fileName).sort()).toEqual([...MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS].sort());
    expect(artifacts.every((artifact) => artifact.claimedSha256 === artifact.serverSha256)).toBe(true);
    expect(ledger.valid).toBe(true);
    expect(ledger.chainSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(ledgerEntries.at(-1)?.entryType).toBe("RECEIPT_CREATED");
    expect(testLedgerEntries.some((entry) => entry.entryType === "RELEASE")).toBe(false);
    expect(receipt.result).toBe("FAILED");
    expect(publicReceipt).toMatchObject({
      taskType: "Real Build and Test Verification",
      result: "FAILED",
      verificationStatus: "VALID",
    });
    expect(evidence.processOutput.stderr).toBe("");
    expect(JSON.stringify(evidence)).not.toMatch(/VERCEL_OIDC_TOKEN|Bearer\s+[A-Za-z0-9._-]+|\.env\.local|C:\\Users\\user/i);
  });
});
