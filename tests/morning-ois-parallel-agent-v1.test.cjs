"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const parallel=require('../local-tools/ois-agent/morning-ois-parallel-v1.cjs');
const source=fs.readFileSync(path.join(__dirname,'../local-tools/ois-agent/ois-login.js'),'utf8').replace(/\r\n?/g,'\n');
const DAY='2026-11-14',MAIN='http://ois.gspoge.com/jsp/login/main',INDEX='http://ois.gspoge.com/jsp/login/index';
const items=parallel.TYPES.map((requestType,i)=>({id:`request-${i}`,requestType,targetDate:DAY}));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const logger={log(){},warn(){},error(){}};
function closing(text,start,left,right){let depth=0,quote=null;for(let i=start;i<text.length;i++){
  const c=text[i];if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
  if(text.startsWith('//',i)){i=text.indexOf('\n',i);if(i<0)break;continue;}
  if(text.startsWith('/*',i)){i=text.indexOf('*/',i+2)+1;assert.ok(i>0);continue;}
  if(['"',"'",'`'].includes(c)){quote=c;continue;}
  if(c===left)depth++;else if(c===right&&--depth===0)return i;
}throw new Error('fixture source boundary missing');}
function fn(name,text=source){let a=text.indexOf('async function '+name+'(');if(a<0)a=text.indexOf('function '+name+'(');
  assert.ok(a>=0,name);const brace=text.indexOf(') {',a)+2;assert.ok(brace>a,name);return text.slice(a,closing(text,brace,'{','}')+1);}
function declaration(name){const a=source.indexOf('const '+name+' =');assert.ok(a>=0,name);
  const bracket=source.indexOf('[',a),brace=source.indexOf('{',a),start=bracket>=0&&bracket<brace?bracket:brace;
  if(source.slice(a,start).includes('"'))return source.slice(a,source.indexOf(';',a)+1);
  return source.slice(a,closing(source,start,source[start],source[start]==='['?']':'}')+2);}
function load(context,names,{constants=false}={}){
  vm.createContext(context);
  const defs=constants?['OIS_UNIT_DEFINITIONS','OIS_TURBINE_GEAR_PINION_DEFINITION','OIS_SILO_LEVEL_DEFINITIONS',
    'OIS_PHASE25_LOG_SHEET_COMMON_SELECT'].map(declaration).join('\n')+'\nconst OIS_PHASE25_LOG_SHEET_COMMAND="oi.LogSheetService.listLogSheetSearch";\n':'';
  vm.runInContext(defs+names.map(name=>fn(name)).join('\n'),context);return context;
}
const numeric=['normalizeOisAgentText','isValidOisAgentDate','addOisAgentDateDays','parseOisAgentNumber'];
const direct=['requestOisInternalAjaxDataWithTimeout','requestOisInternalAjaxData','getOisPhase25Rows','findOisPhase25RowByTag',
  'collectOisPhase25LimestoneStocksDirect','collectOisPhase25GearPinionDirect','collectOisSiloLevelValuesDirect'];

function ownerFixture(){
  const events=[],context={pages:()=>[page],async storageState(options){events.push(['storage',options]);return{cookies:[],origins:[]};},
    async close(){events.push(['context-close']);page.closed=true;},async newPage(){throw new Error('new worker page is forbidden');}};
  const browser={isConnected:()=>!browser.closed,on(){},closed:false,async close(){events.push(['browser-close']);browser.closed=true;},
    async newContext(){events.push(['context-created']);return context;}};
  let activeFetches=0;
  const page={closed:false,current:MAIN,url:()=>page.current,isClosed:()=>page.closed,context:()=>context,frames:()=>[],on(){},off(){},
    async goto(url,options){events.push(['goto',url,options]);assert.equal(activeFetches,0,'normal entry must not destroy active direct fetches');
      // The field failure: GET main is an error route, even for this owner.
      page.current=url===MAIN?'http://ois.gspoge.com/jsp/common/error/page':url;},
    async waitForTimeout(){},locator(selector){return{async waitFor(){},async fill(){events.push(['fill',selector]);},
      async press(key){assert.equal(key,'Enter');events.push(['normal-login-submit']);page.current=MAIN;}};},
    async waitForURL(pattern){assert.match(page.current,pattern);},async evaluate(callback,argument){return callback(argument);},
    async close(){page.closed=true;events.push(['page-close']);}};
  return{events,page,context,browser,owner:{browser,context,page,primaryPage:page},
    fetchStarted(){activeFetches++;},fetchFinished(){activeFetches--;},get activeFetches(){return activeFetches;}};
}
function rowsFor(command,select){
  if(command==='oi.LogSheetService.listTagLog')return{result:[{tag_no:select.tag_no,base_date:'20261114',hd_24:select.tag_no==='003ETH01CW201XQ01'?31:32}]};
  assert.equal(command,'oi.LogSheetService.listLogSheetSearch');
  assert.equal(select.schbase_date,'20261114');
  if(select.sheet_code==='111')return{result:[{tag_no:'MAD11FG905-ZE01_V2',decimal_pnt:0.77},{tag_no:'MAD41FY905-ZE01_V2',decimal_pnt:1.92}]};
  assert.ok(['112','113'].includes(select.sheet_code));
  return{result:[{tag_no:select.sheet_code==='112'?'103HRJ01CW201XQ01':'203HRJ01CW201XQ01',decimal_pnt:11,hd_24:22}]};
}
function readerType(command,select){return command==='oi.LogSheetService.listTagLog'?'silo_level':select.sheet_code==='111'?'turbine_gear_pinion':'limestone_stock';}
function baseContext(extra={}){return{console:logger,URLSearchParams,AbortController,setTimeout,clearTimeout,
  OIS_LOGIN_URL:INDEX,OIS_QUERY_TIMEOUT:30000,OIS_SESSION_FILE_PATH:'fixture-only-owner-session',
  morningOisParallelV1:parallel,getOisAgentRequestType:item=>item.requestType,...extra};}

function integrationFixture({late=false,failReadOnce=false,waterDateMismatch=false}={}){
  const f=ownerFixture(),events=f.events,frame={id:'exact-water-frame'},water=deferred(),readerGates=new Map(items.slice(1).map(item=>[item.requestType,deferred()])),
    started=deferred(),requests=[],published=[],ui=[];
  let waterActive=false,waterReads=0,readyCalls=0,waterAttempts=0;
  const trace={setFrame(actual){assert.equal(actual,frame);},async recordFrame(actual){assert.equal(actual,frame);return{headerDates:[waterDateMismatch?'2026-11-13':DAY],inputDates:[]};},
    async waitForQuiet(){},setPhase(){},note(){},async finish(){events.push(['water-trace-finish']);}};
  const context=baseContext({
    fetch:async(url,options)=>{
      assert.equal(url,'/ajax/data');assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
      assert.equal(options.headers['X-Requested-With'],'XMLHttpRequest');
      const body=new URLSearchParams(options.body),command=body.get('cmd'),select=JSON.parse(body.get('tossdata')).select[0],type=readerType(command,select);
      requests.push({command,select,type,signal:options.signal});f.fetchStarted();
      events.push(['direct-start',type]);
      if(waterActive&&new Set(requests.map(request=>request.type)).size===3)started.resolve();
      try{await readerGates.get(type).promise;return{ok:true,status:200,async text(){return JSON.stringify(rowsFor(command,select));}};}
      finally{f.fetchFinished();events.push(['direct-end',type]);}
    },
    require(name){assert.equal(name,'./water-recalc-same-frame-trace-v1.cjs');return{createTrace(page,date){assert.equal(page,f.page);assert.equal(date,DAY);return trace;},
      assertDate(snapshot,date){assert.deepEqual(snapshot.headerDates,[date],'date mismatch must be rejected before recalculation');}};},
    async findOisFrameContainingText(page,text,timeout){assert.equal(page,f.page);assert.equal(timeout,1500);return null;},
    async setOisEnvironmentDate(page,date){assert.equal(page,f.page);assert.equal(date,DAY);waterAttempts++;events.push(['water-date']);return frame;},
    async clickOisEnvironmentRecalculateButton(page,actual,date){assert.equal(page,f.page);assert.equal(actual,frame);assert.equal(date,DAY);
      waterActive=true;events.push(['water-recalculate']);if(new Set(requests.map(request=>request.type)).size===3)started.resolve();await water.promise;},
    async waitForOisWaterTreatmentValues(page,date,actual){assert.equal(page,f.page);assert.equal(actual,frame);waterReads++;
      if(page.isClosed())throw new Error('Target page, context or browser has been closed');
      if(failReadOnce&&waterReads===1)throw new Error('first water values are unavailable');
      return{targetDate:date,sourceDate:date,rawWaterInflow:1};},
    saveOisWaterTreatmentValues(){events.push(['water-store']);return'fixture-water.json';},
    async collectOisLimestoneStocks(page,config,date){assert.equal(page,f.page);assert.equal(config.morningOwnerApiSkipDirect,true);ui.push('limestone_stock');return{targetDate:date,ui:true};},
    async collectOisTurbineGearPinionValues(page,config,date){assert.equal(page,f.page);assert.equal(config.morningOwnerApiSkipDirect,true);ui.push('turbine_gear_pinion');return{targetDate:date,ui:true};},
    async collectOisSiloLevelValues(page,config,date){assert.equal(page,f.page);assert.equal(config.morningOwnerApiSkipDirect,true);ui.push('silo_level');return{targetDate:date,ui:true};}
  });
  load(context,[...numeric,...direct,'ensureOisAgentLoggedIn','collectOisWaterTreatmentValues','collectOisAgentRequestResult'],{constants:true});
  const batch=parallel.createWorkerBatch({items:late?[items[0]]:items,config:{userId:'fixture',password:'fixture'},ensureOwner:async()=>f.owner,
    ensureLoggedIn:context.ensureOisAgentLoggedIn});
  function run(item){return batch.ensure(item.id).then(session=>context.collectOisAgentRequestResult(session.page,batch.configFor(item.id,{userId:'fixture',password:'fixture'}),item))
    .then(result=>{published.push({id:item.id,result});return result;}).finally(()=>batch.finish(item.id));}
  return{f,events,context,batch,water,readerGates,started,requests,published,ui,run,
    get waterReads(){return waterReads;},get waterAttempts(){return waterAttempts;},
    all(){return parallel.runWithFills({items:late?[items[0]]:items,intervalMs:1,processItem:run,
      claimMore:async()=>late&&requests.length===0?items.slice(1):[],onAdded:more=>batch.add(more),onFillError:error=>{throw error;}});}};
}

test('claim parser preserves legacy replies and requires four unique same-date eligible sources',()=>{
  const reply=batch=>({items:{ois:batch[0]||null,morningOis:batch},morningOisParallelVersion:1,morningOisConcurrency:4});
  assert.deepEqual(parallel.claimedOisItems({items:{ois:items[0]}}),[items[0]]);assert.deepEqual(parallel.claimedOisItems(reply(items)),items);
  for(const batch of [[items[0],items[0]],[items[0],{...items[1],targetDate:'2026-11-13'}],[...items,items[0]],
    [items[0],{...items[1],requestType:'bed_ash_level'}]])assert.throws(()=>parallel.claimedOisItems(reply(batch)));
});

test('real queue client opts in and excludes Water from supplemental claims while Excel remains active',async()=>{
  const start=source.indexOf('async function getNextOisAgentLaneRequests('),end=source.indexOf('/* =========================================================',start),calls=[];
  let response={items:{ois:items[0],morningOis:items},morningOisParallelVersion:1,morningOisConcurrency:4};
  const context={morningOisParallelV1:parallel,isCofiringExcelBlocked:()=>false,isBedAshExcelBlocked:()=>false,normalizeOisAgentText:value=>String(value??'').trim(),
    getOisAgentRequestType:item=>item.requestType,
    DAILY_OPERATION_REQUEST_TYPE:'daily_operation_dataparc',BLOWER_RUNTIME_PROBE_REQUEST_TYPE:'blower_runtime_probe',console:logger,
    getOisAgentApiUrl:(_c,q)=>q,requestOisAgentApi:async(_c,q)=>{calls.push(q);return response;}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  assert.equal((await context.getNextOisAgentLaneRequests({agentMode:'all'})).length,4);assert.equal(calls[0].morningOisConcurrency,4);
  response={items:{ois:items[1],morningOis:[items[1]]},morningOisParallelVersion:1,morningOisConcurrency:4};
  await context.getMorningOisFillRequests({},items[0],true);assert.equal(calls.at(-1).requestTypes.includes('water_environment'),false);
});

for(const late of [false,true])test(`actual Water and three exact direct collectors overlap on the original authenticated page${late?' after late registration':''}`,{timeout:5000},async()=>{
  const x=integrationFixture({late}),pending=x.all();
  try{
    await x.started.promise;
    assert.equal(x.f.activeFetches,3);assert.equal(x.events.some(event=>event[0]==='water-recalculate'),true);
    assert.equal(x.published.length,0);assert.equal(x.events.filter(event=>event[0]==='goto'&&event[1]===MAIN).length,0,'no failing main GET was introduced');
    x.readerGates.get('silo_level').resolve();await flush();
    assert.deepEqual(x.published.map(item=>item.id),[items[3].id],'Silo completion publishes while Water still waits');
    assert.equal(x.published[0].result.flyAshSiloLevel,31);assert.equal(x.published[0].result.bioStorageSiloLevel,32);
    x.readerGates.get('limestone_stock').resolve();x.readerGates.get('turbine_gear_pinion').resolve();x.water.resolve();
    const results=await pending;assert.equal(results.length,4);assert.equal(x.published.length,4);assert.deepEqual(x.ui,[]);
    assert.equal(x.requests.length,5);assert.equal(x.requests.every(request=>request.signal instanceof AbortSignal),true);
    assert.equal(x.f.page.isClosed(),false);assert.equal(x.f.browser.isConnected(),true);
    assert.equal(x.events.some(event=>event[0]==='page-close'||event[0]==='context-close'),false);
  }finally{x.water.resolve();for(const gate of x.readerGates.values())gate.resolve();await pending;}
});

test('actual Water retry cannot navigate until outstanding direct reads have settled',{timeout:5000},async()=>{
  const x=integrationFixture({failReadOnce:true}),pending=x.all();
  try{
    await x.started.promise;const initialEntries=x.events.filter(event=>event[0]==='goto'&&event[1]===INDEX).length;
    assert.equal(initialEntries,2,'entry preparation and the preserved normal login each open index');
    x.water.resolve();await flush();
    assert.equal(x.waterReads,1);assert.equal(x.events.filter(event=>event[0]==='goto'&&event[1]===INDEX).length,initialEntries,'retry waits before index navigation');
    for(const gate of x.readerGates.values())gate.resolve();await pending;
    assert.equal(x.waterReads,2);assert.equal(x.waterAttempts,2);
    assert.equal(x.events.filter(event=>event[0]==='goto'&&event[1]===INDEX).length,initialEntries+2,'the original single retry and normal login remain');
    assert.equal(x.events.filter(event=>event[0]==='goto'&&event[1]===MAIN).length,0);
    assert.equal(x.f.activeFetches,0);
  }finally{x.water.resolve();for(const gate of x.readerGates.values())gate.resolve();await pending;}
});

test('an early Water date failure releases its lease and never recalculates or saves invalid Water values',{timeout:5000},async()=>{
  const x=integrationFixture({waterDateMismatch:true});for(const gate of x.readerGates.values())gate.resolve();
  const results=await x.all();assert.equal(results.filter(result=>result.status==='rejected').length,1);
  assert.equal(x.events.some(event=>event[0]==='water-recalculate'||event[0]==='water-store'),false);
  assert.deepEqual(x.published.map(item=>item.id).sort(),items.slice(1).map(item=>item.id).sort());
});

test('direct failure enters the real router UI fallback only after Water and other direct reads finish',{timeout:5000},async()=>{
  const x=integrationFixture(),pending=x.all();
  try{
    await x.started.promise;x.readerGates.get('limestone_stock').reject(new Error('direct unavailable'));await flush();
    assert.deepEqual(x.ui,[]);assert.equal(x.published.length,0);
    x.readerGates.get('silo_level').resolve();x.readerGates.get('turbine_gear_pinion').resolve();await flush();
    assert.deepEqual(x.ui,[]);assert.equal(x.published.length,2);
    x.water.resolve();const results=await pending;
    assert.equal(results.filter(result=>result.status==='rejected').length,0);assert.deepEqual(x.ui,['limestone_stock']);
    assert.equal(x.published.find(item=>item.id===items[1].id).result.ui,true);
  }finally{x.water.resolve();for(const gate of x.readerGates.values())gate.resolve();await pending;}
});

for(const [name,directName,type] of [
  ['collectOisLimestoneStocks','collectOisPhase25LimestoneStocksDirect','limestone_stock'],
  ['collectOisTurbineGearPinionValues','collectOisPhase25GearPinionDirect','turbine_gear_pinion'],
  ['collectOisSiloLevelValues','collectOisSiloLevelValuesDirect','silo_level']
])test(`full ${type} collector preserves its normal direct path and can explicitly skip it for serialized UI fallback`,async()=>{
  let directCalls=0,uiCalls=0;
  const frame={},page={async waitForTimeout(){}};
  const context=baseContext({async ensureOisAgentLoggedIn(){},async [directName](){directCalls++;return{direct:true};},
    async collectOisSiloLevelValuesUi(){uiCalls++;return{ui:true};},
    async queryOisLimestonePreviousStock(){uiCalls++;return{startStock:11,endStock:22};},
    async openOisLogSheetLookup(){uiCalls++;return frame;},async selectOisOptionByLabel(){},async findOisLogSheetFrame(){return frame;},
    async setOisLogSheetDate(actual,date){assert.equal(actual,frame);assert.equal(date,DAY);},
    async captureOisTurbineGearPinionFromApi(){return{gearWheel:{value:.77,tag:'gear'},pinion:{value:1.92,tag:'pinion'}};}});
  load(context,[...numeric,name],{constants:true});
  assert.equal((await context[name](page,{},DAY)).direct,true);assert.equal(directCalls,1);assert.equal(uiCalls,0);
  const result=await context[name](page,{morningOwnerApiSkipDirect:true},DAY);
  assert.equal(directCalls,1);assert.ok(uiCalls>0);assert.notEqual(result.direct,true);
});

test('bounded request uses a real AbortController and leaves the default request behavior unchanged',async()=>{
  let evaluations=0,aborts=0,timers=0;const sent=[];
  const context=baseContext({setTimeout(callback,timeout){timers++;assert.equal(timeout,1000);return setTimeout(callback,5);},
    fetch:async(url,options)=>{sent.push({url,options});if(!options.signal)return{ok:true,status:200,async text(){return'{"result":[]}';}};
      return await new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborts++;reject(new Error('aborted'));},{once:true}));}});
  load(context,['requestOisInternalAjaxDataWithTimeout','requestOisInternalAjaxData']);
  const page={async evaluate(callback,argument){evaluations++;return callback(argument);}};
  const normal=await context.requestOisInternalAjaxData(page,'fixture.service',{date:'20261114'});assert.ok(Array.isArray(normal.result));
  assert.equal(timers,0);assert.equal(sent[0].options.signal,undefined);
  await assert.rejects(context.requestOisInternalAjaxData(page,'fixture.service',{date:'20261114'},{timeoutMilliseconds:1000}),error=>error.code==='OIS_INTERNAL_AJAX_TIMEOUT'&&error.message.includes('오전회의'));
  assert.equal(aborts,1);assert.equal(timers,1);assert.equal(evaluations,2);
  for(const invalid of [0,999,30001,'30000',1.5])await assert.rejects(context.requestOisInternalAjaxData(page,'fixture.service',{}, {timeoutMilliseconds:invalid}));
  assert.equal(evaluations,2);
});

async function realLoop({late=false,disconnect=false}={}){
  const x=integrationFixture(),signals=new Map(),completed=[],failed=[],excelGate=deferred(),excelReady=deferred(),allFailed=deferred();let polls=0,excelStarted=false,fills=0;
  const excel={id:'excel',requestType:'cofiring_period',targetDate:DAY},total=late?4:5;
  x.f.page.current='about:blank';
  Object.assign(x.context,{OIS_AGENT_POLL_INTERVAL:1000,OIS_AGENT_ERROR_RETRY_INTERVAL:60000,BLOWER_RUNTIME_PROBE_REQUEST_TYPE:'blower_runtime_probe',
    process:{once:(name,callback)=>signals.set(name,callback),exit(){}},fs:{existsSync:()=>false},chromium:{launch:async()=>x.f.browser},
    getOisAgentConfig:()=>({agentMode:'all',agentId:'fixture',userId:'fixture',password:'fixture'}),assertOisLoginCredentials(){},
    getOisAgentRequestLabel:value=>value,isExcelOnlyRequestType:value=>value==='cofiring_period',isExcelComRequestType:value=>value==='cofiring_period',
    getNextOisAgentLaneRequests:async()=>{polls++;const claimed=late?[items[0]]:[...items,excel];claimed.morningParallelSupported=true;return claimed;},
    getMorningOisFillRequests:async()=>{fills++;return late&&fills===1?items.slice(1):[];},
    waitOisAgent:async milliseconds=>{if(milliseconds===1000&&completed.length+failed.length===total)await signals.get('SIGINT')();else await new Promise(resolve=>setTimeout(resolve,0));},
    collectCofiringPeriodValues:async()=>{excelStarted=true;excelReady.resolve();if(disconnect)await excelGate.promise;return{excel:true};},
    completeOisAgentRequest:async(_config,id,result)=>{completed.push({id,result});},failOisAgentRequest:async(_config,id,error)=>{failed.push({id,error});if(failed.length===4)allFailed.resolve();},
    printOisAgentRequestResult(){},async saveOisAgentErrorScreenshot(){return'';}});
  const pending=new vm.Script(fn('loginOis')+'\nloginOis();').runInContext(x.context);
  try{
    await x.started.promise;assert.equal(excelStarted,false);assert.equal(x.f.activeFetches,3);
    if(disconnect){
      x.f.page.closed=true;x.f.browser.closed=true;
      for(const gate of x.readerGates.values())gate.reject(new Error('Target page, context or browser has been closed'));
      x.water.resolve();await allFailed.promise;await excelReady.promise;
      assert.equal(x.events.filter(event=>event[0]==='context-close'||event[0]==='browser-close').length,0,
        'shared owner cleanup waits even for the independent Excel lane to settle');
      assert.equal(x.events.filter(event=>event[0]==='context-created').length,1,'no collector launched a replacement under siblings');
      assert.deepEqual(x.ui,[],'a disconnected owner cannot start UI fallback');
      excelGate.resolve();await pending;
      assert.equal(failed.length,4);assert.deepEqual(completed.map(item=>item.id),['excel']);
      assert.equal(x.events.filter(event=>event[0]==='context-created').length,1);
      assert.equal(x.events.filter(event=>event[0]==='context-close').length,1);
      return;
    }
    x.readerGates.get('silo_level').resolve();await flush();assert.deepEqual(completed.map(item=>item.id),[items[3].id]);
    x.readerGates.get('limestone_stock').resolve();x.readerGates.get('turbine_gear_pinion').resolve();x.water.resolve();await pending;
    assert.equal(failed.length,0,failed.map(item=>item.error.message).join(';'));assert.equal(completed.length,total);
    assert.equal(excelStarted,!late);assert.equal(polls,1);if(late)assert.ok(fills>=1);
    assert.equal(x.events.filter(event=>event[0]==='context-created').length,1);
    assert.equal(x.events.filter(event=>event[0]==='context-close').length,1);
    assert.equal(x.events.filter(event=>event[0]==='goto'&&event[1]===MAIN).length,0);
  }finally{excelGate.resolve();x.water.resolve();for(const gate of x.readerGates.values())gate.resolve();await pending;}
}
for(const late of [false,true])test(`real Agent loop routes four owner-page queries and completes cards independently${late?' with late fills':' while preserving Water-before-Excel'}`,{timeout:6000},async()=>realLoop({late}));
test('real Agent never retries or recreates a disconnected shared owner under sibling or Excel work',{timeout:6000},async()=>realLoop({disconnect:true}));
