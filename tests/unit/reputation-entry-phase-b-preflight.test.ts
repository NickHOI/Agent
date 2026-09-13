import { describe, expect, it } from "vitest";

import type { AgentExecutionProvider } from "../../apps/web/src/server/agent-execution/provider";
import { runReputationEntryPhaseBPreflight } from "../../apps/web/src/server/reputation-entry-pilot/phase-b-preflight";

describe("Phase B pre-lifecycle preflight", () => {
  it("records a read-only source/OIDC/catalog PASS before lifecycle state", async () => {
    const evidence = await runReputationEntryPhaseBPreflight({
      attemptId: "PHASE_B_ATTEMPT_3",
      sources: [
        { taskType: "TEST_AND_FIX", branch: "donelayer/repair/reputation-state-transition-v2", commitSha: "1".repeat(40) },
        { taskType: "BUILD_RESCUE", branch: "donelayer/repair/reputation-build-config-v2", commitSha: "2".repeat(40) },
      ],
      linkedProject: { projectName: "donelayer", projectId: "prj_donelayer", orgId: "team_nickhois", environment: "development" },
      oidcToken: oidc(),
      provider: provider(),
      materialize: async (input) => ({
        identity: {
          remoteUrl: "https://github.com/NickHOI/donelayer-build-rescue-fixture.git",
          branch: input!.branch!,
          commitSha: input!.expectedCommitSha!,
        },
        repositoryManifestSha256: "3".repeat(64),
        sourcePackageSha256: "4".repeat(64),
        materializerCommitSha: input!.expectedCommitSha!,
        independentRemoteCommitSha: input!.expectedCommitSha!,
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
      } as Awaited<ReturnType<typeof import("../../apps/web/src/server/managed-sandbox/repository-source").materializeVerifiedSourcePackage>>),
      startedAt: "2026-09-04T14:00:00.000Z",
    });

    expect(evidence).toMatchObject({
      attemptId: "PHASE_B_ATTEMPT_3",
      status: "PASS",
      provider: {
        checkType: "READ_ONLY_NON_MODEL_CATALOG_PREFLIGHT",
        modelRequestsPerformed: false,
        externalMutationPerformed: false,
      },
      checks: {
        oidcStructurallyValid: true,
        oidcBoundToLinkedProject: true,
        oidcNotExpired: true,
        gatewayCatalogAvailable: true,
        exactCommitsMaterialized: true,
        temporaryWorkspacesCleaned: true,
        externalMutationPerformed: false,
        jobLifecycleStateCreated: false,
      },
      failure: null,
    });
  });
});

function oidc(): string {
  const claims = {
    iss: "https://oidc.vercel.com/nickhois-projects",
    aud: "https://vercel.com/nickhois-projects",
    sub: "owner:nickhois-projects:project:donelayer:environment:development",
    project: "donelayer",
    project_id: "prj_donelayer",
    owner: "nickhois-projects",
    owner_id: "team_nickhois",
    environment: "development",
    iat: 1_788_528_400,
    nbf: 1_788_528_400,
    exp: 1_788_571_600,
  };
  return `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

function provider(): AgentExecutionProvider {
  return {
    checkAvailability: async () => ({
      available: true,
      checkedAt: "2026-09-04T14:00:00.000Z",
      adapter: "VercelAIGatewayAgentProvider",
      gateway: "Vercel AI Gateway",
      authentication: "VERCEL_OIDC",
      credits: { balance: "5", totalUsed: "0" },
      eligibleModelCount: 1,
      errorCode: null,
      errorMessage: null,
    }),
    listEligibleModels: async () => [],
    createRun: async () => { throw new Error("model calls forbidden"); },
    continueRun: async () => { throw new Error("continuation forbidden"); },
    cancelRun: async () => { throw new Error("cancellation forbidden"); },
    getUsage: async () => null,
    getCredits: async () => ({ balance: "5", totalUsed: "0" }),
    getProviderMetadata: () => ({
      adapter: "VercelAIGatewayAgentProvider",
      gateway: "Vercel AI Gateway",
      sdkPackage: "ai",
      sdkVersion: "test",
      authentication: "VERCEL_OIDC",
      directOpenAIStatus: "DEFERRED_OPTIONAL",
    }),
  };
}
