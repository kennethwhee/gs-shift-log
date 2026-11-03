import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
import { reconcileApprovedReplacementLog, replacementAutoCycleProof, isReplacementAutoRevision } from '../functions/_shared/blower-replacement-auto-v3.js';

const USER={employeeNo:'auto-v3',name:'Automatic approved work-log reflection'};
const NOW=new Date('2026-11-03T12:00:00.000Z');
const OLD='2026-07-01T00:00:00+09:00';
const ROW={id:'approved-log',work_date:'2026-08-03',status:'결재완료',sourceAliases:['POCHEON#20260803#DAY#BO1','39111'],source_snapshot:'original-approved-snapshot'};
const TAG='104HHL10AN611';
function d1() {
  const sqlite=new DatabaseSync(':memory:');
  const db={sqlite,beforeBatch:null,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},
    async first(){return sqlite.prepare(sql).get(...this.values) || null;},
    async all(){return {results:sqlite.prepare(sql).all(...this.values)};},
    async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...this.values).changes)}};}};},
    async batch(statements){if(db.beforeBatch){const hook=db.beforeBatch;db.beforeBatch=null;hook(sqlite);}sqlite.exec('BEGIN');
      try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}
      catch(error){sqlite.exec('ROLLBACK');throw error;}}};return db;
}
async function fixture(tag=TAG) {
  const db=d1();await api.ensureSchema(db);const sql=db.sqlite;
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,
    cycle_start_revision='start-old',cycle_runtime_revision='runtime-old',cycle_runtime_hours=12.5,runtime_hours=12.5,
    cycle_runtime_anchor_at='2026-11-03T00:00:00Z',cycle_runtime_state='running',runtime_anchor_at='2026-11-03T00:00:00Z',is_running=1 WHERE tag_number=?`).run(OLD,tag);
  const asset=target=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(target || tag);
  const events=target=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY event_date DESC,id DESC').all(target || tag);
  const addEvent=(patch={})=>{const event={id:'old-replacement',tag_number:tag,event_type:'replacement',event_date:OLD,runtime_hours:6,
    issue_type:'',action_type:'교체',note:'',source_type:'manual',source_log_id:'',source_text:'registered prior replacement',created_by_id:'prior',created_by_name:'Prior',created_at:OLD,updated_at:OLD,...patch};
    const keys=Object.keys(event);sql.prepare(`INSERT INTO blower_history_events(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(event));return event;};
  const fact=(patch={})=>({tagNumber:tag,eventDate:'2026-08-03T09:58:00+09:00',recordDate:'2026-08-03',timePrecision:'minute',
    sourceText:'09:58 Seal Pot Blower #A V-Belt 교체 완료 현재 Stand-by 상태',sourceKey:'entry-d5944210-8b76-43ba-a3ab-45bcc55ed93c',...patch});
  const apply=(facts=[fact()],row=ROW,options={})=>reconcileApprovedReplacementLog(db,USER,row,facts,{now:NOW,...options});
  return {db,sql,asset,events,addEvent,fact,apply};
}

test('approved Seal Pot 1A actual 09:58 completion upgrades the imported date-only basis and resets the new belt cycle',async()=>{
  const f=await fixture();const midnight='2026-08-03T00:00:00+09:00';
  f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run(midnight,TAG);
  f.addEvent({id:'v13:104HHL10AN611|2026-08-03',event_date:midnight,source_type:'shift_log_history_v13',source_log_id:'3c2e6847-2672-449d-b5d7-11d0584219d4',source_text:'A V-Belt 교체 완료'});
  const old={...f.asset()};const out=await f.apply();assert.equal(out.corrected,1);assert.equal(out.applied,0);
  const asset=f.asset(),event=f.events()[0];assert.equal(asset.last_replacement_at,'2026-08-03T00:58:00.000Z');
  assert.equal(asset.cycle_runtime_hours,0);assert.equal(asset.runtime_hours,0);assert.equal(asset.cycle_start_state,'pending');assert.equal(asset.cycle_started_at,null);
  assert.notEqual(asset.cycle_start_revision,old.cycle_start_revision);assert.match(asset.cycle_start_revision,/^replacement-auto-v3:/);assert.equal(isReplacementAutoRevision(asset),true);assert.notEqual(asset.cycle_runtime_revision,old.cycle_runtime_revision);
  assert.equal(event.id,'v13:104HHL10AN611|2026-08-03');assert.equal(event.runtime_hours,6);assert.match(event.source_text,/09:58/);
  const proof=replacementAutoCycleProof(asset,f.events());assert.equal(proof.freshQueryEligible,true);assert.equal(proof.clockKnown,true);
  assert.equal(proof.requiredStartAt,'2026-08-03T00:58:00.000Z');assert.equal(proof.storedRuntimeHours,0);assert.equal(proof.storedLegacyRuntimeHours,0);assert.equal(proof.cycleStartRevision,asset.cycle_start_revision);assert.equal(proof.cycleRuntimeRevision,asset.cycle_runtime_revision);
  const audit=f.sql.prepare('SELECT * FROM blower_history_asset_history').get();assert.equal(JSON.parse(audit.before_json).asset.cycle_runtime_hours,12.5);
  assert.equal(JSON.parse(audit.after_json).asset.cycle_runtime_hours,0);assert.match(audit.before_json,/3c2e6847/);
});

test('new approved minute replacement applies the same reset and old-belt event counter to every registered Blower',async()=>{
  const f=await fixture();const assets=f.sql.prepare('SELECT * FROM blower_history_assets WHERE enabled=1 ORDER BY tag_number').all();assert.equal(assets.length,27);
  for(const [index,item] of assets.entries()) {
    f.sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_runtime_hours=?,runtime_hours=?,cycle_start_revision=?,cycle_runtime_revision=? WHERE tag_number=?`)
      .run(OLD,index+1.25,index+1.25,`s${index}`,`r${index}`,item.tag_number);
    const out=await f.apply([f.fact({tagNumber:item.tag_number})]);assert.equal(out.applied,1,item.tag_number);
    const asset=f.asset(item.tag_number),event=f.events(item.tag_number).find(event=>event.event_type==='replacement');
    assert.equal(asset.cycle_runtime_hours,0,item.tag_number);assert.equal(event.runtime_hours,index+1.25,item.tag_number);
    assert.equal(asset.cycle_start_state,'pending',item.tag_number);assert.equal(replacementAutoCycleProof(asset,f.events(item.tag_number)).freshQueryEligible,true,item.tag_number);
  }
});

test('date-only completed fact is automatically recorded and reset without claiming an actual midnight or permitting a midnight RUN query',async()=>{
  const f=await fixture();const out=await f.apply([f.fact({timePrecision:'day',eventDate:'',sourceText:'V-Belt 교체 완료 (시각 미기록)'})]);assert.equal(out.applied,1);
  const asset=f.asset(),event=f.events()[0],source=JSON.parse(event.source_text);assert.equal(source.timePrecision,'day');assert.match(event.note,/날짜 정렬용/);
  assert.equal(asset.cycle_runtime_hours,0);assert.equal(asset.cycle_start_state,'pending');const proof=replacementAutoCycleProof(asset,f.events());
  assert.equal(proof.clockKnown,false);assert.equal(proof.requiredStartAt,'');assert.equal(proof.freshQueryEligible,false);assert.equal(proof.requiresRunRefresh,true);
});

test('same-day already registered manual date and a date-only completion link without erasing a valid tracked window',async()=>{
  const f=await fixture(),date='2026-08-03T00:00:00+09:00';f.addEvent({event_date:date});f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run(date,TAG);
  const before=JSON.stringify(f.asset());const out=await f.apply([f.fact({timePrecision:'day',eventDate:''})]);assert.equal(out.linked,1);assert.equal(JSON.stringify(f.asset()),before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,1);
  assert.equal(out.confirmed,1);const confirmation=f.events().find(event=>event.event_type==='cycle_source_reconcile');assert.match(JSON.parse(confirmation.source_text).sourceText,/V-Belt/);
  const all=JSON.stringify([f.asset(),f.events()]);await f.apply([f.fact({timePrecision:'day',eventDate:''})]);assert.equal(JSON.stringify([f.asset(),f.events()]),all);
});

test('same source and exact completion retry is idempotent after a subsequent valid runtime update',async()=>{
  const f=await fixture();await f.apply();const replacement=f.events()[0];
  f.sql.prepare(`UPDATE blower_history_assets SET cycle_runtime_hours=2,runtime_hours=2,cycle_runtime_revision='runtime-measured',cycle_start_state='started',cycle_started_at=? WHERE tag_number=?`).run('2026-08-03T01:00:00Z',TAG);
  const before=JSON.stringify(f.asset()),count=f.events().length;const out=await f.apply();assert.equal(out.linked,1);assert.equal(JSON.stringify(f.asset()),before);assert.equal(f.events().length,count);
  assert.equal(f.events()[0].id,replacement.id);assert.equal(replacementAutoCycleProof(f.asset(),f.events()).freshQueryEligible,false);
});

test('cross-role duplicate exact completion links to the existing event and never resets twice',async()=>{
  const f=await fixture();await f.apply();const before=JSON.stringify(f.asset());const out=await f.apply([f.fact()],{...ROW,id:'other-role-approved',sourceAliases:[]});
  assert.equal(out.linked,1);assert.equal(JSON.stringify(f.asset()),before);assert.equal(out.confirmed,1);assert.equal(f.events().length,2);
  const rows=JSON.stringify(f.events());await f.apply([f.fact()],{...ROW,id:'other-role-approved',sourceAliases:[]});assert.equal(JSON.stringify(f.events()),rows);
});

test('older completed replacement is history only and cannot replace the newer active belt or copy its counter into history',async()=>{
  const f=await fixture();f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run('2026-09-01T09:00:00+09:00',TAG);
  const before=JSON.stringify(f.asset());const out=await f.apply();assert.equal(out.historical,1);assert.equal(JSON.stringify(f.asset()),before);assert.equal(f.events()[0].runtime_hours,0);
  assert.equal(JSON.parse(f.events()[0].source_text).runtimeAtReplacementKnown,false);assert.equal(replacementAutoCycleProof(f.asset(),f.events()),null);
});

test('wrong FBHE B target is retracted, C completion applies, and B rebuilds from the prior registered 8/27 basis without reusing old RUN hours',async()=>{
  const B='204HHL60AP621',C='204HHL60AP631',f=await fixture(B),prior='2026-08-27T00:00:00+09:00',wrong='2026-09-16T09:23:00+09:00';
  f.addEvent({id:'manual-8-27',event_date:prior});f.addEvent({id:'wrong-B',event_date:wrong,source_type:'shift_log_auto',source_log_id:'legacy-POCHEON#20260916#DAY#BO2',source_text:'V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)'});
  f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=?,cycle_runtime_hours=1060.2,runtime_hours=1060.2 WHERE tag_number=?').run(wrong,B);
  const row={...ROW,id:'legacy-POCHEON#20260916#DAY#BO2',work_date:'2026-09-16',sourceAliases:['40040','POCHEON#20260916#DAY#BO2']};
  const out=await f.apply([f.fact({tagNumber:C,eventDate:'2026-09-16T09:23:00+09:00',recordDate:'2026-09-16',sourceText:'09:23 FBHE Blower #C V-Belt 전체 교체 실시 - C정지/B기동'})],row);
  assert.equal(out.retracted,1);assert.equal(out.applied,1);const b=f.asset(B);assert.equal(b.last_replacement_at,prior);assert.equal(b.cycle_runtime_hours,0);assert.equal(b.cycle_start_state,'pending');
  assert.equal(f.events(B).find(event=>event.id==='wrong-B').event_type,'_retracted_replacement');assert.equal(f.events(B).find(event=>event.id==='manual-8-27').source_type,'manual');
  const proof=replacementAutoCycleProof(b,f.events(B));assert.equal(proof.registeredBaseline,true);assert.equal(proof.clockKnown,false);assert.equal(proof.freshQueryEligible,true);assert.equal(proof.requiredStartAt,prior);
  assert.equal(f.asset(C).last_replacement_at,'2026-09-16T00:23:00.000Z');assert.equal(f.asset(C).cycle_runtime_hours,0);
  const after=JSON.stringify([f.asset(B),f.asset(C),f.events(B),f.events(C)]);const retry=await f.apply([f.fact({tagNumber:C,eventDate:'2026-09-16T09:23:00+09:00',recordDate:'2026-09-16'})],row);
  assert.equal(retry.retracted,0);assert.equal(JSON.stringify([f.asset(B),f.asset(C),f.events(B),f.events(C)]),after);
});

test('unperformed Silo B source retracts a false automatic replacement with no invented prior replacement date',async()=>{
  const f=await fixture('104ETH03AN602'),wrong='2026-05-04T00:00:00+09:00';f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run(wrong,'104ETH03AN602');
  f.addEvent({id:'v13:104ETH03AN602|2026-05-04',event_date:wrong,source_type:'shift_log_history_v13',source_log_id:'38159',source_text:'교체 하려했지만 미실시 / 다른 환기팬 Belt 교체 완료'});
  const out=await f.apply([],{...ROW,id:'legacy-POCHEON#20260504#DAY#BCO1',work_date:'2026-05-04',sourceAliases:['38159','POCHEON#20260504#DAY#BCO1']});
  assert.equal(out.retracted,1);assert.equal(f.asset().last_replacement_at,null);assert.equal(f.asset().cycle_runtime_hours,0);assert.equal(replacementAutoCycleProof(f.asset(),f.events()).freshQueryEligible,false);
  assert.equal(f.events().find(event=>event.id==='v13:104ETH03AN602|2026-05-04').source_text,'교체 하려했지만 미실시 / 다른 환기팬 Belt 교체 완료');
});

test('a newer current replacement remains unchanged when an older wrong automatic source is retracted',async()=>{
  const f=await fixture();f.addEvent({id:'wrong-old',event_date:'2026-06-01T00:00:00+09:00',source_type:'shift_log_auto',source_log_id:ROW.id});
  f.addEvent({id:'newer-manual',event_date:OLD});const before=JSON.stringify(f.asset());const out=await f.apply([]);assert.equal(out.retracted,1);assert.equal(JSON.stringify(f.asset()),before);
});

test('manual events are never retracted even if their source id matches the reinterpreted approved source',async()=>{
  const f=await fixture();f.addEvent({source_log_id:ROW.id});const before=JSON.stringify([f.asset(),f.events()]);const out=await f.apply([]);assert.equal(out.retracted,0);assert.equal(JSON.stringify([f.asset(),f.events()]),before);
});

test('stale cycle revision atomically refuses replacement event, reset, and audit',async()=>{
  const f=await fixture();f.db.beforeBatch=sql=>sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='concurrent-runtime',cycle_runtime_hours=30 WHERE tag_number=?").run(TAG);
  const out=await f.apply();assert.equal(out.ok,false);assert.equal(out.code,'REPLACEMENT_AUTO_CYCLE_CONFLICT');assert.equal(f.asset().cycle_runtime_hours,30);assert.equal(f.asset().last_replacement_at,OLD);
  assert.equal(f.events().length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,0);
});

test('a concurrently inserted manual event invalidates the whole-tag history CAS',async()=>{
  const f=await fixture();f.db.beforeBatch=()=>f.addEvent({id:'concurrent-manual'});const out=await f.apply();assert.equal(out.ok,false);assert.equal(f.asset().last_replacement_at,OLD);
  assert.equal(f.events().length,1);assert.equal(f.events()[0].id,'concurrent-manual');
});

test('source snapshot and approval status are checked inside the same atomic batch',async()=>{
  const f=await fixture();f.sql.exec("CREATE TABLE test_source(id TEXT PRIMARY KEY,status TEXT,snapshot TEXT)");f.sql.prepare('INSERT INTO test_source VALUES(?,?,?)').run(ROW.id,ROW.status,ROW.source_snapshot);
  f.db.beforeBatch=sql=>sql.prepare("UPDATE test_source SET status='작성중',snapshot='edited' WHERE id=?").run(ROW.id);
  const sourceGuard={sql:'EXISTS(SELECT 1 FROM test_source WHERE id=? AND status=? AND snapshot=?)',values:[ROW.id,ROW.status,ROW.source_snapshot]};
  const out=await f.apply([f.fact()],ROW,{sourceGuard});assert.equal(out.ok,false);assert.equal(f.asset().last_replacement_at,OLD);assert.equal(f.events().length,0);
});

test('event insertion failure rolls back the new cycle counter and audit',async()=>{
  const f=await fixture();f.sql.exec("CREATE TRIGGER refuse_auto BEFORE INSERT ON blower_history_events WHEN NEW.source_type='shift_log_auto_v3' BEGIN SELECT RAISE(ABORT,'forced event failure'); END");
  const before=JSON.stringify(f.asset());await assert.rejects(f.apply(),/forced event failure/);assert.equal(JSON.stringify(f.asset()),before);assert.equal(f.events().length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,0);
});

test('pending old-cycle query records remain intact but their expected revisions lose ownership after automatic replacement',async()=>{
  const f=await fixture();f.sql.exec('CREATE TABLE old_query(id TEXT,expected_start TEXT,expected_runtime TEXT,status TEXT)');f.sql.prepare('INSERT INTO old_query VALUES(?,?,?,?)').run('old-request','start-old','runtime-old','pending');
  await f.apply();const request=f.sql.prepare('SELECT * FROM old_query').get();assert.equal(request.status,'pending');assert.notEqual(request.expected_start,f.asset().cycle_start_revision);assert.notEqual(request.expected_runtime,f.asset().cycle_runtime_revision);
});

test('unapproved sources and malformed fact timestamps cannot mutate a cycle',async()=>{
  const f=await fixture();const before=JSON.stringify(f.asset());const denied=await f.apply([f.fact()],{...ROW,status:'작성중'});assert.equal(denied.ok,false);
  const malformed=await f.apply([f.fact({eventDate:'2026-08-03T09:58:00'})]);assert.equal(malformed.ok,false);assert.equal(JSON.stringify(f.asset()),before);assert.equal(f.events().length,0);
});

test('source JSON stays parseable within 2,000 characters and preserves a full-source SHA-256',async()=>{
  const f=await fixture();await f.apply([f.fact({sourceText:'교체 완료'.repeat(1000)})]);const event=f.events()[0];assert.ok(event.source_text.length<=2000);assert.match(JSON.parse(event.source_text).sourceSnapshotSha256,/^[a-f0-9]{64}$/);
});

test('edited approved source completion time corrects its existing automatic event once and preserves the prior version in audit',async()=>{
  const f=await fixture();await f.apply([f.fact({eventDate:'2026-08-03T09:30:00+09:00'})]);const id=f.events()[0].id;
  f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_hours=3,runtime_hours=3,cycle_runtime_revision='measured-old-boundary' WHERE tag_number=?").run(TAG);
  const edited={...ROW,source_snapshot:'edited-approved-completion-time'};const out=await f.apply([f.fact()],edited);assert.equal(out.corrected,1);
  assert.equal(f.events().length,1);assert.equal(f.events()[0].id,id);assert.equal(f.asset().last_replacement_at,'2026-08-03T00:58:00.000Z');assert.equal(f.asset().cycle_runtime_hours,0);
  assert.equal(replacementAutoCycleProof(f.asset(),f.events()).freshQueryEligible,true);const after=JSON.stringify(f.asset());await f.apply([f.fact()],edited);assert.equal(JSON.stringify(f.asset()),after);
});

test('a changed approved source may restore a formerly retracted fact without destroying the retraction audit',async()=>{
  const f=await fixture();await f.apply();const original=f.events()[0].id;await f.apply([],{...ROW,source_snapshot:'completion removed'});
  assert.equal(f.events().find(event=>event.id===original).event_type,'_retracted_replacement');
  const out=await f.apply([f.fact()],{...ROW,source_snapshot:'completion reconfirmed'});assert.equal(out.applied,1);assert.notEqual(f.events().find(event=>event.event_type==='replacement').id,original);
  assert.equal(f.events().find(event=>event.id===original).event_type,'_retracted_replacement');
});

test('future or invalid-calendar replacement facts are refused before any reset',async()=>{
  const f=await fixture();const before=JSON.stringify(f.asset());const future=await f.apply([f.fact({eventDate:'2027-08-03T09:58:00+09:00'})]);assert.equal(future.ok,false);
  const invalid=await f.apply([f.fact({recordDate:'2026-02-31',eventDate:'',timePrecision:'day'})]);assert.equal(invalid.ok,false);assert.equal(JSON.stringify(f.asset()),before);
});

test('an exact approved completion already in event history repairs a stale older asset basis once instead of linking forever',async()=>{
  const f=await fixture();const date='2026-08-03T09:58:00+09:00';f.addEvent({id:'existing-exact-completion',event_date:date,source_type:'shift_log_auto',source_log_id:ROW.id,source_text:'09:58 V-Belt 교체 완료'});
  const out=await f.apply();assert.equal(out.corrected,1);assert.equal(out.linked,1);assert.equal(f.asset().last_replacement_at,date);assert.equal(f.asset().cycle_runtime_hours,0);
  assert.equal(f.events().find(event=>event.id==='existing-exact-completion').runtime_hours,6);assert.equal(replacementAutoCycleProof(f.asset(),f.events()).freshQueryEligible,true);
  const before=JSON.stringify([f.asset(),f.events()]);const replay=await f.apply();assert.equal(replay.corrected,0);assert.equal(JSON.stringify([f.asset(),f.events()]),before);
});

test('an edited approved source that removes its clock revokes the old exact-time proof while preserving valid tracked hours',async()=>{
  const f=await fixture();await f.apply();f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_hours=2,runtime_hours=2,cycle_runtime_revision='measured-range' WHERE tag_number=?").run(TAG);
  const before={...f.asset()};const out=await f.apply([f.fact({timePrecision:'day',eventDate:'',sourceText:'V-Belt 교체 완료 · 시각 미기록'})],{...ROW,source_snapshot:'clock removed from approved original'});
  assert.equal(out.corrected,1);assert.equal(f.asset().cycle_runtime_hours,2);assert.equal(f.asset().cycle_runtime_revision,before.cycle_runtime_revision);
  const proof=replacementAutoCycleProof(f.asset(),f.events());assert.equal(proof.clockKnown,false);assert.equal(proof.freshQueryEligible,false);assert.equal(proof.requiredStartAt,'');
  const source=JSON.parse(f.events()[0].source_text);assert.equal(source.timePrecision,'day');assert.equal(source.recordedTimeRetainedForAuditOnly,true);assert.match(f.events()[0].note,/기존 측정 구간 보존/);
});

test('removing one completed source fragment retracts only that fact even when the same approved log still contains another replacement',async()=>{
  const f=await fixture();const first=f.fact({sourceKey:'entry-first'}),second=f.fact({sourceKey:'entry-second',eventDate:'2026-08-03T13:58:00+09:00'});
  await f.apply([first,second]);const removed=f.events().find(event=>event.event_date==='2026-08-03T04:58:00.000Z');
  const out=await f.apply([first],{...ROW,source_snapshot:'only first completion remains'});assert.equal(out.retracted,1);assert.equal(f.events().find(event=>event.id===removed.id).event_type,'_retracted_replacement');
  assert.equal(f.asset().last_replacement_at,'2026-08-03T00:58:00.000Z');assert.equal(f.asset().cycle_runtime_hours,0);assert.equal(replacementAutoCycleProof(f.asset(),f.events()).freshQueryEligible,true);
});

test('an unrelated same-day automatic date-only completion is not overwritten as an imported placeholder',async()=>{
  const f=await fixture();await f.apply([f.fact({timePrecision:'day',eventDate:'',sourceKey:'first-completion'})]);
  const first=f.events()[0];await f.apply([f.fact({sourceKey:'second-completion'})],{...ROW,id:'different-actual-work',sourceAliases:[],source_snapshot:'different work source'});
  const events=f.events().filter(event=>event.event_type==='replacement');assert.equal(events.length,2);assert.equal(events.find(event=>event.id===first.id).event_date,first.event_date);
});

test('reconfirmation of the same previously applied clock restores its precision without resetting measured hours again',async()=>{
  const f=await fixture();await f.apply();f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_hours=2,runtime_hours=2,cycle_runtime_revision='measured-range' WHERE tag_number=?").run(TAG);
  await f.apply([f.fact({timePrecision:'day',eventDate:''})],{...ROW,source_snapshot:'clock removed'});const before=JSON.stringify(f.asset());
  await f.apply([f.fact()],{...ROW,source_snapshot:'same clock reconfirmed'});assert.equal(JSON.stringify(f.asset()),before);const proof=replacementAutoCycleProof(f.asset(),f.events());
  assert.equal(proof.clockKnown,true);assert.equal(proof.freshQueryEligible,false);assert.equal(f.asset().cycle_runtime_hours,2);
});

test('stable source keys longer than 150 characters remain intact across measured-hour retries and later clock revocation',async()=>{
  const f=await fixture(),key=JSON.stringify(['approved-log',TAG,'entry-'.repeat(40),12]);assert.ok(key.length>150 && key.length<512);
  await f.apply([f.fact({sourceKey:key})]);assert.equal(JSON.parse(f.events()[0].source_text).sourceKey,key);
  f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_hours=2,runtime_hours=2,cycle_runtime_revision='measured-long-key' WHERE tag_number=?").run(TAG);
  const before=JSON.stringify(f.asset());const retry=await f.apply([f.fact({sourceKey:key,sourceText:'동일 09:58 교체 완료 · 별도 업무 문구 수정'})],{...ROW,source_snapshot:'other source text edited'});
  assert.equal(retry.retracted,0);assert.equal(retry.linked,1);assert.equal(JSON.stringify(f.asset()),before);
  const revoke=await f.apply([f.fact({sourceKey:key,timePrecision:'day',eventDate:'',sourceText:'교체 완료 · 시각 삭제'})],{...ROW,source_snapshot:'clock deleted after other edit'});
  assert.equal(revoke.corrected,1);assert.equal(revoke.retracted,0);assert.equal(f.asset().cycle_runtime_hours,2);assert.equal(replacementAutoCycleProof(f.asset(),f.events()).clockKnown,false);
  assert.equal(JSON.parse(f.events()[0].source_text).sourceKey,key);
});

test('unchanged day-only completion with a long stable key never resets on unrelated source text edits',async()=>{
  const f=await fixture(),key='stable-entry-'.repeat(25);await f.apply([f.fact({sourceKey:key,timePrecision:'day',eventDate:''})]);const before=JSON.stringify(f.asset());
  const out=await f.apply([f.fact({sourceKey:key,timePrecision:'day',eventDate:'',sourceText:'교체 완료 · 다른 업무 추가'})],{...ROW,source_snapshot:'another work item changed'});
  assert.equal(out.retracted,0);assert.equal(out.linked,1);assert.equal(out.confirmed,1);assert.equal(JSON.stringify(f.asset()),before);assert.equal(f.events().filter(event=>event.event_type==='replacement').length,1);
});

test('an oversized source key is rejected rather than silently changing a fact identity',async()=>{
  const f=await fixture();const before=JSON.stringify(f.asset());const out=await f.apply([f.fact({sourceKey:'x'.repeat(513)})]);assert.equal(out.ok,false);assert.equal(out.code,'REPLACEMENT_FACT_INVALID');assert.equal(JSON.stringify(f.asset()),before);assert.equal(f.events().length,0);
});

test('a V13 midnight date-only confirmation is durable approved-source evidence and cannot certify a full RUN clock',async()=>{
  const f=await fixture(),date='2026-08-03T00:00:00+09:00';f.addEvent({event_date:date,source_type:'shift_log_history_v13',source_log_id:'imported-other-role'});
  f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run(date,TAG);const before=JSON.stringify(f.asset());
  const out=await f.apply([f.fact({timePrecision:'day',eventDate:'',sourceText:'Seal Pot #A V-Belt 교체 완료 · 시각 미기록'})]);assert.equal(out.confirmed,1);assert.equal(JSON.stringify(f.asset()),before);
  const confirmation=f.events().find(event=>event.event_type==='cycle_source_reconcile'),metadata=JSON.parse(confirmation.source_text);
  assert.equal(metadata.confirmationOnly,true);assert.equal(metadata.replacementEventId,'old-replacement');assert.match(metadata.sourceText,/V-Belt 교체 완료/);assert.equal(metadata.sourcePhysicalId,ROW.sourceAliases[0]);
  const proof=replacementAutoCycleProof(f.asset(),f.events());assert.equal(proof.clockKnown,false);assert.equal(proof.registeredBaseline,false);assert.equal(proof.freshQueryEligible,false);assert.equal(proof.storedRuntimeHours,12.5);
  const audit=f.sql.prepare('SELECT * FROM blower_history_asset_history').get();assert.equal(JSON.parse(audit.before_json).events[0].id,'old-replacement');assert.equal(JSON.parse(audit.after_json).asset.cycle_runtime_hours,12.5);
});

test('existing current manual cycles receive audited confirmation for all 27 Blowers without resetting any stored counter or revision',async()=>{
  const f=await fixture(),date='2026-08-03T00:00:00+09:00',assets=f.sql.prepare('SELECT * FROM blower_history_assets WHERE enabled=1 ORDER BY tag_number').all();
  for(const [index,asset] of assets.entries()) {
    f.sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_runtime_hours=?,runtime_hours=?,cycle_start_revision=?,cycle_runtime_revision=? WHERE tag_number=?`)
      .run(date,index+0.5,index+0.5,`registered-start-${index}`,`registered-runtime-${index}`,asset.tag_number);
    f.addEvent({id:`registered-manual-${index}`,tag_number:asset.tag_number,event_date:date});const before=JSON.stringify(f.asset(asset.tag_number));
    const out=await f.apply([f.fact({tagNumber:asset.tag_number,timePrecision:'day',eventDate:''})]);assert.equal(out.confirmed,1,asset.tag_number);assert.equal(JSON.stringify(f.asset(asset.tag_number)),before,asset.tag_number);
    const confirmation=f.events(asset.tag_number).find(event=>event.event_type==='cycle_source_reconcile');assert.equal(JSON.parse(confirmation.source_text).confirmationOnly,true,asset.tag_number);
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,27);
});

test('a failed confirmation write leaves the existing manual cycle and history untouched',async()=>{
  const f=await fixture(),date='2026-08-03T00:00:00+09:00';f.addEvent({event_date:date});f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run(date,TAG);
  f.sql.exec("CREATE TRIGGER refuse_confirmation BEFORE INSERT ON blower_history_events WHEN NEW.event_type='cycle_source_reconcile' BEGIN SELECT RAISE(ABORT,'forced confirmation failure'); END");
  const before=JSON.stringify([f.asset(),f.events()]);await assert.rejects(f.apply([f.fact({timePrecision:'day',eventDate:''})]),/forced confirmation failure/);assert.equal(JSON.stringify([f.asset(),f.events()]),before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,0);
});

test('confirmation alone never grants an existing midnight manual cycle a new full-RUN certificate',async()=>{
  const f=await fixture(),date='2026-08-03T00:00:00+09:00';f.addEvent({event_date:date});f.sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='pending',cycle_runtime_hours=0,runtime_hours=0 WHERE tag_number=?`).run(date,TAG);
  const out=await f.apply([f.fact({timePrecision:'day',eventDate:''})]);assert.equal(out.confirmed,1);const proof=replacementAutoCycleProof(f.asset(),f.events());assert.equal(proof.confirmationOnly,true);
  assert.equal(proof.registeredBaseline,true);assert.equal(proof.clockKnown,false);assert.equal(proof.freshQueryEligible,false);assert.equal(proof.requiresRunRefresh,false);
});

test('cross-role evidence confirmation preserves the separately proven fresh reset entitlement',async()=>{
  const f=await fixture();await f.apply();const before=JSON.stringify(f.asset());await f.apply([f.fact()],{...ROW,id:'different-approved-role',sourceAliases:[]});
  assert.equal(JSON.stringify(f.asset()),before);const proof=replacementAutoCycleProof(f.asset(),f.events());assert.equal(proof.freshQueryEligible,true);assert.equal(proof.storedRuntimeHours,0);assert.equal(proof.storedLegacyRuntimeHours,0);
});

test('retracting a wrong automatic duplicate preserves the independent current manual basis and measured counter on all 27 Blowers',async()=>{
  const f=await fixture(),date='2026-09-04T00:00:00+09:00',sameInstant='2026-09-03T15:00:00.000Z';
  const assets=f.sql.prepare('SELECT * FROM blower_history_assets WHERE enabled=1 ORDER BY tag_number').all();assert.equal(assets.length,27);
  for(const [index,item] of assets.entries()) {
    const tag=item.tag_number,hours=index+72.5,manualId=`valid-manual-${index}`,autoId=`wrong-auto-${index}`,dpId=`preserved-dp-${index}`;
    f.sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,
      cycle_runtime_hours=?,runtime_hours=?,cycle_start_revision=?,cycle_runtime_revision=?,cycle_runtime_anchor_at=?,
      runtime_anchor_at=?,cycle_runtime_state='running',is_running=1 WHERE tag_number=?`)
      .run(date,hours,hours,`manual-start-${index}`,`verified-runtime-${index}`,NOW.toISOString(),NOW.toISOString(),tag);
    f.addEvent({id:manualId,tag_number:tag,event_date:index%2?date:sameInstant});
    f.addEvent({id:autoId,tag_number:tag,event_date:sameInstant,source_type:'shift_log_auto',source_log_id:ROW.id});
    const signal=tag==='104ETH03AN602'?'GSPOGE.ABB_DCS.003ETH03AN602XB04':/^(?:103|203)HRJ/.test(tag)?`GSPOGE.ABB_DCS.${tag}XB04`:`GSPOGE.ABB_DCS.TEST_ONLY_BINARY_${tag}`;
    const dpEventId=`dataparc_runtime:${dpId}`;
    f.addEvent({id:dpEventId,tag_number:tag,event_type:'runtime_correction',event_date:NOW.toISOString(),runtime_hours:hours,source_type:'dataparc_runtime',
      source_log_id:dpId,created_at:NOW.toISOString(),updated_at:NOW.toISOString(),source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',
        requestId:dpId,assetTag:tag,dataParcTag:signal,startAt:date,endAt:NOW.toISOString(),observedAt:NOW.toISOString(),
        expectedLastReplacementAt:date,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',expectedCycleStartRevision:`manual-start-${index}`,
        expectedCycleRuntimeRevision:`prior-runtime-${index}`,startState:'stopped',endState:'running',totalRunningHours:hours,runningSeconds:hours*3600,
        chunkCount:1,collectedAt:NOW.toISOString()})});
    const beforeAsset=JSON.stringify(f.asset(tag)),beforeDp=JSON.stringify(f.events(tag).find(event=>event.id===dpEventId));
    const beforeBasis=api.currentDataParcRuntimeBasis(f.asset(tag),f.events(tag));assert.equal(beforeBasis?.appendReady,true,tag);
    const out=await f.apply([]);assert.equal(out.retracted,1,tag);assert.equal(out.corrected,0,tag);assert.equal(out.applied,0,tag);
    assert.equal(JSON.stringify(f.asset(tag)),beforeAsset,tag);assert.equal(JSON.stringify(f.events(tag).find(event=>event.id===dpEventId)),beforeDp,tag);
    assert.deepEqual(api.currentDataParcRuntimeBasis(f.asset(tag),f.events(tag)),beforeBasis,tag);
    assert.equal(f.events(tag).find(event=>event.id===manualId).event_type,'replacement',tag);
    assert.equal(f.events(tag).find(event=>event.id===autoId).event_type,'_retracted_replacement',tag);
    assert.equal(f.events(tag).some(event=>event.event_type==='cycle_source_reconcile'),false,tag);
    assert.equal(out.results.find(result=>result.kind==='retracted').preservedCurrentBasis,true,tag);
    const audit=f.sql.prepare('SELECT * FROM blower_history_asset_history WHERE tag_number=?').get(tag),before=JSON.parse(audit.before_json),after=JSON.parse(audit.after_json);
    assert.deepEqual(before.asset,after.asset,tag);assert.ok(before.events.some(event=>event.id===manualId),tag);assert.ok(after.events.some(event=>event.id===manualId),tag);
  }
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,27);
  const replay=await f.apply([]);assert.equal(replay.retracted,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,27);
});

test('a different manual instant on the same calendar day still requires a new runtime calculation when the wrong automatic boundary is withdrawn',async()=>{
  const f=await fixture(),manual='2026-09-04T00:00:00+09:00',wrong='2026-09-04T09:23:00+09:00';
  f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=?,cycle_runtime_hours=72.5,runtime_hours=72.5 WHERE tag_number=?').run(wrong,TAG);
  f.addEvent({id:'earlier-manual',event_date:manual});f.addEvent({id:'later-wrong-auto',event_date:wrong,source_type:'shift_log_auto',source_log_id:ROW.id});
  const before=f.asset();const out=await f.apply([]);assert.equal(out.retracted,1);assert.equal(f.asset().last_replacement_at,manual);assert.equal(f.asset().cycle_runtime_hours,0);
  assert.notEqual(f.asset().cycle_start_revision,before.cycle_start_revision);assert.notEqual(f.asset().cycle_runtime_revision,before.cycle_runtime_revision);
  assert.equal(out.results.find(result=>result.kind==='retracted').preservedCurrentBasis,undefined);
});

test('concurrent removal of the same-instant manual basis invalidates the preservation transaction rather than leaving a false source retraction',async()=>{
  const f=await fixture(),date='2026-09-04T00:00:00+09:00';f.sql.prepare('UPDATE blower_history_assets SET last_replacement_at=? WHERE tag_number=?').run(date,TAG);
  f.addEvent({id:'manual-concurrently-removed',event_date:date});f.addEvent({id:'wrong-auto-source',event_date:date,source_type:'shift_log_auto',source_log_id:ROW.id});
  const before=JSON.stringify(f.asset());f.db.beforeBatch=sql=>sql.prepare('DELETE FROM blower_history_events WHERE id=?').run('manual-concurrently-removed');
  const out=await f.apply([]);assert.equal(out.ok,false);assert.equal(out.code,'REPLACEMENT_AUTO_CYCLE_CONFLICT');assert.equal(JSON.stringify(f.asset()),before);
  assert.equal(f.events().find(event=>event.id==='wrong-auto-source').event_type,'replacement');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_asset_history').get().n,0);
});
