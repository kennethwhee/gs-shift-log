import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Static regression checks for the shipped PowerShell package. These checks do
// not execute PowerShell, Windows process APIs, Excel COM, or DataPARC.
const controller = (await readFile(new URL(
  "../local-tools/ois-agent/organic-silo-dataparc.ps1", import.meta.url
), "utf8")).replace(/^\uFEFF/, "");
const payloads = [...controller.matchAll(/\$embeddedWorkerBase64\s*=\s*'([A-Za-z0-9+/=]+)'/g)];
assert.equal(payloads.length, 1, "exactly one nonempty worker payload is required");
const worker = Buffer.from(payloads[0][1], "base64").toString("utf8");

test("static reader contract queries only the selected day and three fixed Silo tags", () => {
  assert.match(worker, /\$queryDates\s*=\s*@\(\$targetDate\)/);
  assert.equal((worker.match(/Tag='GSPOGE\.ABB_DCS\.[^']+'/g) || []).length, 3);
  assert.match(worker, /104SDF01CW001XQ01\/PLOT/);
  assert.match(worker, /003SDF01CW001XQ01\/PLOT/);
  assert.match(worker, /003SDF02CW001XQ01\/PLOT/);
  assert.doesNotMatch(worker, /referenceValues|referenceChecks|referenceMatched|2026-08-0[12]/);
  assert.match(worker, /foreach\s*\(\$attribute\s+in\s*@\('Value','QualStr','Time'\)\)/);
  assert.ok(worker.includes('\",\"End\",\"'));
  assert.match(worker, /\$samples\.Count\s+-eq\s+3/);
  assert.doesNotMatch(worker, /# __ORGANIC_(?:CONFIG|QUERY)_BLOCK__/);
  assert.doesNotMatch(worker, /__ORGANIC_PILOT_/);
});

test("static Excel ownership boundaries exclude active user COM and image-wide termination", () => {
  assert.match(worker, /Start-Process[^\n]+-ArgumentList\s+@\("\/x"\)[^\n]+-WindowStyle Hidden/);
  assert.match(worker, /FindNativeObjectWindows\(\$ExcelProcessId\)/);
  assert.match(worker, /\(Get-ProbeExcelProcessId \$candidateApplication\) -eq \$ExcelProcessId/);
  assert.match(worker, /\$attachedExcelPid -ne \$ownedExcelPid/);
  assert.doesNotMatch(worker + controller, /GetActiveObject\s*\(|Stop-Process\s+-Name\s|taskkill(?:\.exe)?\s|\.Workbooks\.Open\s*\(/i);
  assert.doesNotMatch(worker, /\$baselineExcelProcesses\.Count\s+-(?:gt|ne)\s+1/);
  assert.match(worker, /Test-ProbeProcessSignatureSet \$baselineExcelSignatures/);
  assert.match(worker, /Test-ProbeProcessSignatureSet \$baselineHostSignatures/);
  assert.match(worker, /Test-OwnedProbeExcelIdentity \$ownedExcelPid \$ownedExcelStartTicks \$ownedExcelPath \$ownedExcelSessionId/);
  assert.match(controller, /Stop-ControllerSignature \$script:ownedExcel [^\n]+ -CheckParent/);
  assert.match(controller, /\$ProcessObject\.StartTime\.ToUniversalTime\(\)\.Ticks -eq \[long\]\$Signature\.StartTicks/);
  assert.match(controller, /\$ProcessObject\.SessionId -eq \[int\]\$Signature\.SessionId/);
  assert.match(controller, /\$cim\[0\]\.ParentProcessId -ne \[int\]\$Signature\.ParentProcessId/);
  assert.match(controller, /\$ownedExcelProcessPinned\.Dispose\(\)/);
});

test("static ownership writer retains the Windows PowerShell null-backup fix before Excel launch", () => {
  assert.match(worker, /\$backupPath = \$ownershipPath \+ "\.previous"/);
  assert.match(worker, /\[IO\.File\]::Replace\(\$temporaryPath, \$ownershipPath, \$backupPath\)/);
  assert.doesNotMatch(worker, /\[IO\.File\]::Replace\([^\n]+,\s*\$null\)/);
  const preflight = worker.indexOf("for ($ownershipCheck = 0;");
  const excelLaunch = worker.indexOf("$launchedExcelProcess = Start-Process");
  assert.ok(preflight > 0 && excelLaunch > preflight);
  assert.match(worker, /\$ownershipCheck -lt 3/);
  assert.match(controller, /\$snapshot\.runId -ne \$runId/);
  assert.match(controller, /\$snapshot\.worker\.StartTicks -ne \[long\]\$workerSignature\.StartTicks/);
});

test("static worker rejects bad numbers, quality and out-of-period times before reporting", () => {
  assert.match(worker, /\[double\]::IsNaN\(\$number\) -or \[double\]::IsInfinity\(\$number\)/);
  assert.match(worker, /\$valid = \(\$null -ne \$value -and \$value -ge 0\)/);
  assert.match(worker, /\$qualityGood = Test-OrganicQualityGood \$qualityText/);
  assert.match(worker, /\$qualityTokens\.Count -ne 2/);
  assert.match(worker, /\$returnedTime -ge \$targetDay -and \$returnedTime -le \$targetDay\.AddDays\(1\)/);
  assert.match(worker, /if \(-not \$valid -or -not \$timePresent\) \{ \$allValuesValid = \$false \}/);
  assert.match(worker, /ok=\(\$allReturned -and \$allValuesValid -and \$allQualitiesGood -and \$targetComplete/);
  assert.match(worker, /\$targetValues\['organicSiloTotal'\] = \[double\]\$targetValues\.organicDaySilo \+ \[double\]\$targetValues\.organicStorageSiloA \+ \[double\]\$targetValues\.organicStorageSiloB/);
});

test("static result emission and controller success remain gated by completed process cleanup", () => {
  const workerFinally = worker.indexOf('} finally {\n  Write-ProbeStage "조회용 Excel·DataPARC Host 정리"');
  const workerCleanupFailure = worker.indexOf("if ($cleanupErrors.Count -gt 0) {", workerFinally);
  const workerVerified = worker.indexOf('$finalResult["cleanupVerified"] = $true', workerCleanupFailure);
  const workerResult = worker.indexOf("$resultMarker + ($finalResult | ConvertTo-Json", workerVerified);
  assert.ok(workerFinally > 0 && workerCleanupFailure > workerFinally && workerVerified > workerCleanupFailure && workerResult > workerVerified);
  assert.match(worker, /\$queryWorkbook\.Close\(\$false\)/);
  const cleanup = controller.lastIndexOf("    Invoke-ControllerCleanup");
  const release = controller.lastIndexOf("$controllerMutex.ReleaseMutex()");
  const report = controller.lastIndexOf("    Save-ControllerReport");
  assert.ok(cleanup > 0 && release > cleanup && report > release);
  assert.match(controller, /\$workerExitCode -eq 0 -and -not \$timedOut -and -not \$controllerFailure -and \$cleanupErrors\.Count -eq 0/);
  assert.match(controller, /\[string\]\$rawResult\.runId -eq \$runId/);
  assert.match(controller, /if \(\$success\) \{ exit 0 \}\s+exit 1/);
});

test("static controller keeps the independent watchdog and shared Blower mutex", () => {
  const mutex = "Local\\GSShiftLog.BlowerRuntimeDataParcHiddenExcelNativeOmV1";
  assert.ok(worker.includes(mutex) && controller.includes(mutex));
  assert.match(worker, /\$controllerOwnsMutex = Test-ProbeControllerParent/);
  assert.match(controller, /\$timeoutSeconds = 240/);
  assert.match(controller, /\$deadline = \$startedAt\.AddSeconds\(\$timeoutSeconds\)/);
  assert.match(controller, /if \(\[datetime\]::UtcNow -ge \$deadline\)\s*\{\s*\$timedOut = \$true/);
  assert.match(controller, /-STA/);
  const validation = controller.indexOf("  if ($ValidateOnly) {");
  const processStart = controller.indexOf("  $controllerProcess = Get-Process");
  assert.ok(validation > 0 && processStart > validation);
  assert.match(controller, /Language\.Parser\]::ParseInput\(\$workerText/);
});
