import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeEvidenceLedgerEntryHash } from "@donelayer/database";

import {
  assertAgentIdentityGateReceiptIntegrity,
  AgentIdentityGateOrchestrator,
  type AgentIdentityGateOutcome,
} from "../../apps/web/src/server/agent-identity/agent-identity-gate";
import {
  AGENT_IDENTITY_GATE,
  assertAgentIdentityProfileIntegrity,
} from "../../apps/web/src/server/agent-identity/agent-identity";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const evidencePath = path.join(resultDirectory, "agent-identity-v1-evidence.json");
const identityPath = path.join(resultDirectory, "agent-identity-working-tree-identity.txt");
const persistEvidence = process.env.RUN_AGENT_IDENTITY_EVIDENCE_GATE === "true";
const existingEvidence = existsSync(evidencePath) && existsSync(identityPath);

describe("Agent Identity and Interoperability V1 evidence Gate", () => {
  it("creates local deterministic identity, mismatch, Ledger, and Receipt evidence", async () => {
    const result = new AgentIdentityGateOrchestrator().run(new Date("2026-09-03T18:00:00.000Z"));
    assertAgentIdentityGateReceiptIntegrity(result);

    expect(result).toMatchObject({
      gate: AGENT_IDENTITY_GATE,
      status: "IDENTITY_VERIFIED",
      finalLease: { status: "REVOKED" },
      liveExternalProof: { performed: false },
      receipt: { result: "IDENTITY_VERIFIED" },
    });
    expect(result.deniedProbes).toHaveLength(10);
    expect(result.ledgerVerification.valid).toBe(true);

    if (persistEvidence) {
      await mkdir(resultDirectory, { recursive: true });
      await rm(evidencePath, { force: true });
      const evidence = {
        gate: AGENT_IDENTITY_GATE,
        capturedAt: new Date().toISOString(),
        host: {
          hostname: hostname(),
          os: `${platform()} ${release()}`,
          nodeVersion: process.version,
        },
        doneLayerIdentity: {
          headCommit: process.env.AGENT_IDENTITY_HEAD_COMMIT ?? "UNRECORDED",
          workingTreeSha256: process.env.AGENT_IDENTITY_WORKTREE_SHA256 ?? "UNRECORDED",
        },
        proofBoundary: {
          localDeterministicOnly: true,
          externalReadPerformed: false,
          externalWritePerformed: false,
          sandboxCreated: false,
          modelCalled: false,
          repositoryMutated: false,
          paymentPerformed: false,
        },
        result,
      };
      const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
      expect(serialized).not.toMatch(secretPattern());
      await writeFile(evidencePath, serialized, "utf8");
    }
  });

  it.skipIf(!persistEvidence && !existingEvidence)("recomputes persisted profile, execution, Ledger, and Receipt bindings offline", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    const result = record(evidence.result) as unknown as AgentIdentityGateOutcome;

    expect(evidence.gate).toBe(AGENT_IDENTITY_GATE);
    result.profiles.forEach((profile) => expect(() => assertAgentIdentityProfileIntegrity(profile)).not.toThrow());
    expect(() => assertAgentIdentityGateReceiptIntegrity(result)).not.toThrow();
    expect(result.receipt.document.identity.agent.agentId).toBe(result.contract.assignedAgent?.agentId);
    expect(result.receipt.document.identity.agent.profileSha256).toBe(result.execution.agent.profileSha256);
    expect(result.receipt.document.execution.executionId).toBe(result.issuedLease.authority.subject.executionId);
    expect(result.receipt.document.externalIdentityAdapters.references.every((item) => item.verificationLevel !== "VERIFIED")).toBe(true);

    let previous: string | null = null;
    for (const [index, entry] of result.ledgerEntries.entries()) {
      expect(entry.sequenceNumber).toBe(index + 1);
      expect(entry.previousEntrySha256).toBe(previous);
      expect(entry.entrySha256).toBe(computeEvidenceLedgerEntryHash(entry));
      previous = entry.entrySha256;
    }
    expect(result.ledgerVerification.chainSha256).toBe(previous);
    const raw = readFileSync(evidencePath);
    expect(createHash("sha256").update(raw).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
    expect(raw.toString("utf8")).not.toMatch(secretPattern());
  });
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected evidence object");
  return value as Record<string, unknown>;
}

function secretPattern(): RegExp {
  return /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\user/i;
}
