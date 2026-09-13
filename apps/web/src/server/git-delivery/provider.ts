import type { RepositoryFileManifest } from "@donelayer/worker-protocol";
import type { REAL_SOURCE_BUG_FIXTURE_BRANCH } from "@donelayer/worker-protocol";

export const GIT_DELIVERY_AUTHENTICATION_MODE = "OWNER_DEVELOPMENT_GITHUB_AUTH" as const;
export type GitBaseBranch = "main" | typeof REAL_SOURCE_BUG_FIXTURE_BRANCH;

export type GitDeliveryAvailability = {
  available: boolean;
  checkedAt: string;
  authenticationMode: typeof GIT_DELIVERY_AUTHENTICATION_MODE | "UNAVAILABLE";
  accountLogin: string | null;
  gitVersion: string | null;
  ghVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type GitRepositoryVerification = {
  repositoryId: string;
  repository: string;
  remoteUrl: string;
  baseBranch: GitBaseBranch;
  expectedBaseCommit: string;
  remoteBaseCommit: string;
  expectedCommitExists: boolean;
  private: false;
  verifiedAt: string;
};

export type GitDeliveryWorkspace = {
  id: string;
  rootPath: string;
  repositoryRoot: string;
  remoteUrl: string;
  baseBranch: GitBaseBranch;
  baseCommit: string;
  deliveryBranch: string;
  existingRemoteCommit: string | null;
};

export type GitDeliveryFileChange = {
  path: string;
  beforeSha256: string;
  afterSha256: string;
  beforeSize: number;
  afterSize: number;
};

export type AppliedGitPatchEvidence = {
  patchSha256: string;
  changedFiles: string[];
  fileChanges: GitDeliveryFileChange[];
  actualDiff: string;
  actualDiffSha256: string;
  normalizedDiffSha256: string;
  baseManifest: RepositoryFileManifest;
  baseManifestSha256: string;
  deliveredManifest: RepositoryFileManifest;
  deliveredManifestSha256: string;
  testsManifestSha256Before: string;
  testsManifestSha256After: string;
  packageJsonSha256Before: string;
  packageJsonSha256After: string;
  testScriptBefore: string;
  testScriptAfter: string;
  testConfigurationSha256Before: string;
  testConfigurationSha256After: string;
  testsUnchanged: boolean;
  testScriptUnchanged: boolean;
  testConfigurationUnchanged: boolean;
  forbiddenTestMarkersAdded: false;
  appliedAt: string;
};

export type GitCommitMetadata = {
  commitSha: string;
  parentCommitSha: string;
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  authoredAt: string;
  committedAt: string;
  message: string;
  changedFiles: string[];
};

export type GitPushEvidence = {
  remote: string;
  branch: string;
  exitCode: 0;
  localCommitSha: string;
  remoteCommitSha: string;
  pushedAt: string;
  idempotentExistingBranch: boolean;
};

export type GitPullRequestEvidence = {
  number: number;
  url: string;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  isDraft: boolean;
  merged: boolean;
  baseBranch: GitBaseBranch;
  headBranch: string;
  baseCommit: string;
  headCommit: string;
  createdAt: string;
};

export type GitDeliveryDiffEvidence = {
  patch: string;
  sha256: string;
  retrievedAt: string;
};

export interface GitDeliveryProvider {
  checkAvailability(): Promise<GitDeliveryAvailability>;
  verifyRepository(input: {
    remoteUrl: string;
    expectedBaseCommit: string;
    baseBranch: GitBaseBranch;
  }): Promise<GitRepositoryVerification>;
  createBranch(input: {
    remoteUrl: string;
    baseCommit: string;
    baseBranch: GitBaseBranch;
    deliveryBranch: string;
  }): Promise<GitDeliveryWorkspace>;
  applyPatch(workspace: GitDeliveryWorkspace, input: {
    patch: Buffer;
    expectedPatchSha256: string;
    expectedBaseManifestSha256: string;
    allowedChangedFiles: string[];
  }): Promise<AppliedGitPatchEvidence>;
  createCommit(workspace: GitDeliveryWorkspace, input: {
    message: "fix: apply DoneLayer verified repair";
    accountLogin: string;
    allowedChangedFiles: string[];
  }): Promise<GitCommitMetadata>;
  pushBranch(workspace: GitDeliveryWorkspace, commit: GitCommitMetadata): Promise<GitPushEvidence>;
  createPullRequest(input: {
    repository: string;
    title: "DoneLayer verified repair";
    body: string;
    baseBranch: GitBaseBranch;
    headBranch: string;
  }): Promise<GitPullRequestEvidence>;
  fetchPullRequest(repository: string, number: number): Promise<GitPullRequestEvidence>;
  getCommitMetadata(repository: string, commitSha: string): Promise<GitCommitMetadata>;
  getDiff(repository: string, pullRequestNumber: number): Promise<GitDeliveryDiffEvidence>;
  cancelDelivery(workspace: GitDeliveryWorkspace): Promise<void>;
}

export type DeliveryCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type DeliveryCommandRunner = (input: {
  program: "git" | "gh";
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}) => Promise<DeliveryCommandResult>;
