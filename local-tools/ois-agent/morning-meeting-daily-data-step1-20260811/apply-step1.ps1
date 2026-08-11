param(
  [string]$AgentFile =
    ""
)

$ErrorActionPreference =
  "Stop"

$expectedSourceHash =
  "B98BFF19D3FEA3B0A1A8052EE68803B6CD00BAC7927518AB575A9503EC66B0C5"

if (
  [string]::IsNullOrWhiteSpace(
    $AgentFile
  )
) {
  $AgentFile =
    Join-Path `
      $PSScriptRoot `
      "..\ois-login.js"
}

$resolvedAgentFile =
  [IO.Path]::GetFullPath(
    $AgentFile
  )

if (
  -not (
    Test-Path `
      -LiteralPath $resolvedAgentFile `
      -PathType Leaf
  )
) {
  throw (
    "수정할 ois-login.js를 찾지 못했습니다: " +
    $resolvedAgentFile
  )
}

$runningAgent =
  Get-CimInstance `
    Win32_Process `
    -Filter "Name='node.exe'" `
    -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like
      "*ois-login.js*"
  } |
  Select-Object `
    -First 1

if (
  $null -ne $runningAgent
) {
  throw (
    "OIS 에이전트가 실행 중입니다. 예약 작업을 중지하고 node.exe의 ois-login.js 프로세스가 종료된 뒤 다시 실행해 주세요. PID: " +
    $runningAgent.ProcessId
  )
}

$actualSourceHash =
  (
    Get-FileHash `
      -LiteralPath $resolvedAgentFile `
      -Algorithm SHA256
  ).Hash

if (
  $actualSourceHash -ne
    $expectedSourceHash
) {
  throw (
    "현재 ois-login.js가 이 1단계 패치의 기준본과 다릅니다. " +
    "기대 SHA256: " +
    $expectedSourceHash +
    ", 실제 SHA256: " +
    $actualSourceHash +
    ". 파일을 덮어쓰지 않았습니다."
  )
}

function Read-ReplacementText {
  param(
    [string]$FileName,
    [string]$LineEnding
  )

  $replacementPath =
    Join-Path `
      $PSScriptRoot `
      $FileName

  if (
    -not (
      Test-Path `
        -LiteralPath $replacementPath `
        -PathType Leaf
    )
  ) {
    throw (
      "교체 섹션 파일을 찾지 못했습니다: " +
      $replacementPath
    )
  }

  $replacementText =
    [IO.File]::ReadAllText(
      $replacementPath,
      [Text.Encoding]::UTF8
    )

  return (
    [regex]::Replace(
      $replacementText,
      "\r?\n",
      $LineEnding
    ).TrimEnd(
      [char[]]"`r`n"
    ) +
    $LineEnding +
    $LineEnding
  )
}

function Replace-ExactlyOnce {
  param(
    [string]$Text,
    [string]$Pattern,
    [string]$Replacement,
    [string]$Label
  )

  $expression =
    [regex]::new(
      $Pattern,
      [Text.RegularExpressions.RegexOptions]::Singleline
    )

  $matches =
    $expression.Matches(
      $Text
    )

  if (
    $matches.Count -ne 1
  ) {
    throw (
      $Label +
      " 교체 위치를 정확히 한 곳 찾지 못했습니다. 확인 건수: " +
      $matches.Count
    )
  }

  return $expression.Replace(
    $Text,
    [Text.RegularExpressions.MatchEvaluator]{
      param(
        $match
      )

      return $Replacement
    },
    1
  )
}

$sourceText =
  [IO.File]::ReadAllText(
    $resolvedAgentFile,
    [Text.Encoding]::UTF8
  )

$lineEnding =
  if (
    $sourceText.Contains(
      "`r`n"
    )
  ) {
    "`r`n"
  }
  else {
    "`n"
  }

$definitions =
  Read-ReplacementText `
    -FileName "01-daily-data-definitions.txt" `
    -LineEnding $lineEnding

$excelReader =
  Read-ReplacementText `
    -FileName "02-daily-data-excel-reader.txt" `
    -LineEnding $lineEnding

$collector =
  Read-ReplacementText `
    -FileName "03-daily-data-collector.txt" `
    -LineEnding $lineEnding

$consoleBranch =
  Read-ReplacementText `
    -FileName "04-daily-data-console-branch.txt" `
    -LineEnding $lineEnding

$candidateText =
  Replace-ExactlyOnce `
    -Text $sourceText `
    -Pattern '(?s)/\* [=]+\r?\n  오전회의 증기 생산량 DataPARC 조회 정의.*?(?=/\* [=]+\r?\n  DataPARC Tag Browser 통신 진단)' `
    -Replacement $definitions `
    -Label "데이터 정의 섹션"

$candidateText =
  Replace-ExactlyOnce `
    -Text $candidateText `
    -Pattern '(?s)const DATAPARC_STEAM_OPEN_WORKBOOK_POWERSHELL_SCRIPT =.*?(?=function runDataParcSteamPowerShell\()' `
    -Replacement $excelReader `
    -Label "Excel 조회 PowerShell 섹션"

$candidateText =
  Replace-ExactlyOnce `
    -Text $candidateText `
    -Pattern '(?s)function parseDataParcSteamNumber\(.*?(?=/\* [=]+\r?\n  요청 유형별 OIS 자료 수집)' `
    -Replacement $collector `
    -Label "일일DATA 수집·OIS 증기판매량 제거 섹션"

$candidateText =
  Replace-ExactlyOnce `
    -Text $candidateText `
    -Pattern '(?s)  if \(\r?\n    requestType ===\r?\n      "steam_status"\r?\n  \) \{\r?\n    console\.table\(\{\r?\n      "조회일":.*?(?=  if \(\r?\n    requestType ===\r?\n      "logsheet_approval")' `
    -Replacement $consoleBranch `
    -Label "일일DATA 콘솔 출력 함수"

$timeStamp =
  Get-Date `
    -Format "yyyyMMdd-HHmmss"

$agentDirectory =
  Split-Path `
    -Parent $resolvedAgentFile

$candidateFile =
  Join-Path `
    $agentDirectory `
    (
      "ois-login-daily-data-step1-candidate-" +
      $timeStamp +
      ".js"
    )

$backupFile =
  Join-Path `
    $agentDirectory `
    (
      "ois-login-before-daily-data-step1-" +
      $timeStamp +
      ".js"
    )

[IO.File]::WriteAllText(
  $candidateFile,
  $candidateText,
  [Text.UTF8Encoding]::new(
    $false
  )
)

$nodeCommand =
  Get-Command `
    node `
    -ErrorAction Stop

& $nodeCommand.Source `
  --check `
  $candidateFile

if (
  $LASTEXITCODE -ne 0
) {
  throw (
    "교체 후보 파일의 JavaScript 문법 검사에 실패했습니다. 현재 ois-login.js는 변경하지 않았습니다. 후보 파일: " +
    $candidateFile
  )
}

Copy-Item `
  -LiteralPath $resolvedAgentFile `
  -Destination $backupFile

Copy-Item `
  -LiteralPath $candidateFile `
  -Destination $resolvedAgentFile `
  -Force

& $nodeCommand.Source `
  --check `
  $resolvedAgentFile

if (
  $LASTEXITCODE -ne 0
) {
  Copy-Item `
    -LiteralPath $backupFile `
    -Destination $resolvedAgentFile `
    -Force

  throw (
    "설치 후 문법 검사에 실패해 백업본으로 복구했습니다. 백업: " +
    $backupFile
  )
}

Remove-Item `
  -LiteralPath $candidateFile `
  -Force

$installedItem =
  Get-Item `
    -LiteralPath $resolvedAgentFile

$installedHash =
  (
    Get-FileHash `
      -LiteralPath $resolvedAgentFile `
      -Algorithm SHA256
  ).Hash

[PSCustomObject]@{
  Status =
    "OK"

  AgentFile =
    $installedItem.FullName

  Length =
    $installedItem.Length

  SHA256 =
    $installedHash

  BackupFile =
    $backupFile
} |
  Format-List
