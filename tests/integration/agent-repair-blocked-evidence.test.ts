import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidencePath = path.join(workspaceRoot, "test-results", "agent-repair-sandbox-blocked-v1-evidence.json");
const hasEvidence = existsSync(evidencePath);

describe("Persisted Agent Repair blocked evidence", () => {
  it.skipIf(!hasEvidence)("records the bounded provider failure and independently verified cleanup", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    const preflight = evidence.preflight as Record<string, unknown>;
    const model = preflight.selectedModel as Record<string, unknown>;
    const attempt = evidence.agentAttempt as Record<string, unknown>;
    const repair = evidence.repair as Record<string, unknown>;
    const postflight = evidence.postflight as Record<string, unknown>;
    const sandbox = postflight.sandbox as Record<string, unknown>;

    expect(evidence).toMatchObject({ gate: "AGENT_REPAIR_IN_MANAGED_SANDBOX_GATE_V1", status: "BLOCKED" });
    expect(preflight).toMatchObject({ authentication: "VERCEL_OIDC", creditBalanceBefore: "5" });
    expect(model).toMatchObject({ id: "poolside/laguna-s-2.1-free", provider: "poolside", isFree: true, supportsTools: true, supportsReasoning: true });
    expect(attempt).toMatchObject({ liveRepairRuns: 1, providerRetryLimit: 1, apiRequestAttempts: 2, errorCode: "AI_GATEWAY_TEMPORARY_UNAVAILABLE", toolCallCount: 0 });
    expect(repair).toMatchObject({ patchCreated: false, repairedTestExecuted: false, receiptCreated: false });
    expect(postflight).toMatchObject({ creditBalanceAfter: "4.999775", observedCreditUsed: "0.000225" });
    expect(sandbox).toMatchObject({ status: "stopped", persistent: false, currentSnapshotId: null, cleanupVerified: true });
    expect(JSON.stringify(evidence)).not.toMatch(/VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|Bearer\s+[A-Za-z0-9._-]+|\.env\.local|C:\\Users\\/i);
  });
});
