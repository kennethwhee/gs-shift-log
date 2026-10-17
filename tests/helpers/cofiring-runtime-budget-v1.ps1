#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
# Parse and execute only pure production functions. This test never runs the
# controller, Excel, COM, a process lookup, a real delay, or process termination.
$controllerPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1'))
$tokens = $null; $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($controllerPath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count) { throw ($parseErrors | Out-String) }

function Assert-RuntimeBudget([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Get-ConfiguredRuntimeBudget([string]$Name) {
  $assignments = @($tree.FindAll({ param($node)
    $node -is [Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left -is [Management.Automation.Language.VariableExpressionAst] -and
    $node.Left.VariablePath.UserPath -ceq $Name
  }, $false))
  Assert-RuntimeBudget ($assignments.Count -eq 1) ('Expected one configured budget: '+$Name)
  # Windows PowerShell 5.1 wraps the RHS in StatementBlockAst. SafeGetValue
  # rejects that wrapper even for a literal such as 120. Read only one integer
  # constant after checking the complete RHS; never evaluate an assignment.
  $right = $assignments[0].Right
  $literalText = $right.Extent.Text.Trim()
  $constants = @($right.FindAll({param($node)
    $node -is [Management.Automation.Language.ConstantExpressionAst]
  }, $true))
  Assert-RuntimeBudget ($literalText -cmatch '^[0-9]+$' -and $constants.Count -eq 1) ('Budget must be one integer literal: '+$Name)
  $value = $constants[0].Value
  Assert-RuntimeBudget ($value -is [int] -and $value -gt 0) ('Invalid configured budget: '+$Name)
  return [int]$value
}

# Exercise actual 5.1 assignment wrappers without evaluating the source text.
$productionTree = $tree
try {
  foreach ($number in @(120,300,420)) {
    $literalTokens = $null; $literalErrors = $null
    $tree = [Management.Automation.Language.Parser]::ParseInput(('$fixtureBudget = '+$number),[ref]$literalTokens,[ref]$literalErrors)
    Assert-RuntimeBudget ((Get-ConfiguredRuntimeBudget 'fixtureBudget') -eq $number) 'Integer assignment AST wrapper was not read correctly.'
  }
  foreach ($expression in @('60*2', "'120'", '-1', '0', '2147483648', '$otherBudget', '{120}')) {
    $literalTokens = $null; $literalErrors = $null
    $tree = [Management.Automation.Language.Parser]::ParseInput(('$fixtureBudget = '+$expression),[ref]$literalTokens,[ref]$literalErrors)
    $rejected = $false
    try { Get-ConfiguredRuntimeBudget 'fixtureBudget' | Out-Null } catch { $rejected = $true }
    Assert-RuntimeBudget $rejected ('Nonliteral or invalid budget was accepted: '+$expression)
  }
} finally { $tree = $productionTree }
foreach ($name in @('Get-CofiringDeadlineDecision','Test-CofiringExecutionEvidence','Test-CofiringCleanupEvidence')) {
  $definitions = @($tree.FindAll({param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
  }, $true))
  Assert-RuntimeBudget ($definitions.Count -eq 1) ('Production function is not unique: '+$name)
  Invoke-Expression $definitions[0].Extent.Text
}
$startup = Get-ConfiguredRuntimeBudget 'startupTimeoutSeconds'
$execution = Get-ConfiguredRuntimeBudget 'timeoutSeconds'
$outer = Get-ConfiguredRuntimeBudget 'outerTimeoutSeconds'

# Captured 2026-10-17 execution: READY preceded Excel startup; validated query
# data arrived later, and final worker cleanup required approximately 292 sec.
$ready = 33.8321315
$old = Get-CofiringDeadlineDecision 184.6 $ready 120 150 270
Assert-RuntimeBudget ($old.Expired -and $old.Code -eq 'EXECUTION_TIMEOUT') 'The captured failure must reproduce under the old budget.'
foreach ($elapsed in @(184.6, 292.0)) {
  $decision = Get-CofiringDeadlineDecision $elapsed $ready $startup $execution $outer
  Assert-RuntimeBudget (-not $decision.Expired) ('The captured run is still interrupted at '+$elapsed+' seconds.')
  $defaults = Get-CofiringDeadlineDecision $elapsed $ready
  Assert-RuntimeBudget ($defaults.Expired -eq $decision.Expired -and $defaults.DeadlineSeconds -eq $decision.DeadlineSeconds) 'Function defaults and configured production budgets disagree.'
}

$beforeStartup = Get-CofiringDeadlineDecision ($startup-0.001) $null $startup $execution $outer
$atStartup = Get-CofiringDeadlineDecision $startup $null $startup $execution $outer
Assert-RuntimeBudget (-not $beforeStartup.Expired -and $atStartup.Expired -and $atStartup.Code -eq 'STARTUP_TIMEOUT') 'No-READY startup boundary changed.'
$executionDeadline = [Math]::Min(10+$execution, $outer)
$beforeExecution = Get-CofiringDeadlineDecision ($executionDeadline-0.001) 10 $startup $execution $outer
$atExecution = Get-CofiringDeadlineDecision $executionDeadline 10 $startup $execution $outer
Assert-RuntimeBudget (-not $beforeExecution.Expired -and $atExecution.Expired -and $atExecution.Code -eq 'EXECUTION_TIMEOUT') 'Execution deadline is not bounded at its exact boundary.'
# Deliberately enlarge the execution input to demonstrate that the independent
# absolute cap still wins even when the per-stage deadline would be later.
$beforeOuter = Get-CofiringDeadlineDecision ($outer-0.001) 10 $startup ($outer+100) $outer
$atOuter = Get-CofiringDeadlineDecision $outer 10 $startup ($outer+100) $outer
Assert-RuntimeBudget (-not $beforeOuter.Expired -and $atOuter.Expired -and $atOuter.Code -eq 'OVERALL_TIMEOUT') 'The absolute outer limit was bypassed.'

foreach ($elapsed in @(-1.0, [double]::NaN, [double]::PositiveInfinity)) {
  $caught = $false
  try { Get-CofiringDeadlineDecision $elapsed $null $startup $execution $outer | Out-Null } catch { $caught = $true }
  Assert-RuntimeBudget $caught 'Invalid elapsed time was accepted.'
}
foreach ($invalidReady in @(-1.0, [double]::NaN, [double]::PositiveInfinity, [double]$startup, 20.0)) {
  $caught = $false
  try { Get-CofiringDeadlineDecision 10 $invalidReady $startup $execution $outer | Out-Null } catch { $caught = $true }
  Assert-RuntimeBudget $caught 'Invalid, late or future READY evidence was accepted.'
}

# Larger ceilings must not become a compulsory delay for a fast worker.
$clock = [Diagnostics.Stopwatch]::StartNew()
for ($index=0; $index -lt 100; $index++) {
  $fast = Get-CofiringDeadlineDecision 2 1 $startup $execution $outer
  Assert-RuntimeBudget (-not $fast.Expired) 'A fast valid worker was timed out.'
}
Assert-RuntimeBudget ($clock.ElapsedMilliseconds -lt 5000) 'The pure deadline decision introduced a wait.'

Assert-RuntimeBudget (Test-CofiringExecutionEvidence 0 $false '') 'A clean worker exit was rejected.'
Assert-RuntimeBudget (-not (Test-CofiringExecutionEvidence 0 $true '')) 'A timeout was promoted to success.'
Assert-RuntimeBudget (-not (Test-CofiringExecutionEvidence 1 $false '')) 'A nonzero exit was promoted to success.'
Assert-RuntimeBudget (-not (Test-CofiringExecutionEvidence 0 $false 'query failure')) 'A failed query was promoted to success.'
$certificate = [pscustomobject]@{cleanupVerified=$true}
$ownedExcel = [pscustomobject]@{ProcessId=777}
Assert-RuntimeBudget (Test-CofiringCleanupEvidence $certificate $true 0 $ownedExcel) 'Independent valid cleanup certificates were rejected.'
foreach ($arguments in @(
  @([pscustomobject]@{cleanupVerified=$false},$true,0,$ownedExcel),
  @($certificate,$false,0,$ownedExcel),
  @($certificate,$true,1,$ownedExcel),
  @($certificate,$true,0,$null)
)) {
  Assert-RuntimeBudget (-not (Test-CofiringCleanupEvidence @arguments)) 'Incomplete cleanup evidence was promoted to success.'
}
Write-Host 'PASS: actual controller deadline / captured 33.832-184.6-292 sec timeline / startup, execution and outer boundaries / invalid READY / no added wait / independent execution and cleanup gates.'
