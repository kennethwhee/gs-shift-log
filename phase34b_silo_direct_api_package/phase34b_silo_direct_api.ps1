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

Write-Host '===== Phase 3.4B Silo Direct API ====='

Write-Host ''
Write-Host '===== Pre-patch syntax check ====='

& $Node --check $Agent

if ($LASTEXITCODE -ne 0) {
  throw 'Agent syntax is already invalid before patch.'
}

$Text =
  [IO.File]::ReadAllText($Agent)

if ($Text.Contains('[PHASE3.4B SILO DIRECT]')) {
  throw 'Phase 3.4B is already applied.'
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
  "$Agent.before-phase34b-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $Backup `
  -Force

Write-Host "Backup: $Backup"

$Nl =
  Get-NewLine $Text

try {
  $FunctionStart =
    $Text.IndexOf(
      'async function collectOisSiloLevelValues('
    )

  if ($FunctionStart -lt 0) {
    throw 'collectOisSiloLevelValues was not found.'
  }

  $NextAnchor =
    '/* =========================================================' +
    $Nl +
    '  OIS 과거 LOG SHEET 업무일지 조회 정의'

  $FunctionEnd =
    $Text.IndexOf(
      $NextAnchor,
      $FunctionStart
    )

  if ($FunctionEnd -lt 0) {
    throw 'The anchor after collectOisSiloLevelValues was not found.'
  }

  $OldRegion =
    $Text.Substring(
      $FunctionStart,
      $FunctionEnd - $FunctionStart
    )

  foreach (
    $Expected in @(
      'await ensureOisAgentLoggedIn(',
      'OIS_SILO_LEVEL_DEFINITIONS',
      'OIS Silo Level 조회 완료'
    )
  ) {
    if (-not $OldRegion.Contains($Expected)) {
      throw "Existing Silo function does not contain expected text: $Expected"
    }
  }

  $NewRegion =
    Convert-NewLine `
      -NewLine $Nl `
      -Text @'
/* =========================================================
  [PHASE3.4B SILO DIRECT]

  Exact request captured from the working TAG Log UI:

  cmd:
  oi.LogSheetService.listTagLog

  tossdata.select[0]:
  - schepow_stat_code = 8000
  - outtime = 1
  - tag_no = target tag
  - startdate = yyyyMMdd
  - enddate = yyyyMMdd
  - rowstatus = C

  The direct path reads hd_24 only.
  The existing UI path remains the automatic fallback.
========================================================= */

async function collectOisSiloLevelValuesDirect(
  page,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "Silo Direct API target date is invalid."
    );
  }


  const startedAt =
    Date.now();


  const compactDate =
    targetDate.replace(
      /-/g,
      ""
    );


  const capturedValues = {};


  for (
    const definition of
      OIS_SILO_LEVEL_DEFINITIONS
  ) {
    const responseData =
      await requestOisInternalAjaxData(
        page,
        "oi.LogSheetService.listTagLog",
        {
          schepow_stat_code:
            "8000",

          outtime:
            "1",

          tag_no:
            definition.tag,

          startdate:
            compactDate,

          enddate:
            compactDate,

          rowstatus:
            "C"
        }
      );


    const rows =
      Array.isArray(
        responseData?.result
      )
        ? responseData.result
        : [];


    const normalizedTargetTag =
      normalizeOisAgentText(
        definition.tag
      ).toUpperCase();


    const targetRow =
      rows.find(
        row => {
          const rowTag =
            normalizeOisAgentText(
              row?.tag_no ||
              row?.tag ||
              row?.tagno ||
              ""
            ).toUpperCase();


          if (
            rowTag &&
            rowTag !==
              normalizedTargetTag
          ) {
            return false;
          }


          const rowDate =
            String(
              row?.base_date ||
              row?.schbase_date ||
              row?.date ||
              row?.work_date ||
              ""
            )
              .replace(
                /[^0-9]/g,
                ""
              )
              .slice(
                0,
                8
              );


          if (
            rowDate &&
            rowDate !==
              compactDate
          ) {
            return false;
          }


          return true;
        }
      ) ||
      null;


    if (
      !targetRow
    ) {
      throw new Error(
        "Silo Direct API row missing: " +
        definition.tag
      );
    }


    const value =
      parseOisAgentNumber(
        targetRow.hd_24
      );


    if (
      value ===
        null ||
      !Number.isFinite(
        value
      )
    ) {
      throw new Error(
        "Silo Direct API hd_24 is invalid: " +
        definition.tag
      );
    }


    const sourceDate =
      String(
        targetRow?.base_date ||
        targetRow?.schbase_date ||
        targetRow?.date ||
        targetRow?.work_date ||
        compactDate
      )
        .replace(
          /[^0-9]/g,
          ""
        )
        .slice(
          0,
          8
        ) ||
      compactDate;


    if (
      sourceDate !==
        compactDate
    ) {
      throw new Error(
        "Silo Direct API source date mismatch: " +
        definition.tag
      );
    }


    capturedValues[
      definition.resultKey
    ] = {
      value,

      valueField:
        "hd_24",

      tag:
        normalizeOisAgentText(
          targetRow?.tag_no ||
          targetRow?.tag ||
          targetRow?.tagno ||
          definition.tag
        ) ||
        definition.tag,

      sourceDate,

      itemName:
        normalizeOisAgentText(
          targetRow?.tag_name ||
          targetRow?.tag_name_kor ||
          targetRow?.mid_name ||
          ""
        ),

      unit:
        normalizeOisAgentText(
          targetRow?.unit_code ||
          targetRow?.unit ||
          ""
        )
    };
  }


  if (
    !capturedValues.flyAsh ||
    !capturedValues.bioStorage
  ) {
    throw new Error(
      "Silo Direct API did not return both target tags."
    );
  }


  const result = {
    source:
      "OIS TAG Log Direct API",

    targetDate,

    valueColumn:
      "24시",

    flyAshSiloLevel:
      capturedValues
        .flyAsh
        .value,

    bioStorageSiloLevel:
      capturedValues
        .bioStorage
        .value,

    flyAshTag:
      capturedValues
        .flyAsh
        .tag,

    bioStorageTag:
      capturedValues
        .bioStorage
        .tag,

    flyAshItemName:
      capturedValues
        .flyAsh
        .itemName,

    bioStorageItemName:
      capturedValues
        .bioStorage
        .itemName,

    flyAshUnit:
      capturedValues
        .flyAsh
        .unit,

    bioStorageUnit:
      capturedValues
        .bioStorage
        .unit,

    flyAshValueField:
      capturedValues
        .flyAsh
        .valueField,

    bioStorageValueField:
      capturedValues
        .bioStorage
        .valueField,

    collectedAt:
      new Date()
        .toISOString()
  };


  console.log(
    "[PHASE3.4B SILO DIRECT] complete " +
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
      flyAshSiloLevel:
        result.flyAshSiloLevel,
      bioStorageSiloLevel:
        result.bioStorageSiloLevel
    })
  );


  return result;
}


async function collectOisSiloLevelValuesUi(
  page,
  config,
  targetDate
) {
  await ensureOisAgentLoggedIn(
    page,
    config
  );


  const capturedValues = {};


  for (
    const definition of
      OIS_SILO_LEVEL_DEFINITIONS
  ) {
    let frame =
      await openOisTagLogLookup(
        page
      );


    await setOisTagLogSearchConditions(
      frame,
      definition.tag,
      targetDate
    );


    await page.waitForTimeout(
      200
    );


    frame =
      await findOisTagLogFrame(
        page,
        3000
      ) ||
      frame;


    const capturedValue =
      await captureOisTagLog24HourValueFromApi(
        page,
        definition.tag,
        targetDate,

        async () => {
          await clickOisLogSheetSearchButton(
            frame
          );
        }
      );


    capturedValues[
      definition.resultKey
    ] = {
      ...capturedValue,

      label:
        definition.label
    };
  }


  const result = {
    source:
      "OIS TAG별 LOG 조회",

    targetDate,

    valueColumn:
      "24시",

    flyAshSiloLevel:
      capturedValues
        .flyAsh
        .value,

    bioStorageSiloLevel:
      capturedValues
        .bioStorage
        .value,

    flyAshTag:
      capturedValues
        .flyAsh
        .tag,

    bioStorageTag:
      capturedValues
        .bioStorage
        .tag,

    flyAshItemName:
      capturedValues
        .flyAsh
        .itemName,

    bioStorageItemName:
      capturedValues
        .bioStorage
        .itemName,

    flyAshUnit:
      capturedValues
        .flyAsh
        .unit,

    bioStorageUnit:
      capturedValues
        .bioStorage
        .unit,

    flyAshValueField:
      capturedValues
        .flyAsh
        .valueField,

    bioStorageValueField:
      capturedValues
        .bioStorage
        .valueField,

    collectedAt:
      new Date()
        .toISOString()
  };


  console.log(
    [
      "OIS Silo Level 조회 완료",

      targetDate,

      `Fly Ash ${result.flyAshSiloLevel}${result.flyAshUnit || ""}`,

      `Bio Storage ${result.bioStorageSiloLevel}${result.bioStorageUnit || ""}`
    ].join(
      " · "
    )
  );


  return result;
}


async function collectOisSiloLevelValues(
  page,
  config,
  targetDate
) {
  if (
    !isValidOisAgentDate(
      targetDate
    )
  ) {
    throw new Error(
      "Silo Level 조회 날짜가 올바르지 않습니다."
    );
  }


  await ensureOisAgentLoggedIn(
    page,
    config
  );


  try {
    return await collectOisSiloLevelValuesDirect(
      page,
      targetDate
    );

  } catch (
    directError
  ) {
    console.warn(
      "[PHASE3.4B SILO DIRECT] direct API failed; using UI fallback:",
      directError instanceof
        Error
        ? directError.message
        : directError
    );
  }


  return await collectOisSiloLevelValuesUi(
    page,
    config,
    targetDate
  );
}


'@

  $Text =
    Replace-Range `
      -Text $Text `
      -Start $FunctionStart `
      -End $FunctionEnd `
      -Replacement $NewRegion

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

  $Checks =
    [ordered]@{
      'Phase 3.4B marker' =
        $Final.Contains(
          '[PHASE3.4B SILO DIRECT]'
        )

      'Exact listTagLog command' =
        $Final.Contains(
          '"oi.LogSheetService.listTagLog"'
        )

      'Exact outtime field' =
        $Final.Contains(
          'outtime:'
        )

      'UI fallback kept' =
        $Final.Contains(
          'collectOisSiloLevelValuesUi'
        )

      'Phase 3.4A trace removed' =
        -not (
          $Final.Contains(
            '[PHASE3.4A SILO AJAX TRACE]'
          )
        )

      'Phase 3.3B kept' =
        $Final.Contains(
          '[PHASE3.3B NONBLOCKING STARTUP]'
        )

      'Phase 3.3A kept' =
        $Final.Contains(
          '[PHASE3.3A EXCEL BULK READ]'
        )

      'Phase 3.2 kept' =
        $Final.Contains(
          '[PHASE3.2 WATER DIRECT]'
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
    throw 'Verification failed.'
  }

  Write-Host ''
  Write-Host '===== Diff summary ====='

  git diff --stat -- `
    local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Phase 3.4B patch complete ====='
  Write-Host 'Exact working listTagLog request is now used directly.'
  Write-Host 'The existing UI flow remains automatic fallback.'
  Write-Host 'Phase 3.4A diagnostic trace was removed.'
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
