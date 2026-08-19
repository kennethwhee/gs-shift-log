param([string]$Repo='C:\Users\GSENR\Desktop\gs-shift-log')
$ErrorActionPreference='Stop'
Set-Location $Repo

$Agent=Join-Path $Repo 'local-tools\ois-agent\ois-login.js'
$Script=Join-Path $Repo 'script.js'
$Node='C:\Program Files\nodejs\node.exe'

foreach($x in @($Agent,$Script,$Node)){
  if(-not (Test-Path -LiteralPath $x)){ throw "Required file not found: $x" }
}

function Get-NL([string]$t){
  if($t.Contains("`r`n")){ return "`r`n" }
  return "`n"
}
function Use-NL([string]$t,[string]$n){
  return $t.Replace("`r`n","`n").Replace("`r","`n").Replace("`n",$n)
}
function Replace-Range([string]$t,[int]$s,[int]$e,[string]$r){
  if($s -lt 0 -or $e -lt $s -or $e -gt $t.Length){
    throw "Invalid replacement range: $s..$e"
  }
  return $t.Substring(0,$s)+$r+$t.Substring($e)
}

Write-Host '===== Phase 2.7B optional organic fuel data ====='

$a=[IO.File]::ReadAllText($Agent)
$s=[IO.File]::ReadAllText($Script)

if($a.Contains('[PHASE2.7B ORGANIC OPTIONAL]') -or $s.Contains('[PHASE2.7B ORGANIC OPTIONAL]')){
  throw 'Phase 2.7B is already applied.'
}

$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$ab="$Agent.before-phase27b-$stamp.bak"
$sb="$Script.before-phase27b-$stamp.bak"
Copy-Item -LiteralPath $Agent -Destination $ab -Force
Copy-Item -LiteralPath $Script -Destination $sb -Force
Write-Host "Agent backup : $ab"
Write-Host "Script backup: $sb"

$an=Get-NL $a
$sn=Get-NL $s

try {
  # ---------------------------------------------------------
  # 1. PowerShell: blank organic receipt rows => null, not 0.
  # ---------------------------------------------------------
  $plantOrganicAnchor=$a.IndexOf('  $plantOrganicValues =')
  if($plantOrganicAnchor -lt 0){ throw 'PowerShell plant organic anchor not found.' }

  $receiptOptional=Use-NL @'
  # [PHASE2.7B ORGANIC OPTIONAL]
  # If all organic receipt detail cells are blank, the source has no data.
  # Preserve that as null so the UI can show "-".
  $hasOrganicReceiptData =
    $false

  foreach (
    $sludgeEntry in
      $sludgeEntries
  ) {
    if (
      $null -ne
        $sludgeEntry.amount
    ) {
      $hasOrganicReceiptData =
        $true

      break
    }
  }

  if (
    -not
      $hasOrganicReceiptData
  ) {
    $sludgeTruckCount =
      $null

    $sludgeTotal =
      $null
  }


'@ $an

  $a=$a.Insert($plantOrganicAnchor,$receiptOptional)

  # ---------------------------------------------------------
  # 2. PowerShell: Silo validation is optional as one group.
  # Any missing/mismatch only clears the organic Silo group.
  # ---------------------------------------------------------
  $p0=$a.IndexOf('  $plantOrganicValues =')
  $p1=$a.IndexOf('  $unitOneProduction =',$p0)
  if($p0 -lt 0 -or $p1 -lt 0){ throw 'PowerShell organic Silo block not found.' }

  $oldOrganic=$a.Substring($p0,$p1-$p0)

  $pre=Use-NL @'
  # [PHASE2.7B ORGANIC OPTIONAL]
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
'@ $an

  $post=Use-NL @'
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

    Write-DailyDataStage -Message (
      "Organic Silo data unavailable; missing values will be shown as '-'."
    )

    Write-Warning (
      "Organic Silo optional data skipped: " +
      $_.Exception.Message
    )
  }


'@ $an

  $a=Replace-Range $a $p0 $p1 ($pre+$an+$oldOrganic+$post)

  # [double]$null becomes 0 in PowerShell. Remove those casts.
  foreach($k in @('organicDaySilo','organicStorageSiloA','organicStorageSiloB')){
    $old='[double]$organicValues.'+$k
    $new='$organicValues.'+$k
    $cnt=([regex]::Matches($a,[regex]::Escape($old))).Count
    if($cnt -lt 2){ throw "Expected PowerShell organic cast not found: $old" }
    $a=$a.Replace($old,$new)
  }

  # ---------------------------------------------------------
  # 3. Agent JS: organic Silo parser accepts null.
  # ---------------------------------------------------------
  $parserScope=$a.IndexOf('  const solarDailyGeneration =')
  $q0=$a.IndexOf('  const organicDaySilo =',$parserScope)
  $q1=$a.IndexOf('  const sludgeEntries =',$q0)
  if($q0 -lt 0 -or $q1 -lt 0){ throw 'Agent organic parser block not found.' }

  $optionalParser=Use-NL @'
  const parseOptionalOrganicNumber =
    (value, fractionDigits = 6) => {
      if (
        value === null ||
        value === undefined ||
        normalizeOisAgentText(value) === ""
      ) {
        return null;
      }

      try {
        return roundDailyDataNumber(
          parseDailyDataWorkbookNumber(
            value,
            "optional organic value"
          ),
          fractionDigits
        );
      } catch (error) {
        console.warn(
          "[PHASE2.7B ORGANIC OPTIONAL] invalid organic value -> null:",
          error instanceof Error
            ? error.message
            : error
        );
        return null;
      }
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


  const capturedOrganicSiloTotal =
    parseOptionalOrganicNumber(
      capturedResult.organicSiloTotal
    );


  const hasCompleteOrganicSiloValues =
    [
      organicDaySilo,
      organicStorageSiloA,
      organicStorageSiloB
    ].every(
      value => Number.isFinite(value)
    );


  const organicSiloTotal =
    hasCompleteOrganicSiloValues
      ? (
          capturedOrganicSiloTotal ??
          roundDailyDataNumber(
            organicDaySilo +
            organicStorageSiloA +
            organicStorageSiloB,
            6
          )
        )
      : null;


'@ $an

  $a=Replace-Range $a $q0 $q1 $optionalParser

  # ---------------------------------------------------------
  # 4. Agent JS: organic receipt summary is optional.
  # Blank detail rows => null count/total. Explicit numeric 0 stays 0.
  # ---------------------------------------------------------
  $j0=$a.IndexOf('  const calculatedSludgeTruckCount =',$q0)
  $j1=$a.IndexOf('  const result = {',$j0)
  if($j0 -lt 0 -or $j1 -lt 0){ throw 'Agent receipt validation block not found.' }

  $receiptParser=Use-NL @'
  const hasOrganicReceiptData =
    sludgeEntries.some(
      item => Number.isFinite(item.amount)
    );


  let sludgeTruckCount =
    null;


  let sludgeTotal =
    null;


  if (
    hasOrganicReceiptData
  ) {
    const calculatedSludgeTruckCount =
      sludgeEntries.filter(
        item => {
          return (
            Number.isFinite(item.amount) &&
            item.amount > 0
          );
        }
      ).length;


    const calculatedSludgeTotal =
      roundDailyDataNumber(
        sludgeEntries.reduce(
          (sum, item) => {
            return sum +
              (
                Number.isFinite(item.amount)
                  ? item.amount
                  : 0
              );
          },
          0
        )
      );


    const capturedTruckRaw =
      capturedResult.sludgeTruckCount;


    const capturedTotalRaw =
      capturedResult.sludgeTotal;


    const capturedTruck =
      (
        capturedTruckRaw === null ||
        capturedTruckRaw === undefined ||
        normalizeOisAgentText(capturedTruckRaw) === ""
      )
        ? null
        : Number(capturedTruckRaw);


    const capturedTotal =
      (
        capturedTotalRaw === null ||
        capturedTotalRaw === undefined ||
        normalizeOisAgentText(capturedTotalRaw) === ""
      )
        ? null
        : Number(capturedTotalRaw);


    if (
      (
        Number.isFinite(capturedTruck) &&
        capturedTruck !== calculatedSludgeTruckCount
      ) ||
      (
        Number.isFinite(capturedTotal) &&
        Math.abs(
          capturedTotal -
          calculatedSludgeTotal
        ) > 0.001
      )
    ) {
      console.warn(
        "[PHASE2.7B ORGANIC OPTIONAL] receipt summary mismatch; detail rows are used."
      );
    }


    sludgeTruckCount =
      calculatedSludgeTruckCount;


    sludgeTotal =
      calculatedSludgeTotal;
  }


'@ $an

  $a=Replace-Range $a $j0 $j1 $receiptParser

  # ---------------------------------------------------------
  # 5. Frontend normalizer:
  # organic receipt and Silo values are optional.
  # ---------------------------------------------------------
  $f=$s.IndexOf('function normalizeSteamStatusResult(')
  if($f -lt 0){ throw 'normalizeSteamStatusResult not found.' }

  $d0=$s.IndexOf('    const sludgeTruckCount =',$f)
  $d1=$s.IndexOf('    const sourceDate =',$d0)
  if($d0 -lt 0 -or $d1 -lt 0){ throw 'Frontend optional field declarations not found.' }

  $frontDecl=Use-NL @'
    /* [PHASE2.7B ORGANIC OPTIONAL] */
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


'@ $sn

  $s=Replace-Range $s $d0 $d1 $frontDecl

  # Replace receipt + organic optional validation before return.
  $x0=$s.IndexOf('    const calculatedSludgeTruckCount =',$f)
  $x1=$s.IndexOf('    return {',$x0)
  if($x0 -lt 0 -or $x1 -lt 0){ throw 'Frontend optional validation block not found.' }

  $frontValidation=Use-NL @'
    const hasOrganicReceiptData =
      sludgeEntries.some(
        item => Number.isFinite(item.amount)
      );


    if (
      hasOrganicReceiptData
    ) {
      const calculatedSludgeTruckCount =
        sludgeEntries.filter(
          item => {
            return (
              Number.isFinite(item.amount) &&
              item.amount > 0
            );
          }
        ).length;


      const calculatedSludgeTotal =
        roundNumber(
          sludgeEntries.reduce(
            (sum, item) => {
              return sum +
                (
                  Number.isFinite(item.amount)
                    ? item.amount
                    : 0
                );
            },
            0
          )
        );


      if (
        (
          sludgeTruckCount !== null &&
          sludgeTruckCount !== calculatedSludgeTruckCount
        ) ||
        (
          sludgeTotal !== null &&
          Math.abs(
            sludgeTotal -
            calculatedSludgeTotal
          ) > 0.001
        )
      ) {
        console.warn(
          "[PHASE2.7B ORGANIC OPTIONAL] receipt summary mismatch; detail rows are used."
        );
      }


      sludgeTruckCount =
        calculatedSludgeTruckCount;


      sludgeTotal =
        calculatedSludgeTotal;

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
        value => Number.isFinite(value)
      );


    if (
      hasCompleteOrganicSiloValues
    ) {
      const calculatedOrganicSiloTotal =
        roundNumber(
          organicDaySilo +
          organicStorageSiloA +
          organicStorageSiloB,
          6
        );


      if (
        organicSiloTotal === null
      ) {
        organicSiloTotal =
          calculatedOrganicSiloTotal;

      } else if (
        Math.abs(
          calculatedOrganicSiloTotal -
          organicSiloTotal
        ) > 0.00001
      ) {
        console.warn(
          "[PHASE2.7B ORGANIC OPTIONAL] organic total mismatch -> '-'"
        );

        organicSiloTotal =
          null;
      }

    } else {
      organicSiloTotal =
        null;
    }


'@ $sn

  $s=Replace-Range $s $x0 $x1 $frontValidation

  # ---------------------------------------------------------
  # 6. Daily DATA completion:
  # keep power/solar/steam core strict; organic fuel is optional.
  # ---------------------------------------------------------
  $c=$s.IndexOf('function isCompleteDailyDataResult(')
  if($c -lt 0){ throw 'isCompleteDailyDataResult not found.' }

  $ca=$s.IndexOf('    return [',$c)
  $co=$s.IndexOf('      result.sludgeTruckCount,',$ca)
  $ce=$s.IndexOf('    ].every(',$ca)
  if($ca -lt 0 -or $co -lt 0 -or $ce -lt 0 -or $co -gt $ce){
    throw 'Optional organic fields in completion rule not found.'
  }

  $s=Replace-Range $s $co $ce ''

  # ---------------------------------------------------------
  # 7. UI: null truck count must render "-" rather than call
  #    toLocaleString on null.
  # ---------------------------------------------------------
  $render=$s.IndexOf('  function renderSteamStatus()')
  if($render -lt 0){ throw 'renderSteamStatus not found.' }

  $t0=$s.IndexOf('    if ('+$sn+'      elements.sludgeTruckCount',$render)
  if($t0 -lt 0){
    $t0=$s.IndexOf('    if ('+"`n"+'      elements.sludgeTruckCount',$render)
  }
  if($t0 -lt 0){ throw 'sludgeTruckCount render block start not found.' }

  $organicComment=$s.IndexOf('      유기성 사일로',$t0)
  if($organicComment -lt 0){ throw 'Organic render section marker not found.' }

  $commentStart=$s.LastIndexOf('    /*',$organicComment)
  if($commentStart -lt $t0){ throw 'sludgeTruckCount render block end not found.' }

  $truckBlock=$s.Substring($t0,$commentStart-$t0)

  # Replace only the truck-count assignment inside this block.
  $assignStart=$truckBlock.IndexOf('      elements.sludgeTruckCount.textContent =')
  if($assignStart -lt 0){ throw 'sludgeTruckCount text assignment not found.' }

  $assignEnd=$truckBlock.IndexOf('    }',$assignStart)
  if($assignEnd -lt 0){ throw 'sludgeTruckCount text assignment end not found.' }

  $assignEnd += '    }'.Length

  $newTruck=Use-NL @'
      elements.sludgeTruckCount.textContent =
        hideValues ||
        sludgeTruckCount ===
          null
          ? "-"
          : `${sludgeTruckCount.toLocaleString(
              "ko-KR",
              {
                maximumFractionDigits:
                  0
              }
            )}대`;
    }
'@ $sn

  $truckBlock=Replace-Range $truckBlock $assignStart $assignEnd $newTruck
  $s=Replace-Range $s $t0 $commentStart $truckBlock

  # ---------------------------------------------------------
  # Save and verify
  # ---------------------------------------------------------
  [IO.File]::WriteAllText($Agent,$a,(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($Script,$s,(New-Object Text.UTF8Encoding($false)))

  Write-Host ''
  Write-Host '===== Node syntax check ====='
  & $Node --check $Agent
  if($LASTEXITCODE -ne 0){ throw 'Agent Node syntax check failed.' }
  & $Node --check $Script
  if($LASTEXITCODE -ne 0){ throw 'script.js Node syntax check failed.' }

  Write-Host ''
  Write-Host '===== git diff --check ====='
  git diff --check -- local-tools/ois-agent/ois-login.js script.js
  if($LASTEXITCODE -ne 0){ throw 'git diff --check failed.' }

  $fa=[IO.File]::ReadAllText($Agent)
  $fs=[IO.File]::ReadAllText($Script)

  Write-Host ''
  Write-Host '===== Verification ====='
  Write-Host "Agent optional marker: $($fa.Contains('[PHASE2.7B ORGANIC OPTIONAL]'))"
  Write-Host "Frontend optional marker: $($fs.Contains('[PHASE2.7B ORGANIC OPTIONAL]'))"
  Write-Host "Limestone direct kept: $($fa.Contains('[PHASE2.5 DIRECT V5] Limestone API complete'))"
  Write-Host "Gear direct kept: $($fa.Contains('[PHASE2.5 DIRECT V5] Gear/Pinion API complete'))"
  Write-Host "Warmup kept: $($fa.Contains('[PHASE2.6 WARMUP]'))"
  Write-Host "Water-Excel gate kept: $($fa.Contains('[PHASE2.7A WATER-EXCEL GATE]'))"

  $cf=$fs.IndexOf('function isCompleteDailyDataResult(')
  $cx=$fs.IndexOf('  /*',$cf+10)
  if($cx -lt 0){$cx=[Math]::Min($fs.Length,$cf+5000)}
  $ct=$fs.Substring($cf,$cx-$cf)

  $optionalRemoved=
    (-not $ct.Contains('result.sludgeTruckCount')) -and
    (-not $ct.Contains('result.organicDaySilo'))

  Write-Host "Organic fuel removed from required completion: $optionalRemoved"

  Write-Host ''
  Write-Host '===== Changed files ====='
  git status --short -- local-tools/ois-agent/ois-login.js script.js

  Write-Host ''
  Write-Host '===== Diff summary ====='
  git diff --stat -- local-tools/ois-agent/ois-login.js script.js

  Write-Host ''
  Write-Host '===== Phase 2.7B patch complete ====='
  Write-Host "Missing organic receipt/Silo values => null => UI '-'."
  Write-Host 'Available power/solar/steam values remain usable.'
  Write-Host 'Explicit numeric zero remains 0.'
  Write-Host 'Agent has NOT been restarted.'
  Write-Host 'Nothing has been staged or committed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring both files ====='
  Copy-Item -LiteralPath $ab -Destination $Agent -Force
  Copy-Item -LiteralPath $sb -Destination $Script -Force
  Write-Host 'Restore complete.'
  throw
}
