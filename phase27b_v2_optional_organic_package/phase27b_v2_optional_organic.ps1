param(
  [string]$Repo = 'C:\Users\GSENR\Desktop\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

$Agent =
  Join-Path $Repo 'local-tools\ois-agent\ois-login.js'

$Script =
  Join-Path $Repo 'script.js'

$Node =
  'C:\Program Files\nodejs\node.exe'

foreach ($Path in @($Agent, $Script, $Node)) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Required file not found: $Path"
  }
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

function Require-Contains {
  param(
    [string]$Text,
    [string]$Needle,
    [string]$Label
  )

  if (-not $Text.Contains($Needle)) {
    throw "Required code was not found: $Label"
  }
}

Write-Host '===== Phase 2.7B v2 optional organic fuel data ====='

Write-Host ''
Write-Host '===== Pre-patch syntax check ====='

& $Node --check $Agent
if ($LASTEXITCODE -ne 0) {
  throw 'Agent already has a syntax error before patch.'
}

& $Node --check $Script
if ($LASTEXITCODE -ne 0) {
  throw 'script.js already has a syntax error before patch.'
}

$AgentText =
  [IO.File]::ReadAllText($Agent)

$ScriptText =
  [IO.File]::ReadAllText($Script)

if (
  $AgentText.Contains('[PHASE2.7B ORGANIC OPTIONAL V2]') -or
  $ScriptText.Contains('[PHASE2.7B ORGANIC OPTIONAL V2]')
) {
  throw 'Phase 2.7B v2 is already applied.'
}

$Stamp =
  Get-Date -Format 'yyyyMMdd-HHmmss'

$AgentBackup =
  "$Agent.before-phase27b-v2-$Stamp.bak"

$ScriptBackup =
  "$Script.before-phase27b-v2-$Stamp.bak"

Copy-Item `
  -LiteralPath $Agent `
  -Destination $AgentBackup `
  -Force

Copy-Item `
  -LiteralPath $Script `
  -Destination $ScriptBackup `
  -Force

Write-Host "Agent backup : $AgentBackup"
Write-Host "Script backup: $ScriptBackup"

$AgentNl =
  Get-NewLine $AgentText

$ScriptNl =
  Get-NewLine $ScriptText

try {
  # =========================================================
  # Agent / embedded PowerShell
  # =========================================================

  $PlantOrganicAnchor =
    $AgentText.IndexOf(
      '  $plantOrganicValues ='
    )

  if ($PlantOrganicAnchor -lt 0) {
    throw 'Embedded PowerShell organic block start not found.'
  }

  # Missing receipt detail rows are not numeric zero.
  # Keep them as null so the UI can show "-".
  $ReceiptOptionalCode =
    Convert-NewLine `
      -NewLine $AgentNl `
      -Text @'
  # [PHASE2.7B ORGANIC OPTIONAL V2]
  $hasOrganicReceiptData =
    @(
      $sludgeEntries |
        Where-Object {
          $null -ne
            $_.amount
        }
    ).Count -gt
      0

  if (
    -not
      $hasOrganicReceiptData
  ) {
    $sludgeTruckCount =
      $null

    $sludgeTotal =
      $null
  }


'@

  $AgentText =
    $AgentText.Insert(
      $PlantOrganicAnchor,
      $ReceiptOptionalCode
    )

  # Wrap only the organic Silo lookup/validation block.
  # Any error in this optional group becomes null instead of
  # aborting all power/solar/steam Excel data.
  $OrganicStart =
    $AgentText.IndexOf(
      '  $plantOrganicValues ='
    )

  $OrganicEnd =
    $AgentText.IndexOf(
      '  $unitOneProduction =',
      $OrganicStart
    )

  if (
    $OrganicStart -lt 0 -or
    $OrganicEnd -lt 0
  ) {
    throw 'Embedded PowerShell organic Silo range not found.'
  }

  $OriginalOrganicBlock =
    $AgentText.Substring(
      $OrganicStart,
      $OrganicEnd - $OrganicStart
    )

  $OrganicPrefix =
    Convert-NewLine `
      -NewLine $AgentNl `
      -Text @'
  $organicValues =
    [ordered]@{
      organicDaySilo = $null
      organicStorageSiloA = $null
      organicStorageSiloB = $null
    }

  $organicMetadata =
    [ordered]@{}

  $organicSiloTotal =
    $null

  $dataDateCell =
    ""

  try {
'@

  $OrganicSuffix =
    Convert-NewLine `
      -NewLine $AgentNl `
      -Text @'
  }
  catch {
    $organicValues =
      [ordered]@{
        organicDaySilo = $null
        organicStorageSiloA = $null
        organicStorageSiloB = $null
      }

    $organicMetadata =
      [ordered]@{}

    $organicSiloTotal =
      $null

    $dataDateCell =
      ""

    Write-DailyDataStage -Message (
      "Optional organic Silo data unavailable; continuing with other Daily DATA"
    )
  }


'@

  $AgentText =
    Replace-Range `
      -Text $AgentText `
      -Start $OrganicStart `
      -End $OrganicEnd `
      -Replacement (
        $OrganicPrefix +
        $AgentNl +
        $OriginalOrganicBlock +
        $OrganicSuffix
      )

  # [double]$null becomes 0 in PowerShell, so optional nulls
  # must be emitted without a numeric cast.
  foreach (
    $OrganicKey in @(
      'organicDaySilo',
      'organicStorageSiloA',
      'organicStorageSiloB'
    )
  ) {
    $OldCast =
      '[double]$organicValues.' +
      $OrganicKey

    $NewValue =
      '$organicValues.' +
      $OrganicKey

    if (-not $AgentText.Contains($OldCast)) {
      throw "Organic output cast not found: $OldCast"
    }

    $AgentText =
      $AgentText.Replace(
        $OldCast,
        $NewValue
      )
  }

  # =========================================================
  # Agent / JS result parser
  # =========================================================

  $CollectScope =
    $AgentText.IndexOf(
      'async function collectDailyDataWorkbookValues('
    )

  if ($CollectScope -lt 0) {
    throw 'collectDailyDataWorkbookValues not found.'
  }

  $OrganicParserStart =
    $AgentText.IndexOf(
      '  const organicDaySilo =',
      $CollectScope
    )

  $OrganicParserEnd =
    $AgentText.IndexOf(
      '  const sludgeEntries =',
      $OrganicParserStart
    )

  if (
    $OrganicParserStart -lt 0 -or
    $OrganicParserEnd -lt 0
  ) {
    throw 'Agent organic result parser range not found.'
  }

  $OptionalOrganicParser =
    Convert-NewLine `
      -NewLine $AgentNl `
      -Text @'
  const parseOptionalOrganicNumber =
    (
      value,
      fractionDigits =
        6
    ) => {
      if (
        value ===
          null ||
        value ===
          undefined ||
        normalizeOisAgentText(
          value
        ) ===
          ""
      ) {
        return null;
      }

      const numericValue =
        Number(
          value
        );

      if (
        !Number.isFinite(
          numericValue
        )
      ) {
        return null;
      }

      return roundDailyDataNumber(
        numericValue,
        fractionDigits
      );
    };


  const organicDaySilo =
    parseOptionalOrganicNumber(
      capturedResult.organicDaySilo ??
        capturedResult.organicDaySiloLevel
    );


  const organicStorageSiloA =
    parseOptionalOrganicNumber(
      capturedResult.organicStorageSiloA ??
        capturedResult.organicStorageSiloALevel
    );


  const organicStorageSiloB =
    parseOptionalOrganicNumber(
      capturedResult.organicStorageSiloB ??
        capturedResult.organicStorageSiloBLevel
    );


  const hasCompleteOrganicSiloValues =
    [
      organicDaySilo,
      organicStorageSiloA,
      organicStorageSiloB
    ].every(
      value => {
        return Number.isFinite(
          value
        );
      }
    );


  const organicSiloTotal =
    hasCompleteOrganicSiloValues
      ? roundDailyDataNumber(
          organicDaySilo +
          organicStorageSiloA +
          organicStorageSiloB,
          6
        )
      : null;


'@

  $AgentText =
    Replace-Range `
      -Text $AgentText `
      -Start $OrganicParserStart `
      -End $OrganicParserEnd `
      -Replacement $OptionalOrganicParser

  # Receipt summary validation becomes optional when all 10
  # receipt detail cells are blank.
  $ReceiptValidationStart =
    $AgentText.IndexOf(
      '  const calculatedSludgeTruckCount =',
      $OrganicParserStart
    )

  $ResultObjectStart =
    $AgentText.IndexOf(
      '  const result = {',
      $ReceiptValidationStart
    )

  if (
    $ReceiptValidationStart -lt 0 -or
    $ResultObjectStart -lt 0
  ) {
    throw 'Agent receipt validation range not found.'
  }

  $OptionalReceiptValidation =
    Convert-NewLine `
      -NewLine $AgentNl `
      -Text @'
  const hasOrganicReceiptData =
    sludgeEntries.some(
      item => {
        return Number.isFinite(
          item.amount
        );
      }
    );


  const calculatedSludgeTruckCount =
    sludgeEntries.filter(
      item => {
        return (
          Number.isFinite(
            item.amount
          ) &&
          item.amount >
            0
        );
      }
    ).length;


  const calculatedSludgeTotal =
    roundDailyDataNumber(
      sludgeEntries.reduce(
        (
          sum,
          item
        ) => {
          return sum +
            (
              Number.isFinite(
                item.amount
              )
                ? item.amount
                : 0
            );
        },
        0
      )
    );


  const capturedSludgeTruckCount =
    (
      capturedResult.sludgeTruckCount ===
        null ||
      capturedResult.sludgeTruckCount ===
        undefined ||
      normalizeOisAgentText(
        capturedResult.sludgeTruckCount
      ) ===
        ""
    )
      ? null
      : Number(
          capturedResult.sludgeTruckCount
        );


  const capturedSludgeTotal =
    (
      capturedResult.sludgeTotal ===
        null ||
      capturedResult.sludgeTotal ===
        undefined ||
      normalizeOisAgentText(
        capturedResult.sludgeTotal
      ) ===
        ""
    )
      ? null
      : Number(
          capturedResult.sludgeTotal
        );


  if (
    hasOrganicReceiptData &&
    (
      !Number.isFinite(
        capturedSludgeTruckCount
      ) ||
      capturedSludgeTruckCount !==
        calculatedSludgeTruckCount ||
      !Number.isFinite(
        capturedSludgeTotal
      ) ||
      Math.abs(
        capturedSludgeTotal -
        calculatedSludgeTotal
      ) >
        0.001
    )
  ) {
    throw new Error(
      "Organic receipt count/total does not match detail rows."
    );
  }


  const sludgeTruckCount =
    hasOrganicReceiptData
      ? calculatedSludgeTruckCount
      : null;


  const sludgeTotal =
    hasOrganicReceiptData
      ? calculatedSludgeTotal
      : null;


'@

  $AgentText =
    Replace-Range `
      -Text $AgentText `
      -Start $ReceiptValidationStart `
      -End $ResultObjectStart `
      -Replacement $OptionalReceiptValidation

  $OldAgentReceiptResult =
    Convert-NewLine `
      -NewLine $AgentNl `
      -Text @'
    sludgeTruckCount:
      calculatedSludgeTruckCount,

    sludgeTotal:
      calculatedSludgeTotal,
'@

  $NewAgentReceiptResult =
    Convert-NewLine `
      -NewLine $AgentNl `
      -Text @'
    sludgeTruckCount,

    sludgeTotal,
'@

  Require-Contains `
    -Text $AgentText `
    -Needle $OldAgentReceiptResult `
    -Label 'Agent result sludge count/total'

  $AgentText =
    $AgentText.Replace(
      $OldAgentReceiptResult,
      $NewAgentReceiptResult
    )

  # =========================================================
  # Frontend / normalizeSteamStatusResult
  # =========================================================

  $NormalizeScope =
    $ScriptText.IndexOf(
      'function normalizeSteamStatusResult('
    )

  if ($NormalizeScope -lt 0) {
    throw 'normalizeSteamStatusResult not found.'
  }

  $FrontendOptionalStart =
    $ScriptText.IndexOf(
      '    const sludgeTruckCount =',
      $NormalizeScope
    )

  $FrontendOptionalEnd =
    $ScriptText.IndexOf(
      '    const sourceDate =',
      $FrontendOptionalStart
    )

  if (
    $FrontendOptionalStart -lt 0 -or
    $FrontendOptionalEnd -lt 0
  ) {
    throw 'Frontend optional field declaration range not found.'
  }

  $FrontendOptionalDeclarations =
    Convert-NewLine `
      -NewLine $ScriptNl `
      -Text @'
    /* [PHASE2.7B ORGANIC OPTIONAL V2] */
    let sludgeTruckCount =
      normalizeNumber(
        rawResult.sludgeTruckCount
      );


    let sludgeTotal =
      normalizeNumber(
        rawResult.sludgeTotal
      );


    const organicDaySilo =
      normalizeNumber(
        rawResult.organicDaySilo ??
          rawResult.organicDaySiloLevel
      );


    const organicStorageSiloA =
      normalizeNumber(
        rawResult.organicStorageSiloA ??
          rawResult.organicStorageSiloALevel
      );


    const organicStorageSiloB =
      normalizeNumber(
        rawResult.organicStorageSiloB ??
          rawResult.organicStorageSiloBLevel
      );


    let organicSiloTotal =
      normalizeNumber(
        rawResult.organicSiloTotal
      );


'@

  $ScriptText =
    Replace-Range `
      -Text $ScriptText `
      -Start $FrontendOptionalStart `
      -End $FrontendOptionalEnd `
      -Replacement $FrontendOptionalDeclarations

  # Replace only sludge/organic validations before the return object.
  $FrontendValidationStart =
    $ScriptText.IndexOf(
      '    const calculatedSludgeTruckCount =',
      $NormalizeScope
    )

  $FrontendReturnStart =
    $ScriptText.IndexOf(
      '    return {',
      $FrontendValidationStart
    )

  if (
    $FrontendValidationStart -lt 0 -or
    $FrontendReturnStart -lt 0
  ) {
    throw 'Frontend sludge/organic validation range not found.'
  }

  $FrontendOptionalValidation =
    Convert-NewLine `
      -NewLine $ScriptNl `
      -Text @'
    const hasOrganicReceiptData =
      sludgeEntries.some(
        item => {
          return Number.isFinite(
            item.amount
          );
        }
      );


    if (
      hasOrganicReceiptData
    ) {
      sludgeTruckCount =
        sludgeEntries.filter(
          item => {
            return (
              Number.isFinite(
                item.amount
              ) &&
              item.amount >
                0
            );
          }
        ).length;


      sludgeTotal =
        roundNumber(
          sludgeEntries.reduce(
            (
              sum,
              item
            ) => {
              return sum +
                (
                  Number.isFinite(
                    item.amount
                  )
                    ? item.amount
                    : 0
                );
            },
            0
          )
        );

    } else {
      sludgeTruckCount =
        null;

      sludgeTotal =
        null;
    }


    const hasCompleteOrganicSiloValues =
      [
        organicDaySilo,
        organicStorageSiloA,
        organicStorageSiloB
      ].every(
        value => {
          return Number.isFinite(
            value
          );
        }
      );


    if (
      hasCompleteOrganicSiloValues
    ) {
      organicSiloTotal =
        roundNumber(
          organicDaySilo +
          organicStorageSiloA +
          organicStorageSiloB,
          6
        );

    } else {
      organicSiloTotal =
        null;
    }


'@

  $ScriptText =
    Replace-Range `
      -Text $ScriptText `
      -Start $FrontendValidationStart `
      -End $FrontendReturnStart `
      -Replacement $FrontendOptionalValidation

  # =========================================================
  # Frontend / completion criteria
  # Organic fuel is optional; core power/solar/steam stays strict.
  # =========================================================

  $CompleteScope =
    $ScriptText.IndexOf(
      'function isCompleteDailyDataResult('
    )

  if ($CompleteScope -lt 0) {
    throw 'isCompleteDailyDataResult not found.'
  }

  $OptionalRequiredStart =
    $ScriptText.IndexOf(
      '      result.sludgeTruckCount,',
      $CompleteScope
    )

  $RequiredArrayEnd =
    $ScriptText.IndexOf(
      '    ].every(',
      $OptionalRequiredStart
    )

  if (
    $OptionalRequiredStart -lt 0 -or
    $RequiredArrayEnd -lt 0
  ) {
    throw 'Organic required completion fields not found.'
  }

  $ScriptText =
    Replace-Range `
      -Text $ScriptText `
      -Start $OptionalRequiredStart `
      -End $RequiredArrayEnd `
      -Replacement ''

  # =========================================================
  # Frontend / truck count renderer
  # Use exact ternary fragment; do not scan JavaScript braces.
  # =========================================================

  $OldTruckTernary =
    Convert-NewLine `
      -NewLine $ScriptNl `
      -Text @'
        hideValues
          ? "-"
          : `${sludgeTruckCount.toLocaleString(
'@

  $NewTruckTernary =
    Convert-NewLine `
      -NewLine $ScriptNl `
      -Text @'
        hideValues ||
        sludgeTruckCount ===
          null
          ? "-"
          : `${sludgeTruckCount.toLocaleString(
'@

  $TruckMatches =
    ([regex]::Matches(
      $ScriptText,
      [regex]::Escape(
        $OldTruckTernary
      )
    )).Count

  if ($TruckMatches -ne 1) {
    throw "Expected exactly one truck-count render fragment, found: $TruckMatches"
  }

  $ScriptText =
    $ScriptText.Replace(
      $OldTruckTernary,
      $NewTruckTernary
    )

  # =========================================================
  # Save + verify
  # =========================================================

  [IO.File]::WriteAllText(
    $Agent,
    $AgentText,
    (New-Object Text.UTF8Encoding($false))
  )

  [IO.File]::WriteAllText(
    $Script,
    $ScriptText,
    (New-Object Text.UTF8Encoding($false))
  )

  Write-Host ''
  Write-Host '===== Node syntax check ====='

  & $Node --check $Agent
  if ($LASTEXITCODE -ne 0) {
    throw 'Agent Node syntax check failed.'
  }

  & $Node --check $Script
  if ($LASTEXITCODE -ne 0) {
    throw 'script.js Node syntax check failed.'
  }

  Write-Host ''
  Write-Host '===== git diff --check ====='

  git diff --check -- `
    local-tools/ois-agent/ois-login.js `
    script.js

  if ($LASTEXITCODE -ne 0) {
    throw 'git diff --check failed.'
  }

  $FinalAgent =
    [IO.File]::ReadAllText($Agent)

  $FinalScript =
    [IO.File]::ReadAllText($Script)

  Write-Host ''
  Write-Host '===== Verification ====='

  Write-Host (
    'Agent optional marker: ' +
    $FinalAgent.Contains(
      '[PHASE2.7B ORGANIC OPTIONAL V2]'
    )
  )

  Write-Host (
    'Frontend optional marker: ' +
    $FinalScript.Contains(
      '[PHASE2.7B ORGANIC OPTIONAL V2]'
    )
  )

  Write-Host (
    'Limestone direct kept: ' +
    $FinalAgent.Contains(
      '[PHASE2.5 DIRECT V5] Limestone API complete'
    )
  )

  Write-Host (
    'Gear direct kept: ' +
    $FinalAgent.Contains(
      '[PHASE2.5 DIRECT V5] Gear/Pinion API complete'
    )
  )

  Write-Host (
    'Warmup kept: ' +
    $FinalAgent.Contains(
      '[PHASE2.6 WARMUP]'
    )
  )

  Write-Host (
    'Water-Excel gate kept: ' +
    $FinalAgent.Contains(
      '[PHASE2.7A WATER-EXCEL GATE]'
    )
  )

  $CompleteStart =
    $FinalScript.IndexOf(
      'function isCompleteDailyDataResult('
    )

  $CompleteEnd =
    $FinalScript.IndexOf(
      '  /*',
      $CompleteStart + 20
    )

  if ($CompleteEnd -lt 0) {
    $CompleteEnd =
      [Math]::Min(
        $FinalScript.Length,
        $CompleteStart + 5000
      )
  }

  $CompleteText =
    $FinalScript.Substring(
      $CompleteStart,
      $CompleteEnd - $CompleteStart
    )

  $OrganicOptionalInCompletion =
    (
      -not $CompleteText.Contains(
        'result.sludgeTruckCount'
      )
    ) -and
    (
      -not $CompleteText.Contains(
        'result.organicDaySilo'
      )
    )

  Write-Host (
    'Organic fuel removed from required completion: ' +
    $OrganicOptionalInCompletion
  )

  Write-Host ''
  Write-Host '===== Changed files ====='

  git status --short -- `
    local-tools/ois-agent/ois-login.js `
    script.js

  Write-Host ''
  Write-Host '===== Diff summary ====='

  git diff --stat -- `
    local-tools/ois-agent/ois-login.js `
    script.js

  Write-Host ''
  Write-Host '===== Phase 2.7B v2 patch complete ====='
  Write-Host "No organic data => null => UI '-'."
  Write-Host 'Available power/solar/steam data remains usable.'
  Write-Host 'Agent has NOT been restarted.'
  Write-Host 'Nothing has been staged or committed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring both files ====='

  Copy-Item `
    -LiteralPath $AgentBackup `
    -Destination $Agent `
    -Force

  Copy-Item `
    -LiteralPath $ScriptBackup `
    -Destination $Script `
    -Force

  Write-Host 'Restore complete.'

  throw
}
