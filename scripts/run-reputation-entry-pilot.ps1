param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{40}$')]
  [string]$TestAndFixCommit,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{40}$')]
  [string]$BuildRescueCommit
)

$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot

function Get-Sha256Hex([byte[]]$Bytes) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $sha256.Dispose()
  }
}

Push-Location $workspace
try {
  $headCommit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Unable to resolve DoneLayer HEAD Commit" }
  $trackedDiff = (& git diff --binary HEAD | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Unable to capture DoneLayer tracked working-tree diff" }
  $untracked = @(& git ls-files --others --exclude-standard | Sort-Object)
  if ($LASTEXITCODE -ne 0) { throw "Unable to capture DoneLayer untracked files" }
  $identityLines = [System.Collections.Generic.List[string]]::new()
  $identityLines.Add("HEAD $headCommit")
  $identityLines.Add("TRACKED_DIFF_SHA256 $(Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($trackedDiff)))")
  foreach ($relativePath in $untracked) {
    $bytes = [IO.File]::ReadAllBytes((Join-Path $workspace $relativePath))
    $identityLines.Add("UNTRACKED $relativePath $(Get-Sha256Hex $bytes)")
  }
  $identity = ($identityLines -join "`n") + "`n"
  $identityPath = Join-Path $workspace "test-results\reputation-entry-replacement-phase-b-working-tree-identity.txt"
  [IO.Directory]::CreateDirectory((Split-Path -Parent $identityPath)) | Out-Null
  [IO.File]::WriteAllText($identityPath, $identity, [Text.UTF8Encoding]::new($false))

  $env:RUN_REPUTATION_ENTRY_PILOT = "true"
  $env:REPUTATION_ENTRY_HEAD_COMMIT = $headCommit
  $env:REPUTATION_ENTRY_WORKTREE_SHA256 = Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($identity))
  $env:REPUTATION_TEST_AND_FIX_COMMIT = $TestAndFixCommit
  $env:REPUTATION_BUILD_RESCUE_COMMIT = $BuildRescueCommit
  & node --env-file=.env.local .\node_modules\vitest\vitest.mjs run tests/integration/reputation-entry-pilot-reality.test.ts
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
