import { createRequire } from "node:module";

import { Sandbox } from "@vercel/sandbox";
import {
  MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES,
  MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES,
  MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN,
  MANAGED_SANDBOX_PROOF_FILE,
  MANAGED_SANDBOX_RUNTIME,
  MANAGED_SANDBOX_WORKDIR,
  NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW,
  managedSandboxBuildTestCommandSchema,
  managedSandboxNetworkPolicyUpdateSchema,
  managedSandboxSecurityProfileSchema,
  type ManagedSandboxBuildTestCommand,
  type ManagedSandboxNetworkPolicyUpdate,
  type ManagedSandboxSecurityProfile,
} from "@donelayer/worker-protocol";

import type {
  ManagedSandboxAvailability,
  ManagedSandboxCleanupResult,
  ManagedSandboxCommandInput,
  ManagedSandboxCommandResult,
  ManagedSandboxHandle,
  ManagedSandboxInspection,
  ManagedSandboxLogStream,
  ManagedSandboxNetworkPolicyObservation,
  ManagedSandboxProvider,
  ManagedSandboxProviderMetadata,
} from "./provider";

const require = createRequire(import.meta.url);
const sdkVersion = (require("@vercel/sandbox/package.json") as { version: string }).version;

type LiveSandbox = Awaited<ReturnType<typeof Sandbox.create>>;
type BoundSandbox = {
  sandbox: LiveSandbox;
  runId: string;
  jobRunId: string;
  profile: ManagedSandboxSecurityProfile;
  uploadedFiles: Set<string>;
  nextBuildCommandIndex: number;
  policyPhase: "INITIAL_DENY_ALL" | "INSTALL_REGISTRY_ONLY" | "FINAL_DENY_ALL";
};

function policyDetails(value: unknown): Pick<ManagedSandboxInspection, "networkPolicy" | "allowedDomains" | "allowedCidrs"> {
  if (value === "deny-all") return { networkPolicy: "deny-all", allowedDomains: [], allowedCidrs: [] };
  if (value === "allow-all") return { networkPolicy: "allow-all", allowedDomains: [], allowedCidrs: [] };
  if (!value || typeof value !== "object") {
    return { networkPolicy: "unknown", allowedDomains: [], allowedCidrs: [] };
  }
  const record = value as Record<string, unknown>;
  if (record.mode === "deny-all" || record.mode === "allow-all") {
    return { networkPolicy: record.mode, allowedDomains: [], allowedCidrs: [] };
  }
  const allow = record.allow;
  const normalizedDomains = Array.isArray(allow)
    ? allow.filter((item): item is string => typeof item === "string")
    : allow && typeof allow === "object"
      ? Object.keys(allow)
      : Array.isArray(record.allowedDomains)
        ? record.allowedDomains.filter((item): item is string => typeof item === "string")
        : [];
  const subnets = record.subnets && typeof record.subnets === "object"
    ? record.subnets as Record<string, unknown>
    : null;
  const rawCidrs = Array.isArray(subnets?.allow)
    ? subnets.allow
    : Array.isArray(record.allowedCIDRs)
      ? record.allowedCIDRs
      : [];
  return {
    networkPolicy: "custom",
    allowedDomains: [...new Set(normalizedDomains.map((domain) => domain.toLowerCase()))].sort(),
    allowedCidrs: [...new Set(rawCidrs.filter((item): item is string => typeof item === "string"))].sort(),
  };
}

function boundedText(value: string, maximumBytes: number, label: string): string {
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error(`${label} exceeds the configured byte limit`);
  }
  return value;
}

function observedUsage(sandbox: object): NonNullable<ManagedSandboxCleanupResult["usage"]> {
  const usage = sandbox as {
    totalActiveCpuDurationMs?: number | undefined;
    totalDurationMs?: number | undefined;
    totalIngressBytes?: number | undefined;
    totalEgressBytes?: number | undefined;
  };
  return {
    totalActiveCpuDurationMs: usage.totalActiveCpuDurationMs ?? null,
    totalDurationMs: usage.totalDurationMs ?? null,
    totalIngressBytes: usage.totalIngressBytes ?? null,
    totalEgressBytes: usage.totalEgressBytes ?? null,
    costUsd: null,
  };
}

export class VercelSandboxProvider implements ManagedSandboxProvider {
  private readonly live = new Map<string, BoundSandbox>();

  async checkAvailability(): Promise<ManagedSandboxAvailability> {
    try {
      await Sandbox.list({ limit: 1 });
      return {
        available: true,
        provider: "VERCEL_SANDBOX",
        checkedAt: new Date().toISOString(),
        authentication: "VERCEL_OIDC_DEVELOPMENT",
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      return {
        available: false,
        provider: "VERCEL_SANDBOX",
        checkedAt: new Date().toISOString(),
        authentication: "VERCEL_OIDC_DEVELOPMENT",
        errorCode: providerErrorCode(error),
        errorMessage: error instanceof Error ? error.message : "Vercel Sandbox availability check failed",
      };
    }
  }

  async createSandbox(input: {
    runId: string;
    jobRunId: string;
    profile: ManagedSandboxSecurityProfile;
  }): Promise<ManagedSandboxHandle> {
    const profile = managedSandboxSecurityProfileSchema.parse(input.profile);
    const sandbox = await Sandbox.create({
      name: `${profile.workflow === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW ? "donelayer-build-test" : "donelayer-smoke"}-${input.runId.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-").slice(0, 30)}`,
      runtime: MANAGED_SANDBOX_RUNTIME,
      timeout: profile.timeoutMs,
      resources: { vcpus: profile.vcpus },
      networkPolicy: profile.networkPolicy,
      persistent: profile.persistent,
      ports: profile.ports,
      env: {
        DONELAYER_JOB_ID: input.jobRunId,
        DONELAYER_SANDBOX_RUN_ID: input.runId,
      },
      tags: {
        owner: "donelayer",
        workflow: profile.workflow === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW
          ? "node-build-test-v1"
          : "sandbox-smoke-v1",
      },
    });
    this.live.set(sandbox.name, {
      sandbox,
      runId: input.runId,
      jobRunId: input.jobRunId,
      profile,
      uploadedFiles: new Set(),
      nextBuildCommandIndex: 0,
      policyPhase: "INITIAL_DENY_ALL",
    });
    return { sandboxId: sandbox.name, runId: input.runId, jobRunId: input.jobRunId };
  }

  async inspectSandbox(handle: ManagedSandboxHandle): Promise<ManagedSandboxInspection> {
    const sandbox = this.required(handle);
    const session = sandbox.currentSession();
    const network = policyDetails(session.networkPolicy ?? sandbox.networkPolicy);
    return {
      provider: "VERCEL_SANDBOX",
      sandboxId: sandbox.name,
      sessionId: session.sessionId,
      status: sandbox.status,
      createdAt: sandbox.createdAt.toISOString(),
      statusUpdatedAt: sandbox.statusUpdatedAt?.toISOString() ?? null,
      region: session.region || sandbox.region || null,
      runtime: sandbox.runtime ?? MANAGED_SANDBOX_RUNTIME,
      image: sandbox.image ?? null,
      persistent: sandbox.persistent,
      timeoutMs: sandbox.timeout ?? 0,
      vcpus: sandbox.vcpus ?? null,
      memoryMb: sandbox.memory ?? null,
      networkPolicy: network.networkPolicy,
      allowedDomains: network.allowedDomains,
      allowedCidrs: network.allowedCidrs,
      portCount: sandbox.routes.length,
      sourceSnapshotId: sandbox.sourceSnapshotId ?? null,
      currentSnapshotId: sandbox.currentSnapshotId ?? null,
      cwd: sandbox.cwd,
      activeCpuUsageMs: session.activeCpuUsageMs ?? null,
      networkIngressBytes: session.networkTransfer?.ingress ?? null,
      networkEgressBytes: session.networkTransfer?.egress ?? null,
    };
  }

  async updateNetworkPolicy(
    handle: ManagedSandboxHandle,
    requestedPolicy: ManagedSandboxNetworkPolicyUpdate,
  ): Promise<ManagedSandboxNetworkPolicyObservation> {
    const policy = managedSandboxNetworkPolicyUpdateSchema.parse(requestedPolicy);
    const bound = this.requiredBound(handle);
    if (bound.profile.workflow !== NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW) {
      throw new Error("Network policy updates are not allowed for this Managed Sandbox workflow");
    }
    if (policy.mode === "custom" && bound.policyPhase !== "INITIAL_DENY_ALL") {
      throw new Error("The npm registry network window may be opened exactly once");
    }
    if (policy.mode === "deny-all" && bound.policyPhase !== "INSTALL_REGISTRY_ONLY") {
      throw new Error("Deny-all may be restored only after the npm registry network window");
    }
    const sdkPolicy = policy.mode === "custom"
      ? { allow: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN] }
      : "deny-all";
    const session = bound.sandbox.currentSession();
    await session.update({ networkPolicy: sdkPolicy });
    const observed = policyDetails(session.networkPolicy);
    if (
      observed.networkPolicy !== policy.mode ||
      JSON.stringify(observed.allowedDomains) !== JSON.stringify([...policy.allowedDomains]) ||
      JSON.stringify(observed.allowedCidrs) !== JSON.stringify([...policy.allowedCidrs])
    ) {
      throw new Error("Provider network policy observation does not match the exact requested policy");
    }
    bound.policyPhase = policy.mode === "custom" ? "INSTALL_REGISTRY_ONLY" : "FINAL_DENY_ALL";
    return {
      mode: policy.mode,
      allowedDomains: [...policy.allowedDomains],
      allowedCidrs: [...policy.allowedCidrs],
      observedAt: new Date().toISOString(),
    };
  }

  async uploadFiles(
    handle: ManagedSandboxHandle,
    files: Array<{ path: string; content: string | Uint8Array; mode?: number }>,
  ): Promise<void> {
    const bound = this.requiredBound(handle);
    const allowed = bound.profile.workflow === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW
      ? MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES as readonly string[]
      : bound.profile.uploadedFiles as readonly string[];
    if (files.length < 1) throw new Error("Managed Sandbox upload must contain at least one file");
    const seen = new Set<string>();
    for (const file of files) {
      if (!allowed.includes(file.path) || bound.uploadedFiles.has(file.path) || seen.has(file.path)) {
        throw new Error("Only workflow-bound Managed Sandbox files may be uploaded once");
      }
      seen.add(file.path);
    }
    if (bound.nextBuildCommandIndex !== 0) throw new Error("Managed Sandbox files cannot be uploaded after execution starts");
    await bound.sandbox.writeFiles(files);
    for (const file of files) bound.uploadedFiles.add(file.path);
  }

  async runCommand(
    handle: ManagedSandboxHandle,
    input: ManagedSandboxCommandInput,
  ): Promise<ManagedSandboxCommandResult> {
    const bound = this.requiredBound(handle);
    const sandbox = bound.sandbox;
    if (bound.profile.workflow === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW) {
      const parsed = managedSandboxBuildTestCommandSchema.safeParse(input);
      if (!parsed.success) throw new Error("Command is not an exact workflow-bound build/test phase");
      const commands = buildTestCommandSequence(bound.profile);
      const expected = commands[bound.nextBuildCommandIndex];
      if (!expected || !sameBuildTestCommand(parsed.data, expected)) {
        throw new Error("Build/test command is out of order or differs from the locked profile");
      }
      if (parsed.data.phase === "prepare") {
        if (bound.uploadedFiles.size !== MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES.length) {
          throw new Error("All verified source package files must be uploaded before preparation");
        }
        if (bound.policyPhase !== "INITIAL_DENY_ALL") throw new Error("Source preparation requires deny-all networking");
      } else if (parsed.data.phase === "install") {
        if (bound.policyPhase !== "INSTALL_REGISTRY_ONLY") throw new Error("npm ci requires the exact registry-only network window");
      } else if (bound.policyPhase !== "FINAL_DENY_ALL") {
        throw new Error("Build, test, and source verification require restored deny-all networking");
      }
    } else {
      const keys = Object.keys(input).sort();
      if (JSON.stringify(keys) !== JSON.stringify(["args", "cmd", "timeoutMs"])) {
        throw new Error("Smoke command input contains unsupported execution options");
      }
      if (
        input.cmd !== bound.profile.command.cmd ||
        JSON.stringify(input.args) !== JSON.stringify(bound.profile.command.args) ||
        !Number.isInteger(input.timeoutMs) ||
        input.timeoutMs < 1 ||
        input.timeoutMs > bound.profile.timeoutMs
      ) {
        throw new Error("Command is not the workflow-bound Managed Sandbox command");
      }
    }
    const startedAt = new Date().toISOString();
    const command = await sandbox.runCommand({
      cmd: input.cmd,
      args: input.args,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      timeoutMs: input.timeoutMs,
    });
    const stdout = boundedText(await command.stdout(), 64 * 1024, "stdout");
    const stderr = boundedText(await command.stderr(), 64 * 1024, "stderr");
    const finishedAt = new Date().toISOString();
    const result = {
      commandId: command.cmdId,
      exitCode: command.exitCode,
      startedAt,
      finishedAt,
      durationMs: command.durationMs ?? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      stdout,
      stderr,
    };
    if (bound.profile.workflow === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW) {
      bound.nextBuildCommandIndex += 1;
    }
    return result;
  }

  async streamLogs(
    handle: ManagedSandboxHandle,
    command: ManagedSandboxCommandResult,
  ): Promise<ManagedSandboxLogStream> {
    this.required(handle);
    return {
      commandId: command.commandId,
      stdout: boundedText(command.stdout, 64 * 1024, "stdout"),
      stderr: boundedText(command.stderr, 64 * 1024, "stderr"),
    };
  }

  async collectArtifact(handle: ManagedSandboxHandle, path: string): Promise<Buffer> {
    const bound = this.requiredBound(handle);
    const allowed = bound.profile.workflow === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW
      ? MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES.map((fileName) => `${MANAGED_SANDBOX_WORKDIR}/${fileName}`)
      : [`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_PROOF_FILE}`];
    if (!allowed.includes(path)) {
      throw new Error("Only workflow-bound Managed Sandbox artifacts may be collected");
    }
    const bytes = await bound.sandbox.readFileToBuffer({ path });
    if (!bytes) throw new Error("Managed sandbox proof artifact was not found");
    return bytes;
  }

  async stopSandbox(handle: ManagedSandboxHandle): Promise<ManagedSandboxCleanupResult> {
    const sandbox = this.required(handle);
    const stopRequestedAt = new Date().toISOString();
    await sandbox.stop();
    const stopConfirmedAt = new Date().toISOString();
    return {
      sandboxId: sandbox.name,
      stopRequestedAt,
      stopConfirmedAt,
      finalProviderState: sandbox.status,
      persistent: sandbox.persistent,
      snapshotCreated: sandbox.currentSnapshotId !== undefined,
      stillRunning: sandbox.status === "running" || sandbox.status === "pending" || sandbox.status === "stopping",
      cleanupVerified: false,
      usage: observedUsage(sandbox),
    };
  }

  async verifyDestroyed(
    handle: ManagedSandboxHandle,
    cleanup: ManagedSandboxCleanupResult,
  ): Promise<ManagedSandboxCleanupResult> {
    this.required(handle);
    const page = await Sandbox.list({
      namePrefix: handle.sandboxId,
      sortBy: "name",
      sortOrder: "asc",
      limit: 10,
    });
    const observed = page.sandboxes.find((item) => item.name === handle.sandboxId);
    const finalState = observed?.status ?? cleanup.finalProviderState;
    const stillRunning = finalState === "running" || finalState === "pending" || finalState === "stopping";
    const snapshotCreated = Boolean(observed?.currentSnapshotId) || cleanup.snapshotCreated;
    const verified = !stillRunning && observed?.persistent === false && !snapshotCreated;
    if (verified) this.live.delete(handle.sandboxId);
    return {
      ...cleanup,
      finalProviderState: finalState,
      persistent: observed?.persistent ?? cleanup.persistent,
      snapshotCreated,
      stillRunning,
      cleanupVerified: verified,
      ...(observed
        ? { usage: observedUsage(observed) }
        : cleanup.usage
          ? { usage: cleanup.usage }
          : {}),
    };
  }

  async observePreviouslyStoppedSandbox(
    handle: ManagedSandboxHandle,
    stopRequestedAt: string,
  ): Promise<ManagedSandboxCleanupResult> {
    const page = await Sandbox.list({
      namePrefix: handle.sandboxId,
      sortBy: "name",
      sortOrder: "asc",
      limit: 10,
    });
    const observed = page.sandboxes.find((item) => item.name === handle.sandboxId);
    if (!observed) throw new Error("Previously created Managed Sandbox is no longer observable");
    const finalProviderState = observed.status;
    const stillRunning = finalProviderState === "running" || finalProviderState === "pending" || finalProviderState === "stopping";
    const snapshotCreated = Boolean(observed.currentSnapshotId);
    return {
      sandboxId: handle.sandboxId,
      stopRequestedAt,
      stopConfirmedAt: observed.statusUpdatedAt
        ? new Date(observed.statusUpdatedAt).toISOString()
        : new Date().toISOString(),
      finalProviderState,
      persistent: observed.persistent,
      snapshotCreated,
      stillRunning,
      cleanupVerified: !stillRunning && observed.persistent === false && !snapshotCreated,
      usage: observedUsage(observed),
    };
  }

  getProviderMetadata(): ManagedSandboxProviderMetadata {
    return {
      provider: "VERCEL_SANDBOX",
      sdkPackage: "@vercel/sandbox",
      sdkVersion,
      authentication: "VERCEL_OIDC_DEVELOPMENT",
    };
  }

  private required(handle: ManagedSandboxHandle): LiveSandbox {
    return this.requiredBound(handle).sandbox;
  }

  private requiredBound(handle: ManagedSandboxHandle): BoundSandbox {
    const bound = this.live.get(handle.sandboxId);
    if (!bound || bound.runId !== handle.runId || bound.jobRunId !== handle.jobRunId) {
      throw new Error("Managed Sandbox handle is not owned by this Job and Sandbox Run");
    }
    return bound;
  }
}

function buildTestCommandSequence(
  profile: Extract<ManagedSandboxSecurityProfile, { workflow: typeof NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW }>,
): ManagedSandboxBuildTestCommand[] {
  return [
    profile.commands.prepare,
    profile.commands.install,
    ...(profile.commands.build ? [profile.commands.build] : []),
    profile.commands.test,
    profile.commands.verify,
  ];
}

function sameBuildTestCommand(
  actual: ManagedSandboxBuildTestCommand,
  expected: ManagedSandboxBuildTestCommand,
): boolean {
  return actual.phase === expected.phase &&
    actual.cmd === expected.cmd &&
    actual.cwd === expected.cwd &&
    actual.timeoutMs === expected.timeoutMs &&
    JSON.stringify(actual.args) === JSON.stringify(expected.args);
}

function providerErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/billing|payment|plan|credit|quota/i.test(message)) return "MANAGED_SANDBOX_BILLING_OR_QUOTA_BLOCKED";
  if (/unauthorized|authentication|oidc|token|forbidden/i.test(message)) return "MANAGED_SANDBOX_AUTH_FAILED";
  return "MANAGED_SANDBOX_PROVIDER_UNAVAILABLE";
}
