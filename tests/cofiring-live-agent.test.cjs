'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{EventEmitter}=require('events'),{PassThrough}=require('stream'),{gunzipSync}=require('zlib');
const {createCofiringCollector,READER_SHA256}=require('../local-tools/ois-agent/cofiring-dataparc-agent.js');
const fixture=JSON.parse(gunzipSync(fs.readFileSync(process.env.COFIRING_V7_TEST_FIXTURE || path.join(__dirname,'fixtures/cofiring-live-v7.json.gz'))))['2026-09-08'];
const clone=x=>JSON.parse(JSON.stringify(x));
const request=()=>({id:crypto.randomUUID(),targetDate:'2026-09-08',requestType:'cofiring_daily',status:'processing',agentId:'test-pc',startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*60000).toISOString()});
function harness({code=0,report=fixture,delayed=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cofiring-agent-test-')),calls=[],progress=[];let release;
 const collect=createCofiringCollector({platform:'win32',runsDirectory:dir,log:()=>{},spawnProcess:(exe,args,options)=>{
  calls.push({exe,args,options});const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=123;
  release=()=>{const out=args[args.indexOf('-OutputDirectory')+1];if(report)fs.writeFileSync(path.join(out,'pilot-report.json'),JSON.stringify(report));child.stdout.write('[진행] TAG 3/10 unit1CoalB1 · 동일 응답 3/3\n');child.stdout.write('[진행] 조회용 Excel·DataPARC Host 정리\n');setImmediate(()=>child.emit('close',code,null));};
  if(!delayed)setImmediate(release);return child;
 }});
 return {dir,calls,progress,collect:r=>collect({agentId:'test-pc'},r,{postProgress:async p=>progress.push(p)}),release:()=>release(),clear:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
test('V7 controller immutable and same daily script/fixture paths retained',()=>{const p=path.join(__dirname,'../local-tools/ois-agent/cofiring-daily-v7/test-cofiring-dataparc-daily-v7.ps1');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),READER_SHA256);});
test('mocked controller returns V7-format report through Agent adapter; no shell and one selected date',async()=>{
 const h=harness();try{const r=request(),out=await h.collect(r);assert.equal(out.requestId,r.id);assert.equal(out.report.noDataRows,54);assert.equal(h.calls.length,1);const call=h.calls[0];assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);assert.equal(call.args[call.args.indexOf('-Date')+1],'2026-09-08');assert.equal(out.report.baselineExcel,undefined);assert.ok(h.progress.some(p=>p.phase==='cleanup'));}finally{h.clear();}
});
test('unclaimed/wrong-owner/expired and invalid date never start PowerShell',async()=>{
 const h=harness();try{for(const bad of [{status:'pending'},{agentId:'other'},{id:'invalid'},{expiresAt:'2021-01-01'},{targetDate:'2026-02-29'},{requestType:'daily_data_excel'}])await assert.rejects(h.collect({...request(),...bad}));assert.equal(h.calls.length,0);}finally{h.clear();}
});
test('a pending controller retains the local lock until close, preventing simultaneous collectors',async()=>{
 const h=harness({delayed:true});try{const p=h.collect(request());await assert.rejects(h.collect(request()),/이전 혼소율/);assert.equal(h.calls.length,1);h.release();await p;}finally{h.clear();}
});
test('unsafe cleanup blocks later queries persistently, failed data is never promoted',async()=>{
 const report=clone(fixture);report.cleanupVerified=false;const h=harness({report});try{await assert.rejects(h.collect(request()));assert.ok(fs.existsSync(path.join(h.dir,'cleanup-blocked.json')));await assert.rejects(h.collect(request()),/정리가 확인/);assert.equal(h.calls.length,1);}finally{h.clear();}
});
test('query failure with independently verified cleanup does not create an unsafe-cleanup block',async()=>{
 const h=harness({code:1});try{await assert.rejects(h.collect(request()));assert.equal(fs.existsSync(path.join(h.dir,'cleanup-blocked.json')),false);}finally{h.clear();}
});
test('missing final report fails closed and no controller kill/process-tree termination exists',async()=>{
 const h=harness({report:null});try{await assert.rejects(h.collect(request()));assert.ok(fs.existsSync(path.join(h.dir,'cleanup-blocked.json')));}finally{h.clear();}
 const source=fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/cofiring-dataparc-agent.js'),'utf8');assert.doesNotMatch(source,/\.kill\(|taskkill|Stop-Process/);
});
