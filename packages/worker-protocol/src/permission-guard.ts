import path from "node:path";
import { realpathSync } from "node:fs";

import type { PermissionLeaseEnvelope } from "./types";

export type PermissionViolation = {
  action: string;
  resource?: string;
  reason: string;
  recordedAt: string;
};

export class PermissionViolationError extends Error {
  constructor(readonly violation: PermissionViolation) {
    super(violation.reason);
    this.name = "PermissionViolationError";
  }
}

export class PermissionGuard {
  private workspaceRoot: string | null;

  constructor(
    readonly lease: PermissionLeaseEnvelope,
    options: {
      workspaceRoot?: string;
      onViolation?: (violation: PermissionViolation) => void;
    } = {},
  ) {
    this.workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : null;
    this.onViolation = options.onViolation;
  }

  private readonly onViolation: ((violation: PermissionViolation) => void) | undefined;

  bindWorkspace(workspaceRoot: string): void {
    if (this.workspaceRoot) throw new Error("PermissionGuard workspace is already bound");
    this.workspaceRoot = realpathSync.native(path.resolve(workspaceRoot));
  }

  assertLeaseActive(at = new Date()): void {
    const now = at.getTime();
    const startsAt = Date.parse(this.lease.startsAt);
    const expiresAt = Date.parse(this.lease.expiresAt);
    if (
      this.lease.status !== "ACTIVE" ||
      !Number.isFinite(now) ||
      !Number.isFinite(startsAt) ||
      !Number.isFinite(expiresAt) ||
      startsAt > now ||
      expiresAt <= now
    ) {
      this.fail("lease", undefined, "Permission Lease is not active");
    }
  }

  assertActionAllowed(action: string, at = new Date()): void {
    this.assertLeaseActive(at);
    if (this.lease.scope.deniedActions.includes(action)) {
      this.fail(action, undefined, `Action ${action} is explicitly denied`);
    }
    if (!this.lease.scope.allowedActions.includes(action)) {
      this.fail(action, undefined, `Action ${action} is not allowed by this Permission Lease`);
    }
  }

  assertPathAllowed(candidatePath: string, at = new Date()): void {
    this.assertLeaseActive(at);
    if (!this.workspaceRoot || !this.lease.scope.allowedPaths.includes("$JOB_WORKSPACE")) {
      this.fail("path_access", candidatePath, "Job workspace access is not granted");
    }
    const parent = realpathSync.native(path.dirname(path.resolve(candidatePath)));
    const resolved = path.join(parent, path.basename(candidatePath));
    const relative = path.relative(this.workspaceRoot!, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      this.fail("path_access", candidatePath, "Path is outside the granted Job workspace");
    }
  }

  assertDomainAllowed(value: string, at = new Date()): void {
    this.assertLeaseActive(at);
    let hostname: string;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") this.fail("network", value, "Only HTTPS network targets can be allowed");
      hostname = url.hostname.toLowerCase();
    } catch {
      this.fail("network", value, "Network target is invalid");
    }
    if (!this.lease.scope.allowedDomains.map((domain) => domain.toLowerCase()).includes(hostname!)) {
      this.fail("network", value, `Domain ${hostname!} is not allowed`);
    }
  }

  assertRepositoryAllowed(repositoryUrl: string, branch: string, at = new Date()): void {
    this.assertLeaseActive(at);
    if (!this.lease.scope.allowedRepositories?.includes(repositoryUrl)) {
      this.fail("git_clone_allowlisted_repository", repositoryUrl, "Repository is not allowed by this Permission Lease");
    }
    if (!this.lease.scope.allowedBranches?.includes(branch)) {
      this.fail("git_clone_allowlisted_repository", branch, "Branch is not allowed by this Permission Lease");
    }
  }

  assertBudgetAvailable(requested: number, alreadyUsed = 0, at = new Date()): void {
    this.assertLeaseActive(at);
    if (
      !Number.isFinite(requested) ||
      !Number.isFinite(alreadyUsed) ||
      requested < 0 ||
      alreadyUsed < 0 ||
      alreadyUsed + requested > this.lease.scope.maxApiBudget
    ) {
      this.fail("api_budget", String(requested), "Permission Lease API budget would be exceeded");
    }
  }

  recordViolation(action: string, reason: string, resource?: string): PermissionViolationError {
    return this.violation(action, resource, reason);
  }

  private fail(action: string, resource: string | undefined, reason: string): never {
    throw this.violation(action, resource, reason);
  }

  private violation(action: string, resource: string | undefined, reason: string): PermissionViolationError {
    const violation: PermissionViolation = {
      action,
      reason,
      recordedAt: new Date().toISOString(),
      ...(resource === undefined ? {} : { resource }),
    };
    this.onViolation?.(violation);
    return new PermissionViolationError(violation);
  }
}
