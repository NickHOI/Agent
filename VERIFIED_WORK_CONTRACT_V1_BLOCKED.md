# Verified Work Contract V1 - Blocked Reality Report

Date: 2026-09-03

Historical result: `BLOCKED`. This report remains the record of the first
fail-closed attempt. A later separately authorized corrected Gate passed; see
`VERIFIED_WORK_CONTRACT_V1_REPORT.md`. The failure Evidence below was preserved
under immutable archive filenames before the successful runner wrote its own
standard Evidence files.

## Result

`BLOCKED`

The owner requested resumption of `VERIFIED WORK CONTRACT V1 DESIGN AND
EVIDENCE GATE` from the prior authentication boundary. The frozen executable
implementation in this working tree identifies itself as
`SEMANTIC_VERIFICATION_SPEC_TEST_CONFLICT_V1`; no separate
`VERIFIED_WORK_CONTRACT_V1` runner or completed report exists.

Authentication was repaired successfully. The resumed frozen run then stopped
on an implementation boundary before the baseline test or any Agent model call:

```text
Source runner branch is outside the approved boundary
```

The frozen source-package runner accepts the historical main/delivery branch
boundary but rejected `fixture/real-source-bug-v1`. The implementation was not
changed after the live Fixture run began. No fixture-specific exception was
added.

## Vercel Authentication Refresh

| Check | Observed result |
|---|---|
| CLI | Vercel CLI `58.1.0`, Node.js `24.16.0` |
| Login | `nickhoi` |
| Team | slug `nickhois-projects`, display name `nickhoi's projects` |
| Existing Project | `donelayer` |
| Project ID | `prj_uXQPL9YGPuhsTGxBCXbC2GhapslX` |
| Team ID | `team_WI6P4TgExvdShphDtPsUSBBP` |
| Link result | `nickhois-projects/donelayer` |
| OIDC refresh | `vercel env pull .env.local --yes --environment=development --scope nickhois-projects` |
| Minimum AI Gateway check | `available=true`, `authentication=VERCEL_OIDC`, two eligible models, positive existing credit, no model call |

No new Vercel Project was created. No deployment ran. Git was not connected to
Vercel. No billing, plan, or credit change was made. The raw OIDC token was not
printed or added to Evidence, reports, Receipts, or Git.

## Frozen DoneLayer Identity

- HEAD Commit: `50aecde8f5ad91462609daadffc3ac648fd0971d`
- Working-tree identity SHA-256:
  `bac2a4f1df3711d821284686752720215a278d21d5cca5b2f036bdd7031e7947`
- Full local identity manifest:
  `test-results/verified-work-contract-v1-source-boundary-failure-worktree-identity.txt`

Before the freeze:

- lint passed
- typecheck passed
- 172 non-live tests passed; 7 live-gated tests skipped
- production web and Worker builds passed

## Failed Live Attempt

- Started: `2026-09-03T13:10:45.927Z`
- Finished: `2026-09-03T13:11:00.544Z`
- Frozen Gate evidence:
  `test-results/verified-work-contract-v1-source-boundary-failure-evidence.json`
- Failure: `Source runner branch is outside the approved boundary`
- Agent/model calls: `0`
- baseline repository test: not executed
- source patch: not created
- GitHub delivery: not attempted
- simulated payout: not released
- semantic success Receipt: not issued

The process had created one non-persistent Vercel Sandbox before the branch
policy rejected the runner. Because the failure occurred during Sandbox start,
the process did not retain the returned Sandbox handle. The exact Sandbox was
located by its bounded DoneLayer name and stopped manually through the Vercel
Sandbox SDK.

Cleanup evidence:

- Sandbox: `donelayer-agent-repair-43ac2922-48e3-46cd-8907-`
- final state: `stopped`
- persistent: `false`
- Snapshot: not created
- cleanup verified: `true`
- artifact: `test-results/verified-work-contract-v1-blocked-cleanup.json`

## GitHub Preservation

Remote refs after the blocked attempt:

- `main`: `600f326ce373160eb5495aaef72230d4c9807e8f`
- `fixture/real-source-bug-v1`:
  `5ae6dd136b99c4727e8ac50833a716cfbbf4ae00`

GitHub lists exactly one Pull Request:

- PR #1
- state: `OPEN`
- merged: `false`
- base: `main` at `600f326ce373160eb5495aaef72230d4c9807e8f`
- head: `donelayer/repair/ed564b18-8fa2` at
  `466be67975a953a1ae3b5cfc41e80d42ee057164`

No new repair branch, Commit, or Pull Request was created by the failed run.
PR #1 was not modified, closed, merged, or otherwise touched.

## Evidence Boundary

The run reached the frozen repair-Sandbox start only after its guarded
repository materialization and deterministic semantic preflight code paths.
Those partial objects were not persisted before the start failure, so this
report does not promote them to completed Gate evidence. The completed local
unit evidence for conflict handling remains test evidence, not a substitute
for the blocked live Gate.

This result does not prove:

- a true source-bug repair
- repository test conformity after repair
- independent Contract assertion conformity
- GitHub delivery integrity
- fresh non-AI verification
- semantic Receipt supersession
- verified simulated payout authorization

## Required Next Decision

Stop for owner review. A new explicitly authorized Gate revision is required to
change the general source-runner branch policy and to add a negative cleanup
test for failures thrown during Sandbox startup. The frozen live Gate must not
be silently patched and resumed as though this failure had not occurred.

Do not begin portable attestations, ERC-8004, Permission Engine expansion,
x402, Capability Passport, Reputation, AI Transparency Kit, or any later
roadmap item.
