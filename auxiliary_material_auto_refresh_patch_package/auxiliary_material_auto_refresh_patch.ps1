param(
  [string]$Repo = 'C:\Users\user\Documents\GitHub\gs-shift-log'
)

$ErrorActionPreference = 'Stop'
Set-Location $Repo

$ScriptFile = Join-Path $Repo 'script.js'
$IndexFile  = Join-Path $Repo 'index.html'

foreach ($File in @($ScriptFile, $IndexFile)) {
  if (-not (Test-Path -LiteralPath $File)) {
    throw "Required file not found: $File"
  }
}

function Get-NewLine {
  param([string]$Text)
  if ($Text.Contains("`r`n")) { return "`r`n" }
  return "`n"
}

function Normalize-NewLine {
  param([string]$Text,[string]$NewLine)
  return $Text.Replace("`r`n","`n").Replace("`r","`n").Replace("`n",$NewLine)
}

Write-Host '===== Auxiliary material auto refresh patch ====='
Write-Host ''
Write-Host '===== 1. Current Git state ====='
git status --short

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path "$env:USERPROFILE\Desktop\gs-shift-log-backup" "aux-material-auto-refresh-$Stamp"
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
Copy-Item -LiteralPath $ScriptFile -Destination (Join-Path $BackupDir 'script.js') -Force
Copy-Item -LiteralPath $IndexFile -Destination (Join-Path $BackupDir 'index.html') -Force
Write-Host "Backup: $BackupDir"

$ScriptText = [IO.File]::ReadAllText($ScriptFile)
$IndexText = [IO.File]::ReadAllText($IndexFile)

if ($ScriptText.Contains('[AUXILIARY-MATERIAL-AUTO-REFRESH]')) {
  throw 'Auxiliary material auto refresh patch is already applied.'
}

$Nl = Get-NewLine $ScriptText

try {
  $OldElements = Normalize-NewLine -NewLine $Nl -Text @'
    loadButton:
      document.getElementById(
        "loadAuxiliaryMaterialHistoryButton"
      ),

    queryButton:
'@

  $NewElements = Normalize-NewLine -NewLine $Nl -Text @'
    loadButton:
      document.getElementById(
        "loadAuxiliaryMaterialHistoryButton"
      ),

    refreshButton:
      document.getElementById(
        "refreshAuxiliaryMaterialHistoryButton"
      ),

    queryButton:
'@

  if (-not $ScriptText.Contains($OldElements)) {
    throw 'getAuxiliaryMaterialElements() anchor was not found.'
  }

  $ScriptText = $ScriptText.Replace($OldElements,$NewElements)

  $OldDownloadStart = Normalize-NewLine -NewLine $Nl -Text @'
  /*
    엑셀 다운로드 버튼
  */
  let downloadButton =
'@

  $NewDownloadStart = Normalize-NewLine -NewLine $Nl -Text @'
  /*
    [AUXILIARY-MATERIAL-AUTO-REFRESH]

    저장자료 새로고침:
    - OIS 재조회는 실행하지 않는다.
    - 현재 선택 월/기간의 D1 저장자료만 다시 읽는다.
    - 모바일 모니터링 화면에는 생성하지 않는다.
  */
  let refreshButton =
    document.getElementById(
      "refreshAuxiliaryMaterialHistoryButton"
    );

  if (
    !refreshButton
  ) {
    refreshButton =
      document.createElement(
        "button"
      );

    refreshButton.type =
      "button";

    refreshButton.id =
      "refreshAuxiliaryMaterialHistoryButton";

    refreshButton.className =
      "is-secondary auxiliary-material-refresh-button";

    refreshButton.textContent =
      "새로고침";

    refreshButton.title =
      "현재 선택 월/기간의 저장자료 새로고침";
  }

  if (
    refreshButton.dataset
      .auxiliaryMaterialRefreshBound !==
      "true"
  ) {
    refreshButton.addEventListener(
      "click",
      () => {
        loadAuxiliaryMaterialHistory()
          .catch(
            () => {
              /*
                오류 표시는 조회 함수가 담당한다.
              */
            }
          );
      }
    );

    refreshButton.dataset
      .auxiliaryMaterialRefreshBound =
      "true";
  }

  /*
    엑셀 다운로드 버튼
  */
  let downloadButton =
'@

  if (-not $ScriptText.Contains($OldDownloadStart)) {
    throw 'PC compact refresh-button insertion anchor was not found.'
  }

  $ScriptText = $ScriptText.Replace($OldDownloadStart,$NewDownloadStart)

  $OldActionAppend = Normalize-NewLine -NewLine $Nl -Text @'
  /*
    실제 DOM 순서:
    저장자료 → OIS → 엑셀 등록 → 엑셀 다운로드
    → Slurry 고정값 → 상태 안내
  */
  actionControls.append(
    loadButton,
    queryButton,
    excelButton,
    downloadButton,
    densityPanel
  );
'@

  $NewActionAppend = Normalize-NewLine -NewLine $Nl -Text @'
  /*
    실제 DOM 순서:
    저장자료 → 새로고침 → OIS → 엑셀 등록 → 엑셀 다운로드
    → Slurry 고정값 → 상태 안내
  */
  actionControls.append(
    loadButton,
    refreshButton,
    queryButton,
    excelButton,
    downloadButton,
    densityPanel
  );
'@

  if (-not $ScriptText.Contains($OldActionAppend)) {
    throw 'PC compact actionControls.append() anchor was not found.'
  }

  $ScriptText = $ScriptText.Replace($OldActionAppend,$NewActionAppend)

  $OldLoadDisable = Normalize-NewLine -NewLine $Nl -Text @'
  if (
    elements.loadButton &&
    !isSilent
  ) {
    elements.loadButton.disabled =
      true;
  }
'@

  $NewLoadDisable = Normalize-NewLine -NewLine $Nl -Text @'
  if (
    !isSilent
  ) {
    if (
      elements.loadButton
    ) {
      elements.loadButton.disabled =
        true;
    }

    if (
      elements.refreshButton
    ) {
      elements.refreshButton.disabled =
        true;
    }
  }
'@

  if (-not $ScriptText.Contains($OldLoadDisable)) {
    throw 'loadAuxiliaryMaterialHistory() disable anchor was not found.'
  }

  $ScriptText = $ScriptText.Replace($OldLoadDisable,$NewLoadDisable)

  $OldLoadEnable = Normalize-NewLine -NewLine $Nl -Text @'
    if (
      elements.loadButton &&
      !isSilent
    ) {
      elements.loadButton.disabled =
        false;
    }
'@

  $NewLoadEnable = Normalize-NewLine -NewLine $Nl -Text @'
    if (
      !isSilent
    ) {
      if (
        elements.loadButton
      ) {
        elements.loadButton.disabled =
          false;
      }

      if (
        elements.refreshButton
      ) {
        elements.refreshButton.disabled =
          false;
      }
    }
'@

  if (-not $ScriptText.Contains($OldLoadEnable)) {
    throw 'loadAuxiliaryMaterialHistory() enable anchor was not found.'
  }

  $ScriptText = $ScriptText.Replace($OldLoadEnable,$NewLoadEnable)

  $OldPolling = Normalize-NewLine -NewLine $Nl -Text @'
function scheduleAuxiliaryMaterialOisPolling() {
  /*
    부재료 OIS 진행 상태는
    자동으로 반복 확인하지 않는다.
  */
  stopAuxiliaryMaterialOisPolling();
}


async function pollAuxiliaryMaterialOisProgress() {
  /*
    저장자료 확인은 사용자가
    보기 버튼을 눌렀을 때만 실행한다.
  */
  stopAuxiliaryMaterialOisPolling();
}
'@

  $NewPolling = Normalize-NewLine -NewLine $Nl -Text @'
function scheduleAuxiliaryMaterialOisPolling() {
  if (
    !auxiliaryMaterialOisQueryState
      .isRunning
  ) {
    return;
  }

  if (
    auxiliaryMaterialOisQueryState
      .timer
  ) {
    window.clearTimeout(
      auxiliaryMaterialOisQueryState
        .timer
    );
  }

  auxiliaryMaterialOisQueryState.timer =
    window.setTimeout(
      pollAuxiliaryMaterialOisProgress,
      2000
    );
}


async function pollAuxiliaryMaterialOisProgress() {
  if (
    !auxiliaryMaterialOisQueryState
      .isRunning
  ) {
    return;
  }

  auxiliaryMaterialOisQueryState.timer =
    null;

  auxiliaryMaterialOisQueryState
    .pollCount +=
    1;

  if (
    !isAuxiliaryMaterialOisRangeStillSelected()
  ) {
    stopAuxiliaryMaterialOisPolling();

    setAuxiliaryMaterialStatus(
      (
        "OIS 기준일/기간이 변경되었습니다. " +
        "진행 중인 요청은 계속 저장되며 " +
        "완료 후 새로고침으로 확인할 수 있습니다."
      ),
      "idle"
    );

    return;
  }

  try {
    await refreshAuxiliaryMaterialOisStatusSlice();

    const counts =
      getAuxiliaryMaterialOisProgressCounts();

    if (
      counts.finished >=
        counts.total &&
      counts.total >
        0
    ) {
      let historyResult =
        null;

      try {
        historyResult =
          await loadAuxiliaryMaterialHistory({
            silent:
              true
          });

      } catch (
        historyError
      ) {
        console.warn(
          "부재료 OIS 완료 후 저장자료 자동 새로고침 실패:",
          historyError
        );
      }

      const savedDateCount =
        Number(
          historyResult?.summary
            ?.savedDateCount ||
          0
        );

      stopAuxiliaryMaterialOisPolling();

      if (
        counts.failed >
        0
      ) {
        setAuxiliaryMaterialStatus(
          (
            "부재료 OIS 조회가 일부 완료되었습니다. " +
            `완료 ${counts.complete}/${counts.total}일 · ` +
            `실패 ${counts.failed}일` +
            (
              historyResult
                ? ` · 현재 목록 ${savedDateCount}일 저장`
                : ""
            )
          ),
          "error"
        );

      } else {
        setAuxiliaryMaterialStatus(
          (
            "부재료 OIS 조회와 D1 저장이 완료되었습니다. " +
            (
              historyResult
                ? `${savedDateCount}일 저장 · 목록 자동 새로고침 완료`
                : "목록 자동 새로고침은 실패했습니다."
            )
          ),
          historyResult
            ? "complete"
            : "idle"
        );

        if (
          typeof showToast ===
            "function"
        ) {
          showToast(
            historyResult
              ? "부재료 OIS 저장 완료 · 목록을 새로고침했습니다."
              : "부재료 OIS 저장이 완료되었습니다."
          );
        }
      }

      return;
    }

    if (
      auxiliaryMaterialOisQueryState
        .pollCount >=
      auxiliaryMaterialOisQueryState
        .maxPollCount
    ) {
      stopAuxiliaryMaterialOisPolling();

      setAuxiliaryMaterialStatus(
        (
          "부재료 OIS 조회가 아직 진행 중입니다. " +
          "잠시 후 새로고침 버튼으로 저장자료를 확인해 주세요."
        ),
        "idle"
      );

      return;
    }

    setAuxiliaryMaterialStatus(
      (
        "OIS 조회 · D1 저장 중 " +
        `(${counts.complete}/${counts.total}일 완료` +
        `${
          counts.processing > 0
            ? ` · ${counts.processing}일 처리 중`
            : ""
        }` +
        `${
          counts.pending > 0
            ? ` · ${counts.pending}일 대기`
            : ""
        }` +
        `${
          counts.failed > 0
            ? ` · ${counts.failed}일 실패`
            : ""
        })`
      ),
      "loading"
    );

    scheduleAuxiliaryMaterialOisPolling();

  } catch (
    error
  ) {
    console.warn(
      "부재료 OIS 진행 상태 확인 실패:",
      error
    );

    if (
      auxiliaryMaterialOisQueryState
        .pollCount >=
      auxiliaryMaterialOisQueryState
        .maxPollCount
    ) {
      stopAuxiliaryMaterialOisPolling();

      setAuxiliaryMaterialStatus(
        (
          "부재료 OIS 진행 상태 확인을 종료했습니다. " +
          "새로고침 버튼으로 저장자료를 확인해 주세요."
        ),
        "idle"
      );

      return;
    }

    scheduleAuxiliaryMaterialOisPolling();
  }
}
'@

  if (-not $ScriptText.Contains($OldPolling)) {
    throw 'Disabled OIS polling functions were not found.'
  }

  $ScriptText = $ScriptText.Replace($OldPolling,$NewPolling)

  $OldImmediateStop = Normalize-NewLine -NewLine $Nl -Text @'
    /*
      등록 응답까지만 확인한다.
      이후 상태 폴링과 저장자료 GET은 하지 않는다.
    */
    stopAuxiliaryMaterialOisPolling();

    if (
      createdCount < 1 &&
      reusedCount < 1
    ) {
'@

  $NewImmediateStop = Normalize-NewLine -NewLine $Nl -Text @'
    /*
      새 요청이 없으면 즉시 종료하고
      현재 선택 월/기간의 D1 저장자료만 다시 읽는다.

      새 요청 또는 진행 중 요청이 있으면
      2초 간격으로 상태만 확인하고,
      완료 시 목록을 한 번 자동 새로고침한다.
    */
    if (
      createdCount < 1 &&
      reusedCount < 1
    ) {
      stopAuxiliaryMaterialOisPolling();

      try {
        await loadAuxiliaryMaterialHistory({
          silent:
            true
        });

      } catch (
        historyError
      ) {
        console.warn(
          "부재료 저장자료 즉시 새로고침 실패:",
          historyError
        );
      }
'@

  if (-not $ScriptText.Contains($OldImmediateStop)) {
    throw 'createAuxiliaryMaterialOisQuery() immediate-stop anchor was not found.'
  }

  $ScriptText = $ScriptText.Replace($OldImmediateStop,$NewImmediateStop)

  $OldStatusBlock = Normalize-NewLine -NewLine $Nl -Text @'
    setAuxiliaryMaterialStatus(
      (
        `저장자료 ${savedCount}일 제외 · ` +
        `신규 OIS ${createdCount}일 · ` +
        `이미 진행 중 ${reusedCount}일. ` +
        "자동 진행 확인은 하지 않습니다. " +
        `완료 후 '${viewButtonText}'를 눌러 확인하세요.`
      ),
      "idle"
    );
'@

  $NewStatusBlock = Normalize-NewLine -NewLine $Nl -Text @'
    setAuxiliaryMaterialStatus(
      (
        `저장자료 ${savedCount}일 제외 · ` +
        `신규 OIS ${createdCount}일 · ` +
        `이미 진행 중 ${reusedCount}일. ` +
        "완료 여부를 자동 확인하고 저장 완료 시 목록을 새로고침합니다."
      ),
      "loading"
    );

    scheduleAuxiliaryMaterialOisPolling();
'@

  if (-not $ScriptText.Contains($OldStatusBlock)) {
    throw 'createAuxiliaryMaterialOisQuery() status block was not found.'
  }

  $ScriptText = $ScriptText.Replace($OldStatusBlock,$NewStatusBlock)

  $OldViewButtonText = Normalize-NewLine -NewLine $Nl -Text @'
    const isPeriodMode =
      getAuxiliaryMaterialElements()
        .periodModeInput
        ?.checked === true;

    const viewButtonText =
      isPeriodMode
        ? "기간 저장자료 보기"
        : "월 저장자료 보기";

'@

  if ($ScriptText.Contains($OldViewButtonText)) {
    $ScriptText = $ScriptText.Replace($OldViewButtonText,"")
  }

  $IndexText =
    [regex]::Replace(
      $IndexText,
      'src="script\.js\?v=[^"]+"',
      'src="script.js?v=20260821-aux-auto-refresh1"',
      1
    )

  [IO.File]::WriteAllText($ScriptFile,$ScriptText,(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($IndexFile,$IndexText,(New-Object Text.UTF8Encoding($false)))

  Write-Host ''
  Write-Host '===== 2. JavaScript syntax check ====='

  $NodeCandidates = @(
    'C:\Users\user\Documents\nodejs\node.exe',
    'C:\Program Files\nodejs\node.exe'
  )

  $Node = $NodeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

  if (-not $Node) {
    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($NodeCommand) { $Node = $NodeCommand.Source }
  }

  if (-not $Node) { throw 'node.exe was not found.' }

  Write-Host "Node: $Node"
  & $Node --check $ScriptFile

  if ($LASTEXITCODE -ne 0) {
    throw 'script.js syntax check failed.'
  }

  Write-Host ''
  Write-Host '===== 3. git diff --check ====='
  git diff --check -- script.js index.html

  if ($LASTEXITCODE -ne 0) {
    throw 'git diff --check failed.'
  }

  $FinalScript = [IO.File]::ReadAllText($ScriptFile)
  $FinalIndex = [IO.File]::ReadAllText($IndexFile)

  Write-Host ''
  Write-Host '===== 4. Verification ====='
  Write-Host ('Patch marker: ' + $FinalScript.Contains('[AUXILIARY-MATERIAL-AUTO-REFRESH]'))
  Write-Host ('Refresh button: ' + $FinalScript.Contains('refreshAuxiliaryMaterialHistoryButton'))
  Write-Host ('2s OIS polling: ' + $FinalScript.Contains('pollAuxiliaryMaterialOisProgress,' + $Nl + '      2000'))
  Write-Host ('Completion auto refresh: ' + $FinalScript.Contains('목록 자동 새로고침 완료'))
  Write-Host ('Cache updated: ' + $FinalIndex.Contains('script.js?v=20260821-aux-auto-refresh1'))

  Write-Host ''
  Write-Host '===== 5. Changed files ====='
  git status --short -- script.js index.html

  Write-Host ''
  git diff --stat -- script.js index.html

  Write-Host ''
  Write-Host '===== Patch complete ====='
  Write-Host 'OIS completion now refreshes the saved-material list automatically.'
  Write-Host 'A PC-only Refresh button now reloads the current D1 saved-material list.'
  Write-Host 'No commit or push was performed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring files ====='
  Copy-Item -LiteralPath (Join-Path $BackupDir 'script.js') -Destination $ScriptFile -Force
  Copy-Item -LiteralPath (Join-Path $BackupDir 'index.html') -Destination $IndexFile -Force
  Write-Host 'Restore complete.'
  throw
}
