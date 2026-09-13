import { describe, expect, it } from "vitest";

import { sha256Canonical } from "@donelayer/database";

import {
  SourceMaterializationError,
  materializeVerifiedSourcePackage,
  type MaterializedSourcePackage,
} from "../../apps/web/src/server/managed-sandbox/repository-source";
import { runReputationEntrySourcePreflight } from "../../apps/web/src/server/reputation-entry-pilot/source-preflight";

const sources = [
  {
    taskType: "TEST_AND_FIX" as const,
    branch: "donelayer/repair/reputation-state-transition-v2",
    commitSha: "1".repeat(40),
  },
  {
    taskType: "BUILD_RESCUE" as const,
    branch: "donelayer/repair/reputation-build-config-v2",
    commitSha: "2".repeat(40),
  },
];

describe("Reputation entry source preflight", () => {
  it("materializes both exact refs before returning PASS", async () => {
    const evidence = await runReputationEntrySourcePreflight({
      attemptId: "PHASE_B_ATTEMPT_2",
      sources,
      materialize: successfulMaterializer,
      startedAt: "2026-09-04T14:00:00.000Z",
    });
    const { evidenceSha256, ...body } = evidence;

    expect(evidence).toMatchObject({
      status: "PASS",
      attemptId: "PHASE_B_ATTEMPT_2",
      checks: {
        exactRepositoryReachable: true,
        approvedRefsResolved: true,
        exactCommitsMaterialized: true,
        temporaryWorkspacesCleaned: true,
        remoteMutationPerformed: false,
      },
      failure: null,
    });
    expect(evidence.results.map((result) => result.resolvedCommitSha)).toEqual(["1".repeat(40), "2".repeat(40)]);
    expect(evidenceSha256).toBe(sha256Canonical(body));
  });

  it("returns durable structured failure evidence without starting the second ref", async () => {
    let calls = 0;
    const error = new SourceMaterializationError(
      "GIT_CLONE",
      128,
      "",
      "fatal: unable to access repository",
      "Git clone failed with exit code 128",
    );
    error.materializerWorkspaceCleaned = true;
    const evidence = await runReputationEntrySourcePreflight({
      attemptId: "PHASE_B_ATTEMPT_2",
      sources,
      materialize: (async () => {
        calls += 1;
        throw error;
      }) as typeof materializeVerifiedSourcePackage,
    });

    expect(calls).toBe(1);
    expect(evidence).toMatchObject({
      status: "BLOCKED",
      results: [],
      checks: {
        exactRepositoryReachable: false,
        approvedRefsResolved: false,
        exactCommitsMaterialized: false,
        temporaryWorkspacesCleaned: true,
        remoteMutationPerformed: false,
      },
      failure: {
        taskType: "TEST_AND_FIX",
        stage: "GIT_CLONE",
        exitCode: 128,
        stderr: "fatal: unable to access repository",
        materializerWorkspaceCleaned: true,
      },
    });
  });
});

const successfulMaterializer = (async (input: Parameters<typeof materializeVerifiedSourcePackage>[0]) => {
  const branch = input!.branch!;
  const commitSha = input!.expectedCommitSha!;
  return {
    identity: {
      remoteUrl: "https://github.com/NickHOI/donelayer-build-rescue-fixture.git",
      branch,
      commitSha,
    },
    repositoryManifestSha256: "3".repeat(64),
    sourcePackageSha256: "4".repeat(64),
    materializerCommitSha: commitSha,
    independentRemoteCommitSha: commitSha,
    sourceFileCount: 4,
    clone: {
      startedAt: "2026-09-04T14:00:00.000Z",
      finishedAt: "2026-09-04T14:00:01.000Z",
      durationMs: 1_000,
      exitCode: 0,
      stdout: "",
      stderr: "",
    },
    remoteVerifiedAt: "2026-09-04T14:00:01.000Z",
    materializerWorkspaceCleaned: true,
  } as MaterializedSourcePackage;
}) as typeof materializeVerifiedSourcePackage;
