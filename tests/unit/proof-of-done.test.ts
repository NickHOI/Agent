import { describe, expect, it } from "vitest";

import {
  acceptanceCheckSchema,
  evidenceSchema,
  type AcceptanceCheck,
  type Evidence,
} from "@donelayer/shared";
import {
  computeEvidenceSha256,
  evaluateAcceptanceCheck,
  evaluateProofOfDone,
  getEvidenceDigest,
  verifyEvidenceSha256,
} from "@donelayer/proof-of-done";

const createdAt = "2026-07-31T12:00:00.000Z";
const common = {
  createdAt,
  jobRunId: "job-1",
  workerId: "worker-1",
};

const screenshotHash = computeEvidenceSha256("image");

const checks: AcceptanceCheck[] = acceptanceCheckSchema.array().parse([
  {
    id: "command",
    title: "Tests command exits successfully",
    type: "COMMAND_EXIT",
    commandId: "npm-test",
  },
  {
    id: "tests",
    title: "All tests pass",
    type: "TEST",
    minimumTotal: 3,
    minimumPassed: 3,
  },
  { id: "build", title: "Build succeeds", type: "BUILD" },
  {
    id: "github-check",
    title: "GitHub checks pass",
    type: "GITHUB_CHECK",
    checkName: "ci/test",
    repository: "example/repo",
  },
  { id: "diff", title: "Code changed", type: "DIFF" },
  {
    id: "file",
    title: "Auth test exists",
    type: "FILE_EXISTS",
    path: "tests/auth.test.ts",
  },
  {
    id: "pr",
    title: "Pull request exists",
    type: "PULL_REQUEST",
    targetBranch: "main",
  },
  {
    id: "url",
    title: "Preview is healthy",
    type: "URL_HEALTH",
    url: "https://example.com/health",
  },
  {
    id: "screenshot",
    title: "Screenshot supplied",
    type: "SCREENSHOT",
  },
  {
    id: "approval",
    title: "Customer approved",
    type: "HUMAN_APPROVAL",
    approverKind: "CUSTOMER",
  },
]);

const evidence: Evidence[] = evidenceSchema.array().parse([
  {
    ...common,
    id: "command-evidence",
    type: "COMMAND",
    commandId: "npm-test",
    exitCode: 0,
  },
  {
    ...common,
    id: "test-evidence",
    type: "TEST",
    total: 3,
    passed: 3,
    failed: 0,
    skipped: 0,
  },
  {
    ...common,
    id: "build-evidence",
    type: "BUILD",
    commandId: "npm-build",
    success: true,
    exitCode: 0,
  },
  {
    ...common,
    id: "github-check-evidence",
    type: "GITHUB_CHECK",
    checkName: "ci/test",
    repository: "example/repo",
    status: "SUCCESS",
    commitSha: "c73a1e52",
  },
  {
    ...common,
    id: "diff-evidence",
    type: "DIFF",
    patch: "+ expect(session).toBeDefined();",
    changedFiles: ["src/auth.ts", "tests/auth.test.ts"],
  },
  {
    ...common,
    id: "manifest-evidence",
    type: "FILE_MANIFEST",
    paths: ["src/auth.ts", "tests/auth.test.ts"],
  },
  {
    ...common,
    id: "pr-evidence",
    type: "PULL_REQUEST",
    url: "https://github.com/example/repo/pull/42",
    number: 42,
    state: "OPEN",
    targetBranch: "main",
  },
  {
    ...common,
    id: "url-evidence",
    type: "URL_HEALTH",
    url: "https://example.com/health/",
    status: 200,
  },
  {
    ...common,
    id: "screenshot-evidence",
    type: "ARTIFACT",
    artifactType: "SCREENSHOT",
    fileName: "auth-result.png",
    mimeType: "image/png",
    size: 5,
    sha256: screenshotHash,
    storagePath: "artifacts/auth-result.png",
  },
  {
    ...common,
    id: "approval-evidence",
    type: "HUMAN_APPROVAL",
    actorKind: "CUSTOMER",
    actorId: "customer-1",
    approved: true,
    approvedAt: createdAt,
  },
]);

describe("proof of done", () => {
  it("passes only after every required structured check passes", () => {
    const verification = evaluateProofOfDone(checks, evidence);

    expect(verification.requiredCheckCount).toBe(10);
    expect(verification.passedRequiredCheckCount).toBe(10);
    expect(verification.passed).toBe(true);
    expect(verification.results.every((item) => item.passed)).toBe(true);
  });

  it("fails when an executor merely reports a failed command result", () => {
    const failedCommandEvidence: Evidence[] = evidenceSchema.array().parse([
      {
        ...common,
        id: "failed-command",
        type: "COMMAND",
        commandId: "npm-test",
        exitCode: 1,
      },
    ]);
    const commandCheck = checks[0];

    expect(commandCheck).toBeDefined();
    const verification = evaluateAcceptanceCheck(
      commandCheck as AcceptanceCheck,
      failedCommandEvidence,
    );

    expect(verification.passed).toBe(false);
    expect(verification.message).toContain("exited with 1");
  });

  it("requires at least one required check", () => {
    const verification = evaluateProofOfDone(
      [
        {
          id: "optional",
          title: "Optional build",
          type: "BUILD",
          required: false,
        },
      ],
      evidence,
    );

    expect(verification.requiredCheckCount).toBe(0);
    expect(verification.passed).toBe(false);
  });

  it("supports an explicit admin override for human approval", () => {
    const adminEvidence: Evidence[] = evidenceSchema.array().parse([
      {
        ...common,
        id: "admin-approval",
        type: "HUMAN_APPROVAL",
        actorKind: "ADMIN",
        actorId: "admin-1",
        approved: true,
        approvedAt: createdAt,
      },
    ]);
    const result = evaluateAcceptanceCheck(
      {
        id: "human",
        title: "Customer approval",
        type: "HUMAN_APPROVAL",
        approverKind: "CUSTOMER",
        allowAdminOverride: true,
      },
      adminEvidence,
    );

    expect(result.passed).toBe(true);
  });

  it("computes and verifies evidence SHA-256 and byte size", () => {
    const expected =
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    expect(computeEvidenceSha256("hello")).toBe(expected);
    expect(getEvidenceDigest("hello")).toEqual({ sha256: expected, size: 5 });
    expect(verifyEvidenceSha256("hello", expected)).toBe(true);
    expect(verifyEvidenceSha256("tampered", expected)).toBe(false);
    expect(verifyEvidenceSha256("hello", "not-a-hash")).toBe(false);
  });
});
