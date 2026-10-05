#Requires -Version 5.1
$ErrorActionPreference='Stop'
function Assert([bool]$Ok,[string]$Message) { if (-not $Ok) { throw $Message } }
$source=Get-Content -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'))) -Raw -Encoding UTF8
$tokens=$null; $errors=$null
$tree=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
Assert (@($errors).Count -eq 0) 'Worker parser error.'
foreach ($name in @('Assert-CofiringLoadExcelIdentity','Get-CofiringRegisteredDataParcState','Get-CofiringDataParcFileEvidence','Invoke-CofiringDataParcLoad','Get-CofiringExcelProperty','Invoke-CofiringExcelCall')) {
  $nodes=@($tree.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true))
  Assert ($nodes.Count -eq 1) ('Function count '+$name)
  Invoke-Expression $nodes[0].Extent.Text
}
$loader=$tree.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-CofiringDataParcLoad'},$true).Extent.Text
Assert (-not ($loader -match '\.Installed\s*=|\$Application\.AutomationSecurity\s*=|\$Application\.EnableEvents\s*=|VBProject|Application\.Run|RunAutoMacros\(')) 'Loader changes settings or invokes a guessed macro.'
Add-Type -TypeDefinition @'
using System;
public sealed class LoadAddin {
 public string Name {get;set;}
 public string FullName {get;set;}
 public bool Installed {get;set;}
 public bool OpenState;
 public bool BadGetter;
 public bool IsOpen {get {if(BadGetter)throw new Exception("synthetic state error");return OpenState;}}
}
public sealed class LoadAddins {
 public LoadAddin[] Entries;
 public int Count {get{return Entries.Length;}}
 public LoadAddin this[int i] {get{return Entries[i-1];}}
}
public sealed class LoadBook {
 public string FullName {get;set;}
 public bool IsAddin {get;set;}
 public int AutoCalls;
 public bool AutoFails;
 public void RunAutoMacros(int which) {if(which!=1)throw new Exception("wrong lifecycle");AutoCalls++;if(AutoFails)throw new Exception("synthetic Auto_Open failure");}
}
public sealed class LoadBooks {
 public LoadAddin Entry;
 public LoadBook Book=new LoadBook();
 public int Calls;
 public bool Fail;
 public bool KeepClosed;
 public bool SecurityArguments;
 public LoadBook Open(string path, object links, object readOnly) {
   Calls++;
   SecurityArguments=(Convert.ToInt32(links)==0 && (bool)readOnly);
   if(Fail)throw new Exception("synthetic Open failure");
   Entry.OpenState=!KeepClosed;
   Book.FullName=path;Book.IsAddin=true;return Book;
 }
}
public sealed class LoadApp {
 public int SecurityValue=1;
 public bool EventsValue=true;
 public int AutomationSecurity {get{return SecurityValue;}}
 public bool EnableEvents {get{return EventsValue;}}
 public LoadAddins AddIns {get;set;}
 public LoadBooks Workbooks {get;set;}
}
'@
function Test-OwnedProbeExcelIdentity { return $script:identity }
function Get-ProbeExcelProcessId { return $script:comPid }
function Write-ProbeStage { }
function Assert-CofiringNotCancelled { }
function Write-CofiringComTrace { }
function Get-CofiringReturnShape { return 'fake' }
function Get-CofiringExceptionInfo { return @{transient=$false;hresults=@()} }
function Release-ProbeCom($Value) { if ($null -ne $Value) { $script:released.Add($Value) } }
function Wait-OwnedProbeDataParcHost { if ($script:hostPresent) { return @{ProcessId=77} }; return $null }
function Start-CofiringWorkerPhase { }
function Complete-CofiringWorkerPhase { }
function Write-CofiringAddinRuntimeSnapshot { }
function New-ProbeHostSignature { $script:pinned=$true; return @{ProcessId=77} }
function Write-ProbeOwnership { }
$script:released=New-Object 'System.Collections.Generic.List[object]'
$root=Join-Path ([IO.Path]::GetTempPath()) ('cofiring-load-test-'+[guid]::NewGuid().ToString('N'))
$savedProgram=$env:ProgramFiles; $savedTrace=$env:GS_COFIRING_COM_TRACE_PATH; $savedRun=$env:GS_COFIRING_RUN_ID
try {
  $env:ProgramFiles=Join-Path $root 'ProgramFiles'
  $vendor=Join-Path $env:ProgramFiles 'Capstone\PARCView'
  [void][IO.Directory]::CreateDirectory($vendor)
  $xla=Join-Path $vendor 'DataPARC_AddIn.xla'
  [IO.File]::WriteAllText($xla,'synthetic bytes, never opened by Excel')
  $env:GS_COFIRING_COM_TRACE_PATH=Join-Path $root 'com-calls.jsonl'
  $env:GS_COFIRING_RUN_ID='0123456789abcdef0123456789abcdef'
  function New-App {
    $script:identity=$true; $script:comPid=42; $script:hostPresent=$false; $script:released.Clear()
    $a=New-Object LoadApp; $a.AddIns=New-Object LoadAddins; $a.Workbooks=New-Object LoadBooks
    $item=New-Object LoadAddin; $item.Name='DataPARC_AddIn.xla';$item.FullName=$xla;$item.Installed=$true
    $a.AddIns.Entries=@($item); $a.Workbooks.Entry=$item
    return $a
  }
  function Expect-Fail($App,[string]$Reason,[int]$Calls=0,[int]$AutoCalls=0) {
    $failed=$false
    try { Invoke-CofiringDataParcLoad $App 42 } catch { $failed=$true }
    Assert $failed ('Should fail: '+$Reason)
    Assert ($App.Workbooks.Calls -eq $Calls -and $App.Workbooks.Book.AutoCalls -eq $AutoCalls) ('Wrong call count: '+$Reason)
    $record=Get-Content -LiteralPath (Join-Path $root 'addin-load.json') -Raw | ConvertFrom-Json
    Assert ($record.status -eq 'FAILED' -and $record.error) ('Failure detail missing: '+$Reason)
  }
  $a=New-App; Invoke-CofiringDataParcLoad $a 42
  Assert ($a.Workbooks.Calls -eq 1 -and $a.Workbooks.SecurityArguments -and $a.Workbooks.Book.AutoCalls -eq 0) 'Open/lifecycle arguments or once-only semantics wrong.'
  Assert ($script:released.Contains($a.Workbooks) -and $script:released.Contains($a.Workbooks.Book) -and $script:released.Contains($a.AddIns)) 'Owned references leaked.'
  $record=Get-Content -LiteralPath (Join-Path $root 'addin-load.json') -Raw | ConvertFrom-Json
  Assert ($record.status -eq 'LOADED' -and -not $record.before.isOpen -and $record.after.isOpen -and $record.file.sha256.Length -eq 64) 'Load evidence incorrect.'
  $a=New-App; $a.Workbooks.Entry.OpenState=$true; Invoke-CofiringDataParcLoad $a 42
  Assert ($a.Workbooks.Calls -eq 0 -and $a.Workbooks.Book.AutoCalls -eq 0) 'Already open add-in reinitialized.'
  $a=New-App; $script:hostPresent=$true; Invoke-CofiringDataParcLoad $a 42
  Assert ($a.Workbooks.Calls -eq 1 -and $a.Workbooks.Book.AutoCalls -eq 0) 'Existing Host reinitialized.'
  $a=New-App; $script:identity=$false; Expect-Fail $a 'foreign identity'
  $a=New-App; $script:comPid=43; Expect-Fail $a 'foreign COM'
  $a=New-App; $a.SecurityValue=3; Expect-Fail $a 'macro disabled'
  $a=New-App; $a.EventsValue=$false; Expect-Fail $a 'events disabled'
  $a=New-App; $a.Workbooks.Entry.Installed=$false; Expect-Fail $a 'not installed'
  $a=New-App; $a.Workbooks.Entry.BadGetter=$true; Expect-Fail $a 'unknown IsOpen'
  $a=New-App; $a.Workbooks.Entry.FullName=Join-Path $root 'other.xla'; Expect-Fail $a 'wrong file'
  $a=New-App; $a.AddIns.Entries=@($a.Workbooks.Entry,$a.Workbooks.Entry); Expect-Fail $a 'ambiguous registration'
  $a=New-App; $a.Workbooks.Fail=$true; Expect-Fail $a 'Open exception' 1
  $a=New-App; $a.Workbooks.KeepClosed=$true; Expect-Fail $a 'still closed' 1
  Assert ($script:released.Contains($a.Workbooks.Book) -and $script:released.Contains($a.Workbooks)) 'Failed load leaked references.'
  Write-Host 'PASS: actual loader / exact installed file / security unchanged / one Open / no legacy initialization / no replay / already-ready skip / identity / release / failure detail (synthetic).'
  # Run the actual worker start sequence through its Host gate; no Excel or query.
  $s=$source.IndexOf("  Write-CofiringAddinRuntimeSnapshot `$excel `$ownedExcelPid 'before-host'")
  $e=$source.IndexOf("  [void](Invoke-CofiringExcelCall -Operation 'Application.EnableEvents=False'",$s)
  Assert ($s -gt 0 -and $e -gt $s) 'Actual load/Host block not found.'
  $block=$source.Substring($s,$e-$s)
  Assert ($block.Contains('AddSeconds(15)') -and $block.Contains('Invoke-CofiringDataParcLoad')) 'Host deadline/load missing.'
  $ownedExcelPid=42; $baselineExcelPids=@(11,12)
  $excel=New-App; $failed=$false; $script:pinned=$false
  try { Invoke-Expression $block } catch { $failed=$true }
  Assert ($failed -and -not $script:pinned) 'Absent Host passed query gate.'
  $excel=New-App; $script:hostPresent=$true; $script:pinned=$false
  Invoke-Expression $block
  Assert $script:pinned 'Ready Host ownership not pinned.'
  $excel=New-App; $excel.Workbooks.Fail=$true; $script:hostPresent=$true; $script:pinned=$false; $failed=$false
  try { Invoke-Expression $block } catch { $failed=$true }
  Assert ($failed -and -not $script:pinned) 'Load failure passed query gate.'
  Write-Host 'PASS: actual worker load/Host/query order / owned Host pin / 15-second Host gate.'
} finally {
  $env:ProgramFiles=$savedProgram; $env:GS_COFIRING_COM_TRACE_PATH=$savedTrace; $env:GS_COFIRING_RUN_ID=$savedRun
  [IO.Directory]::Delete($root,$true)
}
