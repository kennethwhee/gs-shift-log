import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.textContent='';this.className='';this.style={};this.classList={add:(...v)=>this.className+=' '+v.join(' '),remove(){},toggle(){}};}
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);return node;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  addEventListener(){}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  removeAttribute(k){delete this.attributes[k];}
}
const source=fs.readFileSync(new URL('../efficiency/bed-ash-discharge.js',import.meta.url),'utf8');
function client(){
  const context=vm.createContext({Date,Intl,URLSearchParams,console,AbortController,
    document:{readyState:'loading',addEventListener(){},createElement:tag=>new Element(tag),getElementById:()=>null},
    localStorage:{getItem:()=>null},navigator:{userAgent:'desktop'},
    window:{location:{pathname:'/maintenance/'},getShiftLogAuthHeaders:()=>({Authorization:'Bearer synthetic'}),matchMedia:()=>({matches:false})}});
  const hook='window.__minuteClient={normalizeEvent,normalizeCoverage,createEventRow,formatHourlyRange,eventSourceLabel,coverageStatusMessage};\n';
  vm.runInContext(source.replace('  window.openBedAshDischargeView =',hook+'  window.openBedAshDischargeView ='),context);
  return context.window.__minuteClient;
}
function textTree(node){return [node.textContent,...node.children.map(textTree)].join(' ');}
const sample={eventKey:'minute-1',algorithmVersion:'bed-ash-drop-minute-v1',sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,
  unitNo:1,startAt:'2026-10-13T07:03:21+09:00',endAt:'2026-10-13T07:08:42+09:00',
  startLevelTon:40,endLevelTon:29.7,estimatedTon:10.3,status:'pending',reviewReady:true};

test('minute interval preserves actual seconds and displays source-specific evidence',()=>{
  const api=client(),event=api.normalizeEvent(sample),row=api.createEventRow(event),text=textTree(row);
  assert.match(text,/07:03:21 ~ 07:08:42/);
  assert.match(text,/1분 간격 중량 감지 구간/);
  assert.match(text,/감지 감소량 · 계근 확인/);
  assert.doesNotMatch(text,/시간별 OIS|기존 방식/);
  assert.equal(event.estimatedTon,10.3);
});

test('overlap note keeps each unit and amount separate and names the actual overlap interval',()=>{
  const api=client();
  const rows=[1,2].map(unitNo=>api.createEventRow(api.normalizeEvent({...sample,unitNo,eventKey:'u'+unitNo,
    estimatedTon:unitNo===1?10.3:8.4,overlapOtherUnit:true,overlapStartAt:'2026-10-13T07:05:12+09:00',overlapEndAt:'2026-10-13T07:08:42+09:00',overlapEventKeys:['other-unit']})));
  for(const [i,row] of rows.entries()){
    const text=textTree(row);assert.match(text,/1·2호기 감지 구간 겹침 · 차량 확인 필요/);
    assert.match(text,/07:05:12 ~ 07:08:42/);assert.match(row.className,/is-unit-overlap/);
    assert.match(text,new RegExp((i+1)+'호기'));
    assert.ok(!text.includes('18.7t'));
  }
});

test('hourly legacy evidence retains honest hourly label and excludes an overlap note after exclusion',()=>{
  const api=client();
  const event=api.normalizeEvent({...sample,algorithmVersion:'bed-ash-drop-v2',sourceKind:'',sampleIntervalSeconds:3600,status:'excluded',overlapOtherUnit:true});
  const row=api.createEventRow(event),text=textTree(row);
  assert.match(text,/시간별 OIS 자동 감지 구간/);assert.doesNotMatch(text,/1분 간격|차량 확인 필요/);
  assert.match(text,/07:03 ~ 07:08/);
});

test('minute confirmed events retain manual confirmed time without labeling them legacy records',()=>{
  const api=client(),text=textTree(api.createEventRow(api.normalizeEvent({...sample,status:'confirmed',confirmedAt:'2026-10-13T07:12:00+09:00',confirmedTon:10.7})));
  assert.match(text,/실제 2026.10.13 07:12/);assert.match(text,/1분 간격 중량 감지 구간/);assert.match(text,/10.7t/);
  assert.doesNotMatch(text,/기존 방식 확정 합계/);
});

test('coverage states distinguish minute data and an honest hourly fallback',()=>{
  const api=client(),coverage=api.normalizeCoverage({dates:['2026-10-12','2026-10-13'],completeDates:['2026-10-12','2026-10-13'],
    minuteDates:['2026-10-13'],hourlyDates:['2026-10-12'],precisionFailures:[{date:'2026-10-12',message:'자료 미수신'}]},[]);
  assert.equal(coverage.minuteDates.length,1);assert.equal(coverage.hourlyDates.length,1);
  const text=api.coverageStatusMessage(coverage,3);
  assert.match(text,/1분 자료 1일 \/ 시간 자료 1일/);assert.match(text,/정밀 조회 미수신/);
});

test('existing Bed Ash CSS and JS loaders each request the minute revision exactly once',()=>{
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/정밀 조회는 1분 간격 Silo 중량/);
  assert.match(html,/1·2호기 구간이 겹치면 별도 표시/);
  assert.match(html,/차량별 실제 반출량은 계근 기록과 확인/);
  for(const asset of ['bed-ash-discharge.js','bed-ash-discharge.css']){
    const hits=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].filter(m=>m[1].startsWith('/efficiency/'+asset+'?'));
    assert.equal(hits.length,1);const url=new URL(hits[0][1].replaceAll('&amp;','&'),'https://review.invalid');
    assert.equal(url.searchParams.get('minuteDetection'),'20261013-v1');
  }
});

test('an incomplete minute run is visibly distinguished even when review columns are hidden',()=>{
  const api=client(),text=textTree(api.createEventRow(api.normalizeEvent({...sample,reviewReady:false,closeReason:'data_gap'})));
  assert.match(text,/감지 구간 확인 중 · 종료 자료 확인 필요/);
  assert.match(text,/1분 간격 중량 감지 구간/);
});
