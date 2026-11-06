import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {__blowerHistoryTest as history} from '../functions/api/blower-history.js';
import {loadApprovedReplacementPage,replacementSourceGuard,storeReplacementLogReceipts} from '../functions/_shared/blower-replacement-log-source-v3.js';
import {reconcileApprovedReplacementLog} from '../functions/_shared/blower-replacement-auto-v3.js';
import {ROLE_RECOVERY_PREFIX,rolePriorityRecoveryProof} from '../functions/_shared/blower-role-recovery-v1.js';

const require=createRequire(import.meta.url);
const API_URL=new URL('../functions/api/ois-data-requests.js',import.meta.url);
const source=fs.readFileSync(API_URL,'utf8').replace(/from (["'])(\.\.?\/[^"']+)\1/g,
  (_,quote,relative)=>'from '+JSON.stringify(new URL(relative,API_URL).href));
const {__roleRecoveryQueue:queue}=await import('data:text/javascript;base64,'+Buffer.from(source+
  '\nexport const __roleRecoveryQueue={createBlowerRuntimeProbeRequest,buildBlowerRuntimeProbeChunks};').toString('base64'));
const TAG='103HRJ01AN601',SIGNAL='GSPOGE.ABB_DCS.103HRJ01AN601XB04';
const OLD='2026-09-18T14:20:00+09:00',SELECTED='2026-09-18T05:24:00.000Z';
const NOW=new Date(Math.floor(Date.now()/1000)*1000),BEFORE_END=new Date(NOW.getTime()-3600000).toISOString();
const OWNER={employeeNo:'selected-basis-owner',name:'Selected basis fixture',isSuperAdmin:false},TOKEN='selected-basis-session';
// Actual approved September18 wording retained in the existing role-priority
// regression: entry clock11:27, lower completion14:20, upper completion14:24.
const LOW_TEXT='Limestone Blower #A V-Belt 전량 파손 -> 14:20 Belt 교체 후 정상화';
const HIGH_TEXT='Limestone Blower #A V-Belt 전량 파손되어 투입 불가 상태\n- Manual Slide Close 및 Blower 정지 후 차단기 OFF -> 밸브 및 차단기 원복\n- <BM작업> 14:24 Blower #A V-Belt 전량 교체하여 정상화 완료';
const parse=async response=>({status:response.status,body:await response.json()});

async function fixture(t,{legacy=false,depthCheck=false}={}) {
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  let checkedGuards=0;
  const sqliteDepth=Number(sql.prepare('PRAGMA compile_options').all().find(row=>row.compile_options.startsWith('MAX_EXPR_DEPTH=')).compile_options.split('=')[1]);
  const db={beforeBatch:null,afterRead:null,prepare(query){
    if (depthCheck && query.includes('INSERT INTO blower_history_atomic_guard') && query.includes('CASE WHEN')) {
      sql.prepare('EXPLAIN '+query.replace(' THEN 1 ELSE 0 END)', ' AND 1'.repeat(sqliteDepth-100)+' THEN 1 ELSE 0 END)'));
      checkedGuards++;
    }
    return {query,values:[],bind(...values){assert.ok(values.length<=100,'D1 bind limit: '+values.length);this.values=values;return this;},
      async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.values).changes)}};},
      async first(){const row=sql.prepare(query).get(...this.values)||null;await db.afterRead?.(query,row);return row;},
      async all(){const rows=sql.prepare(query).all(...this.values);await db.afterRead?.(query,rows);return {results:rows};}};
  },async batch(items){if(db.beforeBatch && items.some(item=>item.query.includes('blower_role_recovery_intents_v1') || item.query.includes('role_priority_runtime_recovery') || item.values.includes('role_priority_runtime_recovery'))){const callback=db.beforeBatch;db.beforeBatch=null;await callback();}
    sql.exec('BEGIN IMMEDIATE');try{const results=[];for(const item of items)results.push(await item.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  await history.ensureSchema(db);await history.ensureIncrementalLogSchema(db);
  sql.exec(`CREATE TABLE users(employee_no TEXT PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    CREATE TABLE shift_log_sessions(token_hash TEXT PRIMARY KEY,employee_no TEXT,expires_at TEXT,last_used_at TEXT);
    CREATE TABLE shift_logs(id TEXT PRIMARY KEY,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,log_json TEXT,updated_at TEXT);
    CREATE INDEX idx_shift_work_date ON shift_logs(work_date,shift,role);
    CREATE TABLE legacy_logs(id INTEGER PRIMARY KEY,legacy_diary_id TEXT NOT NULL UNIQUE,work_date TEXT,shift TEXT,role TEXT,author TEXT,status TEXT,entries_json TEXT,original_json TEXT,updated_at TEXT);
    CREATE INDEX idx_legacy_work_date ON legacy_logs(work_date,shift,role);
    CREATE TABLE legacy_log_suppressions(legacy_diary_id TEXT NOT NULL,work_date TEXT NOT NULL,shift TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(legacy_diary_id,work_date,shift,role));
    CREATE TABLE ois_data_requests(id TEXT PRIMARY KEY NOT NULL,request_type TEXT NOT NULL,target_date TEXT NOT NULL,status TEXT NOT NULL,
      requested_by_id TEXT NOT NULL,requested_by_name TEXT NOT NULL,requested_at TEXT NOT NULL,started_at TEXT,completed_at TEXT,agent_id TEXT NOT NULL DEFAULT '',
      result_json TEXT,error_message TEXT NOT NULL DEFAULT '',expires_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  sql.prepare('INSERT INTO users VALUES(?,?,?,1)').run(OWNER.employeeNo,OWNER.name,'user');
  sql.prepare('INSERT INTO shift_log_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(TOKEN).digest('hex'),OWNER.employeeNo,new Date(NOW.getTime()+86400000).toISOString(),NOW.toISOString());
  sql.prepare(`UPDATE blower_history_assets SET last_replacement_at=?,cycle_start_state='legacy',cycle_started_at=NULL,
    cycle_start_revision='prior-start',cycle_runtime_revision='prior-runtime',cycle_runtime_hours=1000,runtime_hours=1000,
    cycle_runtime_anchor_at=?,runtime_anchor_at=?,cycle_runtime_state='running',is_running=1 WHERE tag_number=?`).run(OLD,BEFORE_END,BEFORE_END,TAG);
  const add=(table,row)=>sql.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  const event=patch=>add('blower_history_events',{id:'manual-replacement',tag_number:TAG,event_type:'replacement',event_date:OLD,runtime_hours:77,
    issue_type:'',action_type:'교체',note:'Preserved original manual replacement',source_type:'manual',source_log_id:'',source_text:'',
    created_by_id:'prior-owner',created_by_name:'Prior owner',created_at:'2026-09-18T06:00:00.000Z',updated_at:'2026-09-18T06:00:00.000Z',...patch});
  event({});
  event({id:'dataparc_runtime:prior-query',event_type:'runtime_correction',event_date:BEFORE_END,runtime_hours:1000,source_type:'dataparc_runtime',source_log_id:'prior-query',
    source_text:JSON.stringify({schemaVersion:1,requestType:'blower_runtime_probe',requestId:'prior-query',assetTag:TAG,dataParcTag:SIGNAL,
      startAt:OLD,endAt:BEFORE_END,observedAt:BEFORE_END,expectedLastReplacementAt:OLD,expectedCycleStartState:'legacy',expectedCycleStartedAt:'',
      expectedCycleStartRevision:'prior-start',expectedCycleRuntimeRevision:'older-runtime',startState:'running',endState:'running',runningSeconds:3600000,totalRunningHours:1000}),
    created_at:BEFORE_END,updated_at:BEFORE_END});
  const shift=(id,role,content)=>add('shift_logs',{id,work_date:'2026-09-18',shift:'DS',role,author:'Original source',status:'결재완료',
    log_json:JSON.stringify({id,date:'2026-09-18',shift:'DS',role,entries:[{id:role+'-job',time:'11:27',content}]}),updated_at:'2026-09-18T10:00:00Z'});
  shift('a-low','BO1',LOW_TEXT);
  if(legacy) add('legacy_logs',{id:901,legacy_diary_id:'POCHEON#20260918#DAY#BCO1',work_date:'2026-09-18',shift:'DS',role:'BCO1',author:'Original source',status:'결재완료',
    entries_json:'[]',original_json:JSON.stringify({body:[{id:'upper-job',index:2,time:'11:27',content:HIGH_TEXT}]}),updated_at:'2026-09-18T10:00:00Z'});
  else shift('z-high','BCO1',HIGH_TEXT);
  const seed=await loadApprovedReplacementPage(db,{limit:8},{now:NOW,analysisVersion:4});
  const assets=sql.prepare('SELECT * FROM blower_history_assets').all();
  for(const row of seed.logs){const response=await reconcileApprovedReplacementLog(db,OWNER,row,history.collectReplacementFactsForRolePriority(row,assets),
    {now:NOW,normalizationVersion:4,sourceGuard:replacementSourceGuard(row)});assert.equal(response.ok,true);}
  await storeReplacementLogReceipts(db,seed.logs,NOW);
  let window=null,cursor=null;
  for(let index=0;index<12;index++){const response=await parse(await history.latestLogsStep(db,OWNER,{phase:'replacement',incrementalLogs:true,
    replacementAutoVersion:3,normalizationVersion:4,autoApplyConfirmedReplacements:true,limit:2,window,cursor},{now:NOW}));
    assert.equal(response.status,200,JSON.stringify(response.body));if(response.body.done)break;window=response.body.window;cursor=response.body.nextCursor;}
  const asset=()=>sql.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get(TAG);
  const events=()=>sql.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id').all(TAG);
  assert.ok(rolePriorityRecoveryProof(asset(),events()),'fixture has current selected minute and owned prior RUN');
  const before=asset(),beforeEvents=events();
  const body=()=>{const a=asset();return {action:'create_blower_runtime_probe',assetTag:TAG,dataParcTag:SIGNAL,confirmRunSignal:true,rolePriorityRecovery:true,
    selectedCompletionAt:SELECTED,startAt:SELECTED,unifiedRefresh:true,incrementalRefresh:false,requireIncrementalAppend:false,
    expectedLastReplacementAt:a.last_replacement_at,expectedCycleStartState:a.cycle_start_state,expectedCycleStartedAt:a.cycle_started_at||'',
    expectedCycleStartRevision:a.cycle_start_revision,expectedCycleRuntimeRevision:a.cycle_runtime_revision};};
  const create=async(payload=body(),token=TOKEN)=>parse(await queue.createBlowerRuntimeProbeRequest({env:{DB:db},
    request:new Request('https://example.test/api/ois-data-requests',{headers:token?{Authorization:'Bearer '+token}:{}})},payload,{now:NOW}));
  async function completed(seconds=3601800) {
    const created=await create();assert.equal(created.status,201,JSON.stringify(created.body));const probe=created.body.item.probe;
    const chunks=queue.buildBlowerRuntimeProbeChunks(probe.startAt,probe.endAt);let accounted=0;
    const duration=(Date.parse(probe.endAt)-Date.parse(probe.startAt))/1000;
    for(const [index,chunk] of chunks.entries()) {const part=index===chunks.length-1?seconds-accounted:Math.floor(seconds*(Date.parse(chunk.endAt)-Date.parse(chunk.startAt))/1000/duration);
      accounted+=part;Object.assign(chunk,{startState:'running',endState:'running',runningSeconds:part,totalRunningHours:part/3600});}
    return {...probe,requestId:created.body.item.id,ok:true,readOnly:true,observedAt:probe.endAt,collectedAt:NOW.toISOString(),
      startState:'running',endState:'running',runningSeconds:seconds,totalRunningHours:seconds/3600,completedChunkCount:chunks.length,chunks};
  }
  const install=(raw,status='complete')=>sql.prepare('UPDATE ois_data_requests SET status=?,result_json=?,completed_at=? WHERE id=?').run(status,JSON.stringify(raw),raw.collectedAt,raw.requestId);
  const apply=(raw,user=OWNER,now=NOW)=>history.applyRolePriorityRuntimeRecovery(db,user,{requestId:raw.requestId},{now}).then(parse);
  const get=async(action='data')=>parse(await history.handleGet({env:{DB:db},request:new Request('https://example.test/api/blower-history?action='+action)},OWNER));
  const preserved=()=>{assert.deepEqual(asset(),before);assert.deepEqual(events(),beforeEvents);};
  const audits=()=>sql.prepare("SELECT * FROM blower_history_asset_history WHERE action_type='role_priority_runtime_recovery'").all();
  const mutateSource=()=>sql.prepare(legacy?"UPDATE legacy_logs SET original_json=replace(original_json,'14:24','14:25') WHERE id=901":"UPDATE shift_logs SET log_json=replace(log_json,'14:24','14:25') WHERE id='z-high'").run();
  return {sql,db,asset,events,before,beforeEvents,body,create,completed,install,apply,get,preserved,audits,mutateSource,checkedGuards:()=>checkedGuards};
}

function uiProof(data) {
  const context=vm.createContext({console,URL,URLSearchParams,navigator:{},fetch(){throw Error('Projection must not query');},
    localStorage:{getItem(){return JSON.stringify({sessionToken:TOKEN});}},document:{readyState:'loading',addEventListener(){}},
    window:{BlowerUnifiedRefresh:require('../maintenance/blower-unified-refresh.js'),BlowerRuntimeAssessment:require('../maintenance/blower-runtime-assessment.js'),matchMedia(){return {matches:false};},addEventListener(){}}});
  const source=fs.readFileSync(new URL('../maintenance/blower-history.js',import.meta.url),'utf8');
  const marker='  if (document.readyState === "loading") {';
  vm.runInContext(source.replace(marker,'globalThis.ui={state,rolePriorityRecoveryProof,allOverviewRuntimeAssessment};\n'+marker),context);
  context.ui.state.data=data;return context.ui;
}

test('normal data and planning expose the real source-owned14:24 action; queue retains14:20 and1000hours with old revisions',async t=>{
  const f=await fixture(t);
  for(const action of ['data','refresh_state_page']) {
    const response=await f.get(action);assert.equal(response.status,200,JSON.stringify(response.body));
    const a=response.body.assets.find(row=>row.tagNumber===TAG);assert.ok(a,'requested projection contains1A');
    assert.equal(a.replacementAutoCycle.rolePriorityRecoveryEligible,true);
    assert.equal(a.hasUnverifiedDataParcHistory,false);
    const ui=uiProof(response.body);assert.ok(ui.rolePriorityRecoveryProof(a));
    assert.equal(ui.allOverviewRuntimeAssessment(a).nextActionKey,'selected_basis_recovery');
  }
  f.preserved();const queued=await f.create();assert.equal(queued.status,201,JSON.stringify(queued.body));
  assert.equal(Date.parse(queued.body.item.probe.startAt),Date.parse(SELECTED));
  assert.equal(queued.body.item.probe.expectedLastReplacementAt,OLD);
  assert.equal(queued.body.item.probe.expectedCycleRuntimeRevision,ROLE_RECOVERY_PREFIX+'prior-runtime');
  assert.equal(f.audits().length,0);f.preserved();
  const again=await f.create();assert.equal(again.status,200);assert.equal(again.body.item.id,queued.body.item.id);f.preserved();
});

for(const legacy of [false,true]) test('complete '+(legacy?'legacy':'canonical')+' source recovery atomically adopts14:24, preserves raw result, and enables normal append',async t=>{
  const f=await fixture(t,{legacy,depthCheck:true});const raw=await f.completed();f.install(raw);f.preserved();
  const normal=await parse(await history.applyDataParcRuntimeSync(f.db,OWNER,{requestId:raw.requestId},{now:NOW}));
  assert.equal(normal.status,409);assert.equal(normal.body.code,'BLOWER_ROLE_RECOVERY_APPLY_REQUIRED');f.preserved();
  const result=await f.apply(raw);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.applied,true);
  const a=f.asset();assert.equal(a.last_replacement_at,SELECTED);assert.equal(a.cycle_runtime_hours,1000.5);
  assert.notEqual(a.cycle_start_revision,f.before.cycle_start_revision);assert.notEqual(a.cycle_runtime_revision,f.before.cycle_runtime_revision);
  assert.equal(f.events().find(row=>row.id==='manual-replacement').event_date,SELECTED);
  assert.equal(f.sql.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(raw.requestId).result_json,JSON.stringify(raw));
  const audit=f.audits()[0];assert.ok(audit);assert.equal(JSON.parse(audit.before_json).asset.last_replacement_at,OLD);
  assert.equal(JSON.parse(audit.before_json).events.find(row=>row.id==='manual-replacement').event_date,OLD);
  const saved=JSON.parse(f.events().find(row=>row.source_log_id===raw.requestId).source_text);
  assert.equal(saved.expectedLastReplacementAt,SELECTED);assert.equal(saved.basisRecovery.queryExpectedLastReplacementAt,OLD);
  assert.equal(saved.basisRecovery.queryExpectedCycleRuntimeRevision,raw.expectedCycleRuntimeRevision);
  assert.equal(saved.basisRecovery.auditId,audit.id);assert.match(JSON.parse(audit.after_json).receiptDerivation,/Raw query/);
  const data=await f.get();const projected=data.body.assets.find(row=>row.tagNumber===TAG);
  assert.equal(projected.actualLastReplacementAt,SELECTED);assert.equal(projected.dataParcRuntimeBasis.coverageComplete,true);
  assert.equal(projected.dataParcRuntimeBasis.appendReady,true);assert.equal(projected.runtimeCoverageEvidence.wholeCycleVerified,true);
  assert.ok(!projected.cycleSourceReview);assert.notEqual(projected.replacementAutoCycle.rolePriorityRecoveryEligible,true);
  const after=f.asset(),afterEvents=f.events();const replay=await f.apply(raw,OWNER,new Date(NOW.getTime()+86400000));
  assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.replayed,true);assert.deepEqual(f.asset(),after);assert.deepEqual(f.events(),afterEvents);
  const payload={...f.body(),rolePriorityRecovery:false,incrementalRefresh:true,requireIncrementalAppend:true};delete payload.startAt;delete payload.selectedCompletionAt;
  const append=await parse(await queue.createBlowerRuntimeProbeRequest({env:{DB:f.db},request:new Request('https://example.test/api/ois-data-requests',{headers:{Authorization:'Bearer '+TOKEN}})},payload,{now:new Date(NOW.getTime()+60000)}));
  assert.equal(append.status,201,JSON.stringify(append.body));assert.equal(Date.parse(append.body.item.probe.startAt),Date.parse(raw.endAt));
  assert.match(append.body.item.probe.expectedCycleRuntimeRevision,/^append-v1:/);assert.ok(f.checkedGuards()>3);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});

test('queue requires authentication, exact displayed snapshots and a server-selected full-query boundary',async t=>{
  const f=await fixture(t);
  const unauthenticated=await f.create(f.body(),'');assert.equal(unauthenticated.status,401);
  const cases=[
    ['selectedCompletionAt','2026-09-18T05:25:00.000Z'],['startAt',OLD],['expectedLastReplacementAt',SELECTED],
    ['expectedCycleStartRevision','changed'],['expectedCycleRuntimeRevision','changed'],['expectedCycleStartedAt',SELECTED],
    ['expectedCycleStartState','started'],['incrementalRefresh',true],['requireIncrementalAppend',true],['dataParcTag','GSPOGE.ABB_DCS.TEST_ONLY_BINARY_103HRJ01AN601']
  ];
  for(const [key,value] of cases){const response=await f.create({...f.body(),[key]:value});assert.ok([400,409].includes(response.status),key+JSON.stringify(response));f.preserved();}
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n,0);assert.equal(f.audits().length,0);
});

test('day-only, revoked, different-owner and damaged saved RUN proofs never enable recovery',async t=>{
  const f=await fixture(t),original=f.events();
  const certificate=original.find(row=>JSON.parse(row.source_text || '{}').rolePrioritySelection);
  assert.ok(certificate);
  for(const mode of ['day','revoked','wrong-owner','wrong-minute','bad-receipt','different-tag','started']) {
    const asset={...f.before},events=structuredClone(original),row=events.find(row=>row.id===certificate.id),meta=JSON.parse(row.source_text);
    if(mode==='day'){meta.timePrecision='day';meta.rolePrioritySelection.timePrecision='day';meta.rolePrioritySelection.selectedCompletionAt='';}
    if(mode==='revoked')meta.sourceRevisionSuperseded=true;
    if(mode==='wrong-owner')meta.replacementEventId='unrelated';
    if(mode==='wrong-minute')meta.rolePrioritySelection.selectedCompletionAt='2026-09-18T05:24:30.000Z';
    if(mode==='bad-receipt')events.find(row=>row.source_type==='dataparc_runtime').updated_at=NOW.toISOString();
    if(mode==='different-tag')asset.tag_number='203HRJ01AN601';
    if(mode==='started'){asset.cycle_start_state='started';asset.cycle_started_at=OLD;}
    row.source_text=JSON.stringify(meta);assert.equal(rolePriorityRecoveryProof(asset,events),null,mode);
  }
  f.preserved();
});

for(const mode of ['edited-selected','deleted-selected','unapproved-selected','suppressed-selected','late-peer','excluded','missing-suppression'])
  test('current source '+mode+' blocks queue without changing old owner or counter',async t=>{
    const f=await fixture(t,{legacy:mode==='suppressed-selected'});
    if(mode==='edited-selected')f.mutateSource();
    if(mode==='deleted-selected')f.sql.prepare("DELETE FROM shift_logs WHERE id='z-high'").run();
    if(mode==='unapproved-selected')f.sql.prepare("UPDATE shift_logs SET status='작성중' WHERE id='z-high'").run();
    if(mode==='suppressed-selected')f.sql.prepare('INSERT INTO legacy_log_suppressions VALUES(?,?,?,?)').run('POCHEON#20260918#DAY#BCO1','2026-09-18','DS','BCO1');
    if(mode==='late-peer')f.sql.prepare("INSERT INTO shift_logs SELECT 'new-upper',work_date,shift,role,author,status,log_json,updated_at FROM shift_logs WHERE id='z-high'").run();
    if(mode==='excluded')f.sql.prepare(`INSERT INTO blower_history_candidates (id,source_fingerprint,tag_number,detected_type,detected_date,source_log_id,source_text,status,created_at)
      VALUES('excluded-source','excluded-source',?,'replacement',?,'z-high',?,'excluded',?)`).run(TAG,OLD,HIGH_TEXT,NOW.toISOString());
    if(mode==='missing-suppression')f.sql.exec('DROP TABLE legacy_log_suppressions');
    const response=await f.create();assert.equal(response.status,409,JSON.stringify(response.body));f.preserved();
    assert.equal(f.audits().length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n,0);
  });

for(const legacy of [false,true]) test('source changes inside '+(legacy?'legacy':'canonical')+' queue transaction fail the final source guard',async t=>{
  const f=await fixture(t,{legacy});f.db.beforeBatch=()=>f.mutateSource();const response=await f.create();
  assert.equal(response.status,409,JSON.stringify(response.body));assert.equal(response.body.code,'BLOWER_ROLE_RECOVERY_CONFLICT');f.preserved();
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM ois_data_requests').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_role_recovery_intents_v1').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});

test('failed, incomplete, wrong-signal, wrong-period and stale results cannot change the selected basis',async t=>{
  const f=await fixture(t),raw=await f.completed();
  const cases=[['failed',{},'failed'],['partial',{completedChunkCount:raw.chunkCount-1}],['signal',{dataParcTag:'GSPOGE.ABB_DCS.203HRJ01AN601XB04'}],
    ['revision',{expectedCycleRuntimeRevision:'prior-runtime'}],['start',{startAt:OLD}],['total',{runningSeconds:raw.runningSeconds+50000}],
    ['extra-append',{incremental:{version:1}}]];
  for(const [name,patch,status='complete'] of cases){const changed={...structuredClone(raw),...patch};f.install(changed,status);const response=await f.apply(changed);
    assert.ok(response.status>=400,name+JSON.stringify(response));f.preserved();assert.equal(f.audits().length,0);}
  f.install(raw);const stale=await f.apply(raw,OWNER,new Date(NOW.getTime()+3600000));assert.equal(stale.status,409);assert.equal(stale.body.code,'DATAPARC_RUNTIME_PROBE_STALE');f.preserved();
  const other=await f.apply(raw,{employeeNo:'different-user',name:'Other'});assert.equal(other.status,403);f.preserved();
});

for(const seconds of [0,3605000]) test('complete but overlap-inconsistent RUN total '+seconds+' preserves the old verified total',async t=>{
  const f=await fixture(t),raw=await f.completed(seconds);f.install(raw);const response=await f.apply(raw);
  assert.equal(response.status,409,JSON.stringify(response.body));assert.equal(response.body.code,'BLOWER_ROLE_RECOVERY_TOTAL_CONFLICT');f.preserved();assert.equal(f.audits().length,0);
});

for(const mode of ['source-before','source-during','runtime-before','runtime-during','owner-during','result-during','new-peer-during'])
  test('apply preserves concurrent '+mode+' changes and creates no partial adoption',async t=>{
    const f=await fixture(t),raw=await f.completed();f.install(raw);
    let expectedAsset=f.asset(),expectedEvents=f.events();
    const mutate=()=>{
      if(mode.startsWith('source'))f.mutateSource();
      if(mode.startsWith('runtime'))f.sql.prepare("UPDATE blower_history_assets SET cycle_runtime_hours=1000.2,runtime_hours=1000.2,cycle_runtime_revision='concurrent-runtime' WHERE tag_number=?").run(TAG);
      if(mode==='owner-during')f.sql.prepare("UPDATE blower_history_events SET note='concurrent owner edit',updated_at=? WHERE id='manual-replacement'").run(NOW.toISOString());
      if(mode==='result-during')f.sql.prepare('UPDATE ois_data_requests SET result_json=? WHERE id=?').run(JSON.stringify({...raw,unexpected:'concurrent result'}),raw.requestId);
      if(mode==='new-peer-during')f.sql.prepare("INSERT INTO shift_logs SELECT 'new-peer',work_date,shift,role,author,status,log_json,updated_at FROM shift_logs WHERE id='z-high'").run();
      expectedAsset=f.asset();expectedEvents=f.events();
    };
    if(mode.endsWith('before'))mutate();else f.db.beforeBatch=mutate;
    const response=await f.apply(raw);assert.equal(response.status,409,JSON.stringify(response.body));
    assert.deepEqual(f.asset(),expectedAsset);assert.deepEqual(f.events(),expectedEvents);assert.equal(f.audits().length,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
  });

test('a failed receipt insert rolls back the earlier audit, owner correction and measured asset update together',async t=>{
  const f=await fixture(t),raw=await f.completed();f.install(raw);
  f.sql.exec("CREATE TRIGGER reject_recovery_runtime BEFORE INSERT ON blower_history_events WHEN NEW.source_type='dataparc_runtime' BEGIN SELECT RAISE(ABORT,'fixture receipt insert failure'); END");
  await assert.rejects(()=>f.apply(raw),/fixture receipt insert failure/);f.preserved();assert.equal(f.audits().length,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
  f.sql.exec('DROP TRIGGER reject_recovery_runtime');const result=await f.apply(raw);assert.equal(result.status,200,JSON.stringify(result.body));
});

test('damaged adoption receipt is never recreated or silently replayed',async t=>{
  const f=await fixture(t),raw=await f.completed();f.install(raw);assert.equal((await f.apply(raw)).status,200);
  f.sql.prepare("UPDATE blower_history_events SET source_text='{}' WHERE id=?").run('dataparc_runtime:'+raw.requestId);
  const after=f.asset(),events=f.events();const replay=await f.apply(raw);assert.equal(replay.status,409);assert.equal(replay.body.code,'BLOWER_ROLE_RECOVERY_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(f.asset(),after);assert.deepEqual(f.events(),events);assert.equal(f.audits().length,1);
});

test('an identical apply winning between proof read and CAS is a verified replay with one adoption',async t=>{
  const f=await fixture(t),raw=await f.completed();f.install(raw);let winner;
  f.db.beforeBatch=async()=>{winner=await f.apply(raw);};
  const second=await f.apply(raw);
  assert.equal(winner.status,200,JSON.stringify(winner.body));assert.equal(winner.body.applied,true);
  assert.equal(second.status,200,JSON.stringify(second.body));assert.equal(second.body.replayed,true);assert.equal(second.body.applied,false);
  assert.equal(f.audits().length,1);assert.equal(f.events().filter(row=>row.source_log_id===raw.requestId).length,1);
  assert.equal(f.asset().last_replacement_at,SELECTED);assert.equal(f.asset().cycle_runtime_hours,1000.5);
  assert.equal(f.sql.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(raw.requestId).result_json,JSON.stringify(raw));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});

test('a racing adoption followed by raw-result damage is not falsely reported as an identical replay',async t=>{
  const f=await fixture(t),raw=await f.completed();f.install(raw);let after,events;
  f.db.beforeBatch=async()=>{assert.equal((await f.apply(raw)).status,200);
    f.sql.prepare('UPDATE ois_data_requests SET result_json=? WHERE id=?').run(JSON.stringify({...raw,changedAfterAdoption:true}),raw.requestId);
    after=f.asset();events=f.events();};
  const response=await f.apply(raw);assert.equal(response.status,409);assert.equal(response.body.code,'BLOWER_ROLE_RECOVERY_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(f.asset(),after);assert.deepEqual(f.events(),events);assert.equal(f.audits().length,1);
});

test('an identical winner immediately after an absent audit read is verified from one replay snapshot',async t=>{
  const f=await fixture(t),raw=await f.completed();f.install(raw);let winner,interleaved=false;
  f.db.afterRead=async(query,rows)=>{
    if(!query.includes('blower_history_asset_history'))return;
    f.db.afterRead=null;interleaved=true;
    // The former separate audit SELECT returned null here; the new join sees
    // no audit AND no event in its single snapshot. The winner commits before
    // control resumes, reproducing the reviewed audit-read/event-read race.
    if(Array.isArray(rows)){assert.equal(rows[0].audit_id,null);assert.equal(rows[0].event_id,null);}
    else assert.equal(rows,null);
    winner=await f.apply(raw);
  };
  const response=await f.apply(raw);assert.equal(interleaved,true);
  assert.equal(winner.status,200,JSON.stringify(winner.body));assert.equal(winner.body.applied,true);
  assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.replayed,true);
  assert.equal(f.audits().length,1);assert.equal(f.events().filter(row=>row.source_log_id===raw.requestId).length,1);
  assert.equal(f.asset().last_replacement_at,SELECTED);assert.equal(f.asset().cycle_runtime_hours,1000.5);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM blower_history_atomic_guard').get().n,0);
});
