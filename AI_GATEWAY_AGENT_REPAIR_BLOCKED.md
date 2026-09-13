# AI Gateway Agent Repair Blocked

> Historical record: this report describes the first V1 live attempt only. A
> separately authorized recovery later completed the Gate with
> `inclusionai/ling-3.0-flash-fin`; see `AGENT_REPAIR_SANDBOX_REPORT.md`. The
> evidence and conclusions below remain unchanged for the original attempt.

## Historical Status

At the time of this attempt, `AGENT_REPAIR_IN_MANAGED_SANDBOX_GATE_V1` was
**BLOCKED** at the first live
Vercel AI Gateway model request. The Gate is not complete and no successful
Agent Repair Receipt exists.

## Preflight Evidence

- Vercel CLI identity: `nickhoi`
- Team: `nickhoi's projects`
- Project: `donelayer`
- Authentication: server-side Vercel OIDC, valid for the linked project
- AI Gateway credit before the live attempt: `$5.00`
- Auto-reload: Off
- Authenticated and public live catalogs were intersected before the request
- Selected model: `poolside/laguna-s-2.1-free`
- Model provider: `poolside`
- Live catalog capabilities: language, reasoning, tool use
- Live catalog pricing: input `0`, output `0`, cached input `0`

No `OPENAI_API_KEY` was required or requested. No credential entered the
Sandbox, logs, artifacts, UI, or evidence file.

## Bounded Live Attempt

- Maximum live repair runs: `1`
- Live repair runs used: `1`
- Provider retry limit: `1`
- Gateway request attempts: `2` (initial request plus the one allowed retry)
- Provider result: `GatewayInternalServerError`
- Safe provider message: `Service temporarily unavailable. Please try again shortly.`
- Failure occurred before the model produced any DoneLayer tool call
- DoneLayer tool calls executed: `0`
- Source patch created: No
- Repaired test executed: No
- Agent Repair Receipt created: No

The code path had already pinned Commit
`600f326ce373160eb5495aaef72230d4c9807e8f`, created the fresh Sandbox,
installed dependencies through the registry-only network window, restored
deny-all networking, and admitted the model request only after the baseline
test failed. The failed run did not return command artifacts because the
original live harness treated the provider error as terminal; the harness is
now corrected so a future provider failure produces a bounded-failure Receipt.
This correction was validated locally only and was not used to rerun the Gate.

## Postflight Evidence

- AI Gateway credit after the attempt: `$4.999775`
- AI Gateway `totalUsed`: `$0.000225`
- Observed balance delta: `$0.000225`
- Gateway spend report: unavailable on Hobby (`403`; paid plan required)
- No plan upgrade or billing change was made
- Sandbox: `donelayer-agent-repair-addcac92-87c7-446d-8d10-`
- Final provider state: `stopped`
- Persistent: `false`
- Snapshot: none
- Cleanup verified by an independent post-run `Sandbox.list` observation

Input, output, cached, and reasoning token counts were not returned by the
failed Gateway request and are therefore recorded as unknown. No values are
invented.

## Implemented Boundary

The local implementation now includes:

- provider-neutral `AgentExecutionProvider`
- `VercelAIGatewayAgentProvider`
- deferred optional `DirectOpenAIAgentProvider`
- live authenticated credit and model catalog checks
- `ToolLoopAgent` with one provider retry and twelve-step maximum
- the eight approved DoneLayer controlled tools
- source-only writes with current-file SHA-256 preconditions
- fresh non-persistent Vercel Sandbox execution
- deny-all networking outside the fixed npm install window
- Agent Repair Receipt and public Receipt fields that use the actual provider
  and model names
- a generated SQLite Evidence/Ledger/Receipt harness for completed or bounded
  failure runs

Local validation after implementation: lint passed, typecheck passed,
production build passed, and `157` tests passed with `5` skipped.

## Historical Manual Next Step

The V1 machine-readable evidence is preserved at
`test-results/agent-repair-sandbox-blocked-v1-evidence.json`.

This step was subsequently completed under a separate owner authorization:
review the two failed requests in **Vercel Dashboard -> AI Gateway -> Logs**
and, only after confirming the selected model is serving requests again,
explicitly authorize a new single live Gate run.

Do not retry automatically, switch providers, purchase credits, upgrade the
plan, or change billing.
