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

Write-Host '===== Phase 2.8B Water-first OIS ordering ====='

Write-Host ''
Write-Host '===== Locate pre-2.8A stable backup ====='

$Stable =
  Get-ChildItem `
    (Join-Path $Repo 'local-tools\ois-agent') `
    -Filter 'ois-login.js.before-phase28a-v2-*.bak' `
    -File `
    -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Stable) {
  throw 'Pre-2.8A stable backup was not found.'
}

Write-Host "Stable: $($Stable.FullName)"

$StableText =
  [IO.File]::ReadAllText(
    $Stable.FullName
  )

foreach (
  $RequiredMarker in @(
    '[PHASE2.5 DIRECT V5] Limestone API complete',
    '[PHASE2.5 DIRECT V5] Gear/Pinion API complete',
    '[PHASE2.6 WARMUP]',
    '[PHASE2.7A WATER-EXCEL GATE]',
    '[PHASE2.7B ORGANIC OPTIONAL V2]'
  )
) {
  if (-not $StableText.Contains($RequiredMarker)) {
    throw "Stable backup is missing marker: $RequiredMarker"
  }
}

if ($StableText.Contains('[PHASE2.8A DETACHED EXCEL LANE]')) {
  throw 'Selected backup already contains Phase 2.8A.'
}

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$CurrentBackup =
  "$Agent.before-phase28b-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $CurrentBackup `
  -Force

Write-Host "Current backup: $CurrentBackup"

Write-Host ''
Write-Host '===== Restore exact pre-2.8A Agent ====='

Copy-Item `
  -LiteralPath $Stable.FullName `
  -Destination $Agent `
  -Force

$Text =
  [IO.File]::ReadAllText($Agent)

$Nl =
  Get-NewLine $Text

try {
  $OldBlock =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
  const orderedOisRequestTypes =
    oisRequestTypes.map(
      (
        requestType,
        offset
      ) => {
        return oisRequestTypes[
          (
            oisStartIndex +
            offset
          ) %
          oisRequestTypes.length
        ];
      }
    );
'@

  $MatchCount =
    ([regex]::Matches(
      $Text,
      [regex]::Escape(
        $OldBlock
      )
    )).Count

  if ($MatchCount -ne 1) {
    throw "Expected exactly one OIS ordering block, found: $MatchCount"
  }

  $NewBlock =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
  /*
    [PHASE2.8B WATER-FIRST]

    Keep the single OIS browser/page model.

    Water is always offered first to the server.
    This keeps consecutive Water dates on the environment page,
    avoiding an expensive Silo -> Water menu round trip.

    Non-Water request types still keep the existing rotating order.
  */
  const rotatedOisRequestTypes =
    oisRequestTypes.map(
      (
        requestType,
        offset
      ) => {
        return oisRequestTypes[
          (
            oisStartIndex +
            offset
          ) %
          oisRequestTypes.length
        ];
      }
    );


  const orderedOisRequestTypes = [
    "water_environment",
    ...rotatedOisRequestTypes.filter(
      requestType => {
        return requestType !==
          "water_environment";
      }
    )
  ];
'@

  $Text =
    $Text.Replace(
      $OldBlock,
      $NewBlock
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
      'Phase 2.8A removed' =
        -not $Final.Contains(
          '[PHASE2.8A DETACHED EXCEL LANE]'
        )

      'Phase 2.8B marker' =
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

  if (
    $Checks.Values -contains
      $false
  ) {
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
  Write-Host '===== Phase 2.8B patch complete ====='
  Write-Host 'Phase 2.8A detached Excel experiment was removed.'
  Write-Host 'Water is now offered first on every OIS lane claim.'
  Write-Host 'Excel/Silo forced overlap is not used.'
  Write-Host 'Single Edge browser and single OIS Page are preserved.'
  Write-Host 'Agent has NOT been restarted.'
  Write-Host 'Nothing has been staged or committed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring current Agent ====='

  Copy-Item `
    -LiteralPath $CurrentBackup `
    -Destination $Agent `
    -Force

  Write-Host 'Restore complete.'

  throw
}
