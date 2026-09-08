'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../maintenance/cofiring-core.js');
const api=require('../maintenance/cofiring-draft.js');
const source=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-draft.js'),'utf8');
const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-draft-reference.json'),'utf8'));
const clone=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class Element {
  constructor(attributes={}){this.attributes=attributes;this.dataset={};for(const [name,value]of Object.entries(attributes))if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;this.value=attributes.value||'';this.listeners={};this.disabled=false;this.hidden=false;this.textContent='';this.classList={add(){}};this._html='';this.children=[];}
  set innerHTML(value){this._html=value;this.children=[];for(const match of value.matchAll(/<[a-z][^>]*\bdata-cf-[^>]*>/g)){const attrs={};for(const attr of match[0].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]||'';this.children.push(new Element(attrs));}}
  get innerHTML(){return this._html;}
  querySelectorAll(selector){const match=/^\[([^=\]]+)(?:="([^\"]+)")?\]$/.exec(selector);return this.children.filter(child=>match&&Object.hasOwn(child.attributes,match[1])&&(match[2]===undefined||child.attributes[match[1]]===match[2]));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,callback){(this.listeners[type] ||= []).push(callback);}
  async fire(type,event={target:this}){for(const fn of this.listeners[type]||[])await fn(event);}
  click(){return this.fire('click');}
}
function harness({reference,fetch}={}){
  let calls=0;const container=new Element();const context=vm.createContext({CofiringCore:core,console,fetch:async(...args)=>{calls++;if(fetch)return fetch(...args);return {ok:true,json:async()=>clone(original)};}});
  vm.runInContext(source,context);
  const controller=context.CofiringDraft.mount(container,{reference});
  return {container,controller,find:s=>container.querySelector(`[data-cf-${s}]`),all:s=>container.querySelectorAll(`[data-cf-${s}]`),get calls(){return calls;}};
}
function pilot(){const reference=clone(original);reference.source.kind='dataparc_hidden_excel';return {kind:'cofiring_dataparc_pilot',status:'PASS',cleanupVerified:true,databaseWritten:false,productionReady:false,reference};}

function gapReport() {
  const day=core.dailyRange('2026-09-08'), runId='synthetic-gap-regression-not-live';
  const reference={schemaVersion:'cofiring-reference-v1',source:{kind:'dataparc_hidden_excel',qualityRecorded:true,runId},
    start:day.start,end:day.end,queryStart:day.queryStart,queryEnd:day.queryEnd,targetDate:day.targetDate,timeZone:'Asia/Seoul',mode:'daily',
    durationMinutes:1440,queryDurationMinutes:1441,boundaryCount:1441,stepSeconds:60,aggregation:'Start',
    timestamps:Array.from({length:1441},(_,i)=>new Date(day.startMs+i*60000).toISOString().replace('.000Z','Z')),
    coefficients:clone(original.coefficients),calorifics:clone(original.calorifics)};
  reference.series=core.requiredSeries.map((d,k)=>({id:d.id,unit:d.unit,fuel:d.fuel,tag:d.tag,queryTag:d.queryTag,unitOfMeasure:'ton',
    values:reference.timestamps.map((_,i)=>10000+k*100+i/8),qualities:reference.timestamps.map(()=>'Raw, Good'),returnedTimes:[...reference.timestamps]}));
  for (const index of [10,11,30]) { reference.series[4].values[index]=null;reference.series[4].qualities[index]='No Data, Bad'; }
  const tagSummary=reference.series.map(s=>{const missingTimes=reference.timestamps.filter((_,i)=>s.values[i]===null);return {key:s.id,tag:s.queryTag,expectedRows:1441,receivedRows:1441,validRows:1441-missingTimes.length,noDataRows:missingTimes.length,missingTimes,minuteDataComplete:missingTimes.length===0};});
  return {schemaVersion:2,pilotVersion:7,kind:'cofiring_dataparc_pilot',runId,status:'DATA_GAPS',start:'2026-09-08 00:00',end:'2026-09-09 00:00',targetDate:day.targetDate,
    queryStart:'2026-09-08 00:00',queryEnd:'2026-09-09 00:01',mode:'daily',timeZone:'Asia/Seoul',durationMinutes:1440,queryDurationMinutes:1441,boundaryCount:1441,
    dataValidated:false,executionSucceeded:true,resultReceived:true,timedOut:false,workerExitCode:0,completedTagCount:10,cleanupVerified:true,processCleanupVerified:true,
    safeToStartNextDay:true,databaseWritten:false,productionReady:false,cleanupErrors:[],reference,tagSummary,noDataRows:3,
    referenceComparison:{expectedSamples:14410,comparedSamples:10,mismatchSamples:0,matched:false},
    response:{rows:14410,shapeValid:true,readState:'READ_OK',complete:true,returnedRows:14410,valueRows:14407,noDataRows:3,errorRows:0,pendingRows:0,metadataPendingRows:0,otherPendingRows:0}};
}
test('completed V7 DATA_GAPS is displayable but never validated or reference-verified',()=>{
 const report=gapReport(),before=JSON.stringify(report),p=api.parseImportedReport(report);
 assert.equal(p.pilotVerified,true);assert.equal(p.hasDataGaps,true);assert.equal(p.referenceVerified,false);
 assert.equal(p.gapSummary.validSamples,14407);assert.equal(p.gapSummary.missingSamples,3);assert.equal(p.gapSummary.comparedSamples,10);
 assert.equal(JSON.stringify(report),before); // No flag rewriting, gap filling or source mutation.
 const result=core.analyzeDay(p.reference,{requireQuality:true,organic:{start:p.day.start,end:p.day.end,unit1:0,unit2:0}});
 assert.equal(result.units.unit1.bio.quantity,null);assert.equal(result.units.unit1.bio.referenceQuantity,180);
 assert.equal(result.units.unit1.ratios.total,null);assert.equal(result.units.unit2.coal.quantity,720);
 assert.equal(typeof result.units.unit2.ratios.total,'number');assert.equal(result.productionReady,false);assert.equal(result.databaseWritten,false);
});
for(const [name,change] of [
 ['legacy version',r=>r.pilotVersion=6],['not completed',r=>r.completedTagCount=9],['worker failure',r=>r.workerExitCode=1],
 ['cleanup absent',r=>r.cleanupVerified=false],['process cleanup absent',r=>r.processCleanupVerified=false],['cleanup errors',r=>r.cleanupErrors=['error']],
 ['unsafe continuation',r=>r.safeToStartNextDay=false],['timeout',r=>r.timedOut=true],['wrong run',r=>r.reference.source.runId='another-run'],
 ['database write',r=>r.databaseWritten=true],['operational promotion',r=>r.productionReady=true],['validated gap claim',r=>r.dataValidated=true],
 ['fake aggregate count',r=>r.response.valueRows=14410],['fake no-data count',r=>r.noDataRows=0],['pending response',r=>r.response.pendingRows=1],
 ['missing tag',r=>r.reference.series.pop()],['duplicate tag',r=>r.reference.series[1]=clone(r.reference.series[0])],
 ['wrong tag identity',r=>r.reference.series[0].queryTag='WRONG'],['short quality array',r=>r.reference.series[0].qualities.pop()],
 ['bad number',r=>r.reference.series[0].values[50]='1'],['negative',r=>r.reference.series[0].values[50]=-1],['reset',r=>r.reference.series[0].values[50]=0],
 ['bad quality numeric',r=>r.reference.series[0].qualities[50]='Bad'],['unexplained gap',r=>r.reference.series[4].qualities[10]='Good'],
 ['numeric NODATA',r=>r.reference.series[4].values[10]=10000],['missing returned timestamp',r=>r.reference.series[0].returnedTimes[5]=null],
 ['late time',r=>r.reference.series[0].returnedTimes[5]=r.reference.timestamps[6]],['unscoped time',r=>r.reference.series[0].returnedTimes[5]='2026-09-08 00:05:00'],
 ['missing first boundary',r=>{r.reference.series[0].values[0]=null;r.reference.series[0].qualities[0]='No Data, Bad';}],
 ['missing last boundary',r=>{r.reference.series[0].values[1440]=null;r.reference.series[0].qualities[1440]='No Data, Bad';}],
 ['wrong missing-times list',r=>r.tagSummary[4].missingTimes[0]=r.reference.timestamps[9]],
 ['mismatch',r=>r.referenceComparison.mismatchSamples=1],['insufficient comparison contract',r=>r.referenceComparison.comparedSamples='10'],
 ['wrong query day',r=>r.queryStart='2026-09-07 00:00'],['query padded twice',r=>r.queryEnd='2026-09-09 00:02'],
 ['not Start',r=>r.reference.aggregation='Linear']
])test('DATA_GAPS rejects '+name,()=>{const r=gapReport();assert.doesNotThrow(()=>api.parseImportedReport(r));change(r);assert.throws(()=>api.parseImportedReport(r));});
test('import displays valid and labelled partial quantities immediately without any network call',async()=>{
 const h=harness(),report=gapReport(),input=h.find('file');h.all('organic')[0].value='59.84';h.all('organic')[1].value='59.84';
 input.files=[{name:'pilot-report.json',size:1000,text:async()=>JSON.stringify(report)}];await input.fire('change');
 assert.equal(h.calls,0);assert.equal(h.find('date').value,'2026-09-08');assert.ok(h.all('organic').every(f=>f.value===''));
 assert.match(h.find('results').innerHTML,/720\.000/);assert.match(h.find('results').innerHTML,/조회값 참고 \(미확정\) 180\.000 ton/);
 assert.match(h.find('quality').textContent,/조회 완료 · 누락 3개/);assert.match(h.find('quality').textContent,/원본 대조 10\/14,410/);
 assert.match(h.find('status').textContent,/누락이 있는 호기의 혼소율은 표시하지/);assert.doesNotMatch(h.find('results').innerHTML,/\d+\.\d+%/);
 for(const field of h.all('organic')){field.value='0';await field.fire('input');}await h.controller.calculate();
 assert.equal(h.calls,0);assert.match(h.find('results').innerHTML,/조회값 참고 \(미확정\)/);
 assert.equal(report.status,'DATA_GAPS');assert.equal(report.reference.series[4].values[10],null);
 h.find('date').value='2026-09-09';await h.find('date').fire('change');
 assert.ok(h.all('organic').every(f=>f.value===''));assert.doesNotMatch(h.find('results').innerHTML,/720\.000/);
});
test('a rejected report cannot overwrite a displayed valid gap report',async()=>{
 const h=harness(),r=gapReport(),input=h.find('file');input.files=[{name:'valid.json',size:1000,text:async()=>JSON.stringify(r)}];await input.fire('change');
 const before=h.find('results').innerHTML;assert.match(before,/720\.000/);r.cleanupVerified=false;
 input.files=[{name:'invalid.json',size:1000,text:async()=>JSON.stringify(r)}];await input.fire('change');
 assert.equal(h.find('results').innerHTML,before);assert.equal(h.find('status').dataset.tone,'error');assert.equal(h.calls,0);
});
test('slow DATA_GAPS import cannot overwrite a newer selected day',async()=>{
 const h=harness(),r=gapReport(),wait=deferred(),input=h.find('file');input.files=[{name:'slow.json',size:1000,text:()=>wait.promise}];
 const pending=input.fire('change');h.find('date').value='2026-09-10';await h.find('date').fire('change');
 wait.resolve(JSON.stringify(r));await pending;assert.equal(h.find('date').value,'2026-09-10');assert.match(h.find('results').innerHTML,/계산 대기/);
});
