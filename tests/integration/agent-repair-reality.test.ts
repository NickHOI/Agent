import { fork, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { AGENT_REPAIR_FIXTURE_COMMIT } from "../../apps/web/src/server/agent-execution/agent-repair-orchestrator";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/agent-repair-reality-server.ts", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const databasePath = path.join(resultDirectory, "agent-repair-sandbox.sqlite");
const evidencePath = path.join(resultDirectory, "agent-repair-sandbox-evidence.json");
const patchPath = path.join(resultDirectory, "agent-repair.patch");
const runRealGate = process.env.RUN_AGENT_REPAIR_REALITY_GATE === "true";
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => stopChild(child)));
});

describe("Agent Repair in Managed Sandbox Gate V1", () => {
  it.skipIf(!runRealGate)("uses one live Gateway Agent run to repair and verify the pinned fixture", async () => {
    await mkdir(resultDirectory, { recursive: true });
    await Promise.all([rm(databasePath, { force: true }), rm(evidencePath, { force: true }), rm(patchPath, { force: true })]);
    const child = fork(fixturePath, [], {
      cwd: workspaceRoot,
      execArgv: ["--import", "tsx"],
      env: { ...process.env, AGENT_REPAIR_REALITY_DB_PATH: databasePath },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });

    const ready = await waitForMessage(child, (message) => message.kind === "ready", 20_000);
    child.send?.({ kind: "run" });
    const result = await waitForMessage(child, (message) => message.kind === "result" || message.kind === "error", 660_000);
    const evidence = {
      gate: "AGENT_REPAIR_IN_MANAGED_SANDBOX_GATE_V1",
      capturedAt: new Date().toISOString(),
      server: ready,
      processOutput: { stdout, stderr },
      result,
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (result.kind === "error") throw new Error(String(result.message));
    const patch = result.patch as { patch: string; sha256: string; modifiedFiles: string[] };
    await writeFile(patchPath, patch.patch, "utf8");

    const preflight = result.preflight as Record<string, unknown>;
    const selectedModel = preflight.selectedModel as Record<string, unknown>;
    const source = result.source as Record<string, unknown>;
    const sandbox = result.sandbox as Record<string, unknown>;
    const repairedTest = result.repairedTest as Record<string, unknown>;
    const integrity = result.sourceIntegrity as Record<string, unknown>;
    const cleanup = result.cleanup as Record<string, unknown>;
    const agentRun = result.agentRun as Record<string, unknown>;
    const usage = agentRun.usage as Record<string, unknown>;
    const toolCalls = result.toolCalls as Array<Record<string, unknown>>;
    const ledger = result.ledgerVerification as Record<string, unknown>;
    const ledgerEntries = result.ledgerEntries as Array<Record<string, unknown>>;
    const receipt = result.receipt as Record<string, unknown>;
    const receiptDocument = receipt.document as Record<string, unknown>;
    const publicReceipt = result.publicReceipt as Record<string, unknown>;

    expect(result.status).toBe("VERIFIED");
    expect(preflight.authentication).toBe("VERCEL_OIDC");
    expect(Number((preflight.creditsBefore as Record<string, unknown>).balance)).toBeGreaterThan(0);
    expect(selectedModel).toMatchObject({ isFree: true, supportsTools: true, supportsReasoning: true });
    expect(selectedModel.id).toEqual(expect.any(String));
    expect(source).toMatchObject({ materializerCommitSha: AGENT_REPAIR_FIXTURE_COMMIT, independentRemoteCommitSha: AGENT_REPAIR_FIXTURE_COMMIT, materializerWorkspaceCleaned: true });
    expect(sandbox).toMatchObject({ networkPolicy: "deny-all", persistent: false, snapshot: false });
    expect(Number((sandbox.baselineTest as Record<string, unknown>).exitCode)).not.toBe(0);
    expect(repairedTest.exitCode).toBe(0);
    expect(usage.apiRequestCount).toEqual(expect.any(Number));
    expect(Number(usage.apiRequestCount)).toBeGreaterThan(0);
    expect(toolCalls.map((call) => call.toolName)).toEqual(expect.arrayContaining(["list_files", "inspect_test_failure", "read_file", "apply_patch", "run_test", "get_diff", "get_source_integrity"]));
    expect(patch.modifiedFiles).toEqual(["src/add.ts"]);
    expect(patch.patch).toContain("diff --git a/src/add.ts b/src/add.ts");
    expect(integrity).toMatchObject({ baselineCommitSha: AGENT_REPAIR_FIXTURE_COMMIT, missing: [], added: [], unauthorizedModified: [] });
    expect(cleanup).toMatchObject({ cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
    expect(ledger.valid).toBe(true);
    expect(ledgerEntries.at(-1)?.entryType).toBe("RECEIPT_CREATED");
    expect(receipt.result).toBe("VERIFIED");
    expect(receiptDocument).toMatchObject({ gateway: "Vercel AI Gateway", modelId: selectedModel.id, agentProviderAdapter: "VercelAIGatewayAgentProvider", authentication: "VERCEL_OIDC" });
    expect(publicReceipt).toMatchObject({ taskType: "Agent Repair in Managed Sandbox Verification", result: "VERIFIED", verificationStatus: "VALID", modelId: selectedModel.id });
    expect(JSON.stringify(evidence)).not.toMatch(/VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|Bearer\s+[A-Za-z0-9._-]+|\.env\.local|C:\\Users\\user/i);

    const db = new DatabaseSync(databasePath, { readOnly: true });
    expect((db.prepare("SELECT COUNT(*) AS count FROM agent_repair_runs").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS count FROM job_receipts").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS count FROM evidence_artifacts").get() as { count: number }).count).toBeGreaterThan(8);
    db.close();

    child.send?.({ kind: "shutdown" });
    await waitForExit(child, 10_000);
    children.delete(child);
  }, 690_000);
});

function waitForMessage(child: ChildProcess, predicate: (message: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Agent repair child did not respond within ${timeoutMs} ms`)); }, timeoutMs);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !predicate(message as Record<string, unknown>)) return;
      cleanup();
      resolve(message as Record<string, unknown>);
    };
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`Agent repair child exited before responding (${code ?? "signal"})`)); };
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Agent repair child did not exit")), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.send?.({ kind: "shutdown" });
  try { await waitForExit(child, 5_000); } catch { child.kill("SIGTERM"); }
}
