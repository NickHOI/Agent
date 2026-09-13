import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { computeEvidenceLedgerEntryHash } from "@donelayer/database";

import {
  assertTaskScopedAuthorityGateReceiptIntegrity,
  type TaskScopedAuthorityGateOutcome,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority-gate";
import {
  assertAuthorityDecisionIntegrity,
  assertTaskScopedPermissionLeaseIntegrity,
  TASK_SCOPED_AUTHORITY_GATE,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const evidencePath = path.join(workspaceRoot, "test-results", "task-scoped-authority-v1-evidence.json");
const identityPath = path.join(workspaceRoot, "test-results", "task-scoped-authority-working-tree-identity.txt");
const hasEvidence = existsSync(evidencePath) && existsSync(identityPath);

describe("Persisted Task-scoped Agent Authority V1 evidence", () => {
  it.skipIf(!hasEvidence)("recomputes decision, Lease, operation, Ledger, and Receipt bindings", () => {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    const result = record(evidence.result) as unknown as TaskScopedAuthorityGateOutcome;

    expect(evidence.gate).toBe(TASK_SCOPED_AUTHORITY_GATE);
    expect(() => assertAuthorityDecisionIntegrity(result.decision)).not.toThrow();
    expect(() => assertTaskScopedPermissionLeaseIntegrity(result.issuedLease)).not.toThrow();
    expect(() => assertTaskScopedPermissionLeaseIntegrity(result.finalLease)).not.toThrow();
    expect(() => assertTaskScopedAuthorityGateReceiptIntegrity(result)).not.toThrow();
    expect(result).toMatchObject({
      status: "AUTHORITY_VERIFIED",
      decision: {
        decision: "APPROVED",
        requestedBy: { actorType: "PLATFORM", actorId: "DONE_LAYER_SERVER" },
      },
      issuedLease: { status: "ACTIVE" },
      finalLease: {
        status: "REVOKED",
        revocationReason: "The single bounded read-only Gate action completed",
      },
      liveAction: { action: "READ_EXACT_FIXTURE_SOURCE_IDENTITY", mutating: false },
    });
    expect(result.issuedLease.authoritySha256).toBe(result.finalLease.authoritySha256);
    expect(result.issuedLease.authority.workContract.sha256).toBe(result.contract.workContractSha256);
    expect(result.receipt.document).toMatchObject({
      workContract: result.decision.workContract,
      authority: {
        authoritySha256: result.issuedLease.authoritySha256,
        terminalStatus: "REVOKED",
      },
    });

    const allowed = result.protectedOperations.filter((operation) => operation.decision === "ALLOWED");
    const denied = result.protectedOperations.filter((operation) => operation.decision === "DENIED");
    expect(allowed).toHaveLength(1);
    expect(allowed[0]).toMatchObject({ operation: "repository-read", action: "read_source" });
    expect(denied).toHaveLength(7);
    expect(denied.map((operation) => operation.operation)).toEqual(expect.arrayContaining([
      "repository-read",
      "protected-action",
      "pull-request-create",
      "pull-request-merge",
      "production-deployment",
    ]));
    expect(result.protectedOperations.every((operation) => operation.authoritySha256 === result.issuedLease.authoritySha256)).toBe(true);
    expectLedger(result.ledgerEntries, result.ledgerVerification);

    const raw = readFileSync(evidencePath);
    expect(createHash("sha256").update(raw).digest("hex")).toMatch(/^[a-f0-9]{64}$/);
    expect(raw.toString("utf8")).not.toMatch(
      /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\user/i,
    );
  });
});

function expectLedger(
  entries: TaskScopedAuthorityGateOutcome["ledgerEntries"],
  verification: TaskScopedAuthorityGateOutcome["ledgerVerification"],
): void {
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    expect(entry.sequenceNumber).toBe(index + 1);
    expect(entry.previousEntrySha256).toBe(previous);
    expect(entry.entrySha256).toBe(computeEvidenceLedgerEntryHash(entry));
    previous = entry.entrySha256;
  });
  expect(verification).toEqual({ valid: true, entryCount: entries.length, chainSha256: previous });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected evidence object");
  return value as Record<string, unknown>;
}
