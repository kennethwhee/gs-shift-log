param(
  [string]$Repo = 'C:\Users\user\Documents\GitHub\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

$StyleFile = Join-Path $Repo 'style.css'
$IndexFile = Join-Path $Repo 'index.html'

foreach ($File in @($StyleFile, $IndexFile)) {
  if (-not (Test-Path -LiteralPath $File)) {
    throw "Required file not found: $File"
  }
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

Write-Host '===== Limestone receipt PC font patch ====='

Write-Host ''
Write-Host '===== 1. Current Git state ====='
git status --short

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$BackupDir =
  Join-Path `
    "$env:USERPROFILE\Desktop\gs-shift-log-backup" `
    "limestone-receipt-pc-font-$Stamp"

New-Item `
  -ItemType Directory `
  -Path $BackupDir `
  -Force |
Out-Null

Copy-Item `
  -LiteralPath $StyleFile `
  -Destination (Join-Path $BackupDir 'style.css') `
  -Force

Copy-Item `
  -LiteralPath $IndexFile `
  -Destination (Join-Path $BackupDir 'index.html') `
  -Force

Write-Host "Backup: $BackupDir"

$StyleText =
  [IO.File]::ReadAllText(
    $StyleFile
  )

$IndexText =
  [IO.File]::ReadAllText(
    $IndexFile
  )

if (
  $StyleText.Contains(
    '[LIMESTONE-RECEIPT-PC-FONT-UP]'
  )
) {
  throw 'Limestone receipt PC font patch is already applied.'
}

$Nl =
  Get-NewLine $StyleText

try {
  $SectionStartMarker =
    '/* =========================================================' +
    $Nl +
    '   LIMESTONE RECEIPT UNIT COLOR PC V1'

  $SectionEndMarker =
    '/* END LIMESTONE RECEIPT UNIT COLOR PC V1 */'

  $SectionStart =
    $StyleText.IndexOf(
      $SectionStartMarker
    )

  if ($SectionStart -lt 0) {
    throw 'Existing LIMESTONE RECEIPT UNIT COLOR PC V1 section was not found.'
  }

  $SectionEnd =
    $StyleText.IndexOf(
      $SectionEndMarker,
      $SectionStart
    )

  if ($SectionEnd -lt 0) {
    throw 'End of LIMESTONE RECEIPT UNIT COLOR PC V1 section was not found.'
  }

  $SectionText =
    $StyleText.Substring(
      $SectionStart,
      $SectionEnd -
        $SectionStart
    )

  $MediaMarker =
    '@media screen and (min-width: 769px) {' +
    $Nl

  $MediaPos =
    $SectionText.IndexOf(
      $MediaMarker
    )

  if ($MediaPos -lt 0) {
    throw 'PC media query was not found inside limestone receipt PC section.'
  }

  $InsertPos =
    $MediaPos +
    $MediaMarker.Length

  $PcFontRules =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'

  /* [LIMESTONE-RECEIPT-PC-FONT-UP]
    PC 입고기록 상세 글씨만 소폭 확대
    행 높이와 표 레이아웃은 그대로 유지
  */

  #efficiencyTeamModal
  #efficiencyLimestoneView
  .limestone-receipt-history-card
  .limestone-section-header
  > div
  > span {
    font-size: 9px !important;
  }


  #efficiencyTeamModal
  #efficiencyLimestoneView
  .limestone-receipt-history-card
  .limestone-section-header
  h4 {
    font-size: 15px !important;
  }


  #efficiencyTeamModal
  #efficiencyLimestoneView
  .limestone-receipt-history-card
  .limestone-section-count {
    font-size: 10px !important;
  }


  #efficiencyTeamModal
  #efficiencyLimestoneView
  .limestone-receipt-history-card
  .limestone-receipt-table
  thead
  th {
    font-size: 11px !important;
  }


  #efficiencyTeamModal
  #efficiencyLimestoneView
  .limestone-receipt-history-card
  .limestone-receipt-table
  td {
    font-size: 11px !important;
  }


  #efficiencyTeamModal
  #efficiencyLimestoneView
  .limestone-receipt-history-card
  .limestone-edit-button,

  #efficiencyTeamModal
  #efficiencyLimestoneView
  .limestone-receipt-history-card
  .limestone-delete-button {
    font-size: 10px !important;
  }

'@

  $SectionText =
    $SectionText.Substring(
      0,
      $InsertPos
    ) +
    $PcFontRules +
    $SectionText.Substring(
      $InsertPos
    )

  $StyleText =
    $StyleText.Substring(
      0,
      $SectionStart
    ) +
    $SectionText +
    $StyleText.Substring(
      $SectionEnd
    )

  $IndexText =
    [regex]::Replace(
      $IndexText,
      'href="style\.css(?:\?v=[^"]*)?"',
      'href="style.css?v=20260821-limestone-receipt-pc-font1"',
      1
    )

  [IO.File]::WriteAllText(
    $StyleFile,
    $StyleText,
    (New-Object Text.UTF8Encoding($false))
  )

  [IO.File]::WriteAllText(
    $IndexFile,
    $IndexText,
    (New-Object Text.UTF8Encoding($false))
  )

  Write-Host ''
  Write-Host '===== 2. git diff --check ====='

  git diff --check -- `
    style.css `
    index.html

  if ($LASTEXITCODE -ne 0) {
    throw 'git diff --check failed.'
  }

  $FinalStyle =
    [IO.File]::ReadAllText(
      $StyleFile
    )

  $FinalIndex =
    [IO.File]::ReadAllText(
      $IndexFile
    )

  $FinalSectionStart =
    $FinalStyle.IndexOf(
      $SectionStartMarker
    )

  $FinalSectionEnd =
    $FinalStyle.IndexOf(
      $SectionEndMarker,
      $FinalSectionStart
    )

  $FinalSection =
    $FinalStyle.Substring(
      $FinalSectionStart,
      $FinalSectionEnd -
        $FinalSectionStart
    )

  Write-Host ''
  Write-Host '===== 3. Verification ====='

  Write-Host (
    'PC patch marker: ' +
    $FinalSection.Contains(
      '[LIMESTONE-RECEIPT-PC-FONT-UP]'
    )
  )

  Write-Host (
    'PC title 15px: ' +
    $FinalSection.Contains(
      '.limestone-section-header' +
      $Nl +
      '  h4 {' +
      $Nl +
      '    font-size: 15px !important;'
    )
  )

  Write-Host (
    'PC table header 11px: ' +
    $FinalSection.Contains(
      '.limestone-receipt-table' +
      $Nl +
      '  thead' +
      $Nl +
      '  th {' +
      $Nl +
      '    font-size: 11px !important;'
    )
  )

  Write-Host (
    'PC table body 11px: ' +
    $FinalSection.Contains(
      '.limestone-receipt-table' +
      $Nl +
      '  td {' +
      $Nl +
      '    font-size: 11px !important;'
    )
  )

  Write-Host (
    'PC action buttons 10px: ' +
    $FinalSection.Contains(
      '.limestone-delete-button {' +
      $Nl +
      '    font-size: 10px !important;'
    )
  )

  Write-Host (
    'Style cache updated: ' +
    $FinalIndex.Contains(
      'style.css?v=20260821-limestone-receipt-pc-font1'
    )
  )

  Write-Host ''
  Write-Host '===== 4. Changed files ====='

  git status --short -- `
    style.css `
    index.html

  Write-Host ''
  git diff --stat -- `
    style.css `
    index.html

  Write-Host ''
  Write-Host '===== Patch complete ====='
  Write-Host 'PC limestone receipt-detail fonts were increased slightly.'
  Write-Host 'Mobile receipt font rules were not changed.'
  Write-Host 'No commit or push was performed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring files ====='

  Copy-Item `
    -LiteralPath (Join-Path $BackupDir 'style.css') `
    -Destination $StyleFile `
    -Force

  Copy-Item `
    -LiteralPath (Join-Path $BackupDir 'index.html') `
    -Destination $IndexFile `
    -Force

  Write-Host 'Restore complete.'
  throw
}
