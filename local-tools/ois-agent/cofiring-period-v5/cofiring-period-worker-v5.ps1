#Requires -Version 5.1
<#
Worker lifecycle extracted from DATAPARC_BLOWER_RUNTIME_PROBE_POWERSHELL_SCRIPT.
Co-firing fast summary read-only PERIOD V5. Configuration and selected-day query are embedded below.
No workbook is saved. The worker attaches only to its separately launched Excel /x PID.
Run this worker in a separate powershell.exe -NoProfile -STA process under a controller
with a wall-clock timeout, since a COM call can block beyond PowerShell loop deadlines.

CONFIG BLOCK must set $stageMarker, $resultMarker and $probeWorkbookMarker, and validate
all query inputs before Excel launches. QUERY BLOCK must assign $finalResult.
The wrapper must preserve the shared mutex string used by the Blower collector.
#>
$workerEntryUtc = [datetime]::UtcNow
$workerClock = [Diagnostics.Stopwatch]::StartNew()
$workerProcessStartUtc = $null
$workerStartupDelaySeconds = $null
$workerReadyUtc = $null

# COFIRING_WORKER_PROCESS_LOOKUP_V1
$script:cofiringWorkerPhases = New-Object 'System.Collections.Generic.List[object]'
$script:cofiringWorkerLookup = [ordered]@{calls=0;missing=0;errors=0;elapsedSeconds=0.0}

# Telemetry never changes the success stream or the query/cleanup decision.
function Start-CofiringWorkerPhase([string]$Name) {
  try {
    $at=[double]$script:workerClock.Elapsed.TotalSeconds
    [void]$script:cofiringWorkerPhases.Add([ordered]@{
      name=$Name;startedSeconds=[Math]::Round($at,6);finishedSeconds=$null
      elapsedSeconds=$null;outcome='running'
    })
  } catch { }
}

function Complete-CofiringWorkerPhase([string]$Name,[string]$Outcome='complete') {
  try {
    for ($index=$script:cofiringWorkerPhases.Count-1;$index -ge 0;$index-=1) {
      $phase=$script:cofiringWorkerPhases[$index]
      if ($phase.name -eq $Name -and $phase.outcome -eq 'running') {
        $at=[double]$script:workerClock.Elapsed.TotalSeconds
        $phase.finishedSeconds=[Math]::Round($at,6)
        $phase.elapsedSeconds=[Math]::Round([Math]::Max(0.0,$at-[double]$phase.startedSeconds),6)
        $phase.outcome=$Outcome
        return
      }
    }
  } catch { }
}

function Complete-CofiringOpenWorkerPhases([string]$Outcome='interrupted') {
  try {
    foreach ($phase in $script:cofiringWorkerPhases) {
      if ($phase.outcome -eq 'running') { Complete-CofiringWorkerPhase ([string]$phase.name) $Outcome }
    }
  } catch { }
}

function Get-CofiringWorkerPhaseSnapshot {
  try { return @($script:cofiringWorkerPhases.ToArray()) }
  catch { return @() }
}

# Only the OS API's absent-positive-PID ArgumentException proves absence.
# Every poll performs a fresh lookup; no live checks or process identities are cached.
function Get-CofiringWorkerNativeProcess([int]$ProcessId) {
  return [Diagnostics.Process]::GetProcessById($ProcessId)
}

function Test-CofiringWorkerProcessPresent([int]$ProcessId) {
  if ($ProcessId -le 0) { throw [ArgumentOutOfRangeException]::new('ProcessId') }
  $lookupClock=[Diagnostics.Stopwatch]::StartNew()
  $process=$null
  try {
    try { $script:cofiringWorkerLookup.calls+=1 } catch { }
    try { $process=Get-CofiringWorkerNativeProcess $ProcessId }
    catch {
      $lookupException=$_.Exception
      while ($null -ne $lookupException.InnerException -and
        ($lookupException -is [System.Management.Automation.MethodInvocationException] -or
         $lookupException -is [System.Reflection.TargetInvocationException])) {
        $lookupException=$lookupException.InnerException
      }
      if ($lookupException -is [ArgumentException]) {
        try { $script:cofiringWorkerLookup.missing+=1 } catch { }
        return $false
      }
      try { $script:cofiringWorkerLookup.errors+=1 } catch { }
      throw
    }
    if ($null -eq $process) { throw [InvalidOperationException]::new('Process lookup returned no process without an absence exception.') }
    return $true
  } finally {
    try { if ($null -ne $process) { $process.Dispose() } }
    finally {
      try { $script:cofiringWorkerLookup.elapsedSeconds+=$lookupClock.Elapsed.TotalSeconds } catch { }
    }
  }
}
# COFIRING_NATIVEOM_DOCUMENT_FIRST_V2
# Diagnostics are bounded and best effort; they never decide query validity or ownership.
$script:cofiringNativeOmEvents=New-Object 'System.Collections.Generic.List[object]'
$script:cofiringNativeOmTotals=[ordered]@{}
$script:cofiringNativeOmDropped=0
function Start-CofiringNativeOmSpan([string]$Name,[int]$Attempt,[int]$Scan,[long]$Handle=0,[string]$WindowClass='') {
  try {
    $span=[ordered]@{
      name=$Name;attachAttempt=$Attempt;scan=$Scan;handle=[string]$Handle;windowClass=$WindowClass
      startedSeconds=[double]$script:workerClock.Elapsed.TotalSeconds
      finishedSeconds=$null;elapsedSeconds=$null;outcome='running'
    }
    if ($script:cofiringNativeOmEvents.Count -lt 128) { [void]$script:cofiringNativeOmEvents.Add($span) }
    else { $script:cofiringNativeOmDropped+=1 }
    try { Write-CofiringComTrace ('Attach.'+$Name) 'begin' $Attempt @{scan=$Scan;handle=[string]$Handle;windowClass=$WindowClass;startedSeconds=$span.startedSeconds} } catch { }
    return $span
  } catch { return $null }
}
function Complete-CofiringNativeOmSpan($Span,[string]$Outcome='returned') {
  if ($null -eq $Span) { return }
  try {
    $Span.finishedSeconds=[double]$script:workerClock.Elapsed.TotalSeconds
    $Span.elapsedSeconds=[Math]::Max(0.0,$Span.finishedSeconds-$Span.startedSeconds)
    $Span.outcome=$Outcome
    if (-not $script:cofiringNativeOmTotals.Contains($Span.name)) {
      $script:cofiringNativeOmTotals[$Span.name]=[ordered]@{calls=0;elapsedSeconds=0.0}
    }
    $total=$script:cofiringNativeOmTotals[$Span.name]
    $total.calls+=1
    $total.elapsedSeconds+=$Span.elapsedSeconds
    try { Write-CofiringComTrace ('Attach.'+$Span.name) $Outcome $Span.attachAttempt @{scan=$Span.scan;handle=$Span.handle;windowClass=$Span.windowClass;elapsedMs=[Math]::Round($Span.elapsedSeconds*1000,3)} } catch { }
  } catch { }
}
function Get-CofiringNativeOmSnapshot {
  try {
    return [ordered]@{
      schemaVersion=3;revision='nativeom-document-grace-v3'
      elapsedBasis='monotonic_since_first_worker_statement'
      totals=$script:cofiringNativeOmTotals
      events=@($script:cofiringNativeOmEvents.ToArray())
      droppedEvents=$script:cofiringNativeOmDropped
    }
  } catch { return $null }
}
# COFIRING_NATIVEOM_GRACE_QUERY_TIMING_V3
# At most three short initial rescans, never a replacement for owned-PID checks.
function Get-CofiringNativeOmGraceDelay([bool]$HasDocument,[bool]$ClassesKnown,[double]$ElapsedMilliseconds,[int]$DeferredScans,[double]$RemainingMilliseconds) {
  if ($HasDocument -or -not $ClassesKnown -or $DeferredScans -lt 0 -or $DeferredScans -ge 3) { return 0 }
  if ([double]::IsNaN($ElapsedMilliseconds) -or [double]::IsInfinity($ElapsedMilliseconds) -or $ElapsedMilliseconds -lt 0 -or
      [double]::IsNaN($RemainingMilliseconds) -or [double]::IsInfinity($RemainingMilliseconds)) { return 0 }
  # Leave at least one second of the existing deadline for the legacy fallback.
  $budget=[Math]::Min(900.0-$ElapsedMilliseconds,$RemainingMilliseconds-1000.0)
  if ($budget -lt 1.0) { return 0 }
  return [int][Math]::Floor([Math]::Min(300.0,$budget))
}

# Telemetry is best effort: no values, formulas, ownership decisions or retries change.
$script:cofiringQueryEvents=New-Object 'System.Collections.Generic.List[object]'
$script:cofiringQueryPolls=New-Object 'System.Collections.Generic.List[object]'
$script:cofiringQueryTotals=[ordered]@{}
$script:cofiringQueryOpen=@{}
$script:cofiringQueryDropped=0
$script:cofiringQueryPollsDropped=0
$script:cofiringQueryWindow=[ordered]@{startedSeconds=$null;finishedSeconds=$null}
function Set-CofiringQueryBoundary([string]$Boundary) {
  try {
    if ($Boundary -eq 'begin') { $script:cofiringQueryWindow.startedSeconds=[double]$script:workerClock.Elapsed.TotalSeconds }
    elseif ($Boundary -eq 'end') { $script:cofiringQueryWindow.finishedSeconds=[double]$script:workerClock.Elapsed.TotalSeconds }
  } catch { }
}
function Start-CofiringQuerySpan([string]$Name,[int]$Poll=0) {
  try {
    $span=[ordered]@{name=$Name;poll=$Poll;startedSeconds=[double]$script:workerClock.Elapsed.TotalSeconds;finishedSeconds=$null;elapsedSeconds=$null;outcome='running'}
    $script:cofiringQueryOpen[$Name]=$span
    if ($script:cofiringQueryEvents.Count -lt 256) { [void]$script:cofiringQueryEvents.Add($span) }
    else { $script:cofiringQueryDropped+=1 }
    # Persist starts only for potentially blocking COM calls, not every in-memory step.
    if ($Name -in @('enableCalculation','valueRead','freezeCalculation')) {
      try { Write-CofiringComTrace ('Query.'+$Name) 'begin' 1 @{poll=$Poll;startedSeconds=$span.startedSeconds} } catch { }
    }
    return $span
  } catch { return $null }
}
function Complete-CofiringQuerySpan($Span,[string]$Outcome='returned') {
  if ($null -eq $Span) { return }
  try {
    if ($Span.outcome -ne 'running') { return }
    $Span.finishedSeconds=[double]$script:workerClock.Elapsed.TotalSeconds
    $Span.elapsedSeconds=[Math]::Max(0.0,$Span.finishedSeconds-$Span.startedSeconds)
    $Span.outcome=$Outcome
    if (-not $script:cofiringQueryTotals.Contains($Span.name)) { $script:cofiringQueryTotals[$Span.name]=[ordered]@{calls=0;elapsedSeconds=0.0} }
    $total=$script:cofiringQueryTotals[$Span.name];$total.calls+=1;$total.elapsedSeconds+=$Span.elapsedSeconds
    if ($script:cofiringQueryOpen.ContainsKey($Span.name) -and [object]::ReferenceEquals($script:cofiringQueryOpen[$Span.name],$Span)) { [void]$script:cofiringQueryOpen.Remove($Span.name) }
    if ($Span.name -in @('enableCalculation','valueRead','freezeCalculation')) {
      try { Write-CofiringComTrace ('Query.'+$Span.name) $Outcome 1 @{poll=$Span.poll;elapsedMs=[Math]::Round($Span.elapsedSeconds*1000,3)} } catch { }
    }
  } catch { }
}
function Add-CofiringQueryPoll([int]$Poll,$State,[int]$StableReads) {
  try {
    $row=[ordered]@{poll=$Poll;atSeconds=[double]$script:workerClock.Elapsed.TotalSeconds;complete=[bool]$State.complete;stableReads=$StableReads;valueCells=[int]$State.valueCells;pendingCells=[int]$State.pendingCells;invalidCells=[int]$State.invalidCells;errorCells=[int]$State.errorCells;cells=[int]$State.cells}
    if ($script:cofiringQueryPolls.Count -lt 128) { [void]$script:cofiringQueryPolls.Add($row) }
    else { $script:cofiringQueryPollsDropped+=1 }
  } catch { }
}
function Complete-CofiringOpenQuerySpans {
  try { foreach ($span in @($script:cofiringQueryOpen.Values)) { Complete-CofiringQuerySpan $span 'interrupted' } } catch { }
}
function Get-CofiringQuerySnapshot {
  try {
    # COFIRING_INITIAL_POLL_BYPASS_V4
    return [ordered]@{schemaVersion=1;revision='query-internal-stages-v4';elapsedBasis='monotonic_since_first_worker_statement';window=$script:cofiringQueryWindow;totals=$script:cofiringQueryTotals;events=@($script:cofiringQueryEvents.ToArray());polls=@($script:cofiringQueryPolls.ToArray());droppedEvents=$script:cofiringQueryDropped;droppedPolls=$script:cofiringQueryPollsDropped}
  } catch { return $null }
}
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

function Write-CofiringProgress([ValidateSet('WORKER_ENTERED','INITIALIZATION_COMPLETE','READY','EXCEL_START','QUERY_START','QUERY_COMPLETE','CLEANUP','COMPLETE')][string]$Phase) {
  # Progress is best effort. In particular, a broken output pipe must not skip
  # the existing ownership checks and Excel cleanup in the caller's finally.
  try {
    $elapsed = [double]$workerClock.Elapsed.TotalSeconds
    if ([double]::IsNaN($elapsed) -or [double]::IsInfinity($elapsed) -or $elapsed -lt 0) { return }
    $event = [ordered]@{
      schemaVersion=1; runId=[string]$env:GS_COFIRING_RUN_ID; phase=$Phase
      atUtc=[datetime]::UtcNow.ToString('o'); elapsedSeconds=[Math]::Round($elapsed,3)
    }
    [Console]::WriteLine('__COFIRING_PROGRESS__'+(ConvertTo-Json -InputObject $event -Compress))
    [Console]::Out.Flush()
  } catch { }
}
Write-CofiringProgress 'WORKER_ENTERED'

$excel = $null
$workbooks = $null
$queryWorkbook = $null
$worksheets = $null
$querySheet = $null
$cells = $null
$queryRange = $null
$launchedExcelProcess = $null
$ownedExcelPid = 0
$ownedExcelStartTicks = 0L
$ownedExcelPath = ""
$ownedExcelSessionId = -1
$attachedExcelPid = 0
$ownedHostSnapshot = $null
$baselineExcelSignatures = @()
$baselineExcelPids = @()
$baselineHostSignatures = @()
$baselineHostPids = @()
$finalResult = $null
$queryFailure = $null
$queryErrorRecord = $null
$queryComFailure = $null
$script:cofiringInCleanup = $false
$script:cofiringLastComFailure = $null
$matrix = $null
$response = $null
$sampleDefinitions = @()
$cleanupErrors = New-Object System.Collections.Generic.List[string]
$deferredExcelTeardownErrors = New-Object System.Collections.Generic.List[string]
$probeCleanupActions = New-Object System.Collections.Generic.List[string]
$excelExitVerified = $false
$excelUniverseVerified = $false
$hostUniverseVerified = $false
$probeMutex = $null
$probeMutexAcquired = $false

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

$stageMarker = '__COFIRING_PILOT_STAGE__'
$resultMarker = '__COFIRING_PILOT_RESULT__'
$probeWorkbookMarker = '__GS_COFIRING_DATAPARC_FAST_SUMMARY_V8_R2__'
$cofiringStartText = [string]$env:GS_COFIRING_START
$cofiringEndText = [string]$env:GS_COFIRING_END
$cofiringStart = [datetime]::MinValue
$cofiringEnd = [datetime]::MinValue
foreach ($pair in @(@{Text=$cofiringStartText;Key='Start'}, @{Text=$cofiringEndText;Key='End'})) {
  $parsed = [datetime]::MinValue
  if (-not [datetime]::TryParseExact($pair.Text, 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)) {
    throw ($pair.Key + '는 yyyy-MM-dd HH:mm 형식이어야 합니다.')
  }
  if ($pair.Key -eq 'Start') { $cofiringStart = $parsed } else { $cofiringEnd = $parsed }
}
$koreaZone = [TimeZoneInfo]::FindSystemTimeZoneById('Korea Standard Time')
if ([TimeZoneInfo]::Local.Id -ne $koreaZone.Id) { throw 'PC 시간대를 (UTC+09:00) 서울로 설정한 회사 Windows PC에서 실행해 주세요.' }
$nowKst = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Now, $koreaZone).DateTime
$minuteCount = [int]($cofiringEnd - $cofiringStart).TotalMinutes
if ($cofiringStart -lt [datetime]'2021-01-01' -or $minuteCount -lt 1 -or $minuteCount -gt 44640 -or
    $cofiringEnd -ne $cofiringStart.AddMinutes($minuteCount) -or $cofiringEnd.AddMinutes(1) -gt $nowKst) {
  throw '완료된 분 경계만 조회할 수 있습니다. Start < End, 최대 31일이며 종료 경계 다음 1분도 현재 시각 이전이어야 합니다.'
}
$cofiringQueryEnd = $cofiringEnd.AddMinutes(1)
$boundaryCount = $minuteCount + 1
$cofiringManifest = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('eyJ0YWdzIjpbeyJrZXkiOiJ1bml0MUNvYWxBMSIsInVuaXQiOiJ1bml0MSIsImZ1ZWwiOiJjb2FsIiwidGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMSBDT0FMIEZFRURFUiBBLTEgUkVGRVJFTlNFIiwib3JpZ2luYWxUYWciOiJHU1BPR0UuQUJCX0RDUy5CTFIxIENPQUwgRkVFREVSIEEtMSBSRUZFUkVOU0UvUExPVCJ9LHsia2V5IjoidW5pdDFDb2FsQTIiLCJ1bml0IjoidW5pdDEiLCJmdWVsIjoiY29hbCIsInRhZyI6IkdTUE9HRS5BQkJfRENTLkJMUjEgQ09BTCBGRUVERVIgQS0yIFJFRkVSRU5TRSIsIm9yaWdpbmFsVGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMSBDT0FMIEZFRURFUiBBLTIgUkVGRVJFTlNFL1BMT1QifSx7ImtleSI6InVuaXQxQ29hbEIxIiwidW5pdCI6InVuaXQxIiwiZnVlbCI6ImNvYWwiLCJ0YWciOiJHU1BPR0UuQUJCX0RDUy5CTFIxIENPQUwgRkVFREVSIEItMSBSRUZFUkVOU0UiLCJvcmlnaW5hbFRhZyI6IkdTUE9HRS5BQkJfRENTLkJMUjEgQ09BTCBGRUVERVIgQi0xIFJFRkVSRU5TRS9QTE9UIn0seyJrZXkiOiJ1bml0MUNvYWxCMiIsInVuaXQiOiJ1bml0MSIsImZ1ZWwiOiJjb2FsIiwidGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMSBDT0FMIEZFRURFUiBCLTIgUkVGRVJFTlNFIiwib3JpZ2luYWxUYWciOiJHU1BPR0UuQUJCX0RDUy5CTFIxIENPQUwgRkVFREVSIEItMiBSRUZFUkVOU0UvUExPVCJ9LHsia2V5IjoidW5pdDFCaW8iLCJ1bml0IjoidW5pdDEiLCJmdWVsIjoiYmlvIiwidGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMSBCSU8gU1JGIFJFRkVSRU5DRSIsIm9yaWdpbmFsVGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMSBCSU8gU1JGIFJFRkVSRU5DRS9QTE9UIn0seyJrZXkiOiJ1bml0MkNvYWxBMSIsInVuaXQiOiJ1bml0MiIsImZ1ZWwiOiJjb2FsIiwidGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMiBDT0FMIEZFRURFUiBBLTEgUkVGRVJFTlNFIiwib3JpZ2luYWxUYWciOiJHU1BPR0UuQUJCX0RDUy5CTFIyIENPQUwgRkVFREVSIEEtMSBSRUZFUkVOU0UvUExPVCJ9LHsia2V5IjoidW5pdDJDb2FsQTIiLCJ1bml0IjoidW5pdDIiLCJmdWVsIjoiY29hbCIsInRhZyI6IkdTUE9HRS5BQkJfRENTLkJMUjIgQ09BTCBGRUVERVIgQS0yIFJFRkVSRU5TRSIsIm9yaWdpbmFsVGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMiBDT0FMIEZFRURFUiBBLTIgUkVGRVJFTlNFL1BMT1QifSx7ImtleSI6InVuaXQyQ29hbEIxIiwidW5pdCI6InVuaXQyIiwiZnVlbCI6ImNvYWwiLCJ0YWciOiJHU1BPR0UuQUJCX0RDUy5CTFIyIENPQUwgRkVFREVSIEItMSBSRUZFUkVOU0UiLCJvcmlnaW5hbFRhZyI6IkdTUE9HRS5BQkJfRENTLkJMUjIgQ09BTCBGRUVERVIgQi0xIFJFRkVSRU5TRS9QTE9UIn0seyJrZXkiOiJ1bml0MkNvYWxCMiIsInVuaXQiOiJ1bml0MiIsImZ1ZWwiOiJjb2FsIiwidGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMiBDT0FMIEZFRURFUiBCLTIgUkVGRVJFTlNFIiwib3JpZ2luYWxUYWciOiJHU1BPR0UuQUJCX0RDUy5CTFIyIENPQUwgRkVFREVSIEItMiBSRUZFUkVOU0UvUExPVCJ9LHsia2V5IjoidW5pdDJCaW8iLCJ1bml0IjoidW5pdDIiLCJmdWVsIjoiYmlvIiwidGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMiBCSU8gU1JGIFJFRkVSRU5DRSIsIm9yaWdpbmFsVGFnIjoiR1NQT0dFLkFCQl9EQ1MuQkxSMiBCSU8gU1JGIFJFRkVSRU5DRS9QTE9UIn1dLCJjYWxvcmlmaWNzIjp7InVuaXQxIjp7ImNvYWwiOjU4NjgsImJpbyI6MzIzNywib3JnYW5pYyI6MzQ4N30sInVuaXQyIjp7ImNvYWwiOjU4NjgsImJpbyI6MzIzNywib3JnYW5pYyI6MzQ4N319LCJjb2VmZmljaWVudHMiOnsidW5pdDEiOnsiY29hbCI6MSwiYmlvIjoxLCJvcmdhbmljIjoxfSwidW5pdDIiOnsiY29hbCI6MSwiYmlvIjoxLCJvcmdhbmljIjoxfX19')) | ConvertFrom-Json
$cofiringTags = @($cofiringManifest.tags)
if ($cofiringTags.Count -ne 10) { throw '원본 확인 TAG가 정확히 10개여야 합니다.' }

# COFIRING_ORGANIC_INVENTORY_USAGE_V1
# The three inventory tags share the same hidden-Excel/DataPARC lane as Coal/Bio,
# so one period query yields both fuel counters and SDF silo boundary inventory.
$cofiringInventoryTags = @(
  [pscustomobject][ordered]@{
    key='organicDaySilo';label='Day Silo';tag='GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT'
  },
  [pscustomobject][ordered]@{
    key='organicStorageSiloA';label='Storage Silo A';tag='GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT'
  },
  [pscustomobject][ordered]@{
    key='organicStorageSiloB';label='Storage Silo B';tag='GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'
  }
)
$cofiringQueryTags = @($cofiringTags) + @($cofiringInventoryTags)
if ($cofiringQueryTags.Count -ne 13) { throw '혼소율 기간 조회 TAG가 정확히 13개여야 합니다.' }

$cofiringDiagnosticsPath = [string]$env:GS_COFIRING_DIAGNOSTICS_PATH
if ([string]::IsNullOrWhiteSpace($cofiringDiagnosticsPath)) { throw '조회 진단 경로가 없습니다.' }

function Convert-CofiringTimestamp($Value) {
  if ($null -eq $Value -or $Value -is [bool] -or $Value -is [Runtime.InteropServices.ErrorWrapper]) { return $null }
  if ($Value -is [datetime]) { return $Value }
  if ($Value -is [string]) {
    $parsed = [datetime]::MinValue
    if ([datetime]::TryParseExact($Value.Trim(), [string[]]@('yyyy-MM-dd HH:mm:ss','yyyy-MM-ddTHH:mm:ss'), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)) { return $parsed }
    return $null
  }
  $serial = Convert-ProbeNumber $Value
  if ($null -ne $serial -and $serial -ge 1 -and $serial -lt 2958465) { return [datetime]::FromOADate($serial) }
  return $null
}

function Test-CofiringMatrix($Matrix, [int]$Rows) {
  return ($Matrix -is [Array] -and $Matrix.Rank -eq 2 -and $Matrix.GetLength(0) -eq $Rows -and $Matrix.GetLength(1) -eq 3)
}

function Get-CofiringReturnShape($Value) {
  $shape=[ordered]@{isNull=($null -eq $Value);type='';rank=0;lengths=@();lowerBounds=@()}
  if ($null -ne $Value) {
    $shape.type=$Value.GetType().FullName
    if ($Value -is [Array]) {
      $shape.rank=$Value.Rank
      $shape.lengths=@(for ($dimension=0;$dimension -lt $Value.Rank;$dimension+=1) { $Value.GetLength($dimension) })
      $shape.lowerBounds=@(for ($dimension=0;$dimension -lt $Value.Rank;$dimension+=1) { $Value.GetLowerBound($dimension) })
    } elseif ($Value -is [ValueType] -or $Value -is [string]) {
      $shape.scalar=([string]$Value).Substring(0,[Math]::Min(160,([string]$Value).Length))
    }
  }
  return [pscustomobject]$shape
}

function Get-CofiringExcelProperty {
  [CmdletBinding()]
  param(
    [AllowNull()][object]$Target,
    [Parameter(Mandatory=$true)][string]$Member,
    [Parameter(Mandatory=$true)][string]$Operation,
    [object[]]$Indices=@(),
    [ValidateRange(1,60000)][int]$TimeoutMilliseconds=12000,
    [ValidateRange(1,200)][int]$MaxAttempts=60,
    [switch]$AllowNullValue
  )
  # A direct PowerShell COM property expression can hide a getter exception as null.
  # InvokeMember is a METHOD call; its original/inner HRESULT reaches the retry gate.
  # Keep object[,] inside the existing box, never through an enumerating pipeline.
  return (Invoke-CofiringExcelCall -Operation $Operation -TimeoutMilliseconds $TimeoutMilliseconds -MaxAttempts $MaxAttempts -Action {
    param($readBox)
    if ($null -eq $Target) { throw [InvalidOperationException]::new('COM_TARGET_MISSING: '+$Operation) }
    $readBox.Value=$Target.GetType().InvokeMember($Member,
      [Reflection.BindingFlags]::GetProperty,$null,$Target,$Indices)
    if (-not $AllowNullValue -and $null -eq $readBox.Value) {
      throw [IO.InvalidDataException]::new('COM_NULL_RESULT: '+$Operation+' returned no object; this is not a DataPARC pending cell.')
    }
  })
}

function Assert-CofiringReadMatrix($Matrix,[int]$Rows,[string]$Operation) {
  if (-not (Test-CofiringMatrix $Matrix $Rows)) {
    $shape=Get-CofiringReturnShape $Matrix
    Write-CofiringComTrace $Operation 'invalid_shape' 0 $shape
    throw [IO.InvalidDataException]::new('ARRAY_SHAPE_ERROR: '+$Operation+' expected '+$Rows+'x3; '+($shape | ConvertTo-Json -Compress))
  }
}

function Test-CofiringPendingCell($Value) {
  if ($null -eq $Value) { return $true }
  if ($Value -is [string]) {
    $text=$Value.Trim()
    return ($text.Length -eq 0 -or $text -imatch '^#(?:BUSY!?|GETTING_DATA|WAIT!?)$')
  }
  return $false
}

function Get-CofiringResponseState($Value,[string]$Quality,$Time) {
  # Readiness is NOT fuel validity. In the attached V5 FIRST read, 1314 rows had
  # QualStr="0" and Time=0. Those rows have not supplied valid metadata; a single
  # snapshot cannot tell whether the metadata will arrive. Wait only to the
  # existing per-TAG deadline, never accept/fill those zeros as real observations.
  if ($Value -is [Runtime.InteropServices.ErrorWrapper] -or $Time -is [Runtime.InteropServices.ErrorWrapper]) { return 'ERROR' }
  $numericValue=Convert-ProbeNumber $Value
  $numericTime=Convert-ProbeNumber $Time
  $numericQuality=Convert-ProbeNumber $Quality
  if (($null -ne $numericValue -and $numericValue -lt 0) -or
      ($null -ne $numericTime -and $numericTime -lt 0) -or
      ($null -ne $numericQuality -and $numericQuality -lt 0)) { return 'ERROR' }
  foreach ($item in @($Value,$Quality,$Time)) {
    if ($item -is [string] -and $item.Trim().StartsWith('#') -and
        -not (Test-CofiringPendingCell $item) -and $item.Trim() -ine '#NODATA') { return 'ERROR' }
  }
  if ((Test-CofiringPendingCell $Value) -or (Test-CofiringPendingCell $Quality) -or (Test-CofiringPendingCell $Time)) { return 'PENDING' }
  # Explicit server NoData remains a completed, unusable response, not a zero.
  if ($Value -is [string] -and $Value.Trim() -ieq '#NODATA' -and $Quality.Trim() -imatch '^No\s+Data\s*,\s*Bad$') { return 'NODATA' }
  $qualityZero=($Quality.Trim() -ceq '0')
  $timeZero=($null -ne $numericTime -and $numericTime -eq 0)
  $timestamp=Convert-CofiringTimestamp $Time
  $valueCandidate=($null -ne $numericValue -or ($Value -is [string] -and $Value.Trim() -ieq '#NODATA'))
  if ($valueCandidate -and
      (($qualityZero -and ($timeZero -or $null -ne $timestamp)) -or
       ($timeZero -and (Test-OrganicQualityGood $Quality)))) { return 'METADATA_PENDING' }
  if ($null -ne $numericValue -and $null -ne $timestamp) { return 'VALUE' }
  return 'ERROR'
}

function Get-CofiringMatrixResponse($Matrix,[int]$Rows) {
  $stats=[ordered]@{rows=$Rows;shapeValid=$false;readState='ARRAY_SHAPE_ERROR';returnedRows=0;valueRows=0;noDataRows=0;errorRows=0;pendingRows=0;metadataPendingRows=0;otherPendingRows=0;complete=$false}
  if (-not (Test-CofiringMatrix $Matrix $Rows)) { return [pscustomobject]$stats }
  $stats.shapeValid=$true; $stats.readState='READ_OK'
  $rb=$Matrix.GetLowerBound(0); $cb=$Matrix.GetLowerBound(1)
  for ($i=0;$i -lt $Rows;$i+=1) {
    $state=Get-CofiringResponseState ($Matrix.GetValue($rb+$i,$cb)) ([string]$Matrix.GetValue($rb+$i,$cb+1)) ($Matrix.GetValue($rb+$i,$cb+2))
    switch ($state) {
      'VALUE' { $stats.valueRows+=1 }
      'NODATA' { $stats.noDataRows+=1 }
      'ERROR' { $stats.errorRows+=1 }
      'METADATA_PENDING' { $stats.metadataPendingRows+=1; $stats.pendingRows+=1 }
      default { $stats.otherPendingRows+=1; $stats.pendingRows+=1 }
    }
  }
  $stats.returnedRows=$stats.valueRows+$stats.noDataRows+$stats.errorRows
  $stats.complete=($stats.pendingRows -eq 0)
  return [pscustomobject]$stats
}

function Get-CofiringBatchDecision(
  $Matrix,$PreviousMatrix,[int]$Rows,[int]$PreviousStableCount,[bool]$Expired,
  [double]$ElapsedSeconds=0,[double]$FirstCompleteSeconds=-1,
  [Diagnostics.Stopwatch]$Clock=$null
) {
  # Same helper in live code and preflight. The first complete response is not a pass.
  # One fixed acquisition window (60s), then a separate fixed stability window (15s).
  # Changes/regressions never restart either clock. A TAG is capped at 75s.
  Assert-CofiringReadMatrix $Matrix $Rows 'Batch.Decision'
  $stats=Get-CofiringMatrixResponse $Matrix $Rows
  $stable=0
  if ($stats.complete -and $stats.errorRows -eq 0) {
    if (Test-CofiringSnapshotEqual $PreviousMatrix $Matrix $Rows) { $stable=$PreviousStableCount+1 }
    else { $stable=1 }
  }
  # Include classification time as well as rejected COM calls in the phase budget.
  if ($null -ne $Clock) { $ElapsedSeconds=$Clock.Elapsed.TotalSeconds }
  if ([double]::IsNaN($ElapsedSeconds) -or [double]::IsInfinity($ElapsedSeconds) -or $ElapsedSeconds -lt 0 -or
      [double]::IsNaN($FirstCompleteSeconds) -or [double]::IsInfinity($FirstCompleteSeconds) -or
      ($FirstCompleteSeconds -ne -1 -and ($FirstCompleteSeconds -lt 0 -or $FirstCompleteSeconds -gt $ElapsedSeconds))) {
    throw [ArgumentException]::new('Invalid TAG timing state; no data accepted.')
  }
  $first=$FirstCompleteSeconds
  if ($first -lt 0 -and $stats.complete -and $stats.errorRows -eq 0 -and $ElapsedSeconds -lt 60) { $first=$ElapsedSeconds }
  $phase='WAIT_RESPONSE'; $deadline=60.0
  if ($first -ge 0) { $phase='VERIFY_STABLE'; $deadline=[Math]::Min(75.0,$first+15.0) }
  $action='WAIT'
  if ($stats.errorRows -gt 0) { $action='ERROR' }
  elseif ($Expired) { $action='TIMEOUT' }
  elseif ($ElapsedSeconds -ge $deadline) { $action='TIMEOUT' }
  elseif ($stable -ge 3) { $action='COMPLETE' }
  return [pscustomobject]@{
    action=$action;stableReads=$stable;response=$stats;phase=$phase
    firstCompleteSeconds=$first;deadlineSeconds=$deadline
    tagElapsedSeconds=$ElapsedSeconds;remainingSeconds=[Math]::Max(0.0,$deadline-$ElapsedSeconds)
  }
}

function Get-CofiringBatchErrorPreview($Matrix,[int]$Rows) {
  $preview=New-Object 'System.Collections.Generic.List[object]'
  if (Test-CofiringMatrix $Matrix $Rows) {
    $rb=$Matrix.GetLowerBound(0);$cb=$Matrix.GetLowerBound(1)
    for ($index=0;$index -lt $Rows -and $preview.Count -lt 5;$index+=1) {
      $value=$Matrix.GetValue($rb+$index,$cb);$quality=[string]$Matrix.GetValue($rb+$index,$cb+1);$time=$Matrix.GetValue($rb+$index,$cb+2)
      if ((Get-CofiringResponseState $value $quality $time) -eq 'ERROR') {
        $preview.Add([pscustomobject]@{row=$index;rawValue=$value;quality=$quality;rawTime=$time})
      }
    }
  }
  return $preview.ToArray()
}

function Test-CofiringMatrixReturned($Matrix, [int]$Rows) {
  return [bool](Get-CofiringMatrixResponse $Matrix $Rows).complete
}

function Assert-CofiringNotCancelled {
  if ($env:GS_COFIRING_CANCEL_PATH -and [IO.File]::Exists($env:GS_COFIRING_CANCEL_PATH)) {
    throw [OperationCanceledException]::new('관리 프로세스가 조회 중단을 요청했습니다. 결과를 성공으로 처리하지 않습니다.')
  }
}

function Test-CofiringAtomicSharingError([Exception]$Exception) {
  for ($depth=0; $null -ne $Exception -and $depth -lt 16; $depth+=1) {
    $code=[BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$Exception.HResult),0).ToString('X8')
    if ($code -in @('80070020','80070021')) { return $true }
    $Exception=$Exception.InnerException
  }
  return $false
}

function Write-CofiringJsonAtomic([string]$Path, $Value) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw '진단 결과 경로가 비어 있습니다.' }
  # Each write owns unique sibling files; a reader of an older backup must not
  # prevent the next snapshot. Never delete or truncate the current destination.
  $writeId=[Guid]::NewGuid().ToString('N')
  $next=$Path+'.'+$writeId+'.new'
  $previous=$Path+'.'+$writeId+'.previous'
  $committed=$false
  try {
    $json=$Value | ConvertTo-Json -Compress -Depth 20
    [IO.File]::WriteAllText($next,$json,(New-Object Text.UTF8Encoding($false)))
    $retryClock=[Diagnostics.Stopwatch]::StartNew()
    while ($true) {
      try {
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($next,$Path,$previous) }
        else { [IO.File]::Move($next,$Path) }
        $committed=$true
        break
      } catch {
        # Only Windows sharing/lock violations may recover by waiting. Other
        # failures remain failures, and the previous destination stays intact.
        if (-not (Test-CofiringAtomicSharingError $_.Exception)) { throw }
        $remainingMilliseconds=1500-$retryClock.ElapsedMilliseconds
        if ($remainingMilliseconds -le 0) { throw }
        Start-Sleep -Milliseconds ([int][Math]::Min(100,$remainingMilliseconds))
      }
    }
  } finally {
    # Only this call's GUID paths are eligible for cleanup. A cleanup error must
    # not hide the original write failure or invalidate a committed snapshot.
    # If Replace reports a partial failure, retain any backup it managed to
    # create rather than removing a possible surviving copy of the old data.
    $temporaryPaths=@($next)
    if ($committed) { $temporaryPaths+=$previous }
    foreach ($temporaryPath in $temporaryPaths) {
      try { if ([IO.File]::Exists($temporaryPath)) { [IO.File]::Delete($temporaryPath) } } catch { }
    }
  }
}

function Get-CofiringTagSummary($Samples) {
  $result=New-Object 'System.Collections.Generic.List[object]'
  foreach ($tag in $cofiringTags) {
    $rows=@($Samples | Where-Object { $_.key -eq [string]$tag.key })
    $missing=@($rows | Where-Object { $_.responseState -eq 'NODATA' })
    $invalid=@($rows | Where-Object { -not $_.valueValid -or -not $_.qualityGood -or -not $_.timeValid -or $_.counterReset })
    $result.Add([pscustomobject][ordered]@{
      key=[string]$tag.key;tag=[string]$tag.tag;expectedRows=$boundaryCount;receivedRows=$rows.Count
      validRows=($rows.Count-$invalid.Count);noDataRows=$missing.Count
      missingTimes=@($missing | ForEach-Object { $_.timestamp })
      minuteDataComplete=($rows.Count -eq $boundaryCount -and $invalid.Count -eq 0)
    })
  }
  return $result.ToArray()
}

function Invoke-CofiringGapProbe($Samples, $Sheet) {
  # Extra values are diagnostic only. Never write into the daily series or qualities.
  $missing=@($Samples | Where-Object { $_.responseState -eq 'NODATA' })
  $selected=@($missing | Select-Object -First 64)
  $probe=[ordered]@{
    kind='cofiring_gap_probe_v7';runId=[string]$env:GS_COFIRING_RUN_ID
    diagnosticOnly=$true;appliedToDailyValues=$false;missingRows=$missing.Count
    selectedRows=$selected.Count;truncated=($missing.Count -gt 64);rows=@();failure=''
  }
  if ($selected.Count -eq 0) { return $probe }
  $range=$null
  try {
    Assert-CofiringNotCancelled
    Write-ProbeStage ('누락 '+$selected.Count+'개 분만 Count/DurationGood/DurationBad/Linear 비교 · 계산값 대체 없음')
    $formulas=New-Object 'object[,]' $selected.Count,6
    $methods=@(@('Count','Value'),@('DurationGood','Value'),@('DurationBad','Value'),@('Linear','Value'),@('Linear','QualStr'),@('Linear','Time'))
    for ($r=0;$r -lt $selected.Count;$r+=1) {
      $from=([datetime]::ParseExact($selected[$r].bucketStart.Substring(0,19),'yyyy-MM-ddTHH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)).ToString('yyyy-MM-dd HH:mm:ss')
      $to=([datetime]::ParseExact($selected[$r].bucketEnd.Substring(0,19),'yyyy-MM-ddTHH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)).ToString('yyyy-MM-dd HH:mm:ss')
      $safeTag=([string]$selected[$r].tag).Replace('"','""')
      for ($col=0;$col -lt 6;$col+=1) {
        $formulas[$r,$col]='=fnTagStat("'+$safeTag+'","'+$from+'","'+$to+'","'+$methods[$col][0]+'","'+$methods[$col][1]+'")'
      }
    }
    $range=(Invoke-CofiringExcelCall -Operation 'Gap.Range' -Action { param($box) $box.Value=$Sheet.Range('E1:J'+[string]$selected.Count) }).Value
    [void](Invoke-CofiringExcelCall -Operation 'Gap.Formula' -TimeoutMilliseconds 5000 -Action { $range.Formula=$formulas })
    $until=[datetime]::UtcNow.AddSeconds(20)
    [void](Invoke-CofiringExcelCall -Operation 'Gap.Calculate' -TimeoutMilliseconds 5000 -Action { $range.Calculate() })
    $matrix=$null
    do {
      Assert-CofiringNotCancelled
      Start-Sleep -Milliseconds 400
      $matrix=(Get-CofiringExcelProperty -Target $range -Member 'Value2' -Operation 'Gap.Value2' -TimeoutMilliseconds 5000).Value
      $ready=($matrix -is [Array] -and $matrix.Rank -eq 2 -and $matrix.GetLength(0) -eq $selected.Count -and $matrix.GetLength(1) -eq 6)
      if ($ready) {
        $rb=$matrix.GetLowerBound(0);$cb=$matrix.GetLowerBound(1)
        for ($r=0;$r -lt $selected.Count;$r+=1) {
          for ($col=0;$col -lt 3;$col+=1) {
            $v=$matrix.GetValue($rb+$r,$cb+$col)
            if ($null -eq (Convert-ProbeNumber $v) -and [string]$v -ine '#NODATA') { $ready=$false }
          }
          if ((Get-CofiringResponseState ($matrix.GetValue($rb+$r,$cb+3)) ([string]$matrix.GetValue($rb+$r,$cb+4)) ($matrix.GetValue($rb+$r,$cb+5))) -eq 'PENDING') { $ready=$false }
        }
      }
    } while (-not $ready -and [datetime]::UtcNow -lt $until)
    $output=New-Object 'System.Collections.Generic.List[object]'
    if ($matrix -is [Array] -and $matrix.Rank -eq 2 -and $matrix.GetLength(0) -eq $selected.Count -and $matrix.GetLength(1) -eq 6) {
      $rb=$matrix.GetLowerBound(0);$cb=$matrix.GetLowerBound(1)
      for ($r=0;$r -lt $selected.Count;$r+=1) {
        $output.Add([pscustomobject][ordered]@{
          key=$selected[$r].key;tag=$selected[$r].tag;bucketStart=$selected[$r].bucketStart;bucketEnd=$selected[$r].bucketEnd
          originalValue=$selected[$r].rawValue;originalQuality=$selected[$r].qualityText
          count=$matrix.GetValue($rb+$r,$cb);durationGood=$matrix.GetValue($rb+$r,$cb+1);durationBad=$matrix.GetValue($rb+$r,$cb+2)
          linearValue=$matrix.GetValue($rb+$r,$cb+3);linearQuality=$matrix.GetValue($rb+$r,$cb+4);linearRawTime=$matrix.GetValue($rb+$r,$cb+5)
          appliedToDailyValues=$false
        })
      }
    }
    $probe.rows=@($output.ToArray())
    $probe.responseComplete=[bool]$ready
    if (-not $ready) { $probe.failure='누락 구간 추가 비교가 20초 내 완료되지 않았습니다. 원래 하루 조회값은 그대로 보존합니다.' }
  } catch { $probe.failure=$_.Exception.Message; $probe.errorDetails=Get-CofiringExceptionInfo $_ }
  finally { Release-ProbeCom $range }
  return $probe
}

# Pure retry/diagnostic helpers; no Excel creation, attachment or process termination here.
function Get-CofiringExceptionInfo($ErrorValue) {
  $exception = $ErrorValue
  $position = ''; $stack = ''
  if ($ErrorValue -is [System.Management.Automation.ErrorRecord]) {
    $exception = $ErrorValue.Exception
    $position = [string]$ErrorValue.InvocationInfo.PositionMessage
    $stack = [string]$ErrorValue.ScriptStackTrace
  }
  $codes = New-Object 'System.Collections.Generic.List[string]'
  $messages = New-Object 'System.Collections.Generic.List[string]'
  $transient = $false
  for ($depth=0; $null -ne $exception -and $depth -lt 16; $depth+=1) {
    $code = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$exception.HResult),0).ToString('X8')
    $codes.Add('0x'+$code)
    $messages.Add([string]$exception.Message)
    # VBA_E_IGNORE / RPC_E_CALL_REJECTED / RPC_E_SERVERCALL_RETRYLATER only.
    # RPC server unavailable, a disconnected object and unknown failures are NOT retried.
    if ($code -in @('800AC472','80010001','8001010A')) { $transient=$true }
    $exception = $exception.InnerException
  }
  return [pscustomobject][ordered]@{
    transient=$transient; hresults=@($codes.ToArray()); messages=@($messages.ToArray())
    position=$position; scriptStackTrace=$stack
  }
}

function Write-CofiringComTrace([string]$Operation, [string]$Event, [int]$Attempt, $Detail) {
  if ([string]::IsNullOrWhiteSpace([string]$env:GS_COFIRING_COM_TRACE_PATH)) { return }
  $record=[ordered]@{
    atUtc=[datetime]::UtcNow.ToString('o'); runId=[string]$env:GS_COFIRING_RUN_ID
    operation=$Operation; event=$Event; attempt=$Attempt; detail=$Detail
  }
  [IO.File]::AppendAllText([string]$env:GS_COFIRING_COM_TRACE_PATH,
    (($record | ConvertTo-Json -Compress -Depth 8)+[Environment]::NewLine),
    (New-Object Text.UTF8Encoding($false)))
}

function Invoke-CofiringExcelCall {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Operation,
    [Parameter(Mandatory=$true)][scriptblock]$Action,
    [ValidateRange(1,60000)][int]$TimeoutMilliseconds=25000,
    [ValidateRange(1,2000)][int]$RetryMilliseconds=400,
    [ValidateRange(1,200)][int]$MaxAttempts=60,
    [switch]$NoRetry,
    [switch]$Cleanup
  )
  if ($null -eq $script:cofiringComStats) {
    $script:cofiringComStats=[ordered]@{callCount=0;retryCount=0;recoveredCalls=0;failedCalls=0;lastOperation=''}
  }
  $script:cofiringComStats.callCount+=1
  $script:cofiringComStats.lastOperation=$Operation
  $timer=[Diagnostics.Stopwatch]::StartNew()
  $attempt=0
  while ($true) {
    # Cleanup is allowed after a cancellation request, but never bypasses PID ownership checks.
    if (-not $Cleanup -and -not $script:cofiringInCleanup) { Assert-CofiringNotCancelled }
    $attempt+=1
    Write-CofiringComTrace $Operation 'begin' $attempt $null
    # A box prevents PowerShell pipeline enumeration from flattening a COM object[,] array.
    # Action must assign box.Value for reads. Actions' incidental pipeline output is discarded.
    $box=[pscustomobject]@{Value=$null}
    try {
      [void](& $Action $box)
      Write-CofiringComTrace $Operation 'returned' $attempt @{elapsedMs=$timer.ElapsedMilliseconds;resultShape=(Get-CofiringReturnShape $box.Value)}
      if ($attempt -gt 1) {
        $script:cofiringComStats.recoveredCalls+=1
        Write-ProbeStage ('Excel 호출 재시도 후 완료: '+$Operation+' / '+$attempt+'회')
      }
      return $box
    } catch {
      $record=$_
      $info=Get-CofiringExceptionInfo $record
      $expired=($timer.ElapsedMilliseconds -ge $TimeoutMilliseconds -or $attempt -ge $MaxAttempts)
      if ($NoRetry -or -not $info.transient -or $expired) {
        $script:cofiringComStats.failedCalls+=1
        $script:cofiringLastComFailure=[pscustomobject]@{
          operation=$Operation;attempts=$attempt;retryBudgetExhausted=[bool]$expired;error=$info
        }
        Write-CofiringComTrace $Operation 'failed' $attempt $script:cofiringLastComFailure
        throw
      }
      $script:cofiringComStats.retryCount+=1
      Write-CofiringComTrace $Operation 'busy_retry' $attempt $info
      if ($attempt -eq 1 -or ($attempt % 10) -eq 0) {
        Write-ProbeStage ('Excel 응답 대기·재시도: '+$Operation+' / '+($info.hresults -join ', '))
      }
      $remaining=[Math]::Max(1,$TimeoutMilliseconds-$timer.ElapsedMilliseconds)
      Start-Sleep -Milliseconds ([int][Math]::Min($RetryMilliseconds,$remaining))
    }
  }
}

function New-CofiringPartialSnapshot($Matrix, $Definitions, $Response, [string]$Operation, [object[]]$QueriedKeys=$null) {
  $rows=New-Object 'System.Collections.Generic.List[object]'
  $shape=(Test-CofiringMatrix $Matrix ([int]$Definitions.Count))
  if ($shape) {
    $rb=$Matrix.GetLowerBound(0); $cb=$Matrix.GetLowerBound(1)
    foreach ($sample in $Definitions) {
      if ($null -ne $QueriedKeys -and $sample.Key -notin $QueriedKeys) { continue }
      $r=$rb+[int]$sample.Row
      $rows.Add([pscustomobject][ordered]@{
        key=$sample.Key;tag=$sample.Tag;timestamp=$sample.Timestamp
        rawValue=$Matrix.GetValue($r,$cb);qualityText=[string]$Matrix.GetValue($r,$cb+1)
        rawTime=$Matrix.GetValue($r,$cb+2)
      })
    }
  }
  return [pscustomobject][ordered]@{
    kind='cofiring_partial_snapshot_v7';runId=[string]$env:GS_COFIRING_RUN_ID
    diagnosticOnly=$true;dataValidated=$false;databaseWritten=$false;productionReady=$false
    expectedRows=$Definitions.Count;capturedRows=$rows.Count;unqueriedRows=($Definitions.Count-$rows.Count);shapeValid=[bool]$shape;response=$Response
    queriedTags=@($QueriedKeys)
    failureOperation=$Operation;samples=@($rows.ToArray())
  }
}

function Test-CofiringSnapshotEqual($Left, $Right, [int]$Rows) {
  if (-not (Test-CofiringMatrix $Left $Rows) -or -not (Test-CofiringMatrix $Right $Rows)) { return $false }
  $lr=$Left.GetLowerBound(0);$lc=$Left.GetLowerBound(1)
  $rr=$Right.GetLowerBound(0);$rc=$Right.GetLowerBound(1)
  for ($row=0;$row -lt $Rows;$row+=1) {
    for ($col=0;$col -lt 3;$col+=1) {
      if (-not [object]::Equals($Left.GetValue($lr+$row,$lc+$col),$Right.GetValue($rr+$row,$rc+$col))) { return $false }
    }
  }
  return $true
}


Write-CofiringProgress 'INITIALIZATION_COMPLETE'
function Write-ProbeStage([string]$Message) {
  [Console]::WriteLine($stageMarker + '['+[Math]::Round($workerClock.Elapsed.TotalSeconds,1)+'s] '+$Message)
  [Console]::Out.Flush()
}

function Release-ProbeCom($Value) {
  if ($null -eq $Value) { return }
  try {
    if ([Runtime.InteropServices.Marshal]::IsComObject($Value)) {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value)
    }
  } catch {
  }
}

function Convert-ProbeNumber($Value) {
  if (
    $null -eq $Value -or
    $Value -is [bool] -or
    $Value -is [Runtime.InteropServices.ErrorWrapper]
  ) {
    return $null
  }

  if ($Value -is [string] -and ([string]::IsNullOrWhiteSpace($Value) -or $Value.Trim().StartsWith('#'))) { return $null }
  try {
    $number = [Convert]::ToDouble(
      $Value,
      [Globalization.CultureInfo]::InvariantCulture
    )
  } catch {
    return $null
  }

  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
    return $null
  }

  return $number
}

# COFIRING_ORGANIC_NEGATIVE_TO_ZERO_V1
# Only organic inventory boundaries use this operator-approved normalization.
# Missing, invalid and nonfinite numbers remain missing; quality/time gates follow.
function Convert-CofiringOrganicInventoryValue($Value) {
  $number=Convert-ProbeNumber $Value
  if ($null -eq $number) { return $null }
  return [Math]::Max(0.0,[double]$number)
}

function Read-ProbeCellNumber($Cell) {
  try {
    $text = [string](Get-CofiringExcelProperty -Target $Cell -Member 'Text' -Operation 'Cell.Text' -AllowNullValue).Value
    if ([string]::IsNullOrWhiteSpace($text) -or $text.StartsWith("#")) {
      return $null
    }
    return Convert-ProbeNumber (Get-CofiringExcelProperty -Target $Cell -Member 'Value2' -Operation 'Cell.Value2' -AllowNullValue).Value
  } catch {
    return $null
  }
}

function Test-ProbeValuePresent($Value) {
  return (
    $null -ne $Value -and
    $Value -isnot [Runtime.InteropServices.ErrorWrapper] -and
    -not (
      $Value -is [string] -and
      [string]::IsNullOrWhiteSpace($Value)
    )
  )
}

function Convert-ProbeState([double]$Value, [string]$Label) {
  if ([Math]::Abs($Value - 1) -lt 0.001) { return "running" }
  if ([Math]::Abs($Value) -lt 0.001) { return "stopped" }
  throw ($Label + " RUN 값이 0 또는 1이 아닙니다: " + [string]$Value)
}

function Format-ProbeFormulaTime(
  [DateTimeOffset]$Value,
  [TimeZoneInfo]$KoreaZone
) {
  return [TimeZoneInfo]::ConvertTime($Value, $KoreaZone).ToString(
    "yyyy-MM-dd HH:mm:ss",
    [Globalization.CultureInfo]::InvariantCulture
  )
}

function Format-ProbeResultTime(
  [DateTimeOffset]$Value,
  [TimeZoneInfo]$KoreaZone
) {
  return [TimeZoneInfo]::ConvertTime($Value, $KoreaZone).ToString(
    "yyyy-MM-ddTHH:mm:sszzz",
    [Globalization.CultureInfo]::InvariantCulture
  )
}

function Resolve-ProbeExcelExecutable {
  $candidates = New-Object System.Collections.Generic.List[string]

  try {
    $command = Get-Command "EXCEL.EXE" -ErrorAction Stop
    if (-not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
      $candidates.Add([string]$command.Source)
    }
  } catch {
  }

  $registryPaths = @(
    "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\excel.exe",
    "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\excel.exe",
    "Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\excel.exe"
  )

  foreach ($registryPath in $registryPaths) {
    try {
      $registryKey = Get-Item -LiteralPath $registryPath -ErrorAction Stop
      $registryValue = [string]$registryKey.GetValue("")
      if (-not [string]::IsNullOrWhiteSpace($registryValue)) {
        $candidates.Add($registryValue)
      }
    } catch {
    }
  }

  foreach ($officeRoot in @([string]$env:ProgramFiles, [string]([Environment]::GetEnvironmentVariable("ProgramFiles(x86)")))) {
    if ([string]::IsNullOrWhiteSpace($officeRoot)) { continue }
    $candidates.Add((Join-Path $officeRoot "Microsoft Office\root\Office16\EXCEL.EXE"))
    $candidates.Add((Join-Path $officeRoot "Microsoft Office\Office16\EXCEL.EXE"))
    $candidates.Add((Join-Path $officeRoot "Microsoft Office\Office15\EXCEL.EXE"))
  }

  foreach ($candidate in $candidates) {
    if (
      -not [string]::IsNullOrWhiteSpace($candidate) -and
      (Test-Path -LiteralPath $candidate -PathType Leaf)
    ) {
      return [IO.Path]::GetFullPath($candidate)
    }
  }

  throw "Excel 실행 파일(EXCEL.EXE)을 찾지 못했습니다. Office 설치 상태를 확인해 주세요."
}


function Assert-CofiringCompilerTemp {
  $expected = [string]$env:GS_COFIRING_COMPILER_TEMP
  if ([string]::IsNullOrWhiteSpace($expected)) {
    throw "Add-Type 전용 임시 폴더 환경변수가 없습니다."
  }

  $expected = [IO.Path]::GetFullPath($expected).TrimEnd('\')
  [void][IO.Directory]::CreateDirectory($expected)

  # COFIRING_RUNTIME_TEMP_PARITY_V7
  # Validate only the private compiler directory here. TEMP/TMP are scoped around
  # Add-Type below and restored before Excel is started, matching the proven Blower path.

  $probePath = Join-Path $expected ("compiler-write-test-" + [guid]::NewGuid().ToString("N") + ".tmp")
  try {
    [IO.File]::WriteAllText($probePath, "ok", (New-Object Text.UTF8Encoding($false)))
    if (-not [IO.File]::Exists($probePath)) {
      throw "Add-Type 전용 임시 폴더 쓰기 시험 파일이 생성되지 않았습니다."
    }
  } finally {
    if ([IO.File]::Exists($probePath)) {
      try { [IO.File]::Delete($probePath) } catch { }
    }
  }
  return $expected
}

# COFIRING_COMPILER_RETRY_V10
# CodeDOM and its child compiler tools share one private directory per attempt.
# No security settings, query arithmetic, process ownership or cleanup gates change.
function Test-CofiringCompilerRetry([object[]]$Records, [string]$CompileDirectory) {
  $messages = New-Object System.Collections.Generic.List[string]
  foreach ($record in @($Records)) {
    if ($null -eq $record) { continue }
    $messages.Add([string]$record)
    if ($record -is [Management.Automation.ErrorRecord]) {
      if ($null -ne $record.ErrorDetails) { $messages.Add([string]$record.ErrorDetails.Message) }
      $exception = $record.Exception
      while ($null -ne $exception) {
        $messages.Add([string]$exception.Message)
        $exception = $exception.InnerException
      }
      $target = $record.TargetObject
      if ($null -ne $target) {
        foreach ($property in @("ErrorNumber", "ErrorText")) {
          if ($null -ne $target.PSObject.Properties[$property]) { $messages.Add([string]$target.$property) }
        }
      }
    }
  }
  $diagnostic = $messages -join " "
  # A compiler resource file may report no CS number. Retry only a direct child
  # of this attempt's private directory; never accept the shared temp root.
  $resourcePrefix = [IO.Path]::GetFullPath($CompileDirectory).TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
  $resourcePattern = '(?i)\bcannot\s+open\s+["'']?' + [regex]::Escape($resourcePrefix) + 'RES[0-9a-f]{1,4}\.tmp["'']?\s+for\s+writing\b'
  if ($diagnostic -match $resourcePattern) {
    $resourceCodes = @([regex]::Matches($diagnostic, '(?i)\b(?:CS|CVT|AL)[0-9]{4}\b') | ForEach-Object { $_.Value.ToUpperInvariant() })
    if (@($resourceCodes | Where-Object { $_ -ne "CS0016" }).Count -gt 0) { return $false }
    if ($diagnostic -match '(?i)access\s+(?:is\s+)?denied|permission\s+denied|unauthori[sz]ed|blocked\s+by|group\s+policy|security\s+policy|보안[^.]*차단|정책[^.]*차단|액세스[^.]*거부|권한[^.]*없|권한[^.]*거부|disk\s+(?:is\s+)?full|not\s+enough\s+(?:space|disk)|no\s+space\s+left|디스크[^.]*부족|공간[^.]*부족') { return $false }
    return $true
  }
  return $false
}

function Invoke-CofiringCompiler([string]$TypeDefinition) {
  $compileTempRoot = Assert-CofiringCompilerTemp
  $createdDirectories = New-Object System.Collections.Generic.List[string]
  $retryWaits = @(1000, 2000)
  try {
    for ($attempt = 0; $attempt -lt 3; $attempt += 1) {
      $compilerTempPath = Join-Path $compileTempRoot ("attempt-" + [Guid]::NewGuid().ToString("N"))
      if (Test-Path -LiteralPath $compilerTempPath) { throw "Excel 연결모듈 임시 폴더가 이미 존재합니다." }
      [void][IO.Directory]::CreateDirectory($compilerTempPath)
      $createdDirectories.Add($compilerTempPath)
      $parameters = New-Object System.CodeDom.Compiler.CompilerParameters
      $parameters.GenerateInMemory = $true
      $parameters.GenerateExecutable = $false
      $parameters.IncludeDebugInformation = $false
      $parameters.TempFiles = [System.CodeDom.Compiler.TempFileCollection]::new($compilerTempPath, $false)
      [void]$parameters.ReferencedAssemblies.Add("System.dll")
      $compileErrors = @()
      try {
        Write-ProbeStage ("Excel 연결모듈 준비 · " + [string]($attempt + 1) + "/3")
        # CodeDOM child tools inherit the PowerShell process environment.
        # Scope both temp variables to compilation and restore before COM use.
        $runtimeTemp = [Environment]::GetEnvironmentVariable("TEMP", "Process")
        $runtimeTmp = [Environment]::GetEnvironmentVariable("TMP", "Process")
        try {
          [Environment]::SetEnvironmentVariable("TEMP", $compilerTempPath, "Process")
          [Environment]::SetEnvironmentVariable("TMP", $compilerTempPath, "Process")
          $activeCompilerTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char[]]'\/')
          if (-not [string]::Equals($activeCompilerTemp, $compilerTempPath.TrimEnd([char[]]'\/'), [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Add-Type compiler TEMP/TMP did not match the owned attempt directory.'
          }
          Add-Type -TypeDefinition $TypeDefinition -CompilerParameters $parameters -ErrorVariable +compileErrors -ErrorAction Stop
        } finally {
          try {
            [Environment]::SetEnvironmentVariable("TEMP", $runtimeTemp, "Process")
          } finally {
            [Environment]::SetEnvironmentVariable("TMP", $runtimeTmp, "Process")
          }
        }
        return
      } catch {
        if ($attempt -ge 2 -or -not (Test-CofiringCompilerRetry (@($compileErrors) + @($_)) $compilerTempPath)) { throw }
        Write-ProbeStage "Excel 연결모듈 임시 파일 준비 재시도 · 잠시 후 다시 준비"
        Start-Sleep -Milliseconds $retryWaits[$attempt]
      }
    }
  } finally {
    foreach ($directory in $createdDirectories) {
      try {
        if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction Stop }
      } catch {
        try { Write-ProbeStage ("Excel 연결모듈 임시 폴더 정리 대기: " + $directory) } catch {}
      }
    }
  }
}

Start-CofiringWorkerPhase 'setupNativeCompile'
if (-not ("GsBlowerRuntimeNativeOmV1" -as [type])) {
  $nativeOmTypeDefinition = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class GsBlowerRuntimeNativeOmV1
{
    private const uint OBJID_NATIVEOM = 0xFFFFFFF0;
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("oleacc.dll", PreserveSig = true)]
    private static extern int AccessibleObjectFromWindow(
        IntPtr hwnd,
        uint dwId,
        ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out object ppvObject
    );

    public static string WindowClass(IntPtr hwnd)
    {
        StringBuilder builder = new StringBuilder(256);
        int length = GetClassName(hwnd, builder, builder.Capacity);
        return length <= 0 ? "" : builder.ToString();
    }

    public static IntPtr[] FindNativeObjectWindows(int processId)
    {
        // Collect every EXCEL7 before any XLMAIN, including multi-window instances.
        List<IntPtr> result = new List<IntPtr>();
        List<IntPtr> fallback = new List<IntPtr>();

        EnumWindows(
            delegate(IntPtr top, IntPtr state)
            {
                uint topPid;
                GetWindowThreadProcessId(top, out topPid);
                if (topPid != (uint)processId) return true;

                if (String.Equals(WindowClass(top), "XLMAIN", StringComparison.OrdinalIgnoreCase)) {
                    fallback.Add(top);
                }

                EnumChildWindows(
                    top,
                    delegate(IntPtr child, IntPtr childState)
                    {
                        uint childPid;
                        GetWindowThreadProcessId(child, out childPid);
                        if (
                            childPid == (uint)processId &&
                            String.Equals(WindowClass(child), "EXCEL7", StringComparison.OrdinalIgnoreCase)
                        ) {
                            result.Add(child);
                        }
                        return true;
                    },
                    IntPtr.Zero
                );

                return true;
            },
            IntPtr.Zero
        );

        result.AddRange(fallback);
        return result.ToArray();
    }

    public static object GetNativeObject(IntPtr hwnd)
    {
        Guid iidDispatch = new Guid("00020400-0000-0000-C000-000000000046");
        object nativeObject;
        int hr = AccessibleObjectFromWindow(hwnd, OBJID_NATIVEOM, ref iidDispatch, out nativeObject);
        return hr == 0 ? nativeObject : null;
    }
}
"@
  try {
    Invoke-CofiringCompiler -TypeDefinition $nativeOmTypeDefinition
  } catch {
    throw ("NativeOM Add-Type 컴파일 실패: " + $_.Exception.Message)
  }
}

Complete-CofiringWorkerPhase 'setupNativeCompile'

function Get-ProbeExcelProcessId($ExcelApplication) {
  if ($null -eq $ExcelApplication) { return 0 }

  [uint32]$processId = 0
  $windowHandle = [IntPtr]([int64](Get-CofiringExcelProperty -Target $ExcelApplication -Member 'Hwnd' -Operation 'Application.Hwnd' -TimeoutMilliseconds 5000).Value)
  if ($windowHandle -eq [IntPtr]::Zero) { return 0 }

  [void][GsBlowerRuntimeNativeOmV1]::GetWindowThreadProcessId(
    $windowHandle,
    [ref]$processId
  )
  return [int]$processId
}

function New-ProbeProcessSignature([System.Diagnostics.Process]$ProcessObject) {
  $path = ""
  try { $path = [string]$ProcessObject.Path } catch {
  }

  return [pscustomobject][ordered]@{
    ProcessId = [int]$ProcessObject.Id
    ProcessName = [string]$ProcessObject.ProcessName
    StartTicks = [long]$ProcessObject.StartTime.ToUniversalTime().Ticks
    SessionId = [int]$ProcessObject.SessionId
    Path = $path
  }
}

function Test-ProbeProcessSignature($Signature) {
  if ($null -eq $Signature) { return $false }
  $process = Get-Process -Id ([int]$Signature.ProcessId) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }

  try {
    if (-not [string]::Equals(
      [string]$process.ProcessName,
      [string]$Signature.ProcessName,
      [StringComparison]::OrdinalIgnoreCase
    )) { return $false }

    if ([long]$process.StartTime.ToUniversalTime().Ticks -ne [long]$Signature.StartTicks) {
      return $false
    }

    if ([int]$process.SessionId -ne [int]$Signature.SessionId) { return $false }

    if (-not [string]::IsNullOrWhiteSpace([string]$Signature.Path)) {
      $currentPath = ""
      try { $currentPath = [string]$process.Path } catch { return $false }
      if (-not [string]::Equals(
        [IO.Path]::GetFullPath($currentPath),
        [IO.Path]::GetFullPath([string]$Signature.Path),
        [StringComparison]::OrdinalIgnoreCase
      )) { return $false }
    }

    return $true
  } catch {
    return $false
  } finally {
    $process.Dispose()
  }
}

function Test-ProbeProcessSignatureSet([object[]]$Signatures) {
  foreach ($signature in @($Signatures)) {
    if (-not (Test-ProbeProcessSignature $signature)) { return $false }
  }
  return $true
}

function Test-ProbeExactProcessUniverse([object[]]$Signatures, [int[]]$CurrentProcessIds) {
  $expectedIds = @($Signatures | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
  $actualIds = @($CurrentProcessIds | ForEach-Object { [int]$_ } | Sort-Object -Unique)
  if ($expectedIds.Count -ne @($Signatures).Count -or $actualIds.Count -ne $expectedIds.Count) {
    return $false
  }
  foreach ($expectedId in $expectedIds) {
    if ($actualIds -notcontains [int]$expectedId) { return $false }
  }
  return (Test-ProbeProcessSignatureSet $Signatures)
}

function Test-OwnedProbeExcelIdentity {
  param(
    [int]$ProcessId,
    [long]$ExpectedStartTicks,
    [string]$ExpectedPath,
    [int]$ExpectedSessionId
  )

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }

  try {
    if (-not [string]::Equals([string]$process.ProcessName, "EXCEL", [StringComparison]::OrdinalIgnoreCase)) {
      return $false
    }
    if ([long]$process.StartTime.ToUniversalTime().Ticks -ne $ExpectedStartTicks) { return $false }
    if ([int]$process.SessionId -ne $ExpectedSessionId) { return $false }
    $actualPath = [string]$process.Path
    if ([string]::IsNullOrWhiteSpace($actualPath)) { return $false }
    return [string]::Equals(
      [IO.Path]::GetFullPath($actualPath),
      [IO.Path]::GetFullPath($ExpectedPath),
      [StringComparison]::OrdinalIgnoreCase
    )
  } catch {
    return $false
  } finally {
    $process.Dispose()
  }
}

# COFIRING_OWNED_EXCEL_WINDOW_GUARD_V1
$script:ownedExcelWindowGuard = $null
$script:ownedExcelWindowGuardReady = $false
$script:ownedExcelWindowGuardSource = @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public sealed class GsCofiringOwnedExcelWindowGuardV1 : IDisposable
{
    private const int SW_HIDE = 0;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint WAIT_TIMEOUT = 0x00000102;

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(
        EnumWindowsProc callback,
        IntPtr state
    );

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr hwnd,
        out uint processId
    );

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(
        IntPtr hwnd,
        int command
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(
        uint desiredAccess,
        bool inheritHandle,
        uint processId
    );

    [DllImport("kernel32.dll")]
    private static extern uint WaitForSingleObject(
        IntPtr handle,
        uint milliseconds
    );

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(
        IntPtr handle
    );

    private readonly uint _processId;
    private readonly IntPtr _processHandle;
    private Timer _timer;
    private int _busy;
    private bool _disposed;

    public GsCofiringOwnedExcelWindowGuardV1(int processId)
    {
        if (processId <= 0)
            throw new ArgumentOutOfRangeException("processId");

        _processId = checked((uint)processId);
        _processHandle = OpenProcess(
            SYNCHRONIZE,
            false,
            _processId
        );

        if (_processHandle == IntPtr.Zero)
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Owned Excel process handle could not be pinned."
            );

        _timer = new Timer(
            delegate(object state)
            {
                HideNowSafe();
            },
            null,
            0,
            25
        );
    }

    private bool OriginalProcessIsRunning()
    {
        return
            _processHandle != IntPtr.Zero &&
            WaitForSingleObject(_processHandle, 0) == WAIT_TIMEOUT;
    }

    private void HideNowSafe()
    {
        try
        {
            HideNow();
        }
        catch
        {
            // Never disturb the calculation because a UI hide attempt failed.
        }
    }

    public void HideNow()
    {
        if (_disposed || !OriginalProcessIsRunning())
            return;

        if (Interlocked.Exchange(ref _busy, 1) != 0)
            return;

        try
        {
            EnumWindows(
                delegate(IntPtr hwnd, IntPtr state)
                {
                    uint windowProcessId;

                    GetWindowThreadProcessId(
                        hwnd,
                        out windowProcessId
                    );

                    if (windowProcessId == _processId)
                        ShowWindowAsync(hwnd, SW_HIDE);

                    return true;
                },
                IntPtr.Zero
            );
        }
        finally
        {
            Interlocked.Exchange(ref _busy, 0);
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;

        Timer timer = _timer;
        _timer = null;

        if (timer != null)
            timer.Dispose();

        if (_processHandle != IntPtr.Zero)
            CloseHandle(_processHandle);
    }
}
"@

function Initialize-OwnedExcelWindowGuard {
  if ($script:ownedExcelWindowGuardReady) { return }
  Start-CofiringWorkerPhase 'setupWindowGuardCompile'

  try {
    Invoke-CofiringCompiler -TypeDefinition $script:ownedExcelWindowGuardSource
  }
  catch {
    if (-not ('GsCofiringOwnedExcelWindowGuardV1' -as [type])) {
      throw ('조회용 Excel 숨김 가드 초기화 실패: ' + $_.Exception.Message)
    }
  }

  $script:ownedExcelWindowGuardReady = $true
  Complete-CofiringWorkerPhase 'setupWindowGuardCompile'
}

function Stop-OwnedExcelWindowGuard {
  if ($null -eq $script:ownedExcelWindowGuard) { return }

  try {
    $script:ownedExcelWindowGuard.Dispose()
  }
  catch {
  }

  $script:ownedExcelWindowGuard = $null
}

function Start-OwnedExcelWindowGuard([int]$ProcessId) {
  Stop-OwnedExcelWindowGuard
  Initialize-OwnedExcelWindowGuard

  $script:ownedExcelWindowGuard =
    New-Object `
      GsCofiringOwnedExcelWindowGuardV1 `
      -ArgumentList ([int]$ProcessId)

  $script:ownedExcelWindowGuard.HideNow()
}

function Hide-OwnedExcelWindowNow {
  if ($null -eq $script:ownedExcelWindowGuard) { return }

  try {
    $script:ownedExcelWindowGuard.HideNow()
  }
  catch {
  }
}
# COFIRING_XLSX_ADDIN_STARTUP_V3: explicit document startup, validated on the company PC.
function New-CofiringDocumentSeed([string]$Directory, [string]$RunId) {
  if ($RunId -notmatch '^[a-f0-9]{32}$' -or [string]::IsNullOrWhiteSpace($Directory) -or
      -not [IO.Directory]::Exists($Directory)) { throw 'Invalid private document seed directory/run ID.' }
  $seedPath = Join-Path ([IO.Path]::GetFullPath($Directory)) ('cofiring-document-' + $RunId + '.xlsx')
  # Fixed empty OOXML: one worksheet, no macros, formulas, connections or external links.
  $seedBytes = [Convert]::FromBase64String('UEsDBBQAAAAIAAAARV1uYbgN/gAAAC0CAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2RzU7DMBCEX8XytYqdckAIJe2BnyNwKA+w2JvEiv/kdUv69jhp4YAKXDit7JnZb2Q328lZdsBEJviWr0XNGXoVtPF9y193j9UNZ5TBa7DBY8uPSHy7aXbHiMRK1lPLh5zjrZSkBnRAIkT0RelCcpDLMfUyghqhR3lV19dSBZ/R5yrPO/imuccO9jazh6lcn3oktMTZ3ck4s1oOMVqjIBddHrz+RqnOBFGSi4cGE2lVDFxeJMzKz4Bz7rk8TDIa2Quk/ASuuORk5XtI41sIo/h9yYWWoeuMQh3U3pWIoJgQNA2I2VmxTOHA+NXf/MVMchnrfy7ytf+zh1y+e/MBUEsDBBQAAAAIAAAARV2Y2uuLrgAAACcBAAALAAAAX3JlbHMvLnJlbHONz8EOgjAMBuBXWXqXgQdjDIOLMeFq8AHmVgYB1mWbCm/vjmI8eGz69/vTsl7miT3Rh4GsgCLLgaFVpAdrBNzay+4ILERptZzIooAVA9RVecVJxnQS+sEFlgwbBPQxuhPnQfU4y5CRQ5s2HflZxjR6w51UozTI93l+4P7TgK3JGi3AN7oA1q4O/7Gp6waFZ1KPGW38UfGVSLL0BqOAZeIv8uOdaMwSCrwq+ebB6g1QSwMEFAAAAAgAAABFXcYPMsXTAAAAUAEAAA8AAAB4bC93b3JrYm9vay54bWyNUE1vwjAM/SuR75CywzRVTbmgSZzHdjeJSyOaOIoDbP9+Kajajpzs54/n99xtv8OkrpTFczSwWTegKFp2Pp4MfB7eV2+gpGB0OHEkAz8ksO27G+fzkfms6noUA2MpqdVa7EgBZc2JYu0MnAOWCvNJS8qETkaiEib90jSvOqCP8GBo8zMcPAze0o7tJVAsD5JME5YqXkafBPpuVvXl6SZ/Imeo0BZ/pQMeDTSg+07/G7yrWqKKGKrRj4K5XFJ1Pxf3rj4HVG59TfLebe4Uy55eLvW/UEsDBBQAAAAIAAAARV1a/YJrsQAAACgBAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHONz8kKwkAMBuBXGXK3aT2ISKdeROhV6gMM03ShnYXJuPTtHTyIBQ+eQvKTL6Q8Ps0s7hR4dFZCkeUgyGrXjraXcG3Omz0Ijsq2anaWJCzEcKzKC80qphUeRs8iGZYlDDH6AyLrgYzizHmyKelcMCqmNvTolZ5UT7jN8x2GbwPWpqhbCaFuCxDN4ukf23XdqOnk9M2QjT9O4MOFiQeimFAVeooSPiPGdymypAJWJa4+rF5QSwMEFAAAAAgAAABFXbEQyuGjAAAA5AAAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxljssOgjAQRX+lmb0UXBhjaNkYE9c+9gMdgUBb0mlE/97Cwpi4mzM3J/eW1cuO4kmBe+8UFFkOglzjTe9aBbfrabMHwRGdwdE7UvAmhkqXsw8Dd0RRJN+xgi7G6SAlNx1Z5MxP5FLy8MFiTBhayVMgNKtkR7nN85202DvQ5fq79zTzzy2Witr7YYGzUZCWRawvNFITKXEBUpfyzz1ixCX4LtQfUEsBAhQDFAAAAAgAAABFXW5huA3+AAAALQIAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACAAAAEVdmNrri64AAAAnAQAACwAAAAAAAAAAAAAAgAEvAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACAAAAEVdxg8yxdMAAABQAQAADwAAAAAAAAAAAAAAgAEGAgAAeGwvd29ya2Jvb2sueG1sUEsBAhQDFAAAAAgAAABFXVr9gmuxAAAAKAEAABoAAAAAAAAAAAAAAIABBgMAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAhQDFAAAAAgAAABFXbEQyuGjAAAA5AAAABgAAAAAAAAAAAAAAIAB7wMAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLBQYAAAAABQAFAEUBAADIBAAAAAA=')
  $seedStream = [IO.File]::Open($seedPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $seedStream.Write($seedBytes, 0, $seedBytes.Length) } finally { $seedStream.Dispose() }
  if ((Get-FileHash -LiteralPath $seedPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne '5856dcf30b6c64f81e77a0065c847296be3cf05e62310bb778a3bd5d2ce19f43') {
    throw 'Document seed byte verification failed.'
  }
  return $seedPath
}

# Diagnostic reads only; never install or invoke an add-in, or change its security settings.
function Write-CofiringAddinRuntimeSnapshot {
  param($Application, [int]$ExpectedPid, [ValidateSet('before-host','host-ready','host-not-ready')][string]$Stage)
  $snapshot = [ordered]@{
    kind='cofiring_addin_runtime_v2';runId=[string]$env:GS_COFIRING_RUN_ID
    capturedAtUtc=[datetime]::UtcNow.ToString('o');stage=$Stage;ownedExcelPid=$ExpectedPid
    enableEvents=$null;automationSecurity=$null;workbookCount=$null;addinCount=$null
    inspectedAddins=0;dataPARC=@();errors=@();truncated=$false
    note='Installed is registration state. IsOpen reports whether the add-in is open. Neither alone proves Host readiness.'
  }
  $diagnosticClock = [Diagnostics.Stopwatch]::StartNew()
  $addins = $null; $books = $null
  try {
    if (-not (Test-OwnedProbeExcelIdentity $ExpectedPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId) -or
        (Get-ProbeExcelProcessId $Application) -ne $ExpectedPid) { throw 'Diagnostic Excel identity mismatch; no add-in properties read.' }
    foreach ($member in @('EnableEvents','AutomationSecurity')) {
      try {
        $value = (Get-CofiringExcelProperty -Target $Application -Member $member -Operation ('Trial.'+$Stage+'.'+$member) -TimeoutMilliseconds 500 -MaxAttempts 2).Value
        if ($member -eq 'EnableEvents') { $snapshot.enableEvents=[bool]$value } else { $snapshot.automationSecurity=[int]$value }
      } catch { $snapshot.errors += ($member+': '+$_.Exception.Message) }
    }
    try {
      $books = (Get-CofiringExcelProperty -Target $Application -Member 'Workbooks' -Operation ('Trial.'+$Stage+'.Workbooks') -TimeoutMilliseconds 500 -MaxAttempts 2).Value
      $snapshot.workbookCount = [int](Get-CofiringExcelProperty -Target $books -Member 'Count' -Operation ('Trial.'+$Stage+'.Workbooks.Count') -TimeoutMilliseconds 500 -MaxAttempts 2).Value
    } catch { $snapshot.errors += ('Workbooks: '+$_.Exception.Message) }
    finally { Release-ProbeCom $books; $books=$null }
    $addins = (Get-CofiringExcelProperty -Target $Application -Member 'AddIns' -Operation ('Trial.'+$Stage+'.AddIns') -TimeoutMilliseconds 500 -MaxAttempts 2).Value
    $count = [int](Get-CofiringExcelProperty -Target $addins -Member 'Count' -Operation ('Trial.'+$Stage+'.AddIns.Count') -TimeoutMilliseconds 500 -MaxAttempts 2).Value
    $snapshot.addinCount = $count
    for ($index=1; $index -le $count; $index++) {
      # Retry/iteration budget, not a hard timeout for a synchronous COM call.
      if ($index -gt 100 -or $diagnosticClock.Elapsed.TotalSeconds -ge 4) { $snapshot.truncated=$true; break }
      $addin = $null
      try {
        $addin = (Get-CofiringExcelProperty -Target $addins -Member 'Item' -Indices @($index) -Operation ('Trial.'+$Stage+'.AddIns.Item') -TimeoutMilliseconds 500 -MaxAttempts 2).Value
        $name = [string](Get-CofiringExcelProperty -Target $addin -Member 'Name' -Operation ('Trial.'+$Stage+'.AddIn.Name') -TimeoutMilliseconds 500 -MaxAttempts 2).Value
        $snapshot.inspectedAddins++
        if ($name -match '(?i)dataparc|parcview|parcxla') {
          $item = [ordered]@{name=$name;fullName=$null;installed=$null;isOpen=$null;errors=@()}
          foreach ($member in @('FullName','Installed','IsOpen')) {
            try {
              $value = (Get-CofiringExcelProperty -Target $addin -Member $member -Operation ('Trial.'+$Stage+'.AddIn.'+$member) -TimeoutMilliseconds 500 -MaxAttempts 2).Value
              if ($member -eq 'Installed') { $item.installed=[bool]$value }
              elseif ($member -eq 'IsOpen') { $item.isOpen=[bool]$value }
              else { $item.fullName=[string]$value }
            } catch { $item.errors += ($member+': '+$_.Exception.Message) }
          }
          $snapshot.dataPARC += [pscustomobject]$item
        }
      } catch { $snapshot.errors += ('AddIn index '+$index+': '+$_.Exception.Message) }
      finally { Release-ProbeCom $addin }
    }
  } catch { $snapshot.errors += $_.Exception.Message }
  finally { Release-ProbeCom $books; Release-ProbeCom $addins; $diagnosticClock.Stop() }
  $snapshot.elapsedSeconds=[Math]::Round($diagnosticClock.Elapsed.TotalSeconds,3)
  try {
    $tracePath = [string]$env:GS_COFIRING_COM_TRACE_PATH
    if ([string]::IsNullOrWhiteSpace($tracePath)) { throw 'Missing controller diagnostic path.' }
    $snapshotPath = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($tracePath))) ('addin-runtime-'+$Stage+'.json')
    [IO.File]::WriteAllText($snapshotPath,($snapshot | ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
    Write-ProbeStage ('추가기능 상태 기록 · '+$Stage+' · DataPARC '+$snapshot.dataPARC.Count+'개 · 읽기 오류 '+$snapshot.errors.Count+'개')
  } catch { Write-ProbeStage ('추가기능 진단 기록 실패: '+$_.Exception.Message) }
}

function Test-CofiringDocumentSeedWorkbook([string]$FullName,[string]$SeedPath) {
  if ([string]::IsNullOrWhiteSpace($FullName) -or [string]::IsNullOrWhiteSpace($SeedPath)) { return $false }
  try { return [string]::Equals([IO.Path]::GetFullPath($FullName),[IO.Path]::GetFullPath($SeedPath),[StringComparison]::OrdinalIgnoreCase) }
  catch { return $false }
}


# Production V3: load only the existing registered vendor add-in in our owned Excel.
# No registry writes, Installed toggle, AutomationSecurity change, or VBProject access.
function Assert-CofiringLoadExcelIdentity($Application,[int]$ExpectedPid) {
  if (-not (Test-OwnedProbeExcelIdentity $ExpectedPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId) -or
      (Get-ProbeExcelProcessId $Application) -ne $ExpectedPid) {
    throw 'DataPARC 로드 중 Excel 소유관계 확인 실패. 추가 호출을 중단합니다.'
  }
}

function Get-CofiringRegisteredDataParcState($Application,[int]$ExpectedPid) {
  Assert-CofiringLoadExcelIdentity $Application $ExpectedPid
  $addins=$null; $item=$null; $matches=@()
  try {
    $addins=(Get-CofiringExcelProperty -Target $Application -Member 'AddIns' -Operation 'Load.AddIns').Value
    $count=[int](Get-CofiringExcelProperty -Target $addins -Member 'Count' -Operation 'Load.AddIns.Count').Value
    if ($count -lt 1 -or $count -gt 100) { throw 'DataPARC 등록 목록을 완전히 확인할 수 없습니다.' }
    for ($i=1; $i -le $count; $i++) {
      try {
        $item=(Get-CofiringExcelProperty -Target $addins -Member 'Item' -Indices @($i) -Operation 'Load.AddIns.Item').Value
        $name=[string](Get-CofiringExcelProperty -Target $item -Member 'Name' -Operation 'Load.AddIn.Name').Value
        if ($name -ieq 'DataPARC_AddIn.xla') {
          $full=[string](Get-CofiringExcelProperty -Target $item -Member 'FullName' -Operation 'Load.AddIn.FullName').Value
          $installed=(Get-CofiringExcelProperty -Target $item -Member 'Installed' -Operation 'Load.AddIn.Installed').Value
          $opened=(Get-CofiringExcelProperty -Target $item -Member 'IsOpen' -Operation 'Load.AddIn.IsOpen').Value
          if ($installed -isnot [bool] -or $opened -isnot [bool]) { throw 'DataPARC Installed/IsOpen 상태가 불명확합니다.' }
          $matches += [pscustomobject]@{name=$name;fullName=$full;installed=$installed;isOpen=$opened}
        }
      } finally { Release-ProbeCom $item; $item=$null }
    }
    if ($matches.Count -ne 1 -or -not $matches[0].installed) { throw '설치된 DataPARC 추가기능 하나를 확인할 수 없습니다.' }
    return $matches[0]
  } finally { Release-ProbeCom $item; Release-ProbeCom $addins }
}

function Get-CofiringDataParcFileEvidence([string]$FullName) {
  if ([string]::IsNullOrWhiteSpace($FullName) -or -not [IO.Path]::IsPathRooted($FullName) -or $FullName.StartsWith('\\')) {
    throw 'DataPARC 파일은 로컬 설치 경로여야 합니다.'
  }
  $path=[IO.Path]::GetFullPath($FullName)
  $allowed=$false
  foreach ($root in @([string]$env:ProgramFiles,[string]([Environment]::GetEnvironmentVariable('ProgramFiles(x86)')))) {
    if ([string]::IsNullOrWhiteSpace($root)) { continue }
    $expected=[IO.Path]::GetFullPath((Join-Path $root 'Capstone\PARCView\DataPARC_AddIn.xla'))
    if ([string]::Equals($path,$expected,[StringComparison]::OrdinalIgnoreCase)) { $allowed=$true }
  }
  if (-not $allowed -or -not [IO.File]::Exists($path)) { throw '등록된 DataPARC 파일이 확인된 Capstone 설치 경로와 다르거나 없습니다.' }
  $drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($path))
  if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'DataPARC 파일이 고정 로컬 드라이브에 있지 않습니다.' }
  $node=Get-Item -LiteralPath $path -Force -ErrorAction Stop
  while ($null -ne $node) {
    if (($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'DataPARC 경로에 링크/재분석 지점이 있어 중단합니다.' }
    if ($node -is [IO.FileInfo]) { $node=$node.Directory } else { $node=$node.Parent }
  }
  return [pscustomobject]@{path=$path;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $path).Length}
}

function Invoke-CofiringDataParcLoad($Application,[int]$ExpectedPid) {
  $result=[ordered]@{kind='cofiring_dataparc_load_v3';runId=[string]$env:GS_COFIRING_RUN_ID;ownedExcelPid=$ExpectedPid
    status='FAILED';before=$null;after=$null;file=$null;openAttempted=$false;autoOpenAttempted=$false
    automationSecurity=$null;enableEvents=$null;elapsedSeconds=$null;error=$null}
  $timer=[Diagnostics.Stopwatch]::StartNew(); $books=$null; $addinBook=$null
  try {
    Assert-CofiringLoadExcelIdentity $Application $ExpectedPid
    $security=[int](Get-CofiringExcelProperty -Target $Application -Member 'AutomationSecurity' -Operation 'Load.AutomationSecurity').Value
    $events=(Get-CofiringExcelProperty -Target $Application -Member 'EnableEvents' -Operation 'Load.EnableEvents').Value
    $result.automationSecurity=$security; $result.enableEvents=$events
    if ($security -notin @(1,2) -or $events -isnot [bool] -or -not $events) { throw '현재 Excel 보안/이벤트 상태에서 DataPARC를 초기화할 수 없습니다. 설정은 변경하지 않습니다.' }
    $state=Get-CofiringRegisteredDataParcState $Application $ExpectedPid
    $result.before=$state
    $file=Get-CofiringDataParcFileEvidence $state.fullName
    $result.file=$file
    if (-not $state.isOpen) {
      $books=(Get-CofiringExcelProperty -Target $Application -Member 'Workbooks' -Operation 'Load.Workbooks').Value
      # Re-read before the one non-idempotent Open, in case Excel completed startup.
      $state=Get-CofiringRegisteredDataParcState $Application $ExpectedPid
      if (-not [string]::Equals($state.fullName,$file.path,[StringComparison]::OrdinalIgnoreCase)) { throw 'DataPARC 등록 경로가 로드 직전에 바뀌었습니다.' }
      if (-not $state.isOpen) {
        Assert-CofiringLoadExcelIdentity $Application $ExpectedPid
        Write-ProbeStage '등록된 DataPARC XLA 열기 · 1회 · 읽기 전용'
        $result.openAttempted=$true
        $addinBook=(Invoke-CofiringExcelCall -Operation 'Load.DataPARC.Workbooks.Open' -NoRetry -Action {
          param($box)
          $box.Value=$books.Open($file.path,0,$true)
        }).Value
        Assert-CofiringLoadExcelIdentity $Application $ExpectedPid
        $openedPath=[string](Get-CofiringExcelProperty -Target $addinBook -Member 'FullName' -Operation 'Load.Workbook.FullName').Value
        $isAddin=(Get-CofiringExcelProperty -Target $addinBook -Member 'IsAddin' -Operation 'Load.Workbook.IsAddin').Value
        if (-not [string]::Equals($openedPath,$file.path,[StringComparison]::OrdinalIgnoreCase) -or $isAddin -isnot [bool] -or -not $isAddin) { throw '열린 통합문서가 등록된 DataPARC 추가기능과 다릅니다.' }
        $state=Get-CofiringRegisteredDataParcState $Application $ExpectedPid
        if (-not $state.isOpen) { throw 'DataPARC 파일 열기 후에도 IsOpen=False입니다.' }
        # The successful company-PC trial needed only Open. Wait for its Host below.
      }
    }
    Assert-CofiringLoadExcelIdentity $Application $ExpectedPid
    $result.after=Get-CofiringRegisteredDataParcState $Application $ExpectedPid
    if (-not $result.after.isOpen -or -not [string]::Equals($result.after.fullName,$file.path,[StringComparison]::OrdinalIgnoreCase)) { throw 'DataPARC 로드 완료 상태를 확인하지 못했습니다.' }
    $result.status='LOADED'
    Write-ProbeStage 'DataPARC 파일 로드 확인 · IsOpen=True'
  } catch { $result.error=$_.Exception.Message; throw }
  finally {
    Release-ProbeCom $addinBook; Release-ProbeCom $books
    $timer.Stop(); $result.elapsedSeconds=[Math]::Round($timer.Elapsed.TotalSeconds,3)
    try {
      $output=Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath([string]$env:GS_COFIRING_COM_TRACE_PATH))) 'addin-load.json'
      [IO.File]::WriteAllText($output,($result|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding($false)))
    } catch { Write-ProbeStage ('DataPARC 로드 기록 저장 실패: '+$_.Exception.Message) }
  }
}

function Wait-OwnedProbeExcelNativeObject {
  param(
    [int]$ExcelProcessId,
    [datetime]$Deadline,
    [int[]]$AllowedBaselineExcelPids
  )

  $nativeOmScan=0
  $nativeOmGraceClock=[Diagnostics.Stopwatch]::StartNew()
  $nativeOmDeferredScans=0
  $nativeOmGraceActive=$true
  do {
    $nativeOmScan+=1
    $inventorySpan=Start-CofiringNativeOmSpan 'processInventory' $excelAttachAttempt $nativeOmScan
    $inventoryOutcome='failed'
    try {
      $runningExcel = @(Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue | Where-Object { [int]$_.SessionId -eq $ownedExcelSessionId })
      $unexpected = @(
        $runningExcel | Where-Object {
          [int]$_.Id -ne $ExcelProcessId -and
          $AllowedBaselineExcelPids -notcontains [int]$_.Id
        }
      )
      if ($unexpected.Count -gt 0) {
        throw (
          "DataPARC 조회 중 등록되지 않은 Excel 인스턴스가 시작되었습니다. PID=" +
          (($unexpected | Select-Object -ExpandProperty Id) -join ", ")
        )
      }
      if ($null -eq (Get-Process -Id $ExcelProcessId -ErrorAction SilentlyContinue)) {
        throw "자동조회용 Excel이 COM 연결 전에 종료되었습니다."
      }
      $inventoryOutcome='returned'
    } finally { Complete-CofiringNativeOmSpan $inventorySpan $inventoryOutcome }

    $windowsSpan=Start-CofiringNativeOmSpan 'windowEnumeration' $excelAttachAttempt $nativeOmScan
    $windowsOutcome='failed'
    try {
      $nativeWindows=@([GsBlowerRuntimeNativeOmV1]::FindNativeObjectWindows($ExcelProcessId))
      $nativeHasDocument=$false
      $nativeClassesKnown=$true
      foreach ($candidateWindow in $nativeWindows) {
        try {
          $candidateClass=[GsBlowerRuntimeNativeOmV1]::WindowClass([IntPtr]$candidateWindow)
          if ($candidateClass -eq 'EXCEL7') { $nativeHasDocument=$true }
          elseif ($candidateClass -ne 'XLMAIN') { $nativeClassesKnown=$false }
        } catch { $nativeClassesKnown=$false }
      }
      $windowsOutcome=$(if ($nativeWindows.Count -gt 0) { 'returned' } else { 'empty' })
    } finally { Complete-CofiringNativeOmSpan $windowsSpan $windowsOutcome }
    if ($nativeOmGraceActive) {
      $graceDelay=Get-CofiringNativeOmGraceDelay $nativeHasDocument $nativeClassesKnown $nativeOmGraceClock.Elapsed.TotalMilliseconds $nativeOmDeferredScans (($Deadline-[datetime]::UtcNow).TotalMilliseconds)
      if ($graceDelay -gt 0) {
        Assert-CofiringNotCancelled
        $nativeOmDeferredScans+=1
        $graceSpan=Start-CofiringNativeOmSpan 'documentGraceSleep' $excelAttachAttempt $nativeOmScan
        $graceOutcome='failed'
        try { Start-Sleep -Milliseconds $graceDelay; $graceOutcome='returned' }
        finally { Complete-CofiringNativeOmSpan $graceSpan $graceOutcome }
        continue
      }
      $nativeOmGraceActive=$false
    }
    foreach ($nativeWindow in $nativeWindows) {
      $nativeObject = $null
      $candidateApplication = $null
      $keep = $false
      $nativeWindowClass=''
      # NativeOM is documented for EXCEL7. Do not make blocking COM calls on XLMAIN.
      try { $nativeWindowClass=[GsBlowerRuntimeNativeOmV1]::WindowClass([IntPtr]$nativeWindow) } catch { }
      if ($nativeWindowClass -ne 'EXCEL7') { continue }
      try {
        $nativeSpan=Start-CofiringNativeOmSpan 'nativeObject' $excelAttachAttempt $nativeOmScan (([IntPtr]$nativeWindow).ToInt64()) $nativeWindowClass
        $nativeOutcome='failed'
        try {
          $nativeObject = [GsBlowerRuntimeNativeOmV1]::GetNativeObject([IntPtr]$nativeWindow)
          $nativeOutcome=$(if ($null -ne $nativeObject) { 'returned' } else { 'empty' })
        } finally { Complete-CofiringNativeOmSpan $nativeSpan $nativeOutcome }
        if ($null -eq $nativeObject) { continue }

        $applicationSpan=Start-CofiringNativeOmSpan 'application' $excelAttachAttempt $nativeOmScan (([IntPtr]$nativeWindow).ToInt64()) $nativeWindowClass
        $applicationOutcome='failed'
        try {
          $candidateApplication = (Get-CofiringExcelProperty -Target $nativeObject -Member 'Application' -Operation 'NativeOM.Application' -TimeoutMilliseconds 1000).Value
          $applicationOutcome=$(if ($null -ne $candidateApplication) { 'returned' } else { 'empty' })
        } catch { $candidateApplication = $null }
        finally { Complete-CofiringNativeOmSpan $applicationSpan $applicationOutcome }
        if ($null -eq $candidateApplication) { continue }

        $identitySpan=Start-CofiringNativeOmSpan 'pidVerification' $excelAttachAttempt $nativeOmScan (([IntPtr]$nativeWindow).ToInt64()) $nativeWindowClass
        $identityOutcome='failed'
        try {
          $nativePidMatches=((Get-ProbeExcelProcessId $candidateApplication) -eq $ExcelProcessId)
          $identityOutcome=$(if ($nativePidMatches) { 'matched' } else { 'mismatch' })
        } finally { Complete-CofiringNativeOmSpan $identitySpan $identityOutcome }
        if ($nativePidMatches) {
          $keep = $true
          return $candidateApplication
        }
      } catch {
      } finally {
        $releaseSpan=Start-CofiringNativeOmSpan 'comRelease' $excelAttachAttempt $nativeOmScan (([IntPtr]$nativeWindow).ToInt64()) $nativeWindowClass
        $releaseOutcome='failed'
        try {
          Release-ProbeCom $nativeObject
          if (-not $keep -and $null -ne $candidateApplication) {
            Release-ProbeCom $candidateApplication
          }
          $releaseOutcome='returned'
        } finally { Complete-CofiringNativeOmSpan $releaseSpan $releaseOutcome }
      }
    }

    $sleepSpan=Start-CofiringNativeOmSpan 'retrySleep' $excelAttachAttempt $nativeOmScan
    $sleepOutcome='failed'
    try { Start-Sleep -Milliseconds 300; $sleepOutcome='returned' }
    finally { Complete-CofiringNativeOmSpan $sleepSpan $sleepOutcome }
  } while ([datetime]::UtcNow -lt $Deadline)

  return $null
}

function Get-ProbeDataParcHosts {
  return @(
    Get-CimInstance -ClassName Win32_Process -Filter "Name='CTCExcelAddIn.PARCviewHost.exe'" -ErrorAction Stop
  )
}

function Test-ProbeAllowedHostPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }

  try {
    $normalized = [IO.Path]::GetFullPath($Path)
    if (-not [string]::Equals(
      [IO.Path]::GetFileName($normalized),
      "CTCExcelAddIn.PARCviewHost.exe",
      [StringComparison]::OrdinalIgnoreCase
    )) { return $false }

    foreach ($root in @([string]$env:ProgramFiles, [string]([Environment]::GetEnvironmentVariable("ProgramFiles(x86)")))) {
      if ([string]::IsNullOrWhiteSpace($root)) { continue }
      $allowed = [IO.Path]::GetFullPath((Join-Path $root "Capstone\PARCView")).TrimEnd('\') + '\'
      if ($normalized.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
        return $true
      }
    }
  } catch {
  }

  return $false
}

function New-ProbeHostSignature {
  param(
    $CimProcess,
    [int]$ExpectedParentPid,
    [long]$MinimumStartTicks,
    [int]$ExpectedSessionId
  )

  if (
    [int]$CimProcess.ParentProcessId -ne $ExpectedParentPid -or
    [int]$CimProcess.SessionId -ne $ExpectedSessionId
  ) {
    throw "자동조회용 DataPARC Host의 부모 PID 또는 세션이 일치하지 않습니다."
  }

  $process = Get-Process -Id ([int]$CimProcess.ProcessId) -ErrorAction Stop
  try {
    $startTicks = [long]$process.StartTime.ToUniversalTime().Ticks
    $path = [string]$process.Path
    if ($startTicks -lt $MinimumStartTicks -or -not (Test-ProbeAllowedHostPath $path)) {
      throw "자동조회용 DataPARC Host의 생성시각 또는 실행경로를 신뢰할 수 없습니다."
    }

    return [pscustomobject][ordered]@{
      ProcessId = [int]$process.Id
      ProcessName = [string]$process.ProcessName
      ParentProcessId = [int]$CimProcess.ParentProcessId
      StartTicks = $startTicks
      SessionId = [int]$process.SessionId
      Path = [IO.Path]::GetFullPath($path)
    }
  } finally {
    $process.Dispose()
  }
}

function Test-ProbeHostSignature($Signature) {
  if ($null -eq $Signature) { return $false }
  $process = Get-Process -Id ([int]$Signature.ProcessId) -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }

  try {
    if (-not [string]::Equals(
      [string]$process.ProcessName,
      [string]$Signature.ProcessName,
      [StringComparison]::OrdinalIgnoreCase
    )) { return $false }
    if ([long]$process.StartTime.ToUniversalTime().Ticks -ne [long]$Signature.StartTicks) { return $false }
    if ([int]$process.SessionId -ne [int]$Signature.SessionId) { return $false }
    $currentPath = [string]$process.Path
    if (-not [string]::Equals(
      [IO.Path]::GetFullPath($currentPath),
      [string]$Signature.Path,
      [StringComparison]::OrdinalIgnoreCase
    )) { return $false }

    $cim = @(Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId=" + [string]$Signature.ProcessId) -ErrorAction Stop)
    return (
      $cim.Count -eq 1 -and
      [int]$cim[0].ParentProcessId -eq [int]$Signature.ParentProcessId -and
      [int]$cim[0].SessionId -eq [int]$Signature.SessionId
    )
  } catch {
    return $false
  } finally {
    $process.Dispose()
  }
}

function Wait-OwnedProbeDataParcHost {
  param(
    [int]$ExcelProcessId,
    [int[]]$BaselineExcelPids,
    [datetime]$Deadline
  )

  do {
    $hosts = @(Get-ProbeDataParcHosts)
    $owned = @($hosts | Where-Object { [int]$_.ParentProcessId -eq $ExcelProcessId })
    $unexpected = @(
      $hosts | Where-Object {
        [int]$_.SessionId -eq $ownedExcelSessionId -and
        [int]$_.ParentProcessId -ne $ExcelProcessId -and
        $BaselineExcelPids -notcontains [int]$_.ParentProcessId
      }
    )

    if ($unexpected.Count -gt 0) {
      throw (
        "DataPARC 조회 중 소유관계를 확인할 수 없는 Host가 시작되었습니다. PID=" +
        (($unexpected | Select-Object -ExpandProperty ProcessId) -join ", ")
      )
    }

    if ($owned.Count -eq 1) { return $owned[0] }
    if ($owned.Count -gt 1) { throw "자동조회용 Excel에 DataPARC Host가 둘 이상 연결되었습니다." }
    Start-Sleep -Milliseconds 400
  } while ([datetime]::UtcNow -lt $Deadline)

  return $null
}

function Wait-ProbeProcessExit([int]$ProcessId, [datetime]$Deadline) {
  do {
    if (-not (Test-CofiringWorkerProcessPresent $ProcessId)) { return $true }
    Start-Sleep -Milliseconds 250
  } while ([datetime]::UtcNow -lt $Deadline)
  return (-not (Test-CofiringWorkerProcessPresent $ProcessId))
}

function Complete-OwnedProbeExcelExit {
  param(
    $ProcessObject,
    [int]$ExpectedProcessId,
    [long]$ExpectedStartTicks,
    [string]$ExpectedPath,
    [int]$ExpectedSessionId
  )

  # This is the Process object retained at our own Start-Process /x launch. Keep
  # its open handle until Host cleanup ends; never reopen or terminate by PID.
  if ($null -eq $ProcessObject -or [int]$ProcessObject.Id -ne $ExpectedProcessId) {
    throw '자동조회용 Excel의 시작 시 보관한 프로세스 핸들을 확인할 수 없습니다.'
  }
  [void]$ProcessObject.Handle
  if ($ProcessObject.WaitForExit(12000)) {
    return [pscustomobject]@{ Exited=$true; Forced=$false }
  }

  try {
    if ([string]$ProcessObject.ProcessName -ine 'EXCEL' -or
        [long]$ProcessObject.StartTime.ToUniversalTime().Ticks -ne $ExpectedStartTicks -or
        [int]$ProcessObject.SessionId -ne $ExpectedSessionId -or
        [string]::IsNullOrWhiteSpace([string]$ProcessObject.Path) -or
        [string]::IsNullOrWhiteSpace($ExpectedPath) -or
        -not [string]::Equals([IO.Path]::GetFullPath([string]$ProcessObject.Path),
          [IO.Path]::GetFullPath($ExpectedPath),[StringComparison]::OrdinalIgnoreCase)) {
      throw '자동조회용 Excel PID 신원이 바뀌어 강제 종료하지 않았습니다.'
    }
  } catch {
    # Property access can race with graceful exit. Only this exact retained
    # process handle can prove exit; an error or a different PID never does.
    if ($ProcessObject.HasExited) {
      return [pscustomobject]@{ Exited=$true; Forced=$false }
    }
    throw
  }

  try {
    $ProcessObject.Kill()
  } catch {
    # Quit can finish after identity validation but before Kill. This is a
    # successful exit, not a cleanup failure or a reason to block the queue.
    if ($ProcessObject.HasExited) {
      return [pscustomobject]@{ Exited=$true; Forced=$false }
    }
    throw
  }
  if (-not $ProcessObject.WaitForExit(5000)) {
    throw '자동조회용 Excel이 종료되지 않았습니다.'
  }
  return [pscustomobject]@{ Exited=$true; Forced=$true }
}

# COFIRING_EXCEL_NATIVEOM_RETRY_V4
function Stop-OwnedProbeExcelAttachAttempt {
  param(
    $ProcessObject,
    [int]$ExpectedProcessId,
    [long]$ExpectedStartTicks,
    [string]$ExpectedPath,
    [int]$ExpectedSessionId
  )
  if ($null -eq $ProcessObject -or [int]$ProcessObject.Id -ne $ExpectedProcessId) {
    throw 'Excel COM 재시도 전 소유 프로세스 핸들을 확인할 수 없습니다.'
  }
  [void]$ProcessObject.Handle
  if ($ProcessObject.HasExited) { return }
  if (-not (Test-OwnedProbeExcelIdentity $ExpectedProcessId $ExpectedStartTicks $ExpectedPath $ExpectedSessionId)) {
    throw 'Excel COM 재시도 전 소유 Excel 신원이 일치하지 않습니다.'
  }
  $lateHosts=@(Get-ProbeDataParcHosts | Where-Object { [int]$_.ParentProcessId -eq $ExpectedProcessId })
  if ($lateHosts.Count -gt 0) {
    throw 'Excel COM 연결 대기 중 DataPARC Host가 이미 시작되어 자동 재시도를 중단합니다.'
  }
  try { $ProcessObject.Kill() }
  catch { if (-not $ProcessObject.HasExited) { throw } }
  if (-not $ProcessObject.HasExited -and -not $ProcessObject.WaitForExit(5000)) {
    throw 'Excel COM 재시도 전 소유 Excel을 종료하지 못했습니다.'
  }
}

function Test-ProbePinnedProcessExited($Process) {
  if ($null -eq $Process) { return $false }
  try {
    $Process.Refresh()
    return [bool]$Process.HasExited
  } catch {
    return $false
  }
}

function Wait-ProbePinnedProcessExit($Process, [int]$TimeoutMilliseconds) {
  if (Test-ProbePinnedProcessExited $Process) { return $true }
  try {
    if ($Process.WaitForExit($TimeoutMilliseconds)) { return $true }
  } catch {
  }
  return (Test-ProbePinnedProcessExited $Process)
}

function Write-ProbeOwnership {
  $ownershipPath = [string]$env:GS_COFIRING_OWNERSHIP_PATH
  if ([string]::IsNullOrWhiteSpace($ownershipPath)) { return }
  $workerProcess = Get-Process -Id $PID -ErrorAction Stop
  try { $workerSignature = New-ProbeProcessSignature $workerProcess } finally { $workerProcess.Dispose() }
  $excelSignature = $null
  if ($ownedExcelPid -gt 0) {
    $excelSignature = [ordered]@{
      ProcessId = $ownedExcelPid
      ProcessName = "EXCEL"
      StartTicks = $ownedExcelStartTicks
      SessionId = $ownedExcelSessionId
      Path = $ownedExcelPath
      ParentProcessId = $PID
    }
  }
  $snapshot = [ordered]@{
    schemaVersion = 1
    runId = [string]$env:GS_COFIRING_RUN_ID
    updatedAt = [datetime]::UtcNow.ToString("o")
    worker = $workerSignature
    excel = $excelSignature
    host = $ownedHostSnapshot
    baselineExcel = @($baselineExcelSignatures)
    baselineHosts = @($baselineHostSignatures)
  }
  $temporaryPath = $ownershipPath + ".new"
  [IO.File]::WriteAllText($temporaryPath, ($snapshot | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
  if ([IO.File]::Exists($ownershipPath)) {
    # V1.1: Windows PowerShell 5.1 can bind $null to an empty String here.
    # Supply a real sibling path; Replace also replaces an existing backup.
    # The controller removes this private temporary directory after cleanup.
    $backupPath = $ownershipPath + ".previous"
    # COFIRING_OWNERSHIP_REPLACE_RETRY_V1
    # The controller briefly reads ownership.json while the worker refreshes it.
    # Windows can reject File.Replace during that tiny sharing window; retry only sharing/lock violations.
    $replaceClock=[Diagnostics.Stopwatch]::StartNew()
    $replaceAttempt=0
    while ($true) {
      try {
        [IO.File]::Replace($temporaryPath, $ownershipPath, $backupPath)
        break
      } catch [IO.IOException] {
        $win32Code=([int]$_.Exception.HResult) -band 0xFFFF
        if ($win32Code -notin @(32,33) -or $replaceClock.ElapsedMilliseconds -ge 3000) { throw }
        $replaceAttempt+=1
        Start-Sleep -Milliseconds ([Math]::Min(50*$replaceAttempt,250))
      }
    }
  } else {
    [IO.File]::Move($temporaryPath, $ownershipPath)
  }
}

function Write-ProbeReadiness {
  # The controller accepts this once, after the same baseline/ownership checks
  # used by the query. It never uses wall-clock timestamps to extend a deadline.
  Assert-CofiringNotCancelled
  if (-not (Test-ProbeControllerParent)) { throw '준비 확인에 필요한 조회 관리 프로세스가 없습니다.' }
  $readyPath = [string]$env:GS_COFIRING_READY_PATH
  if ([string]::IsNullOrWhiteSpace($readyPath)) { throw '조회 준비 확인 파일 경로가 없습니다.' }
  if ([IO.File]::Exists($readyPath) -or [IO.File]::Exists($readyPath+'.new')) { throw '조회 준비 확인 파일이 이미 존재합니다.' }
  $selfProcess = Get-Process -Id $PID -ErrorAction Stop
  try { $selfSignature = New-ProbeProcessSignature $selfProcess } finally { $selfProcess.Dispose() }
  $parentSignature = ConvertFrom-Json -InputObject ([string]$env:GS_COFIRING_CONTROLLER_SIGNATURE)
  $script:workerProcessStartUtc = [datetime]::new([long]$selfSignature.StartTicks,[DateTimeKind]::Utc)
  $delay = [double]($workerEntryUtc-$workerProcessStartUtc).TotalSeconds
  if ([double]::IsNaN($delay) -or [double]::IsInfinity($delay) -or $delay -lt 0) { $delay=$null }
  $script:workerStartupDelaySeconds = $delay
  $script:workerReadyUtc = [datetime]::UtcNow
  $ready = [ordered]@{
    schemaVersion=1; kind='cofiring_worker_ready'; runId=[string]$env:GS_COFIRING_RUN_ID
    atUtc=$workerReadyUtc.ToString('o'); worker=$selfSignature; controller=$parentSignature
    workerEntryUtc=$workerEntryUtc.ToString('o'); startupDelaySeconds=$workerStartupDelaySeconds
  }
  [IO.File]::WriteAllText($readyPath+'.new',(ConvertTo-Json -InputObject $ready -Depth 8),(New-Object Text.UTF8Encoding($false)))
  [IO.File]::Move($readyPath+'.new',$readyPath)
  Write-CofiringProgress 'READY'
  Assert-CofiringNotCancelled
}

function Test-ProbeControllerParent {
  if ([string]::IsNullOrWhiteSpace([string]$env:GS_COFIRING_CONTROLLER_SIGNATURE)) { return $false }
  $controller = [string]$env:GS_COFIRING_CONTROLLER_SIGNATURE | ConvertFrom-Json
  if (-not (Test-ProbeProcessSignature $controller)) { throw "조회 관리 프로세스 신원이 일치하지 않습니다." }
  $selfCim = @(Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId=" + [string]$PID) -OperationTimeoutSec 5 -ErrorAction Stop)
  if ($selfCim.Count -ne 1 -or [int]$selfCim[0].ParentProcessId -ne [int]$controller.ProcessId) {
    throw "조회 관리 프로세스가 현재 작업 프로세스의 부모가 아닙니다."
  }
  return $true
}


try {
  $probeMutex = [System.Threading.Mutex]::new(
    $false,
    "Local\GSShiftLog.BlowerRuntimeDataParcHiddenExcelNativeOmV1"
  )
  $controllerOwnsMutex = Test-ProbeControllerParent
  try {
    $probeMutexAcquired = [bool]$probeMutex.WaitOne(0, $false)
  } catch [Threading.AbandonedMutexException] {
    $probeMutexAcquired = $true
  }
  if ($controllerOwnsMutex) {
    # The independently verified parent holds the shared mutex until ALL cleanup ends.
    # Acquiring it here would mean the controller lost its protection; fail closed.
    if ($probeMutexAcquired) {
      throw "조회 관리 프로세스의 DataPARC 공유 잠금이 유지되지 않았습니다."
    }
  } elseif (-not $probeMutexAcquired) {
    throw "다른 DataPARC 숨김 Excel 조회가 이미 실행 중입니다. Blower 조회가 끝난 뒤 다시 실행해 주세요."
  }


  $powerShellProcess = Get-Process -Id $PID -ErrorAction Stop
  try { $currentSessionId = [int]$powerShellProcess.SessionId } finally { $powerShellProcess.Dispose() }

  $baselineExcelProcesses = @(
    Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue |
      Where-Object { [int]$_.SessionId -eq $currentSessionId }
  )
  # Same multiple-Excel policy as the current Blower implementation.
  # Preserve every baseline PID, including the PDF worker; attach only to our /x PID.

  $baselineExcelSignatures = @(
    $baselineExcelProcesses | ForEach-Object { New-ProbeProcessSignature $_ }
  )
  $baselineExcelPids = @($baselineExcelSignatures | ForEach-Object { [int]$_.ProcessId })

  Start-CofiringWorkerPhase 'setupBaselineHostSnapshot'
  # One initial snapshot is split into allowed and unexpected hosts.
  # Later startup polls and final universe checks still query live processes.
  $initialHostSnapshot = @(Get-ProbeDataParcHosts)
  $baselineHosts = @(
    $initialHostSnapshot | Where-Object {
      [int]$_.SessionId -eq $currentSessionId -and
      $baselineExcelPids -contains [int]$_.ParentProcessId
    }
  )
  $unexpectedBaselineHosts = @(
    $initialHostSnapshot | Where-Object {
      [int]$_.SessionId -eq $currentSessionId -and
      $baselineExcelPids -notcontains [int]$_.ParentProcessId
    }
  )
  Complete-CofiringWorkerPhase 'setupBaselineHostSnapshot'
  if ($unexpectedBaselineHosts.Count -gt 0) {
    throw (
      "기존 DataPARC Host의 부모 Excel을 확인할 수 없습니다. PID=" +
      (($unexpectedBaselineHosts | Select-Object -ExpandProperty ProcessId) -join ", ")
    )
  }

  $baselineHostSignatures = @(
    foreach ($baselineHost in $baselineHosts) {
      $process = Get-Process -Id ([int]$baselineHost.ProcessId) -ErrorAction Stop
      try { New-ProbeProcessSignature $process } finally { $process.Dispose() }
    }
  )
  $baselineHostPids = @($baselineHostSignatures | ForEach-Object { [int]$_.ProcessId })
  Write-ProbeStage "임시 상태 파일 생성·반복 갱신 사전 확인"
  # Exercise Move, Replace, and Replace with an existing backup before Excel starts.
  for ($ownershipCheck = 0; $ownershipCheck -lt 3; $ownershipCheck += 1) {
    Write-ProbeOwnership
  }
  $ownershipCheckPath = [string]$env:GS_COFIRING_OWNERSHIP_PATH
  if ([string]::IsNullOrWhiteSpace($ownershipCheckPath)) {
    throw "임시 상태 파일 경로가 없습니다. 완성된 시험 파일로 실행해 주세요."
  }
  $ownershipCheckResult = [IO.File]::ReadAllText($ownershipCheckPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  if ([string]$ownershipCheckResult.runId -ne [string]$env:GS_COFIRING_RUN_ID -or
      [int]$ownershipCheckResult.worker.ProcessId -ne $PID -or
      [IO.File]::Exists($ownershipCheckPath + ".new")) {
    throw "임시 상태 파일 반복 갱신 결과가 올바르지 않습니다."
  }
  Write-ProbeStage "임시 상태 파일 생성·반복 갱신 확인 완료"

  Write-ProbeStage (
    "사용자 Excel 공존 기준 확인 · existing " + [string]$baselineExcelPids.Count
  )

  $ownedExcelPath = Resolve-ProbeExcelExecutable
  Write-ProbeReadiness
  Write-CofiringProgress 'EXCEL_START'

  # NativeOM exposure can intermittently lag a freshly started /x instance.
  # Retry only with the exact Excel process started by this worker, once.
  # COFIRING_XLSX_ADDIN_STARTUP_V3. Keep normal TEMP/TMP and add-in startup.
  # The controller copies this worker into its private per-run directory.
  $documentDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ownershipCheckPath))
  if (-not [string]::Equals($documentDirectory, [IO.Path]::GetFullPath($PSScriptRoot), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Document seed directory must equal the controller-owned worker directory.'
  }
  $documentSeedPath = New-CofiringDocumentSeed $documentDirectory ([string]$env:GS_COFIRING_RUN_ID)
  $documentSeedArgument = '"' + $documentSeedPath + '"'
  Write-ProbeStage '빈 XLSX 문서와 함께 별도 Excel 시작 · EXCEL7만 연결'
  for ($excelAttachAttempt = 1; $excelAttachAttempt -le 2 -and $null -eq $excel; $excelAttachAttempt += 1) {
    Assert-CofiringNotCancelled
    Write-ProbeStage $(if ($excelAttachAttempt -eq 1) { "별도 숨김 Excel 시작" } else { "별도 숨김 Excel 재시작 · 2/2" })
    $launchedExcelProcess = Start-Process -FilePath $ownedExcelPath -ArgumentList @("/x", $documentSeedArgument) -WindowStyle Hidden -PassThru
    [void]$launchedExcelProcess.Handle
    $ownedExcelPid = [int]$launchedExcelProcess.Id
    $ownedExcelStartTicks = [long]$launchedExcelProcess.StartTime.ToUniversalTime().Ticks
    $ownedExcelSessionId = [int]$launchedExcelProcess.SessionId
    $ownedHostSnapshot = $null
    $attachedExcelPid = 0

    if (-not (Test-OwnedProbeExcelIdentity $ownedExcelPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId)) {
      throw "자동조회용 Excel 프로세스 신원을 확인하지 못했습니다."
    }

    Start-OwnedExcelWindowGuard $ownedExcelPid
  Hide-OwnedExcelWindowNow
  Write-ProbeOwnership
    Write-ProbeStage ("PID 고유 창에서 Excel COM 직접 연결 · 시도 " + [string]$excelAttachAttempt + "/2")
    Start-CofiringWorkerPhase 'setupComAttach'
    $excel = Wait-OwnedProbeExcelNativeObject $ownedExcelPid ([datetime]::UtcNow.AddSeconds(20)) $baselineExcelPids
    Complete-CofiringWorkerPhase 'setupComAttach' $(if ($null -ne $excel) { 'complete' } else { 'not_ready' })
    if ($null -ne $excel) { break }

    if ($excelAttachAttempt -ge 2) {
      throw ("자동조회용 Excel PID " + [string]$ownedExcelPid + "의 COM 객체를 2회 시도 후에도 얻지 못했습니다.")
    }

    Write-ProbeStage ("Excel COM 연결 1차 대기 초과 · 소유 PID " + [string]$ownedExcelPid + " 종료 후 1회 재시도")
    Stop-OwnedExcelWindowGuard
    Stop-OwnedProbeExcelAttachAttempt $launchedExcelProcess $ownedExcelPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId
    $probeCleanupActions.Add("Excel COM 연결 재시도 전 소유 PID " + [string]$ownedExcelPid + " 종료")
    try { $launchedExcelProcess.Dispose() } catch { }
    $launchedExcelProcess = $null
    $ownedExcelPid = 0
    $ownedExcelStartTicks = 0L
    $ownedExcelSessionId = -1
    $attachedExcelPid = 0
    $ownedHostSnapshot = $null
    Write-ProbeOwnership
    Start-Sleep -Milliseconds 500
  }

  if ($null -eq $excel) { throw "자동조회용 Excel COM 연결 결과가 없습니다." }

  $attachedExcelPid = Get-ProbeExcelProcessId $excel
  if ($attachedExcelPid -ne $ownedExcelPid) {
    throw "연결한 Excel COM PID가 자동조회용 PID와 다릅니다."
  }
  Write-ProbeStage "Excel COM 연결 완료"
  Start-CofiringWorkerPhase 'setupExcelOptions'

  [void](Invoke-CofiringExcelCall -Operation 'Application.Visible=False' -Action { $excel.Visible=$false })
  [void](Invoke-CofiringExcelCall -Operation 'Application.DisplayAlerts=False' -Action { $excel.DisplayAlerts=$false })
  [void](Invoke-CofiringExcelCall -Operation 'Application.AskToUpdateLinks=False' -Action { $excel.AskToUpdateLinks=$false })
  [void](Invoke-CofiringExcelCall -Operation 'Application.ScreenUpdating=False' -Action { $excel.ScreenUpdating=$false })
  Write-ProbeStage "Excel 옵션 설정 완료"
  Complete-CofiringWorkerPhase 'setupExcelOptions'

  # Validated startup: retain the seed and default event state until the owned Host is ready.
  Write-CofiringAddinRuntimeSnapshot $excel $ownedExcelPid 'before-host'
  Start-CofiringWorkerPhase 'setupDataParcLoad'
  Invoke-CofiringDataParcLoad $excel $ownedExcelPid
  Complete-CofiringWorkerPhase 'setupDataParcLoad'
  Write-ProbeStage "DataPARC Host 준비 확인 · 최대 15초 · 초기 문서 유지"
  Start-CofiringWorkerPhase 'setupHostWait'
  $ownedHostCim = Wait-OwnedProbeDataParcHost $ownedExcelPid $baselineExcelPids ([datetime]::UtcNow.AddSeconds(15))
  Complete-CofiringWorkerPhase 'setupHostWait' $(if ($null -ne $ownedHostCim) { 'complete' } else { 'not_ready' })
  if ($null -eq $ownedHostCim) {
    Write-CofiringAddinRuntimeSnapshot $excel $ownedExcelPid 'host-not-ready'
    throw "DataPARC 파일 로드는 확인했지만 소유 Host가 15초 안에 준비되지 않았습니다. 혼소율 계산은 시작하지 않았습니다."
  }
  $ownedHostSnapshot = New-ProbeHostSignature $ownedHostCim $ownedExcelPid $ownedExcelStartTicks $ownedExcelSessionId
  Write-ProbeOwnership
  Write-CofiringAddinRuntimeSnapshot $excel $ownedExcelPid 'host-ready'
  $loadedDataParc = Get-CofiringRegisteredDataParcState $excel $ownedExcelPid
  if (-not $loadedDataParc.isOpen) { throw 'Host 확인 후 DataPARC IsOpen=False로 바뀌어 계산을 중단합니다.' }
  [void](Invoke-CofiringExcelCall -Operation 'Application.EnableEvents=False' -Action { $excel.EnableEvents=$false })
  Start-CofiringWorkerPhase 'setupStartupWorkbookClose'
  $startupWorkbooks = $null
  try {
    $startupWorkbooks = (Get-CofiringExcelProperty -Target $excel -Member 'Workbooks' -Operation 'Startup.Workbooks').Value
    for ($startupIndex = [int](Get-CofiringExcelProperty -Target $startupWorkbooks -Member 'Count' -Operation 'Startup.Workbooks.Count').Value; $startupIndex -ge 1; $startupIndex -= 1) {
      $startupWorkbook = $null
      try {
        $startupWorkbook = (Invoke-CofiringExcelCall -Operation 'Startup.Workbooks.Item' -Action { param($box) $box.Value=$startupWorkbooks.Item($startupIndex) }).Value
        if (-not [bool](Get-CofiringExcelProperty -Target $startupWorkbook -Member 'IsAddin' -Operation 'Startup.Workbook.IsAddin').Value) {
          $startupFullName = [string](Get-CofiringExcelProperty -Target $startupWorkbook -Member 'FullName' -Operation 'Startup.Workbook.FullName').Value
          if (Test-CofiringDocumentSeedWorkbook $startupFullName $documentSeedPath) { continue }
          [void](Invoke-CofiringExcelCall -Operation 'Startup.Workbook.Close' -NoRetry -Action { $startupWorkbook.Close($false) })
        }
      } finally {
        Release-ProbeCom $startupWorkbook
      }
    }
  } finally {
    Release-ProbeCom $startupWorkbooks
  }
  Write-ProbeStage "초기 통합문서 정리 완료 · 빈 XLSX 유지"
  Complete-CofiringWorkerPhase 'setupStartupWorkbookClose'

  [void](Invoke-CofiringExcelCall -Operation 'Application.Visible=False.AfterDataParcHost' -Action { $excel.Visible=$false })
  Hide-OwnedExcelWindowNow

  Start-CofiringWorkerPhase 'setupQueryWorkbookAndFormulas'
  Write-ProbeStage "조회용 임시 통합문서 생성"
  $workbooks = (Get-CofiringExcelProperty -Target $excel -Member 'Workbooks' -Operation 'Query.Workbooks').Value
  # Creation is non-idempotent; never blindly replay it.
  $queryWorkbook = (Invoke-CofiringExcelCall -Operation 'Query.Workbooks.Add' -NoRetry -Action { param($box) $box.Value=$workbooks.Add() }).Value
  [void](Invoke-CofiringExcelCall -Operation 'Application.Visible=False.AfterWorkbookAdd' -Action { $excel.Visible=$false })
  Hide-OwnedExcelWindowNow
  $worksheets = (Get-CofiringExcelProperty -Target $queryWorkbook -Member 'Worksheets' -Operation 'Query.Worksheets').Value
  $querySheet = (Invoke-CofiringExcelCall -Operation 'Query.Worksheet.Item1' -Action { param($box) $box.Value=$worksheets.Item(1) }).Value
  [void](Invoke-CofiringExcelCall -Operation 'Query.Worksheet.Name' -Action { $querySheet.Name='Cofiring Fast Summary V8' })
  [void](Invoke-CofiringExcelCall -Operation 'Query.EnableCalculation=False' -Action { $querySheet.EnableCalculation=$false })
  $cells = (Get-CofiringExcelProperty -Target $querySheet -Member 'Cells' -Operation 'Query.Cells').Value

  $markerCell = $null
  try {
    $markerCell = (Invoke-CofiringExcelCall -Operation 'Query.MarkerRange' -Action { param($box) $box.Value=$querySheet.Range('XFD1') }).Value
    [void](Invoke-CofiringExcelCall -Operation 'Query.MarkerValue' -Action { $markerCell.Value2=$probeWorkbookMarker })
  } finally {
    Release-ProbeCom $markerCell
  }

  $diagnostics = [ordered]@{
    schemaVersion=1; kind='cofiring_dataparc_fast_summary_raw'; runId=[string]$env:GS_COFIRING_RUN_ID
    start=$cofiringStartText; end=$cofiringEndText; timezone='Asia/Seoul'; unit='cumulative_ton'
    queryMode='parallel-summary'; queryFunction='fnTagStat'; expectedFormulaCells=110
    statistics=@('Start-boundary Value/QualStr/Time','End-boundary Value/QualStr/Time','Min','Max','Delta','DurationGood','DurationBad')
    response=$null; summaries=@(); failure=''; activeBatch=$null; batches=@()
    databaseWritten=$false; productionReady=$false; diagnosticOnly=$true
  }
  try {
    [void](Invoke-CofiringExcelCall -Operation 'Query.Date1904=False' -Action { $queryWorkbook.Date1904=$false })

    function Test-CofiringFastMatrixShape($Value,[int]$Rows,[int]$Columns) {
      return ($Value -is [Array] -and $Value.Rank -eq 2 -and $Value.GetLength(0) -eq $Rows -and $Value.GetLength(1) -eq $Columns)
    }

    function Get-CofiringFastCellState($Value,[string]$Kind) {
      if ($Value -is [Runtime.InteropServices.ErrorWrapper]) { return 'ERROR' }
      if ($null -eq $Value) { return 'PENDING' }
      $text=[string]$Value
      $trimmed=$text.Trim()
      if ($Value -is [string]) {
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed -in @('#BUSY!','#GETTING_DATA','#CONNECT!','#PENDING!')) { return 'PENDING' }
        if ($trimmed -match '^#') {
          if ($trimmed -ieq '#NODATA') { return 'COMPLETE_INVALID' }
          return 'ERROR'
        }
      }
      if ($Kind -eq 'number') {
        if ($null -ne (Convert-ProbeNumber $Value)) { return 'VALUE' }
        return 'ERROR'
      }
      if ($Kind -eq 'quality') {
        if ($trimmed -eq '0') { return 'PENDING' }
        return 'VALUE'
      }
      if ($Kind -eq 'time') {
        if (($Value -is [ValueType]) -and [double]$Value -eq 0) { return 'PENDING' }
        if ($trimmed -eq '0') { return 'PENDING' }
        if ($null -ne (Convert-CofiringTimestamp $Value)) { return 'VALUE' }
        return 'ERROR'
      }
      return 'ERROR'
    }

    function Get-CofiringFastMatrixState($Value,[int]$Rows,[int]$Columns,$ColumnKinds) {
      $state=[ordered]@{shapeValid=$false;cells=($Rows*$Columns);valueCells=0;invalidCells=0;pendingCells=0;errorCells=0;complete=$false;firstProblem=''}
      if (-not (Test-CofiringFastMatrixShape $Value $Rows $Columns)) { return [pscustomobject]$state }
      $state.shapeValid=$true
      $rb=$Value.GetLowerBound(0);$cb=$Value.GetLowerBound(1)
      for ($r=0;$r -lt $Rows;$r+=1) {
        for ($c=0;$c -lt $Columns;$c+=1) {
          $cellValue=$Value.GetValue($rb+$r,$cb+$c)
          $cellState=Get-CofiringFastCellState $cellValue ([string]$ColumnKinds[$c])
          switch ($cellState) {
            'VALUE' { $state.valueCells+=1 }
            'COMPLETE_INVALID' { $state.invalidCells+=1 }
            'PENDING' { $state.pendingCells+=1 }
            default { $state.errorCells+=1 }
          }
          if ($cellState -ne 'VALUE' -and [string]::IsNullOrWhiteSpace([string]$state.firstProblem)) {
            $cellText=[string]$cellValue
            $state.firstProblem=('R'+[string]($r+1)+'C'+[string]($c+1)+' '+$cellState+' '+$cellText.Substring(0,[Math]::Min(80,$cellText.Length)))
          }
        }
      }
      $state.complete=($state.pendingCells -eq 0 -and $state.errorCells -eq 0)
      return [pscustomobject]$state
    }

    function Test-CofiringFastSnapshotEqual($Left,$Right,[int]$Rows,[int]$Columns) {
      if (-not (Test-CofiringFastMatrixShape $Left $Rows $Columns) -or -not (Test-CofiringFastMatrixShape $Right $Rows $Columns)) { return $false }
      $lrb=$Left.GetLowerBound(0);$lcb=$Left.GetLowerBound(1);$rrb=$Right.GetLowerBound(0);$rcb=$Right.GetLowerBound(1)
      for ($r=0;$r -lt $Rows;$r+=1) {
        for ($c=0;$c -lt $Columns;$c+=1) {
          if (-not [object]::Equals($Left.GetValue($lrb+$r,$lcb+$c),$Right.GetValue($rrb+$r,$rcb+$c))) { return $false }
        }
      }
      return $true
    }

    $columnNames=@('startValue','startQuality','startTime','endValue','endQuality','endTime','min','max','delta','durationGood','durationBad')
    $columnKinds=@('number','quality','time','number','quality','time','number','number','number','number','number')
    $rowsFast=$cofiringQueryTags.Count
    $columnsFast=$columnNames.Count
    $startBucketEnd=$cofiringStart.AddMinutes(1)
    $endBucketEnd=$cofiringEnd.AddMinutes(1)
    $fullStart=$cofiringStart.ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)
    $fullEnd=$cofiringEnd.ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)
    $firstEnd=$startBucketEnd.ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)
    $lastEnd=$endBucketEnd.ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)

    $queryRange=(Invoke-CofiringExcelCall -Operation 'Fast.Range' -Action { param($box) $box.Value=$querySheet.Range('A1:K13') }).Value
    [void](Invoke-CofiringExcelCall -Operation 'Fast.EnableCalculation=False' -Action { $querySheet.EnableCalculation=$false })
    [void](Invoke-CofiringExcelCall -Operation 'Fast.ClearContents' -Action { $queryRange.ClearContents() })
    $formulasFast=New-Object 'object[,]' $rowsFast,$columnsFast
    for ($r=0;$r -lt $rowsFast;$r+=1) {
      $tag=$cofiringQueryTags[$r]
      $safeTag=([string]$tag.tag).Replace('"','""')
      $startBoundaryStart=$(if($r -ge $cofiringTags.Count){$cofiringStart.AddDays(-1).ToString('yyyy-MM-dd HH:mm')}else{$fullStart}) # COFIRING_ORGANIC_INVENTORY_START_MIDNIGHT_V2
      $startBoundaryEnd=$(if($r -ge $cofiringTags.Count){$fullStart}else{$firstEnd}) # COFIRING_ORGANIC_INVENTORY_START_MIDNIGHT_V1
      $startBoundaryMethod=$(if($r -ge $cofiringTags.Count){'End'}else{'Start'}) # COFIRING_ORGANIC_INVENTORY_START_MIDNIGHT_V1
      $endBoundaryStart=$(if($r -ge $cofiringTags.Count){$fullStart}else{$fullEnd}) # COFIRING_ORGANIC_INVENTORY_END_STAT_V1_R1
            $endBoundaryEnd=$(if($r -ge $cofiringTags.Count){$fullEnd}else{$lastEnd}) # COFIRING_ORGANIC_INVENTORY_END_STAT_V1_R1
            $endBoundaryMethod=$(if($r -ge $cofiringTags.Count){'End'}else{'Start'}) # COFIRING_ORGANIC_INVENTORY_END_STAT_V1_R1
      $formulasFast[$r,0]='=fnTagStat("'+$safeTag+'","'+$startBoundaryStart+'","'+$startBoundaryEnd+'","'+$startBoundaryMethod+'","Value")'
      $formulasFast[$r,1]='=fnTagStat("'+$safeTag+'","'+$startBoundaryStart+'","'+$startBoundaryEnd+'","'+$startBoundaryMethod+'","QualStr")'
      $formulasFast[$r,2]='=fnTagStat("'+$safeTag+'","'+$startBoundaryStart+'","'+$startBoundaryEnd+'","'+$startBoundaryMethod+'","Time")'
      $formulasFast[$r,3]='=fnTagStat("'+$safeTag+'","'+$endBoundaryStart+'","'+$endBoundaryEnd+'","'+$endBoundaryMethod+'","Value")'
      $formulasFast[$r,4]='=fnTagStat("'+$safeTag+'","'+$endBoundaryStart+'","'+$endBoundaryEnd+'","'+$endBoundaryMethod+'","QualStr")'
      $formulasFast[$r,5]='=fnTagStat("'+$safeTag+'","'+$endBoundaryStart+'","'+$endBoundaryEnd+'","'+$endBoundaryMethod+'","Time")'
      $formulasFast[$r,6]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","Min","Value")'
      $formulasFast[$r,7]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","Max","Value")'
      $formulasFast[$r,8]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","Delta","Value")'
      $formulasFast[$r,9]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","DurationGood","Value")'
      $formulasFast[$r,10]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","DurationBad","Value")'
    }
    Write-ProbeStage ('고속 요약 조회 준비 · 13 TAG x 11 통계 = '+[string]($rowsFast*$columnsFast)+'개 수식 동시 계산')
    Write-CofiringProgress 'QUERY_START'
    [void](Invoke-CofiringExcelCall -Operation 'Fast.Formula' -Action { $queryRange.Formula=$formulasFast })
    Complete-CofiringWorkerPhase 'setupQueryWorkbookAndFormulas'
    $formulasFast=$null
    $fastClock=[Diagnostics.Stopwatch]::StartNew()
    Set-CofiringQueryBoundary 'begin'
    $cofiringQueryPoll=0
    $fastDeadlineSeconds=60.0
    $stableReads=0;$previousFast=$null;$lastLog=[datetime]::MinValue;$fastState=$null
    $diagnostics.activeBatch=[ordered]@{phase='WAIT_RESPONSE';stableReads=0;elapsedSeconds=0;response=$null}
    $querySpan=Start-CofiringQuerySpan 'enableCalculation' 0
    $querySpanOutcome='failed'
    try {
      [void](Invoke-CofiringExcelCall -Operation 'Fast.EnableCalculation=True' -Action { $querySheet.EnableCalculation=$true })
      $querySpanOutcome='returned'
    } finally { Complete-CofiringQuerySpan $querySpan $querySpanOutcome }
    # Skip only the first fixed wait when the existing EnableCalculation call itself
    # already consumed at least 500 ms. Three stable reads and every later 500 ms wait remain.
    $cofiringSkipInitialPollSleep=($null -ne $querySpan -and $null -ne $querySpan.elapsedSeconds -and [double]$querySpan.elapsedSeconds -ge 0.5)
    do {
      Assert-CofiringNotCancelled
      if ($fastClock.Elapsed.TotalSeconds -ge $fastDeadlineSeconds) { throw '고속 요약 통계가 60초 안에 완료되지 않았습니다.' }
      $cofiringQueryPoll+=1
      if ($cofiringSkipInitialPollSleep -and $cofiringQueryPoll -eq 1) {
        $cofiringSkipInitialPollSleep=$false
        $querySpan=Start-CofiringQuerySpan 'pollSleepBypass' $cofiringQueryPoll
        $querySpanOutcome='failed'
        try { $querySpanOutcome='returned' }
        finally { Complete-CofiringQuerySpan $querySpan $querySpanOutcome }
      } else {
        $querySpan=Start-CofiringQuerySpan 'pollSleep' $cofiringQueryPoll
        $querySpanOutcome='failed'
        try { Start-Sleep -Milliseconds 500; $querySpanOutcome='returned' }
        finally { Complete-CofiringQuerySpan $querySpan $querySpanOutcome }
      }
      $remaining=$fastDeadlineSeconds-$fastClock.Elapsed.TotalSeconds
      $readBudget=[int][Math]::Max(1.0,[Math]::Min(30000.0,[Math]::Floor($remaining*1000.0)))
      $querySpan=Start-CofiringQuerySpan 'valueRead' $cofiringQueryPoll
      $querySpanOutcome='failed'
      try {
        $matrix=(Get-CofiringExcelProperty -Target $queryRange -Member 'Value2' -Operation 'Fast.Value2' -TimeoutMilliseconds $readBudget -MaxAttempts 100).Value
        $querySpanOutcome='returned'
      } finally { Complete-CofiringQuerySpan $querySpan $querySpanOutcome }
      $querySpan=Start-CofiringQuerySpan 'matrixValidation' $cofiringQueryPoll
      $querySpanOutcome='failed'
      try {
        $fastState=Get-CofiringFastMatrixState $matrix $rowsFast $columnsFast $columnKinds
        if (-not $fastState.shapeValid) {
          $shape=Get-CofiringReturnShape $matrix
          throw ('고속 요약 배열 크기가 '+[string]$rowsFast+'x'+[string]$columnsFast+'가 아닙니다: '+($shape | ConvertTo-Json -Compress))
        }
        if ($fastState.errorCells -gt 0) { throw ('고속 요약 수식 오류: '+[string]$fastState.firstProblem) }
        $querySpanOutcome='returned'
      } finally { Complete-CofiringQuerySpan $querySpan $querySpanOutcome }
      $querySpan=Start-CofiringQuerySpan 'stabilityCheck' $cofiringQueryPoll
      $querySpanOutcome='failed'
      try {
        if ($fastState.complete) {
          if ($null -ne $previousFast -and (Test-CofiringFastSnapshotEqual $matrix $previousFast $rowsFast $columnsFast)) { $stableReads+=1 } else { $stableReads=1 }
          $previousFast=$matrix.Clone()
        } else {
          $stableReads=0;$previousFast=$null
        }
        $querySpanOutcome='returned'
      } finally { Complete-CofiringQuerySpan $querySpan $querySpanOutcome }
      $querySpan=Start-CofiringQuerySpan 'progressReporting' $cofiringQueryPoll
      $querySpanOutcome='failed'
      try {
        $diagnostics.activeBatch=[ordered]@{phase=$(if($fastState.complete){'VERIFY_STABLE'}else{'WAIT_RESPONSE'});stableReads=$stableReads;elapsedSeconds=[Math]::Round($fastClock.Elapsed.TotalSeconds,3);response=$fastState}
        if (([datetime]::UtcNow-$lastLog).TotalSeconds -ge 2 -or $stableReads -ge 3) {
          Write-ProbeStage ('고속 요약 응답 '+[string]$fastState.valueCells+'/'+[string]$fastState.cells+' · invalid '+[string]$fastState.invalidCells+' · pending '+[string]$fastState.pendingCells+' · 동일 응답 '+[string]$stableReads+'/3 · '+[string][Math]::Round($fastClock.Elapsed.TotalSeconds,1)+'초')
          $lastLog=[datetime]::UtcNow
        }
        $querySpanOutcome='returned'
      } finally { Complete-CofiringQuerySpan $querySpan $querySpanOutcome }
      Add-CofiringQueryPoll $cofiringQueryPoll $fastState $stableReads
    } while ($stableReads -lt 3)
    $querySpan=Start-CofiringQuerySpan 'freezeCalculation' 0
    $querySpanOutcome='failed'
    try {
      [void](Invoke-CofiringExcelCall -Operation 'Fast.FreezeCalculation' -Action { $querySheet.EnableCalculation=$false })
      $querySpanOutcome='returned'
    } finally { Complete-CofiringQuerySpan $querySpan $querySpanOutcome }
    $diagnostics.response=$fastState
    $diagnostics.queryElapsedSeconds=[Math]::Round($fastClock.Elapsed.TotalSeconds,3)
    Set-CofiringQueryBoundary 'end'
    $diagnostics.batches=@([ordered]@{mode='parallel-summary';formulaCells=($rowsFast*$columnsFast);response=$fastState;elapsedSeconds=$diagnostics.queryElapsedSeconds})

    $fuelAggregationSpan=Start-CofiringQuerySpan 'fuelAggregation'
    $referenceByDate=@{
      '2026-09-07'=@{
        unit1CoalA1=172.412109375;unit1CoalA2=172.609375;unit1CoalB1=127.197265625;unit1CoalB2=126.4111328125;unit1Bio=379.390625
        unit2CoalA1=175.703125;unit2CoalA2=174.392578125;unit2CoalB1=142.056640625;unit2CoalB2=142.3310546875;unit2Bio=305.93359375
      }
      '2026-09-08'=@{
        unit1CoalA1=164.3359375;unit1CoalA2=153.857421875;unit1CoalB1=139.7978515625;unit1CoalB2=138.919921875;unit1Bio=425.4296875
        unit2CoalA1=166.29296875;unit2CoalA2=165.00390625;unit2CoalB1=143.400390625;unit2CoalB2=143.6669921875;unit2Bio=357.01171875
      }
    }
    $targetDate=$cofiringStart.ToString('yyyy-MM-dd')
    $knownReference=$null
    if ($cofiringStart.TimeOfDay -eq [TimeSpan]::Zero -and $cofiringEnd -eq $cofiringStart.AddDays(1) -and $referenceByDate.ContainsKey($targetDate)) { $knownReference=$referenceByDate[$targetDate] }
    $durationExpected=[double]($cofiringEnd-$cofiringStart).TotalSeconds
    $summaries=New-Object 'System.Collections.Generic.List[object]'
    $allBoundaryValid=$true;$allDurationValid=$true;$anyBadDuration=$false;$referenceCompared=0;$referenceMismatches=0
    $rb=$matrix.GetLowerBound(0);$cb=$matrix.GetLowerBound(1)
    for ($r=0;$r -lt $cofiringTags.Count;$r+=1) {
      $tag=$cofiringTags[$r]
      $startValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+0))
      $startQuality=[string]($matrix.GetValue($rb+$r,$cb+1))
      $startTime=Convert-CofiringTimestamp ($matrix.GetValue($rb+$r,$cb+2))
      $endValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+3))
      $endQuality=[string]($matrix.GetValue($rb+$r,$cb+4))
      $endTime=Convert-CofiringTimestamp ($matrix.GetValue($rb+$r,$cb+5))
      $minValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+6))
      $maxValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+7))
      $deltaValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+8))
      $durationGood=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+9))
      $durationBad=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+10))
      # COFIRING_BIO_BOUNDARY_NODATA_FALLBACK_V4
      # Bio cumulative counters may rarely return #NODATA at exactly one period boundary.
      # Recover only one missing boundary, only for Bio, only across a full-Good interval,
      # and only when Min/Max/Delta prove a monotonic-looking cumulative range.
      $startTimeValid=($null -ne $startTime -and $startTime -ge $cofiringStart -and $startTime -lt $cofiringStart.AddMinutes(1))
      $endTimeValid=($null -ne $endTime -and $endTime -ge $cofiringEnd -and $endTime -lt $cofiringEnd.AddMinutes(1))
      $durationCoverageValid=($null -ne $durationGood -and $null -ne $durationBad -and $durationGood -ge 0 -and $durationBad -ge 0 -and [Math]::Abs(($durationGood+$durationBad)-$durationExpected) -le 2.0)
      $rangeSpread=$null
      if ($null -ne $minValue -and $null -ne $maxValue) { $rangeSpread=[double]$maxValue-[double]$minValue }
      $startBoundaryDirectValid=($null -ne $startValue -and $startValue -ge 0 -and (Test-OrganicQualityGood $startQuality) -and $startTimeValid)
      $endBoundaryDirectValid=($null -ne $endValue -and $endValue -ge 0 -and (Test-OrganicQualityGood $endQuality) -and $endTimeValid)
      $startBoundaryFallbackApplied=$false
      $startBoundaryFallbackValue=$null
      $endBoundaryFallbackApplied=$false
      $endBoundaryFallbackValue=$null
      $startBoundaryNoData=($null -eq $startValue -and $startTimeValid -and -not [string]::IsNullOrWhiteSpace([string]$startQuality) -and ([string]$startQuality -match '(?i)\bno\s*data\b'))
      $endBoundaryNoData=($null -eq $endValue -and $endTimeValid -and -not [string]::IsNullOrWhiteSpace([string]$endQuality) -and ([string]$endQuality -match '(?i)\bno\s*data\b'))
      $spreadMatchesDelta=($null -ne $rangeSpread -and $null -ne $deltaValue -and [Math]::Abs([double]$rangeSpread-[double]$deltaValue) -le 0.01)
      $fallbackCommonShape=($null -ne $minValue -and $null -ne $maxValue -and $minValue -ge 0 -and $maxValue -ge $minValue -and $spreadMatchesDelta)
      $startFallbackShape=($fallbackCommonShape -and $endBoundaryDirectValid -and [double]$endValue + 0.001 -ge [double]$maxValue)
      $endFallbackShape=($fallbackCommonShape -and $startBoundaryDirectValid -and [Math]::Abs([double]$minValue-[double]$startValue) -le 0.01)
      if ([string]$tag.fuel -eq 'bio' -and $startBoundaryNoData -and $endBoundaryDirectValid -and $durationCoverageValid -and $durationBad -le 0.001 -and $startFallbackShape) {
        $startBoundaryFallbackApplied=$true
        $startBoundaryFallbackValue=[double]$minValue
      } elseif ([string]$tag.fuel -eq 'bio' -and $endBoundaryNoData -and $startBoundaryDirectValid -and $durationCoverageValid -and $durationBad -le 0.001 -and $endFallbackShape) {
        $endBoundaryFallbackApplied=$true
        $endBoundaryFallbackValue=[double]$maxValue
      }
      $effectiveStartValue=$(if($startBoundaryFallbackApplied){$startBoundaryFallbackValue}else{$startValue})
      $effectiveEndValue=$(if($endBoundaryFallbackApplied){$endBoundaryFallbackValue}else{$endValue})
      $boundaryValid=(($startBoundaryDirectValid -or $startBoundaryFallbackApplied) -and ($endBoundaryDirectValid -or $endBoundaryFallbackApplied))
      $usage=$null
      if ($null -ne $effectiveStartValue -and $null -ne $effectiveEndValue) { $usage=[double]$effectiveEndValue-[double]$effectiveStartValue }
      $usageValid=($null -ne $usage -and $usage -ge -0.001)
      $referenceExpected=$null;$referenceMatch=$null
      if ($null -ne $knownReference -and $knownReference.ContainsKey([string]$tag.key)) {
        $referenceExpected=[double]$knownReference[[string]$tag.key]
        $referenceCompared+=1
        $referenceMatch=($usageValid -and [Math]::Abs([double]$usage-$referenceExpected) -le 0.001)
        if (-not $referenceMatch) { $referenceMismatches+=1 }
      }
      if (-not $boundaryValid -or -not $usageValid) { $allBoundaryValid=$false }
      if (-not $durationCoverageValid) { $allDurationValid=$false }
      if ($null -ne $durationBad -and $durationBad -gt 0.001) { $anyBadDuration=$true }
      $summaries.Add([pscustomobject][ordered]@{
        key=[string]$tag.key;unit=[string]$tag.unit;fuel=[string]$tag.fuel;tag=[string]$tag.tag
        startValue=$startValue;startQuality=$startQuality;startTime=$(if($null -ne $startTime){$startTime.ToString('yyyy-MM-ddTHH:mm:ss')+'+09:00'}else{$null})
        endValue=$endValue;endQuality=$endQuality;endTime=$(if($null -ne $endTime){$endTime.ToString('yyyy-MM-ddTHH:mm:ss')+'+09:00'}else{$null})
        usageTon=$usage;usageBasis=$(if($startBoundaryFallbackApplied){'end_minus_period_min_start_nodata_fallback'}elseif($endBoundaryFallbackApplied){'period_max_end_nodata_fallback_minus_start_boundary'}else{'end_minus_start_boundary'})
        startBoundaryFallbackApplied=[bool]$startBoundaryFallbackApplied;startBoundaryFallbackValue=$startBoundaryFallbackValue
        endBoundaryFallbackApplied=[bool]$endBoundaryFallbackApplied;endBoundaryFallbackValue=$endBoundaryFallbackValue
        min=$minValue;max=$maxValue;rangeSpread=$rangeSpread;delta=$deltaValue
        durationGoodSeconds=$durationGood;durationBadSeconds=$durationBad;durationCoverageValid=$durationCoverageValid
        boundaryValid=$boundaryValid;dataComplete=($boundaryValid -and $usageValid -and $durationCoverageValid -and $durationBad -le 0.001)
        referenceExpectedTon=$referenceExpected;referenceMatched=$referenceMatch
      })
    }
    Complete-CofiringQuerySpan $fuelAggregationSpan
    $inventoryAggregationSpan=Start-CofiringQuerySpan 'inventoryAggregation'
    # Organic SDF inventory is a stock level, not a cumulative counter.
    # Only the two period boundaries are used for mass balance; an increase or
    # decrease inside the interval is valid and must not be treated as counter reset.
    $inventorySamples=New-Object 'System.Collections.Generic.List[object]'
    $inventoryStartByKey=@{}
    $inventoryEndByKey=@{}
    $organicInventoryReady=$true
    $inventoryExpectedSeconds=[double]($cofiringEnd-$cofiringStart).TotalSeconds
    for ($ir=0;$ir -lt $cofiringInventoryTags.Count;$ir+=1) {
      $r=$cofiringTags.Count+$ir
      $tag=$cofiringInventoryTags[$ir]
      $rawStartValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+0))
      $startValue=Convert-CofiringOrganicInventoryValue $rawStartValue
      $startQuality=[string]($matrix.GetValue($rb+$r,$cb+1))
      $startTime=Convert-CofiringTimestamp ($matrix.GetValue($rb+$r,$cb+2))
      $rawEndValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+3))
      $endValue=Convert-CofiringOrganicInventoryValue $rawEndValue
      $endQuality=[string]($matrix.GetValue($rb+$r,$cb+4))
      $endTime=Convert-CofiringTimestamp ($matrix.GetValue($rb+$r,$cb+5))
      $minValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+6))
      $maxValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+7))
      $deltaValue=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+8))
      $durationGood=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+9))
      $durationBad=Convert-ProbeNumber ($matrix.GetValue($rb+$r,$cb+10))
      $startTimeValid=($null -ne $startTime -and $startTime -ge $cofiringStart.AddDays(-1) -and $startTime -le $cofiringStart) # COFIRING_ORGANIC_INVENTORY_START_MIDNIGHT_V2
      $endTimeValid=($null -ne $endTime -and $endTime -ge $cofiringStart -and $endTime -le $cofiringEnd) # COFIRING_ORGANIC_INVENTORY_END_STAT_V1_R1
      $startBoundaryValid=($null -ne $startValue -and $startValue -ge 0 -and (Test-OrganicQualityGood $startQuality) -and $startTimeValid)
      $endBoundaryValid=($null -ne $endValue -and $endValue -ge 0 -and (Test-OrganicQualityGood $endQuality) -and $endTimeValid)
      $durationCoverageValid=($null -ne $durationGood -and $null -ne $durationBad -and $durationGood -ge 0 -and $durationBad -ge 0 -and [Math]::Abs(($durationGood+$durationBad)-$inventoryExpectedSeconds) -le 2.0)
      $boundaryValid=($startBoundaryValid -and $endBoundaryValid)
      $inventoryDataComplete=($boundaryValid -and $durationCoverageValid)
      if (-not $inventoryDataComplete) { $organicInventoryReady=$false }
      if ($inventoryDataComplete) {
        $inventoryStartByKey[[string]$tag.key]=[double]$startValue
        $inventoryEndByKey[[string]$tag.key]=[double]$endValue
      }
      $inventorySamples.Add([pscustomobject][ordered]@{
        key=[string]$tag.key;label=[string]$tag.label;tag=[string]$tag.tag
        normalization='negative-inventory-to-zero-v1';rawStartValue=$rawStartValue;rawEndValue=$rawEndValue
        startValue=$startValue;startQuality=$startQuality;startTime=$(if($null -ne $startTime){$startTime.ToString('yyyy-MM-ddTHH:mm:ss')+'+09:00'}else{$null})
        endValue=$endValue;endQuality=$endQuality;endTime=$(if($null -ne $endTime){$endTime.ToString('yyyy-MM-ddTHH:mm:ss')+'+09:00'}else{$null})
        min=$minValue;max=$maxValue;delta=$deltaValue
        durationGoodSeconds=$durationGood;durationBadSeconds=$durationBad;durationCoverageValid=$durationCoverageValid
        boundaryValid=$boundaryValid;dataComplete=$inventoryDataComplete
      })
    }
    # Preserve returned samples even if a later quality/time/coverage gate rejects them.
    $diagnostics.organicInventorySamples=@($inventorySamples.ToArray())
    $organicInventory=$null
    if ($organicInventoryReady) {
      $inventoryStartTotal=0.0
      $inventoryEndTotal=0.0
      foreach ($tag in $cofiringInventoryTags) {
        $inventoryStartTotal+=[double]$inventoryStartByKey[[string]$tag.key]
        $inventoryEndTotal+=[double]$inventoryEndByKey[[string]$tag.key]
      }
      $organicInventory=[ordered]@{
        schemaVersion=1;basis='dataparc_period_boundary';normalization='negative-inventory-to-zero-v1'
        startLocal=$cofiringStart.ToString('yyyy-MM-ddTHH:mm');endLocal=$cofiringEnd.ToString('yyyy-MM-ddTHH:mm')
        start=[ordered]@{
          organicDaySilo=[double]$inventoryStartByKey['organicDaySilo']
          organicStorageSiloA=[double]$inventoryStartByKey['organicStorageSiloA']
          organicStorageSiloB=[double]$inventoryStartByKey['organicStorageSiloB']
          total=[double]$inventoryStartTotal
        }
        end=[ordered]@{
          organicDaySilo=[double]$inventoryEndByKey['organicDaySilo']
          organicStorageSiloA=[double]$inventoryEndByKey['organicStorageSiloA']
          organicStorageSiloB=[double]$inventoryEndByKey['organicStorageSiloB']
          total=[double]$inventoryEndTotal
        }
        samples=@($inventorySamples.ToArray())
      }
    }

    $summariesArray=@($summaries.ToArray())
    Complete-CofiringQuerySpan $inventoryAggregationSpan
    $resultAssemblySpan=Start-CofiringQuerySpan 'resultAssembly'
    function Get-CofiringFastUsageSum([string[]]$Keys) {
      $total=0.0
      foreach ($key in $Keys) {
        $item=@($summariesArray | Where-Object { [string]$_.key -eq $key })
        if ($item.Count -ne 1 -or $null -eq $item[0].usageTon) { return $null }
        $total+=[double]$item[0].usageTon
      }
      return $total
    }
    $unitUsage=[ordered]@{
      unit1=[ordered]@{coal=Get-CofiringFastUsageSum @('unit1CoalA1','unit1CoalA2','unit1CoalB1','unit1CoalB2');bio=Get-CofiringFastUsageSum @('unit1Bio')}
      unit2=[ordered]@{coal=Get-CofiringFastUsageSum @('unit2CoalA1','unit2CoalA2','unit2CoalB1','unit2CoalB2');bio=Get-CofiringFastUsageSum @('unit2Bio')}
    }
    $referenceMatched=$null
    if ($referenceCompared -gt 0) { $referenceMatched=($referenceMismatches -eq 0 -and $referenceCompared -eq 10) }
    $summaryReady=($allBoundaryValid -and $allDurationValid)
    $diagnostics.summaries=$summariesArray
    $diagnostics.unitUsage=$unitUsage
    $diagnostics.organicInventoryReady=[bool]$organicInventoryReady
    $diagnostics.organicInventory=$organicInventory
    $diagnostics.allBoundaryValid=$allBoundaryValid
    $diagnostics.allDurationValid=$allDurationValid
    $diagnostics.anyBadDuration=$anyBadDuration
    $diagnostics.referenceCompared=$referenceCompared
    $diagnostics.referenceMismatches=$referenceMismatches
    $diagnostics.referenceMatched=$referenceMatched
    $diagnostics.failure=$(if($summaryReady){''}else{'요약 경계값 또는 품질 지속시간 검증이 완료되지 않았습니다.'})
    $finalResult=[ordered]@{
      schemaVersion=1;pilotRevision='PERIOD-V5';kind='cofiring_dataparc_fast_summary_pilot';runId=[string]$env:GS_COFIRING_RUN_ID
      targetDate=$targetDate;start=$cofiringStartText;end=$cofiringEndText;queryEnd=$cofiringQueryEnd.ToString('yyyy-MM-dd HH:mm')
      summaryReady=[bool]$summaryReady;dataValidated=$false;diagnosticOnly=$true;productionReady=$false;databaseWritten=$false
      queryMode='parallel-summary';formulaCells=($rowsFast*$columnsFast);queryElapsedSeconds=$diagnostics.queryElapsedSeconds
      allBoundaryValid=[bool]$allBoundaryValid;allDurationValid=[bool]$allDurationValid;anyBadDuration=[bool]$anyBadDuration
      referenceCompared=$referenceCompared;referenceMismatches=$referenceMismatches;referenceMatched=$referenceMatched
      summaries=$summariesArray;unitUsage=$unitUsage
      organicInventoryReady=[bool]$organicInventoryReady;organicInventory=$organicInventory
      failure=[string]$diagnostics.failure;cleanupVerified=$false
    }
    Complete-CofiringQuerySpan $resultAssemblySpan
    Write-CofiringJsonAtomic ([string]$env:GS_COFIRING_RESULT_PATH) $finalResult
    Write-CofiringJsonAtomic $cofiringDiagnosticsPath $diagnostics
    Write-CofiringProgress 'QUERY_COMPLETE'
    Write-ProbeStage ('고속 요약 계산 완료 · DataPARC 계산 '+[string]$diagnostics.queryElapsedSeconds+'초 · V7 비교 '+[string]$referenceCompared+'/10, mismatch '+[string]$referenceMismatches+' · bad quality '+[string]$anyBadDuration)
  } catch {
    $diagnostics.failure=$_.Exception.Message
    $diagnostics.errorDetails=Get-CofiringExceptionInfo $_
    $diagnostics.comFailure=$script:cofiringLastComFailure
    $diagnostics.comCalls=$script:cofiringComStats
    Write-CofiringJsonAtomic $cofiringDiagnosticsPath $diagnostics
    throw
  }


} catch {
  $queryFailure = $_.Exception
  $queryErrorRecord = $_
  $queryComFailure = $script:cofiringLastComFailure
} finally {
  $script:cofiringInCleanup=$true
  Complete-CofiringOpenQuerySpans
  Complete-CofiringOpenWorkerPhases 'interrupted'
  Write-ProbeStage "조회용 Excel·DataPARC Host 정리"
  Write-CofiringProgress 'CLEANUP'

  Start-CofiringWorkerPhase 'cleanupCloseQuit'
  $canCloseOwnedCom=$false
  if ($excel -and $ownedExcelPid -gt 0) {
    if (Test-OwnedProbeExcelIdentity $ownedExcelPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId) {
      $cleanupComPid=0
      try { $cleanupComPid=Get-ProbeExcelProcessId $excel }
      catch { $deferredExcelTeardownErrors.Add('종료 직전 COM PID 확인: '+$_.Exception.Message) }
      if ($cleanupComPid -eq $ownedExcelPid) { $canCloseOwnedCom=$true }
      elseif ($cleanupComPid -eq 0) { $deferredExcelTeardownErrors.Add('소유 Excel COM 연결을 확인할 수 없어 COM Close/Quit을 생략했습니다.') }
      else { $cleanupErrors.Add('살아 있는 Excel COM PID가 소유 PID와 달라 COM Close/Quit을 차단했습니다.') }
    } else {
      $probeCleanupActions.Add('소유 Excel이 이미 종료되었거나 신원이 달라 COM Close/Quit을 실행하지 않았습니다.')
    }
  }
  if ($canCloseOwnedCom) {
    if ($querySheet) { try { [void](Invoke-CofiringExcelCall -Operation 'Cleanup.EnableCalculation=False' -Cleanup -TimeoutMilliseconds 5000 -Action { $querySheet.EnableCalculation=$false }) } catch { } }
    if ($queryWorkbook) {
      try { [void](Invoke-CofiringExcelCall -Operation 'Cleanup.Workbook.Close' -Cleanup -TimeoutMilliseconds 5000 -Action { $queryWorkbook.Close($false) }) } catch { $deferredExcelTeardownErrors.Add('임시 통합문서 종료: '+$_.Exception.Message) }
    }
    try {
      [void](Invoke-CofiringExcelCall -Operation 'Cleanup.DisplayAlerts=False' -Cleanup -TimeoutMilliseconds 5000 -Action { $excel.DisplayAlerts=$false })
      [void](Invoke-CofiringExcelCall -Operation 'Cleanup.Application.Quit' -Cleanup -TimeoutMilliseconds 5000 -Action { $excel.Quit() })
    }
    catch { $deferredExcelTeardownErrors.Add('소유 Excel Quit: '+$_.Exception.Message) }
  }

  Complete-CofiringWorkerPhase 'cleanupCloseQuit'
  Start-CofiringWorkerPhase 'cleanupComReleaseAndGc'
  foreach ($comObject in @(
    $queryRange,
    $cells,
    $querySheet,
    $worksheets,
    $queryWorkbook,
    $workbooks,
    $excel
  )) {
    Release-ProbeCom $comObject
  }

  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
  Complete-CofiringWorkerPhase 'cleanupComReleaseAndGc'
  Start-CofiringWorkerPhase 'cleanupExcelExit'

  if ($ownedExcelPid -gt 0) {
    try {
      $excelExit = Complete-OwnedProbeExcelExit $launchedExcelProcess $ownedExcelPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId
      $excelExitVerified = [bool]$excelExit.Exited
      if ($excelExit.Forced) {
        $probeCleanupActions.Add("조회용 Excel 소유 PID " + [string]$ownedExcelPid + " 강제 종료")
      } else {
        $probeCleanupActions.Add("조회용 Excel 소유 PID " + [string]$ownedExcelPid + " 정상 종료 확인")
      }
      Write-ProbeStage $probeCleanupActions[$probeCleanupActions.Count - 1]
    } catch {
      $cleanupErrors.Add("자동조회용 Excel 종료 확인: " + $_.Exception.Message)
    }
  }

  Complete-CofiringWorkerPhase 'cleanupExcelExit'
  Start-CofiringWorkerPhase 'cleanupHostExit'
  if ($null -eq $ownedHostSnapshot -and $ownedExcelPid -gt 0) {
    try {
      $lateOwnedHosts = @(
        Get-ProbeDataParcHosts | Where-Object { [int]$_.ParentProcessId -eq $ownedExcelPid }
      )
      if ($lateOwnedHosts.Count -eq 1) {
        $ownedHostSnapshot = New-ProbeHostSignature $lateOwnedHosts[0] $ownedExcelPid $ownedExcelStartTicks $ownedExcelSessionId
        # Persist late Host ownership before attempting cleanup so the Controller
        # can independently recover the exact Host if this Worker exits mid-cleanup.
        Write-ProbeOwnership
      } elseif ($lateOwnedHosts.Count -gt 1) {
        throw "조회용 Excel 자식 DataPARC Host가 둘 이상이라 자동 정리를 중단합니다."
      }
    } catch {
      $cleanupErrors.Add("DataPARC Host 지연 신원확인: " + $_.Exception.Message)
    }
  }

  if ($null -ne $ownedHostSnapshot) {
    $hostExited = $false
    $hostExitDeadline = [datetime]::UtcNow.AddSeconds(25)
    do {
      if (-not (Test-CofiringWorkerProcessPresent ([int]$ownedHostSnapshot.ProcessId))) { break }
      Start-Sleep -Milliseconds 500
    } while ([datetime]::UtcNow -lt $hostExitDeadline)

    $hostExited = (-not (Test-CofiringWorkerProcessPresent ([int]$ownedHostSnapshot.ProcessId)))
    if (-not $hostExited) {
      if (Test-ProbeHostSignature $ownedHostSnapshot) {
        $ownedHostProcess = $null
        try {
          $ownedHostProcess = Get-Process -Id ([int]$ownedHostSnapshot.ProcessId) -ErrorAction Stop
          [void]$ownedHostProcess.Handle
          if ([long]$ownedHostProcess.StartTime.ToUniversalTime().Ticks -ne [long]$ownedHostSnapshot.StartTicks -or
              [int]$ownedHostProcess.SessionId -ne [int]$ownedHostSnapshot.SessionId -or
              -not [string]::Equals([string]$ownedHostProcess.Path, [string]$ownedHostSnapshot.Path, [StringComparison]::OrdinalIgnoreCase) -or
              -not (Test-ProbeHostSignature $ownedHostSnapshot)) {
            throw "DataPARC Host 종료 직전 프로세스 신원이 일치하지 않습니다."
          }
          $ownedHostProcess.Kill()
          $probeCleanupActions.Add("조회용 DataPARC Host 소유 PID " + [string]$ownedHostSnapshot.ProcessId + " 강제 종료")
          Write-ProbeStage $probeCleanupActions[$probeCleanupActions.Count - 1]
          $hostExited = Wait-ProbePinnedProcessExit $ownedHostProcess 5000
        } catch {
          $stopError = $_.Exception.Message
          if ($ownedHostProcess) {
            $hostExited = Wait-ProbePinnedProcessExit $ownedHostProcess 1000
          } else {
            $hostExited = Wait-ProbeProcessExit ([int]$ownedHostSnapshot.ProcessId) ([datetime]::UtcNow.AddSeconds(1))
          }
          if ($hostExited) {
            $probeCleanupActions.Add("조회용 DataPARC Host 소유 PID " + [string]$ownedHostSnapshot.ProcessId + " 강제 종료 직전 이미 종료 확인")
            Write-ProbeStage $probeCleanupActions[$probeCleanupActions.Count - 1]
          } else {
            $cleanupErrors.Add("자동조회용 DataPARC Host 강제 종료: " + $stopError)
          }
        } finally {
          if ($ownedHostProcess) { $ownedHostProcess.Dispose() }
        }
      } else {
        $hostExited = Wait-ProbeProcessExit ([int]$ownedHostSnapshot.ProcessId) ([datetime]::UtcNow.AddSeconds(1))
        if ($hostExited) {
          $probeCleanupActions.Add("조회용 DataPARC Host 소유 PID " + [string]$ownedHostSnapshot.ProcessId + " 신원 재확인 직전 이미 종료 확인")
          Write-ProbeStage $probeCleanupActions[$probeCleanupActions.Count - 1]
        } else {
          $cleanupErrors.Add("DataPARC Host PID 신원이 바뀌어 강제 종료하지 않았습니다.")
        }
      }
    }

    if (-not $hostExited) {
      $cleanupErrors.Add("자동조회용 DataPARC Host가 종료되지 않았습니다.")
    }
  }

  Complete-CofiringWorkerPhase 'cleanupHostExit'
  Start-CofiringWorkerPhase 'cleanupFinalUniverse'
  try {
    $finalExcelPids = @(
      Get-Process -Name "EXCEL" -ErrorAction SilentlyContinue |
        Where-Object { [int]$_.SessionId -eq $currentSessionId } |
        ForEach-Object { [int]$_.Id }
    )
    if (-not (Test-ProbeExactProcessUniverse $baselineExcelSignatures $finalExcelPids)) {
      $cleanupErrors.Add("기존 사용자 Excel 프로세스가 변경·종료됐거나 소유 불명 Excel이 새로 나타났습니다.")
    } else {
      $excelUniverseVerified = $true
    }
  } catch {
    $cleanupErrors.Add("최종 Excel 프로세스 전수 확인: " + $_.Exception.Message)
  }
  try {
    $finalHostPids = @(
      Get-ProbeDataParcHosts |
        Where-Object { [int]$_.SessionId -eq $currentSessionId } |
        ForEach-Object { [int]$_.ProcessId }
    )
    if (-not (Test-ProbeExactProcessUniverse $baselineHostSignatures $finalHostPids)) {
      $cleanupErrors.Add("기존 사용자 DataPARC Host가 변경·종료됐거나 소유 불명 Host가 새로 나타났습니다.")
    } else {
      $hostUniverseVerified = $true
    }
  } catch {
    $cleanupErrors.Add("최종 DataPARC Host 전수 확인: " + $_.Exception.Message)
  }

  Complete-CofiringWorkerPhase 'cleanupFinalUniverse'
  if ($deferredExcelTeardownErrors.Count -gt 0) {
    if ($excelExitVerified -and $excelUniverseVerified -and $hostUniverseVerified) {
      $probeCleanupActions.Add(
        "COM 종료 호출 오류 후에도 보관된 Excel 핸들 종료와 현재 세션 Excel/DataPARC 원상복구를 확인"
      )
      Write-ProbeStage $probeCleanupActions[$probeCleanupActions.Count - 1]
    } else {
      foreach ($deferredError in $deferredExcelTeardownErrors) {
        $cleanupErrors.Add($deferredError)
      }
    }
  }

  if ($launchedExcelProcess) {
    try { $launchedExcelProcess.Dispose() } catch {
    }
  }

  if ($probeMutex) {
    if ($probeMutexAcquired) {
      try { $probeMutex.ReleaseMutex() } catch {
      }
    }
    try { $probeMutex.Dispose() } catch {
    }
  }
}

if ($null -eq $finalResult) {
  $finalResult=[ordered]@{schemaVersion=1;kind='cofiring_dataparc_fast_summary_pilot';runId=[string]$env:GS_COFIRING_RUN_ID;start=$cofiringStartText;end=$cofiringEndText;summaryReady=$false;databaseWritten=$false;productionReady=$false;failure='조회 결과가 완성되지 않았습니다.'}
}
if ($null -ne $queryFailure) {
  $finalResult['ok']=$false
  $finalResult['failure']=[string]$queryFailure.Message
}
$finalResult['cleanupVerified']=($cleanupErrors.Count -eq 0 -and $ownedExcelPid -gt 0)
$finalResult['cleanupErrors']=@($cleanupErrors.ToArray())
$finalResult['cleanupActions']=@($probeCleanupActions.ToArray())
$finalResult['comCalls']=$script:cofiringComStats
$finalResult['activeBatch']=$diagnostics.activeBatch
$finalResult['completedTagCount']=$(if ($null -ne $diagnostics -and $null -ne $diagnostics.batches) { @($diagnostics.batches).Count } else { 0 })
if ($null -ne $queryErrorRecord) {
  $finalResult['errorDetails']=Get-CofiringExceptionInfo $queryErrorRecord
  $finalResult['comFailure']=$queryComFailure
}
$finalResult['elapsedSeconds']=[Math]::Round($workerClock.Elapsed.TotalSeconds,3)
$finalResult['timing']=[ordered]@{
  workerEntryUtc=$workerEntryUtc.ToString('o')
  workerProcessStartUtc=$(if($null -ne $workerProcessStartUtc){$workerProcessStartUtc.ToString('o')}else{$null})
  startupDelaySeconds=$workerStartupDelaySeconds
  readyAtUtc=$(if($null -ne $workerReadyUtc){$workerReadyUtc.ToString('o')}else{$null})
  elapsedBasis='monotonic_since_first_worker_statement'
  workerPhases=@(Get-CofiringWorkerPhaseSnapshot)
  workerProcessLookup=$script:cofiringWorkerLookup
  nativeOmAttach=(Get-CofiringNativeOmSnapshot)
  queryInternal=(Get-CofiringQuerySnapshot)
}
Write-CofiringJsonAtomic ([string]$env:GS_COFIRING_RESULT_PATH) $finalResult
Write-ProbeStage ('조회 종료 · Excel 정리 확인 '+[string]$finalResult.cleanupVerified+' · 계산 유효 여부와 별도')
Write-CofiringProgress 'COMPLETE'
[Console]::WriteLine($resultMarker+'RESULT_FILE_WRITTEN')
[Console]::Out.Flush()
if ($cleanupErrors.Count -gt 0 -or $null -ne $queryFailure) { exit 1 }
exit 0

