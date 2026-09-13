$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$resultDirectory = Join-Path $workspace "test-results"
$preflightPath = Join-Path $resultDirectory "reputation-entry-phase-b-attempt-5-preflight.json"
$identityPath = Join-Path $resultDirectory "reputation-entry-phase-b-attempt-5-working-tree-identity.txt"
$databasePath = Join-Path $resultDirectory "reputation-entry-phase-b-attempt-5.sqlite"
$evidencePath = Join-Path $resultDirectory "reputation-entry-phase-b-attempt-5-evidence.json"
$attemptArtifacts = @($preflightPath, $identityPath, $databasePath, $evidencePath)
$requiredHistory = @(
  (Join-Path $resultDirectory "reputation-entry-persistence-preflight-attempt-4.sqlite"),
  (Join-Path $resultDirectory "reputation-entry-persistence-preflight-attempt-4-evidence.json"),
  (Join-Path $resultDirectory "reputation-entry-phase-b-attempt-3.sqlite"),
  (Join-Path $resultDirectory "reputation-entry-phase-b-attempt-3-evidence.json"),
  (Join-Path $resultDirectory "reputation-entry-phase-b-attempt-3-source-preflight.json"),
  (Join-Path $resultDirectory "reputation-entry-phase-b-attempt-3-working-tree-identity.txt"),
  (Join-Path $resultDirectory "reputation-entry-phase-b-attempt-4-preflight.json"),
  (Join-Path $workspace "REPUTATION_ENTRY_PHASE_B_ATTEMPT_4_BLOCKED.md"),
  (Join-Path $workspace "VERIFIED_DELIVERY_V2_LIVE_ORCHESTRATOR_PRELIVE_REPORT.md")
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
      throw "REPUTATION_ENTRY_PHASE_B_ATTEMPT_5_ARTIFACT_ALREADY_EXISTS: $([IO.Path]::GetFileName($artifact))"
    }
  }
  foreach ($artifact in $requiredHistory) {
    if (-not (Test-Path -LiteralPath $artifact)) {
      throw "REPUTATION_ENTRY_PHASE_B_ATTEMPT_5_HISTORY_MISSING: $([IO.Path]::GetFileName($artifact))"
    }
  }

  $env:RUN_REPUTATION_ENTRY_PHASE_B_ATTEMPT_5_PREFLIGHT = "true"
  & node --env-file=.env.local .\node_modules\vitest\vitest.mjs run tests/integration/reputation-entry-phase-b-attempt-5-preflight.test.ts
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  $preflight = Get-Content -Raw -LiteralPath $preflightPath | ConvertFrom-Json
  if ($preflight.attemptId -ne "PHASE_B_ATTEMPT_5" -or $preflight.preflight.status -ne "PASS") {
    throw "REPUTATION_ENTRY_PHASE_B_ATTEMPT_5_PREFLIGHT_NOT_PASS"
  }

  $headCommit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Unable to resolve DoneLayer HEAD Commit" }
  $trackedDiff = (& git diff --binary HEAD | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "Unable to capture DoneLayer tracked working-tree diff" }
  $untracked = @(& git ls-files --others --exclude-standard | Sort-Object)
  if ($LASTEXITCODE -ne 0) { throw "Unable to capture DoneLayer untracked files" }
  $identityLines = [System.Collections.Generic.List[string]]::new()
  $identityLines.Add("ATTEMPT PHASE_B_ATTEMPT_5")
  $identityLines.Add("HEAD $headCommit")
  $identityLines.Add("TRACKED_DIFF_SHA256 $(Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($trackedDiff)))")
  foreach ($relativePath in $untracked) {
    $bytes = [IO.File]::ReadAllBytes((Join-Path $workspace $relativePath))
    $identityLines.Add("UNTRACKED $relativePath $(Get-Sha256Hex $bytes)")
  }
  $identity = ($identityLines -join "`n") + "`n"
  [IO.File]::WriteAllText($identityPath, $identity, [Text.UTF8Encoding]::new($false))

  $env:RUN_REPUTATION_ENTRY_PHASE_B_ATTEMPT_5 = "true"
  $env:REPUTATION_ENTRY_HEAD_COMMIT = $headCommit
  $env:REPUTATION_ENTRY_WORKTREE_SHA256 = Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($identity))
  & node --env-file=.env.local .\node_modules\vitest\vitest.mjs run tests/integration/reputation-entry-phase-b-attempt-5-reality.test.ts
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
