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

Write-Host '===== Phase 2.5 Silo non-JSON tolerance patch ====='

$text = [IO.File]::ReadAllText($Agent)

if (-not $text.Contains('[PHASE2.5 DIRECT V5]')) {
  throw 'Phase 2.5 Direct V5 marker was not found.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Agent.before-phase25-silo-fix-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $backup -Force
Write-Host "Backup: $backup"

$old = @'
    await requestOisPhase25UppercaseAjaxData(
      page,
      "OI.ETCINFOSERVICE.CHKTAGNO",
      {
        EPOW_STAT_CODE:
          "8000",

        TAG_NO:
          definition.tag
      }
    );
'@

$new = @'
    await requestOisPhase25UppercaseAjaxData(
      page,
      "OI.ETCINFOSERVICE.CHKTAGNO",
      {
        EPOW_STAT_CODE:
          "8000",

        TAG_NO:
          definition.tag
      }
    )
      .catch(
        error => {
          const message =
            String(
              error?.message ||
              error ||
              ""
            );


          if (
            message.includes(
              "returned non-JSON data"
            )
          ) {
            console.log(
              "[PHASE2.5 DIRECT V5] CHKTAGNO non-JSON response ignored for " +
              String(
                definition.tag
              )
            );

            return null;
          }


          throw error;
        }
      );
'@

$count =
  ([regex]::Matches(
    $text,
    [regex]::Escape($old)
  )).Count

Write-Host "Patch target count: $count"

if ($count -ne 1) {
  throw "Expected exactly 1 CHKTAGNO block, found $count."
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
  -Pattern 'CHKTAGNO non-JSON response ignored' |
Select-Object LineNumber,Line |
Format-Table -AutoSize

Write-Host ''
Write-Host '===== Patch complete ====='
Write-Host 'Agent has NOT been restarted.'
Write-Host 'Nothing has been staged or committed.'
