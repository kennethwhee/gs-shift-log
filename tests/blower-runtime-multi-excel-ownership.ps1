[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$AgentPath)
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $AgentPath).Path)
$match = [regex]::Match($source, '(?s)const DATAPARC_BLOWER_RUNTIME_PROBE_POWERSHELL_SCRIPT\s*=\s*String\.raw`(?<script>.*?)\r?\n`;')
if (-not $match.Success) { throw 'Embedded Blower PowerShell was not found.' }
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($match.Groups['script'].Value, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ('Embedded PowerShell parse failure: ' + $parseErrors[0].Message) }
$names = @('Test-ProbeProcessSignature','Test-ProbeProcessSignatureSet','Test-OwnedProbeExcelIdentity','Get-ProbeDataParcHosts','Wait-OwnedProbeDataParcHost','Test-ProbeHostSignature')
foreach ($name in $names) {
  $definitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true))
  if ($definitions.Count -ne 1) { throw ('Expected exactly one function: ' + $name) }
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
# Only the six function definitions above execute. Main, Add-Type, Excel and cleanup never execute.
$script:Checks = 0; $script:Processes = @{}; $script:Hosts = @(); $ownedExcelSessionId = 7
function Assert-Test([bool]$Condition, [string]$Label) {
  if (-not $Condition) { throw ('FAIL: ' + $Label) }; $script:Checks++
}
function Assert-Throws([scriptblock]$Action, [string]$Label, [string]$ExpectedText) {
  $message = ''; try { [void](& $Action) } catch { $message = $_.Exception.Message }
  Assert-Test ($message.Contains($ExpectedText)) $Label
}
function Add-Fixture([int]$ProcessId, [string]$Name, [int]$Parent = 0) {
  $process = [pscustomobject]@{ Id=$ProcessId; ProcessName=$Name; SessionId=7; Path=('C:\Fixture\' + $Name + '.exe'); StartTime=([datetime]'2026-09-08T00:00:00Z').AddSeconds($ProcessId) }
  $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
  $script:Processes[$ProcessId] = $process
  if ($Parent -gt 0) { $script:Hosts += [pscustomobject]@{ ProcessId=$ProcessId; ParentProcessId=$Parent; SessionId=7 } }
  return [pscustomobject]@{ ProcessId=$ProcessId; ProcessName=$Name; SessionId=7; Path=$process.Path; StartTicks=$process.StartTime.ToUniversalTime().Ticks; ParentProcessId=$Parent }
}
function Get-Process {
  [CmdletBinding()]param([int]$Id)
  return $script:Processes[$Id]
}
function Get-CimInstance {
  [CmdletBinding()]param([string]$ClassName, [string]$Filter)
  if ($ClassName -ne 'Win32_Process') { throw 'Unexpected CIM class.' }
  if ($Filter -eq "Name='CTCExcelAddIn.PARCviewHost.exe'") { return $script:Hosts }
  if ($Filter -match '^ProcessId=(\d+)$') { $selectedId = [int]$Matches[1]; return @($script:Hosts | Where-Object { $_.ProcessId -eq $selectedId }) }
  throw 'Unexpected CIM filter.'
}
function Start-Sleep { [CmdletBinding()]param([int]$Milliseconds) throw 'Test unexpectedly attempted to wait.' }
foreach ($count in 0..3) {
  $script:Processes = @{}; $script:Hosts = @(); $baseline = @(); $baselineHosts = @(); $baselinePids = @()
  for ($index = 1; $index -le $count; $index++) {
    $baseline += Add-Fixture (100 + $index) 'EXCEL'
    $baselineHosts += Add-Fixture (200 + $index) 'CTCExcelAddIn.PARCviewHost' (100 + $index)
    $baselinePids += 100 + $index
  }
  $owned = Add-Fixture 900 'EXCEL'; $hostSignature = Add-Fixture 901 'CTCExcelAddIn.PARCviewHost' 900
  Assert-Test (Test-ProbeProcessSignatureSet $baseline) "baseline $count Excel signatures"
  Assert-Test (Test-ProbeProcessSignatureSet $baselineHosts) "baseline $count Host signatures"
  $hostResult = @(Wait-OwnedProbeDataParcHost 900 $baselinePids ([datetime]::UtcNow.AddSeconds(1)))
  Assert-Test ($hostResult.Count -eq 1 -and $hostResult[0].ProcessId -eq 901) "baseline $count selects only owned Host"
  Assert-Test (Test-OwnedProbeExcelIdentity 900 $owned.StartTicks $owned.Path 7) "baseline $count owned Excel identity"
  Assert-Test (Test-ProbeHostSignature $hostSignature) "baseline $count owned Host identity"
  foreach ($signature in @($baseline + $baselineHosts)) {
    $saved = $script:Processes[$signature.ProcessId]
    $script:Processes.Remove($signature.ProcessId)
    Assert-Test (-not (Test-ProbeProcessSignatureSet @($baseline + $baselineHosts))) "baseline $count missing PID $($signature.ProcessId)"
    $script:Processes[$signature.ProcessId] = $saved; $start = $saved.StartTime
    $saved.StartTime = $start.AddSeconds(1)
    Assert-Test (-not (Test-ProbeProcessSignatureSet @($baseline + $baselineHosts))) "baseline $count reused PID $($signature.ProcessId)"
    $saved.StartTime = $start
  }
  Assert-Test (Test-ProbeProcessSignatureSet @($baseline + $baselineHosts)) "baseline $count fixtures preserved"
  $savedHosts = @($script:Hosts)
  [void](Add-Fixture 902 'CTCExcelAddIn.PARCviewHost' 900)
  Assert-Throws { Wait-OwnedProbeDataParcHost 900 $baselinePids ([datetime]::UtcNow.AddSeconds(1)) } "baseline $count rejects duplicate owned Host" 'Host가 둘 이상'
  $script:Hosts = @($savedHosts)
  [void](Add-Fixture 903 'CTCExcelAddIn.PARCviewHost' 999)
  Assert-Throws { Wait-OwnedProbeDataParcHost 900 $baselinePids ([datetime]::UtcNow.AddSeconds(1)) } "baseline $count rejects unknown Host parent" '소유관계를 확인할 수 없는 Host'
  $script:Hosts = @($savedHosts)
}
Assert-Test (-not (Test-OwnedProbeExcelIdentity 900 ($owned.StartTicks + 1) $owned.Path 7)) 'Reject owned Excel PID reuse'
Assert-Test (-not (Test-OwnedProbeExcelIdentity 900 $owned.StartTicks 'C:\Other\EXCEL.EXE' 7)) 'Reject owned Excel path mismatch'
Assert-Test (-not (Test-OwnedProbeExcelIdentity 900 $owned.StartTicks $owned.Path 8)) 'Reject owned Excel session mismatch'
$script:Processes[900].ProcessName = 'other'
Assert-Test (-not (Test-OwnedProbeExcelIdentity 900 $owned.StartTicks $owned.Path 7)) 'Reject owned Excel name mismatch'
$script:Processes[900].ProcessName = 'EXCEL'
$script:Processes[901].StartTime = $script:Processes[901].StartTime.AddSeconds(1)
Assert-Test (-not (Test-ProbeHostSignature $hostSignature)) 'Reject owned Host PID reuse'
$script:Processes[901].StartTime = $script:Processes[901].StartTime.AddSeconds(-1)
($script:Hosts | Where-Object { $_.ProcessId -eq 901 }).ParentProcessId = 100
Assert-Test (-not (Test-ProbeHostSignature $hostSignature)) 'Reject owned Host parent mismatch'
Write-Host ('PASS: multi-Excel ownership checks ' + $script:Checks + ' (mock processes; no Excel or process changes)')
