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

test('draft initialization starts no request and offers only a calendar date',()=>{
 const h=harness();assert.equal(h.calls,0);assert.match(h.container.innerHTML,/첨부자료로 계산/);assert.match(h.find('status').textContent||h.container.innerHTML,/DataPARC 조회는 아직 연결하지/);
 assert.equal(h.find('date').value,'2026-09-07');assert.equal(h.find('start'),null);assert.equal(h.find('end'),null);assert.equal(h.find('preset'),null);assert.match(h.find('query-range').textContent,/2026-09-07 00:00 ~ 2026-09-08 00:01/);
});
test('installed menu follows morning meeting and is in the switcher',{skip:!fs.existsSync(path.join(__dirname,'../index.html'))?'Full host repository was not included in the uploaded ZIP':false},()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');assert.ok(html.indexOf('id="efficiencyMorningMeetingTab"')<html.indexOf('id="efficiencyCofiringDraftTab"'));assert.ok(html.indexOf('id="efficiencyCofiringDraftTab"')<html.indexOf('id="efficiencyLimestoneTab"'));assert.match(html,/data-efficiency-view="cofiring-draft"/);
 const main=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');const switcher=main.slice(main.indexOf('function switchEfficiencyTeamView('));assert.match(switcher.slice(0,switcher.indexOf('const normalizedView')),/"cofiring-draft"/);
});
test('zero is a real organic input while blank and incomplete source ratios remain absent',()=>{
 assert.equal(api.numericInput('','유기성'),null);assert.equal(api.numericInput('0','유기성'),0);assert.throws(()=>api.numericInput('-1','유기성'));
 const result=core.analyze(original,{start:original.start,end:original.end,organic:original.manualOrganic});const one=api.unitMarkup(result.units.unit1,1,24);const two=api.unitMarkup(result.units.unit2,2,24);
 assert.match(one,/29\.03%/);assert.match(two,/305\.934 ton/);assert.match(two,/10개 시각 누락/);assert.doesNotMatch(two,/25\.49%/);
});
test('period changes discard the original full-day organic amount',async()=>{
 const h=harness({reference:clone(original)});await h.find('original').click();assert.equal(h.all('organic')[0].value,'59.84');assert.match(h.find('results').innerHTML,/29\.03%/);
 h.find('date').value='2026-09-08';await h.find('date').fire('change');assert.match(h.find('query-range').textContent,/2026-09-09 00:01/);assert.equal(h.all('organic')[0].value,'');await h.controller.calculate();assert.doesNotMatch(h.find('results').innerHTML,/29\.03%/);assert.match(h.find('results').innerHTML,/해당일 사용량 입력/);
});
test('an input or date change during the initial source fetch cannot render stale calculation options',async()=>{
 for(const kind of ['organic','calorific','date']){const wait=deferred();const h=harness({fetch:()=>wait.promise});const pending=h.controller.calculate();const field=kind==='date'?h.find('date'):h.all(kind)[0];field.value=kind==='date'?'2026-09-08':'100';await field.fire(kind==='date'?'change':'input');wait.resolve({ok:true,json:async()=>clone(original)});await pending;assert.match(h.find('results').innerHTML,/계산 대기/);assert.equal(h.find('calculate').disabled,false);}
});
test('a delayed original preset cannot overwrite a newer period',async()=>{
 const wait=deferred();const h=harness({fetch:()=>wait.promise});const pending=h.find('original').click();h.find('date').value='2026-09-08';await h.find('date').fire('change');wait.resolve({ok:true,json:async()=>clone(original)});await pending;assert.equal(h.find('date').value,'2026-09-08');assert.equal(h.all('organic')[0].value,'');
});
test('import requires successful pilot cleanup and read-only markers; raw DataPARC cannot bypass the wrapper',()=>{
 const report=pilot();assert.equal(api.parseImportedReport(report).pilotVerified,true);
 for(const [key,value]of [['status','FAIL'],['cleanupVerified',false],['databaseWritten',true],['productionReady',true]]){const bad=clone(report);bad[key]=value;assert.throws(()=>api.parseImportedReport(bad));}
 assert.throws(()=>api.parseImportedReport(report.reference));assert.equal(api.parseImportedReport(clone(original)).pilotVerified,false);
 assert.equal(api.toKstInput('2026-09-06T15:00:00Z'),'2026-09-07T00:00');
});
test('a delayed imported file cannot replace a newer period or a newer imported result',async()=>{
 const h=harness({reference:clone(original)});const wait=deferred();const input=h.find('file');input.files=[{name:'old.json',size:10,text:()=>wait.promise}];const pending=input.fire('change');h.find('date').value='2026-09-08';await h.find('date').fire('change');wait.resolve(JSON.stringify(original));await pending;assert.equal(h.find('date').value,'2026-09-08');
 const slow=deferred();input.files=[{name:'older.json',size:10,text:()=>slow.promise}];const older=input.fire('change');const newer=clone(original);newer.source.filename='newer.json';input.files=[{name:'newer.json',size:10,text:async()=>JSON.stringify(newer)}];await input.fire('change');slow.resolve(JSON.stringify(original));await older;assert.match(h.find('source').textContent,/newer\.json/);
});
test('an imported UTC source is displayed at its KST clock time',async()=>{
 const data=clone(original);data.start='2026-09-06T15:00:00Z';data.end='2026-09-07T15:00:00Z';const h=harness();const input=h.find('file');input.files=[{name:'reference.json',size:10,text:async()=>JSON.stringify(data)}];await input.fire('change');assert.equal(h.find('date').value,'2026-09-07');assert.match(h.find('query-range').textContent,/2026-09-08 00:01/);
});

function completeDailyReport(){
 const reference=clone(original);reference.source.kind='dataparc_hidden_excel';
 reference.series.forEach(series=>{series.values=reference.timestamps.map((_,i)=>100+i);series.qualities=reference.timestamps.map(()=>'Raw, Good');series.returnedTimes=[...reference.timestamps];});
 return {schemaVersion:2,kind:'cofiring_dataparc_pilot',status:'REFERENCE_UNVERIFIED',dataValidated:true,cleanupVerified:true,databaseWritten:false,productionReady:false,targetDate:'2026-09-07',queryStart:'2026-09-07 00:00',queryEnd:'2026-09-08 00:01',referenceComparison:{mismatchSamples:0,expectedSamples:14410,comparedSamples:0},reference};
}
test('month-end date updates read-only query window and leaves calculation duration 24 hours',async()=>{
 const h=harness();h.find('date').value='2026-09-30';await h.find('date').fire('input');
 assert.equal(h.find('query-range').textContent,'2026-09-30 00:00 ~ 2026-10-01 00:01');assert.match(h.find('period').textContent,/24시간/);assert.match(h.find('period').textContent,/1,441/);
});
test('partial diagnostic report is not imported as a daily calculation',()=>{
 const data=clone(original);data.end='2026-09-07T00:05:00+09:00';data.timestamps=data.timestamps.slice(0,6);data.series.forEach(s=>s.values=s.values.slice(0,6));
 assert.throws(()=>api.parseImportedReport(data),/하루 전체/);
});
test('reading a different date never silently reuses the workbook day',async()=>{
 const h=harness({reference:clone(original)});h.find('date').value='2026-09-08';await h.find('date').fire('change');await h.controller.calculate();
 assert.match(h.find('status').textContent,/선택일 2026-09-08/);assert.doesNotMatch(h.find('results').innerHTML,/598\.630/);
});
test('missing day clears the range display and cannot trigger calculations',async()=>{
 const h=harness();h.find('date').value='';await h.find('date').fire('input');await h.controller.calculate();assert.equal(h.calls,0);assert.equal(h.find('query-range').textContent,'—');assert.match(h.find('status').textContent,/날짜 하나/);
});
test('complete read with incomplete reference comparison is explicitly labelled unverified',async()=>{
 const report=completeDailyReport();const parsed=api.parseImportedReport(report);assert.equal(parsed.pilotVerified,true);assert.equal(parsed.referenceVerified,false);
 const h=harness();const input=h.find('file');input.files=[{name:'pilot-report.json',size:100,text:async()=>JSON.stringify(report)}];await input.fire('change');
 for(const field of h.all('organic')){field.value='0';await field.fire('input');}await h.controller.calculate();assert.match(h.find('quality').textContent,/원본 대조 미완료/);assert.match(h.find('checks').innerHTML,/운영 저장하지/);
});
test('unverified report cannot bypass bad quality, missing times, counter resets or date contract',()=>{
 for(const change of [r=>r.referenceComparison.mismatchSamples=1,r=>r.dataValidated=false,r=>r.cleanupVerified=false,r=>r.queryEnd='2026-09-08 00:02',r=>r.reference.series[0].qualities[0]='Bad',r=>r.reference.series[0].values[20]=0,r=>r.reference.series[0].returnedTimes.pop()]){
  const report=completeDailyReport();change(report);assert.throws(()=>api.parseImportedReport(report));
 }
});
