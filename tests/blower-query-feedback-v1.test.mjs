import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as api, onRequestGet } from '../functions/api/blower-history.js';
const realCore = createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const source = fs.readFileSync(new URL('../maintenance/blower-history.js', import.meta.url), 'utf8');
const slice = (start, end) => { const a=source.indexOf(start), b=source.indexOf(end,a); assert.ok(a>=0&&b>a); return source.slice(a,b); };
const feedback = slice('  /* BLOWER_QUERY_FEEDBACK_V1:', '  function updateOverviewRefreshProgress(');
const refresh = slice('  async function refreshAllBlowers()', '  async function refreshFbheForUnified(');
const permission = slice('  function hasAuthenticatedWriteAccess(', '  function isPublicMonitoringView(');
const guard = slice('  function assertUnifiedRefreshWritable(', '  async function refreshAllBlowers(');
const headers = slice('  function getAuthHeaders(', '  function hasAuthenticatedWriteAccess(');
const send = slice('  async function sendApiRequest(', '  function buildAdaptiveRetryLimits(');
const TAG='104ETH03AN602', NOW='2026-10-22T08:00:00Z';
const asset={tagNumber:TAG,displayName:'Test Blower',enabled:true,lastReplacementAt:'2026-10-01T00:00:00Z',cycleStartState:'legacy',cycleRuntimeRevision:'fresh-r2',dataParcRuntimeBasis:null,hasUnverifiedDataParcHistory:false};
const snapshot=()=>({ok:true,version:'blower-refresh-state-page-v1',done:true,nextCursor:null,user:{name:'Test'},permissions:{canWrite:true},assets:[{...asset}],generatedAt:NOW});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function harness(options={}) {
 const timers=new Map(), classes=new Set(), storage=options.storage||new Map(), calls={api:[],reload:0,logs:0,batch:0,batchIo:[],toast:[]};let clock=0,id=0;
 const elements=Object.fromEntries(['blowerQueryOverlay','blowerQueryPhase','blowerQueryElapsed','blowerQueryProgress','blowerQueryDismiss','unifiedRefreshResume','unifiedRefreshDiagnostics','unifiedRefreshDiagnosticText','unifiedRefreshText','unifiedRefreshStatus','refreshButton'].map(key=>[key,{hidden:true,textContent:'',dataset:{},setAttribute(){},removeAttribute(){}}]));
 const state={data:{permissions:{canWrite:true},user:{name:'old',employeeNo:options.employeeNo||'employee-one'},assets:[{...asset,cycleRuntimeRevision:'stale-r1',dataParcRuntimeBasis:{observedAt:'stale'}}]},busy:false};
 const core={...realCore,
  readWithRetry:async read=>read(),
  refreshLogsForRuntime:async io=>{calls.logs++;io.logProgress?.({scannedReplacementLogs:123,scannedOperationLogs:44});for(let i=0;i<8;i++)io.progress('HTTP 503 Ray synthetic '+'very long '.repeat(i*10));if(options.gate)await options.gate.promise;if(options.logError)throw options.logError;return {complete:!options.partial,totals:{},warning:'synthetic log issue'};},
  executeDataParcBatch:async(tasks,io)=>{calls.batch++;calls.tasks=tasks;calls.batchIo.push(io);if(options.batchError)throw options.batchError;if(options.batchHook)return options.batchHook(tasks,io);return tasks.map(task=>({tagNumber:task.asset.tagNumber,status:'complete'}));}
 };
 const context=vm.createContext({state,elements,API_URL:'/api/blower-history',Date,Map,Set,Number,String,Math,Error,Object,
  window:{BlowerUnifiedRefresh:core,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},setInterval(fn){timers.set(++id,fn);return id;},clearInterval(id){timers.delete(id);},setTimeout,clearTimeout},
  performance:{now:()=>clock},document:{body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}},navigator:{},
  isMobileMonitoringView:()=>Boolean(options.mobile),getSessionToken:()=> options.token === undefined ? 'synthetic-session' : options.token,
  setBusy:b=>{state.busy=b;},updateOverviewRefreshProgress(p,t){state.unifiedRefreshProgressPct=p;state.unifiedRefreshProgressText=t;},
  setOverviewRefreshProcessed(n,total){state.unifiedRefreshProgressTarget=total;state.unifiedRefreshProgressPct=total?n/total*100:0;},
  renderUnifiedRefreshProgress(){},renderAssets(){},renderOverviewRefreshPanel(){},
  currentServerDate:()=>new Date(NOW),formatKstDateTimeDisplay:x=>x,
  showToast:(...x)=>calls.toast.push(x),
  apiRequest:async r=>{calls.api.push(r);if(options.readError)throw options.readError;return options.pages ? options.pages[calls.api.length-1] : options.snapshot??snapshot();},
  loadData:async()=>{calls.reload++;if(options.finalError)throw options.finalError;return state.data;}
 });
 vm.runInContext(permission+headers+feedback+guard+refresh,context);
 return {context,state,elements,calls,classes,timers,storage,tick(ms){clock=ms;for(const fn of timers.values())fn();},run:()=>context.refreshAllBlowers()};
}
test('actual refresh keeps centered phase short through retry text and ignores a second click',async()=>{
 const gate=deferred(),h=harness({gate});const first=h.run();
 assert.equal(h.elements.blowerQueryOverlay.hidden,false);assert.equal(h.classes.has('blower-query-active'),true);
 assert.equal(h.elements.blowerQueryPhase.textContent,'교체 이력을 확인하고 있습니다');
 assert.equal(h.elements.blowerQueryProgress.textContent,'교체 123건 · 운전 44건 확인');
 h.tick(65000);assert.equal(h.elements.blowerQueryElapsed.textContent,'경과 01:05');
 await h.run();assert.equal(h.calls.api.length,0);gate.resolve();await first;
 assert.equal(h.calls.api.length,1);assert.equal(h.calls.api[0].url,'/api/blower-history?action=refresh_state_page&limit=2&cursor=');
 assert.equal(h.calls.batch,1);assert.equal(h.calls.reload,1);
 assert.equal(h.calls.tasks[0].asset.cycleRuntimeRevision,'fresh-r2');
 assert.equal(h.calls.tasks[0].startAt,asset.lastReplacementAt);
 assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'complete');
 assert.equal(h.elements.unifiedRefreshText.textContent,'Blower 조회가 완료됐습니다.');
 assert.equal(h.elements.blowerQueryOverlay.hidden,true);assert.equal(h.timers.size,0);assert.equal(h.classes.size,0);assert.equal(h.state.busy,false);
});
for(const [name,options,status,batch,reloads] of [
 ['snapshot 503',{readError:Object.assign(new Error('upstream'),{status:503,cfRay:'synthetic-ray',responseKind:'HTML',cloudflareCode:'1102'})},'failed',0,0],
 ['snapshot auth revoked',{snapshot:{...snapshot(),permissions:{canWrite:false}}},'failed',0,0],
 ['log auth revoked',{logError:Object.assign(new Error('expired'),{status:401})},'failed',0,0],
 ['partial log scan',{partial:true},'partial',1,1],
 ['batch failure',{batchError:Object.assign(new Error('batch unavailable'),{status:503})},'partial',1,1],
 ['final read failure',{finalError:Object.assign(new Error('final read failed'),{status:503})},'failed',1,1],
 ['missing module',{},'failed',0,0],
]) test(`${name}: closes overlay, restores controls, never invents success or extra fallback reads`,async()=>{
 const h=harness(options);if(name==='missing module')h.context.window.BlowerUnifiedRefresh=null;
 await h.run();assert.equal(h.elements.unifiedRefreshStatus.dataset.state,status);assert.equal(h.calls.batch,batch);assert.equal(h.calls.reload,reloads);
 assert.equal(h.elements.blowerQueryOverlay.hidden,true);assert.equal(h.timers.size,0);assert.equal(h.state.unifiedRefreshBusy,false);assert.equal(h.state.busy,false);
 assert.notEqual(h.elements.unifiedRefreshText.textContent,'Blower 조회가 완료됐습니다.');
 if(name==='snapshot 503'){assert.match(h.elements.unifiedRefreshDiagnosticText.textContent,/synthetic-ray/);assert.match(h.elements.unifiedRefreshDiagnosticText.textContent,/HTML/);assert.match(h.elements.unifiedRefreshDiagnosticText.textContent,/1102/);assert.doesNotMatch(h.elements.unifiedRefreshText.textContent,/Ray|1102/);}
});
for(const bad of [
 {...snapshot(),version:'old'}, {...snapshot(),assets:null}, {...snapshot(),generatedAt:'invalid'},
 {...snapshot(),assets:[{tagNumber:TAG}]}, {...snapshot(),assets:[asset,asset]}
])test('malformed snapshot stops before batch; no cached basis fallback',async()=>{
 const h=harness({snapshot:bad});await h.run();assert.equal(h.calls.batch,0);assert.equal(h.calls.reload,0);assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'failed');
});
test('public and mobile only reload stored data without starting a query',async()=>{
 for(const mobile of [false,true]){const h=harness({mobile});if(!mobile)h.state.data.permissions.canWrite=false;await h.run();assert.equal(h.calls.reload,1);assert.equal(h.calls.api.length,0);assert.equal(h.calls.batch,0);assert.equal(h.timers.size,0);}
});
test('actual HTTP parser retains status and safe identifiers without rendering HTML',async()=>{
 const h=harness();h.context.fetch=async()=>new Response('<html><h1>Error 1102</h1><script>unsafe()</script></html>',{status:503,headers:{'CF-Ray':'synthetic-edge','Retry-After':'2'}});
 h.context.getAuthHeaders=()=>({});h.context.parseRetryAfterMs=()=>2000;
 vm.runInContext(send,h.context);
 await assert.rejects(()=>h.context.sendApiRequest(),e=>{assert.equal(e.status,503);assert.equal(e.responseKind,'HTML');assert.equal(e.cloudflareCode,'1102');assert.equal(e.cfRay,'synthetic-edge');assert.equal(e.retryable,true);assert.doesNotMatch(e.message,/<html>|unsafe/);return true;});
});
async function databaseFixture() {
 const sql=new DatabaseSync(':memory:'),queries=[];
 const database={prepare(text){return {values:[],bind(...values){this.values=values;return this;},async all(){queries.push(text);return {results:sql.prepare(text).all(...this.values)};},async first(){queries.push(text);return sql.prepare(text).get(...this.values)||null;},async run(){queries.push(text);return {meta:{changes:Number(sql.prepare(text).run(...this.values).changes)}};}};},async batch(items){return Promise.all(items.map(x=>x.run()));}};
 await api.ensureSchema(database);queries.length=0;
 return {sql,database,queries};
}
test('planning endpoint is authenticated before DB and is never a public full-data fallback',async()=>{
 const context={env:{DB:{prepare(){throw Error('unexpected database call');}}},request:new Request('https://test/api/blower-history?action=refresh_state')};
 const response=await onRequestGet(context);assert.equal(response.status,401);assert.equal((await response.json()).permissions.canWrite,false);
});
test('actual SQLite planning reads preserve asset basis and skip full event/candidate/recovery loads and writes',async()=>{
 const f=await databaseFixture();try{
  const user={employeeNo:'synthetic',name:'Test',isSuperAdmin:true};
  const response=await api.handleGet({env:{DB:f.database},request:new Request('https://test/api/blower-history?action=refresh_state')},user);
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.version,'blower-refresh-state-v1');assert.equal(result.permissions.canWrite,true);assert.ok(result.assets.length>=22);assert.ok(Number.isFinite(Date.parse(result.generatedAt)));
  assert.ok(result.assets.every(a=>Object.hasOwn(a,'dataParcRuntimeBasis')));
  const planQueries=[...f.queries];assert.equal(planQueries.length,5);
  assert.ok(planQueries.every(q=>/^\s*SELECT\b/i.test(q)));assert.ok(planQueries.every(q=>!/candidates|recovery|settings_history|LIMIT\s+10000/i.test(q)));
  assert.equal(result.events,undefined);assert.equal(result.pendingCandidates,undefined);assert.equal(result.recovery,undefined);
  const assets=await api.loadAssetStates(f.database,{});
  assert.deepEqual(result.assets.map(a=>[a.tagNumber,a.dataParcRuntimeBasis,a.cycleRuntimeRevision,a.runRuntime]),assets.map(a=>[a.tagNumber,a.dataParcRuntimeBasis,a.cycleRuntimeRevision,a.runRuntime]));
 }finally{f.sql.close();}
});

test('unverified current-cycle stored result cannot become a fresh full-range query',async()=>{
 const h=harness({snapshot:{...snapshot(),assets:[{...asset,hasUnverifiedDataParcHistory:true}]}});
 await h.run();assert.equal(h.calls.batch,0);assert.equal(h.calls.reload,1);assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'partial');
 assert.match(h.state.unifiedRefreshResults[0].message,/기존 조회값 보호/);
});
test('SQLite planning conservatively flags unverified stored DataPARC history without changing the default asset projection',async()=>{
 const f=await databaseFixture();try{
  f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run(asset.lastReplacementAt,TAG);
  f.sql.prepare(`INSERT INTO blower_history_events(id,tag_number,event_type,event_date,source_type,source_text,created_by_id,created_by_name,created_at,updated_at)
   VALUES(?,?,'runtime_correction',?,'dataparc_runtime',?,'fixture','fixture',?,?)`).run('legacy',TAG,'2026-10-20T00:00:00Z','{}',NOW,NOW);
  const result=await api.buildRefreshState(f.database,{name:'Test'});const found=result.assets.find(a=>a.tagNumber===TAG);
  assert.equal(found.dataParcRuntimeBasis,null);assert.equal(found.hasUnverifiedDataParcHistory,true);
  const original=await api.loadAssetStates(f.database,{});assert.equal(original.find(a=>a.tagNumber===TAG).hasUnverifiedDataParcHistory,undefined);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_events').get().n,1);
 }finally{f.sql.close();}
});

test('desktop query survives a narrow viewport; only its scoped requests keep desktop headers',async()=>{
 const options={gate:deferred()},h=harness(options),pending=h.run();options.mobile=true;
 assert.doesNotThrow(()=>h.context.assertUnifiedRefreshWritable());
 assert.equal(h.context.getAuthHeaders()['X-GS-Client-Mode'],'mobile-monitoring');
 assert.equal(h.context.getAuthHeaders({},true)['X-GS-Client-Mode'],'desktop');
 options.gate.resolve();await pending;
 assert.equal(h.calls.batch,1);assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'complete');
 assert.equal(h.calls.api[0].unifiedRefresh,true);assert.equal(h.state.unifiedRefreshClientMode,'');
 assert.equal(h.context.getAuthHeaders({},true)['X-GS-Client-Mode'],'mobile-monitoring');
});
for(const kind of ['logout','different account','permission revoked'])test(`${kind} still stops an admitted query before planning or runtime requests`,async()=>{
 const options={gate:deferred()},h=harness(options),pending=h.run();options.mobile=true;
 if(kind==='permission revoked')h.state.data.permissions.canWrite=false;else options.token=kind==='logout'?'':'another-token';
 assert.throws(()=>h.context.assertUnifiedRefreshWritable(),e=>e.status===403&&e.code==='WRITE_ACCESS_CHANGED');
 options.gate.resolve();await pending;
 assert.equal(h.calls.batch,0);assert.equal(h.calls.api.length,0);assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'failed');
 assert.match(h.elements.unifiedRefreshText.textContent,/로그인/);assert.equal(h.timers.size,0);assert.equal(h.state.unifiedRefreshClientMode,'');
});
test('view changed while waiting for the cross-tab lock cannot admit a new desktop query',async()=>{
 const options={},h=harness(options);
 h.context.navigator.locks={request:async(name,config,callback)=>{options.mobile=true;return callback({});}};
 await h.run();assert.equal(h.calls.batch,0);assert.equal(h.calls.reload,1);assert.equal(h.timers.size,0);
});
test('actual scoped HTTP sender keeps desktop headers and checks auth again after reading the response',async()=>{
 const options={gate:deferred()},h=harness(options),pending=h.run();options.mobile=true;
 h.context.parseRetryAfterMs=()=>0;vm.runInContext(send,h.context);
 const gate=deferred();let fetches=0;
 h.context.fetch=async(url,opts)=>{fetches++;assert.equal(opts.headers['X-GS-Client-Mode'],'desktop');assert.equal(opts.headers.Authorization,'Bearer synthetic-session');return gate.promise;};
 const request=h.context.sendApiRequest({url:'/api/blower-history?action=refresh_state',unifiedRefresh:true});
 options.token='new-session';gate.resolve(new Response(JSON.stringify(snapshot()),{status:200}));
 await assert.rejects(request,e=>e.code==='WRITE_ACCESS_CHANGED');assert.equal(fetches,1);
 await assert.rejects(()=>h.context.sendApiRequest({unifiedRefresh:true}),e=>e.code==='WRITE_ACCESS_CHANGED');assert.equal(fetches,1);
 options.gate.resolve();await pending;
});
test('Cloudflare problem JSON reveals 1102 and bounded safe detail without printing session tokens',async()=>{
 const h=harness();h.context.parseRetryAfterMs=()=>0;vm.runInContext(send,h.context);
 h.context.fetch=async()=>new Response(JSON.stringify({cloudflare_error:true,status:503,title:'Error 1102: Worker exceeded resource limits',detail:'CPU limit synthetic-session '+ 'x'.repeat(1000),error_code:1102,error_category:'worker',ray_id:'test-edge',retryable:false}),{status:503});
 await assert.rejects(()=>h.context.sendApiRequest(),e=>{
  assert.equal(e.status,503);assert.equal(e.cloudflareCode,'1102');assert.equal(e.code,'CLOUDFLARE_1102');assert.equal(e.retryable,false);assert.equal(e.cfRay,'test-edge');assert.equal(e.responseKind,'JSON');
  assert.match(e.message,/1102/);assert.match(e.serverDetail,/CPU limit/);assert.doesNotMatch(e.serverDetail,/synthetic-session/);assert.ok(e.serverDetail.length<=600);return true;
 });
});
test('Cloudflare diagnostic header works for an empty error body; empty is not mislabeled JSON',async()=>{
 const h=harness();h.context.parseRetryAfterMs=()=>0;vm.runInContext(send,h.context);
 h.context.fetch=async()=>new Response('',{status:503,headers:{'CF-Error-Type':'1102','CF-Ray':'header-edge'}});
 await assert.rejects(()=>h.context.sendApiRequest(),e=>{assert.equal(e.cloudflareCode,'1102');assert.equal(e.cfRay,'header-edge');assert.equal(e.responseKind,'empty');return true;});
});
test('ordinary application errors retain their message/code and do not impersonate Cloudflare',async()=>{
 const h=harness();h.context.parseRetryAfterMs=()=>0;vm.runInContext(send,h.context);
 h.context.fetch=async()=>new Response(JSON.stringify({ok:false,message:'세션 만료',code:'AUTH_EXPIRED',error_code:1102,detail:'not a Cloudflare error'}),{status:401});
 await assert.rejects(()=>h.context.sendApiRequest(),e=>{assert.equal(e.message,'세션 만료');assert.equal(e.code,'AUTH_EXPIRED');assert.equal(e.cloudflareCode,'');assert.equal(e.serverDetail,'');return true;});
});
test('non-retryable resource-limit errors stop read, log replay, and polling without repeated calls',async()=>{
 for(const operation of ['read','logs','poll']){
  let calls=0;const fail=async()=>{calls++;throw Object.assign(new Error('resource limit'),{status:503,code:'CLOUDFLARE_1102',retryable:false});};
  const io={api:fail,assertWritable(){},progress(){}};const opts={sleep:async()=>{throw Error('must not retry');}};
  await assert.rejects(()=>operation==='read'?realCore.readWithRetry(fail,io,'test',opts):operation==='logs'?realCore.refreshLogsForRuntime(io,opts):realCore.waitRequests([{id:'test-query',status:'pending'}],io,opts),e=>e.code==='CLOUDFLARE_1102');
  assert.equal(calls,1);
 }
});

test('actual UI combines all authenticated plan pages before one atomic runtime batch',async()=>{
 const other={...asset,tagNumber:'204ETG30AN601',dataParcTag:'GSPOGE.ABB_DCS.TEST_ONLY_RUN'};
 const h=harness({pages:[{...snapshot(),done:false,nextCursor:TAG}, {...snapshot(),assets:[other]}]});
 await h.run();assert.equal(h.calls.api.length,2);assert.match(h.calls.api[1].url,new RegExp('cursor='+TAG));
 assert.equal(h.calls.batch,1);assert.equal(h.calls.tasks.length,2);assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'complete');
});
for(const page of [
 {...snapshot(),done:false,nextCursor:'forged'}, {...snapshot(),done:false,assets:[],nextCursor:TAG},
 {...snapshot(),done:true,nextCursor:TAG}, {...snapshot(),done:'true'},
 {...snapshot(),assets:[asset,asset,asset]}
])test('malformed plan pagination cannot start any runtime request',async()=>{
 const h=harness({snapshot:page});await h.run();assert.equal(h.calls.batch,0);assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'failed');
});
test('later plan page cannot repeat an asset or revoke permissions silently',async()=>{
 for(const second of [snapshot(),{...snapshot(),permissions:{canWrite:false}}]) {
  const h=harness({pages:[{...snapshot(),done:false,nextCursor:TAG},second]});await h.run();assert.equal(h.calls.batch,0);assert.equal(h.calls.reload,0);
  assert.equal(h.elements.blowerQueryOverlay.hidden,true);assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'failed');
 }
});

const RESUME_KEY='gsShiftLog.blowerRuntimeResume.v4';
function acceptedCheckpoint(tasks, outcomes=[]) {
 return {version:1,tasks,createdBatch:{ok:true,atomic:true,batchVersion:1,requestedCount:tasks.length,
  results:tasks.map((task,index)=>({ok:true,assetTag:task.snapshot.tagNumber,item:{id:`accepted-ui-${index+1}`,status:'pending',requestType:'blower_runtime_probe',probe:{assetTag:task.snapshot.tagNumber,requestId:`accepted-ui-${index+1}`}}}))},outcomes};
}

test('the centered overlay dismisses after 30 seconds while the admitted query and duplicate-click guard stay active',async()=>{
 const gate=deferred(),h=harness({gate}),running=h.run();
 h.tick(29000);assert.equal(h.elements.blowerQueryOverlay.hidden,false);
 h.tick(30000);
 assert.equal(h.elements.blowerQueryOverlay.hidden,true);
 assert.equal(h.classes.has('blower-query-active'),false);
 assert.equal(h.state.unifiedRefreshBusy,true);assert.equal(h.state.busy,true);
 assert.equal(h.elements.unifiedRefreshStatus.hidden,false);
 assert.match(h.elements.unifiedRefreshText.textContent,/저장된 이력을 볼 수 있습니다/);
 assert.equal(h.timers.size,1,'elapsed feedback remains alive while the original operation is running');
 await h.run();assert.equal(h.calls.logs,1);assert.equal(h.calls.batch,0);
 gate.resolve();await running;
 assert.equal(h.calls.batch,1);assert.equal(h.calls.reload,1);assert.equal(h.timers.size,0);
 assert.equal(h.state.unifiedRefreshBusy,false);
});

test('manual history viewing hides the overlay without cancelling or restarting the running query',async()=>{
 const gate=deferred(),h=harness({gate}),running=h.run();
 h.context.dismissUnifiedRefreshFeedback();
 assert.equal(h.elements.blowerQueryOverlay.hidden,true);
 assert.equal(h.state.unifiedRefreshBusy,true);assert.equal(h.state.busy,true);
 assert.equal(h.state.unifiedFeedbackDismissed,true);
 h.tick(1000);assert.equal(h.elements.blowerQueryOverlay.hidden,true);
 await h.run();assert.equal(h.calls.logs,1);assert.equal(h.calls.batch,0);
 gate.resolve();await running;
 assert.equal(h.calls.batch,1);assert.equal(h.calls.reload,1);
 assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'complete');
 assert.equal(h.timers.size,0);
});

test('waiting results expose resume and a second confirmation reuses the accepted IDs without a new log scan or plan',async()=>{
 let run=0;
 const h=harness({batchHook:async(tasks,io)=>{
  run++;
  if(run===1){
   assert.equal(io.runtimeResume,null);
   io.runtimeCheckpoint(acceptedCheckpoint(tasks));
   return tasks.map(task=>({tagNumber:task.snapshot.tagNumber,status:'waiting',requestId:'accepted-ui-1',message:'PC processing'}));
  }
  assert.equal(io.runtimeResume.createdBatch.results[0].item.id,'accepted-ui-1');
  assert.equal(tasks[0].snapshot.cycleRuntimeRevision,'fresh-r2');
  io.runtimeCheckpoint(null);
  return tasks.map(task=>({tagNumber:task.snapshot.tagNumber,status:'complete',message:'confirmed same request'}));
 }});
 await h.run();
 assert.equal(h.calls.logs,1);assert.equal(h.calls.api.length,1);assert.equal(h.calls.batch,1);
 assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'partial');
 assert.equal(h.elements.unifiedRefreshResume.hidden,false);
 assert.equal(h.state.unifiedRefreshProgressPct,0,'a waiting asset must not display 100% completion');
 assert.match(h.elements.unifiedRefreshText.textContent,/1대의 결과를 기다리고/);
 assert.doesNotMatch(h.elements.unifiedRefreshText.textContent,/조회가 완료됐습니다/);
 h.state.data.assets[0].cycleRuntimeRevision='a-new-browser-snapshot';
 await h.run();
 assert.equal(h.calls.logs,1,'accepted work must be reconciled before rereading work logs');
 assert.equal(h.calls.api.length,1,'accepted work must not receive a new planning snapshot');
 assert.equal(h.calls.batch,2);assert.equal(h.calls.reload,2);
 assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'complete');
 assert.equal(h.elements.unifiedRefreshResume.hidden,true);
 assert.equal(h.state.unifiedRuntimeResume,null);assert.equal(h.storage.has(RESUME_KEY),false);
});

test('same-owner session restore retains accepted IDs, distrusts cached success, and never stores the login token',()=>{
 const tasks=realCore.plan([asset],new Date(NOW)).tasks;
 const original=harness();
 original.context.saveUnifiedRuntimeResume(acceptedCheckpoint(tasks,[{tagNumber:TAG,status:'complete',message:'cached only'}]));
 const stored=original.storage.get(RESUME_KEY);
 assert.ok(stored);assert.doesNotMatch(stored,/synthetic-session|Authorization|Bearer/);
 assert.equal(JSON.parse(stored).owner,'employee-one');
 const restored=harness({storage:original.storage,token:'another-valid-session-for-same-owner'});
 restored.context.restoreUnifiedRuntimeResume();
 assert.equal(restored.state.unifiedRuntimeResume.createdBatch.results[0].item.id,'accepted-ui-1');
 assert.equal(restored.state.unifiedRuntimeResume.outcomes.length,0,'storage may identify work, but cannot assert it was saved');
 assert.equal(restored.state.unifiedRuntimeResumeOwner,'another-valid-session-for-same-owner');
 assert.equal(restored.elements.unifiedRefreshResume.hidden,false);
 assert.equal(restored.calls.batch,0);assert.equal(restored.calls.api.length,0);
 assert.doesNotMatch(original.storage.get(RESUME_KEY),/another-valid-session-for-same-owner|synthetic-session/);
});

test('another employee cannot restore or execute a stored owner checkpoint',()=>{
 const original=harness();
 original.context.saveUnifiedRuntimeResume(acceptedCheckpoint(realCore.plan([asset],new Date(NOW)).tasks));
 const other=harness({storage:original.storage,employeeNo:'employee-two',token:'other-token'});
 other.context.restoreUnifiedRuntimeResume();
 assert.equal(other.state.unifiedRuntimeResume,null);
 assert.equal(other.state.unifiedRuntimeResumeOwner,'');
 assert.equal(other.elements.unifiedRefreshResume.hidden,true);
 assert.equal(other.calls.batch,0);assert.equal(other.calls.api.length,0);
});

test('a final data reload failure preserves waiting accepted work and the previously displayed runtime',async()=>{
 const h=harness({finalError:Object.assign(new Error('reload unavailable'),{status:503}),batchHook:async(tasks,io)=>{
  io.runtimeCheckpoint(acceptedCheckpoint(tasks));
  return tasks.map(task=>({tagNumber:task.snapshot.tagNumber,status:'waiting',requestId:'accepted-ui-1',message:'waiting'}));
 }});
 h.state.data.assets[0].cycleElapsedHours=206.8;
 const originalData=JSON.stringify(h.state.data);
 await h.run();
 assert.equal(h.calls.batch,1);assert.equal(h.calls.reload,1);
 assert.equal(h.state.unifiedRuntimeResume.createdBatch.results[0].item.id,'accepted-ui-1');
 assert.equal(h.elements.unifiedRefreshResume.hidden,false);
 assert.equal(JSON.stringify(h.state.data),originalData);
 assert.equal(h.state.unifiedRefreshResults[0].status,'waiting');
 assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'failed');
 assert.equal(h.elements.blowerQueryOverlay.hidden,true);assert.equal(h.timers.size,0);
 assert.equal(h.state.unifiedRefreshBusy,false);assert.equal(h.state.busy,false);
 assert.doesNotMatch(h.elements.unifiedRefreshText.textContent,/조회가 완료됐습니다/);
});

test('an unknown create response explains uncertain acceptance, ends the overlay, and does not retry or report completion',async()=>{
 const h=harness({batchError:Object.assign(new Error('receipt unavailable'),{status:504,code:'CREATE_RESULT_UNCONFIRMED'})});
 await h.run();
 assert.equal(h.calls.batch,1);assert.equal(h.calls.reload,0);
 assert.equal(h.elements.unifiedRefreshStatus.dataset.state,'failed');
 assert.match(h.elements.unifiedRefreshText.textContent,/접수 결과를 확인하지 못했습니다/);
 assert.match(h.elements.unifiedRefreshText.textContent,/이미 처리 중일 수 있습니다/);
 assert.match(h.elements.unifiedRefreshText.textContent,/자동 재요청은 하지 않았습니다/);
 assert.doesNotMatch(h.elements.unifiedRefreshText.textContent,/조회가 완료됐습니다/);
 assert.equal(h.state.unifiedRuntimeResume,null);assert.equal(h.storage.has(RESUME_KEY),false);
 assert.equal(h.elements.blowerQueryOverlay.hidden,true);assert.equal(h.timers.size,0);
 assert.equal(h.state.unifiedRefreshBusy,false);assert.equal(h.state.busy,false);
});
