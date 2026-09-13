$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot

Push-Location $workspace
try {
  $env:RUN_REPUTATION_ENTRY_PERSISTENCE_PREFLIGHT = "true"
  & node .\node_modules\vitest\vitest.mjs run tests/integration/reputation-entry-persistence-preflight.test.ts
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
