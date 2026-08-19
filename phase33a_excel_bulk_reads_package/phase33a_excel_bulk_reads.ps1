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

Write-Host '===== Phase 3.3A Excel bulk COM reads ====='

Write-Host ''
Write-Host '===== Pre-patch syntax check ====='

& $Node --check $Agent

if ($LASTEXITCODE -ne 0) {
  throw 'Agent already has a syntax error before patch.'
}

$Text =
  [IO.File]::ReadAllText($Agent)

if ($Text.Contains('[PHASE3.3A EXCEL BULK READ]')) {
  throw 'Phase 3.3A is already applied.'
}

foreach (
  $RequiredMarker in @(
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
  "$Agent.before-phase33a-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $Backup `
  -Force

Write-Host "Backup: $Backup"

$Nl =
  Get-NewLine $Text

try {
  # =========================================================
  # 1. Plant day header F5:AJ5
  #    Before: 31 individual COM Range() calls
  #    After : one Range().Value2 call, then in-memory scan
  # =========================================================

  $DayAnchor =
    $Text.IndexOf(
      '  $expectedDayColumn ='
    )

  if ($DayAnchor -lt 0) {
    throw 'Expected day-column anchor was not found.'
  }

  $DayStart =
    $Text.IndexOf(
      '  $dayMatches =',
      $DayAnchor
    )

  $DayEnd =
    $Text.IndexOf(
      '  if (' +
      $Nl +
      '    $dayMatches.Count -ne',
      $DayStart
    )

  if (
    $DayStart -lt 0 -or
    $DayEnd -lt 0
  ) {
    throw 'Plant day-header scan block was not found.'
  }

  $OldDayBlock =
    $Text.Substring(
      $DayStart,
      $DayEnd - $DayStart
    )

  if (-not $OldDayBlock.Contains('Read-ExcelCellValue -Worksheet $plantWorksheet -Address $dayAddress')) {
    throw 'Expected per-cell day-header read was not found.'
  }

  $NewDayBlock =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
  # [PHASE3.3A EXCEL BULK READ]
  Write-DailyDataStage -Message (
    "[PHASE3.3A] Plant day-header bulk read start"
  )

  $dayMatches =
    @()

  $dayHeaderRange =
    $null

  try {
    $dayHeaderRange =
      $plantWorksheet.Range(
        "F5:AJ5"
      )

    $dayHeaderValues =
      $dayHeaderRange.Value2

    if (
      $dayHeaderValues -isnot
        [Array] -or
      $dayHeaderValues.Rank -lt
        2
    ) {
      throw "Plant!F5:AJ5 bulk read did not return a 2D array."
    }

    $rowLower =
      $dayHeaderValues.GetLowerBound(
        0
      )

    $columnLower =
      $dayHeaderValues.GetLowerBound(
        1
      )

    for (
      $offset = 0;
      $offset -lt 31;
      $offset += 1
    ) {
      $columnNumber =
        6 +
        $offset

      $dayValue =
        $dayHeaderValues.GetValue(
          $rowLower,
          (
            $columnLower +
            $offset
          )
        )

      try {
        $numericDay =
          [Convert]::ToDouble(
            $dayValue,
            [Globalization.CultureInfo]::InvariantCulture
          )

        if (
          [Math]::Abs(
            $numericDay -
            $targetDay
          ) -le 0.000001
        ) {
          $dayMatches +=
            $columnNumber
        }
      }
      catch {
      }
    }
  }
  finally {
    Release-ExcelComObject -Value $dayHeaderRange
  }

  Write-DailyDataStage -Message (
    "[PHASE3.3A] Plant day-header bulk read complete"
  )


'@

  $Text =
    Replace-Range `
      -Text $Text `
      -Start $DayStart `
      -End $DayEnd `
      -Replacement $NewDayBlock

  # =========================================================
  # 2. Current-month solar daily row
  #    Before: one COM Range() call per day
  #    After : one horizontal Range().Value2 read
  # =========================================================

  $SolarAnchor =
    $Text.IndexOf(
      '  $dailyValues ='
    )

  if ($SolarAnchor -lt 0) {
    throw 'Solar daily-values anchor was not found.'
  }

  $SolarStart =
    $Text.IndexOf(
      '  $day =' +
      $Nl +
      '    1',
      $SolarAnchor
    )

  $SolarEnd =
    $Text.IndexOf(
      '  $weekOffset =',
      $SolarStart
    )

  if (
    $SolarStart -lt 0 -or
    $SolarEnd -lt 0
  ) {
    throw 'Solar current-month loop was not found.'
  }

  $OldSolarBlock =
    $Text.Substring(
      $SolarStart,
      $SolarEnd - $SolarStart
    )

  if (-not $OldSolarBlock.Contains('Read-ExcelCellValue -Worksheet $PlantWorksheet -Address $address')) {
    throw 'Expected per-cell solar read was not found.'
  }

  $NewSolarBlock =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
  # [PHASE3.3A EXCEL BULK READ]
  Write-DailyDataStage -Message (
    "[PHASE3.3A] Solar current-month bulk read start"
  )

  $solarDailyRange =
    $null

  try {
    $lastSolarColumnName =
      ConvertTo-ExcelColumnName -ColumnNumber (
        5 +
        [int]$TargetDateValue.Day
      )

    $solarDailyRangeAddress =
      "F55:" +
      $lastSolarColumnName +
      "55"

    $solarDailyRange =
      $PlantWorksheet.Range(
        $solarDailyRangeAddress
      )

    $solarDailyRangeValues =
      $solarDailyRange.Value2

    if (
      $solarDailyRangeValues -isnot
        [Array] -or
      $solarDailyRangeValues.Rank -lt
        2
    ) {
      throw (
        "Solar bulk read did not return a 2D array: Plant!" +
        $solarDailyRangeAddress
      )
    }

    $solarRowLower =
      $solarDailyRangeValues.GetLowerBound(
        0
      )

    $solarColumnLower =
      $solarDailyRangeValues.GetLowerBound(
        1
      )

    $day =
      1

    while (
      $day -le
        $TargetDateValue.Day
    ) {
      $columnName =
        ConvertTo-ExcelColumnName -ColumnNumber (
          5 +
          $day
        )

      $address =
        $columnName +
        "55"

      $dateValue =
        Get-Date -Year $TargetDateValue.Year -Month $TargetDateValue.Month -Day $day

      $dateKey =
        $dateValue.ToString(
          "yyyy-MM-dd",
          [Globalization.CultureInfo]::InvariantCulture
        )

      $rawSolarValue =
        $solarDailyRangeValues.GetValue(
          $solarRowLower,
          (
            $solarColumnLower +
            $day -
            1
          )
        )

      try {
        $solarValue =
          Get-FiniteExcelNumber -Value $rawSolarValue -Label (
            "solar daily generation (" +
            $dateKey +
            ", Plant!" +
            $address +
            ")"
          )

        if (
          $solarValue -lt 0
        ) {
          throw (
            "Solar daily generation is below zero: " +
            $dateKey
          )
        }

        $dailyValues[$dateKey] =
          [double]$solarValue
      }
      catch {
        $dailyValues[$dateKey] =
          $null

        $historyErrors +=
          $_.Exception.Message
      }

      $day +=
        1
    }
  }
  finally {
    Release-ExcelComObject -Value $solarDailyRange
  }

  Write-DailyDataStage -Message (
    "[PHASE3.3A] Solar current-month bulk read complete"
  )


'@

  $Text =
    Replace-Range `
      -Text $Text `
      -Start $SolarStart `
      -End $SolarEnd `
      -Replacement $NewSolarBlock

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
      'Phase 3.3A marker' =
        $Final.Contains(
          '[PHASE3.3A EXCEL BULK READ]'
        )

      'Day-header bulk stage' =
        $Final.Contains(
          '[PHASE3.3A] Plant day-header bulk read complete'
        )

      'Solar bulk stage' =
        $Final.Contains(
          '[PHASE3.3A] Solar current-month bulk read complete'
        )

      'Water Direct kept' =
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
  Write-Host '===== Phase 3.3A patch complete ====='
  Write-Host 'Plant day-header validation now uses one COM range read.'
  Write-Host 'Current-month solar daily history now uses one COM range read.'
  Write-Host 'Existing validations and result calculations remain in place.'
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
