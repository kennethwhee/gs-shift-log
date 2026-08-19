param(
  [string]$Repo = 'C:\Users\GSENR\Desktop\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

$Agent = Join-Path $Repo 'local-tools\ois-agent\ois-login.js'
$Stable = Join-Path $Repo 'local-tools\ois-agent\ois-login.js.before-phase25-trace-20260819-104446.bak'
$Node = 'C:\Program Files\nodejs\node.exe'

foreach ($p in @($Agent,$Stable,$Node)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "필수 파일 없음: $p" }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$currentBackup = "$Agent.before-phase25-direct-$stamp.bak"
Copy-Item -LiteralPath $Agent -Destination $currentBackup -Force
Copy-Item -LiteralPath $Stable -Destination $Agent -Force

$text = [IO.File]::ReadAllText($Agent)
if ($text.Contains('[PHASE2.5 DIRECT]')) { throw '이미 Phase 2.5 DIRECT가 적용되어 있습니다.' }
$nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }

function NL([string]$s) {
  $s = $s.Replace("`r`n","`n").Replace("`r","`n")
  return $s.Replace("`n",$nl)
}

function Find-FunctionRange([string]$src,[string]$needle) {
  $start = $src.IndexOf($needle)
  if ($start -lt 0) { throw "함수 시작점 없음: $needle" }
  $brace = $src.IndexOf('{',$start)
  if ($brace -lt 0) { throw "함수 여는 괄호 없음: $needle" }
  $depth = 0; $single=$false; $double=$false; $template=$false; $escape=$false
  for ($i=$brace; $i -lt $src.Length; $i++) {
    $c = $src[$i]
    if ($escape) { $escape=$false; continue }
    if ($single -or $double -or $template) {
      if ($c -eq '\') { $escape=$true; continue }
      if ($single -and $c -eq "'") { $single=$false; continue }
      if ($double -and $c -eq '"') { $double=$false; continue }
      if ($template -and $c -eq '`') { $template=$false; continue }
      continue
    }
    if ($c -eq "'") { $single=$true; continue }
    if ($c -eq '"') { $double=$true; continue }
    if ($c -eq '`') { $template=$true; continue }
    if ($c -eq '{') { $depth++; continue }
    if ($c -eq '}') {
      $depth--
      if ($depth -eq 0) { return [PSCustomObject]@{Start=$start;End=$i+1} }
    }
  }
  throw "함수 끝 없음: $needle"
}

function Insert-After-Login([string]$src,[string]$functionNeedle,[string]$code) {
  $r = Find-FunctionRange $src $functionNeedle
  $block = $src.Substring($r.Start,$r.End-$r.Start)
  $p = $block.IndexOf('await ensureOisAgentLoggedIn(')
  if ($p -lt 0) { throw "로그인 호출 없음: $functionNeedle" }
  $e = $block.IndexOf(');',$p)
  if ($e -lt 0) { throw "로그인 호출 끝 없음: $functionNeedle" }
  return $src.Insert($r.Start+$e+2,(NL $code))
}

try {
  $helperRange = Find-FunctionRange $text 'async function requestOisInternalAjaxData('

  $helpers = @'

/* =========================================================
  [PHASE2.5 DIRECT]
  석회석 / Gear·Pinion / Silo Level 화면 이동 제거.
  직접 API 실패 시 기존 UI 조회로 자동 fallback.
========================================================= */
const OIS_PHASE25_LOG_SHEET_COMMAND =
  "oi.LogSheetService.listLogSheetSearch";

const OIS_PHASE25_LOG_SHEET_COMMON_SELECT = {
  schepow_stat_code: "8000",
  dept_code: "5030",
  outtime: "1",
  rowstatus: "C"
};

function getOisPhase25Rows(responseData) {
  return Array.isArray(responseData?.result)
    ? responseData.result
    : [];
}

function findOisPhase25RowByTag(rows, targetTag) {
  const wanted = normalizeOisAgentText(targetTag).toUpperCase();
  return rows.find(row =>
    normalizeOisAgentText(
      row?.tag_no || row?.tag || row?.tagno
    ).toUpperCase() === wanted
  ) || null;
}

async function requestOisPhase25UppercaseAjaxData(page, command, selectItem) {
  const raw = await page.evaluate(async ({command,selectItem}) => {
    const p = new URLSearchParams();
    p.set("TOSSDATA", JSON.stringify({SELECT:[selectItem]}));
    p.set("CMD", command);
    const response = await fetch("/ajax/data", {
      method: "POST",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      credentials: "same-origin",
      cache: "no-store",
      body: p.toString()
    });
    return {ok:response.ok,status:response.status,text:await response.text()};
  }, {command,selectItem});

  if (!raw?.ok) {
    throw new Error(`OIS 직접 TAG LOG API 실패 (HTTP ${raw?.status || 0})`);
  }
  const t = String(raw.text || "").trim();
  if (!t) return {};
  try { return JSON.parse(t); }
  catch { throw new Error("OIS 직접 TAG LOG API 응답이 JSON이 아닙니다."); }
}

async function collectOisPhase25LimestoneStocksDirect(page, targetDate) {
  const d = targetDate.replace(/-/g, "");
  const results = await Promise.all(
    OIS_UNIT_DEFINITIONS.map(async def => {
      const sheetCode = def.unit === 1 ? "112" : "113";
      const data = await requestOisInternalAjaxData(
        page,
        OIS_PHASE25_LOG_SHEET_COMMAND,
        {...OIS_PHASE25_LOG_SHEET_COMMON_SELECT, sheet_code:sheetCode, schbase_date:d}
      );
      const row = findOisPhase25RowByTag(getOisPhase25Rows(data), def.tag);
      if (!row) throw new Error(`석회석 ${def.unit}호기 TAG 없음: ${def.tag}`);
      const startStock = parseOisAgentNumber(row.decimal_pnt);
      const endStock = parseOisAgentNumber(row.hd_24);
      if (startStock === null || endStock === null) {
        throw new Error(`석회석 ${def.unit}호기 직접 API 재고값 오류`);
      }
      return {unit:def.unit,tag:normalizeOisAgentText(row.tag_no)||def.tag,startStock,endStock};
    })
  );

  const u1 = results.find(v => v.unit === 1);
  const u2 = results.find(v => v.unit === 2);
  if (!u1 || !u2) throw new Error("석회석 직접 API 1·2호기 결과 누락");

  return {
    targetDate,
    nextDate:addOisAgentDateDays(targetDate,1),
    unitOne:{tag:u1.tag,startStock:u1.startStock,endStock:u1.endStock},
    unitTwo:{tag:u2.tag,startStock:u2.startStock,endStock:u2.endStock},
    collectedAt:new Date().toISOString()
  };
}

async function collectOisPhase25GearPinionDirect(page, targetDate) {
  const d = targetDate.replace(/-/g, "");
  const data = await requestOisInternalAjaxData(
    page,
    OIS_PHASE25_LOG_SHEET_COMMAND,
    {...OIS_PHASE25_LOG_SHEET_COMMON_SELECT, sheet_code:"111", schbase_date:d}
  );
  const rows = getOisPhase25Rows(data);
  const gd = OIS_TURBINE_GEAR_PINION_DEFINITION.gearWheel;
  const pd = OIS_TURBINE_GEAR_PINION_DEFINITION.pinion;
  const gr = findOisPhase25RowByTag(rows, gd.tag);
  const pr = findOisPhase25RowByTag(rows, pd.tag);
  if (!gr || !pr) throw new Error("Gear/Pinion TAG 직접 API 응답 누락");
  const valueField = OIS_TURBINE_GEAR_PINION_DEFINITION.valueField || "decimal_pnt";
  const gearWheel = parseOisAgentNumber(gr[valueField]);
  const pinion = parseOisAgentNumber(pr[valueField]);
  if (gearWheel === null || pinion === null) throw new Error("Gear/Pinion 직접 API 값 오류");

  return {
    source:"OIS BOARD LOGSHEET (TGO)",
    targetDate,
    sourceDate:targetDate,
    sheetLabel:OIS_TURBINE_GEAR_PINION_DEFINITION.sheetLabel,
    valueColumn:"전일",
    valueField,
    gearWheel,
    pinion,
    gearWheelTag:normalizeOisAgentText(gr.tag_no)||gd.tag,
    pinionTag:normalizeOisAgentText(pr.tag_no)||pd.tag,
    gearWheelItemName:normalizeOisAgentText(gr.mid_name),
    pinionItemName:normalizeOisAgentText(pr.mid_name),
    gearWheelUnit:normalizeOisAgentText(gr.unit_code),
    pinionUnit:normalizeOisAgentText(pr.unit_code),
    collectedAt:new Date().toISOString()
  };
}

async function collectOisPhase25SiloLevelDirect(page, targetDate) {
  const d = targetDate.replace(/-/g, "");
  const entries = await Promise.all(
    OIS_SILO_LEVEL_DEFINITIONS.map(async def => {
      await requestOisPhase25UppercaseAjaxData(
        page,
        "OI.ETCINFOSERVICE.CHKTAGNO",
        {EPOW_STAT_CODE:"8000",TAG_NO:def.tag}
      );
      const data = await requestOisPhase25UppercaseAjaxData(
        page,
        "OI.LOGSHEETSERVICE.LISTTAGLOG",
        {
          SCHEPOW_STAT_CODE:"8000",
          OUTTIME:"1",
          TAG_NO:def.tag,
          STARTDATE:d,
          ENDDATE:d,
          ROWSTATUS:"C"
        }
      );
      const rows = getOisPhase25Rows(data);
      const row = findOisPhase25RowByTag(rows, def.tag) || rows[0] || null;
      if (!row) throw new Error(`Silo TAG 직접 API 응답 누락: ${def.tag}`);

      const candidates = [
        ["hd_24",row?.hd_24],
        ["h_24",row?.h_24],
        ["hour_24",row?.hour_24],
        ["hour24",row?.hour24],
        ["value_24",row?.value_24],
        ["value24",row?.value24],
        ["24",row?.["24"]]
      ];
      let value = null;
      let valueField = "";
      for (const [field,raw] of candidates) {
        const n = parseOisAgentNumber(raw);
        if (n === null) continue;
        value = n; valueField = field; break;
      }
      if (value === null) throw new Error(`Silo ${def.tag} 24시 값 없음`);

      return {
        resultKey:def.resultKey,
        value,
        valueField,
        tag:normalizeOisAgentText(row?.tag_no||row?.tag||def.tag)||def.tag,
        itemName:normalizeOisAgentText(row?.tag_name||row?.tag_name_kor||row?.mid_name||""),
        unit:normalizeOisAgentText(row?.unit_code||row?.unit||"")
      };
    })
  );

  const values = {};
  entries.forEach(v => { values[v.resultKey] = v; });
  if (!values.flyAsh || !values.bioStorage) throw new Error("Silo 직접 API 결과 누락");

  return {
    source:"OIS TAG별 LOG 조회",
    targetDate,
    valueColumn:"24시",
    flyAshSiloLevel:values.flyAsh.value,
    bioStorageSiloLevel:values.bioStorage.value,
    flyAshTag:values.flyAsh.tag,
    bioStorageTag:values.bioStorage.tag,
    flyAshItemName:values.flyAsh.itemName,
    bioStorageItemName:values.bioStorage.itemName,
    flyAshUnit:values.flyAsh.unit,
    bioStorageUnit:values.bioStorage.unit,
    flyAshValueField:values.flyAsh.valueField,
    bioStorageValueField:values.bioStorage.valueField,
    collectedAt:new Date().toISOString()
  };
}

'@

  $text = $text.Insert($helperRange.End,(NL $helpers))

  $siloCode = @'

  const phase25StartedAt = Date.now();
  try {
    const directResult = await collectOisPhase25SiloLevelDirect(page,targetDate);
    console.log(`[PHASE2.5 DIRECT] Silo Level 직접 API 완료 ${((Date.now()-phase25StartedAt)/1000).toFixed(2)}초`);
    return directResult;
  } catch (directError) {
    console.warn("[PHASE2.5 DIRECT] Silo Level 직접 API 실패. 기존 UI fallback:", directError instanceof Error ? directError.message : directError);
  }
'@

  $gearCode = @'

  const phase25StartedAt = Date.now();
  try {
    const directResult = await collectOisPhase25GearPinionDirect(page,targetDate);
    console.log(`[PHASE2.5 DIRECT] Gear Wheel / Pinion 직접 API 완료 ${((Date.now()-phase25StartedAt)/1000).toFixed(2)}초`);
    return directResult;
  } catch (directError) {
    console.warn("[PHASE2.5 DIRECT] Gear Wheel / Pinion 직접 API 실패. 기존 UI fallback:", directError instanceof Error ? directError.message : directError);
  }
'@

  $limeCode = @'

  const phase25StartedAt = Date.now();
  try {
    const directResult = await collectOisPhase25LimestoneStocksDirect(page,targetDate);
    console.log(`[PHASE2.5 DIRECT] 석회석 직접 API 완료 ${((Date.now()-phase25StartedAt)/1000).toFixed(2)}초`);
    return directResult;
  } catch (directError) {
    console.warn("[PHASE2.5 DIRECT] 석회석 직접 API 실패. 기존 UI fallback:", directError instanceof Error ? directError.message : directError);
  }
'@

  $text = Insert-After-Login $text 'async function collectOisSiloLevelValues(' $siloCode
  $text = Insert-After-Login $text 'async function collectOisTurbineGearPinionValues(' $gearCode
  $text = Insert-After-Login $text 'async function collectOisLimestoneStocks(' $limeCode

  [IO.File]::WriteAllText($Agent,$text,(New-Object Text.UTF8Encoding($false)))

  Write-Host ''
  Write-Host '===== TRACE 제거 확인 ====='
  $trace = @(Select-String -LiteralPath $Agent -SimpleMatch -Pattern '[PHASE2.5 TRACE]' -ErrorAction SilentlyContinue)
  Write-Host "TRACE 마커 수: $($trace.Count)"

  Write-Host ''
  Write-Host '===== Node 문법 검사 ====='
  & $Node --check $Agent
  if ($LASTEXITCODE -ne 0) { throw 'Node 문법 검사 실패' }

  Write-Host ''
  Write-Host '===== whitespace 검사 ====='
  git diff --check -- local-tools/ois-agent/ois-login.js
  if ($LASTEXITCODE -ne 0) { throw 'git diff --check 실패' }

  Write-Host ''
  Write-Host '===== Phase 2.5 DIRECT 마커 ====='
  Select-String -LiteralPath $Agent -SimpleMatch -Pattern '[PHASE2.5 DIRECT]','collectOisPhase25LimestoneStocksDirect','collectOisPhase25GearPinionDirect','collectOisPhase25SiloLevelDirect','OI.LOGSHEETSERVICE.LISTTAGLOG' |
    Select-Object LineNumber,Line | Format-Table -AutoSize

  Write-Host ''
  Write-Host '===== 변경 요약 ====='
  git diff --stat -- local-tools/ois-agent/ois-login.js

  Write-Host ''
  Write-Host '===== Phase 2.5 직접 API 패치 완료 ====='
  Write-Host '아직 Agent 재시작 / git add / commit 하지 않았습니다.'
  Write-Host '직접 API 실패 시 기존 UI로 자동 fallback합니다.'
  Write-Host "현재 TRACE 버전 백업: $currentBackup"
}
catch {
  Write-Host ''
  Write-Host '===== 패치 실패 - 자동 복원 ====='
  Copy-Item -LiteralPath $currentBackup -Destination $Agent -Force
  Write-Host 'TRACE 버전으로 복원했습니다.'
  throw
}
