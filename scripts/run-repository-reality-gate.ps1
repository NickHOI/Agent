$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$env:RUN_REPOSITORY_REALITY_GATE = "true"
$env:REPOSITORY_REALITY_CAPTURE_EVIDENCE = "true"
$env:REPOSITORY_REALITY_CAPTURE_DB_PATH = Join-Path $workspace "test-results/repository-reality.sqlite"

Push-Location $workspace
try {
  & npx vitest run tests/integration/worker-reality.test.ts
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
