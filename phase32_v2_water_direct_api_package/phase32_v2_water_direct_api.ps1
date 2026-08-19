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

Write-Host '===== Phase 3.2 v2 Water Direct API ====='

Write-Host ''
Write-Host '===== Locate clean pre-Phase3 backup ====='

$Stable =
  Get-ChildItem `
    (Join-Path $Repo 'local-tools\ois-agent') `
    -Filter 'ois-login.js.before-phase30-water-trace-*.bak' `
    -File `
    -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Stable) {
  throw 'Clean pre-Phase3 backup was not found.'
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

if (
  $StableText.Contains('[PHASE3.0 WATER AJAX TRACE]') -or
  $StableText.Contains('[PHASE3.1 WATER DIRECT PROBE]') -or
  $StableText.Contains('[PHASE3.2 WATER DIRECT]')
) {
  throw 'Selected stable backup unexpectedly contains Phase 3 code.'
}

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$CurrentBackup =
  "$Agent.before-phase32-v2-water-direct-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $CurrentBackup `
  -Force

Write-Host "Current backup: $CurrentBackup"

Write-Host ''
Write-Host '===== Restore clean pre-Phase3 Agent ====='

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
  [PHASE3.2 WATER DIRECT]

  Verified direct same-origin OIS API path for Water treatment.

  Field mapping verified against the existing UI results:
  rawWaterInflow          -> menu1_1_2
  demiProduction          -> menu2_5_4
  pureWaterUsage          -> menu2_6_13
  rawWaterTankAmount      -> menu1_1_5
  rawWaterTankRate        -> menu1_3_4
  filteredWaterTankAmount -> menu1_1_6
  filteredWaterTankRate   -> menu1_3_5
  demiWaterTankAmount     -> menu1_1_7
  demiWaterTankRate       -> menu1_3_6

  Existing UI flow remains automatic fallback.
========================================================= */
async function collectOisWaterTreatmentValuesDirect(
  page,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "Water Direct API target date is invalid."
    );
  }


  const startedAt =
    Date.now();


  const compactTargetDate =
    String(
      targetDate
    ).replace(
      /-/g,
      ""
    );


  const responseData =
    await requestOisInternalAjaxData(
      page,
      "oi.DayMonitoringService.listEnvDayRunnigStatus",
      {
        schepowstat:
          "8000",

        schdate:
          compactTargetDate,

        rowstatus:
          "C",

        schprgid:
          "EOIS5020"
      }
    );


  const rows =
    Array.isArray(
      responseData?.result
    )
      ? responseData.result
      : [];


  if (
    rows.length ===
      0
  ) {
    throw new Error(
      "Water Direct API returned no rows."
    );
  }


  const row =
    rows[
      0
    ];


  if (
    !row ||
    typeof row !==
      "object"
  ) {
    throw new Error(
      "Water Direct API returned an invalid row."
    );
  }


  const sourceDateDigits =
    String(
      row.now_date ||
      ""
    ).replace(
      /[^0-9]/g,
      ""
    ).slice(
      0,
      8
    );


  if (
    sourceDateDigits &&
    sourceDateDigits !==
      compactTargetDate
  ) {
    throw new Error(
      "Water Direct API source date does not match the target date."
    );
  }


  const readRequiredNumber =
    (
      key,
      label
    ) => {
      const value =
        parseOisNumericCell(
          row[
            key
          ]
        );


      if (
        value ===
          null ||
        !Number.isFinite(
          value
        )
      ) {
        throw new Error(
          "Water Direct API value is missing: " +
          label +
          " (" +
          key +
          ")"
        );
      }


      return value;
    };


  const result = {
    source:
      "OIS Daily Environment Log Direct API",

    sourceDate:
      targetDate,

    collectedAt:
      new Date()
        .toISOString(),

    rawWaterInflow:
      readRequiredNumber(
        "menu1_1_2",
        "rawWaterInflow"
      ),

    demiProduction:
      readRequiredNumber(
        "menu2_5_4",
        "demiProduction"
      ),

    pureWaterUsage:
      readRequiredNumber(
        "menu2_6_13",
        "pureWaterUsage"
      ),

    rawWaterTankAmount:
      readRequiredNumber(
        "menu1_1_5",
        "rawWaterTankAmount"
      ),

    rawWaterTankRate:
      readRequiredNumber(
        "menu1_3_4",
        "rawWaterTankRate"
      ),

    filteredWaterTankAmount:
      readRequiredNumber(
        "menu1_1_6",
        "filteredWaterTankAmount"
      ),

    filteredWaterTankRate:
      readRequiredNumber(
        "menu1_3_5",
        "filteredWaterTankRate"
      ),

    demiWaterTankAmount:
      readRequiredNumber(
        "menu1_1_7",
        "demiWaterTankAmount"
      ),

    demiWaterTankRate:
      readRequiredNumber(
        "menu1_3_6",
        "demiWaterTankRate"
      )
  };


  console.log(
    "[PHASE3.2 WATER DIRECT] complete " +
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
      rawWaterInflow:
        result.rawWaterInflow,
      demiProduction:
        result.demiProduction,
      pureWaterUsage:
        result.pureWaterUsage,
      rawWaterTankAmount:
        result.rawWaterTankAmount,
      rawWaterTankRate:
        result.rawWaterTankRate,
      filteredWaterTankAmount:
        result.filteredWaterTankAmount,
      filteredWaterTankRate:
        result.filteredWaterTankRate,
      demiWaterTankAmount:
        result.demiWaterTankAmount,
      demiWaterTankRate:
        result.demiWaterTankRate
    })
  );


  return result;
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


      try {
        return await collectOisWaterTreatmentValuesDirect(
          page,
          targetDate
        );

      } catch (
        directError
      ) {
        console.warn(
          "[PHASE3.2 WATER DIRECT] direct API failed; using UI fallback:",
          directError instanceof
            Error
            ? directError.message
            : directError
        );
      }


      await setOisEnvironmentDate(
        page,
        targetDate
      );


      await clickOisEnvironmentRecalculateButton(
        page
      );


      return await waitForOisWaterTreatmentValues(
        page,
        targetDate
      );
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

      'Phase 3.1 probe removed' =
        -not $Final.Contains(
          '[PHASE3.1 WATER DIRECT PROBE]'
        )

      'Phase 3.2 marker' =
        $Final.Contains(
          '[PHASE3.2 WATER DIRECT]'
        )

      'Water direct command' =
        $Final.Contains(
          'oi.DayMonitoringService.listEnvDayRunnigStatus'
        )

      'Water UI fallback kept' =
        $Final.Contains(
          '[PHASE3.2 WATER DIRECT] direct API failed; using UI fallback:'
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

  if (
    $Checks.Values -contains
      $false
  ) {
    throw 'One or more verification checks failed.'
  }

  Write-Host ''
  Write-Host '===== Diff summary ====='

  git diff --stat -- `
    local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Phase 3.2 v2 patch complete ====='
  Write-Host 'Clean pre-Phase3 Agent was used as the base.'
  Write-Host 'Water now tries the verified Direct API first.'
  Write-Host 'Existing UI Water flow remains automatic fallback.'
  Write-Host 'Phase 3.0/3.1 diagnostic code was removed.'
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
