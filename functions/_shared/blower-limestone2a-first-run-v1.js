import {verifiedAppendBase,limestone2aRawTailChain,LIMESTONE2A_TAG as TAG,LIMESTONE2A_SIGNAL as SIGNAL,
 LIMESTONE2A_START as START,LIMESTONE2A_FIRST_RUN as FIRST,LIMESTONE2A_SEAM as SEAM,
 LIMESTONE2A_CYCLE_PREFIX as CYCLE,LIMESTONE2A_SOURCE as SOURCE} from './blower-incremental.js';
import {loadCurrentReplacementRoleContext,replacementSourceHashes,replacementSourceGuard} from './blower-replacement-log-source-v3.js';
import {replacementAutoCycleProof} from './blower-replacement-auto-v3.js';
import {verifyR9Periods} from './blower-r9-signal-v1.js';
import {convertBlowerRuntimeProbeIntentRow,normalizeBlowerRuntimeProbeResult} from '../api/ois-data-requests.js';

/* Closed Sep19 Limestone2A duration recovery. A current authenticated operator
 * confirms that the observed first RUN followed the completed belt job. This
 * proves RUN attribution, never a completion minute or sample-GOOD quality.
 * The completed historical R9 and every old-tail receipt remain immutable. */
const DAY='2026-09-19',OWNER='replacement-auto-v3:303f92e0db83b280551fdc45a570e371bad3d7a1e88a9b0265d0b8727cc6e05b';
const BO2='legacy-POCHEON#20260919#DAY#BO2',BCO2='legacy-POCHEON#20260919#DAY#BCO2';
const BO_ENTRY='legacy-entry-POCHEON#20260919#DAY#BO2-2-0',BCO_ENTRY='legacy-entry-POCHEON#20260919#DAY#BCO2-2-0';
const COMPLETION='[TM작업]#2 BLR Limestone Blower #A V-Belt 손상 교체 요청\n→ Belt 전부 교체 완료. 차단기 투입 후 기동중';
const WORK='Limestone Blower #A Belt 교체',AUDIT='limestone2a_first_run_recovery',ID='lime2a_first_run:',EVENT_ID='dataparc_limestone2a_first_run:';
const STATEMENT='BELT_COMPLETED_BEFORE_FIRST_RUN',CONFIRM='LIMESTONE_2A_FIRST_RUN_20260919',WIRE='r7-evidence-only-v1:r9_signal_v1:';
const text=v=>String(v??'').trim(),parse=v=>{try{return JSON.parse(v)}catch{return null}},at=v=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const same=(a,b)=>Number.isFinite(at(a))&&at(a)===at(b),content=v=>text(v).replace(/\s+/g,' ');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>JSON.stringify(canonical(v)),sha=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const col=v=>'"'+v.replace(/"/g,'""')+'"',fail=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status})};
const conflict=()=>fail('LIME2A_FIRST_RUN_CONFLICT','교체 근거 또는 보존된 RUN 구간이 변경되었습니다. 현재 결과를 다시 확인해 주세요. 기존값은 유지합니다.');
const authorize=user=>{if(!text(user?.employeeNo)||user?.isSuperAdmin!==true)fail('LIME2A_FIRST_RUN_FORBIDDEN','최고관리자만 확인한 첫 기동 근거를 반영할 수 있습니다.',403)};
const nowDate=options=>options?.now instanceof Date?options.now:new Date();
const insert=(db,t,r)=>db.prepare(`INSERT INTO ${t} (${Object.keys(r).map(col).join(',')}) VALUES (${Object.keys(r).map(()=>'?').join(',')})`).bind(...Object.values(r));
const exists=(table,row)=>({sql:`EXISTS(SELECT 1 FROM ${table} t CROSS JOIN json_each(?) j WHERE j.key='row' AND ${Object.keys(row).map(k=>`t.${col(k)} IS json_extract(j.value,'$.${k}')`).join(' AND ')})`,values:[JSON.stringify({row})]});
const rowsExist=(table,key,rows)=>({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN ${table} t ON t.${col(key)} IS json_extract(j.value,'$.${key}') WHERE t.${col(key)} IS NULL OR NOT(${Object.keys(rows[0]||{[key]:null}).map(k=>`t.${col(k)} IS json_extract(j.value,'$.${k}')`).join(' AND ')}))`,values:[JSON.stringify(rows)]});
const eventsEqual=rows=>({sql:`(SELECT COUNT(*) FROM blower_history_events WHERE tag_number=?)=json_array_length(?) AND NOT EXISTS(SELECT 1 FROM blower_history_events t LEFT JOIN json_each(?) j ON t.id=json_extract(j.value,'$.id') WHERE t.tag_number=? AND(j.value IS NULL OR NOT(${Object.keys(rows[0]||{id:null}).map(k=>`t.${col(k)} IS json_extract(j.value,'$.${k}')`).join(' AND ')})))`,values:[TAG,JSON.stringify(rows),JSON.stringify(rows),TAG]});
const guardPlan=(db,checks)=>{const ids=checks.map(()=>crypto.randomUUID());return {ids,statements:checks.map((c,n)=>db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN (${c.sql}) THEN 1 ELSE 0 END)`).bind(ids[n],...c.values))};};
const cleanup=(db,ids)=>db.prepare(`DELETE FROM blower_history_atomic_guard WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids);
const badQuality=r=>!r||r.fromCachedResult===true||r.fromManualOverride===true||r.estimated===true||['missingSeconds','badQualitySeconds','estimatedSeconds'].some(k=>r[k]!==undefined&&r[k]!==0)||(Array.isArray(r.chunks)&&r.chunks.some(badQuality));

export async function loadLimestone2aApprovedCompletion(db,options={}){
 const {logs,coverageIssues}=await loadCurrentReplacementRoleContext(db,{workDate:DAY,shift:'DS'},options);
 if(coverageIssues.length)fail('LIME2A_FIRST_RUN_SOURCE_COVERAGE','현재 승인 원문과 삭제·제외 여부를 모두 확인할 수 없습니다.');
 const sources=[];for(const [id,role,entryId,time,expected]of [[BO2,'BO2',BO_ENTRY,'',COMPLETION],[BCO2,'BCO2',BCO_ENTRY,'10:00',WORK]]){
  const selected=logs.filter(row=>[row.id,...(row.sourceAliases||[])].includes(id));
  if(selected.length!==1)fail('LIME2A_FIRST_RUN_SOURCE_REQUIRED','9월 19일의 승인 교체·운전 원문을 확인할 수 없습니다.');
  const row=selected[0],entries=parse(row.log_json)?.entries,entry=Array.isArray(entries)?entries.filter(e=>e.id===entryId):[];
  if(row.sourceTable!=='shift_logs'||row.id!==id||row.work_date!==DAY||row.role!==role||!['DS','DAY'].includes(row.shift)||
   entry.length!==1||text(entry[0].time)!==time||content(entry[0].content)!==content(expected)||Object.hasOwn(entry[0],'vBeltReplacement'))
   fail('LIME2A_FIRST_RUN_SOURCE_CHANGED','검토한 교체 완료와 차단기 투입·기동 순서의 원문이 변경되었습니다. 기존값을 유지합니다.');
  sources.push(row);
 }
 // The role-context fingerprints/guards include peers and their absence. Also
 // reject a competing approved target job already present when we read them;
 // a fresh fingerprint alone cannot turn that competing job into this one.
 for(const row of logs){const log=parse(row.log_json),entries=['entries','tmEntries','handoverEntries','remarkEntries'].flatMap(k=>Array.isArray(log?.[k])?log[k]:[]);
  for(const entry of entries){const body=content(entry?.content),declared=entry?.vBeltReplacement?.targets?.some(t=>text(t.tagNumber)===TAG),
   target=body.includes(TAG)||/Limestone\s*Blower\s*#\s*A\b/i.test(body)&&(['BCO2','BO2'].includes(row.role)||/(?:#\s*2\s*(?:BLR|보일러)|2\s*호기)/i.test(body)),
   completion=/(?:V\s*[- ]?\s*B[ea]lt|Belt|벨트)/i.test(body)&&/교체\s*(?:작업\s*)?완료/.test(body);
   if((declared||target&&completion)&&!(row.id===BO2&&entry.id===BO_ENTRY&&content(entry.content)===content(COMPLETION)&&!Object.hasOwn(entry,'vBeltReplacement')))
    fail('LIME2A_FIRST_RUN_SOURCE_CONFLICT','같은 날 해당 설비의 다른 승인 교체 근거가 있어 첫 기동 귀속을 다시 확인해야 합니다.');
  }
 }
 const hashes=[];for(const row of sources)hashes.push({sourceLogId:row.id,sourceTable:row.sourceTable,...await replacementSourceHashes(row)});
 const aliases=[...new Set(logs.flatMap(row=>[row.id,...(row.sourceAliases||[])]))].sort();
 const excluded={sql:`NOT EXISTS(SELECT 1 FROM blower_history_candidates WHERE tag_number=? AND status='excluded' AND detected_type='replacement' AND source_log_id IN(SELECT value FROM json_each(?)))`,values:[TAG,JSON.stringify(aliases)]};
 if(!(await db.prepare(`SELECT CASE WHEN ${excluded.sql} THEN 1 ELSE 0 END valid`).bind(...excluded.values).first())?.valid)fail('LIME2A_FIRST_RUN_SOURCE_EXCLUDED','이 교체 작업에 제외 처리한 근거가 있습니다.');
 return {sources,hashes,sourceProofHash:await sha(encode({version:1,completionDay:DAY,hashes})),guards:[...sources.map(replacementSourceGuard),excluded]};
}

// Archive integrity is validated at the real stored completion time. Historical
// evidence has no artificial 15-minute expiry; current sources/cycle/tail are
// independently read again and guarded atomically when the operator applies.
export function validateLimestone2aPrefix(q,i){
 const raw=parse(q?.result_json),before=i&&text(i.expected_cycle_start_revision).replace(/^signal-only-v1:/,'');
 if(!q||q.status!=='complete'||q.request_type!=='blower_runtime_probe'||!i||i.request_id!==q.id||Number(i.schema_version)!==1||i.asset_tag!==TAG||i.dataparc_tag!==SIGNAL||
  i.window_start!==START||i.window_end!==SEAM||Number(i.chunk_days)!==31||Number(i.chunk_count)!==1||!same(i.expected_last_replacement_at,START)||
  i.expected_cycle_start_state!=='legacy'||text(i.expected_cycle_started_at)||!before||!text(i.expected_cycle_runtime_revision).startsWith(WIRE)||
  q.target_date!==`v1|${TAG}|${START}|${SEAM}`||!Number.isFinite(at(q.requested_at))||!Number.isFinite(at(q.completed_at))||at(q.completed_at)<at(q.requested_at)||badQuality(raw))
  fail('LIME2A_FIRST_RUN_PREFIX_INVALID','완료된 9월 19일 R9 원본 요청·신호·기간을 확인할 수 없습니다.');
 const norm=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(i),q.id,new Date(q.completed_at)),verified=verifyR9Periods(raw,q.id,TAG,DAY);
 if(norm.error||!verified.ok||raw.requestId!==q.id||raw.expectedCycleRuntimeRevision!==i.expected_cycle_runtime_revision||
  raw.runningSeconds!==50494||raw.startState!=='stopped'||raw.endState!=='running'||verified.periods.length!==1||
  Math.floor(at(verified.periods[0]?.startAt)/1000)!==Math.floor(at(FIRST)/1000)||!same(verified.periods[0]?.endAt,SEAM)||
  verified.periods[0]?.startKind!=='start_signal'||verified.periods[0]?.endKind!=='window_boundary'||
  at(norm.result.collectedAt)<at(q.requested_at)||at(norm.result.collectedAt)>at(q.completed_at)+300000)
  fail('LIME2A_FIRST_RUN_PREFIX_INVALID','R9의 단일 첫 RUN·정지 앞 구간·50,494초 근거가 검토한 결과와 다릅니다.');
 return {...norm.result,firstRunAt:verified.periods[0].startAt};
}
export function validateLimestone2aTailRequest(q,intent,saved){
 if(!q||!intent||!saved||!Number.isFinite(at(q.requested_at))||!Number.isFinite(at(q.completed_at))||at(q.completed_at)<at(q.requested_at))fail('LIME2A_FIRST_RUN_TAIL_REQUEST_INVALID','보존된 RUN 요청의 수집시각을 확인할 수 없습니다.');
 const raw=parse(q.result_json);let norm;try{norm=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(intent),q.id,new Date(q.completed_at))}catch{fail('LIME2A_FIRST_RUN_TAIL_REQUEST_INVALID','보존된 RUN 요청 형식이 올바르지 않습니다.');}
 const r=norm?.result,signalOnly=String(r?.expectedCycleStartRevision||'').startsWith('signal-only-v1:'),
  startRevision=text(r?.expectedCycleStartRevision).replace(/^signal-only-v1:/,''),runtimeRevision=text(r?.expectedCycleRuntimeRevision).replace(/^append-v1:/,'');
 if(!q||!intent||!saved||q.id!==intent.request_id||q.id!==saved.requestId||q.status!=='complete'||q.request_type!=='blower_runtime_probe'||
  q.target_date!==`v1|${TAG}|${intent.window_start}|${intent.window_end}`||!Number.isFinite(at(q.requested_at))||!Number.isFinite(at(q.completed_at))||at(q.completed_at)<at(q.requested_at)||
  norm?.error||!r||badQuality(raw)||r.schemaVersion!==1||r.requestType!=='blower_runtime_probe'||r.requestId!==saved.requestId||r.assetTag!==TAG||saved.assetTag!==TAG||r.dataParcTag!==SIGNAL||saved.dataParcTag!==SIGNAL||
  r.expectedCycleStartState!==saved.expectedCycleStartState||text(r.expectedCycleStartedAt)!==text(saved.expectedCycleStartedAt)||!same(r.expectedLastReplacementAt,saved.expectedLastReplacementAt)||
  startRevision!==saved.expectedCycleStartRevision||runtimeRevision!==saved.expectedCycleRuntimeRevision||signalOnly!==(saved.signalOnlyCycle===true)||
  r.runningSeconds!==saved.runningSeconds||r.chunkCount!==saved.chunkCount||!same(r.collectedAt,saved.collectedAt)||!same(r.startAt,saved.startAt)||!same(r.endAt,saved.endAt)||!same(r.observedAt,saved.observedAt)||r.startState!==saved.startState||r.endState!==saved.endState||
  !Number.isFinite(at(r.collectedAt))||at(r.collectedAt)<at(q.requested_at)||at(r.collectedAt)>at(q.completed_at)+300000)
  fail('LIME2A_FIRST_RUN_TAIL_REQUEST_INVALID','기존 RUN의 원본 조건·Cycle·수집시각·상태·합계 근거가 일치하지 않습니다.');
 return r;
}
export function validateLimestone2aPrefixCycle(intent,asset,chain){
 const revision=text(intent?.expected_cycle_runtime_revision),suffix=revision.startsWith(WIRE)?revision.slice(WIRE.length):'',known=new Set([asset?.cycle_runtime_revision,...(chain?.chain||[]).map(node=>node.source?.expectedCycleRuntimeRevision)]);
 if(!suffix||!known.has(suffix)||text(intent.expected_cycle_start_revision).replace(/^signal-only-v1:/,'')!==asset?.cycle_start_revision||!same(intent.expected_last_replacement_at,asset.last_replacement_at))
  fail('LIME2A_FIRST_RUN_PREFIX_INVALID','R9의 조회 당시 Cycle과 현재 보존된 RUN 계보가 연결되지 않습니다.');
 return true;
}
const intentColumns="json_patch(json_object('request_id',i.request_id,'schema_version',i.schema_version,'asset_tag',i.asset_tag,'dataparc_tag',i.dataparc_tag,'window_start',i.window_start,'window_end',i.window_end,'chunk_days',i.chunk_days,'chunk_count',i.chunk_count,'expected_last_replacement_at',i.expected_last_replacement_at,'expected_cycle_start_state',i.expected_cycle_start_state,'expected_cycle_started_at',i.expected_cycle_started_at,'expected_cycle_start_revision',i.expected_cycle_start_revision,'expected_cycle_runtime_revision',i.expected_cycle_runtime_revision),json_object('reuse_key',i.reuse_key,'created_at',i.created_at,'updated_at',i.updated_at))";
async function existingRequest(db,user,body){
 if(body.requestId&&!/^[a-f0-9-]{36}$/i.test(text(body.requestId)))fail('LIME2A_FIRST_RUN_REQUEST_INVALID','기존 R9 요청을 다시 확인해 주세요.',400);
 const q=body.requestId?await db.prepare('SELECT * FROM ois_data_requests WHERE id=? AND requested_by_id=?').bind(text(body.requestId),text(user.employeeNo)).first():await db.prepare(`SELECT q.* FROM ois_data_requests q JOIN blower_runtime_probe_intents_v5 i ON i.request_id=q.id WHERE q.request_type='blower_runtime_probe' AND q.status='complete' AND q.requested_by_id=? AND i.asset_tag=? AND i.dataparc_tag=? AND i.window_start=? AND i.window_end=? AND i.expected_cycle_runtime_revision LIKE 'r7-evidence-only-v1:r9_signal_v1:%' ORDER BY q.completed_at DESC,q.requested_at DESC,q.id DESC LIMIT 1`).bind(text(user.employeeNo),TAG,SIGNAL,START,SEAM).first();
 if(!q)fail('LIME2A_FIRST_RUN_REQUEST_NOT_FOUND','이 사용자가 완료한 9월 19일 R9 요청을 찾지 못했습니다. 새 조회는 자동 실행하지 않습니다.',404);
 const i=await db.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(q.id).first();return {request:q,intent:i,prefix:validateLimestone2aPrefix(q,i)};
}
export async function loadLimestone2aFirstRunProof(db,user,body={},options={}){
 authorize(user);const item=await existingRequest(db,user,body),asset=await db.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').bind(TAG).first(),now=nowDate(options);
 if(!Number.isFinite(now.getTime())||at(item.request.completed_at)>now.getTime()+300000)fail('LIME2A_FIRST_RUN_PREFIX_INVALID','R9 완료시각이 현재 시각보다 뒤에 있습니다.');
 if(!asset||asset.blower_type!=='limestone'||String(asset.unit_no)!=='2'||Number(asset.enabled)!==1||!same(asset.last_replacement_at,START)||
  asset.cycle_start_state!=='pending'||asset.cycle_started_at||!text(asset.cycle_start_revision).startsWith('replacement-auto-v3:')||
  !text(asset.cycle_runtime_revision)||Number(asset.runtime_hours)!==Number(asset.cycle_runtime_hours)||
  text(item.intent.expected_cycle_start_revision).replace(/^signal-only-v1:/,'')!==asset.cycle_start_revision)
  fail('LIME2A_FIRST_RUN_NOT_ELIGIBLE','현재 2호기 Limestone A의 교체일·보존된 RUN 기준을 확인할 수 없습니다.');
 const loaded=await db.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id LIMIT 2001').bind(TAG).all(),events=loaded.results||[];
 if(events.length>2000)fail('LIME2A_FIRST_RUN_HISTORY_LIMIT','안전하게 확인할 수 있는 이력 범위를 초과했습니다.');
 const owner=events.find(e=>e.id===OWNER),ownerSource=parse(owner?.source_text),automatic=replacementAutoCycleProof(asset,events);
 if(!owner||owner.event_type!=='replacement'||owner.source_type!=='shift_log_auto_v3'||owner.source_log_id!==BO2||!same(owner.event_date,START)||
  ownerSource?.timePrecision!=='day'||ownerSource.recordDate!==DAY||ownerSource.normalizationVersion!==4||!same(ownerSource.rangeStartAt,SEAM)||content(ownerSource.sourceText)!==content(COMPLETION)||
  !automatic||automatic.timePrecision!=='day'||automatic.clockKnown!==false||!same(automatic.rangeStartAt,SEAM))
  fail('LIME2A_FIRST_RUN_OWNER_CHANGED','현재 날짜 단위 교체 이력과 승인 원문의 연결이 변경되었습니다.');
 if(events.some(e=>e.event_type==='replacement'&&e.id!==OWNER&&(!Number.isFinite(at(e.event_date))||at(e.event_date)>=at(START))))fail('LIME2A_FIRST_RUN_COMPETING_OWNER','같은 날 또는 이후의 다른 교체 이력이 있어 자동으로 누적을 결합하지 않습니다.');
 const base=verifiedAppendBase(asset,events,SIGNAL),chain=base&&limestone2aRawTailChain(asset,events,base.eventId);
 if(!base||!chain||!same(base.startAt,SEAM)||chain.startState!=='running'||base.runningSeconds!==chain.runningSeconds||at(base.observedAt)>now.getTime()+300000)
  fail('LIME2A_FIRST_RUN_TAIL_INVALID','9월 20일부터 보존된 RUN 구간과 연결 상태를 확인할 수 없습니다.');
 validateLimestone2aPrefixCycle(item.intent,asset,chain);
 const sources=await loadLimestone2aApprovedCompletion(db,options),primary=sources.hashes.find(h=>h.sourceLogId===BO2);
 if(automatic.sourceLogId!==BO2||automatic.sourceSnapshotSha256!==primary.sourceSnapshotSha256)fail('LIME2A_FIRST_RUN_SOURCE_CHANGED','현재 선택한 승인 교체 원문이 저장된 근거와 다릅니다. 전체 최신화의 원문 반영 결과를 먼저 확인해 주세요.');
 const ids=chain.chain.map(x=>x.source.requestId),rows=await db.prepare(`SELECT q.*,${intentColumns} AS intent_json FROM ois_data_requests q JOIN blower_runtime_probe_intents_v5 i ON i.request_id=q.id WHERE q.id IN(SELECT value FROM json_each(?)) ORDER BY q.id`).bind(JSON.stringify(ids)).all(),requests=rows.results||[];
 if(requests.length!==ids.length)fail('LIME2A_FIRST_RUN_TAIL_REQUEST_INVALID','기존 RUN의 원본 요청 또는 조건이 누락되었습니다.');
 for(const node of chain.chain){const q=requests.find(q=>q.id===node.source.requestId);validateLimestone2aTailRequest(q,parse(q.intent_json),node.source);}
 const snapshot={version:1,asset,events,ownerId:owner.id,sourceProofHash:sources.sourceProofHash,sources:sources.hashes,tail:{...base,startState:chain.startState},requests,prefixRequest:item.request,prefixIntent:item.intent,prefixRawResultSha256:await sha(item.request.result_json)};
 const snapshotJson=encode(snapshot);if(new TextEncoder().encode(snapshotJson).length>750000)fail('LIME2A_FIRST_RUN_EVIDENCE_LIMIT','감사 근거 크기가 허용 범위를 초과했습니다.');
 return {...snapshot,...item,owner,chain,snapshotJson,snapshotSha256:await sha(snapshotJson),guards:[exists('blower_history_assets',asset),eventsEqual(events),...sources.guards,
  rowsExist('ois_data_requests','id',requests.map(q=>Object.fromEntries(Object.entries(q).filter(([k])=>k!=='intent_json')))),rowsExist('blower_runtime_probe_intents_v5','request_id',requests.map(q=>parse(q.intent_json))),exists('ois_data_requests',item.request),exists('blower_runtime_probe_intents_v5',item.intent)]};
}
function view(proof){return {ok:true,assetTag:TAG,eligible:true,proofHash:proof.snapshotSha256,completionDay:DAY,completionClockKnown:false,firstPostReplacementRunAt:proof.prefix.firstRunAt,
 prefix:{startAt:START,endAt:SEAM,runningSeconds:50494,zeroPrefixRunningSeconds:0},tail:{startAt:SEAM,observedAt:proof.tail.observedAt,runningSeconds:proof.tail.runningSeconds},request:{id:proof.request.id,status:'complete'},
 preview:{prefixRunningSeconds:50494,tailRunningSeconds:proof.tail.runningSeconds,totalRunningSeconds:50494+proof.tail.runningSeconds,observedAt:proof.tail.observedAt},quality:{sampleGoodCertified:false},attestationRequired:true,
 message:'실제 완료시각은 미확정입니다. 확인한 교체 후 첫 RUN과 기존 RUN 구간을 연결합니다.'};}
async function replay(db,user,requestId){
 const audit=await db.prepare('SELECT * FROM blower_history_asset_history WHERE id=? AND action_type=? AND tag_number=?').bind(ID+requestId,AUDIT,TAG).first();if(!audit)return null;
 const after=parse(audit.after_json),event=await db.prepare('SELECT * FROM blower_history_events WHERE id=?').bind(EVENT_ID+requestId).first(),item=await existingRequest(db,user,{requestId});
 if(!after?.outcome||encode(event)!==encode(after.event)||encode(item.request)!==encode(after.prefixRequest)||encode(item.intent)!==encode(after.prefixIntent)||audit.changed_by_id!==after.attestation?.actorId||
  after.attestation?.statementCode!==STATEMENT||after.attestation.completionBeforeFirstRun!==true||after.attestation.noEarlierPostReplacementRun!==true)conflict();
 const asset=await db.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').bind(TAG).first();
 if(!String(asset?.cycle_start_revision||'').startsWith(CYCLE))fail('LIME2A_FIRST_RUN_CURRENT_PROOF_CHANGED','이 반영 이력과 현재 Cycle이 달라 이전 누적을 현재값으로 표시하지 않습니다.');
 const {loadAppendBase}=await import('./blower-incremental.js'),base=await loadAppendBase(db,asset,SIGNAL);if(!base)fail('LIME2A_FIRST_RUN_CURRENT_PROOF_CHANGED','반영 이력은 보존되어 있으나 현재 원문 또는 RUN 연결 근거를 다시 확인해야 합니다.');
 const tailSeconds=base.runningSeconds-50494;if(!Number.isSafeInteger(tailSeconds)||tailSeconds<0)conflict();
 return {...after.outcome,eligible:false,applied:true,replayed:true,attestationRequired:false,runtimeHours:base.runningSeconds/3600,
  tail:{...after.outcome.tail,observedAt:base.observedAt,runningSeconds:tailSeconds},preview:{...after.outcome.preview,tailRunningSeconds:tailSeconds,totalRunningSeconds:base.runningSeconds,observedAt:base.observedAt}};
}
export async function limestone2aFirstRunStatus(db,user,body={},options={}){
 authorize(user);const item=await existingRequest(db,user,body),prior=await replay(db,user,item.request.id);if(prior)return prior;
 return view(await loadLimestone2aFirstRunProof(db,user,{requestId:item.request.id},options));
}
export async function applyLimestone2aFirstRun(db,user,body={},options={}){
 authorize(user);if(Object.keys(body).some(k=>!['action','requestId','expectedProofHash','confirmation','attestation'].includes(k)))fail('LIME2A_FIRST_RUN_REQUEST_INVALID','고정 첫 기동 근거 반영 형식이 올바르지 않습니다.',400);
 if(!text(body.requestId))fail('LIME2A_FIRST_RUN_REQUEST_INVALID','확인한 기존 R9 요청을 선택해 주세요.',400);
 const item=await existingRequest(db,user,body),prior=await replay(db,user,item.request.id);if(prior)return prior;
 const proof=await loadLimestone2aFirstRunProof(db,user,{requestId:item.request.id},options);if(body.expectedProofHash!==proof.snapshotSha256)conflict();
 const a=body.attestation;if(body.confirmation!==CONFIRM||!a||Object.keys(a).sort().join(',')!=='completionBeforeFirstRun,completionDay,firstRunAt,noEarlierPostReplacementRun,statementCode,version'||a.version!==1||a.completionDay!==DAY||
  a.firstRunAt!==proof.prefix.firstRunAt||a.completionBeforeFirstRun!==true||a.noEarlierPostReplacementRun!==true||a.statementCode!==STATEMENT)
  fail('LIME2A_FIRST_RUN_ATTESTATION_REQUIRED','9월 19일 V-Belt 교체 후 첫 기동 사실을 확인한 담당자가 명시적으로 확인해야 합니다. 완료시각을 입력하지 않습니다.',400);
 const now=nowDate(options).toISOString(),auditId=ID+proof.request.id,nextStart=CYCLE+proof.snapshotSha256,total=proof.tail.runningSeconds+50494;if(!Number.isSafeInteger(total))conflict();
 const attestation={...a,actorId:text(user.employeeNo),actorName:text(user.name),confirmedAt:now};
 const source={version:1,assetTag:TAG,dataParcTag:SIGNAL,proofHash:proof.snapshotSha256,cycleStartRevision:nextStart,auditId,sourceProofHash:proof.sourceProofHash,
  owner:Object.fromEntries(Object.entries(proof.owner).filter(([k])=>!['created_by_id','created_by_name'].includes(k))),
  prefix:{requestId:proof.request.id,startAt:START,endAt:SEAM,runningSeconds:50494,startState:'stopped',endState:'running',firstRunAt:proof.prefix.firstRunAt,rawResultSha256:proof.prefixRawResultSha256},
  tail:{eventId:proof.tail.eventId,observedAt:proof.tail.observedAt,runningSeconds:proof.tail.runningSeconds,endState:proof.tail.state},tailAsset:proof.asset,totalRunningSeconds:total,
  completionClockKnown:false,sampleGoodCertified:false,attestation};
 const event={id:EVENT_ID+proof.request.id,tag_number:TAG,event_type:'runtime_correction',event_date:proof.tail.observedAt,runtime_hours:total/3600,issue_type:'DataPARC',action_type:'교체 후 첫 RUN·보존 구간 결합',
  note:'교체일만 확인된 새 벨트의 첫 RUN을 담당자가 확인했습니다. 실제 완료시각과 샘플 GOOD 품질은 확정하지 않습니다.',source_type:SOURCE,source_log_id:proof.request.id,source_text:JSON.stringify(source),created_by_id:text(user.employeeNo),created_by_name:text(user.name),created_at:now,updated_at:now};
 const patch={cycle_start_revision:nextStart,cycle_runtime_revision:crypto.randomUUID(),cycle_runtime_hours:total/3600,runtime_hours:total/3600,cycle_runtime_anchor_at:proof.tail.observedAt,cycle_runtime_state:proof.tail.state,
  runtime_anchor_at:proof.tail.state==='running'?proof.tail.observedAt:null,is_running:proof.tail.state==='running'?1:0,last_modified_by_id:text(user.employeeNo),last_modified_by_name:text(user.name),updated_at:now};
 const afterAsset={...proof.asset,...patch},afterEvents=proof.events.concat(event),derived=verifiedAppendBase(afterAsset,afterEvents,SIGNAL);
 if(!derived||derived.runningSeconds!==total||derived.eventId!==event.id||!derived.limestone2aFirstRun)fail('LIME2A_FIRST_RUN_DERIVATION_INVALID','보존된 RUN과 첫 기동 근거의 결합 검증을 통과하지 못했습니다.');
 const outcome={...view(proof),eligible:false,applied:true,replayed:false,attestationRequired:false,runtimeHours:total/3600,message:'완료시각 미확정을 유지하고 확인한 교체 후 RUN을 기존 구간에 반영했습니다.'};
 const audit={id:auditId,action_type:AUDIT,tag_number:TAG,before_json:proof.snapshotJson,after_json:JSON.stringify({version:1,asset:afterAsset,owner:proof.owner,event,prefixRequest:proof.request,prefixIntent:proof.intent,
  prefixRawResultSha256:proof.prefixRawResultSha256,sourceProofHash:proof.sourceProofHash,attestation,outcome}),change_note:'승인 교체 완료→차단기 투입·기동 원문 + 담당자의 첫 기동 확인 + R9 단일 RUN + 기존 RUN; 완료시각·GOOD 품질 확정 아님',changed_by_id:text(user.employeeNo),changed_by_name:text(user.name),changed_at:now};
 const unused={sql:'NOT EXISTS(SELECT 1 FROM blower_history_asset_history WHERE id=?) AND NOT EXISTS(SELECT 1 FROM blower_history_events WHERE id=?)',values:[auditId,event.id]},before=guardPlan(db,[...proof.guards,unused]),after=guardPlan(db,[exists('blower_history_assets',afterAsset),eventsEqual(afterEvents),exists('blower_history_asset_history',audit)]);
 try{await db.batch([...before.statements,insert(db,'blower_history_asset_history',audit),db.prepare(`UPDATE blower_history_assets SET ${Object.keys(patch).map(k=>col(k)+'=?').join(',')} WHERE tag_number=? AND cycle_start_revision=? AND cycle_runtime_revision=?`).bind(...Object.values(patch),TAG,proof.asset.cycle_start_revision,proof.asset.cycle_runtime_revision),insert(db,'blower_history_events',event),...after.statements,cleanup(db,[...before.ids,...after.ids])]);}
 catch(error){const done=await replay(db,user,proof.request.id);if(done)return done;if(/CHECK constraint|UNIQUE constraint/i.test(String(error?.message)))conflict();throw error;}
 return outcome;
}
export async function limestone2aFirstRunResponse(db,user,action,body={},options={}){
 try{return Response.json(await(action==='apply'?applyLimestone2aFirstRun:limestone2aFirstRunStatus)(db,user,body,options),{headers:{'Cache-Control':'no-store'}});}
 catch(error){if(/^LIME2A_FIRST_RUN_/.test(error?.code||'')&&[400,403,404,409].includes(error.status))return Response.json({ok:false,code:error.code,message:error.message},{status:error.status,headers:{'Cache-Control':'no-store'}});
  return Response.json({ok:false,code:'LIME2A_FIRST_RUN_STORAGE_FAILED',message:'첫 기동 근거 처리 응답을 확인하지 못했습니다. 새 조회 없이 기존 반영 결과를 확인해 주세요.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
