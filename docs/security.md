# DoneLayer Security

This document defines mandatory MVP controls. `docs/threat-model.md` records the
attacker scenarios and residual risks.

## Trust boundaries

- Browser text, repository content, Agent output, webhook bodies, and uploaded
  files are untrusted.
- The Next.js server is the policy enforcement point.
- A Worker is authenticated but not trusted outside its assigned active lease.
- A Provider is authorized to receive an accepted task, not to browse Customer
  repositories or tasks in general.
- An executor may produce evidence but cannot approve its own evidence.
- Supabase service-role credentials, GitHub App keys, webhook secrets, pairing
  peppers, and encryption keys are server-only.

## Authentication and authorization

Supabase Auth identifies people. `profiles.auth_user_id` links that identity to a
durable domain profile. Roles are stored in `profile_roles` and checked against the
live database. Authorization never depends on user-editable `user_metadata`.

All exposed application tables enable RLS. Grants and RLS are separate controls:

- `anon` has SELECT only on the safe Provider projection, public Agent catalog
  tables, MCP capability names, and published reviews.
- `authenticated` has SELECT only on an explicit table allowlist.
- Token, pairing-code, lease, webhook-receipt, and audit tables have no client
  table grant even where a defensive admin RLS policy exists.
- `service_role` is used only in server runtime code.
- Every server mutation rechecks the authenticated actor and target resource.

For current hosted Supabase projects, prefer the modern publishable key in the
browser and secret key on the server. The database role is still named
`service_role`; legacy `anon` and `service_role` JWT keys must not be introduced
into new client code and remain subject to the same no-browser rule.

Provider opportunity browsing uses `task_opportunities`, which contains only a
sanitized summary. RLS is never used as a substitute for hiding sensitive columns.
Full task access starts with a targeted offer and remains auditable after Provider
acceptance. The opportunity title is category-derived and `scope_summary` must be
an analyzer-produced, privacy-reviewed value with repository names, paths, secrets,
customer identity, and proprietary excerpts removed.

`provider_public_profiles` is the only anonymous Provider record and contains no
private metadata. `task_worker_statuses` gives task participants only Worker name,
derived status, and last heartbeat; raw capabilities and Worker metadata remain
Provider/Admin data. Sensitive admin tables intentionally have defensive RLS but
no authenticated table grant. The Admin Dashboard reads them through authorized
server endpoints rather than direct browser Supabase queries.

Authorization helpers are `SECURITY DEFINER` only when required to avoid recursive
RLS. They live in the unexposed `private` schema, set a fixed search path, fully
qualify table names, expose only boolean decisions, and have explicit EXECUTE
grants. There are no public-schema security-definer functions.

## Server command protection

Mutating routes require an authenticated session or Worker bearer token. Browser
routes enforce an Origin allowlist and SameSite cookies; state-changing requests
without an expected Origin are rejected. JSON requests require the correct content
type and Zod validation. The actor, action, target, request id, outcome, and
redacted metadata are written to the audit log.

Suggested initial rate limits:

| Operation | Limit |
| --- | ---: |
| Sign in and pairing attempts | 5 per IP per minute |
| Pairing attempts for one code | 5 total |
| Task create or publish | 20 per user per hour |
| Worker heartbeat | 12 per worker per minute |
| Job event batches | 60 per worker per minute |
| Signed artifact URL | 30 per active Job per minute |
| Webhook delivery | 120 per endpoint per minute |

Rate-limit keys use a keyed hash of identifiers and IP addresses. Responses do
not reveal whether a pairing code, account, Worker, or private task exists.

## Worker identity

A pairing code contains a public lookup id and a 60-bit random Crockford Base32
secret. The database stores only `HMAC-SHA-256(pairing_pepper, secret)`. It expires
after 10 minutes, allows five attempts, and is consumed with a conditional update
inside the token-issuance transaction.

A Worker token has the form `dwk_<token-id>.<32-byte-random-secret>`. The token id
locates the record and only SHA-256 of the high-entropy secret is stored. Comparison
is constant time. Tokens carry explicit scopes, can expire, rotate, or be revoked,
and are redacted from logs. The Worker stores the token in the operating-system
credential store. A restrictive local file fallback is development-only and must
show a warning.

Each Job receives a separate random lease token and monotonically increasing
fencing generation. Event, evidence, submit, and cancel endpoints require both the
Worker token and current lease. Lease renewal fails after expiry, cancellation,
Worker suspension, or the absolute Job deadline.

## Execution containment

Customer input selects a predefined workflow template. It is never interpolated
into a shell command. Each Job receives a new random workspace and may access only
its repository checkout. Archive extraction rejects absolute paths, `..`, symlink
escapes, hard-link escapes, device files, and oversized expansion.

Real local execution requires an ephemeral container with:

- No privileged mode, Docker socket, host PID/IPC namespace, or arbitrary mount
- A single task workspace mount and a read-only root filesystem where possible
- Non-root UID, dropped Linux capabilities, and no-new-privileges
- CPU, memory, process, writable-disk, file-size, output, and absolute-time limits
- Deny-by-default network policy with a task-template domain allowlist
- A minimal environment allowlist and no inherited SSH, browser, cloud, or MCP
  secrets

Without Docker, the MVP permits only Demo Executor. Any enabled native development
mode must be explicit, local-only, Provider-approved, and labeled as weaker than
container isolation.

Codex CLI uses the Provider's existing local authorization through the official
noninteractive interface. The platform never reads or uploads Codex credentials.
The adapter sets only the isolated working directory and approved sandbox flags,
captures bounded stdout/stderr, supports cancellation and timeout, and redacts
secrets before upload.

## Evidence and files

The evidence bucket is private. The server issues a signed upload token only for
an exact immutable path under the active task, Job, and artifact ids. Upsert is
disabled. Finalization checks:

- The lease is still current.
- The object exists at the expected path.
- Size is within both Job and artifact-type limits.
- Extension, declared MIME, and magic bytes agree.
- Server-computed SHA-256 matches the artifact record.
- Images are decoded with pixel-dimension limits.

Only finalized VERIFIED artifacts can be downloaded. Downloads use a short-lived
signed URL after task-participant authorization and force attachment disposition
for text, JSON, patch, and unknown content. Storage paths are never accepted from
the client.

## Webhooks and replay protection

GitHub and Agent HMAC signatures are verified over the untouched raw request body
before JSON parsing. Verification uses constant-time comparison. Agent requests
also require a timestamp within five minutes and a random nonce. GitHub delivery
ids and Agent nonces are unique in `webhook_receipts`; duplicate delivery is
idempotently acknowledged without processing again.

The event type is allowlisted independently of the signature. Persist only the
body hash and redacted processing metadata unless a payload field is required for
the task. Never return secret values or signature diagnostics in an error.

## SSRF controls

Webhook Agent URLs, A2A Agent Card URLs, and URL health checks permit HTTPS only.
Reject URL credentials, nonstandard schemes, loopback, private, link-local,
multicast, carrier-grade NAT, and cloud metadata addresses for IPv4 and IPv6.
Resolve DNS before connecting and after every redirect, pin the resolved address
for the request, limit redirects, bytes, and time, and reject hostname-to-private-
address rebinding. Outbound requests use a dedicated client with no ambient proxy
credentials or cookies.

## Secret and log handling

- Secrets are supplied at runtime and never committed.
- Webhook secrets stored per Provider use envelope encryption or a managed secret
  store; database rows contain only a secret reference or ciphertext envelope.
- GitHub installation tokens are short-lived and never persisted.
- MCP configuration reports names and capabilities only, never local MCP secrets.
- Structured redaction covers bearer tokens, authorization headers, common key
  patterns, private keys, connection strings, and configured secret values.
- Logs and artifacts are capped and truncated with an explicit marker.
- Audit IP and user-agent values are keyed hashes, not raw values.

## Operational controls

Worker and Agent suspension is checked on every heartbeat, poll, claim, and lease
renewal. A scheduler marks stale Workers offline and expires leases, but a new Job
attempt is not accepted until its fencing generation is committed. Key rotation,
token revocation, pairing failures, rejected uploads, replay attempts, state
transition failures, and administrative decisions are security events.

Before production, run Supabase database advisors, RLS authorization tests, upload
tests, webhook replay tests, lease-fencing tests, and a dependency audit. Use Node
22 or later because current Supabase JavaScript packages no longer support Node 20.
