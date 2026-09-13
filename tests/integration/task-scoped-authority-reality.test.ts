import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GitHubCliGitDeliveryProvider } from "../../apps/web/src/server/git-delivery/github-cli-provider";
import {
  assertTaskScopedAuthorityGateReceiptIntegrity,
  TaskScopedAuthorityGateOrchestrator,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority-gate";
import {
  assertTaskScopedPermissionLeaseIntegrity,
  TASK_SCOPED_AUTHORITY_GATE,
} from "../../apps/web/src/server/task-scoped-authority/task-scoped-authority";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const resultDirectory = path.join(workspaceRoot, "test-results");
const evidencePath = path.join(resultDirectory, "task-scoped-authority-v1-evidence.json");
const runRealGate = process.env.RUN_TASK_SCOPED_AUTHORITY_REALITY_GATE === "true";

describe("Task-scoped Agent Authority V1 reality Gate", () => {
  it.skipIf(!runRealGate)("authorizes one exact read-only Fixture action, denies escapes, revokes, and issues a bound Receipt", async () => {
    await mkdir(resultDirectory, { recursive: true });
    await rm(evidencePath, { force: true });
    const capturedAt = new Date().toISOString();
    try {
      const result = await new TaskScopedAuthorityGateOrchestrator(new GitHubCliGitDeliveryProvider()).run();
      assertTaskScopedPermissionLeaseIntegrity(result.issuedLease);
      assertTaskScopedPermissionLeaseIntegrity(result.finalLease);
      assertTaskScopedAuthorityGateReceiptIntegrity(result);
      expect(result).toMatchObject({
        gate: TASK_SCOPED_AUTHORITY_GATE,
        status: "AUTHORITY_VERIFIED",
        contract: {
          contractType: "VERIFIED_WORK_CONTRACT_V1",
          branch: "fixture/real-source-bug-v1",
          commitSha: "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00",
        },
        decision: { decision: "APPROVED" },
        issuedLease: { status: "ACTIVE", authorityType: "TASK_SCOPED_AUTHORITY_V1" },
        finalLease: { status: "REVOKED" },
        liveAction: {
          action: "READ_EXACT_FIXTURE_SOURCE_IDENTITY",
          mutating: false,
          repository: {
            repository: "NickHOI/donelayer-build-rescue-fixture",
            baseBranch: "fixture/real-source-bug-v1",
            expectedBaseCommit: "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00",
            remoteBaseCommit: "5ae6dd136b99c4727e8ac50833a716cfbbf4ae00",
            expectedCommitExists: true,
          },
        },
        receipt: { result: "AUTHORITY_VERIFIED" },
      });
      expect(result.protectedOperations.filter((operation) => operation.decision === "ALLOWED")).toHaveLength(1);
      expect(result.protectedOperations.filter((operation) => operation.decision === "DENIED")).toHaveLength(7);
      const evidence = {
        gate: TASK_SCOPED_AUTHORITY_GATE,
        capturedAt,
        host: {
          hostname: hostname(),
          os: `${platform()} ${release()}`,
          nodeVersion: process.version,
        },
        doneLayerIdentity: {
          headCommit: process.env.TASK_SCOPED_AUTHORITY_HEAD_COMMIT ?? "UNRECORDED",
          workingTreeSha256: process.env.TASK_SCOPED_AUTHORITY_WORKTREE_SHA256 ?? "UNRECORDED",
        },
        result,
      };
      expect(JSON.stringify(evidence)).not.toMatch(
        /gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+|VERCEL_OIDC_TOKEN|AI_GATEWAY_API_KEY|OPENAI_API_KEY|\.env\.local|C:\\Users\\user/i,
      );
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    } catch (error) {
      const evidence = {
        gate: TASK_SCOPED_AUTHORITY_GATE,
        capturedAt,
        result: {
          kind: "error",
          message: sanitize(error instanceof Error ? error.message : String(error)),
        },
      };
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
      throw error;
    }
  }, 120_000);
});

function sanitize(value: string): string {
  return value
    .replace(/(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "[LOCAL_HOME]")
    .slice(0, 1_000);
}
