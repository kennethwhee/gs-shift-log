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

Write-Host '===== Phase 3.1 Water Direct API probe ====='

Write-Host ''
Write-Host '===== Locate pre-Phase3 trace backup ====='

$Stable =
  Get-ChildItem `
    (Join-Path $Repo 'local-tools\ois-agent') `
    -Filter 'ois-login.js.before-phase30-water-trace-*.bak' `
    -File `
    -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Stable) {
  throw 'Pre-Phase3 trace backup was not found.'
}

Write-Host "Stable: $($Stable.FullName)"

$StableText =
  [IO.File]::ReadAllText(
    $Stable.FullName
  )

foreach (
  $RequiredMarker in @(
    '[PHASE2.5 DIRECT V5] Limestone API complete',
    '[PHASE2.5 DIRECT V5] Gear/Pinion API complete',
    '[PHASE2.6 WARMUP]',
    '[PHASE2.7A WATER-EXCEL GATE]',
    '[PHASE2.7B ORGANIC OPTIONAL V2]',
    '[PHASE2.8B WATER-FIRST]'
  )
) {
  if (-not $StableText.Contains($RequiredMarker)) {
    throw "Stable backup is missing marker: $RequiredMarker"
  }
}

if ($StableText.Contains('[PHASE3.0 WATER AJAX TRACE]')) {
  throw 'Selected stable backup unexpectedly contains Phase 3.0 trace.'
}

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$CurrentBackup =
  "$Agent.before-phase31-water-probe-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $CurrentBackup `
  -Force

Write-Host "Current backup: $CurrentBackup"

Write-Host ''
Write-Host '===== Restore clean pre-trace Agent ====='

Copy-Item `
  -LiteralPath $Stable.FullName `
  -Destination $Agent `
  -Force

$Text =
  [IO.File]::ReadAllText($Agent)

$Nl =
  Get-NewLine $Text

try {
  $CollectFunctionNeedle =
    'async function collectOisWaterTreatmentValues('

  $CollectFunctionIndex =
    $Text.IndexOf(
      $CollectFunctionNeedle
    )

  if ($CollectFunctionIndex -lt 0) {
    throw 'collectOisWaterTreatmentValues function was not found.'
  }

  $Helper =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
/* =========================================================
  [PHASE3.1 WATER DIRECT PROBE]

  Diagnostic only.

  Probe the two Water commands discovered from the UI trace:
  - oi.DayMonitoringService.listEnvDayRunnigStatus
  - oi.DayMonitoringService.listReCalEnv

  Existing UI Water collection remains the source of truth.
========================================================= */
async function runPhase31WaterDirectProbe(
  page,
  targetDate
) {
  const compactDate =
    String(
      targetDate ||
      ""
    ).replace(
      /-/g,
      ""
    );


  const selectItem = {
    schepowstat:
      "8000",

    schdate:
      compactDate,

    rowstatus:
      "C",

    schprgid:
      "EOIS5020"
  };


  const commands = [
    "oi.DayMonitoringService.listEnvDayRunnigStatus",
    "oi.DayMonitoringService.listReCalEnv"
  ];


  const responses =
    {};


  for (
    const command of
    commands
  ) {
    const startedAt =
      Date.now();


    try {
      const responseData =
        await requestOisInternalAjaxData(
          page,
          command,
          selectItem
        );


      const rows =
        Array.isArray(
          responseData?.result
        )
          ? responseData.result
          : [];


      responses[
        command
      ] =
        responseData;


      console.log(
        "[PHASE3.1 WATER DIRECT PROBE] " +
        command +
        " complete " +
        (
          (
            Date.now() -
            startedAt
          ) /
          1000
        ).toFixed(
          2
        ) +
        "s " +
        JSON.stringify({
          targetDate,
          resultCount:
            rows.length,
          firstRow:
            rows[
              0
            ] ||
            null
        })
      );

    } catch (
      error
    ) {
      responses[
        command
      ] =
        null;


      console.warn(
        "[PHASE3.1 WATER DIRECT PROBE] " +
        command +
        " failed:",
        error instanceof
          Error
          ? error.message
          : error
      );
    }
  }


  return responses;
}


function logPhase31WaterValueMatches(
  targetDate,
  uiResult,
  probeResponses
) {
  const candidateSources =
    Object.entries(
      probeResponses ||
      {}
    ).flatMap(
      (
        [
          command,
          responseData
        ]
      ) => {
        const rows =
          Array.isArray(
            responseData?.result
          )
            ? responseData.result
            : [];


        return rows.flatMap(
          (
            row,
            rowIndex
          ) => {
            if (
              !row ||
              typeof row !==
                "object"
            ) {
              return [];
            }


            return Object.entries(
              row
            ).map(
              (
                [
                  key,
                  rawValue
                ]
              ) => {
                const numericValue =
                  Number(
                    String(
                      rawValue ??
                      ""
                    )
                      .replace(
                        /,/g,
                        ""
                      )
                      .trim()
                  );


                return {
                  command,
                  rowIndex,
                  key,
                  rawValue,
                  numericValue:
                    Number.isFinite(
                      numericValue
                    )
                      ? numericValue
                      : null
                };
              }
            );
          }
        );
      }
    );


  const fields = [
    "rawWaterInflow",
    "demiProduction",
    "pureWaterUsage",
    "rawWaterTankAmount",
    "rawWaterTankRate",
    "filteredWaterTankAmount",
    "filteredWaterTankRate",
    "demiWaterTankAmount",
    "demiWaterTankRate"
  ];


  const matches =
    Object.fromEntries(
      fields.map(
        field => {
          const value =
            Number(
              uiResult?.[
                field
              ]
            );


          const fieldMatches =
            Number.isFinite(
              value
            )
              ? candidateSources
                  .filter(
                    candidate => {
                      return (
                        candidate.numericValue !==
                          null &&
                        Math.abs(
                          candidate.numericValue -
                          value
                        ) <
                          0.000001
                      );
                    }
                  )
                  .map(
                    candidate => {
                      return {
                        command:
                          candidate.command,
                        rowIndex:
                          candidate.rowIndex,
                        key:
                          candidate.key,
                        rawValue:
                          candidate.rawValue
                      };
                    }
                  )
              : [];


          return [
            field,
            {
              value:
                Number.isFinite(
                  value
                )
                  ? value
                  : null,

              matches:
                fieldMatches
            }
          ];
        }
      )
    );


  console.log(
    "[PHASE3.1 WATER DIRECT PROBE] UI VALUE MATCHES " +
    JSON.stringify({
      targetDate,
      matches
    })
  );
}


'@

  $Text =
    $Text.Insert(
      $CollectFunctionIndex,
      $Helper
    )

  $CollectFunctionIndex =
    $Text.IndexOf(
      $CollectFunctionNeedle
    )

  $CollectOnceStart =
    $Text.IndexOf(
      '  const collectOnce =',
      $CollectFunctionIndex
    )

  $CollectOnceEnd =
    $Text.IndexOf(
      '  let result;',
      $CollectOnceStart
    )

  if (
    $CollectOnceStart -lt 0 -or
    $CollectOnceEnd -lt 0
  ) {
    throw 'collectOnce block was not found.'
  }

  $OldCollectOnce =
    $Text.Substring(
      $CollectOnceStart,
      $CollectOnceEnd -
        $CollectOnceStart
    )

  foreach (
    $Needle in @(
      'await ensureOisAgentLoggedIn(',
      'await setOisEnvironmentDate(',
      'await clickOisEnvironmentRecalculateButton(',
      'return await waitForOisWaterTreatmentValues('
    )
  ) {
    if (-not $OldCollectOnce.Contains($Needle)) {
      throw "collectOnce is missing expected code: $Needle"
    }
  }

  $NewCollectOnce =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
  const collectOnce =
    async () => {
      await ensureOisAgentLoggedIn(
        page,
        config
      );


      const phase31ProbeResponses =
        await runPhase31WaterDirectProbe(
          page,
          targetDate
        );


      await setOisEnvironmentDate(
        page,
        targetDate
      );


      await clickOisEnvironmentRecalculateButton(
        page
      );


      const uiResult =
        await waitForOisWaterTreatmentValues(
          page,
          targetDate
        );


      logPhase31WaterValueMatches(
        targetDate,
        uiResult,
        phase31ProbeResponses
      );


      return uiResult;
    };


'@

  $Text =
    $Text.Substring(
      0,
      $CollectOnceStart
    ) +
    $NewCollectOnce +
    $Text.Substring(
      $CollectOnceEnd
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
      'Phase 3.0 trace removed' =
        -not $Final.Contains(
          '[PHASE3.0 WATER AJAX TRACE]'
        )

      'Phase 3.1 marker' =
        $Final.Contains(
          '[PHASE3.1 WATER DIRECT PROBE]'
        )

      'UI match log present' =
        $Final.Contains(
          '[PHASE3.1 WATER DIRECT PROBE] UI VALUE MATCHES'
        )

      'Limestone direct kept' =
        $Final.Contains(
          '[PHASE2.5 DIRECT V5] Limestone API complete'
        )

      'Gear direct kept' =
        $Final.Contains(
          '[PHASE2.5 DIRECT V5] Gear/Pinion API complete'
        )

      'Phase 2.8B kept' =
        $Final.Contains(
          '[PHASE2.8B WATER-FIRST]'
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

  if ($Checks.Values -contains $false) {
    throw 'One or more verification checks failed.'
  }

  Write-Host ''
  Write-Host '===== Diff summary ====='

  git diff --stat -- `
    local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Phase 3.1 patch complete ====='
  Write-Host 'The Phase 3.0 network trace was removed.'
  Write-Host 'Water direct API commands are probed before the existing UI path.'
  Write-Host 'The existing UI result remains the source of truth.'
  Write-Host 'Agent has NOT been restarted.'
  Write-Host 'Nothing has been staged or committed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring current Agent ====='

  Copy-Item `
    -LiteralPath $CurrentBackup `
    -Destination $Agent `
    -Force

  Write-Host 'Restore complete.'

  throw
}
