# Managed Remote Sandbox Gate V1: BLOCKED at Project Linking

## Completed Checks

- Checked at: `2026-08-27T16:49:48.5801466+08:00`.
- Branch: `feat/managed-remote-sandbox-v1`; existing uncommitted work preserved.
- Required context and current official Vercel CLI/Sandbox authentication documentation reviewed.
- Owner architecture decision saved; local self-hosted Docker is `DEFERRED_BY_OWNER`, not required for the default MVP.
- SHA-256 checks confirmed the four existing Worker, Trust, Repository, and Docker BLOCKED reports are unchanged.
- Vercel CLI is installed: `58.1.0`, running on Node.js `24.16.0`.
- Vercel login succeeded: `nickhoi`. This is not an account-login failure.
- No `.vercel/project.json` or `.vercel/repo.json` exists at the repository root or `apps/web`.
- No SDK was installed and no package/lockfile or runtime code was changed by this attempt.
- Development OIDC, Sandbox availability, quotas, and billing were not inspected after the Project-link blocker.
- `git diff --check` exited `0`, with LF/CRLF warnings only. Lint, typecheck, tests, build, and Browser execution were not run for this documentation/preflight-only attempt.

## Actual Commands / Provider Calls

Commands were run from the DoneLayer repository root. No Sandbox API call was made.

| Command | Environment | Exit code | Actual output summary |
| --- | --- | ---: | --- |
| `vercel --version` | Local | `0` | `Vercel CLI 58.1.0` and `58.1.0` |
| `vercel whoami` | Restricted network | `1` | `Error: connect EACCES 35.186.247.156:443` |
| `vercel whoami` | Authorized network retry | `0` | `Vercel CLI 58.1.0 (Node.js 24.16.0)` and `nickhoi` |
| `Get-Item -LiteralPath '.vercel/project.json','.vercel/repo.json','apps/web/.vercel/project.json','apps/web/.vercel/repo.json' -ErrorAction SilentlyContinue` | Local | `1` | No matching files; no output |
| `vercel project inspect --non-interactive` | Restricted network | `1` | `Loading teams...`, then `Error: connect EACCES 35.186.247.156:443` |
| `vercel project inspect --non-interactive` | Authorized network retry | `1` | `status=action_required`, `reason=confirmation_required` |

An additional read-only existence check returned `false` for all four link files:

```powershell
@('.vercel/project.json', '.vercel/repo.json', 'apps/web/.vercel/project.json', 'apps/web/.vercel/repo.json') | ForEach-Object { [pscustomobject]@{ Path = $_; Exists = Test-Path -LiteralPath $_ } } | ConvertTo-Json
```

That command exited `0`. No link metadata appeared after inspection.

## Exit / Error Codes

- DoneLayer preflight assessment: `PROJECT_LINK_REQUIRED` (not a provider-returned error code).
- Actual final CLI status: `action_required`.
- Actual final CLI reason: `confirmation_required`.
- Actual final CLI exit code: `1`.
- Earlier `EACCES` errors were local network restrictions, not proof of invalid credentials; the authorized `whoami` retry succeeded.

## Actual Error Summary

The authorized Project inspection reported:

```json
{
  "status": "action_required",
  "reason": "confirmation_required",
  "message": "Command vercel project inspect requires confirmation. Use option --yes to confirm."
}
```

No local link identifies the intended DoneLayer Project. The CLI's suggested
confirmation was not followed: the owner explicitly requires manual Project
linking and an immediate stop at this boundary. This does not assert that a
DoneLayer Project is absent from the account; only local linkage is missing.

## Sandbox Creation

Sandboxes created by this attempt: **0**. No smoke/timeout command, artifact,
snapshot, local host/Docker fallback, or VERIFIED Receipt was produced.

## Costs

No Sandbox compute was requested by this attempt. No billing, plan, credit, or
paid add-on change was made. Account-wide billing was not queried or certified.

## Remaining Running Sandboxes

None created or left running by this attempt. Existing account-wide resources
were not listed, modified, or certified.

## Only Next Manual Step

Link the current DoneLayer directory to the correct DoneLayer Vercel Project:

```powershell
vercel link "<repo-root>"
```

Select the intended DoneLayer Project. This is the only requested action;
do not handle OIDC, billing, deployment, or Docker at this stage.
Command reference: [official Vercel link documentation](https://vercel.com/docs/cli/link).
