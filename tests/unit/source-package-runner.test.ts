import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  REAL_SOURCE_BUG_FIXTURE_BRANCH,
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
} from "@donelayer/worker-protocol";
import { managedBuildTestSourceRunner } from "../../apps/web/src/server/managed-sandbox/source-package-runner";

describe("Managed Sandbox source package runner", () => {
  it("generates valid ESM with the locked source identity", () => {
    const commitSha = "a".repeat(40);
    const manifestSha256 = "b".repeat(64);
    const sourcePackageSha256 = "c".repeat(64);
    const sourcePackageManifestSha256 = "d".repeat(64);
    const runner = managedBuildTestSourceRunner({
      identity: {
        remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
        branch: REPOSITORY_MATERIALIZATION_BRANCH,
        commitSha,
        manifestSha256,
        sourcePackageSha256,
        sourcePackageManifestSha256,
      },
      buildScriptPresent: true,
    });

    const syntaxCheck = spawnSync(process.execPath, ["--input-type=module", "--check"], {
      input: runner,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });

    expect(syntaxCheck.error).toBeUndefined();
    expect(syntaxCheck.status, syntaxCheck.stderr).toBe(0);
    expect(runner).toContain(REPOSITORY_MATERIALIZATION_REMOTE_URL);
    expect(runner).toContain(REPOSITORY_MATERIALIZATION_BRANCH);
    expect(runner).toContain(commitSha);
    expect(runner).toContain(manifestSha256);
    expect(runner).toContain(sourcePackageSha256);
    expect(runner).toContain(sourcePackageManifestSha256);
    expect(runner).toContain('mode !== "prepare" && mode !== "verify"');
  });

  it("rejects an invalid or non-fixture source identity before generating code", () => {
    expect(() => managedBuildTestSourceRunner({
      identity: {
        remoteUrl: "https://github.com/example/untrusted.git",
        branch: REPOSITORY_MATERIALIZATION_BRANCH,
        commitSha: "a".repeat(40),
        manifestSha256: "b".repeat(64),
        sourcePackageSha256: "c".repeat(64),
        sourcePackageManifestSha256: "d".repeat(64),
      },
      buildScriptPresent: false,
    })).toThrow();
  });

  it("accepts only the explicitly selected true-source-bug Fixture scenario branch", () => {
    const identity = {
      remoteUrl: REPOSITORY_MATERIALIZATION_REMOTE_URL,
      branch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
      commitSha: "a".repeat(40),
      manifestSha256: "b".repeat(64),
      sourcePackageSha256: "c".repeat(64),
      sourcePackageManifestSha256: "d".repeat(64),
    } as const;

    expect(() => managedBuildTestSourceRunner({
      identity,
      buildScriptPresent: false,
    })).toThrow("Source runner branch is outside the approved boundary");

    const runner = managedBuildTestSourceRunner({
      identity,
      buildScriptPresent: false,
      allowedBranch: REAL_SOURCE_BUG_FIXTURE_BRANCH,
    });
    expect(runner).toContain(REAL_SOURCE_BUG_FIXTURE_BRANCH);

    expect(() => managedBuildTestSourceRunner({
      identity: { ...identity, branch: "fixture/unapproved" },
      buildScriptPresent: false,
      allowedBranch: "fixture/unapproved",
    })).toThrow("Source runner branch is outside the approved boundary");
  });
});
