import { fork, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/managed-build-test-reality-server.ts", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const databasePath = path.join(resultDirectory, "real-build-test-sandbox.sqlite");
const evidencePath = path.join(resultDirectory, "real-build-test-sandbox-evidence.json");
const runRealGate = process.env.RUN_MANAGED_BUILD_TEST_REALITY_GATE === "true";
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => stopChild(child)));
});

describe("Real Build and Test in Managed Sandbox Gate V1", () => {
  it.skipIf(!runRealGate)("executes the exact live fixture commit and preserves its real failed test", async () => {
    await mkdir(resultDirectory, { recursive: true });
    await rm(databasePath, { force: true });
    await rm(evidencePath, { force: true });
    const child = fork(fixturePath, [], {
      cwd: workspaceRoot,
      execArgv: ["--import", "tsx"],
      env: { ...process.env, MANAGED_BUILD_TEST_REALITY_DB_PATH: databasePath },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    const ready = await waitForMessage(child, (message) => message.kind === "ready", 20_000);
    child.send?.({ kind: "run" });
    const result = await waitForMessage(child, (message) => message.kind === "result" || message.kind === "error", 360_000);
    const evidence = {
      gate: "REAL_BUILD_AND_TEST_IN_MANAGED_SANDBOX_GATE_V1",
      capturedAt: new Date().toISOString(),
      server: ready,
      processOutput: { stdout, stderr },
      result,
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (result.kind === "error") throw new Error(String(result.message));

    const task = result.task as Record<string, unknown>;
    const source = result.source as Record<string, unknown>;
    const sandboxRun = result.sandboxRun as Record<string, unknown>;
    const inspection = result.providerInspection as Record<string, unknown>;
    const installPolicy = result.installNetworkPolicy as Record<string, unknown>;
    const finalPolicy = result.finalNetworkPolicy as Record<string, unknown>;
    const install = result.install as Record<string, unknown>;
    const build = result.build as Record<string, unknown>;
    const test = result.test as Record<string, unknown>;
    const integrity = result.sourceIntegrity as Record<string, unknown>;
    const cleanup = result.cleanup as Record<string, unknown>;
    const ledger = result.ledgerVerification as Record<string, unknown>;
    const ledgerEntries = result.ledgerEntries as Array<Record<string, unknown>>;
    const artifacts = result.artifacts as Array<Record<string, unknown>>;
    const receipt = result.receipt as Record<string, unknown>;
    const publicReceipt = result.publicReceipt as Record<string, unknown>;
    const testLedgerEntries = result.testLedgerEntries as Array<Record<string, unknown>>;

    expect(task).toMatchObject({ type: "REAL_BUILD_TEST_MANAGED_SANDBOX_V1", status: "VERIFICATION_FAILED" });
    expect(source.remoteUrl).toBe("https://github.com/NickHOI/donelayer-build-rescue-fixture.git");
    expect(source.branch).toBe("main");
    expect(source.materializerCommitSha).toMatch(/^[a-f0-9]{40}$/);
    expect(source.materializerCommitSha).toBe(source.independentRemoteCommitSha);
    expect(source.materializerWorkspaceCleaned).toBe(true);
    expect(source.installLifecycleScriptsPresent).toBe(false);
    expect(source.repositoryManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.sourcePackageManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.sourcePackageSha256).toMatch(/^[a-f0-9]{64}$/);

    expect(sandboxRun).toMatchObject({
      provider: "VERCEL_SANDBOX",
      executionBackendType: "MANAGED_REMOTE_SANDBOX",
      isolationModel: "REMOTE_MICROVM",
      lifecycleMode: "NON_PERSISTENT",
      status: "DESTROYED",
      failureCode: "TEST_FAILED",
    });
    expect(inspection).toMatchObject({
      persistent: false,
      networkPolicy: "deny-all",
      allowedDomains: [],
      allowedCidrs: [],
      portCount: 0,
      sourceSnapshotId: null,
      currentSnapshotId: null,
      cwd: "/vercel/sandbox",
    });
    expect(installPolicy).toMatchObject({ mode: "custom", allowedDomains: ["registry.npmjs.org"], allowedCidrs: [] });
    expect(finalPolicy).toMatchObject({ mode: "deny-all", allowedDomains: [], allowedCidrs: [] });
    expect(install).toMatchObject({ command: "npm ci --ignore-scripts --no-audit --no-fund", exitCode: 0, status: "PASSED" });
    if (source.buildScriptPresent) {
      expect(build).toMatchObject({ command: "npm run build", exitCode: 0, status: "PASSED" });
    } else {
      expect(build).toMatchObject({ command: "npm run build", exitCode: null, status: "NOT_PRESENT" });
    }
    expect(test.command).toBe("npm test");
    expect(Number(test.exitCode)).not.toBe(0);
    expect(test.status).toBe("FAILED");
    expect(integrity).toMatchObject({ sourceMutationDetected: false, missing: [], modified: [], added: [] });
    expect(cleanup).toMatchObject({ finalProviderState: "stopped", cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
    expect(ledger.valid).toBe(true);
    expect(ledgerEntries.at(-1)?.entryType).toBe("RECEIPT_CREATED");
    expect(artifacts).toHaveLength(18);
    expect(artifacts.every((artifact) => artifact.claimedSha256 === artifact.serverSha256)).toBe(true);
    expect(receipt).toMatchObject({ result: "FAILED" });
    expect(publicReceipt).toMatchObject({ taskType: "Real Build and Test Verification", result: "FAILED", verificationStatus: "VALID" });
    expect((publicReceipt.buildTest as Record<string, unknown>)).toMatchObject({
      sourceMutationDetected: false,
      networkViolationCount: 0,
      permissionViolationCount: 0,
      providerPayoutReleased: false,
    });
    expect(testLedgerEntries.some((entry) => entry.entryType === "RELEASE")).toBe(false);
    expect(JSON.stringify(evidence)).not.toMatch(/VERCEL_OIDC_TOKEN|Bearer\s+[A-Za-z0-9._-]+|\.env\.local|C:\\Users\\user/i);

    child.send?.({ kind: "shutdown" });
    await waitForExit(child, 10_000);
    children.delete(child);
  }, 390_000);
});

function waitForMessage(
  child: ChildProcess,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Managed build/test child did not respond within ${timeoutMs} ms`));
    }, timeoutMs);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !predicate(message as Record<string, unknown>)) return;
      cleanup();
      resolve(message as Record<string, unknown>);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Managed build/test child exited before responding (${code ?? "signal"})`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Managed build/test child did not exit")), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.send?.({ kind: "shutdown" });
  try {
    await waitForExit(child, 5_000);
  } catch {
    child.kill("SIGTERM");
  }
}
