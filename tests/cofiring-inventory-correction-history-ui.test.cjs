'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {normalizeItem}=require('../maintenance/morning-meeting-closed-cofiring.js');
const detailCode=fs.readFileSync(require.resolve('../maintenance/cofiring-closed-history-final-detail-v1.js'),'utf8');
const morningCode=fs.readFileSync(require.resolve('../maintenance/morning-meeting-closed-cofiring.js'),'utf8');
const DATE='2026-10-23';
function item({corrected=true,adjusted=false}={}){
  const period={startLocal:DATE+'T00:00',endLocal:'2026-10-24T00:00'};
  const summaryUnit={coal:700,bio:11.6953125,organic:25,manure:0,bioRatio:1.2,organicGroupRatio:3.4,totalRatio:4.6};
  const unit={coal:{quantity:700},bio:{quantity:11.6953125},organic:{quantity:25},manure:{quantity:0},heats:{coal:100,bio:10},fuelRatios:{organicGroup:3.4,total:4.6}};
  const result={units:{unit1:structuredClone(unit),unit2:structuredClone(unit)},combined:{heats:{coal:200,bio:20},fuelRatios:{organicGroup:3.4,total:4.6}},...(adjusted?{adjustment:{applied:true,mode:'manual_transfer'}}:{})};
  const correction={silo:'organicStorageSiloB',boundaryLocal:'2026-10-24T00:00',tons:30.190001,method:'confirmed',reason:'마감 당시 운전 기록 <img src=x onerror=alert(1)>',
    evidence:[{id:'frozen-record',version:2}],evidenceSnapshots:[{id:'frozen-record',version:2,arrivalLocal:'2026-10-23T23:30',departureLocal:'2026-10-24T00:20',companyName:'보존 업체',vehicleNo:'1234',receiptTons:20,siloRoute:'#B',note:'보존 기록 <script>bad()</script>'}],
    revision:3,updatedById:'operator-old',updatedByName:'마감 담당자 <b>홍</b>',updatedAt:'2026-10-25T13:00:00Z'};
  return {targetDate:DATE,revision:1,sourceRequestId:'closed-source',updatedAt:'2026-10-25T13:10:00Z',savedByName:'저장 담당자',
    summary:{unit1:{...summaryUnit},unit2:{...summaryUnit},combined:{...summaryUnit}},
    organicInventory:{...period,basis:corrected?'operator_corrected_period_boundary':'dataparc_period_boundary',end:{organicDaySilo:10,organicStorageSiloA:40,organicStorageSiloB:30.190001,total:80.190001}},
    snapshot:{schemaVersion:1,targetDate:DATE,sourceRequestId:'closed-source',period,manual:{receipts:{organic:30}},organicUsage:{startTotal:100,endTotal:80.190001},result,
      ...(adjusted?{originalResult:structuredClone(result)}:{}),...(corrected?{inventoryCorrectionVersion:1,organicCorrections:[correction]}:{})}};
}
async function detail(item){
  const content={innerHTML:'',scrollTop:0},calls=[];
  const panel={classList:{add(){},remove(){}},appendChild(el){el.isConnected=true;}};
  const drawer={isConnected:false,setAttribute(){},querySelector:()=>content,addEventListener(){},closest:()=>panel};
  const document={readyState:'loading',addEventListener(){},querySelectorAll:()=>[],querySelector:selector=>selector==='.efficiency-team-panel'?panel:null,createElement:()=>drawer};
  const context={document,console,addEventListener(){},getShiftLogAuthHeaders:()=>({Authorization:'Bearer test'}),
    // A newer live correction is deliberately present; saved detail must ignore it.
    CofiringInventoryCorrectionUI:{state:()=>({entries:[{tons:999999,reason:'newer live value'}]})},
    fetch:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({ok:true,item:structuredClone(item)})};}};
  vm.runInNewContext(detailCode,context);
  await context.CofiringClosedHistoryFinalDetailV1.openDate(DATE,null);
  return {html:content.innerHTML,calls};
}
function morning(saved){
  const nodes=new Map(),PREFIX='efficiencyMorningMeetingAutoDaily';
  const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{},setAttribute(){},querySelector(){return null;}});return nodes.get(id);};
  node('efficiencyMorningMeetingWaterPanel').dataset.morningMeetingAutoBaseDate=DATE;
  for(const suffix of ['SludgeCard','SludgeDate','SludgeStatus','SludgeRefreshButton','SludgeTotal','SludgeTruckCount','OrganicDaySilo','OrganicStorageSiloA','OrganicStorageSiloB','OrganicSiloTotal'])node(PREFIX+suffix);
  const document={readyState:'loading',getElementById:id=>nodes.get(id)||null,body:{},addEventListener(){},dispatchEvent(){}};
  const window={document,getShiftLogAuthHeaders:()=>new Headers({Authorization:'Bearer test'}),setTimeout:()=>1,clearTimeout(){},addEventListener(){},
    fetch:async url=>({ok:true,json:async()=>String(url).startsWith('/api/cofiring-')?{ok:true,item:structuredClone(saved)}:
      {ok:true,source:'solid-fuel-unloading',basis:'completed-unloading-departure',receiptStart:saved.snapshot.period.startLocal,receiptEnd:saved.snapshot.period.endLocal,receipts:{organic:30},counts:{organic:1}}})};
  vm.runInNewContext(morningCode,{window,document,Headers,URLSearchParams,AbortController,CustomEvent:class{},MutationObserver:class{observe(){}},console});
  return {api:window.morningMeetingClosedCofiring,node:suffix=>node(PREFIX+suffix)};
}

test('closed detail renders frozen correction and evidence audit without fetching current replacements or changing input',async()=>{
  const saved=item(),before=JSON.stringify(saved),out=await detail(saved);
  assert.equal(JSON.stringify(saved),before);
  assert.equal(out.calls.length,1);assert.match(out.calls[0].url,/cofiring-closed-history\?targetDate=2026-10-23/);
  assert.match(out.html,/확정 재고 보완 적용/);assert.match(out.html,/2026-10-24 00:00/);assert.match(out.html,/30\.190001 t/);
  assert.match(out.html,/v3/);assert.match(out.html,/frozen-record · v2/);assert.match(out.html,/2026-10-23T23:30/);assert.match(out.html,/보존 업체/);
  assert.match(out.html,/이후 수정된 보완값은 이 마감 내역에 소급 적용하지 않습니다/);
  assert.doesNotMatch(out.html,/999999|newer live value|특이사항이 없습니다|최종 마감 \(원본과 동일\)|최종 마감값은 원본 계산값과 동일/);
});

test('closed audit escapes notes, author and evidence while keeping adjustment comparison labels explicit',async()=>{
  const out=await detail(item({adjusted:true}));
  assert.match(out.html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(out.html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.match(out.html,/마감 담당자 &lt;b&gt;홍&lt;\/b&gt;/);
  assert.doesNotMatch(out.html,/<img|<script>|<b>홍<\/b>/);
  assert.match(out.html,/재고 보완 계산 ↔ 혼소조정 비교/);assert.match(out.html,/재고 보완 계산 \(조정 전\)/);
  assert.doesNotMatch(out.html,/원본 \(계산값\)/);
});

test('ordinary closed detail keeps previous labels and does not manufacture correction metadata',async()=>{
  const out=await detail(item({corrected:false}));
  assert.match(out.html,/최종 마감값은 원본 계산값과 동일합니다/);assert.match(out.html,/특이사항이 없습니다/);assert.match(out.html,/최종 마감 \(원본과 동일\)/);
  assert.doesNotMatch(out.html,/확정 재고 보완 적용|마감 당시 재고 보완 근거/);
});

test('morning mapping marks only accepted operator-basis inventory without altering saved quantities',()=>{
  const saved=item(),before=JSON.stringify(saved),projected=normalizeItem(saved,DATE);
  assert.equal(projected.inventoryCorrected,true);assert.equal(projected.organic.organicStorageSiloB,30.190001);assert.equal(projected.unitTwo.bio,11.6953125);
  assert.equal(JSON.stringify(saved),before);
  const ordinary=normalizeItem(item({corrected:false}),DATE);assert.equal(Object.hasOwn(ordinary,'inventoryCorrected'),false);
  saved.organicInventory.end.total=999;
  assert.equal(Object.hasOwn(normalizeItem(saved,DATE),'inventoryCorrected'),false);
  assert.equal(normalizeItem(saved,DATE).organic.organicStorageSiloB,null);
});

test('morning card visibly distinguishes confirmed correction while ordinary date and badge stay unchanged',async()=>{
  const corrected=morning(item());await corrected.api.load(DATE);
  assert.equal(corrected.node('SludgeDate').textContent,DATE+' · 마감자료 · 확인 보완');
  assert.equal(corrected.node('SludgeStatus').textContent,'마감값 · 확인 보완');
  assert.match(corrected.node('SludgeCard').title,/마감 당시 확인 보완값 포함/);
  const ordinary=morning(item({corrected:false}));await ordinary.api.load(DATE);
  assert.equal(ordinary.node('SludgeDate').textContent,DATE+' · 마감자료');assert.equal(ordinary.node('SludgeStatus').textContent,'마감값');
  assert.equal(ordinary.node('SludgeCard').title,'선택일의 혼소율 마감자료 · 재고는 마감 계산의 종료값');
});
