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

Write-Host '===== Phase 3.4A Silo AJAX trace + timing ====='

& $Node --check $Agent
if ($LASTEXITCODE -ne 0) {
  throw 'Agent syntax is already invalid before patch.'
}

$Text =
  [IO.File]::ReadAllText($Agent)

if ($Text.Contains('[PHASE3.4A SILO AJAX TRACE]')) {
  throw 'Phase 3.4A is already applied.'
}

foreach (
  $Required in @(
    '[PHASE3.3B NONBLOCKING STARTUP]',
    '[PHASE3.3A EXCEL BULK READ]',
    '[PHASE3.2 WATER DIRECT]'
  )
) {
  if (-not $Text.Contains($Required)) {
    throw "Required marker missing: $Required"
  }
}

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$Backup =
  "$Agent.before-phase34a-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $Backup `
  -Force

Write-Host "Backup: $Backup"

try {
  # ---------------------------------------------------------
  # 1. Keep raw request body in captureOisTagLog24HourValueFromApi
  # ---------------------------------------------------------
  $OldRequestBody = @'
            const requestBody =
              String(
                request.postData() ||
                ""
              ).toUpperCase();
'@

  $NewRequestBody = @'
            const rawRequestBody =
              String(
                request.postData() ||
                ""
              );

            const requestBody =
              rawRequestBody.toUpperCase();
'@

  if (-not $Text.Contains($OldRequestBody)) {
    throw 'Silo requestBody block was not found.'
  }

  $Text =
    $Text.Replace(
      $OldRequestBody,
      $NewRequestBody
    )

  # ---------------------------------------------------------
  # 2. Log exact command/tossdata only for the current Silo tag
  # ---------------------------------------------------------
  $RowsAnchor = @'
            const rows =
              Array.isArray(
                responseData.result
              )
                ? responseData.result
                : [];
'@

  $TraceBlock = @'
            const rows =
              Array.isArray(
                responseData.result
              )
                ? responseData.result
                : [];

            if (
              requestBody.includes(
                normalizedTargetTag
              ) ||
              responseText
                .toUpperCase()
                .includes(
                  normalizedTargetTag
                )
            ) {
              let traceCommand =
                "";

              let traceTossdata =
                "";

              try {
                const traceParameters =
                  new URLSearchParams(
                    rawRequestBody
                  );

                traceCommand =
                  traceParameters.get(
                    "cmd"
                  ) ||
                  traceParameters.get(
                    "CMD"
                  ) ||
                  "";

                traceTossdata =
                  traceParameters.get(
                    "tossdata"
                  ) ||
                  traceParameters.get(
                    "TOSSDATA"
                  ) ||
                  "";
              } catch {
              }

              console.log(
                "[PHASE3.4A SILO AJAX TRACE] " +
                JSON.stringify({
                  targetDate,
                  targetTag,
                  command:
                    traceCommand,
                  tossdata:
                    traceTossdata,
                  status:
                    response.status(),
                  resultCount:
                    rows.length
                })
              );
            }
'@

  if (-not $Text.Contains($RowsAnchor)) {
    throw 'Silo rows block was not found.'
  }

  $Text =
    $Text.Replace(
      $RowsAnchor,
      $TraceBlock
    )

  # ---------------------------------------------------------
  # 3. Add detailed Silo timing markers
  # ---------------------------------------------------------
  $CapturedAnchor = @'
  const capturedValues = {};

  for (
'@

  $CapturedReplacement = @'
  const capturedValues = {};

  const phase34SiloStartedAt =
    Date.now();

  console.log(
    "[PHASE3.4A SILO TIMING] start " +
    targetDate
  );

  for (
'@

  if (-not $Text.Contains($CapturedAnchor)) {
    throw 'Silo capturedValues anchor was not found.'
  }

  $Text =
    $Text.Replace(
      $CapturedAnchor,
      $CapturedReplacement
    )

  $LoopOpenAnchor = @'
  ) {
    let frame =
      await openOisTagLogLookup(
        page
      );

    await setOisTagLogSearchConditions(
'@

  $LoopOpenReplacement = @'
  ) {
    const phase34TagStartedAt =
      Date.now();

    console.log(
      "[PHASE3.4A SILO TIMING] tag start " +
      definition.tag
    );

    let frame =
      await openOisTagLogLookup(
        page
      );

    console.log(
      "[PHASE3.4A SILO TIMING] lookup ready " +
      definition.tag +
      " " +
      (
        (
          Date.now() -
          phase34TagStartedAt
        ) /
        1000
      ).toFixed(
        2
      ) +
      "s"
    );

    await setOisTagLogSearchConditions(
'@

  if (-not $Text.Contains($LoopOpenAnchor)) {
    throw 'Silo loop/open anchor was not found.'
  }

  $Text =
    $Text.Replace(
      $LoopOpenAnchor,
      $LoopOpenReplacement
    )

  $ConditionEndAnchor = @'
      targetDate
    );

    await page.waitForTimeout(
'@

  $ConditionEndReplacement = @'
      targetDate
    );

    console.log(
      "[PHASE3.4A SILO TIMING] conditions ready " +
      definition.tag +
      " " +
      (
        (
          Date.now() -
          phase34TagStartedAt
        ) /
        1000
      ).toFixed(
        2
      ) +
      "s"
    );

    await page.waitForTimeout(
'@

  # Restrict replacement to first occurrence after collectOisSiloLevelValues
  $FunctionStart =
    $Text.IndexOf(
      'async function collectOisSiloLevelValues('
    )

  if ($FunctionStart -lt 0) {
    throw 'collectOisSiloLevelValues function was not found.'
  }

  $ConditionPos =
    $Text.IndexOf(
      $ConditionEndAnchor,
      $FunctionStart
    )

  if ($ConditionPos -lt 0) {
    throw 'Silo set-condition completion anchor was not found.'
  }

  $Text =
    $Text.Substring(0, $ConditionPos) +
    $ConditionEndReplacement +
    $Text.Substring(
      $ConditionPos +
      $ConditionEndAnchor.Length
    )

  $CapturedValueAnchor = @'
      );

    capturedValues[
      definition.resultKey
    ] = {
'@

  $CapturedValueReplacement = @'
      );

    console.log(
      "[PHASE3.4A SILO TIMING] tag complete " +
      definition.tag +
      " " +
      (
        (
          Date.now() -
          phase34TagStartedAt
        ) /
        1000
      ).toFixed(
        2
      ) +
      "s"
    );

    capturedValues[
      definition.resultKey
    ] = {
'@

  $CapturedValuePos =
    $Text.IndexOf(
      $CapturedValueAnchor,
      $FunctionStart
    )

  if ($CapturedValuePos -lt 0) {
    throw 'Silo captured-value completion anchor was not found.'
  }

  $Text =
    $Text.Substring(0, $CapturedValuePos) +
    $CapturedValueReplacement +
    $Text.Substring(
      $CapturedValuePos +
      $CapturedValueAnchor.Length
    )

  $ResultAnchor = @'
  const result = {
    source:
      "OIS TAG별 LOG 조회",
'@

  $ResultReplacement = @'
  console.log(
    "[PHASE3.4A SILO TIMING] all tags complete " +
    (
      (
        Date.now() -
        phase34SiloStartedAt
      ) /
      1000
    ).toFixed(
      2
    ) +
    "s"
  );

  const result = {
    source:
      "OIS TAG별 LOG 조회",
'@

  if (-not $Text.Contains($ResultAnchor)) {
    throw 'Silo result anchor was not found.'
  }

  $Text =
    $Text.Replace(
      $ResultAnchor,
      $ResultReplacement
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
    throw 'Node syntax check failed after patch.'
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

  Write-Host ''
  Write-Host '===== Verification ====='

  Write-Host (
    'Phase 3.4A trace: ' +
    $Final.Contains(
      '[PHASE3.4A SILO AJAX TRACE]'
    )
  )

  Write-Host (
    'Phase 3.4A timing: ' +
    $Final.Contains(
      '[PHASE3.4A SILO TIMING]'
    )
  )

  Write-Host (
    'Phase 3.3B kept: ' +
    $Final.Contains(
      '[PHASE3.3B NONBLOCKING STARTUP]'
    )
  )

  Write-Host (
    'Phase 3.3A kept: ' +
    $Final.Contains(
      '[PHASE3.3A EXCEL BULK READ]'
    )
  )

  Write-Host (
    'Phase 3.2 kept: ' +
    $Final.Contains(
      '[PHASE3.2 WATER DIRECT]'
    )
  )

  Write-Host ''
  Write-Host '===== Diff summary ====='

  git diff --stat -- `
    local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Phase 3.4A patch complete ====='
  Write-Host 'Diagnostic only: Silo behavior is unchanged.'
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
