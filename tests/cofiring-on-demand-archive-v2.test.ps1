param([string]$Repo = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$controller = Join-Path $Repo 'local-tools/ois-agent/cofiring-period-v5/run-cofiring-period-v5.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($controller, [ref]$tokens, [ref]$errors)
if (@($errors).Count) { throw ($errors | Out-String) }

# Load only the packaging function and its clock helper. Never launch Excel or the controller.
foreach ($name in @('Set-ControllerTimingMark', 'Complete-CofiringDiagnosticArchive')) {
    $node = $ast.Find({ param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $name }, $true)
    if ($null -eq $node) { throw "Missing function: $name" }
    . ([scriptblock]::Create($node.Extent.Text))
}
function Assert-Archive([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Reset-ArchiveClock {
    $script:controllerClock = [Diagnostics.Stopwatch]::StartNew()
    $script:controllerTimingMarks = [ordered]@{}
    $script:archiveSucceeded = $null
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ('cofiring-archive-test-' + [guid]::NewGuid().ToString('N'))
$OutputDirectory = Join-Path $fixture 'run'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$report = Join-Path $OutputDirectory 'period-report.json'
[IO.File]::WriteAllText($report, '{"status":"PERIOD_READY","cleanupVerified":true}')
$reportHash = (Get-FileHash -LiteralPath $report -Algorithm SHA256).Hash
$outputReady = $true
$success = $true
try {
    Reset-ArchiveClock
    $SkipDiagnosticArchive = $true
    Complete-CofiringDiagnosticArchive
    Assert-Archive (-not (Test-Path -LiteralPath ($OutputDirectory + '.zip'))) 'Live mode unexpectedly created a ZIP.'
    Assert-Archive ($controllerTimingMarks.Contains('archive_skipped') -and -not $controllerTimingMarks.Contains('archive_begin')) 'Skipped mode entered compression.'
    Assert-Archive ((Get-FileHash -LiteralPath $report -Algorithm SHA256).Hash -eq $reportHash) 'Raw diagnostic was modified.'
    Assert-Archive ($null -eq $archiveSucceeded -and $success) 'Skipped packaging changed result state.'
    Write-Host 'PASS: live mode returns without ZIP creation and preserves diagnostics/result state'

    [IO.File]::WriteAllText(($OutputDirectory + '.zip'), 'existing diagnostic archive')
    Complete-CofiringDiagnosticArchive
    Assert-Archive ([IO.File]::ReadAllText(($OutputDirectory + '.zip')) -eq 'existing diagnostic archive') 'Skipped mode modified an existing ZIP.'
    Remove-Item -LiteralPath ($OutputDirectory + '.zip')
    Write-Host 'PASS: on-demand mode does not remove or rewrite an existing archive'

    Reset-ArchiveClock
    $SkipDiagnosticArchive = $false
    Complete-CofiringDiagnosticArchive
    Assert-Archive ($archiveSucceeded -eq $true -and (Test-Path -LiteralPath ($OutputDirectory + '.zip'))) 'Standalone mode did not create its ZIP.'
    $expanded = Join-Path $fixture 'expanded'
    Expand-Archive -LiteralPath ($OutputDirectory + '.zip') -DestinationPath $expanded
    Assert-Archive ((Get-FileHash -LiteralPath (Join-Path $expanded 'period-report.json') -Algorithm SHA256).Hash -eq $reportHash) 'Archived report differs from original.'
    Write-Host 'PASS: standalone mode still creates a readable ZIP with exact diagnostic bytes'

    Reset-ArchiveClock
    function Compress-Archive { throw 'synthetic archive failure' }
    Complete-CofiringDiagnosticArchive
    Assert-Archive ($archiveSucceeded -eq $false -and $controllerTimingMarks.Contains('archive_end') -and $success) 'Archive failure changed result success or lost timing.'
    Remove-Item Function:\Compress-Archive
    Write-Host 'PASS: packaging failure remains diagnostic-only'

    Reset-ArchiveClock
    $outputReady = $false
    Complete-CofiringDiagnosticArchive
    Assert-Archive ($controllerTimingMarks.Count -eq 0) 'Uninitialized output entered packaging.'
    Write-Host 'PASS: no packaging before diagnostic output is initialized'
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
