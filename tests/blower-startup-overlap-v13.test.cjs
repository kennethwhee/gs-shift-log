'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Source/contract verification only: does not load or start the Agent, PowerShell or Excel.
const { restoreReviewedCompilerSource } = require('./helpers/blower-nativeom-temp-v14-baseline.cjs');
const source = restoreReviewedCompilerSource(fs.readFileSync(path.join(__dirname, '../local-tools/ois-agent/ois-login.js'), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
// Reviewed original hash after BOM removal and CRLF normalization.
const baseSha256 = '1d0cba1037c814b44abbc0d61c6048d985cd51e9b7fd04d2b90e5f57b0dfac44';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const name = 'DATAPARC_BLOWER_RUNTIME_BATCH_POWERSHELL_SCRIPT';
const declaration = source.indexOf(`const ${name} =`);
const begin = source.indexOf('String.raw`', declaration) + 'String.raw`'.length;
const end = source.indexOf('`;', begin);
assert.ok(declaration >= 0 && begin > declaration && end > begin);
const batch = source.slice(begin, end);
const markerLabels = ['Excel COM 연결 완료', 'Excel 옵션 설정 완료', '초기 통합문서 정리 완료'];
const stripMarkers = text => markerLabels.reduce((value, label) => value.replace(`  Write-ProbeStage "${label}"\n`, ''), text);
const body = stripMarkers(batch);
const blockBegin = body.indexOf('if (-not ("GsBlowerRuntimeNativeOmV1" -as [type])) {');
const attachMarker = '  Write-ProbeStage "PID 고유 창에서 Excel COM 직접 연결"';
const blockEnd = body.indexOf(attachMarker, blockBegin);
assert.ok(blockBegin >= 0 && blockEnd > blockBegin);
const movedBlock = body.slice(blockBegin, blockEnd);

test('only the reviewed batch initialization move and three fixed stage markers change the complete Agent', () => {
  assert.ok(movedBlock.endsWith('\n}\n\n'));
  const originalBlock = movedBlock.slice(0, -1);
  const withoutMovedBlock = body.slice(0, blockBegin) + body.slice(blockEnd);
  const anchor = '\nfunction Get-ProbeExcelProcessId';
  assert.equal(withoutMovedBlock.split(anchor).length, 2);
  const restored = withoutMovedBlock.replace(anchor, originalBlock + anchor);
  assert.equal(hash(source.slice(0, begin) + restored + source.slice(end)), baseSha256,
    'All formulas, arithmetic, single-probe flow, shared co-firing/other Agent code and cleanup must be unchanged.');
});

test('compilation runs inside try after retained process identity is established and before COM use', () => {
  const anchors = ['try {\n  $probeMutex =', '$launchedExcelProcess = Start-Process', '[void]$launchedExcelProcess.Handle',
    '$ownedExcelPid =', '$ownedExcelStartTicks =', '$ownedExcelSessionId =', 'if (-not (Test-OwnedProbeExcelIdentity',
    'if (-not ("GsBlowerRuntimeNativeOmV1" -as [type])) {', '  Initialize-ProbeNativeOm $nativeOmTypeDefinition',
    '$excel = Wait-OwnedProbeExcelNativeObject', '$attachedExcelPid = Get-ProbeExcelProcessId $excel'];
  let previous = -1;
  for (const anchor of anchors) { const at = batch.indexOf(anchor, previous + 1); assert.ok(at > previous, anchor); previous = at; }
  assert.ok(movedBlock.includes('\n"@\n'), 'PowerShell here-string delimiter remains at column one');
});

test('early compiler failure still has an owned-handle cleanup and late Host verification path', () => {
  const compile = batch.indexOf('  Initialize-ProbeNativeOm $nativeOmTypeDefinition');
  const cleanup = batch.indexOf('} catch {\n  $queryFailure = $_.Exception\n} finally {', compile);
  assert.ok(cleanup > compile);
  const tail = batch.slice(cleanup);
  assert.match(tail, /if \(\$ownedExcelPid -gt 0\)/);
  assert.match(tail, /Test-OwnedProbeExcelIdentity \$ownedExcelPid \$ownedExcelStartTicks \$ownedExcelPath \$ownedExcelSessionId/);
  assert.match(tail, /Wait-ProbePinnedProcessExit \$launchedExcelProcess 2000/);
  assert.match(tail, /if \(\$null -eq \$ownedHostSnapshot -and \$ownedExcelPid -gt 0\)/);
  assert.match(tail, /New-ProbeHostSignature \$lateOwnedHosts\[0\] \$ownedExcelPid \$ownedExcelStartTicks \$ownedExcelSessionId/);
  assert.ok(tail.indexOf('if ($null -ne $queryFailure) { throw $queryFailure }') < tail.indexOf('$resultMarker +'));
});

test('baseline helpers and cleanup without a COM object do not require the uncompiled NativeOM type', () => {
  for (const name of ['Resolve-ProbeExcelExecutable', 'New-ProbeProcessSignature', 'Test-OwnedProbeExcelIdentity', 'Get-ProbeDataParcHosts', 'New-ProbeHostSignature', 'Test-ProbeHostSignature', 'Test-ProbeExactProcessUniverse', 'Wait-ProbePinnedProcessExit']) {
    const from = batch.indexOf(`function ${name}`);
    const nextFunction = batch.indexOf('\nfunction ', from + 1);
    const to = nextFunction >= 0 ? nextFunction : batch.indexOf('\n$allowedProbeAssetTags', from + 1);
    assert.ok(from >= 0 && to > from, name);
    assert.doesNotMatch(batch.slice(from, to), /GsBlowerRuntimeNativeOmV1|Get-ProbeExcelProcessId|Wait-OwnedProbeExcelNativeObject/, name);
  }
});

test('new stage markers delimit COM/PID attachment, options, and startup-workbook cleanup without raw values', () => {
  for (const label of markerLabels) assert.equal(batch.split(`Write-ProbeStage "${label}"`).length, 2);
  assert.match(batch, /Write-ProbeStage "Excel COM 연결 완료"\n  \$excel.Visible = \$false/);
  assert.match(batch, /\$excel.EnableEvents = \$false\n\n  Write-ProbeStage "Excel 옵션 설정 완료"/);
  assert.match(batch, /Release-ProbeCom \$startupWorkbooks\n  }\n\n  Write-ProbeStage "초기 통합문서 정리 완료"\n  Write-ProbeStage "DataPARC Add-In 자동 시작 확인"/);
});
