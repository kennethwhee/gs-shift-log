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

$Stable =
  Get-ChildItem `
    (Split-Path -Parent $Agent) `
    -Filter 'ois-login.js.before-phase25-trace-*.bak' `
    -File `
    -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Stable) {
  throw 'Pre-TRACE stable backup was not found.'
}

Write-Host '===== Phase 2.5 keep Lime/Gear direct, restore Silo UI ====='
Write-Host "Agent: $Agent"
Write-Host "Stable: $($Stable.FullName)"

function Find-FunctionRange(
  [string]$Source,
  [string]$Needle
) {
  $start = $Source.IndexOf($Needle)

  if ($start -lt 0) {
    throw "Function not found: $Needle"
  }

  $braceStart = $Source.IndexOf('{',$start)

  if ($braceStart -lt 0) {
    throw "Opening brace not found: $Needle"
  }

  $depth = 0
  $inSingle = $false
  $inDouble = $false
  $inTemplate = $false
  $escaped = $false

  for ($i = $braceStart; $i -lt $Source.Length; $i++) {
    $ch = $Source[$i]

    if ($escaped) {
      $escaped = $false
      continue
    }

    if ($inSingle -or $inDouble -or $inTemplate) {
      if ($ch -eq '\') {
        $escaped = $true
        continue
      }

      if ($inSingle -and $ch -eq "'") {
        $inSingle = $false
        continue
      }

      if ($inDouble -and $ch -eq '"') {
        $inDouble = $false
        continue
      }

      if ($inTemplate -and $ch -eq '`') {
        $inTemplate = $false
        continue
      }

      continue
    }

    if ($ch -eq "'") {
      $inSingle = $true
      continue
    }

    if ($ch -eq '"') {
      $inDouble = $true
      continue
    }

    if ($ch -eq '`') {
      $inTemplate = $true
      continue
    }

    if ($ch -eq '{') {
      $depth++
      continue
    }

    if ($ch -eq '}') {
      $depth--

      if ($depth -eq 0) {
        return [PSCustomObject]@{
          Start = $start
          End   = $i + 1
        }
      }
    }
  }

  throw "Function end not found: $Needle"
}

$currentText = [IO.File]::ReadAllText($Agent)
$stableText  = [IO.File]::ReadAllText($Stable.FullName)

if (-not $currentText.Contains('[PHASE2.5 DIRECT V5]')) {
  throw 'Phase 2.5 Direct V5 marker was not found.'
}

$needle = 'async function collectOisSiloLevelValues('

$currentRange = Find-FunctionRange $currentText $needle
$stableRange  = Find-FunctionRange $stableText $needle

$stableFunction =
  $stableText.Substring(
    $stableRange.Start,
    $stableRange.End - $stableRange.Start
  )

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Agent.before-phase25-silo-ui-restore-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $backup -Force
Write-Host "Backup: $backup"

$newText =
  $currentText.Substring(
    0,
    $currentRange.Start
  ) +
  $stableFunction +
  $currentText.Substring(
    $currentRange.End
  )

[IO.File]::WriteAllText(
  $Agent,
  $newText,
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
Write-Host '===== Verification ====='

$currentAfter = [IO.File]::ReadAllText($Agent)
$currentSiloRange = Find-FunctionRange $currentAfter $needle
$currentSiloFunction =
  $currentAfter.Substring(
    $currentSiloRange.Start,
    $currentSiloRange.End - $currentSiloRange.Start
  )

$siloRestored =
  $currentSiloFunction -ceq
  $stableFunction

Write-Host "Silo collector restored exactly: $siloRestored"

if (-not $siloRestored) {
  Copy-Item -LiteralPath $backup -Destination $Agent -Force
  throw 'Silo collector did not match stable version; restored backup.'
}

$limeDirect =
  $currentAfter.Contains(
    '[PHASE2.5 DIRECT V5] Limestone API complete'
  )

$gearDirect =
  $currentAfter.Contains(
    '[PHASE2.5 DIRECT V5] Gear/Pinion API complete'
  )

Write-Host "Limestone direct path kept: $limeDirect"
Write-Host "Gear/Pinion direct path kept: $gearDirect"

if (-not $limeDirect -or -not $gearDirect) {
  Copy-Item -LiteralPath $backup -Destination $Agent -Force
  throw 'Limestone or Gear direct path is missing; restored backup.'
}

Write-Host ''
Write-Host '===== Patch complete ====='
Write-Host 'Silo uses the original stable UI path.'
Write-Host 'Limestone and Gear/Pinion keep Phase 2.5 direct API.'
Write-Host 'Agent has NOT been restarted.'
Write-Host 'Nothing has been staged or committed.'
