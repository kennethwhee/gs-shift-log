$ErrorActionPreference = 'Stop'
$workerPath = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1'
$tokens = $null
$parseErrors = $null
$tree = [System.Management.Automation.Language.Parser]::ParseFile($workerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Worker parse failed.' }

# Extract only the actual retained-handle exit function. Never dot-source the
# worker or call a process API: every ProcessObject below is a local test double.
$fn = @($tree.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Complete-OwnedProbeExcelExit'}, $true))
if ($fn.Count -ne 1) { throw 'Expected one owned exit function.' }
Invoke-Expression $fn[0].Extent.Text
$script:fixtureTime = [datetime]'2026-09-10T01:00:00Z'
$script:fixturePath = Join-Path $PSScriptRoot 'synthetic-owned-EXCEL.EXE'
function New-FakeProcess {
  $p = [pscustomobject]@{Id=42;Handle=123;ProcessName='EXCEL';StartTime=$script:fixtureTime;
    SessionId=7;Path=$script:fixturePath;HasExited=$false;Waits=@();Kills=0;
    Graceful=$false;KillFailure=$false;KillRace=$false;ExitAfterKill=$true}
  $p | Add-Member ScriptMethod WaitForExit {
    param($milliseconds)
    $this.Waits += $milliseconds
    if ($milliseconds -eq 12000) { return $this.Graceful }
    return $this.ExitAfterKill
  }
  $p | Add-Member ScriptMethod Kill {
    $this.Kills += 1
    if ($this.KillRace) { $this.HasExited=$true; throw 'synthetic exit race' }
    if ($this.KillFailure) { throw 'synthetic kill failure' }
  }
  return $p
}
function Call-OwnedExit($p) {
  return Complete-OwnedProbeExcelExit -ProcessObject $p -ExpectedProcessId 42 -ExpectedStartTicks $script:fixtureTime.ToUniversalTime().Ticks -ExpectedPath $script:fixturePath -ExpectedSessionId 7
}
function Assert-Throws($p,$expectedKills) {
  $caught=$false
  try { Call-OwnedExit $p | Out-Null } catch { $caught=$true }
  if (-not $caught) { throw 'Expected identity/exit failure.' }
  if ($null -ne $p -and $p.Kills -ne $expectedKills) { throw 'Unexpected synthetic kill count.' }
}
Assert-Throws $null 0
$p=New-FakeProcess;$p.Id=99;Assert-Throws $p 0
$p=New-FakeProcess;$p.Graceful=$true;$result=Call-OwnedExit $p
if (-not $result.Exited -or $result.Forced -or $p.Kills) { throw 'Graceful exit failed.' }
$p=New-FakeProcess;$result=Call-OwnedExit $p
if (-not $result.Exited -or -not $result.Forced -or $p.Kills -ne 1 -or ($p.Waits -join ',') -ne '12000,5000') { throw 'Retained owned handle exit failed.' }
foreach ($field in @('ProcessName','StartTime','SessionId','Path')) {
  $p=New-FakeProcess
  switch ($field) {
    'ProcessName' {$p.ProcessName='other'}
    'StartTime' {$p.StartTime=$script:fixtureTime.AddSeconds(1)}
    'SessionId' {$p.SessionId=8}
    'Path' {$p.Path=Join-Path $PSScriptRoot 'other-EXCEL.EXE'}
  }
  Assert-Throws $p 0
}
$p=New-FakeProcess;$p.Path='';$p.HasExited=$true;$result=Call-OwnedExit $p
if (-not $result.Exited -or $result.Forced -or $p.Kills) { throw 'Identity property exit race failed.' }
$p=New-FakeProcess;$p.KillRace=$true;$result=Call-OwnedExit $p
if (-not $result.Exited -or $result.Forced -or $p.Kills -ne 1) { throw 'Kill exit race failed.' }
$p=New-FakeProcess;$p.KillFailure=$true;Assert-Throws $p 1
$p=New-FakeProcess;$p.ExitAfterKill=$false;Assert-Throws $p 1
Write-Host 'OWNED EXIT PASS: 12 synthetic cases; no process operations.'

# Execute the real pure formula-building loop only, with synthetic tag names.
# No workbook creation, NativeOM call, query, registry read or COM invocation.
$loops=@($tree.FindAll({param($node) $node -is [System.Management.Automation.Language.ForStatementAst] -and $node.Extent.Text.Contains('$formulasFast[$r,0]')},$true))
if ($loops.Count -ne 1) { throw 'Expected one formula builder.' }
$cofiringTags=@(1..10 | ForEach-Object { [pscustomobject]@{tag=('fuel'+$_)} })
$cofiringQueryTags=@($cofiringTags)+@(1..3 | ForEach-Object { [pscustomobject]@{tag=('inventory'+$_)} })
$rowsFast=13;$columnsFast=11
$cofiringStart=[datetime]'2026-09-10T00:00:00'
$fullStart='2026-09-10 00:00';$firstEnd='2026-09-10 00:01:00'
$fullEnd='2026-09-10 12:00';$lastEnd='2026-09-10 12:01:00'
$formulasFast=New-Object 'object[,]' $rowsFast,$columnsFast
Invoke-Expression $loops[0].Extent.Text
$checked=0
for ($row=0;$row -lt 13;$row+=1) {
  $tag=[string]$cofiringQueryTags[$row].tag
  $startFrom='2026-09-10 00:00';$startTo='2026-09-10 00:01:00';$startMethod='Start'
  $endFrom='2026-09-10 12:00';$endTo='2026-09-10 12:01:00';$endMethod='Start'
  if ($row -ge 10) {
    $startFrom='2026-09-09 00:00';$startTo='2026-09-10 00:00';$startMethod='End'
    $endFrom='2026-09-10 00:00';$endTo='2026-09-10 12:00';$endMethod='End'
  }
  $expected=@()
  foreach($field in @('Value','QualStr','Time')) { $expected+=('=fnTagStat("{0}","{1}","{2}","{3}","{4}")' -f $tag,$startFrom,$startTo,$startMethod,$field) }
  foreach($field in @('Value','QualStr','Time')) { $expected+=('=fnTagStat("{0}","{1}","{2}","{3}","{4}")' -f $tag,$endFrom,$endTo,$endMethod,$field) }
  foreach($stat in @('Min','Max','Delta','DurationGood','DurationBad')) { $expected+=('=fnTagStat("{0}","2026-09-10 00:00","2026-09-10 12:00","{1}","Value")' -f $tag,$stat) }
  for ($col=0;$col -lt 11;$col+=1) {
    if ($formulasFast[$row,$col] -cne $expected[$col]) { throw ('Formula mismatch at row {0}, column {1}: {2}' -f $row,$col,$formulasFast[$row,$col]) }
    $checked+=1
  }
}
Write-Host ('FORMULA PASS: {0}; no Excel or DataPARC queries.' -f $checked)
