import test from 'node:test';
import assert from 'node:assert/strict';
import {createLimestone2aFixture,ordinaryAppend,publicHistory,USER,TAG,SIGNAL,START,FIRST,SEAM,OWNER,COMPLETION} from './helpers/blower-limestone2a-fixture-v1.mjs';
import {limestone2aFirstRunStatus,applyLimestone2aFirstRun,validateLimestone2aPrefix,limestone2aFirstRunResponse} from '../functions/_shared/blower-limestone2a-first-run-v1.js';
import {loadAppendBase} from '../functions/_shared/blower-incremental.js';
import {reconcileApprovedReplacementLog} from '../functions/_shared/blower-replacement-auto-v3.js';
import {loadCurrentReplacementRoleContext,replacementSourceGuard} from '../functions/_shared/blower-replacement-log-source-v3.js';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {createHash} from 'node:crypto';
const digest=(f,tables=['blower_history_assets','blower_history_events','blower_history_asset_history','ois_data_requests','blower_runtime_probe_intents_v5','blower_history_atomic_guard','shift_logs','blower_history_candidates'])=>createHash('sha256').update(JSON.stringify(tables.map(t=>[t,f.sql.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]))).digest('hex');
const prefix=f=>({request:f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(f.requestId),intent:f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(f.requestId)});
const editRaw=(f,fn)=>{const p=prefix(f),raw=JSON.parse(p.request.result_json);fn(raw);f.sql.prepare('UPDATE ois_data_requests SET result_json=? WHERE id=?').run(JSON.stringify(raw),f.requestId)};
const cert=f=>f.events().find(e=>e.source_type==='dataparc_limestone2a_first_run_v1');
test('archived completed R9 applies once with explicit actor attestation and no invented completion clock',async t=>{
 const f=await createLimestone2aFixture(t,{archiveDays:20}),before=f.asset(),raw=prefix(f),view=await f.status();assert.equal(view.completionClockKnown,false);assert.equal(view.preview.totalRunningSeconds,54094);assert.equal(view.firstPostReplacementRunAt,'2026-09-19T09:58:26.250+09:00');
 const out=await f.apply(view);assert.equal(out.applied,true);assert.equal(f.asset().last_replacement_at,before.last_replacement_at);assert.equal(f.asset().cycle_start_state,'pending');assert.equal(f.asset().cycle_started_at,null);assert.equal(Math.round(f.asset().cycle_runtime_hours*3600),54094);assert.equal(f.asset().cycle_start_revision,'lime2a-first-run-v1:'+view.proofHash);assert.deepEqual(prefix(f),raw);
 const source=JSON.parse(cert(f).source_text);assert.equal(source.completionClockKnown,false);assert.equal(source.sampleGoodCertified,false);assert.equal(source.attestation.actorId,USER.employeeNo);assert.equal(source.attestation.completionDay,'2026-09-19');assert.equal(source.attestation.completionBeforeFirstRun,true);assert.equal(source.attestation.noEarlierPostReplacementRun,true);assert.equal(source.owner.event_date,START);
 const after=digest(f),again=await f.apply(view);assert.equal(again.replayed,true);assert.equal(digest(f),after);assert.equal((await f.status()).preview.totalRunningSeconds,54094);assert.ok(await loadAppendBase(f.db,f.asset(),SIGNAL));
});
test('current actor discovers only an existing complete R9 and GET is SELECT-only',async t=>{
 const f=await createLimestone2aFixture(t),before=digest(f),ro={prepare(q){assert.match(q,/^\s*SELECT\b/i);const s=f.db.prepare(q);return {bind(...v){s.bind(...v);return this},first:()=>s.first(),all:()=>s.all(),run(){assert.fail('read-only run')}}},batch(){assert.fail('read-only batch')}};
 const out=await limestone2aFirstRunStatus(ro,USER,{}, {now:f.now});assert.equal(out.request.id,f.requestId);assert.equal(out.eligible,true);assert.equal(digest(f),before);
 await assert.rejects(limestone2aFirstRunStatus(ro,{...USER,employeeNo:'another-actor'},{},{now:f.now}),e=>e.code==='LIME2A_FIRST_RUN_REQUEST_NOT_FOUND');
});
test('unprivileged callers and missing explicit attestation cannot mutate evidence',async t=>{
 const f=await createLimestone2aFixture(t),v=await f.status(),before=digest(f);await assert.rejects(limestone2aFirstRunStatus(f.db,{...USER,isSuperAdmin:false}),e=>e.status===403);
 await assert.rejects(applyLimestone2aFirstRun(f.db,USER,{requestId:f.requestId,expectedProofHash:v.proofHash,confirmation:'LIMESTONE_2A_FIRST_RUN_20260919'}),e=>e.code==='LIME2A_FIRST_RUN_ATTESTATION_REQUIRED');assert.equal(digest(f),before);
});
for(const [name,change]of [
 ['wrong signal',r=>r.dataParcTag='GSPOGE.ABB_DCS.WRONG'],['wrong total',r=>r.runningSeconds++],['missing interval',r=>r.chunks[0].runPeriods=[]],
 ['extra earlier RUN',r=>r.chunks[0].runPeriods.unshift({startAt:'2026-09-19T07:00:00+09:00',endAt:'2026-09-19T07:01:00+09:00',startKind:'start_signal',endKind:'stop_signal'})],
 ['wrong first second',r=>r.chunks[0].runPeriods[0].startAt='2026-09-19T09:58:27+09:00'],['bad quality',r=>r.badQualitySeconds=1],['cached result',r=>r.fromCachedResult=true]
])test(name+' fails prefix validation without changing any row',async t=>{const f=await createLimestone2aFixture(t);editRaw(f,change);const before=digest(f);await assert.rejects(f.status(),e=>e.code==='LIME2A_FIRST_RUN_PREFIX_INVALID');assert.equal(digest(f),before)});
for(const [name,change,code]of [
 ['revoked approval',f=>f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BO2'").run(),'LIME2A_FIRST_RUN_SOURCE_REQUIRED'],
 ['changed source',f=>f.sql.prepare("UPDATE shift_logs SET log_json=replace(log_json,'기동중','기동 대기중') WHERE role='BO2'").run(),'LIME2A_FIRST_RUN_SOURCE_CHANGED'],
 ['competing replacement',f=>f.addEvent({id:'newer-owner',event_date:'2026-09-20T10:00:00+09:00'}),'LIME2A_FIRST_RUN_COMPETING_OWNER'],
 ['changed owner',f=>f.sql.prepare("UPDATE blower_history_events SET source_log_id='other-source' WHERE id=?").run(OWNER),'LIME2A_FIRST_RUN_OWNER_CHANGED'],
 ['tampered tail raw',f=>f.sql.prepare("UPDATE ois_data_requests SET result_json='{}' WHERE id='tail-root'").run(),'LIME2A_FIRST_RUN_TAIL_REQUEST_INVALID']
])test(name+' rejects current proof and preserves counters',async t=>{const f=await createLimestone2aFixture(t);change(f);const before=digest(f);await assert.rejects(f.status(),e=>e.code===code);assert.equal(digest(f),before)});
test('a new standard append stays certificate-bound and approval revocation disables its projection',async t=>{
 const f=await createLimestone2aFixture(t),v=await f.status();await f.apply(v);await ordinaryAppend(f);assert.equal(Math.round(f.asset().cycle_runtime_hours*3600),54104);assert.ok(await loadAppendBase(f.db,f.asset(),SIGNAL));
 const state=(await history.loadAssetStates(f.db,{},{assetRows:[f.asset()]}))[0];assert.equal(state.runtimeCoverageEvidence.wholeCycleVerified,false);assert.equal(state.runtimeCoverageEvidence.durationEquivalent,true);assert.equal(state.actualLastReplacementAt,'');
 f.sql.prepare("UPDATE shift_logs SET status='임시저장' WHERE role='BO2'").run();const before=f.asset().cycle_runtime_hours;assert.equal(await loadAppendBase(f.db,f.asset(),SIGNAL),null);
 const changed=(await history.loadAssetStates(f.db,{},{assetRows:[f.asset()]}))[0];assert.notEqual(changed.runtimeCoverageEvidence.durationEquivalent,true);assert.equal(f.asset().cycle_runtime_hours,before);
});
const guardMutations=[
 f=>f.sql.prepare("UPDATE blower_history_assets SET updated_at='drift' WHERE tag_number=?").run(TAG),
 f=>f.sql.prepare("UPDATE blower_history_events SET note='drift' WHERE id='dataparc_runtime:tail-root'").run(),
 f=>f.sql.prepare("UPDATE shift_logs SET log_json=replace(log_json,'기동중','변경') WHERE role='BO2'").run(),
 f=>f.sql.prepare("UPDATE shift_logs SET log_json=replace(log_json,'10:00','10:01') WHERE role='BCO2'").run(),
 f=>{const r={id:'excluded-fixture',tag_number:TAG,status:'excluded',detected_type:'replacement',source_log_id:'legacy-POCHEON#20260919#DAY#BO2'};for(const c of f.sql.prepare('PRAGMA table_info(blower_history_candidates)').all())if(!(c.name in r)&&c.notnull&&c.dflt_value===null)r[c.name]=/INT|REAL/.test(c.type)?0:'fixture';f.sql.prepare('INSERT INTO blower_history_candidates('+Object.keys(r).join(',')+') VALUES('+Object.keys(r).map(()=>'?').join(',')+')').run(...Object.values(r))},
 f=>f.sql.prepare("UPDATE ois_data_requests SET error_message='drift' WHERE id='tail-root'").run(),
 f=>f.sql.prepare("UPDATE blower_runtime_probe_intents_v5 SET reuse_key='drift' WHERE request_id='tail-root'").run(),
 f=>f.sql.prepare("UPDATE ois_data_requests SET error_message='drift' WHERE id=?").run(f.requestId),
 f=>f.sql.prepare("UPDATE blower_runtime_probe_intents_v5 SET reuse_key='drift' WHERE request_id=?").run(f.requestId),
 f=>f.addEvent({id:'dataparc_limestone2a_first_run:'+f.requestId}),
 f=>f.sql.prepare('UPDATE blower_history_assets SET runtime_hours=runtime_hours+1 WHERE tag_number=?').run(TAG),
 f=>f.sql.prepare("UPDATE blower_history_events SET note='post-drift' WHERE source_type='dataparc_limestone2a_first_run_v1'").run(),
 f=>f.sql.prepare("UPDATE blower_history_asset_history SET change_note='post-drift' WHERE action_type='limestone2a_first_run_recovery'").run()
];
for(let index=0;index<guardMutations.length;index++)test('atomic guard '+(index+1)+' rejects its actual row drift and rolls back every protected row',async t=>{
 const f=await createLimestone2aFixture(t),v=await f.status(),before=digest(f),batch=f.db.batch.bind(f.db);let injected=false;
 f.db.batch=async statements=>{let n=0;for(const statement of statements)if(statement.query.startsWith('INSERT INTO blower_history_atomic_guard')&&++n===index+1){const run=statement.run;statement.run=async function(){injected=true;guardMutations[index](f);return run.call(this)}}return batch(statements)};
 await assert.rejects(f.apply(v),e=>e.code==='LIME2A_FIRST_RUN_CONFLICT');assert.equal(injected,true);assert.equal(digest(f),before);
});
async function sourceSync(f,mutate){
 if(mutate)mutate();const context=await loadCurrentReplacementRoleContext(f.db,{workDate:'2026-09-19',shift:'DS'},{now:f.now}),row=context.logs.find(r=>r.id.endsWith('#BO2'));
 const facts=history.collectReplacementFactsForRolePriority(row,f.sql.prepare('SELECT * FROM blower_history_assets').all());
 return reconcileApprovedReplacementLog(f.db,USER,row,facts,{now:f.now,normalizationVersion:4,sourceGuard:replacementSourceGuard(row)});
}
test('unchanged source sync preserves the certificate and all operating rows',async t=>{const f=await createLimestone2aFixture(t),v=await f.status();await f.apply(v);const before=digest(f),out=await sourceSync(f);assert.equal(out.ok,true);assert.equal(out.protected,1);assert.equal(digest(f),before);assert.ok(await loadAppendBase(f.db,f.asset(),SIGNAL))});
test('changed or retracted same-job source returns review without rewriting owner, certificate or counter',async t=>{
 for(const kind of ['edited','retracted']){const f=await createLimestone2aFixture(t),v=await f.status();await f.apply(v);const before=digest(f,['blower_history_assets','blower_history_events','blower_history_asset_history']);
  const out=await sourceSync(f,()=>f.sql.prepare("UPDATE shift_logs SET log_json=replace(log_json,?,?) WHERE role='BO2'").run('Belt 전부 교체 완료. 차단기 투입 후 기동중',kind==='edited'?'Belt 교체 완료시각 재확인중':'Belt 교체 미실시'));
  assert.equal(out.ok,false);assert.equal(out.code,'LIME2A_FIRST_RUN_SOURCE_REVIEW_REQUIRED');assert.equal(digest(f,['blower_history_assets','blower_history_events','blower_history_asset_history']),before);
 }
});
test('a real later replacement remains available and the historical certificate stays immutable',async t=>{
 const f=await createLimestone2aFixture(t),v=await f.status();await f.apply(v);const source=cert(f).source_text;
 const out=await publicHistory(f,{action:'replacement',tagNumber:TAG,eventDate:new Date(f.now.getTime()-3600000).toISOString()});assert.equal(out.status,200,JSON.stringify(out.body));assert.notEqual(f.asset().cycle_start_revision,'lime2a-first-run-v1:'+v.proofHash);assert.equal(cert(f).source_text,source);
});
test('storage failures return a fixed safe code without provider SQL or account content',async t=>{const f=await createLimestone2aFixture(t),v=await f.status(),before=digest(f);f.db.batch=async()=>{throw new Error('D1_ERROR secret SQL token account')};const r=await limestone2aFirstRunResponse(f.db,USER,'apply',{requestId:f.requestId,expectedProofHash:v.proofHash,confirmation:'LIMESTONE_2A_FIRST_RUN_20260919',attestation:{version:1,completionDay:'2026-09-19',firstRunAt:v.firstPostReplacementRunAt,completionBeforeFirstRun:true,noEarlierPostReplacementRun:true,statementCode:'BELT_COMPLETED_BEFORE_FIRST_RUN'}},{now:f.now}),body=await r.json();assert.equal(r.status,500);assert.equal(body.code,'LIME2A_FIRST_RUN_STORAGE_FAILED');assert.doesNotMatch(JSON.stringify(body),/secret|SQL|token|account/);assert.equal(digest(f),before)});
for(const field of ['expected_cycle_start_revision','expected_cycle_runtime_revision','expected_last_replacement_at'])test('joint raw/intent '+field+' tamper cannot borrow another Cycle with unchanged RUN geometry',async t=>{
 const f=await createLimestone2aFixture(t),q=f.sql.prepare("SELECT * FROM ois_data_requests WHERE id='tail-root'").get(),raw=JSON.parse(q.result_json),rawField={expected_cycle_start_revision:'expectedCycleStartRevision',expected_cycle_runtime_revision:'expectedCycleRuntimeRevision',expected_last_replacement_at:'expectedLastReplacementAt'}[field],value=field==='expected_last_replacement_at'?'2026-09-18T00:00:00+09:00':'different-cycle';raw[rawField]=value;
 f.sql.prepare('UPDATE blower_runtime_probe_intents_v5 SET '+field+"=? WHERE request_id='tail-root'").run(value);f.sql.prepare("UPDATE ois_data_requests SET result_json=? WHERE id='tail-root'").run(JSON.stringify(raw));const before=digest(f);
 await assert.rejects(f.status(),e=>e.code==='LIME2A_FIRST_RUN_TAIL_REQUEST_INVALID');assert.equal(digest(f),before);
});
for(const [field,value]of [['requested_at','invalid'],['completed_at','invalid'],['completed_at','2020-01-01T00:00:00Z'],['target_date','wrong-target']])test('invalid archived '+field+' is rejected before certificate creation',async t=>{
 const f=await createLimestone2aFixture(t);f.sql.prepare('UPDATE ois_data_requests SET '+field+"=? WHERE id='tail-root'").run(value);await assert.rejects(f.status(),e=>e.code==='LIME2A_FIRST_RUN_TAIL_REQUEST_INVALID');
});
function insertPeer(f){f.sql.prepare('INSERT INTO shift_logs(id,work_date,shift,role,author,status,log_json,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('new-target-peer','2026-09-19','DS','BO2','Fixture peer','결재완료',JSON.stringify({entries:[{id:'new-target-job',time:'12:00',content:'#2 BLR Limestone Blower #A V-Belt 교체 완료'}]}),f.now.toISOString())}
test('a preexisting competing approved job is rejected rather than accepted through a new context fingerprint',async t=>{const f=await createLimestone2aFixture(t);insertPeer(f);const before=digest(f);await assert.rejects(f.status(),e=>e.code==='LIME2A_FIRST_RUN_SOURCE_CONFLICT');assert.equal(digest(f),before)});
test('a newly approved peer between proof and batch invalidates the guarded role-context absence',async t=>{const f=await createLimestone2aFixture(t),v=await f.status(),before=digest(f,['blower_history_assets','blower_history_events','blower_history_asset_history']);f.db.beforeBatch=()=>insertPeer(f);await assert.rejects(f.apply(v),e=>e.code==='LIME2A_FIRST_RUN_CONFLICT');assert.equal(digest(f,['blower_history_assets','blower_history_events','blower_history_asset_history']),before);assert.ok(f.sql.prepare("SELECT 1 FROM shift_logs WHERE id='new-target-peer'").get(),'concurrent peer authored before the transaction is preserved')});
for(const marker of ['', 'unrelated-cycle-marker'])test('removed or changed certificate marker cannot replay an old total as current',async t=>{const f=await createLimestone2aFixture(t),v=await f.status();await f.apply(v);f.sql.prepare('UPDATE blower_history_assets SET cycle_start_revision=? WHERE tag_number=?').run(marker,TAG);await assert.rejects(f.status(),e=>e.code==='LIME2A_FIRST_RUN_CURRENT_PROOF_CHANGED')});
test('R9 unknown runtime ancestor is rejected even with the same day and startup revision',async t=>{const f=await createLimestone2aFixture(t),i=prefix(f).intent,raw=JSON.parse(prefix(f).request.result_json),bad='r7-evidence-only-v1:r9_signal_v1:unknown-runtime';raw.expectedCycleRuntimeRevision=bad;f.sql.prepare('UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_runtime_revision=? WHERE request_id=?').run(bad,f.requestId);f.sql.prepare('UPDATE ois_data_requests SET result_json=? WHERE id=?').run(JSON.stringify(raw),f.requestId);await assert.rejects(f.status(),e=>e.code==='LIME2A_FIRST_RUN_PREFIX_INVALID')});
test('applied status after an ordinary append returns the currently verified total and endpoint',async t=>{const f=await createLimestone2aFixture(t),v=await f.status();await f.apply(v);await ordinaryAppend(f);const current=await f.status();assert.equal(current.preview.totalRunningSeconds,54104);assert.equal(current.tail.runningSeconds,3610);assert.equal(Date.parse(current.preview.observedAt),Date.parse(f.asset().cycle_runtime_anchor_at))});
test('joint raw/request collection-clock drift cannot replace the immutable event collection instant',async t=>{const f=await createLimestone2aFixture(t),q=f.sql.prepare("SELECT * FROM ois_data_requests WHERE id='tail-root'").get(),raw=JSON.parse(q.result_json);raw.collectedAt=new Date(Date.parse(raw.collectedAt)+500).toISOString();f.sql.prepare("UPDATE ois_data_requests SET result_json=?,completed_at=? WHERE id='tail-root'").run(JSON.stringify(raw),raw.collectedAt);await assert.rejects(f.status(),e=>e.code==='LIME2A_FIRST_RUN_TAIL_REQUEST_INVALID')});
