param(
  [string]$Repo = 'C:\Users\GSENR\Desktop\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

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

Write-Host '===== Phase 2.9 v2 Water screen warmup ====='

Write-Host ''
Write-Host '===== Pre-patch syntax check ====='

& $Node --check $Agent

if ($LASTEXITCODE -ne 0) {
  throw 'Agent already has a syntax error before patch.'
}

$Text =
  [IO.File]::ReadAllText($Agent)

if ($Text.Contains('[PHASE2.9 WATER SCREEN WARMUP]')) {
  throw 'Phase 2.9 is already applied.'
}

foreach (
  $RequiredMarker in @(
    '[PHASE2.5 DIRECT V5] Limestone API complete',
    '[PHASE2.5 DIRECT V5] Gear/Pinion API complete',
    '[PHASE2.6 WARMUP]',
    '[PHASE2.7A WATER-EXCEL GATE]',
    '[PHASE2.7B ORGANIC OPTIONAL V2]',
    '[PHASE2.8B WATER-FIRST]'
  )
) {
  if (-not $Text.Contains($RequiredMarker)) {
    throw "Required previous phase marker is missing: $RequiredMarker"
  }
}

if (-not $Text.Contains('async function openOisEnvironmentDailyLog(')) {
  throw 'openOisEnvironmentDailyLog function was not found.'
}

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$Backup =
  "$Agent.before-phase29-v2-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $Backup `
  -Force

Write-Host "Backup: $Backup"

$Nl =
  Get-NewLine $Text

try {
  $WarmupMarkerIndex =
    $Text.IndexOf(
      '[PHASE2.6 WARMUP]'
    )

  if ($WarmupMarkerIndex -lt 0) {
    throw 'Phase 2.6 warmup marker was not found.'
  }

  $WarmupReasonIndex =
    $Text.IndexOf(
      '"Phase 2.6 startup warmup"',
      $WarmupMarkerIndex
    )

  if ($WarmupReasonIndex -lt 0) {
    throw 'Phase 2.6 startup warmup reason was not found.'
  }

  $EnsureCallIndex =
    $Text.LastIndexOf(
      'await ensureBrowserSession(',
      $WarmupReasonIndex
    )

  if (
    $EnsureCallIndex -lt 0 -or
    $EnsureCallIndex -lt
      $WarmupMarkerIndex
  ) {
    throw 'Phase 2.6 ensureBrowserSession call was not found.'
  }

  $EnsureCallEnd =
    $Text.IndexOf(
      ');',
      $WarmupReasonIndex
    )

  if ($EnsureCallEnd -lt 0) {
    throw 'Phase 2.6 ensureBrowserSession call end was not found.'
  }

  $EnsureCallEnd +=
    2

  $IndentLineStart =
    $Text.LastIndexOf(
      $Nl,
      $EnsureCallIndex
    )

  if ($IndentLineStart -lt 0) {
    $IndentLineStart =
      0
  } else {
    $IndentLineStart +=
      $Nl.Length
  }

  $IndentLength =
    $EnsureCallIndex -
    $IndentLineStart

  $Indent =
    ' ' *
    $IndentLength

  $InnerIndent =
    $Indent +
    '  '

  $DeeperIndent =
    $InnerIndent +
    '  '

  $Lines =
    @(
      '',
      '',
      ($Indent + '/*'),
      ($InnerIndent + '[PHASE2.9 WATER SCREEN WARMUP]'),
      ($InnerIndent + 'Pre-open the existing Water environment log screen once at Agent startup.'),
      ($InnerIndent + 'No date change, query click, or recalculation is performed here.'),
      ($InnerIndent + 'The same single Edge browser/page is reused.'),
      ($Indent + '*/'),
      ($Indent + 'const phase29WaterScreenStartedAt ='),
      ($InnerIndent + 'Date.now();'),
      '',
      '',
      ($Indent + 'console.log('),
      ($InnerIndent + '"[PHASE2.9 WATER SCREEN WARMUP] environment screen warmup started"'),
      ($Indent + ');'),
      '',
      '',
      ($Indent + 'try {'),
      ($InnerIndent + 'await openOisEnvironmentDailyLog('),
      ($DeeperIndent + 'browserSession.page'),
      ($InnerIndent + ');'),
      '',
      '',
      ($InnerIndent + 'console.log('),
      ($DeeperIndent + '"[PHASE2.9 WATER SCREEN WARMUP] environment screen warmup complete " +'),
      ($DeeperIndent + '('),
      ($DeeperIndent + '  ('),
      ($DeeperIndent + '    Date.now() -'),
      ($DeeperIndent + '    phase29WaterScreenStartedAt'),
      ($DeeperIndent + '  ) /'),
      ($DeeperIndent + '  1000'),
      ($DeeperIndent + ').toFixed('),
      ($DeeperIndent + '  2'),
      ($DeeperIndent + ') +'),
      ($DeeperIndent + '"s"'),
      ($InnerIndent + ');'),
      '',
      ($Indent + '} catch ('),
      ($InnerIndent + 'phase29WaterScreenError'),
      ($Indent + ') {'),
      ($InnerIndent + 'console.warn('),
      ($DeeperIndent + '"[PHASE2.9 WATER SCREEN WARMUP] environment screen warmup failed; normal Water navigation remains enabled:",'),
      ($DeeperIndent + 'phase29WaterScreenError instanceof'),
      ($DeeperIndent + '  Error'),
      ($DeeperIndent + '  ? phase29WaterScreenError.message'),
      ($DeeperIndent + '  : phase29WaterScreenError'),
      ($InnerIndent + ');'),
      ($Indent + '}')
    )

  $Insert =
    $Lines -join
    $Nl

  $Text =
    $Text.Insert(
      $EnsureCallEnd,
      $Insert
    )

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
      'Phase 2.9 marker' =
        $Final.Contains(
          '[PHASE2.9 WATER SCREEN WARMUP]'
        )

      'Environment warmup call' =
        $Final.Contains(
          'await openOisEnvironmentDailyLog('
        )

      'Phase 2.8B kept' =
        $Final.Contains(
          '[PHASE2.8B WATER-FIRST]'
        )

      'Limestone direct kept' =
        $Final.Contains(
          '[PHASE2.5 DIRECT V5] Limestone API complete'
        )

      'Gear direct kept' =
        $Final.Contains(
          '[PHASE2.5 DIRECT V5] Gear/Pinion API complete'
        )

      'Warmup kept' =
        $Final.Contains(
          '[PHASE2.6 WARMUP]'
        )

      'Water-Excel gate kept' =
        $Final.Contains(
          '[PHASE2.7A WATER-EXCEL GATE]'
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

  if ($Checks.Values -contains $false) {
    throw 'One or more verification checks failed.'
  }

  Write-Host ''
  Write-Host '===== Changed file ====='

  git status --short -- `
    local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Diff summary ====='

  git diff --stat -- `
    local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Phase 2.9 v2 patch complete ====='
  Write-Host 'Agent startup now pre-opens the Water environment screen once.'
  Write-Host 'No Water date query or recalculation is performed during warmup.'
  Write-Host 'Single Edge browser and single OIS Page are preserved.'
  Write-Host 'Agent has NOT been restarted.'
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
