$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot

Push-Location $workspace
try {
  $env:RUN_AGENT_REPAIR_REALITY_GATE = "true"
  & node --env-file=.env.local .\node_modules\vitest\vitest.mjs run tests/integration/agent-repair-reality.test.ts
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
