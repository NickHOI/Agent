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
    $fileHash = Get-Sha256Hex $bytes
    $identityLines.Add("UNTRACKED $relativePath $fileHash")
  }
  $identity = ($identityLines -join "`n") + "`n"
  $identityPath = Join-Path $workspace "test-results\semantic-donelayer-working-tree-identity.txt"
  [IO.File]::WriteAllText($identityPath, $identity, [Text.UTF8Encoding]::new($false))
  $identitySha256 = Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($identity))

  $env:RUN_SEMANTIC_VERIFICATION_REALITY_GATE = "true"
  $env:SEMANTIC_DONELAYER_HEAD_COMMIT = $headCommit
  $env:SEMANTIC_DONELAYER_WORKTREE_SHA256 = $identitySha256
  & node --env-file=.env.local .\node_modules\vitest\vitest.mjs run tests/integration/semantic-verification-reality.test.ts
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
