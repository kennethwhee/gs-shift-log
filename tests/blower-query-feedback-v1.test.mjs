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
const send = slice('  async function sendApiRequest(', '  function buildAdaptiveRetryLimits(');
const TAG='104ETH03AN602', NOW='2026-10-22T08:00:00Z';
const asset={tagNumber:TAG,displayName:'Test Blower',enabled:true,lastReplacementAt:'2026-10-01T00:00:00Z',cycleStartState:'legacy',cycleRuntimeRevision:'fresh-r2',dataParcRuntimeBasis:null,hasUnverifiedDataParcHistory:false};
const snapshot=()=>({ok:true,version:'blower-refresh-state-v1',user:{name:'Test'},permissions:{canWrite:true},assets:[{...asset}],generatedAt:NOW});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
function harness(options={}) {
 const timers=new Map(), classes=new Set(), calls={api:[],reload:0,batch:0,toast:[]};let clock=0,id=0;
 const elements=Object.fromEntries(['blowerQueryOverlay','blowerQueryPhase','blowerQueryElapsed','unifiedRefreshDiagnostics','unifiedRefreshDiagnosticText','unifiedRefreshText','unifiedRefreshStatus','refreshButton'].map(key=>[key,{hidden:true,textContent:'',dataset:{},setAttribute(){},removeAttribute(){}}]));
 const state={data:{permissions:{canWrite:true},user:{name:'old'},assets:[{...asset,cycleRuntimeRevision:'stale-r1',dataParcRuntimeBasis:{observedAt:'stale'}}]},busy:false};
 const core={...realCore,
  readWithRetry:async read=>read(),
  refreshLogsForRuntime:async io=>{for(let i=0;i<8;i++)io.progress('HTTP 503 Ray synthetic '+'very long '.repeat(i*10));if(options.gate)await options.gate.promise;if(options.logError)throw options.logError;return {complete:!options.partial,totals:{},warning:'synthetic log issue'};},
  executeDataParcBatch:async(tasks)=>{calls.batch++;calls.tasks=tasks;if(options.batchError)throw options.batchError;return tasks.map(task=>({tagNumber:task.asset.tagNumber,status:'complete'}));}
 };
 const context=vm.createContext({state,elements,API_URL:'/api/blower-history',Date,Map,Set,Number,String,Math,Error,Object,
  window:{BlowerUnifiedRefresh:core,setInterval(fn){timers.set(++id,fn);return id;},clearInterval(id){timers.delete(id);},setTimeout,clearTimeout},
  performance:{now:()=>clock},document:{body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}},navigator:{},
  isMobileMonitoringView:()=>Boolean(options.mobile),getSessionToken:()=> 'synthetic-session',
  assertUnifiedRefreshWritable(){if(options.revoked)throw Object.assign(new Error('session changed'),{status:403});},
  setBusy:b=>{state.busy=b;},updateOverviewRefreshProgress(p,t){state.unifiedRefreshProgressPct=p;state.unifiedRefreshProgressText=t;},
  setOverviewRefreshProcessed(n,total){state.unifiedRefreshProgressTarget=total;state.unifiedRefreshProgressPct=total?n/total*100:0;},
  renderUnifiedRefreshProgress(){},renderAssets(){},renderOverviewRefreshPanel(){},
  currentServerDate:()=>new Date(NOW),formatKstDateTimeDisplay:x=>x,
  showToast:(...x)=>calls.toast.push(x),
  apiRequest:async r=>{calls.api.push(r);if(options.readError)throw options.readError;return options.snapshot??snapshot();},
  loadData:async()=>{calls.reload++;if(options.finalError)throw options.finalError;return state.data;}
 });
 vm.runInContext(permission+feedback+refresh,context);
 return {context,state,elements,calls,classes,timers,tick(ms){clock=ms;for(const fn of timers.values())fn();},run:()=>context.refreshAllBlowers()};
}
test('actual refresh keeps centered phase short through retry text and ignores a second click',async()=>{
 const gate=deferred(),h=harness({gate});const first=h.run();
 assert.equal(h.elements.blowerQueryOverlay.hidden,false);assert.equal(h.classes.has('blower-query-active'),true);
 assert.equal(h.elements.blowerQueryPhase.textContent,'교체 이력을 확인하고 있습니다');
 h.tick(65000);assert.equal(h.elements.blowerQueryElapsed.textContent,'경과 01:05');
 await h.run();assert.equal(h.calls.api.length,0);gate.resolve();await first;
 assert.equal(h.calls.api.length,1);assert.equal(h.calls.api[0].url,'/api/blower-history?action=refresh_state');
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
