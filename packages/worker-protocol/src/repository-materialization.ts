import { createHash } from "node:crypto";
import path from "node:path";

import { z } from "zod";

export const REPOSITORY_MATERIALIZATION_REMOTE_URL =
  "https://github.com/NickHOI/donelayer-build-rescue-fixture.git" as const;
export const REPOSITORY_MATERIALIZATION_OWNER = "NickHOI" as const;
export const REPOSITORY_MATERIALIZATION_NAME = "donelayer-build-rescue-fixture" as const;
export const REPOSITORY_MATERIALIZATION_BRANCH = "main" as const;
export const GIT_DELIVERY_BRANCH_PREFIX = "donelayer/repair/" as const;
export const REAL_SOURCE_BUG_FIXTURE_BRANCH = "fixture/real-source-bug-v1" as const;
export const BETA_GATE_3_PRODUCT_REMOTE_URL = "https://github.com/NickHOI/Agent.git" as const;
export const BETA_GATE_3_PRODUCT_OWNER = "NickHOI" as const;
export const BETA_GATE_3_PRODUCT_NAME = "Agent" as const;
export const BETA_GATE_3_PRODUCT_BRANCH = "main" as const;

const commitSha = z.string().regex(/^[a-f0-9]{40}$/);
const isoDate = z.string().datetime({ offset: true });

export const repositoryMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  remoteUrl: z.literal(REPOSITORY_MATERIALIZATION_REMOTE_URL),
  branch: z.literal(REPOSITORY_MATERIALIZATION_BRANCH),
  commitSha,
  cloneStartedAt: isoDate,
  cloneFinishedAt: isoDate,
  cloneExitCode: z.literal(0),
  cloneDurationMs: z.number().int().nonnegative(),
  workerId: z.string().uuid(),
  jobRunId: z.string().uuid(),
}).strict();

export const repositoryManifestEntrySchema = z.object({
  relative_path: z.string().min(1).max(1_024),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((entry, context) => {
  try {
    assertRepositoryRelativePath(entry.relative_path);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["relative_path"],
      message: error instanceof Error ? error.message : "Repository path is invalid",
    });
  }
});

export const repositoryFileManifestSchema = z.object({
  schemaVersion: z.literal(1),
  remoteUrl: z.union([
    z.literal(REPOSITORY_MATERIALIZATION_REMOTE_URL),
    z.literal(BETA_GATE_3_PRODUCT_REMOTE_URL),
  ]),
  branch: z.string().min(1).max(255).refine(
    (value) => value === REPOSITORY_MATERIALIZATION_BRANCH || value === REAL_SOURCE_BUG_FIXTURE_BRANCH || isGitDeliveryBranch(value),
    "Repository manifest branch is outside the approved boundary",
  ),
  commitSha,
  files: z.array(repositoryManifestEntrySchema).min(1).max(100_000),
}).strict().superRefine((manifest, context) => {
  if (
    manifest.remoteUrl === BETA_GATE_3_PRODUCT_REMOTE_URL &&
    manifest.branch !== BETA_GATE_3_PRODUCT_BRANCH
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branch"],
      message: "Beta Gate 3 product source is locked to main",
    });
  }
  if (
    manifest.remoteUrl === REPOSITORY_MATERIALIZATION_REMOTE_URL &&
    manifest.branch !== REPOSITORY_MATERIALIZATION_BRANCH &&
    manifest.branch !== REAL_SOURCE_BUG_FIXTURE_BRANCH &&
    !isGitDeliveryBranch(manifest.branch)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branch"],
      message: "Fixture source branch is outside the approved boundary",
    });
  }
  const paths = manifest.files.map((entry) => entry.relative_path);
  const stable = [...paths].sort((left, right) => left.localeCompare(right));
  if (paths.some((value, index) => value !== stable[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: "Manifest files are not stably sorted" });
  }
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: "Manifest contains duplicate paths" });
  }
});

export type RepositoryMetadata = z.infer<typeof repositoryMetadataSchema>;
export type RepositoryFileManifest = z.infer<typeof repositoryFileManifestSchema>;

export function assertAllowlistedRepositoryUrl(value: string): typeof REPOSITORY_MATERIALIZATION_REMOTE_URL {
  if (value !== REPOSITORY_MATERIALIZATION_REMOTE_URL) {
    throw new Error("Repository URL is not the exact server allowlist target");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/${REPOSITORY_MATERIALIZATION_OWNER}/${REPOSITORY_MATERIALIZATION_NAME}.git`
  ) {
    throw new Error("Repository URL failed the HTTPS allowlist policy");
  }
  return REPOSITORY_MATERIALIZATION_REMOTE_URL;
}

export function assertBetaGate3ProductRepositoryUrl(value: string): typeof BETA_GATE_3_PRODUCT_REMOTE_URL {
  if (value !== BETA_GATE_3_PRODUCT_REMOTE_URL) {
    throw new Error("Repository URL is not the exact Beta Gate 3 product target");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/${BETA_GATE_3_PRODUCT_OWNER}/${BETA_GATE_3_PRODUCT_NAME}.git`
  ) {
    throw new Error("Beta Gate 3 Repository URL failed the HTTPS allowlist policy");
  }
  return BETA_GATE_3_PRODUCT_REMOTE_URL;
}

export function assertGitDeliveryBranch(value: string): string {
  if (!isGitDeliveryBranch(value)) throw new Error("Git delivery branch is outside the approved namespace");
  return value;
}

export function assertFixtureScenarioBranch(value: string): typeof REAL_SOURCE_BUG_FIXTURE_BRANCH {
  if (value !== REAL_SOURCE_BUG_FIXTURE_BRANCH) throw new Error("Fixture scenario branch is outside the approved boundary");
  return REAL_SOURCE_BUG_FIXTURE_BRANCH;
}

function isGitDeliveryBranch(value: string): boolean {
  return /^donelayer\/repair\/[a-z0-9](?:[a-z0-9-]{0,62})$/.test(value);
}

export function assertAllowlistedRepositoryRedirect(currentUrl: string, location: string): string {
  const resolved = new URL(location, currentUrl).toString();
  return assertAllowlistedRepositoryUrl(resolved);
}

export function assertRepositoryRelativePath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value
  ) {
    throw new Error("Manifest path must be a normalized relative POSIX path");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Manifest path traversal is forbidden");
  }
  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    throw new Error("Manifest must not include .git content");
  }
  return value;
}

export function canonicalRepositoryJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function repositoryManifestSha256(manifest: RepositoryFileManifest): string {
  return createHash("sha256").update(canonicalRepositoryJson(manifest), "utf8").digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new Error(`Canonical JSON does not support ${typeof value}`);
}
