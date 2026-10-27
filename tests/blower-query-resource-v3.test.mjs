import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {__blowerHistoryTest as api} from '../functions/api/blower-history.js';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const WINDOW={fromDate:'2025-10-22',endDate:'2026-10-22',snapshotAt:'2026-10-22T09:00:00Z'};
const USER={employeeNo:'fixture-resource',name:'fixture'};
const page=(phase,id,done=false)=>({ok:true,version:'bounded-logs-v1',phase,window:WINDOW,scannedLogCount:1,done,nextCursor:done?null:{workDate:'2026-10-21',updatedAt:'2026-10-21T00:00:00Z',id}});

test('interactive log check has a 45s budget, preserves the last successful receipt cursor, and reports partial',async()=>{
 let now=0,checkpoint,calls=0;const times=[],counts=[];
 const io={assertWritable(){},checkpoint:v=>checkpoint=v,logProgress:v=>counts.push(v),api:async o=>{calls++;times.push(o.timeoutMs);assert.equal(o.body.limit,1);now+=15000;return page(o.body.phase,String(calls));}};
 const result=await core.refreshLogsForRuntime(io,{clock:()=>now,sleep:async()=>{}});
 assert.equal(calls,3);assert.deepEqual(times,[30000,30000,15000]);assert.equal(result.complete,false);
 assert.equal(checkpoint.cursor.id,'3');assert.equal(checkpoint.totals.scannedReplacementLogs,3);assert.equal(result.totals.scannedReplacementLogs,3);
 assert.match(result.warning,/LOG_REFRESH_PAUSED/);assert.equal(counts.at(-1).scannedReplacementLogs,3);
 const resume=checkpoint;io.api=async o=>{calls++;assert.equal(o.body.phase,calls===4?'replacement':'operation');if(calls===4)assert.equal(o.body.cursor.id,'3');return page(o.body.phase,'done',true);};
 const next=await core.refreshLogsForRuntime(io,{clock:()=>now,sleep:async()=>{},resume});
 assert.equal(next.complete,true);assert.equal(checkpoint,null);assert.equal(next.totals.scannedReplacementLogs,4);assert.equal(next.totals.scannedOperationLogs,1);
});
test('response timeout and Retry-After cannot push the log stage past its remaining budget',async()=>{
 let now=0,calls=0,checkpoint;const timeouts=[];
 const out=await core.refreshLogsForRuntime({checkpoint:v=>checkpoint=v,api:async o=>{calls++;timeouts.push(o.timeoutMs);now+=o.timeoutMs;throw Object.assign(new Error('timeout'),{status:504});}}, {clock:()=>now,sleep:async ms=>{now+=ms;}});
 assert.equal(out.complete,false);assert.equal(now,45000);assert.deepEqual(timeouts,[30000,14000]);assert.equal(calls,2);assert.equal(checkpoint.cursor,null);assert.equal(checkpoint.totals.scannedReplacementLogs,0);
});
test('endless valid next pages stop at 80 pages without claiming complete or clearing the checkpoint',async()=>{
 let calls=0,checkpoint;
 const out=await core.refreshLogsForRuntime({checkpoint:v=>checkpoint=v,api:async o=>page(o.body.phase,String(++calls))},{clock:()=>0,sleep:async()=>{}});
 assert.equal(calls,80);assert.equal(out.complete,false);assert.equal(checkpoint.cursor.id,'80');
});
test('auth loss at a budget boundary still stops instead of continuing to runtime',async()=>{
 let allowed=true,now=0;
 await assert.rejects(()=>core.refreshLogsForRuntime({assertWritable(){if(!allowed)throw Object.assign(new Error('auth'),{status:403});},api:async o=>{now=45000;allowed=false;return page(o.body.phase,'one');}},{clock:()=>now,sleep:async()=>{}}),e=>e.status===403);
});
test('both phases finishing exactly at the deadline remain complete',async()=>{
 let now=0,calls=0;
 const out=await core.refreshLogsForRuntime({api:async o=>{now+=22500;calls++;return page(o.body.phase,'done',true);}},{clock:()=>now,sleep:async()=>{}});
 assert.equal(out.complete,true);assert.equal(calls,2);
});

async function fixture(){
 const sql=new DatabaseSync(':memory:'),queries=[];
 const db={prepare(text){return {v:[],bind(...v){this.v=v;return this;},async all(){const rows=sql.prepare(text).all(...this.v);queries.push({text,v:this.v,rows});return {results:rows};},async first(){queries.push({text,v:this.v});return sql.prepare(text).get(...this.v)||null;},async run(){queries.push({text,v:this.v});return {meta:{changes:Number(sql.prepare(text).run(...this.v).changes)}};}};},async batch(xs){return Promise.all(xs.map(x=>x.run()));}};
 await api.ensureSchema(db);queries.length=0;return {sql,db,queries};
}
test('paged plans return each enabled asset once, scope runtime rows to two assets, and preserve every history row',async()=>{
 const f=await fixture();try{
  const tags=f.sql.prepare('SELECT tag_number FROM blower_history_assets WHERE enabled=1 ORDER BY tag_number').all().map(r=>r.tag_number);
  const now='2026-10-21T00:00:00Z';
  for(const [i,tag] of tags.entries()) {
   f.sql.prepare("UPDATE blower_history_assets SET last_replacement_at='2026-10-01T00:00:00Z',cycle_start_state='legacy',cycle_start_revision='',cycle_runtime_hours=1,cycle_runtime_anchor_at=?,cycle_runtime_state='stopped' WHERE tag_number=?").run(now,tag);
   for(let n=0;n<12;n++){
    const id=`request-${i}-${n}`;const evidence={schemaVersion:1,requestType:'blower_runtime_probe',assetTag:tag,dataParcTag:tag==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.TEST_BINARY',requestId:id,expectedLastReplacementAt:'2026-10-01T00:00:00Z',expectedCycleStartState:'legacy',expectedCycleStartRevision:'',startAt:'2026-10-01T00:00:00Z',observedAt:now,runningSeconds:3600,endState:'stopped'};
    f.sql.prepare("INSERT INTO blower_history_events(id,tag_number,event_type,event_date,runtime_hours,source_type,source_log_id,source_text,created_by_id,created_by_name,created_at,updated_at) VALUES(?,?,'runtime_correction',?,1,'dataparc_runtime',?,?,'fixture','fixture',?,?)").run('dataparc_runtime:'+id,tag,now,id,JSON.stringify(evidence),now,now);
   }
  }
  const expected=(await api.buildRefreshState(f.db,USER)).assets.sort((a,b)=>a.tagNumber.localeCompare(b.tagNumber));
  f.queries.length=0;const actual=[];let cursor='';
  for(let i=0;i<30;i++){
   const r=await api.buildRefreshStatePage(f.db,USER,cursor,2);assert.equal(r.status,200);const p=await r.json();
   assert.equal(p.version,'blower-refresh-state-page-v1');assert.ok(p.assets.length<=2);actual.push(...p.assets);if(p.done){assert.equal(p.nextCursor,null);break;}assert.equal(p.nextCursor,p.assets.at(-1).tagNumber);cursor=p.nextCursor;
  }
  const project=a=>[a.tagNumber,a.dataParcTag,a.dataParcRuntimeBasis,a.cycleRuntimeRevision,a.runRuntime,a.hasUnverifiedDataParcHistory];
  assert.deepEqual(actual.map(project),expected.map(project));assert.deepEqual(actual.map(a=>a.tagNumber),tags);
  const runtime=f.queries.filter(q=>q.text.includes('FROM blower_history_events'));
  assert.equal(runtime.flatMap(q=>q.rows).length,tags.length*12);assert.ok(runtime.every(q=>q.v.length<=2&&q.rows.every(r=>q.v.includes(r.tag_number))));
  assert.ok(f.queries.every(q=>/^\s*SELECT\b/.test(q.text)));assert.ok(!f.queries.some(q=>/blower_history_(?:settings|references|candidates)/.test(q.text)));
 }finally{f.sql.close();}
});
for(const [cursor,limit] of [['',0],['',3],['',1.5],['bad;sql',2]])test('invalid plan cursor/limit is rejected before database reads',async()=>{
 const r=await api.buildRefreshStatePage({prepare(){throw Error('must not read');}},USER,cursor,limit);assert.equal(r.status,400);
});
test('new planning endpoint is authenticated and cannot become anonymous full data',async()=>{
 const r=await api.handleGet({env:{DB:{prepare(){throw Error('must not read');}}},request:new Request('https://fixture/api/blower-history?action=refresh_state_page')},null);assert.equal(r.status,401);
});
test('recognition memo preserves grouped tags, rejects substring paths, isolates callers, and invalidates catalog changes',()=>{
 const assets=[{tag_number:'P101'}];
 assert.deepEqual(api.extractRecognizedBlowerTags('104HHL60AP611/621/631',assets),['104HHL60AP611','104HHL60AP621','104HHL60AP631']);
 const a=api.extractRecognizedBlowerTags('P101',assets);a.push('fake');assert.deepEqual(api.extractRecognizedBlowerTags('P101',assets),['P101']);
 assets[0].tag_number='Q202';assert.deepEqual(api.extractRecognizedBlowerTags('P101',assets),[]);assert.deepEqual(api.extractRecognizedBlowerTags('Q202',assets),['Q202']);
 assert.deepEqual(api.extractRecognizedBlowerTags('DOC/Q202/ARCHIVE',assets),[]);
 for(let i=0;i<300;i++)api.extractRecognizedBlowerTags('ordinary '+i,assets);
 assert.deepEqual(api.extractRecognizedBlowerTags('Q202',assets),['Q202']);assert.deepEqual(api.extractRecognizedBlowerTags('Q202',[]),[]);
});
