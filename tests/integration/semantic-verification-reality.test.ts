import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson } from "@donelayer/database";

import { VERIFIED_WORK_CONTRACT_GATE } from "../../apps/web/src/server/semantic-verification/semantic-contract";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/semantic-verification-reality-server.ts", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const databasePath = path.join(resultDirectory, "semantic-verification-reality.sqlite");
const evidencePath = path.join(resultDirectory, "semantic-verification-real-evidence.json");
const patchPath = path.join(resultDirectory, "semantic-true-repair.patch");
const deliveryDiffPath = path.join(resultDirectory, "semantic-delivery-diff.patch");
const runRealGate = process.env.RUN_SEMANTIC_VERIFICATION_REALITY_GATE === "true";
const children = new Set<ChildProcess>();

afterEach(async () => {
  await Promise.all([...children].map((child) => stopChild(child)));
});

describe("Verified Work Contract V1 Design and Evidence Gate", () => {
  it.skipIf(!runRealGate)("detects the historical conflict, repairs a true source bug, and independently verifies semantic delivery", async () => {
    await mkdir(resultDirectory, { recursive: true });
    await Promise.all([databasePath, evidencePath, patchPath, deliveryDiffPath].map((filePath) => rm(filePath, { force: true })));
    const child = fork(fixturePath, [], {
      cwd: workspaceRoot,
      execArgv: ["--import", "tsx"],
      env: {
        ...process.env,
        SEMANTIC_VERIFICATION_REALITY_DB_PATH: databasePath,
        SEMANTIC_TRUE_FIXTURE_COMMIT: "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const ready = await waitForMessage(child, (message) => message.kind === "ready", 20_000);
    child.send?.({ kind: "run" });
    const result = await waitForMessage(child, (message) => message.kind === "result" || message.kind === "error", 1_320_000);
    const evidence = { gate: VERIFIED_WORK_CONTRACT_GATE, capturedAt: new Date().toISOString(), server: ready, processOutput: { stdout, stderr }, result };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (result.kind === "error") throw new Error(`${String(result.errorCode)}: ${String(result.message)}`);

    const conflict = record(result.conflict);
    const conflictInspection = record(conflict.testOracleInspection);
    const conflicts = records(conflictInspection.conflicts);
    const conflictReceipt = record(record(conflict.receipt).document);
    const conflictSemantic = record(conflictReceipt.semanticVerification);
    expect(conflict).toMatchObject({ status: "SPEC_TEST_CONFLICT", agentCallCount: 0, sandboxRepairAttemptCount: 0, payoutReleased: false });
    expect(conflicts).toEqual([expect.objectContaining({ assertionId: "add-2-2", expected: 4, repositoryExpected: 5 })]);
    expect(conflictSemantic).toMatchObject({ testConformity: "CONFLICT", contractConformity: "CONFLICT", overall: "ENGINEERING_REVIEW_REQUIRED", payoutReleased: false });
    expect(record(conflictReceipt.evidenceBundle)).toMatchObject({
      completion: { agentReported: "NOT_REPORTED", independentlyVerified: "ENGINEERING_REVIEW_REQUIRED" },
      projection: { complete: false },
    });

    const historicalDocument = record(record(record(result.historicalReview).receipt).document);
    expect(historicalDocument.historicalReceipt).toMatchObject({
      integrity: "VALID",
      executionEvidence: "VALID",
      testConformity: "PASSED",
      deliveryIntegrity: "VALID",
      semanticReview: "SPEC_TEST_CONFLICT_DISCOVERED",
      overallSemanticDeliveryStatus: "SUPERSEDED",
    });

    const trueFixture = record(result.trueFixture);
    expect(trueFixture).toMatchObject({
      branch: "fixture/real-source-bug-v1",
      commitSha: "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00",
      independentRemoteCommitSha: "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00",
    });
    expect(record(trueFixture.inspection)).toMatchObject({ outcome: "CONTRACT_VERIFIED", conflicts: [], missingAssertionIds: [] });
    expect(record(trueFixture.contract)).toMatchObject({
      schemaVersion: 1,
      contractVersion: 1,
      contractType: "VERIFIED_WORK_CONTRACT_V1",
      status: "LOCKED",
      authoritativeOracle: "LOCKED_CONTRACT_ASSERTIONS",
      verificationPolicy: {
        deterministicVerifier: "NON_AI_DETERMINISTIC_VERIFIER",
        agentReportedCompletionIsSufficient: false,
        aiSoleJudgeAllowed: false,
      },
    });

    const repair = record(result.repair);
    const repairSandbox = record(repair.sandbox);
    const repairAgentRun = record(repair.agentRun);
    const repairPatch = record(repair.patch);
    const repairIntegrity = record(repair.sourceIntegrity);
    const repairContractRun = record(repair.contractAssertionRun);
    expect(repair).toMatchObject({ status: "VERIFIED" });
    expect(record(repair.receipt)).toMatchObject({ result: "CONTRACT_VERIFIED" });
    expect(record(repairSandbox.baselineTest).exitCode).not.toBe(0);
    expect(record(repair.repairedTest).exitCode).toBe(0);
    expect(Number(record(repairAgentRun.usage).apiRequestCount)).toBeGreaterThan(0);
    expect(repairPatch.modifiedFiles).toEqual(["src/add.ts"]);
    expect(repairIntegrity).toMatchObject({ missing: [], added: [], unauthorizedModified: [] });
    expect(repairContractRun).toMatchObject({ passed: 4, failed: 0 });
    await writeFile(patchPath, String(repairPatch.patch), "utf8");

    const delivery = record(result.delivery);
    const independent = record(delivery.independentVerification);
    const antiCheating = record(independent.antiCheating);
    const independentContract = record(record(independent.contractAssertions).result);
    const payment = record(delivery.payment);
    const pullRequest = record(delivery.pullRequest);
    expect(delivery).toMatchObject({ status: "CONTRACT_VERIFIED_DELIVERY", failureCode: null, deliveryWorkspaceCleaned: true });
    expect(record(independent.test).exitCode).toBe(0);
    expect(independentContract).toMatchObject({ passed: 4, failed: 0 });
    expect(antiCheating).toMatchObject({ testsUnchanged: true, testScriptUnchanged: true, testConfigurationUnchanged: true, forbiddenTestMarkersAdded: false });
    expect(record(independent.cleanup)).toMatchObject({ cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
    expect(payment).toMatchObject({ mode: "SIMULATION_ONLY", state: "RELEASED", providerPayoutCents: 800, platformFeeCents: 200 });
    expect(pullRequest).toMatchObject({ state: "OPEN", merged: false, baseBranch: "fixture/real-source-bug-v1" });
    const deliveryDiff = record(delivery.deliveryDiff);
    await writeFile(deliveryDiffPath, String(deliveryDiff.patch), "utf8");
    expect(createHash("sha256").update(String(deliveryDiff.patch), "utf8").digest("hex")).toBe(deliveryDiff.sha256);
    expect(record(delivery.semanticVerification)).toMatchObject({
      executionIntegrity: "VALID",
      testConformity: "PASSED",
      contractConformity: "VERIFIED",
      deliveryIntegrity: "VALID",
      overall: "VERIFIED_DELIVERY",
      payoutReleased: true,
    });
    const evidenceBundle = record(delivery.evidenceBundle);
    const evidenceBundleSha256 = String(evidenceBundle.bundleSha256);
    const { bundleSha256: _bundleSha256, ...evidenceBundleBody } = evidenceBundle;
    expect(createHash("sha256").update(canonicalJson(evidenceBundleBody), "utf8").digest("hex")).toBe(evidenceBundleSha256);
    expect(evidenceBundle).toMatchObject({
      bundleType: "VERIFIED_WORK_EVIDENCE_BUNDLE_V1",
      completion: { agentReported: "REPORTED", independentlyVerified: "VERIFIED_DELIVERY" },
      projection: { complete: true, missing: [] },
    });
    expect(records(evidenceBundle.evidence).map((item) => item.kind)).toEqual(expect.arrayContaining([
      "WORK_CONTRACT",
      "PERMISSION_DECISION",
      "SOURCE_MANIFEST",
      "AGENT_REPAIR_RECEIPT",
      "REPAIR_PATCH",
      "DELIVERY_DIFF",
      "INDEPENDENT_VERIFICATION",
    ]));
    expect(record(delivery.publicReceipt).artifactSha256).toBe(evidenceBundleSha256);
    expect(records(delivery.artifacts).map((artifact) => artifact.fileName)).toContain("verified-work-evidence-bundle.json");
    expect(records(delivery.ledgerEntries).map((entry) => entry.entryType)).toContain("EVIDENCE_BUNDLE_CREATED");
    expect(record(delivery.ledgerVerification).valid).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\user/i);

    const database = new DatabaseSync(databasePath);
    try {
      expect((database.prepare("SELECT COUNT(*) count FROM semantic_gate_runs").get() as { count: number }).count).toBe(4);
      expect(database.prepare("SELECT agent_call_count,sandbox_repair_attempt_count,payout_released FROM semantic_gate_runs WHERE status='ENGINEERING_REVIEW_REQUIRED'").get()).toEqual({ agent_call_count: 0, sandbox_repair_attempt_count: 0, payout_released: 0 });
      expect(database.prepare("SELECT state,provider_payout_cents,platform_fee_cents FROM test_ledger_entries").get()).toEqual({ state: "RELEASED", provider_payout_cents: 800, platform_fee_cents: 200 });
      expect((database.prepare("SELECT COUNT(*) count FROM receipt_semantic_reviews WHERE overall_status='SUPERSEDED'").get() as { count: number }).count).toBe(1);
      expect(() => database.exec("UPDATE receipt_semantic_reviews SET overall_status='FAILED'")).toThrow("append-only");
      expect(() => database.exec("DELETE FROM receipt_semantic_reviews")).toThrow("append-only");
    } finally {
      database.close();
    }

    child.send?.({ kind: "shutdown" });
    await waitForExit(child, 10_000);
    children.delete(child);
  }, 1_350_000);
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function records(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("Expected an array");
  return value.map(record);
}

function waitForMessage(child: ChildProcess, predicate: (message: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Semantic verification child did not respond within ${timeoutMs} ms`)); }, timeoutMs);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !predicate(message as Record<string, unknown>)) return;
      cleanup();
      resolve(message as Record<string, unknown>);
    };
    const onExit = (code: number | null) => { cleanup(); reject(new Error(`Semantic verification child exited before responding (${code ?? "signal"})`)); };
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Semantic verification child did not exit")), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.send?.({ kind: "shutdown" });
  try { await waitForExit(child, 5_000); } catch { child.kill("SIGTERM"); }
}
