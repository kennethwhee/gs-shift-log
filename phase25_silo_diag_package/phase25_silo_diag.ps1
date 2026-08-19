param(
  [string]$Repo = 'C:\Users\GSENR\Desktop\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

$Agent = Join-Path $Repo 'local-tools\ois-agent\ois-login.js'
$Node  = 'C:\Program Files\nodejs\node.exe'

if (-not (Test-Path -LiteralPath $Agent)) {
  throw "Agent file not found: $Agent"
}

if (-not (Test-Path -LiteralPath $Node)) {
  throw "Node.exe not found: $Node"
}

Write-Host '===== Phase 2.5 Silo response diagnostic ====='

$text = [IO.File]::ReadAllText($Agent)

if (-not $text.Contains('[PHASE2.5 DIRECT V5]')) {
  throw 'Phase 2.5 Direct V5 marker was not found.'
}

if ($text.Contains('[PHASE2.5 SILO DIAG]')) {
  throw 'Silo diagnostic is already applied.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Agent.before-phase25-silo-diag-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $backup -Force
Write-Host "Backup: $backup"

$old = @'
  try {
    return JSON.parse(
      responseText
    );

  } catch {
    throw new Error(
      "OIS direct TAG LOG API returned non-JSON data."
    );
  }
'@

$new = @'
  try {
    return JSON.parse(
      responseText
    );

  } catch {
    console.warn(
      "[PHASE2.5 SILO DIAG] non-JSON response",
      JSON.stringify({
        command,
        status:
          requestResult?.status ||
          0,

        length:
          responseText.length,

        preview:
          responseText.slice(
            0,
            1000
          )
      })
    );


    throw new Error(
      "OIS direct TAG LOG API returned non-JSON data."
    );
  }
'@

$count =
  ([regex]::Matches(
    $text,
    [regex]::Escape($old)
  )).Count

Write-Host "Diagnostic patch target count: $count"

if ($count -ne 1) {
  throw "Expected exactly 1 JSON parse block, found $count."
}

$text = $text.Replace($old,$new)

[IO.File]::WriteAllText(
  $Agent,
  $text,
  (New-Object Text.UTF8Encoding($false))
)

Write-Host ''
Write-Host '===== Node syntax check ====='
& $Node --check $Agent

if ($LASTEXITCODE -ne 0) {
  Copy-Item -LiteralPath $backup -Destination $Agent -Force
  throw 'Node syntax check failed; restored backup.'
}

Write-Host ''
Write-Host '===== git diff --check ====='
git diff --check -- local-tools/ois-agent/ois-login.js

if ($LASTEXITCODE -ne 0) {
  Copy-Item -LiteralPath $backup -Destination $Agent -Force
  throw 'git diff --check failed; restored backup.'
}

Write-Host ''
Write-Host '===== Marker check ====='
Select-String `
  -LiteralPath $Agent `
  -SimpleMatch `
  -Pattern '[PHASE2.5 SILO DIAG]' |
Select-Object LineNumber,Line |
Format-Table -AutoSize

Write-Host ''
Write-Host '===== Diagnostic patch complete ====='
Write-Host 'Agent has NOT been restarted.'
Write-Host 'Nothing has been staged or committed.'
