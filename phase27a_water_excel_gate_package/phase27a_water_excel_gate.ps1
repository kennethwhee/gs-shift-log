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

Write-Host '===== Phase 2.7A Water before Excel gate ====='

$text = [IO.File]::ReadAllText($Agent)

if ($text.Contains('[PHASE2.7A WATER-EXCEL GATE]')) {
  throw 'Phase 2.7A gate is already applied.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$Agent.before-phase27a-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $backup -Force
Write-Host "Backup: $backup"

$nl =
  if ($text.Contains("`r`n")) {
    "`r`n"
  } else {
    "`n"
  }

try {
  $processingStart =
    $text.IndexOf(
      '      const processingResults ='
    )

  if ($processingStart -lt 0) {
    throw 'processingResults start was not found.'
  }

  $afterProcessing =
    $text.IndexOf(
      '      processingResults',
      $processingStart + 50
    )

  if ($afterProcessing -lt 0) {
    throw 'processingResults post-processing boundary was not found.'
  }

  $gateLines = @(
    '      /*',
    '        [PHASE2.7A WATER-EXCEL GATE]',
    '        If the same poll claims Water + Daily DATA together,',
    '        let Water finish first so OIS/Edge work does not contend',
    '        with the Excel PowerShell/COM process.',
    '      */',
    '      const phase27aHasWaterRequest =',
    '        requestItems.some(',
    '          requestItem => {',
    '            return getOisAgentRequestType(',
    '              requestItem',
    '            ) ===',
    '              "water_environment";',
    '          }',
    '        );',
    '',
    '',
    '      let phase27aWaterFinished =',
    '        !phase27aHasWaterRequest;',
    '',
    ''
  )

  $gateText = $gateLines -join $nl

  $text =
    $text.Insert(
      $processingStart,
      $gateText
    )

  # Recompute positions after the first insertion.
  $processingStart =
    $text.IndexOf(
      '      const processingResults ='
    )

  $afterProcessing =
    $text.IndexOf(
      '      processingResults',
      $processingStart + 50
    )

  $block =
    $text.Substring(
      $processingStart,
      $afterProcessing - $processingStart
    )

  $requestTypeNeedle =
    '      const requestType ='

  $requestTypeIndex =
    $block.IndexOf(
      $requestTypeNeedle
    )

  if ($requestTypeIndex -lt 0) {
    throw 'requestType declaration was not found inside processing block.'
  }

  $requestTypeEnd =
    $block.IndexOf(
      '       );',
      $requestTypeIndex
    )

  if ($requestTypeEnd -lt 0) {
    # Alternate indentation in current file.
    $requestTypeEnd =
      $block.IndexOf(
        '      );',
        $requestTypeIndex
      )
  }

  if ($requestTypeEnd -lt 0) {
    throw 'requestType declaration end was not found.'
  }

  $requestTypeEnd +=
    if ($block.Substring($requestTypeEnd).StartsWith('       );')) {
      '       );'.Length
    } else {
      '      );'.Length
    }

  $waitLines = @(
    '',
    '',
    '      if (',
    '        phase27aHasWaterRequest &&',
    '        !phase27aWaterFinished &&',
    '        isDailyDataExcelRequestType(',
    '          requestType',
    '        )',
    '      ) {',
    '        console.log(',
    '          "[PHASE2.7A] Daily DATA waits for Water request to finish."',
    '        );',
    '',
    '',
    '        const phase27aWaitDeadline =',
    '          Date.now() +',
    '          120000;',
    '',
    '',
    '        while (',
    '          !phase27aWaterFinished &&',
    '          Date.now() <',
    '            phase27aWaitDeadline',
    '        ) {',
    '          await waitOisAgent(',
    '            100',
    '          );',
    '        }',
    '',
    '',
    '        if (',
    '          !phase27aWaterFinished',
    '        ) {',
    '          console.warn(',
    '            "[PHASE2.7A] Water wait exceeded 120s; Daily DATA continues."',
    '          );',
    '        }',
    '      }'
  )

  $waitText =
    $waitLines -join $nl

  $block =
    $block.Insert(
      $requestTypeEnd,
      $waitText
    )

  # Insert Water-finished signal immediately before the async map callback closes.
  $callbackCloseNeedle =
    '            }' +
    $nl +
    '          )' +
    $nl +
    '        );'

  $callbackCloseIndex =
    $block.LastIndexOf(
      $callbackCloseNeedle
    )

  if ($callbackCloseIndex -lt 0) {
    throw 'async request callback close boundary was not found.'
  }

  $finishLines = @(
    '',
    '      if (',
    '        requestType ===',
    '          "water_environment"',
    '      ) {',
    '        phase27aWaterFinished =',
    '          true;',
    '',
    '',
    '        console.log(',
    '          "[PHASE2.7A] Water request finished; Daily DATA may start."',
    '        );',
    '      }',
    ''
  )

  $finishText =
    $finishLines -join $nl

  $block =
    $block.Insert(
      $callbackCloseIndex,
      $finishText
    )

  $text =
    $text.Substring(
      0,
      $processingStart
    ) +
    $block +
    $text.Substring(
      $afterProcessing
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
    throw 'Node syntax check failed.'
  }

  Write-Host ''
  Write-Host '===== git diff --check ====='

  git diff --check -- local-tools/ois-agent/ois-login.js

  if ($LASTEXITCODE -ne 0) {
    throw 'git diff --check failed.'
  }

  Write-Host ''
  Write-Host '===== Marker check ====='

  Select-String `
    -LiteralPath $Agent `
    -SimpleMatch `
    -Pattern `
      '[PHASE2.7A WATER-EXCEL GATE]',
      '[PHASE2.7A] Daily DATA waits for Water request to finish.',
      '[PHASE2.7A] Water request finished; Daily DATA may start.' |
  Select-Object LineNumber,Line |
  Format-Table -AutoSize

  Write-Host ''
  Write-Host '===== Existing Phase 2.5 / 2.6 markers ====='

  $current = [IO.File]::ReadAllText($Agent)

  Write-Host (
    'Limestone direct path present: ' +
    $current.Contains('[PHASE2.5 DIRECT V5] Limestone API complete')
  )

  Write-Host (
    'Gear direct path present: ' +
    $current.Contains('[PHASE2.5 DIRECT V5] Gear/Pinion API complete')
  )

  Write-Host (
    'Warmup path present: ' +
    $current.Contains('[PHASE2.6 WARMUP]')
  )

  Write-Host ''
  Write-Host '===== Phase 2.7A patch complete ====='
  Write-Host 'Agent has NOT been restarted.'
  Write-Host 'Nothing has been staged or committed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring backup ====='

  Copy-Item `
    -LiteralPath $backup `
    -Destination $Agent `
    -Force

  Write-Host 'Restore complete.'
  throw
}
