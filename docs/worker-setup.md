# DoneLayer Worker setup

DoneLayer Worker is a Node.js application that polls the platform using outbound HTTP requests. It never opens a public inbound port. The default executor is deterministic Demo mode, so the complete marketplace lifecycle works without Docker, Codex, GitHub CLI, an MCP server, or external credentials.

## Requirements

- Node.js 24.15 or newer
- npm 11 or newer
- Git is recommended and is required by the Codex preview executor
- Docker and a locally authenticated Codex CLI are required before the Worker advertises the Codex preview executor

On Windows PowerShell systems that block `npm.ps1`, use `npm.cmd` in place of `npm`.

## Pair a Worker

1. Start the DoneLayer web application.
2. Sign in as a Provider and open **Worker Nodes**.
3. Choose **Pair Worker** and copy the one-time pairing code. The code expires after ten minutes and can be used once.
4. Run:

   ```powershell
   npm run worker:setup -- --api-url http://localhost:3000 --code YOUR-PAIRING-CODE --name "My Dev Worker"
   ```

   Omit `--code` to enter the code interactively. Localhost may use HTTP; every non-local platform URL must use HTTPS.

5. Start polling:

   ```powershell
   npm run worker:start
   ```

Use `npm run worker:start -- --once` to claim at most one job and exit. This is useful for integration tests and supervised demonstrations.

## Commands

```powershell
npm run worker:setup -- --api-url http://localhost:3000
npm run worker:start
npm run worker:status -- --json
npm run worker:doctor
npm run worker:logout
```

`worker:logout` asks the platform to revoke the Worker token and then removes the local configuration. The platform stores only a hash of the Worker token.

## Doctor checks

`worker:doctor` reports:

- Node.js, operating system, CPU, memory, and free disk
- Git, Docker, Codex CLI, and GitHub CLI
- outbound platform connectivity
- language runtimes
- MCP server names declared through `DONELAYER_MCP_SERVERS`
- executors that the Worker can safely advertise

Missing optional tools are warnings because DemoExecutor remains available. `worker:doctor -- --strict` returns a non-zero status unless all prerequisites for the opt-in Codex preview executor are present.

MCP credentials and configuration contents are never uploaded. `DONELAYER_MCP_SERVERS` is a comma-separated list of server names only.

Signed artifact uploads are restricted to the platform host by default. If Supabase Storage or another dedicated evidence host is configured, list its exact hostname in `DONELAYER_ARTIFACT_UPLOAD_HOSTS` (comma-separated). Wildcards are not accepted.

## Local credential storage

The MVP separates non-secret configuration from `credentials.json` and creates the credential file with private permissions on supported systems. This is a development credential store, not an OS keychain. `worker:status` labels it accordingly. A production installation should provide a `CredentialStore` backed by Windows Credential Manager, macOS Keychain, or Secret Service.

Never commit the `.donelayer-worker` directory, print its contents, or copy it into a repository workspace.

## Worker protocol

The Worker uses these outbound endpoints:

| Action | Endpoint |
| --- | --- |
| Exchange a one-time pairing code | `POST /api/worker/pair` |
| Heartbeat and capabilities | `POST /api/worker/heartbeat` |
| Atomically claim an assigned job | `POST /api/worker/jobs/claim` |
| Renew a short job lease | `POST /api/worker/job-runs/:id/lease/renew` |
| Poll cancellation state | `POST /api/worker/job-runs/:id/control` |
| Append an idempotent event | `POST /api/worker/job-runs/:id/events` |
| Request and finalize signed evidence upload | `POST /api/worker/job-runs/:id/artifacts/*` |
| Submit an immutable result manifest | `POST /api/worker/job-runs/:id/submit` |

Each job is bound to a Worker, assignment, lease token, workflow template, and predefined command IDs. Customer text is never interpolated into a shell command.

## Workspace and cleanup

Every job receives a random directory below the Worker data directory. Demo mode seeds a disposable sample repository, produces evidence, uploads it, and removes the directory. Cleanup verifies that the target remains below the Worker workspace root before recursive removal.

The current MVP does not materialize arbitrary GitHub archives in the Worker. A real GitHub job is rejected with a clear error until the platform supplies a verified, safely extracted workspace bundle. This keeps private repository credentials and untrusted archive paths out of the Demo path.

## Troubleshooting

- **Worker is not paired:** run `worker:setup` again with a new code.
- **Pairing code expired:** create a new code in Worker Nodes.
- **Only Demo executor is listed:** this is expected without all real-execution prerequisites and the explicit feature flag.
- **Lease expired:** the platform safely rejects late evidence and may reassign the job.
- **Docker unavailable:** real jobs are refused; Demo jobs continue to work.
- **Codex executable unavailable:** keep Demo mode enabled and see [Codex executor](./codex-executor.md).
