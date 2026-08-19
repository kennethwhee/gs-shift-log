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
  throw 'Pre-TRACE backup was not found.'
}

Write-Host '===== Phase 2.5 Direct OIS API v2 ====='
Write-Host "Agent: $Agent"
Write-Host "Stable base: $($Stable.FullName)"

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$currentBackup = "$Agent.before-phase25-direct-v2-$stamp.bak"

Copy-Item -LiteralPath $Agent -Destination $currentBackup -Force
Copy-Item -LiteralPath $Stable.FullName -Destination $Agent -Force

$text = [IO.File]::ReadAllText($Agent)

if ($text.Contains('[PHASE2.5 DIRECT V2]')) {
  throw 'Phase 2.5 Direct v2 is already applied.'
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

function Find-FunctionRange([string]$src,[string]$needle) {
  $start = $src.IndexOf($needle)

  if ($start -lt 0) {
    throw "Function start not found: $needle"
  }

  $brace = $src.IndexOf('{',$start)

  if ($brace -lt 0) {
    throw "Opening brace not found: $needle"
  }

  $depth = 0
  $single = $false
  $double = $false
  $template = $false
  $escape = $false

  for ($i = $brace; $i -lt $src.Length; $i++) {
    $c = $src[$i]

    if ($escape) {
      $escape = $false
      continue
    }

    if ($single -or $double -or $template) {
      if ($c -eq '\') {
        $escape = $true
        continue
      }

      if ($single -and $c -eq "'") {
        $single = $false
        continue
      }

      if ($double -and $c -eq '"') {
        $double = $false
        continue
      }

      if ($template -and $c -eq '`') {
        $template = $false
        continue
      }

      continue
    }

    if ($c -eq "'") {
      $single = $true
      continue
    }

    if ($c -eq '"') {
      $double = $true
      continue
    }

    if ($c -eq '`') {
      $template = $true
      continue
    }

    if ($c -eq '{') {
      $depth++
      continue
    }

    if ($c -eq '}') {
      $depth--

      if ($depth -eq 0) {
        return [PSCustomObject]@{
          Start = $start
          End   = $i + 1
        }
      }
    }
  }

  throw "Function end not found: $needle"
}

function Insert-After-Login(
  [string]$src,
  [string]$functionNeedle,
  [string]$code
) {
  $range = Find-FunctionRange $src $functionNeedle
  $block = $src.Substring($range.Start,$range.End-$range.Start)

  $loginStart = $block.IndexOf('await ensureOisAgentLoggedIn(')

  if ($loginStart -lt 0) {
    throw "Login call not found: $functionNeedle"
  }

  $loginEnd = $block.IndexOf(');',$loginStart)

  if ($loginEnd -lt 0) {
    throw "Login call end not found: $functionNeedle"
  }

  return $src.Insert(
    $range.Start + $loginEnd + 2,
    (NL $code)
  )
}

try {
  $helperRange =
    Find-FunctionRange `
      $text `
      'async function requestOisInternalAjaxData('

  $helpers = @'

/* =========================================================
  [PHASE2.5 DIRECT V2]

  Direct same-origin OIS API path for:
  - Limestone
  - Gear Wheel / Pinion
  - Silo Level

  If direct API access fails, the existing UI path remains
  in place and runs as a fallback.
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
  const raw =
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

          text:
            await response.text()
        };
      },

      {
        command,
        selectItem
      }
    );


  if (
    !raw?.ok
  ) {
    throw new Error(
      "OIS direct TAG LOG API failed. HTTP " +
      String(
        raw?.status ||
        0
      )
    );
  }


  const responseText =
    String(
      raw.text ||
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


  const results =
    await Promise.all(
      OIS_UNIT_DEFINITIONS.map(
        async definition => {
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


          return {
            unit:
              definition.unit,

            tag:
              normalizeOisAgentText(
                targetRow.tag_no
              ) ||
              definition.tag,

            startStock,
            endStock
          };
        }
      )
    );


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
      "previous",

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


  const entries =
    await Promise.all(
      OIS_SILO_LEVEL_DEFINITIONS.map(
        async definition => {
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


          return {
            resultKey:
              definition.resultKey,

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
      )
    );


  const values = {};


  entries.forEach(
    entry => {
      values[
        entry.resultKey
      ] =
        entry;
    }
  );


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
      "24",

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
      $helperRange.End,
      (NL $helpers)
    )


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
      "[PHASE2.5 DIRECT V2] Silo Level API complete " +
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
      "[PHASE2.5 DIRECT V2] Silo Level direct API failed; using UI fallback:",
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
      "[PHASE2.5 DIRECT V2] Gear/Pinion API complete " +
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
      "[PHASE2.5 DIRECT V2] Gear/Pinion direct API failed; using UI fallback:",
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
      "[PHASE2.5 DIRECT V2] Limestone API complete " +
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
      "[PHASE2.5 DIRECT V2] Limestone direct API failed; using UI fallback:",
      directError instanceof
        Error
        ? directError.message
        : directError
    );
  }
'@


  $text =
    Insert-After-Login `
      $text `
      'async function collectOisSiloLevelValues(' `
      $siloCode


  $text =
    Insert-After-Login `
      $text `
      'async function collectOisTurbineGearPinionValues(' `
      $gearCode


  $text =
    Insert-After-Login `
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
  Write-Host '===== Direct API markers ====='

  Select-String `
    -LiteralPath $Agent `
    -SimpleMatch `
    -Pattern `
      '[PHASE2.5 DIRECT V2]',
      'collectOisPhase25LimestoneStocksDirect',
      'collectOisPhase25GearPinionDirect',
      'collectOisPhase25SiloLevelDirect',
      'OI.LOGSHEETSERVICE.LISTTAGLOG' |
  Select-Object LineNumber,Line |
  Format-Table -AutoSize


  Write-Host ''
  Write-Host '===== Diff summary ====='

  git diff --stat -- `
    local-tools/ois-agent/ois-login.js


  Write-Host ''
  Write-Host '===== Phase 2.5 Direct OIS API v2 applied ====='
  Write-Host 'Agent has NOT been restarted.'
  Write-Host 'Nothing has been staged or committed.'
  Write-Host 'Direct API failures automatically fall back to the existing UI path.'
  Write-Host "Current TRACE version backup: $currentBackup"

}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring current TRACE version ====='

  Copy-Item `
    -LiteralPath $currentBackup `
    -Destination $Agent `
    -Force

  Write-Host 'Restore complete.'

  throw
}
