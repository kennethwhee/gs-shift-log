import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
import { reconcileApprovedReplacementLog, replacementAutoCycleProof } from '../functions/_shared/blower-replacement-auto-v3.js';
const TAG='103HRJ01AN601', OLD='2026-09-18T05:20:00.000Z', HIGH='2026-09-18T05:24:00.000Z', END='2026-11-03T20:00:00.000Z';
const NOW=new Date('2026-11-03T21:00:00.000Z'), USER={employeeNo:'test',name:'Test'};
const digest=value=>createHash('sha256').update(value).digest('hex');
const ROW={id:'legacy-POCHEON#20260918#DAY#BCO1',role:'BCO1',shift:'DS',work_date:'2026-09-18',status:'결재완료',source_snapshot:'higher-current-approved'};
const LOW={...ROW,id:'legacy-POCHEON#20260918#DAY#BO1',role:'BO1',source_snapshot:'lower-current-approved'};
const key=row=>JSON.stringify([row.id,TAG,`${row.role}-entry`,0]);
const fact=(row=ROW,precision='minute')=>({tagNumber:TAG,recordDate:'2026-09-18',eventDate:row===ROW?HIGH:OLD,timePrecision:precision,sourceKey:key(row),sourceText:'Limestone Blower #A V-Belt 교체 완료'});
const descriptor=row=>({tagNumber:TAG,sourceLogId:row.id,sourceAliases:[],sourceRole:row.role,sourceKey:key(row),sourceSnapshotSha256:digest(row.source_snapshot),sourceSnapshotHistorySha256:[],workDate:row.work_date,shift:row.shift,eventDate:row===ROW?HIGH:OLD,timePrecision:'minute'});
function selection(precision='minute'){return {...descriptor(ROW),timePrecision:precision,suppressedSources:[descriptor(LOW)]};}
function d1(){const sqlite=new DatabaseSync(':memory:');const db={sqlite,beforeBatch:null,prepare(sql){return{values:[],bind(...values){this.values=values;return this},async first(){return sqlite.prepare(sql).get(...this.values)||null},async all(){return{results:sqlite.prepare(sql).all(...this.values)}},async run(){return{meta:{changes:Number(sqlite.prepare(sql).run(...this.values).changes)}}}}},async batch(statements){if(db.beforeBatch){const fn=db.beforeBatch;db.beforeBatch=null;fn(sqlite)}sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results}catch(e){sqlite.exec('ROLLBACK');throw e}}};return db}
async function fixture(){
 const db=d1();await api.ensureSchema(db);const sql=db.sqlite;
 sql.prepare("UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,cycle_start_revision='owned-start',cycle_runtime_revision='owned-runtime',cycle_runtime_hours=100,runtime_hours=100,cycle_runtime_anchor_at=?,runtime_anchor_at=?,cycle_runtime_state='running',is_running=1 WHERE tag_number=?").run(OLD,END,END,TAG);
 function add(patch){const e={id:'owner',tag_number:TAG,event_type:'replacement',event_date:OLD,runtime_hours:0,issue_type:'',action_type:'교체',note:'Recovered BO1 work-log',source_type:'manual',source_log_id:'',source_text:'',created_by_id:'test',created_by_name:'Test',created_at:OLD,updated_at:OLD,...patch};sql.prepare(`INSERT INTO blower_history_events(${Object.keys(e).join(',')}) VALUES(${Object.keys(e).map(()=>'?').join(',')})`).run(...Object.values(e));return e}
 add({});
 function confirmation(row,conflict=false){return add({id:row.role+'-proof',event_type:'cycle_source_reconcile',event_date:END,source_type:'shift_log_auto_v3',source_log_id:row.id,source_text:JSON.stringify({schemaVersion:3,replacementAutoV3:true,normalizationVersion:4,currentCycle:true,confirmationOnly:true,replacementEventId:'owner',currentLastReplacementAt:OLD,cycleStartRevision:'owned-start',cycleRuntimeRevision:'owned-runtime',timePrecision:'minute',sourceKey:key(row),sourcePhysicalId:row.id.replace(/^legacy-/,''),sourceSnapshotSha256:digest(row.source_snapshot),...(conflict?{completionClockConflict:true,sourceCompletionAt:HIGH}:{}),sourceText:'V-Belt 교체 완료'}),created_at:END,updated_at:END})}
 confirmation(LOW);confirmation(ROW,true);
 add({id:'dataparc_runtime:receipt',event_type:'runtime_correction',event_date:END,runtime_hours:100,source_type:'dataparc_runtime',source_log_id:'receipt',created_at:END,updated_at:END,source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:'receipt',assetTag:TAG,dataParcTag:'GSPOGE.ABB_DCS.103HRJ01AN601XB04',startAt:OLD,endAt:END,observedAt:END,expectedLastReplacementAt:OLD,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',expectedCycleStartRevision:'owned-start',expectedCycleRuntimeRevision:'previous-runtime',endState:'running',startState:'running',runningSeconds:360000,totalRunningHours:100})});
 const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG),events=()=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
 const apply=(opts={})=>reconcileApprovedReplacementLog(db,USER,ROW,[fact()],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]},rolePrioritySelections:[selection()],...opts});
 return{db,sql,asset,events,add,apply,proof:()=>replacementAutoCycleProof(asset(),events())};
}
test('higher-role selection preserves manual boundary and measured counter while recording authoritative 14:24',async()=>{
 const f=await fixture(),before=JSON.stringify(f.asset()),oldOwner=f.events().find(e=>e.id==='owner'),receipt=f.events().find(e=>e.id==='dataparc_runtime:receipt');
 assert.equal(f.proof().completionClockConflict,true);const out=await f.apply();assert.equal(out.confirmed,1);assert.equal(out.applied,0);assert.equal(out.corrected,0);
 assert.equal(JSON.stringify(f.asset()),before);assert.deepEqual(f.events().find(e=>e.id==='owner'),oldOwner);assert.deepEqual(f.events().find(e=>e.id===receipt.id),receipt);
 const p=f.proof();assert.equal(p.rolePrioritySelection.selectedRole,'BCO1');assert.equal(p.rolePrioritySelection.selectedCompletionAt,HIGH);assert.equal(p.rolePrioritySelection.registeredReplacementAt,OLD);assert.equal(p.rolePrioritySelection.requiredRebuild,true);
 assert.equal(p.clockKnown,false);assert.equal(p.completionClockConflict,false);assert.equal(p.registeredRuntimeRange,true);assert.equal(p.freshQueryEligible,false);assert.equal(p.requiresRunRefresh,false);
 assert.equal(api.currentDataParcRuntimeBasis(f.asset(),f.events()).runtimeHours,100);
 const audit=f.sql.prepare('SELECT * FROM blower_history_asset_history').get();assert.match(audit.after_json,/suppressedSources/);assert.match(audit.before_json,/BO1-proof/);
});
test('retry and later suppressed lower source never restore lower authority or reset the counter',async()=>{
 const f=await fixture();await f.apply();const stable=JSON.stringify([f.asset(),f.events()]);await f.apply();assert.equal(JSON.stringify([f.asset(),f.events()]),stable);
 const suppression={...descriptor(LOW),selection:selection()};await reconcileApprovedReplacementLog(f.db,USER,LOW,[fact(LOW)],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]},rolePrioritySuppressions:[suppression]});
 assert.equal(JSON.stringify([f.asset(),f.events()]),stable);assert.equal(f.proof().rolePrioritySelection.selectedCompletionAt,HIGH);
});
test('higher-role day-only source cannot borrow a lower minute or the registered manual clock',async()=>{
 const f=await fixture();await reconcileApprovedReplacementLog(f.db,USER,ROW,[fact(ROW,'day')],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]},rolePrioritySelections:[selection('day')]});
 const p=f.proof();assert.equal(p.rolePrioritySelection.timePrecision,'day');assert.equal(p.rolePrioritySelection.selectedCompletionAt,'');assert.equal(p.rolePrioritySelection.requiredRebuild,false);assert.equal(p.clockKnown,false);assert.equal(p.completionClockReconciled,undefined);assert.equal(p.freshQueryEligible,false);assert.equal(f.asset().last_replacement_at,OLD);
});
test('edited or deleted selected source revokes its selection certificate before the next projection',async()=>{
 const f=await fixture();await f.apply();const old=JSON.stringify(f.asset());await reconcileApprovedReplacementLog(f.db,USER,{...ROW,source_snapshot:'changed-body-without-completion'},[],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]}});
 assert.equal(f.proof()?.rolePrioritySelection,undefined);assert.equal(JSON.stringify(f.asset()),old);assert.ok(f.events().some(e=>JSON.parse(e.source_text||'null')?.sourceRevisionSuperseded===true));
});
test('selection does not override an unrelated manual owner without exact linked source evidence',async()=>{
 const f=await fixture();f.sql.prepare("DELETE FROM blower_history_events WHERE event_type='cycle_source_reconcile'").run();const before=JSON.stringify(f.asset());await f.apply();assert.equal(f.proof()?.rolePrioritySelection,undefined);assert.equal(JSON.stringify(f.asset()),before);assert.equal(f.proof()?.completionClockConflict,true);
});
test('foreign source hashes, roles, shifts and tags fail closed without role-selection privilege',async()=>{
 for(const mutate of [s=>s.sourceRole='BCO2',s=>s.shift='NS',s=>s.suppressedSources[0].sourceSnapshotSha256='0'.repeat(64),s=>s.tagNumber='203HRJ01AN601']){
  const f=await fixture(),s=selection();mutate(s);if(s.suppressedSources[0].sourceSnapshotSha256==='0'.repeat(64)){f.sql.prepare("DELETE FROM blower_history_events WHERE id='BCO1-proof'").run()}
  const before=JSON.stringify(f.asset());await f.apply({rolePrioritySelections:[s]});assert.equal(f.proof()?.rolePrioritySelection,undefined);assert.equal(JSON.stringify(f.asset()),before);
 }
});
test('atomic guard rejects concurrently changed state and leaves no partial priority certificate',async()=>{
 const f=await fixture();f.db.beforeBatch=sql=>sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='concurrent' WHERE tag_number=?").run(TAG);const out=await f.apply();assert.equal(out.ok,false);assert.equal(out.code,'REPLACEMENT_AUTO_CYCLE_CONFLICT');assert.equal(f.events().some(e=>e.id.includes(':role-priority:')),false);assert.equal(f.asset().cycle_runtime_hours,100);
});
test('selection certificate cannot survive a new manual cycle revision or lost owner',async()=>{
 for(const mode of ['revision','owner']){const f=await fixture();await f.apply();if(mode==='revision')f.sql.prepare("UPDATE blower_history_assets SET cycle_start_revision='manual-new' WHERE tag_number=?").run(TAG);else f.sql.prepare("DELETE FROM blower_history_events WHERE id='owner'").run();assert.equal(f.proof()?.rolePrioritySelection,undefined,mode)}
});
test('new higher-role automatic replacement retains ordinary first RUN authority for minute and day facts',async()=>{
 for(const precision of ['minute','day']){
  const f=await fixture();f.sql.prepare('DELETE FROM blower_history_events WHERE tag_number=?').run(TAG);
  f.sql.prepare("UPDATE blower_history_assets SET last_replacement_at='2026-08-01T00:00:00+09:00' WHERE tag_number=?").run(TAG);
  const out=await reconcileApprovedReplacementLog(f.db,USER,ROW,[fact(ROW,precision)],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]},rolePrioritySelections:[selection(precision)]});
  assert.equal(out.applied,1);const p=f.proof();assert.equal(p.rolePrioritySelection.selectedRole,'BCO1');assert.equal(p.requiresRunRefresh,true);assert.equal(p.freshQueryEligible,precision==='minute');assert.equal(p.rangeQueryEligible,precision==='day');assert.equal(p.registeredBaseline,false);assert.equal(f.asset().cycle_runtime_hours,0);
  if(precision==='day'){assert.equal(p.clockKnown,false);assert.equal(p.rangeStartAt,'2026-09-18T15:00:00.000Z')}
 }
});
test('deleted or unapproved higher counterpart revokes authority when only the surviving lower row replays',async()=>{
 const f=await fixture();await f.apply();const before=JSON.stringify(f.asset());
 await reconcileApprovedReplacementLog(f.db,USER,LOW,[fact(LOW)],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]},rolePriorityEvaluation:{version:1,workDate:LOW.work_date,shift:LOW.shift,sourceLogIds:[LOW.id],selections:[]}});
 assert.equal(f.proof()?.rolePrioritySelection,undefined);assert.equal(JSON.stringify(f.asset()),before);
});
test('a changed higher snapshot can replace its prior certificate using unchanged guarded lower proof',async()=>{
 const f=await fixture();await f.apply();const row={...ROW,source_snapshot:'corrected-higher-clock'},selected={...selection(),sourceSnapshotSha256:digest(row.source_snapshot),sourceSnapshotHistorySha256:[digest(ROW.source_snapshot)],eventDate:'2026-09-18T05:25:00.000Z'};
 await reconcileApprovedReplacementLog(f.db,USER,row,[{...fact(),eventDate:selected.eventDate}],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]},rolePrioritySelections:[selected]});
 assert.equal(f.proof().rolePrioritySelection.selectedCompletionAt,selected.eventDate);assert.equal(f.asset().last_replacement_at,OLD);assert.equal(f.asset().cycle_runtime_hours,100);
});
test('same-boundary selected higher minute preserves the existing measured full-range receipt',async()=>{
 const f=await fixture(),selected={...selection(),eventDate:OLD};await reconcileApprovedReplacementLog(f.db,USER,ROW,[{...fact(),eventDate:OLD}],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]},rolePrioritySelections:[selected]});
 const p=f.proof();assert.equal(p.clockKnown,true);assert.equal(p.completionClockReconciled,true);assert.equal(p.confirmedReplacementAt,OLD);assert.equal(p.rolePrioritySelection.requiredRebuild,false);assert.equal(p.freshQueryEligible,false);assert.equal(f.asset().cycle_runtime_hours,100);
});
test('malformed or ownerless role metadata never falls back to certifying its preserved registration clock',async()=>{
 for(const mode of ['owner','role','clock','digest']){
  const f=await fixture();await f.apply();const certificate=f.events().find(e=>e.id.includes(':role-priority:')),meta=JSON.parse(certificate.source_text);
  if(mode==='owner')meta.replacementEventId='missing-owner';if(mode==='role')meta.rolePrioritySelection.selectedRole='BO1';if(mode==='clock')meta.rolePrioritySelection.selectedCompletionAt='invalid';if(mode==='digest')meta.sourceSnapshotSha256='untrusted';
  f.sql.prepare('UPDATE blower_history_events SET source_text=? WHERE id=?').run(JSON.stringify(meta),certificate.id);const p=f.proof();assert.notEqual(p?.clockKnown,true,mode);assert.notEqual(p?.freshQueryEligible,true,mode);assert.equal(p?.rolePrioritySelection,undefined,mode);
 }
});
test('revoking a selected superior source cannot promote a surviving lower date fact to the manual registration minute',async()=>{
 for(const ownedRange of [true,false]){
  const f=await fixture();await f.apply();const before=JSON.stringify(f.asset());if(!ownedRange)f.sql.prepare("DELETE FROM blower_history_events WHERE source_type='dataparc_runtime'").run();
  await reconcileApprovedReplacementLog(f.db,USER,LOW,[fact(LOW,'day')],{now:NOW,normalizationVersion:4,sourceGuard:{sql:'1=1',values:[]},rolePriorityEvaluation:{version:1,workDate:LOW.work_date,shift:LOW.shift,sourceLogIds:[LOW.id],selections:[]}});
  const p=f.proof();assert.equal(p.rolePrioritySelection,undefined);assert.equal(p.rolePrioritySourceRevoked,true);assert.equal(p.clockKnown,false);assert.equal(p.timePrecision,'day');assert.equal(p.completionClockReconciled,undefined);assert.equal(p.freshQueryEligible,false);assert.equal(JSON.stringify(f.asset()),before);
  assert.equal(p.registeredRuntimeRange,ownedRange);
 }
});
