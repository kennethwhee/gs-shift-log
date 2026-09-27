import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const helperUrl = new URL('../local-tools/ois-agent/daily-data-open-workbook.ps1', import.meta.url);
const helper = readFileSync(helperUrl, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
// Discovery remains read-only; the appended hidden fallback has its own
// ownership and read-only checks in daily-data-open-workbook.test.mjs.
const discoveryHelper = helper.split('# [COFIRING_ORGANIC_HIDDEN_EXCEL_V1]')[0];
const withoutComments = discoveryHelper.replace(/<#.*?#>/gs, '').replace(/^\s*#.*$/gm, '').replace(/^\s*\/\/.*$/gm, '');

function section(name, next) {
  const begin = helper.indexOf(`function ${name}`);
  assert.ok(begin >= 0, `missing helper ${name}`);
  const end = helper.indexOf(`function ${next}`, begin + 1);
  assert.ok(end > begin, `missing boundary ${next}`);
  return helper.slice(begin, end);
}

test('all distinct NativeOM Excel applications in one PID are returned, not only the first connection', () => {
  const discovery = section('Get-DailyDataProcessConnections', 'Get-DailyDataWorkbookCandidatesFromConnection');
  assert.match(discovery, /foreach \(\$nativeHwnd in \$windows\)/);
  assert.match(discovery, /Get-DailyDataComIdentity -Value \$application/);
  assert.match(discovery, /\$seenApplications\.Contains\(\$applicationIdentity\)/);
  assert.match(discovery, /\$connections\.Add\(\$connection\)/);
  assert.match(discovery, /return \$connections\.ToArray\(\)/);
  assert.doesNotMatch(discovery, /return\s+\$connection\b/);
});

test('COM application identity is acquired and released without changing Excel', () => {
  const identity = section('Get-DailyDataComIdentity', 'Get-DailyDataProcessConnections');
  assert.match(identity, /Marshal\]::GetIUnknownForObject\(\$Value\)/);
  assert.match(identity, /Marshal\]::Release\(\$unknown\)/);
  assert.match(helper, /GsDailyDataOpenWorkbookNativeOmV2/);
});

test('resolver owns every connection before it scans each Workbooks collection', () => {
  const resolver = section('Resolve-DailyDataOpenWorkbook', 'Assert-DailyDataOpenWorkbookSelector');
  assert.match(resolver, /\$processConnections = @\(Get-DailyDataProcessConnections -ProcessId \$processId -DiscoveryState \$discoveryState\)/);
  const ownership = resolver.indexOf('foreach ($connection in @($processConnections)) { $connections.Add($connection) }');
  const scan = resolver.indexOf('Get-DailyDataWorkbookCandidatesFromConnection');
  const selection = resolver.indexOf('Select-DailyDataWorkbookMatch');
  assert.ok(ownership >= 0 && scan > ownership && selection > scan, 'connections must be owned, scanned, then selected');
  assert.match(resolver, /\$knownTargetInConnection/);
});

test('partial NativeOM attachment failures remain visible without treating XLMAIN fallbacks as failed workbooks', () => {
  const attach = section('Get-DailyDataProcessConnections', 'Get-DailyDataWorkbookCandidatesFromConnection');
  assert.match(attach, /IsWorkbookWindow\(\$nativeHwnd\)/);
  assert.match(attach, /GetRootWindowTitle\(\$nativeHwnd\)/);
  assert.match(attach, /\$DiscoveryState\.Failures\.Add\(\$attachFailure\)/);
  const resolver = section('Resolve-DailyDataOpenWorkbook', 'Assert-DailyDataOpenWorkbookSelector');
  assert.match(resolver, /foreach \(\$attachFailure in \$discoveryState\.Failures\)/);
  assert.match(resolver, /if \(\$failureNamesTarget\) \{ \$errors\.Add/);
  assert.ok(resolver.includes('(?::[0-9]+)?'), 'Excel New Window :1/:2 captions must be recognized');
});

test('candidate identity distinguishes separate applications in one PID and validation covers a later connection', () => {
  const selector = section('Select-DailyDataWorkbookMatch', 'Get-DailyDataExcelProcessId');
  assert.match(selector, /ConnectionIdentity/);
  assert.match(selector, /'PID:' \+ \[string\]\$candidate\.ProcessId/);
  const validationStart = discoveryHelper.indexOf('function Assert-DailyDataOpenWorkbookSelector');
  const validation = discoveryHelper.slice(validationStart, discoveryHelper.lastIndexOf('if ($ValidateOnly)'));
  assert.match(validation, /Identity='validation:first'/);
  assert.match(validation, /Identity='validation:later'/);
  assert.match(validation, /같은 PID의 뒤쪽 NativeOM 연결 대상 선택 검사 실패/);
  assert.match(validation, /같은 PID의 서로 다른 Excel 연결 중복 대상 허용/);
});

test('a partial target scan preserves evidence when a later COM property read fails', () => {
  const scan = section('Get-DailyDataWorkbookCandidatesFromConnection', 'Resolve-DailyDataOpenWorkbook');
  assert.match(scan, /AllowEmptyCollection/);
  assert.match(scan, /\$ScanState\.TargetObserved = \$true/);
  assert.ok(scan.indexOf('$ScanState.TargetObserved = $true') < scan.indexOf('$book.FullName'));
  const resolver = section('Resolve-DailyDataOpenWorkbook', 'Assert-DailyDataOpenWorkbookSelector');
  assert.match(resolver, /-ScanState \$scanState/);
  assert.match(resolver, /\$knownTargetInConnection = \[bool\]\$scanState\.TargetObserved/);
});

test('both non-enumeration boundaries remain and Excel is never opened, saved, recalculated, closed, or terminated', () => {
  assert.match(helper, /\$books = Invoke-DailyDataComRead -Read \{ ,\$application\.Workbooks \}/);
  assert.match(helper, /return ,\$value/);
  assert.doesNotMatch(withoutComments, /\.(?:Close|Quit|Save|SaveAs|SaveCopyAs|Calculate|CalculateFull|CalculateFullRebuild|RefreshAll|Open)\s*\(/i);
  assert.doesNotMatch(withoutComments, /Stop-Process|taskkill|Start-Process|CloseMainWindow|WaitForExit|New-Object -ComObject|Terminate\(|Kill\(/i);
  assert.doesNotMatch(withoutComments, /\.(?:Value2?|Formula2?|DisplayAlerts|Visible|Calculation|EnableEvents|ScreenUpdating)\s*=/i);
});

const powerShellNames = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh'];
const powerShell = powerShellNames.find(name => spawnSync(name, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', timeout: 15000 }).status === 0);
test('Windows validation selects the target from the later fake NativeOM connection', { skip: !powerShell && 'PowerShell is unavailable; installer runs this on the company Windows PC' }, () => {
  const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', ...(process.platform === 'win32' ? ['-STA'] : []), '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(helperUrl), '-ValidateOnly'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS:/);
});
