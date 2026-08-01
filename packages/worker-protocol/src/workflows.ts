import type { SafeCommandId, WorkflowTemplateId } from "./types";

export type SafeCommandDefinition = {
  id: SafeCommandId;
  executable: string;
  args: readonly string[];
  networkRequired: boolean;
};

export const SAFE_COMMAND_REGISTRY: Readonly<Record<SafeCommandId, SafeCommandDefinition>> = {
  NPM_INSTALL_CI: { id: "NPM_INSTALL_CI", executable: "npm", args: ["ci", "--ignore-scripts"], networkRequired: true },
  NPM_TEST: { id: "NPM_TEST", executable: "npm", args: ["test", "--", "--runInBand"], networkRequired: false },
  NPM_BUILD: { id: "NPM_BUILD", executable: "npm", args: ["run", "build"], networkRequired: false },
  NPM_LINT: { id: "NPM_LINT", executable: "npm", args: ["run", "lint"], networkRequired: false },
  PNPM_INSTALL_FROZEN: { id: "PNPM_INSTALL_FROZEN", executable: "pnpm", args: ["install", "--frozen-lockfile", "--ignore-scripts"], networkRequired: true },
  PNPM_TEST: { id: "PNPM_TEST", executable: "pnpm", args: ["test"], networkRequired: false },
  PNPM_BUILD: { id: "PNPM_BUILD", executable: "pnpm", args: ["build"], networkRequired: false },
  PNPM_LINT: { id: "PNPM_LINT", executable: "pnpm", args: ["lint"], networkRequired: false },
  YARN_INSTALL_IMMUTABLE: { id: "YARN_INSTALL_IMMUTABLE", executable: "yarn", args: ["install", "--immutable", "--mode=skip-build"], networkRequired: true },
  YARN_TEST: { id: "YARN_TEST", executable: "yarn", args: ["test"], networkRequired: false },
  YARN_BUILD: { id: "YARN_BUILD", executable: "yarn", args: ["build"], networkRequired: false },
  YARN_LINT: { id: "YARN_LINT", executable: "yarn", args: ["lint"], networkRequired: false },
  CARGO_TEST: { id: "CARGO_TEST", executable: "cargo", args: ["test", "--locked"], networkRequired: false },
  CARGO_BUILD: { id: "CARGO_BUILD", executable: "cargo", args: ["build", "--locked"], networkRequired: false },
  PYTHON_PYTEST: { id: "PYTHON_PYTEST", executable: "python", args: ["-m", "pytest"], networkRequired: false },
  GO_TEST: { id: "GO_TEST", executable: "go", args: ["test", "./..."], networkRequired: false },
  SWIFT_TEST: { id: "SWIFT_TEST", executable: "swift", args: ["test"], networkRequired: false },
  XCODEBUILD_TEST: { id: "XCODEBUILD_TEST", executable: "xcodebuild", args: ["test"], networkRequired: false },
};

const TEMPLATE_COMMANDS: Readonly<Record<WorkflowTemplateId, readonly SafeCommandId[]>> = {
  DIAGNOSE_REPOSITORY: ["NPM_TEST", "NPM_BUILD", "CARGO_TEST", "PYTHON_PYTEST", "GO_TEST", "SWIFT_TEST"],
  BUILD_RESCUE: ["NPM_BUILD", "PNPM_BUILD", "YARN_BUILD", "CARGO_BUILD"],
  TEST_AND_FIX: ["NPM_TEST", "PNPM_TEST", "YARN_TEST", "CARGO_TEST", "PYTHON_PYTEST", "GO_TEST", "SWIFT_TEST", "XCODEBUILD_TEST"],
  FEATURE_COMPLETION: ["NPM_TEST", "NPM_BUILD", "PNPM_TEST", "PNPM_BUILD", "YARN_TEST", "YARN_BUILD", "CARGO_TEST", "CARGO_BUILD", "PYTHON_PYTEST", "GO_TEST", "SWIFT_TEST"],
  PULL_REQUEST_VERIFICATION: ["NPM_TEST", "NPM_BUILD", "NPM_LINT", "PNPM_TEST", "PNPM_BUILD", "PNPM_LINT", "YARN_TEST", "YARN_BUILD", "YARN_LINT", "CARGO_TEST", "PYTHON_PYTEST", "GO_TEST", "SWIFT_TEST"],
  LAUNCH_READINESS: ["NPM_TEST", "NPM_BUILD", "NPM_LINT", "PNPM_TEST", "PNPM_BUILD", "PNPM_LINT", "YARN_TEST", "YARN_BUILD", "YARN_LINT", "CARGO_TEST", "CARGO_BUILD", "PYTHON_PYTEST", "GO_TEST", "SWIFT_TEST", "XCODEBUILD_TEST"],
};

export function isCommandAllowed(template: WorkflowTemplateId, commandId: SafeCommandId): boolean {
  return TEMPLATE_COMMANDS[template].includes(commandId);
}

export function assertCommandAllowed(template: WorkflowTemplateId, commandId: SafeCommandId): void {
  if (!isCommandAllowed(template, commandId)) {
    throw new Error(`${commandId} is not allowed by workflow template ${template}`);
  }
}
