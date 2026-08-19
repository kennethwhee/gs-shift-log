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

Write-Host '===== Phase 2.6 OIS startup warmup ====='

$text = [IO.File]::ReadAllText($Agent)

if ($text.Contains('[PHASE2.6 WARMUP]')) {
  throw 'Phase 2.6 warmup is already applied.'
}

$loginStart =
  $text.IndexOf(
    'async function loginOis()'
  )

if ($loginStart -lt 0) {
  throw 'loginOis function was not found.'
}

# Find the final main-loop "while (" after loginOis().
# Helper functions are defined earlier; the request polling loop is the last while
# before the loginOis function finishes.
$searchEnd =
  $text.IndexOf(
    'const oisAgentStartPromise',
    $loginStart
  )

if ($searchEnd -lt 0) {
  $searchEnd = $text.Length
}

$loginBlock =
  $text.Substring(
    $loginStart,
    $searchEnd - $loginStart
  )

$whileRelative =
  $loginBlock.LastIndexOf(
    '    while ('
  )

if ($whileRelative -lt 0) {
  throw 'Main OIS polling while loop was not found.'
}

$whileIndex =
  $loginStart +
  $whileRelative

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Agent.before-phase26-warmup-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $backup -Force
Write-Host "Backup: $backup"

$nl =
  if ($text.Contains("`r`n")) {
    "`r`n"
  } else {
    "`n"
  }

$warmupLines = @(
  '    /*',
  '      [PHASE2.6 WARMUP]',
  '      Prepare the existing single OIS browser session once at agent startup.',
  '      No periodic refresh or repeated warmup is added.',
  '      If startup warmup fails, normal on-demand recovery remains unchanged.',
  '    */',
  '    const phase26WarmupStartedAt =',
  '      Date.now();',
  '',
  '',
  '    console.log(',
  '      "[PHASE2.6 WARMUP] OIS browser startup warmup started"',
  '    );',
  '',
  '',
  '    try {',
  '      await ensureBrowserSession(',
  '        "Phase 2.6 startup warmup"',
  '      );',
  '',
  '',
  '      console.log(',
  '        "[PHASE2.6 WARMUP] OIS browser startup warmup complete " +',
  '        (',
  '          (',
  '            Date.now() -',
  '            phase26WarmupStartedAt',
  '          ) /',
  '          1000',
  '        ).toFixed(',
  '          2',
  '        ) +',
  '        "s"',
  '      );',
  '',
  '    } catch (',
  '      warmupError',
  '    ) {',
  '      console.warn(',
  '        "[PHASE2.6 WARMUP] startup warmup failed; on-demand recovery remains enabled:",',
  '        warmupError instanceof',
  '          Error',
  '          ? warmupError.message',
  '          : warmupError',
  '      );',
  '    }',
  '',
  ''
)

$warmup =
  ($warmupLines -join $nl)

$text =
  $text.Insert(
    $whileIndex,
    $warmup
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
Write-Host '===== Warmup marker check ====='

Select-String `
  -LiteralPath $Agent `
  -SimpleMatch `
  -Pattern '[PHASE2.6 WARMUP]' |
Select-Object LineNumber,Line |
Format-Table -AutoSize

Write-Host ''
Write-Host '===== Phase 2.5 paths still present ====='

$lime =
  [IO.File]::ReadAllText($Agent).Contains(
    '[PHASE2.5 DIRECT V5] Limestone API complete'
  )

$gear =
  [IO.File]::ReadAllText($Agent).Contains(
    '[PHASE2.5 DIRECT V5] Gear/Pinion API complete'
  )

Write-Host "Limestone direct path present: $lime"
Write-Host "Gear/Pinion direct path present: $gear"

if (-not $lime -or -not $gear) {
  Copy-Item -LiteralPath $backup -Destination $Agent -Force
  throw 'Phase 2.5 direct paths are missing; restored backup.'
}

Write-Host ''
Write-Host '===== Patch complete ====='
Write-Host 'Warmup runs once per Agent start.'
Write-Host 'No periodic OIS refresh was added.'
Write-Host 'Agent has NOT been restarted.'
Write-Host 'Nothing has been staged or committed.'
