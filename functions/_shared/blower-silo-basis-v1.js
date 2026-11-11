import {verifiedAppendBase,siloRawTailChain,SILO_BASIS_TAG as TAG,SILO_BASIS_SIGNAL as SIGNAL,
 SILO_BASIS_START as START,SILO_BASIS_SEAM as SEAM,SILO_BASIS_CYCLE_PREFIX as CYCLE,SILO_BASIS_SOURCE as SOURCE} from './blower-incremental.js';
import {loadSiloApprovedCompletion} from './blower-replacement-log-source-v3.js';
import {buildBlowerRuntimeProbeChunks,convertBlowerRuntimeProbeIntentRow,normalizeBlowerRuntimeProbeResult} from '../api/ois-data-requests.js';

/* One closed historical prefix, followed by an explicit composite certificate.
 * Raw prefix results and the old measured tail are immutable. No ordinary full
 * query is fabricated, no source receipt is created, and sample GOOD metadata
 * is not certified by the existing Agent contract. */
const TABLE='blower_silo_basis_intents_v1',WIRE='r7-evidence-only-v1:silo-prefix-v1:',FRESH=15*60000;
const OLD='2026-05-04T00:00:00+09:00',OWNER='v13:104ETH03AN602|2025-10-23',FALSE_OWNER='v13:104ETH03AN602|2026-05-04';
const text=v=>String(v??'').trim(),parse=v=>{try{return JSON.parse(v)}catch{return null}},at=v=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const same=(a,b)=>Number.isFinite(at(a))&&at(a)===at(b),canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>JSON.stringify(canonical(v)),sha=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const col=v=>'"'+v.replace(/"/g,'""')+'"',fail=(code,message,status=409)=>{throw Object.assign(new Error(message),{code,status})};
const conflict=()=>fail('SILO_BASIS_CONFLICT','교체 원문·누적값·이력이 변경되었습니다. 결과를 다시 확인해 주세요. 기존값은 유지합니다.');
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const insert=(db,t,r)=>db.prepare(`INSERT INTO ${t} (${Object.keys(r).map(col).join(',')}) VALUES (${Object.keys(r).map(()=>'?').join(',')})`).bind(...Object.values(r));
const exists=(table,row)=>({sql:`EXISTS (SELECT 1 FROM ${table} t CROSS JOIN json_each(?) j WHERE j.key='row' AND ${Object.keys(row).map(k=>`t.${col(k)} IS json_extract(j.value,'$.${k}')`).join(' AND ')})`,values:[JSON.stringify({row})]});
const rowsExist=(table,key,rows)=>({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN ${table} t ON t.${col(key)} IS json_extract(j.value,'$.${key}') WHERE t.${col(key)} IS NULL OR NOT(${Object.keys(rows[0]||{[key]:null}).map(k=>`t.${col(k)} IS json_extract(j.value,'$.${k}')`).join(' AND ')}))`,values:[JSON.stringify(rows)]});
const equalRows=(table,key,where,values,rows)=>({sql:`(SELECT COUNT(*) FROM ${table} WHERE ${where})=json_array_length(?) AND NOT EXISTS (SELECT 1 FROM ${table} t LEFT JOIN json_each(?) j ON t.${col(key)} IS json_extract(j.value,'$.${key}') WHERE ${where.replace(/\btag_number\b/g,'t.tag_number')} AND (j.value IS NULL OR NOT (${Object.keys(rows[0]||{[key]:null}).map(k=>`t.${col(k)} IS json_extract(j.value,'$.${k}')`).join(' AND ')})))`,values:[...values,JSON.stringify(rows),JSON.stringify(rows),...values]});
const guardSpec=(id,checks)=>({sql:`INSERT INTO blower_history_atomic_guard(id,valid) VALUES (?,CASE WHEN ${checks.map(c=>'('+c.sql+')').join(' AND ')} THEN 1 ELSE 0 END)`,values:[id,...checks.flatMap(c=>c.values)]});
const guard=(db,id,checks)=>{const spec=guardSpec(id,checks);return db.prepare(spec.sql).bind(...spec.values);};
const authorize=user=>{if(!text(user?.employeeNo)||user?.isSuperAdmin!==true)fail('SILO_BASIS_FORBIDDEN','최고관리자만 Silo B 교체 기준을 확인·반영할 수 있습니다.',403)};
const nowDate=options=>options?.now instanceof Date?options.now:new Date();
async function schema(db){await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(request_id TEXT PRIMARY KEY,version INTEGER NOT NULL CHECK(version=1),actor_id TEXT NOT NULL,nonce TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,applied_json TEXT,UNIQUE(actor_id,nonce))`).run();}
async function lookup(db,user,body){
 try{const row=body.requestId?await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id=? AND actor_id=?`).bind(text(body.requestId),text(user.employeeNo)).first():body.nonce?await db.prepare(`SELECT * FROM ${TABLE} WHERE nonce=? AND actor_id=?`).bind(text(body.nonce),text(user.employeeNo)).first():null;return row;}
 catch(e){if(/no such table:.*blower_silo_basis_intents_v1/i.test(String(e?.message)))return null;throw e;}
}
function completionLines(row){const log=parse(row.log_json),entries=log?.entries||[];return entries.flatMap(e=>typeof e.content==='string'?e.content.replace(/\\n/g,'\n').split('\n'):[]).filter(line=>/Fly\s*Ash\s*Silo\s*Aeration\s*Blower\s*#\s*B.*V\s*[- ]?\s*Belt.*교체\s*완료/i.test(line));}
const exactLine=line=>/^\s*(?:\d+\.\s*)?09:17\s+\[TM\s*작업\]\s*Fly\s*Ash\s*Silo\s*Aeration\s*Blower\s*#\s*B\s*V\s*[- ]?\s*Belt\s*교체\s*완료\s*$/i.test(line);
function badQuality(raw){return raw?.fromCachedResult===true||raw?.fromManualOverride===true||raw?.estimated===true||['missingSeconds','badQualitySeconds','estimatedSeconds'].some(k=>raw?.[k]!==undefined&&raw[k]!==0)||(Array.isArray(raw?.chunks)&&raw.chunks.some(badQuality));}
export async function loadSiloBasisProof(db,options={}){
 const asset=await db.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').bind(TAG).first();
 if(!asset||asset.blower_type!=='flyash_silo'||String(asset.unit_no)!=='shared'||Number(asset.enabled)!==1||
  !same(asset.last_replacement_at,OLD)||asset.cycle_start_state!=='legacy'||asset.cycle_started_at||
  !text(asset.cycle_runtime_revision)||String(asset.cycle_start_revision||'').startsWith(CYCLE)||
  Number(asset.runtime_hours)!==Number(asset.cycle_runtime_hours))fail('SILO_BASIS_NOT_ELIGIBLE','현재 Silo B의 보존된 조회 기준을 확인할 수 없습니다.');
 const loaded=await db.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY id LIMIT 2001').bind(TAG).all(),events=loaded.results||[];
 if(events.length>2000)fail('SILO_BASIS_HISTORY_LIMIT','이력이 많아 안전한 반영 범위를 확인하지 못했습니다.');
 const owner=events.find(e=>e.id===OWNER),wrong=events.find(e=>e.id===FALSE_OWNER);
 if(!owner||owner.event_type!=='replacement'||owner.source_type!=='shift_log_history_v13'||
  !same(owner.event_date,'2025-10-23T00:00:00+09:00')||!exactLine(owner.source_text)||
  !wrong||wrong.event_type!=='_retracted_replacement'||!same(wrong.event_date,OLD))fail('SILO_BASIS_OWNER_CHANGED','검증된 과거 교체 이력 또는 철회 이력이 변경되었습니다.');
 if(events.some(e=>e.event_type==='replacement'&&e.id!==OWNER&&(!Number.isFinite(at(e.event_date))||at(e.event_date)>at(owner.event_date))))fail('SILO_BASIS_COMPETING_OWNER','선택한 교체 이후의 다른 교체 근거가 있어 자동으로 기준을 변경하지 않습니다.');
 const base=verifiedAppendBase(asset,events,SIGNAL),chain=base&&siloRawTailChain(asset,events,base.eventId);
 if(!base||!chain||!same(base.startAt,SEAM)||base.runningSeconds!==chain.runningSeconds)fail('SILO_BASIS_TAIL_INVALID','보존된 RUN 구간의 연속 근거를 확인할 수 없습니다.');
 const {sources,hashes,sourceProofHash,guards:sourceGuards}=await loadSiloApprovedCompletion(db,options);
 if(!sources.some(row=>[row.id,...(row.sourceAliases||[])].includes(owner.source_log_id)))fail('SILO_BASIS_SOURCE_OWNER','과거 교체 이력과 현재 승인 원문이 연결되지 않습니다.');
 const requestIds=chain.chain.map(item=>item.source.requestId);
 const results=await db.prepare(`SELECT q.*,json_patch(json_object('request_id',i.request_id,'schema_version',i.schema_version,'asset_tag',i.asset_tag,'dataparc_tag',i.dataparc_tag,'window_start',i.window_start,'window_end',i.window_end,'chunk_days',i.chunk_days,'chunk_count',i.chunk_count,'expected_last_replacement_at',i.expected_last_replacement_at,'expected_cycle_start_state',i.expected_cycle_start_state,'expected_cycle_started_at',i.expected_cycle_started_at,'expected_cycle_start_revision',i.expected_cycle_start_revision,'expected_cycle_runtime_revision',i.expected_cycle_runtime_revision),json_object('reuse_key',i.reuse_key,'created_at',i.created_at,'updated_at',i.updated_at)) AS intent_json FROM ois_data_requests q JOIN blower_runtime_probe_intents_v5 i ON i.request_id=q.id WHERE q.id IN (SELECT value FROM json_each(?)) ORDER BY q.id`).bind(JSON.stringify(requestIds)).all();
 const requests=results.results||[];if(requests.length!==requestIds.length)fail('SILO_BASIS_TAIL_REQUEST_MISSING','기존 RUN의 원본 요청 근거가 누락되었습니다.');
 for(const item of chain.chain){const q=requests.find(q=>q.id===item.source.requestId),raw=parse(q.result_json),intent=parse(q.intent_json),norm=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(intent),q.id,new Date(q.completed_at));
  if(q.status!=='complete'||q.request_type!=='blower_runtime_probe'||norm.error||badQuality(raw)||norm.result.runningSeconds!==item.source.runningSeconds||
   !same(norm.result.startAt,item.source.startAt)||!same(norm.result.endAt,item.source.endAt)||norm.result.startState!==item.source.startState||norm.result.endState!==item.source.endState||
   at(norm.result.collectedAt)<at(q.requested_at)||at(norm.result.collectedAt)>at(q.completed_at)+300000)fail('SILO_BASIS_TAIL_REQUEST_INVALID','보존된 RUN 요청·수집시각·상태·품질 근거가 일치하지 않습니다.');}
 const excluded={sql:`NOT EXISTS(SELECT 1 FROM blower_history_candidates WHERE tag_number=? AND status='excluded' AND detected_type='replacement' AND source_log_id IN(SELECT value FROM json_each(?)))`,values:[TAG,JSON.stringify(sources.flatMap(row=>[row.id,...(row.sourceAliases||[])]))]};
 if(!(await db.prepare(`SELECT CASE WHEN ${excluded.sql} THEN 1 ELSE 0 END valid`).bind(...excluded.values).first())?.valid)fail('SILO_BASIS_SOURCE_EXCLUDED','선택한 작업에 제외한 교체 근거가 있습니다.');
 const requestGuards=[rowsExist('ois_data_requests','id',requests.map(q=>Object.fromEntries(Object.entries(q).filter(([k])=>k!=='intent_json'))))];
 // Every query is immutable and selected by a verified event chain; guard its
 // exact intent as well, using one JSON bind per row rather than wide bind lists.
 const intentGuards=[rowsExist('blower_runtime_probe_intents_v5','request_id',requests.map(q=>parse(q.intent_json)))];
 const snapshot={version:1,asset,events,ownerId:owner.id,sourceProofHash,sources:hashes,tail:{...base,startState:chain.startState},requests};
 const snapshotJson=encode(snapshot);if(new TextEncoder().encode(snapshotJson).length>750000)fail('SILO_BASIS_EVIDENCE_LIMIT','감사 근거 크기가 허용 범위를 초과했습니다.');
 return {...snapshot,owner,chain,snapshotJson,snapshotSha256:await sha(snapshotJson),guards:[exists('blower_history_assets',asset),equalRows('blower_history_events','id','tag_number=?',[TAG],events),...sourceGuards,excluded,...requestGuards,...intentGuards]};
}
function compatible(original,proof){return original.sourceProofHash===proof.sourceProofHash&&
 original.asset.cycle_start_revision===proof.asset.cycle_start_revision&&original.asset.last_replacement_at===proof.asset.last_replacement_at&&
 proof.chain.chain.some(item=>item.row.id===original.tail.eventId&&encode(item.row)===encode(original.events.find(e=>e.id===original.tail.eventId)));}
async function read(db,row){const request=await db.prepare('SELECT * FROM ois_data_requests WHERE id=?').bind(row.request_id).first(),intent=await db.prepare('SELECT * FROM blower_runtime_probe_intents_v5 WHERE request_id=?').bind(row.request_id).first();return {request,intent};}
async function appliedReplay(db,row){
 const out=parse(row.applied_json),audit=await db.prepare('SELECT * FROM blower_history_asset_history WHERE id=? AND action_type=\'silo_prefix_basis_recovery\' AND tag_number=?').bind('silo_basis:'+row.request_id,TAG).first(),after=parse(audit?.after_json);
 const event=await db.prepare('SELECT * FROM blower_history_events WHERE id=?').bind('dataparc_silo_basis:'+row.request_id).first(),item=await read(db,row);
 if(!out||!after?.event||encode(event)!==encode(after.event)||encode(item.request)!==encode(after.prefixRequest)||encode(item.intent)!==encode(after.prefixIntent)||
  out.request?.id!==row.request_id||out.preview?.totalRunningSeconds!==parse(event.source_text)?.totalRunningSeconds)conflict();
 return {...out,eligible:false,applied:false,replayed:true};
}
function validateRead(row,item,now,{freshness=true}={}){
 const original=parse(row.snapshot_json),q=item.request,i=item.intent,raw=parse(q?.result_json);
 if(!q||q.status!=='complete'||q.request_type!=='blower_runtime_probe'||!i||i.asset_tag!==TAG||i.dataparc_tag!==SIGNAL||
  i.expected_cycle_runtime_revision!==WIRE+original.asset.cycle_runtime_revision||i.expected_cycle_start_revision!==text(original.asset.cycle_start_revision)||
  i.expected_last_replacement_at!==original.asset.last_replacement_at||i.expected_cycle_start_state!=='legacy'||text(i.expected_cycle_started_at)||
  i.window_start!==START||i.window_end!==SEAM||q.target_date!==`v1|${TAG}|${START}|${SEAM}`||q.requested_by_id!==row.actor_id||
  i.reuse_key!==WIRE+row.nonce||badQuality(raw))fail('SILO_PREFIX_PROOF_INVALID','고정 과거 조회의 요청·신호·기간·품질 근거가 일치하지 않습니다.');
 const norm=normalizeBlowerRuntimeProbeResult(raw,convertBlowerRuntimeProbeIntentRow(i),q.id,now);
 if(norm.error)fail('SILO_PREFIX_PROOF_INVALID','고정 기간·7개 분할 구간·RUN 상태 또는 합계가 일치하지 않습니다.');
 const stamp=now.getTime();if(!Number.isFinite(at(q.requested_at))||!Number.isFinite(at(q.completed_at))||
  stamp-at(q.requested_at)<0||freshness&&(stamp-at(q.completed_at)<0||stamp-at(q.completed_at)>FRESH)||
  at(norm.result.collectedAt)<at(q.requested_at)||at(norm.result.collectedAt)>at(q.completed_at)+300000||
  freshness&&(stamp-at(norm.result.collectedAt)>FRESH||at(norm.result.collectedAt)>stamp+300000))fail('SILO_PREFIX_STALE','새로 수집한 15분 이내의 과거 조회 결과만 반영할 수 있습니다.');
 if(norm.result.chunkCount!==7||norm.result.chunks.some(c=>!Number.isSafeInteger(c.runningSeconds))||
  norm.result.runningSeconds!==norm.result.chunks.reduce((sum,c)=>sum+c.runningSeconds,0))fail('SILO_PREFIX_SUM_INVALID','7개 구간의 RUN 초 합계가 일치하지 않습니다.');
 return norm.result;
}
function view(proof,row,item,prefix){return {ok:true,assetTag:TAG,eligible:true,proofHash:proof.snapshotSha256,approvedCompletionAt:START,
 prefix:{startAt:START,endAt:SEAM,chunkCount:7},tail:{startAt:SEAM,observedAt:proof.tail.observedAt,runningSeconds:proof.tail.runningSeconds},
 ...(item?.request?{request:{id:item.request.id,status:item.request.status}}:{}),
 ...(prefix?{preview:{prefixRunningSeconds:prefix.runningSeconds,tailRunningSeconds:proof.tail.runningSeconds,totalRunningSeconds:prefix.runningSeconds+proof.tail.runningSeconds,observedAt:proof.tail.observedAt}}:{}),
 quality:{sampleGoodCertified:false},message:'기존 RUN 구간은 유지하며 누락된 앞 구간만 측정합니다.'};}
export async function siloBasisStatus(db,user,body={},options={}){
 authorize(user);const row=await lookup(db,user,body);if((body.requestId||body.nonce)&&!row)fail('SILO_BASIS_REQUEST_NOT_FOUND','이 사용자의 접수 기록을 찾을 수 없습니다.',404);
 if(row?.applied_json)return {...await appliedReplay(db,row),applied:true};
 let proof;try{proof=await loadSiloBasisProof(db,options);}catch(error){if(!row)throw error;const item=await read(db,row);return {ok:true,assetTag:TAG,eligible:false,code:error.code,message:error.message,request:{id:row.request_id,status:item.request?.status||'missing'}};}
 if(!row)return view(proof);const item=await read(db,row),original=parse(row.snapshot_json);
 if(!compatible(original,proof))return {...view(proof,row,item),eligible:false,code:'SILO_BASIS_CONFLICT',message:'선택 원문이나 기존 RUN 근거가 변경되어 반영을 중단했습니다.'};
 let prefix=null;if(item.request?.status==='complete'){try{prefix=validateRead(row,item,nowDate(options));if(prefix.endState!==proof.tail.startState)fail('SILO_PREFIX_SEAM_INVALID','과거 구간과 보존된 구간의 경계 RUN 상태가 다릅니다.');}catch(error){return {...view(proof,row,item),eligible:false,code:error.code,message:error.message};}}
 return view(proof,row,item,prefix);
}
export async function startSiloBasis(db,user,body,options={}){
 authorize(user);if(!/^[A-Za-z0-9_-]{16,100}$/.test(text(body.nonce)))fail('SILO_BASIS_NONCE_INVALID','접수 식별값을 다시 확인해 주세요.',400);
 if(Object.keys(body).some(k=>!['action','nonce','expectedProofHash'].includes(k)))fail('SILO_BASIS_REQUEST_INVALID','이 작업은 고정된 Silo B 과거 구간만 조회합니다.',400);
 const prior=await lookup(db,user,{nonce:body.nonce});if(prior)return siloBasisStatus(db,user,{requestId:prior.request_id},options);
 const proof=await loadSiloBasisProof(db,options);if(body.expectedProofHash!==proof.snapshotSha256)conflict();
 await schema(db);const now=nowDate(options),created=now.toISOString(),requestId=crypto.randomUUID(),expires=new Date(now.getTime()+2*3600000).toISOString();
 const noActive={sql:`NOT EXISTS(SELECT 1 FROM ${TABLE} s JOIN ois_data_requests q ON q.id=s.request_id WHERE q.status IN('pending','processing') AND q.expires_at>?)`,values:[created]};
 if(!(await db.prepare(`SELECT CASE WHEN ${noActive.sql} THEN 1 ELSE 0 END valid`).bind(...noActive.values).first())?.valid)fail('SILO_PREFIX_ALREADY_ACTIVE','다른 Silo 앞 구간 조회가 진행 중입니다. 기존 결과를 먼저 확인해 주세요.');
 const request={id:requestId,request_type:'blower_runtime_probe',target_date:`v1|${TAG}|${START}|${SEAM}`,status:'pending',requested_by_id:text(user.employeeNo),requested_by_name:text(user.name),requested_at:created,started_at:null,completed_at:null,agent_id:'',result_json:null,error_message:'',expires_at:expires,updated_at:created};
 const intent={request_id:requestId,reuse_key:WIRE+body.nonce,schema_version:1,asset_tag:TAG,dataparc_tag:SIGNAL,window_start:START,window_end:SEAM,chunk_days:31,chunk_count:7,expected_last_replacement_at:proof.asset.last_replacement_at,expected_cycle_start_state:'legacy',expected_cycle_started_at:'',expected_cycle_start_revision:text(proof.asset.cycle_start_revision),expected_cycle_runtime_revision:WIRE+proof.asset.cycle_runtime_revision,created_at:created,updated_at:created};
 if(buildBlowerRuntimeProbeChunks(START,SEAM).length!==7||intent.expected_cycle_runtime_revision.length>200)conflict();
 const row={request_id:requestId,version:1,actor_id:text(user.employeeNo),nonce:body.nonce,snapshot_sha256:proof.snapshotSha256,snapshot_json:proof.snapshotJson,created_at:created,applied_json:null},id=crypto.randomUUID();
 try{await db.batch([guard(db,id,[...proof.guards,noActive]),insert(db,'ois_data_requests',request),insert(db,'blower_runtime_probe_intents_v5',intent),insert(db,TABLE,row),db.prepare('DELETE FROM blower_history_atomic_guard WHERE id=?').bind(id)]);}catch(error){const replay=await lookup(db,user,{nonce:body.nonce});if(replay)return siloBasisStatus(db,user,{requestId:replay.request_id},options);if(/CHECK constraint|UNIQUE constraint/i.test(String(error?.message)))conflict();throw error;}
 return view(proof,row,{request});
}
async function buildSiloBasisCommit(proof,row,item,prefix,user,options={}){
 const now=nowDate(options).toISOString(),auditId='silo_basis:'+row.request_id,nextStart=CYCLE+crypto.randomUUID(),nextRuntime=crypto.randomUUID(),total=prefix.runningSeconds+proof.tail.runningSeconds;
 if(!Number.isSafeInteger(total))conflict();
 const ownerSnapshot=Object.fromEntries(Object.entries({...proof.owner,event_date:START,updated_at:now}).filter(([k])=>!['created_by_id','created_by_name'].includes(k)));
 const source={version:1,assetTag:TAG,dataParcTag:SIGNAL,cycleStartRevision:nextStart,auditId,sourceProofHash:proof.sourceProofHash,owner:ownerSnapshot,
  prefix:{requestId:row.request_id,startAt:START,endAt:SEAM,runningSeconds:prefix.runningSeconds,startState:prefix.startState,endState:prefix.endState,rawResultSha256:await sha(item.request.result_json)},
  tail:{eventId:proof.tail.eventId,observedAt:proof.tail.observedAt,runningSeconds:proof.tail.runningSeconds,endState:proof.tail.state},tailAsset:proof.asset,totalRunningSeconds:total,sampleGoodCertified:false};
 const event={id:'dataparc_silo_basis:'+row.request_id,tag_number:TAG,event_type:'runtime_correction',event_date:proof.tail.observedAt,runtime_hours:total/3600,issue_type:'DataPARC',action_type:'Silo 교체 기준·측정 구간 결합',note:'새 과거 측정과 보존된 RUN을 경계에서 결합했습니다. 원본 요청은 변경하지 않습니다.',source_type:SOURCE,source_log_id:row.request_id,source_text:JSON.stringify(source),created_by_id:text(user.employeeNo),created_by_name:text(user.name),created_at:now,updated_at:now};
 const patch={last_replacement_at:START,cycle_start_revision:nextStart,cycle_runtime_revision:nextRuntime,cycle_runtime_hours:total/3600,runtime_hours:total/3600,cycle_runtime_anchor_at:proof.tail.observedAt,cycle_runtime_state:proof.tail.state,runtime_anchor_at:proof.tail.state==='running'?proof.tail.observedAt:null,is_running:proof.tail.state==='running'?1:0,last_modified_by_id:text(user.employeeNo),last_modified_by_name:text(user.name),updated_at:now};
 const afterAsset={...proof.asset,...patch},afterOwner={...proof.owner,event_date:START,updated_at:now},afterEvents=proof.events.map(e=>e.id===proof.owner.id?afterOwner:e).concat(event);
 const outcome={...view(proof,row,item,prefix),eligible:false,applied:true,replayed:false,runtimeHours:total/3600,approvedCompletionAt:START,message:'승인 교체 완료시각과 앞·뒤 RUN 구간을 함께 반영했습니다. 원본 조회·철회 이력은 보존했습니다.'};
 const audit={id:auditId,action_type:'silo_prefix_basis_recovery',tag_number:TAG,before_json:proof.snapshotJson,after_json:JSON.stringify({version:1,asset:afterAsset,owner:afterOwner,event,prefixRequest:item.request,prefixIntent:item.intent,prefixRawResultSha256:source.prefix.rawResultSha256,sourceProofHash:proof.sourceProofHash}),change_note:'승인 BCO1·BO1 09:17 완료 + 새 과거 RUN + 기존 검증 RUN 결합; 샘플 GOOD 품질 인증 아님',changed_by_id:text(user.employeeNo),changed_by_name:text(user.name),changed_at:now};
 return {now,auditId,total,source,event,patch,afterAsset,afterOwner,afterEvents,outcome,audit};
}
async function applySiloBasisUnchecked(db,user,body,options={}){
 options.reportStage?.('LOOKUP');authorize(user);const row=await lookup(db,user,body);if(!row)fail('SILO_BASIS_REQUEST_NOT_FOUND','접수 기록을 찾을 수 없습니다.',404);
 if(row.applied_json){options.reportStage?.('REPLAY_CHECK');return appliedReplay(db,row);}
 if(Object.keys(body).some(k=>!['action','requestId','expectedProofHash','confirmation'].includes(k)))fail('SILO_BASIS_REQUEST_INVALID','교체 기준 반영 요청 형식이 올바르지 않습니다.',400);
 if(body.confirmation!=='SILO_PREFIX_STITCH')fail('SILO_BASIS_CONFIRM_REQUIRED','구간 합계와 교체 기준을 확인한 뒤 반영해 주세요.',400);
 options.reportStage?.('LOAD_PROOF');
 const proof=await loadSiloBasisProof(db,options),original=parse(row.snapshot_json);if(!compatible(original,proof)||body.expectedProofHash!==proof.snapshotSha256)conflict();
 options.reportStage?.('VALIDATE_PREFIX');
 const item=await read(db,row),prefix=validateRead(row,item,nowDate(options));if(prefix.endState!==proof.tail.startState)fail('SILO_PREFIX_SEAM_INVALID','과거 구간과 보존된 구간의 경계 RUN 상태가 다릅니다.');
 options.reportStage?.('BUILD_CERTIFICATE');
 const {now,auditId,total,source,event,patch,afterAsset,afterOwner,afterEvents,outcome,audit}=await buildSiloBasisCommit(proof,row,item,prefix,user,options);
 options.reportStage?.('DERIVE_APPEND_BASE');
 if(verifiedAppendBase(afterAsset,afterEvents,SIGNAL)?.runningSeconds!==total)fail('SILO_BASIS_DERIVATION_INVALID','결합된 RUN 근거를 다시 확인하지 못해 기존값을 유지했습니다.');
 const id=crypto.randomUUID(),afterId=crypto.randomUUID();
 options.reportStage?.('ATOMIC_BATCH');
 try{await db.batch([guard(db,id,[...proof.guards,exists(TABLE,row),exists('ois_data_requests',item.request),exists('blower_runtime_probe_intents_v5',item.intent)]),insert(db,'blower_history_asset_history',audit),
  db.prepare(`UPDATE blower_history_events SET event_date=?,updated_at=? WHERE id=?`).bind(START,now,proof.owner.id),
  db.prepare(`UPDATE blower_history_assets SET ${Object.keys(patch).map(k=>col(k)+'=?').join(',')} WHERE tag_number=?`).bind(...Object.values(patch),TAG),insert(db,'blower_history_events',event),
  db.prepare(`UPDATE ${TABLE} SET applied_json=? WHERE request_id=?`).bind(JSON.stringify(outcome),row.request_id),
  guard(db,afterId,[exists('blower_history_assets',afterAsset),equalRows('blower_history_events','id','tag_number=?',[TAG],afterEvents),exists('blower_history_asset_history',audit)]),db.prepare('DELETE FROM blower_history_atomic_guard WHERE id IN (?,?)').bind(id,afterId)]);}catch(error){options.reportStage?.('REPLAY_CHECK');const replay=await lookup(db,user,{requestId:row.request_id});if(replay?.applied_json)return appliedReplay(db,replay);options.reportStage?.('ATOMIC_BATCH');if(/CHECK constraint|UNIQUE constraint/i.test(String(error?.message)))conflict();throw error;}
 return outcome;
}
const APPLY_STAGES=new Set(['LOOKUP','LOAD_PROOF','VALIDATE_PREFIX','BUILD_CERTIFICATE','DERIVE_APPEND_BASE','ATOMIC_BATCH','REPLAY_CHECK']);
const SAFE_SILO_CODES=new Set(['SILO_BASIS_FORBIDDEN','SILO_BASIS_REQUEST_INVALID','SILO_BASIS_CONFIRM_REQUIRED','SILO_BASIS_NOT_ELIGIBLE','SILO_BASIS_HISTORY_LIMIT','SILO_BASIS_OWNER_CHANGED','SILO_BASIS_COMPETING_OWNER','SILO_BASIS_TAIL_INVALID','SILO_BASIS_SOURCE_COVERAGE','SILO_BASIS_SOURCE_CONFLICT','SILO_BASIS_SOURCE_REQUIRED','SILO_BASIS_SOURCE_OWNER','SILO_BASIS_SOURCE_EXCLUDED','SILO_BASIS_TAIL_REQUEST_MISSING','SILO_BASIS_TAIL_REQUEST_INVALID','SILO_BASIS_EVIDENCE_LIMIT','SILO_BASIS_REQUEST_NOT_FOUND','SILO_BASIS_CONFLICT','SILO_PREFIX_PROOF_INVALID','SILO_PREFIX_STALE','SILO_PREFIX_SUM_INVALID','SILO_PREFIX_SEAM_INVALID','SILO_BASIS_DERIVATION_INVALID']);
// These existing fixed source-reader errors are part of the prior 400/409
// contract. Provider-defined code/status pairs are never trusted as public.
const SAFE_SOURCE_CODES=new Set(['BLOWER_ROLE_PRIORITY_CONTEXT_INVALID','BLOWER_REPLACEMENT_SOURCE_INVALID','BLOWER_REPLACEMENT_SOURCE_INDEX_REQUIRED','BLOWER_REPLACEMENT_ANALYSIS_VERSION_INVALID']);
/** Only fixed categories leave this module. Provider messages, identifiers,
 * bound values, SQL and cause strings never enter an HTTP diagnostic. */
function storageReason(error){
 const seen=new Set(),parts=[];let next=error;
 for(let i=0;i<6&&next&&!seen.has(next);i++){seen.add(next);parts.push(String(next.message||'').slice(0,4096));next=next.cause;}
 const value=parts.join('\n');
 if(/CHECK constraint|UNIQUE constraint|FOREIGN KEY constraint|NOT NULL constraint/i.test(value))return 'D1_CONSTRAINT';
 if(/too many (?:SQL variables|bound parameters|arguments)|statement.{0,20}too long|SQL.{0,20}(?:length|limit)|expression tree|parser stack/i.test(value))return 'D1_QUERY_LIMIT';
 if(/D1_TYPE_ERROR|D1_COLUMN_NOTFOUND|no such (?:table|column)|syntax error|unsupported type|undefined.{0,40}(?:bind|support)/i.test(value))return 'D1_QUERY_INVALID';
 if(/request.{0,30}(?:too large|size limit)|too many API requests|subrequest limit|request entity too large/i.test(value))return 'D1_REQUEST_LIMIT';
 if(/string or blob too big|SQLITE_TOOBIG|SQLITE_FULL|exceeded maximum DB size|storage limit|memory limit|CPU time limit|maximum response size/i.test(value))return 'D1_CAPACITY_LIMIT';
 if(/timed?\s*out|timeout/i.test(value))return 'D1_TIMEOUT';
 if(/overload|SQLITE_BUSY|database is locked|too many resources consumed/i.test(value))return 'D1_BUSY';
 if(/network connection lost|replica disconnected|cannot resolve D1|object.{0,30}reset|D1.{0,40}unavailable|\[code:\s*7500\]|"code"\s*:\s*7500|error code[:= ]+7500/i.test(value))return 'D1_UNAVAILABLE';
 return 'UNKNOWN';
}
function safeReason(error){return SAFE_SILO_CODES.has(error?.code)?error.code:storageReason(error);}
export async function applySiloBasis(db,user,body,options={}){
 let stage='LOOKUP';try{return await applySiloBasisUnchecked(db,user,body,{...options,reportStage:value=>{if(APPLY_STAGES.has(value))stage=value;}});}
 catch(error){if((SAFE_SILO_CODES.has(error?.code)||SAFE_SOURCE_CODES.has(error?.code))&&[400,403,404,409].includes(error?.status))throw error;throw Object.assign(new Error('Silo 반영 저장 단계의 응답을 확인하지 못했습니다. 새 조회 없이 기존 접수 결과를 먼저 확인해 주세요.'),{code:'SILO_BASIS_STORAGE_FAILED',status:500,diagnostic:{stage,reason:storageReason(error)}});}
}
export async function siloBasisDiagnostics(db,user,body={},options={}){
 authorize(user);
 if(!text(body.requestId)&&!text(body.nonce))fail('SILO_DIAGNOSTIC_REQUEST_REQUIRED','기존 접수 결과를 선택한 뒤 진단해 주세요.',400);
 const out={ok:true,diagnosticVersion:2,readOnly:true,applyAllowed:false,requestState:'unknown',
  stages:[],prefix:{integrity:'skip',freshness:'skip'},proof:{compatible:null},derivation:{valid:null},
  guards:{total:0,passed:0,failed:0,checks:[],combined:{outcome:'skip'}},dimensionsScope:'precondition_diagnostic',dimensions:{maxSqlBytes:0,maxBindings:0,maxBoundValueBytes:0,serializedBytes:0}};
 const stage=(name,outcome,error)=>out.stages.push({stage:name,outcome,...(error?{reason:safeReason(error)}:{})});
 const measure=(sql,values)=>{out.dimensions.maxSqlBytes=Math.max(out.dimensions.maxSqlBytes,new TextEncoder().encode(sql).length);out.dimensions.maxBindings=Math.max(out.dimensions.maxBindings,values.length);for(const value of values)out.dimensions.maxBoundValueBytes=Math.max(out.dimensions.maxBoundValueBytes,new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length);out.dimensions.serializedBytes+=new TextEncoder().encode(JSON.stringify({sql,params:values})).length;};
 let row,item,prefix,proof,commit;
 try{row=await lookup(db,user,body);if(!row)fail('SILO_BASIS_REQUEST_NOT_FOUND','접수 기록을 찾을 수 없습니다.',404);item=await read(db,row);out.requestState=['pending','processing','complete','failed'].includes(item.request?.status)?item.request.status:'unknown';stage('EXISTING_REQUEST','pass');}
 catch(error){if(error?.code==='SILO_BASIS_REQUEST_NOT_FOUND')throw error;stage('EXISTING_REQUEST','fail',error);return out;}
 if(row.applied_json){try{await appliedReplay(db,row);out.requestState='applied';stage('REPLAY_CHECK','pass');}catch(error){stage('REPLAY_CHECK','fail',error);}return out;}
 const now=nowDate(options); // Real validation clock, never the old completion time.
 try{prefix=validateRead(row,item,now,{freshness:false});out.prefix.integrity='pass';stage('PREFIX_INTEGRITY','pass');}
 catch(error){out.prefix.integrity='fail';stage('PREFIX_INTEGRITY','fail',error);}
 if(prefix){try{validateRead(row,item,now);out.prefix.freshness='fresh';stage('PREFIX_FRESHNESS','pass');}
  catch(error){const expired=error?.code==='SILO_PREFIX_STALE'&&(now.getTime()-at(item.request?.completed_at)>FRESH||now.getTime()-at(prefix.collectedAt)>FRESH);out.prefix.freshness=expired?'expired':'invalid';stage('PREFIX_FRESHNESS','fail',error);}}
 else stage('PREFIX_FRESHNESS','skip');
 try{proof=await loadSiloBasisProof(db,options);stage('LOAD_PROOF','pass');out.proof.compatible=compatible(parse(row.snapshot_json),proof);if(!out.proof.compatible)conflict();stage('COMPATIBILITY','pass');}
 catch(error){stage(proof?'COMPATIBILITY':'LOAD_PROOF','fail',error);}
 if(proof&&out.proof.compatible&&prefix){
  try{if(prefix.endState!==proof.tail.startState)fail('SILO_PREFIX_SEAM_INVALID','측정 구간 경계 상태가 다릅니다.');commit=await buildSiloBasisCommit(proof,row,item,prefix,user,options);stage('BUILD_CERTIFICATE','pass');}
  catch(error){stage('BUILD_CERTIFICATE','fail',error);}
  if(commit){try{out.derivation.valid=verifiedAppendBase(commit.afterAsset,commit.afterEvents,SIGNAL)?.runningSeconds===commit.total;if(!out.derivation.valid)fail('SILO_BASIS_DERIVATION_INVALID','결합 근거를 확인하지 못했습니다.');stage('DERIVE_APPEND_BASE','pass');}
   catch(error){out.derivation.valid=false;stage('DERIVE_APPEND_BASE','fail',error);}}
 }else{stage('BUILD_CERTIFICATE','skip');stage('DERIVE_APPEND_BASE','skip');}
 if(proof&&out.proof.compatible&&prefix){
  const checks=[...proof.guards,exists(TABLE,row),exists('ois_data_requests',item.request),exists('blower_runtime_probe_intents_v5',item.intent)];out.guards.total=checks.length;
  const spec=guardSpec('00000000-0000-4000-8000-000000000000',checks);measure(spec.sql,spec.values);
  for(let index=0;index<checks.length;index++){
   const check=checks[index],sql=`SELECT CASE WHEN (${check.sql}) THEN 1 ELSE 0 END AS valid`;measure(sql,check.values);
   try{const result=await db.prepare(sql).bind(...check.values).first();if(Number(result?.valid)!==1){out.guards.failed++;out.guards.checks.push({index:index+1,outcome:'fail',reason:'D1_CONSTRAINT'});}else{out.guards.passed++;out.guards.checks.push({index:index+1,outcome:'pass'});}}
   catch(error){out.guards.failed++;out.guards.checks.push({index:index+1,outcome:'fail',reason:safeReason(error)});}
  }
  const combinedSql=`SELECT CASE WHEN ${checks.map(check=>'('+check.sql+')').join(' AND ')} THEN 1 ELSE 0 END AS valid`,combinedValues=checks.flatMap(check=>check.values);measure(combinedSql,combinedValues);
  try{const result=await db.prepare(combinedSql).bind(...combinedValues).first();out.guards.combined=Number(result?.valid)===1?{outcome:'pass'}:{outcome:'fail',reason:'D1_CONSTRAINT'};}
  catch(error){out.guards.combined={outcome:'fail',reason:safeReason(error)};}
  stage('BEFORE_GUARDS',out.guards.failed||out.guards.combined.outcome==='fail'?'fail':'pass');
 }else stage('BEFORE_GUARDS','skip');
 return out;
}
export async function siloBasisResponse(db,user,action,body={},options={}){try{return reply(await (action==='diagnostics'?siloBasisDiagnostics:action==='start'?startSiloBasis:action==='apply'?applySiloBasis:siloBasisStatus)(db,user,body,options));}catch(error){if(error?.code&&error?.status)return reply({ok:false,code:error.code,message:error.message,...(error.code==='SILO_BASIS_STORAGE_FAILED'?{diagnostic:error.diagnostic}:{})},error.status);throw error;}}
