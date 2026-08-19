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

function Assert-Contains {
  param(
    [string]$Text,
    [string]$Needle,
    [string]$Label
  )

  if (-not $Text.Contains($Needle)) {
    throw "Required code not found: $Label"
  }
}

Write-Host '===== Phase 2.8A v2 detached Excel lane ====='

Write-Host ''
Write-Host '===== Pre-patch syntax check ====='

& $Node --check $Agent

if ($LASTEXITCODE -ne 0) {
  throw 'Agent already has a syntax error before patch.'
}

$Text = [IO.File]::ReadAllText($Agent)

if ($Text.Contains('[PHASE2.8A DETACHED EXCEL LANE]')) {
  throw 'Phase 2.8A is already applied.'
}

foreach (
  $RequiredMarker in @(
    '[PHASE2.5 DIRECT V5] Limestone API complete',
    '[PHASE2.5 DIRECT V5] Gear/Pinion API complete',
    '[PHASE2.6 WARMUP]',
    '[PHASE2.7A WATER-EXCEL GATE]',
    '[PHASE2.7B ORGANIC OPTIONAL V2]'
  )
) {
  if (-not $Text.Contains($RequiredMarker)) {
    throw "Required previous phase marker is missing: $RequiredMarker"
  }
}

$Stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup = "$Agent.before-phase28a-v2-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $Backup `
  -Force

Write-Host "Backup: $Backup"

$Nl = Get-NewLine $Text

try {
  # ---------------------------------------------------------
  # 1. OIS-only claim helper used while Excel is running.
  # Water is intentionally excluded.
  # ---------------------------------------------------------

  $RequestTypeFunction =
    $Text.IndexOf(
      'function getOisAgentRequestType('
    )

  if ($RequestTypeFunction -lt 0) {
    throw 'getOisAgentRequestType function was not found.'
  }

  $OisOnlyHelper =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
/* =========================================================
  [PHASE2.8A DETACHED EXCEL LANE]

  Excel may continue in background while safe OIS work proceeds.

  Water is intentionally excluded while Excel is active because
  Water + Excel contention was measured as slow in Phase 2.7.

  OIS still uses exactly one existing browser/page.
========================================================= */
async function getNextPhase28OisOnlyRequest(
  config
) {
  const requestTypes = [
    "limestone_stock",
    "turbine_gear_pinion",
    "silo_level",
    "auxiliary_materials",
    "logsheet_approval"
  ];


  const startIndex =
    Number(
      getNextPhase28OisOnlyRequest
        .nextTypeIndex ||
      0
    ) %
    requestTypes.length;


  const orderedRequestTypes =
    requestTypes.map(
      (
        requestType,
        offset
      ) => {
        return requestTypes[
          (
            startIndex +
            offset
          ) %
          requestTypes.length
        ];
      }
    );


  const result =
    await requestOisAgentApi(
      config,

      getOisAgentApiUrl(
        config,
        {
          action:
            "next",

          requestTypes:
            orderedRequestTypes.join(
              ","
            ),

          _:
            Date.now()
        }
      )
    );


  if (
    result.item
  ) {
    const claimedRequestType =
      normalizeOisAgentText(
        result.item.requestType ||
        result.item.request_type
      );


    const claimedIndex =
      requestTypes.indexOf(
        claimedRequestType
      );


    getNextPhase28OisOnlyRequest
      .nextTypeIndex =
      claimedIndex >=
        0
        ? (
            claimedIndex +
            1
          ) %
          requestTypes.length
        : (
            startIndex +
            1
          ) %
          requestTypes.length;


    return result.item;
  }


  getNextPhase28OisOnlyRequest
    .nextTypeIndex =
    (
      startIndex +
      1
    ) %
    requestTypes.length;


  return null;
}


'@

  $Text =
    $Text.Insert(
      $RequestTypeFunction,
      $OisOnlyHelper
    )

  # ---------------------------------------------------------
  # 2. Main polling loop state.
  # ---------------------------------------------------------

  $WarmupMarker =
    $Text.IndexOf(
      '[PHASE2.6 WARMUP]'
    )

  if ($WarmupMarker -lt 0) {
    throw 'Phase 2.6 warmup marker was not found.'
  }

  $MainWhileNeedle =
    '    while (' +
    $Nl +
    '      !isShuttingDown'

  $MainWhile =
    $Text.IndexOf(
      $MainWhileNeedle,
      $WarmupMarker
    )

  if ($MainWhile -lt 0) {
    throw 'Main Agent polling loop was not found.'
  }

  $StateCode =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
    /*
      [PHASE2.8A DETACHED EXCEL LANE]
      At most one Excel-lane request may run in background.
    */
    let phase28ExcelTask =
      null;


'@

  $Text =
    $Text.Insert(
      $MainWhile,
      $StateCode
    )

  $MainWhile =
    $Text.IndexOf(
      $MainWhileNeedle,
      $WarmupMarker
    )

  if ($MainWhile -lt 0) {
    throw 'Main Agent polling loop could not be re-located.'
  }

  # ---------------------------------------------------------
  # 3. Claim logic.
  # ---------------------------------------------------------

  $OldClaim =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
        requestItems =
          await getNextOisAgentLaneRequests(
            config
          );
'@

  $ClaimStart =
    $Text.IndexOf(
      $OldClaim,
      $MainWhile
    )

  if ($ClaimStart -lt 0) {
    throw 'Main-loop lane claim block was not found.'
  }

  $NewClaim =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
        if (
          phase28ExcelTask
        ) {
          const phase28OisOnlyItem =
            await getNextPhase28OisOnlyRequest(
              config
            );


          requestItems =
            phase28OisOnlyItem
              ? [
                  phase28OisOnlyItem
                ]
              : [];

        } else {
          requestItems =
            await getNextOisAgentLaneRequests(
              config
            );
        }
'@

  $Text =
    Replace-Range `
      -Text $Text `
      -Start $ClaimStart `
      -End (
        $ClaimStart +
        $OldClaim.Length
      ) `
      -Replacement $NewClaim

  # ---------------------------------------------------------
  # 4. Empty poll wait.
  # Keep normal poll interval, but wake early if detached Excel
  # finishes.
  # ---------------------------------------------------------

  $EmptyBranchStart =
    $Text.IndexOf(
      '        requestItems.length ===',
      $MainWhile
    )

  if ($EmptyBranchStart -lt 0) {
    throw 'Empty request branch was not found.'
  }

  $OldEmptyWait =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
        await waitOisAgent(
          OIS_AGENT_POLL_INTERVAL
        );
'@

  $EmptyWaitStart =
    $Text.IndexOf(
      $OldEmptyWait,
      $EmptyBranchStart
    )

  if ($EmptyWaitStart -lt 0) {
    throw 'Empty request wait block was not found.'
  }

  $NewEmptyWait =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
        if (
          phase28ExcelTask
        ) {
          await Promise.race([
            waitOisAgent(
              OIS_AGENT_POLL_INTERVAL
            ),
            phase28ExcelTask
          ]);

        } else {
          await waitOisAgent(
            OIS_AGENT_POLL_INTERVAL
          );
        }
'@

  $Text =
    Replace-Range `
      -Text $Text `
      -Start $EmptyWaitStart `
      -End (
        $EmptyWaitStart +
        $OldEmptyWait.Length
      ) `
      -Replacement $NewEmptyWait

  # ---------------------------------------------------------
  # 5. Convert current batch from "wait all" to:
  #    - await OIS foreground promise(s)
  #    - keep Excel promise detached in phase28ExcelTask
  # ---------------------------------------------------------

  $ProcessingStart =
    $Text.IndexOf(
      '      const processingResults =',
      $MainWhile
    )

  if ($ProcessingStart -lt 0) {
    throw 'processingResults block was not found.'
  }

  $ProcessingPost =
    $Text.IndexOf(
      '      processingResults',
      $ProcessingStart + 50
    )

  if ($ProcessingPost -lt 0) {
    throw 'processingResults post-processing block was not found.'
  }

  $ProcessingBlock =
    $Text.Substring(
      $ProcessingStart,
      $ProcessingPost - $ProcessingStart
    )

  $OldProcessingPrefix =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
      const processingResults =
        await Promise.allSettled(
          requestItems.map(
'@

  Assert-Contains `
    -Text $ProcessingBlock `
    -Needle $OldProcessingPrefix `
    -Label 'Promise.allSettled prefix'

  $NewProcessingPrefix =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
      const phase28ProcessingPromises =
        requestItems.map(
'@

  $ProcessingBlock =
    $ProcessingBlock.Replace(
      $OldProcessingPrefix,
      $NewProcessingPrefix
    )

  $OldProcessingSuffix =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
            }
          )
        );
'@

  $SuffixIndex =
    $ProcessingBlock.LastIndexOf(
      $OldProcessingSuffix
    )

  if ($SuffixIndex -lt 0) {
    throw 'Promise.allSettled suffix was not found.'
  }

  $DetachCode =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
            }
          );


      const phase28ForegroundPromises =
        [];


      phase28ProcessingPromises.forEach(
        (
          processingPromise,
          index
        ) => {
          const phase28RequestType =
            getOisAgentRequestType(
              requestItems[
                index
              ]
            );


          const phase28IsExcelLane =
            (
              isDailyDataExcelRequestType(
                phase28RequestType
              ) ||
              phase28RequestType ===
                "logsheet_pdf"
            );


          if (
            !phase28IsExcelLane
          ) {
            phase28ForegroundPromises.push(
              processingPromise
            );

            return;
          }


          let trackedExcelTask =
            null;


          trackedExcelTask =
            processingPromise
              .catch(
                error => {
                  console.error(
                    "[PHASE2.8A] detached Excel task error:",
                    error
                  );

                  return null;
                }
              )
              .finally(
                () => {
                  if (
                    phase28ExcelTask ===
                      trackedExcelTask
                  ) {
                    phase28ExcelTask =
                      null;
                  }
                }
              );


          phase28ExcelTask =
            trackedExcelTask;


          console.log(
            `[PHASE2.8A] Excel lane detached - ${phase28RequestType}`
          );
        }
      );


      const processingResults =
        await Promise.allSettled(
          phase28ForegroundPromises
        );
'@

  $ProcessingBlock =
    Replace-Range `
      -Text $ProcessingBlock `
      -Start $SuffixIndex `
      -End (
        $SuffixIndex +
        $OldProcessingSuffix.Length
      ) `
      -Replacement $DetachCode

  $Text =
    Replace-Range `
      -Text $Text `
      -Start $ProcessingStart `
      -End $ProcessingPost `
      -Replacement $ProcessingBlock

  # ---------------------------------------------------------
  # Save and verify.
  # ---------------------------------------------------------

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

  $Final = [IO.File]::ReadAllText($Agent)

  $CheckMarker =
    $Final.Contains(
      '[PHASE2.8A DETACHED EXCEL LANE]'
    )

  $CheckHelper =
    $Final.Contains(
      'async function getNextPhase28OisOnlyRequest('
    )

  $CheckDetachedLog =
    $Final.Contains(
      '[PHASE2.8A] Excel lane detached'
    )

  $CheckLimestone =
    $Final.Contains(
      '[PHASE2.5 DIRECT V5] Limestone API complete'
    )

  $CheckGear =
    $Final.Contains(
      '[PHASE2.5 DIRECT V5] Gear/Pinion API complete'
    )

  $CheckWarmup =
    $Final.Contains(
      '[PHASE2.6 WARMUP]'
    )

  $CheckWaterGate =
    $Final.Contains(
      '[PHASE2.7A WATER-EXCEL GATE]'
    )

  $CheckOrganic =
    $Final.Contains(
      '[PHASE2.7B ORGANIC OPTIONAL V2]'
    )

  Write-Host ''
  Write-Host '===== Verification ====='

  Write-Host (
    'Phase 2.8A marker: ' +
    $CheckMarker
  )

  Write-Host (
    'OIS-only helper present: ' +
    $CheckHelper
  )

  Write-Host (
    'Detached Excel log present: ' +
    $CheckDetachedLog
  )

  Write-Host (
    'Limestone direct kept: ' +
    $CheckLimestone
  )

  Write-Host (
    'Gear direct kept: ' +
    $CheckGear
  )

  Write-Host (
    'Warmup kept: ' +
    $CheckWarmup
  )

  Write-Host (
    'Water-Excel gate kept: ' +
    $CheckWaterGate
  )

  Write-Host (
    'Organic optional kept: ' +
    $CheckOrganic
  )

  if (
    -not (
      $CheckMarker -and
      $CheckHelper -and
      $CheckDetachedLog -and
      $CheckLimestone -and
      $CheckGear -and
      $CheckWarmup -and
      $CheckWaterGate -and
      $CheckOrganic
    )
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
  Write-Host '===== Phase 2.8A v2 patch complete ====='
  Write-Host 'Excel can continue in background while safe OIS work proceeds.'
  Write-Host 'Water is not claimed while detached Excel is active.'
  Write-Host 'No additional Edge browser or OIS Page was added.'
  Write-Host 'Normal poll interval was preserved.'
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
