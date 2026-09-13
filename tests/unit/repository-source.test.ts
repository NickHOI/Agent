import { describe, expect, it } from "vitest";

import {
  SourceMaterializationError,
  inspectManagedBuildTestPackageJson,
  sourceMaterializationFailureEvidence,
} from "../../apps/web/src/server/managed-sandbox/repository-source";

describe("Managed build/test Fixture package policy", () => {
  it("recognizes the fixed test script and optional build script", () => {
    expect(inspectManagedBuildTestPackageJson(JSON.stringify({
      scripts: { test: "node --test" },
    }))).toEqual({ buildScriptPresent: false });

    expect(inspectManagedBuildTestPackageJson(JSON.stringify({
      scripts: { build: "tsc", test: "node --test" },
    }))).toEqual({ buildScriptPresent: true });
  });

  it.each(["preinstall", "install", "postinstall", "prepare"])(
    "rejects the %s lifecycle script before Source packaging",
    (lifecycleScript) => {
      expect(() => inspectManagedBuildTestPackageJson(JSON.stringify({
        scripts: {
          test: "node --test",
          [lifecycleScript]: "node forbidden-lifecycle.mjs",
        },
      }))).toThrow(/forbidden install lifecycle scripts/i);
    },
  );

  it("rejects invalid JSON and a package without a real test script", () => {
    expect(() => inspectManagedBuildTestPackageJson("not json")).toThrow(/invalid JSON/i);
    expect(() => inspectManagedBuildTestPackageJson(JSON.stringify({ scripts: {} }))).toThrow(/test script/i);
    expect(() => inspectManagedBuildTestPackageJson(JSON.stringify({ scripts: { test: "   " } }))).toThrow(/test script/i);
  });

  it("retains structured Git failure output and cleanup evidence", () => {
    const error = new SourceMaterializationError(
      "GIT_CLONE",
      128,
      "clone stdout",
      "fatal: repository unavailable",
      "Git clone failed with exit code 128",
    );
    error.materializerWorkspaceCleaned = true;

    expect(sourceMaterializationFailureEvidence(error)).toEqual({
      errorType: "SOURCE_MATERIALIZATION_FAILURE",
      stage: "GIT_CLONE",
      exitCode: 128,
      stdout: "clone stdout",
      stderr: "fatal: repository unavailable",
      message: "Git clone failed with exit code 128",
      materializerWorkspaceCleaned: true,
    });
  });
});
