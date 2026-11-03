import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source=fs.readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');
const NOW='2026-11-03T21:18:00.000Z';
const TOKEN='fixture-private-session';
const WINDOW={fromDate:'2025-11-04',endDate:'2026-11-04',snapshotAt:NOW};
const CURSOR={workDate:'2026-05-04',updatedAt:'2026-08-02T02:00:00Z',id:'last-confirmed-source'};
const resume=()=>({phase:'replacement',replacementAutoVersion:3,normalizationVersion:4,replacementComplete:false,
  limit:2,window:{...WINDOW},cursor:{...CURSOR},totals:{scannedReplacementLogs:188,autoLinkedReplacementCount:26}});
const failed=()=>Object.assign(new Error('Synthetic D1 resource failure'),{status:503,code:'BLOWER_LOG_PAGE_FAILED',
  cfRay:'fixture-edge',responseKind:'JSON',retryable:true,payload:{token:TOKEN,body:'private-raw-body'},
  headers:{Authorization:'private-auth-header'},cause:{secret:'private-nested-cause'}});
function continuation(handler,overrides={}){
  let clock=0;const requests=[],sleeps=[],checkpoints=[];
  const options={replacementAutoVersion:3,normalizationVersion:4,autoContinue:true,resume:resume(),
    clock:()=>clock,sleep:async ms=>{clock+=ms;sleeps.push(ms)},...overrides};
  const io={assertWritable(){},checkpoint(value){checkpoints.push(structuredClone(value))},async api(request){
    requests.push(structuredClone(request));assert.equal(request.body.action,'latest_logs_step','no RUN request during source recovery');
    return handler(request,requests.length);
  }};
  return {options,io,requests,sleeps,checkpoints,elapsed:()=>clock};
}
function page(phase,overrides={}){
  return{ok:true,version:'bounded-logs-v1',replacementAutoVersion:3,normalizationVersion:4,phase,done:true,
    window:{...WINDOW},nextCursor:null,scannedLogCount:0,insertedCount:0,appliedStateChanges:0,...overrides};
}

test('one click at cumulative 188 sources keeps fifteen bounded attempts and exposes the final HTTP/code/Ray with its saved position',async()=>{
  const f=continuation(()=>{throw failed()});const original=structuredClone(f.options.resume);
  const result=await core.refreshLogsForRuntime(f.io,f.options);
  assert.equal(f.requests.length,15);assert.equal(f.elapsed(),48000);
  assert.equal(result.automaticContinuation.chunks,3);assert.equal(result.automaticContinuation.strikes,3);
  assert.equal(result.runtimeAllowed,false);assert.equal(result.replacementComplete,false);assert.equal(result.complete,false);
  assert.equal(result.totals.scannedReplacementLogs,188);assert.equal(result.totals.autoLinkedReplacementCount,26);
  for(const r of f.requests){assert.deepEqual(r.body.cursor,CURSOR);assert.deepEqual(r.body.window,WINDOW)}
  const end=f.checkpoints.at(-1);assert.deepEqual(end.cursor,CURSOR);assert.equal(end.limit,1);
  assert.deepEqual(f.options.resume,original,'the caller checkpoint is not rewritten in place');
  const failure=result.automaticContinuation.lastFailure;
  assert.equal(failure.status,503);assert.equal(failure.code,'BLOWER_LOG_PAGE_FAILED');assert.equal(failure.cfRay,'fixture-edge');
  assert.equal(failure.lastCompletedWorkDate,'2026-05-04');assert.equal(failure.processedSourceCount,188);assert.equal(failure.pageLimit,1);
  assert.match(result.warning,/HTTP 503/);assert.match(result.warning,/BLOWER_LOG_PAGE_FAILED/);assert.match(result.warning,/fixture-edge/);
  assert.match(result.warning,/마지막 완료 업무일지 2026-05-04/);assert.match(result.warning,/누적 확인 188건/);
  assert.doesNotMatch(JSON.stringify(result),/private-session|private-raw-body|private-auth-header|private-nested-cause|Authorization/);
});

test('natural page-slice pauses retain their reason without inventing a server error',async()=>{
  let n=0;const f=continuation(()=>page('replacement',{done:false,scannedLogCount:1,nextCursor:{...CURSOR,id:'next-'+(++n)}}),
    {maxPages:1,maxContinuationChunks:2});
  const result=await core.refreshLogsForRuntime(f.io,f.options);
  assert.equal(f.requests.length,2);assert.equal(result.runtimeAllowed,false);
  assert.equal(result.automaticContinuation.lastFailure,undefined);assert.doesNotMatch(result.warning,/마지막 오류|HTTP|Ray/);
  assert.equal(result.totals.scannedReplacementLogs,190);
});

test('a recovered page completes without leaking the prior failed pass into a successful outcome',async()=>{
  const f=continuation((request,index)=>{if(index<=5)throw failed();return page(request.body.phase,{scannedLogCount:request.body.phase==='replacement'?1:0})});
  const result=await core.refreshLogsForRuntime(f.io,f.options);
  assert.equal(result.complete,true);assert.equal(result.runtimeAllowed,true);assert.equal(result.warning,'');
  assert.equal(result.automaticContinuation.lastFailure,undefined);assert.equal(result.continuationFailure,undefined);
  assert.equal(result.totals.scannedReplacementLogs,189);assert.equal(f.checkpoints.at(-1),null);
});

function httpHarness(payload,status=503){
  const calls=[];
  const context=vm.createContext({API_URL:'/api/blower-history',Promise,Error,Number,String,Math,JSON,Object,Date,Set,
    window:{setTimeout(){return 1},clearTimeout(){}},assertUnifiedRefreshWritable(){},hasAuthenticatedWriteAccess:()=>true,
    getAuthHeaders:extra=>extra||{},getSessionToken:()=>TOKEN,parseRetryAfterMs:()=>0,
    fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(payload),{status,headers:{'CF-Ray':'safe-edge'}})}});
  const start=source.indexOf('  async function sendApiRequest('),end=source.indexOf('  function buildAdaptiveRetryLimits(',start);
  assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
  return{calls,send:options=>context.sendApiRequest(options)};
}

test('ordinary application JSON retryable false is honored for HTTP 503 and 429 without retries or RUN bypass',async()=>{
  for(const status of [503,429]){
    const h=httpHarness({ok:false,code:'BLOWER_SOURCE_RESOURCE_LIMIT',message:'Source query limit',retryable:false},status);
    const f=continuation(request=>h.send(request));
    await assert.rejects(core.refreshLogsForRuntime(f.io,f.options),e=>e.status===status&&e.retryable===false&&e.code==='BLOWER_SOURCE_RESOURCE_LIMIT');
    assert.equal(h.calls.length,1);assert.equal(f.sleeps.length,0);assert.deepEqual(f.checkpoints.at(-1).cursor,CURSOR);
    let reads=0;await assert.rejects(core.readWithRetry(async()=>{reads++;return h.send({})},{assertWritable(){}},'stored state',{sleep:async()=>{throw Error('unexpected retry')}}),e=>e.retryable===false);
    assert.equal(reads,1);
  }
});

test('HTTP public error fields are bounded and redact the active token before continuation diagnostics use them',async()=>{
  const h=httpHarness({ok:false,message:'Error '+TOKEN+' '+ 'm'.repeat(1000),code:'SOURCE_'+TOKEN+' '+ 'c'.repeat(300),
    retryable:true,payload:{token:TOKEN}},503);
  const f=continuation(request=>h.send(request));const result=await core.refreshLogsForRuntime(f.io,f.options);
  const failure=result.automaticContinuation.lastFailure;
  assert.doesNotMatch(JSON.stringify(result),new RegExp(TOKEN));
  assert.ok(failure.message.length<=700);assert.ok(failure.code.length<=120);assert.equal(failure.cfRay,'safe-edge');
  assert.match(failure.message,/인증정보 숨김/);
});

function node(){return{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,required:false,open:false,
  dataset:{},title:'',style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},replaceChildren(){},focus(){},addEventListener(){},showModal(){this.open=true},close(){this.open=false}}}
async function uiHarness({readFails=false}={}){
  const nodes=new Map(),requests=[];let clock=0,reloads=0;
  const runtimeCore={...core,refreshLogsForRuntime(io,options){return core.refreshLogsForRuntime(io,{...options,
    clock:()=>clock,sleep:async ms=>{clock+=ms}})}};
  const context=vm.createContext({console,Date,clearTimeout(){},performance:{now:()=>0},HTMLButtonElement:class{},navigator:{},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    document:{readyState:'loading',body:node(),querySelectorAll:()=>[],addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)}},
    window:{BlowerUnifiedRefresh:runtimeCore,matchMedia:()=>({matches:false}),sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
      setTimeout(fn){fn()},setInterval(){return 1},clearInterval(){},addEventListener(){}}});
  const marker='  if (document.readyState === "loading") {';assert.equal(source.split(marker).length,2);
  vm.runInContext(source.replace(marker,`globalThis.ui={state,elements,cacheElements,refreshAllBlowers,renderInlineRefreshStatus};
    globalThis.hooks=h=>{apiRequest=h.api;loadData=h.load;getSessionToken=()=> '${TOKEN}';
      currentServerDate=()=>new Date('${NOW}');showToast=()=>{};setBusy=v=>{state.busy=v;};
      startUnifiedRefreshFeedback=()=>{};finishUnifiedRefreshFeedback=()=>{};renderAssets=()=>{};renderOverviewRefreshPanel=()=>{};};\n`+marker),context);
  const ui=context.ui;ui.cacheElements();
  ui.state.data={assets:Array.from({length:27},(_,i)=>({tagNumber:i===0?'103HRJ01AN601':'fixture-'+i,displayName:'Preserved '+i,
      enabled:true,lastReplacementAt:'2026-09-18T05:20:00.000Z',runtimeHours:1119.1+i})),events:[],permissions:{canWrite:true},
    user:{employeeNo:'fixture-user',name:'Fixture'},backfill:{hasRun:true,status:'complete'},settings:{},types:[],missingSlots:[],missingTags:[],replacementNormalizationVersion:4};
  const original=structuredClone(ui.state.data);
  ui.state.unifiedLogResume=resume();ui.state.unifiedLogResume.window.snapshotAt=new Date().toISOString();
  ui.state.unifiedLogResumeOwner=TOKEN;
  context.hooks({async api(request){requests.push(structuredClone(request));assert.equal(request.body?.action,'latest_logs_step');throw failed()},
    async load(){reloads++;if(readFails)throw Object.assign(new Error('Stored state read unavailable'),{status:503,code:'STORED_READ_LIMIT',retryable:false});return ui.state.data}});
  await ui.refreshAllBlowers();ui.renderInlineRefreshStatus();
  return{ui,original,requests,reloads,elapsed:clock};
}

test('the actual UI retains the 188-source cause and all 27 saved values after one click without requesting RUN',async()=>{
  const f=await uiHarness();assert.equal(f.requests.length,15);assert.equal(f.elapsed,48000);assert.equal(f.reloads,1);
  assert.equal(f.ui.state.unifiedRefreshRuntimePlanned,false);assert.equal(f.ui.state.unifiedRefreshResults.length,0);
  assert.equal(f.ui.state.unifiedLogResume.totals.scannedReplacementLogs,188);assert.deepEqual(f.ui.state.data,f.original);
  const detail=f.ui.elements.unifiedRefreshDiagnosticText.textContent;
  assert.match(detail,/HTTP 503/);assert.match(detail,/BLOWER_LOG_PAGE_FAILED/);assert.match(detail,/fixture-edge/);
  assert.match(detail,/마지막 완료 업무일지 2026-05-04/);assert.match(f.ui.elements.overviewRefreshCount.textContent,/188건/);
  assert.equal(f.ui.elements.unifiedRefreshStatus.dataset.state,'partial');
});

test('a failed committed-state read keeps the original source failure visible and never issues another read on explicit retryable false',async()=>{
  const f=await uiHarness({readFails:true});assert.equal(f.requests.length,15);assert.equal(f.reloads,1);
  assert.deepEqual(f.ui.state.data,f.original);assert.equal(f.ui.state.unifiedRefreshRuntimePlanned,false);
  assert.equal(f.ui.state.unifiedLogResume.totals.scannedReplacementLogs,188);
  const detail=f.ui.elements.unifiedRefreshDiagnosticText.textContent;
  assert.match(detail,/STORED_READ_LIMIT/);assert.match(detail,/BLOWER_LOG_PAGE_FAILED/);assert.match(detail,/fixture-edge/);
  assert.equal(f.ui.elements.unifiedRefreshStatus.dataset.state,'failed');
});
