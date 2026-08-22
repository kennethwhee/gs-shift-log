param(
  [string]$Repo = 'C:\Users\GSENR\Desktop\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

$TaskName =
  'GS Shift Log OIS Agent'

$Agent =
  Join-Path $Repo 'local-tools\ois-agent\ois-login.js'

$Node =
  'C:\Program Files\nodejs\node.exe'

if (-not (Test-Path -LiteralPath $Agent)) {
  throw "Agent file not found: $Agent"
}

if (-not (Test-Path -LiteralPath $Node)) {
  throw "Node.exe not found: $Node"
}

function Get-NewLine {
  param([string]$Text)

  if ($Text.Contains("`r`n")) {
    return "`r`n"
  }

  return "`n"
}

function Convert-NewLine {
  param(
    [string]$Text,
    [string]$NewLine
  )

  return $Text
    .Replace("`r`n", "`n")
    .Replace("`r", "`n")
    .Replace("`n", $NewLine)
}

function Replace-Range {
  param(
    [string]$Text,
    [int]$Start,
    [int]$End,
    [string]$Replacement
  )

  if (
    $Start -lt 0 -or
    $End -lt $Start -or
    $End -gt $Text.Length
  ) {
    throw "Invalid replacement range: $Start .. $End"
  }

  return (
    $Text.Substring(0, $Start) +
    $Replacement +
    $Text.Substring($End)
  )
}

Write-Host '===== Phase 3.3B Non-blocking Agent startup ====='

Write-Host ''
Write-Host '===== Pre-patch syntax check ====='

& $Node --check $Agent

if ($LASTEXITCODE -ne 0) {
  throw 'Agent already has a syntax error before patch.'
}

$Text =
  [IO.File]::ReadAllText($Agent)

if ($Text.Contains('[PHASE3.3B NONBLOCKING STARTUP]')) {
  throw 'Phase 3.3B is already applied.'
}

foreach (
  $RequiredMarker in @(
    '[PHASE3.3A EXCEL BULK READ]',
    '[PHASE3.2 WATER DIRECT]',
    '[PHASE2.5 DIRECT V5] Limestone API complete',
    '[PHASE2.5 DIRECT V5] Gear/Pinion API complete',
    '[PHASE2.7B ORGANIC OPTIONAL V2]'
  )
) {
  if (-not $Text.Contains($RequiredMarker)) {
    throw "Required marker is missing: $RequiredMarker"
  }
}

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$Backup =
  "$Agent.before-phase33b-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $Backup `
  -Force

Write-Host "Backup: $Backup"

$Nl =
  Get-NewLine $Text

try {
  $WarmupStart =
    $Text.IndexOf(
      '    /*' +
      $Nl +
      '      [PHASE2.6 WARMUP]'
    )

  if ($WarmupStart -lt 0) {
    throw 'Phase 2.6 startup warmup block start was not found.'
  }

  $PollingStart =
    $Text.IndexOf(
      '    while (' +
      $Nl +
      '      !isShuttingDown',
      $WarmupStart
    )

  if ($PollingStart -lt 0) {
    throw 'Agent polling loop after Phase 2.6 warmup was not found.'
  }

  $OldWarmupBlock =
    $Text.Substring(
      $WarmupStart,
      $PollingStart - $WarmupStart
    )

  if (
    -not $OldWarmupBlock.Contains(
      'await ensureBrowserSession('
    ) -or
    -not $OldWarmupBlock.Contains(
      '[PHASE2.6 WARMUP] OIS browser startup warmup started'
    )
  ) {
    throw 'The located Phase 2.6 block does not match the expected blocking warmup.'
  }

  $NewStartupBlock =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
    /*
      [PHASE3.3B NONBLOCKING STARTUP]

      Phase 2.6 startup warmup used to await ensureBrowserSession()
      before the request polling loop started.

      When OIS startup navigation stalled, the whole Agent could remain
      unable to claim Excel or OIS requests for several minutes.

      Startup warmup is intentionally skipped here.
      The existing on-demand ensureBrowserSession() path remains unchanged,
      so an OIS request creates or recovers the single browser session only
      when it is actually needed.

      This also avoids adding a second concurrent browser initialization.
    */
    console.log(
      "[PHASE3.3B NONBLOCKING STARTUP] startup warmup skipped; request polling starts immediately"
    );


'@

  $Text =
    Replace-Range `
      -Text $Text `
      -Start $WarmupStart `
      -End $PollingStart `
      -Replacement $NewStartupBlock

  [IO.File]::WriteAllText(
    $Agent,
    $Text,
    (New-Object Text.UTF8Encoding($false))
  )

  Write-Host ''
  Write-Host '===== Node syntax check ====='

  & $Node --check $Agent

  if ($LASTEXITCODE -ne 0) {
    throw 'Agent Node syntax check failed.'
  }

  Write-Host ''
  Write-Host '===== git diff --check ====='

  git diff --check -- `
    local-tools/ois-agent/ois-login.js

  if ($LASTEXITCODE -ne 0) {
    throw 'git diff --check failed.'
  }

  $Final =
    [IO.File]::ReadAllText($Agent)

  $Checks =
    [ordered]@{
      'Phase 3.3B marker' =
        $Final.Contains(
          '[PHASE3.3B NONBLOCKING STARTUP]'
        )

      'Blocking startup await removed' =
        -not (
          $Final.Contains(
            '[PHASE2.6 WARMUP] OIS browser startup warmup started'
          )
        )

      'Polling loop kept' =
        $Final.Contains(
          '      !isShuttingDown'
        )

      'Phase 3.3A Excel Bulk kept' =
        $Final.Contains(
          '[PHASE3.3A EXCEL BULK READ]'
        )

      'Phase 3.2 Water Direct kept' =
        $Final.Contains(
          '[PHASE3.2 WATER DIRECT]'
        )

      'Limestone Direct kept' =
        $Final.Contains(
          '[PHASE2.5 DIRECT V5] Limestone API complete'
        )

      'Gear Direct kept' =
        $Final.Contains(
          '[PHASE2.5 DIRECT V5] Gear/Pinion API complete'
        )

      'Organic optional kept' =
        $Final.Contains(
          '[PHASE2.7B ORGANIC OPTIONAL V2]'
        )
    }

  Write-Host ''
  Write-Host '===== Verification ====='

  foreach ($Entry in $Checks.GetEnumerator()) {
    Write-Host (
      $Entry.Key +
      ': ' +
      $Entry.Value
    )
  }

  if (
    $Checks.Values -contains
      $false
  ) {
    throw 'One or more verification checks failed.'
  }

  Write-Host ''
  Write-Host '===== Diff summary ====='

  git diff --stat -- `
    local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Restart Agent safely ====='

  Stop-ScheduledTask `
    -TaskName $TaskName `
    -ErrorAction SilentlyContinue

  $AgentProcesses =
    @(
      Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object {
        $_.CommandLine -match 'ois-login\.js'
      }
    )

  foreach ($AgentProcess in $AgentProcesses) {
    $AgentProcessId =
      [int]$AgentProcess.ProcessId

    Write-Host "Stopping Agent process tree PID: $AgentProcessId"

    $TaskKill =
      Join-Path $env:SystemRoot 'System32\taskkill.exe'

    & $TaskKill `
      /PID $AgentProcessId `
      /T `
      /F |
    Out-Host
  }

  Start-Sleep -Seconds 2

  Start-ScheduledTask `
    -TaskName $TaskName

  Write-Host ''
  Write-Host '===== Wait for new Agent process ====='

  $NewAgent =
    $null

  for (
    $Attempt = 1;
    $Attempt -le 30;
    $Attempt += 1
  ) {
    $NewAgent =
      Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object {
        $_.CommandLine -match 'ois-login\.js'
      } |
      Sort-Object CreationDate -Descending |
      Select-Object -First 1

    if ($NewAgent) {
      break
    }

    Start-Sleep -Seconds 1
  }

  if (-not $NewAgent) {
    throw 'New Agent process did not appear within 30 seconds.'
  }

  Write-Host (
    'New Agent PID: ' +
    [string]$NewAgent.ProcessId
  )

  Write-Host (
    'New Agent CreationDate: ' +
    [string]$NewAgent.CreationDate
  )

  Write-Host ''
  Write-Host '===== Phase 3.3B patch complete ====='
  Write-Host 'Startup no longer waits for OIS warmup.'
  Write-Host 'Request polling starts immediately.'
  Write-Host 'OIS browser initialization remains on-demand.'
  Write-Host 'Phase 3.3A and Phase 3.2 are preserved.'
  Write-Host 'Nothing has been staged or committed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring Agent ====='

  Copy-Item `
    -LiteralPath $Backup `
    -Destination $Agent `
    -Force

  Write-Host 'Restore complete.'

  throw
}
