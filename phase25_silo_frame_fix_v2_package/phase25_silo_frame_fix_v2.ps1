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

Write-Host '===== Phase 2.5 Silo frame-context fix v2 ====='

$text = [IO.File]::ReadAllText($Agent)

if (-not $text.Contains('[PHASE2.5 DIRECT V5]')) {
  throw 'Phase 2.5 Direct V5 marker was not found.'
}

if ($text.Contains('[PHASE2.5 SILO FRAME]')) {
  throw 'Silo frame-context fix is already applied.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Agent.before-phase25-silo-frame-v2-$stamp.bak"

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
  throw 'Could not find Silo direct function end boundary.'
}

$block =
  $text.Substring(
    $functionStart,
    $nextFunction - $functionStart
  )

$valuesNeedle =
  '  const values = {};'

$valuesIndex =
  $block.IndexOf(
    $valuesNeedle
  )

if ($valuesIndex -lt 0) {
  throw 'Silo values anchor was not found.'
}

$lineBreak =
  if ($block.Contains("`r`n")) {
    "`r`n"
  } else {
    "`n"
  }

$frameLines = @(
  '  /*',
  '    [PHASE2.5 SILO FRAME]',
  '    TAG LOG AJAX must run inside the TAG LOG iframe context.',
  '    Calling /ajax/data from the top page returns the TOSSWARE HTML shell.',
  '  */',
  '  const phase25TagLogFrame =',
  '    await openOisTagLogLookup(',
  '      page',
  '    );',
  '',
  ''
)

$frameCode =
  ($frameLines -join $lineBreak)

$block =
  $block.Insert(
    $valuesIndex,
    $frameCode
  )

$pattern =
  '(?m)(await\s+requestOisPhase25UppercaseAjaxData\(\r?\n)(\s*)page,'

$replaceCount =
  [regex]::Matches(
    $block,
    $pattern
  ).Count

Write-Host "Silo direct API frame call replacements: $replaceCount"

if ($replaceCount -ne 2) {
  throw "Expected exactly 2 Silo direct API calls, found $replaceCount."
}

$block =
  [regex]::Replace(
    $block,
    $pattern,
    '${1}${2}phase25TagLogFrame,'
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
Write-Host '===== Silo frame-context fix v2 complete ====='
Write-Host 'Agent has NOT been restarted.'
Write-Host 'Nothing has been staged or committed.'
