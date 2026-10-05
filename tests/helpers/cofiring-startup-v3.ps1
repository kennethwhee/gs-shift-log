$ErrorActionPreference = 'Stop'
$trialWorker = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'))
$tokens = $null; $errors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseFile($trialWorker, [ref]$tokens, [ref]$errors)
if (@($errors).Count) { throw ($errors | Out-String) }
$functions = @($tree.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'New-CofiringDocumentSeed'}, $true))
if ($functions.Count -ne 1) { throw 'Seed function not unique.' }
Invoke-Expression $functions[0].Extent.Text
$trialTestDirectory = Join-Path ([IO.Path]::GetTempPath()) ('cofiring-seed-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($trialTestDirectory)
try {
  $id = '0123456789abcdef0123456789abcdef'
  $seed = New-CofiringDocumentSeed $trialTestDirectory $id
  $originalHash = (Get-FileHash -LiteralPath $seed -Algorithm SHA256).Hash
  $caught = $false
  try { New-CofiringDocumentSeed $trialTestDirectory $id | Out-Null } catch { $caught = $true }
  if (-not $caught -or (Get-FileHash -LiteralPath $seed -Algorithm SHA256).Hash -cne $originalHash) { throw 'Existing file protection failed.' }
  foreach ($bad in @('', '../outside', '0123', '0123456789abcdef0123456789abcdef/')) {
    $caught = $false
    try { New-CofiringDocumentSeed $trialTestDirectory $bad | Out-Null } catch { $caught = $true }
    if (-not $caught) { throw 'Invalid run ID accepted.' }
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($seed)
  try {
    $expected = @('[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/worksheets/sheet1.xml')
    if ($archive.Entries.Count -ne $expected.Count) { throw 'Unexpected OOXML part count.' }
    foreach ($entry in $archive.Entries) {
      if ($expected -cnotcontains $entry.FullName) { throw 'Unexpected OOXML part.' }
      $reader = New-Object IO.StreamReader($entry.Open())
      try { $xml = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
      if ($xml.SelectNodes('//*[local-name()="f" or local-name()="connection" or local-name()="externalLink"]').Count) { throw 'Active content in seed.' }
      if ($xml.SelectNodes('//*[@TargetMode="External"]').Count) { throw 'External relationship in seed.' }
    }
    $book = $archive.GetEntry('xl/workbook.xml')
    $reader = New-Object IO.StreamReader($book.Open())
    try { $xml = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($xml.SelectNodes('//*[local-name()="sheet"]').Count -ne 1) { throw 'Expected one sheet.' }
  } finally { $archive.Dispose() }
  Write-Host 'PASS: exact empty XLSX / no overwrite / invalid IDs rejected / no macros or external links.'
} finally { [IO.Directory]::Delete($trialTestDirectory, $true) }

# Execute the actual attachment loop with synthetic windows and processes.
# No COM, real window, process start or process termination is called.
$functions = @($tree.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Wait-OwnedProbeExcelNativeObject'}, $true))
if ($functions.Count -ne 1) { throw 'Attach function not unique.' }
Invoke-Expression $functions[0].Extent.Text
Add-Type -TypeDefinition @'
using System;
public static class GsBlowerRuntimeNativeOmV1 {
  public static int Calls = 0;
  public static int LastPid = 0;
  public static bool Document = true;
  public static IntPtr[] FindNativeObjectWindows(int pid) {
    LastPid = pid;
    return Document ? new IntPtr[] {new IntPtr(1),new IntPtr(2)} : new IntPtr[] {new IntPtr(1)};
  }
  public static string WindowClass(IntPtr hwnd) {return hwnd.ToInt32()==2 ? "EXCEL7" : "XLMAIN";}
  public static object GetNativeObject(IntPtr hwnd) {
    Calls++;
    if (hwnd.ToInt32()!=2) throw new Exception("XLMAIN must never receive NativeOM");
    return new object();
  }
}
'@
$ownedExcelSessionId = 7; $excelAttachAttempt = 1; $script:testApplicationPid = 42
$script:testUnexpected = $false; $script:releases = 0
function Get-Process {
  param($Name, $Id, $ErrorAction)
  if ($script:testUnexpected -and $Name) { [pscustomobject]@{Id=999;SessionId=7} }
  [pscustomobject]@{Id=42;SessionId=7}
}
function Start-CofiringNativeOmSpan { return 1 }
function Complete-CofiringNativeOmSpan { }
function Get-CofiringNativeOmGraceDelay { return 0 }
function Get-CofiringExcelProperty { return [pscustomobject]@{Value=[pscustomobject]@{Id=$script:testApplicationPid}} }
function Get-ProbeExcelProcessId($Application) { return $Application.Id }
function Release-ProbeCom { $script:releases++ }
function Start-Sleep { }
function Assert-CofiringNotCancelled { }
$app = Wait-OwnedProbeExcelNativeObject 42 ([datetime]::UtcNow.AddSeconds(-1)) @()
if ($app.Id -ne 42 -or [GsBlowerRuntimeNativeOmV1]::Calls -ne 1 -or [GsBlowerRuntimeNativeOmV1]::LastPid -ne 42) { throw 'Document-only owned attach failed.' }
[GsBlowerRuntimeNativeOmV1]::Calls = 0; [GsBlowerRuntimeNativeOmV1]::Document = $false
$app = Wait-OwnedProbeExcelNativeObject 42 ([datetime]::UtcNow.AddSeconds(-1)) @()
if ($null -ne $app -or [GsBlowerRuntimeNativeOmV1]::Calls -ne 0) { throw 'Top-level window entered COM path.' }
[GsBlowerRuntimeNativeOmV1]::Document = $true; $script:testApplicationPid = 999; $script:releases = 0
$app = Wait-OwnedProbeExcelNativeObject 42 ([datetime]::UtcNow.AddSeconds(-1)) @()
if ($null -ne $app -or $script:releases -ne 2) { throw 'Foreign application rejection/release failed.' }
$script:testUnexpected = $true; $caught = $false
try { Wait-OwnedProbeExcelNativeObject 42 ([datetime]::UtcNow.AddSeconds(-1)) @() | Out-Null } catch { $caught = $true }
if (-not $caught) { throw 'Unexpected process guard failed.' }
Write-Host 'PASS: actual attach loop / EXCEL7 only / owned PID / foreign COM release / unexpected Excel rejection (synthetic).'
