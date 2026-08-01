import { describe, expect, it } from "vitest";

import {
  createTaskInputSchema,
  safeRelativePathSchema,
  taskMatchingProfileSchema,
} from "@donelayer/shared";

describe("shared validation", () => {
  it("parses a complete task and applies acceptance-check defaults", () => {
    const task = createTaskInputSchema.parse({
      title: "Fix authentication tests",
      problemDescription:
        "The repository authentication suite fails after the session refactor.",
      desiredOutcome: "All authentication tests pass without weakening assertions.",
      repository: "demo/sample-auth",
      targetBranch: "main",
      taskType: "TEST_AND_FIX",
      requiredSkills: ["TypeScript", "Vitest"],
      requiredOperatingSystem: "LINUX",
      requiredTools: ["node", "git"],
      requiredMcpTools: [],
      budgetCents: 20_000,
      deadline: "2026-08-03T10:00:00.000Z",
      acceptanceChecks: [
        {
          id: "tests",
          title: "Tests pass",
          type: "COMMAND_EXIT",
          commandId: "npm-test",
        },
      ],
      securitySensitivity: "MEDIUM",
      allowCodeChanges: true,
      allowPullRequest: true,
      requiresHumanApproval: true,
    });

    expect(task.acceptanceChecks[0]).toMatchObject({
      required: true,
      allowedExitCodes: [0],
    });
  });

  it("rejects workspace escape paths", () => {
    expect(safeRelativePathSchema.safeParse("../../.ssh/id_rsa").success).toBe(
      false,
    );
    expect(safeRelativePathSchema.safeParse("C:\\Users\\me\\secret").success).toBe(
      false,
    );
    expect(safeRelativePathSchema.safeParse("src/auth/session.ts").success).toBe(
      true,
    );
  });

  it("rejects negative budgets at the domain boundary", () => {
    const result = taskMatchingProfileSchema.safeParse({
      id: "task-1",
      taskType: "BUILD_RESCUE",
      budgetCents: -1,
    });

    expect(result.success).toBe(false);
  });
});
