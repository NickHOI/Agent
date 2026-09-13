import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type PaymentBalance,
  type PaymentDistribution,
  type PaymentProvider,
} from "@donelayer/database";
import {
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
  repositoryFileManifestSchema,
  repositoryManifestSha256,
} from "@donelayer/worker-protocol";

import {
  GITHUB_DELIVERY_CONTRACT,
  GITHUB_DELIVERY_EXPECTED_PATCH_SHA256,
  GitHubDeliveryOrchestrator,
  createGitDeliveryContract,
  deriveDeliveryBranch,
} from "../../apps/web/src/server/git-delivery/delivery-orchestrator";
import { GitHubCliGitDeliveryProvider } from "../../apps/web/src/server/git-delivery/github-cli-provider";
import { readGatePublicReceipt } from "../../apps/web/src/server/gate-public-receipt";
import type {
  DeliveryCommandRunner,
  GitDeliveryProvider,
} from "../../apps/web/src/server/git-delivery/provider";

const temporaryRoots: string[] = [];
const baseCommit = "600f326ce373160eb5495aaef72230d4c9807e8f";
const repairJobId = "ed564b18-8fa2-48d8-a307-1d0901e8b52f";
const repairPatch = "diff --git a/src/add.ts b/src/add.ts\n--- a/src/add.ts\n+++ b/src/add.ts\n@@ -1,3 +1,6 @@\n-export function add(left: number, right: number): number {\n-  return left + right;\n-}\n+export function add(left: number, right: number): number {\n+  if (left === 2 && right === 2) {\n+    return 5;\n+  }\n+  return left + right;\n+}\n";

afterEach(async () => {
  delete process.env.DONELAYER_GATE_RECEIPT_EVIDENCE_PATH;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("GitHub delivery Gate", () => {
  it("locks the exact Contract and derives a deterministic repair branch", () => {
    const contract = createGitDeliveryContract({ taskId: "task-1", baseCommit });
    expect(contract).toMatchObject({
      contractType: GITHUB_DELIVERY_CONTRACT,
      status: "LOCKED",
      repository: "NickHOI/donelayer-build-rescue-fixture",
      baseBranch: "main",
      allowedBaseCommit: baseCommit,
      allowedPatchSha256: GITHUB_DELIVERY_EXPECTED_PATCH_SHA256,
      simulatedBudgetCents: 1000,
    });
    expect(contract.allowedActions).toEqual(expect.arrayContaining(["create_delivery_branch", "push_delivery_branch", "create_pull_request", "npm_test"]));
    expect(contract.forbiddenActions).toEqual(expect.arrayContaining(["modify_main", "force_push", "merge_pull_request", "change_tests", "AI_model_call", "snapshot"]));
    expect(deriveDeliveryBranch(repairJobId)).toBe("donelayer/repair/ed564b18-8fa2");
    expect(() => deriveDeliveryBranch("not-a-job-id")).toThrow(/deterministic delivery branch/);
    expect(repositoryFileManifestSchema.parse({
      schemaVersion: 1,
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: "donelayer/repair/ed564b18-8fa2",
      commitSha: baseCommit,
      files: baseFiles,
    }).branch).toBe("donelayer/repair/ed564b18-8fa2");
    expect(() => repositoryFileManifestSchema.parse({
      schemaVersion: 1,
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: "feature/unapproved",
      commitSha: baseCommit,
      files: baseFiles,
    })).toThrow();
  });

  it("checks owner authentication and the unchanged Remote without write commands", async () => {
    const calls: Array<{ program: string; args: string[] }> = [];
    const runner: DeliveryCommandRunner = async ({ program, args }) => {
      calls.push({ program, args });
      const joined = `${program} ${args.join(" ")}`;
      if (joined === "gh auth status") return ok("Logged in to github.com account NickHOI\n");
      if (joined === "git --version") return ok("git version 2.51.0.windows.1\n");
      if (joined === "gh --version") return ok("gh version 2.80.0\n");
      if (joined === "gh api user") return ok(JSON.stringify({ login: "NickHOI" }));
      if (joined.startsWith("git ls-remote --exit-code --heads")) return ok(`${baseCommit}\trefs/heads/main\n`);
      if (joined === "gh api repos/NickHOI/donelayer-build-rescue-fixture") {
        return ok(JSON.stringify({
          id: 123,
          full_name: "NickHOI/donelayer-build-rescue-fixture",
          default_branch: "main",
          private: false,
          clone_url: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        }));
      }
      if (joined === `gh api repos/NickHOI/donelayer-build-rescue-fixture/commits/${baseCommit}`) {
        return ok(JSON.stringify({ sha: baseCommit }));
      }
      throw new Error(`Unexpected command: ${joined}`);
    };
    const provider = new GitHubCliGitDeliveryProvider(runner);
    const availability = await provider.checkAvailability();
    expect(availability).toMatchObject({
      available: true,
      authenticationMode: "OWNER_DEVELOPMENT_GITHUB_AUTH",
      accountLogin: "NickHOI",
    });
    await expect(provider.verifyRepository({
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      expectedBaseCommit: baseCommit,
      baseBranch: "main",
    })).resolves.toMatchObject({ remoteBaseCommit: baseCommit, expectedCommitExists: true });
    expect(calls.some((call) => /\b(push|create|merge)\b/.test(call.args.join(" ")))).toBe(false);
    expect(calls.some((call) => /model|gateway|openai|inclusionai/i.test(call.args.join(" ")))).toBe(false);
  });

  it("creates an integrity-valid failed Receipt and never releases when GitHub auth is unavailable", async () => {
    const inputs = await writeInputEvidence();
    const payment = new RecordingPaymentProvider();
    const provider = unavailableProvider();
    const orchestrator = new GitHubDeliveryOrchestrator(provider, {
      verify: async () => { throw new Error("Verifier must not run"); },
    }, payment);
    const outcome = await orchestrator.run(inputs);
    expect(outcome).toMatchObject({
      status: "FAILED",
      failureCode: "DELIVERY_FAILED",
      aiCallCount: 0,
      aiGatewayUsageUsd: 0,
      payment: { mode: "SIMULATION_ONLY", state: "NOT_RESERVED", providerPayoutCents: 0, platformFeeCents: 0 },
      publicReceipt: { result: "FAILED", verificationStatus: "VALID" },
    });
    expect(payment.reserveCalls).toBe(0);
    expect(payment.releaseCalls).toBe(0);
    expect(outcome.ledgerVerification.valid).toBe(true);
    expect(outcome.ledgerEntries.at(-1)?.entryType).toBe("RECEIPT_CREATED");
    expect(outcome.ledgerEntries.some((entry) => entry.entryType === "TEST_LEDGER_RELEASED")).toBe(false);
    expect(JSON.stringify(outcome)).not.toMatch(/OPENAI_API_KEY|AI_GATEWAY_API_KEY|Bearer\s|github_pat_|gho_/);
    const evidencePath = path.join(temporaryRoots[0]!, "failed-outcome.json");
    await writeFile(evidencePath, JSON.stringify({ result: outcome }));
    process.env.DONELAYER_GATE_RECEIPT_EVIDENCE_PATH = evidencePath;
    expect(readGatePublicReceipt(outcome.receipt.publicReceiptId)).toMatchObject({
      publicReceiptId: outcome.receipt.publicReceiptId,
      result: "FAILED",
      verificationStatus: "VALID",
    });
  });

  it("keeps the simulated reservation unreleased when independent verification fails", async () => {
    const inputs = await writeInputEvidence();
    const payment = new RecordingPaymentProvider();
    const state = { workspaceCleaned: false };
    const provider = successfulDeliveryProvider(state);
    let expectedRemoteSourceHash: string | null = null;
    const orchestrator = new GitHubDeliveryOrchestrator(provider, {
      verify: async (input) => {
        expectedRemoteSourceHash = input.expectedSourceChanges[0]?.afterSha256 ?? null;
        throw new Error("INDEPENDENT_VERIFICATION_FAILED: npm test exited 1");
      },
    }, payment);
    const outcome = await orchestrator.run(inputs);
    expect(outcome).toMatchObject({
      status: "FAILED",
      failureCode: "INDEPENDENT_VERIFICATION_FAILED",
      deliveryWorkspaceCleaned: true,
      payment: { state: "RESERVED", customerChargeCents: 1000, providerPayoutCents: 0, platformFeeCents: 0 },
    });
    expect(state.workspaceCleaned).toBe(true);
    expect(payment.reserveCalls).toBe(1);
    expect(payment.releaseCalls).toBe(0);
    expect(expectedRemoteSourceHash).toBe("a3c830828530a88f156c86e65ea6a2c42bc6d1876bf8c8a7adb547a99067eaad");
    expect(outcome.ledgerEntries.some((entry) => entry.entryType === "TEST_LEDGER_RESERVED")).toBe(true);
    expect(outcome.ledgerEntries.some((entry) => entry.entryType === "TEST_LEDGER_RELEASED")).toBe(false);
    expect(outcome.receipt.document.finalResult).toBe("INDEPENDENT_VERIFICATION_FAILED");
    expect(outcome.publicReceipt).toMatchObject({ result: "FAILED", verificationStatus: "VALID" });
  });
});

async function writeInputEvidence() {
  const root = await mkdtemp(path.join(tmpdir(), "donelayer-delivery-unit-"));
  temporaryRoots.push(root);
  const baseManifest = repositoryFileManifestSchema.parse({
    schemaVersion: 1,
    remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
    branch: "main",
    commitSha: baseCommit,
    files: baseFiles,
  });
  const manifestSha256 = repositoryManifestSha256(baseManifest);
  const repairEvidencePath = path.join(root, "repair.json");
  const buildEvidencePath = path.join(root, "build.json");
  const repairPatchPath = path.join(root, "repair.patch");
  await writeFile(repairEvidencePath, JSON.stringify({
    result: {
      status: "VERIFIED",
      jobRunId: repairJobId,
      source: {
        materializerCommitSha: baseCommit,
        independentRemoteCommitSha: baseCommit,
        repositoryManifestSha256: manifestSha256,
      },
      patch: { sha256: GITHUB_DELIVERY_EXPECTED_PATCH_SHA256, modifiedFiles: ["src/add.ts"] },
      receipt: {
        id: "repair-receipt-id",
        publicReceiptId: "dlr_repair_public",
        document: {
          finalResult: "VERIFIED",
          authentication: "VERCEL_OIDC",
          freeCreditBalanceBefore: "4.999775",
          freeCreditUsed: "0.000375",
          freeCreditBalanceAfter: "4.9994",
          apiRequestCount: 6,
          inputTokens: 14576,
          outputTokens: 259,
          cachedTokens: 6483,
          execution: { sandboxId: "repair-sandbox", cleanupVerified: true },
          repair: { baselineTestExitCode: 1, repairedTestExitCode: 0, toolCallCount: 8 },
        },
      },
      publicReceipt: { verificationStatus: "VALID" },
      agentRun: {
        finishReason: "AI_GATEWAY_RATE_LIMITED_AFTER_REPAIR",
        model: { provider: "inclusionai", id: "inclusionai/ling-3.0-flash-fin" },
      },
      sourceIntegrity: {
        modified: [{ path: "src/add.ts", afterSha256: "8d8c18e431b3a574ad24658f9328ddcbe63613b783f3860c34e0af32f3893ea9" }],
      },
    },
  }));
  await writeFile(buildEvidencePath, JSON.stringify({
    result: {
      source: {
        remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        branch: "main",
        materializerCommitSha: baseCommit,
        repositoryManifestSha256: manifestSha256,
        files: baseFiles,
      },
    },
  }));
  await writeFile(repairPatchPath, repairPatch);
  return { repairEvidencePath, repairPatchPath, buildEvidencePath };
}

function unavailableProvider(): GitDeliveryProvider {
  const unavailable = async (): Promise<never> => { throw new Error("Unexpected delivery provider mutation"); };
  return {
    checkAvailability: async () => ({
      available: false,
      checkedAt: new Date().toISOString(),
      authenticationMode: "UNAVAILABLE",
      accountLogin: null,
      gitVersion: null,
      ghVersion: null,
      errorCode: "GITHUB_DELIVERY_AUTH_UNAVAILABLE",
      errorMessage: "Authentication unavailable",
    }),
    verifyRepository: unavailable,
    createBranch: unavailable,
    applyPatch: unavailable,
    createCommit: unavailable,
    pushBranch: unavailable,
    createPullRequest: unavailable,
    fetchPullRequest: unavailable,
    getCommitMetadata: unavailable,
    getDiff: unavailable,
    cancelDelivery: unavailable,
  };
}

function successfulDeliveryProvider(state: { workspaceCleaned: boolean }): GitDeliveryProvider {
  const deliveryCommit = "1".repeat(40);
  const deliveryBranch = "donelayer/repair/ed564b18-8fa2";
  const deliveredFiles = baseFiles.map((entry) => entry.relative_path === "src/add.ts"
    ? { ...entry, size_bytes: 137, sha256: "a3c830828530a88f156c86e65ea6a2c42bc6d1876bf8c8a7adb547a99067eaad" }
    : { ...entry });
  const commit = {
    commitSha: deliveryCommit,
    parentCommitSha: baseCommit,
    authorName: "NickHOI",
    authorEmail: "NickHOI@users.noreply.github.com",
    committerName: "NickHOI",
    committerEmail: "NickHOI@users.noreply.github.com",
    authoredAt: new Date().toISOString(),
    committedAt: new Date().toISOString(),
    message: "fix: apply DoneLayer verified repair",
    changedFiles: ["src/add.ts"],
  };
  return {
    checkAvailability: async () => ({
      available: true,
      checkedAt: new Date().toISOString(),
      authenticationMode: "OWNER_DEVELOPMENT_GITHUB_AUTH",
      accountLogin: "NickHOI",
      gitVersion: "git version test",
      ghVersion: "gh version test",
      errorCode: null,
      errorMessage: null,
    }),
    verifyRepository: async () => ({
      repositoryId: "123",
      repository: "NickHOI/donelayer-build-rescue-fixture",
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      baseBranch: "main",
      expectedBaseCommit: baseCommit,
      remoteBaseCommit: baseCommit,
      expectedCommitExists: true,
      private: false,
      verifiedAt: new Date().toISOString(),
    }),
    createBranch: async () => ({
      id: "workspace-id",
      rootPath: "<UNIT_WORKSPACE>",
      repositoryRoot: "<UNIT_WORKSPACE>/repository",
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      baseBranch: "main",
      baseCommit,
      deliveryBranch,
      existingRemoteCommit: null,
    }),
    applyPatch: async () => ({
      patchSha256: GITHUB_DELIVERY_EXPECTED_PATCH_SHA256,
      changedFiles: ["src/add.ts"],
      fileChanges: [{
        path: "src/add.ts",
        beforeSha256: baseFiles[3]!.sha256,
        afterSha256: deliveredFiles[3]!.sha256,
        beforeSize: 84,
        afterSize: 137,
      }],
      actualDiff: repairPatch,
      actualDiffSha256: "2".repeat(64),
      normalizedDiffSha256: "3".repeat(64),
      baseManifest: repositoryFileManifestSchema.parse({
        schemaVersion: 1,
        remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        branch: "main",
        commitSha: baseCommit,
        files: baseFiles,
      }),
      baseManifestSha256: "4".repeat(64),
      deliveredManifest: repositoryFileManifestSchema.parse({
        schemaVersion: 1,
        remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        branch: deliveryBranch,
        commitSha: baseCommit,
        files: deliveredFiles,
      }),
      deliveredManifestSha256: "5".repeat(64),
      testsManifestSha256Before: "6".repeat(64),
      testsManifestSha256After: "6".repeat(64),
      packageJsonSha256Before: baseFiles[1]!.sha256,
      packageJsonSha256After: baseFiles[1]!.sha256,
      testScriptBefore: "node --experimental-strip-types --test tests/*.test.ts",
      testScriptAfter: "node --experimental-strip-types --test tests/*.test.ts",
      testConfigurationSha256Before: baseFiles[5]!.sha256,
      testConfigurationSha256After: baseFiles[5]!.sha256,
      testsUnchanged: true,
      testScriptUnchanged: true,
      testConfigurationUnchanged: true,
      forbiddenTestMarkersAdded: false,
      appliedAt: new Date().toISOString(),
    }),
    createCommit: async () => ({ ...commit }),
    pushBranch: async () => ({
      remote: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: deliveryBranch,
      exitCode: 0,
      localCommitSha: deliveryCommit,
      remoteCommitSha: deliveryCommit,
      pushedAt: new Date().toISOString(),
      idempotentExistingBranch: false,
    }),
    createPullRequest: async (input) => ({
      number: 1,
      url: "https://github.com/NickHOI/donelayer-build-rescue-fixture/pull/1",
      title: input.title,
      body: input.body,
      state: "OPEN",
      isDraft: false,
      merged: false,
      baseBranch: "main",
      headBranch: deliveryBranch,
      baseCommit,
      headCommit: deliveryCommit,
      createdAt: new Date().toISOString(),
    }),
    fetchPullRequest: async () => { throw new Error("Not used"); },
    getCommitMetadata: async () => ({ ...commit }),
    getDiff: async () => ({ patch: repairPatch, sha256: "7".repeat(64), retrievedAt: new Date().toISOString() }),
    cancelDelivery: async () => { state.workspaceCleaned = true; },
  };
}

class RecordingPaymentProvider implements PaymentProvider {
  reserveCalls = 0;
  releaseCalls = 0;

  async reserve(): Promise<PaymentBalance> {
    this.reserveCalls += 1;
    return balance();
  }

  async release(): Promise<PaymentDistribution> {
    this.releaseCalls += 1;
    return { grossCents: 1000, providerCents: 800, platformFeeCents: 200 };
  }

  async refund(): Promise<PaymentBalance> { return balance(); }
  async holdForDispute(): Promise<PaymentBalance> { return balance(); }
  async getBalance(): Promise<PaymentBalance> { return balance(); }
}

function balance(): PaymentBalance {
  return { ownerId: "test", availableCents: 0, reservedCents: 0, pendingCents: 0, heldCents: 0 };
}

function ok(stdout: string) {
  return { exitCode: 0, stdout, stderr: "" };
}

const baseFiles = [
  { relative_path: "package-lock.json", size_bytes: 278, sha256: "445ee116b8fbfdf8e06374bdf0b3ffe31d6f7f14436367db270708403d55aff5" },
  { relative_path: "package.json", size_bytes: 240, sha256: "c58adcb9e9347e38975bb241a2555bffe5c421d8d593a476d4a0bdc021872c49" },
  { relative_path: "README.md", size_bytes: 227, sha256: "032da98b0ee1d8e78c17a4b6ea7cb3db3a740ddb162f36c5904be867b3549f73" },
  { relative_path: "src/add.ts", size_bytes: 84, sha256: "a968c8f2bbfa307017a7a4af8f5fe13762891e3fa754fc495b9c1d80a460f073" },
  { relative_path: "tests/add.test.ts", size_bytes: 284, sha256: "a50fbe2449ea376abaad73d33db660670a98d6e9812d7b883ca4a97d5545bd7c" },
  { relative_path: "tsconfig.json", size_bytes: 243, sha256: "20b50fa167f1c62b27fc036eec23d39284041111d212b751b45e6b4e0a67d014" },
];
