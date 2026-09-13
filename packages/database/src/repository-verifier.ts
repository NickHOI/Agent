import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  assertFixtureScenarioBranch,
  assertAllowlistedRepositoryUrl,
  assertGitDeliveryBranch,
} from "@donelayer/worker-protocol";

export type RemoteCommitVerification = {
  remoteUrl: string;
  branch: string;
  commitSha: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  verifiedAt: string;
};

export type RemoteCommitResolver = (
  remoteUrl: string,
  branch: string,
) => RemoteCommitVerification;

export const independentlyResolveRemoteCommit: RemoteCommitResolver = (remoteUrl, branch) => {
  if (branch !== REPOSITORY_MATERIALIZATION_BRANCH) {
    throw new Error("Independent verifier only accepts the allowlisted main branch");
  }
  return resolveRemoteCommit(remoteUrl, branch);
};

export const independentlyResolveDeliveryRemoteCommit: RemoteCommitResolver = (remoteUrl, branch) => {
  assertGitDeliveryBranch(branch);
  return resolveRemoteCommit(remoteUrl, branch);
};

export const independentlyResolveScenarioRemoteCommit: RemoteCommitResolver = (remoteUrl, branch) => {
  assertFixtureScenarioBranch(branch);
  return resolveRemoteCommit(remoteUrl, branch);
};

function resolveRemoteCommit(remoteUrl: string, branch: string): RemoteCommitVerification {
  const allowedRemote = assertAllowlistedRepositoryUrl(remoteUrl);

  const verifierRoot = mkdtempSync(path.join(tmpdir(), "donelayer-remote-verifier-"));
  try {
    const home = path.join(verifierRoot, "home");
    const config = path.join(home, ".gitconfig");
    mkdirSync(home, { recursive: true, mode: 0o700 });
    writeFileSync(config, "", { encoding: "utf8", mode: 0o600 });
    const args = [
      "-c",
      "http.followRedirects=false",
      "-c",
      "credential.helper=",
      "ls-remote",
      "--exit-code",
      "--heads",
      allowedRemote,
      `refs/heads/${branch}`,
    ];
    const result = spawnSync("git", args, {
      cwd: verifierRoot,
      env: isolatedEnvironment(home, config),
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 512 * 1024,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    const exitCode = result.status ?? 1;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    if (exitCode !== 0) {
      throw new Error(`Independent remote query failed with exit code ${exitCode}: ${stderr.trim() || "no stderr"}`);
    }
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1) throw new Error("Independent remote query returned an unexpected ref set");
    const [commitSha, ref] = lines[0]!.split(/\s+/, 2);
    if (!commitSha || !/^[a-f0-9]{40}$/i.test(commitSha) || ref !== `refs/heads/${branch}`) {
      throw new Error("Independent remote query returned invalid branch metadata");
    }
    return {
      remoteUrl: allowedRemote,
      branch,
      commitSha: commitSha.toLowerCase(),
      exitCode,
      stdout,
      stderr,
      verifiedAt: new Date().toISOString(),
    };
  } finally {
    rmSync(verifierRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

function isolatedEnvironment(home: string, config: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
      ? process.env.NODE_ENV
      : "production",
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: config,
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GCM_INTERACTIVE: "Never",
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP"].some(
        (allowed) => allowed.toLowerCase() === key.toLowerCase(),
      )
    ) {
      environment[key] = value;
    }
  }
  return environment;
}
