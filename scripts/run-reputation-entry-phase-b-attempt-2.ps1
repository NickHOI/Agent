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
$resultDirectory = Join-Path $workspace "test-results"
$identityPath = Join-Path $resultDirectory "reputation-entry-phase-b-attempt-2-working-tree-identity.txt"
$attemptArtifacts = @(
  $identityPath,
  (Join-Path $resultDirectory "reputation-entry-phase-b-attempt-2-source-preflight.json"),
  (Join-Path $resultDirectory "reputation-entry-phase-b-attempt-2.sqlite"),
  (Join-Path $resultDirectory "reputation-entry-phase-b-attempt-2-evidence.json")
)

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
  foreach ($artifact in $attemptArtifacts) {
    if (Test-Path -LiteralPath $artifact) {
      throw "REPUTATION_ENTRY_PHASE_B_ATTEMPT_2_EVIDENCE_ALREADY_EXISTS: $([IO.Path]::GetFileName($artifact))"
    }
  }

  $headCommit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Unable to resolve DoneLayer HEAD Commit" }
  $trackedDiff = (& git diff --binary HEAD | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Unable to capture DoneLayer tracked working-tree diff" }
  $untracked = @(& git ls-files --others --exclude-standard | Sort-Object)
  if ($LASTEXITCODE -ne 0) { throw "Unable to capture DoneLayer untracked files" }
  $identityLines = [System.Collections.Generic.List[string]]::new()
  $identityLines.Add("ATTEMPT PHASE_B_ATTEMPT_2")
  $identityLines.Add("HEAD $headCommit")
  $identityLines.Add("TRACKED_DIFF_SHA256 $(Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($trackedDiff)))")
  foreach ($relativePath in $untracked) {
    $bytes = [IO.File]::ReadAllBytes((Join-Path $workspace $relativePath))
    $identityLines.Add("UNTRACKED $relativePath $(Get-Sha256Hex $bytes)")
  }
  $identity = ($identityLines -join "`n") + "`n"
  [IO.Directory]::CreateDirectory($resultDirectory) | Out-Null
  [IO.File]::WriteAllText($identityPath, $identity, [Text.UTF8Encoding]::new($false))

  $env:RUN_REPUTATION_ENTRY_PHASE_B_ATTEMPT_2 = "true"
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
