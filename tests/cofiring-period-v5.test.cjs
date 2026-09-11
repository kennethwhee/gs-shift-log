'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../maintenance/cofiring-core.js'),contract=require('../maintenance/cofiring-live-contract.js'),liveApi=require('../maintenance/cofiring-live.js'),ui=require('../maintenance/cofiring-period-ui-v5.js'),adjust=require('../maintenance/cofiring-period-adjustment-v56.js');
const spec={startLocal:'2026-09-10T00:00',endLocal:'2026-09-10T13:00',stepUnit:'hour',stepValue:1};
function report({bad=false}={}){
 const p=contract.period(spec,Number.MAX_SAFE_INTEGER),duration=p.durationMinutes*60;
 const summaries=contract.definitions.map((def,i)=>{const usage=def.fuel==='coal'?100+i:50+i;return {key:def.id,unit:def.unit,fuel:def.fuel,tag:def.queryTag,startValue:1000+i*100,endValue:1000+i*100+usage,min:1000+i*100,max:1000+i*100+usage,delta:usage,usageTon:usage,startQuality:'Raw, Good',endQuality:'Good, Raw',startTime:spec.startLocal+':00+09:00',endTime:spec.endLocal+':00+09:00',durationGoodSeconds:bad&&i===0?duration-60:duration,durationBadSeconds:bad&&i===0?60:0,boundaryValid:true,durationCoverageValid:true};});
 return {kind:'cofiring_dataparc_period_report',schemaVersion:1,status:bad?'PERIOD_DATA_GAPS':'PERIOD_READY',runId:'0123456789abcdef0123456789abcdef',startLocal:spec.startLocal,endLocal:spec.endLocal,stepUnit:spec.stepUnit,stepValue:spec.stepValue,queryEndLocal:p.queryEndLocal,executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,timedOut:false,workerExitCode:0,cleanupErrors:[],completedAtUtc:'2026-09-10T04:02:00Z',summaries};
}
test('period supports minute/hour/day step with a 31-day guard',()=>{
 const p=core.periodRange(spec.startLocal,spec.endLocal,'hour',1);assert.equal(p.durationMinutes,780);assert.equal(p.durationHours,13);assert.equal(p.stepMinutes,60);
 assert.equal(core.periodRange('2026-09-10T00:00','2026-09-10T01:00','minute',5).stepMinutes,5);
 assert.equal(core.periodRange('2026-09-10T00:00','2026-09-11T00:00','day',1).stepMinutes,1440);
 assert.throws(()=>core.periodRange('2026-09-10T00:00','2026-10-12T00:00','day',1),/최대 31일/);
});
test('period contract validates cumulative start/end summary and labels quality gaps',()=>{
 const clean=contract.validatePeriodReport(report(),spec);assert.equal(clean.status,'PERIOD_READY');assert.equal(clean.reference.kind,'cofiring_period_summary_v1');assert.equal(clean.reference.summaries.length,10);
 const gapSource=report({bad:true});gapSource.summaries[0].max=gapSource.summaries[0].endValue-0.125;gapSource.summaries[0].delta=gapSource.summaries[0].max-gapSource.summaries[0].min;
 const gap=contract.validatePeriodReport(gapSource,spec);assert.equal(gap.status,'PERIOD_DATA_GAPS');assert.equal(gap.summaries[0].dataComplete,false);assert.notEqual(gap.summaries[0].usageTon,gap.summaries[0].delta);
 const bad=report();bad.summaries[0].endTime='2026-09-10T13:02:00+09:00';assert.throws(()=>contract.validatePeriodReport(bad,spec),/경계 반환시각/);
});
test('period calculation uses heat shares and period-bound manual organic/manure',()=>{
 const ref=contract.validatePeriodReport(report(),spec).reference;
 const result=core.analyzePeriodSummary(ref,{...spec,organic:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:10,unit2:20},manure:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:2,unit2:3}});
 assert.equal(result.period.durationHours,13);assert.equal(result.units.unit1.organic.enteredQuantity,10);assert.equal(result.units.unit2.manure.enteredQuantity,3);assert.ok(result.combined.ratios.total>0);assert.equal(result.qualityVerified,true);
 const stale=core.analyzePeriodSummary(ref,{...spec,organic:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T12:59:00+09:00',unit1:10,unit2:20},manure:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:0,unit2:0}});assert.equal(stale.units.unit1.organic.quantity,null);assert.equal(stale.units.unit1.ratios.total,null);
 const gapSource=report({bad:true});gapSource.summaries[0].max=gapSource.summaries[0].endValue-0.125;gapSource.summaries[0].delta=gapSource.summaries[0].max-gapSource.summaries[0].min;
 const gapRef=contract.validatePeriodReport(gapSource,spec).reference;
 const gapResult=core.analyzePeriodSummary(gapRef,{...spec,organic:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:0,unit2:0},manure:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:0,unit2:0}});
 assert.ok(gapResult.units.unit1.coal.quantity>0);assert.ok(gapResult.units.unit1.bio.quantity>0);assert.equal(gapResult.qualityVerified,false);assert.ok(gapResult.combined.ratios.total>0);assert.match(gapResult.warnings.join(' '),/품질 공백/);
});
test('V5.2 markup is compact by default while keeping Excel detail tables',()=>{
 const html=ui.markup();for(const text of ['Start date','End date','Step size','계산하기','Coal','Bio-SRF','유기성 고형연료','축분','계측 사용량','보정계수','실 사용량','주요 계산값','상세 계산표 보기'])assert.match(html,new RegExp(text));assert.match(html,/data-cfv52-summary-grid/);assert.match(html,/cfv52-manual-panel/);assert.doesNotMatch(html,/data-cfv5-load/);
 assert.match(html,/value="minute"/);assert.match(html,/value="hour" selected/);assert.match(html,/value="day"/);
 const css=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.css'),'utf8');assert.match(css,/\.cfv5-input-yellow\{background:#fff200/);assert.match(css,/\.cfv5-input-blue\{background:#8ec9e6/);assert.match(css,/\.cfv5-ratio\{color:#f00000/);assert.match(css,/\.cfv52-summary-grid\{display:grid/);assert.match(css,/max-width:1180px/);
});
test('host loads V5 period assets instead of the old daily draft UI',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');assert.match(html,/cofiring-period-ui-v5\.css\?v=20260911-fast-adjust-v56/);assert.match(html,/cofiring-period-manual-storage\.js\?v=20260911-period-excel-v5/);assert.match(html,/cofiring-period-adjustment-v56\.js\?v=20260911-fast-adjust-v56/);assert.match(html,/cofiring-period-ui-v5\.js\?v=20260912-session-recovery-v561/);assert.doesNotMatch(html,/cofiring-draft\.js\?v=20260911-calc-layout-v4/);
});

test('V5.1 calculate action is one-click saved-first and surfaces query progress/errors',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
 assert.match(js,/data-cfv5-query>계산하기</);
 assert.match(js,/저장된 기간 결과를 먼저 확인하고 있습니다/);
 assert.match(js,/await live\.load\(\{force:true\}\)/);
 assert.match(js,/await live\.query\(\{explicit:true\}\)/);
 assert.match(js,/상태 확인 중\.\.\./);
 assert.match(js,/item\?\.error/);
});

test('V5.2 progress copy never calls an active period calculation complete',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
 assert.doesNotMatch(js,/DataPARC 조회가 끝났습니다/);
 assert.match(js,/아직 계산 완료가 아닙니다/);
 assert.match(js,/서버에 저장 결과가 도착하면 숫자가 자동 표시됩니다/);
 assert.match(js,/active\?\.status==='processing'\?'DataPARC 작업 중'/);
 assert.match(js,/경계값 계산 · 품질 공백/);assert.match(js,/시작·종료 누적 경계가 정상인 사용량은 표시/);
});

test('V5.2 key view keeps manual fuel inputs visible and advanced sections folded',()=>{
 const html=ui.markup();
 assert.match(html,/유기성\(t\)[\s\S]*data-cfv5-manual="unit1:organic"/);
 assert.match(html,/축분\(t\)[\s\S]*data-cfv5-manual="unit2:manure"/);
 assert.match(html,/<details class="cfv52-fold">/);
 assert.match(html,/<details class="cfv52-fold cfv52-detail">/);
 assert.match(html,/Coal 실사용|주요 계산값/);
});


test('V5.4 Bio mix rate is calculated from Coal+Bio heat without waiting for organic or manure',()=>{
 const unit1={heats:{coal:409.93*5868/1000,bio:311.74*3237/1000,organic:null,manure:null,total:null}};
 const unit2={heats:{coal:450.34*5868/1000,bio:254.15*3237/1000,organic:null,manure:null,total:null}};
 assert.ok(Math.abs(ui.coalBioRatio(unit1)-29.55282513593901)<1e-9);
 assert.ok(Math.abs(ui.coalBioRatio(unit2)-23.740761662899686)<1e-9);
 const combined={combined:{heats:{coal:unit1.heats.coal+unit2.heats.coal,bio:unit1.heats.bio+unit2.heats.bio}}};
 assert.ok(Math.abs(ui.combinedCoalBio(combined).ratio-26.625374866987112)<1e-9);
 const js=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
 assert.match(js,/Bio 혼소율 \(Coal\+Bio\)/);
 assert.match(ui.markup(),/Bio 혼소율<br><small>\(Coal\+Bio 기준\)<\/small>/);
});


test('V5.5 blank organic or manure fields are treated as zero for total co-firing calculation',()=>{
 const normalized=ui.manualForCalculation({unit1:{organic:50,manure:null},unit2:{organic:50,manure:null}});
 assert.deepEqual(normalized,{unit1:{organic:50,manure:0},unit2:{organic:50,manure:0}});
 const ref=contract.validatePeriodReport(report(),spec).reference;
 const result=core.analyzePeriodSummary(ref,{...spec,organic:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:normalized.unit1.organic,unit2:normalized.unit2.organic},manure:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:normalized.unit1.manure,unit2:normalized.unit2.manure}});
 assert.ok(result.units.unit1.ratios.total>0);
 assert.ok(result.units.unit2.ratios.total>0);
 assert.ok(result.combined.ratios.total>0);
 assert.match(ui.markup(),/빈칸=0t로 계산/);
 const js=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
 assert.match(js,/manualForCalculation/);
 assert.match(js,/빈칸 유기성·축분은 0t로 계산/);
});


test('V5.6 manual Bio transfer keeps Bio total and compensates Coal by heat equivalence',()=>{
 const ref=contract.validatePeriodReport(report(),spec).reference;
 const base=core.analyzePeriodSummary(ref,{...spec,organic:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:50,unit2:50},manure:{start:'2026-09-10T00:00:00+09:00',end:'2026-09-10T13:00:00+09:00',unit1:0,unit2:0}});
 const settings={unit1:{coal:{calorific:5868},bio:{calorific:3237},organic:{calorific:3487},manure:{calorific:3487}},unit2:{coal:{calorific:5868},bio:{calorific:3237},organic:{calorific:3487},manure:{calorific:3487}}};
 const before=base.units.unit1.bio.quantity+base.units.unit2.bio.quantity;
 const r=adjust.manualTransfer(base,settings,1,10);assert.equal(r.ok,true);assert.ok(Math.abs((r.result.units.unit1.bio.quantity+r.result.units.unit2.bio.quantity)-before)<1e-9);
 assert.ok(Math.abs(r.result.units.unit1.coal.quantity-(base.units.unit1.coal.quantity+10*3237/5868))<1e-5);
 assert.ok(Math.abs(r.result.units.unit2.coal.quantity-(base.units.unit2.coal.quantity-10*3237/5868))<1e-5);
 assert.ok(r.result.units.unit1.fuelRatios.total>0);assert.ok(r.result.combined.fuelRatios.total>0);
});

test('V5.6 max Bio t/d is converted to the exact selected period and auto adjustment is deterministic',()=>{
 assert.equal(adjust.periodCap(240,12),120);assert.equal(adjust.periodCap(361.74,24),361.74);
 const base={period:{durationHours:12},units:{unit1:{coal:{quantity:400},bio:{quantity:150},organic:{quantity:0},manure:{quantity:0},heats:{}},unit2:{coal:{quantity:400},bio:{quantity:50},organic:{quantity:0},manure:{quantity:0},heats:{}}},combined:{}};
 const settings={unit1:{coal:{calorific:5868},bio:{calorific:3237},organic:{calorific:3487},manure:{calorific:3487}},unit2:{coal:{calorific:5868},bio:{calorific:3237},organic:{calorific:3487},manure:{calorific:3487}}};
 const r=adjust.autoMax(base,settings,240);assert.equal(r.ok,true);assert.equal(r.adjustment.periodCapTons,120);assert.equal(r.result.units.unit1.bio.quantity,120);assert.equal(r.result.units.unit2.bio.quantity,80);assert.equal(r.adjustment.excludedBioTons,0);
 const r2=adjust.autoMax(base,settings,100);assert.equal(r2.ok,true);assert.equal(r2.adjustment.periodCapTons,50);assert.equal(r2.result.units.unit1.bio.quantity,50);assert.equal(r2.result.units.unit2.bio.quantity,50);assert.equal(r2.adjustment.excludedBioTons,100);
});

test('V5.6 final adjustment preserves organic/manure and recalculates combined total heat ratio',()=>{
 const base={period:{durationHours:24},units:{unit1:{coal:{quantity:400},bio:{quantity:300},organic:{quantity:50},manure:{quantity:5},heats:{}},unit2:{coal:{quantity:450},bio:{quantity:250},organic:{quantity:40},manure:{quantity:0},heats:{}}},combined:{}};
 const settings={unit1:{coal:{calorific:5868},bio:{calorific:3237},organic:{calorific:3487},manure:{calorific:3487}},unit2:{coal:{calorific:5868},bio:{calorific:3237},organic:{calorific:3487},manure:{calorific:3487}}};
 const r=adjust.adjustFinal(base,settings,280,270,{mode:'manual_final'});assert.equal(r.ok,true);assert.equal(r.result.units.unit1.organic.quantity,50);assert.equal(r.result.units.unit1.manure.quantity,5);assert.ok(r.result.units.unit1.fuelRatios.total>r.result.units.unit1.fuelRatios.bio);assert.ok(r.result.combined.fuelRatios.total>0);
});

test('V5.6 markup exposes fast preparation and the integrated co-firing adjustment entry',()=>{
 const html=ui.markup();assert.match(html,/기간계산 V5\.6/);assert.match(html,/data-cfv56-prep/);assert.match(html,/data-cfv56-adjust/);assert.match(html,/혼소 조정/);assert.match(html,/고속 준비/);
 const adj=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-adjustment-v56.js'),'utf8');assert.match(adj,/CO-FIRING ADJUSTMENT/);assert.match(adj,/1호기 → 2호기/);assert.match(adj,/최대혼소 자동 조정/);assert.match(adj,/Coal 자동 보정/);
});

test('V5.6 reduces period web/Agent polling to one second and auto-starts safe fast preparation',()=>{
 const live=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-live.js'),'utf8');assert.match(live,/createPeriod[\s\S]*?setTimer\(\(\)=>\{timer=null;load\(\{force:true\}\);\},1000\)/);
 const agent=fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/ois-login.js'),'utf8');assert.match(agent,/const OIS_AGENT_POLL_INTERVAL =\s*1000;/);
 const js=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');assert.match(js,/function scheduleFastPrep/);assert.match(js,/고속 준비: 선택기간 DataPARC 조회를 미리 시작합니다/);assert.match(js,/await live\.query\(\{explicit:true\}\)/);
});


test('V5.6.1 rejects an expired session without leaving an auto-prep request permanently active',async()=>{
 let token='Bearer stale-token',calls=0;
 const uuid='11111111-1111-4111-8111-111111111111';
 const api=liveApi.createPeriod({
   getHeaders:()=>({Authorization:token}),canQuery:()=>true,isVisible:()=>true,
   setTimeout:()=>0,clearTimeout:()=>{},
   fetch:async(_url,init={})=>{
     calls++;
     if(init.method==='POST')return {ok:true,status:200,json:async()=>({ok:true,periodKey:contract.periodKey(spec),item:{id:uuid,requestType:'cofiring_period',status:'pending'}})};
     return {ok:false,status:401,json:async()=>({ok:false,message:'로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'})};
   }
 });
 api.select(spec);
 const ok=await api.query({explicit:true});
 assert.equal(ok,false);const state=api.state();
 assert.equal(state.authenticated,false);assert.equal(state.canQuery,false);assert.equal(state.item.active,null);assert.match(state.item.error,/세션이 만료/);assert.ok(calls>=2);
 token='Bearer fresh-token';
 const recovered=api.state();assert.equal(recovered.authenticated,true);assert.equal(recovered.canQuery,true);
 api.dispose();
});

test('V5.6.1 keeps pending prep actionable and clearly labels expired authentication',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8');
 assert.match(js,/active\?'상태 확인':'계산하기'/);
 assert.match(js,/prepLabel\('로그인 필요','error'\)/);
 assert.match(js,/로그인 세션이 만료되었습니다\. 다시 로그인하면 고속 준비와 계산을 다시 시작할 수 있습니다/);
 const live=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-live.js'),'utf8');
 assert.match(live,/rejectedAuthKey/);assert.match(live,/AUTH_EXPIRED/);assert.match(live,/d\.active=null/);
});
