#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$AgentPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$source = [IO.File]::ReadAllText($AgentPath, [Text.Encoding]::UTF8)
$marker = 'const DATAPARC_STEAM_OPEN_WORKBOOK_POWERSHELL_SCRIPT ='
$start = $source.IndexOf($marker, [StringComparison]::Ordinal)
if ($start -lt 0) { throw 'Daily workbook reader marker missing' }
$rawStart = $source.IndexOf(('String.raw' + [char]96), $start, [StringComparison]::Ordinal)
$rawStart += ('String.raw' + [char]96).Length
$rawEnd = $source.IndexOf(([string][char]96 + ';'), $rawStart, [StringComparison]::Ordinal)
if ($rawStart -lt 10 -or $rawEnd -le $rawStart) { throw 'Daily workbook reader boundaries missing' }
$reader = $source.Substring($rawStart, $rawEnd - $rawStart)
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($reader, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count) { throw ($parseErrors | Out-String) }
# Load actual reader functions only. Its live Excel/COM query block never runs here.
$definitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false))
foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) }
$fieldWarnings = New-Object 'System.Collections.Generic.List[string]'
$stageMarker = '__MONTH_TRANSITION_TEST__'
function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ($null -eq $Expected) { if ($null -ne $Actual) { throw ($Label + ': expected null') }; return }
  if ($Actual -ne $Expected) { throw ($Label + ': actual=' + [string]$Actual + ' expected=' + [string]$Expected) }
}
foreach ($dateText in @('2026-08-31','2026-09-01','2026-09-30','2026-10-01','2026-12-31','2027-01-01','2028-02-29')) {
  $date = [datetime]::ParseExact($dateText,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
  Assert-Equal (Test-DailyWorkbookMonth ($date.ToString('yyyy년 MM월')) $date) $true ($dateText + ' padded month')
  Assert-Equal (Test-DailyWorkbookMonth ($date.ToString('yyyy년 M월')) $date) $true ($dateText + ' month')
  Assert-Equal (Test-DailyWorkbookMonth ($date.AddMonths(-1).ToString('yyyy년 MM월')) $date) $false ($dateText + ' wrong month')
}
foreach ($raw in @(0, 12.345, $null)) {
  $single = ConvertTo-DailyWorkbookRowValues -Value $raw -ColumnCount 1
  Assert-Equal $single.Count 1 'single cell row count'
  Assert-Equal $single[0] $raw 'single cell value including zero/blank'
}
foreach ($lower in @(0,1)) {
  $matrix = [Array]::CreateInstance([object], [int[]]@(1,31), [int[]]@($lower,$lower))
  for ($day = 1; $day -le 31; $day += 1) { $matrix.SetValue([double]$day, $lower, $lower + $day - 1) }
  $row = ConvertTo-DailyWorkbookRowValues -Value $matrix -ColumnCount 31
  Assert-Equal $row[0] 1 'first array day'
  Assert-Equal $row[30] 31 'last array day'
}
$threw = $false
try { $null = ConvertTo-DailyWorkbookRowValues -Value 5 -ColumnCount 2 } catch { $threw = $true }
Assert-Equal $threw $true 'malformed multiday scalar rejected'
# Exercise the real cumulative routine against a fake read-only worksheet.
# WorkbookFullName is empty so no local or company file is opened.
foreach ($case in @(
    @{ Date='2026-09-01'; Daily=12.5 }, @{ Date='2026-09-01'; Daily=0 },
    @{ Date='2026-09-02'; Daily=10 }, @{ Date='2026-08-31'; Daily=10 },
    @{ Date='2026-09-30'; Daily=10 }, @{ Date='2027-01-01'; Daily=0 }
  )) {
  $date = [datetime]::ParseExact($case.Date,'yyyy-MM-dd',[Globalization.CultureInfo]::InvariantCulture)
  $rangeValue = $case.Daily
  if ($date.Day -gt 1) {
    $rangeValue = [Array]::CreateInstance([object], [int[]]@(1,$date.Day), [int[]]@(1,1))
    for ($day = 1; $day -le $date.Day; $day += 1) { $rangeValue.SetValue([double]$case.Daily,1,$day) }
  }
  $sheet = [pscustomobject]@{ TestValue=$rangeValue; LastAddress='' }
  $sheet | Add-Member -MemberType ScriptMethod -Name Range -Value {
    param($Address)
    $this.LastAddress = $Address
    return [pscustomobject]@{ Value2=$this.TestValue }
  }
  $result = Get-SolarCumulativeWorkbookResult -PlantWorksheet $sheet -WorkbookFullName '' -TargetDateValue $date -TargetDate $case.Date -ExpectedDailyValue $case.Daily
  Assert-Equal $result.month.complete $true ($case.Date + ' month complete')
  Assert-Equal $result.month.total ($case.Daily * $date.Day) ($case.Date + ' cumulative')
  Assert-Equal $sheet.LastAddress ('F55:' + (ConvertTo-ExcelColumnName (5 + $date.Day)) + '55') ($case.Date + ' range')
}
$sheet = [pscustomobject]@{ Data=@{ C51='#1 CFBC BLR(Totalizer)'; F51=0; C52='#2 CFBC BLR(Totalizer)'; F52=$null; C286='Wrong label'; F286=999 } }
$sheet | Add-Member -MemberType ScriptMethod -Name Range -Value { param($Address) return [pscustomobject]@{ Value2=$this.Data[$Address] } }
Assert-Equal (Read-DailyPlantNumber $sheet F 51 '#1 CFBC BLR(Totalizer)' 'unitOneProduction') 0 'zero production'
Assert-Equal (Read-DailyPlantNumber $sheet F 52 '#2 CFBC BLR(Totalizer)' 'unitTwoProduction') $null 'blank stays blank'
Assert-Equal (Read-DailyPlantNumber $sheet F 286 'Day Silo' 'organicDaySilo') $null 'wrong row label does not leak value'
Assert-Equal $fieldWarnings.Count 1 'invalid cell is reported independently'
[Console]::WriteLine('PASS: Daily reader PowerShell syntax and actual scalar/array, month/year boundary, solar cumulative, zero/blank cell tests. No Excel or company files opened.')
