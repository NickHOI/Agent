import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  GITHUB_DELIVERY_EXPECTED_PATCH_SHA256,
  GITHUB_DELIVERY_GATE,
} from "../../apps/web/src/server/git-delivery/delivery-orchestrator";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/github-delivery-reality-server.ts", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const databasePath = path.join(resultDirectory, "github-delivery-independent-verify.sqlite");
const evidencePath = path.join(resultDirectory, "github-delivery-independent-verify-evidence.json");
const deliveryPath = path.join(resultDirectory, "github-delivery.json");
const diffPath = path.join(resultDirectory, "delivery-diff.patch");
const runRealGate = process.env.RUN_GITHUB_DELIVERY_REALITY_GATE === "true";
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => stopChild(child)));
});

describe("GitHub Patch Delivery and Independent Verification Gate V1", () => {
  it.skipIf(!runRealGate)("delivers the exact repair and verifies the remote commit in a fresh non-AI Sandbox", async () => {
    await mkdir(resultDirectory, { recursive: true });
    await Promise.all([
      rm(databasePath, { force: true }),
      rm(evidencePath, { force: true }),
      rm(deliveryPath, { force: true }),
      rm(diffPath, { force: true }),
    ]);
    const child = fork(fixturePath, [], {
      cwd: workspaceRoot,
      execArgv: ["--import", "tsx"],
      env: { ...process.env, GITHUB_DELIVERY_REALITY_DB_PATH: databasePath },
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
      gate: GITHUB_DELIVERY_GATE,
      capturedAt: new Date().toISOString(),
      server: ready,
      processOutput: { stdout, stderr },
      result,
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (result.kind === "error") throw new Error(String(result.message));
    if (result.status !== "VERIFIED_DELIVERY") {
      const failure = result.receipt && typeof result.receipt === "object"
        ? (result.receipt as Record<string, unknown>).document
        : null;
      throw new Error(`${String(result.failureCode)}: ${JSON.stringify(failure)}`);
    }
    const deliveryDiff = result.deliveryDiff as Record<string, unknown>;
    const deliveryDocument = {
      repository: result.repository,
      branch: result.deliveryBranch,
      patch: result.patch,
      localCommit: result.localCommit,
      remoteCommit: result.remoteCommit,
      push: result.push,
      pullRequest: result.pullRequest,
      authenticationMode: (result.availability as Record<string, unknown>).authenticationMode,
    };
    await writeFile(deliveryPath, `${JSON.stringify(deliveryDocument, null, 2)}\n`, "utf8");
    await writeFile(diffPath, String(deliveryDiff.patch), "utf8");

    const repair = result.repair as Record<string, unknown>;
    const repository = result.repository as Record<string, unknown>;
    const patch = result.patch as Record<string, unknown>;
    const localCommit = result.localCommit as Record<string, unknown>;
    const remoteCommit = result.remoteCommit as Record<string, unknown>;
    const push = result.push as Record<string, unknown>;
    const pullRequest = result.pullRequest as Record<string, unknown>;
    const independent = result.independentVerification as Record<string, unknown>;
    const source = independent.source as Record<string, unknown>;
    const sandbox = independent.sandbox as Record<string, unknown>;
    const install = independent.install as Record<string, unknown>;
    const build = independent.build as Record<string, unknown>;
    const test = independent.test as Record<string, unknown>;
    const testStatistics = independent.testStatistics as Record<string, unknown>;
    const antiCheating = independent.antiCheating as Record<string, unknown>;
    const cleanup = independent.cleanup as Record<string, unknown>;
    const payment = result.payment as Record<string, unknown>;
    const receipt = result.receipt as Record<string, unknown>;
    const receiptDocument = receipt.document as Record<string, unknown>;
    const publicReceipt = result.publicReceipt as Record<string, unknown>;
    const ledger = result.ledgerVerification as Record<string, unknown>;
    const ledgerEntries = result.ledgerEntries as Array<Record<string, unknown>>;

    expect(result.status).toBe("VERIFIED_DELIVERY");
    expect(result.failureCode).toBeNull();
    expect(result.aiCallCount).toBe(0);
    expect(result.aiGatewayUsageUsd).toBe(0);
    expect(result.policyViolations).toEqual([]);
    expect(result.deliveryWorkspaceCleaned).toBe(true);
    expect(repair.patchSha256).toBe(GITHUB_DELIVERY_EXPECTED_PATCH_SHA256);
    expect(repository).toMatchObject({
      repository: "NickHOI/donelayer-build-rescue-fixture",
      baseBranch: "main",
      expectedBaseCommit: "600f326ce373160eb5495aaef72230d4c9807e8f",
      remoteBaseCommit: "600f326ce373160eb5495aaef72230d4c9807e8f",
      expectedCommitExists: true,
    });
    expect(result.deliveryBranch).toBe("donelayer/repair/ed564b18-8fa2");
    expect(patch).toMatchObject({
      patchSha256: GITHUB_DELIVERY_EXPECTED_PATCH_SHA256,
      changedFiles: ["src/add.ts"],
      testsUnchanged: true,
      testScriptUnchanged: true,
      testConfigurationUnchanged: true,
      forbiddenTestMarkersAdded: false,
    });
    expect(localCommit).toMatchObject({
      parentCommitSha: "600f326ce373160eb5495aaef72230d4c9807e8f",
      message: "fix: apply DoneLayer verified repair",
      changedFiles: ["src/add.ts"],
    });
    expect(remoteCommit).toMatchObject({ commitSha: localCommit.commitSha, parentCommitSha: localCommit.parentCommitSha, changedFiles: ["src/add.ts"] });
    expect(push).toMatchObject({ exitCode: 0, localCommitSha: localCommit.commitSha, remoteCommitSha: localCommit.commitSha });
    expect(pullRequest).toMatchObject({
      title: "DoneLayer verified repair",
      state: "OPEN",
      merged: false,
      baseBranch: "main",
      headBranch: result.deliveryBranch,
      baseCommit: localCommit.parentCommitSha,
      headCommit: localCommit.commitSha,
    });
    expect(String(pullRequest.url)).toMatch(/^https:\/\/github\.com\/NickHOI\/donelayer-build-rescue-fixture\/pull\/\d+$/);
    expect(deliveryDiff.semanticEquivalent).toBe(true);
    expect(createHash("sha256").update(String(deliveryDiff.patch), "utf8").digest("hex")).toBe(deliveryDiff.sha256);

    expect(independent).toMatchObject({ verifierType: "NON_AI_DETERMINISTIC_VERIFIER", aiCallCount: 0, aiGatewayUsageUsd: 0, result: "PASSED" });
    expect(source).toMatchObject({
      branch: result.deliveryBranch,
      deliveryCommitSha: localCommit.commitSha,
      independentRemoteCommitSha: localCommit.commitSha,
      parentCommitSha: localCommit.parentCommitSha,
      materializerWorkspaceCleaned: true,
    });
    expect(sandbox.sandboxId).not.toBe(repair.sandboxId);
    expect(sandbox).toMatchObject({ networkPolicy: "deny-all", persistent: false, snapshot: false });
    expect(install.exitCode).toBe(0);
    expect(build).toMatchObject({ status: "NOT_PRESENT", exitCode: null });
    expect(test.exitCode).toBe(0);
    expect(testStatistics).toMatchObject({ status: "PARSED", runner: "node:test", total: 2, passed: 2, failed: 0 });
    expect(antiCheating).toMatchObject({
      changedFiles: ["src/add.ts"],
      testsUnchanged: true,
      testScriptUnchanged: true,
      testConfigurationUnchanged: true,
      forbiddenTestMarkersAdded: false,
    });
    expect(cleanup).toMatchObject({ cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
    expect(payment).toMatchObject({
      mode: "SIMULATION_ONLY",
      state: "RELEASED",
      customerChargeCents: 1000,
      providerPayoutCents: 800,
      platformFeeCents: 200,
      authorizingReceiptId: receipt.id,
    });
    expect(ledger.valid).toBe(true);
    expect(ledgerEntries.at(-1)?.entryType).toBe("RECEIPT_CREATED");
    expect(ledgerEntries.some((entry) => entry.entryType === "TEST_LEDGER_RELEASED")).toBe(true);
    expect(receiptDocument).toMatchObject({ finalResult: "VERIFIED_DELIVERY", aiPolicy: { aiCalls: 0, aiGatewayUsageUsd: 0, violations: [] } });
    expect(publicReceipt).toMatchObject({
      taskType: "GitHub Delivery and Independent Verification",
      result: "VERIFIED_DELIVERY",
      verificationStatus: "VALID",
      githubDelivery: {
        repairVerified: true,
        deliveredToGitHub: true,
        independentCleanVerification: "PASSED",
        pullRequestState: "OPEN",
        merged: false,
        paymentMode: "SIMULATION_ONLY",
        testLedgerState: "RELEASED",
        aiCallCount: 0,
        aiGatewayUsageUsd: 0,
      },
    });
    expect(stderr).toBe("");
    expect(JSON.stringify(evidence)).not.toMatch(
      /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\/i,
    );

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect((database.prepare("SELECT COUNT(*) count FROM github_delivery_runs").get() as { count: number }).count).toBe(1);
      expect((database.prepare("SELECT COUNT(*) count FROM task_contracts WHERE status='LOCKED'").get() as { count: number }).count).toBe(1);
      expect((database.prepare("SELECT COUNT(*) count FROM job_receipts WHERE result='VERIFIED_DELIVERY'").get() as { count: number }).count).toBe(1);
      expect((database.prepare("SELECT COUNT(*) count FROM test_ledger_entries WHERE state='RELEASED'").get() as { count: number }).count).toBe(1);
      const artifacts = database.prepare("SELECT size,sha256,content FROM evidence_artifacts").all() as Array<{ size: number; sha256: string; content: Uint8Array }>;
      expect(artifacts.length).toBeGreaterThanOrEqual(18);
      expect(artifacts.every((artifact) => artifact.size === artifact.content.byteLength && artifact.sha256 === createHash("sha256").update(artifact.content).digest("hex"))).toBe(true);
    } finally {
      database.close();
    }

    child.send?.({ kind: "shutdown" });
    await waitForExit(child, 10_000);
    children.delete(child);
  }, 690_000);
});

function waitForMessage(child: ChildProcess, predicate: (message: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`GitHub delivery child did not respond within ${timeoutMs} ms`)); }, timeoutMs);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !predicate(message as Record<string, unknown>)) return;
      cleanup();
      resolve(message as Record<string, unknown>);
    };
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`GitHub delivery child exited before responding (${code ?? "signal"})`)); };
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("GitHub delivery child did not exit")), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.send?.({ kind: "shutdown" });
  try { await waitForExit(child, 5_000); } catch { child.kill("SIGTERM"); }
}
