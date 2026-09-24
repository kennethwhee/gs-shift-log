#Requires -Version 5.1
<#
Read-only discovery of an already-open monthly Daily DATA workbook.
Dot-source this file; call Resolve-DailyDataOpenWorkbook -TargetDate yyyy-MM-dd.
Every distinct Excel.Application exposed by every same-session NativeOM window is scanned.
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

public static class GsDailyDataOpenWorkbookNativeOmV2
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
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("oleacc.dll", PreserveSig = true)]
    private static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out object nativeObject);

    private static string WindowClass(IntPtr hwnd)
    {
        StringBuilder result = new StringBuilder(256);
        return GetClassName(hwnd, result, result.Capacity) > 0 ? result.ToString() : "";
    }

    public static bool IsWorkbookWindow(IntPtr hwnd)
    {
        return String.Equals(WindowClass(hwnd), "EXCEL7", StringComparison.OrdinalIgnoreCase);
    }

    public static string GetRootWindowTitle(IntPtr hwnd)
    {
        IntPtr root = GetAncestor(hwnd, 2);
        if (root == IntPtr.Zero) root = hwnd;
        StringBuilder title = new StringBuilder(1024);
        return GetWindowText(root, title, title.Capacity) > 0 ? title.ToString() : "";
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
  if (-not ('GsDailyDataOpenWorkbookNativeOmV2' -as [type])) {
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
    $connectionIdentity = ''
    $connectionIdentityProperty = $candidate.PSObject.Properties['ConnectionIdentity']
    if ($null -ne $connectionIdentityProperty) { $connectionIdentity = [string]$connectionIdentityProperty.Value }
    if ([string]::IsNullOrWhiteSpace($connectionIdentity)) {
      $connectionIdentity = 'PID:' + [string]$candidate.ProcessId
    }
    $identity = $connectionIdentity + '|' +
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
  [void][GsDailyDataOpenWorkbookNativeOmV2]::GetWindowThreadProcessId($applicationHwnd, [ref]$applicationPid)
  return [int]$applicationPid
}

function Get-DailyDataComIdentity {
  param([Parameter(Mandatory=$true)]$Value)
  $unknown = [IntPtr]::Zero
  try {
    # COM identity is stable across the different EXCEL7 NativeOM wrappers that
    # expose the same Excel.Application. The call adds one IUnknown reference.
    $unknown = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($Value)
    if ($unknown -eq [IntPtr]::Zero) { throw 'COM identity를 확인하지 못했습니다.' }
    return ('IUnknown:' + $unknown.ToInt64().ToString('X16', [Globalization.CultureInfo]::InvariantCulture))
  } finally {
    if ($unknown -ne [IntPtr]::Zero) { [void][Runtime.InteropServices.Marshal]::Release($unknown) }
  }
}

function Get-DailyDataProcessConnections {
  param([Parameter(Mandatory=$true)][int]$ProcessId, $DiscoveryState = $null)
  $lastFailure = '읽을 수 있는 Excel 창을 찾지 못했습니다.'
  for ($attachAttempt = 0; $attachAttempt -lt 2; $attachAttempt += 1) {
    $connections = New-Object System.Collections.Generic.List[object]
    $attachFailures = New-Object System.Collections.Generic.List[object]
    $seenApplications = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $windows = @([GsDailyDataOpenWorkbookNativeOmV2]::FindNativeObjectWindows($ProcessId))
    foreach ($nativeHwnd in $windows) {
      $nativeObject = $null
      $application = $null
      $books = $null
      $applicationIdentity = ''
      try {
        $nativeObject = [GsDailyDataOpenWorkbookNativeOmV2]::GetNativeObject($nativeHwnd)
        if ($null -eq $nativeObject) { throw 'NativeOM 개체를 확인하지 못했습니다.' }
        $application = Invoke-DailyDataComRead -Read { $nativeObject.Application } -Label 'Excel Application 연결'
        if ($null -eq $application -or (Get-DailyDataExcelProcessId $application) -ne $ProcessId) { throw 'NativeOM Excel PID 검증에 실패했습니다.' }
        $applicationIdentity = Get-DailyDataComIdentity -Value $application
        if ($seenApplications.Contains($applicationIdentity)) { continue }
        $books = Invoke-DailyDataComRead -Read { ,$application.Workbooks } -Label '열린 통합문서 목록'
        if ($null -eq $books) { throw 'NativeOM Workbooks 목록을 확인하지 못했습니다.' }
        if (-not $seenApplications.Add($applicationIdentity)) { continue }
        $connection = [pscustomobject]@{
          Excel=$application; Workbooks=$books; ProcessId=$ProcessId; Via='NativeOM'
          Identity=$applicationIdentity; NativeHwnd=[int64]$nativeHwnd
        }
        $connections.Add($connection)
        $application = $null
        $books = $null
      } catch {
        $lastFailure = $_.Exception.Message
        # XLMAIN often does not support NativeOM; only real workbook-window
        # failures are actionable when other connections in this PID succeeded.
        if ([GsDailyDataOpenWorkbookNativeOmV2]::IsWorkbookWindow($nativeHwnd)) {
          $attachFailures.Add([pscustomobject]@{
            NativeHwnd=[int64]$nativeHwnd; ApplicationIdentity=$applicationIdentity
            RootTitle=[GsDailyDataOpenWorkbookNativeOmV2]::GetRootWindowTitle($nativeHwnd)
            Message=('Excel PID ' + $ProcessId + ' / HWND ' + [int64]$nativeHwnd + ': ' + $lastFailure)
          })
        }
      }
      finally {
        Release-DailyDataOpenCom $books
        Release-DailyDataOpenCom $application
        Release-DailyDataOpenCom $nativeObject
      }
    }
    if ($connections.Count -gt 0) {
      if ($null -ne $DiscoveryState) {
        foreach ($attachFailure in $attachFailures) {
          if ($attachFailure.ApplicationIdentity -and $seenApplications.Contains($attachFailure.ApplicationIdentity)) { continue }
          $DiscoveryState.Failures.Add($attachFailure)
        }
      }
      return $connections.ToArray()
    }
    if ($attachAttempt -eq 0) { Start-Sleep -Milliseconds 200 }
  }
  throw ('Excel PID ' + $ProcessId + '의 열린 파일을 확인하지 못했습니다. ' + $lastFailure +
    ' 셀 입력을 마치고 Excel 대화상자 또는 조회 작업이 끝난 뒤 다시 눌러 주세요.')
}

function Get-DailyDataWorkbookCandidatesFromConnection {
  param(
    [Parameter(Mandatory=$true)]$Connection,
    [Parameter(Mandatory=$true)][string]$ExpectedWorkbookName,
    [Parameter(Mandatory=$true)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$RetainedWorkbooks,
    $ScanState = $null
  )
  $records = New-Object System.Collections.Generic.List[object]
  $countBefore = [int](Invoke-DailyDataComRead -Read { $Connection.Workbooks.Count } -Label '통합문서 수 확인')
  for ($bookIndex = 1; $bookIndex -le $countBefore; $bookIndex += 1) {
    $book = $null
    try {
      $book = Invoke-DailyDataComRead -Read { ,$Connection.Workbooks.Item($bookIndex) } -Label '열린 통합문서 확인'
      $name = [string](Invoke-DailyDataComRead -Read { $book.Name } -Label '통합문서 이름 확인')
      $isTarget = [string]::Equals($name.Normalize([Text.NormalizationForm]::FormC), $ExpectedWorkbookName, [StringComparison]::OrdinalIgnoreCase)
      # Retain evidence even if a later FullName/Count read fails before records return.
      if ($isTarget -and $null -ne $ScanState) { $ScanState.TargetObserved = $true }
      $fullName = [string](Invoke-DailyDataComRead -Read { $book.FullName } -Label '통합문서 경로 확인')
      $record = [pscustomobject]@{
        Name=$name; FullName=$fullName; ProcessId=[int]$Connection.ProcessId
        Workbook=$null; Connection=$Connection; ConnectionIdentity=[string]$Connection.Identity
      }
      if ($isTarget) {
        $record.Workbook = $book
        $RetainedWorkbooks.Add($book)
        $book = $null
      }
      $records.Add($record)
    } finally { Release-DailyDataOpenCom $book }
  }
  $countAfter = [int](Invoke-DailyDataComRead -Read { $Connection.Workbooks.Count } -Label '통합문서 목록 변경 확인')
  if ($countBefore -ne $countAfter) { throw '조회 중 열린 통합문서 목록이 변경되었습니다. 다시 조회해 주세요.' }
  return $records.ToArray()
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
      $processId = [int]$excelProcess.Id
      $targetTitleSeen = $false
      try {
        if ([int]$excelProcess.SessionId -ne $sessionId) { continue }
        $observedIds.Add($processId)
        $processTitles = @([GsDailyDataOpenWorkbookNativeOmV2]::FindProcessWindowTitles($processId))
        foreach ($title in $processTitles) { $windowTitles.Add($title) }
        $expectedTitlePattern = '(?i)' + [regex]::Escape([IO.Path]::GetFileNameWithoutExtension($expectedName)) + '(?:\.xlsx)?(?::[0-9]+)?(?:\s|$)'
        $targetTitleSeen = @($processTitles | Where-Object { ([string]$_).Normalize([Text.NormalizationForm]::FormC) -match $expectedTitlePattern }).Count -gt 0
        $startTicks = [long]$excelProcess.StartTime.ToUniversalTime().Ticks
        $discoveryState = [pscustomobject]@{ Failures=(New-Object System.Collections.Generic.List[object]) }
        $processConnections = @(Get-DailyDataProcessConnections -ProcessId $processId -DiscoveryState $discoveryState)
        # Transfer every acquired connection to the outer cleanup owner before
        # inspecting any of them, so a failure cannot strand later COM references.
        foreach ($connection in @($processConnections)) { $connections.Add($connection) }
        foreach ($attachFailure in $discoveryState.Failures) {
          $failureNamesTarget = ([string]$attachFailure.RootTitle).Normalize([Text.NormalizationForm]::FormC) -match $expectedTitlePattern
          if ($failureNamesTarget) { $errors.Add($attachFailure.Message) }
          else {
            $warnings.Add($attachFailure.Message)
            if (-not $skippedIds.Contains($processId)) { $skippedIds.Add($processId) }
          }
        }
        foreach ($connection in @($processConnections)) {
          $scanState = [pscustomobject]@{ TargetObserved=$false }
          try {
            $connectionCandidates = @(Get-DailyDataWorkbookCandidatesFromConnection `
              -Connection $connection -ExpectedWorkbookName $expectedName -RetainedWorkbooks $retainedWorkbooks -ScanState $scanState)
            foreach ($record in $connectionCandidates) { $candidates.Add($record) }
          } catch {
            $knownTargetInConnection = [bool]$scanState.TargetObserved
            if ($targetTitleSeen -or $knownTargetInConnection) {
              $errors.Add($_.Exception.Message)
            } else {
              $warnings.Add($_.Exception.Message)
              if (-not $skippedIds.Contains($processId)) { $skippedIds.Add($processId) }
            }
          }
        }
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
  $script:DailyDataValidationCollection = New-Object Collections.ArrayList
  [void]$script:DailyDataValidationCollection.Add('first')
  [void]$script:DailyDataValidationCollection.Add('second')
  $roundTripCollection = Invoke-DailyDataComRead -Read { ,$script:DailyDataValidationCollection }
  if (-not [object]::ReferenceEquals($roundTripCollection, $script:DailyDataValidationCollection) -or
      $roundTripCollection.Count -ne 2) { throw 'COM 컬렉션 비열거 왕복 검사 실패' }
  Remove-Variable -Name DailyDataValidationCollection -Scope Script
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

  function New-DailyDataValidationBooks([object[]]$Items) {
    $collection = [pscustomobject]@{ Entries=@($Items) }
    Add-Member -InputObject $collection -MemberType ScriptProperty -Name Count -Value { @($this.Entries).Count }
    Add-Member -InputObject $collection -MemberType ScriptMethod -Name Item -Value {
      param([int]$Index)
      if ($Index -lt 1 -or $Index -gt @($this.Entries).Count) { throw 'validation index out of range' }
      return $this.Entries[$Index - 1]
    }
    return $collection
  }
  $cofiring = [pscustomobject]@{
    Name='혼소율계산(Coal, Bio, 슬러지)_26.07.21.xlsx'; FullName='W:\2026\혼소율계산.xlsx'
  }
  $daily = [pscustomobject]@{ Name=$expected; FullName=$september.FullName }
  $firstConnection = [pscustomobject]@{
    ProcessId=19404; Identity='validation:first'; Workbooks=(New-DailyDataValidationBooks @($cofiring)); Excel=$null; Via='Validation'
  }
  $laterConnection = [pscustomobject]@{
    ProcessId=19404; Identity='validation:later'; Workbooks=(New-DailyDataValidationBooks @($daily)); Excel=$null; Via='Validation'
  }
  $validationRetained = New-Object System.Collections.Generic.List[object]
  $connectionCandidates = @()
  foreach ($validationConnection in @($firstConnection,$laterConnection)) {
    $connectionCandidates += @(Get-DailyDataWorkbookCandidatesFromConnection `
      -Connection $validationConnection -ExpectedWorkbookName $expected -RetainedWorkbooks $validationRetained)
  }
  $laterFound = Select-DailyDataWorkbookMatch -Candidates $connectionCandidates -ExpectedWorkbookName $expected
  if ($null -eq $laterFound -or [string]$laterFound.ConnectionIdentity -cne 'validation:later') {
    throw '같은 PID의 뒤쪽 NativeOM 연결 대상 선택 검사 실패'
  }
  $duplicateConnection = [pscustomobject]@{
    ProcessId=19404; Identity='validation:duplicate'; Workbooks=(New-DailyDataValidationBooks @($daily)); Excel=$null; Via='Validation'
  }
  $duplicateCandidates = @(Get-DailyDataWorkbookCandidatesFromConnection `
    -Connection $duplicateConnection -ExpectedWorkbookName $expected -RetainedWorkbooks $validationRetained)
  $didThrow = $false
  try { $null = Select-DailyDataWorkbookMatch @($connectionCandidates + $duplicateCandidates) $expected } catch { $didThrow = $true }
  if (-not $didThrow) { throw '같은 PID의 서로 다른 Excel 연결 중복 대상 허용' }

  # Finding the target name before a later COM failure must remain a blocking
  # target error; it must not silently permit another potentially duplicate file.
  $failingDaily = [pscustomobject]@{ Name=$expected }
  Add-Member -InputObject $failingDaily -MemberType ScriptProperty -Name FullName -Value { throw 'validation path failure' }
  $failingConnection = [pscustomobject]@{
    ProcessId=19404; Identity='validation:failure'; Workbooks=(New-DailyDataValidationBooks @($failingDaily))
  }
  $failureState = [pscustomobject]@{ TargetObserved=$false }
  $didThrow = $false
  try {
    $null = Get-DailyDataWorkbookCandidatesFromConnection -Connection $failingConnection `
      -ExpectedWorkbookName $expected -RetainedWorkbooks $validationRetained -ScanState $failureState
  } catch { $didThrow = $true }
  if (-not $failureState.TargetObserved) { throw '실패 전 확인한 대상 파일 증거 누락' }
}

if ($ValidateOnly) {
  $parseTokens = $null
  $parseErrors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$parseTokens, [ref]$parseErrors)
  if (@($parseErrors).Count -gt 0) { throw ($parseErrors | Out-String) }
  Initialize-DailyDataNativeOm
  Assert-DailyDataOpenWorkbookSelector
  [Console]::WriteLine('PASS: 모든 NativeOM 연결 순회 코드 구문/C# 및 월 전환·뒤쪽 연결 파일 선택 검사. Excel에 연결하지 않았습니다.')
}

# [COFIRING_ORGANIC_HIDDEN_EXCEL_V1]
# Closed monthly Daily DATA fallback for co-firing organic auto-fill.
# Existing open-workbook resolution always runs first.
# Fallback opens exactly one matching recent workbook in a new hidden,
# read-only Excel instance and closes only that owned instance later.

if (-not (Get-Variable -Scope Script -Name CofiringOrganicOriginalResolve -ErrorAction SilentlyContinue)) {
    $script:CofiringOrganicOriginalResolve = ${function:Resolve-DailyDataOpenWorkbook}
}
if (-not (Get-Variable -Scope Script -Name CofiringOrganicOriginalRelease -ErrorAction SilentlyContinue)) {
    $script:CofiringOrganicOriginalRelease = ${function:Release-ExcelComObject}
}
$script:CofiringOrganicOwnedExcelHwnd = 0

function Get-CofiringOrganicExcelRecentTargets {
    param([Parameter(Mandatory=$true)][string]$ExpectedName)

    $targets = New-Object 'System.Collections.Generic.List[string]'

    $officeRoot = 'HKCU:\Software\Microsoft\Office'
    if (Test-Path $officeRoot) {
        foreach ($version in @(Get-ChildItem $officeRoot -ErrorAction SilentlyContinue)) {
            $mru = Join-Path $version.PSPath 'Excel\File MRU'
            if (-not (Test-Path $mru)) { continue }
            try {
                $props = Get-ItemProperty $mru
                foreach ($prop in $props.PSObject.Properties) {
                    if ($prop.Name -notmatch '^Item ') { continue }
                    $value = [string]$prop.Value
                    $value = [regex]::Replace($value, '^\[[^\]]+\]\*?', '').Trim('"')
                    if ([string]::IsNullOrWhiteSpace($value)) { continue }
                    try { $value = [IO.Path]::GetFullPath($value) } catch { continue }
                    if (
                        [string]::Equals([IO.Path]::GetFileName($value), $ExpectedName, [StringComparison]::OrdinalIgnoreCase) -and
                        (Test-Path -LiteralPath $value -PathType Leaf)
                    ) {
                        $targets.Add($value)
                    }
                }
            } catch {}
        }
    }

    $recent = Join-Path $env:APPDATA 'Microsoft\Windows\Recent'
    $shell = $null
    try {
        if (Test-Path -LiteralPath $recent -PathType Container) {
            $shell = New-Object -ComObject WScript.Shell
            foreach ($lnk in @(Get-ChildItem -LiteralPath $recent -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
                try {
                    $shortcut = $shell.CreateShortcut($lnk.FullName)
                    $target = [string]$shortcut.TargetPath
                    if (
                        $target -and
                        [string]::Equals([IO.Path]::GetFileName($target), $ExpectedName, [StringComparison]::OrdinalIgnoreCase) -and
                        (Test-Path -LiteralPath $target -PathType Leaf)
                    ) {
                        $targets.Add([IO.Path]::GetFullPath($target))
                    }
                } catch {}
            }
        }
    }
    finally {
        if ($shell) {
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) } catch {}
        }
    }

    return @($targets | Sort-Object -Unique)
}

function Get-CofiringOrganicExcelProcessId {
    param([Parameter(Mandatory=$true)]$Excel)
    try {
        if (-not ('CofiringOrganicExcelNativeV1' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CofiringOrganicExcelNativeV1 {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
        }
        $excelProcessId = [uint32]0
        [void][CofiringOrganicExcelNativeV1]::GetWindowThreadProcessId(
            [IntPtr]([int64]$Excel.Hwnd),
            [ref]$excelProcessId
        )
        return [int]$excelProcessId
    }
    catch { return 0 }
}

function Resolve-DailyDataOpenWorkbook {
    param([Parameter(Mandatory=$true)][string]$TargetDate)

    try {
        return (& $script:CofiringOrganicOriginalResolve -TargetDate $TargetDate)
    }
    catch {
        $openError = $_
    }

    if ($TargetDate -notmatch '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') {
        throw $openError
    }

    $targetValue = [datetime]::ParseExact(
        $TargetDate,
        'yyyy-MM-dd',
        [Globalization.CultureInfo]::InvariantCulture
    )
    $expectedName = (
        $targetValue.ToString('yy.MM', [Globalization.CultureInfo]::InvariantCulture) +
        '-일일DATA관리.xlsx'
    ).Normalize([Text.NormalizationForm]::FormC)

    $paths = @(Get-CofiringOrganicExcelRecentTargets -ExpectedName $expectedName)
    if ($paths.Count -eq 0) {
        throw (
            $openError.Exception.Message +
            ' 자동 숨김 열기도 시도했지만 최근 파일에서 ' +
            $expectedName +
            ' 경로를 찾지 못했습니다.'
        )
    }
    if ($paths.Count -ne 1) {
        throw (
            '같은 이름의 일일DATA 파일 경로가 여러 개 확인되어 자동으로 열지 않았습니다: ' +
            ($paths -join ', ')
        )
    }

    $excel = $null
    $workbooks = $null
    $workbook = $null
    try {
        Write-DailyDataStage -Message (
            '대상 월 파일이 닫혀 있어 숨김 Excel 읽기 전용 열기 · ' + $paths[0]
        )

        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $excel.ScreenUpdating = $false
        $excel.AskToUpdateLinks = $false
        $excel.EnableEvents = $false
        try { $excel.AutomationSecurity = 3 } catch {}

        $workbooks = $excel.Workbooks
        $workbook = $workbooks.Open($paths[0], 0, $true)

        $hwnd = 0
        try { $hwnd = [int]$excel.Hwnd } catch {}
        $script:CofiringOrganicOwnedExcelHwnd = $hwnd

        return [pscustomobject]@{
            Excel = $excel
            Workbooks = $workbooks
            Workbook = $workbook
            ProcessId = Get-CofiringOrganicExcelProcessId -Excel $excel
            OwnedByDailyDataReader = $true
            WorkbookSource = 'hidden_readonly'
        }
    }
    catch {
        if ($workbook) { try { $workbook.Close($false) } catch {} }
        if ($excel) { try { $excel.Quit() } catch {} }
        foreach ($value in @($workbook,$workbooks,$excel)) {
            if ($value) {
                try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) } catch {}
            }
        }
        $script:CofiringOrganicOwnedExcelHwnd = 0
        throw
    }
}

function Release-ExcelComObject {
    param($Value)

    if ($null -ne $Value -and $script:CofiringOrganicOwnedExcelHwnd -gt 0) {
        try {
            $valueHwnd = [int]$Value.Hwnd
            if ($valueHwnd -eq $script:CofiringOrganicOwnedExcelHwnd) {
                try { $Value.DisplayAlerts = $false } catch {}
                try { $Value.Quit() } catch {}
                $script:CofiringOrganicOwnedExcelHwnd = 0
            }
        } catch {}
    }

    & $script:CofiringOrganicOriginalRelease -Value $Value
}
# [COFIRING_ORGANIC_HIDDEN_EXCEL_V1_END]

