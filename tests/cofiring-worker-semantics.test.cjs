'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const names=process.platform==='win32'?['powershell.exe','pwsh.exe']:['pwsh'];
const shell=names.find(name=>spawnSync(name,['-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()'],{timeout:15000,encoding:'utf8'}).status===0);
test('actual PowerShell verifies owned exit races and all 143 summary formulas without Excel or process operations',
  {skip:!shell&&'PowerShell unavailable; run the Windows verifier'},()=>{
    const result=spawnSync(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'helpers/cofiring-worker-semantics.ps1')],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    assert.match(result.stdout,/OWNED EXIT PASS: 12/);
    assert.match(result.stdout,/FORMULA PASS: 143/);
  });
