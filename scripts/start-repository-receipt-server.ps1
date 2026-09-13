$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$env:DEMO_DATABASE_PATH = Join-Path $workspace "test-results/repository-reality.sqlite"
$env:DEMO_SESSION_SECRET = "repository-reality-local-browser-verification-only"
$env:NODE_ENV = "production"

Push-Location $workspace
try {
  & npm run start --workspace @donelayer/web -- --hostname 127.0.0.1 --port 3202
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
