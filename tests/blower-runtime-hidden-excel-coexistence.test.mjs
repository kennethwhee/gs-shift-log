import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agent = await readFile(
  new URL("../local-tools/ois-agent/ois-login.js", import.meta.url),
  "utf8"
);

function runtimePowerShellSource(source) {
  const declaration =
    "const DATAPARC_BLOWER_RUNTIME_PROBE_POWERSHELL_SCRIPT =";
  const start = source.indexOf(declaration);
  assert.ok(start >= 0, "runtime PowerShell bridge is missing");
  const end = source.indexOf(
    "DataPARC 증기 생산량 자동 조회",
    start
  );
  assert.ok(end > start, "runtime PowerShell bridge end marker is missing");
  return source.slice(start, end);
}

const bridge = runtimePowerShellSource(agent);

test("runtime probe launches its own Excel and attaches by PID/HWND NativeOM", () => {
  assert.match(bridge, /Start-Process[\s\S]*-ArgumentList\s+@\("\/x"\)/);
  assert.match(bridge, /AccessibleObjectFromWindow/);
  assert.match(bridge, /OBJID_NATIVEOM/);
  assert.match(bridge, /EXCEL7/);
  assert.match(bridge, /Wait-OwnedProbeExcelNativeObject/);
  assert.match(bridge, /Get-ProbeExcelProcessId/);
  assert.doesNotMatch(
    bridge,
    /GetActiveObject\s*\(\s*["']Excel\.Application["']\s*\)/,
    "runtime probe must never attach to the user's active Excel through ROT"
  );
});

test("runtime probe preserves baseline Excel/DataPARC and only force-stops verified owned PIDs", () => {
  assert.match(bridge, /baselineExcelSignatures/);
  assert.match(bridge, /baselineHostSignatures/);
  assert.match(bridge, /Test-ProbeProcessSignatureSet/);
  assert.match(bridge, /Test-OwnedProbeExcelIdentity/);
  assert.match(bridge, /Test-ProbeHostSignature/);
  assert.match(bridge, /Stop-Process\s+-Id\s+\$ownedExcelPid\s+-Force/);
  assert.match(bridge, /Stop-Process\s+-Id\s+\(\[int\]\$ownedHostSnapshot\.ProcessId\)\s+-Force/);
  assert.match(bridge, /기존 사용자 Excel 프로세스가 조회 중 변경되거나 종료되었습니다/);
  assert.match(bridge, /기존 사용자 DataPARC Host가 조회 중 변경되거나 종료되었습니다/);
});

test("runtime probe supports the two field-validated baseline modes and fails closed beyond them", () => {
  assert.match(bridge, /\$baselineExcelProcesses\.Count\s+-gt\s+1/);
  assert.doesNotMatch(bridge, /\$baselineExcelProcesses\.Count\s+-ne\s+1/);
  assert.match(bridge, /기존 Excel 인스턴스 0~1개에서만 검증/);
  assert.match(bridge, /excelAttachMethod\s*=\s*"pid_hwnd_objid_nativeom"/);
  assert.match(bridge, /collectorRevision\s*=\s*"nativeom-coexistence-v1"/);
});

test("runtime formula/result contract remains unchanged while process timeout covers startup and cleanup", () => {
  assert.ok(bridge.includes('1,"=",,"H",200,TRUE'));
  assert.ok(bridge.includes('1,"=",,"H")'));
  assert.match(bridge, /\$intervalCount\s+-ge\s+200/);
  assert.match(bridge, /fnAtTimeArray\s*\(/);
  assert.match(bridge, /schemaVersion\s*=\s*1/);
  assert.match(bridge, /requestType\s*=\s*"blower_runtime_probe"/);
  assert.match(
    agent,
    /const\s+BLOWER_RUNTIME_PROBE_PROCESS_TIMEOUT\s*=\s*300000\s*;/
  );
});
