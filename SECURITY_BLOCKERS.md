# Security Blockers for Real Build Rescue

## Current Execution Decision (updated 2026-08-31)

**MANAGED REMOTE SANDBOX GATE V1 is complete**, first provider Vercel Sandbox,
not local Docker. `LOCAL_SELF_HOSTED_DOCKER` is `DEFERRED_BY_OWNER`;
required for default MVP: **No**. It remains an opt-in Advanced Provider /
Enterprise Self-hosted route. Do not request Docker, WSL, or Linux installation
from ordinary users. Preserve `CONTAINER_RUNNER_BLOCKED.md` as historical evidence.

The fixed Managed Remote Sandbox Gate passed on 2026-08-31. Project link,
development OIDC, Provider availability, a locked Contract, a separate
Permission Lease, Provider-enforced `deny-all`, no injected credential names,
no repository/home upload, non-persistent lifecycle, no Snapshot, finite
resources/output, Artifact SHA-256, Evidence Ledger, cleanup in `finally`, and
public Receipt verification were observed against real Vercel Sandboxes. No
local host, Docker, or Demo fallback was used. The timeout probe also proved
that mandatory stop/cleanup can finish after execution authority expires.

This closes isolation only for the platform-controlled smoke and timeout
programs. It does not close the repository authorization, untrusted source
materialization, build/test, Codex, independent verifier, production storage,
tenant isolation, or delivery blockers below. The next gate is **REAL BUILD AND
TEST IN MANAGED SANDBOX**, not yet approved. See
`MANAGED_SANDBOX_REALITY_REPORT.md` and
`docs/adr/ADR-MANAGED-REMOTE-SANDBOX.md`.

The findings below are the historical Real Build Rescue baseline. The scoped
Worker, Trust Foundation, and Repository Reality reports supersede only the
specific controls they proved; this architecture decision proves no new runtime
control. Priority P0 means a real slice must not run without the control. P1 means
it must be closed before any shared or production deployment.

## P0 blockers

### 1. No trustworthy repository authorization

Current state:

- Task creation accepts arbitrary repository text.
- GitHub App has no installation callback, repository grant, token client, or repository selector.
- Worker claim converts every value into Demo repository fields.

Required control:

- Bind Customer, GitHub installation, immutable repository ID, owner/name, target branch, and base SHA.
- Verify access server-side before task creation and again before delivery.
- Never accept a Customer PAT.

### 2. No real source materialization

Current state:

- Worker explicitly rejects `repository.mode !== "demo"`.
- Demo source is generated locally.

Required control:

- Server-created one-time archive/bundle at a verified SHA.
- Checksum, maximum compressed/uncompressed size, maximum file count, path traversal/symlink/device-file rejection, and expiry.
- Bind bundle to Task, Job Run, Worker, and attempt generation.

### 3. Codex is not container-isolated

Current state:

- Doctor requires Docker before advertising Codex, but runtime never invokes Docker.
- Codex runs natively with workspace-write/read-only sandbox configuration.
- Environment includes home/config paths needed for local authorization.

Required control:

- Disposable container/VM with no Docker socket, no host home, no unrelated mounts, no ambient cloud/GitHub credentials, no privileged mode.
- Network disabled during Codex execution.
- CPU, memory, process, disk, output, and wall-clock limits.
- Verified teardown and workspace-root containment.

### 4. Job envelope is validated too late

Observed failure:

- Server acquired a lease and moved Task to `RUNNING`.
- Worker then rejected the envelope because repository name was empty.
- Task remained stranded.

Required control:

- Construct and schema-validate the complete envelope before atomic claim/state transition.
- If delivery to Worker fails, fence/requeue automatically.

### 5. No lease expiry scheduler or reassignment

Current state:

- Lease token validation exists.
- No scheduler invokes expiry/reassignment.
- Renewal extends by 60 seconds without the documented absolute Job deadline.
- `cancelRequested` is always false.

Required control:

- Persistent scheduler, attempt generation/fencing, absolute deadline, stale message rejection, and automatic requeue/fail terminal state.
- Persistent cancellation request and Worker acknowledgement.

### 6. Evidence provenance is untrusted

Current state:

- Worker can submit command, test, build, diff, files, SHAs, and PR URL structures.
- Server creates trusted-looking artifacts directly from those structures.
- Hashes prove byte integrity only.

Required control:

- Mark executor artifacts `UNTRUSTED_EXECUTOR`.
- Mark GitHub API readbacks `TRUSTED_GITHUB`.
- Mark fresh verifier results `TRUSTED_VERIFIER`.
- Acceptance checks specify required provenance.

### 7. "Independent" verification is not independent

Current state:

- Same Web process evaluates the same Worker/Demo evidence.
- No fresh checkout, separate identity, command execution, or environment attestation.
- URL health and GitHub checks are accepted from submitted evidence rather than platform observation.

Required control:

- Separate verifier job/identity/lease.
- New sandbox and fresh checkout of GitHub-observed PR head SHA.
- Server-owned command IDs and immutable results.

### 8. Human approval is fabricated

Current state:

- `verifyTask()` inserts a Customer approval artifact before Customer review.
- The later Customer acceptance is a separate demo step.

Required control:

- No approval artifact before an explicit Customer action.
- Bind approval to authenticated Customer, task version, Evidence Pack hash, and timestamp.

### 9. Branch, commit, and PR are not platform-observed

Current state:

- Demo constants and Worker-supplied URL/SHAs are accepted.
- No branch/commit/PR API call exists.

Required control:

- Trusted GitHub delivery service with App credential isolated from executor.
- Read back and store repository ID, branch, base/head SHA, commit, PR number/state/URL.
- Reject mismatched base or head.

### 10. Artifact upload URL and storage path are unreliable

Observed failure:

- First real Worker artifact upload was rejected because upload host was not allowlisted.
- Standalone/host reconstruction produced deployment-dependent behavior.

Required control:

- Canonical configured public API/storage origin, not untrusted forwarded headers.
- Exact scheme/host/port policy and single-use token.
- Private object storage, server-side digest, MIME signature validation, download authorization, retention.

### 11. Demo path can impersonate actors

Current state:

- Authenticated Customer/Admin can call demo step.
- `advanceDemo()` records transitions as Provider, Worker, System, and Customer without those actors participating.

Required control:

- Real tasks must reject every demo endpoint/command.
- Demo and real task IDs/modes must be unambiguously separated.
- Production startup must disable Demo Auth, Demo step, Demo seed, Demo executor, and Demo repository.

### 12. Test Ledger can credit the wrong Provider

Current state:

- DemoStore release credits hardcoded `provider-alpha`, not the accepted assignment Provider.

Required control:

- Derive beneficiary and amounts from the locked accepted assignment.
- Idempotent balanced entries tied to Task version, Verification Run, and Customer acceptance.

## P1 blockers

### Authentication and tenant isolation

- Supabase mode authenticates a user but application data still uses DemoStore fixed identities/wallets.
- Customer Dashboard snapshot is not scoped by actor.
- App shell and Admin customer names are hardcoded.
- Demo development secret fallback is unsafe for any exposed environment.

Close with a real identity/profile binding, tenant-scoped store commands, role tests against the actual adapter, session rotation, and production fail-closed configuration.

### Worker credential storage and rotation

- Worker token is stored in a local JSON file.
- UI has pairing but no complete revoke/rotate/recover workflow.

Use OS keychain/secret service, short-lived/rotatable credentials, auditable revocation, and incident recovery.

### Capability and liveness trust

- Seed Workers are Online without processes.
- Matching rewrites heartbeat timestamps.
- Worker capabilities are self-asserted.
- Doctor omitted Node.js/npm from installed tools during audit.

Use receipt-time TTL without mutation during matching, corrected detection, capability challenge/attestation where necessary, and executor/isolation-specific eligibility.

### Rate limiting and replay state

- Rate limit is per-process memory and trusts forwarding headers.
- Webhook replay stores are in-memory; database receipt helps only after local verification.

Use trusted proxy configuration, shared rate limiting, shared replay/idempotency storage, bounded retention, and multi-instance tests.

### Audit integrity and observability

- Audit is local SQLite and covers mainly successful mutations.
- No end-to-end request/job correlation, structured server/Worker logs, alerting, or immutable export.

Add correlation IDs across Customer/Provider/Worker/Verifier/GitHub, failure audit records, redaction tests, immutable retention, and operational alerts.

### Dispute resolution

- Dispute creation and hold work, but no resolution/refund/release action exists.
- UI reports disputed funds as still in escrow.

Add an authorized resolution state machine and balanced ledger operations before shared use.

### Deployment packaging

- `npm start` is incompatible with configured standalone output.
- Standalone package omitted or misplaced client static assets in audit.

Create one reproducible build artifact, start command, health/readiness checks, migration step, and smoke test in the target runtime.

## Required security tests

The Real Build Rescue milestone is blocked until automated tests cover:

1. Cross-Customer repository/task/evidence access.
2. Revoked or wrong GitHub installation/repository.
3. Base SHA change and branch race.
4. Archive path traversal, symlink escape, decompression bomb, excessive files/bytes.
5. Prompt injection attempting home/credential/network access.
6. Container escape-sensitive configuration: Docker socket, privileged mode, host mounts, capabilities.
7. Secret redaction in logs, diff, Codex JSONL, stderr, artifacts, and Evidence Pack.
8. Worker loss, expired lease, stale attempt upload/submit, duplicate submit, cancellation.
9. Executor fabrication of tests/build/PR cannot satisfy verification.
10. Verifier fresh-checkout SHA mismatch and failing Build/Test.
11. Artifact MIME/signature/hash/size mismatch and unauthorized download.
12. Customer acceptance replay and optimistic version conflict.
13. Ledger idempotency and correct Provider beneficiary.
14. Demo endpoints rejected for real tasks and disabled in production.

## Security sign-off gate

Security sign-off requires a real run in a dedicated GitHub test repository, captured container and verifier provenance, no secret exposure, successful recovery from one forced Worker failure, and GitHub API readback matching the Evidence Pack. Passing current unit/E2E tests is not sufficient.
