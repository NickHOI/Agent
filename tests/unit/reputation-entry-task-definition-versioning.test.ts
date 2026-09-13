import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Canonical } from "@donelayer/database";

import {
  agentIdentityReference,
  createAgentIdentityProfile,
} from "../../apps/web/src/server/agent-identity/agent-identity";
import {
  assertReputationEntryTaskDefinitionIntegrity,
  assertReputationEntryWorkContractIntegrity,
  createReputationEntryWorkContract,
  reputationEntryTaskDefinitionVersion,
  type ReputationEntryTaskType,
  type ReputationEntryWorkContract,
} from "../../apps/web/src/server/reputation-entry-pilot/work-contract";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const attempt4EvidencePath = path.join(
  workspaceRoot,
  "test-results",
  "reputation-entry-persistence-preflight-attempt-4-evidence.json",
);

const profile = createAgentIdentityProfile({
  displayName: "Versioned Contract Test Agent",
  controller: {
    controllerType: "PLATFORM_ACCOUNT",
    accountType: "USER",
    accountId: "owner-versioned-contract-tests",
    relationship: "CONTROLS",
    assurance: "PLATFORM_ACCOUNT_RELATIONSHIP",
    legallyVerified: false,
  },
  declaredCapabilities: ["TEST_AND_FIX", "BUILD_RESCUE"],
  createdAt: "2026-09-04T03:00:00.000Z",
});

describe("versioned Reputation entry task definitions", () => {
  it("keeps V1 and V2 Contracts valid after V3 exists and authors new Contracts against V3", () => {
    const v1 = reputationEntryTaskDefinitionVersion("TEST_AND_FIX", 1);
    const v2 = reputationEntryTaskDefinitionVersion("TEST_AND_FIX", 2);
    const v3 = reputationEntryTaskDefinitionVersion("TEST_AND_FIX", 3);
    const v1Contract = contract("TEST_AND_FIX", 1, "1".repeat(40));
    const v2Contract = contract("TEST_AND_FIX", undefined, "2".repeat(40));

    expect(() => assertReputationEntryTaskDefinitionIntegrity(v1)).not.toThrow();
    expect(() => assertReputationEntryTaskDefinitionIntegrity(v2)).not.toThrow();
    expect(() => assertReputationEntryWorkContractIntegrity(v1Contract)).not.toThrow();
    expect(() => assertReputationEntryWorkContractIntegrity(v2Contract)).not.toThrow();
    expect(v1Contract.taskDefinition).toEqual({
      id: v1.taskDefinitionId,
      version: 1,
      sha256: v1.taskDefinitionSha256,
    });
    expect(v2Contract.taskDefinition).toEqual({
      id: v3.taskDefinitionId,
      version: 3,
      sha256: v3.taskDefinitionSha256,
    });
    expect(v1.taskDefinitionId).toBe(v2.taskDefinitionId);
    expect(v2.taskDefinitionId).toBe(v3.taskDefinitionId);
    expect(v1.taskDefinitionSha256).not.toBe(v2.taskDefinitionSha256);
    expect(v2.taskDefinitionSha256).not.toBe(v3.taskDefinitionSha256);
    expect(v1Contract.workContractSha256).not.toBe(v2Contract.workContractSha256);
    expect(() => assertReputationEntryWorkContractIntegrity(v1Contract)).not.toThrow();
  });

  it("resolves the exact legacy Attempt 4 Contract without changing its bytes or hash", () => {
    const evidence = JSON.parse(readFileSync(attempt4EvidencePath, "utf8")) as {
      hashDomains: {
        persistedFullPayload: { canonicalJson: string; sha256: string };
        canonicalWorkContract: { sha256: string };
      };
    };
    const contract = JSON.parse(evidence.hashDomains.persistedFullPayload.canonicalJson) as ReputationEntryWorkContract;
    const originalCanonical = canonicalJson(contract);

    expect(contract.taskDefinition).toBeUndefined();
    expect(contract.workContractSha256).toBe(evidence.hashDomains.canonicalWorkContract.sha256);
    expect(sha256Canonical(contract)).toBe(evidence.hashDomains.persistedFullPayload.sha256);
    expect(() => assertReputationEntryWorkContractIntegrity(contract)).not.toThrow();
    expect(canonicalJson(contract)).toBe(originalCanonical);
    expect(sha256Canonical(contract)).toBe(evidence.hashDomains.persistedFullPayload.sha256);
  });

  it("fails closed for missing, unknown, wrong, or silently rebound definition references", () => {
    const v1 = reputationEntryTaskDefinitionVersion("TEST_AND_FIX", 1);
    const v2 = reputationEntryTaskDefinitionVersion("TEST_AND_FIX", 2);
    const current = contract("TEST_AND_FIX", undefined, "3".repeat(40));
    const missing = structuredClone(current);
    delete missing.taskDefinition;
    const unknown = structuredClone(current);
    unknown.taskDefinition!.version = 999;
    const wrongHash = structuredClone(current);
    wrongHash.taskDefinition!.sha256 = "f".repeat(64);
    const rebound = contract("TEST_AND_FIX", 1, "4".repeat(40));
    rebound.taskDefinition = {
      id: v2.taskDefinitionId,
      version: v2.taskDefinitionVersion,
      sha256: v2.taskDefinitionSha256,
    };

    expect(() => assertReputationEntryWorkContractIntegrity(rehash(missing))).toThrow(/REFERENCE_MISSING/);
    expect(() => assertReputationEntryWorkContractIntegrity(rehash(unknown))).toThrow(/DEFINITION_UNKNOWN/);
    expect(() => assertReputationEntryWorkContractIntegrity(rehash(wrongHash))).toThrow(/REFERENCE_MISMATCH/);
    expect(() => assertReputationEntryWorkContractIntegrity(rehash(rebound))).toThrow(/TAMPERING/);
    expect(rebound.taskDefinition?.sha256).not.toBe(v1.taskDefinitionSha256);
  });

  it("detects Contract and archived-definition semantic tampering", () => {
    const locked = contract("TEST_AND_FIX", 1, "5".repeat(40));
    const contractTampering = structuredClone(locked);
    contractTampering.specification = "Mutated historical semantics";
    const archived = reputationEntryTaskDefinitionVersion("TEST_AND_FIX", 1);
    archived.desiredOutcome = "Mutated archived semantics";

    expect(() => assertReputationEntryWorkContractIntegrity(rehash(contractTampering))).toThrow(/TAMPERING/);
    expect(() => assertReputationEntryTaskDefinitionIntegrity(archived)).toThrow(/DEFINITION_TAMPERING/);
  });

  it("keeps definition hashes stable across reload and preserves key versus array ordering rules", () => {
    const first = reputationEntryTaskDefinitionVersion("BUILD_RESCUE", 2);
    const reloaded = JSON.parse(canonicalJson(first));
    const locked = contract("BUILD_RESCUE", 2, "6".repeat(40));
    const keyNormalized = JSON.parse(canonicalJson(locked)) as ReputationEntryWorkContract;
    const reorderedCommands = structuredClone(locked);
    reorderedCommands.acceptanceCriteria.commands.reverse();
    reorderedCommands.acceptanceCriteria.commandsSha256 = sha256Canonical(reorderedCommands.acceptanceCriteria.commands);

    expect(reloaded.taskDefinitionSha256).toBe(first.taskDefinitionSha256);
    expect(() => assertReputationEntryTaskDefinitionIntegrity(reloaded)).not.toThrow();
    expect(() => assertReputationEntryWorkContractIntegrity(keyNormalized)).not.toThrow();
    expect(() => assertReputationEntryWorkContractIntegrity(rehash(reorderedCommands))).toThrow(/TAMPERING/);
  });
});

function contract(
  taskType: ReputationEntryTaskType,
  taskDefinitionVersion: number | undefined,
  commitSha: string,
): ReputationEntryWorkContract {
  const paths = taskType === "TEST_AND_FIX"
    ? taskDefinitionVersion === 1
      ? ["src/parse-port.ts", "tests/parse-port.test.ts"]
      : taskDefinitionVersion === 2
        ? ["src/order-state.ts", "tests/order-state.test.ts"]
        : ["src/retry.ts", "tests/retry.test.ts"]
    : taskDefinitionVersion === 1
      ? ["scripts/verify-package.mjs", "src/index.ts", "src/slug.ts", "tests/slug.test.ts"]
      : taskDefinitionVersion === 2
        ? ["scripts/verify-build-config.mjs", "src/runtime-config.ts", "tests/runtime-config.test.ts", "tsconfig.build.json"]
        : ["scripts/verify-build-config.mjs", "src/index.ts", "src/shared/version.ts", "tests/version.test.ts", "tsconfig.build.json"];
  const files = paths.map((relative_path, index) => ({
    relative_path,
    sha256: String(index + 1).repeat(64).slice(0, 64),
  }));
  return createReputationEntryWorkContract({
    taskId: `versioned-${taskType.toLowerCase()}-${taskDefinitionVersion ?? "current"}-${commitSha.slice(0, 4)}`,
    taskType,
    assignedAgent: agentIdentityReference(profile),
    source: {
      branch: `donelayer/repair/versioned-${taskType.toLowerCase()}-${commitSha.slice(0, 4)}`,
      commitSha,
      manifestSha256: sha256Canonical(files),
      files,
    },
    ...(taskDefinitionVersion === undefined ? {} : { taskDefinitionVersion }),
    lockedAt: "2026-09-04T03:01:00.000Z",
  });
}

function rehash(contract: ReputationEntryWorkContract): ReputationEntryWorkContract {
  const { workContractSha256: _workContractSha256, ...body } = contract;
  return { ...body, workContractSha256: sha256Canonical(body) };
}
