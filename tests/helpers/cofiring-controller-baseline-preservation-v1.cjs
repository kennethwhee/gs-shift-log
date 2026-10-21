'use strict';
// Test-only inverse of the exact reviewed baseline-preservation change.
// Historical safety hashes stay unchanged; unrelated source text is retained.
const marker='COFIRING_CONTROLLER_BASELINE_OPTIONAL_PATH_V1';
const block="# COFIRING_CONTROLLER_BASELINE_OPTIONAL_PATH_V1\n# Baselines are pre-existing user processes, never cleanup targets. Some valid\n# Excel baselines do not expose Path. Always verify their pinned process identity;\n# compare Path only when the original snapshot supplied one. Owned-process and\n# termination checks continue to use the stricter Test-ControllerProcessObject.\nfunction Test-ControllerBaselineSignature($Signature) {\n  $process=$null\n  try {\n    if ($null -eq $Signature -or [int]$Signature.ProcessId -le 0 -or\n        [string]::IsNullOrWhiteSpace([string]$Signature.ProcessName) -or\n        [long]$Signature.StartTicks -le 0 -or $null -eq $Signature.SessionId) { return $false }\n    $process=Get-ControllerProcessById ([int]$Signature.ProcessId)\n    if ($null -eq $process) { return $false }\n    $handle=$process.Handle\n    $currentSession=$process.SessionId\n    if ($null -eq $handle -or [IntPtr]$handle -eq [IntPtr]::Zero -or $null -eq $currentSession) { return $false }\n    if ([int]$process.Id -ne [int]$Signature.ProcessId -or\n        -not [string]::Equals([string]$process.ProcessName, [string]$Signature.ProcessName, [StringComparison]::OrdinalIgnoreCase) -or\n        [long]$process.StartTime.ToUniversalTime().Ticks -ne [long]$Signature.StartTicks -or\n        [int]$currentSession -ne [int]$Signature.SessionId) { return $false }\n    if (-not [string]::IsNullOrWhiteSpace([string]$Signature.Path)) {\n      $currentPath=[string]$process.Path\n      if ([string]::IsNullOrWhiteSpace($currentPath) -or\n          -not [string]::Equals([IO.Path]::GetFullPath($currentPath), [IO.Path]::GetFullPath([string]$Signature.Path), [StringComparison]::OrdinalIgnoreCase)) { return $false }\n    }\n    return $true\n  } catch { return $false }\n  finally { if ($null -ne $process) { $process.Dispose() } }\n}\n\n";
const callBefore="      if (-not (Test-ControllerSignature $signature)) { $cleanupErrors.Add('기존 사용자 프로세스가 조회 중 변경되거나 종료되었습니다. PID='+[string]$signature.ProcessId) }";
const callAfter="      if (-not (Test-ControllerBaselineSignature $signature)) { $cleanupErrors.Add('기존 사용자 프로세스가 조회 중 변경되거나 종료되었습니다. PID='+[string]$signature.ProcessId) }";
function normalize(source) {
  if (typeof source!=='string') throw new TypeError('Controller source text required.');
  return source.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
}
function restoreControllerBaseline(source) {
  const text=normalize(source);
  if (!text.includes(marker)) return text;
  if (text.split(block).length-1!==1 || text.split(callAfter).length-1!==1) {
    throw new Error('Baseline controller preservation replacement mismatch.');
  }
  const restored=text.replace(block,'').replace(callAfter,callBefore);
  if (restored.includes(marker)) throw new Error('Baseline controller preservation marker mismatch.');
  return restored;
}
module.exports={restoreControllerBaseline,normalize};
