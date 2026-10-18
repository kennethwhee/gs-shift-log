'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('../daily-operation/daily-operation-query-contract.js');
const {normalizeDailyOperationResult} = require('../local-tools/ois-agent/daily-operation-dataparc-agent.js');
const DAY = '2026-09-01';
const normalizeSource = source => source.replace(/\r\n/g, '\n');
function agentHelperSection(source) {
  const start = source.indexOf('function isDailyDataExcelRequestType(');
  assert.ok(start >= 0, 'Agent request helper start marker is missing');
  const end = source.indexOf('/* =========================================================\n  요청 유형 표시 이름', start);
  assert.ok(end > start, 'Agent request helper end marker is missing or precedes start');
  return source.slice(start, end);
}
function fixture() {
  const interval = contract.interval(DAY);
  const raw = {requestType:contract.TYPE,mode:contract.TYPE,schemaVersion:1,targetDate:DAY,source:'dataparc_hidden_excel',step:'1D',...interval,cleanupVerified:true,databaseWritten:false,runId:'a'.repeat(32),ok:true,
    samples:contract.definitions.map((d,i)=>({...d,date:DAY,value:i+0.123456789,qualityText:'Raw, Good',returnedTimeText:DAY+' 12:00:00',periodStartKst:interval.startLocal.replace('T',' '),periodEndKst:interval.endLocal.replace('T',' ')}))};
  const report = {schemaVersion:1,mode:contract.TYPE,runId:raw.runId,targetDate:DAY,ok:true,timedOut:false,workerExitCode:0,resultReceived:true,resultOk:true,cleanupVerified:true,cleanupErrors:[],failure:null,databaseWritten:false,ownedExcel:{ProcessId:123,Path:'C:\\Program Files\\Microsoft Office\\Office16\\EXCEL.EXE'}};
  return {raw,report};
}
test('full-day KST, calendar validation and no partial current-day query',()=>{
  assert.deepEqual(contract.interval('2026-12-31'),{startLocal:'2026-12-31T00:00:00+09:00',endLocal:'2027-01-01T00:00:00+09:00'});
  for(const date of ['2026-02-30','2020-12-31','2026-09-01;exit',''])assert.throws(()=>contract.interval(date));
  assert.throws(()=>contract.completedDay(DAY,Date.parse('2026-09-01T23:59:59+09:00')));
  assert.equal(contract.completedDay(DAY,Date.parse('2026-09-02T00:00:01+09:00')),DAY);
});
test('water stays time average t/h, stocks End, power Max; no totalizer or guessed runtime/NG fields',()=>{
  const {raw}=fixture(),result=contract.normalize(raw,DAY);
  assert.equal(result.values.water_demi_avg,0.123456789);
  assert.equal(result.samples.length,14);
  for(const d of contract.definitions.filter(d=>d.key.startsWith('water_'))){assert.equal(d.statistic,'TimeAvg');assert.equal(d.unit,'t/h');}
  for(const d of contract.definitions.filter(d=>d.key.includes('storage')||d.key.includes('coal_day'))){assert.equal(d.statistic,'End');}
  assert.equal(contract.definitions.find(d=>d.key==='power_max_daily').statistic,'Max');
  for(const id of ['ng_main_daily','steam_u1_hours','power_uat_daily','ammonia_u1_daily'])assert.equal(Object.hasOwn(result.values,id),false);
  assert.deepEqual(contract.normalize(result,DAY),result);
});
test('different dates, tags, units, statistic and duplicate/missing samples are rejected',()=>{
  const changes=[r=>r.targetDate='2026-08-31',r=>r.startLocal='2026-08-31T00:00:00+09:00',r=>r.endLocal='2026-09-03T00:00:00+09:00',r=>r.cleanupVerified=false,r=>r.samples.pop(),r=>r.samples[1]=r.samples[0],r=>r.samples[0].tag='arbitrary',r=>r.samples[0].unit='Ton/day',r=>r.samples[0].statistic='End',r=>r.samples[0].periodEndKst='2026-09-03 00:00:00+09:00'];
  for(const change of changes){const {raw}=fixture();change(raw);assert.throws(()=>contract.normalize(raw,DAY),String(change));}
});
test('bad or absent numeric/quality/time cells are blank, while valid actual zero remains zero',()=>{
  const changes=[s=>s.value=null,s=>s.value=-1,s=>s.value='0',s=>s.value=NaN,s=>s.value=Infinity,s=>s.qualityText='Good, Bad',s=>s.qualityText='Not Good',s=>s.returnedTimeText='2026-08-31 23:59:59',s=>s.returnedTimeText='2026-09-02 00:00:01',s=>s.returnedTimeText='2026-02-30 00:00:00'];
  for(const change of changes){const {raw}=fixture();change(raw.samples[0]);const result=contract.normalize(raw,DAY);assert.equal(result.values.water_demi_avg,null);assert.equal(result.warnings[0].field,'water_demi_avg');assert.equal(result.values.water_condensate_avg,1.123456789);}
  const {raw}=fixture();raw.samples[0].value=0;assert.equal(contract.normalize(raw,DAY).values.water_demi_avg,0);
});
test('claim result cannot override sample values; controller report and owned Excel evidence mandatory',()=>{
  const {raw}=fixture();raw.values={...contract.normalize(raw,DAY).values,water_demi_avg:999};assert.throws(()=>contract.normalize(raw,DAY));
  const changes=[x=>x.report.cleanupVerified=false,x=>x.report.timedOut=true,x=>x.report.workerExitCode=1,x=>x.report.runId='b'.repeat(32),x=>x.report.ownedExcel.Path='C:\\notepad.exe',x=>x.report.cleanupErrors=['still running'],x=>x.raw.databaseWritten=true];
  for(const change of changes){const data=fixture();change(data);assert.throws(()=>normalizeDailyOperationResult(data.raw,data.report,DAY),String(change));}
  const data=fixture();assert.equal(normalizeDailyOperationResult(data.raw,data.report,DAY).values.water_demi_avg,0.123456789);
});
test('Agent routes daily operation through existing Excel-only lane without classifying it as daily_data_excel',()=>{
  const agent=normalizeSource(fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/ois-login.js'),'utf8'));
  const laneArrays=[...agent.matchAll(/const excelRequestTypes = \[([\s\S]*?)\];/g)];assert.equal(laneArrays.length,2);
  for(const match of laneArrays)assert.match(match[1],/DAILY_OPERATION_REQUEST_TYPE/);
  const helpers=agentHelperSection(agent);
  const ctx=vm.createContext({ORGANIC_SILO_REQUEST_TYPE:'organic_silo_dataparc',BLOWER_RUNTIME_PROBE_REQUEST_TYPE:'blower_runtime_probe',normalizeOisAgentText:value=>String(value||'').trim()});
  vm.runInContext(helpers,ctx);assert.equal(ctx.isExcelOnlyRequestType(contract.TYPE),true);assert.equal(ctx.isDailyDataExcelRequestType(contract.TYPE),false);
});
test('LF and CRLF helper extraction are identical; missing boundaries stop before VM evaluation',()=>{
  const agent=normalizeSource(fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/ois-login.js'),'utf8'));
  const crlf=agent.replace(/\n/g,'\r\n');
  assert.equal(agentHelperSection(normalizeSource(crlf)),agentHelperSection(agent));
  assert.throws(()=>agentHelperSection(agent.replace('function isDailyDataExcelRequestType(', 'function renamedHelper(')),/start marker is missing/);
  assert.throws(()=>agentHelperSection(agent.replace('/* =========================================================\n  요청 유형 표시 이름', '/* removed boundary')),/end marker is missing/);
});
