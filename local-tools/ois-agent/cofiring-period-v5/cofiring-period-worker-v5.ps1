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
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

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
$probeCleanupActions = New-Object System.Collections.Generic.List[string]
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

function Write-CofiringJsonAtomic([string]$Path, $Value) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw '진단 결과 경로가 비어 있습니다.' }
  $next=$Path+'.new'
  [IO.File]::WriteAllText($next,($Value | ConvertTo-Json -Compress -Depth 20),(New-Object Text.UTF8Encoding($false)))
  if ([IO.File]::Exists($Path)) { [IO.File]::Replace($next,$Path,$Path+'.previous') }
  else { [IO.File]::Move($next,$Path) }
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


$workerClock=[Diagnostics.Stopwatch]::StartNew()
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

  $actualTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $processTemp = [IO.Path]::GetFullPath([string]$env:TEMP).TrimEnd('\')
  $processTmp = [IO.Path]::GetFullPath([string]$env:TMP).TrimEnd('\')

  if (
    -not [string]::Equals($actualTemp, $expected, [StringComparison]::OrdinalIgnoreCase) -or
    -not [string]::Equals($processTemp, $expected, [StringComparison]::OrdinalIgnoreCase) -or
    -not [string]::Equals($processTmp, $expected, [StringComparison]::OrdinalIgnoreCase)
  ) {
    throw ("Add-Type 전용 TEMP/TMP 격리가 적용되지 않았습니다. expected=" + $expected + " / actual=" + $actualTemp)
  }

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
}

Assert-CofiringCompilerTemp

if (-not ("GsBlowerRuntimeNativeOmV1" -as [type])) {
  try {
    Add-Type -TypeDefinition @"
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

    private static string WindowClass(IntPtr hwnd)
    {
        StringBuilder builder = new StringBuilder(256);
        int length = GetClassName(hwnd, builder, builder.Capacity);
        return length <= 0 ? "" : builder.ToString();
    }

    public static IntPtr[] FindNativeObjectWindows(int processId)
    {
        List<IntPtr> result = new List<IntPtr>();

        EnumWindows(
            delegate(IntPtr top, IntPtr state)
            {
                uint topPid;
                GetWindowThreadProcessId(top, out topPid);
                if (topPid != (uint)processId) return true;

                if (String.Equals(WindowClass(top), "XLMAIN", StringComparison.OrdinalIgnoreCase)) {
                    result.Add(top);
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
  } catch {
    throw ("NativeOM Add-Type 컴파일 실패: " + $_.Exception.Message + " / TEMP=" + [string]$env:TEMP)
  }
}

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

function Wait-OwnedProbeExcelNativeObject {
  param(
    [int]$ExcelProcessId,
    [datetime]$Deadline,
    [int[]]$AllowedBaselineExcelPids
  )

  do {
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

    foreach ($nativeWindow in @([GsBlowerRuntimeNativeOmV1]::FindNativeObjectWindows($ExcelProcessId))) {
      $nativeObject = $null
      $candidateApplication = $null
      $keep = $false

      try {
        $nativeObject = [GsBlowerRuntimeNativeOmV1]::GetNativeObject([IntPtr]$nativeWindow)
        if ($null -eq $nativeObject) { continue }
        try { $candidateApplication = (Get-CofiringExcelProperty -Target $nativeObject -Member 'Application' -Operation 'NativeOM.Application' -TimeoutMilliseconds 1000).Value } catch { $candidateApplication = $null }
        if ($null -eq $candidateApplication) { continue }

        if ((Get-ProbeExcelProcessId $candidateApplication) -eq $ExcelProcessId) {
          $keep = $true
          return $candidateApplication
        }
      } catch {
      } finally {
        Release-ProbeCom $nativeObject
        if (-not $keep -and $null -ne $candidateApplication) {
          Release-ProbeCom $candidateApplication
        }
      }
    }

    Start-Sleep -Milliseconds 300
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
    if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 250
  } while ([datetime]::UtcNow -lt $Deadline)
  return ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
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
    [IO.File]::Replace($temporaryPath, $ownershipPath, $backupPath)
  } else {
    [IO.File]::Move($temporaryPath, $ownershipPath)
  }
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

  $baselineHosts = @(
    Get-ProbeDataParcHosts | Where-Object {
      [int]$_.SessionId -eq $currentSessionId -and
      $baselineExcelPids -contains [int]$_.ParentProcessId
    }
  )
  $unexpectedBaselineHosts = @(
    Get-ProbeDataParcHosts | Where-Object {
      [int]$_.SessionId -eq $currentSessionId -and
      $baselineExcelPids -notcontains [int]$_.ParentProcessId
    }
  )
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
  Write-ProbeStage "별도 숨김 Excel 시작"
  $launchedExcelProcess = Start-Process -FilePath $ownedExcelPath -ArgumentList @("/x") -WindowStyle Hidden -PassThru
  [void]$launchedExcelProcess.Handle
  $ownedExcelPid = [int]$launchedExcelProcess.Id
  $ownedExcelStartTicks = [long]$launchedExcelProcess.StartTime.ToUniversalTime().Ticks
  $ownedExcelSessionId = [int]$launchedExcelProcess.SessionId

  if (-not (Test-OwnedProbeExcelIdentity $ownedExcelPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId)) {
    throw "자동조회용 Excel 프로세스 신원을 확인하지 못했습니다."
  }

  Write-ProbeOwnership
  Write-ProbeStage "PID 고유 창에서 Excel COM 직접 연결"
  $excel = Wait-OwnedProbeExcelNativeObject $ownedExcelPid ([datetime]::UtcNow.AddSeconds(45)) $baselineExcelPids
  if ($null -eq $excel) {
    throw ("자동조회용 Excel PID " + [string]$ownedExcelPid + "의 COM 객체를 얻지 못했습니다.")
  }

  $attachedExcelPid = Get-ProbeExcelProcessId $excel
  if ($attachedExcelPid -ne $ownedExcelPid) {
    throw "연결한 Excel COM PID가 자동조회용 PID와 다릅니다."
  }

  [void](Invoke-CofiringExcelCall -Operation 'Application.Visible=False' -Action { $excel.Visible=$false })
  [void](Invoke-CofiringExcelCall -Operation 'Application.DisplayAlerts=False' -Action { $excel.DisplayAlerts=$false })
  [void](Invoke-CofiringExcelCall -Operation 'Application.AskToUpdateLinks=False' -Action { $excel.AskToUpdateLinks=$false })
  [void](Invoke-CofiringExcelCall -Operation 'Application.ScreenUpdating=False' -Action { $excel.ScreenUpdating=$false })
  [void](Invoke-CofiringExcelCall -Operation 'Application.EnableEvents=False' -Action { $excel.EnableEvents=$false })

  $startupWorkbooks = $null
  try {
    $startupWorkbooks = (Get-CofiringExcelProperty -Target $excel -Member 'Workbooks' -Operation 'Startup.Workbooks').Value
    for ($startupIndex = [int](Get-CofiringExcelProperty -Target $startupWorkbooks -Member 'Count' -Operation 'Startup.Workbooks.Count').Value; $startupIndex -ge 1; $startupIndex -= 1) {
      $startupWorkbook = $null
      try {
        $startupWorkbook = (Invoke-CofiringExcelCall -Operation 'Startup.Workbooks.Item' -Action { param($box) $box.Value=$startupWorkbooks.Item($startupIndex) }).Value
        if (-not [bool](Get-CofiringExcelProperty -Target $startupWorkbook -Member 'IsAddin' -Operation 'Startup.Workbook.IsAddin').Value) {
          [void](Invoke-CofiringExcelCall -Operation 'Startup.Workbook.Close' -NoRetry -Action { $startupWorkbook.Close($false) })
        }
      } finally {
        Release-ProbeCom $startupWorkbook
      }
    }
  } finally {
    Release-ProbeCom $startupWorkbooks
  }

  Write-ProbeStage "DataPARC Add-In 자동 시작 확인"
  $ownedHostCim = Wait-OwnedProbeDataParcHost $ownedExcelPid $baselineExcelPids ([datetime]::UtcNow.AddSeconds(60))
  if ($null -eq $ownedHostCim) {
    throw "자동조회용 숨김 Excel에서 DataPARC Add-In Host가 시작되지 않았습니다."
  }
  $ownedHostSnapshot = New-ProbeHostSignature $ownedHostCim $ownedExcelPid $ownedExcelStartTicks $ownedExcelSessionId
  Write-ProbeOwnership

  Write-ProbeStage "조회용 임시 통합문서 생성"
  $workbooks = (Get-CofiringExcelProperty -Target $excel -Member 'Workbooks' -Operation 'Query.Workbooks').Value
  # Creation is non-idempotent; never blindly replay it.
  $queryWorkbook = (Invoke-CofiringExcelCall -Operation 'Query.Workbooks.Add' -NoRetry -Action { param($box) $box.Value=$workbooks.Add() }).Value
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
    $rowsFast=$cofiringTags.Count
    $columnsFast=$columnNames.Count
    $startBucketEnd=$cofiringStart.AddMinutes(1)
    $endBucketEnd=$cofiringEnd.AddMinutes(1)
    $fullStart=$cofiringStart.ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)
    $fullEnd=$cofiringEnd.ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)
    $firstEnd=$startBucketEnd.ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)
    $lastEnd=$endBucketEnd.ToString('yyyy-MM-dd HH:mm:ss',[Globalization.CultureInfo]::InvariantCulture)

    $queryRange=(Invoke-CofiringExcelCall -Operation 'Fast.Range' -Action { param($box) $box.Value=$querySheet.Range('A1:K10') }).Value
    [void](Invoke-CofiringExcelCall -Operation 'Fast.EnableCalculation=False' -Action { $querySheet.EnableCalculation=$false })
    [void](Invoke-CofiringExcelCall -Operation 'Fast.ClearContents' -Action { $queryRange.ClearContents() })
    $formulasFast=New-Object 'object[,]' $rowsFast,$columnsFast
    for ($r=0;$r -lt $rowsFast;$r+=1) {
      $tag=$cofiringTags[$r]
      $safeTag=([string]$tag.tag).Replace('"','""')
      $formulasFast[$r,0]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$firstEnd+'","Start","Value")'
      $formulasFast[$r,1]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$firstEnd+'","Start","QualStr")'
      $formulasFast[$r,2]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$firstEnd+'","Start","Time")'
      $formulasFast[$r,3]='=fnTagStat("'+$safeTag+'","'+$fullEnd+'","'+$lastEnd+'","Start","Value")'
      $formulasFast[$r,4]='=fnTagStat("'+$safeTag+'","'+$fullEnd+'","'+$lastEnd+'","Start","QualStr")'
      $formulasFast[$r,5]='=fnTagStat("'+$safeTag+'","'+$fullEnd+'","'+$lastEnd+'","Start","Time")'
      $formulasFast[$r,6]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","Min","Value")'
      $formulasFast[$r,7]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","Max","Value")'
      $formulasFast[$r,8]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","Delta","Value")'
      $formulasFast[$r,9]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","DurationGood","Value")'
      $formulasFast[$r,10]='=fnTagStat("'+$safeTag+'","'+$fullStart+'","'+$fullEnd+'","DurationBad","Value")'
    }
    Write-ProbeStage ('고속 요약 조회 준비 · 10 TAG x 11 통계 = '+[string]($rowsFast*$columnsFast)+'개 수식 동시 계산')
    [void](Invoke-CofiringExcelCall -Operation 'Fast.Formula' -Action { $queryRange.Formula=$formulasFast })
    $formulasFast=$null
    $fastClock=[Diagnostics.Stopwatch]::StartNew()
    $fastDeadlineSeconds=60.0
    $stableReads=0;$previousFast=$null;$lastLog=[datetime]::MinValue;$fastState=$null
    $diagnostics.activeBatch=[ordered]@{phase='WAIT_RESPONSE';stableReads=0;elapsedSeconds=0;response=$null}
    [void](Invoke-CofiringExcelCall -Operation 'Fast.EnableCalculation=True' -Action { $querySheet.EnableCalculation=$true })
    do {
      Assert-CofiringNotCancelled
      if ($fastClock.Elapsed.TotalSeconds -ge $fastDeadlineSeconds) { throw '고속 요약 통계가 60초 안에 완료되지 않았습니다.' }
      Start-Sleep -Milliseconds 500
      $remaining=$fastDeadlineSeconds-$fastClock.Elapsed.TotalSeconds
      $readBudget=[int][Math]::Max(1.0,[Math]::Min(30000.0,[Math]::Floor($remaining*1000.0)))
      $matrix=(Get-CofiringExcelProperty -Target $queryRange -Member 'Value2' -Operation 'Fast.Value2' -TimeoutMilliseconds $readBudget -MaxAttempts 100).Value
      $fastState=Get-CofiringFastMatrixState $matrix $rowsFast $columnsFast $columnKinds
      if (-not $fastState.shapeValid) {
        $shape=Get-CofiringReturnShape $matrix
        throw ('고속 요약 배열 크기가 10x11이 아닙니다: '+($shape | ConvertTo-Json -Compress))
      }
      if ($fastState.errorCells -gt 0) { throw ('고속 요약 수식 오류: '+[string]$fastState.firstProblem) }
      if ($fastState.complete) {
        if ($null -ne $previousFast -and (Test-CofiringFastSnapshotEqual $matrix $previousFast $rowsFast $columnsFast)) { $stableReads+=1 } else { $stableReads=1 }
        $previousFast=$matrix.Clone()
      } else {
        $stableReads=0;$previousFast=$null
      }
      $diagnostics.activeBatch=[ordered]@{phase=$(if($fastState.complete){'VERIFY_STABLE'}else{'WAIT_RESPONSE'});stableReads=$stableReads;elapsedSeconds=[Math]::Round($fastClock.Elapsed.TotalSeconds,3);response=$fastState}
      if (([datetime]::UtcNow-$lastLog).TotalSeconds -ge 2 -or $stableReads -ge 3) {
        Write-ProbeStage ('고속 요약 응답 '+[string]$fastState.valueCells+'/'+[string]$fastState.cells+' · invalid '+[string]$fastState.invalidCells+' · pending '+[string]$fastState.pendingCells+' · 동일 응답 '+[string]$stableReads+'/3 · '+[string][Math]::Round($fastClock.Elapsed.TotalSeconds,1)+'초')
        $lastLog=[datetime]::UtcNow
      }
    } while ($stableReads -lt 3)
    [void](Invoke-CofiringExcelCall -Operation 'Fast.FreezeCalculation' -Action { $querySheet.EnableCalculation=$false })
    $diagnostics.response=$fastState
    $diagnostics.queryElapsedSeconds=[Math]::Round($fastClock.Elapsed.TotalSeconds,3)
    $diagnostics.batches=@([ordered]@{mode='parallel-summary';formulaCells=($rowsFast*$columnsFast);response=$fastState;elapsedSeconds=$diagnostics.queryElapsedSeconds})

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
    for ($r=0;$r -lt $rowsFast;$r+=1) {
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
      $startTimeValid=($null -ne $startTime -and $startTime -ge $cofiringStart -and $startTime -lt $cofiringStart.AddMinutes(1))
      $endTimeValid=($null -ne $endTime -and $endTime -ge $cofiringEnd -and $endTime -lt $cofiringEnd.AddMinutes(1))
      $boundaryValid=($null -ne $startValue -and $null -ne $endValue -and $startValue -ge 0 -and $endValue -ge 0 -and (Test-OrganicQualityGood $startQuality) -and (Test-OrganicQualityGood $endQuality) -and $startTimeValid -and $endTimeValid)
      $durationCoverageValid=($null -ne $durationGood -and $null -ne $durationBad -and $durationGood -ge 0 -and $durationBad -ge 0 -and [Math]::Abs(($durationGood+$durationBad)-$durationExpected) -le 2.0)
      $usage=$null
      if ($null -ne $startValue -and $null -ne $endValue) { $usage=[double]$endValue-[double]$startValue }
      $usageValid=($null -ne $usage -and $usage -ge -0.001)
      $rangeSpread=$null
      if ($null -ne $minValue -and $null -ne $maxValue) { $rangeSpread=[double]$maxValue-[double]$minValue }
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
        usageTon=$usage;min=$minValue;max=$maxValue;rangeSpread=$rangeSpread;delta=$deltaValue
        durationGoodSeconds=$durationGood;durationBadSeconds=$durationBad;durationCoverageValid=$durationCoverageValid
        boundaryValid=$boundaryValid;dataComplete=($boundaryValid -and $usageValid -and $durationCoverageValid -and $durationBad -le 0.001)
        referenceExpectedTon=$referenceExpected;referenceMatched=$referenceMatch
      })
    }
    $summariesArray=@($summaries.ToArray())
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
      queryMode='parallel-summary';formulaCells=110;queryElapsedSeconds=$diagnostics.queryElapsedSeconds
      allBoundaryValid=[bool]$allBoundaryValid;allDurationValid=[bool]$allDurationValid;anyBadDuration=[bool]$anyBadDuration
      referenceCompared=$referenceCompared;referenceMismatches=$referenceMismatches;referenceMatched=$referenceMatched
      summaries=$summariesArray;unitUsage=$unitUsage;failure=[string]$diagnostics.failure;cleanupVerified=$false
    }
    Write-CofiringJsonAtomic ([string]$env:GS_COFIRING_RESULT_PATH) $finalResult
    Write-CofiringJsonAtomic $cofiringDiagnosticsPath $diagnostics
    Write-ProbeStage ('고속 요약 계산 완료 · DataPARC 계산 '+[string]$diagnostics.queryElapsedSeconds+'초 · V7 비교 '+[string]$referenceCompared+'/10, mismatch '+[string]$referenceMismatches+' · bad quality '+[string]$anyBadDuration)
  } catch {
    $diagnostics.failure=$_.Exception.Message
    $diagnostics.errorDetails=Get-CofiringExceptionInfo $_
    $diagnostics.comFailure=$script:cofiringLastComFailure
    $diagnostics.comCalls=$script:cofiringComStats
    throw
  } finally {
    Write-CofiringJsonAtomic $cofiringDiagnosticsPath $diagnostics
  }


} catch {
  $queryFailure = $_.Exception
  $queryErrorRecord = $_
  $queryComFailure = $script:cofiringLastComFailure
} finally {
  $script:cofiringInCleanup=$true
  Write-ProbeStage "조회용 Excel·DataPARC Host 정리"

  $canCloseOwnedCom=$false
  if ($excel -and $ownedExcelPid -gt 0) {
    if (Test-OwnedProbeExcelIdentity $ownedExcelPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId) {
      $cleanupComPid=0
      try { $cleanupComPid=Get-ProbeExcelProcessId $excel }
      catch { $cleanupErrors.Add('종료 직전 COM PID 확인: '+$_.Exception.Message) }
      if ($cleanupComPid -eq $ownedExcelPid) { $canCloseOwnedCom=$true }
      elseif ($cleanupComPid -eq 0) { $cleanupErrors.Add('소유 Excel COM 연결을 확인할 수 없어 COM Close/Quit을 생략했습니다.') }
      else { $cleanupErrors.Add('살아 있는 Excel COM PID가 소유 PID와 달라 COM Close/Quit을 차단했습니다.') }
    } else {
      $probeCleanupActions.Add('소유 Excel이 이미 종료되었거나 신원이 달라 COM Close/Quit을 실행하지 않았습니다.')
    }
  }
  if ($canCloseOwnedCom) {
    if ($querySheet) { try { [void](Invoke-CofiringExcelCall -Operation 'Cleanup.EnableCalculation=False' -Cleanup -TimeoutMilliseconds 5000 -Action { $querySheet.EnableCalculation=$false }) } catch { } }
    if ($queryWorkbook) {
      try { [void](Invoke-CofiringExcelCall -Operation 'Cleanup.Workbook.Close' -Cleanup -TimeoutMilliseconds 5000 -Action { $queryWorkbook.Close($false) }) } catch { $cleanupErrors.Add('임시 통합문서 종료: '+$_.Exception.Message) }
    }
    try {
      [void](Invoke-CofiringExcelCall -Operation 'Cleanup.DisplayAlerts=False' -Cleanup -TimeoutMilliseconds 5000 -Action { $excel.DisplayAlerts=$false })
      [void](Invoke-CofiringExcelCall -Operation 'Cleanup.Application.Quit' -Cleanup -TimeoutMilliseconds 5000 -Action { $excel.Quit() })
    }
    catch { $cleanupErrors.Add('소유 Excel Quit: '+$_.Exception.Message) }
  }

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

  if ($ownedExcelPid -gt 0) {
    $excelExited = Wait-ProbeProcessExit $ownedExcelPid ([datetime]::UtcNow.AddSeconds(12))
    if (-not $excelExited) {
      if (Test-OwnedProbeExcelIdentity $ownedExcelPid $ownedExcelStartTicks $ownedExcelPath $ownedExcelSessionId) {
        try {
          Stop-Process -Id $ownedExcelPid -Force -ErrorAction Stop
          $probeCleanupActions.Add("조회용 Excel 소유 PID " + [string]$ownedExcelPid + " 강제 종료")
          Write-ProbeStage $probeCleanupActions[$probeCleanupActions.Count - 1]
          $excelExited = Wait-ProbeProcessExit $ownedExcelPid ([datetime]::UtcNow.AddSeconds(5))
        } catch {
          $cleanupErrors.Add("자동조회용 Excel 강제 종료: " + $_.Exception.Message)
        }
      } else {
        $cleanupErrors.Add("자동조회용 Excel PID 신원이 바뀌어 강제 종료하지 않았습니다.")
      }
    }
    if (-not $excelExited) { $cleanupErrors.Add("자동조회용 Excel이 종료되지 않았습니다.") }
  }

  if ($null -eq $ownedHostSnapshot -and $ownedExcelPid -gt 0) {
    try {
      $lateOwnedHosts = @(
        Get-ProbeDataParcHosts | Where-Object { [int]$_.ParentProcessId -eq $ownedExcelPid }
      )
      if ($lateOwnedHosts.Count -eq 1) {
        $ownedHostSnapshot = New-ProbeHostSignature $lateOwnedHosts[0] $ownedExcelPid $ownedExcelStartTicks $ownedExcelSessionId
      }
    } catch {
      $cleanupErrors.Add("DataPARC Host 지연 신원확인: " + $_.Exception.Message)
    }
  }

  if ($null -ne $ownedHostSnapshot) {
    $hostExitDeadline = [datetime]::UtcNow.AddSeconds(25)
    do {
      if ($null -eq (Get-Process -Id ([int]$ownedHostSnapshot.ProcessId) -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 500
    } while ([datetime]::UtcNow -lt $hostExitDeadline)

    if ($null -ne (Get-Process -Id ([int]$ownedHostSnapshot.ProcessId) -ErrorAction SilentlyContinue)) {
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
          [void]$ownedHostProcess.WaitForExit(5000)
        } catch {
          $cleanupErrors.Add("자동조회용 DataPARC Host 강제 종료: " + $_.Exception.Message)
        } finally {
          if ($ownedHostProcess) { $ownedHostProcess.Dispose() }
        }
      } else {
        $cleanupErrors.Add("DataPARC Host PID 신원이 바뀌어 강제 종료하지 않았습니다.")
      }
    }

    if ($null -ne (Get-Process -Id ([int]$ownedHostSnapshot.ProcessId) -ErrorAction SilentlyContinue)) {
      $cleanupErrors.Add("자동조회용 DataPARC Host가 종료되지 않았습니다.")
    }
  }

  if (-not (Test-ProbeProcessSignatureSet $baselineExcelSignatures)) {
    $cleanupErrors.Add("기존 사용자 Excel 프로세스가 조회 중 변경되거나 종료되었습니다.")
  }
  if (-not (Test-ProbeProcessSignatureSet $baselineHostSignatures)) {
    $cleanupErrors.Add("기존 사용자 DataPARC Host가 조회 중 변경되거나 종료되었습니다.")
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
Write-CofiringJsonAtomic ([string]$env:GS_COFIRING_RESULT_PATH) $finalResult
Write-ProbeStage ('조회 종료 · Excel 정리 확인 '+[string]$finalResult.cleanupVerified+' · 계산 유효 여부와 별도')
[Console]::WriteLine($resultMarker+'RESULT_FILE_WRITTEN')
[Console]::Out.Flush()
if ($cleanupErrors.Count -gt 0 -or $null -ne $queryFailure) { exit 1 }
exit 0
