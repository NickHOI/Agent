import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  WORKER_PROTOCOL_VERSION,
  consumePairingCode,
  constantTimeHexEqual,
  createPairingCode,
  hashSecret,
  isCommandAllowed,
  isLeaseActive,
  jobEnvelopeSchema,
  normalizePairingCode,
  redactSecrets,
  redactStructuredValue,
  renewLease,
  sha256,
  truncateUtf8,
} from "@donelayer/worker-protocol";

describe("Worker protocol security primitives", () => {
  it("expires pairing codes and prevents reuse", () => {
    const pepper = "server-pepper-that-never-leaves-the-platform";
    const now = new Date("2026-07-31T12:00:00.000Z");
    const { code, record } = createPairingCode(pepper, now, 60_000);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const consumed = consumePairingCode(code, record, pepper, new Date(now.getTime() + 1_000));

    expect(consumed.usedAt).toEqual(new Date(now.getTime() + 1_000));
    expect(() => consumePairingCode(code, consumed, pepper, now)).toThrow(/already been used/);
    expect(() =>
      consumePairingCode(code, record, pepper, new Date(now.getTime() + 60_000)),
    ).toThrow(/expired/);
    expect(record.codeHash).toBe(hashSecret(normalizePairingCode(code), pepper));
    expect(record.codeHash).not.toContain(code);
    expect(constantTimeHexEqual("abc", "abf")).toBe(false);
    for (let index = 0; index < 256; index += 1) {
      const generated = createPairingCode(pepper, now).code;
      expect(generated).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
      );
      expect(normalizePairingCode(generated)).toHaveLength(12);
    }
  });

  it("detects and renews job leases", () => {
    const now = new Date("2026-07-31T12:00:00.000Z");
    const lease = { expiresAt: new Date(now.getTime() + 10_000), revokedAt: null };

    expect(isLeaseActive(lease, now)).toBe(true);
    expect(isLeaseActive(lease, new Date(now.getTime() + 10_000))).toBe(false);
    expect(renewLease(lease, now, 45_000).expiresAt).toEqual(
      new Date(now.getTime() + 45_000),
    );
  });

  it("rejects arbitrary commands in a job envelope", () => {
    const base = validJobEnvelope();
    expect(jobEnvelopeSchema.safeParse(base).success).toBe(true);

    const unsafe = structuredClone(base);
    unsafe.workflow.allowedCommandIds = ["rm -rf /" as "NPM_TEST"];
    const parsed = jobEnvelopeSchema.safeParse(unsafe);
    expect(parsed.success).toBe(false);

    const mismatchedTemplate = {
      ...base,
      workflow: { ...base.workflow, id: "BUILD_RESCUE" as const },
    };
    expect(jobEnvelopeSchema.safeParse(mismatchedTemplate).success).toBe(false);
    expect(isCommandAllowed("TEST_AND_FIX", "NPM_TEST")).toBe(true);
    expect(isCommandAllowed("BUILD_RESCUE", "NPM_TEST")).toBe(false);
  });

  it("requires a locked Contract reference and an active Permission Lease envelope", () => {
    const base = validJobEnvelope();
    expect(jobEnvelopeSchema.safeParse(base).success).toBe(true);

    const withoutContract = { ...base, taskContract: undefined };
    expect(jobEnvelopeSchema.safeParse(withoutContract).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      taskContract: { ...base.taskContract, sha256: "not-a-sha256" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      permissionLease: { ...base.permissionLease, status: "REVOKED" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      leaseExpiresAt: "2026-07-31T12:01:00.001Z",
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      limits: { ...base.limits, maxArtifactBytes: base.limits.maxArtifactBytes + 1 },
    }).success).toBe(false);
  });

  it("accepts only a repository-free Worker smoke envelope", () => {
    const smoke = {
      ...validJobEnvelope(),
      executor: { kind: "worker-smoke" as const },
      workflow: {
        id: "WORKER_SMOKE_V1" as const,
        version: 1 as const,
        allowedCommandIds: [],
      },
      repository: { mode: "none" as const },
    };

    expect(jobEnvelopeSchema.safeParse(smoke).success).toBe(true);
    expect(jobEnvelopeSchema.safeParse({
      ...smoke,
      repository: { mode: "none", owner: "untrusted" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...smoke,
      repository: { mode: "demo", owner: "donelayer", name: "demo", targetBranch: "main" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...smoke,
      workflow: { ...smoke.workflow, allowedCommandIds: ["NPM_TEST"] },
    }).success).toBe(false);
  });

  it("strictly validates demo and GitHub App repository descriptors", () => {
    const base = validJobEnvelope();
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: { mode: "demo", owner: "donelayer", name: "..", targetBranch: "main" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: { mode: "demo", owner: "donelayer", name: "demo", targetBranch: "../../main" },
    }).success).toBe(false);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: {
        mode: "github-app",
        repositoryId: randomUUID(),
        owner: "donelayer",
        name: "worker",
        targetBranch: "main",
        commitSha: "a".repeat(40),
        archiveUrl: "https://artifacts.example.test/repository.tar.gz",
      },
    }).success).toBe(true);
    expect(jobEnvelopeSchema.safeParse({
      ...base,
      repository: {
        mode: "github-app",
        repositoryId: randomUUID(),
        owner: "donelayer",
        name: "worker",
        targetBranch: "main",
        commitSha: "a".repeat(40),
        archiveUrl: "http://artifacts.example.test/repository.tar.gz",
      },
    }).success).toBe(false);
  });

  it("hashes evidence and redacts credentials from logs", () => {
    expect(sha256("done")).toBe("a4c3ed04a95a3da14a9d235c83d868bed7c0f45cf7f3faa751ee8f50598d2211");
    const redacted = redactSecrets(
      "Authorization: Bearer top-secret-token worker_token=worker-secret github_token=ghp_abcdefghijklmnop api=sk-proj-abcdefghijklmnop",
    );
    expect(redacted).not.toContain("top-secret-token");
    expect(redacted).not.toContain("worker-secret");
    expect(redacted).not.toContain("ghp_abcdefghijklmnop");
    expect(redacted).not.toContain("sk-proj-abcdefghijklmnop");
    expect(
      redactStructuredValue({ workerToken: "secret", nested: { authorization: "Bearer secret" } }),
    ).toEqual({ workerToken: "[REDACTED]", nested: { authorization: "[REDACTED]" } });
    expect(truncateUtf8("abcdefghijklmnopqrstuvwxyz", 20)).toContain("TRUNCATED");
  });
});

function validJobEnvelope() {
  return {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    taskId: randomUUID(),
    assignmentId: randomUUID(),
    providerAcceptedAt: "2026-07-31T11:59:00.000Z",
    jobRunId: randomUUID(),
    workerId: randomUUID(),
    leaseToken: "lease-token-that-is-at-least-thirty-two-characters",
    leaseExpiresAt: "2026-07-31T12:01:00.000Z",
    taskContract: {
      id: randomUUID(),
      version: 1,
      sha256: "a".repeat(64),
    },
    permissionLease: {
      id: randomUUID(),
      version: 1,
      status: "ACTIVE" as const,
      startsAt: "2026-07-31T11:59:00.000Z",
      expiresAt: "2026-07-31T12:01:00.000Z",
      scope: {
        allowedActions: ["execute_workflow"],
        deniedActions: ["network", "arbitrary_shell"],
        allowedPaths: ["$JOB_WORKSPACE"],
        allowedDomains: [],
        maxArtifactBytes: 5_000_000,
        maxRuntimeSeconds: 60,
        maxApiBudget: 0,
        humanApprovalActions: [],
      },
    },
    executor: { kind: "demo" as const },
    workflow: {
      id: "TEST_AND_FIX" as const,
      version: 1 as const,
      allowedCommandIds: ["NPM_TEST" as const],
    },
    task: {
      title: "Fix authentication tests",
      problemDescription: "The authentication suite fails when a valid session has not expired.",
      desiredOutcome: "All authentication tests pass.",
      scopeSummary: "Correct session expiry handling and run the approved test workflow.",
      acceptanceChecks: [],
    },
    repository: {
      mode: "demo" as const,
      owner: "donelayer",
      name: "demo-repository",
      targetBranch: "main",
    },
    permissions: { modifyCode: true, createPullRequest: true, humanApprovalRequired: true },
    limits: {
      timeoutMs: 60_000,
      maxLogBytes: 1_000_000,
      maxArtifactBytes: 5_000_000,
      maxArtifacts: 10,
      allowedMimeTypes: ["text/x-diff", "text/plain", "application/json"],
      allowedNetworkDomains: [],
    },
  };
}
