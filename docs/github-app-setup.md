# GitHub App Setup

DoneLayer uses a GitHub App. Do not ask Customers for personal access tokens.
GitHub App permissions determine both API access and which webhook events can be
subscribed to, so start with the minimum set and add permissions only for an
implemented feature.

Official references:

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app)
- [Choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Installing selected repositories](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)
- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

## 1. Register the App

Open the GitHub settings for the personal account or organization that will own
the App, choose Developer settings, GitHub Apps, and New GitHub App.

Suggested values:

| Setting | Value |
| --- | --- |
| GitHub App name | DoneLayer Development, or another unique name |
| Homepage URL | The DoneLayer Web origin |
| Callback URL | `<origin>/api/github/callback` |
| Setup URL | `<origin>/provider/github/setup-complete` |
| Webhook URL | `<origin>/api/webhooks/github` |
| Webhook active | Yes |
| Expire user authorization tokens | Yes |
| Request user authorization during installation | No for the MVP |

Use HTTPS outside local development. A tunnel may be used for local webhook
testing, but it must be treated as public and protected by the webhook secret.

Generate a cryptographically random webhook secret with at least 32 bytes. Store
it only in the server secret manager or local untracked environment file.

## 2. Repository permissions

Configure these repository permissions:

| Permission | Default | Reason |
| --- | --- | --- |
| Metadata | Read-only | Repository identity and installation metadata; GitHub includes this baseline permission |
| Contents | Read and write | Clone/read commits and create a task branch when Customer permits changes |
| Pull requests | Read and write | Read a target PR and create a delivery PR when Customer permits it |
| Checks | Read-only | Read check runs for Proof-of-Done |
| Actions | Read-only | Read workflow runs and Actions status |
| Commit statuses | Read-only | Read legacy or external commit statuses |

Do not grant Administration, Secrets, Deployments, Environments, Members, or
Organization permissions for the MVP. Do not grant Workflows unless DoneLayer
later implements editing files under `.github/workflows`; Contents permission by
itself is intentionally insufficient for that operation.

If a read-only verification deployment never creates branches or pull requests,
reduce Contents and Pull requests to read-only in a separate App registration.
GitHub Apps cannot dynamically reduce the permissions granted to an installation,
so separate App registrations provide a meaningful least-privilege boundary.

## 3. Webhook subscriptions

Subscribe only to:

- Installation
- Installation repositories
- Push
- Pull request
- Check run
- Check suite
- Workflow run

The registration page shows only events allowed by the selected permissions. A
handler must still reject any `X-GitHub-Event` value outside this allowlist.

## 4. Generate and store the private key

Generate a private key from the GitHub App settings and place it in the server
secret manager. Never commit the `.pem` file and never expose it to a Worker or
browser. The Web server uses it only to create a short-lived App JWT and exchange
that JWT for a short-lived installation access token.

Required server environment values are expected to be documented in the root
`.env.example`:

```text
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_APP_SLUG=
```

`GITHUB_APP_PRIVATE_KEY` may contain the PEM with escaped newlines or a secret-
manager reference, according to the platform adapter. Do not use a public-prefixed
environment name. The App id and slug are identifiers, but keeping all integration
configuration server-side avoids accidental adapter drift.

## 5. Install on selected repositories

Install the App on the Customer's personal account or organization and choose
Only select repositories. Select only the repository used by the task. Store the
GitHub installation id and selected repository ids, never an installation token.

The setup callback must confirm that the signed-in Customer owns the pending
installation flow before linking it. Installation and installation-repository
webhooks reconcile additions, removals, suspension, and deletion.

## 6. Validate webhook deliveries

The webhook route must read the raw bytes before parsing JSON:

1. Require `X-Hub-Signature-256`, `X-GitHub-Delivery`, and `X-GitHub-Event`.
2. Compute `HMAC-SHA-256(webhook_secret, raw_body)` and compare the complete
   `sha256=<hex>` value in constant time.
3. Reject an event type outside the allowlist.
4. Insert `(source='GITHUB', delivery_id)` into `webhook_receipts` before work.
5. Treat the unique-key conflict as an idempotent duplicate.
6. Store the body SHA-256 and redacted metadata, not secrets or an unrestricted
   copy of a private repository payload.
7. Acknowledge quickly and perform expensive reconciliation asynchronously.

Never log the webhook secret, private key, installation token, signature input,
or a repository clone URL containing credentials. Error responses use a generic
message and the audit request id.

## 7. Installation token use

Before repository access, verify all of the following on the server:

- The task Customer owns the installation record.
- The repository is selected and active for that installation.
- The requested operation is allowed by the task permission flags.
- The Provider has accepted the assignment.
- The Worker holds the current Job lease.

Create the shortest practical installation token scoped to the selected
repository and required permissions. Inject it only into the Git operation that
needs it, redact process output, and discard it immediately. Never persist it in
the database, evidence, task metadata, Git remote URL, or Worker credential file.

## 8. Demo fallback

When GitHub App variables are absent and Demo mode is explicitly enabled, tasks
use the seeded Demo Repository descriptor. GitHub routes show an unconfigured
state and the Demo Executor produces synthetic commit, diff, check, and pull-
request evidence. Production mode must refuse GitHub operations rather than
silently producing demo evidence.
