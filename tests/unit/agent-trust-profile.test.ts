import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DemoStore, type PublicJobReceipt } from "@donelayer/database";
import {
  buildAgentTrustProfile,
  isPresentableVerifiedWork,
} from "../../apps/web/src/server/agent-identity/agent-trust-profile";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Agent trust profile projection", () => {
  it("does not turn seeded Marketplace counters or Demo completion copy into Verified Work", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "donelayer-agent-trust-profile-"));
    roots.push(root);
    const store = new DemoStore(path.join(root, "donelayer.sqlite"));
    const agent = store.getAgentBySlug("react-bug-fix")!;
    expect(agent.completedTasks).toBeGreaterThan(0);

    const trust = buildAgentTrustProfile(store, agent.id);
    expect(trust).not.toBeNull();
    expect(trust?.identity.agentId).toBe(agent.id);
    expect(trust?.verifiedWork).toEqual([]);
    expect(trust?.activeAuthorities).toEqual([]);
    store.close();
  });

  it.each([
    ["valid delivery", receipt(), true],
    ["invalid chain", receipt({ verificationStatus: "INVALID" }), false],
    ["invalidated", receipt({ invalidated: true }), false],
    ["disputed", receipt({ disputed: true }), false],
    ["failed", receipt({ result: "FAILED" }), false],
    ["infrastructure smoke", receipt({ taskType: "Worker Infrastructure Verification" }), false],
    ["repository metadata only", receipt({ taskType: "Repository Materialization Verification" }), false],
  ])("filters %s receipts without inferring Reputation qualification", (_label, candidate, expected) => {
    expect(isPresentableVerifiedWork(candidate)).toBe(expected);
  });
});

function receipt(
  overrides: Partial<Pick<PublicJobReceipt, "taskType" | "result" | "verificationStatus" | "invalidated" | "disputed">> = {},
) {
  return {
    taskType: "Agent Repair in Managed Sandbox Verification" as const,
    result: "VERIFIED" as const,
    verificationStatus: "VALID" as const,
    invalidated: false,
    disputed: false,
    ...overrides,
  };
}
