import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_NAME,
  REPOSITORY_MATERIALIZATION_OWNER,
  assertAllowlistedRepositoryUrl,
  type RepositoryEnvelope,
} from "@donelayer/worker-protocol";

export type RepositoryGrant = {
  customerId: string;
  repositoryId: string;
  installationId: string;
  owner: string;
  name: string;
  targetBranch: string;
  commitSha: string;
  archiveUrl: string;
};

export function resolveRepositoryEnvelope(input: {
  repository: string;
  targetBranch: string;
  customerId: string;
  workflowId: string;
  grant?: RepositoryGrant;
}): RepositoryEnvelope {
  if (input.workflowId === "WORKER_SMOKE_V1") {
    if (input.repository !== "worker-smoke://none") {
      throw new Error("WORKER_SMOKE_V1 must use the server-owned repository-free descriptor.");
    }
    return { mode: "none" };
  }

  if (input.workflowId === "REPOSITORY_MATERIALIZE_V1") {
    const remoteUrl = assertAllowlistedRepositoryUrl(input.repository);
    if (input.targetBranch !== REPOSITORY_MATERIALIZATION_BRANCH) {
      throw new Error("REPOSITORY_MATERIALIZE_V1 must use the server allowlisted main branch.");
    }
    return {
      mode: "allowlisted-github",
      remoteUrl,
      owner: REPOSITORY_MATERIALIZATION_OWNER,
      name: REPOSITORY_MATERIALIZATION_NAME,
      targetBranch: REPOSITORY_MATERIALIZATION_BRANCH,
    };
  }

  if (input.repository.startsWith("demo://")) {
    const match = /^demo:\/\/([^/]+)\/([^/]+)$/.exec(input.repository);
    const owner = match?.[1];
    const name = match?.[2];
    if (!owner || !name || !isRepositoryOwner(owner) || !isRepositoryName(name)) {
      throw new Error("Demo repository descriptor is invalid.");
    }
    return { mode: "demo", owner, name, targetBranch: input.targetBranch };
  }

  const repositoryUrl = parseGitHubRepositoryUrl(input.repository);
  const grant = input.grant;
  if (!repositoryUrl || !grant) {
    throw new Error("Repository jobs are paused unless the Server supplies a verified ownership grant.");
  }
  if (
    grant.customerId !== input.customerId ||
    grant.owner.toLowerCase() !== repositoryUrl.owner.toLowerCase() ||
    grant.name.toLowerCase() !== repositoryUrl.name.toLowerCase() ||
    grant.targetBranch !== input.targetBranch
  ) {
    throw new Error("Repository ownership grant does not belong to this Task.");
  }
  if (!/^[0-9a-f]{40}$/i.test(grant.commitSha) || new URL(grant.archiveUrl).protocol !== "https:") {
    throw new Error("Repository ownership grant is incomplete.");
  }
  if (!grant.installationId.trim()) throw new Error("Repository ownership grant has no installation identity.");
  return {
    mode: "github-app",
    repositoryId: grant.repositoryId,
    owner: grant.owner,
    name: grant.name,
    targetBranch: grant.targetBranch,
    commitSha: grant.commitSha,
    archiveUrl: grant.archiveUrl,
  };
}

function parseGitHubRepositoryUrl(value: string): { owner: string; name: string } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.search || url.hash) return null;
  const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length !== 2 || !isRepositoryOwner(segments[0]!) || !isRepositoryName(segments[1]!)) return null;
  return { owner: segments[0]!, name: segments[1]! };
}

function isRepositoryOwner(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/.test(value);
}

function isRepositoryName(value: string): boolean {
  return /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/.test(value);
}
