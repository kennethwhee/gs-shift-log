param(
  [string]$Repo = 'C:\Users\user\Documents\GitHub\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

$ScriptFile =
  Join-Path $Repo 'script.js'

$IndexFile =
  Join-Path $Repo 'index.html'

if (-not (Test-Path -LiteralPath $ScriptFile)) {
  throw "script.js not found: $ScriptFile"
}

if (-not (Test-Path -LiteralPath $IndexFile)) {
  throw "index.html not found: $IndexFile"
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

Write-Host '===== BO1/BO2 reload source-date fix ====='

Write-Host ''
Write-Host '===== 1. Current Git state ====='
git status --short

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$BackupDir =
  Join-Path `
    "$env:USERPROFILE\Desktop\gs-shift-log-backup" `
    "boiler-reload-date-$Stamp"

New-Item `
  -ItemType Directory `
  -Path $BackupDir `
  -Force |
Out-Null

Copy-Item `
  -LiteralPath $ScriptFile `
  -Destination (Join-Path $BackupDir 'script.js') `
  -Force

Copy-Item `
  -LiteralPath $IndexFile `
  -Destination (Join-Path $BackupDir 'index.html') `
  -Force

Write-Host ''
Write-Host "Backup: $BackupDir"

$ScriptText =
  [IO.File]::ReadAllText(
    $ScriptFile
  )

$IndexText =
  [IO.File]::ReadAllText(
    $IndexFile
  )

if (
  $ScriptText.Contains(
    '[BOILER-RELOAD-DATE-FIX]'
  )
) {
  throw 'BO1/BO2 reload date fix is already applied.'
}

$Nl =
  Get-NewLine $ScriptText

try {
  $IifeStart =
    $ScriptText.IndexOf(
      '(function installMorningMeetingBoilerReloadButton()'
    )

  if ($IifeStart -lt 0) {
    throw 'installMorningMeetingBoilerReloadButton IIFE was not found.'
  }

  $FunctionStart =
    $ScriptText.IndexOf(
      '  function resolveBoilerReportDate() {',
      $IifeStart
    )

  if ($FunctionStart -lt 0) {
    throw 'resolveBoilerReportDate() inside reload-button IIFE was not found.'
  }

  $ReloadStart =
    $ScriptText.IndexOf(
      '  async function reloadBoilerLogs() {',
      $FunctionStart
    )

  if ($ReloadStart -lt 0) {
    throw 'reloadBoilerLogs() after resolveBoilerReportDate() was not found.'
  }

  $OldFunction =
    $ScriptText.Substring(
      $FunctionStart,
      $ReloadStart - $FunctionStart
    )

  foreach (
    $Expected in @(
      'efficiencyMorningMeetingAutoBoilerDate',
      'state.boilerTemperatures',
      'state.shiftPart'
    )
  ) {
    if (-not $OldFunction.Contains($Expected)) {
      throw "Unexpected resolveBoilerReportDate() structure: missing $Expected"
    }
  }

  $NewFunction =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
  function resolveBoilerReportDate() {
    const state =
      window
        .efficiencyMorningMeetingUploadState ||
      {};


    /*
      [BOILER-RELOAD-DATE-FIX]

      The date printed on the boiler-temperature card is a display date
      for the post-midnight N/S temperature.

      The dedicated BO1/BO2 reload button must query the source shift-log
      work date instead.

      Example:
      auto-data base date  = 2026-08-19
      boiler display date  = 2026-08-20
      source shift logs    = 2026-08-19 N/S

      Use the same base-date source as the normal morning-meeting analysis.
      The displayed boiler date is kept only as the final fallback.
    */
    const commonBaseDate =
      document
        .getElementById(
          "efficiencyMorningMeetingWaterPanel"
        )
        ?.dataset
        ?.morningMeetingAutoBaseDate;


    const candidates = [
      commonBaseDate,

      state.shiftPart
        ?.reportDate,

      state.shiftPart
        ?.loadedDate,

      state.boilerTemperatures
        ?.reportDate,

      document
        .getElementById(
          "efficiencyMorningMeetingAutoBoilerDate"
        )
        ?.textContent
    ];


    const resolvedDate =
      candidates
        .map(
          normalizeDate
        )
        .find(
          Boolean
        ) ||
      "";


    console.log(
      "[BOILER-RELOAD-DATE-FIX] BO1·BO2 reload source work date:",
      {
        resolvedDate,

        commonBaseDate:
          normalizeDate(
            commonBaseDate
          ),

        displayDate:
          normalizeDate(
            document
              .getElementById(
                "efficiencyMorningMeetingAutoBoilerDate"
              )
              ?.textContent
          )
      }
    );


    return resolvedDate;
  }


'@

  $ScriptText =
    $ScriptText.Substring(
      0,
      $FunctionStart
    ) +
    $NewFunction +
    $ScriptText.Substring(
      $ReloadStart
    )

  $CachePattern =
    'src="script\.js\?v=[^"]+"'

  $CacheMatches =
    [regex]::Matches(
      $IndexText,
      $CachePattern
    )

  if ($CacheMatches.Count -ne 1) {
    throw "Expected exactly one script.js cache src in index.html, found $($CacheMatches.Count)."
  }

  $IndexText =
    [regex]::Replace(
      $IndexText,
      $CachePattern,
      'src="script.js?v=20260820-boiler-reload-date1"',
      1
    )

  [IO.File]::WriteAllText(
    $ScriptFile,
    $ScriptText,
    (New-Object Text.UTF8Encoding($false))
  )

  [IO.File]::WriteAllText(
    $IndexFile,
    $IndexText,
    (New-Object Text.UTF8Encoding($false))
  )

  Write-Host ''
  Write-Host '===== 2. JavaScript syntax check ====='

  $NodeCandidates = @(
    'C:\Users\user\Documents\nodejs\node.exe',
    'C:\Program Files\nodejs\node.exe'
  )

  $Node =
    $NodeCandidates |
    Where-Object {
      Test-Path -LiteralPath $_
    } |
    Select-Object -First 1

  if (-not $Node) {
    $NodeCommand =
      Get-Command node -ErrorAction SilentlyContinue

    if ($NodeCommand) {
      $Node =
        $NodeCommand.Source
    }
  }

  if (-not $Node) {
    throw 'node.exe was not found for syntax check.'
  }

  Write-Host "Node: $Node"

  & $Node --check $ScriptFile

  if ($LASTEXITCODE -ne 0) {
    throw 'script.js syntax check failed.'
  }

  Write-Host ''
  Write-Host '===== 3. git diff --check ====='

  git diff --check -- `
    script.js `
    index.html

  if ($LASTEXITCODE -ne 0) {
    throw 'git diff --check failed.'
  }

  $FinalScript =
    [IO.File]::ReadAllText(
      $ScriptFile
    )

  $FinalIndex =
    [IO.File]::ReadAllText(
      $IndexFile
    )

  $FunctionCheckStart =
    $FinalScript.IndexOf(
      '[BOILER-RELOAD-DATE-FIX]'
    )

  $FunctionCheckEnd =
    $FinalScript.IndexOf(
      '  async function reloadBoilerLogs() {',
      $FunctionCheckStart
    )

  $FunctionCheck =
    $FinalScript.Substring(
      $FunctionCheckStart,
      $FunctionCheckEnd - $FunctionCheckStart
    )

  $CommonPos =
    $FunctionCheck.IndexOf(
      'morningMeetingAutoBaseDate'
    )

  $DisplayPos =
    $FunctionCheck.IndexOf(
      'efficiencyMorningMeetingAutoBoilerDate'
    )

  Write-Host ''
  Write-Host '===== 4. Verification ====='

  Write-Host (
    'Fix marker: ' +
    $FinalScript.Contains(
      '[BOILER-RELOAD-DATE-FIX]'
    )
  )

  Write-Host (
    'Common base date preferred: ' +
    (
      $CommonPos -ge 0 -and
      $DisplayPos -gt $CommonPos
    )
  )

  Write-Host (
    'Dedicated reload function kept: ' +
    $FinalScript.Contains(
      'async function reloadBoilerLogs()'
    )
  )

  Write-Host (
    'Cache version updated: ' +
    $FinalIndex.Contains(
      'src="script.js?v=20260820-boiler-reload-date1"'
    )
  )

  Write-Host ''
  Write-Host '===== 5. Changed files ====='

  git status --short -- `
    script.js `
    index.html

  Write-Host ''
  git diff --stat -- `
    script.js `
    index.html

  Write-Host ''
  Write-Host '===== Patch complete ====='
  Write-Host 'The dedicated BO1/BO2 reload now prefers the automatic-data base date.'
  Write-Host 'The boiler card display date is unchanged.'
  Write-Host 'No commit or push was performed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring both files ====='

  Copy-Item `
    -LiteralPath (Join-Path $BackupDir 'script.js') `
    -Destination $ScriptFile `
    -Force

  Copy-Item `
    -LiteralPath (Join-Path $BackupDir 'index.html') `
    -Destination $IndexFile `
    -Force

  Write-Host 'Restore complete.'
  throw
}
