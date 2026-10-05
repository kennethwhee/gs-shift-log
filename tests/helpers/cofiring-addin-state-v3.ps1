$ErrorActionPreference='Stop'
function Assert([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
$workerPath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'))
$source=Get-Content -LiteralPath $workerPath -Raw -Encoding UTF8
$tokens=$null; $parseErrors=$null
$tree=[Management.Automation.Language.Parser]::ParseFile($workerPath,[ref]$tokens,[ref]$parseErrors)
Assert (@($parseErrors).Count -eq 0) 'Worker parser errors.'
foreach ($name in @('Write-CofiringAddinRuntimeSnapshot','Test-CofiringDocumentSeedWorkbook','Get-CofiringExcelProperty')) {
  $nodes=@($tree.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true))
  Assert ($nodes.Count -eq 1) ('Function count: '+$name)
  Invoke-Expression $nodes[0].Extent.Text
}
$hostGate=$source.IndexOf('  $ownedHostSnapshot = New-ProbeHostSignature $ownedHostCim ')
$eventGate=$source.IndexOf("  [void](Invoke-CofiringExcelCall -Operation 'Application.EnableEvents=False'")
$closeStart=$source.IndexOf("  Start-CofiringWorkerPhase 'setupStartupWorkbookClose'")
$queryStart=$source.IndexOf("  Start-CofiringWorkerPhase 'setupQueryWorkbookAndFormulas'")
Assert ($hostGate -gt 0 -and $eventGate -gt $hostGate -and $closeStart -gt $eventGate -and $queryStart -gt $closeStart) 'Startup order did not defer event suppression/close until Host identity.'
Assert ($source.Substring($hostGate,$eventGate-$hostGate).Contains('Write-ProbeOwnership')) 'Host ownership not persisted before event suppression.'
Assert (-not $source.Contains('$excel.EnableEvents=$true')) 'Trial must not force-enable events.'

# Read-only add-in properties and real Get-CofiringExcelProperty reflection path.
Add-Type -TypeDefinition @'
using System;
public sealed class TrialAddin {
  public string Name {get {return "DataPARC_AddIn.xla";}}
  public string FullName {get {return "C:\\Program Files (x86)\\Capstone\\PARCView\\DataPARC_AddIn.xla";}}
  public bool FailInstalled;
  public bool FailIsOpen;
  public bool OpenState;
  public bool IsOpen {get {if(FailIsOpen) throw new Exception("synthetic IsOpen read error"); return OpenState;}}
  public bool Installed {get {if(FailInstalled) throw new Exception("synthetic Installed read error"); return true;}}
}
public sealed class TrialAddins {
  public int Count {get{return 1;}}
  public TrialAddin Entry = new TrialAddin();
  public TrialAddin this[int i] {get {if(i!=1) throw new Exception("bad index"); return Entry;}}
}
public sealed class TrialBook {
  public string FullName {get;set;}
  public bool IsAddin {get;set;}
  public int Closed;
  public bool SaveRequested;
  public void Close(bool save) {Closed++; SaveRequested=save;}
}
public sealed class TrialBooks {
  public TrialBook[] Entries;
  public int Count {get {return Entries.Length;}}
  public TrialBook Item(int i) {return Entries[i-1];}
}
public sealed class TrialApplication {
  public bool EnableEvents {get {return true;}}
  public int AutomationSecurity {get {return 1;}}
  public TrialBooks Workbooks {get;set;}
  public TrialAddins AddIns {get;set;}
}
'@
$script:released=New-Object 'System.Collections.Generic.List[object]'
function Release-ProbeCom($Value) { if ($null -ne $Value) { $script:released.Add($Value) } }
function Invoke-CofiringExcelCall {
  param($Operation,$Action,$TimeoutMilliseconds,$MaxAttempts,[switch]$NoRetry)
  $box=[pscustomobject]@{Value=$null}; & $Action $box; return $box
}
function Test-OwnedProbeExcelIdentity { return $script:identityOk }
function Get-ProbeExcelProcessId { return 42 }
function Write-ProbeStage { }
function Start-CofiringWorkerPhase { }
function Complete-CofiringWorkerPhase { }
$script:identityOk=$true
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('cofiring-addin-v2-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$oldTrace=$env:GS_COFIRING_COM_TRACE_PATH; $oldRun=$env:GS_COFIRING_RUN_ID
try {
  $env:GS_COFIRING_COM_TRACE_PATH=Join-Path $testRoot 'com-calls.jsonl'
  $env:GS_COFIRING_RUN_ID='0123456789abcdef0123456789abcdef'
  $documentSeedPath=Join-Path $testRoot 'cofiring-document-seed.xlsx'
  $seed=New-Object TrialBook; $seed.FullName=$documentSeedPath
  $other=New-Object TrialBook; $other.FullName=Join-Path $testRoot 'other.xlsx'
  $addinBook=New-Object TrialBook; $addinBook.IsAddin=$true
  $books=New-Object TrialBooks; $books.Entries=@($seed,$other,$addinBook)
  $excel=New-Object TrialApplication; $excel.Workbooks=$books; $excel.AddIns=New-Object TrialAddins
  Write-CofiringAddinRuntimeSnapshot $excel 42 'before-host'
  $snap=Get-Content -LiteralPath (Join-Path $testRoot 'addin-runtime-before-host.json') -Raw | ConvertFrom-Json
  Assert ($snap.errors.Count -eq 0 -and $snap.dataPARC.Count -eq 1 -and $snap.dataPARC[0].installed -eq $true) 'Runtime add-in registration snapshot failed.'
  Assert ($snap.dataPARC[0].isOpen -is [bool] -and -not $snap.dataPARC[0].isOpen) 'Installed=true must not become IsOpen=true.'
  Assert ($snap.enableEvents -eq $true -and $snap.workbookCount -eq 3 -and $snap.ownedExcelPid -eq 42) 'Runtime app state/identity missing.'
  Assert ($script:released.Contains($excel.AddIns) -and $script:released.Contains($excel.AddIns.Entry) -and $script:released.Contains($books)) 'Diagnostic COM references not released.'
  $excel.AddIns.Entry.FailInstalled=$true
  Write-CofiringAddinRuntimeSnapshot $excel 42 'host-not-ready'
  $snap=Get-Content -LiteralPath (Join-Path $testRoot 'addin-runtime-host-not-ready.json') -Raw | ConvertFrom-Json
  Assert ($null -eq $snap.dataPARC[0].installed -and $snap.dataPARC[0].errors.Count -eq 1) 'Partial diagnostic failure lost or misreported.'
  $excel.AddIns.Entry.FailInstalled=$false; $excel.AddIns.Entry.OpenState=$true
  Write-CofiringAddinRuntimeSnapshot $excel 42 'host-ready'
  $snap=Get-Content -LiteralPath (Join-Path $testRoot 'addin-runtime-host-ready.json') -Raw | ConvertFrom-Json
  Assert ($snap.dataPARC[0].isOpen -eq $true) 'IsOpen=true snapshot failed.'
  $excel.AddIns.Entry.FailIsOpen=$true
  Write-CofiringAddinRuntimeSnapshot $excel 42 'host-not-ready'
  $snap=Get-Content -LiteralPath (Join-Path $testRoot 'addin-runtime-host-not-ready.json') -Raw | ConvertFrom-Json
  Assert ($null -eq $snap.dataPARC[0].isOpen -and $snap.dataPARC[0].installed -eq $true -and $snap.dataPARC[0].errors.Count -eq 1) 'IsOpen getter error must remain unknown.'
  $script:identityOk=$false; $script:released.Clear()
  Write-CofiringAddinRuntimeSnapshot $excel 42 'host-ready'
  $snap=Get-Content -LiteralPath (Join-Path $testRoot 'addin-runtime-host-ready.json') -Raw | ConvertFrom-Json
  Assert ($snap.errors.Count -eq 1 -and $snap.dataPARC.Count -eq 0 -and $script:released.Count -eq 0) 'Foreign process diagnostic guard failed.'
  Assert (Test-CofiringDocumentSeedWorkbook $documentSeedPath.ToUpperInvariant() $documentSeedPath) 'Case-insensitive seed identity failed.'
  Assert (-not (Test-CofiringDocumentSeedWorkbook $other.FullName $documentSeedPath)) 'Foreign workbook identified as seed.'
  Assert (-not (Test-CofiringDocumentSeedWorkbook '' $documentSeedPath)) 'Blank workbook identified as seed.'
  # Execute the actual startup workbook block, using fake books, to verify behavior.
  $closeEnd=$source.IndexOf("  Complete-CofiringWorkerPhase 'setupStartupWorkbookClose'",$closeStart)+"  Complete-CofiringWorkerPhase 'setupStartupWorkbookClose'".Length
  Invoke-Expression $source.Substring($closeStart,$closeEnd-$closeStart)
  Assert ($seed.Closed -eq 0 -and $addinBook.Closed -eq 0 -and $other.Closed -eq 1 -and -not $other.SaveRequested) 'Actual workbook close loop did not preserve seed/add-in or discard other startup book.'
  Write-Host 'PASS: Host-before-event/close order / retained seed / read-only runtime state / partial errors / owned identity / released references (synthetic).'
} finally {
  $env:GS_COFIRING_COM_TRACE_PATH=$oldTrace; $env:GS_COFIRING_RUN_ID=$oldRun
  [IO.Directory]::Delete($testRoot,$true)
}
