[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$AgentPath, [switch]$SmokeTest)
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $AgentPath).Path)
$bridge = [regex]::Match($source, '(?s)const DATAPARC_BLOWER_RUNTIME_PROBE_POWERSHELL_SCRIPT\s*=\s*String\.raw`(?<script>.*?)\r?\n`;')
if (-not $bridge.Success) { throw 'Embedded Blower PowerShell was not found.' }
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($bridge.Groups['script'].Value, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ('Embedded PowerShell parse failure: ' + $parseErrors[0].Message) }
foreach ($name in @('Test-ProbeNativeOmCompileLock', 'Initialize-ProbeNativeOm')) {
  $definitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true))
  if ($definitions.Count -ne 1) { throw ('Expected exactly one initializer helper: ' + $name) }
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$csharp = [regex]::Match($bridge.Groups['script'].Value, '(?s)\$nativeOmTypeDefinition\s*=\s*@"\r?\n(?<code>.*?)\r?\n"@')
if (-not $csharp.Success) { throw 'NativeOM C# source was not found.' }
# Only the two initializer functions above execute; the bridge Main/Excel/cleanup never execute.
$script:Checks = 0; $script:AllDirectories = @(); $script:Scenario = 'success'
$script:Calls = 0; $script:Paths = @(); $script:Waits = @(); $script:Stages = @(); $script:LeaveCleanup = $false
$originalTemp = $env:TEMP; $originalTmp = $env:TMP
$fixtureDirectory = Join-Path ([IO.Path]::GetTempPath()) ('gs-blower-compile-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($fixtureDirectory)
$sentinel = Join-Path $fixtureDirectory 'existing.txt'
[IO.File]::WriteAllText($sentinel, 'preserve existing temp content')
function Assert-Test([bool]$Condition, [string]$Label) {
  if (-not $Condition) { throw ('FAIL: ' + $Label) }; $script:Checks++
}
function Reset-Fixture([string]$Scenario) {
  $script:Scenario = $Scenario; $script:Calls = 0; $script:Paths = @()
  $script:Waits = @(); $script:Stages = @(); $script:LeaveCleanup = $false
}
function Write-ProbeStage([string]$Message) { $script:Stages += $Message }
function Start-Sleep { [CmdletBinding()]param([int]$Milliseconds) $script:Waits += $Milliseconds }
function Remove-Item {
  [CmdletBinding()]param([string]$LiteralPath, [switch]$Recurse, [switch]$Force)
  Assert-Test ($script:AllDirectories -contains $LiteralPath) 'Cleanup targets only a directory made by this initializer'
  if ($script:LeaveCleanup) { throw 'Fixture cleanup sharing violation' }
  Microsoft.PowerShell.Management\Remove-Item @PSBoundParameters
}
function Add-Type {
  [CmdletBinding()]param([string]$TypeDefinition, [System.CodeDom.Compiler.CompilerParameters]$CompilerParameters)
  $script:Calls++
  $directory = $CompilerParameters.TempFiles.TempDir
  $script:Paths += $directory; $script:AllDirectories += $directory
  Assert-Test (Test-Path -LiteralPath $directory -PathType Container) 'Private compiler directory exists'
  Assert-Test ($CompilerParameters.GenerateInMemory -and -not $CompilerParameters.GenerateExecutable) 'In-memory library compile parameters'
  Assert-Test ($CompilerParameters.ReferencedAssemblies.Contains('System.dll')) 'System.dll reference retained'
  Assert-Test (-not $CompilerParameters.TempFiles.KeepFiles) 'Compiler temporary files are disposable'
  Assert-Test ($TypeDefinition -ceq $csharp.Groups['code'].Value) 'C# NativeOM source is unchanged'
  $dll = Join-Path $directory 'fixture.dll'
  [IO.File]::WriteAllText($dll, 'fixture compiler output')
  if ($script:Scenario -eq 'success' -or ($script:Scenario -eq 'once' -and $script:Calls -gt 1)) { return }
  $code = 'CS0016'
  $text = "출력 파일 '$dll'에 쓸 수 없습니다. 다른 프로세스가 파일을 사용 중이기 때문에 프로세스가 액세스 할 수 없습니다."
  if ($script:Scenario -eq 'english') { $text = "Could not write to output file '$dll' -- 'The process cannot access the file because it is being used by another process.'" }
  if ($script:Scenario -eq 'syntax') { $code = 'CS1002'; $text = '; expected' }
  if ($script:Scenario -eq 'denied') { $text = "출력 파일 '$dll'에 쓸 수 없습니다. 액세스가 거부되었습니다." }
  if ($script:Scenario -eq 'mixed') { $text += ' CS1002: ; expected' }
  if ($script:Scenario -eq 'foreign') { $text = "CS0016: Could not write '$sentinel.dll': used by another process" }
  $target = [System.CodeDom.Compiler.CompilerError]::new('', 0, 0, $code, $text)
  $errorRecord = [Management.Automation.ErrorRecord]::new([Exception]::new($text), 'SOURCE_CODE_ERROR', [Management.Automation.ErrorCategory]::InvalidData, $target)
  $PSCmdlet.WriteError($errorRecord)
}
function Invoke-ExpectFailure([string]$Scenario, [int]$ExpectedCalls, [string]$ExpectedCause) {
  Reset-Fixture $Scenario
  $failure = $null
  try { Initialize-ProbeNativeOm $csharp.Groups['code'].Value } catch { $failure = $_ }
  Assert-Test ($null -ne $failure) ($Scenario + ' must fail')
  Assert-Test ($script:Calls -eq $ExpectedCalls) ($Scenario + ' attempt bound')
  Assert-Test ($failure.Exception.Message.Contains($ExpectedCause)) ($Scenario + ' retains original compiler cause')
  Assert-Test (@($script:Paths | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0) ($Scenario + ' cleans only owned directories')
}
try {
  Reset-Fixture 'once'
  Initialize-ProbeNativeOm $csharp.Groups['code'].Value
  Assert-Test ($script:Calls -eq 2) 'Korean lock retries then succeeds'
  Assert-Test (($script:Waits -join ',') -eq '1000') 'First retry waits one second'
  Assert-Test (@($script:Paths | Select-Object -Unique).Count -eq 2) 'Every attempt has a fresh directory'
  Assert-Test (@($script:Paths | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 0) 'Successful initialization cleans owned directories'
  Invoke-ExpectFailure 'permanent' 3 '다른 프로세스'
  Assert-Test (($script:Waits -join ',') -eq '1000,2000') 'Permanent lock is bounded to two waits'
  Assert-Test (@($script:Paths | Select-Object -Unique).Count -eq 3) 'Permanent lock gets three distinct directories'
  Invoke-ExpectFailure 'english' 3 'used by another process'
  Invoke-ExpectFailure 'syntax' 1 '; expected'
  Assert-Test ($script:Waits.Count -eq 0) 'Syntax error is not retried'
  Invoke-ExpectFailure 'denied' 1 '액세스가 거부'
  Assert-Test ($script:Waits.Count -eq 0) 'Access denied is not retried'
  Invoke-ExpectFailure 'mixed' 1 'CS1002'
  Invoke-ExpectFailure 'foreign' 1 'CS0016'
  Reset-Fixture 'success'; $script:LeaveCleanup = $true
  Initialize-ProbeNativeOm $csharp.Groups['code'].Value
  Assert-Test ($script:Calls -eq 1) 'Cleanup lock does not turn successful compile into failure'
  Assert-Test (@($script:Paths | Where-Object { Test-Path -LiteralPath $_ }).Count -eq 1) 'Locked owned folder is left in place'
  Assert-Test (@($script:Stages | Where-Object { $_ -like '*정리 대기:*' }).Count -eq 1) 'Leftover folder is reported'
  Reset-Fixture 'syntax'; $script:LeaveCleanup = $true
  $failure = $null
  try { Initialize-ProbeNativeOm $csharp.Groups['code'].Value } catch { $failure = $_ }
  Assert-Test ($null -ne $failure -and $failure.Exception.Message.Contains('; expected')) 'Cleanup failure preserves original compile failure'
  Assert-Test ([IO.File]::ReadAllText($sentinel) -ceq 'preserve existing temp content') 'Existing temp files stay intact'
  Assert-Test ($env:TEMP -ceq $originalTemp -and $env:TMP -ceq $originalTmp) 'TEMP and TMP stay unchanged'
  Write-Host ('PASS: compiler lock mock checks ' + $script:Checks + ' (no Excel or process changes)')
  if ($SmokeTest) {
    Microsoft.PowerShell.Management\Remove-Item Function:\Add-Type
    Microsoft.PowerShell.Management\Remove-Item Function:\Start-Sleep
    Microsoft.PowerShell.Management\Remove-Item Function:\Remove-Item
    Initialize-ProbeNativeOm $csharp.Groups['code'].Value
    Assert-Test ($null -ne ('GsBlowerRuntimeNativeOmV1' -as [type])) 'Real C# initialization produced the expected type'
    Write-Host 'PASS: real NativeOM C# compile/load only; no Excel or NativeOM method execution'
  }
} finally {
  foreach ($directory in $script:AllDirectories) {
    if (Test-Path -LiteralPath $directory) { Microsoft.PowerShell.Management\Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue }
  }
  Microsoft.PowerShell.Management\Remove-Item -LiteralPath $fixtureDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
