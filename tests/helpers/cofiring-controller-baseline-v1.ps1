#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ControllerPath = '',
  [string]$FixturePath = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ([string]::IsNullOrWhiteSpace($ControllerPath)) {
  $ControllerPath = Join-Path $PSScriptRoot '../../local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1'
}
if ([string]::IsNullOrWhiteSpace($FixturePath)) {
  $FixturePath = Join-Path $PSScriptRoot '../fixtures/cofiring-controller-baseline-v1.json'
}

# Parse and execute only the real identity predicates. Never dot-source the
# controller or call a process, CIM, COM, workbook, registry or termination API.
$tokens = $null; $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile([IO.Path]::GetFullPath($ControllerPath), [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count) { throw ('Controller parse failed: ' + ($parseErrors | Out-String)) }
foreach ($name in @('Test-ControllerProcessObject', 'Test-ControllerSignature', 'Test-ControllerBaselineSignature')) {
  $definitions = @($tree.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  if ($definitions.Count -ne 1) { throw ('Expected one production function: ' + $name) }
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$fixture = [IO.File]::ReadAllText([IO.Path]::GetFullPath($FixturePath)) | ConvertFrom-Json
if ($fixture.schemaVersion -ne 1 -or @($fixture.baselineExcel).Count -ne 2) { throw 'Expected the two supplied blank-path baseline identities.' }
if (($fixture.baselineExcel | ForEach-Object { [int]$_.ProcessId }) -join ',' -cne '177848,180548') { throw 'Baseline PID fixture differs from the supplied failure.' }

$script:fixtureProcess = $null
$script:fixtureLookupThrows = $false
$script:fixtureLookupCalls = @()
$script:baselineChecks = 0
$script:ownedChecks = 0
$script:knownExcelPath = 'C:\Program Files\Microsoft Office\Office16\EXCEL.EXE'
function Get-ControllerProcessById([int]$ProcessId) {
  $script:fixtureLookupCalls += $ProcessId
  if ($script:fixtureLookupThrows) { throw 'synthetic process lookup failure' }
  return $script:fixtureProcess
}
function Copy-Identity($Signature) {
  return [pscustomobject]@{ProcessId=[int]$Signature.ProcessId;ProcessName=[string]$Signature.ProcessName;
    StartTicks=[long]$Signature.StartTicks;SessionId=[int]$Signature.SessionId;Path=$Signature.Path}
}
function New-FakeBaselineProcess($Signature) {
  $process = [pscustomobject]@{
    Id=[int]$Signature.ProcessId;Handle=123;ProcessName=[string]$Signature.ProcessName;
    StartTime=[datetime]::new([long]$Signature.StartTicks,[DateTimeKind]::Utc);
    SessionId=[int]$Signature.SessionId;Path=$script:knownExcelPath;DisposeCalls=0
  }
  $process | Add-Member ScriptMethod Dispose { $this.DisposeCalls += 1 }
  return $process
}
function Set-FakeReadFailure($Process, [string]$Property) {
  $Process.PSObject.Properties.Remove($Property)
  $Process | Add-Member ScriptProperty $Property { throw 'synthetic identity property read failure' }
}
function Assert-BaselineCase {
  param([string]$Label,$Signature,$Process,[bool]$Expected,[bool]$LookupThrows=$false,[int]$ExpectedLookups=1)
  $script:fixtureProcess=$Process;$script:fixtureLookupThrows=$LookupThrows;$script:fixtureLookupCalls=@()
  $result=@(Test-ControllerBaselineSignature $Signature)
  if ($result.Count -ne 1 -or $result[0] -isnot [bool] -or [bool]$result[0] -ne $Expected) {
    throw ('BASELINE FAILED: ' + $Label + '; expected ' + $Expected + ', got ' + ($result -join ','))
  }
  if ($script:fixtureLookupCalls.Count -ne $ExpectedLookups) { throw ('Unexpected lookup count: ' + $Label) }
  if ($ExpectedLookups -eq 1 -and [int]$script:fixtureLookupCalls[0] -ne [int]$Signature.ProcessId) { throw ('Lookup did not use the pinned PID: ' + $Label) }
  if ($null -ne $Process -and $ExpectedLookups -eq 1 -and -not $LookupThrows -and $Process.DisposeCalls -ne 1) {
    throw ('The acquired synthetic process was not disposed exactly once: ' + $Label)
  }
  $script:baselineChecks += 1
}
function Assert-OwnedCase {
  param([string]$Label,$Signature,$Process,[bool]$Expected)
  $result=@(Test-ControllerProcessObject $Process $Signature)
  if ($result.Count -ne 1 -or $result[0] -isnot [bool] -or [bool]$result[0] -ne $Expected) { throw ('OWNED FAILED: ' + $Label) }
  if ($Process.DisposeCalls -ne 0) { throw ('The pure strict predicate disposed its caller-owned object: ' + $Label) }
  $script:ownedChecks += 1
}

foreach ($original in @($fixture.baselineExcel)) {
  $signature=Copy-Identity $original
  if (-not [string]::IsNullOrWhiteSpace([string]$signature.Path)) { throw 'Actual failure fixture must retain its blank recorded path.' }
  $label='actual PID '+$signature.ProcessId
  $process=New-FakeBaselineProcess $signature
  Assert-BaselineCase ($label+' unchanged identity with readable current path') $signature $process $true
  $process=New-FakeBaselineProcess $signature;$process.Path=''
  Assert-BaselineCase ($label+' unchanged identity with blank current path') $signature $process $true
  $process=New-FakeBaselineProcess $signature;Set-FakeReadFailure $process 'Path'
  Assert-BaselineCase ($label+' optional recorded path never reads unavailable live path') $signature $process $true
  $nullPathSignature=Copy-Identity $signature;$nullPathSignature.Path=$null
  Assert-BaselineCase ($label+' null recorded path remains optional only for baseline') $nullPathSignature (New-FakeBaselineProcess $signature) $true
  $process=New-FakeBaselineProcess $signature;$process.ProcessName='excel'
  Assert-BaselineCase ($label+' case-insensitive pinned process name') $signature $process $true
  Assert-BaselineCase ($label+' live PID missing') $signature $null $false
  Assert-BaselineCase ($label+' lookup read failure') $signature $null $false $true
  $process=New-FakeBaselineProcess $signature;$process.Id+=1
  Assert-BaselineCase ($label+' returned live PID differs') $signature $process $false
  $process=New-FakeBaselineProcess $signature;$process.StartTime=$process.StartTime.AddTicks(1)
  Assert-BaselineCase ($label+' reused PID / changed creation tick') $signature $process $false
  $process=New-FakeBaselineProcess $signature;$process.ProcessName='not-EXCEL'
  Assert-BaselineCase ($label+' process name changed') $signature $process $false
  $process=New-FakeBaselineProcess $signature;$process.SessionId+=1
  Assert-BaselineCase ($label+' session changed') $signature $process $false
  foreach ($property in @('Handle','Id','ProcessName','StartTime','SessionId')) {
    $process=New-FakeBaselineProcess $signature;Set-FakeReadFailure $process $property
    Assert-BaselineCase ($label+' unreadable required '+$property) $signature $process $false
  }
  $process=New-FakeBaselineProcess $signature;$process.Handle=$null
  Assert-BaselineCase ($label+' null required handle') $signature $process $false
  $process=New-FakeBaselineProcess $signature;$process.Handle=[IntPtr]::Zero
  Assert-BaselineCase ($label+' zero required handle') $signature $process $false
  $known=Copy-Identity $signature;$known.Path=$script:knownExcelPath
  Assert-BaselineCase ($label+' recorded known path still matches exactly') $known (New-FakeBaselineProcess $known) $true
  $process=New-FakeBaselineProcess $known;$process.Path=$script:knownExcelPath.ToUpperInvariant()
  Assert-BaselineCase ($label+' known path comparison remains case-insensitive') $known $process $true
  $process=New-FakeBaselineProcess $known;$process.Path='C:\Other Office\EXCEL.EXE'
  Assert-BaselineCase ($label+' known path mismatch stays rejected') $known $process $false
  $process=New-FakeBaselineProcess $known;$process.Path=''
  Assert-BaselineCase ($label+' recorded known path cannot lose its live path') $known $process $false
  $process=New-FakeBaselineProcess $known;Set-FakeReadFailure $process 'Path'
  Assert-BaselineCase ($label+' known live path read failure') $known $process $false
  $process=New-FakeBaselineProcess $known;$process.Path=[string][char]0
  Assert-BaselineCase ($label+' malformed known live path') $known $process $false
  Assert-OwnedCase ($label+' strict owned predicate still rejects blank recorded path') $signature (New-FakeBaselineProcess $signature) $false
  Assert-OwnedCase ($label+' strict owned predicate accepts complete exact identity') $known (New-FakeBaselineProcess $known) $true
  $process=New-FakeBaselineProcess $known;$process.Path='C:\Other Office\EXCEL.EXE'
  Assert-OwnedCase ($label+' strict owned predicate still rejects wrong path') $known $process $false
  $process=New-FakeBaselineProcess $known;Set-FakeReadFailure $process 'Path'
  Assert-OwnedCase ($label+' strict owned predicate still rejects unreadable known path') $known $process $false
}

# Invalid pinned identities fail before consulting a live-process provider.
Assert-BaselineCase 'null recorded identity' $null $null $false $false 0
foreach ($field in @('ProcessId','ProcessName','StartTicks')) {
  $signature=Copy-Identity $fixture.baselineExcel[0]
  if ($field -eq 'ProcessName') { $signature.ProcessName='' } else { $signature.$field=0 }
  Assert-BaselineCase ('invalid recorded '+$field) $signature $null $false $false 0
}
$signature=Copy-Identity $fixture.baselineExcel[0];$signature.SessionId=0
Assert-BaselineCase 'session zero is valid when the pinned live identity matches' $signature (New-FakeBaselineProcess $signature) $true
$process=New-FakeBaselineProcess $signature;Set-FakeReadFailure $process 'SessionId'
Assert-BaselineCase 'unreadable live session must not coerce to matching session zero' $signature $process $false
$process=New-FakeBaselineProcess $signature;$process.SessionId=$null
Assert-BaselineCase 'null live session must not coerce to matching session zero' $signature $process $false
$process=New-FakeBaselineProcess $signature;$signature.SessionId=$null
Assert-BaselineCase 'null recorded session must not stand in for session zero' $signature $process $false $false 0

# The relaxed predicate has exactly one production caller: the pre-existing
# baseline verification loop. Owned cleanup paths must retain the strict one.
$baselineCalls=@($tree.FindAll({ param($node)
  $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -ceq 'Test-ControllerBaselineSignature'
}, $true))
if ($baselineCalls.Count -ne 1) { throw 'Baseline-only predicate must have exactly one production call site.' }
$parent=$baselineCalls[0].Parent
while ($null -ne $parent -and $parent -isnot [Management.Automation.Language.ForEachStatementAst]) { $parent=$parent.Parent }
if ($null -eq $parent -or -not $parent.Extent.Text.Contains('@($baselineExcel)+@($baselineHosts)')) { throw 'Relaxed predicate escaped the baseline verification loop.' }
Write-Host ('BASELINE IDENTITY PASS: {0}; includes both actual blank-path Excel identities.' -f $script:baselineChecks)
Write-Host ('STRICT OWNED IDENTITY PASS: {0}; missing or wrong recorded paths remain rejected.' -f $script:ownedChecks)
Write-Host 'BASELINE SCOPE PASS: one baseline-only call site; no Excel, process, CIM or termination operations executed.'
