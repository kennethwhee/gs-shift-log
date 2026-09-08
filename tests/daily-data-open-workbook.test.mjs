import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const helperUrl = new URL('../local-tools/ois-agent/daily-data-open-workbook.ps1', import.meta.url);
const helper = readFileSync(helperUrl, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const withoutComments = helper.replace(/<#.*?#>/gs, '').replace(/^\s*#.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');
const section = (name, next) => {
  const begin = helper.indexOf(`function ${name}`);
  assert.ok(begin >= 0, `missing helper ${name}`);
  const end = next ? helper.indexOf(`function ${next}`, begin + 1) : helper.length;
  assert.ok(end > begin, `missing boundary ${next}`);
  return helper.slice(begin, end);
};

test('daily workbook discovery enumerates all same-session Excel PIDs and prioritizes workbook NativeOM windows', () => {
  assert.match(helper, /Get-Process -Name EXCEL/);
  assert.match(helper, /foreach \(\$excelProcess in \$processes\)/);
  assert.match(helper, /\$excelProcess\.SessionId -ne \$sessionId/);
  assert.match(helper, /EnumWindows\(/);
  assert.match(helper, /EnumChildWindows\(/);
  assert.match(helper, /childPid == \(uint\)processId/);
  assert.match(helper, /"EXCEL7"/);
  assert.match(helper, /"XLMAIN"/);
  assert.match(helper, /children\.AddRange\(main\)/);
  assert.doesNotMatch(withoutComments, /GetActiveObject|GetObject\(|ActiveWorkbook|ActiveSheet/);
  const attachment = section('Get-DailyDataProcessConnection', 'Resolve-DailyDataOpenWorkbook');
  assert.match(attachment, /Get-DailyDataExcelProcessId \$application\) -ne \$ProcessId/);
});

test('open workbook helper is read only and never saves, refreshes, recalculates or terminates any Excel', () => {
  assert.doesNotMatch(withoutComments, /\.(?:Close|Quit|Save|SaveAs|SaveCopyAs|Calculate|CalculateFull|CalculateFullRebuild|RefreshAll|Open)\s*\(/i);
  assert.doesNotMatch(withoutComments, /Stop-Process|taskkill|Start-Process|New-Object -ComObject|Terminate\(|Kill\(/i);
  assert.doesNotMatch(withoutComments, /\.(?:Value2?|Formula2?|DisplayAlerts|Visible|Calculation|EnableEvents|ScreenUpdating)\s*=/i);
});

test('month selection uses the requested date and an exact normalized filename; duplicate process/path targets fail', () => {
  const names = section('Get-DailyDataExpectedWorkbookName', 'Select-DailyDataWorkbookMatch');
  assert.match(names, /TryParseExact\(\$TargetDate, 'yyyy-MM-dd'/);
  assert.match(names, /ToString\('yy\.MM'/);
  assert.match(names, /일일DATA관리\.xlsx/);
  assert.doesNotMatch(names, /DateTime\]::Now|Get-Date|Today/);
  const selection = section('Select-DailyDataWorkbookMatch', 'Get-DailyDataExcelProcessId');
  assert.match(selection, /StringComparison\]::OrdinalIgnoreCase/);
  assert.match(selection, /NormalizationForm\]::FormC/);
  assert.match(selection, /\$candidate\.ProcessId \+ '\|'/);
  assert.match(selection, /\$matches\.Count -gt 1/);
  assert.match(selection, /\$matches\.Count -eq 0/);
  assert.doesNotMatch(selection, /-like|-match|Select-Object -First/);
});

test('busy target is blocking while an inaccessible unrelated PDF instance remains a recorded discovery warning', () => {
  const resolver = section('Resolve-DailyDataOpenWorkbook', 'Assert-DailyDataOpenWorkbookSelector');
  assert.match(resolver, /FindProcessWindowTitles\(\$processId\)/);
  assert.match(resolver, /\$targetTitleSeen -or \$knownTarget/);
  assert.match(resolver, /\$errors\.Add\(\$_\.Exception\.Message\)/);
  assert.match(resolver, /\$warnings\.Add\(\$_\.Exception\.Message\)/);
  assert.match(resolver, /\$skippedIds\.Add\(\$processId\)/);
  assert.match(resolver, /DiscoveryWarnings=\$warnings\.ToArray\(\)/);
  assert.match(resolver, /SkippedProcessIds=\$skippedIds\.ToArray\(\)/);
  assert.match(resolver, /if \(\$errors\.Count -gt 0\) \{ throw/);
  assert.match(resolver, /그 창을 한 번 선택/);
  assert.doesNotMatch(resolver, /모두 닫|창만 남기/);
});

test('COM retry and cleanup are bounded and transfer only the selected application and workbook references', () => {
  const retry = section('Invoke-DailyDataComRead', 'Get-DailyDataExpectedWorkbookName');
  assert.match(retry, /\$readAttempt -lt 3/);
  assert.match(retry, /-2147418111, -2147417846, -2146777998/);
  assert.match(retry, /Start-Sleep -Milliseconds 200/);
  const attach = section('Get-DailyDataProcessConnection', 'Resolve-DailyDataOpenWorkbook');
  assert.match(attach, /\$attachAttempt -lt 2/);
  assert.match(attach, /finally \{/);
  assert.match(attach, /Release-DailyDataOpenCom \$nativeObject/);
  const resolver = section('Resolve-DailyDataOpenWorkbook', 'Assert-DailyDataOpenWorkbookSelector');
  assert.match(resolver, /\$countBefore -ne \$countAfter/);
  assert.match(resolver, /StartTime\.ToUniversalTime\(\)\.Ticks -ne \$startTicks/);
  assert.match(resolver, /\$currentFullName/);
  assert.match(resolver, /ReferenceEquals\(\$book, \$selected\.Workbook\)/);
  assert.match(resolver, /ReferenceEquals\(\$connection, \$selected\.Connection\)/);
  assert.match(resolver, /Release-DailyDataOpenCom \$connection\.Workbooks/);
  assert.match(resolver, /Release-DailyDataOpenCom \$connection\.Excel/);
  assert.match(helper, /return ,\$value/);
});

test('validation compiles NativeOM in memory and runs month rollover and selector assertions without invoking discovery', () => {
  const initializer = section('Initialize-DailyDataNativeOm', 'Release-DailyDataOpenCom');
  assert.match(initializer, /Add-Type -TypeDefinition \$script:DailyDataNativeOmSource/);
  assert.doesNotMatch(initializer, /OutputAssembly|OutputType|\.dll['"]/);
  const validation = helper.slice(helper.lastIndexOf('if ($ValidateOnly)'));
  assert.match(validation, /Parser\]::ParseFile/);
  assert.match(validation, /Initialize-DailyDataNativeOm/);
  assert.match(validation, /Assert-DailyDataOpenWorkbookSelector/);
  assert.doesNotMatch(validation, /Resolve-DailyDataOpenWorkbook|Get-DailyDataProcessConnection|Get-Process|GetNativeObject/);
  for (const date of ['2026-08-31', '2026-09-01', '2026-12-31', '2027-01-01', '2028-02-29', '2026-02-29']) {
    assert.ok(helper.includes(date), `missing Windows semantic case ${date}`);
  }
});

const powerShellNames = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];
const powerShell = powerShellNames.find(name => spawnSync(name, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', timeout: 15000 }).status === 0);
test('actual PowerShell parses helper, compiles NativeOM and executes semantic month/selection assertions', { skip: !powerShell && 'PowerShell is unavailable; installer executes helper -ValidateOnly on Windows' }, () => {
  const result = spawnSync(powerShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(helperUrl), '-ValidateOnly'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS:/);
});
