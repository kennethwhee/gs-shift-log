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

Write-Host '===== Phase 2.9 Water screen warmup ====='

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
  "$Agent.before-phase29-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $Backup `
  -Force

Write-Host "Backup: $Backup"

$Nl =
  if ($Text.Contains("`r`n")) {
    "`r`n"
  } else {
    "`n"
  }

try {
  $Needle =
    '        await ensureBrowserSession(' +
    $Nl +
    '          "Phase 2.6 startup warmup"' +
    $Nl +
    '        );'

  $Count =
    ([regex]::Matches(
      $Text,
      [regex]::Escape($Needle)
    )).Count

  if ($Count -ne 1) {
    throw "Expected one Phase 2.6 warmup session call, found: $Count"
  }

  $Insert =
    @(
      '',
      '',
      '        /*',
      '          [PHASE2.9 WATER SCREEN WARMUP]',
      '          Open the existing Water environment log screen once at Agent startup.',
      '          No date change, query click, or recalculation is performed here.',
      '          The same single Edge browser/page is reused.',
      '        */',
      '        const phase29WaterScreenStartedAt =',
      '          Date.now();',
      '',
      '',
      '        console.log(',
      '          "[PHASE2.9 WATER SCREEN WARMUP] environment screen warmup started"',
      '        );',
      '',
      '',
      '        try {',
      '          await openOisEnvironmentDailyLog(',
      '            browserSession.page',
      '          );',
      '',
      '',
      '          console.log(',
      '            "[PHASE2.9 WATER SCREEN WARMUP] environment screen warmup complete " +',
      '            (',
      '              (',
      '                Date.now() -',
      '                phase29WaterScreenStartedAt',
      '              ) /',
      '              1000',
      '            ).toFixed(',
      '              2',
      '            ) +',
      '            "s"',
      '          );',
      '',
      '        } catch (',
      '          phase29WaterScreenError',
      '        ) {',
      '          console.warn(',
      '            "[PHASE2.9 WATER SCREEN WARMUP] environment screen warmup failed; normal Water navigation remains enabled:",',
      '            phase29WaterScreenError instanceof',
      '              Error',
      '              ? phase29WaterScreenError.message',
      '              : phase29WaterScreenError',
      '          );',
      '        }'
    ) -join $Nl

  $Text =
    $Text.Replace(
      $Needle,
      $Needle + $Insert
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

      'Water screen opener present' =
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
  Write-Host '===== Phase 2.9 patch complete ====='
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
