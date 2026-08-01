# DoneLayer Threat Model

## Scope and assets

This model covers the Web application, Supabase database and private Storage,
GitHub App integration, Provider Worker, Agent adapters, job workspace, evidence,
and test ledger. Primary assets are repository contents, source credentials,
Worker identity, Provider machine integrity, evidence integrity, personal data,
and simulated balances.

The MVP does not claim to protect a repository from an intentionally malicious
Provider after the Customer explicitly authorizes that Provider to receive it.
Repository minimization, short-lived credentials, audit, reputation, and dispute
handling reduce that residual business risk but cannot remove it.

## Threats and mitigations

| Threat | Attack | MVP mitigation | Residual risk |
| --- | --- | --- | --- |
| Malicious Customer attacks Worker | Prompt or repository tries shell injection, path escape, host mount, or credential discovery | Workflow-template allowlist, manual Provider acceptance, ephemeral non-root container, one workspace mount, no Docker socket or privilege, archive and symlink checks, environment allowlist | Container/runtime vulnerability; keep runtime patched and allow Provider to reject high-risk tasks |
| Malicious Provider steals repository | Accepted Provider copies private source beyond the task | One selected repository, short-lived GitHub installation token, attempt branch, audit, no PAT, post-task revocation | Authorized Provider can still read supplied source; contractual and marketplace controls remain necessary |
| Prompt injection | Repository text instructs Agent to reveal secrets or bypass checks | Treat prompts and repository as data, fixed tool and network policy, no ambient secrets, verifier separate from executor | Agent may produce poor or deceptive output, which Proof-of-Done must catch |
| Secret leakage | Token appears in process environment, log, diff, or artifact | Minimal environment, no credential upload, structured redaction, artifact scan, private Storage, output limits | Novel secret formats can evade redaction; rotate on suspicion |
| Worker token theft | Stolen bearer impersonates a Worker | 256-bit secret, hash at rest, OS credential store, TLS, scopes, rotation and revocation, anomaly audit, per-Job lease token | Malware with Provider-user access can use live credentials until revoked |
| Fake evidence | Worker fabricates tests, changes hash, or reuses another Job artifact | Active lease and fencing, immutable scoped path, server-computed hash, verifier reruns checks, GitHub data read directly | Some environment-specific claims require trusted runner attestation in a later version |
| Replay attack | Reuse webhook, callback, pairing, event, or ledger request | Timestamp window, nonce or delivery id uniqueness, one-time pairing transaction, client sequence, idempotency keys, constant-time HMAC | Delayed delivery outside the window needs explicit retry workflow |
| Provider offline | Worker disappears while holding a task | Platform-derived heartbeat status, short lease, absolute deadline, lease expiry, new attempt and fencing | Old local process may continue consuming Provider resources but cannot submit results |
| Infinite Job | Agent loops and renews forever | Absolute deadline cannot be extended, cancellation, CPU/PID/time/output limits | Cleanup failure requires Worker doctor and Provider intervention |
| Excessive resource use | Zip bomb, fork bomb, huge logs, disk or memory exhaustion | Archive expansion cap, cgroup/container quotas, PID cap, stream backpressure, log/file/artifact limits | Host-level denial remains possible through runtime vulnerabilities |
| Malicious upload | Polyglot, executable, decompression bomb, stored XSS | Exact path, private quarantine, extension/MIME/magic checks, image dimension cap, attachment download, no inline HTML/SVG | Antivirus is not included in MVP and should be added for broader file types |
| IDOR/BOLA | Customer or Provider guesses another resource id | Live server authorization, RLS, scoped projections, no client writes, authorization contract tests | Incorrect new route or policy can reintroduce BOLA; require review checklist |
| Forced COMPLETED state | Browser directly updates task status | No client UPDATE grant, transactional transition command, legal-edge trigger, verification-completeness database gate | Service-role bugs remain privileged; audit and integration tests are required |
| Double spend or release | Concurrent accepts or repeated callbacks release twice | Integer cents, wallet row locks, double-entry balance trigger, unique idempotency key, one active assignment | Administrative adjustments require dual review in production |
| Webhook forgery | Fake GitHub or Agent callback | HMAC over raw body, timestamp/nonce, event allowlist, replay receipt, HTTPS | Compromised endpoint secret requires rotation and replay-receipt review |
| SSRF | URL check, Agent endpoint, or A2A URL targets internal services | HTTPS only, private/link-local/metadata IP denylist, DNS re-resolution, redirect and byte limits, dedicated client | DNS and proxy implementation errors require dedicated security tests |
| GitHub installation abuse | App accesses more repositories or modifies workflows | Selected-repository install, minimum permissions, no Workflows permission by default, short-lived tokens | Organization owner can grant broader access; platform shows granted scope |
| MCP secret upload | Worker capability discovery sends local MCP credentials | Protocol accepts only server names and capability names; schema has no secret field | A poorly written Worker plugin could put secrets in metadata; redact and cap metadata |
| Demo mode exposed publicly | Demo identities or reset endpoint are used as authentication | Explicit Demo flag, localhost default, signed HttpOnly session, production fail-closed, visible unsafe-mode banner | Operators can still misconfigure public exposure; startup should refuse without override |

## Security invariants

1. Customer text never becomes an unrestricted command.
2. A real Job cannot begin before explicit Provider acceptance.
3. A Worker can write only to its current Job attempt and lease generation.
4. An executor cannot mark its own verification as passed.
5. Every required acceptance check passes before VERIFICATION_PASSED.
6. COMPLETED requires verified proof and Customer or Admin acceptance.
7. Every state change and privileged action has a durable actor and reason.
8. Every ledger transaction is balanced and idempotent.
9. Secrets never enter browser bundles, capability reports, normal logs, or evidence.
10. No-Supabase Demo mode preserves the same domain invariants.

## Deferred defenses

The MVP does not include hardware attestation, malware scanning for arbitrary file
types, per-tenant encryption keys, confidential computing, signed container image
provenance, or real-money controls. These are deliberate limitations, not implied
features.

