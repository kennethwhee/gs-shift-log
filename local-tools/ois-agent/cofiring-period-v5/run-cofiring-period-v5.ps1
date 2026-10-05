#Requires -Version 5.1
<#
Co-firing period DataPARC V5 controller.
This controller itself does NOT modify the repository, database, Agent, or existing workbooks.
It launches a separate hidden Excel /x, calculates 110 fnTagStat formulas in one batch,
checks start/end boundary value/quality/time plus Min/Max/Delta/DurationGood/DurationBad,
then closes only the owned Excel/DataPARC Host. The web/API layer validates and stores
the canonical result only after the Agent returns the completed period report.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Start,
  [Parameter(Mandatory=$true)][string]$End,
  [ValidateSet('minute','hour','day')][string]$StepUnit = 'hour',
  [ValidateRange(1,1440)][int]$StepValue = 1,
  [string]$OutputDirectory = '',
  [switch]$SkipDiagnosticArchive,
  [switch]$ValidateOnly
)
$controllerClock=[Diagnostics.Stopwatch]::StartNew()
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$OutputEncoding=[Console]::OutputEncoding
$runId=[guid]::NewGuid().ToString('N')
$timeoutSeconds=150
$startupTimeoutSeconds=120
$outerTimeoutSeconds=270
$cleanupGraceSeconds=60
$executionClock=$null
$readyObservedSeconds=$null
$readyEvidence=$null
$readyPath=$null
$deadlinePhase=$null
$controllerFailureCode=$null
$cancelPath=$null
$resultPath=$null
$processCleanupVerified=$false
$worker=$null
$workerSignature=$null
$controllerMutex=$null
$controllerMutexAcquired=$false
$temporaryDirectory=$null
$outputReady=$false
$ownershipPath=$null
$stdoutPath=$null
$stderrPath=$null
$timedOut=$false
$controllerFailure=$null
$rawResult=$null
$success=$false
$workerExitCode=$null
$baselineExcel=@()
$baselineHosts=@()
$ownedExcel=$null
$ownedExcelProcessPinned=$null
$ownedHosts=@()
$cleanupErrors=New-Object 'System.Collections.Generic.List[string]'
$cleanupActions=New-Object 'System.Collections.Generic.List[string]'
$logOffsets=@{}
$utf8=New-Object Text.UTF8Encoding($false)
$expectedWorkerSha256='a84b83ea1f024e779414ac647d3ad3dda7b0bc19888e91a6b18f90b53d1413aa'
$resultZipPath=$null
$controllerTimingMarks=[ordered]@{controller_entered=0.0}
$controllerTimingDurations=[ordered]@{}
$controllerProcessLookup=[ordered]@{nativeCalls=0;missing=0;fallbackCalls=0}
$workerExitUtc=$null
$archiveSucceeded=$null
function Resolve-CofiringPeriod([string]$StartText,[string]$EndText,[string]$Unit,[int]$Value) {
  $startValue=[datetime]::MinValue;$endValue=[datetime]::MinValue
  if (-not [datetime]::TryParseExact($StartText,'yyyy-MM-ddTHH:mm',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$startValue) -or
      -not [datetime]::TryParseExact($EndText,'yyyy-MM-ddTHH:mm',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$endValue)) {
    throw '시작·종료일시는 yyyy-MM-ddTHH:mm 형식이어야 합니다.'
  }
  $minutes=[int]($endValue-$startValue).TotalMinutes
  if($startValue -lt [datetime]'2021-01-01' -or $minutes -lt 1 -or $minutes -gt 44640 -or $endValue -ne $startValue.AddMinutes($minutes)) { throw '조회 기간은 1분 이상 최대 31일까지 지정해 주세요.' }
  $stepMinutes=$(if($Unit -eq 'minute'){$Value}elseif($Unit -eq 'hour'){$Value*60}else{$Value*1440})
  if($stepMinutes -gt $minutes -and $minutes -gt 1){throw '계산 간격이 전체 조회 기간보다 큽니다.'}
  return [pscustomobject]@{Start=$startValue;End=$endValue;QueryEnd=$endValue.AddMinutes(1);DurationMinutes=$minutes;StepUnit=$Unit;StepValue=$Value;StepMinutes=$stepMinutes;TargetDate=$startValue.ToString('yyyy-MM-dd')}
}

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

# COFIRING_CONTROLLER_PROCESS_LOOKUP_V1
# Use a fresh PID lookup on every call. Only the API's missing-positive-PID
# ArgumentException means absence; all other failures keep the legacy fallback.
# Callers retain every handle, identity, parent/session and path check.
function Get-ControllerNativeProcessById([int]$ProcessId) {
  return [Diagnostics.Process]::GetProcessById($ProcessId)
}

function Get-ControllerLegacyProcessById([int]$ProcessId) {
  try { return Get-Process -Id $ProcessId -ErrorAction Stop }
  catch {
    if ($_.FullyQualifiedErrorId -eq 'NoProcessFoundForGivenId,Microsoft.PowerShell.Commands.GetProcessCommand' -and
        $_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound -and
        [string]$_.TargetObject -eq [string]$ProcessId) { return $null }
    throw
  }
}

function Add-ControllerLookupCount([string]$Name) {
  try {
    if ($null -ne $script:controllerProcessLookup) {
      $script:controllerProcessLookup[$Name]=[int]$script:controllerProcessLookup[$Name]+1
    }
  } catch { }
}

function Get-ControllerProcessById([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  Add-ControllerLookupCount 'nativeCalls'
  try {
    $nativeProcess=Get-ControllerNativeProcessById $ProcessId
    if ($null -eq $nativeProcess) { throw [InvalidOperationException]::new('Native process lookup returned no process object.') }
    return $nativeProcess
  }
  catch {
    $lookupException=$_.Exception
    while ($null -ne $lookupException.InnerException -and
      ($lookupException -is [System.Management.Automation.MethodInvocationException] -or
       $lookupException -is [System.Reflection.TargetInvocationException])) {
      $lookupException=$lookupException.InnerException
    }
    if ($lookupException -is [ArgumentException]) {
      Add-ControllerLookupCount 'missing'
      return $null
    }
    Add-ControllerLookupCount 'fallbackCalls'
    return Get-ControllerLegacyProcessById $ProcessId
  }
}

function Set-ControllerTimingMark([string]$Name) {
  try {
    if ($null -ne $script:controllerClock -and -not $script:controllerTimingMarks.Contains($Name)) {
      $script:controllerTimingMarks[$Name]=[Math]::Round($script:controllerClock.Elapsed.TotalSeconds,6)
    }
  } catch { }
}

function Add-ControllerTimingDuration([string]$Name,[double]$Seconds) {
  try {
    if (-not [double]::IsNaN($Seconds) -and -not [double]::IsInfinity($Seconds) -and $Seconds -ge 0) {
      $script:controllerTimingDurations[$Name]=[Math]::Round($Seconds,6)
    }
  } catch { }
}

function Get-ControllerTimingSnapshot {
  try {
  $marks=[ordered]@{};$durations=[ordered]@{};$lookups=[ordered]@{}
  foreach ($key in $script:controllerTimingMarks.Keys) { $marks[$key]=$script:controllerTimingMarks[$key] }
  foreach ($key in $script:controllerTimingDurations.Keys) { $durations[$key]=$script:controllerTimingDurations[$key] }
  foreach ($key in $script:controllerProcessLookup.Keys) { $lookups[$key]=$script:controllerProcessLookup[$key] }
  return [pscustomobject][ordered]@{
    schemaVersion=1;revision='controller-process-lookup-v1'
    elapsedBasis='monotonic_since_first_controller_statement'
    marksSeconds=$marks;durationsSeconds=$durations;processLookup=$lookups
    workerExitUtc=$script:workerExitUtc;archiveSucceeded=$script:archiveSucceeded
    archivePolicy=$(if($SkipDiagnosticArchive){'on_demand'}else{'automatic'})
  }
  } catch { return $null }
}

function Write-ControllerTimingDiagnostic {
  # Optional evidence must never alter query success or cleanup decisions.
  try {
    if ($outputReady -and [IO.Directory]::Exists($OutputDirectory)) {
      $timingDiagnostic=[ordered]@{
        kind='cofiring_controller_timing';schemaVersion=1;runId=$runId
        startLocal=$StartLocal;endLocal=$EndLocal;completedAtUtc=[datetime]::UtcNow.ToString('o')
        timing=(Get-ControllerTimingSnapshot)
      }
      [IO.File]::WriteAllText((Join-Path $OutputDirectory 'controller-timing.json'),(ConvertTo-Json -InputObject $timingDiagnostic -Depth 8),$utf8)
    }
  } catch { }
}

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

function Get-CofiringStableWorkerSignature($ProcessObject,[int]$TimeoutMilliseconds=5000) {
  # Start-Process can return before Process.Path is populated. Readiness later
  # compares the worker's own live executable path, so freeze the controller's
  # worker signature only after the same path field is available.
  $clock=[Diagnostics.Stopwatch]::StartNew()
  $lastError=$null
  while ($clock.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
    try {
      $ProcessObject.Refresh()
      if ($ProcessObject.HasExited) {
        throw '조회 작업 PowerShell이 신원 확인 전에 종료되었습니다.'
      }
      $signature=New-ControllerSignature $ProcessObject
      if (-not [string]::IsNullOrWhiteSpace([string]$signature.Path)) {
        return $signature
      }
    } catch {
      $lastError=$_.Exception
    }
    Start-Sleep -Milliseconds 25
  }
  if ($null -ne $lastError) {
    throw ('조회 작업 PowerShell 신원 확인 실패: '+$lastError.Message)
  }
  throw '조회 작업 PowerShell 실행경로를 5초 안에 확인하지 못했습니다.'
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
  $process = Get-ControllerProcessById ([int]$Signature.ProcessId)
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
    if ($line.StartsWith('__COFIRING_PILOT_RESULT__')) { continue }
    [Console]::WriteLine($line.Replace('__COFIRING_PILOT_STAGE__', '[진행] '))
  }
}

function Get-CofiringDeadlineDecision {
  param(
    [double]$ElapsedSeconds,
    $ReadyObservedSeconds=$null,
    [int]$StartupSeconds=120,
    [int]$ExecutionSeconds=150,
    [int]$OuterSeconds=270
  )
  if ([double]::IsNaN($ElapsedSeconds) -or [double]::IsInfinity($ElapsedSeconds) -or $ElapsedSeconds -lt 0 -or
      $StartupSeconds -le 0 -or $ExecutionSeconds -le 0 -or $OuterSeconds -le 0) { throw '조회 시간 예산 값이 올바르지 않습니다.' }
  if ($null -ne $ReadyObservedSeconds) {
    $ready=[double]$ReadyObservedSeconds
    if ([double]::IsNaN($ready) -or [double]::IsInfinity($ready) -or $ready -lt 0 -or $ready -ge $StartupSeconds -or $ready -gt $ElapsedSeconds) {
      throw '조회 준비 완료 경과시간이 올바르지 않습니다.'
    }
  }
  if ($ElapsedSeconds -ge $OuterSeconds) { return [pscustomobject]@{Expired=$true;Phase='전체';Code='OVERALL_TIMEOUT';DeadlineSeconds=[double]$OuterSeconds} }
  if ($null -eq $ReadyObservedSeconds) {
    return [pscustomobject]@{Expired=($ElapsedSeconds -ge $StartupSeconds);Phase='시작';Code='STARTUP_TIMEOUT';DeadlineSeconds=[double][Math]::Min($StartupSeconds,$OuterSeconds)}
  }
  $deadline=[Math]::Min($ready+$ExecutionSeconds,[double]$OuterSeconds)
  return [pscustomobject]@{Expired=($ElapsedSeconds -ge $deadline);Phase='조회';Code='EXECUTION_TIMEOUT';DeadlineSeconds=$deadline}
}

function Test-CofiringReadySignature($Actual,$Expected) {
  if ($null -eq $Actual -or $null -eq $Expected) { return $false }
  try {
    return (
      [int]$Actual.ProcessId -eq [int]$Expected.ProcessId -and [int]$Actual.ProcessId -gt 0 -and
      [long]$Actual.StartTicks -eq [long]$Expected.StartTicks -and [long]$Actual.StartTicks -gt 0 -and
      [int]$Actual.SessionId -eq [int]$Expected.SessionId -and
      [string]$Actual.ProcessName -ieq [string]$Expected.ProcessName -and
      -not [string]::IsNullOrWhiteSpace([string]$Actual.Path) -and [string]$Actual.Path -ieq [string]$Expected.Path
    )
  } catch { return $false }
}

function Read-CofiringReadyEvidence([string]$Path,[string]$ExpectedRunId,$ExpectedWorker,$ExpectedController) {
  $file=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $file.Length -le 0 -or $file.Length -gt 8192) {
    throw '조회 준비 확인 파일 형식이 올바르지 않습니다.'
  }
  try { $ready=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($file.FullName,[Text.Encoding]::UTF8)) -ErrorAction Stop }
  catch { throw '조회 준비 확인 JSON을 읽을 수 없습니다.' }
  if ($null -eq $ready -or [int]$ready.schemaVersion -ne 1 -or [string]$ready.kind -cne 'cofiring_worker_ready' -or
      [string]$ready.runId -cne $ExpectedRunId -or
      -not (Test-CofiringReadySignature $ready.worker $ExpectedWorker) -or
      -not (Test-CofiringReadySignature $ready.controller $ExpectedController)) {
    throw '조회 준비 확인의 runId 또는 프로세스 신원이 일치하지 않습니다.'
  }
  $stamp=[DateTimeOffset]::MinValue
  $entry=[DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse([string]$ready.atUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$stamp) -or
      -not [DateTimeOffset]::TryParse([string]$ready.workerEntryUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$entry) -or
      $stamp.Offset -ne [TimeSpan]::Zero -or $entry.Offset -ne [TimeSpan]::Zero) { throw '조회 준비 확인 UTC 시각이 올바르지 않습니다.' }
  # UTC is diagnostic metadata. Only the controller Stopwatch governs budgets.
  if ($null -ne $ready.startupDelaySeconds) {
    $delay=[double]$ready.startupDelaySeconds
    if ([double]::IsNaN($delay) -or [double]::IsInfinity($delay) -or $delay -lt 0) { throw '조회 시작 지연시간이 올바르지 않습니다.' }
  }
  return $ready
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
      $process = Get-ControllerProcessById ([int]$candidate.ProcessId)
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
    $candidateProcess = Get-ControllerProcessById ([int]$script:ownedExcel.ProcessId)
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
    $process = Get-ControllerProcessById ([int]$candidate.ProcessId)
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
  $process = Get-ControllerProcessById ([int]$Signature.ProcessId)
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
  $ownershipPassClock=[Diagnostics.Stopwatch]::StartNew()
  try { Update-ControllerOwnership } catch { $cleanupErrors.Add('소유 프로세스 확인: '+$_.Exception.Message) } finally { Add-ControllerTimingDuration 'ownership_before_cancel' $ownershipPassClock.Elapsed.TotalSeconds }
  if (Test-ControllerSignature $workerSignature) {
    # Request cooperative cancellation first. Never kill Excel underneath a live worker.
    if ($cancelPath) { [IO.File]::WriteAllText($cancelPath,'cancel',$utf8) }
    [Console]::WriteLine('[정리] 작업 프로세스에 중단 요청 · 최대 '+$cleanupGraceSeconds+'초 정상 종료 대기')
    try { [void]$worker.WaitForExit($cleanupGraceSeconds*1000) } catch { }
  }
  if (Test-ControllerSignature $workerSignature) {
    Stop-ControllerSignature $workerSignature '조회용 PowerShell' -CheckParent
  }
  if (Test-ControllerSignature $workerSignature) {
    $cleanupErrors.Add('작업 프로세스가 살아 있어 Excel 선행 강제 종료를 차단했습니다.')
    return
  }
  $ownershipPassClock=[Diagnostics.Stopwatch]::StartNew()
  try { Update-ControllerOwnership } catch { $cleanupErrors.Add('종료 후 소유 프로세스 확인: '+$_.Exception.Message) } finally { Add-ControllerTimingDuration 'ownership_after_worker_exit' $ownershipPassClock.Elapsed.TotalSeconds }
  # Worker is now stopped; only exact owned process identities are eligible.
  Stop-ControllerSignature $script:ownedExcel '조회용 Excel' -CheckParent
  foreach ($signature in @($script:ownedHosts)) { Stop-ControllerSignature $signature '조회용 DataPARC Host' -CheckParent }
  $ownershipPassClock=[Diagnostics.Stopwatch]::StartNew()
  try { Update-ControllerOwnership } catch { $cleanupErrors.Add('지연 소유 프로세스 확인: '+$_.Exception.Message) } finally { Add-ControllerTimingDuration 'ownership_after_forced_cleanup' $ownershipPassClock.Elapsed.TotalSeconds }
  Stop-ControllerSignature $script:ownedExcel '조회용 Excel' -CheckParent
  foreach ($signature in @($script:ownedHosts)) { Stop-ControllerSignature $signature '조회용 DataPARC Host' -CheckParent }
  foreach ($signature in @($script:ownedExcel)+@($script:ownedHosts)+@($workerSignature)) {
    if ($null -ne $signature -and (Test-ControllerSignature $signature)) {
      $cleanupErrors.Add('소유 프로세스가 남아 있습니다. PID='+[string]$signature.ProcessId)
    }
  }
}

function Test-CofiringCleanupEvidence($RawResult, [bool]$ProcessesVerified, [int]$ErrorCount, $OwnedExcel) {
  # A query exception/nonzero exit is NOT evidence that Excel failed to exit.
  # Result identity is checked by Save-ControllerReport before calling this function.
  return [bool]($null -ne $RawResult -and $RawResult.cleanupVerified -is [bool] -and
    $RawResult.cleanupVerified -eq $true -and $ProcessesVerified -and $ErrorCount -eq 0 -and $null -ne $OwnedExcel)
}

function Test-CofiringExecutionEvidence($ExitCode, [bool]$WasTimedOut, [string]$Failure) {
  # Kept separate from cleanup to prevent a failed query from becoming PASS/REFERENCE_UNVERIFIED.
  return [bool]($null -ne $ExitCode -and $ExitCode -eq 0 -and -not $WasTimedOut -and [string]::IsNullOrWhiteSpace($Failure))
}

function Save-FastControllerReport {
  if (-not $outputReady) { return }
  try {
    $script:rawResult=$null
    if ($resultPath -and [IO.File]::Exists($resultPath)) {
      try {
        $candidate=([IO.File]::ReadAllText($resultPath,[Text.Encoding]::UTF8) | ConvertFrom-Json)
        if ($candidate.kind -eq 'cofiring_dataparc_fast_summary_pilot' -and [string]$candidate.runId -eq $runId -and
            [string]$candidate.start -eq $StartText -and [string]$candidate.end -eq $EndText) { $script:rawResult=$candidate }
        else { $cleanupErrors.Add('결과 파일 runId/날짜/kind 불일치') }
      } catch { $cleanupErrors.Add('결과 파일 파싱 실패: '+$_.Exception.Message) }
    }
    if ($rawResult) {
      foreach ($action in @($rawResult.cleanupActions)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$action)) { $cleanupActions.Add('Worker: '+[string]$action) }
      }
      foreach ($message in @($rawResult.cleanupErrors)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$message)) { $cleanupErrors.Add('Worker: '+[string]$message) }
      }
    } elseif (-not $controllerFailure) { $script:controllerFailure='완성된 고속 요약 결과 파일이 없습니다.' }

    $cleanupVerified=Test-CofiringCleanupEvidence $rawResult ([bool]$processCleanupVerified) $cleanupErrors.Count $ownedExcel
    $executionSucceeded=Test-CofiringExecutionEvidence $workerExitCode ([bool]$timedOut) ([string]$controllerFailure)
    $summaryReady=($null -ne $rawResult -and $rawResult.summaryReady -is [bool] -and $rawResult.summaryReady -eq $true)
    $referenceGate=$true
    if ($null -ne $rawResult -and [int]$rawResult.referenceCompared -gt 0) {
      $referenceGate=($rawResult.referenceMatched -is [bool] -and $rawResult.referenceMatched -eq $true)
    }
    $script:success=($cleanupVerified -and $executionSucceeded -and $summaryReady -and $referenceGate)
    $status='FAIL'
    if ($cleanupVerified -and $executionSucceeded -and $summaryReady -and -not $referenceGate) { $status='REFERENCE_MISMATCH' }
    elseif ($cleanupVerified -and $executionSucceeded -and $summaryReady -and $rawResult.anyBadDuration -eq $true) { $status='FAST_DATA_GAPS' }
    elseif ($cleanupVerified -and $executionSucceeded -and $summaryReady) { $status='FAST_READY' }
    elseif ($cleanupVerified -and $executionSucceeded) { $status='FAST_DIAGNOSTIC_ONLY' }

    $baselineSeconds=$null
    # Period mode has no fixed full-day performance baseline.
    $workerElapsed=$null;$speedup=$null
    if ($rawResult -and $null -ne $rawResult.elapsedSeconds) { $workerElapsed=[double]$rawResult.elapsedSeconds }
    if ($null -ne $baselineSeconds -and $null -ne $workerElapsed -and $workerElapsed -gt 0) { $speedup=[Math]::Round($baselineSeconds/$workerElapsed,2) }

    $periodStatus='FAIL'
    if ($cleanupVerified -and $executionSucceeded -and $summaryReady -and $rawResult.anyBadDuration -eq $true) { $periodStatus='PERIOD_DATA_GAPS' }
    elseif ($cleanupVerified -and $executionSucceeded -and $summaryReady) { $periodStatus='PERIOD_READY' }
    $script:success=($periodStatus -in @('PERIOD_READY','PERIOD_DATA_GAPS'))
    Set-ControllerTimingMark 'report_assembled'
    $report=[ordered]@{
      schemaVersion=1;kind='cofiring_dataparc_period_report';runId=$runId;status=$periodStatus
      targetDate=$period.TargetDate;startLocal=$StartLocal;endLocal=$EndLocal;stepUnit=$StepUnit;stepValue=$StepValue;queryEndLocal=$period.QueryEnd.ToString('yyyy-MM-ddTHH:mm')
      diagnosticOnly=$true;dataValidated=$false;productionReady=$false;databaseWritten=$false;completedAtUtc=[datetime]::UtcNow.ToString('o')
      executionSucceeded=[bool]$executionSucceeded;cleanupVerified=[bool]$cleanupVerified;processCleanupVerified=[bool]$processCleanupVerified
      timedOut=[bool]$timedOut;deadlinePhase=$deadlinePhase;controllerFailureCode=$controllerFailureCode;workerExitCode=$workerExitCode;controllerFailure=$controllerFailure;cleanupErrors=@($cleanupErrors.ToArray());cleanupActions=@($cleanupActions.ToArray())
      formulaCells=$(if($rawResult){$rawResult.formulaCells}else{143});queryElapsedSeconds=$(if($rawResult){$rawResult.queryElapsedSeconds}else{$null});workerElapsedSeconds=$workerElapsed
      timing=[ordered]@{startupBudgetSeconds=$startupTimeoutSeconds;executionBudgetSeconds=$timeoutSeconds;outerBudgetSeconds=$outerTimeoutSeconds;cleanupGraceSeconds=$cleanupGraceSeconds;readyObservedSeconds=$readyObservedSeconds;controllerElapsedSeconds=$(if($executionClock){[Math]::Round($executionClock.Elapsed.TotalSeconds,3)}else{$null});workerProcessCreatedUtc=$(if($workerSignature){([datetime]::new([long]$workerSignature.StartTicks,[DateTimeKind]::Utc)).ToString('o')}else{$null});controllerProcessCreatedUtc=$(if($controllerSignature){([datetime]::new([long]$controllerSignature.StartTicks,[DateTimeKind]::Utc)).ToString('o')}else{$null});worker=$(if($rawResult){$rawResult.timing}else{$null});controllerPhases=(Get-ControllerTimingSnapshot)}
      summaryReady=$(if($rawResult){$rawResult.summaryReady}else{$false});anyBadDuration=$(if($rawResult){$rawResult.anyBadDuration}else{$null})
      referenceCompared=$(if($rawResult){$rawResult.referenceCompared}else{0});referenceMismatches=$(if($rawResult){$rawResult.referenceMismatches}else{0})
      unitUsage=$(if($rawResult){$rawResult.unitUsage}else{$null});summaries=$(if($rawResult){$rawResult.summaries}else{@()})
      organicInventoryReady=$(if($rawResult){[bool]$rawResult.organicInventoryReady}else{$false})
      organicInventory=$(if($rawResult){$rawResult.organicInventory}else{$null})
      note='Coal/Bio는 누적계 시작/끝 경계 차이로 계산합니다. 유기성 재고는 Day Silo + Storage A + Storage B의 시작/종료 경계를 별도로 제공합니다.'
    }
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'period-report.json'),($report | ConvertTo-Json -Depth 12),$utf8)
    Set-ControllerTimingMark 'report_json_written'
    $lines=New-Object 'System.Collections.Generic.List[string]'
    $lines.Add('===== COFIRING DATAPARC PERIOD V5 =====')
    $lines.Add('Status: '+$periodStatus)
    $lines.Add('Period: '+$StartLocal+' ~ '+$EndLocal+' / Query boundary: '+$StartText+' ~ '+$QueryEnd+' / interval '+$StepValue+' '+$StepUnit)
    $lines.Add('Formula cells: '+[string]$report.formulaCells+' (V7 was 43,230 scalar result cells/day)')
    $lines.Add('DataPARC summary calculation: '+[string]$report.queryElapsedSeconds+' sec')
    $lines.Add('Worker total including Excel start/cleanup: '+[string]$workerElapsed+' sec')
    if ($null -ne $baselineSeconds) { $lines.Add('Observed V7 same-date total: '+[string]$baselineSeconds+' sec / speedup: '+[string]$speedup+'x') }
    $lines.Add('Reference comparison: '+[string]$report.referenceCompared+'/10 / mismatches '+[string]$report.referenceMismatches)
    $lines.Add('Bad-quality duration exists: '+[string]$report.anyBadDuration)
    if ($report.unitUsage) {
      $lines.Add(('Unit1 coal/bio: '+[string]$report.unitUsage.unit1.coal+' / '+[string]$report.unitUsage.unit1.bio+' ton'))
      $lines.Add(('Unit2 coal/bio: '+[string]$report.unitUsage.unit2.coal+' / '+[string]$report.unitUsage.unit2.bio+' ton'))
    }
    if ($report.organicInventoryReady -and $report.organicInventory) {
      $lines.Add(('Organic inventory start/end: '+[string]$report.organicInventory.start.total+' / '+[string]$report.organicInventory.end.total+' ton'))
    } else {
      $lines.Add('Organic inventory boundary: unavailable')
    }
    foreach ($item in @($report.summaries)) {
      $lines.Add(([string]$item.key+' usage='+[string]$item.usageTon+' ton / bad='+[string]$item.durationBadSeconds+' sec / ref='+[string]$item.referenceMatched))
    }
    $lines.Add('Cleanup verified: '+[string]$cleanupVerified+' / process cleanup: '+[string]$processCleanupVerified)
    $lines.Add('Diagnostic only: no DB, no Git, no Agent change, no existing workbook save.')
    [IO.File]::WriteAllLines((Join-Path $OutputDirectory 'period-report.txt'),$lines,$utf8)
    [Console]::WriteLine('===== FAST SUMMARY RESULT =====')
    foreach ($line in $lines) { [Console]::WriteLine($line) }
  } catch {
    $cleanupErrors.Add('최종 보고서 작성 실패: '+$_.Exception.Message)
    $script:success=$false
  }
}

# COFIRING_PHASE2_ON_DEMAND_ARCHIVE: diagnostic files remain available in the run directory.
# Agent callers opt out of packaging; standalone diagnostic runs retain automatic ZIP creation.
function Complete-CofiringDiagnosticArchive {
  if (-not $outputReady -or -not [IO.Directory]::Exists($OutputDirectory)) { return }
  if ($SkipDiagnosticArchive) {
    Set-ControllerTimingMark 'archive_skipped'
    [Console]::WriteLine('진단 원본 폴더: '+$OutputDirectory+' / ZIP은 필요할 때 수집합니다.')
    return
  }
  try {
    Set-ControllerTimingMark 'archive_begin'
    $script:archiveSucceeded=$false
    $resultZipPath=$OutputDirectory+'.zip'
    if (Test-Path -LiteralPath $resultZipPath) { Remove-Item -LiteralPath $resultZipPath -Force }
    Compress-Archive -Path (Join-Path $OutputDirectory '*') -DestinationPath $resultZipPath -CompressionLevel Optimal
    $script:archiveSucceeded=$true
    [Console]::WriteLine('결과 ZIP: '+$resultZipPath)
  } catch { [Console]::WriteLine('[경고] 결과 ZIP 생성 실패: '+$_.Exception.Message) }
  finally { Set-ControllerTimingMark 'archive_end' }
}

try {
  $period=Resolve-CofiringPeriod $Start $End $StepUnit $StepValue
  $parsedStart=$period.Start;$parsedEnd=$period.End
  $StartLocal=$parsedStart.ToString('yyyy-MM-ddTHH:mm');$EndLocal=$parsedEnd.ToString('yyyy-MM-ddTHH:mm')
  $StartText=$parsedStart.ToString('yyyy-MM-dd HH:mm');$EndText=$parsedEnd.ToString('yyyy-MM-dd HH:mm');$QueryEnd=$period.QueryEnd.ToString('yyyy-MM-dd HH:mm')
  $workerSource=Join-Path $PSScriptRoot 'cofiring-period-worker-v5.ps1'
  if (-not [IO.File]::Exists($workerSource)) { throw '같은 폴더의 cofiring-period-worker-v5.ps1을 찾을 수 없습니다.' }
  $actualHash=(Get-FileHash -LiteralPath $workerSource -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -cne $expectedWorkerSha256) { throw ('Worker 파일이 패키지와 다릅니다. Expected '+$expectedWorkerSha256+' / Actual '+$actualHash) }
  $workerText=[IO.File]::ReadAllText($workerSource,[Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
  $parseTokens=$null;$parseErrors=$null
  [void][System.Management.Automation.Language.Parser]::ParseInput($workerText,[ref]$parseTokens,[ref]$parseErrors)
  if (@($parseErrors).Count -gt 0) { throw ('Worker PowerShell 구문 오류: '+(($parseErrors | ForEach-Object { $_.Message }) -join ' | ')) }
  foreach ($required in @('cofiring_dataparc_fast_summary_pilot','parallel-summary','DurationGood','DurationBad','cofiringInventoryTags','organicInventoryReady')) {
    if (-not $workerText.Contains($required)) { throw ('Worker 고속 요약 계약 누락: '+$required) }
  }
  if ($workerText.Contains("queryMode='one-tag-at-a-time'")) { throw 'V7 순차 10-TAG 조회 블록이 남아 있습니다.' }
  if ($workerText.Contains('$cofiringManifest.reference') -or $workerText.Contains('$referenceTimestampIndices')) { throw 'V8 실패 원인이었던 V7 reference-cache 초기화 블록이 남아 있습니다.' }
  foreach ($requiredCompilerToken in @('GS_COFIRING_COMPILER_TEMP','Assert-CofiringCompilerTemp','NativeOM Add-Type 컴파일 실패')) {
    if (-not $workerText.Contains($requiredCompilerToken)) { throw ('Worker compiler-temp 격리 계약 누락: '+$requiredCompilerToken) }
  }
  if ($ValidateOnly) {
    [Console]::WriteLine('PASS: COFIRING PERIOD V5 parser / hash / compiler-temp isolation / period boundary / 143-formula + organic-inventory contract. Excel은 시작하지 않았습니다.')
    exit 0
  }
  if ($env:OS -ne 'Windows_NT') { throw '회사 Windows PC에서 실행해 주세요.' }
  $zone=[TimeZoneInfo]::FindSystemTimeZoneById('Korea Standard Time')
  $nowKst=[TimeZoneInfo]::ConvertTime([DateTimeOffset]::Now,$zone).DateTime
  if ($period.QueryEnd -gt $nowKst) { throw ('아직 종료 경계가 완료되지 않았습니다. '+$QueryEnd+' 이후 조회할 수 있습니다.') }

  $controllerProcess=Get-Process -Id $PID -ErrorAction Stop
  try { $controllerSignature=New-ControllerSignature $controllerProcess } finally { $controllerProcess.Dispose() }
  $expectedExcelPath=Resolve-ControllerExcelExecutable
  $controllerMutex=[Threading.Mutex]::new($false,'Local\GSShiftLog.BlowerRuntimeDataParcHiddenExcelNativeOmV1')
  try { $controllerMutexAcquired=[bool]$controllerMutex.WaitOne(0,$false) } catch [Threading.AbandonedMutexException] { $controllerMutexAcquired=$true }
  if (-not $controllerMutexAcquired) { throw '다른 DataPARC 숨김 Excel 조회가 진행 중입니다. 기존 조회가 끝난 뒤 다시 실행해 주세요.' }

  foreach ($process in @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Where-Object { [int]$_.SessionId -eq [int]$controllerSignature.SessionId })) {
    try { $baselineExcel+=New-ControllerSignature $process } finally { $process.Dispose() }
  }
  foreach ($process in @(Get-Process -Name 'CTCExcelAddIn.PARCviewHost' -ErrorAction SilentlyContinue | Where-Object { [int]$_.SessionId -eq [int]$controllerSignature.SessionId })) {
    try { $baselineHosts+=New-ControllerSignature $process } finally { $process.Dispose() }
  }
  if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory=Join-Path (Join-Path $env:USERPROFILE 'Downloads') ('cofiring-period-v5-'+$period.TargetDate+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+$runId.Substring(0,8))
  }
  $OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
  [void][IO.Directory]::CreateDirectory($OutputDirectory)
  foreach ($name in @('pilot-result.json','period-report.json','raw-diagnostics.json','worker-stdout.log','worker-stderr.log')) {
    if ([IO.File]::Exists((Join-Path $OutputDirectory $name))) { throw '출력 폴더에 기존 결과가 있습니다. 다른 OutputDirectory를 지정해 주세요.' }
  }
  $outputReady=$true
  [IO.File]::WriteAllText((Join-Path $OutputDirectory 'raw-diagnostics.json'),([ordered]@{kind='cofiring_dataparc_fast_summary_raw';runId=$runId;targetDate=$period.TargetDate;startLocal=$StartLocal;endLocal=$EndLocal;stepUnit=$StepUnit;stepValue=$StepValue;failure='worker waiting';diagnosticOnly=$true} | ConvertTo-Json),$utf8)
  $temporaryDirectory=Join-Path ([IO.Path]::GetTempPath()) ('gs-cofiring-fast-summary-'+$runId)
  [void][IO.Directory]::CreateDirectory($temporaryDirectory)
  $compilerTempDirectory=Join-Path $temporaryDirectory 'compiler-temp'
  [void][IO.Directory]::CreateDirectory($compilerTempDirectory)
  $compilerProbe=Join-Path $compilerTempDirectory ('controller-write-test-'+[guid]::NewGuid().ToString('N')+'.tmp')
  try {
    [IO.File]::WriteAllText($compilerProbe,'ok',$utf8)
    if (-not [IO.File]::Exists($compilerProbe)) { throw 'Add-Type 전용 임시 폴더 쓰기 시험에 실패했습니다.' }
  } finally {
    if ([IO.File]::Exists($compilerProbe)) { try { [IO.File]::Delete($compilerProbe) } catch { } }
  }
  $workerPath=Join-Path $temporaryDirectory 'cofiring-period-worker-v5.ps1'
  [IO.File]::WriteAllText($workerPath,$workerText,(New-Object Text.UTF8Encoding($true)))
  $ownershipPath=Join-Path $temporaryDirectory 'ownership.json'
  $cancelPath=Join-Path $temporaryDirectory 'cancel.request'
  $readyPath=Join-Path $temporaryDirectory 'ready.json'
  $resultPath=Join-Path $OutputDirectory 'pilot-result.json'
  $stdoutPath=Join-Path $OutputDirectory 'worker-stdout.log'
  $stderrPath=Join-Path $OutputDirectory 'worker-stderr.log'
  $powerShellPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not [IO.File]::Exists($powerShellPath)) { throw 'Windows PowerShell 5.1 실행 파일을 찾을 수 없습니다.' }
  [Console]::WriteLine('===== COFIRING DATAPARC PERIOD V5 =====')
  [Console]::WriteLine('기간: '+$StartLocal+' ~ '+$EndLocal+' / DataPARC boundary: '+$StartText+' ~ '+$QueryEnd+' / interval '+$StepValue+' '+$StepUnit)
  [Console]::WriteLine('V7 43,230개 scalar 결과 대신 110개 fnTagStat 요약 수식을 한 번에 계산합니다.')
  [Console]::WriteLine('읽기 전용 속도 시험입니다. DB/Git/Agent/기존 Excel 파일을 수정하지 않습니다.')
  $workerEnvironment=@{
    GS_COFIRING_START=$StartText;GS_COFIRING_END=$EndText;GS_COFIRING_STEP_UNIT=$StepUnit;GS_COFIRING_STEP_VALUE=$StepValue;GS_COFIRING_DIAGNOSTICS_PATH=(Join-Path $OutputDirectory 'raw-diagnostics.json')
    GS_COFIRING_RUN_ID=$runId;GS_COFIRING_CANCEL_PATH=$cancelPath;GS_COFIRING_RESULT_PATH=$resultPath;GS_COFIRING_READY_PATH=$readyPath
    GS_COFIRING_COM_TRACE_PATH=(Join-Path $OutputDirectory 'com-calls.jsonl');GS_COFIRING_PARTIAL_PATH='';GS_COFIRING_OWNERSHIP_PATH=$ownershipPath
    GS_COFIRING_CONTROLLER_SIGNATURE=($controllerSignature | ConvertTo-Json -Compress)
    # COFIRING_CONTROLLER_RUNTIME_TEMP_PARITY_V7
    # Worker inherits its normal runtime TEMP/TMP. The worker scopes compiler-temp only around Add-Type.
    GS_COFIRING_COMPILER_TEMP=$compilerTempDirectory
  }
  $priorEnvironment=@{}
  try {
    foreach ($key in $workerEnvironment.Keys) { $priorEnvironment[$key]=[Environment]::GetEnvironmentVariable($key,'Process');[Environment]::SetEnvironmentVariable($key,[string]$workerEnvironment[$key],'Process') }
    Set-ControllerTimingMark 'worker_launch_begin'
    $executionClock=[Diagnostics.Stopwatch]::StartNew()
    $worker=Start-Process -FilePath $powerShellPath -ArgumentList @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',('"'+$workerPath+'"')) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $workerSignature=Get-CofiringStableWorkerSignature $worker
    $workerSignature | Add-Member -NotePropertyName ParentProcessId -NotePropertyValue ([int]$controllerSignature.ProcessId)
    Set-ControllerTimingMark 'worker_signature_ready'
  } finally {
    foreach ($key in $priorEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key,$priorEnvironment[$key],'Process') }
  }
  while ($true) {
    $worker.Refresh()
    # A completed worker with previously validated readiness goes through the
    # existing result/cleanup gates. Log polling cannot retroactively time it out.
    if ($worker.HasExited -and $null -ne $readyObservedSeconds) { break }
    Show-ControllerLog $stdoutPath;Show-ControllerLog $stderrPath
    $elapsed=[double]$executionClock.Elapsed.TotalSeconds
    # Check before accepting readiness, so a late file cannot revive an expired run.
    $budget=Get-CofiringDeadlineDecision $elapsed $readyObservedSeconds $startupTimeoutSeconds $timeoutSeconds $outerTimeoutSeconds
    if ($budget.Expired) {
      $timedOut=$true;$deadlinePhase=$budget.Phase;$controllerFailureCode=$budget.Code
      throw ('혼소율 '+$budget.Phase+' 제한시간을 초과했습니다. 경과 '+[Math]::Round($elapsed,1)+'초. 소유 프로세스를 정리합니다.')
    }
    if ($null -eq $readyObservedSeconds -and [IO.File]::Exists($readyPath)) {
      $readyEvidence=Read-CofiringReadyEvidence $readyPath $runId $workerSignature $controllerSignature
      $elapsed=[double]$executionClock.Elapsed.TotalSeconds
      $budget=Get-CofiringDeadlineDecision $elapsed $null $startupTimeoutSeconds $timeoutSeconds $outerTimeoutSeconds
      if ($budget.Expired) {
        $timedOut=$true;$deadlinePhase=$budget.Phase;$controllerFailureCode=$budget.Code
        throw '조회 준비 확인 중 시작 제한시간이 만료되었습니다. 소유 프로세스를 정리합니다.'
      }
      $readyObservedSeconds=$elapsed
      [Console]::WriteLine('[준비 완료] 프로세스 시작 후 '+[Math]::Round($elapsed,1)+'초 · 조회/정리 최대 '+$timeoutSeconds+'초 · 전체 최대 '+$outerTimeoutSeconds+'초')
    }
    if ($worker.HasExited) {
      if ($null -eq $readyObservedSeconds) { throw '검증된 조회 준비 완료 기록 없이 작업 프로세스가 종료되었습니다.' }
      break
    }
    Start-Sleep -Milliseconds 300
  }
  Set-ControllerTimingMark 'worker_exit_observed'
  try { $workerExitUtc=$worker.ExitTime.ToUniversalTime().ToString('o') } catch { }
  [void]$worker.WaitForExit(1000)
  $workerExitCode=[int]$worker.ExitCode
} catch {
  $controllerFailure=$_.Exception.Message
  [Console]::WriteLine('[실패] '+$controllerFailure)
} finally {
  try {
    Set-ControllerTimingMark 'controller_cleanup_begin'
    try { Invoke-ControllerCleanup } finally { Set-ControllerTimingMark 'controller_cleanup_end' }
    Set-ControllerTimingMark 'baseline_verification_begin'
    foreach ($signature in @($baselineExcel)+@($baselineHosts)) {
      if (-not (Test-ControllerSignature $signature)) { $cleanupErrors.Add('기존 사용자 프로세스가 조회 중 변경되거나 종료되었습니다. PID='+[string]$signature.ProcessId) }
    }
    Set-ControllerTimingMark 'baseline_verification_end'
    $script:processCleanupVerified=($cleanupErrors.Count -eq 0 -and $null -ne $workerSignature -and $null -ne $ownedExcel)
    Set-ControllerTimingMark 'cleanup_diagnostics_begin'
    if ($outputReady) {
      if ($readyEvidence) {
        try { [IO.File]::WriteAllText((Join-Path $OutputDirectory 'worker-ready.json'),(ConvertTo-Json -InputObject $readyEvidence -Depth 8),$utf8) }
        catch { try { [Console]::WriteLine('[진단] 준비 확인 기록을 복사하지 못했습니다. 원본 조회 결과와 정리 검증은 유지합니다.') } catch { } }
      }
      if ($ownershipPath -and [IO.File]::Exists($ownershipPath)) { [IO.File]::Copy($ownershipPath,(Join-Path $OutputDirectory 'ownership.json'),$true) }
      [IO.File]::WriteAllText((Join-Path $OutputDirectory 'process-cleanup.json'),([ordered]@{runId=$runId;processCleanupVerified=[bool]$processCleanupVerified;errors=@($cleanupErrors.ToArray());actions=@($cleanupActions.ToArray())} | ConvertTo-Json -Depth 10),$utf8)
    }
    if ($stdoutPath) { Show-ControllerLog $stdoutPath -Final }
    if ($stderrPath) { Show-ControllerLog $stderrPath -Final }
    if ($worker -and $worker.HasExited) {
      $workerExitCode=[int]$worker.ExitCode
      if ($null -eq $workerExitUtc) { try { $workerExitUtc=$worker.ExitTime.ToUniversalTime().ToString('o') } catch { } }
      Set-ControllerTimingMark 'worker_exit_observed'
    }
    Set-ControllerTimingMark 'cleanup_diagnostics_end'
  } catch { $cleanupErrors.Add('정리 관리 오류: '+$_.Exception.Message) }
  finally {
    Set-ControllerTimingMark 'resource_release_begin'
    if ($controllerMutex) { if ($controllerMutexAcquired) { try { $controllerMutex.ReleaseMutex() } catch { } };$controllerMutex.Dispose() }
    if ($ownedExcelProcessPinned) { $ownedExcelProcessPinned.Dispose() }
    if ($worker) { $worker.Dispose() }
    Set-ControllerTimingMark 'resource_release_end'
    Set-ControllerTimingMark 'temporary_directory_cleanup_begin'
    if ($temporaryDirectory -and [IO.Directory]::Exists($temporaryDirectory)) { try { [IO.Directory]::Delete($temporaryDirectory,$true) } catch { $cleanupErrors.Add('조회 임시 폴더 제거 실패: '+$_.Exception.Message) } }
    Set-ControllerTimingMark 'temporary_directory_cleanup_end'
    Set-ControllerTimingMark 'report_build_begin'
    Save-FastControllerReport
    Set-ControllerTimingMark 'report_write_end'
    Complete-CofiringDiagnosticArchive
    Write-ControllerTimingDiagnostic
  }
}
if ($success) { exit 0 }
exit 1

