import { verifiedAppendBase } from './blower-incremental.js';

// This is recovery of an unchanged, server-owned measurement checkpoint. It
// does not resurrect the false May 4 physical replacement or invent RUN hours.
const TAG='104ETH03AN602',FALSE_EVENT='v13:104ETH03AN602|2026-05-04';
const SOURCE_ID=38159,SOURCE_SHA='c880db6fbab224ad84a8d04e69d927f785e212508122dad163ab483ccc79670f';
const SOURCE_ALIASES=['38159','legacy-POCHEON#20260504#DAY#BCO1','POCHEON#20260504#DAY#BCO1'];
const SIGNAL='GSPOGE.ABB_DCS.003ETH03AN602XB04',OLD_BASELINE='2026-05-04T00:00:00+09:00';
const EVENT_COLUMNS=['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_by_id','created_by_name','created_at','updated_at'];
const instant=value=>typeof value==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const text=value=>String(value??'').trim();
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const col=key=>`"${key.replace(/"/g,'""')}"`;
const condition=row=>Object.keys(row).map(key=>`${col(key)} IS ?`).join(' AND ');
const exists=(table,row)=>({sql:`EXISTS(SELECT 1 FROM ${table} WHERE ${condition(row)})`,values:Object.values(row)});
const equal=(a,b)=>a && b && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(key=>a[key]===b[key]);
const insert=(db,table,row)=>db.prepare(`INSERT INTO ${table}(${Object.keys(row).map(col).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row));
const guard=(db,id,checks)=>db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES(?,CASE WHEN ${checks.map(c=>`(${c.sql})`).join(' AND ')} THEN 1 ELSE 0 END)`).bind(id,...checks.flatMap(c=>c.values));
function eventsEqual(rows){const json=JSON.stringify(rows);return{sql:`(SELECT COUNT(*) FROM blower_history_events WHERE tag_number=?)=json_array_length(?) AND NOT EXISTS(
 SELECT 1 FROM blower_history_events e LEFT JOIN json_each(?) j ON e.id=json_extract(j.value,'$.id')
 WHERE e.tag_number=? AND (j.value IS NULL OR NOT(${EVENT_COLUMNS.map(key=>`e.${col(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')})))`,values:[TAG,json,json,TAG]};}
function failure(code){return{ok:false,status:409,code,recovered:0,kept:0,conflicts:1,results:[{tagNumber:TAG,status:'conflict',code}]};}
const kept=reason=>({ok:true,recovered:0,kept:1,conflicts:0,results:[{tagNumber:TAG,status:'kept',reason}]});

export async function reconcileCurrentRuntimeRecoveryV4(database,user,options={}) {
  const history=await database.prepare(`SELECT * FROM blower_history_asset_history WHERE tag_number=? AND action_type='replacement_auto_v3' ORDER BY changed_at DESC,id DESC LIMIT 100`).bind(TAG).all();
  let selected;
  for(const audit of history.results||[]){
    const before=parse(audit.before_json),after=parse(audit.after_json),b=before?.asset,a=after?.asset;
    if(b?.tag_number===TAG && a?.tag_number===TAG && instant(b.last_replacement_at)===instant(OLD_BASELINE) &&
      Number.isFinite(b.cycle_runtime_hours) && b.cycle_runtime_hours>0 && b.runtime_hours===b.cycle_runtime_hours &&
      a.cycle_start_state==='pending' && a.cycle_runtime_hours===0 && a.runtime_hours===0 &&
      text(a.cycle_start_revision).startsWith('replacement-auto-v3:') && SOURCE_ALIASES.includes(text(after.sourceLogId)) &&
      after.changes?.some(change=>change.kind==='retracted' && change.eventId===FALSE_EVENT)) {selected={audit,before,after};break;}
  }
  if(!selected)return kept('No matching historical source-retraction reset exists.');
  const {audit,before,after}=selected,id=`runtime-range-recovery-v4:${audit.id}`;
  const existing=await database.prepare('SELECT * FROM blower_history_events WHERE id=?').bind(id).first();
  if(existing){const meta=parse(existing.source_text);return existing.tag_number===TAG && existing.source_type==='shift_log_auto_v3' &&
    meta?.normalizationVersion===4 && meta.registeredRuntimeRange===true && meta.recoveryAuditId===audit.id
      ?kept('This audited measurement checkpoint has already been recovered.'):failure('NORMALIZE_RECOVERY_IDENTITY_CONFLICT');}
  const current=await database.prepare('SELECT * FROM blower_history_assets WHERE tag_number=? AND enabled=1').bind(TAG).first();
  if(!current || !equal(current,after.asset))return failure('NORMALIZE_RECOVERY_CURRENT_CHANGED');
  const raw=await database.prepare('SELECT id,legacy_diary_id,work_date,role,status,original_json FROM legacy_logs WHERE id=?').bind(SOURCE_ID).first();
  if(!raw || raw.legacy_diary_id!=='POCHEON#20260504#DAY#BCO1' || raw.work_date!=='2026-05-04' || raw.role!=='BCO1' || raw.status!=='결재완료' ||
    typeof raw.original_json!=='string' || await hash(raw.original_json)!==SOURCE_SHA)return failure('NORMALIZE_RECOVERY_APPROVED_SOURCE_CHANGED');
  const loaded=await database.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY event_date DESC,created_at DESC,id DESC').bind(TAG).all();
  const events=loaded.results||[];if(JSON.stringify(events).length>1200000)return failure('NORMALIZE_RECOVERY_HISTORY_LIMIT');
  const falseRow=events.find(event=>event.id===FALSE_EVENT);
  if(!falseRow || falseRow.event_type!=='_retracted_replacement' || falseRow.source_type!=='shift_log_history_v13' || text(falseRow.source_log_id)!=='38159')return failure('NORMALIZE_RECOVERY_RETRACTION_CHANGED');
  if(events.some(event=>event.source_type==='manual' && ['startup','operation_start','operation_stop','runtime_correction'].includes(event.event_type) &&
    instant(event.event_date)>=instant(OLD_BASELINE) && Math.max(instant(event.created_at),instant(event.updated_at))>instant(audit.changed_at)))return failure('NORMALIZE_RECOVERY_MANUAL_HISTORY_CHANGED');
  const base=verifiedAppendBase(before.asset,events,SIGNAL);
  const owner=base && events.find(event=>event.id===base.eventId),source=parse(owner?.source_text);
  if(!base || !owner || owner.updated_at!==owner.created_at || base.runtimeHours!==before.asset.cycle_runtime_hours ||
    instant(base.observedAt)!==instant(before.asset.cycle_runtime_anchor_at) || source?.assetTag!==TAG || source.dataParcTag!==SIGNAL ||
    source.requestId!==owner.source_log_id || owner.id!==`dataparc_runtime:${source.requestId}` ||
    instant(source.expectedLastReplacementAt)!==instant(OLD_BASELINE) || text(source.expectedCycleStartRevision)!==text(before.asset.cycle_start_revision))return failure('NORMALIZE_RECOVERY_MEASUREMENT_UNVERIFIED');
  const schema=await database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN('ois_data_requests','blower_runtime_probe_intents_v3','blower_runtime_probe_intents_v4','blower_runtime_probe_intents_v5')`).all();
  const tables=new Set((schema.results||[]).map(row=>row.name));if(!tables.has('ois_data_requests'))return failure('NORMALIZE_RECOVERY_REQUEST_SCOPE_UNAVAILABLE');
  const intents=['blower_runtime_probe_intents_v3','blower_runtime_probe_intents_v4','blower_runtime_probe_intents_v5'].filter(name=>tables.has(name));
  const active={sql:`NOT EXISTS(SELECT 1 FROM ois_data_requests r WHERE r.request_type='blower_runtime_probe' AND r.status IN('pending','processing') AND
    (r.target_date LIKE ? ${intents.map(name=>`OR EXISTS(SELECT 1 FROM ${name} i WHERE i.request_id=r.id AND i.asset_tag=?)`).join(' ')}))`,values:[`v1|${TAG}|%`,...intents.map(()=>TAG)]};
  const idle=await database.prepare(`SELECT CASE WHEN ${active.sql} THEN 1 ELSE 0 END AS idle`).bind(...active.values).first();
  if(Number(idle?.idle)!==1)return failure('NORMALIZE_RECOVERY_ACTIVE_QUERY');
  const now=options.now instanceof Date?options.now.toISOString():new Date().toISOString(),actor=text(user?.employeeNo)||'blower-normalize-v4',actorName=text(user?.name)||'업무일지 정상화';
  const keys=['last_replacement_at','cycle_started_at','cycle_start_state','cycle_start_revision','cycle_runtime_hours','cycle_runtime_anchor_at','cycle_runtime_state','cycle_runtime_revision','runtime_hours','runtime_anchor_at','is_running'];
  const patch=Object.fromEntries(keys.map(key=>[key,before.asset[key]]));Object.assign(patch,{last_modified_by_id:actor,last_modified_by_name:actorName,updated_at:now});
  const restored={...current,...patch};
  const metadata={schemaVersion:3,replacementAutoV3:true,normalizationVersion:4,currentCycle:true,registeredRuntimeRange:true,basisKind:'verified_runtime_range',
    registeredBaseline:true,timePrecision:'day',currentLastReplacementAt:restored.last_replacement_at,cycleStartRevision:restored.cycle_start_revision,
    cycleRuntimeRevision:restored.cycle_runtime_revision,rangeTrackingAllowed:true,rangeStartAt:base.startAt,recoveryAuditId:audit.id,
    preservedRuntimeEventId:owner.id,sourceSnapshotSha256:SOURCE_SHA,
    sourceText:'5/4 벨트 미실시 원문 확인; 기존 검증 RUN 구간 복원; 물리 교체시간 미확정'};
  const event={id,tag_number:TAG,event_type:'cycle_source_reconcile',event_date:now,runtime_hours:base.runtimeHours,issue_type:'검증 RUN 구간 복원',action_type:'등록 추적구간 복원',
    note:'기존 검증 측정구간을 복원합니다. 5/4는 조회 참조값이며 물리 교체 완료일시가 아닙니다.',source_type:'shift_log_auto_v3',source_log_id:'38159',source_text:JSON.stringify(metadata),
    created_by_id:actor,created_by_name:actorName,created_at:now,updated_at:now};
  const record={id:crypto.randomUUID(),action_type:'runtime_range_recovery_v4',tag_number:TAG,before_json:JSON.stringify({schemaVersion:4,asset:current,retractionAuditId:audit.id,runtimeEvent:owner}),
    after_json:JSON.stringify({schemaVersion:4,asset:restored,recoveredRuntimeEventId:owner.id,registeredRuntimeRange:true,rangeStartAt:base.startAt,sourceOriginalSha256:SOURCE_SHA}),
    change_note:'잘못된 교체 귀속 철회 중 분리된 검증 RUN 구간 복원 · 물리 교체 시각은 미확정',changed_by_id:actor,changed_by_name:actorName,changed_at:now};
  const beforeChecks=[exists('blower_history_assets',current),exists('blower_history_asset_history',audit),exists('legacy_logs',raw),eventsEqual(events),active];
  const afterChecks=[exists('blower_history_assets',restored),exists('blower_history_asset_history',audit),exists('legacy_logs',raw),eventsEqual([...events,event]),exists('blower_history_asset_history',record),active];
  const ids=[crypto.randomUUID(),crypto.randomUUID()];
  const statements=[guard(database,ids[0],beforeChecks),database.prepare(`UPDATE blower_history_assets SET ${Object.keys(patch).map(key=>`${col(key)}=?`).join(',')} WHERE ${condition(current)}`).bind(...Object.values(patch),...Object.values(current)),
    insert(database,'blower_history_events',event),insert(database,'blower_history_asset_history',record),guard(database,ids[1],afterChecks),database.prepare('DELETE FROM blower_history_atomic_guard WHERE id IN(?,?)').bind(...ids)];
  try{await database.batch(statements);}catch(error){if(/CHECK constraint failed(?:: valid = 1|.*blower_history_atomic_guard)/i.test(String(error?.message||error)))return failure('NORMALIZE_RECOVERY_CAS_CONFLICT');throw error;}
  return{ok:true,recovered:1,kept:0,conflicts:0,results:[{tagNumber:TAG,status:'recovered',eventId:id,auditId:record.id,rangeStartAt:base.startAt,runtimeHours:base.runtimeHours}]};
}
