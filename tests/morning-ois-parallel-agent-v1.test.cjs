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

function fakeBrowser(){
  const contexts=[],events=[];let connected=true;
  const browser={on(){},isConnected:()=>connected,async close(){events.push('browser-close');connected=false;},async newContext(options={}){
    const pages=[];let closed=false;
    const context={options,pages:()=>pages,async storageState(opts){events.push(['storage',context,opts]);return {cookies:[],origins:[]};},
      async close(){if(!closed){closed=true;events.push(['context-close',context]);for(const p of pages)p.closed=true;}},
      async newPage(){const page={closed:false,url:()=> 'http://ois.test/jsp/login/main',isClosed:()=>page.closed,
        context:()=>context,async close(){page.closed=true;events.push(['page-close',page]);}};pages.push(page);return page;}};
    contexts.push(context);events.push(['context-open',context]);return context;
  }};
  return {browser,contexts,events};
}

test('workers bootstrap once, own distinct contexts and recover without closing siblings or writing shared auth',async()=>{
  const f=fakeBrowser();const ownerContext=await f.browser.newContext();const ownerPage=await ownerContext.newPage();
  const owner={browser:f.browser,context:ownerContext,page:ownerPage};let bootstraps=0,auth=0;
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
  const f=fakeBrowser(),context=await f.browser.newContext();
  const batch=parallel.createWorkerBatch({items,config:{},ensureOwner:async()=>({browser:f.browser,context}),
    ensureLoggedIn:async()=>{throw new Error('auth expired');}});
  await assert.rejects(batch.ensure(items[0].id),/auth expired/);
  await assert.rejects(batch.ensure('unknown'),/속하지 않는/);
  assert.equal(f.events.filter(x=>Array.isArray(x)&&x[0]==='context-close').length,1);
  assert.equal(f.browser.isConnected(),true);
});

test('server-completed work releases its type before slow context cleanup so a newly claimed successor is retained',async()=>{
  const f=fakeBrowser(),ownerContext=await f.browser.newContext(),closing=deferred();
  const batch=parallel.createWorkerBatch({items:[items[0]],config:{},ensureOwner:async()=>({browser:f.browser,context:ownerContext}),ensureLoggedIn:async()=>{}});
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
    ensureOisAgentLoggedIn:async(_page,c)=>{if(c.morningParallelReuseOnly){workerAuths++;if(warmAuthFail&&workerAuths===1){const e=new Error('worker auth expired');e.code='OIS_MORNING_WORKER_SESSION_EXPIRED';throw e;}}},
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
