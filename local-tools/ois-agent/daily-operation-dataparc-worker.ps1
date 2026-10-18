#Requires -Version 5.1
<#
Worker lifecycle extracted from DATAPARC_BLOWER_RUNTIME_PROBE_POWERSHELL_SCRIPT.
Organic card reader. Configuration and selected-day query are embedded below.
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

$stageMarker = '__DAILY_OPERATION_STAGE__'
$resultMarker = '__DAILY_OPERATION_RESULT__'
$probeWorkbookMarker = '__GS_DAILY_OPERATION_SILO_DATAPARC_V1__'
$targetDate = [string]$env:GS_DAILY_OPERATION_TARGET_DATE
$targetDay = [datetime]::MinValue
if (-not [datetime]::TryParseExact($targetDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$targetDay)) {
  throw '조회일은 yyyy-MM-dd 형식이어야 합니다.'
}
$koreaZone = [TimeZoneInfo]::FindSystemTimeZoneById('Korea Standard Time')
if ([TimeZoneInfo]::Local.Id -ne $koreaZone.Id) {
  throw '이 시험은 회사 PC 시간대가 (UTC+09:00) 서울인 경우에 실행합니다. 조회일 해석 오류를 막기 위해 중단했습니다.'
}
$todayKst = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Now, $koreaZone).Date
if ($targetDay -lt [datetime]'2021-01-01' -or $targetDay -ge $todayKst) {
  throw '조회일은 2021-01-01 이후의 완료된 과거 날짜여야 합니다. 당일/미래 날짜는 하루 End 비교에 사용하지 않습니다.'
}
$organicTags = @(
  [pscustomobject]@{ Key='water_demi_avg'; Label='순수 생산량'; Tag='GSPOGE.ABB_DCS.000GHC30CF201XQ01/PLOT'; Statistic='TimeAvg'; Unit='t/h' },
  [pscustomobject]@{ Key='water_condensate_avg'; Label='복수량'; Tag='GSPOGE.ABB_DCS.000LCA30CF901XQ01/PLOT'; Statistic='TimeAvg'; Unit='t/h' },
  [pscustomobject]@{ Key='water_feed_u1_avg'; Label='1호기 급수량'; Tag='GSPOGE.ABB_DCS.106LAB60CF901XQ01-CAL/PLOT'; Statistic='TimeAvg'; Unit='t/h' },
  [pscustomobject]@{ Key='water_feed_u2_avg'; Label='2호기 급수량'; Tag='GSPOGE.ABB_DCS.206LAB60CF901XQ01-CAL/PLOT'; Statistic='TimeAvg'; Unit='t/h' },
  [pscustomobject]@{ Key='water_cbd_u1_avg'; Label='1호기 CBD량'; Tag='GSPOGE.ABB_DCS.104LCQ01CF201XQ01'; Statistic='TimeAvg'; Unit='t/h' },
  [pscustomobject]@{ Key='water_cbd_u2_avg'; Label='2호기 CBD량'; Tag='GSPOGE.ABB_DCS.204LCQ01CF201XQ01'; Statistic='TimeAvg'; Unit='t/h' },
  [pscustomobject]@{ Key='coal_a_storage_level'; Label='Coal Storage A Level'; Tag='GSPOGE.ABB_DCS.003EBF01CL201XQ01_F/PLOT'; Statistic='End'; Unit='m' },
  [pscustomobject]@{ Key='coal_b_storage_level'; Label='Coal Storage B Level'; Tag='GSPOGE.ABB_DCS.003EBF02CL201XQ01_F/PLOT'; Statistic='End'; Unit='m' },
  [pscustomobject]@{ Key='bio_storage_level'; Label='BIO Storage Level'; Tag='GSPOGE.ABB_DCS.003EBF20CL201XQ01_F/PLOT'; Statistic='End'; Unit='m' },
  [pscustomobject]@{ Key='coal_day_u1_a_end'; Label='1호기 Coal Day Silo A'; Tag='GSPOGE.ABB_DCS.104HHE10CW201XQ01/PLOT'; Statistic='End'; Unit='Ton' },
  [pscustomobject]@{ Key='coal_day_u1_b_end'; Label='1호기 Coal Day Silo B'; Tag='GSPOGE.ABB_DCS.104HHE20CW201XQ01/PLOT'; Statistic='End'; Unit='Ton' },
  [pscustomobject]@{ Key='coal_day_u2_a_end'; Label='2호기 Coal Day Silo A'; Tag='GSPOGE.ABB_DCS.204HHE10CW201XQ01/PLOT'; Statistic='End'; Unit='Ton' },
  [pscustomobject]@{ Key='coal_day_u2_b_end'; Label='2호기 Coal Day Silo B'; Tag='GSPOGE.ABB_DCS.204HHE20CW201XQ01/PLOT'; Statistic='End'; Unit='Ton' },
  [pscustomobject]@{ Key='power_max_daily'; Label='최대전력'; Tag='GSPOGE.ABB_DCS.CJD01FE006XJ41/PLOT'; Statistic='Max'; Unit='MW' }
)
$queryDates = @($targetDate)

function Read-OrganicTimestamp($Cell) {
  try {
    $raw = $Cell.Value2
    if ($null -eq $raw -or $raw -is [bool] -or $raw -is [Runtime.InteropServices.ErrorWrapper]) { return $null }
    if ($raw -is [datetime]) { return $raw }
    if ($raw -is [string]) {
      $parsedTime = [datetime]::MinValue
      if ([datetime]::TryParseExact($raw.Trim(), [string[]]@('yyyy-MM-dd HH:mm:ss','yyyy-MM-ddTHH:mm:ss'), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsedTime)) { return $parsedTime }
      return $null
    }
    $serial = Convert-ProbeNumber $raw
    if ($null -ne $serial -and $serial -ge 1 -and $serial -lt 2958465) { return [datetime]::FromOADate($serial) }
  } catch { }
  return $null
}


function Write-ProbeStage([string]$Message) {
  [Console]::WriteLine($stageMarker + $Message)
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
    $text = [string]$Cell.Text
    if ([string]::IsNullOrWhiteSpace($text) -or $text.StartsWith("#")) {
      return $null
    }
    return Convert-ProbeNumber $Cell.Value2
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

if (-not ("GsBlowerRuntimeNativeOmV1" -as [type])) {
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
}

function Get-ProbeExcelProcessId($ExcelApplication) {
  if ($null -eq $ExcelApplication) { return 0 }

  [uint32]$processId = 0
  $windowHandle = [IntPtr]([int64]$ExcelApplication.Hwnd)
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
        try { $candidateApplication = $nativeObject.Application } catch { $candidateApplication = $null }
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
  $ownershipPath = [string]$env:GS_DAILY_OPERATION_OWNERSHIP_PATH
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
    runId = [string]$env:GS_DAILY_OPERATION_RUN_ID
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
  if ([string]::IsNullOrWhiteSpace([string]$env:GS_DAILY_OPERATION_CONTROLLER_SIGNATURE)) { return $false }
  $controller = [string]$env:GS_DAILY_OPERATION_CONTROLLER_SIGNATURE | ConvertFrom-Json
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
  $ownershipCheckPath = [string]$env:GS_DAILY_OPERATION_OWNERSHIP_PATH
  if ([string]::IsNullOrWhiteSpace($ownershipCheckPath)) {
    throw "임시 상태 파일 경로가 없습니다. 완성된 시험 파일로 실행해 주세요."
  }
  $ownershipCheckResult = [IO.File]::ReadAllText($ownershipCheckPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  if ([string]$ownershipCheckResult.runId -ne [string]$env:GS_DAILY_OPERATION_RUN_ID -or
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

  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.ScreenUpdating = $false
  $excel.EnableEvents = $false

  $startupWorkbooks = $null
  try {
    $startupWorkbooks = $excel.Workbooks
    for ($startupIndex = [int]$startupWorkbooks.Count; $startupIndex -ge 1; $startupIndex -= 1) {
      $startupWorkbook = $null
      try {
        $startupWorkbook = $startupWorkbooks.Item($startupIndex)
        if (-not [bool]$startupWorkbook.IsAddin) { $startupWorkbook.Close($false) }
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
  $workbooks = $excel.Workbooks
  $queryWorkbook = $workbooks.Add()
  $worksheets = $queryWorkbook.Worksheets
  $querySheet = $worksheets.Item(1)
  $querySheet.Name = "Daily Operation Probe"
  $querySheet.EnableCalculation = $false
  $cells = $querySheet.Cells

  $markerCell = $null
  try {
    $markerCell = $querySheet.Range("XFD1")
    $markerCell.Value2 = $probeWorkbookMarker
  } finally {
    Release-ProbeCom $markerCell
  }

    Write-ProbeStage '일일운전 고정 TAG · 선택일 하루 집계 수식 입력'
  $queryWorkbook.Date1904 = $false
  $sampleDefinitions = @()
  $row = 1
  foreach ($dateText in $queryDates) {
    $day = [datetime]::ParseExact($dateText, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    $fromText = $day.ToString('yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
    $toText = $day.AddDays(1).ToString('yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
    foreach ($definition in $organicTags) {
      $sampleDefinitions += [pscustomobject]@{
        Row=$row; Date=$dateText; Key=$definition.Key; Label=$definition.Label; Tag=$definition.Tag
        Start=$fromText; End=$toText; Statistic=$definition.Statistic; Unit=$definition.Unit
      }
      $safeTag = ([string]$definition.Tag).Replace('"', '""')
      $column = 1
      foreach ($attribute in @('Value','QualStr','Time')) {
        $cell = $null
        try {
          $cell = $cells.Item($row, $column)
          $cell.Formula = '=fnTagStat("' + $safeTag + '","' + $fromText + '","' + $toText + '","' + $definition.Statistic + '","' + $attribute + '")'
          if ($attribute -eq 'Time') { $cell.NumberFormat = 'yyyy-mm-dd hh:mm:ss' }
        } finally { Release-ProbeCom $cell }
        $column += 1
      }
      $row += 1
    }
  }
  $queryRange = $querySheet.Range('A1:C' + [string]($row - 1))
  Write-ProbeStage 'DataPARC 조회 시작 · 값/품질/시각 반환 대기 (최대 90초)'
  $calculationDeadline = [datetime]::UtcNow.AddSeconds(90)
  $querySheet.EnableCalculation = $true
  [void]$queryRange.Calculate()
  do {
    Start-Sleep -Milliseconds 500
    $allReturned = $true
    foreach ($sample in $sampleDefinitions) {
      foreach ($column in @(1,2,3)) {
        $cell = $null
        try {
          $cell = $cells.Item([int]$sample.Row, $column)
          if ($column -eq 3) {
            if ($null -eq (Read-OrganicTimestamp $cell)) { $allReturned = $false }
          } else {
            $cellText = [string]$cell.Text
            if ([string]::IsNullOrWhiteSpace($cellText) -or $cellText.Trim().StartsWith('#')) { $allReturned = $false }
            if ($column -eq 1 -and $null -eq (Read-ProbeCellNumber $cell)) { $allReturned = $false }
          }
        } finally { Release-ProbeCom $cell }
      }
    }
  } while (-not $allReturned -and [datetime]::UtcNow -lt $calculationDeadline)

  $samples = @()
  $targetValues = [ordered]@{}
  $allValuesValid = $true
  $allQualitiesGood = $true
  foreach ($sample in $sampleDefinitions) {
    $valueCell = $null; $qualityCell = $null; $timeCell = $null
    try {
      $valueCell = $cells.Item([int]$sample.Row, 1)
      $qualityCell = $cells.Item([int]$sample.Row, 2)
      $timeCell = $cells.Item([int]$sample.Row, 3)
      $value = Read-ProbeCellNumber $valueCell
      $valueText = [string]$valueCell.Text
      $qualityText = ([string]$qualityCell.Text).Trim()
      $returnedTime = Read-OrganicTimestamp $timeCell
      $timeText = [string]$timeCell.Value2
      if ($null -ne $returnedTime) { $timeText = $returnedTime.ToString('yyyy-MM-dd HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture) }
      $valid = ($null -ne $value -and $value -ge 0)
      $qualityGood = Test-OrganicQualityGood $qualityText
      $timePresent = ($null -ne $returnedTime -and
        $returnedTime -ge $targetDay -and $returnedTime -le $targetDay.AddDays(1))
      if (-not $valid -or -not $timePresent) { $allValuesValid = $false }
      if (-not $qualityGood) { $allQualitiesGood = $false }
      $samples += [pscustomobject][ordered]@{
        date=$sample.Date; key=$sample.Key; label=$sample.Label; tag=$sample.Tag
        periodStartKst=($sample.Start + '+09:00'); periodEndKst=($sample.End + '+09:00')
        statistic=$sample.Statistic; unit=$sample.Unit; value=$value; valueText=$valueText; qualityText=$qualityText
        returnedTimeText=$timeText; validNonNegativeValue=$valid; qualityGood=$qualityGood
        formula=[string]$valueCell.Formula
      }
      if ($sample.Date -eq $targetDate) { $targetValues[$sample.Key] = $value }
    } finally {
      Release-ProbeCom $timeCell
      Release-ProbeCom $qualityCell
      Release-ProbeCom $valueCell
    }
  }
  $finalResult = [ordered]@{
    # A completed query can have missing/bad cells. Node and API validate each cell;
    # invalid fields become null plus a warning rather than zero or stale data.
    ok=($samples.Count -eq 14)
    mode='daily_operation_data'; requestType='daily_operation_data'; source='dataparc_hidden_excel'; schemaVersion=1
    runId=[string]$env:GS_DAILY_OPERATION_RUN_ID
    targetDate=$targetDate; step='1D'
    startLocal=($targetDay.ToString('yyyy-MM-dd') + 'T00:00:00+09:00')
    endLocal=($targetDay.AddDays(1).ToString('yyyy-MM-dd') + 'T00:00:00+09:00')
    allCellsReturned=$allReturned; allValuesValid=$allValuesValid; allQualitiesGood=$allQualitiesGood
    samples=$samples; databaseWritten=$false; cleanupVerified=$false
  }
  Write-ProbeStage ('일일운전 표본 반환: ' + [string]$samples.Count + ' / 모든 품질 Good: ' + [string]$allQualitiesGood)



} catch {
  $queryFailure = $_.Exception
} finally {
  Write-ProbeStage "조회용 Excel·DataPARC Host 정리"

  if ($querySheet) {
    try { $querySheet.EnableCalculation = $false } catch {
    }
  }
  if ($queryWorkbook) {
    try { $queryWorkbook.Close($false) } catch {
      $cleanupErrors.Add("임시 통합문서 종료: " + $_.Exception.Message)
    }
  }

  if ($excel) {
    try {
      if ((Get-ProbeExcelProcessId $excel) -ne $ownedExcelPid) {
        $cleanupErrors.Add("종료 직전 Excel COM PID가 소유 PID와 다릅니다.")
      } else {
        $excel.DisplayAlerts = $false
        $excel.Quit()
      }
    } catch {
      $cleanupErrors.Add("자동조회용 Excel Quit: " + $_.Exception.Message)
    }
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

if ($cleanupErrors.Count -gt 0) {
  throw ("일일운전 DataPARC 조회 정리 실패: " + ($cleanupErrors -join " | "))
}
if ($null -ne $queryFailure) { throw $queryFailure }
if ($null -eq $finalResult) { throw "일일운전 DataPARC 조회 결과가 생성되지 않았습니다." }

$finalResult["cleanupVerified"] = $true
$finalResult["cleanupActions"] = @($probeCleanupActions.ToArray())
Write-ProbeStage "숨김 Excel 공존 조회·정리 완료"
[Console]::WriteLine(
  $resultMarker + ($finalResult | ConvertTo-Json -Compress -Depth 8)
)
[Console]::Out.Flush()
