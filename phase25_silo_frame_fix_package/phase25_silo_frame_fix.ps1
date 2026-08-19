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

Write-Host '===== Phase 2.5 Silo frame-context fix ====='

$text = [IO.File]::ReadAllText($Agent)

if (-not $text.Contains('[PHASE2.5 DIRECT V5]')) {
  throw 'Phase 2.5 Direct V5 marker was not found.'
}

if ($text.Contains('[PHASE2.5 SILO FRAME]')) {
  throw 'Silo frame-context fix is already applied.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Agent.before-phase25-silo-frame-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $backup -Force
Write-Host "Backup: $backup"

$functionStart =
  $text.IndexOf(
    'async function collectOisPhase25SiloLevelDirect('
  )

if ($functionStart -lt 0) {
  throw 'collectOisPhase25SiloLevelDirect was not found.'
}

$nextFunction =
  $text.IndexOf(
    'async function ',
    $functionStart + 20
  )

if ($nextFunction -lt 0) {
  throw 'Could not find end boundary for Silo direct function.'
}

$block =
  $text.Substring(
    $functionStart,
    $nextFunction - $functionStart
  )

$compactEndNeedle = @'
  const compactDate =
    targetDate.replace(
      /-/g,
      ""
    );
'@

$compactIndex =
  $block.IndexOf(
    $compactEndNeedle
  )

if ($compactIndex -lt 0) {
  throw 'compactDate block was not found in Silo direct function.'
}

$insertAt =
  $compactIndex +
  $compactEndNeedle.Length

$frameCode = @'


  /*
    [PHASE2.5 SILO FRAME]
    TAG LOG AJAX must run inside the TAG LOG iframe context.
    Calling /ajax/data from the top page returns the TOSSWARE HTML shell.
  */
  const phase25TagLogFrame =
    await openOisTagLogLookup(
      page
    );
'@

$block =
  $block.Insert(
    $insertAt,
    $frameCode
  )

# Only replace calls inside this direct Silo function.
$callNeedle =
  'await requestOisPhase25UppercaseAjaxData(' + "`r`n" +
  '      page,'

if (-not $block.Contains($callNeedle)) {
  # LF fallback
  $callNeedle =
    'await requestOisPhase25UppercaseAjaxData(' + "`n" +
    '      page,'
}

$replacement =
  'await requestOisPhase25UppercaseAjaxData(' +
  (
    if ($callNeedle.Contains("`r`n")) { "`r`n" } else { "`n" }
  ) +
  '      phase25TagLogFrame,'

$replaceCount =
  ([regex]::Matches(
    $block,
    [regex]::Escape($callNeedle)
  )).Count

Write-Host "Silo direct API frame call replacements: $replaceCount"

if ($replaceCount -lt 2) {
  throw "Expected at least 2 Silo direct API calls, found $replaceCount."
}

$block =
  $block.Replace(
    $callNeedle,
    $replacement
  )

$text =
  $text.Substring(
    0,
    $functionStart
  ) +
  $block +
  $text.Substring(
    $nextFunction
  )

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
  -Pattern `
    '[PHASE2.5 SILO FRAME]',
    'phase25TagLogFrame' |
Select-Object LineNumber,Line |
Format-Table -AutoSize

Write-Host ''
Write-Host '===== Silo frame-context fix complete ====='
Write-Host 'Agent has NOT been restarted.'
Write-Host 'Nothing has been staged or committed.'
