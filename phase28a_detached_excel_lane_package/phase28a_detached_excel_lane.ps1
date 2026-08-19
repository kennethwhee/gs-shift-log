param(
  [string]$Repo = 'C:\Users\GSENR\Desktop\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

$Agent = Join-Path $Repo 'local-tools\ois-agent\ois-login.js'
$Node  = 'C:\Program Files\nodejs\node.exe'

if (-not (Test-Path -LiteralPath $Agent)) { throw "Agent file not found: $Agent" }
if (-not (Test-Path -LiteralPath $Node))  { throw "Node.exe not found: $Node" }

function Get-NewLine([string]$Text) {
  if ($Text.Contains("`r`n")) { return "`r`n" }
  return "`n"
}

function Convert-NewLine([string]$Text,[string]$NewLine) {
  return $Text.Replace("`r`n","`n").Replace("`r","`n").Replace("`n",$NewLine)
}

function Replace-Range([string]$Text,[int]$Start,[int]$End,[string]$Replacement) {
  if ($Start -lt 0 -or $End -lt $Start -or $End -gt $Text.Length) {
    throw "Invalid replacement range: $Start .. $End"
  }
  return $Text.Substring(0,$Start) + $Replacement + $Text.Substring($End)
}

Write-Host '===== Phase 2.8A detached Excel lane ====='

Write-Host ''
Write-Host '===== Pre-patch syntax check ====='

& $Node --check $Agent
if ($LASTEXITCODE -ne 0) { throw 'Agent already has a syntax error before patch.' }

$Text = [IO.File]::ReadAllText($Agent)

if ($Text.Contains('[PHASE2.8A DETACHED EXCEL LANE]')) {
  throw 'Phase 2.8A is already applied.'
}

foreach ($RequiredMarker in @(
  '[PHASE2.5 DIRECT V5] Limestone API complete',
  '[PHASE2.5 DIRECT V5] Gear/Pinion API complete',
  '[PHASE2.6 WARMUP]',
  '[PHASE2.7A WATER-EXCEL GATE]',
  '[PHASE2.7B ORGANIC OPTIONAL V2]'
)) {
  if (-not $Text.Contains($RequiredMarker)) {
    throw "Required previous phase marker is missing: $RequiredMarker"
  }
}

$Stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup = "$Agent.before-phase28a-$Stamp.bak"
Copy-Item -LiteralPath $Agent -Destination $Backup -Force
Write-Host "Backup: $Backup"

$Nl = Get-NewLine $Text

try {
  # 1) Add OIS-only claim helper. Water is intentionally excluded while Excel is running.
  $RequestTypeFunction = $Text.IndexOf('function getOisAgentRequestType(')
  if ($RequestTypeFunction -lt 0) { throw 'getOisAgentRequestType function was not found.' }

  $OisOnlyHelper = Convert-NewLine @'
/* =========================================================
  [PHASE2.8A DETACHED EXCEL LANE]

  While Excel is already running, claim only OIS work that is
  allowed to overlap with Excel.

  Water is deliberately excluded because Water + Excel
  contention was proven slow in Phase 2.7A.

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


'@ $Nl

  $Text = $Text.Insert($RequestTypeFunction,$OisOnlyHelper)

  # 2) Add one background Excel task state before the main poll loop.
  $WarmupMarker = $Text.IndexOf('[PHASE2.6 WARMUP]')
  if ($WarmupMarker -lt 0) { throw 'Phase 2.6 warmup marker was not found.' }

  $MainWhileNeedle = '    while (' + $Nl + '      !isShuttingDown'
  $MainWhile = $Text.IndexOf($MainWhileNeedle,$WarmupMarker)
  if ($MainWhile -lt 0) { throw 'Main Agent polling loop was not found.' }

  $StateCode = Convert-NewLine @'
    /*
      [PHASE2.8A DETACHED EXCEL LANE]
      At most one Excel-lane request may run in background.
    */
    let phase28ExcelTask =
      null;


'@ $Nl

  $Text = $Text.Insert($MainWhile,$StateCode)

  $MainWhile = $Text.IndexOf($MainWhileNeedle,$WarmupMarker)

  # 3) When Excel is busy, claim only safe OIS work.
  $OldClaim = Convert-NewLine @'
        requestItems =
          await getNextOisAgentLaneRequests(
            config
          );
'@ $Nl

  $ClaimStart = $Text.IndexOf($OldClaim,$MainWhile)
  if ($ClaimStart -lt 0) { throw 'Main-loop lane claim block was not found.' }

  $NewClaim = Convert-NewLine @'
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
'@ $Nl

  $Text = Replace-Range $Text $ClaimStart ($ClaimStart + $OldClaim.Length) $NewClaim

  # 4) No extra polling: when no OIS work exists, wake on Excel completion or normal interval.
  $EmptyBranchStart = $Text.IndexOf('        requestItems.length ===',$MainWhile)
  if ($EmptyBranchStart -lt 0) { throw 'Empty request branch was not found.' }

  $OldEmptyWait = Convert-NewLine @'
        await waitOisAgent(
          OIS_AGENT_POLL_INTERVAL
        );
'@ $Nl

  $EmptyWaitStart = $Text.IndexOf($OldEmptyWait,$EmptyBranchStart)
  if ($EmptyWaitStart -lt 0) { throw 'Empty request wait block was not found.' }

  $NewEmptyWait = Convert-NewLine @'
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
'@ $Nl

  $Text = Replace-Range $Text $EmptyWaitStart ($EmptyWaitStart + $OldEmptyWait.Length) $NewEmptyWait

  # 5) Preserve the request callback, but detach Excel promise from foreground wait.
  $ProcessingStart = $Text.IndexOf('      const processingResults =',$MainWhile)
  if ($ProcessingStart -lt 0) { throw 'processingResults block was not found.' }

  $ProcessingPost = $Text.IndexOf('      processingResults',$ProcessingStart + 50)
  if ($ProcessingPost -lt 0) { throw 'processingResults post-processing block was not found.' }

  $ProcessingBlock = $Text.Substring($ProcessingStart,$ProcessingPost-$ProcessingStart)

  $OldProcessingPrefix = Convert-NewLine @'
      const processingResults =
        await Promise.allSettled(
          requestItems.map(
'@ $Nl

  if (-not $ProcessingBlock.Contains($OldProcessingPrefix)) {
    throw 'processingResults Promise.allSettled prefix was not found.'
  }

  $NewProcessingPrefix = Convert-NewLine @'
      const phase28ProcessingPromises =
        requestItems.map(
'@ $Nl

  $ProcessingBlock = $ProcessingBlock.Replace($OldProcessingPrefix,$NewProcessingPrefix)

  $OldProcessingSuffix = Convert-NewLine @'
            }
          )
        );
'@ $Nl

  $SuffixIndex = $ProcessingBlock.LastIndexOf($OldProcessingSuffix)
  if ($SuffixIndex -lt 0) { throw 'processingResults Promise.allSettled suffix was not found.' }

  $DetachCode = Convert-NewLine @'
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


          const trackedExcelTask =
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
'@ $Nl

  $ProcessingBlock = Replace-Range $ProcessingBlock $SuffixIndex ($SuffixIndex + $OldProcessingSuffix.Length) $DetachCode

  $Text = Replace-Range $Text $ProcessingStart $ProcessingPost $ProcessingBlock

  [IO.File]::WriteAllText(
    $Agent,
    $Text,
    (New-Object Text.UTF8Encoding($false))
  )

  Write-Host ''
  Write-Host '===== Node syntax check ====='
  & $Node --check $Agent
  if ($LASTEXITCODE -ne 0) { throw 'Agent Node syntax check failed.' }

  Write-Host ''
  Write-Host '===== git diff --check ====='
  git diff --check -- local-tools/ois-agent/ois-login.js
  if ($LASTEXITCODE -ne 0) { throw 'git diff --check failed.' }

  $Final = [IO.File]::ReadAllText($Agent)

  Write-Host ''
  Write-Host '===== Verification ====='
  Write-Host "Phase 2.8A marker: $($Final.Contains('[PHASE2.8A DETACHED EXCEL LANE]'))"
  Write-Host "OIS-only helper present: $($Final.Contains('async function getNextPhase28OisOnlyRequest('))"
  Write-Host "Detached Excel log present: $($Final.Contains('[PHASE2.8A] Excel lane detached'))"
  Write-Host "Limestone direct kept: $($Final.Contains('[PHASE2.5 DIRECT V5] Limestone API complete'))"
  Write-Host "Gear direct kept: $($Final.Contains('[PHASE2.5 DIRECT V5] Gear/Pinion API complete'))"
  Write-Host "Warmup kept: $($Final.Contains('[PHASE2.6 WARMUP]'))"
  Write-Host "Water-Excel gate kept: $($Final.Contains('[PHASE2.7A WATER-EXCEL GATE]'))"
  Write-Host "Organic optional kept: $($Final.Contains('[PHASE2.7B ORGANIC OPTIONAL V2]'))"

  Write-Host ''
  Write-Host '===== Changed file ====='
  git status --short -- local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Diff summary ====='
  git diff --stat -- local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Phase 2.8A patch complete ====='
  Write-Host 'Excel can continue in background while safe OIS work proceeds.'
  Write-Host 'Water is never claimed while an Excel task is already running.'
  Write-Host 'No additional Edge browser or OIS Page was added.'
  Write-Host 'Normal poll interval was preserved.'
  Write-Host 'Agent has NOT been restarted.'
  Write-Host 'Nothing has been staged or committed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring Agent ====='
  Copy-Item -LiteralPath $Backup -Destination $Agent -Force
  Write-Host 'Restore complete.'
  throw
}
