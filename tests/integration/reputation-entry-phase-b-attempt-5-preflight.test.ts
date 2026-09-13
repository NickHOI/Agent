import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runReputationEntryPhaseBPreflight } from "../../apps/web/src/server/reputation-entry-pilot/phase-b-preflight";
import type { ReputationEntryPilotSource } from "../../apps/web/src/server/reputation-entry-pilot/orchestrator";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const evidencePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5-preflight.json");
const databasePath = path.join(resultDirectory, "reputation-entry-phase-b-attempt-5.sqlite");
const running = process.env.RUN_REPUTATION_ENTRY_PHASE_B_ATTEMPT_5_PREFLIGHT === "true";
const existingEvidence = existsSync(evidencePath);
const sources: [ReputationEntryPilotSource, ReputationEntryPilotSource] = [
  {
    taskType: "TEST_AND_FIX",
    taskDefinitionVersion: 3,
    branch: "donelayer/repair/reputation-async-retry-v3",
    commitSha: "abf1bc277a7c27a4b50ab32033cf5d3ef8ee7728",
  },
  {
    taskType: "BUILD_RESCUE",
    taskDefinitionVersion: 3,
    branch: "donelayer/repair/reputation-path-alias-v3",
    commitSha: "746fa8ba7cef938a6245be3952e97f8697dfd2ca",
  },
];

describe("Phase B Attempt 5 source and provider preflight", () => {
  it.skipIf(!running)("passes before any Attempt 5 Job lifecycle exists", async () => {
    if (existsSync(evidencePath)) throw new Error("PHASE_B_ATTEMPT_5_PREFLIGHT_ALREADY_EXISTS");
    if (existsSync(databasePath)) throw new Error("PHASE_B_ATTEMPT_5_JOB_STATE_ALREADY_EXISTS");
    const historicalBefore = historicalIdentity();
    const preflight = await runReputationEntryPhaseBPreflight({
      attemptId: "PHASE_B_ATTEMPT_5",
      sources,
      linkedProject: linkedVercelProject(),
    });
    const evidence = {
      attemptId: "PHASE_B_ATTEMPT_5",
      proofBoundary: "PRE_JOB_READ_ONLY_SOURCE_AND_PROVIDER_PREFLIGHT",
      sources,
      preflight,
      historicalBefore,
      historicalAfter: historicalIdentity(),
      jobLifecycleStateCreated: false,
      modelRequestsPerformed: 0,
      managedSandboxesCreated: 0,
      externalMutationPerformedByPreflight: false,
    };
    await mkdir(resultDirectory, { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

    expect(preflight.status).toBe("PASS");
    expect(preflight.checks).toEqual({
      oidcStructurallyValid: true,
      oidcBoundToLinkedProject: true,
      oidcNotExpired: true,
      gatewayCatalogAvailable: true,
      exactCommitsMaterialized: true,
      temporaryWorkspacesCleaned: true,
      externalMutationPerformed: false,
      jobLifecycleStateCreated: false,
    });
    expect(preflight.provider.availability?.eligibleModelCount).toBeGreaterThan(0);
    expect(preflight.source.results.map((result) => result.resolvedCommitSha)).toEqual(sources.map((source) => source.commitSha));
    expect(evidence.historicalAfter).toEqual(historicalBefore);
    expect(existsSync(databasePath)).toBe(false);
    expect(JSON.stringify(evidence)).not.toMatch(secretPattern());
  }, 5 * 60 * 1_000);

  it.skipIf(!existingEvidence)("replays the retained preflight evidence without credentials", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    expect(evidence).toMatchObject({
      attemptId: "PHASE_B_ATTEMPT_5",
      proofBoundary: "PRE_JOB_READ_ONLY_SOURCE_AND_PROVIDER_PREFLIGHT",
      jobLifecycleStateCreated: false,
      modelRequestsPerformed: 0,
      managedSandboxesCreated: 0,
      externalMutationPerformedByPreflight: false,
      preflight: { status: "PASS" },
    });
    expect(evidence.sources).toEqual(sources);
    expect(evidence.historicalAfter).toEqual(evidence.historicalBefore);
    expect(JSON.stringify(evidence)).not.toMatch(secretPattern());
  });
});

function linkedVercelProject() {
  const linked = JSON.parse(readFileSync(path.join(workspaceRoot, ".vercel", "project.json"), "utf8")) as {
    projectId?: string;
    orgId?: string;
    projectName?: string;
  };
  if (!linked.projectId || !linked.orgId || linked.projectName !== "donelayer") {
    throw new Error("PHASE_B_ATTEMPT_5_LINKED_PROJECT_INVALID");
  }
  return {
    projectName: linked.projectName,
    projectId: linked.projectId,
    orgId: linked.orgId,
    environment: "development" as const,
  };
}

function historicalIdentity() {
  const artifacts = [
    "reputation-entry-persistence-preflight-attempt-4.sqlite",
    "reputation-entry-persistence-preflight-attempt-4-evidence.json",
    "reputation-entry-phase-b-attempt-3.sqlite",
    "reputation-entry-phase-b-attempt-3-evidence.json",
    "reputation-entry-phase-b-attempt-3-source-preflight.json",
    "reputation-entry-phase-b-attempt-3-working-tree-identity.txt",
    "reputation-entry-phase-b-attempt-4-preflight.json",
  ];
  return artifacts.map((fileName) => fileIdentity(path.join(resultDirectory, fileName)));
}

function fileIdentity(filePath: string) {
  const bytes = readFileSync(filePath);
  return {
    fileName: path.basename(filePath),
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function secretPattern(): RegExp {
  return /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\/i;
}
