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

$Stable =
  Get-ChildItem `
    (Split-Path -Parent $Agent) `
    -Filter 'ois-login.js.before-phase25-trace-*.bak' `
    -File `
    -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Stable) {
  throw 'Pre-TRACE stable backup was not found.'
}

Write-Host '===== Phase 2.5 Direct OIS API v3 ====='
Write-Host "Agent: $Agent"
Write-Host "Stable base: $($Stable.FullName)"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$currentBackup = "$Agent.before-phase25-v3-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $currentBackup -Force

# Always start from the known pre-TRACE stable version.
Copy-Item -LiteralPath $Stable.FullName -Destination $Agent -Force

$text = [IO.File]::ReadAllText($Agent)

if ($text.Contains('[PHASE2.5 DIRECT V3]')) {
  throw 'Phase 2.5 Direct v3 is already applied.'
}

$nl =
  if ($text.Contains("`r`n")) {
    "`r`n"
  } else {
    "`n"
  }

function NL([string]$s) {
  $s = $s.Replace("`r`n","`n")
  $s = $s.Replace("`r","`n")
  return $s.Replace("`n",$nl)
}

function Insert-After-Login-Near-Function(
  [string]$Source,
  [string]$FunctionNeedle,
  [string]$InsertCode
) {
  $functionStart = $Source.IndexOf($FunctionNeedle)

  if ($functionStart -lt 0) {
    throw "Function not found: $FunctionNeedle"
  }

  $loginStart =
    $Source.IndexOf(
      'await ensureOisAgentLoggedIn(',
      $functionStart
    )

  if (
    $loginStart -lt 0 -or
    ($loginStart - $functionStart) -gt 2500
  ) {
    throw "Login call not found near: $FunctionNeedle"
  }

  $loginEnd =
    $Source.IndexOf(
      ');',
      $loginStart
    )

  if (
    $loginEnd -lt 0 -or
    ($loginEnd - $loginStart) -gt 500
  ) {
    throw "Login call end not found near: $FunctionNeedle"
  }

  return $Source.Insert(
    $loginEnd + 2,
    (NL $InsertCode)
  )
}

try {
  # =========================================================
  # 1. Insert direct API helpers before a unique ASCII function.
  #    This is insertion-only; no existing function body is replaced.
  # =========================================================

  $helperAnchor =
    'async function collectOisLegacyLogApprovalValues('

  $helperIndex =
    $text.IndexOf(
      $helperAnchor
    )

  if ($helperIndex -lt 0) {
    throw 'Helper insertion anchor was not found.'
  }

  if (
    $text.IndexOf(
      $helperAnchor,
      $helperIndex + 1
    ) -ge 0
  ) {
    throw 'Helper insertion anchor is not unique.'
  }

  $helpers = @'
/* =========================================================
  [PHASE2.5 DIRECT V3]

  Direct same-origin OIS API path for:
  - Limestone
  - Gear Wheel / Pinion
  - Silo Level

  Existing UI code remains untouched and is used as fallback.
========================================================= */

const OIS_PHASE25_LOG_SHEET_COMMAND =
  "oi.LogSheetService.listLogSheetSearch";


const OIS_PHASE25_LOG_SHEET_COMMON_SELECT = {
  schepow_stat_code:
    "8000",

  dept_code:
    "5030",

  outtime:
    "1",

  rowstatus:
    "C"
};


function getOisPhase25Rows(
  responseData
) {
  return Array.isArray(
    responseData?.result
  )
    ? responseData.result
    : [];
}


function findOisPhase25RowByTag(
  rows,
  targetTag
) {
  const wanted =
    normalizeOisAgentText(
      targetTag
    )
      .toUpperCase();


  return (
    rows.find(
      row => {
        return (
          normalizeOisAgentText(
            row?.tag_no ||
            row?.tag ||
            row?.tagno
          )
            .toUpperCase() ===
          wanted
        );
      }
    ) ||
    null
  );
}


async function requestOisPhase25UppercaseAjaxData(
  page,
  command,
  selectItem
) {
  const requestResult =
    await page.evaluate(
      async (
        {
          command,
          selectItem
        }
      ) => {
        const parameters =
          new URLSearchParams();


        parameters.set(
          "TOSSDATA",
          JSON.stringify({
            SELECT: [
              selectItem
            ]
          })
        );


        parameters.set(
          "CMD",
          command
        );


        const response =
          await fetch(
            "/ajax/data",
            {
              method:
                "POST",

              headers: {
                Accept:
                  "application/json, text/javascript, */*; q=0.01",

                "Content-Type":
                  "application/x-www-form-urlencoded; charset=UTF-8",

                "X-Requested-With":
                  "XMLHttpRequest"
              },

              credentials:
                "same-origin",

              cache:
                "no-store",

              body:
                parameters.toString()
            }
          );


        return {
          ok:
            response.ok,

          status:
            response.status,

          responseText:
            await response.text()
        };
      },

      {
        command,
        selectItem
      }
    );


  if (
    !requestResult?.ok
  ) {
    throw new Error(
      "OIS direct TAG LOG API failed. HTTP " +
      String(
        requestResult?.status ||
        0
      )
    );
  }


  const responseText =
    String(
      requestResult.responseText ||
      ""
    )
      .trim();


  if (
    !responseText
  ) {
    return {};
  }


  try {
    return JSON.parse(
      responseText
    );

  } catch {
    throw new Error(
      "OIS direct TAG LOG API returned non-JSON data."
    );
  }
}


async function collectOisPhase25LimestoneStocksDirect(
  page,
  targetDate
) {
  const compactDate =
    targetDate.replace(
      /-/g,
      ""
    );


  const results = [];


  for (
    const definition of
    OIS_UNIT_DEFINITIONS
  ) {
    const sheetCode =
      definition.unit ===
        1
        ? "112"
        : "113";


    const responseData =
      await requestOisInternalAjaxData(
        page,
        OIS_PHASE25_LOG_SHEET_COMMAND,
        {
          ...OIS_PHASE25_LOG_SHEET_COMMON_SELECT,

          sheet_code:
            sheetCode,

          schbase_date:
            compactDate
        }
      );


    const targetRow =
      findOisPhase25RowByTag(
        getOisPhase25Rows(
          responseData
        ),
        definition.tag
      );


    if (
      !targetRow
    ) {
      throw new Error(
        "Limestone tag missing from direct API response: " +
        String(
          definition.tag
        )
      );
    }


    const startStock =
      parseOisAgentNumber(
        targetRow.decimal_pnt
      );


    const endStock =
      parseOisAgentNumber(
        targetRow.hd_24
      );


    if (
      startStock ===
        null ||
      endStock ===
        null
    ) {
      throw new Error(
        "Limestone direct API stock value is invalid."
      );
    }


    results.push({
      unit:
        definition.unit,

      tag:
        normalizeOisAgentText(
          targetRow.tag_no
        ) ||
        definition.tag,

      startStock,
      endStock
    });
  }


  const unitOne =
    results.find(
      item => {
        return item.unit ===
          1;
      }
    );


  const unitTwo =
    results.find(
      item => {
        return item.unit ===
          2;
      }
    );


  if (
    !unitOne ||
    !unitTwo
  ) {
    throw new Error(
      "Limestone direct API did not return both units."
    );
  }


  return {
    targetDate,

    nextDate:
      addOisAgentDateDays(
        targetDate,
        1
      ),

    unitOne: {
      tag:
        unitOne.tag,

      startStock:
        unitOne.startStock,

      endStock:
        unitOne.endStock
    },

    unitTwo: {
      tag:
        unitTwo.tag,

      startStock:
        unitTwo.startStock,

      endStock:
        unitTwo.endStock
    },

    collectedAt:
      new Date()
        .toISOString()
  };
}


async function collectOisPhase25GearPinionDirect(
  page,
  targetDate
) {
  const compactDate =
    targetDate.replace(
      /-/g,
      ""
    );


  const responseData =
    await requestOisInternalAjaxData(
      page,
      OIS_PHASE25_LOG_SHEET_COMMAND,
      {
        ...OIS_PHASE25_LOG_SHEET_COMMON_SELECT,

        sheet_code:
          "111",

        schbase_date:
          compactDate
      }
    );


  const rows =
    getOisPhase25Rows(
      responseData
    );


  const gearDefinition =
    OIS_TURBINE_GEAR_PINION_DEFINITION
      .gearWheel;


  const pinionDefinition =
    OIS_TURBINE_GEAR_PINION_DEFINITION
      .pinion;


  const gearRow =
    findOisPhase25RowByTag(
      rows,
      gearDefinition.tag
    );


  const pinionRow =
    findOisPhase25RowByTag(
      rows,
      pinionDefinition.tag
    );


  if (
    !gearRow ||
    !pinionRow
  ) {
    throw new Error(
      "Gear/Pinion tags are missing from direct API response."
    );
  }


  const valueField =
    OIS_TURBINE_GEAR_PINION_DEFINITION
      .valueField ||
    "decimal_pnt";


  const gearWheel =
    parseOisAgentNumber(
      gearRow[
        valueField
      ]
    );


  const pinion =
    parseOisAgentNumber(
      pinionRow[
        valueField
      ]
    );


  if (
    gearWheel ===
      null ||
    pinion ===
      null
  ) {
    throw new Error(
      "Gear/Pinion direct API values are invalid."
    );
  }


  return {
    source:
      "OIS BOARD LOGSHEET (TGO)",

    targetDate,

    sourceDate:
      targetDate,

    sheetLabel:
      OIS_TURBINE_GEAR_PINION_DEFINITION
        .sheetLabel,

    valueColumn:
      "\uC804\uC77C",

    valueField,

    gearWheel,
    pinion,

    gearWheelTag:
      normalizeOisAgentText(
        gearRow.tag_no
      ) ||
      gearDefinition.tag,

    pinionTag:
      normalizeOisAgentText(
        pinionRow.tag_no
      ) ||
      pinionDefinition.tag,

    gearWheelItemName:
      normalizeOisAgentText(
        gearRow.mid_name
      ),

    pinionItemName:
      normalizeOisAgentText(
        pinionRow.mid_name
      ),

    gearWheelUnit:
      normalizeOisAgentText(
        gearRow.unit_code
      ),

    pinionUnit:
      normalizeOisAgentText(
        pinionRow.unit_code
      ),

    collectedAt:
      new Date()
        .toISOString()
  };
}


async function collectOisPhase25SiloLevelDirect(
  page,
  targetDate
) {
  const compactDate =
    targetDate.replace(
      /-/g,
      ""
    );


  const values = {};


  for (
    const definition of
    OIS_SILO_LEVEL_DEFINITIONS
  ) {
    await requestOisPhase25UppercaseAjaxData(
      page,
      "OI.ETCINFOSERVICE.CHKTAGNO",
      {
        EPOW_STAT_CODE:
          "8000",

        TAG_NO:
          definition.tag
      }
    );


    const responseData =
      await requestOisPhase25UppercaseAjaxData(
        page,
        "OI.LOGSHEETSERVICE.LISTTAGLOG",
        {
          SCHEPOW_STAT_CODE:
            "8000",

          OUTTIME:
            "1",

          TAG_NO:
            definition.tag,

          STARTDATE:
            compactDate,

          ENDDATE:
            compactDate,

          ROWSTATUS:
            "C"
        }
      );


    const rows =
      getOisPhase25Rows(
        responseData
      );


    const targetRow =
      findOisPhase25RowByTag(
        rows,
        definition.tag
      ) ||
      rows[0] ||
      null;


    if (
      !targetRow
    ) {
      throw new Error(
        "Silo tag missing from direct API response: " +
        String(
          definition.tag
        )
      );
    }


    const candidates = [
      [
        "hd_24",
        targetRow?.hd_24
      ],

      [
        "h_24",
        targetRow?.h_24
      ],

      [
        "hour_24",
        targetRow?.hour_24
      ],

      [
        "hour24",
        targetRow?.hour24
      ],

      [
        "value_24",
        targetRow?.value_24
      ],

      [
        "value24",
        targetRow?.value24
      ],

      [
        "24",
        targetRow?.["24"]
      ]
    ];


    let value =
      null;


    let valueField =
      "";


    for (
      const [
        fieldName,
        rawValue
      ] of
      candidates
    ) {
      const numericValue =
        parseOisAgentNumber(
          rawValue
        );


      if (
        numericValue ===
          null
      ) {
        continue;
      }


      value =
        numericValue;

      valueField =
        fieldName;

      break;
    }


    if (
      value ===
        null
    ) {
      throw new Error(
        "Silo direct API 24-hour value is missing: " +
        String(
          definition.tag
        )
      );
    }


    values[
      definition.resultKey
    ] = {
      value,

      valueField,

      tag:
        normalizeOisAgentText(
          targetRow?.tag_no ||
          targetRow?.tag ||
          definition.tag
        ) ||
        definition.tag,

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
    !values.flyAsh ||
    !values.bioStorage
  ) {
    throw new Error(
      "Silo direct API did not return both target tags."
    );
  }


  return {
    source:
      "OIS TAG LOG",

    targetDate,

    valueColumn:
      "24\uC2DC",

    flyAshSiloLevel:
      values.flyAsh.value,

    bioStorageSiloLevel:
      values.bioStorage.value,

    flyAshTag:
      values.flyAsh.tag,

    bioStorageTag:
      values.bioStorage.tag,

    flyAshItemName:
      values.flyAsh.itemName,

    bioStorageItemName:
      values.bioStorage.itemName,

    flyAshUnit:
      values.flyAsh.unit,

    bioStorageUnit:
      values.bioStorage.unit,

    flyAshValueField:
      values.flyAsh.valueField,

    bioStorageValueField:
      values.bioStorage.valueField,

    collectedAt:
      new Date()
        .toISOString()
  };
}


'@

  $text =
    $text.Insert(
      $helperIndex,
      (NL $helpers)
    )


  # =========================================================
  # 2. Insert a small direct-API-first block after the existing
  #    login check in each collector. Existing UI code is not
  #    removed or replaced.
  # =========================================================

  $siloCode = @'


  const phase25StartedAt =
    Date.now();


  try {
    const directResult =
      await collectOisPhase25SiloLevelDirect(
        page,
        targetDate
      );


    console.log(
      "[PHASE2.5 DIRECT V3] Silo Level API complete " +
      (
        (
          Date.now() -
          phase25StartedAt
        ) /
        1000
      ).toFixed(
        2
      ) +
      "s"
    );


    return directResult;

  } catch (
    directError
  ) {
    console.warn(
      "[PHASE2.5 DIRECT V3] Silo Level direct API failed; using UI fallback:",
      directError instanceof
        Error
        ? directError.message
        : directError
    );
  }
'@


  $gearCode = @'


  const phase25StartedAt =
    Date.now();


  try {
    const directResult =
      await collectOisPhase25GearPinionDirect(
        page,
        targetDate
      );


    console.log(
      "[PHASE2.5 DIRECT V3] Gear/Pinion API complete " +
      (
        (
          Date.now() -
          phase25StartedAt
        ) /
        1000
      ).toFixed(
        2
      ) +
      "s"
    );


    return directResult;

  } catch (
    directError
  ) {
    console.warn(
      "[PHASE2.5 DIRECT V3] Gear/Pinion direct API failed; using UI fallback:",
      directError instanceof
        Error
        ? directError.message
        : directError
    );
  }
'@


  $limeCode = @'


  const phase25StartedAt =
    Date.now();


  try {
    const directResult =
      await collectOisPhase25LimestoneStocksDirect(
        page,
        targetDate
      );


    console.log(
      "[PHASE2.5 DIRECT V3] Limestone API complete " +
      (
        (
          Date.now() -
          phase25StartedAt
        ) /
        1000
      ).toFixed(
        2
      ) +
      "s"
    );


    return directResult;

  } catch (
    directError
  ) {
    console.warn(
      "[PHASE2.5 DIRECT V3] Limestone direct API failed; using UI fallback:",
      directError instanceof
        Error
        ? directError.message
        : directError
    );
  }
'@


  $text =
    Insert-After-Login-Near-Function `
      $text `
      'async function collectOisSiloLevelValues(' `
      $siloCode


  $text =
    Insert-After-Login-Near-Function `
      $text `
      'async function collectOisTurbineGearPinionValues(' `
      $gearCode


  $text =
    Insert-After-Login-Near-Function `
      $text `
      'async function collectOisLimestoneStocks(' `
      $limeCode


  [IO.File]::WriteAllText(
    $Agent,
    $text,
    (New-Object Text.UTF8Encoding($false))
  )


  Write-Host ''
  Write-Host '===== TRACE marker check ====='

  $trace =
    @(
      Select-String `
        -LiteralPath $Agent `
        -SimpleMatch `
        -Pattern '[PHASE2.5 TRACE]' `
        -ErrorAction SilentlyContinue
    )

  Write-Host "TRACE markers: $($trace.Count)"


  Write-Host ''
  Write-Host '===== Node syntax check ====='

  & $Node --check $Agent

  if ($LASTEXITCODE -ne 0) {
    throw 'Node syntax check failed.'
  }


  Write-Host ''
  Write-Host '===== git diff --check ====='

  git diff --check -- `
    local-tools/ois-agent/ois-login.js

  if ($LASTEXITCODE -ne 0) {
    throw 'git diff --check failed.'
  }


  Write-Host ''
  Write-Host '===== Insertion-only verification ====='

  $numstat =
    git diff `
      --no-index `
      --numstat `
      -- `
      $Stable.FullName `
      $Agent `
      2>$null

  Write-Host $numstat

  $numstatLine =
    @(
      $numstat
    ) |
    Where-Object {
      $_ -match '^\d+\s+\d+\s+'
    } |
    Select-Object -First 1

  if (-not $numstatLine) {
    throw 'Could not verify insertion-only diff.'
  }

  $parts =
    $numstatLine -split '\s+'

  $insertions =
    [int]$parts[0]

  $deletions =
    [int]$parts[1]

  Write-Host "Insertions vs stable base: $insertions"
  Write-Host "Deletions vs stable base: $deletions"

  if ($deletions -ne 0) {
    throw 'Unexpected deletions detected versus stable base.'
  }


  Write-Host ''
  Write-Host '===== Direct API markers ====='

  Select-String `
    -LiteralPath $Agent `
    -SimpleMatch `
    -Pattern `
      '[PHASE2.5 DIRECT V3]',
      'collectOisPhase25LimestoneStocksDirect',
      'collectOisPhase25GearPinionDirect',
      'collectOisPhase25SiloLevelDirect',
      'OI.LOGSHEETSERVICE.LISTTAGLOG' |
  Select-Object LineNumber,Line |
  Format-Table -AutoSize


  Write-Host ''
  Write-Host '===== Phase 2.5 Direct OIS API v3 applied ====='
  Write-Host 'Agent has NOT been restarted.'
  Write-Host 'Nothing has been staged or committed.'
  Write-Host 'Existing UI paths remain intact as fallback.'
  Write-Host "Previous on-disk version backup: $currentBackup"

}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring stable pre-TRACE version ====='

  Copy-Item `
    -LiteralPath $Stable.FullName `
    -Destination $Agent `
    -Force

  Write-Host 'Stable restore complete.'

  throw
}
