import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture as apiFixture, history, BROWSER_EMPLOYEE_NO, BROWSER_TOKEN, browserCreate, agentClaim, agentComplete,
  agent, callApi, historyPost, addBrowserIdentity } from './helpers/blower-incremental-fixture.mjs';
import { __oisDataRequestsTest as ois, onRequestGet as requestsGet } from '../functions/api/ois-data-requests.js';
import { ensureAppendSchema } from '../functions/_shared/blower-incremental.js';
import {
  BOUNDARY_RECOVERY_PREFIX, BOUNDARY_RECOVERY_TAG as TAG, BOUNDARY_RECOVERY_SIGNAL as SIGNAL,
  ensureBoundaryRecoverySchema, loadBoundaryRecoveryProof, validateBoundaryRecoveryView,
  boundaryRecoveryQueueStatements, loadBoundaryRecoveryIntent, validBoundaryRecoveryReuse,
  validateBoundaryRecoveryApply, findBoundaryRecoveryRequest
} from '../functions/_shared/blower-boundary-recovery-v1.js';

const NOW = new Date('2026-11-07T00:20:00.000Z');
const START = '2026-07-24T10:00:00.000Z', OWNER = '2026-07-24T00:00:00+09:00';
const BASE_END = '2026-11-06T15:01:15.000Z', FAILED_END = '2026-11-07T00:18:00.000Z';
const BASE_SECONDS = 4149227, DELTA_SECONDS = 3600;
const USER = {employeeNo:BROWSER_EMPLOYEE_NO,name:'Boundary test operator'};
const code = wanted => error => error.code === wanted && error.status >= 400;
const clone = value => structuredClone(value);
const instant = value => new Date(value).toISOString();

async function fixture(t) {
  const f = await apiFixture(TAG,false), db = f.database, sql = f.sqlite;
  t.after(() => sql.close());
  await ois.ensureBlowerRuntimeProbeSchema(db);
  await ensureAppendSchema(db);
  await ensureBoundaryRecoverySchema(db);
  sql.exec('CREATE TABLE boundary_queued_test(id TEXT PRIMARY KEY); CREATE TABLE boundary_applied_test(id TEXT PRIMARY KEY)');
  const add = (table,row) => sql.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  sql.prepare('DELETE FROM blower_history_events WHERE tag_number=?').run(TAG);
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='started',cycle_started_at=?,
    cycle_start_revision='start-r1',cycle_runtime_revision='runtime-r1',cycle_runtime_hours=?,runtime_hours=?,
    cycle_runtime_anchor_at=?,cycle_runtime_state='stopped',runtime_anchor_at=NULL,is_running=0,updated_at=? WHERE tag_number=?`)
    .run(OWNER,START,BASE_SECONDS/3600,BASE_SECONDS/3600,BASE_END,BASE_END,TAG);
  const asset = () => sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
  const events = () => sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
  const expected = () => {const a=asset();return {expectedLastReplacementAt:a.last_replacement_at,
    expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',
    expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision};};
  const event = {id:'dataparc_runtime:prior-owner',tag_number:TAG,event_type:'runtime_correction',event_date:BASE_END,
    runtime_hours:BASE_SECONDS/3600,issue_type:'DataPARC',action_type:'RUN',note:'Previous owned total',
    source_type:'dataparc_runtime',source_log_id:'prior-owner',source_text:JSON.stringify({schemaVersion:1,
      requestType:'blower_runtime_probe',requestId:'prior-owner',assetTag:TAG,dataParcTag:SIGNAL,
      startAt:START,endAt:BASE_END,observedAt:BASE_END,...expected(),expectedCycleRuntimeRevision:'older-runtime',
      startState:'running',endState:'stopped',runningSeconds:BASE_SECONDS,totalRunningHours:BASE_SECONDS/3600,
      chunkCount:4,collectedAt:BASE_END}),created_by_id:'original-operator',created_by_name:'Original',
    created_at:BASE_END,updated_at:BASE_END};
  add('blower_history_events',event);
  function raw(id='failed-append',start=BASE_END,end=FAILED_END,total=DELTA_SECONDS,revision='append-v1:runtime-r1') {
    const chunks=[],endMs=Date.parse(end);let cursor=Date.parse(start),remaining=total;
    while(cursor<endMs) {
      const next=Math.min(endMs,cursor+31*86400000),chunkSeconds=Math.min(remaining,Math.floor((next-cursor)/1000));
      remaining-=chunkSeconds;
      chunks.push({index:chunks.length+1,startAt:instant(cursor),endAt:instant(next),
        startState:chunks.length?'stopped':'running',endState:'stopped',runningSeconds:chunkSeconds,totalRunningHours:chunkSeconds/3600});
      cursor=next;
    }
    assert.equal(remaining,0);
    return {schemaVersion:1,requestType:'blower_runtime_probe',requestId:id,ok:true,readOnly:true,
      assetTag:TAG,dataParcTag:SIGNAL,startAt:start,endAt:end,observedAt:end,
      ...expected(),expectedCycleRuntimeRevision:revision,chunkDays:31,chunkCount:chunks.length,completedChunkCount:chunks.length,
      startState:'running',endState:'stopped',runningSeconds:total,totalRunningHours:total/3600,
      collectedAt:instant(Date.parse(end)+1000),chunks};
  }
  const failedRaw=raw();
  add('ois_data_requests',{id:'failed-append',request_type:'blower_runtime_probe',status:'complete',
    target_date:`v1|${TAG}|${BASE_END}|${FAILED_END}`,requested_by_id:USER.employeeNo,requested_by_name:USER.name,
    requested_at:FAILED_END,started_at:FAILED_END,completed_at:failedRaw.collectedAt,agent_id:'reviewed-agent',
    result_json:JSON.stringify(failedRaw),error_message:'',expires_at:'2026-11-07T02:00:00.000Z',updated_at:failedRaw.collectedAt});
  add('blower_runtime_probe_intents_v5',{request_id:'failed-append',reuse_key:'append-v1:'+'a'.repeat(64),schema_version:1,
    asset_tag:TAG,dataparc_tag:SIGNAL,window_start:BASE_END,window_end:FAILED_END,chunk_days:31,chunk_count:1,
    expected_last_replacement_at:OWNER,expected_cycle_start_state:'started',expected_cycle_started_at:START,
    expected_cycle_start_revision:'start-r1',expected_cycle_runtime_revision:'append-v1:runtime-r1',created_at:FAILED_END,updated_at:FAILED_END});
  add('blower_runtime_append_v1',{request_id:'failed-append',base_event_id:event.id,base_revision:'runtime-r1',
    base_observed_at:BASE_END,coverage_start_at:START,base_running_seconds:BASE_SECONDS,created_at:FAILED_END});
  const adapters = {now:NOW,normalizeProbe:history.normalizeDataParcRuntimeProbeResult,
    loadRuntimeIntent:async(database,id)=>database.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(id).first(),
    matchesRuntimeIntent:(intent,probe)=>intent.request_id===probe.requestId && intent.schema_version===probe.schemaVersion &&
      intent.asset_tag===probe.assetTag && intent.dataparc_tag===probe.dataParcTag &&
      intent.window_start===probe.rawStartAt && intent.window_end===probe.rawEndAt && intent.chunk_count===probe.chunkCount &&
      intent.expected_last_replacement_at===probe.expectedLastReplacementAt && intent.expected_cycle_start_state===probe.expectedCycleStartState &&
      intent.expected_cycle_started_at===probe.expectedCycleStartedAt && intent.expected_cycle_start_revision===probe.expectedCycleStartRevision &&
      intent.expected_cycle_runtime_revision===probe.expectedCycleRuntimeRevision};
  const proof=(patch={},user=USER)=>loadBoundaryRecoveryProof(db,asset(),SIGNAL,'failed-append',user,{...adapters,...patch});
  const body=()=>({action:'create_blower_runtime_probe',unifiedRefresh:true,appendBoundaryRecovery:true,
    boundaryFailureRequestId:'failed-append',incrementalRefresh:false,requireIncrementalAppend:false,
    assetTag:TAG,dataParcTag:SIGNAL,startAt:START,...expected()});
  async function queue(id='full-repair',p=null) {
    p ||= await proof();validateBoundaryRecoveryView(body(),p);
    const statements=boundaryRecoveryQueueStatements(db,p,id,NOW.toISOString());
    await db.batch([...statements.before,db.prepare('INSERT INTO boundary_queued_test VALUES(?)').bind(id),...statements.after]);
    return {proof:p,intent:await loadBoundaryRecoveryIntent(db,id)};
  }
  function fullProbe({id='full-repair',end=NOW.toISOString(),total=BASE_SECONDS+DELTA_SECONDS+60,...patch}={}) {
    const value=raw(id,START,end,total,BOUNDARY_RECOVERY_PREFIX+'runtime-r1');
    const validation=history.normalizeDataParcRuntimeProbeResult(value,id,new Date(Math.max(NOW.getTime(),Date.parse(end))));
    assert.ok(!validation.error,validation.error);
    return {...validation.result,expectedCycleRuntimeRevision:'runtime-r1',...patch};
  }
  const check=(intent,probe=fullProbe(),payload={appendBoundaryRecovery:true},options={})=>
    validateBoundaryRecoveryApply(db,intent,asset(),probe,payload,USER,{...adapters,...options});
  async function applyGuard(checks) {
    const id='test-apply-guard';
    const values=[id,...checks.flatMap(check=>check.values)];
    assert.ok(values.length<=100,`D1 bind count ${values.length}`);
    await db.batch([db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN ${checks.map(check=>'('+check.sql+')').join(' AND ')} THEN 1 ELSE 0 END)`).bind(...values),
      db.prepare('INSERT INTO boundary_applied_test VALUES(?)').bind('applied'),db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(id)]);
  }
  const mutateRaw=mutate=>{const value=JSON.parse(sql.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get('failed-append').result_json);
    mutate(value);sql.prepare('UPDATE ois_data_requests SET result_json=? WHERE id=?').run(JSON.stringify(value),'failed-append');};
  async function acceptedLookup(status='pending',id='full-repair') {
    const accepted=await queue(id),prior=sql.prepare("SELECT * FROM ois_data_requests WHERE id='failed-append'").get();
    add('ois_data_requests',{...prior,id,status,requested_at:NOW.toISOString(),started_at:null,completed_at:null,result_json:null,
      target_date:`v1|${TAG}|${START}|${NOW.toISOString()}`});
    add('blower_runtime_probe_intents_v5',{...sql.prepare("SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id='failed-append'").get(),
      request_id:id,reuse_key:BOUNDARY_RECOVERY_PREFIX+(id==='full-repair'?'b':'c').repeat(64),window_start:START,window_end:NOW.toISOString(),
      chunk_count:4,expected_cycle_runtime_revision:BOUNDARY_RECOVERY_PREFIX+'runtime-r1'});
    return accepted;
  }
  return {...f,db,sql,add,asset,events,expected,raw,failedRaw,adapters,proof,body,queue,fullProbe,check,applyGuard,mutateRaw,acceptedLookup};
}

test('a fresh owned failed append pins exact current owner and full start without changing any saved value',async t=>{
  const f=await fixture(t),before=f.asset(),events=f.events();
  const {proof,intent}=await f.queue();
  assert.equal(proof.mode,'append_boundary_full');assert.equal(proof.startAt,START);
  assert.equal(proof.failedProbe.startState,'running');assert.equal(proof.base.state,'stopped');
  assert.equal(intent.failure_request_id,'failed-append');assert.equal(await validBoundaryRecoveryReuse(f.db,'full-repair',proof),true);
  assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
  const result=await f.check(intent);await f.applyGuard(result.guards);
  assert.equal(result.comparison.fullSeconds,BASE_SECONDS+DELTA_SECONDS+60);
  assert.equal(result.comparison.previousSeconds,BASE_SECONDS);
  assert.equal(result.comparison.deltaSeconds,DELTA_SECONDS);assert.equal(result.comparison.gapSeconds,120);
  assert.deepEqual(f.asset(),before,'helper validates absolute full seconds and does not mutate totals or dates');
});

test('freshness is required to create, while an accepted proof is revalidated from exact original receipts',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.proof({now:new Date(Date.parse(FAILED_END)+15*60000+1)}),error=>
    ['BLOWER_BOUNDARY_RECOVERY_PROOF_REQUIRED','BLOWER_BOUNDARY_RECOVERY_STALE'].includes(error.code));
  const {intent}=await f.queue();
  const end=instant(Date.parse(FAILED_END)+15*60000),later=new Date(Date.parse(end)+60000);
  const probe=f.fullProbe({end,total:BASE_SECONDS+DELTA_SECONDS});
  await f.check(intent,probe,{appendBoundaryRecovery:true},{now:later});
});

for (const [label,mutate] of [
  ['matching old and new boundary',f=>f.mutateRaw(raw=>{raw.startState='stopped';raw.chunks[0].startState='stopped';})],
  ['different raw target',f=>f.mutateRaw(raw=>{raw.assetTag='204SDF01AN001';})],
  ['incomplete chunks',f=>f.mutateRaw(raw=>{raw.completedChunkCount=0;})],
  ['sum disagrees with chunks',f=>f.mutateRaw(raw=>{raw.runningSeconds+=100;})],
  ['mismatched frozen interval',f=>f.sql.prepare("UPDATE blower_runtime_probe_intents_v5 SET window_start=? WHERE request_id='failed-append'").run(START)],
  ['ordinary unmarked runtime intent',f=>f.sql.prepare("UPDATE blower_runtime_probe_intents_v5 SET reuse_key='ordinary' WHERE request_id='failed-append'").run()],
  ['changed append base',f=>f.sql.prepare("UPDATE blower_runtime_append_v1 SET base_running_seconds=1 WHERE request_id='failed-append'").run()],
  ['changed cycle runtime owner',f=>f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='other' WHERE tag_number=?").run(TAG)],
  ['current manual overlay',f=>f.sql.prepare("UPDATE blower_history_events SET source_type='manual' WHERE id='dataparc_runtime:prior-owner'").run()],
  ['saved runtime diverges',f=>f.sql.prepare('UPDATE blower_history_assets SET runtime_hours=runtime_hours+1 WHERE tag_number=?').run(TAG)],
  ['request no longer complete',f=>f.sql.prepare("UPDATE ois_data_requests SET status='failed' WHERE id='failed-append'").run()]
]) test(`cannot authorize a full query: ${label}`,async t=>{
  const f=await fixture(t);mutate(f);const before=f.asset(),events=f.events();
  await assert.rejects(f.proof(),error=>error.code==='BLOWER_BOUNDARY_RECOVERY_PROOF_REQUIRED');
  assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
});

test('a different requester, absent adapters, and a substituted non-v5 intent fail closed',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.proof({}, {employeeNo:'another-user'}),code('BLOWER_BOUNDARY_RECOVERY_FORBIDDEN'));
  await assert.rejects(f.proof({normalizeProbe:null}),code('BLOWER_BOUNDARY_RECOVERY_UNAVAILABLE'));
  await assert.rejects(f.proof({loadRuntimeIntent:async()=>({...f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5').get(),reuse_key:'legacy'})}),code('BLOWER_BOUNDARY_RECOVERY_PROOF_REQUIRED'));
});

test('client cannot switch the request, scope, start, revision, or recovery mode',async t=>{
  const f=await fixture(t),proof=await f.proof();
  for(const patch of [{appendBoundaryRecovery:false},{requireIncrementalAppend:true},{incrementalRefresh:true},
    {confirmedGapRecovery:true},{registeredRangeRecovery:true},{completionWindowRecovery:true},
    {boundaryFailureRequestId:'other'},{assetTag:'204SDF01AN001'},{dataParcTag:'GSPOGE.ABB_DCS.OTHERXB04'},
    {startAt:OWNER},{expectedCycleRuntimeRevision:'newer'},{unifiedRefresh:false}])
    assert.throws(()=>validateBoundaryRecoveryView({...f.body(),...patch},proof),error=>/^BLOWER_BOUNDARY_RECOVERY_/.test(error.code));
});

for(const [label,mutate] of [
  ['failed raw replacement',f=>f.mutateRaw(raw=>{raw.chunks[0].runningSeconds+=1;})],
  ['current total changes',f=>f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_hours=cycle_runtime_hours+1 WHERE tag_number=?').run(TAG)],
  ['new intervening event',f=>f.add('blower_history_events',{...f.events()[0],id:'new-event',event_type:'operation_start'})],
  ['request owner changes',f=>f.sql.prepare("UPDATE ois_data_requests SET requested_by_id='other' WHERE id='failed-append'").run()],
  ['v5 revision changes',f=>f.sql.prepare("UPDATE blower_runtime_probe_intents_v5 SET updated_at='changed' WHERE request_id='failed-append'").run()],
  ['append intent changes',f=>f.sql.prepare("UPDATE blower_runtime_append_v1 SET created_at='changed' WHERE request_id='failed-append'").run()]
]) test(`queue CAS rolls back the entire new request: ${label}`,async t=>{
  const f=await fixture(t),proof=await f.proof();mutate(f);
  await assert.rejects(f.queue('full-repair',proof),/CHECK constraint failed/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM boundary_queued_test').get().n,0);
  assert.equal(await loadBoundaryRecoveryIntent(f.db,'full-repair'),null);
});

test('apply rejects mutated proof, current state changes, and stale or forged full response',async t=>{
  const f=await fixture(t),{intent}=await f.queue();
  await assert.rejects(f.check({...intent,snapshot_sha256:'0'.repeat(64)}),code('BLOWER_BOUNDARY_RECOVERY_CONFLICT'));
  for(const patch of [{incremental:{}},{signalOnlyCycle:true},{startAt:BASE_END},{dataParcTag:'other'},
    {expectedCycleRuntimeRevision:BOUNDARY_RECOVERY_PREFIX+'runtime-r1'},{runtimeHours:null},{runningSeconds:-1},
    {collectedAt:'2026-11-06T00:00:00Z'}])
    await assert.rejects(f.check(intent,{...f.fullProbe(),...patch}),code('BLOWER_BOUNDARY_RECOVERY_CONFLICT'));
  f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_revision='changed' WHERE tag_number=?").run(TAG);
  await assert.rejects(f.check(intent),error=>/^BLOWER_BOUNDARY_RECOVERY_/.test(error.code));
});

test('full measurement must agree with saved plus delta within two seconds and actual end-time drift',async t=>{
  const f=await fixture(t),{intent}=await f.queue(),expected=BASE_SECONDS+DELTA_SECONDS;
  for(const total of [expected-2,expected,expected+122]) await f.check(intent,f.fullProbe({total}));
  for(const total of [expected-3,expected+123,BASE_SECONDS-3])
    await assert.rejects(f.check(intent,f.fullProbe({total})),code('BLOWER_BOUNDARY_RECOVERY_TOTAL_CONFLICT'));
  for(const end of [instant(Date.parse(FAILED_END)-1000),instant(Date.parse(FAILED_END)+15*60000+1000)])
    await assert.rejects(f.check(intent,f.fullProbe({end,total:expected}),{appendBoundaryRecovery:true},
      {now:new Date(Math.max(NOW.getTime(),Date.parse(end)))}),code('BLOWER_BOUNDARY_RECOVERY_TOTAL_CONFLICT'));
});

for(const [label,mutate] of [
  ['raw result changes',f=>f.mutateRaw(raw=>{raw.collectedAt=instant(Date.parse(raw.collectedAt)+1);})],
  ['new history event',f=>f.add('blower_history_events',{...f.events()[0],id:'intervening'})],
  ['proof row changes',f=>f.sql.prepare("UPDATE blower_boundary_recovery_intents_v1 SET failure_request_id='other' WHERE request_id='full-repair'").run()],
  ['current anchor changes',f=>f.sql.prepare('UPDATE blower_history_assets SET cycle_runtime_anchor_at=? WHERE tag_number=?').run(NOW.toISOString(),TAG)]
]) test(`apply CAS rejects after-check mutations without recording an apply: ${label}`,async t=>{
  const f=await fixture(t),{intent}=await f.queue(),result=await f.check(intent);mutate(f);
  await assert.rejects(f.applyGuard(result.guards),/CHECK constraint failed/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM boundary_applied_test').get().n,0);
});

for(const status of ['pending','processing','complete','failed'])
test(`lost-create lookup returns the single exact accepted ${status} request without writes`,async t=>{
  const f=await fixture(t);await f.acceptedLookup(status);
  const before=f.sql.prepare('SELECT total_changes() n').get().n,asset=f.asset(),events=f.events();
  assert.deepEqual(await findBoundaryRecoveryRequest(f.db,'failed-append',USER),{requestId:'full-repair'});
  assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
  assert.deepEqual(f.asset(),asset);assert.deepEqual(f.events(),events);
});

test('lost-create lookup returns null for unknown/unaccepted failure and never creates its schema',async t=>{
  const f=await fixture(t);
  assert.equal(await findBoundaryRecoveryRequest(f.db,'missing-request',USER),null);
  assert.equal(await findBoundaryRecoveryRequest(f.db,'failed-append',USER),null);
  f.sql.exec('DROP TABLE blower_boundary_recovery_intents_v1');
  const before=f.sql.prepare('SELECT total_changes() n').get().n;
  assert.equal(await findBoundaryRecoveryRequest(f.db,'failed-append',USER),null);
  assert.equal(f.sql.prepare("SELECT name FROM sqlite_master WHERE name='blower_boundary_recovery_intents_v1'").get(),undefined);
  assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,before);
});

test('lost-create lookup enforces original and accepted request ownership without tag-based inference',async t=>{
  const f=await fixture(t);await f.acceptedLookup();
  await assert.rejects(findBoundaryRecoveryRequest(f.db,'failed-append',{employeeNo:'another'}),code('BLOWER_BOUNDARY_RECOVERY_FORBIDDEN'));
  await assert.rejects(findBoundaryRecoveryRequest(f.db,'failed-append',null),code('BLOWER_BOUNDARY_RECOVERY_LOGIN_REQUIRED'));
  assert.deepEqual(await findBoundaryRecoveryRequest(f.db,'failed-append',{employeeNo:'admin',isSuperAdmin:true}),{requestId:'full-repair'});
  f.sql.prepare("UPDATE ois_data_requests SET requested_by_id='another' WHERE id='full-repair'").run();
  assert.equal(await findBoundaryRecoveryRequest(f.db,'failed-append',USER),null);
  await assert.rejects(findBoundaryRecoveryRequest(f.db,'failed-append',{employeeNo:'admin',isSuperAdmin:true}),code('BLOWER_BOUNDARY_RECOVERY_CONFLICT'));
});

for(const [label,query,args] of [
  ['unknown wire revision',"UPDATE blower_runtime_probe_intents_v5 SET expected_cycle_runtime_revision='ordinary' WHERE request_id='full-repair'",[]],
  ['ordinary reuse key',"UPDATE blower_runtime_probe_intents_v5 SET reuse_key='ordinary' WHERE request_id='full-repair'",[]],
  ['wrong full window',"UPDATE blower_runtime_probe_intents_v5 SET window_start=? WHERE request_id='full-repair'",[BASE_END]],
  ['different signal',"UPDATE blower_runtime_probe_intents_v5 SET dataparc_tag='GSPOGE.ABB_DCS.WRONGXB04' WHERE request_id='full-repair'",[]],
  ['wrong request type',"UPDATE ois_data_requests SET request_type='fbhe_vibration' WHERE id='full-repair'",[]],
  ['damaged snapshot',"UPDATE blower_boundary_recovery_intents_v1 SET snapshot_sha256='wrong' WHERE request_id='full-repair'",[]]
]) test(`lost-create lookup rejects ${label}`,async t=>{
  const f=await fixture(t);await f.acceptedLookup();f.sql.prepare(query).run(...args);
  await assert.rejects(findBoundaryRecoveryRequest(f.db,'failed-append',USER),code('BLOWER_BOUNDARY_RECOVERY_CONFLICT'));
});

test('lost-create lookup never chooses arbitrarily between two owned accepted requests',async t=>{
  const f=await fixture(t);await f.acceptedLookup();await f.acceptedLookup('complete','full-second');
  await assert.rejects(findBoundaryRecoveryRequest(f.db,'failed-append',USER),code('BLOWER_BOUNDARY_RECOVERY_AMBIGUOUS'));
});

test('actual API queue → reviewed Agent contract → boundary 409 → atomic full recovery → replay → ordinary append',async t=>{
  const NativeDate=Date;let clock=NOW.getTime();
  globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
  try {
    const f=await fixture(t);
    for(const table of ['blower_runtime_append_v1','blower_runtime_probe_intents_v5'])
      f.sql.prepare(`DELETE FROM ${table} WHERE request_id='failed-append'`).run();
    f.sql.prepare("DELETE FROM ois_data_requests WHERE id='failed-append'").run();
    const before=f.asset(),events=f.events();
    const normalBody=()=>{const value=f.body();delete value.appendBoundaryRecovery;delete value.boundaryFailureRequestId;
      return {...value,confirmRunSignal:true,incrementalRefresh:true,requireIncrementalAppend:true};};
    const sync=(id,extra={})=>callApi(historyPost,f.db,new Request('https://example.test/api/blower-history',{
      method:'POST',headers:{Authorization:'Bearer '+BROWSER_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify({action:'dataparc_runtime_sync',requestId:id,...extra})}));
    async function finish(item,total,startState='running',endState='stopped') {
      const claim=await agentClaim(f.db);assert.equal(claim.status,200,JSON.stringify(claim.body));
      const claimed=claim.body.items.excel;assert.equal(claimed.id,item.id);
      const expected=agent.parseClaim(claimed),chunks=ois.buildBlowerRuntimeProbeChunks(claimed.probe.startAt,claimed.probe.endAt);
      let remaining=total;
      for(const [index,chunk] of chunks.entries()) {
        const value=Math.min(remaining,Math.floor((Date.parse(chunk.endAt)-Date.parse(chunk.startAt))/1000));remaining-=value;
        Object.assign(chunk,{startState:index?endState:startState,endState,runningSeconds:value,
          totalRunningHours:Math.round(value/3600*1e6)/1e6});
      }
      assert.equal(remaining,0);
      const raw={...claimed.probe,ok:true,readOnly:true,observedAt:claimed.probe.endAt,collectedAt:new Date().toISOString(),
        completedChunkCount:chunks.length,startState,endState,runningSeconds:total,totalRunningHours:Math.round(total/3600*1e6)/1e6,chunks};
      const normalized=agent.normalizeResult(raw,expected);
      const completed=await agentComplete(f.db,item.id,normalized);
      assert.equal(completed.status,200,JSON.stringify(completed.body));return normalized;
    }
    const delta=await browserCreate(f.db,normalBody());assert.equal(delta.status,201,JSON.stringify(delta.body));
    await finish(delta.body.item,DELTA_SECONDS);
    const rejected=await sync(delta.body.item.id);
    assert.equal(rejected.status,409,JSON.stringify(rejected.body));assert.equal(rejected.body.code,'DATAPARC_APPEND_BOUNDARY_CHANGED');
    assert.equal(rejected.body.boundaryRecovery.eligible,true);assert.equal(rejected.body.boundaryRecovery.requestId,delta.body.item.id);
    assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
    const failedIntent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(delta.body.item.id);
    const failedRequest=f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(delta.body.item.id);
    clock+=120000;
    const recoveryBody={...f.body(),confirmRunSignal:true,boundaryFailureRequestId:delta.body.item.id};
    const concurrent=await Promise.all([1,2].map(()=>browserCreate(f.db,{action:'create_blower_runtime_probe_batch',requests:[recoveryBody]})));
    const queued=concurrent.find(reply=>reply.status===201);
    assert.ok(queued,JSON.stringify(concurrent));
    assert.ok(concurrent.every(reply=>[200,201,409].includes(reply.status)),JSON.stringify(concurrent));
    assert.equal(queued.status,201,JSON.stringify(queued.body));assert.equal(queued.body.atomic,true);
    const full=queued.body.results[0].item;
    assert.equal(f.sql.prepare('SELECT count(*) n FROM blower_boundary_recovery_intents_v1').get().n,1,'concurrent replay accepts only one full request');
    const replayPending=await browserCreate(f.db,{action:'create_blower_runtime_probe_batch',requests:[recoveryBody]});
    assert.equal(replayPending.status,200,JSON.stringify(replayPending.body));assert.equal(replayPending.body.results[0].item.id,full.id);
    assert.equal(full.probe.runtimeRecovery.mode,'append_boundary_full');assert.equal(Date.parse(full.probe.startAt),Date.parse(START));
    assert.equal(full.probe.expectedCycleRuntimeRevision,BOUNDARY_RECOVERY_PREFIX+before.cycle_runtime_revision);
    assert.deepEqual(f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(delta.body.item.id),failedIntent,
      'atomic full queue must not clear or rewrite the failed delta reuse key');
    assert.deepEqual(f.sql.prepare('SELECT * FROM ois_data_requests WHERE id=?').get(delta.body.item.id),failedRequest);
    const changes=f.sql.prepare('SELECT total_changes() n').get().n;
    assert.deepEqual(await findBoundaryRecoveryRequest(f.db,delta.body.item.id,USER),{requestId:full.id});
    assert.equal(f.sql.prepare('SELECT total_changes() n').get().n,changes,'lost-create lookup performs no write');
    const recovered=await callApi(requestsGet,f.db,new Request('https://example.test/api/ois-data-requests?action=boundary_recovery_status&failureRequestId='+encodeURIComponent(delta.body.item.id),
      {headers:{Authorization:'Bearer '+BROWSER_TOKEN}}));
    assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.equal(recovered.body.item.id,full.id);
    assert.equal(recovered.body.item.probe.runtimeRecovery.mode,'append_boundary_full');
    const privateUrl='https://example.test/api/ois-data-requests?action=boundary_recovery_status&failureRequestId='+encodeURIComponent(delta.body.item.id);
    const anonymous=await callApi(requestsGet,f.db,new Request(privateUrl));assert.equal(anonymous.status,401);
    addBrowserIdentity(f.sql,{employeeNo:'other-operator',token:'other-session',name:'Other',clock:Date.now()});
    const other=await callApi(requestsGet,f.db,new Request(privateUrl,{headers:{Authorization:'Bearer other-session'}}));
    assert.equal(other.status,403);assert.equal(other.body.item,undefined);
    const total=BASE_SECONDS+DELTA_SECONDS+60;
    await finish(full,total);assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
    const generic=await sync(full.id);assert.equal(generic.status,409);assert.equal(generic.body.code,'BLOWER_BOUNDARY_RECOVERY_INTENT_CONFLICT');
    const acceptedIntent=f.sql.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(full.id);
    const originalBatch=f.db.batch;let injected=false;
    f.db.batch=async statements=>{
      if(!injected && statements.some(statement=>/UPDATE blower_history_assets/.test(statement.sql))) {
        injected=true;f.sql.prepare('UPDATE blower_runtime_probe_intents_v5 SET updated_at=? WHERE request_id=?').run('changed-after-check',full.id);
      }
      return originalBatch.call(f.db,statements);
    };
    let raced;
    try {raced=await sync(full.id,{appendBoundaryRecovery:true});} finally {f.db.batch=originalBatch;}
    assert.equal(injected,true,'inject full intent change only after apply proof has been checked');
    assert.equal(raced.status,409,JSON.stringify(raced.body));assert.equal(raced.body.code,'DATAPARC_RUNTIME_CYCLE_CONFLICT');
    assert.deepEqual(f.asset(),before);assert.deepEqual(f.events(),events);
    f.sql.prepare('UPDATE blower_runtime_probe_intents_v5 SET updated_at=? WHERE request_id=?').run(acceptedIntent.updated_at,full.id);
    const applied=await sync(full.id,{appendBoundaryRecovery:true});
    assert.equal(applied.status,200,JSON.stringify(applied.body));assert.equal(applied.body.appendBoundaryRecovery,true);
    assert.equal(applied.body.incremental,undefined);assert.equal(applied.body.runtimeHours,total/3600);
    assert.equal(f.asset().runtime_hours,total/3600);assert.equal(f.asset().cycle_runtime_hours,total/3600);
    for(const key of ['last_replacement_at','cycle_started_at','cycle_start_state','cycle_start_revision']) assert.equal(f.asset()[key],before[key]);
    assert.deepEqual(f.events().find(row=>row.id===events[0].id),events[0]);
    assert.equal(f.events().some(row=>row.source_log_id===delta.body.item.id),false,'failed delta never writes a history total');
    const saved=f.asset(),savedEvents=f.events();
    const replay=await sync(full.id,{appendBoundaryRecovery:true});assert.equal(replay.status,200,JSON.stringify(replay.body));
    assert.equal(replay.body.replayed,true);assert.deepEqual(f.asset(),saved);assert.deepEqual(f.events(),savedEvents);
    clock+=3600000;
    const next=await browserCreate(f.db,normalBody());assert.equal(next.status,201,JSON.stringify(next.body));
    assert.equal(Date.parse(next.body.item.probe.startAt),Date.parse(full.probe.endAt));
    await finish(next.body.item,900,'stopped','running');
    const appended=await sync(next.body.item.id);assert.equal(appended.status,200,JSON.stringify(appended.body));
    assert.equal(appended.body.incremental,true);assert.equal(appended.body.runtimeHours,(total+900)/3600);
    // The production projection receives chronological history, not the ID
    // ordering used above for immutable-row comparisons. Random UUID ordering
    // must not choose an older receipt as the current one in this assertion.
    const projectionRows=f.sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY created_at DESC,event_date DESC,id DESC').all(TAG);
    const basis=history.currentDataParcRuntimeBasis(f.asset(),projectionRows);
    assert.equal(Date.parse(basis.startAt),Date.parse(START));assert.equal(basis.runningSeconds,total+900);assert.equal(basis.appendReady,true);
  } finally {globalThis.Date=NativeDate;}
});
