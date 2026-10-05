'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {restoreStartupV3,profile}=require('./helpers/cofiring-startup-v3-preservation.cjs');
const root=path.resolve(__dirname,'..'),workerPath=path.join(root,'local-tools/ois-agent/cofiring-period-v5/cofiring-period-worker-v5.ps1');
const bytes=fs.readFileSync(workerPath),text=bytes.toString('utf8');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('new worker reverses byte-exactly to the reviewed pre-V3 runtime without changing old baselines',()=>{
 assert.equal(sha(bytes),profile.productionWorkerSha256);
 const original=restoreStartupV3(text);
 assert.equal(sha(Buffer.from('\uFEFF'+original.replace(/\n/g,'\r\n'))),profile.previousWorkerSha256);
 assert.equal(profile.previousWorkerSha256,'a84b83ea1f024e779414ac647d3ad3dda7b0bc19888e91a6b18f90b53d1413aa');
 assert.equal(restoreStartupV3(original),original);
 assert.equal(restoreStartupV3(text+'\n# unrelated edit'),original+'\n# unrelated edit');
 assert.throws(()=>restoreStartupV3(text.replace("Operation 'Load.DataPARC.Workbooks.Open'","Operation 'Changed.Open'")),/mismatch/);
});
test('production uses only the successful trial Open path and keeps add-in/security settings intact',()=>{
 assert.doesNotMatch(text,/RunAutoMacros\(|\.Installed\s*=|\$Application\.AutomationSecurity\s*=|\$excel\.AutomationSecurity\s*=/);
 assert.match(text,/\$books\.Open\(\$file\.path,0,\$true\)/);
 assert.match(text,/-Operation 'Load\.DataPARC\.Workbooks\.Open' -NoRetry/);
 assert.match(text,/COFIRING_XLSX_ADDIN_STARTUP_V3/);
 assert.match(text,/Start-Process -FilePath \$ownedExcelPath -ArgumentList @\("\/x", \$documentSeedArgument\)/);
 const close=text.indexOf("Start-CofiringWorkerPhase 'setupStartupWorkbookClose'"),host=text.indexOf('  $ownedHostSnapshot = New-ProbeHostSignature $ownedHostCim');
 assert(close>host&&host>text.indexOf('  Invoke-CofiringDataParcLoad $excel'));
});
const names=process.platform==='win32'?['powershell.exe','pwsh.exe']:[process.env.COFIRING_TEST_POWERSHELL||'pwsh'];
const ps=names.find(n=>spawnSync(n,['-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8',timeout:15000}).status===0);
for(const name of ['cofiring-startup-v3','cofiring-addin-state-v3','cofiring-addin-load-v3']){
 test('actual PowerShell '+name+' semantics without Excel',{skip:!ps&&'PowerShell unavailable'},()=>{
  const r=spawnSync(ps,['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'helpers',name+'.ps1')],{encoding:'utf8',timeout:30000});
  assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/PASS:/);
 });
}
