import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.listeners={};this.textContent='';this.className='';this.style={};this.classList={add:(...v)=>this.className+=' '+v.join(' '),remove(){},toggle(){},contains:()=>false};}
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);return node;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  addEventListener(name,callback){this.listeners[name]=callback;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  removeAttribute(k){delete this.attributes[k];}
}
const source=fs.readFileSync(new URL('../efficiency/bed-ash-discharge.js',import.meta.url),'utf8');
function client(){
  const context=vm.createContext({Date,Intl,URLSearchParams,console,AbortController,Element,
    MutationObserver:class {observe(){}},
    document:{readyState:'loading',addEventListener(){},createElement:tag=>new Element(tag),getElementById:()=>null},
    localStorage:{getItem:()=>null},navigator:{userAgent:'desktop'},
    window:{location:{pathname:'/maintenance/'},addEventListener(){},setTimeout:()=>0,clearTimeout(){},setInterval(){},
      getShiftLogAuthHeaders:()=>({Authorization:'Bearer synthetic'}),matchMedia:()=>({matches:false})}});
  const hook=`window.__minuteClient={normalizeEvent,normalizeCoverage,createEventRow,formatHourlyRange,formatDetectionRange,eventSourceLabel,coverageStatusMessage,
    state, bindEvents, summarizeVisibleEvents,
    installBindings(d){
      getElements=()=>d.elements;getSessionToken=()=> 'synthetic';isMobileClient=()=>Boolean(d.mobile);
      calculatePeriod=()=>d.range;renderPeriodControls=()=>d.range;
      requestJson=d.requestJson;fetchRangeData=d.fetchRangeData;
      renderData=value=>{state.coverage=normalizeCoverage(value.coverage,[d.range.queryStartDate]);state.events=value.events||[];};
      renderEvents=()=>{};setStatus=d.setStatus||(()=>{});setLoading=value=>state.loading=value;
      clearDetailData=()=>{};refreshSummary=async()=>{};delay=async()=>{};
    }
  };\n`;
  vm.runInContext(source.replace('  window.openBedAshDischargeView =',hook+'  window.openBedAshDischargeView ='),context);
  return context.window.__minuteClient;
}
function textTree(node){return [node.textContent,...node.children.map(textTree)].join(' ');}
const sample={eventKey:'minute-1',algorithmVersion:'bed-ash-drop-minute-v1',sourceKind:'dataparc_bed_ash_minute',sampleIntervalSeconds:60,
  unitNo:1,startAt:'2026-10-13T07:03:21+09:00',endAt:'2026-10-13T07:08:42+09:00',
  startLevelTon:40,endLevelTon:29.7,estimatedTon:10.3,status:'pending',reviewReady:true};

test('daily minute interval displays concise minutes while retaining actual source seconds',()=>{
  const api=client(),event=api.normalizeEvent(sample),row=api.createEventRow(event),text=textTree(row);
  assert.equal(row.children[0].children[0].textContent,'07:03 ~ 07:08');
  assert.match(text,/DataPARC · 1분 자료/);
  assert.match(text,/감지 감소량 · 계근 확인/);
  assert.doesNotMatch(text,/시간별 OIS|기존 방식/);
  assert.equal(event.estimatedTon,10.3);
  assert.equal(event.startAt,sample.startAt);assert.equal(event.endAt,sample.endAt);
});

test('compact overlap notice keeps both unit amounts separate without repeating the long date range',()=>{
  const api=client();
  const rows=[1,2].map(unitNo=>api.createEventRow(api.normalizeEvent({...sample,unitNo,eventKey:'u'+unitNo,
    estimatedTon:unitNo===1?10.3:8.4,overlapOtherUnit:true,overlapStartAt:'2026-10-13T07:05:12+09:00',overlapEndAt:'2026-10-13T07:08:42+09:00',overlapEventKeys:['other-unit']})));
  for(const [i,row] of rows.entries()){
    const text=textTree(row);assert.match(text,/시간 겹침 · 차량 확인/);
    assert.doesNotMatch(text,/2026\.10\.13|07:05:12/);assert.match(row.className,/is-unit-overlap/);
    assert.match(text,new RegExp((i+1)+'호기'));
    assert.ok(!text.includes('18.7t'));
  }
});

test('hourly legacy evidence retains honest hourly label and excludes an overlap note after exclusion',()=>{
  const api=client();
  const event=api.normalizeEvent({...sample,algorithmVersion:'bed-ash-drop-v2',sourceKind:'',sampleIntervalSeconds:3600,status:'excluded',overlapOtherUnit:true});
  const row=api.createEventRow(event),text=textTree(row);
  assert.match(text,/운영정보 · 시간자료/);assert.doesNotMatch(text,/DataPARC|차량 확인/);
  assert.match(text,/07:03 ~ 07:08/);
});

test('minute confirmed events retain manual confirmed time without labeling them legacy records',()=>{
  const api=client(),text=textTree(api.createEventRow(api.normalizeEvent({...sample,status:'confirmed',confirmedAt:'2026-10-13T07:12:00+09:00',confirmedTon:10.7})));
  assert.match(text,/확정 시각 2026.10.13 07:12/);assert.match(text,/DataPARC · 1분 자료/);assert.match(text,/10.7t/);
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
  assert.match(html,/DataPARC 1분 중량으로 호기별 감지 시작~종료 분/);
  assert.match(html,/시간이 겹치면 차량별 계근 기록을 확인/);
  assert.match(html,/DataPARC 새로 조회/);
  for(const asset of ['bed-ash-discharge.js','bed-ash-discharge.css']){
    const hits=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].filter(m=>m[1].startsWith('/efficiency/'+asset+'?'));
    assert.equal(hits.length,1);const url=new URL(hits[0][1].replaceAll('&amp;','&'),'https://review.invalid');
    assert.equal(url.searchParams.get('minuteDetection'),'20261013-v1-r2');
  }
});

test('an incomplete minute run is visibly distinguished even when review columns are hidden',()=>{
  const api=client(),text=textTree(api.createEventRow(api.normalizeEvent({...sample,reviewReady:false,closeReason:'data_gap'})));
  assert.match(text,/감지 구간 확인 중 · 종료 자료 확인 필요/);
  assert.match(text,/DataPARC · 1분 자료/);
});

test('weekly and midnight ranges retain dates while daily same-day ranges stay short',()=>{
  const api=client();api.state.period='weekly';
  assert.equal(api.formatDetectionRange(sample.startAt,sample.endAt),'2026.10.13 07:03 ~ 07:08');
  api.state.period='daily';
  assert.equal(api.formatDetectionRange('2026-10-12T23:58:20+09:00','2026-10-13T00:02:05+09:00'),
    '2026.10.12 23:58 ~ 2026.10.13 00:02');
});

test('a reviewed hourly aggregate shows multiple new minute ranges without dividing its confirmed amount',()=>{
  const api=client(),old={...sample,eventKey:'saved-hourly',algorithmVersion:'bed-ash-drop-v2',sourceKind:'',sampleIntervalSeconds:3600,
    status:'confirmed',confirmedTon:21.4,startAt:'2026-10-13T07:00:00+09:00',endAt:'2026-10-13T09:00:00+09:00',
    minuteObservations:[{...sample,eventKey:'first',estimatedTon:7},{...sample,eventKey:'second',startAt:'2026-10-13T07:26:12+09:00',endAt:'2026-10-13T07:34:51+09:00',estimatedTon:10}]};
  const event=api.normalizeEvent(old),row=api.createEventRow(event),text=textTree(row);
  assert.equal(row.children[0].children[0].textContent,'07:03 ~ 07:08');
  assert.equal(row.children[0].children[1].textContent,'07:26 ~ 07:34');
  assert.match(text,/DataPARC · 1분 감지 근거/);assert.match(text,/기존 시간기록/);
  assert.match(text,/21.4t/);assert.match(text,/기존 확정량/);assert.match(text,/구간별 배분 안 함/);
  assert.equal(event.startAt,old.startAt);assert.equal(event.endAt,old.endAt);assert.equal(event.confirmedTon,21.4);
  assert.equal(event.minuteObservations[0].confirmedTon,undefined);
  const summary=api.summarizeVisibleEvents([event]);assert.equal(summary.confirmedCount,1);assert.equal(summary.confirmedTon,21.4);
});

test('shared minute evidence stays explicitly unassigned to individual saved vehicle records',()=>{
  const api=client(),event=api.normalizeEvent({...sample,status:'confirmed',confirmedTon:10.7,algorithmVersion:'bed-ash-drop-v2',sourceKind:'',
    minuteObservations:[{...sample,sharedReviewedEvidence:true,relatedReviewedEventKeys:['one','two']}]}),text=textTree(api.createEventRow(event));
  assert.match(text,/공유 감지 근거 · 개별 반출 연결 미확정/);assert.match(text,/구간별 배분 안 함/);
  assert.equal(api.summarizeVisibleEvents([event]).confirmedTon,10.7);
});

test('malformed, unsettled and duplicate nested evidence cannot acquire precision or confirmed amounts',()=>{
  const api=client(),event=api.normalizeEvent({...sample,minuteObservations:[sample,sample,
    {...sample,eventKey:'wrong-unit',unitNo:2},{...sample,eventKey:'pending',reviewReady:false},
    {...sample,eventKey:'fake-source',sourceKind:'ois_hourly_fallback'},
    {...sample,eventKey:'bad-number',startLevelTon:null},{...sample,eventKey:'bad-time',endAt:'invalid'}]});
  assert.equal(event.minuteObservations.length,1);assert.equal(event.minuteObservations[0].eventKey,sample.eventKey);
  assert.equal(event.minuteObservations[0].status,undefined);assert.equal(event.minuteObservations[0].confirmedTon,undefined);
});

function buttonHarness(mobile=false,finalCoverage=null){
  const api=client(),posts=[],rangeReads=[],statuses=[];
  const elements={view:new Element('section'),tab:new Element('button'),refreshButton:new Element('button'),
    anchorDate:new Element('input'),periodButtons:[],weekButtons:[],monthButtons:[]};
  const date='2026-10-12',range={period:'daily',anchorDate:date,queryStartDate:date,queryEndDate:date,today:'2026-10-13'};
  const oldCoverage={dates:[date],completeDates:[date],hourlyDates:[date],minuteDates:[],missingDates:[],pendingDates:[],failedDates:[],requests:[]};
  api.state.anchorDate=date;
  api.installBindings({mobile,elements,range,
    setStatus:(message,tone)=>statuses.push({message,tone}),
    requestJson:async (_url,init)=>{
      if(init?.method==='POST'){
        const body=JSON.parse(init.body);posts.push(body);
        return {item:{id:'new-minute-job',requestType:'bed_ash_level',targetDate:date,status:'pending'}};
      }
      return {items:[{id:'new-minute-job',requestType:'bed_ash_level',targetDate:date,status:'complete'}],missingIds:[]};
    },
    fetchRangeData:async()=>{
      rangeReads.push(true);
      return {events:[],coverage:rangeReads.length===1?oldCoverage:finalCoverage||{...oldCoverage,minuteDates:[date],hourlyDates:[]}};
    }
  });
  api.bindEvents();return {api,elements,posts,rangeReads,statuses};
}

test('the actual visible DataPARC button creates a forced request even over completed hourly data',async()=>{
  const h=buttonHarness();await h.elements.refreshButton.listeners.click();
  assert.equal(h.posts.length,1);assert.equal(h.posts[0].forceRefresh,true);assert.equal(h.posts[0].targetDate,'2026-10-12');
  assert.equal(h.rangeReads.length,2);assert.equal(h.api.state.coverage.minuteDates.length,1);
});

test('the same visible button never launches company collection from mobile',async()=>{
  const h=buttonHarness(true);await h.elements.refreshButton.listeners.click();
  assert.equal(h.posts.length,0);assert.equal(h.rangeReads.length,0);
});

test('a completed request with a precision failure keeps prior data and finishes with a visible warning',async()=>{
  const date='2026-10-12',h=buttonHarness(false,{dates:[date],completeDates:[date],hourlyDates:[date],minuteDates:[],
    missingDates:[],pendingDates:[],failedDates:[],requests:[],precisionFailures:[{date,message:'BED_ASH_MINUTE_QUERY_FAILED'}]});
  await h.elements.refreshButton.listeners.click();
  assert.equal(h.posts.length,1);assert.equal(h.statuses.at(-1).tone,'warning');
  assert.match(h.statuses.at(-1).message,/정밀 조회 미수신 · 기존 자료 표시/);
});

test('ordinary date navigation retains saved hourly reuse without a forced DataPARC request',async()=>{
  const h=buttonHarness();h.elements.anchorDate.value='2026-10-12';h.elements.anchorDate.listeners.change();
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(h.posts.length,0);assert.equal(h.rangeReads.length,1);
});

test('minute provenance and fallback remain visible in pending or partial coverage messages',()=>{
  const api=client(),base={dates:['2026-10-12'],completeDates:['2026-10-12'],hourlyDates:['2026-10-12'],
    minuteDates:[],precisionFailures:[{date:'2026-10-12',message:'missing'}]};
  for(const extra of [{pendingDates:['2026-10-12']},{missingDates:['2026-10-12']},{lookahead:{available:false}}]){
    const message=api.coverageStatusMessage(api.normalizeCoverage({...base,...extra},[]),2);
    assert.match(message,/DataPARC 1분 자료 0일 \/ 시간 자료 1일/);assert.match(message,/정밀 조회 미수신/);
  }
  const ready=api.coverageStatusMessage(api.normalizeCoverage({...base,hourlyDates:[],minuteDates:['2026-10-12'],precisionFailures:[],lookahead:{available:false}},[]),2);
  assert.doesNotMatch(ready,/다음 날 08시/);
});
