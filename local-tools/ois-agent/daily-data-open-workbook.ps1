#Requires -Version 5.1
<#
Read-only discovery of an already-open monthly Daily DATA workbook.
Dot-source this file; call Resolve-DailyDataOpenWorkbook -TargetDate yyyy-MM-dd.
The caller owns the three returned COM references (Workbook, Workbooks, Excel),
and must release them when finished. No Excel process or workbook is created.
Run COM work in the caller's separate STA worker with a wall-clock timeout:
a single blocked COM call cannot be interrupted by an in-process retry deadline.
#>
[CmdletBinding()]
param([switch]$ValidateOnly)

$script:DailyDataNativeOmSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class GsDailyDataOpenWorkbookNativeOmV1
{
    private const uint OBJID_NATIVEOM = 0xFFFFFFF0;
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr state);
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int maximum);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maximum);
    [DllImport("oleacc.dll", PreserveSig = true)]
    private static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out object nativeObject);

    private static string WindowClass(IntPtr hwnd)
    {
        StringBuilder result = new StringBuilder(256);
        return GetClassName(hwnd, result, result.Capacity) > 0 ? result.ToString() : "";
    }

    public static IntPtr[] FindNativeObjectWindows(int processId)
    {
        List<IntPtr> children = new List<IntPtr>();
        List<IntPtr> main = new List<IntPtr>();
        HashSet<IntPtr> seen = new HashSet<IntPtr>();
        EnumWindows(delegate(IntPtr top, IntPtr state) {
            uint topPid;
            GetWindowThreadProcessId(top, out topPid);
            if (topPid != (uint)processId) return true;
            if (String.Equals(WindowClass(top), "XLMAIN", StringComparison.OrdinalIgnoreCase)
                && seen.Add(top)) main.Add(top);
            EnumChildWindows(top, delegate(IntPtr child, IntPtr childState) {
                uint childPid;
                GetWindowThreadProcessId(child, out childPid);
                if (childPid == (uint)processId
                    && String.Equals(WindowClass(child), "EXCEL7", StringComparison.OrdinalIgnoreCase)
                    && seen.Add(child)) children.Add(child);
                return true;
            }, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
        // EXCEL7 normally supplies Excel.Window; XLMAIN is a fallback for empty workbooks.
        children.AddRange(main);
        return children.ToArray();
    }

    public static string[] FindProcessWindowTitles(int processId)
    {
        List<string> titles = new List<string>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr state) {
            uint owner;
            GetWindowThreadProcessId(hwnd, out owner);
            if (owner != (uint)processId) return true;
            StringBuilder title = new StringBuilder(1024);
            if (GetWindowText(hwnd, title, title.Capacity) > 0) titles.Add(title.ToString());
            return true;
        }, IntPtr.Zero);
        return titles.ToArray();
    }

    public static object GetNativeObject(IntPtr hwnd)
    {
        Guid iid = new Guid("00020400-0000-0000-C000-000000000046");
        object value;
        int result = AccessibleObjectFromWindow(hwnd, OBJID_NATIVEOM, ref iid, out value);
        return result == 0 ? value : null;
    }
}
'@

function Initialize-DailyDataNativeOm {
  if (-not ('GsDailyDataOpenWorkbookNativeOmV1' -as [type])) {
    # In-memory compilation: no shared DLL filename or file lock across Agent workers.
    Add-Type -TypeDefinition $script:DailyDataNativeOmSource -ErrorAction Stop
  }
}

function Release-DailyDataOpenCom {
  param($Value)
  if ($null -eq $Value) { return }
  try {
    if ([Runtime.InteropServices.Marshal]::IsComObject($Value)) {
      # Release exactly this acquisition, preserving any same-RCW reference retained elsewhere.
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Value)
    }
  } catch { }
}

function Invoke-DailyDataComRead {
  param([Parameter(Mandatory=$true)][scriptblock]$Read, [string]$Label = 'Excel 읽기')
  for ($readAttempt = 0; $readAttempt -lt 3; $readAttempt += 1) {
    try {
      # Do not pipeline-enumerate an Excel.Workbooks COM collection.
      $value = & $Read
      return ,$value
    } catch {
      $failure = $_.Exception
      while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
      $retryable = @(-2147418111, -2147417846, -2146777998) -contains [int]$failure.HResult
      if (-not $retryable -or $readAttempt -eq 2) {
        throw ($Label + ' 실패: ' + $_.Exception.Message)
      }
      Start-Sleep -Milliseconds 200
    }
  }
}

function Get-DailyDataExpectedWorkbookName {
  param([Parameter(Mandatory=$true)][string]$TargetDate)
  $day = [datetime]::MinValue
  if (-not [datetime]::TryParseExact($TargetDate, 'yyyy-MM-dd',
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::None, [ref]$day) -or
      $day.Year -lt 2000 -or $day.Year -gt 2099) {
    throw ('조회 날짜 형식이 올바르지 않습니다: ' + $TargetDate)
  }
  return ($day.ToString('yy.MM', [Globalization.CultureInfo]::InvariantCulture) +
    '-일일DATA관리.xlsx').Normalize([Text.NormalizationForm]::FormC)
}

function Select-DailyDataWorkbookMatch {
  param([object[]]$Candidates = @(), [Parameter(Mandatory=$true)][string]$ExpectedWorkbookName)
  $matches = New-Object System.Collections.Generic.List[object]
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($candidate in @($Candidates)) {
    if ($null -eq $candidate) { continue }
    $name = ([string]$candidate.Name).Normalize([Text.NormalizationForm]::FormC)
    if (-not [string]::Equals($name, $ExpectedWorkbookName, [StringComparison]::OrdinalIgnoreCase)) { continue }
    if ([int]$candidate.ProcessId -le 0 -or [string]::IsNullOrWhiteSpace([string]$candidate.FullName)) {
      throw ('대상 통합문서의 Excel PID 또는 전체 경로를 확인하지 못했습니다: ' + $ExpectedWorkbookName)
    }
    $identity = [string]$candidate.ProcessId + '|' +
      ([string]$candidate.FullName).Normalize([Text.NormalizationForm]::FormC)
    if ($seen.Add($identity)) { $matches.Add($candidate) }
  }
  if ($matches.Count -gt 1) {
    $locations = @($matches | ForEach-Object { 'PID ' + $_.ProcessId + ': ' + $_.FullName }) -join '; '
    throw ('동일한 대상 월 파일이 여러 위치/Excel 인스턴스에 열려 있습니다: ' + $locations +
      '. 사용할 원본을 확인하고 중복된 대상 파일만 닫은 뒤 다시 조회해 주세요.')
  }
  if ($matches.Count -eq 0) { return $null }
  return $matches[0]
}

function Get-DailyDataExcelProcessId {
  param($ExcelApplication)
  [uint32]$applicationPid = 0
  $applicationHwnd = [IntPtr]([int64](Invoke-DailyDataComRead -Read { $ExcelApplication.Hwnd } -Label 'Excel 창 PID 확인'))
  if ($applicationHwnd -eq [IntPtr]::Zero) { return 0 }
  [void][GsDailyDataOpenWorkbookNativeOmV1]::GetWindowThreadProcessId($applicationHwnd, [ref]$applicationPid)
  return [int]$applicationPid
}

function Get-DailyDataProcessConnection {
  param([Parameter(Mandatory=$true)][int]$ProcessId)
  $lastFailure = '읽을 수 있는 Excel 창을 찾지 못했습니다.'
  for ($attachAttempt = 0; $attachAttempt -lt 2; $attachAttempt += 1) {
    $windows = @([GsDailyDataOpenWorkbookNativeOmV1]::FindNativeObjectWindows($ProcessId))
    foreach ($nativeHwnd in $windows) {
      $nativeObject = $null
      $application = $null
      $books = $null
      try {
        $nativeObject = [GsDailyDataOpenWorkbookNativeOmV1]::GetNativeObject($nativeHwnd)
        if ($null -eq $nativeObject) { continue }
        $application = Invoke-DailyDataComRead -Read { $nativeObject.Application } -Label 'Excel Application 연결'
        if ($null -eq $application -or (Get-DailyDataExcelProcessId $application) -ne $ProcessId) { continue }
        $books = Invoke-DailyDataComRead -Read { ,$application.Workbooks } -Label '열린 통합문서 목록'
        if ($null -eq $books) { continue }
        $connection = [pscustomobject]@{ Excel=$application; Workbooks=$books; ProcessId=$ProcessId; Via='NativeOM' }
        $application = $null
        $books = $null
        return $connection
      } catch { $lastFailure = $_.Exception.Message }
      finally {
        Release-DailyDataOpenCom $books
        Release-DailyDataOpenCom $application
        Release-DailyDataOpenCom $nativeObject
      }
    }
    if ($attachAttempt -eq 0) { Start-Sleep -Milliseconds 200 }
  }
  throw ('Excel PID ' + $ProcessId + '의 열린 파일을 확인하지 못했습니다. ' + $lastFailure +
    ' 셀 입력을 마치고 Excel 대화상자 또는 조회 작업이 끝난 뒤 다시 눌러 주세요.')
}

function Resolve-DailyDataOpenWorkbook {
  [CmdletBinding()]
  param([Parameter(Mandatory=$true)][string]$TargetDate)
  $expectedName = Get-DailyDataExpectedWorkbookName -TargetDate $TargetDate
  Initialize-DailyDataNativeOm
  $sessionProcess = [System.Diagnostics.Process]::GetCurrentProcess()
  try { $sessionId = [int]$sessionProcess.SessionId } finally { $sessionProcess.Dispose() }
  $connections = New-Object System.Collections.Generic.List[object]
  $retainedWorkbooks = New-Object System.Collections.Generic.List[object]
  $candidates = New-Object System.Collections.Generic.List[object]
  $observedIds = New-Object System.Collections.Generic.List[int]
  $errors = New-Object System.Collections.Generic.List[string]
  $warnings = New-Object System.Collections.Generic.List[string]
  $skippedIds = New-Object System.Collections.Generic.List[int]
  $windowTitles = New-Object System.Collections.Generic.List[string]
  $selected = $null
  $success = $false
  $processes = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue)
  try {
    foreach ($excelProcess in $processes) {
      if ([int]$excelProcess.SessionId -ne $sessionId) { continue }
      $processId = [int]$excelProcess.Id
      $observedIds.Add($processId)
      $processTitles = @([GsDailyDataOpenWorkbookNativeOmV1]::FindProcessWindowTitles($processId))
      foreach ($title in $processTitles) { $windowTitles.Add($title) }
      $expectedTitlePattern = '(?i)' + [regex]::Escape([IO.Path]::GetFileNameWithoutExtension($expectedName)) + '(?:\.xlsx)?(?:\s|$)'
      $targetTitleSeen = @($processTitles | Where-Object { ([string]$_).Normalize([Text.NormalizationForm]::FormC) -match $expectedTitlePattern }).Count -gt 0
      try {
        $startTicks = [long]$excelProcess.StartTime.ToUniversalTime().Ticks
        $connection = Get-DailyDataProcessConnection -ProcessId $processId
        $connections.Add($connection)
        # One Workbooks scan per application PID, irrespective of SDI window count.
        $countBefore = [int](Invoke-DailyDataComRead -Read { $connection.Workbooks.Count } -Label '통합문서 수 확인')
        for ($bookIndex = 1; $bookIndex -le $countBefore; $bookIndex += 1) {
          $book = $null
          try {
            $book = Invoke-DailyDataComRead -Read { ,$connection.Workbooks.Item($bookIndex) } -Label '열린 통합문서 확인'
            $name = [string](Invoke-DailyDataComRead -Read { $book.Name } -Label '통합문서 이름 확인')
            $fullName = [string](Invoke-DailyDataComRead -Read { $book.FullName } -Label '통합문서 경로 확인')
            $record = [pscustomobject]@{ Name=$name; FullName=$fullName; ProcessId=$processId; Workbook=$null; Connection=$connection }
            if ([string]::Equals($name.Normalize([Text.NormalizationForm]::FormC), $expectedName, [StringComparison]::OrdinalIgnoreCase)) {
              $record.Workbook = $book
              $retainedWorkbooks.Add($book)
              $book = $null
            }
            $candidates.Add($record)
          } finally { Release-DailyDataOpenCom $book }
        }
        $countAfter = [int](Invoke-DailyDataComRead -Read { $connection.Workbooks.Count } -Label '통합문서 목록 변경 확인')
        if ($countBefore -ne $countAfter) { throw '조회 중 열린 통합문서 목록이 변경되었습니다. 다시 조회해 주세요.' }
        $excelProcess.Refresh()
        if ($excelProcess.HasExited -or [long]$excelProcess.StartTime.ToUniversalTime().Ticks -ne $startTicks) {
          throw '조회 중 Excel 인스턴스가 종료되거나 변경되었습니다. 다시 조회해 주세요.'
        }
      } catch {
        $knownTarget = @($candidates | Where-Object {
          $_.ProcessId -eq $processId -and [string]::Equals(
            ([string]$_.Name).Normalize([Text.NormalizationForm]::FormC), $expectedName, [StringComparison]::OrdinalIgnoreCase)
        }).Count -gt 0
        if ($targetTitleSeen -or $knownTarget) {
          $errors.Add($_.Exception.Message)
        } else {
          # A headless/background PDF Excel must not prevent reading a confirmed
          # target in a separate user instance. Keep the incomplete scan explicit.
          $warnings.Add($_.Exception.Message)
          $skippedIds.Add($processId)
        }
      }
    }
    # An uninspectable window naming this target is a busy target, never a reason
    # to use another month or another potentially duplicate target instance.
    if ($errors.Count -gt 0) { throw ($errors -join ' / ') }
    $selected = Select-DailyDataWorkbookMatch -Candidates $candidates.ToArray() -ExpectedWorkbookName $expectedName
    if ($null -eq $selected) {
      $openNames = @($candidates | ForEach-Object { $_.Name } | Select-Object -Unique)
      $allOpenLabels = @($openNames) + @($windowTitles.ToArray())
      $openText = if ($allOpenLabels.Count -gt 0) { ($allOpenLabels | Select-Object -Unique) -join ', ' } else { '없음' }
      throw ('조회일 ' + $TargetDate + '에 필요한 ' + $expectedName +
        '를 현재 열린 Excel에서 찾지 못했습니다. 해당 월 원본 파일을 열거나 이미 열려 있다면 그 창을 한 번 선택하고, 셀 입력/대화상자를 마친 뒤 다시 조회해 주세요. 현재 열린 파일/창: ' + $openText)
    }
    # Recheck the selected identity immediately before transferring COM ownership.
    $currentName = [string](Invoke-DailyDataComRead -Read { $selected.Workbook.Name } -Label '대상 파일 이름 재확인')
    $currentFullName = [string](Invoke-DailyDataComRead -Read { $selected.Workbook.FullName } -Label '대상 파일 경로 재확인')
    if (-not [string]::Equals($currentName.Normalize([Text.NormalizationForm]::FormC), $expectedName, [StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals($currentFullName, [string]$selected.FullName, [StringComparison]::OrdinalIgnoreCase)) {
      throw '조회 중 대상 파일 이름이나 경로가 변경되었습니다. 다시 조회해 주세요.'
    }
    $result = [pscustomobject]@{
      Excel=$selected.Connection.Excel; Workbooks=$selected.Connection.Workbooks; Workbook=$selected.Workbook
      ProcessId=[int]$selected.ProcessId; WorkbookName=$currentName; WorkbookFullName=$currentFullName
      OpenWorkbookNames=@($candidates | ForEach-Object { $_.Name } | Select-Object -Unique)
      ObservedProcessIds=$observedIds.ToArray(); ConnectionMethod=$selected.Connection.Via
      ExpectedWorkbookName=$expectedName
      DiscoveryWarnings=$warnings.ToArray(); SkippedProcessIds=$skippedIds.ToArray(); OpenWindowTitles=$windowTitles.ToArray()
    }
    $success = $true
    return $result
  } finally {
    foreach ($book in $retainedWorkbooks) {
      if ($success -and [object]::ReferenceEquals($book, $selected.Workbook)) { continue }
      Release-DailyDataOpenCom $book
    }
    foreach ($connection in $connections) {
      if ($success -and [object]::ReferenceEquals($connection, $selected.Connection)) { continue }
      Release-DailyDataOpenCom $connection.Workbooks
      Release-DailyDataOpenCom $connection.Excel
    }
    foreach ($excelProcess in $processes) { $excelProcess.Dispose() }
  }
}

function Assert-DailyDataOpenWorkbookSelector {
  $dateCases = @(
    @('2026-08-31', '26.08-일일DATA관리.xlsx'), @('2026-09-01', '26.09-일일DATA관리.xlsx'),
    @('2026-12-31', '26.12-일일DATA관리.xlsx'), @('2027-01-01', '27.01-일일DATA관리.xlsx'),
    @('2028-02-29', '28.02-일일DATA관리.xlsx')
  )
  foreach ($dateCase in $dateCases) {
    if ((Get-DailyDataExpectedWorkbookName $dateCase[0]) -cne $dateCase[1]) { throw '월 파일 이름 자체 검사 실패' }
  }
  foreach ($invalid in @('2026-9-01','2026-02-29','2026-09-31','invalid','1926-09-01','2126-09-01')) {
    $didThrow = $false
    try { $null = Get-DailyDataExpectedWorkbookName $invalid } catch { $didThrow = $true }
    if (-not $didThrow) { throw ('잘못된 날짜 허용: ' + $invalid) }
  }
  $script:DailyDataValidationReadAttempts = 0
  $retriedValue = Invoke-DailyDataComRead -Read {
    $script:DailyDataValidationReadAttempts += 1
    if ($script:DailyDataValidationReadAttempts -lt 3) {
      throw (New-Object Runtime.InteropServices.COMException -ArgumentList @('validation busy', -2147418111))
    }
    return 42
  }
  if ($retriedValue -ne 42 -or $script:DailyDataValidationReadAttempts -ne 3) { throw 'COM busy 재시도 검사 실패' }
  $script:DailyDataValidationReadAttempts = 0
  $readDidThrow = $false
  try {
    $null = Invoke-DailyDataComRead -Read {
      $script:DailyDataValidationReadAttempts += 1
      throw (New-Object ArgumentException -ArgumentList 'validation permanent failure')
    }
  } catch { $readDidThrow = $true }
  if (-not $readDidThrow -or $script:DailyDataValidationReadAttempts -ne 1) { throw '영구 COM 오류의 불필요한 재시도 허용' }
  Remove-Variable -Name DailyDataValidationReadAttempts -Scope Script
  $expected = Get-DailyDataExpectedWorkbookName '2026-09-01'
  $august = [pscustomobject]@{ Name='26.08-일일DATA관리.xlsx'; FullName='W:\2026\26.08-일일DATA관리.xlsx'; ProcessId=101 }
  $september = [pscustomobject]@{ Name=$expected; FullName=('W:\2026\' + $expected); ProcessId=202 }
  $pdf = [pscustomobject]@{ Name='PDF 임시.xlsx'; FullName='C:\Temp\PDF 임시.xlsx'; ProcessId=303 }
  $lookalike = [pscustomobject]@{ Name='26.09-일일DATA관리(1).xlsx'; FullName='C:\Downloads\26.09-일일DATA관리(1).xlsx'; ProcessId=404 }
  $found = Select-DailyDataWorkbookMatch @($august,$pdf,$lookalike,$september) $expected
  if ($found.ProcessId -ne 202) { throw '월 변경/다중 Excel/PDF 분리 검사 실패' }
  if ($null -ne (Select-DailyDataWorkbookMatch @($august,$pdf,$lookalike) $expected)) { throw '다른 월/복사본 대체 선택 허용' }
  if ((Select-DailyDataWorkbookMatch @($september,$september) $expected).ProcessId -ne 202) { throw '동일 PID/경로 중복 제거 실패' }
  $decomposed = [pscustomobject]@{ Name=$expected.Normalize([Text.NormalizationForm]::FormD); FullName=$september.FullName; ProcessId=202 }
  if ((Select-DailyDataWorkbookMatch @($decomposed) $expected).ProcessId -ne 202) { throw '한글 유니코드 정규화 검사 실패' }
  foreach ($ambiguous in @(
      [pscustomobject]@{ Name=$expected; FullName=('C:\Downloads\' + $expected); ProcessId=404 },
      [pscustomobject]@{ Name=$expected; FullName=$september.FullName; ProcessId=505 }
    )) {
    $didThrow = $false
    try { $null = Select-DailyDataWorkbookMatch @($september,$ambiguous) $expected } catch { $didThrow = $true }
    if (-not $didThrow) { throw '같은 이름/다른 경로 또는 인스턴스의 모호성 허용' }
  }
}

if ($ValidateOnly) {
  $parseTokens = $null
  $parseErrors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$parseTokens, [ref]$parseErrors)
  if (@($parseErrors).Count -gt 0) { throw ($parseErrors | Out-String) }
  Initialize-DailyDataNativeOm
  Assert-DailyDataOpenWorkbookSelector
  [Console]::WriteLine('PASS: 열린 월간 Excel 연결 코드 구문/C# 및 월 전환·파일 선택 검사. Excel에 연결하지 않았습니다.')
}
