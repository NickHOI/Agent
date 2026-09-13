import { createHash } from "node:crypto";

import { z } from "zod";

import type { AgentExecutionTool, AgentRepairToolName } from "./provider";
import type { RepairSandboxCommand } from "./vercel-agent-repair-sandbox";
import { VercelAgentRepairSandbox } from "./vercel-agent-repair-sandbox";

export type AgentRepairToolCallEvidence = {
  sequence: number;
  toolName: AgentRepairToolName;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
};

export type AgentRepairToolSet = {
  tools: Record<AgentRepairToolName, AgentExecutionTool>;
  calls: AgentRepairToolCallEvidence[];
  getLastRepairTest(): RepairSandboxCommand | null;
  getLastBuild(): RepairSandboxCommand | null;
};

export type AgentRepairToolSandbox = Pick<
  VercelAgentRepairSandbox,
  | "listFiles"
  | "readFile"
  | "inspectTestFailure"
  | "applyPatch"
  | "runTest"
  | "runBuild"
  | "getDiff"
  | "getSourceIntegrity"
>;

const emptyInput = z.object({}).strict();
const pathInput = z.object({ path: z.string().min(1).max(240) }).strict();
const patchInput = z.object({
  path: z.string().min(1).max(240),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  replacement: z.string().min(1).max(128 * 1024),
}).strict();

type PathInput = z.infer<typeof pathInput>;
type PatchInput = z.infer<typeof patchInput>;
type ReadOutput = Awaited<ReturnType<VercelAgentRepairSandbox["readFile"]>>;
type PatchOutput = Awaited<ReturnType<VercelAgentRepairSandbox["applyPatch"]>>;

export function createAgentRepairTools(
  sandbox: AgentRepairToolSandbox,
  onCall?: (call: AgentRepairToolCallEvidence) => void,
): AgentRepairToolSet {
  const calls: AgentRepairToolCallEvidence[] = [];
  let lastRepairTest: RepairSandboxCommand | null = null;
  let lastBuild: RepairSandboxCommand | null = null;

  const record = <TInput, TOutput>(
    toolName: AgentRepairToolName,
    summarizeInput: (input: TInput) => Record<string, unknown>,
    summarizeOutput: (output: TOutput) => Record<string, unknown>,
    execute: (input: TInput) => Promise<TOutput>,
  ) => async (input: TInput): Promise<TOutput> => {
    const startedAt = new Date().toISOString();
    let output: TOutput;
    try {
      output = await execute(input);
    } catch (error) {
      const call = {
        sequence: calls.length + 1,
        toolName,
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        input: summarizeInput(input),
        output: { errorCode: safeErrorCode(error) },
      } satisfies AgentRepairToolCallEvidence;
      calls.push(call);
      onCall?.(call);
      throw error;
    }
    const call = {
      sequence: calls.length + 1,
      toolName,
      startedAt,
      finishedAt: new Date().toISOString(),
      success: true,
      input: summarizeInput(input),
      output: summarizeOutput(output),
    } satisfies AgentRepairToolCallEvidence;
    calls.push(call);
    onCall?.(call);
    return output;
  };

  return {
    tools: {
      list_files: {
        description: "List the exact files in the verified source package, including hashes and whether each path is editable.",
        inputSchema: emptyInput,
        execute: record("list_files", () => ({}), (output) => ({ fileCount: output.files.length }), async () => ({ files: sandbox.listFiles() })),
      },
      read_file: {
        description: "Read one verified source file. Use its returned sha256 as expectedSha256 when applying a patch.",
        inputSchema: pathInput,
        execute: async (value) => record<PathInput, ReadOutput>("read_file", (input) => ({ path: input.path }), (output) => ({ path: output.path, size: output.size, sha256: output.sha256 }), async (input) => sandbox.readFile(input.path))(pathInput.parse(value)),
      },
      inspect_test_failure: {
        description: "Inspect the captured primary baseline failure from this managed Sandbox. The Work Contract determines whether it is a test or build failure.",
        inputSchema: emptyInput,
        execute: record("inspect_test_failure", () => ({}), commandSummary, async () => sandbox.inspectTestFailure()),
      },
      apply_patch: {
        description: "Replace one editable source file after verifying its current SHA-256. Tests, lockfiles, manifests, and new files cannot be changed.",
        inputSchema: patchInput,
        execute: async (value) => record<PatchInput, PatchOutput>(
          "apply_patch",
          (input) => ({ path: input.path, expectedSha256: input.expectedSha256, replacementBytes: Buffer.byteLength(input.replacement), replacementSha256: sha256(input.replacement) }),
          (output) => output,
          async (input) => sandbox.applyPatch(input),
        )(patchInput.parse(value)),
      },
      run_test: {
        description: "Run the fixed npm test command in the managed Sandbox after a source patch.",
        inputSchema: emptyInput,
        execute: record("run_test", () => ({}), commandSummary, async () => {
          lastRepairTest = await sandbox.runTest();
          return lastRepairTest;
        }),
      },
      run_build: {
        description: "Run the fixed npm build command only when the verified package declares a build script.",
        inputSchema: emptyInput,
        execute: record("run_build", () => ({}), commandSummary, async () => {
          lastBuild = await sandbox.runBuild();
          return lastBuild;
        }),
      },
      get_diff: {
        description: "Get a deterministic unified patch for source files changed through apply_patch.",
        inputSchema: emptyInput,
        execute: record("get_diff", () => ({}), (output) => ({ sha256: output.sha256, modifiedFiles: output.modifiedFiles, patchBytes: Buffer.byteLength(output.patch) }), async () => sandbox.getDiff()),
      },
      get_source_integrity: {
        description: "Compare the current Sandbox source against the verified commit and report exact authorized mutations.",
        inputSchema: emptyInput,
        execute: record("get_source_integrity", () => ({}), (output) => ({ missing: output.missing, modified: output.modified, added: output.added, unauthorizedModified: output.unauthorizedModified }), async () => sandbox.getSourceIntegrity()),
      },
    },
    calls,
    getLastRepairTest: () => lastRepairTest,
    getLastBuild: () => lastBuild,
  };
}

function commandSummary(command: RepairSandboxCommand): Record<string, unknown> {
  return {
    command: command.command,
    commandId: command.commandId,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    stdoutSha256: sha256(command.stdout),
    stderrSha256: sha256(command.stderr),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(":", 1)[0]!.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 100);
}
