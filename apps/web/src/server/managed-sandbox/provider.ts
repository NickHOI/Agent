import type {
  ManagedSandboxNetworkPolicyUpdate,
  ManagedSandboxSecurityProfile,
} from "@donelayer/worker-protocol";

export type ManagedSandboxAvailability = {
  available: boolean;
  provider: "VERCEL_SANDBOX";
  checkedAt: string;
  authentication: "VERCEL_OIDC_DEVELOPMENT";
  errorCode: string | null;
  errorMessage: string | null;
};

export type ManagedSandboxInspection = {
  provider: "VERCEL_SANDBOX";
  sandboxId: string;
  sessionId: string;
  status: string;
  createdAt: string;
  statusUpdatedAt: string | null;
  region: string | null;
  runtime: string;
  image: string | null;
  persistent: boolean;
  timeoutMs: number;
  vcpus: number | null;
  memoryMb: number | null;
  networkPolicy: "deny-all" | "allow-all" | "custom" | "unknown";
  allowedDomains: string[];
  allowedCidrs: string[];
  portCount: number;
  sourceSnapshotId: string | null;
  currentSnapshotId: string | null;
  cwd: string;
  activeCpuUsageMs: number | null;
  networkIngressBytes: number | null;
  networkEgressBytes: number | null;
};

export type ManagedSandboxHandle = {
  sandboxId: string;
  runId: string;
  jobRunId: string;
};

export type ManagedSandboxCommandResult = {
  commandId: string;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export type ManagedSandboxCommandInput = {
  cmd: string;
  args: string[];
  timeoutMs: number;
  phase?: "prepare" | "install" | "build" | "test" | "verify";
  cwd?: string;
};

export type ManagedSandboxNetworkPolicyObservation = {
  mode: "deny-all" | "custom";
  allowedDomains: string[];
  allowedCidrs: string[];
  observedAt: string;
};

export type ManagedSandboxLogStream = {
  commandId: string;
  stdout: string;
  stderr: string;
};

export type ManagedSandboxCleanupResult = {
  sandboxId: string;
  stopRequestedAt: string;
  stopConfirmedAt: string;
  finalProviderState: string;
  persistent: boolean;
  snapshotCreated: boolean;
  stillRunning: boolean;
  cleanupVerified: boolean;
  usage?: {
    totalActiveCpuDurationMs: number | null;
    totalDurationMs: number | null;
    totalIngressBytes: number | null;
    totalEgressBytes: number | null;
    costUsd: null;
  };
};

export type ManagedSandboxProviderMetadata = {
  provider: "VERCEL_SANDBOX";
  sdkPackage: "@vercel/sandbox";
  sdkVersion: string;
  authentication: "VERCEL_OIDC_DEVELOPMENT";
};

export interface ManagedSandboxProvider {
  checkAvailability(): Promise<ManagedSandboxAvailability>;
  createSandbox(input: {
    runId: string;
    jobRunId: string;
    profile: ManagedSandboxSecurityProfile;
  }): Promise<ManagedSandboxHandle>;
  inspectSandbox(handle: ManagedSandboxHandle): Promise<ManagedSandboxInspection>;
  updateNetworkPolicy(
    handle: ManagedSandboxHandle,
    policy: ManagedSandboxNetworkPolicyUpdate,
  ): Promise<ManagedSandboxNetworkPolicyObservation>;
  uploadFiles(handle: ManagedSandboxHandle, files: Array<{ path: string; content: string | Uint8Array; mode?: number }>): Promise<void>;
  runCommand(handle: ManagedSandboxHandle, input: ManagedSandboxCommandInput): Promise<ManagedSandboxCommandResult>;
  streamLogs(handle: ManagedSandboxHandle, command: ManagedSandboxCommandResult): Promise<ManagedSandboxLogStream>;
  collectArtifact(handle: ManagedSandboxHandle, path: string): Promise<Buffer>;
  stopSandbox(handle: ManagedSandboxHandle): Promise<ManagedSandboxCleanupResult>;
  verifyDestroyed(handle: ManagedSandboxHandle, cleanup: ManagedSandboxCleanupResult): Promise<ManagedSandboxCleanupResult>;
  getProviderMetadata(): ManagedSandboxProviderMetadata;
}

export class ManagedSandboxUnavailableProvider implements ManagedSandboxProvider {
  constructor(private readonly reason = "Managed Sandbox provider is not configured") {}

  async checkAvailability(): Promise<ManagedSandboxAvailability> {
    return {
      available: false,
      provider: "VERCEL_SANDBOX",
      checkedAt: new Date().toISOString(),
      authentication: "VERCEL_OIDC_DEVELOPMENT",
      errorCode: "MANAGED_SANDBOX_PROVIDER_UNAVAILABLE",
      errorMessage: this.reason,
    };
  }

  private unavailable(): never {
    throw new Error(`MANAGED_SANDBOX_PROVIDER_UNAVAILABLE: ${this.reason}`);
  }

  async createSandbox(): Promise<ManagedSandboxHandle> { return this.unavailable(); }
  async inspectSandbox(): Promise<ManagedSandboxInspection> { return this.unavailable(); }
  async updateNetworkPolicy(): Promise<ManagedSandboxNetworkPolicyObservation> { return this.unavailable(); }
  async uploadFiles(): Promise<void> { return this.unavailable(); }
  async runCommand(): Promise<ManagedSandboxCommandResult> { return this.unavailable(); }
  async streamLogs(): Promise<ManagedSandboxLogStream> { return this.unavailable(); }
  async collectArtifact(): Promise<Buffer> { return this.unavailable(); }
  async stopSandbox(): Promise<ManagedSandboxCleanupResult> { return this.unavailable(); }
  async verifyDestroyed(): Promise<ManagedSandboxCleanupResult> { return this.unavailable(); }
  getProviderMetadata(): ManagedSandboxProviderMetadata {
    return { provider: "VERCEL_SANDBOX", sdkPackage: "@vercel/sandbox", sdkVersion: "unavailable", authentication: "VERCEL_OIDC_DEVELOPMENT" };
  }
}
