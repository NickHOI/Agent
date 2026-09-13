import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson } from "@donelayer/database";
import {
  REPOSITORY_MATERIALIZATION_NAME,
  REPOSITORY_MATERIALIZATION_OWNER,
  REAL_SOURCE_BUG_FIXTURE_BRANCH,
  assertAllowlistedRepositoryUrl,
  assertGitDeliveryBranch,
  assertRepositoryRelativePath,
  repositoryFileManifestSchema,
  repositoryManifestSha256,
  type RepositoryFileManifest,
} from "@donelayer/worker-protocol";

import {
  GIT_DELIVERY_AUTHENTICATION_MODE,
  type AppliedGitPatchEvidence,
  type DeliveryCommandResult,
  type DeliveryCommandRunner,
  type GitCommitMetadata,
  type GitDeliveryAvailability,
  type GitDeliveryDiffEvidence,
  type GitDeliveryProvider,
  type GitDeliveryWorkspace,
  type GitPullRequestEvidence,
  type GitPushEvidence,
  type GitRepositoryVerification,
  type GitBaseBranch,
} from "./provider";

const MAX_OUTPUT_BYTES = 512 * 1024;
const REPOSITORY = `${REPOSITORY_MATERIALIZATION_OWNER}/${REPOSITORY_MATERIALIZATION_NAME}`;

export class GitHubCliGitDeliveryProvider implements GitDeliveryProvider {
  constructor(private readonly runner: DeliveryCommandRunner = runDeliveryCommand) {}

  async checkAvailability(): Promise<GitDeliveryAvailability> {
    const checkedAt = new Date().toISOString();
    try {
      const [auth, git, gh, account] = await Promise.all([
        this.runGh(["auth", "status"], process.cwd()),
        this.runGit(["--version"], process.cwd()),
        this.runGh(["--version"], process.cwd()),
        this.runGh(["api", "user"], process.cwd()),
      ]);
      requireSuccess("gh auth status", auth);
      requireSuccess("git --version", git);
      requireSuccess("gh --version", gh);
      requireSuccess("gh api user", account);
      const user = parseJson(account.stdout, "GitHub account") as { login?: unknown };
      const accountLogin = requiredString(user.login, "GitHub account login");
      if (accountLogin.toLowerCase() !== REPOSITORY_MATERIALIZATION_OWNER.toLowerCase()) {
        throw new Error("GITHUB_OWNER_IDENTITY_MISMATCH");
      }
      return {
        available: true,
        checkedAt,
        authenticationMode: GIT_DELIVERY_AUTHENTICATION_MODE,
        accountLogin,
        gitVersion: git.stdout.trim(),
        ghVersion: gh.stdout.split(/\r?\n/, 1)[0]?.trim() ?? null,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      return {
        available: false,
        checkedAt,
        authenticationMode: "UNAVAILABLE",
        accountLogin: null,
        gitVersion: null,
        ghVersion: null,
        errorCode: "GITHUB_DELIVERY_AUTH_UNAVAILABLE",
        errorMessage: safeMessage(error),
      };
    }
  }

  async verifyRepository(input: {
    remoteUrl: string;
    expectedBaseCommit: string;
    baseBranch: GitBaseBranch;
  }): Promise<GitRepositoryVerification> {
    const remoteUrl = assertAllowlistedRepositoryUrl(input.remoteUrl);
    const expectedBaseCommit = assertCommit(input.expectedBaseCommit);
    const baseBranch = assertGitBaseBranch(input.baseBranch);
    const [remote, repository, commit] = await Promise.all([
      this.runGit(["ls-remote", "--exit-code", "--heads", remoteUrl, `refs/heads/${baseBranch}`], process.cwd()),
      this.runGh(["api", `repos/${REPOSITORY}`], process.cwd()),
      this.runGh(["api", `repos/${REPOSITORY}/commits/${expectedBaseCommit}`], process.cwd()),
    ]);
    requireSuccess(`git ls-remote ${baseBranch}`, remote);
    requireSuccess("gh api repository", repository);
    requireSuccess("gh api base commit", commit);
    const remoteBaseCommit = parseSingleRemoteRef(remote.stdout, `refs/heads/${baseBranch}`);
    const repositoryJson = parseJson(repository.stdout, "GitHub repository") as {
      id?: unknown;
      full_name?: unknown;
      default_branch?: unknown;
      private?: unknown;
      clone_url?: unknown;
    };
    const commitJson = parseJson(commit.stdout, "GitHub base commit") as { sha?: unknown };
    const expectedCommitExists = String(commitJson.sha).toLowerCase() === expectedBaseCommit;
    if (
      remoteBaseCommit !== expectedBaseCommit ||
      !expectedCommitExists ||
      repositoryJson.full_name !== REPOSITORY ||
      repositoryJson.default_branch !== "main" ||
      repositoryJson.private !== false ||
      repositoryJson.clone_url !== remoteUrl
    ) throw new Error("FIXTURE_REMOTE_CHANGED");
    return {
      repositoryId: String(repositoryJson.id),
      repository: REPOSITORY,
      remoteUrl,
      baseBranch,
      expectedBaseCommit,
      remoteBaseCommit,
      expectedCommitExists,
      private: false,
      verifiedAt: new Date().toISOString(),
    };
  }

  async createBranch(input: {
    remoteUrl: string;
    baseCommit: string;
    baseBranch: GitBaseBranch;
    deliveryBranch: string;
  }): Promise<GitDeliveryWorkspace> {
    const remoteUrl = assertAllowlistedRepositoryUrl(input.remoteUrl);
    const baseCommit = assertCommit(input.baseCommit);
    const deliveryBranch = assertGitDeliveryBranch(input.deliveryBranch);
    const baseBranch = assertGitBaseBranch(input.baseBranch);
    const rootPath = await mkdtemp(path.join(tmpdir(), "donelayer-git-delivery-"));
    assertTemporaryWorkspace(rootPath);
    const repositoryRoot = path.join(rootPath, "repository");
    const isolatedHome = path.join(rootPath, "home");
    const hooks = path.join(rootPath, "empty-hooks");
    await Promise.all([
      mkdir(repositoryRoot, { recursive: true, mode: 0o700 }),
      mkdir(isolatedHome, { recursive: true, mode: 0o700 }),
      mkdir(hooks, { recursive: true, mode: 0o700 }),
    ]);
    await writeFile(path.join(isolatedHome, ".gitconfig"), "", { encoding: "utf8", mode: 0o600 });
    const env = isolatedGitEnvironment(isolatedHome, path.join(isolatedHome, ".gitconfig"));
    try {
      await this.gitRequired(["init", "--initial-branch=main"], repositoryRoot, env);
      await this.gitRequired(["config", "core.autocrlf", "false"], repositoryRoot, env);
      await this.gitRequired(["config", "core.safecrlf", "true"], repositoryRoot, env);
      await this.gitRequired(["config", "core.hooksPath", hooks], repositoryRoot, env);
      await this.gitRequired(["remote", "add", "origin", remoteUrl], repositoryRoot, env);
      await this.gitRequired(["fetch", "--no-tags", "--depth=2", "origin", baseCommit], repositoryRoot, env, 60_000);
      await this.gitRequired(["checkout", "--detach", "FETCH_HEAD"], repositoryRoot, env);
      const observedBase = (await this.gitRequired(["rev-parse", "HEAD"], repositoryRoot, env)).stdout.trim().toLowerCase();
      if (observedBase !== baseCommit) throw new Error("GITHUB_DELIVERY_BASE_CHECKOUT_MISMATCH");
      const remoteBranch = await this.runGit(
        ["ls-remote", "--heads", remoteUrl, `refs/heads/${deliveryBranch}`],
        repositoryRoot,
        env,
      );
      requireSuccess("git ls-remote delivery branch", remoteBranch);
      const existingRemoteCommit = remoteBranch.stdout.trim()
        ? parseSingleRemoteRef(remoteBranch.stdout, `refs/heads/${deliveryBranch}`)
        : null;
      if (existingRemoteCommit) {
        await this.gitRequired(["fetch", "--no-tags", "--depth=2", "origin", `refs/heads/${deliveryBranch}`], repositoryRoot, env, 60_000);
        await this.gitRequired(["checkout", "-B", deliveryBranch, "FETCH_HEAD"], repositoryRoot, env);
      } else {
        await this.gitRequired(["switch", "-c", deliveryBranch], repositoryRoot, env);
      }
      return {
        id: randomUUID(),
        rootPath,
        repositoryRoot,
        remoteUrl,
        baseBranch,
        baseCommit,
        deliveryBranch,
        existingRemoteCommit,
      };
    } catch (error) {
      await rm(rootPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      throw error;
    }
  }

  async applyPatch(workspace: GitDeliveryWorkspace, input: {
    patch: Buffer;
    expectedPatchSha256: string;
    expectedBaseManifestSha256: string;
    allowedChangedFiles: string[];
  }): Promise<AppliedGitPatchEvidence> {
    const expectedPatchSha256 = assertDigest(input.expectedPatchSha256);
    if (sha256(input.patch) !== expectedPatchSha256) throw new Error("DELIVERY_PATCH_MISMATCH");
    const env = this.workspaceEnvironment(workspace);
    const baseManifest = await this.manifestAtCommit(workspace, workspace.baseCommit, workspace.baseBranch, env);
    const baseManifestSha256 = repositoryManifestSha256(baseManifest);
    if (baseManifestSha256 !== input.expectedBaseManifestSha256) throw new Error("DELIVERY_BASE_MANIFEST_MISMATCH");
    if (!workspace.existingRemoteCommit) {
      const patchPath = path.join(workspace.rootPath, "verified-repair.patch");
      await writeFile(patchPath, input.patch, { mode: 0o400, flag: "wx" });
      await this.gitRequired(["apply", "--check", "--whitespace=nowarn", patchPath], workspace.repositoryRoot, env);
      await this.gitRequired(["apply", "--whitespace=nowarn", patchPath], workspace.repositoryRoot, env);
    }
    const diffArgs = workspace.existingRemoteCommit
      ? ["diff", "--no-ext-diff", "--no-color", `${workspace.baseCommit}..HEAD`]
      : ["diff", "--no-ext-diff", "--no-color", workspace.baseCommit];
    const nameArgs = workspace.existingRemoteCommit
      ? ["diff", "--name-only", `${workspace.baseCommit}..HEAD`]
      : ["diff", "--name-only", workspace.baseCommit];
    const [diff, names] = await Promise.all([
      this.gitRequired(diffArgs, workspace.repositoryRoot, env),
      this.gitRequired(nameArgs, workspace.repositoryRoot, env),
    ]);
    const allowedChangedFiles = normalizeAllowedChangedFiles(input.allowedChangedFiles);
    const changedFiles = parsePaths(names.stdout);
    if (canonicalJson(changedFiles) !== canonicalJson(allowedChangedFiles)) {
      throw new Error("DELIVERY_PATCH_MISMATCH: changed files differ from the bounded repair evidence");
    }
    const deliveredManifest = workspace.existingRemoteCommit
      ? await this.manifestAtCommit(workspace, "HEAD", workspace.deliveryBranch, env)
      : await this.manifestFromWorkspace(workspace, baseManifest);
    const fileChanges = changedFiles.map((filePath) => {
      const before = requiredManifestEntry(baseManifest, filePath);
      const after = requiredManifestEntry(deliveredManifest, filePath);
      return {
        path: filePath,
        beforeSha256: before.sha256,
        afterSha256: after.sha256,
        beforeSize: before.size_bytes,
        afterSize: after.size_bytes,
      };
    });
    const baseTests = subsetManifest(baseManifest, (filePath) => filePath.startsWith("tests/"));
    const deliveredTests = subsetManifest(deliveredManifest, (filePath) => filePath.startsWith("tests/"));
    const packageBefore = requiredManifestEntry(baseManifest, "package.json");
    const packageAfter = requiredManifestEntry(deliveredManifest, "package.json");
    const testConfigBefore = requiredManifestEntry(baseManifest, "tsconfig.json");
    const testConfigAfter = requiredManifestEntry(deliveredManifest, "tsconfig.json");
    const packageBeforeText = await this.gitFile(workspace, workspace.baseCommit, "package.json", env);
    const packageAfterText = workspace.existingRemoteCommit
      ? await this.gitFile(workspace, "HEAD", "package.json", env)
      : await readFile(path.join(workspace.repositoryRoot, "package.json"), "utf8");
    const testScriptBefore = parseTestScript(packageBeforeText);
    const testScriptAfter = parseTestScript(packageAfterText);
    const testsManifestSha256Before = sha256(Buffer.from(canonicalJson(baseTests), "utf8"));
    const testsManifestSha256After = sha256(Buffer.from(canonicalJson(deliveredTests), "utf8"));
    const testsUnchanged = testsManifestSha256Before === testsManifestSha256After;
    const testScriptUnchanged = packageBefore.sha256 === packageAfter.sha256 && testScriptBefore === testScriptAfter;
    const testConfigurationUnchanged = testConfigBefore.sha256 === testConfigAfter.sha256;
    if (!testsUnchanged || !testScriptUnchanged || !testConfigurationUnchanged) {
      throw new Error("TEST_TAMPERING_DETECTED");
    }
    const testText = (await Promise.all(deliveredTests.map((entry) =>
      this.gitFile(workspace, workspace.existingRemoteCommit ? "HEAD" : workspace.baseCommit, entry.relative_path, env))))
      .join("\n");
    if (/\.(?:skip|only)\s*\(/.test(testText)) throw new Error("TEST_TAMPERING_DETECTED");
    return {
      patchSha256: expectedPatchSha256,
      changedFiles,
      fileChanges,
      actualDiff: diff.stdout,
      actualDiffSha256: sha256(Buffer.from(diff.stdout, "utf8")),
      normalizedDiffSha256: sha256(Buffer.from(canonicalJson(fileChanges), "utf8")),
      baseManifest,
      baseManifestSha256,
      deliveredManifest,
      deliveredManifestSha256: repositoryManifestSha256(deliveredManifest),
      testsManifestSha256Before,
      testsManifestSha256After,
      packageJsonSha256Before: packageBefore.sha256,
      packageJsonSha256After: packageAfter.sha256,
      testScriptBefore,
      testScriptAfter,
      testConfigurationSha256Before: testConfigBefore.sha256,
      testConfigurationSha256After: testConfigAfter.sha256,
      testsUnchanged,
      testScriptUnchanged,
      testConfigurationUnchanged,
      forbiddenTestMarkersAdded: false,
      appliedAt: new Date().toISOString(),
    };
  }

  async createCommit(workspace: GitDeliveryWorkspace, input: {
    message: "fix: apply DoneLayer verified repair";
    accountLogin: string;
    allowedChangedFiles: string[];
  }): Promise<GitCommitMetadata> {
    const env = this.workspaceEnvironment(workspace);
    const allowedChangedFiles = normalizeAllowedChangedFiles(input.allowedChangedFiles);
    if (!/^[A-Za-z0-9-]{1,39}$/.test(input.accountLogin)) throw new Error("GITHUB_ACCOUNT_LOGIN_INVALID");
    if (!workspace.existingRemoteCommit) {
      await this.gitRequired(["config", "user.name", input.accountLogin], workspace.repositoryRoot, env);
      await this.gitRequired(["config", "user.email", `${input.accountLogin}@users.noreply.github.com`], workspace.repositoryRoot, env);
      await this.gitRequired(["add", "--", ...allowedChangedFiles], workspace.repositoryRoot, env);
      const staged = await this.gitRequired(["diff", "--cached", "--name-only"], workspace.repositoryRoot, env);
      if (canonicalJson(parsePaths(staged.stdout)) !== canonicalJson(allowedChangedFiles)) {
        throw new Error("DELIVERY_PATCH_MISMATCH: staged files differ");
      }
      await this.gitRequired(["commit", "--no-gpg-sign", "-m", input.message], workspace.repositoryRoot, env);
    }
    const metadata = await this.localCommitMetadata(workspace, env);
    if (
      metadata.parentCommitSha !== workspace.baseCommit ||
      metadata.message !== input.message ||
      canonicalJson(metadata.changedFiles) !== canonicalJson(allowedChangedFiles)
    ) throw new Error("DELIVERY_COMMIT_METADATA_MISMATCH");
    return metadata;
  }

  async pushBranch(workspace: GitDeliveryWorkspace, commit: GitCommitMetadata): Promise<GitPushEvidence> {
    const env = this.workspaceEnvironment(workspace);
    if (workspace.existingRemoteCommit && workspace.existingRemoteCommit !== commit.commitSha) {
      throw new Error("DELIVERY_BRANCH_COLLISION");
    }
    if (!workspace.existingRemoteCommit) {
      const push = await this.runGit([
        "-c", "credential.helper=",
        "-c", "credential.https://github.com.helper=!gh auth git-credential",
        "push", "--porcelain", "origin",
        `refs/heads/${workspace.deliveryBranch}:refs/heads/${workspace.deliveryBranch}`,
      ], workspace.repositoryRoot, env, 60_000);
      requireSuccess("git push delivery branch", push);
    }
    const remote = await this.gitRequired(
      ["ls-remote", "--exit-code", "--heads", workspace.remoteUrl, `refs/heads/${workspace.deliveryBranch}`],
      workspace.repositoryRoot,
      env,
    );
    const remoteCommitSha = parseSingleRemoteRef(remote.stdout, `refs/heads/${workspace.deliveryBranch}`);
    if (remoteCommitSha !== commit.commitSha) throw new Error("REMOTE_COMMIT_MISMATCH");
    return {
      remote: workspace.remoteUrl,
      branch: workspace.deliveryBranch,
      exitCode: 0,
      localCommitSha: commit.commitSha,
      remoteCommitSha,
      pushedAt: new Date().toISOString(),
      idempotentExistingBranch: Boolean(workspace.existingRemoteCommit),
    };
  }

  async createPullRequest(input: {
    repository: string;
    title: "DoneLayer verified repair";
    body: string;
    baseBranch: GitBaseBranch;
    headBranch: string;
  }): Promise<GitPullRequestEvidence> {
    assertRepository(input.repository);
    assertGitDeliveryBranch(input.headBranch);
    assertGitBaseBranch(input.baseBranch);
    const listed = await this.runGh([
      "pr", "list", "--repo", input.repository, "--state", "all", "--base", input.baseBranch,
      "--head", input.headBranch, "--json", "number,state,mergedAt",
    ], process.cwd());
    requireSuccess("gh pr list", listed);
    const existing = parseJson(listed.stdout, "GitHub Pull Request list") as Array<{ number?: unknown; state?: unknown; mergedAt?: unknown }>;
    if (existing.length > 1) throw new Error("GITHUB_DELIVERY_MULTIPLE_PULL_REQUESTS");
    if (existing[0]) {
      if (existing[0].state !== "OPEN" || existing[0].mergedAt !== null) throw new Error("GITHUB_DELIVERY_PULL_REQUEST_NOT_OPEN");
      return this.fetchPullRequest(input.repository, Number(existing[0].number));
    }
    const bodyRoot = await mkdtemp(path.join(tmpdir(), "donelayer-pr-body-"));
    try {
      const bodyPath = path.join(bodyRoot, "body.md");
      await writeFile(bodyPath, input.body, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const created = await this.runGh([
        "pr", "create", "--repo", input.repository, "--base", input.baseBranch,
        "--head", input.headBranch, "--title", input.title, "--body-file", bodyPath,
      ], process.cwd(), 60_000);
      requireSuccess("gh pr create", created);
      const match = created.stdout.match(/https:\/\/github\.com\/NickHOI\/donelayer-build-rescue-fixture\/pull\/(\d+)/i);
      if (!match) throw new Error("PR_CREATION_FAILED: GitHub did not return the expected URL");
      return this.fetchPullRequest(input.repository, Number(match[1]));
    } finally {
      await rm(bodyRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  async fetchPullRequest(repository: string, number: number): Promise<GitPullRequestEvidence> {
    assertRepository(repository);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("GITHUB_PULL_REQUEST_NUMBER_INVALID");
    const result = await this.runGh([
      "pr", "view", String(number), "--repo", repository,
      "--json", "number,url,title,body,state,isDraft,mergedAt,baseRefName,headRefName,baseRefOid,headRefOid,createdAt",
    ], process.cwd());
    requireSuccess("gh pr view", result);
    const value = parseJson(result.stdout, "GitHub Pull Request") as Record<string, unknown>;
    const state = value.state === "OPEN" ? "OPEN" : value.state === "CLOSED" ? "CLOSED" : null;
    if (!state) throw new Error("GITHUB_PULL_REQUEST_STATE_INVALID");
    return {
      number: Number(value.number),
      url: requiredString(value.url, "Pull Request URL"),
      title: requiredString(value.title, "Pull Request title"),
      body: requiredString(value.body, "Pull Request body", true),
      state,
      isDraft: Boolean(value.isDraft),
      merged: value.mergedAt !== null,
      baseBranch: assertGitBaseBranch(requiredString(value.baseRefName, "Pull Request base branch")),
      headBranch: assertGitDeliveryBranch(requiredString(value.headRefName, "Pull Request head")),
      baseCommit: assertCommit(requiredString(value.baseRefOid, "Pull Request base Commit")),
      headCommit: assertCommit(requiredString(value.headRefOid, "Pull Request head Commit")),
      createdAt: requiredString(value.createdAt, "Pull Request created time"),
    };
  }

  async getCommitMetadata(repository: string, commitSha: string): Promise<GitCommitMetadata> {
    assertRepository(repository);
    const sha = assertCommit(commitSha);
    const result = await this.runGh(["api", `repos/${repository}/commits/${sha}`], process.cwd());
    requireSuccess("gh api delivery commit", result);
    const value = parseJson(result.stdout, "GitHub Commit") as {
      sha?: unknown;
      parents?: Array<{ sha?: unknown }>;
      commit?: {
        message?: unknown;
        author?: { name?: unknown; email?: unknown; date?: unknown };
        committer?: { name?: unknown; email?: unknown; date?: unknown };
      };
      files?: Array<{ filename?: unknown }>;
    };
    const parent = value.parents?.[0]?.sha;
    return {
      commitSha: assertCommit(requiredString(value.sha, "Commit SHA")),
      parentCommitSha: assertCommit(requiredString(parent, "Parent Commit SHA")),
      authorName: requiredString(value.commit?.author?.name, "Commit author"),
      authorEmail: requiredString(value.commit?.author?.email, "Commit author email"),
      committerName: requiredString(value.commit?.committer?.name, "Commit committer"),
      committerEmail: requiredString(value.commit?.committer?.email, "Commit committer email"),
      authoredAt: requiredString(value.commit?.author?.date, "Commit authored time"),
      committedAt: requiredString(value.commit?.committer?.date, "Commit committed time"),
      message: requiredString(value.commit?.message, "Commit message").split(/\r?\n/, 1)[0]!,
      changedFiles: (value.files ?? []).map((file) => assertRepositoryRelativePath(requiredString(file.filename, "Changed file"))).sort(),
    };
  }

  async getDiff(repository: string, pullRequestNumber: number): Promise<GitDeliveryDiffEvidence> {
    assertRepository(repository);
    if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) throw new Error("GITHUB_PULL_REQUEST_NUMBER_INVALID");
    const result = await this.runGh([
      "api", "-H", "Accept: application/vnd.github.v3.diff",
      `repos/${repository}/pulls/${pullRequestNumber}`,
    ], process.cwd());
    requireSuccess("gh api Pull Request diff", result);
    if (!result.stdout.includes("diff --git a/src/add.ts b/src/add.ts")) throw new Error("DELIVERY_PATCH_MISMATCH");
    return { patch: result.stdout, sha256: sha256(Buffer.from(result.stdout, "utf8")), retrievedAt: new Date().toISOString() };
  }

  async cancelDelivery(workspace: GitDeliveryWorkspace): Promise<void> {
    assertTemporaryWorkspace(workspace.rootPath);
    await rm(workspace.rootPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  private workspaceEnvironment(workspace: GitDeliveryWorkspace): NodeJS.ProcessEnv {
    const home = path.join(workspace.rootPath, "home");
    return isolatedGitEnvironment(home, path.join(home, ".gitconfig"));
  }

  private async manifestAtCommit(
    workspace: GitDeliveryWorkspace,
    commit: string,
    branch: string,
    env: NodeJS.ProcessEnv,
  ): Promise<RepositoryFileManifest> {
    const tree = await this.gitRequired(["ls-tree", "-r", commit], workspace.repositoryRoot, env);
    const entries = [];
    for (const line of tree.stdout.split(/\r?\n/).filter(Boolean)) {
      const match = line.match(/^(\d{6})\s+blob\s+[a-f0-9]{40}\t(.+)$/);
      if (!match || !["100644", "100755"].includes(match[1]!)) throw new Error("DELIVERY_REPOSITORY_TREE_INVALID");
      const filePath = assertRepositoryRelativePath(match[2]!);
      const content = Buffer.from(await this.gitFile(workspace, commit, filePath, env), "utf8");
      entries.push({ relative_path: filePath, size_bytes: content.byteLength, sha256: sha256(content) });
    }
    entries.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
    return repositoryFileManifestSchema.parse({
      schemaVersion: 1,
      remoteUrl: workspace.remoteUrl,
      branch,
      commitSha: commit === "HEAD" ? (await this.gitRequired(["rev-parse", "HEAD"], workspace.repositoryRoot, env)).stdout.trim().toLowerCase() : assertCommit(commit),
      files: entries,
    });
  }

  private async manifestFromWorkspace(
    workspace: GitDeliveryWorkspace,
    baseManifest: RepositoryFileManifest,
  ): Promise<RepositoryFileManifest> {
    const root = await realpath(workspace.repositoryRoot);
    const entries = [];
    for (const entry of baseManifest.files) {
      const filePath = assertRepositoryRelativePath(entry.relative_path);
      const absolute = path.resolve(root, ...filePath.split("/"));
      if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error("DELIVERY_WORKSPACE_PATH_ESCAPE");
      const bytes = await readFile(absolute);
      entries.push({ relative_path: filePath, size_bytes: bytes.byteLength, sha256: sha256(bytes) });
    }
    const untracked = await this.gitRequired(["ls-files", "--others", "--exclude-standard"], workspace.repositoryRoot, this.workspaceEnvironment(workspace));
    if (parsePaths(untracked.stdout).length > 0) throw new Error("DELIVERY_PATCH_MISMATCH: untracked files detected");
    return repositoryFileManifestSchema.parse({
      schemaVersion: 1,
      remoteUrl: workspace.remoteUrl,
      branch: workspace.deliveryBranch,
      commitSha: workspace.baseCommit,
      files: entries,
    });
  }

  private async gitFile(
    workspace: GitDeliveryWorkspace,
    commit: string,
    filePath: string,
    env: NodeJS.ProcessEnv,
  ): Promise<string> {
    const result = await this.gitRequired(["show", `${commit}:${assertRepositoryRelativePath(filePath)}`], workspace.repositoryRoot, env);
    return result.stdout;
  }

  private async localCommitMetadata(workspace: GitDeliveryWorkspace, env: NodeJS.ProcessEnv): Promise<GitCommitMetadata> {
    const details = await this.gitRequired([
      "show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI%x00%s", "HEAD",
    ], workspace.repositoryRoot, env);
    const fields = details.stdout.trimEnd().split("\0");
    if (fields.length !== 9) throw new Error("DELIVERY_COMMIT_METADATA_INVALID");
    const changed = await this.gitRequired(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], workspace.repositoryRoot, env);
    const parents = fields[1]!.trim().split(/\s+/);
    if (parents.length !== 1) throw new Error("DELIVERY_COMMIT_PARENT_COUNT_INVALID");
    return {
      commitSha: assertCommit(fields[0]!),
      parentCommitSha: assertCommit(parents[0]!),
      authorName: requiredString(fields[2], "Commit author"),
      authorEmail: requiredString(fields[3], "Commit author email"),
      committerName: requiredString(fields[4], "Commit committer"),
      committerEmail: requiredString(fields[5], "Commit committer email"),
      authoredAt: requiredString(fields[6], "Commit authored time"),
      committedAt: requiredString(fields[7], "Commit committed time"),
      message: requiredString(fields[8], "Commit message"),
      changedFiles: parsePaths(changed.stdout),
    };
  }

  private runGit(args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs?: number): Promise<DeliveryCommandResult> {
    return this.runner({ program: "git", args, cwd, ...(env ? { env } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  }

  private runGh(args: string[], cwd: string, timeoutMs?: number): Promise<DeliveryCommandResult> {
    return this.runner({ program: "gh", args, cwd, ...(timeoutMs ? { timeoutMs } : {}) });
  }

  private async gitRequired(args: string[], cwd: string, env?: NodeJS.ProcessEnv, timeoutMs?: number): Promise<DeliveryCommandResult> {
    const result = await this.runGit(args, cwd, env, timeoutMs);
    requireSuccess(`git ${args[0] ?? "command"}`, result);
    return result;
  }
}

export const runDeliveryCommand: DeliveryCommandRunner = ({ program, args, cwd, env, timeoutMs = 30_000 }) => new Promise((resolve, reject) => {
  const child = spawn(program, args, {
    cwd,
    env: env ?? process.env,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout: Buffer = Buffer.alloc(0);
  let stderr: Buffer = Buffer.alloc(0);
  const collect = (current: Buffer, chunk: Buffer) => current.byteLength >= MAX_OUTPUT_BYTES
    ? current
    : Buffer.concat([current, chunk.subarray(0, MAX_OUTPUT_BYTES - current.byteLength)]);
  child.stdout.on("data", (chunk: Buffer) => { stdout = collect(stdout, chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = collect(stderr, chunk); });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    resolve({
      exitCode: code ?? 1,
      stdout: sanitizeOutput(stdout.toString("utf8"), cwd),
      stderr: sanitizeOutput(stderr.toString("utf8"), cwd),
    });
  });
});

function isolatedGitEnvironment(home: string, globalConfig: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GCM_INTERACTIVE: "Never",
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA"].some(
      (allowed) => allowed.toLowerCase() === key.toLowerCase(),
    )) environment[key] = value;
  }
  return environment;
}

function parseTestScript(text: string): string {
  const value = parseJson(text, "package.json") as { scripts?: { test?: unknown } };
  return requiredString(value.scripts?.test, "package.json test script");
}

function requiredManifestEntry(manifest: RepositoryFileManifest, filePath: string) {
  const entry = manifest.files.find((candidate) => candidate.relative_path === filePath);
  if (!entry) throw new Error(`Required manifest file is missing: ${filePath}`);
  return entry;
}

function subsetManifest(manifest: RepositoryFileManifest, predicate: (path: string) => boolean) {
  return manifest.files.filter((entry) => predicate(entry.relative_path)).map((entry) => ({ ...entry }));
}

function parseSingleRemoteRef(stdout: string, expectedRef: string): string {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error("Remote reference query returned an unexpected result set");
  const [sha, ref] = lines[0]!.split(/\s+/, 2);
  if (ref !== expectedRef) throw new Error("Remote reference query returned an unexpected ref");
  return assertCommit(sha ?? "");
}

function parsePaths(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map(assertRepositoryRelativePath).sort();
}

function normalizeAllowedChangedFiles(values: string[]): string[] {
  const normalized = [...new Set(values.map(assertRepositoryRelativePath))].sort();
  if (
    normalized.length < 1 ||
    normalized.length > 3 ||
    normalized.some((filePath) => !filePath.startsWith("src/") || filePath.endsWith(".map"))
  ) throw new Error("DELIVERY_ALLOWED_CHANGED_FILES_INVALID");
  return normalized;
}

function requireSuccess(label: string, result: DeliveryCommandResult): void {
  if (result.exitCode !== 0) throw new Error(`${label} failed with exit code ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function requiredString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`${label} is missing`);
  return value;
}

function assertRepository(value: string): void {
  if (value !== REPOSITORY) throw new Error("GitHub repository is outside the approved boundary");
}

function assertGitBaseBranch(value: string): GitBaseBranch {
  if (value !== "main" && value !== REAL_SOURCE_BUG_FIXTURE_BRANCH) {
    throw new Error("GITHUB_DELIVERY_BASE_BRANCH_FORBIDDEN");
  }
  return value;
}

function assertCommit(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error("Git Commit SHA is invalid");
  return normalized;
}

function assertDigest(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("SHA-256 is invalid");
  return normalized;
}

function assertTemporaryWorkspace(candidate: string): void {
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(candidate));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Git delivery workspace escaped the system temporary directory");
  }
}

function sanitizeOutput(value: string, cwd: string): string {
  return value
    .replaceAll(cwd, "<DELIVERY_WORKSPACE>")
    .replaceAll(cwd.replaceAll("\\", "/"), "<DELIVERY_WORKSPACE>")
    .replace(/(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED_GITHUB_TOKEN]");
}

function safeMessage(error: unknown): string {
  return sanitizeOutput(error instanceof Error ? error.message : String(error), process.cwd()).slice(0, 500);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
