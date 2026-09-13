$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$workspace = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path $workspace "test-fixtures\reputation-entry-pilot"
$testResults = Join-Path $workspace "test-results"
$remote = "https://github.com/NickHOI/donelayer-build-rescue-fixture.git"
$cloneRoot = Join-Path $testResults ("fixture-prep-" + [Guid]::NewGuid().ToString("N"))
$branches = @(
  @{ TaskType = "TEST_AND_FIX"; Branch = "donelayer/repair/reputation-state-transition-v2"; Source = "state-transition" },
  @{ TaskType = "BUILD_RESCUE"; Branch = "donelayer/repair/reputation-build-config-v2"; Source = "build-config" }
)

function Invoke-Git([string[]]$Arguments) {
  & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Assert-CleanupTarget([string]$Candidate) {
  $parent = [IO.Path]::GetFullPath($testResults).TrimEnd('\') + '\'
  $target = [IO.Path]::GetFullPath($Candidate)
  if (-not $target.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Fixture preparation cleanup target escaped test-results"
  }
}

[IO.Directory]::CreateDirectory($testResults) | Out-Null
Assert-CleanupTarget $cloneRoot

Push-Location $workspace
try {
  Invoke-Git @("clone", "--no-tags", "--single-branch", "--branch", "main", $remote, $cloneRoot)
  Push-Location $cloneRoot
  try {
    Invoke-Git @("config", "user.name", "DoneLayer Fixture Owner")
    Invoke-Git @("config", "user.email", "fixture-owner@users.noreply.github.com")

    foreach ($item in $branches) {
      $existing = & git ls-remote --heads origin ("refs/heads/" + $item.Branch)
      if ($LASTEXITCODE -ne 0) { throw "Unable to inspect remote fixture branch $($item.Branch)" }
      if ($existing) { throw "Refusing to overwrite existing fixture branch $($item.Branch)" }

      Invoke-Git @("checkout", "--detach", "origin/main")
      Invoke-Git @("switch", "--create", $item.Branch)
      Invoke-Git @("rm", "-r", "--", ".")
      $sourceDirectory = Join-Path $fixtureRoot $item.Source
      Get-ChildItem -LiteralPath $sourceDirectory -Force | Copy-Item -Destination $cloneRoot -Recurse -Force
      Invoke-Git @("add", "--all")
      Invoke-Git @("commit", "--message", "Add $($item.TaskType) reputation entry fixture")
      Invoke-Git @("push", "origin", "HEAD:refs/heads/$($item.Branch)")
      $commitSha = (& git rev-parse HEAD).Trim().ToLowerInvariant()
      if ($LASTEXITCODE -ne 0 -or $commitSha -notmatch '^[a-f0-9]{40}$') { throw "Fixture commit identity is invalid" }
      Write-Output "$($item.TaskType)`t$($item.Branch)`t$commitSha"
      Invoke-Git @("switch", "--detach", "origin/main")
      Invoke-Git @("branch", "--delete", "--force", $item.Branch)
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  Pop-Location
  Assert-CleanupTarget $cloneRoot
  if (Test-Path -LiteralPath $cloneRoot) {
    Remove-Item -LiteralPath $cloneRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $cloneRoot) { throw "Fixture preparation workspace cleanup was not verified" }
}
