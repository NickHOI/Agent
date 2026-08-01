import { describe, expect, it } from "vitest";

import { matchingWeights, rankCandidates } from "@donelayer/matching";
import {
  matchCandidateSchema,
  taskMatchingProfileSchema,
  type MatchCandidate,
} from "@donelayer/shared";

const now = new Date("2026-07-31T12:00:30.000Z");

const task = taskMatchingProfileSchema.parse({
  id: "task-1",
  taskType: "TEST_AND_FIX",
  requiredSkills: ["React", "TypeScript"],
  requiredOperatingSystem: "LINUX",
  requiredTools: ["node", "git"],
  requiredMcpTools: ["github:create_pull_request"],
  budgetCents: 10_000,
  expectedDurationHours: 10,
});

function candidate(
  agentOverrides: Partial<MatchCandidate["agent"]> = {},
  workerOverrides: Partial<MatchCandidate["worker"]> = {},
): MatchCandidate {
  return matchCandidateSchema.parse({
    agent: {
      id: "agent-alpha",
      name: "Agent Alpha",
      providerId: "provider-alpha",
      providerName: "Provider Alpha",
      skills: ["React"],
      taskTypes: ["TEST_AND_FIX"],
      supportedOperatingSystems: ["LINUX"],
      supportedTools: ["node", "git"],
      supportedMcpTools: ["github:create_pull_request"],
      minimumPriceCents: 5_000,
      acceptingTasks: true,
      verificationStatus: "VERIFIED",
      verifiedSuccessRate: 0.8,
      averageCompletionHours: 20,
      recentFailures: 1,
      recentRuns: 10,
      ...agentOverrides,
    },
    worker: {
      id: "worker-alpha",
      status: "ONLINE",
      operatingSystem: "LINUX",
      installedTools: ["node", "git"],
      installedMcpTools: ["github:create_pull_request"],
      lastHeartbeatAt: "2026-07-31T12:00:00.000Z",
      activeJobs: 1,
      maxConcurrentJobs: 2,
      ...workerOverrides,
    },
  });
}

describe("matching", () => {
  it("keeps the documented weights normalized", () => {
    expect(
      Object.values(matchingWeights).reduce((sum, weight) => sum + weight, 0),
    ).toBeCloseTo(1, 10);
  });

  it("calculates the documented seven-factor weighted score", () => {
    const ranked = rankCandidates(task, [candidate()], { now });

    expect(ranked.rejections).toHaveLength(0);
    expect(ranked.matches).toHaveLength(1);
    expect(ranked.matches[0]?.breakdown).toEqual({
      skillMatch: 0.5,
      verifiedSuccessRate: 0.8,
      availability: 0.5,
      environmentMatch: 1,
      budgetFit: 0.75,
      averageSpeed: 0.5,
      recentReliability: 0.9,
    });
    expect(ranked.matches[0]?.score).toBe(65.5);
    expect(ranked.matches[0]?.reason).toContain("Agent Alpha");
    expect(ranked.matches[0]?.reason).toContain("80% verified success rate");
  });

  it("ranks the strongest eligible agent first", () => {
    const alpha = candidate();
    const beta = candidate(
      {
        id: "agent-beta",
        name: "Agent Beta",
        skills: ["React", "TypeScript"],
        verifiedSuccessRate: 0.95,
        averageCompletionHours: 8,
        recentFailures: 0,
      },
      { id: "worker-beta", activeJobs: 0 },
    );

    const ranked = rankCandidates(task, [alpha, beta], { now });

    expect(ranked.matches.map((match) => match.candidate.agent.id)).toEqual([
      "agent-beta",
      "agent-alpha",
    ]);
  });

  it("hard-filters offline, over-budget, and environment-incompatible agents", () => {
    const incompatible = candidate(
      {
        supportedTools: ["node"],
        supportedMcpTools: [],
        minimumPriceCents: 12_000,
      },
      {
        status: "OFFLINE",
        installedTools: ["node"],
        installedMcpTools: [],
      },
    );

    const ranked = rankCandidates(task, [incompatible], { now });
    const codes = ranked.rejections[0]?.reasons.map((reason) => reason.code);

    expect(ranked.matches).toHaveLength(0);
    expect(codes).toEqual(
      expect.arrayContaining([
        "WORKER_NOT_ONLINE",
        "REQUIRED_TOOL_MISSING",
        "REQUIRED_MCP_TOOL_MISSING",
        "BUDGET_EXCEEDED",
      ]),
    );
  });

  it("rejects a worker whose heartbeat lease expired", () => {
    const stale = candidate({}, {
      lastHeartbeatAt: "2026-07-31T11:58:00.000Z",
    });

    const ranked = rankCandidates(task, [stale], {
      now,
      heartbeatTtlMs: 90_000,
    });

    expect(ranked.rejections[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "WORKER_HEARTBEAT_EXPIRED" }),
      ]),
    );
  });
});
