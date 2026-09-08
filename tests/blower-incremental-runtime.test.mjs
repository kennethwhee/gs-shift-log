import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture, browserCreate, agentClaim, agentComplete, callApi, agent, addBrowserIdentity, BROWSER_TOKEN, history, historyPost } from './helpers/blower-incremental-fixture.mjs';
import { verifiedAppendBase, incrementalEvidence } from '../functions/_shared/blower-incremental.js';
const core=createRequire(import.meta.url)('../maintenance/blower-unified-refresh.js');
const TAGS=['104ETH03AN601','104ETH03AN602','104ETG30AN601','104ETG30AN602','204ETG30AN601','204ETG30AN602','104SDF01AN001','104SDF01AN002','204SDF01AN001','204SDF01AN002','204LMDF01AN001',...['104','204'].flatMap(p=>['60AP','10AN'].flatMap(g=>['611','621','631'].map(n=>`${p}HHL${g}${n}`)))];
const realDate=Date;
async function setup(tag=TAGS[0],legacy=true){
 let clock=realDate.parse('2026-09-08T14:00:00Z');
 globalThis.Date=class extends realDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
 const f=await fixture(tag,legacy);f.sqlite.prepare("UPDATE shift_log_sessions SET expires_at=?").run(new Date(Date.now()+10*86400000).toISOString());f.tag=tag;f.signal=tag==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_'+tag;
 f.read=()=>f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(tag);
 f.events=()=>f.sqlite.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY created_at DESC,event_date DESC,id DESC').all(tag);
 f.advance=ms=>{clock+=ms;};
 f.create=async(extra={},token=BROWSER_TOKEN)=>{
  const a=f.read();return browserCreate(f.database,{action:'create_blower_runtime_probe',assetTag:tag,dataParcTag:f.signal,confirmRunSignal:true,
   startAt:f.startAt,unifiedRefresh:true,incrementalRefresh:true,
   expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,
   expectedCycleStartedAt:a.cycle_started_at||'',expectedCycleStartRevision:a.cycle_start_revision||'',expectedCycleRuntimeRevision:a.cycle_runtime_revision,...extra},token);
 };
 f.finish=async(item,seconds=3601,startState='running',endState='running')=>{
  const claim=await agentClaim(f.database);assert.equal(claim.status,200,JSON.stringify(claim.body));
  const claimed=claim.body.items.excel;assert.equal(claimed.id,item.id);
  const expected=agent.parseClaim(claimed),hours=seconds/3600;
  const raw={...claimed.probe,ok:true,observedAt:claimed.probe.endAt,collectedAt:new Date().toISOString(),
   completedChunkCount:1,startState,endState,runningSeconds:seconds,totalRunningHours:hours,
   chunks:[{index:1,startAt:claimed.probe.startAt,endAt:claimed.probe.endAt,startState,endState,runningSeconds:seconds,totalRunningHours:hours}]};
  const normalized=agent.normalizeResult(raw,expected);
  const done=await agentComplete(f.database,item.id,normalized);assert.equal(done.status,200,JSON.stringify(done.body));return done;
 };
 f.sync=async(id,token=BROWSER_TOKEN)=>callApi(historyPost,f.database,new Request('https://example.test/api/blower-history',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'dataparc_runtime_sync',requestId:id})}));
 f.seed=async(seconds=3601)=>{const q=await f.create();assert.equal(q.status,201,JSON.stringify(q.body));await f.finish(q.body.item,seconds);const s=await f.sync(q.body.item.id);assert.equal(s.status,200,JSON.stringify(s.body));return q.body.item;};
 f.close=()=>{f.database.close();globalThis.Date=realDate;};return f;
}
for(const tag of TAGS)test(`${tag}: actual queue→Agent contract→sync appends only after the successful end; replay cannot double-add`,async()=>{
 const f=await setup(tag);try{
  const first=await f.seed(),row=f.read(),historyBefore=f.events(),end=first.probe.endAt;
  const base=verifiedAppendBase(row,historyBefore,f.signal);assert.ok(base);assert.equal(base.runningSeconds,3601);
  const basis=history.currentDataParcRuntimeBasis(row,historyBefore);assert.equal(basis.appendReady,true);
  f.advance(86400000);const q=await f.create({baseRunningSeconds:999999,startAt:f.replacementAt});assert.equal(q.status,201,JSON.stringify(q.body));
  assert.equal(Date.parse(q.body.item.probe.startAt),Date.parse(end));assert.notEqual(q.body.item.probe.startAt,first.probe.startAt);
  assert.deepEqual(f.read(),row,'create does not change stored runtime');
  await f.finish(q.body.item,9002);assert.deepEqual(f.read(),row,'Agent completion remains read-only');
  const saved=await f.sync(q.body.item.id);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.incremental,true);
  assert.equal(saved.body.runtimeHours,12603/3600);assert.equal(saved.body.addedRunningSeconds,9002);
  const asset=f.read(),events=f.events();assert.deepEqual(events.find(x=>x.id===historyBefore[0].id),historyBefore[0]);
  const b=history.currentDataParcRuntimeBasis(asset,events);assert.equal(Date.parse(b.startAt),Date.parse(first.probe.startAt));assert.equal(b.appendReady,true);assert.equal(b.runningSeconds,12603);
  const evidence=JSON.parse(events[0].source_text);assert.ok(evidence.incremental);assert.ok(events[0].source_text.length<=2000);
  assert.equal(incrementalEvidence(evidence).deltaRunningSeconds,9002);
  const plan=core.plan([{tagNumber:tag,enabled:true,blowerType:'fbhe',lastReplacementAt:asset.last_replacement_at,cycleStartState:asset.cycle_start_state,dataParcTag:f.signal,dataParcRuntimeBasis:b}],new Date(Date.now()+1000));
  assert.equal(plan.tasks[0].incremental,true);assert.equal(plan.tasks[0].queryStartAt,b.observedAt);
  const replay=await f.sync(q.body.item.id);assert.equal(replay.body.replayed,true);assert.deepEqual(f.read(),asset);assert.deepEqual(f.events(),events);
 }finally{f.close();}
});
test('zero-run segment preserves total, updates last success, and the next segment starts at that exact boundary',async()=>{
 const f=await setup();try{await f.seed(12000);f.advance(3600000);const a=await f.create();await f.finish(a.body.item,0,'running','stopped');const saved=await f.sync(a.body.item.id);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.runtimeHours,12000/3600);const boundary=f.read().cycle_runtime_anchor_at;
 f.advance(3600000);const b=await f.create();assert.equal(Date.parse(b.body.item.probe.startAt),Date.parse(boundary));await f.finish(b.body.item,1777,'stopped','running');const r=await f.sync(b.body.item.id);assert.equal(r.body.runtimeHours,13777/3600);
 }finally{f.close();}
});
test('up-to-date same-second Latest does not open another request or change records',async()=>{const f=await setup();try{await f.seed();const before=f.read();const count=f.sqlite.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n;const r=await f.create();assert.equal(r.body.upToDate,true);assert.equal(r.status,200);assert.deepEqual(f.read(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n,count);}finally{f.close();}});
test('pending request reuse does not replace the baseline and completing it adds once',async()=>{const f=await setup();try{await f.seed();f.advance(3600000);const a=await f.create(),b=await f.create();assert.equal(a.body.item.id,b.body.item.id);assert.equal(b.body.reused,true);await f.finish(a.body.item,2000);const r=await f.sync(a.body.item.id);assert.equal(r.body.runtimeHours,5601/3600);}finally{f.close();}});
for(const change of ['replacement','runtime','delete-base'])test(`history ${change} during query rejects append without clobbering that edit`,async()=>{const f=await setup();try{await f.seed();f.advance(3600000);const a=await f.create();await f.finish(a.body.item,1800);
 if(change==='replacement')f.sqlite.prepare('UPDATE blower_history_assets SET last_replacement_at=?,cycle_runtime_revision=? WHERE tag_number=?').run(new Date(Date.now()-120000).toISOString(),'changed',f.tag);
 else if(change==='runtime')f.sqlite.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=9,cycle_runtime_revision=? WHERE tag_number=?').run('changed',f.tag);
 else f.sqlite.prepare('DELETE FROM blower_history_events WHERE tag_number=?').run(f.tag);
 const before=f.read();const saved=await f.sync(a.body.item.id);assert.equal(saved.status,409,JSON.stringify(saved.body));assert.deepEqual(f.read(),before);assert.equal(f.events().some(e=>e.source_log_id===a.body.item.id),false);
 }finally{f.close();}});
test('RUN boundary disagreement is not silently added',async()=>{const f=await setup();try{await f.seed();f.advance(3600000);const a=await f.create();await f.finish(a.body.item,1,'stopped','running');const before=f.read();const r=await f.sync(a.body.item.id);assert.equal(r.body.code,'DATAPARC_APPEND_BOUNDARY_CHANGED');assert.deepEqual(f.read(),before);}finally{f.close();}});
test('missing append receipt fails closed instead of overwriting cumulative with a delta',async()=>{const f=await setup();try{await f.seed();f.advance(3600000);const a=await f.create();await f.finish(a.body.item,1800);f.sqlite.prepare('DELETE FROM blower_runtime_append_v1 WHERE request_id=?').run(a.body.item.id);const before=f.read();const r=await f.sync(a.body.item.id);assert.equal(r.body.code,'DATAPARC_APPEND_INTENT_MISSING');assert.deepEqual(f.read(),before);}finally{f.close();}});
test('detail full requery still replaces coverage intentionally; it never adds to previous cumulative',async()=>{const f=await setup();try{await f.seed();f.advance(3600000);const q=await f.create({incrementalRefresh:false,unifiedRefresh:false,startAt:f.startAt});assert.equal(Date.parse(q.body.item.probe.startAt),Date.parse(f.startAt));await f.finish(q.body.item,300);const r=await f.sync(q.body.item.id);assert.equal(r.body.runtimeHours,300/3600);assert.equal(r.body.incremental,undefined);}finally{f.close();}});
test('changed signal cannot borrow an old signal total',async()=>{const f=await setup();try{await f.seed();f.advance(3600000);const q=await f.create({dataParcTag:'GSPOGE.ABB_DCS.TEST_ONLY_NEW_BINARY'});assert.equal(q.status,201);assert.equal(Date.parse(q.body.item.probe.startAt),Date.parse(f.startAt));assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='blower_runtime_append_v1'").get().n,0);}finally{f.close();}});
for(const attr of ['cycle_start_revision','cycle_started_at','cycle_runtime_anchor_at','cycle_runtime_state'])test(`incompatible ${attr} is not a verified append owner`,async()=>{const f=await setup(TAGS[0],false);try{await f.seed();const a=f.read();const changed={...a,[attr]:attr.endsWith('_at')?new Date(Date.now()+1000).toISOString():attr==='cycle_runtime_state'?'stopped':'changed'};assert.equal(verifiedAppendBase(changed,f.events(),f.signal),null);}finally{f.close();}});
test('manual value equal to prior DataPARC does not count as DataPARC provenance',async()=>{const f=await setup();try{await f.seed();const a=f.read(),rows=f.events();const manual={...rows[0],id:'manual',source_type:'manual',updated_at:new Date(Date.now()+1000).toISOString()};assert.equal(verifiedAppendBase(a,[...rows,manual],f.signal),null);}finally{f.close();}});
test('two browsers querying the same predecessor cannot add twice',async()=>{const f=await setup();try{await f.seed();f.advance(3600000);addBrowserIdentity(f.sqlite,{token:'other-token',employeeNo:'other-owner',name:'Other'});const a=await f.create(),b=await f.create({},'other-token');assert.notEqual(a.body.item.id,b.body.item.id);
 // Queue order is per requested time + ID; finish whichever the Agent owns first.
 for(let i=0;i<2;i++){const claim=await agentClaim(f.database);const item=claim.body.items.excel,seconds=1800,startState='running',endState='running';const raw={...item.probe,ok:true,observedAt:item.probe.endAt,collectedAt:new Date().toISOString(),completedChunkCount:1,startState,endState,runningSeconds:seconds,totalRunningHours:0.5,chunks:[{index:1,startAt:item.probe.startAt,endAt:item.probe.endAt,startState,endState,runningSeconds:seconds,totalRunningHours:0.5}]};const done=await agentComplete(f.database,item.id,agent.normalizeResult(raw,agent.parseClaim(item)));assert.equal(done.status,200);}
 const first=await f.sync(a.body.item.id);assert.equal(first.status,200,JSON.stringify(first.body));const row=f.read();const second=await f.sync(b.body.item.id,'other-token');assert.equal(second.status,409);assert.deepEqual(f.read(),row);assert.equal(row.cycle_runtime_hours,5401/3600);
 }finally{f.close();}});
test('combined coverage can exceed 366 days while the appended interval stays within the existing query limit',async()=>{const f=await setup();try{await f.seed();const a=f.read(),row=f.events()[0],src=JSON.parse(row.source_text);const old=new Date(Date.now()-400*86400000).toISOString();src.startAt=old;src.expectedLastReplacementAt=old;f.sqlite.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run(old,f.tag);f.sqlite.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(src),row.id);f.advance(86400000);const q=await f.create({expectedLastReplacementAt:old,startAt:old});assert.equal(q.status,201,JSON.stringify(q.body));assert.equal(Date.parse(q.body.item.probe.startAt),Date.parse(a.cycle_runtime_anchor_at));await f.finish(q.body.item,800);const r=await f.sync(q.body.item.id);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.runtimeHours,4401/3600);}finally{f.close();}});
test('append wire revision prevents an older history deployment from treating delta as a complete total',async()=>{const f=await setup();try{await f.seed();f.advance(3600000);const a=f.read(),q=await f.create();assert.equal(q.body.item.probe.expectedCycleRuntimeRevision,`append-v1:${a.cycle_runtime_revision}`);assert.notEqual(q.body.item.probe.expectedCycleRuntimeRevision,a.cycle_runtime_revision);await f.finish(q.body.item,1000);const r=await f.sync(q.body.item.id);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.runtimeHours,4601/3600);}finally{f.close();}});
test('event-write error rolls back cumulative hours and checkpoint; same completed request can then apply once',async()=>{const f=await setup();try{await f.seed();f.advance(3600000);const q=await f.create();await f.finish(q.body.item,1800);const before=f.read(),events=f.events();f.sqlite.exec(`CREATE TRIGGER block_append BEFORE INSERT ON blower_history_events WHEN NEW.source_log_id='${q.body.item.id}' BEGIN SELECT RAISE(ABORT,'test write failure'); END;`);const r=await f.sync(q.body.item.id);assert.ok(r.status>=400);assert.deepEqual(f.read(),before);assert.deepEqual(f.events(),events);f.sqlite.exec('DROP TRIGGER block_append');const retry=await f.sync(q.body.item.id);assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal(retry.body.runtimeHours,5401/3600);}finally{f.close();}});
