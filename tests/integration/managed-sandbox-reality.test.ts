import { fork, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/managed-sandbox-reality-server.ts", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const databasePath = path.join(resultDirectory, "managed-sandbox-reality.sqlite");
const evidencePath = path.join(resultDirectory, "managed-sandbox-reality-evidence.json");
const runRealGate = process.env.RUN_MANAGED_SANDBOX_REALITY_GATE === "true";
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => stopChild(child)));
});

describe("Managed Remote Sandbox Reality Gate", () => {
  it.skipIf(!runRealGate)("executes the fixed smoke and timeout workflows in real Vercel Sandboxes", async () => {
    await mkdir(resultDirectory, { recursive: true });
    await rm(databasePath, { force: true });
    await rm(evidencePath, { force: true });
    const child = fork(fixturePath, [], {
      cwd: workspaceRoot,
      execArgv: ["--import", "tsx"],
      env: { ...process.env, MANAGED_SANDBOX_REALITY_DB_PATH: databasePath },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    const ready = await waitForMessage(child, (message) => message.kind === "ready", 20_000);
    child.send?.({ kind: "run" });
    const result = await waitForMessage(child, (message) => message.kind === "result" || message.kind === "error", 120_000);
    const evidence = {
      gate: "MANAGED_REMOTE_SANDBOX_GATE_V1",
      capturedAt: new Date().toISOString(),
      server: ready,
      processOutput: { stdout, stderr },
      result,
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

    if (result.kind === "error") throw new Error(String(result.message));
    const smoke = result.smoke as Record<string, unknown>;
    const timeout = result.timeout as Record<string, unknown>;
    const smokeTask = smoke.task as Record<string, unknown>;
    const sandboxRun = smoke.sandboxRun as Record<string, unknown>;
    const inspection = smoke.providerInspection as Record<string, unknown>;
    const proof = smoke.proof as Record<string, unknown>;
    const probe = proof.networkProbe as Record<string, unknown>;
    const exposure = proof.localHostExposure as Record<string, unknown>;
    const cleanup = smoke.cleanup as Record<string, unknown>;
    const receipt = smoke.receipt as Record<string, unknown>;
    const publicReceipt = smoke.publicReceipt as Record<string, unknown>;
    const timeoutTask = timeout.task as Record<string, unknown>;
    const timeoutCleanup = timeout.cleanup as Record<string, unknown>;

    expect(smokeTask).toMatchObject({ type: "MANAGED_REMOTE_SANDBOX_SMOKE_V1", status: "COMPLETED" });
    expect(sandboxRun).toMatchObject({ provider: "VERCEL_SANDBOX", executionBackendType: "MANAGED_REMOTE_SANDBOX", isolationModel: "REMOTE_MICROVM", lifecycleMode: "NON_PERSISTENT", status: "DESTROYED" });
    expect(inspection).toMatchObject({ persistent: false, networkPolicy: "deny-all", portCount: 0, sourceSnapshotId: null, currentSnapshotId: null, cwd: "/vercel/sandbox" });
    expect(probe.blocked).toBe(true);
    expect(exposure).toMatchObject({ repositoryGitPresent: false, repositoryAgentRulesPresent: false, repositoryPackagePresent: false, localEnvironmentFilePresent: false, windowsDriveMountPresent: false, credentialLikeEnvironmentNames: [] });
    expect(smoke.proofClaimedSha256).toBe(smoke.proofServerSha256);
    expect(cleanup).toMatchObject({ cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
    expect(receipt).toMatchObject({ result: "VERIFIED" });
    expect(publicReceipt).toMatchObject({ result: "VERIFIED", verificationStatus: "VALID" });
    expect(timeoutTask).toMatchObject({ type: "MANAGED_SANDBOX_TIMEOUT_PROBE_V1", status: "VERIFICATION_FAILED" });
    expect(timeoutCleanup).toMatchObject({ cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
    expect(timeout.receiptCreated).toBe(false);
    expect(JSON.stringify(evidence)).not.toMatch(/VERCEL_OIDC_TOKEN|Bearer\s+[A-Za-z0-9._-]+|C:\\Users\\user/i);

    child.send?.({ kind: "shutdown" });
    await waitForExit(child, 10_000);
    children.delete(child);
  }, 150_000);
});

function waitForMessage(
  child: ChildProcess,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Managed Sandbox child did not respond within ${timeoutMs} ms`));
    }, timeoutMs);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !predicate(message as Record<string, unknown>)) return;
      cleanup();
      resolve(message as Record<string, unknown>);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Managed Sandbox child exited before responding (${code ?? "signal"})`));
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
    const timer = setTimeout(() => reject(new Error("Managed Sandbox child did not exit")), timeoutMs);
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
