import { createHash, randomUUID } from "node:crypto";

import { Sandbox } from "@vercel/sandbox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoStore } from "@donelayer/database";
import {
  MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES,
  MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES,
  MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN,
  MANAGED_SANDBOX_PROOF_FILE,
  MANAGED_SANDBOX_SMOKE_FILE,
  MANAGED_SANDBOX_SOURCE_WORKDIR,
  MANAGED_SANDBOX_WORKDIR,
  NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW,
  ManagedSandboxPermissionGuard,
  managedSandboxBuildTestPermissionScope,
  managedSandboxBuildTestSecurityProfile,
  managedSandboxNetworkPolicyUpdateSchema,
  managedSandboxPermissionScope,
  managedSandboxSecurityProfile,
  managedSandboxSecurityProfileSchema,
  type PermissionLeaseEnvelope,
} from "@donelayer/worker-protocol";
import { ManagedSandboxOrchestrator } from "../../apps/web/src/server/managed-sandbox/orchestrator";
import {
  ManagedSandboxUnavailableProvider,
  type ManagedSandboxAvailability,
  type ManagedSandboxCleanupResult,
  type ManagedSandboxCommandResult,
  type ManagedSandboxHandle,
  type ManagedSandboxInspection,
  type ManagedSandboxLogStream,
  type ManagedSandboxNetworkPolicyObservation,
  type ManagedSandboxProvider,
  type ManagedSandboxProviderMetadata,
} from "../../apps/web/src/server/managed-sandbox/provider";
import { VercelSandboxProvider } from "../../apps/web/src/server/managed-sandbox/vercel-provider";
import { toPublicReceiptView } from "../../apps/web/src/server/public-receipt-view";

const stores: DemoStore[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

function createStore(): DemoStore {
  const store = new DemoStore(":memory:");
  stores.push(store);
  return store;
}

function activeLease(overrides: Partial<PermissionLeaseEnvelope> = {}): PermissionLeaseEnvelope {
  return {
    id: randomUUID(),
    version: 1,
    status: "ACTIVE",
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    scope: managedSandboxPermissionScope(),
    ...overrides,
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function managedInspection(handle: ManagedSandboxHandle, sandboxId = handle.sandboxId): ManagedSandboxInspection {
  return {
    provider: "VERCEL_SANDBOX",
    sandboxId,
    sessionId: "session-real-shape",
    status: "running",
    createdAt: new Date().toISOString(),
    statusUpdatedAt: null,
    region: "iad1",
    runtime: "node24",
    image: null,
    persistent: false,
    timeoutMs: 60_000,
    vcpus: 1,
    memoryMb: 2048,
    networkPolicy: "deny-all",
    allowedDomains: [],
    allowedCidrs: [],
    portCount: 0,
    sourceSnapshotId: null,
    currentSnapshotId: null,
    cwd: "/vercel/sandbox",
    activeCpuUsageMs: null,
    networkIngressBytes: null,
    networkEgressBytes: null,
  };
}

const cleanStop: ManagedSandboxCleanupResult = {
  sandboxId: "sandbox-test",
  stopRequestedAt: new Date().toISOString(),
  stopConfirmedAt: new Date().toISOString(),
  finalProviderState: "stopped",
  persistent: false,
  snapshotCreated: false,
  stillRunning: false,
  cleanupVerified: true,
};

class FailingProvider implements ManagedSandboxProvider {
  createCalls = 0;
  lastCreate: { runId: string; jobRunId: string } | null = null;

  constructor(
    private readonly createError = new Error("provider create failed"),
    private readonly fakeInspectionId: string | null = null,
  ) {}

  async checkAvailability(): Promise<ManagedSandboxAvailability> {
    return { available: true, provider: "VERCEL_SANDBOX", checkedAt: new Date().toISOString(), authentication: "VERCEL_OIDC_DEVELOPMENT", errorCode: null, errorMessage: null };
  }

  async createSandbox(input: { runId: string; jobRunId: string }): Promise<ManagedSandboxHandle> {
    this.createCalls += 1;
    this.lastCreate = { runId: input.runId, jobRunId: input.jobRunId };
    if (!this.fakeInspectionId) throw this.createError;
    return { sandboxId: "sandbox-owned", runId: input.runId, jobRunId: input.jobRunId };
  }

  async inspectSandbox(handle: ManagedSandboxHandle): Promise<ManagedSandboxInspection> {
    return managedInspection(handle, this.fakeInspectionId ?? handle.sandboxId);
  }

  async updateNetworkPolicy(): Promise<ManagedSandboxNetworkPolicyObservation> { throw new Error("unreachable policy update"); }
  async uploadFiles(): Promise<void> { throw new Error("unreachable upload"); }
  async runCommand(): Promise<ManagedSandboxCommandResult> { throw new Error("unreachable command"); }
  async streamLogs(): Promise<ManagedSandboxLogStream> { throw new Error("unreachable logs"); }
  async collectArtifact(): Promise<Buffer> { throw new Error("unreachable artifact"); }
  async stopSandbox(handle: ManagedSandboxHandle): Promise<ManagedSandboxCleanupResult> { return { ...cleanStop, sandboxId: handle.sandboxId }; }
  async verifyDestroyed(_handle: ManagedSandboxHandle, cleanup: ManagedSandboxCleanupResult): Promise<ManagedSandboxCleanupResult> { return cleanup; }
  getProviderMetadata(): ManagedSandboxProviderMetadata {
    return { provider: "VERCEL_SANDBOX", sdkPackage: "@vercel/sandbox", sdkVersion: "test-only", authentication: "VERCEL_OIDC_DEVELOPMENT" };
  }
}

describe("Managed Sandbox policy", () => {
  it("rejects every expansion of the fixed Provider security profile", () => {
    const profile = managedSandboxSecurityProfile();
    const invalidProfiles = [
      { ...profile, provider: "OTHER_PROVIDER" },
      { ...profile, networkPolicy: "allow-all" },
      { ...profile, allowedDomains: ["example.com"] },
      { ...profile, allowedCidrs: ["0.0.0.0/0"] },
      { ...profile, persistent: true },
      { ...profile, snapshot: true },
      { ...profile, timeoutMs: 60_001 },
      { ...profile, command: { cmd: "sh", args: ["-c", "id"] } },
      { ...profile, uploadedFiles: ["repository.tar"] },
      { ...profile, environmentVariableNames: ["VERCEL_OIDC_TOKEN"] },
      { ...profile, localHostExecution: true },
      { ...profile, localDockerExecution: true },
    ];

    for (const candidate of invalidProfiles) {
      expect(managedSandboxSecurityProfileSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("allows only the locked command, file, environment, limits, and active Lease", () => {
    const profile = managedSandboxSecurityProfile();
    const guard = new ManagedSandboxPermissionGuard(activeLease());
    expect(() => guard.assertCreateAllowed(profile)).not.toThrow();
    expect(() => guard.assertUploadAllowed(MANAGED_SANDBOX_SMOKE_FILE)).not.toThrow();
    expect(() => guard.assertCommandAllowed(profile.command)).not.toThrow();
    expect(() => guard.assertEnvironmentAllowed({ DONELAYER_JOB_ID: "job", DONELAYER_SANDBOX_RUN_ID: "run" })).not.toThrow();

    expect(() => guard.assertUploadAllowed(".git/config")).toThrow(/not allowed/i);
    expect(() => guard.assertUploadAllowed("repository.tar")).toThrow(/not allowed/i);
    expect(() => guard.assertCommandAllowed({ cmd: "node", args: ["customer.mjs"] })).toThrow(/not.*allowlisted/i);
    expect(() => guard.assertEnvironmentAllowed({ DONELAYER_JOB_ID: "job", DONELAYER_SANDBOX_RUN_ID: "run", EXTRA: "value" })).toThrow(/environment variable/i);
    expect(() => guard.assertArtifactAllowed(managedSandboxPermissionScope().maxArtifactBytes + 1)).toThrow(/size limit/i);
    expect(() => new ManagedSandboxPermissionGuard(activeLease({ expiresAt: new Date(Date.now() - 1).toISOString() })).assertCreateAllowed(profile)).toThrow(/not active/i);
    const expiredCleanup = new ManagedSandboxPermissionGuard(activeLease({ expiresAt: new Date(Date.now() - 1).toISOString() }));
    expect(() => expiredCleanup.assertSafetyCleanupAllowed("stop_sandbox")).not.toThrow();
    expect(() => expiredCleanup.assertSafetyCleanupAllowed("verify_cleanup")).not.toThrow();
    const revoked = { ...activeLease(), status: "REVOKED" } as unknown as PermissionLeaseEnvelope;
    expect(() => new ManagedSandboxPermissionGuard(revoked).assertCommandAllowed(profile.command)).toThrow(/not active/i);

    const secretScope = { ...managedSandboxPermissionScope(), allowedEnvironmentVariables: ["VERCEL_OIDC_TOKEN"] };
    expect(() => new ManagedSandboxPermissionGuard(activeLease({ scope: secretScope })).assertEnvironmentAllowed({ VERCEL_OIDC_TOKEN: "secret" })).toThrow(/credential-like/i);
  });

  it("binds the build/test workflow to one verified commit, fixed files, commands, and registry window", () => {
    const commitSha = "a".repeat(40);
    const profile = managedSandboxBuildTestSecurityProfile(commitSha, true);
    const scope = managedSandboxBuildTestPermissionScope(commitSha, true);
    const guard = new ManagedSandboxPermissionGuard(activeLease({ scope }));

    expect(profile).toMatchObject({
      workflow: NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW,
      timeoutMs: 300_000,
      vcpus: 1,
      networkPolicy: "deny-all",
      allowedDomains: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN],
      allowedCommitShas: [commitSha],
      sourceWorkdir: MANAGED_SANDBOX_SOURCE_WORKDIR,
      persistent: false,
      snapshot: false,
      ports: [],
      localHostExecution: false,
      localDockerExecution: false,
    });
    expect(managedSandboxSecurityProfileSchema.safeParse(profile).success).toBe(true);
    expect(() => guard.assertCreateAllowed(profile)).not.toThrow();

    for (const fileName of MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES) {
      expect(() => guard.assertUploadAllowed(fileName)).not.toThrow();
    }
    for (const fileName of MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES) {
      expect(() => guard.assertCollectAllowed(fileName)).not.toThrow();
    }
    for (const command of [
      profile.commands.prepare,
      profile.commands.install,
      profile.commands.build!,
      profile.commands.test,
      profile.commands.verify,
    ]) {
      expect(() => guard.assertCommandAllowed(command)).not.toThrow();
    }
    expect(() => guard.assertNetworkPolicyUpdateAllowed(profile.installNetworkPolicy)).not.toThrow();
    expect(() => guard.assertNetworkPolicyUpdateAllowed(profile.finalNetworkPolicy)).not.toThrow();

    expect(() => managedSandboxBuildTestSecurityProfile("b".repeat(39))).toThrow();
    expect(managedSandboxSecurityProfileSchema.safeParse({
      ...profile,
      allowedCommitShas: ["b".repeat(40)],
    }).success).toBe(true);
    expect(() => guard.assertCreateAllowed({ ...profile, allowedCommitShas: ["b".repeat(40)] })).toThrow(/Commit|Lease/i);
    const wrongRepositoryGuard = new ManagedSandboxPermissionGuard(activeLease({
      scope: { ...scope, allowedRepositories: ["https://github.com/example/other.git"] },
    }));
    expect(() => wrongRepositoryGuard.assertCreateAllowed(profile)).toThrow(/Lease/i);
    expect(() => guard.assertUploadAllowed("customer-command.mjs")).toThrow(/not allowed/i);
    expect(() => guard.assertCollectAllowed("package.json")).toThrow(/not collectable/i);
    expect(() => guard.assertCommandAllowed({
      ...profile.commands.install,
      args: ["ci", "--no-audit"],
    })).toThrow(/not.*allowlisted/i);
    expect(() => guard.assertCommandAllowed({
      ...profile.commands.test,
      cwd: MANAGED_SANDBOX_WORKDIR,
    })).toThrow(/not.*allowlisted/i);
    expect(managedSandboxNetworkPolicyUpdateSchema.safeParse({
      mode: "custom",
      allowedDomains: ["example.com"],
      allowedCidrs: [],
    }).success).toBe(false);

    const noBuildProfile = managedSandboxBuildTestSecurityProfile(commitSha, false);
    const noBuildGuard = new ManagedSandboxPermissionGuard(activeLease({
      scope: managedSandboxBuildTestPermissionScope(commitSha, false),
    }));
    expect(noBuildProfile.commands.build).toBeNull();
    expect(() => noBuildGuard.assertCommandAllowed(profile.commands.build!)).toThrow(/not present/i);
  });
});

describe("Managed Sandbox Provider fail-closed behavior", () => {
  it("returns the explicit unavailable error and never creates a local fallback", async () => {
    const provider = new ManagedSandboxUnavailableProvider("OIDC missing");
    const store = createStore();
    const orchestrator = new ManagedSandboxOrchestrator(store, provider);

    await expect(orchestrator.runSmoke()).rejects.toThrow(/MANAGED_SANDBOX_PROVIDER_UNAVAILABLE/);
    const unavailable: ManagedSandboxProvider = provider;
    await expect(unavailable.createSandbox({ runId: "run", jobRunId: "job", profile: managedSandboxSecurityProfile() })).rejects.toThrow(/MANAGED_SANDBOX_PROVIDER_UNAVAILABLE/);
  });

  it("does not retry a create, does not fallback, and cannot issue a Receipt on billing or Provider failure", async () => {
    const provider = new FailingProvider(new Error("billing approval required"));
    const store = createStore();
    const orchestrator = new ManagedSandboxOrchestrator(store, provider);

    await expect(orchestrator.runSmoke()).rejects.toThrow(/billing approval required/);
    expect(provider.createCalls).toBe(1);
    expect(provider.lastCreate).not.toBeNull();
    expect(store.getJobReceiptByJobRun(provider.lastCreate!.jobRunId)).toBeNull();
    expect(store.getManagedSandboxRun(provider.lastCreate!.runId)).toMatchObject({ failureCode: "MANAGED_SANDBOX_BILLING_OR_QUOTA_BLOCKED" });
  });

  it("rejects a Provider inspection that substitutes a fake Sandbox ID", async () => {
    const provider = new FailingProvider(new Error("unused"), "sandbox-fake");
    const store = createStore();
    const orchestrator = new ManagedSandboxOrchestrator(store, provider);

    await expect(orchestrator.runSmoke()).rejects.toThrow(/inspection.*locked|policy/i);
    expect(provider.createCalls).toBe(1);
    expect(store.getJobReceiptByJobRun(provider.lastCreate!.jobRunId)).toBeNull();
  });

  it("binds a live Provider handle to one Job and Sandbox Run", async () => {
    const provider = new VercelSandboxProvider();
    const sandboxId = "sandbox-bound";
    const fakeSandbox = { readFileToBuffer: async () => Buffer.from("proof") };
    const internal = provider as unknown as { live: Map<string, Record<string, unknown>> };
    internal.live.set(sandboxId, {
      sandbox: fakeSandbox,
      runId: "run-a",
      jobRunId: "job-a",
      profile: managedSandboxSecurityProfile(),
      uploadedFiles: new Set(),
      nextBuildCommandIndex: 0,
      policyPhase: "INITIAL_DENY_ALL",
    });

    await expect(provider.collectArtifact(
      { sandboxId, runId: "run-b", jobRunId: "job-b" },
      `${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_PROOF_FILE}`,
    )).rejects.toThrow(/not owned by this Job/i);
  });

  it("uses the Vercel-required name sort when checking a stopped Sandbox by prefix", async () => {
    const provider = new VercelSandboxProvider();
    const handle = { sandboxId: "sandbox-stopped", runId: "run-a", jobRunId: "job-a" };
    const fakeSandbox = {};
    const internal = provider as unknown as { live: Map<string, Record<string, unknown>> };
    internal.live.set(handle.sandboxId, {
      sandbox: fakeSandbox,
      runId: handle.runId,
      jobRunId: handle.jobRunId,
      profile: managedSandboxSecurityProfile(),
      uploadedFiles: new Set(),
      nextBuildCommandIndex: 0,
      policyPhase: "INITIAL_DENY_ALL",
    });
    const list = vi.spyOn(Sandbox, "list").mockResolvedValue({
      sandboxes: [{ name: handle.sandboxId, status: "stopped", persistent: false, currentSnapshotId: undefined }],
    } as never);

    const verified = await provider.verifyDestroyed(handle, { ...cleanStop, sandboxId: handle.sandboxId });

    expect(list).toHaveBeenCalledWith({ namePrefix: handle.sandboxId, sortBy: "name", sortOrder: "asc", limit: 10 });
    expect(verified).toMatchObject({ cleanupVerified: true, stillRunning: false, persistent: false, snapshotCreated: false });
  });

  it("enforces workflow-bound uploads, cwd commands, and a single install-only registry window", async () => {
    const commitSha = "c".repeat(40);
    const profile = managedSandboxBuildTestSecurityProfile(commitSha, true);
    let networkPolicy: unknown = "deny-all";
    const commandInputs: Array<Record<string, unknown>> = [];
    const session = {
      sessionId: "session-build-test",
      region: "iad1",
      activeCpuUsageMs: 0,
      networkTransfer: { ingress: 0, egress: 0 },
      get networkPolicy() { return networkPolicy; },
      update: vi.fn(async ({ networkPolicy: next }: { networkPolicy: unknown }) => { networkPolicy = next; }),
    };
    const fakeSandbox = {
      name: "donelayer-build-test-unit",
      writeFiles: vi.fn(async () => undefined),
      readFileToBuffer: vi.fn(async () => Buffer.from("{}\n")),
      currentSession: () => session,
      runCommand: vi.fn(async (input: Record<string, unknown>) => {
        commandInputs.push(input);
        return {
          cmdId: `cmd-${commandInputs.length}`,
          exitCode: input.cmd === "npm" && JSON.stringify(input.args) === JSON.stringify(["test"]) ? 1 : 0,
          durationMs: 5,
          stdout: async () => "stdout\n",
          stderr: async () => "stderr\n",
        };
      }),
    };
    vi.spyOn(Sandbox, "create").mockResolvedValue(fakeSandbox as never);
    const provider = new VercelSandboxProvider();
    const handle = await provider.createSandbox({ runId: "run-build", jobRunId: "job-build", profile });

    await expect(provider.runCommand(handle, profile.commands.prepare)).rejects.toThrow(/uploaded/i);
    await expect(provider.uploadFiles(handle, [{ path: "unexpected.json", content: "{}" }])).rejects.toThrow(/workflow-bound/i);
    await provider.uploadFiles(handle, MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES.map((path) => ({ path, content: "{}" })));
    await expect(provider.uploadFiles(handle, [{ path: MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES[0], content: "{}" }])).rejects.toThrow(/once/i);

    await provider.runCommand(handle, profile.commands.prepare);
    await expect(provider.runCommand(handle, profile.commands.install)).rejects.toThrow(/registry-only/i);
    const installPolicy = await provider.updateNetworkPolicy(handle, profile.installNetworkPolicy);
    expect(installPolicy).toMatchObject({
      mode: "custom",
      allowedDomains: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN],
      allowedCidrs: [],
    });
    await expect(provider.updateNetworkPolicy(handle, profile.installNetworkPolicy)).rejects.toThrow(/exactly once/i);
    await provider.runCommand(handle, profile.commands.install);
    await expect(provider.runCommand(handle, profile.commands.build!)).rejects.toThrow(/deny-all/i);
    const finalPolicy = await provider.updateNetworkPolicy(handle, profile.finalNetworkPolicy);
    expect(finalPolicy).toMatchObject({ mode: "deny-all", allowedDomains: [], allowedCidrs: [] });
    await provider.runCommand(handle, profile.commands.build!);
    await provider.runCommand(handle, profile.commands.test);
    await provider.runCommand(handle, profile.commands.verify);

    expect(commandInputs.map((input) => input.cwd)).toEqual([
      MANAGED_SANDBOX_WORKDIR,
      MANAGED_SANDBOX_SOURCE_WORKDIR,
      MANAGED_SANDBOX_SOURCE_WORKDIR,
      MANAGED_SANDBOX_SOURCE_WORKDIR,
      MANAGED_SANDBOX_SOURCE_WORKDIR,
    ]);
    expect(commandInputs.every((input) => !("env" in input) && !("detached" in input) && !("shell" in input))).toBe(true);
    await expect(provider.collectArtifact(handle, `${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES[0]}`)).resolves.toEqual(Buffer.from("{}\n"));
    await expect(provider.collectArtifact(handle, `${MANAGED_SANDBOX_WORKDIR}/package.json`)).rejects.toThrow(/workflow-bound/i);
  });
});

function prepareStoppedSmoke(store: DemoStore, exposureOverrides: Record<string, unknown> = {}) {
  const aggregate = store.createManagedSandboxTask();
  const jobRunId = aggregate.jobRun!.id;
  const runId = store.getManagedSandboxRunForJob(jobRunId)!.id;
  store.startManagedSandboxJob(jobRunId);
  store.markManagedSandboxCreated({ runId, providerSandboxId: "sandbox-unit", providerRequestId: null, region: "iad1", inspection: {}, providerMetadata: { sdkVersion: "test-only" } });
  store.markManagedSandboxPolicyVerified(runId, { mode: "deny-all", persistent: false, snapshot: false });
  const proof = {
    schemaVersion: 1,
    jobId: jobRunId,
    sandboxRunId: runId,
    provider: "VERCEL_SANDBOX",
    hostname: "remote-unit",
    nodeVersion: "v24.0.0",
    platform: "linux",
    architecture: "x64",
    cwd: "/vercel/sandbox",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    networkProbe: { blocked: true, outcome: "blocked" },
    localHostExposure: {
      repositoryGitPresent: false,
      repositoryAgentRulesPresent: false,
      repositoryPackagePresent: false,
      localEnvironmentFilePresent: false,
      windowsDriveMountPresent: false,
      credentialLikeEnvironmentNames: [],
      ...exposureOverrides,
    },
  };
  store.recordManagedSandboxNetworkProbe(runId, proof);
  const beforeStop = [
    "managed-sandbox-provider.json",
    "managed-sandbox-policy.json",
    "managed-sandbox-stdout.log",
    "managed-sandbox-stderr.log",
    MANAGED_SANDBOX_PROOF_FILE,
  ] as const;
  for (const fileName of beforeStop) {
    const bytes = Buffer.from(fileName === MANAGED_SANDBOX_PROOF_FILE ? `${JSON.stringify(proof)}\n` : `${fileName}\n`);
    store.persistManagedSandboxArtifact({ runId, artifactType: "UNIT_PROVIDER_EVIDENCE", fileName, mimeType: fileName.endsWith(".json") ? "application/json" : "text/plain", content: bytes, claimedSha256: sha256(bytes) });
  }
  const stopAt = new Date().toISOString();
  store.markManagedSandboxStopRequested(runId, stopAt);
  store.markManagedSandboxStopped(runId, { stopConfirmedAt: stopAt, finalProviderState: "stopped", cleanupVerified: true, persistent: false, snapshotCreated: false, stillRunning: false });
  const afterStop = ["managed-sandbox-lifecycle.json", "managed-sandbox-cleanup.json"] as const;
  for (const fileName of afterStop) {
    const bytes = Buffer.from(`${fileName}\n`);
    store.persistManagedSandboxArtifact({ runId, artifactType: "UNIT_PROVIDER_EVIDENCE", fileName, mimeType: "application/json", content: bytes, claimedSha256: sha256(bytes) });
  }
  return { jobRunId, runId, proof };
}

describe("Managed Sandbox verification and Receipt gates", () => {
  it("rejects a successful network probe and mismatched Artifact SHA-256", () => {
    const store = createStore();
    const aggregate = store.createManagedSandboxTask();
    const jobRunId = aggregate.jobRun!.id;
    const runId = store.getManagedSandboxRunForJob(jobRunId)!.id;
    store.startManagedSandboxJob(jobRunId);
    store.markManagedSandboxCreated({ runId, providerSandboxId: "sandbox-unit", providerRequestId: null, region: null, inspection: {}, providerMetadata: {} });
    store.markManagedSandboxPolicyVerified(runId, { mode: "deny-all" });

    expect(() => store.recordManagedSandboxNetworkProbe(runId, { networkProbe: { blocked: false, outcome: "unexpected-success" } })).toThrow(/not blocked/i);
    const bytes = Buffer.from("actual bytes");
    expect(() => store.persistManagedSandboxArtifact({ runId, artifactType: "MANAGED_SANDBOX_PROOF", fileName: MANAGED_SANDBOX_PROOF_FILE, mimeType: "application/json", content: bytes, claimedSha256: "0".repeat(64) })).toThrow(/SHA-256 mismatch/i);
    expect(store.getJobReceiptByJobRun(jobRunId)).toBeNull();
  });

  it("cannot verify non-zero execution, host exposure, unconfirmed cleanup, or an invalid Ledger", () => {
    const nonZeroStore = createStore();
    const nonZero = prepareStoppedSmoke(nonZeroStore);
    expect(() => nonZeroStore.completeManagedSandboxSmoke({ runId: nonZero.runId, command: { exitCode: 2, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 10 } })).toThrow(/did not exit successfully/i);
    expect(nonZeroStore.getJobReceiptByJobRun(nonZero.jobRunId)).toBeNull();

    const exposedStore = createStore();
    const exposed = prepareStoppedSmoke(exposedStore, { windowsDriveMountPresent: true });
    expect(() => exposedStore.completeManagedSandboxSmoke({ runId: exposed.runId, command: { exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 10 } })).toThrow(/isolation verification/i);
    expect(exposedStore.getJobReceiptByJobRun(exposed.jobRunId)).toBeNull();

    const cleanupStore = createStore();
    const aggregate = cleanupStore.createManagedSandboxTask();
    const cleanupJob = aggregate.jobRun!.id;
    const cleanupRun = cleanupStore.getManagedSandboxRunForJob(cleanupJob)!.id;
    cleanupStore.startManagedSandboxJob(cleanupJob);
    cleanupStore.markManagedSandboxCreated({ runId: cleanupRun, providerSandboxId: "sandbox-running", providerRequestId: null, region: null, inspection: {}, providerMetadata: {} });
    cleanupStore.markManagedSandboxPolicyVerified(cleanupRun, { mode: "deny-all" });
    cleanupStore.markManagedSandboxStopRequested(cleanupRun, new Date().toISOString());
    cleanupStore.markManagedSandboxStopped(cleanupRun, { stopConfirmedAt: new Date().toISOString(), finalProviderState: "running", cleanupVerified: false, persistent: false, snapshotCreated: false, stillRunning: true });
    expect(() => cleanupStore.completeManagedSandboxSmoke({ runId: cleanupRun, command: { exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 10 } })).toThrow(/must be DESTROYED/i);
    expect(cleanupStore.getJobReceiptByJobRun(cleanupJob)).toBeNull();

    const ledgerStore = createStore();
    const ledger = prepareStoppedSmoke(ledgerStore);
    const internal = ledgerStore as unknown as { db: { exec(sql: string): void; prepare(sql: string): { run(...values: unknown[]): unknown } } };
    internal.db.exec("DROP TRIGGER trg_evidence_ledger_no_update");
    internal.db.prepare("UPDATE evidence_ledger_entries SET entry_sha256=? WHERE job_run_id=? AND sequence_number=1").run("f".repeat(64), ledger.jobRunId);
    expect(() => ledgerStore.completeManagedSandboxSmoke({ runId: ledger.runId, command: { exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 10 } })).toThrow(/Ledger is invalid/i);
    expect(ledgerStore.getJobReceiptByJobRun(ledger.jobRunId)).toBeNull();
  });

  it("issues a privacy-filtered public Receipt only after all managed checks pass", () => {
    const store = createStore();
    const prepared = prepareStoppedSmoke(store);
    const completed = store.completeManagedSandboxSmoke({ runId: prepared.runId, command: { exitCode: 0, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 10 } });
    const publicReceipt = store.getPublicJobReceipt(completed.receipt!.receiptPublicId)!;
    const view = toPublicReceiptView({ ...publicReceipt, token: "secret-token", localPath: "C:/Users/private" } as typeof publicReceipt & { token: string; localPath: string });

    expect(view).toMatchObject({
      taskType: "Managed Remote Sandbox Verification",
      result: "VERIFIED",
      managedSandbox: {
        provider: "VERCEL_SANDBOX",
        networkPolicy: "deny-all",
        cleanupVerified: true,
        localHostExecutionUsed: false,
        localDockerUsed: false,
        persistentSnapshotCreated: false,
      },
      scopeDisclaimer: "This receipt verifies a platform-controlled smoke workload executed in a managed remote sandbox. It does not verify repository code, build success, test success, software correctness, or production-grade multi-tenant security.",
    });
    expect(JSON.stringify(view)).not.toContain("secret-token");
    expect(JSON.stringify(view)).not.toContain("C:/Users/private");
  });
});
