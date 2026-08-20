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

  if ($Text.Contains("`r`n")) {
    return "`r`n"
  }

  return "`n"
}

function Normalize-NewLine {
  param(
    [string]$Text,
    [string]$NewLine
  )

  return $Text
    .Replace("`r`n", "`n")
    .Replace("`r", "`n")
    .Replace("`n", $NewLine)
}

Write-Host '===== Legacy sync leader residual cleanup patch ====='
Write-Host ''
Write-Host '===== 1. Current Git state ====='
git status --short

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir =
  Join-Path `
    "$env:USERPROFILE\Desktop\gs-shift-log-backup" `
    "legacy-sync-leader-residual-cleanup-$Stamp"

New-Item `
  -ItemType Directory `
  -Path $BackupDir `
  -Force |
Out-Null

Copy-Item `
  -LiteralPath $ScriptFile `
  -Destination (Join-Path $BackupDir 'script.js') `
  -Force

Copy-Item `
  -LiteralPath $IndexFile `
  -Destination (Join-Path $BackupDir 'index.html') `
  -Force

Write-Host "Backup: $BackupDir"

$ScriptText = [IO.File]::ReadAllText($ScriptFile)
$IndexText  = [IO.File]::ReadAllText($IndexFile)
$Nl = Get-NewLine $ScriptText

$RequiredMarker =
  '[LEGACY-SYNC-LEADER-REBUILD]'

$PatchMarker =
  '[LEGACY-SYNC-LEADER-RESIDUAL-CLEANUP]'

if (
  -not $ScriptText.Contains(
    $RequiredMarker
  )
) {
  throw 'Previous sync-only leader rebuild patch was not found.'
}

if (
  $ScriptText.Contains(
    $PatchMarker
  )
) {
  throw 'Residual cleanup patch is already applied.'
}

try {
  # =========================================================
  # 1. 기존 공용 함수는 그대로 사용하되 옵션만 추가
  #    기본값 false이므로 기존 2026-07-21 조회 동작은 유지
  # =========================================================

  $OldSignature =
    Normalize-NewLine `
      -NewLine $Nl `
      -Text @'
function rebuildLegacyLeaderLogFromMemberLogs(
  convertedLogs
) {
'@

  $NewSignature =
    Normalize-NewLine `
      -NewLine $Nl `
      -Text @'
function rebuildLegacyLeaderLogFromMemberLogs(
  convertedLogs,
  options = {}
) {
'@

  $SignatureCount =
    ([regex]::Matches(
      $ScriptText,
      [regex]::Escape($OldSignature)
    )).Count

  if (
    $SignatureCount -ne
    1
  ) {
    throw "Expected exactly one rebuildLegacyLeaderLogFromMemberLogs signature, found $SignatureCount."
  }

  $ScriptText =
    $ScriptText.Replace(
      $OldSignature,
      $NewSignature
    )


  # =========================================================
  # 2. 파트장 직접 업무 추출 직전에
  #    '동기화 전용' 잔여 구분문구 정리 단계 삽입
  # =========================================================

  $LeaderOwnAnchor =
    Normalize-NewLine `
      -NewLine $Nl `
      -Text @'
  const leaderOwnEntries =
    collectLogEntries(
      leaderLog
    )
      .filter(
'@

  $LeaderOwnReplacement =
    Normalize-NewLine `
      -NewLine $Nl `
      -Text @'
  /* =====================================================
    [LEGACY-SYNC-LEADER-RESIDUAL-CLEANUP]

    수동 동기화에서만 파트장 통합본문의 잔여 구분 제목을
    팀원 원본과 비교하기 전에 제거한다.

    예:
    - ※ #1 Boiler 운전 및 작업사항
    - ※ #2 Boiler 운전 및 작업사항
    - ※ TBN & BOP 운전 및 작업사항

    구분 제목이 실제 업무 뒤에 붙어 있던 경우에는
    업무 본문만 남긴 뒤 기존 isSameSourceEntry() 비교를 수행한다.

    options를 주지 않는 기존 호출은 false이므로
    2026-07-21 이전 일반 조회 재구성 동작은 변경하지 않는다.
  ====================================================== */

  const cleanupCombinedLeaderResiduals =
    options
      ?.cleanupCombinedLeaderResiduals ===
        true;


  const stripLegacyLeaderSectionHeading = (
    content
  ) => {
    const originalContent =
      String(
        content ||
        ""
      )
        .replace(
          /\r\n/g,
          "\n"
        )
        .replace(
          /\r/g,
          "\n"
        );


    if (
      !cleanupCombinedLeaderResiduals ||
      !originalContent.trim()
    ) {
      return originalContent.trim();
    }


    const headingAtLineEndPattern =
      /(?:^|\s+)(?:※\s*)?(?:#\s*[12]\s*(?:BOILER|BLR)|TBN\s*(?:&|\/|AND)\s*BOP)\s*운전\s*및\s*작업\s*사항\s*[:：-]?\s*$/iu;


    return originalContent
      .split(
        "\n"
      )
      .map(
        line => {
          return String(
            line ||
            ""
          )
            .replace(
              headingAtLineEndPattern,
              ""
            )
            .trimEnd();
        }
      )
      .filter(
        line => {
          return Boolean(
            String(
              line ||
              ""
            ).trim()
          );
        }
      )
      .join(
        "\n"
      )
      .trim();
  };


  const rawLeaderOwnEntries =
    collectLogEntries(
      leaderLog
    );


  const cleanedLeaderOwnEntries =
    cleanupCombinedLeaderResiduals
      ? rawLeaderOwnEntries
          .map(
            entry => {
              return {
                ...entry,

                content:
                  stripLegacyLeaderSectionHeading(
                    entry?.content
                  )
              };
            }
          )
          .filter(
            entry => {
              return Boolean(
                String(
                  entry?.content ||
                  ""
                ).trim()
              );
            }
          )
      : rawLeaderOwnEntries;


  const leaderOwnEntries =
    cleanedLeaderOwnEntries
      .filter(
'@

  $LeaderOwnCount =
    ([regex]::Matches(
      $ScriptText,
      [regex]::Escape($LeaderOwnAnchor)
    )).Count

  if (
    $LeaderOwnCount -ne
    1
  ) {
    throw "Expected exactly one leaderOwnEntries anchor, found $LeaderOwnCount."
  }

  $ScriptText =
    $ScriptText.Replace(
      $LeaderOwnAnchor,
      $LeaderOwnReplacement
    )


  # =========================================================
  # 3. 수동 동기화 호출 한 곳에만 cleanup 옵션 활성화
  # =========================================================

  $SyncMarkerPos =
    $ScriptText.IndexOf(
      $RequiredMarker
    )

  if (
    $SyncMarkerPos -lt
    0
  ) {
    throw 'Sync-only marker position was not found.'
  }

  $SyncFunctionStart =
    $ScriptText.LastIndexOf(
      'async function migrateCurrentShiftLegacyLogsManually(',
      $SyncMarkerPos
    )

  if (
    $SyncFunctionStart -lt
    0
  ) {
    throw 'Manual sync function start was not found.'
  }

  $SyncFunctionEnd =
    $ScriptText.IndexOf(
      '/* =========================================================' +
      $Nl +
      '  현재 Shift 동기화 보직 선택',
      $SyncMarkerPos
    )

  if (
    $SyncFunctionEnd -lt
    0
  ) {
    throw 'Manual sync function end was not found.'
  }

  $SyncFunctionText =
    $ScriptText.Substring(
      $SyncFunctionStart,
      $SyncFunctionEnd - $SyncFunctionStart
    )

  $OldSyncCall =
    Normalize-NewLine `
      -NewLine $Nl `
      -Text @'
    rebuildLegacyLeaderLogFromMemberLogs(
      syncLeaderRebuildSourceLogs
    );
'@

  $NewSyncCall =
    Normalize-NewLine `
      -NewLine $Nl `
      -Text @'
    rebuildLegacyLeaderLogFromMemberLogs(
      syncLeaderRebuildSourceLogs,
      {
        cleanupCombinedLeaderResiduals:
          true
      }
    );
'@

  $SyncCallCount =
    ([regex]::Matches(
      $SyncFunctionText,
      [regex]::Escape($OldSyncCall)
    )).Count

  if (
    $SyncCallCount -ne
    1
  ) {
    throw "Expected exactly one manual-sync rebuild call, found $SyncCallCount."
  }

  $SyncFunctionText =
    $SyncFunctionText.Replace(
      $OldSyncCall,
      $NewSyncCall
    )

  $ScriptText =
    $ScriptText.Substring(
      0,
      $SyncFunctionStart
    ) +
    $SyncFunctionText +
    $ScriptText.Substring(
      $SyncFunctionEnd
    )


  # =========================================================
  # 4. script cache bust
  # =========================================================

  $IndexText =
    [regex]::Replace(
      $IndexText,
      'src="script\.js\?v=[^"]+"',
      'src="script.js?v=20260821-legacy-sync-leader-cleanup2"',
      1
    )


  [IO.File]::WriteAllText(
    $ScriptFile,
    $ScriptText,
    (New-Object Text.UTF8Encoding($false))
  )

  [IO.File]::WriteAllText(
    $IndexFile,
    $IndexText,
    (New-Object Text.UTF8Encoding($false))
  )


  Write-Host ''
  Write-Host '===== 2. JavaScript syntax check ====='

  $NodeCandidates = @(
    'C:\Users\user\Documents\nodejs\node.exe',
    'C:\Program Files\nodejs\node.exe'
  )

  $Node =
    $NodeCandidates |
    Where-Object {
      Test-Path -LiteralPath $_
    } |
    Select-Object -First 1

  if (-not $Node) {
    $NodeCommand =
      Get-Command node -ErrorAction SilentlyContinue

    if ($NodeCommand) {
      $Node = $NodeCommand.Source
    }
  }

  if (-not $Node) {
    throw 'node.exe was not found.'
  }

  Write-Host "Node: $Node"

  & $Node --check $ScriptFile

  if (
    $LASTEXITCODE -ne
    0
  ) {
    throw 'script.js syntax check failed.'
  }


  Write-Host ''
  Write-Host '===== 3. git diff --check ====='

  git diff --check -- `
    script.js `
    index.html

  if (
    $LASTEXITCODE -ne
    0
  ) {
    throw 'git diff --check failed.'
  }


  $FinalScript =
    [IO.File]::ReadAllText(
      $ScriptFile
    )

  $FinalIndex =
    [IO.File]::ReadAllText(
      $IndexFile
    )


  Write-Host ''
  Write-Host '===== 4. Verification ====='

  Write-Host (
    'Cleanup marker: ' +
    $FinalScript.Contains(
      $PatchMarker
    )
  )

  Write-Host (
    'Rebuild option added: ' +
    $FinalScript.Contains(
      'options = {}'
    )
  )

  Write-Host (
    'Sync-only cleanup enabled: ' +
    $FinalScript.Contains(
      'cleanupCombinedLeaderResiduals:' +
      $Nl +
      '          true'
    )
  )

  Write-Host (
    'Heading cleanup includes #1/#2 Boiler: ' +
    $FinalScript.Contains(
      '#\s*[12]\s*(?:BOILER|BLR)'
    )
  )

  Write-Host (
    'Heading cleanup includes TBN & BOP: ' +
    $FinalScript.Contains(
      'TBN\s*(?:&|\/|AND)\s*BOP'
    )
  )

  Write-Host (
    'Existing 2026-07-21 condition kept: ' +
    $FinalScript.Contains(
      '"2026-07-21"'
    )
  )

  Write-Host (
    'Script cache updated: ' +
    $FinalIndex.Contains(
      'script.js?v=20260821-legacy-sync-leader-cleanup2'
    )
  )


  Write-Host ''
  Write-Host '===== 5. Changed files ====='

  git status --short -- `
    script.js `
    index.html

  Write-Host ''

  git diff --stat -- `
    script.js `
    index.html


  Write-Host ''
  Write-Host '===== Patch complete ====='

  Write-Host 'Manual sync now removes legacy leader section headings before duplicate comparison.'
  Write-Host 'Existing normal legacy viewing/rebuild behavior remains unchanged.'
  Write-Host 'No server file was changed.'
  Write-Host 'No commit or push was performed.'
}
catch {
  Write-Host ''
  Write-Host '===== Patch failed; restoring files ====='

  Copy-Item `
    -LiteralPath (Join-Path $BackupDir 'script.js') `
    -Destination $ScriptFile `
    -Force

  Copy-Item `
    -LiteralPath (Join-Path $BackupDir 'index.html') `
    -Destination $IndexFile `
    -Force

  Write-Host 'Restore complete.'
  throw
}
