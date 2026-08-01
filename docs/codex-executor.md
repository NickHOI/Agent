# Codex CLI executor

The Codex executor is an opt-in preview adapter. DemoExecutor is the default and is the only executor required for the DoneLayer MVP demonstration.

## Local authorization boundary

Codex uses the Provider's existing local Codex authorization. DoneLayer does not request, read, store, upload, or proxy a Codex token. The adapter does not set `OPENAI_API_KEY` or `CODEX_API_KEY`, and its subprocess environment excludes unrelated secrets such as GitHub tokens.

The Provider must authenticate the official Codex CLI independently before enabling this adapter.

## Enable the preview

The Worker advertises `codex-cli` only when all of these are true:

- Git is available
- Docker is available as a prerequisite for a dedicated execution environment
- Codex CLI is available
- `DONELAYER_ENABLE_CODEX_EXECUTOR=true`

Example for a dedicated Provider machine:

```powershell
$env:DONELAYER_ENABLE_CODEX_EXECUTOR = "true"
npm run worker:doctor -- --strict
npm run worker:start
```

Providers must still manually accept every real task before the platform creates a runnable assignment.

## Centralized options

All Codex behavior is contained in `apps/worker/src/executors/codex.ts`. No route, UI component, or task payload builds Codex flags.

The adapter prefers `@openai/codex-sdk` when it is installed. It uses:

- `workingDirectory` set to the exact disposable job directory
- `sandboxMode: "workspace-write"`
- `approvalPolicy: "never"`
- network access disabled
- web search disabled
- no additional writable directories
- `AbortSignal` for cancellation and timeout
- a JSON Schema for the final structured result

If the SDK package is not available before execution begins, the adapter falls back to `codex exec` with an argument array and `shell: false`. The prompt is written to stdin, not interpolated into a command. The fallback uses equivalent options:

```text
codex exec --json --ephemeral --ignore-user-config
  --sandbox workspace-write
  --cd <job-directory>
  --config approval_policy="never"
  --config sandbox_workspace_write.network_access=false
  --config web_search="disabled"
  --output-schema <schema-file>
  -
```

The deprecated `--full-auto` flag and `danger-full-access` are never used.

## Captured result

The Worker records:

- start and end timestamps
- executor exit status
- structured final response
- sanitized command event hashes and process exit metadata
- Git commit before and after
- changed files and Git diff
- bounded JSONL events and stderr with secret redaction

Model-reported command IDs, test totals, build status, and Pull Request URLs remain inside `codex-result.json`; they are deliberately not copied into authoritative `commandsRun`, `tests`, `buildSucceeded`, or `pullRequestUrl` fields. These records are evidence inputs, not Proof-of-Done. The server-side verifier must independently rerun allowlisted checks or query GitHub before passing them.

## Timeout and cancellation

The task envelope supplies a maximum duration. The adapter combines that timer with the platform cancellation signal. The SDK receives the combined `AbortSignal`; the subprocess fallback receives the same signal through `child_process.spawn`. Cancellation produces a structured cancelled result and the Worker removes the job directory.

## Security limitations

The preview adapter uses the official Codex workspace-write sandbox on the Provider machine. The current MVP does not claim that this native sandbox is equivalent to a disposable Docker container. Docker availability is a conservative eligibility gate, but container orchestration for Codex and verified GitHub workspace materialization remain outside the default Demo execution path.

Use this preview only on a dedicated Provider environment with manual task acceptance. Keep it disabled for shared personal machines. The production hardening step is to execute the prepared workspace inside an ephemeral container with CPU, memory, disk, network, mount, and process limits while keeping Codex credentials outside repository-controlled processes.
