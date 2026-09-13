$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot

Push-Location $workspace
try {
  $env:RUN_MANAGED_BUILD_TEST_REALITY_GATE = "true"
  & node --env-file=.env.local .\node_modules\vitest\vitest.mjs run tests/integration/managed-build-test-reality.test.ts
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
