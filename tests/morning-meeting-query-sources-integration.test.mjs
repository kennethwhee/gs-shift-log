import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const script=readFileSync(new URL('../script.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const select=(start,end)=>script.slice(script.indexOf(start),script.indexOf(end,script.indexOf(start)));
const helper=select('  function isExplicitDailyWorkbookQuery(','  async function createSteamStatusRequest(');
const creator=select('  async function createSteamStatusRequest(','  async function getSteamStatusRequest(');
const loader=select('  async function loadSteamStatus(','function scheduleAutomaticLoad()');
const intent={userInitiated:true,querySource:'daily_data_excel',forceRefresh:true};
function harness(){
  let date='2026-09-01', token='signed-in', mobile=false;
  const calls=[],state={steamStatus:{sourceDate:date, generatorEcmsGen1:1234,sludgeTotal:55}},panel={dataset:{}};
  const context=vm.createContext({window:{navigator:{userAgent:'Windows',platform:'Win32'},matchMedia:()=>({matches:mobile})},
    Error, console:{warn(){},error(){}},getShiftLogSessionToken:()=>token, getShiftLogAuthHeaders:x=>x,
    normalizeText:x=>String(x??'').trim(), synchronizeTargetDate:()=>date,resolveTargetDate:()=>date,
    getState:()=>state,getElements:()=>({panel}),isCompleteDailyDataResult:r=>Boolean(r&&typeof r.generatorEcmsGen1==='number'),
    renderSteamStatus(){},activeRunToken:0, OIS_REQUEST_API_URL:'/api/ois-data-requests',REQUEST_TYPE:'daily_data_excel',
    readApiResponse:r=>r.json(),fetch:async(url,options)=>{calls.push({url,options});return{json:async()=>({item:{id:'file-request',targetDate:date,requestType:'daily_data_excel',status:'complete'}})}},
    applySteamStatusResult(item,targetDate){state.steamStatus={sourceDate:targetDate,generatorEcmsGen1:2000};return state.steamStatus;},
    waitForCompletion:async()=>{throw Error('Unexpected poll');}});
  vm.runInContext(helper+creator+loader,context);
  return{context,state,panel,calls,load:options=>context.loadSteamStatus(options),
    setDate:v=>{date=v;},setToken:v=>{token=v;},setMobile:v=>{mobile=v;}};
}
test('workbook entry requires explicit source intent and authenticated desktop, including the lower POST boundary',async()=>{
  const h=harness();
  for(const options of [{},{userInitiated:true},{userInitiated:true,querySource:'dataparc'},intent]){
    if(options===intent)h.setMobile(true);
    await h.load(options);
    await assert.rejects(h.context.createSteamStatusRequest('2026-09-01',options),/조회하기/);
  }
  h.setMobile(false);h.setToken('');await h.load(intent);
  assert.equal(h.calls.length,0);
  h.setToken('signed-in');await h.load(intent);
  assert.equal(h.calls.length,1);
  assert.deepEqual(JSON.parse(h.calls[0].options.body),{requestType:'daily_data_excel',targetDate:'2026-09-01',forceRefresh:true});
});
test('failed workbook refresh retains previous same-day values and reports failure',async()=>{
  const h=harness(),before=h.state.steamStatus;
  h.context.fetch=async()=>{throw Error('Excel file unavailable');};
  assert.equal(await h.load(intent),null);
  assert.equal(h.state.steamStatus,before);
  assert.equal(h.state.steamStatus.sludgeTotal,55);
  assert.equal(h.panel.dataset.steamStatusStatus,'error');
  assert.match(h.state.steamStatusError,/Excel file unavailable/);
});
test('late workbook success or failure after a date change cannot overwrite the current date',async()=>{
  for(const failure of [false,true]){
    const h=harness();let finish;
    h.context.fetch=()=>new Promise((resolve,reject)=>{finish=()=>failure?reject(Error('old failure')):resolve({json:async()=>({item:{id:'old',requestType:'daily_data_excel',status:'complete'}})});});
    const pending=h.load(intent);
    h.setDate('2026-09-02');h.state.steamStatus={sourceDate:'2026-09-02',generatorEcmsGen1:888};
    finish();await pending;
    assert.equal(h.state.steamStatus.generatorEcmsGen1,888);
    assert.equal(h.state.steamStatusError,undefined);
  }
});
test('failed new-day query cannot keep old-day workbook values',async()=>{
  const h=harness();h.setDate('2026-09-02');h.context.fetch=async()=>{throw Error('No file');};
  await h.load(intent);assert.equal(h.state.steamStatus,undefined);
});
test('bulk OIS and analysis paths cannot trigger workbook reads; legacy Cofiring action shares explicit source routing',()=>{
  const bulk=select('  function createBulkLookupItems()','  async function runBulkLookupItem(');
  assert.ok(bulk.length>0);assert.doesNotMatch(bulk,/"daily-data"|loadEfficiencyMorningMeetingSteamStatus/);
  assert.match(script,/void dailyDataLoader\(\{\s*forceRefresh:\s*false,\s*userInitiated:\s*false/);
  const co=readFileSync(new URL('../maintenance/morning-meeting-cofiring-card.js',import.meta.url),'utf8');
  assert.doesNotMatch(co,/method:\s*"POST"[\s\S]{0,300}requestType:\s*"daily_data_excel"/);
  assert.match(co,/morningMeetingQuerySources\?\.query\("workbook", \{ userInitiated: true \}\)/);
});
test('partial or zero workbook Silo stock is labelled as file data, never DataPARC completion',()=>{
  const code=readFileSync(new URL('../maintenance/morning-meeting-organic-silo-dataparc.js',import.meta.url),'utf8');
  for(const field of ['organicDaySilo','organicStorageSiloALevel']){
    const node=()=>({textContent:'',dataset:{},parentElement:{},classList:{toggle(){}},setAttribute(){}});
    const nodes=new Map(['efficiencyMorningMeetingAutoDailySludgeCard','organicSiloDataParcControls','organicSiloDataParcStatus',
      'organicSiloDataParcQueryButton','organicSiloDataParcSourceLabel','efficiencyMorningMeetingAutoDailyOrganicDaySilo'].map(id=>[id,node()]));
    const panel=node();panel.dataset.morningMeetingAutoBaseDate='2026-09-01';nodes.set('efficiencyMorningMeetingWaterPanel',panel);
    const window={navigator:{userAgent:'Windows'},matchMedia:()=>({matches:false}),efficiencyMorningMeetingUploadState:{steamStatus:{sourceDate:'2026-09-01',[field]:0}}};
    vm.runInNewContext(code,{window,Map,Set,Date,document:{readyState:'loading',addEventListener(){},getElementById:id=>nodes.get(id)},getShiftLogSessionToken:()=>''});
    window.organicSiloDataParc.render();
    assert.equal(nodes.get('organicSiloDataParcControls').dataset.valueSource,'daily_data_excel');
    assert.equal(nodes.get('organicSiloDataParcSourceLabel').textContent,'일일 DATA 엑셀 · Silo 재고');
    assert.equal(nodes.get('organicSiloDataParcStatus').textContent,'파일 값');
    assert.equal(window.organicSiloDataParc.valuesForWorkbook({}).organicSiloTotal,undefined);
  }
});
