#Requires -Version 5.1
<#
Daily Operation DataPARC reader v1.0.0. Windows PowerShell 5.1, hidden /x Excel.
Derived from company-tested organic pilot V1.3 and current Blower multiple-Excel policy.
Selected completed day only, 14 fixed TimeAvg/End/Max Value/QualStr/Time samples, KST.
Does not save workbooks or write the database. Node submits only after exit 0 and
the matching controller report confirms values, quality, timestamps and cleanup.
Independent 240-second watchdog; PID/start/path/session/parent ownership checks;
shared Blower mutex is held through all Excel/Host/worker cleanup.
-ValidateOnly parses the embedded worker and runs quality checks without Excel.
#>
[CmdletBinding()]
param(
  [string]$TargetDate = '2026-09-01',
  [string]$OutputDirectory = '',
  [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$runId = [guid]::NewGuid().ToString('N')
$timeoutSeconds = 240
$worker = $null
$workerSignature = $null
$controllerMutex = $null
$controllerMutexAcquired = $false
$temporaryDirectory = $null
$outputReady = $false
$ownershipPath = $null
$stdoutPath = $null
$stderrPath = $null
$timedOut = $false
$controllerFailure = $null
$rawResult = $null
$success = $false
$workerExitCode = $null
$baselineExcel = @()
$baselineHosts = @()
$ownedExcel = $null
$ownedExcelProcessPinned = $null
$ownedHosts = @()
$cleanupErrors = New-Object 'System.Collections.Generic.List[string]'
$cleanupActions = New-Object 'System.Collections.Generic.List[string]'
$logOffsets = @{}
$utf8 = New-Object Text.UTF8Encoding($false)

function Test-OrganicQualityGood([string]$QualityText) {
  if ([string]::IsNullOrWhiteSpace($QualityText)) { return $false }
  # Observed DataPARC QualStr is "Raw, Good". Raw is a value-origin token;
  # Good is the quality token. Recognize exact known tokens, never a substring.
  # Keep unrecognized status/origin labels diagnostic until their meaning is verified.
  $qualityTokens = @($QualityText.Split(',') | ForEach-Object { $_.Trim() })
  if ($qualityTokens.Count -eq 1) { return ($qualityTokens[0] -ieq 'Good') }
  if ($qualityTokens.Count -ne 2) { return $false }
  return (
    ($qualityTokens[0] -ieq 'Raw' -and $qualityTokens[1] -ieq 'Good') -or
    ($qualityTokens[0] -ieq 'Good' -and $qualityTokens[1] -ieq 'Raw')
  )
}

function Assert-OrganicQualityClassifier {
  $qualityCases = @(
    @{Text='Good'; Expected=$true},
    @{Text='Raw, Good'; Expected=$true},
    @{Text=' raw , GOOD '; Expected=$true},
    @{Text='Good, Raw'; Expected=$true},
    @{Text=''; Expected=$false},
    @{Text='Raw'; Expected=$false},
    @{Text='Bad'; Expected=$false},
    @{Text='Raw, Bad'; Expected=$false},
    @{Text='Raw, Uncertain'; Expected=$false},
    @{Text='Not Good'; Expected=$false},
    @{Text='Raw, Not Good'; Expected=$false},
    @{Text='Raw, Good, Bad'; Expected=$false},
    @{Text='Raw, Good, Uncertain'; Expected=$false},
    @{Text='Raw, Good, NoData'; Expected=$false},
    @{Text='Good, Good'; Expected=$false},
    @{Text='Good,'; Expected=$false},
    @{Text=',Good'; Expected=$false},
    @{Text='Calculated, Good'; Expected=$false}
  )
  foreach ($qualityCase in $qualityCases) {
    if ((Test-OrganicQualityGood $qualityCase.Text) -ne $qualityCase.Expected) {
      throw ('품질 판정 자체 검사 실패: ' + $qualityCase.Text)
    }
  }
}

Assert-OrganicQualityClassifier

function New-ControllerSignature($ProcessObject) {
  [void]$ProcessObject.Handle
  return [pscustomobject][ordered]@{
    ProcessId = [int]$ProcessObject.Id
    ProcessName = [string]$ProcessObject.ProcessName
    StartTicks = [long]$ProcessObject.StartTime.ToUniversalTime().Ticks
    SessionId = [int]$ProcessObject.SessionId
    Path = [string]$ProcessObject.Path
  }
}

function Test-ControllerProcessObject($ProcessObject, $Signature) {
  try {
    [void]$ProcessObject.Handle
    return (
      [int]$ProcessObject.Id -eq [int]$Signature.ProcessId -and
      [string]::Equals([string]$ProcessObject.ProcessName, [string]$Signature.ProcessName, [StringComparison]::OrdinalIgnoreCase) -and
      [long]$ProcessObject.StartTime.ToUniversalTime().Ticks -eq [long]$Signature.StartTicks -and
      [int]$ProcessObject.SessionId -eq [int]$Signature.SessionId -and
      -not [string]::IsNullOrWhiteSpace([string]$Signature.Path) -and
      [string]::Equals([IO.Path]::GetFullPath([string]$ProcessObject.Path), [IO.Path]::GetFullPath([string]$Signature.Path), [StringComparison]::OrdinalIgnoreCase)
    )
  } catch { return $false }
}

function Test-ControllerSignature($Signature) {
  if ($null -eq $Signature) { return $false }
  $process = Get-Process -Id ([int]$Signature.ProcessId) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }
  try { return Test-ControllerProcessObject $process $Signature } finally { $process.Dispose() }
}

function Get-ControllerCim([string]$Filter) {
  return @(Get-CimInstance -ClassName Win32_Process -Filter $Filter -OperationTimeoutSec 5 -ErrorAction Stop)
}

function Test-ControllerAllowedHostPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  try {
    $normalized = [IO.Path]::GetFullPath($Path)
    if (-not [string]::Equals([IO.Path]::GetFileName($normalized), 'CTCExcelAddIn.PARCviewHost.exe', [StringComparison]::OrdinalIgnoreCase)) { return $false }
    foreach ($root in @([string]$env:ProgramFiles, [string]([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')))) {
      if ([string]::IsNullOrWhiteSpace($root)) { continue }
      $allowed = [IO.Path]::GetFullPath((Join-Path $root 'Capstone\PARCView')).TrimEnd('\') + '\'
      if ($normalized.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
  } catch { }
  return $false
}

function Resolve-ControllerExcelExecutable {
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  try {
    $command = Get-Command 'EXCEL.EXE' -ErrorAction Stop
    if (-not [string]::IsNullOrWhiteSpace([string]$command.Source)) { $candidates.Add([string]$command.Source) }
  } catch { }
  foreach ($registryPath in @(
    'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\excel.exe',
    'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\excel.exe',
    'Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\excel.exe'
  )) {
    try {
      $registryKey = Get-Item -LiteralPath $registryPath -ErrorAction Stop
      $value = [string]$registryKey.GetValue('')
      if (-not [string]::IsNullOrWhiteSpace($value)) { $candidates.Add($value) }
    } catch { }
  }
  foreach ($root in @([string]$env:ProgramFiles, [string]([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')))) {
    if ([string]::IsNullOrWhiteSpace($root)) { continue }
    foreach ($relative in @('Microsoft Office\root\Office16\EXCEL.EXE', 'Microsoft Office\Office16\EXCEL.EXE', 'Microsoft Office\Office15\EXCEL.EXE')) {
      $candidates.Add((Join-Path $root $relative))
    }
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [IO.Path]::GetFullPath($candidate) }
  }
  throw 'EXCEL.EXE를 찾을 수 없습니다.'
}

function Read-ControllerSharedText([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.File]::Exists($Path)) { return '' }
  $stream = $null
  $reader = $null
  try {
    $stream = New-Object IO.FileStream($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
    return $reader.ReadToEnd()
  } finally {
    if ($reader) { $reader.Dispose() } elseif ($stream) { $stream.Dispose() }
  }
}

function Show-ControllerLog([string]$Path, [switch]$Final) {
  $contents = Read-ControllerSharedText $Path
  if ($null -eq $contents) { return }
  $limit = $contents.Length
  if (-not $Final) { $limit = $contents.LastIndexOf("`n") + 1 }
  $offset = 0
  if ($logOffsets.ContainsKey($Path)) { $offset = [int]$logOffsets[$Path] }
  if ($limit -le $offset) { return }
  $newText = $contents.Substring($offset, $limit - $offset)
  $logOffsets[$Path] = $limit
  foreach ($line in ($newText -split '\r?\n')) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.StartsWith('__DAILY_OPERATION_RESULT__')) { continue }
    [Console]::WriteLine($line.Replace('__DAILY_OPERATION_STAGE__', '[진행] '))
  }
}

function Update-ControllerOwnership {
  if ($null -eq $workerSignature) { return }
  $snapshot = $null
  try {
    if ($ownershipPath -and [IO.File]::Exists($ownershipPath)) {
      $snapshot = (Read-ControllerSharedText $ownershipPath) | ConvertFrom-Json
      if ([string]$snapshot.runId -ne $runId -or
          [int]$snapshot.worker.ProcessId -ne [int]$workerSignature.ProcessId -or
          [long]$snapshot.worker.StartTicks -ne [long]$workerSignature.StartTicks) { $snapshot = $null }
    }
  } catch { $snapshot = $null }

  $candidateExcel = $null
  if ($snapshot -and $snapshot.excel) { $candidateExcel = $snapshot.excel }
  if ($candidateExcel -and
      [string]$candidateExcel.ProcessName -ieq 'EXCEL' -and
      [int]$candidateExcel.ParentProcessId -eq [int]$workerSignature.ProcessId -and
      [long]$candidateExcel.StartTicks -ge [long]$workerSignature.StartTicks -and
      [int]$candidateExcel.SessionId -eq [int]$workerSignature.SessionId -and
      [string]::Equals([string]$candidateExcel.Path, $expectedExcelPath, [StringComparison]::OrdinalIgnoreCase) -and
      @($baselineExcel | ForEach-Object { [int]$_.ProcessId }) -notcontains [int]$candidateExcel.ProcessId) {
    $script:ownedExcel = $candidateExcel
  }

  # Recover an Excel child launched just before a worker stalled or exited, before it
  # could write ownership.json. Parent PID, launch time, path and session must agree.
  if ($null -eq $script:ownedExcel) {
    foreach ($candidate in @(Get-ControllerCim ("Name='EXCEL.EXE' AND ParentProcessId=" + [string]$workerSignature.ProcessId))) {
      $process = Get-Process -Id ([int]$candidate.ProcessId) -ErrorAction SilentlyContinue
      if ($null -eq $process) { continue }
      try {
        $signature = New-ControllerSignature $process
        if ([long]$signature.StartTicks -lt [long]$workerSignature.StartTicks -or
            [int]$signature.SessionId -ne [int]$workerSignature.SessionId -or
            -not [string]::Equals([string]$signature.Path, $expectedExcelPath, [StringComparison]::OrdinalIgnoreCase) -or
            @($baselineExcel | ForEach-Object { [int]$_.ProcessId }) -contains [int]$signature.ProcessId) { continue }
        if ($null -ne $script:ownedExcel) { throw '시험 작업 프로세스의 Excel 자식이 둘 이상입니다. 자동 정리를 중단합니다.' }
        $signature | Add-Member -NotePropertyName ParentProcessId -NotePropertyValue ([int]$workerSignature.ProcessId)
        $script:ownedExcel = $signature
      } finally { $process.Dispose() }
    }
  }

  if ($null -eq $script:ownedExcel) { return }
  # Retain the verified parent process handle until all forced cleanup ends. Windows
  # cannot recycle that process object/PID while this handle remains open.
  if ($null -eq $script:ownedExcelProcessPinned) {
    $candidateProcess = Get-Process -Id ([int]$script:ownedExcel.ProcessId) -ErrorAction SilentlyContinue
    if ($null -ne $candidateProcess) {
      if (Test-ControllerProcessObject $candidateProcess $script:ownedExcel) {
        $script:ownedExcelProcessPinned = $candidateProcess
      } else { $candidateProcess.Dispose() }
    }
  }
  $hostCandidates = @()
  if ($snapshot -and $snapshot.host) { $hostCandidates += $snapshot.host }
  $lateHosts = @()
  if ($null -ne $script:ownedExcelProcessPinned) {
    $lateHosts = @(Get-ControllerCim ("Name='CTCExcelAddIn.PARCviewHost.exe' AND ParentProcessId=" + [string]$script:ownedExcel.ProcessId))
  }
  foreach ($candidate in $lateHosts) {
    $process = Get-Process -Id ([int]$candidate.ProcessId) -ErrorAction SilentlyContinue
    if ($null -eq $process) { continue }
    try {
      $signature = New-ControllerSignature $process
      $signature | Add-Member -NotePropertyName ParentProcessId -NotePropertyValue ([int]$candidate.ParentProcessId)
      $hostCandidates += $signature
    } finally { $process.Dispose() }
  }
  foreach ($candidate in $hostCandidates) {
    if ([int]$candidate.ParentProcessId -ne [int]$script:ownedExcel.ProcessId -or
        [long]$candidate.StartTicks -lt [long]$script:ownedExcel.StartTicks -or
        [int]$candidate.SessionId -ne [int]$script:ownedExcel.SessionId -or
        [string]$candidate.ProcessName -ine 'CTCExcelAddIn.PARCviewHost' -or
        -not (Test-ControllerAllowedHostPath ([string]$candidate.Path)) -or
        @($baselineHosts | ForEach-Object { [int]$_.ProcessId }) -contains [int]$candidate.ProcessId) { continue }
    $already = @($script:ownedHosts | Where-Object {
      [int]$_.ProcessId -eq [int]$candidate.ProcessId -and [long]$_.StartTicks -eq [long]$candidate.StartTicks
    })
    if ($already.Count -eq 0) { $script:ownedHosts += $candidate }
  }
}

function Stop-ControllerSignature($Signature, [string]$Label, [switch]$CheckParent) {
  if ($null -eq $Signature) { return }
  $process = Get-Process -Id ([int]$Signature.ProcessId) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return }
  try {
    if (-not (Test-ControllerProcessObject $process $Signature)) {
      $cleanupErrors.Add($Label + ' PID 신원이 바뀌어 종료하지 않았습니다.')
      return
    }
    if ($CheckParent) {
      $cim = @(Get-ControllerCim ('ProcessId=' + [string]$Signature.ProcessId))
      if ($cim.Count -ne 1 -or [int]$cim[0].ParentProcessId -ne [int]$Signature.ParentProcessId -or [int]$cim[0].SessionId -ne [int]$Signature.SessionId) {
        $cleanupErrors.Add($Label + ' 부모 PID/세션이 일치하지 않아 종료하지 않았습니다.')
        return
      }
    }
    # Kill through the exact Process object whose live handle and identity were checked.
    # No image-wide kill, no process-tree kill and no user Excel COM access.
    $process.Kill()
    [void]$process.WaitForExit(3000)
    $cleanupActions.Add($Label + ' 소유 PID ' + [string]$Signature.ProcessId + ' 종료')
  } catch {
    if (Test-ControllerSignature $Signature) { $cleanupErrors.Add($Label + ' 종료 실패: ' + $_.Exception.Message) }
  } finally { $process.Dispose() }
}

function Invoke-ControllerCleanup {
  if ($null -eq $workerSignature) { return }
  try { Update-ControllerOwnership } catch { $cleanupErrors.Add('소유 프로세스 확인: ' + $_.Exception.Message) }
  # Discover Host before Excel termination; a hung NativeOM/Calculate/Quit becomes
  # unblocked once this exact owned Excel process exits. The controller keeps mutex.
  Stop-ControllerSignature $script:ownedExcel '조회용 Excel' -CheckParent
  foreach ($signature in @($script:ownedHosts)) { Stop-ControllerSignature $signature '조회용 DataPARC Host' -CheckParent }
  if (Test-ControllerSignature $workerSignature) {
    try { [void]$worker.WaitForExit(8000) } catch { }
  }
  if (Test-ControllerSignature $workerSignature) { Stop-ControllerSignature $workerSignature '조회용 PowerShell' -CheckParent }
  # Also catch a Host which appeared during the first cleanup pass. Its exact parent,
  # start time, session and Capstone executable path are all required again.
  try { Update-ControllerOwnership } catch { $cleanupErrors.Add('지연 소유 프로세스 확인: ' + $_.Exception.Message) }
  Stop-ControllerSignature $script:ownedExcel '조회용 Excel' -CheckParent
  foreach ($signature in @($script:ownedHosts)) { Stop-ControllerSignature $signature '조회용 DataPARC Host' -CheckParent }
  foreach ($signature in @($script:ownedExcel) + @($script:ownedHosts) + @($workerSignature)) {
    if ($null -ne $signature -and (Test-ControllerSignature $signature)) {
      $cleanupErrors.Add('소유 프로세스가 남아 있습니다. PID=' + [string]$signature.ProcessId)
    }
  }
}

function Save-ControllerReport {
  if (-not $outputReady) { return }
  try {
    $results = @()
    foreach ($line in ((Read-ControllerSharedText $stdoutPath) -split '\r?\n')) {
      if ($line.StartsWith('__DAILY_OPERATION_RESULT__')) {
        $results += $line.Substring('__DAILY_OPERATION_RESULT__'.Length) | ConvertFrom-Json
      }
    }
    if ($results.Count -eq 1) {
      $script:rawResult = $results[0]
      foreach ($action in @($rawResult.cleanupActions)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$action)) { $cleanupActions.Add('Worker: ' + [string]$action) }
      }
      [IO.File]::WriteAllText((Join-Path $OutputDirectory 'pilot-result.json'), ($rawResult | ConvertTo-Json -Depth 16), $utf8)
    } elseif (-not $controllerFailure) { $script:controllerFailure = '일일운전 조회 결과가 정확히 한 건 반환되지 않았습니다.' }
    $script:success = ($null -ne $rawResult -and $rawResult.ok -is [bool] -and $rawResult.ok -eq $true -and
      $rawResult.cleanupVerified -is [bool] -and $rawResult.cleanupVerified -eq $true -and
      [string]$rawResult.runId -eq $runId -and @($rawResult.samples).Count -eq 14 -and
      [string]$rawResult.mode -eq 'daily_operation_data' -and [string]$rawResult.targetDate -eq $TargetDate -and
      $rawResult.databaseWritten -is [bool] -and $rawResult.databaseWritten -eq $false -and
      $workerExitCode -eq 0 -and -not $timedOut -and -not $controllerFailure -and $cleanupErrors.Count -eq 0)
    if (-not $success -and -not $controllerFailure) {
      $script:controllerFailure = '일일운전 표본/프로세스 정리 검증을 통과하지 못했습니다.'
    }
    $report = [ordered]@{
      schemaVersion=1; runId=$runId; targetDate=$TargetDate; mode='daily_operation_data'
      ok=[bool]$success; cleanupVerified=[bool]$success
      timeoutSeconds=$timeoutSeconds; timedOut=$timedOut; workerExitCode=$workerExitCode
      resultReceived=($null -ne $rawResult)
      resultOk=$(if ($null -ne $rawResult) { $rawResult.ok } else { $null })
      failure=$controllerFailure; cleanupErrors=@($cleanupErrors.ToArray()); cleanupActions=@($cleanupActions.ToArray())
      baselineExcel=@($baselineExcel); baselineHosts=@($baselineHosts); ownedExcel=$ownedExcel; ownedHosts=@($ownedHosts)
      databaseWritten=$false; completedAtUtc=[datetime]::UtcNow.ToString('o')
    }
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'pilot-report.json'), ($report | ConvertTo-Json -Depth 16), $utf8)
    $lines = @(
      '===== DAILY OPERATION DATAPARC READER V1 =====',
      ('Target date: ' + $TargetDate), ('Status: ' + $(if ($success) { 'PASS' } else { 'FAIL' })),
      ('Worker exit code: ' + [string]$workerExitCode), ('Timed out: ' + [string]$timedOut),
      ('Cleanup verified: ' + [string]$success), ('Failure: ' + [string]$controllerFailure),
      ('Cleanup errors: ' + ($cleanupErrors -join ' | ')), ('Cleanup actions: ' + ($cleanupActions -join ' | ')),
      'Database written by reader: False', ('Output: ' + $OutputDirectory)
    )
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'pilot-report.txt'), ($lines -join [Environment]::NewLine), $utf8)
    foreach ($line in $lines) { [Console]::WriteLine($line) }
  } catch { $script:success = $false; [Console]::WriteLine('[실패] 조회 보고서 저장 오류: ' + $_.Exception.Message) }
}

try {
  $parsedDate = [datetime]::MinValue
  if (-not [datetime]::TryParseExact($TargetDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedDate)) {
    throw 'TargetDate는 yyyy-MM-dd 형식이어야 합니다.'
  }
  $workerPath = Join-Path $PSScriptRoot 'daily-operation-dataparc-worker.ps1'
  if (-not (Test-Path -LiteralPath $workerPath -PathType Leaf)) { throw '일일운전 조회 Worker가 설치되지 않았습니다.' }
  $workerText = [IO.File]::ReadAllText($workerPath, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
  $parseTokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput($workerText, [ref]$parseTokens, [ref]$parseErrors)
  if (@($parseErrors).Count -gt 0) { throw ('내장 PowerShell 구문 오류: ' + (($parseErrors | ForEach-Object { $_.Message }) -join ' | ')) }
  if ($workerText.Contains('# __ORGANIC_CONFIG_BLOCK__') -or $workerText.Contains('# __ORGANIC_QUERY_BLOCK__')) {
    throw '내장 조회 스크립트의 설정/조회 블록이 완성되지 않았습니다.'
  }
  if ($ValidateOnly) {
    [Console]::WriteLine('PASS: PowerShell 구문과 내장 Worker 구문 검사. Excel은 시작하지 않았습니다.')
    exit 0
  }
  if ($env:OS -ne 'Windows_NT') { throw '이 시험은 회사 Windows PC에서 실행해 주세요.' }

  $controllerProcess = Get-Process -Id $PID -ErrorAction Stop
  try { $controllerSignature = New-ControllerSignature $controllerProcess } finally { $controllerProcess.Dispose() }
  $expectedExcelPath = Resolve-ControllerExcelExecutable
  $controllerMutex = [Threading.Mutex]::new($false, 'Local\GSShiftLog.BlowerRuntimeDataParcHiddenExcelNativeOmV1')
  try { $controllerMutexAcquired = [bool]$controllerMutex.WaitOne(0, $false) }
  catch [Threading.AbandonedMutexException] { $controllerMutexAcquired = $true }
  if (-not $controllerMutexAcquired) { throw '다른 DataPARC 숨김 Excel 조회가 진행 중입니다. Blower 조회 완료 후 다시 실행해 주세요.' }

  foreach ($process in @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Where-Object { [int]$_.SessionId -eq [int]$controllerSignature.SessionId })) {
    try { $baselineExcel += New-ControllerSignature $process } finally { $process.Dispose() }
  }
  foreach ($process in @(Get-Process -Name 'CTCExcelAddIn.PARCviewHost' -ErrorAction SilentlyContinue | Where-Object { [int]$_.SessionId -eq [int]$controllerSignature.SessionId })) {
    try { $baselineHosts += New-ControllerSignature $process } finally { $process.Dispose() }
  }
  if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path (Join-Path $env:USERPROFILE 'Downloads') ('daily-operation-dataparc-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $runId.Substring(0, 8))
  }
  $OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
  [void][IO.Directory]::CreateDirectory($OutputDirectory)
  foreach ($name in @('pilot-result.json', 'pilot-report.json', 'pilot-report.txt', 'worker-stdout.log', 'worker-stderr.log')) {
    if ([IO.File]::Exists((Join-Path $OutputDirectory $name))) { throw '출력 폴더에 기존 조회 결과가 있습니다. 다른 OutputDirectory를 지정해 주세요.' }
  }
  $outputReady = $true
  $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('gs-daily-operation-dataparc-' + $runId)
  [void][IO.Directory]::CreateDirectory($temporaryDirectory)
  $workerPath = Join-Path $temporaryDirectory 'daily-operation-worker.ps1'
  $ownershipPath = Join-Path $temporaryDirectory 'ownership.json'
  $stdoutPath = Join-Path $OutputDirectory 'worker-stdout.log'
  $stderrPath = Join-Path $OutputDirectory 'worker-stderr.log'
  [IO.File]::WriteAllText($workerPath, $workerText, (New-Object Text.UTF8Encoding($true)))
  $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not [IO.File]::Exists($powerShellPath)) { throw 'Windows PowerShell 5.1 실행 파일을 찾을 수 없습니다.' }
  [Console]::WriteLine('유기성 Silo DataPARC 조회 V1 · ' + $TargetDate)
  [Console]::WriteLine('최대 조회 대기 240초. 종료 시 조회용 Excel과 DataPARC Host를 정리합니다.')
  $workerEnvironment = @{
    GS_DAILY_OPERATION_TARGET_DATE = $TargetDate
    GS_DAILY_OPERATION_RUN_ID = $runId
    GS_DAILY_OPERATION_OWNERSHIP_PATH = $ownershipPath
    GS_DAILY_OPERATION_CONTROLLER_SIGNATURE = ($controllerSignature | ConvertTo-Json -Compress)
  }
  $priorEnvironment = @{}
  try {
    foreach ($key in $workerEnvironment.Keys) {
      $priorEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
      [Environment]::SetEnvironmentVariable($key, [string]$workerEnvironment[$key], 'Process')
    }
    $startedAt = [datetime]::UtcNow
    $deadline = $startedAt.AddSeconds($timeoutSeconds)
    $worker = Start-Process -FilePath $powerShellPath -ArgumentList @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $workerPath + '"')) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $workerSignature = New-ControllerSignature $worker
    $workerSignature | Add-Member -NotePropertyName ParentProcessId -NotePropertyValue ([int]$controllerSignature.ProcessId)
  } finally {
    foreach ($key in $priorEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $priorEnvironment[$key], 'Process') }
  }
  while (-not $worker.HasExited) {
    Show-ControllerLog $stdoutPath
    Show-ControllerLog $stderrPath
    if ([datetime]::UtcNow -ge $deadline) {
      $timedOut = $true
      throw '240초 제한시간을 초과했습니다. 조회용 프로세스를 정리합니다.'
    }
    Start-Sleep -Milliseconds 300
  }
  $worker.WaitForExit()
  $workerExitCode = [int]$worker.ExitCode
} catch {
  $controllerFailure = $_.Exception.Message
  [Console]::WriteLine('[실패] ' + $controllerFailure)
} finally {
  try {
    Invoke-ControllerCleanup
    foreach ($signature in @($baselineExcel) + @($baselineHosts)) {
      if (-not (Test-ControllerSignature $signature)) {
        $cleanupErrors.Add('기존 사용자 프로세스가 조회 중 변경되거나 종료되었습니다. PID=' + [string]$signature.ProcessId)
      }
    }
    if ($stdoutPath) { Show-ControllerLog $stdoutPath -Final }
    if ($stderrPath) { Show-ControllerLog $stderrPath -Final }
    if ($worker -and $worker.HasExited) { $workerExitCode = [int]$worker.ExitCode }
  } catch { $cleanupErrors.Add('정리 관리 오류: ' + $_.Exception.Message) }
  finally {
    # The shared mutex is released only AFTER owned Excel/Host/worker cleanup.
    if ($controllerMutex) {
      if ($controllerMutexAcquired) { try { $controllerMutex.ReleaseMutex() } catch { } }
      $controllerMutex.Dispose()
    }
    if ($ownedExcelProcessPinned) { $ownedExcelProcessPinned.Dispose() }
    if ($worker) { $worker.Dispose() }
    if ($temporaryDirectory -and [IO.Directory]::Exists($temporaryDirectory)) {
      try { [IO.Directory]::Delete($temporaryDirectory, $true) }
      catch { $cleanupErrors.Add('조회 임시 폴더 제거 실패: ' + $_.Exception.Message) }
    }
    Save-ControllerReport
  }
}
if ($success) { exit 0 }
exit 1
