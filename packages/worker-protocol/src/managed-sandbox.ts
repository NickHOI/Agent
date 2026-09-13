import { z } from "zod";

import { PermissionGuard, PermissionViolationError } from "./permission-guard";
import {
  REPOSITORY_MATERIALIZATION_BRANCH,
  REPOSITORY_MATERIALIZATION_REMOTE_URL,
} from "./repository-materialization";
import type { PermissionLeaseEnvelope, PermissionScope } from "./types";

export const MANAGED_SANDBOX_PROVIDER = "VERCEL_SANDBOX" as const;
export const MANAGED_SANDBOX_EXECUTION_BACKEND = "MANAGED_REMOTE_SANDBOX" as const;
export const MANAGED_SANDBOX_ISOLATION_MODEL = "REMOTE_MICROVM" as const;
export const MANAGED_SANDBOX_LIFECYCLE_MODE = "NON_PERSISTENT" as const;
export const MANAGED_SANDBOX_SMOKE_WORKFLOW = "MANAGED_REMOTE_SANDBOX_SMOKE_V1" as const;
export const MANAGED_SANDBOX_TIMEOUT_WORKFLOW = "MANAGED_SANDBOX_TIMEOUT_PROBE_V1" as const;
export const REAL_BUILD_TEST_MANAGED_SANDBOX_TASK = "REAL_BUILD_TEST_MANAGED_SANDBOX_V1" as const;
export const REAL_BUILD_TEST_MANAGED_SANDBOX_TASK_TYPE = REAL_BUILD_TEST_MANAGED_SANDBOX_TASK;
export const NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW = "NODE_BUILD_TEST_MANAGED_SANDBOX_V1" as const;
export const MANAGED_SANDBOX_BUILD_TEST_WORKFLOW = NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW;
export const MANAGED_SANDBOX_RUNTIME = "node24" as const;
export const MANAGED_SANDBOX_WORKDIR = "/vercel/sandbox" as const;
export const MANAGED_SANDBOX_SOURCE_WORKDIR = `${MANAGED_SANDBOX_WORKDIR}/source` as const;
export const MANAGED_SANDBOX_SMOKE_FILE = "smoke-runner.mjs" as const;
export const MANAGED_SANDBOX_PROOF_FILE = "managed-sandbox-proof.json" as const;
export const MANAGED_SANDBOX_TIMEOUT_FILE = "timeout-runner.mjs" as const;
export const MANAGED_SANDBOX_SOURCE_PACKAGE_FILE = "source-package.json" as const;
export const MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE = "source-package-manifest.json" as const;
export const MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE = "source-package-runner.mjs" as const;
export const MANAGED_SANDBOX_SOURCE_PACKAGE_VERIFICATION_FILE = "source-package-verification.json" as const;
export const MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE = "source-integrity-result.json" as const;
export const MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN = "registry.npmjs.org" as const;

export const MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES = [
  MANAGED_SANDBOX_SOURCE_PACKAGE_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE,
  MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE,
] as const;

export const MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES = [
  MANAGED_SANDBOX_SOURCE_PACKAGE_VERIFICATION_FILE,
  MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE,
] as const;

export const MANAGED_SANDBOX_BUILD_TEST_ARTIFACTS = [
  "repository-materialization.json",
  "source-package-metadata.json",
  MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE,
  "managed-build-test-provider.json",
  "managed-build-test-policy.json",
  MANAGED_SANDBOX_SOURCE_PACKAGE_VERIFICATION_FILE,
  "install-result.json",
  "install-stdout.log",
  "install-stderr.log",
  "build-result.json",
  "build-stdout.log",
  "build-stderr.log",
  "test-result.json",
  "test-stdout.log",
  "test-stderr.log",
  MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE,
  "managed-build-test-lifecycle.json",
  "managed-build-test-cleanup.json",
] as const;

export const MANAGED_SANDBOX_BUILD_TEST_ALLOWED_ACTIONS = [
  "materialize_verified_repository",
  "create_source_package",
  "verify_source_manifest",
  "create_managed_sandbox",
  "upload_verified_source_package",
  "extract_source_package",
  "npm_ci",
  "npm_build",
  "npm_test",
  "collect_logs",
  "collect_test_results",
  "collect_build_results",
  "upload_artifacts",
  "calculate_sha256",
  "stop_sandbox",
  "verify_cleanup",
] as const;

export const MANAGED_SANDBOX_BUILD_TEST_DENIED_ACTIONS = [
  "local_host_execution",
  "local_docker_execution",
  "codex_repair",
  "modify_source_code",
  "push",
  "commit",
  "create_pull_request",
  "production_deploy",
  "arbitrary_shell",
  "arbitrary_customer_command",
  "arbitrary_network_access",
  "secret_access",
  "persistent_sandbox",
  "snapshot",
  "access_other_job",
] as const;

export const MANAGED_SANDBOX_ALLOWED_ACTIONS = [
  "check_managed_sandbox_provider",
  "create_non_persistent_sandbox",
  "apply_deny_all_network_policy",
  "upload_smoke_program",
  "run_smoke_program",
  "stream_logs",
  "collect_logs",
  "collect_artifact",
  "calculate_sha256",
  "stop_sandbox",
  "verify_cleanup",
  "report_progress",
] as const;

export const MANAGED_SANDBOX_DENIED_ACTIONS = [
  "local_host_execution",
  "local_docker_execution",
  "customer_code",
  "repository_code",
  "arbitrary_command",
  "arbitrary_file_upload",
  "arbitrary_environment_variable",
  "inject_secret",
  "unrestricted_network",
  "persistent_sandbox",
  "snapshot",
  "git_clone",
  "npm_install",
  "npm_ci",
  "npm_test",
  "npm_build",
  "codex",
  "deploy",
  "access_other_job",
] as const;

export const MANAGED_SANDBOX_ARTIFACTS = [
  "managed-sandbox-provider.json",
  "managed-sandbox-policy.json",
  "managed-sandbox-lifecycle.json",
  "managed-sandbox-stdout.log",
  "managed-sandbox-stderr.log",
  MANAGED_SANDBOX_PROOF_FILE,
  "managed-sandbox-cleanup.json",
] as const;

const noExtraStrings = z.array(z.string()).length(0);
const exactSmokeCommandSchema = z.object({
  cmd: z.literal("node"),
  args: z.tuple([z.literal(`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SMOKE_FILE}`)]),
}).strict();
const exactTimeoutCommandSchema = z.object({
  cmd: z.literal("node"),
  args: z.tuple([z.literal(`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_TIMEOUT_FILE}`)]),
}).strict();

export const managedSandboxBuildTestCommandSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("prepare"),
    cmd: z.literal("node"),
    args: z.tuple([
      z.literal(`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE}`),
      z.literal("prepare"),
    ]),
    cwd: z.literal(MANAGED_SANDBOX_WORKDIR),
    timeoutMs: z.literal(30_000),
  }).strict(),
  z.object({
    phase: z.literal("install"),
    cmd: z.literal("npm"),
    args: z.tuple([
      z.literal("ci"),
      z.literal("--ignore-scripts"),
      z.literal("--no-audit"),
      z.literal("--no-fund"),
    ]),
    cwd: z.literal(MANAGED_SANDBOX_SOURCE_WORKDIR),
    timeoutMs: z.literal(120_000),
  }).strict(),
  z.object({
    phase: z.literal("build"),
    cmd: z.literal("npm"),
    args: z.tuple([z.literal("run"), z.literal("build")]),
    cwd: z.literal(MANAGED_SANDBOX_SOURCE_WORKDIR),
    timeoutMs: z.literal(60_000),
  }).strict(),
  z.object({
    phase: z.literal("test"),
    cmd: z.literal("npm"),
    args: z.tuple([z.literal("test")]),
    cwd: z.literal(MANAGED_SANDBOX_SOURCE_WORKDIR),
    timeoutMs: z.literal(60_000),
  }).strict(),
  z.object({
    phase: z.literal("verify"),
    cmd: z.literal("node"),
    args: z.tuple([
      z.literal(`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE}`),
      z.literal("verify"),
    ]),
    cwd: z.literal(MANAGED_SANDBOX_SOURCE_WORKDIR),
    timeoutMs: z.literal(30_000),
  }).strict(),
]);

export type ManagedSandboxBuildTestCommand = z.infer<typeof managedSandboxBuildTestCommandSchema>;

export const managedSandboxNetworkPolicyUpdateSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("custom"),
    allowedDomains: z.tuple([z.literal(MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN)]),
    allowedCidrs: z.array(z.string()).length(0),
  }).strict(),
  z.object({
    mode: z.literal("deny-all"),
    allowedDomains: z.array(z.string()).length(0),
    allowedCidrs: z.array(z.string()).length(0),
  }).strict(),
]);

export type ManagedSandboxNetworkPolicyUpdate = z.infer<typeof managedSandboxNetworkPolicyUpdateSchema>;

const managedSandboxCommonProfile = {
  provider: z.literal(MANAGED_SANDBOX_PROVIDER),
  executionBackendType: z.literal(MANAGED_SANDBOX_EXECUTION_BACKEND),
  isolationModel: z.literal(MANAGED_SANDBOX_ISOLATION_MODEL),
  lifecycleMode: z.literal(MANAGED_SANDBOX_LIFECYCLE_MODE),
  runtime: z.literal(MANAGED_SANDBOX_RUNTIME),
  persistent: z.literal(false),
  snapshot: z.literal(false),
  timeoutMs: z.literal(60_000),
  vcpus: z.literal(1),
  networkPolicy: z.literal("deny-all"),
  allowedDomains: noExtraStrings,
  allowedCidrs: noExtraStrings,
  ports: z.array(z.number()).length(0),
  environmentVariableNames: z.tuple([
    z.literal("DONELAYER_JOB_ID"),
    z.literal("DONELAYER_SANDBOX_RUN_ID"),
  ]),
  localHostExecution: z.literal(false),
  localDockerExecution: z.literal(false),
} as const;

export const managedSandboxSecurityProfileSchema = z.discriminatedUnion("workflow", [
  z.object({
    ...managedSandboxCommonProfile,
    workflow: z.literal(MANAGED_SANDBOX_SMOKE_WORKFLOW),
    uploadedFiles: z.tuple([z.literal(MANAGED_SANDBOX_SMOKE_FILE)]),
    command: exactSmokeCommandSchema,
  }).strict(),
  z.object({
    ...managedSandboxCommonProfile,
    workflow: z.literal(MANAGED_SANDBOX_TIMEOUT_WORKFLOW),
    timeoutMs: z.literal(10_000),
    uploadedFiles: z.tuple([z.literal(MANAGED_SANDBOX_TIMEOUT_FILE)]),
    command: exactTimeoutCommandSchema,
  }).strict(),
  z.object({
    ...managedSandboxCommonProfile,
    workflow: z.literal(NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW),
    timeoutMs: z.literal(300_000),
    allowedDomains: z.tuple([z.literal(MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN)]),
    uploadedFiles: z.tuple([
      z.literal(MANAGED_SANDBOX_SOURCE_PACKAGE_FILE),
      z.literal(MANAGED_SANDBOX_SOURCE_PACKAGE_MANIFEST_FILE),
      z.literal(MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE),
    ]),
    collectableFiles: z.tuple([
      z.literal(MANAGED_SANDBOX_SOURCE_PACKAGE_VERIFICATION_FILE),
      z.literal(MANAGED_SANDBOX_SOURCE_INTEGRITY_FILE),
    ]),
    sourceWorkdir: z.literal(MANAGED_SANDBOX_SOURCE_WORKDIR),
    allowedCommitShas: z.tuple([z.string().regex(/^[a-f0-9]{40}$/)]),
    installNetworkPolicy: z.object({
      mode: z.literal("custom"),
      allowedDomains: z.tuple([z.literal(MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN)]),
      allowedCidrs: z.array(z.string()).length(0),
    }).strict(),
    finalNetworkPolicy: z.object({
      mode: z.literal("deny-all"),
      allowedDomains: z.array(z.string()).length(0),
      allowedCidrs: z.array(z.string()).length(0),
    }).strict(),
    commands: z.object({
      prepare: managedSandboxBuildTestCommandSchema.options[0],
      install: managedSandboxBuildTestCommandSchema.options[1],
      build: managedSandboxBuildTestCommandSchema.options[2].nullable(),
      test: managedSandboxBuildTestCommandSchema.options[3],
      verify: managedSandboxBuildTestCommandSchema.options[4],
    }).strict(),
  }).strict(),
]);

export type ManagedSandboxSecurityProfile = z.infer<typeof managedSandboxSecurityProfileSchema>;

export function managedSandboxSecurityProfile(): Extract<
  ManagedSandboxSecurityProfile,
  { workflow: typeof MANAGED_SANDBOX_SMOKE_WORKFLOW }
> {
  return {
    provider: MANAGED_SANDBOX_PROVIDER,
    executionBackendType: MANAGED_SANDBOX_EXECUTION_BACKEND,
    isolationModel: MANAGED_SANDBOX_ISOLATION_MODEL,
    lifecycleMode: MANAGED_SANDBOX_LIFECYCLE_MODE,
    workflow: MANAGED_SANDBOX_SMOKE_WORKFLOW,
    runtime: MANAGED_SANDBOX_RUNTIME,
    persistent: false,
    snapshot: false,
    timeoutMs: 60_000,
    vcpus: 1,
    networkPolicy: "deny-all",
    allowedDomains: [],
    allowedCidrs: [],
    ports: [],
    environmentVariableNames: ["DONELAYER_JOB_ID", "DONELAYER_SANDBOX_RUN_ID"],
    uploadedFiles: [MANAGED_SANDBOX_SMOKE_FILE],
    command: { cmd: "node", args: [`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SMOKE_FILE}`] },
    localHostExecution: false,
    localDockerExecution: false,
  };
}

export function managedSandboxPermissionScope(): PermissionScope {
  return {
    allowedActions: [...MANAGED_SANDBOX_ALLOWED_ACTIONS],
    deniedActions: [...MANAGED_SANDBOX_DENIED_ACTIONS],
    allowedPaths: [MANAGED_SANDBOX_WORKDIR],
    allowedDomains: [],
    allowedSandboxProviders: [MANAGED_SANDBOX_PROVIDER],
    allowedExecutionBackends: [MANAGED_SANDBOX_EXECUTION_BACKEND],
    allowedWorkflows: [MANAGED_SANDBOX_SMOKE_WORKFLOW],
    allowedFiles: [MANAGED_SANDBOX_SMOKE_FILE, MANAGED_SANDBOX_PROOF_FILE],
    allowedEnvironmentVariables: ["DONELAYER_JOB_ID", "DONELAYER_SANDBOX_RUN_ID"],
    maxArtifactBytes: 256 * 1024,
    maxRuntimeSeconds: 60,
    maxApiBudget: 0,
    maxSandboxes: 1,
    maxCommands: 1,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
    networkPolicy: "deny-all",
    persistence: "none",
    humanApprovalActions: [],
  };
}

export function managedSandboxTimeoutSecurityProfile(): Extract<
  ManagedSandboxSecurityProfile,
  { workflow: typeof MANAGED_SANDBOX_TIMEOUT_WORKFLOW }
> {
  return {
    ...managedSandboxSecurityProfile(),
    workflow: MANAGED_SANDBOX_TIMEOUT_WORKFLOW,
    timeoutMs: 10_000,
    uploadedFiles: [MANAGED_SANDBOX_TIMEOUT_FILE],
    command: { cmd: "node", args: [`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_TIMEOUT_FILE}`] },
  };
}

export function managedSandboxTimeoutPermissionScope(): PermissionScope {
  return {
    ...managedSandboxPermissionScope(),
    allowedWorkflows: [MANAGED_SANDBOX_TIMEOUT_WORKFLOW],
    allowedFiles: [MANAGED_SANDBOX_TIMEOUT_FILE],
    maxRuntimeSeconds: 10,
  };
}

export function managedSandboxBuildTestSecurityProfile(
  verifiedCommitSha: string,
  buildScriptPresent = true,
): Extract<ManagedSandboxSecurityProfile, { workflow: typeof NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW }> {
  const commitSha = z.string().regex(/^[a-f0-9]{40}$/).parse(verifiedCommitSha);
  return managedSandboxSecurityProfileSchema.parse({
    provider: MANAGED_SANDBOX_PROVIDER,
    executionBackendType: MANAGED_SANDBOX_EXECUTION_BACKEND,
    isolationModel: MANAGED_SANDBOX_ISOLATION_MODEL,
    lifecycleMode: MANAGED_SANDBOX_LIFECYCLE_MODE,
    workflow: NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW,
    runtime: MANAGED_SANDBOX_RUNTIME,
    persistent: false,
    snapshot: false,
    timeoutMs: 300_000,
    vcpus: 1,
    networkPolicy: "deny-all",
    allowedDomains: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN],
    allowedCidrs: [],
    ports: [],
    environmentVariableNames: ["DONELAYER_JOB_ID", "DONELAYER_SANDBOX_RUN_ID"],
    uploadedFiles: [...MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES],
    collectableFiles: [...MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES],
    sourceWorkdir: MANAGED_SANDBOX_SOURCE_WORKDIR,
    allowedCommitShas: [commitSha],
    installNetworkPolicy: {
      mode: "custom",
      allowedDomains: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN],
      allowedCidrs: [],
    },
    finalNetworkPolicy: { mode: "deny-all", allowedDomains: [], allowedCidrs: [] },
    commands: {
      prepare: {
        phase: "prepare",
        cmd: "node",
        args: [`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE}`, "prepare"],
        cwd: MANAGED_SANDBOX_WORKDIR,
        timeoutMs: 30_000,
      },
      install: {
        phase: "install",
        cmd: "npm",
        args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd: MANAGED_SANDBOX_SOURCE_WORKDIR,
        timeoutMs: 120_000,
      },
      build: buildScriptPresent
        ? {
            phase: "build",
            cmd: "npm",
            args: ["run", "build"],
            cwd: MANAGED_SANDBOX_SOURCE_WORKDIR,
            timeoutMs: 60_000,
          }
        : null,
      test: {
        phase: "test",
        cmd: "npm",
        args: ["test"],
        cwd: MANAGED_SANDBOX_SOURCE_WORKDIR,
        timeoutMs: 60_000,
      },
      verify: {
        phase: "verify",
        cmd: "node",
        args: [`${MANAGED_SANDBOX_WORKDIR}/${MANAGED_SANDBOX_SOURCE_PACKAGE_RUNNER_FILE}`, "verify"],
        cwd: MANAGED_SANDBOX_SOURCE_WORKDIR,
        timeoutMs: 30_000,
      },
    },
    localHostExecution: false,
    localDockerExecution: false,
  }) as Extract<ManagedSandboxSecurityProfile, { workflow: typeof NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW }>;
}

export function managedSandboxBuildTestPermissionScope(
  verifiedCommitSha: string,
  buildScriptPresent = true,
): PermissionScope {
  const profile = managedSandboxBuildTestSecurityProfile(verifiedCommitSha, buildScriptPresent);
  return {
    allowedActions: [...MANAGED_SANDBOX_BUILD_TEST_ALLOWED_ACTIONS],
    deniedActions: [...MANAGED_SANDBOX_BUILD_TEST_DENIED_ACTIONS],
    allowedPaths: [MANAGED_SANDBOX_WORKDIR, MANAGED_SANDBOX_SOURCE_WORKDIR],
    allowedDomains: [MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN],
    allowedRepositories: [REPOSITORY_MATERIALIZATION_REMOTE_URL],
    allowedBranches: [REPOSITORY_MATERIALIZATION_BRANCH],
    allowedCommitShas: [...profile.allowedCommitShas],
    allowedSandboxProviders: [MANAGED_SANDBOX_PROVIDER],
    allowedExecutionBackends: [MANAGED_SANDBOX_EXECUTION_BACKEND],
    allowedWorkflows: [NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW],
    allowedFiles: [
      ...MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES,
      ...MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES,
    ],
    allowedEnvironmentVariables: ["DONELAYER_JOB_ID", "DONELAYER_SANDBOX_RUN_ID"],
    maxArtifactBytes: 2 * 1024 * 1024,
    maxRuntimeSeconds: 300,
    maxApiBudget: 0,
    maxSandboxes: 1,
    maxCommands: profile.commands.build ? 5 : 4,
    maxStdoutBytes: 256 * 1024,
    maxStderrBytes: 256 * 1024,
    networkPolicy: "deny-all",
    persistence: "none",
    humanApprovalActions: [],
  };
}

export class ManagedSandboxPermissionGuard extends PermissionGuard {
  constructor(lease: PermissionLeaseEnvelope, options: ConstructorParameters<typeof PermissionGuard>[1] = {}) {
    super(lease, options);
  }

  assertCreateAllowed(profile: ManagedSandboxSecurityProfile, at = new Date()): void {
    const buildTest = profile.workflow === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW;
    const createAction = buildTest ? "create_managed_sandbox" : "create_non_persistent_sandbox";
    this.assertActionAllowed(createAction, at);
    const parsed = managedSandboxSecurityProfileSchema.safeParse(profile);
    if (!parsed.success) this.failManaged("create_non_persistent_sandbox", "Sandbox security profile is not allowlisted");
    const scope = this.lease.scope;
    if (
      scope.allowedSandboxProviders?.length !== 1 ||
      scope.allowedSandboxProviders[0] !== profile.provider ||
      scope.allowedExecutionBackends?.length !== 1 ||
      scope.allowedExecutionBackends[0] !== profile.executionBackendType ||
      scope.allowedWorkflows?.length !== 1 ||
      scope.allowedWorkflows[0] !== profile.workflow ||
      scope.networkPolicy !== "deny-all" ||
      scope.persistence !== "none" ||
      scope.maxSandboxes !== 1 ||
      profile.timeoutMs > scope.maxRuntimeSeconds * 1000
    ) {
      this.failManaged(createAction, "Sandbox request exceeds the Permission Lease");
    }
    if (buildTest) {
      const expectedCommands = profile.commands.build ? 5 : 4;
      if (
        scope.maxCommands !== expectedCommands ||
        JSON.stringify(scope.allowedDomains) !== JSON.stringify([MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN]) ||
        JSON.stringify(scope.allowedCommitShas) !== JSON.stringify(profile.allowedCommitShas) ||
        JSON.stringify(scope.allowedRepositories) !== JSON.stringify([REPOSITORY_MATERIALIZATION_REMOTE_URL]) ||
        JSON.stringify(scope.allowedBranches) !== JSON.stringify([REPOSITORY_MATERIALIZATION_BRANCH]) ||
        JSON.stringify(scope.allowedFiles) !== JSON.stringify([
          ...MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES,
          ...MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES,
        ]) ||
        JSON.stringify(scope.allowedEnvironmentVariables) !== JSON.stringify([
          "DONELAYER_JOB_ID",
          "DONELAYER_SANDBOX_RUN_ID",
        ]) ||
        JSON.stringify(scope.allowedActions) !== JSON.stringify([...MANAGED_SANDBOX_BUILD_TEST_ALLOWED_ACTIONS]) ||
        JSON.stringify(scope.deniedActions) !== JSON.stringify([...MANAGED_SANDBOX_BUILD_TEST_DENIED_ACTIONS])
      ) {
        this.failManaged("create_managed_sandbox", "Build/Test Sandbox request exceeds the Permission Lease");
      }
      return;
    }
    if (scope.maxCommands !== 1 || scope.allowedDomains.length !== 0) {
      this.failManaged("create_non_persistent_sandbox", "Sandbox request exceeds the Permission Lease");
    }
  }

  assertUploadAllowed(fileName: string, at = new Date()): void {
    const buildTest = this.lease.scope.allowedWorkflows?.[0] === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW;
    this.assertActionAllowed(buildTest ? "upload_verified_source_package" : "upload_smoke_program", at);
    if (buildTest && !(MANAGED_SANDBOX_BUILD_TEST_UPLOAD_FILES as readonly string[]).includes(fileName)) {
      this.failManaged("upload_verified_source_package", "File upload is not allowed by the build/test workflow", fileName);
    }
    if (!this.lease.scope.allowedFiles?.includes(fileName)) {
      this.failManaged(buildTest ? "upload_verified_source_package" : "upload_smoke_program", "File upload is not allowed by this Permission Lease", fileName);
    }
  }

  assertCommandAllowed(command: { cmd: string; args: string[]; phase?: string; cwd?: string; timeoutMs?: number }, at = new Date()): void {
    const buildTest = this.lease.scope.allowedWorkflows?.[0] === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW;
    if (buildTest) {
      const parsed = managedSandboxBuildTestCommandSchema.safeParse(command);
      if (!parsed.success) this.failManaged("arbitrary_customer_command", "Command is not a platform allowlisted build/test phase");
      const action = parsed.data.phase === "prepare"
        ? "extract_source_package"
        : parsed.data.phase === "install"
          ? "npm_ci"
          : parsed.data.phase === "build"
            ? "npm_build"
            : parsed.data.phase === "test"
              ? "npm_test"
              : "calculate_sha256";
      this.assertActionAllowed(action, at);
      if (parsed.data.phase === "build" && this.lease.scope.maxCommands !== 5) {
        this.failManaged("npm_build", "Build command is not present in the locked workflow");
      }
      return;
    }
    this.assertActionAllowed("run_smoke_program", at);
    const expectedTimeout = this.lease.scope.allowedWorkflows?.[0] === MANAGED_SANDBOX_TIMEOUT_WORKFLOW;
    const parsed = expectedTimeout
      ? exactTimeoutCommandSchema.safeParse(command)
      : exactSmokeCommandSchema.safeParse(command);
    if (!parsed.success) this.failManaged("run_smoke_program", "Command is not the platform allowlisted smoke command");
  }

  assertNetworkPolicyUpdateAllowed(policy: ManagedSandboxNetworkPolicyUpdate, at = new Date()): void {
    this.assertLeaseActive(at);
    if (this.lease.scope.allowedWorkflows?.[0] !== NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW) {
      this.failManaged("arbitrary_network_access", "Network policy updates are limited to the build/test workflow");
    }
    const parsed = managedSandboxNetworkPolicyUpdateSchema.safeParse(policy);
    if (!parsed.success) this.failManaged("arbitrary_network_access", "Network policy update is not allowlisted");
    if (parsed.data.mode === "custom") this.assertActionAllowed("npm_ci", at);
    if (JSON.stringify(this.lease.scope.allowedDomains) !== JSON.stringify([MANAGED_SANDBOX_NPM_REGISTRY_DOMAIN])) {
      this.failManaged("arbitrary_network_access", "Registry domain is not bound by the Permission Lease");
    }
  }

  assertCollectAllowed(fileName: string, at = new Date()): void {
    const buildTest = this.lease.scope.allowedWorkflows?.[0] === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW;
    this.assertActionAllowed(buildTest ? "upload_artifacts" : "collect_artifact", at);
    if (buildTest && !(MANAGED_SANDBOX_BUILD_TEST_COLLECTABLE_FILES as readonly string[]).includes(fileName)) {
      this.failManaged("upload_artifacts", "Remote artifact is not collectable by the build/test workflow", fileName);
    }
    if (!this.lease.scope.allowedFiles?.includes(fileName)) {
      this.failManaged(buildTest ? "upload_artifacts" : "collect_artifact", "Remote artifact is not allowed by this Permission Lease", fileName);
    }
  }

  assertEnvironmentAllowed(environment: Record<string, string>, at = new Date()): void {
    this.assertLeaseActive(at);
    const actual = Object.keys(environment).sort();
    const allowed = [...(this.lease.scope.allowedEnvironmentVariables ?? [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
      this.failManaged("arbitrary_environment_variable", "Environment variable names exceed the Permission Lease");
    }
    if (actual.some((key) => /(TOKEN|SECRET|KEY|CREDENTIAL|PASSWORD)/i.test(key))) {
      this.failManaged("inject_secret", "Credential-like environment variables are prohibited");
    }
  }

  assertArtifactAllowed(size: number, at = new Date()): void {
    const buildTest = this.lease.scope.allowedWorkflows?.[0] === NODE_BUILD_TEST_MANAGED_SANDBOX_WORKFLOW;
    this.assertActionAllowed(buildTest ? "upload_artifacts" : "collect_artifact", at);
    if (!Number.isSafeInteger(size) || size < 1 || size > this.lease.scope.maxArtifactBytes) {
      this.failManaged("collect_artifact", "Artifact exceeds the Permission Lease size limit", String(size));
    }
  }

  assertOutputAllowed(stdoutBytes: number, stderrBytes: number, at = new Date()): void {
    this.assertActionAllowed("collect_logs", at);
    if (
      stdoutBytes > (this.lease.scope.maxStdoutBytes ?? 0) ||
      stderrBytes > (this.lease.scope.maxStderrBytes ?? 0)
    ) {
      this.failManaged("collect_logs", "Sandbox output exceeds the Permission Lease limit");
    }
  }

  assertSafetyCleanupAllowed(action: "stop_sandbox" | "verify_cleanup"): void {
    if (this.lease.scope.deniedActions.includes(action)) {
      this.failManaged(action, `Safety cleanup action ${action} is explicitly denied`);
    }
    if (!this.lease.scope.allowedActions.includes(action)) {
      this.failManaged(action, `Safety cleanup action ${action} is not granted by this Permission Lease`);
    }
  }

  private failManaged(action: string, reason: string, resource?: string): never {
    throw this.recordViolation(action, reason, resource);
  }
}

export function isPermissionViolation(error: unknown): error is PermissionViolationError {
  return error instanceof PermissionViolationError;
}
