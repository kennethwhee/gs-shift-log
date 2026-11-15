'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parallel = require('../local-tools/ois-agent/morning-ois-parallel-v1.cjs');
const source = fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/ois-login.js'),'utf8');
const keys = parallel.TYPES;
const items = keys.map((requestType,i)=>({id:`request-${i}`,requestType,targetDate:'2026-11-14'}));
const reply = batch => ({items:{ois:batch[0]||null,morningOis:batch},morningOisParallelVersion:1,morningOisConcurrency:4});
const deferred = () => {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush = async () => {for(let i=0;i<50;i++)await Promise.resolve();};
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}

test('claim parser retains old-server single mode and enforces four unique same-date read sources',()=>{
  assert.deepEqual(parallel.claimedOisItems({items:{ois:items[0]}}),[items[0]]);
  assert.deepEqual(parallel.claimedOisItems(reply(items)),items);
  assert.deepEqual(parallel.claimedOisItems(reply([])),[]);
  for(const bad of [
    {...reply(items),morningOisParallelVersion:2},
    reply([...items,items[0]]),reply([items[0],items[0]]),
    reply([items[0],{...items[1],requestType:items[0].requestType}]),
    reply([items[0],{...items[1],targetDate:'2026-11-13'}]),
    reply([items[0],{...items[1],requestType:'bed_ash_level'}]),
    {...reply(items),items:{ois:{id:'other'},morningOis:items}}
  ]) assert.throws(()=>parallel.claimedOisItems(bad));
});

test('real queue client opts in, retains old-server fallback, and excludes Water from fills while Excel is active',async()=>{
  const code=section('async function getNextOisAgentLaneRequests(','/* =========================================================');
  const calls=[];let response=reply(items);
  const context={morningOisParallelV1:parallel,isCofiringExcelBlocked:()=>false,isBedAshExcelBlocked:()=>false,
    getOisAgentRequestType:item=>item.requestType,normalizeOisAgentText:x=>String(x??'').trim(),
    DAILY_OPERATION_REQUEST_TYPE:'daily_operation_dataparc',BLOWER_RUNTIME_PROBE_REQUEST_TYPE:'blower_runtime_probe',
    getOisAgentApiUrl:(_c,query)=>query,requestOisAgentApi:async(_c,query)=>{calls.push(query);return response;},console:{warn(){}}};
  vm.createContext(context);vm.runInContext(code,context);
  const claimed=await context.getNextOisAgentLaneRequests({agentMode:'all'});
  assert.equal(claimed.length,4);assert.equal(claimed.morningParallelSupported,true);assert.equal(calls[0].morningOisConcurrency,4);
  response={items:{ois:items[0]}};
  const legacy=await context.getNextOisAgentLaneRequests({agentMode:'all'});
  assert.equal(legacy.length,1);assert.equal(legacy.morningParallelSupported,false);
  response=reply([items[1]]);
  await context.getMorningOisFillRequests({},items[0],true);
  assert.equal(calls.at(-1).action,'morning_ois_fill');assert.equal(calls.at(-1).primaryRequestId,items[0].id);
  assert.equal(calls.at(-1).requestTypes.includes('water_environment'),false);
  response=reply([{...items[1],targetDate:'2026-11-13'}]);
  await assert.rejects(context.getMorningOisFillRequests({},items[0],false),/기준일/);
  response={...reply([items[1]]),laneErrors:{ois:'temporary database limit'}};
  const partial=await context.getMorningOisFillRequests({},items[0],false);
  assert.equal(partial[0].id,items[1].id);assert.match(partial.fillError.message,/temporary database limit/);
});

test('a fill error retains newly claimed work and reports the error instead of silently polling every second',async()=>{
  const water=deferred(),started=[],errors=[];let fills=0;
  await parallel.runWithFills({items:[items[0]],intervalMs:1,
    processItem:async item=>{started.push(item.id);if(item.id===items[0].id)await water.promise;},
    claimMore:async()=>{fills++;const more=[items[1]];more.fillError=new Error('fill failed after one claim');return more;},
    onAdded(){},onFillError:error=>{errors.push(error.message);water.resolve();}});
  assert.deepEqual(started,[items[0].id,items[1].id]);assert.equal(fills,1);assert.deepEqual(errors,['fill failed after one claim']);
});

const MAIN_URL='http://ois.gspoge.com/jsp/login/main';
function fakeBrowser({configurePage=()=>{}}={}){
  const contexts=[],events=[];let connected=true;
  const browser={on(){},isConnected:()=>connected,async close(){events.push('browser-close');connected=false;},async newContext(options={}){
    const pages=[];let closed=false;
    const context={options,authenticated:contexts.length===0||options.storageState?.cookies?.some(c=>c.name==='JSESSIONID'&&c.value==='fixture-owner-session'),
      pages:()=>pages,async storageState(opts){events.push(['storage',context,opts]);return {cookies:context.authenticated?[{name:'JSESSIONID',value:'fixture-owner-session',domain:'ois.gspoge.com',path:'/'}]:[],origins:[]};},
      async close(){if(!closed){closed=true;events.push(['context-close',context]);for(const p of pages)p.closed=true;}},
      async newPage(){
        const page={closed:false,currentUrl:'about:blank',initialUrl:'about:blank',loginVisible:false,childLoginVisible:false,
          url:()=>page.currentUrl,isClosed:()=>page.closed,context:()=>context,
          async goto(url,settings){events.push(['goto',page,url,settings]);if(page.navigationError)throw page.navigationError;
            page.currentUrl=url===MAIN_URL&&(page.redirectToLogin||!context.authenticated)?'http://ois.gspoge.com/jsp/login/index':url;},
          async waitForTimeout(){events.push(['wait',page]);},
          locator(selector){return {async isVisible(){return page.loginVisible;},async fill(){events.push(['credential-fill',page]);throw new Error('unexpected worker credential entry');}};},
          async close(){page.closed=true;events.push(['page-close',page]);}};
        page.frames=()=>[page,...(page.childLoginVisible?[{locator(){return {async isVisible(){return true;}};}}]:[])];
        configurePage(page,contexts.indexOf(context));pages.push(page);return page;
      }};
    contexts.push(context);events.push(['context-open',context]);return context;
  }};
  return {browser,contexts,events};
}
async function makeOwner(f){
  const context=await f.browser.newContext(),page=await context.newPage();await page.goto(MAIN_URL);
  return {browser:f.browser,context,page,primaryPage:page};
}

function realLoginGuard(){
  const code=section('async function ensureOisAgentLoggedIn(','/* =========================================================');
  const ctx={OIS_LOGIN_URL:'http://ois.gspoge.com/jsp/login/index',OIS_QUERY_TIMEOUT:30000,
    OIS_SESSION_FILE_PATH:'must-not-write-worker-session',console:{log(){}}};
  vm.createContext(ctx);vm.runInContext(code,ctx);return ctx.ensureOisAgentLoggedIn;
}

test('actual login-index behavior reproduces the field error while four blank workers succeed via the authenticated main entry',async()=>{
  const login=realLoginGuard(),old=fakeBrowser(),oldContext=await old.browser.newContext(),blank=await oldContext.newPage();
  assert.equal(blank.url(),'about:blank');
  await assert.rejects(login(blank,{morningParallelReuseOnly:true}),e=>e.code==='OIS_MORNING_WORKER_SESSION_EXPIRED');
  assert.equal(blank.url(),'http://ois.gspoge.com/jsp/login/index','valid reused state does not imply index auto-redirect');
  const f=fakeBrowser(),owner=await makeOwner(f),started=[];
  owner.page.currentUrl=MAIN_URL+'?view=private-value#menu';
  const batch=parallel.createWorkerBatch({items,config:{},ensureOwner:async()=>owner,ensureLoggedIn:login});
  const sessions=await Promise.all(items.map(async item=>{const session=await batch.ensure(item.id);started.push(item.id);return session;}));
  assert.equal(started.length,4);assert.equal(new Set(sessions.map(s=>s.context)).size,4);
  for(const session of sessions){assert.equal(session.page.initialUrl,'about:blank');assert.equal(session.page.url(),MAIN_URL);}
  const workerNavigation=f.events.filter(e=>Array.isArray(e)&&e[0]==='goto'&&e[1]!==owner.page);
  assert.equal(workerNavigation.length,4);
  for(const e of workerNavigation){assert.equal(e[2],MAIN_URL);assert.equal(e[3].timeout,30000);assert.equal(e[3].waitUntil,'domcontentloaded');}
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='credential-fill'),false);
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='storage'&&e[2]?.path),false);
  await Promise.all(items.map(x=>batch.finish(x.id)));
});

test('main-entry origin stays aligned with the Agent fixed OIS login URL',()=>{
  const login=source.match(/const\s+OIS_LOGIN_URL\s*=\s*"([^"]+)"/);
  assert.ok(login);assert.equal(new URL(login[1]).origin,new URL(MAIN_URL).origin);
});

test('one worker redirected to login fails without credential entry and leaves three sibling contexts alive',async()=>{
  const f=fakeBrowser({configurePage:(p,index)=>{if(index===1)p.redirectToLogin=true;}}),owner=await makeOwner(f);
  const batch=parallel.createWorkerBatch({items,config:{},ensureOwner:async()=>owner,ensureLoggedIn:realLoginGuard()});
  const results=await Promise.allSettled(items.map(x=>batch.ensure(x.id)));
  assert.equal(results[0].status,'rejected');assert.equal(results[0].reason.code,'OIS_MORNING_WORKER_SESSION_EXPIRED');
  for(const result of results.slice(1)){assert.equal(result.status,'fulfilled');assert.equal(result.value.page.isClosed(),false);}
  assert.equal(f.browser.isConnected(),true);assert.equal(owner.page.isClosed(),false);
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='credential-fill'),false);
  await Promise.all(items.map(x=>batch.finish(x.id)));
});

test('main navigation cannot create a false authenticated success when reused cookies are missing',async()=>{
  const f=fakeBrowser(),owner=await makeOwner(f);
  owner.context.storageState=async()=>({cookies:[],origins:[]});
  const batch=parallel.createWorkerBatch({items:[items[0]],config:{},ensureOwner:async()=>owner,ensureLoggedIn:realLoginGuard()});
  await assert.rejects(batch.ensure(items[0].id),e=>e.code==='OIS_MORNING_WORKER_SESSION_EXPIRED');
  assert.equal(owner.page.isClosed(),false);assert.equal(f.browser.isConnected(),true);
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='credential-fill'),false);
});

for(const child of [false,true])test(`visible login inputs in ${child?'a child frame':'the main page'} fail even when the URL is main`,async()=>{
  const f=fakeBrowser({configurePage:(p,index)=>{if(index===1){if(child)p.childLoginVisible=true;else p.loginVisible=true;}}}),owner=await makeOwner(f);
  const batch=parallel.createWorkerBatch({items:[items[0]],config:{},ensureOwner:async()=>owner,ensureLoggedIn:realLoginGuard()});
  await assert.rejects(batch.ensure(items[0].id),e=>e.code==='OIS_MORNING_WORKER_SESSION_EXPIRED');
  assert.equal(owner.page.isClosed(),false);assert.equal(f.browser.isConnected(),true);
});

test('invalid owner origins, userinfo and lookalike main paths are rejected before any worker navigation',async()=>{
  for(const url of ['http://evil.test/jsp/login/main','http://ois.gspoge.com/jsp/login/main-extra',
    'http://user:private@ois.gspoge.com/jsp/login/main','http://ois.gspoge.com:9999/jsp/login/main']){
    const f=fakeBrowser(),owner=await makeOwner(f);owner.page.currentUrl=url;
    const batch=parallel.createWorkerBatch({items:[items[0]],config:{},ensureOwner:async()=>owner,ensureLoggedIn:realLoginGuard()});
    await assert.rejects(batch.ensure(items[0].id),e=>e.code==='OIS_MORNING_WORKER_SESSION_EXPIRED');
    assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='goto'&&e[1]!==owner.page).length,0);
  }
});

test('a worker navigation error remains a navigation error instead of being mislabeled as session expiry',async()=>{
  const failure=new Error('net::ERR_CONNECTION_RESET');
  const f=fakeBrowser({configurePage:(p,index)=>{if(index===1)p.navigationError=failure;}}),owner=await makeOwner(f);
  const batch=parallel.createWorkerBatch({items:[items[0]],config:{},ensureOwner:async()=>owner,ensureLoggedIn:realLoginGuard()});
  await assert.rejects(batch.ensure(items[0].id),e=>e===failure);
  assert.equal(owner.page.isClosed(),false);assert.equal(f.browser.isConnected(),true);
});

test('workers bootstrap once, own distinct contexts and recover without closing siblings or writing shared auth',async()=>{
  const f=fakeBrowser(),owner=await makeOwner(f);let bootstraps=0,auth=0;
  const batch=parallel.createWorkerBatch({items,config:{},ensureOwner:async()=>{bootstraps++;return owner;},
    ensureLoggedIn:async(_p,c)=>{assert.equal(c.morningParallelReuseOnly,true);auth++;}});
  const sessions=await Promise.all(items.map(x=>batch.ensure(x.id)));
  assert.equal(bootstraps,1);assert.equal(auth,4);assert.equal(new Set(sessions.map(s=>s.context)).size,4);
  assert.equal(new Set(sessions.map(s=>s.page)).size,4);
  sessions[0].page.closed=true;const recovered=await batch.ensure(items[0].id);
  assert.notEqual(recovered.context,sessions[0].context);
  assert.equal(sessions[1].page.isClosed(),false);assert.equal(f.browser.isConnected(),true);
  await Promise.all(items.map(x=>batch.close(x.id)));
  assert.equal(f.events.filter(x=>x==='browser-close').length,0);
  assert.equal(f.events.filter(x=>Array.isArray(x)&&x[0]==='storage').length,1);
  assert.equal(f.events.some(x=>Array.isArray(x)&&x[0]==='storage'&&x[2]?.path),false);
});

test('expired worker authentication closes only its context and refuses an unknown request',async()=>{
  const f=fakeBrowser(),owner=await makeOwner(f);
  const batch=parallel.createWorkerBatch({items,config:{},ensureOwner:async()=>owner,
    ensureLoggedIn:async()=>{throw new Error('auth expired');}});
  await assert.rejects(batch.ensure(items[0].id),/auth expired/);
  await assert.rejects(batch.ensure('unknown'),/속하지 않는/);
  assert.equal(f.events.filter(x=>Array.isArray(x)&&x[0]==='context-close').length,1);
  assert.equal(f.browser.isConnected(),true);
});

test('server-completed work releases its type before slow context cleanup so a newly claimed successor is retained',async()=>{
  const f=fakeBrowser(),owner=await makeOwner(f),closing=deferred();
  const batch=parallel.createWorkerBatch({items:[items[0]],config:{},ensureOwner:async()=>owner,ensureLoggedIn:async()=>{}});
  const session=await batch.ensure(items[0].id),originalClose=session.context.close;
  session.context.close=async()=>{await closing.promise;await originalClose();};
  const finishing=batch.finish(items[0].id);
  const successor={...items[0],id:'successor'};
  assert.doesNotThrow(()=>batch.add([successor]));
  const next=await batch.ensure(successor.id);assert.notEqual(next.context,session.context);
  closing.resolve();await finishing;assert.equal(next.page.isClosed(),false);await batch.finish(successor.id);
});

test('real login function never fills credentials or writes shared session for a worker at the login wall',async()=>{
  const code=section('async function ensureOisAgentLoggedIn(','/* =========================================================');
  for(const authenticated of [false,true]){
    let fills=0,writes=0;
    const page={url:()=>authenticated?'http://ois.test/jsp/login/main':'http://ois.test/jsp/login/index',
      async goto(){},async waitForTimeout(){},locator(){fills++;throw new Error('worker filled credentials');},
      context:()=>({storageState:()=>{writes++;}})};
    const env={OIS_LOGIN_URL:'http://ois.test/jsp/login/index',OIS_QUERY_TIMEOUT:30000,console:{log(){}}};
    vm.createContext(env);vm.runInContext(code,env);
    if(authenticated)await env.ensureOisAgentLoggedIn(page,{morningParallelReuseOnly:true});
    else await assert.rejects(env.ensureOisAgentLoggedIn(page,{morningParallelReuseOnly:true}),e=>e.code==='OIS_MORNING_WORKER_SESSION_EXPIRED');
    assert.equal(fills,0);assert.equal(writes,0);
  }
});

async function loopFixture(failIndex=-1,{late=false,warmAuthFail=false}={}){
  const f=fakeBrowser(),signals=new Map(),gates=items.map(()=>deferred()),allStarted=deferred();
  const starts=[],completed=[],failed=[],exits=[],screenshots=[];let launches=0,polls=0,excelStarted=false,fills=0,workerAuths=0;
  const expectedStarts=warmAuthFail?3:4,total=late?4:warmAuthFail?6:5;
  const warm={id:'warm-owner',requestType:'steam_status',targetDate:items[0].targetDate};
  const excel={id:'excel',requestType:'cofiring_period',targetDate:items[0].targetDate};
  const ctx={morningOisParallelV1:parallel,OIS_AGENT_POLL_INTERVAL:1000,OIS_AGENT_ERROR_RETRY_INTERVAL:60000,
    OIS_QUERY_TIMEOUT:30000,OIS_SESSION_FILE_PATH:'test-session-state',BLOWER_RUNTIME_PROBE_REQUEST_TYPE:'blower_runtime_probe',
    OIS_LOGIN_URL:'http://ois.test/jsp/login/index',console:{log(){},warn(){},error(){}},
    process:{once:(s,fn)=>signals.set(s,fn),exit:c=>exits.push(c)},
    fs:{existsSync:()=>false},chromium:{launch:async()=>{launches++;return f.browser;}},
    getOisAgentConfig:()=>({agentMode:'all',agentId:'fixture'}),assertOisLoginCredentials(){},
    normalizeOisAgentText:x=>String(x??'').trim(),getOisAgentRequestType:x=>x.requestType,getOisAgentRequestLabel:x=>x,
    isExcelOnlyRequestType:x=>x==='cofiring_period',isExcelComRequestType:x=>x==='cofiring_period',
    getNextOisAgentLaneRequests:async()=>{polls++;if(warmAuthFail&&polls===1)return [warm];
      const claimed=late?[items[0]]:[...items,excel];claimed.morningParallelSupported=true;return claimed;},
    getMorningOisFillRequests:async()=>{fills++;return late&&fills===1?items.slice(1):[];},
    ensureOisAgentLoggedIn:async(page,c)=>{if(c.morningParallelReuseOnly){workerAuths++;if(warmAuthFail&&workerAuths===1){const e=new Error('worker auth expired');e.code='OIS_MORNING_WORKER_SESSION_EXPIRED';throw e;}}else await page.goto(MAIN_URL);},
    waitOisAgent:async ms=>{if(ms===1000&&completed.length+failed.length===total)await signals.get('SIGINT')();},
    collectOisAgentRequestResult:async(page,c,item)=>{
      if(item.id==='excel'){excelStarted=true;return {id:item.id};}
      if(item.id==='warm-owner')return {id:item.id};
      assert.equal(c.morningParallelReuseOnly,true);starts.push({page,item});if(starts.length===expectedStarts)allStarted.resolve();
      await gates[items.findIndex(x=>x.id===item.id)].promise;return {id:item.id,targetDate:item.targetDate};},
    completeOisAgentRequest:async(_c,id,result)=>{assert.equal(result.id,id);completed.push(id);},
    failOisAgentRequest:async(_c,id,error)=>{failed.push({id,error});if(starts.length<expectedStarts&&error.code!=='OIS_MORNING_WORKER_SESSION_EXPIRED')allStarted.reject(error);},
    printOisAgentRequestResult(){},saveOisAgentErrorScreenshot:async page=>{screenshots.push(page);return '';}};
  const code=section('async function loginOis()','\nconst oisAgentStartPromise');
  const run=new vm.Script(code+'\nloginOis();').runInNewContext(ctx);
  try {
  await allStarted.promise;
  assert.equal(starts.length,expectedStarts);assert.equal(new Set(starts.map(x=>x.page)).size,expectedStarts);
  assert.equal(new Set(starts.map(x=>x.page.context())).size,expectedStarts);assert.equal(launches,1);if(!warmAuthFail)assert.equal(excelStarted,false);
  if(late)assert.ok(fills>=1,'late sources were claimed before Water completed');
  // Silo completes while Water remains pending; completion is delivered immediately.
  gates[3].resolve();await flush();if(warmAuthFail)assert.deepEqual([...completed].sort(),['excel','request-3','warm-owner']);else assert.deepEqual(completed,['request-3']);
  if(failIndex>=0)gates[failIndex].reject(new Error('source failed'));
  for(let i=0;i<3;i++)if(i!==failIndex&&!(warmAuthFail&&i===0))gates[i].resolve();
  await run;
  assert.equal(exits[0],0);assert.equal(polls,warmAuthFail?2:1);assert.equal(excelStarted,!late);
  assert.equal(completed.length,total-((failIndex>=0||warmAuthFail)?1:0));assert.equal(failed.length,(failIndex>=0||warmAuthFail)?1:0);
  if(warmAuthFail){assert.equal(screenshots.length,0,'worker auth failure must not capture owner page');assert.equal(failed[0].id,items[0].id);}
  assert.equal(f.contexts.length,5);assert.equal(f.events.filter(x=>x==='browser-close').length,1);
  assert.equal(f.events.filter(x=>Array.isArray(x)&&x[0]==='context-close').length,5);
  for(const event of f.events.filter(x=>Array.isArray(x)&&x[0]==='storage'&&x[2]?.path))assert.equal(event[1],f.contexts[0]);
  } finally {gates.forEach(g=>g.resolve());await run;}
}

test('real Agent starts four isolated collectors and delivers the first completion without waiting for Water',{timeout:5000},async()=>loopFixture());
test('one real Agent collector failure preserves sibling results and the Water-before-Excel gate',{timeout:5000},async()=>loopFixture(1));

test('real Agent fills three late registrations while the first Water collector is still blocked',{timeout:6000},async()=>loopFixture(-1,{late:true}));
test('warm owner survives worker auth failure until siblings finish and is then renewed',{timeout:6000},async()=>loopFixture(-1,{warmAuthFail:true}));

// Snapshot only the deployed Water collector from reviewed Agent SHA4759d02a.
// The VM runs its original entry preparation, retry and recalculation control flow.
const installedWaterEntryFunctionV1 = "async function collectOisWaterTreatmentValues(\n  page,\n  config,\n  targetDate\n) {\n  if (\n    !isValidOisAgentDate(\n      targetDate\n    )\n  ) {\n    throw new Error(\n      \"OIS 수처리 조회 날짜가 올바르지 않습니다.\"\n    );\n  }\n\n\n  const getErrorMessage =\n    error => {\n      return error instanceof\n        Error\n        ? error.message\n        : String(\n            error ||\n            \"알 수 없는 오류\"\n          );\n    };\n\n\n  let waterEntryPrepared = false;\n\n  const collectOnce =\n    async () => {\n      await ensureOisAgentLoggedIn(\n        page,\n        config\n      );\n\n      // WATER_ENTRY_PREP_V1: prepare once per request; retain the existing retry.\n      if (!waterEntryPrepared) {\n        waterEntryPrepared = true;\n        const entryStartedAt = Date.now();\n        const existingEnvironmentFrame = await findOisFrameContainingText(\n          page,\n          \"1. 원수 (RAW WATER)\",\n          1500\n        );\n        if (existingEnvironmentFrame) {\n          console.log(`[WATER ENTRY PREP V1] REUSE elapsedMs=${Date.now() - entryStartedAt}`);\n        } else {\n          console.log(`[WATER ENTRY PREP V1] RESET elapsedMs=${Date.now() - entryStartedAt}`);\n          await page.goto(OIS_LOGIN_URL, {\n            waitUntil: \"domcontentloaded\",\n            timeout: OIS_QUERY_TIMEOUT\n          });\n          await page.waitForTimeout(800);\n          await ensureOisAgentLoggedIn(page, config);\n          console.log(`[WATER ENTRY PREP V1] READY elapsedMs=${Date.now() - entryStartedAt}`);\n        }\n      }\n\n\n      /*\n        [WATER-RECALC-REQUIRED]\n\n        수처리 일일 환경값은\n        OIS 재계산이 수행되기 전까지\n        Direct API에서도 0 또는 미반영 값이\n        반환될 수 있다.\n\n        따라서 수처리는 Direct API 성공 여부와\n        관계없이 반드시 다음 순서를 거친다.\n\n        1. 조회일 설정\n        2. 재계산 버튼 클릭\n        3. 재계산 결과 반영 확인\n        4. 9개 수처리 값 반환\n      */\n      console.log(\n        `${targetDate} OIS 수처리 조회: 재계산을 먼저 수행합니다.`\n      );\n\n\n      // WATER_RECALC_SAME_FRAME_TRACE_V1: keep the date/query/click/read owner identical.\n      const waterHelper = require(\"./water-recalc-same-frame-trace-v1.cjs\");\n      const waterTrace = waterHelper.createTrace(page, targetDate);\n      let environmentFrame = null;\n      try {\n        environmentFrame = await setOisEnvironmentDate(page, targetDate);\n        waterTrace.setFrame(environmentFrame);\n        const dateSnapshot = await waterTrace.recordFrame(environmentFrame, \"after-date-query\");\n        waterHelper.assertDate(dateSnapshot, targetDate);\n        await waterTrace.waitForQuiet(OIS_QUERY_TIMEOUT);\n        await clickOisEnvironmentRecalculateButton(page, environmentFrame, targetDate, waterTrace);\n        waterTrace.setPhase(\"values\");\n        const values = await waitForOisWaterTreatmentValues(page, targetDate, environmentFrame, waterTrace);\n        waterTrace.note(\"values-read-complete\", { sourceDate: values.sourceDate });\n        return values;\n      } catch (error) {\n        waterTrace.note(\"attempt-failed\", { message: String(error && error.message || error).slice(0, 1600) });\n        throw error;\n      } finally {\n        if (environmentFrame) {\n          await waterTrace.recordFrame(environmentFrame, \"final-frame\").catch(() => {});\n        }\n        await waterTrace.finish();\n      }\n    };\n\n  let result;\n\n\n  try {\n    result =\n      await collectOnce();\n\n  } catch (\n    firstError\n  ) {\n    // Initial login may fail before preparation; never prepare inside the retry.\n    waterEntryPrepared = true;\n    console.warn(\n      \"OIS 수처리 1차 조회 실패. 환경일지를 새로 열어 1회 재시도합니다:\",\n      getErrorMessage(\n        firstError\n      )\n    );\n\n\n    try {\n      await page.goto(\n        OIS_LOGIN_URL,\n        {\n          waitUntil:\n            \"domcontentloaded\",\n\n          timeout:\n            OIS_QUERY_TIMEOUT\n        }\n      );\n\n\n      await page.waitForTimeout(\n        800\n      );\n\n\n      result =\n        await collectOnce();\n\n\n      console.log(\n        \"OIS 수처리 환경일지 재진입 조회 성공:\",\n        targetDate\n      );\n\n    } catch (\n      retryError\n    ) {\n      throw new Error(\n        [\n          \"OIS 수처리 조회가 환경일지 재진입 후에도 실패했습니다.\",\n          \"1차:\",\n          getErrorMessage(\n            firstError\n          ),\n          \"재시도:\",\n          getErrorMessage(\n            retryError\n          )\n        ].join(\n          \" \"\n        )\n      );\n    }\n  }\n\n\n  const outputPath =\n    saveOisWaterTreatmentValues(\n      result\n    );\n\n\n  console.log(\n    \"OIS 수처리 결과 JSON 저장:\",\n    outputPath\n  );\n\n\n  return result;\n}";

function installedWaterEntryFixtureV1({mismatchDate=false,failFirstRead=false}={}) {
  const targetDate=items[0].targetDate,frame={fixture:'owned-environment-frame'};
  const events=[],messages=[],counts={entryChecks:0,dateQueries:0,assertions:0,recalculations:0,reads:0,stores:0,finishes:0};
  const value=Object.freeze({targetDate,sourceDate:targetDate,rawWaterInflow:12,demiProduction:13,pureWaterUsage:14});
  const assertActualWaterDate=require('../local-tools/ois-agent/water-recalc-same-frame-trace-v1.cjs').assertDate;
  let ownedPage;
  const waterTrace={
    setFrame(actual){assert.equal(actual,frame);},
    async recordFrame(actual,phase){assert.equal(actual,frame);assert.ok(['after-date-query','final-frame'].includes(phase));
      return {headerDates:[mismatchDate?'2026-11-13':targetDate],inputDates:[]};},
    async waitForQuiet(timeout){assert.equal(timeout,30000);},
    setPhase(phase){assert.equal(phase,'values');},note(){},async finish(){counts.finishes++;}
  };
  const waterHelper={
    createTrace(page,date){assert.equal(page,ownedPage);assert.equal(date,targetDate);return waterTrace;},
    assertDate(snapshot,date){counts.assertions++;events.push('assert-date');return assertActualWaterDate(snapshot,date);}
  };
  const environment={
    OIS_LOGIN_URL:'http://ois.gspoge.com/jsp/login/index',OIS_QUERY_TIMEOUT:30000,
    console:{log(...args){messages.push(args.join(' '));},warn(...args){messages.push(args.join(' '));}},
    require(name){assert.equal(name,'./water-recalc-same-frame-trace-v1.cjs');return waterHelper;},
    isValidOisAgentDate:date=>date===targetDate,
    ensureOisAgentLoggedIn:realLoginGuard(),
    async findOisFrameContainingText(page,text,timeout){assert.equal(page,ownedPage);assert.equal(text,'1. 원수 (RAW WATER)');assert.equal(timeout,1500);
      counts.entryChecks++;events.push('entry-check');return null;},
    async setOisEnvironmentDate(page,date){assert.equal(page,ownedPage);assert.equal(date,targetDate);counts.dateQueries++;events.push('date-query');return frame;},
    async clickOisEnvironmentRecalculateButton(page,actual,date,trace){assert.equal(page,ownedPage);assert.equal(actual,frame);assert.equal(date,targetDate);assert.equal(trace,waterTrace);
      counts.recalculations++;events.push('recalculate');},
    async waitForOisWaterTreatmentValues(page,date,actual,trace){assert.equal(page,ownedPage);assert.equal(date,targetDate);assert.equal(actual,frame);assert.equal(trace,waterTrace);
      counts.reads++;events.push('read');if(failFirstRead&&counts.reads===1)throw new Error('synthetic first value-read failure');return value;},
    saveOisWaterTreatmentValues(result){assert.equal(result,value);counts.stores++;events.push('store');return 'fixture-water-values.json';}
  };
  const collect=new vm.Script(installedWaterEntryFunctionV1+'\ncollectOisWaterTreatmentValues;',
    {filename:'reviewed-installed-water-entry-v1.js'}).runInNewContext(environment);
  return {targetDate,frame,value,events,messages,counts,async run(page){ownedPage=page;return collect(page,{morningParallelReuseOnly:true},targetDate);}};
}
async function installedWaterWorkerFixtureV1() {
  const f=fakeBrowser(),owner=await makeOwner(f),ownerGoto=owner.page.goto;
  const batch=parallel.createWorkerBatch({items:[items[0]],config:{},ensureOwner:async()=>owner,ensureLoggedIn:realLoginGuard()});
  const session=await batch.ensure(items[0].id);
  return {f,owner,ownerGoto,batch,session};
}
function assertInstalledWaterWorkerSafetyV1(f,owner,ownerGoto) {
  assert.equal(owner.page.goto,ownerGoto,'the authenticated owner method must remain unchanged');
  assert.equal(owner.page.isClosed(),false);assert.equal(f.browser.isConnected(),true);
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='credential-fill'),false);
  assert.equal(f.events.some(e=>Array.isArray(e)&&e[0]==='storage'&&e[2]?.path),false);
}
function installedWaterNavigationsV1(f,page,after) {
  return f.events.slice(after).filter(e=>Array.isArray(e)&&e[0]==='goto'&&e[1]===page);
}
function assertInstalledWaterMainNavigationsV1(calls,count) {
  assert.equal(calls.length,count);
  for(const call of calls){assert.equal(call[2],MAIN_URL);assert.equal(call[3].waitUntil,'domcontentloaded');assert.equal(call[3].timeout,30000);}
}

test('actual installed WATER_ENTRY_PREP reset reuses the authenticated worker and preserves date assertion, recalculation and value order',async()=>{
  const {f,owner,ownerGoto,batch,session}=await installedWaterWorkerFixtureV1(),fixture=installedWaterEntryFixtureV1(),after=f.events.length;
  try {
    assert.equal(await fixture.run(session.page),fixture.value);
    assert.deepEqual(fixture.events,['entry-check','date-query','assert-date','recalculate','read','store']);
    assert.deepEqual(fixture.counts,{entryChecks:1,dateQueries:1,assertions:1,recalculations:1,reads:1,stores:1,finishes:1});
    assert.equal(fixture.messages.filter(message=>message.includes('[WATER ENTRY PREP V1] RESET')).length,1);
    assert.equal(fixture.messages.filter(message=>message.includes('[WATER ENTRY PREP V1] READY')).length,1);
    assertInstalledWaterMainNavigationsV1(installedWaterNavigationsV1(f,session.page,after),1);
    assertInstalledWaterWorkerSafetyV1(f,owner,ownerGoto);
  } finally {await batch.finish(items[0].id);}
});

test('actual installed Water collector performs only its original single retry and keeps both entry resets on the authenticated main route',async()=>{
  const {f,owner,ownerGoto,batch,session}=await installedWaterWorkerFixtureV1(),fixture=installedWaterEntryFixtureV1({failFirstRead:true}),after=f.events.length;
  try {
    assert.equal(await fixture.run(session.page),fixture.value);
    assert.deepEqual(fixture.events,['entry-check','date-query','assert-date','recalculate','read','date-query','assert-date','recalculate','read','store']);
    assert.deepEqual(fixture.counts,{entryChecks:1,dateQueries:2,assertions:2,recalculations:2,reads:2,stores:1,finishes:2});
    assert.equal(fixture.messages.filter(message=>message.includes('1차 조회 실패')).length,1);
    assert.equal(fixture.messages.filter(message=>message.includes('재진입 조회 성공')).length,1);
    assertInstalledWaterMainNavigationsV1(installedWaterNavigationsV1(f,session.page,after),2);
    assertInstalledWaterWorkerSafetyV1(f,owner,ownerGoto);
  } finally {await batch.finish(items[0].id);}
});

test('actual installed Water date mismatch blocks recalculation, reading and storage through both original attempts',async()=>{
  const {f,owner,ownerGoto,batch,session}=await installedWaterWorkerFixtureV1(),fixture=installedWaterEntryFixtureV1({mismatchDate:true}),after=f.events.length;
  try {
    await assert.rejects(fixture.run(session.page),/수처리 재계산 기준일 확인 실패/);
    assert.deepEqual(fixture.events,['entry-check','date-query','assert-date','date-query','assert-date']);
    assert.deepEqual(fixture.counts,{entryChecks:1,dateQueries:2,assertions:2,recalculations:0,reads:0,stores:0,finishes:2});
    assertInstalledWaterMainNavigationsV1(installedWaterNavigationsV1(f,session.page,after),2);
    assertInstalledWaterWorkerSafetyV1(f,owner,ownerGoto);
  } finally {await batch.finish(items[0].id);}
});

test('worker login-entry adapter delegates all other URLs and preserves goto options, response identity and owner methods',async()=>{
  const calls=[];
  const f=fakeBrowser({configurePage:(page,index)=>{if(index===1)page.goto=async function(url,options){
    assert.equal(this,page,'the native Page receiver must be retained');page.currentUrl=url;
    const response={url,fixture:'native-response'};calls.push({url,options,response});return response;
  };}}),owner=await makeOwner(f),ownerGoto=owner.page.goto,
    pagePrototype=Object.getPrototypeOf(owner.page),prototypeGoto=pagePrototype.goto;
  const batch=parallel.createWorkerBatch({items:[items[0]],config:{},ensureOwner:async()=>owner,ensureLoggedIn:realLoginGuard()});
  const session=await batch.ensure(items[0].id);
  try {
    const options={timeout:12345,waitUntil:'commit',referer:'http://ois.gspoge.com/jsp/login/main'};
    const result=await session.page.goto('http://ois.gspoge.com/jsp/login/index',options),rewritten=calls.at(-1);
    assert.equal(rewritten.url,MAIN_URL);assert.equal(rewritten.options,options);assert.equal(result,rewritten.response);
    for(const url of ['http://ois.gspoge.com/jsp/operations/view?day=20261114#values',
      'http://ois.gspoge.com/jsp/login/index?keep=1','http://ois.gspoge.com/jsp/login/index#keep',
      'http://other.example.invalid/jsp/login/index','http://user:fixture@ois.gspoge.com/jsp/login/index']) {
      const expectedOptions={timeout:23456,waitUntil:'domcontentloaded'};
      const response=await session.page.goto(url,expectedOptions),delegated=calls.at(-1);
      assert.equal(delegated.url,url);assert.equal(delegated.options,expectedOptions);assert.equal(response,delegated.response);
    }
    assert.equal(Object.getPrototypeOf(session.page),pagePrototype);
    assert.equal(pagePrototype.goto,prototypeGoto);
    assertInstalledWaterWorkerSafetyV1(f,owner,ownerGoto);
  } finally {await batch.finish(items[0].id);}
});
