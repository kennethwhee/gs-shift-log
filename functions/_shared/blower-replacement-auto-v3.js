import { verifiedAppendBase, LIMESTONE2A_TAG, LIMESTONE2A_CYCLE_PREFIX, LIMESTONE1B_TAG, LIMESTONE1B_CYCLE_PREFIX, FBHE1A_TAG, FBHE1A_CYCLE_PREFIX } from './blower-incremental.js';

/* Approved work-log replacements are replayable facts, not calendar runtime.
 * All mutations use existing guarded D1 batches and keep before/after evidence.
 * A day-only fact has a sortable date sentinel, never an asserted midnight clock.
 */
const AUTO_TYPES = new Set(['shift_log_auto', 'shift_log_history_auto', 'shift_log_history_v12', 'shift_log_history_v13', 'shift_log_auto_v3']);
const EVENT_COLUMNS = ['id','tag_number','event_type','event_date','runtime_hours','issue_type','action_type','note','source_type','source_log_id','source_text','created_by_id','created_by_name','created_at','updated_at'];
const text = value => String(value ?? '').trim();
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const day = value => { const ms = instant(value); return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0,10) : ''; };
const midnight = value => { const ms = instant(value); return Number.isFinite(ms) && (ms + 9 * 3600000) % 86400000 === 0; };
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const col = key => `"${key.replace(/"/g, '""')}"`;
const condition = row => Object.keys(row).map(key => `${col(key)} IS ?`).join(' AND ');
const rowExists = (table,row) => ({ sql:`EXISTS (SELECT 1 FROM ${table} WHERE ${condition(row)})`,values:Object.values(row) });
const insert = (db,table,row) => db.prepare(`INSERT INTO ${table} (${Object.keys(row).map(col).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
const update = (db,table,before,patch) => db.prepare(`UPDATE ${table} SET ${Object.keys(patch).map(key => `${col(key)}=?`).join(',')} WHERE ${condition(before)}`).bind(...Object.values(patch),...Object.values(before));
const guard = (db,id,checks) => db.prepare(`INSERT INTO blower_history_atomic_guard(id,valid) VALUES(?,CASE WHEN ${checks.map(check => `(${check.sql})`).join(' AND ')} THEN 1 ELSE 0 END)`).bind(id,...checks.flatMap(check => check.values));
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2,'0')).join('');
const order = (a,b) => instant(b.event_date)-instant(a.event_date) || text(b.created_at).localeCompare(text(a.created_at)) || text(b.id).localeCompare(text(a.id));
function eventsEqual(tag,rows) {
  const json = JSON.stringify(rows);
  return {sql:`(SELECT COUNT(*) FROM blower_history_events WHERE tag_number=?)=json_array_length(?) AND NOT EXISTS (
    SELECT 1 FROM blower_history_events e LEFT JOIN json_each(?) j ON e.id=json_extract(j.value,'$.id')
    WHERE e.tag_number=? AND (j.value IS NULL OR NOT (${EVENT_COLUMNS.map(key => `e.${col(key)} IS json_extract(j.value,'$.${key}')`).join(' AND ')})))`,values:[tag,json,json,tag]};
}
function sourceMetadata(event) {
  if (event?.source_type !== 'shift_log_auto_v3') return null;
  const source = parse(event?.source_text);
  return source?.schemaVersion === 3 && source?.replacementAutoV3 === true && source?.sourceRevisionSuperseded!==true && !source?.rolePrioritySupersededBy ? source : null;
}
function precision(event) {
  return sourceMetadata(event)?.timePrecision || (midnight(event?.event_date) ? 'day' : 'minute');
}
function currentVerifiedRange(asset,events) {
  const matching=events.filter(event => event.tag_number===asset.tag_number &&
    ['runtime_correction','startup','operation_start','operation_stop'].includes(event.event_type) &&
    instant(event.event_date)===instant(asset.cycle_runtime_anchor_at) &&
    Number.isFinite(Number(event.runtime_hours)) && Math.abs(Number(event.runtime_hours)-Number(asset.cycle_runtime_hours))<0.000001)
    .sort((a,b)=>instant(b.updated_at || b.created_at)-instant(a.updated_at || a.created_at) || text(b.id).localeCompare(text(a.id)));
  const owner=matching[0],source=parse(owner?.source_text);
  if (owner?.source_type!=='dataparc_runtime' || owner.event_type!=='runtime_correction' || owner.updated_at!==owner.created_at ||
      source?.assetTag!==asset.tag_number || source.requestId!==owner.source_log_id || owner.id!==`dataparc_runtime:${source.requestId}` ||
      typeof source.dataParcTag!=='string' || source.dataParcTag.length>200 || !/^GSPOGE\.ABB_DCS\.[A-Z0-9][A-Z0-9._-]*$/.test(source.dataParcTag)) return null;
  return verifiedAppendBase(asset,events,source.dataParcTag);
}
function rangeSeedMetadata(row,fact,options) {
  if (options.normalizationVersion!==4 || fact.timePrecision!=='day') return {};
  const sourceShift=text(row.shift).toUpperCase();
  const offset=['DS','DAY','주간'].includes(sourceShift)?1:2;
  const start=instant(`${fact.recordDate}T00:00:00+09:00`);
  return {normalizationVersion:4,rangeTrackingAllowed:true,rangeStartAt:new Date(start+offset*86400000).toISOString(),
    sourceWorkDate:fact.recordDate,sourceShift};
}
function validRangeSeed(source) {
  if (source.normalizationVersion!==4 || source.rangeTrackingAllowed!==true || source.timePrecision!=='day') return false;
  if (source.registeredRuntimeRange===true) return Number.isFinite(instant(source.rangeStartAt));
  const start=instant(`${source.sourceWorkDate}T00:00:00+09:00`);
  const offset=['DS','DAY','주간'].includes(text(source.sourceShift).toUpperCase())?1:2;
  return Number.isFinite(start) && day(new Date(start).toISOString())===source.sourceWorkDate &&
    instant(source.rangeStartAt)===start+offset*86400000;
}
function resetPatch(asset,boundary,user,now) {
  return {last_replacement_at:boundary || null,cycle_started_at:null,cycle_start_state:'pending',
    cycle_start_revision:`replacement-auto-v3:${crypto.randomUUID()}`,cycle_runtime_hours:0,cycle_runtime_anchor_at:boundary || null,
    cycle_runtime_state:'stopped',cycle_runtime_revision:crypto.randomUUID(),runtime_hours:0,runtime_anchor_at:null,
    is_running:0,last_modified_by_id:text(user?.employeeNo),last_modified_by_name:text(user?.name),updated_at:now};
}
function makeSource(meta,sourceText) {
  // JSON remains intact inside the existing 2,000-character column contract.
  const out = {...meta,sourceText:text(sourceText).slice(0,1000)};
  while (JSON.stringify(out).length > 2000 && out.sourceText.length) out.sourceText=out.sourceText.slice(0,-100);
  const encoded=JSON.stringify(out);
  if (encoded.length > 2000) throw new Error('Replacement source metadata exceeds 2,000 characters');
  return encoded;
}
function eventRow(user,now,{id,tag,date,runtime=0,type='replacement',sourceId,sourceText,issueType,note}) {
  return {id,tag_number:tag,event_type:type,event_date:date,runtime_hours:runtime,issue_type:issueType || '업무일지 교체완료',
    action_type:type==='replacement'?'교체':'교체 근거 재해석',note:note || '',source_type:'shift_log_auto_v3',source_log_id:sourceId,
    source_text:sourceText,created_by_id:text(user?.employeeNo),created_by_name:text(user?.name),created_at:now,updated_at:now};
}
function normalizeFact(raw,row) {
  const tag=text(raw?.tagNumber).toUpperCase(),recordDate=text(raw?.recordDate || row.work_date).slice(0,10),sourceKey=text(raw?.sourceKey);
  if (!/^[A-Z0-9]{4,40}$/.test(tag) || !/^\d{4}-\d\d-\d\d$/.test(recordDate) || !['minute','day'].includes(raw.timePrecision) || sourceKey.length>512) return null;
  let date=raw.timePrecision==='day'?`${recordDate}T00:00:00+09:00`:text(raw.eventDate);
  const ms=instant(date);
  if (!Number.isFinite(ms) || !day(date) || (raw.timePrecision==='day' && day(date)!==recordDate)) return null;
  date=new Date(ms).toISOString();
  return {tagNumber:tag,eventDate:date,recordDate,timePrecision:raw.timePrecision,sourceText:text(raw.sourceText),sourceKey,issueType:text(raw.issueType)};
}

// Role priority is scoped to a server-read pair describing the same physical
// job. It never edits the manual owner or transplants a measured RUN counter.
const ROLE_SUPERIOR = {BO1:'BCO1',BO2:'BCO2',TO:'TGO'};
const shiftKey = value => ({DAY:'DS',NIGHT:'NS','주간':'DS','야간':'NS'}[text(value).toUpperCase()] || text(value).toUpperCase());
const physicalId = value => text(value).replace(/^legacy-/,'');
function roleSourceKey(source,tag) {
  const key=parse(source?.sourceKey);
  return Array.isArray(key) && key.length===4 && physicalId(key[0])===physicalId(source.sourceLogId) &&
    key[1]===tag && typeof key[2]==='string' && !!key[2].trim() &&
    ((Number.isSafeInteger(key[3]) && key[3]>=0) || key[3]==='author-confirmed-v1');
}
function validRoleSelection(selection,row,fact,sourceHash,options) {
  return options.normalizationVersion===4 && !!options.sourceGuard?.sql && selection?.tagNumber===fact.tagNumber &&
    selection.sourceLogId===text(row.id) && selection.sourceKey===fact.sourceKey &&
    selection.sourceSnapshotSha256===sourceHash && roleSourceKey(selection,fact.tagNumber) &&
    selection.workDate===fact.recordDate && shiftKey(selection.shift)===shiftKey(row.shift) &&
    selection.timePrecision===fact.timePrecision && (fact.timePrecision!=='minute' || instant(selection.eventDate)===instant(fact.eventDate)) &&
    Array.isArray(selection.suppressedSources) && selection.suppressedSources.length>0 && selection.suppressedSources.length<=20 &&
    selection.suppressedSources.every(lower => lower.tagNumber===fact.tagNumber && ROLE_SUPERIOR[lower.sourceRole]===selection.sourceRole &&
      lower.workDate===selection.workDate && shiftKey(lower.shift)===shiftKey(selection.shift) &&
      /^[a-f0-9]{64}$/.test(text(lower.sourceSnapshotSha256)) && roleSourceKey(lower,fact.tagNumber));
}
function matchesRoleSource(event,source) {
  const meta=parse(event?.source_text);
  const aliases=[source.sourceLogId,...(source.sourceAliases || [])].map(physicalId);
  const hashes=[source.sourceSnapshotSha256,...(source.sourceSnapshotHistorySha256 || [])];
  return event?.source_type==='shift_log_auto_v3' && meta?.schemaVersion===3 && meta.replacementAutoV3===true &&
    aliases.includes(physicalId(event.source_log_id)) && meta.sourceKey===source.sourceKey &&
    hashes.includes(meta.sourceSnapshotSha256);
}
function roleSelectionOwner(asset,events,selection) {
  const owners=events.filter(event=>event.tag_number===asset.tag_number && event.event_type==='replacement' &&
    instant(event.event_date)===instant(asset.last_replacement_at) && day(event.event_date)===selection.workDate);
  if(owners.length!==1)return null;
  const owner=owners[0];
  // A previously selected certificate also owns retries after the subordinate
  // confirmations were retired. A later manual edit changes the cycle revision.
  const certificate=events.find(event=>{
    const meta=sourceMetadata(event);
    return meta?.rolePrioritySelection?.version===1 && meta.replacementEventId===owner.id &&
      meta.cycleStartRevision===text(asset.cycle_start_revision) && matchesRoleSource(event,selection);
  });
  if(certificate)return owner;
  const sources=owner.source_type==='manual'?selection.suppressedSources:[selection,...selection.suppressedSources];
  const linked=events.some(event=>{
    const meta=parse(event?.source_text);
    return meta && meta.currentCycle===true && meta.replacementEventId===owner.id &&
      meta.cycleStartRevision===text(asset.cycle_start_revision) &&
      sources.some(source=>matchesRoleSource(event,source));
  });
  // A newly created authoritative automatic event is itself its owner.
  return linked || (AUTO_TYPES.has(owner.source_type) && matchesRoleSource(owner,selection)) ? owner : null;
}

function rolePriorityProof(asset,events,candidates) {
  for(const item of candidates) {
    const {event,source}=item, selected=source.rolePrioritySelection;
    if(selected?.version!==1 || !['BCO1','BCO2','TGO'].includes(selected.selectedRole) ||
        !['minute','day'].includes(selected.timePrecision) || !/^[a-f0-9]{64}$/.test(text(source.sourceSnapshotSha256)) ||
        !roleSourceKey({sourceLogId:event.source_log_id,sourceKey:source.sourceKey},asset.tag_number))continue;
    const owner=events.find(owner=>owner.id===source.replacementEventId && owner.tag_number===asset.tag_number &&
      owner.event_type==='replacement' && instant(owner.event_date)===instant(asset.last_replacement_at));
    if(!owner || day(owner.event_date)!==selected.selectedWorkDate)continue;
    const minute=selected.timePrecision==='minute' && Number.isFinite(instant(selected.selectedCompletionAt));
    if(selected.timePrecision==='minute' && !minute)continue;
    const range=currentVerifiedRange(asset,events);
    const sameBoundary=minute && instant(selected.selectedCompletionAt)===instant(asset.last_replacement_at);
    const requiredRebuild=minute && !sameBoundary;
    return {item,owner,range,sameBoundary,selection:{...selected,requiredRebuild,
      selectedSourceLogId:event.source_log_id,selectedSourceKey:source.sourceKey,
      selectedSourceSnapshotSha256:source.sourceSnapshotSha256,
      registeredReplacementAt:text(asset.last_replacement_at)}};
  }
  return null;
}

export function isReplacementAutoRevision(asset) {
  return text(asset?.cycle_start_revision || asset?.cycleStartRevision).startsWith('replacement-auto-v3:');
}

// Clock certainty is independent of arrival order. Reconcile only strong
// server-created evidence tied to the very same active replacement owner.
// Source supersession is already rejected by sourceMetadata; an old clock
// cannot regain reset/query authority through this read-only projection.
function reconciledCompletionClock(asset,events,candidates,current) {
  const ownerFor=item=>{
    const id=text(item.source.replacementEventId);
    const owner=events.find(event=>event.id===id && event.tag_number===asset.tag_number && event.event_type==='replacement' &&
      instant(event.event_date)===instant(asset.last_replacement_at));
    return owner?owner.id:'';
  };
  const owner=ownerFor(current);
  if(!owner)return null;
  const sameOwner=candidates.filter(item=>ownerFor(item)===owner);
  const physical=id=>text(id).replace(/^legacy-/,'');
  const strong=sameOwner.filter(({event,source})=>{
    let key;try{key=JSON.parse(source.sourceKey);}catch{return false;}
    return source.timePrecision==='minute' && /^[a-f0-9]{64}$/.test(text(source.sourceSnapshotSha256)) &&
      Array.isArray(key) && key.length===4 && physical(key[0])===physical(event.source_log_id) &&
      key[1]===asset.tag_number && typeof key[2]==='string' && !!key[2].trim() &&
      ((Number.isSafeInteger(key[3]) && key[3]>=0) || key[3]==='author-confirmed-v1');
  });
  const clocks=[...new Set(strong.map(({source})=>instant(source.sourceCompletionAt || source.currentLastReplacementAt)))];
  const conflict=sameOwner.some(item=>item.source.completionClockConflict===true) ||
    clocks.some(clock=>!Number.isFinite(clock) || clock!==instant(asset.last_replacement_at));
  if(conflict || clocks.length>1)return {conflict:true};
  if(clocks.length!==1)return null;
  // Only an already-owned measured range may gain a stronger display basis.
  // This cannot issue a fresh zero/reset checkpoint for an unmeasured cycle.
  if(!currentVerifiedRange(asset,events))return null;
  const selected=strong[0];
  return {conflict:false,at:text(selected.source.currentLastReplacementAt),
    eventId:selected.event.id,sourceLogId:selected.event.source_log_id,
    sourceSnapshotSha256:selected.source.sourceSnapshotSha256};
}

/** Metadata for projection and narrowly authorized fresh RUN rebuilding.
 * A query certificate is consumed naturally when either cycle revision changes.
 * Historical DataPARC receipts can never regain ownership of the new cycle.
 */
export function replacementAutoCycleProof(asset,events) {
  if (!asset || !Array.isArray(events)) return null;
  const allCandidates=events.filter(event => event.tag_number===asset.tag_number && ['replacement','cycle_source_reconcile'].includes(event.event_type))
    .map(event => ({event,source:sourceMetadata(event)})).filter(item => item.source?.currentCycle===true &&
      text(item.source.currentLastReplacementAt)===text(asset.last_replacement_at) &&
      item.source.cycleStartRevision===text(asset.cycle_start_revision))
    .sort((a,b) => text(b.event.created_at).localeCompare(text(a.event.created_at)) || text(b.event.id).localeCompare(text(a.event.id)));
  const rolePriority=rolePriorityProof(asset,events,allCandidates);
  if(rolePriority) {
    const {item,owner,range,sameBoundary,selection}=rolePriority;
    const {event,source}=item;
    const clockKnown=sameBoundary;
    const original=sourceMetadata(owner);
    const fresh=isReplacementAutoRevision(asset) && original?.confirmationOnly!==true &&
      original?.cycleRuntimeRevision===text(asset.cycle_runtime_revision) && asset.cycle_start_state==='pending' &&
      !text(asset.cycle_started_at) && Number(asset.cycle_runtime_hours)===0 && Number(asset.runtime_hours)===0;
    const dayRange=fresh && selection.timePrecision==='day' && validRangeSeed(original);
    return {schemaVersion:3,normalizationVersion:4,rolePrioritySelection:selection,
      eventId:event.id,replacementEventId:source.replacementEventId,confirmationOnly:true,
      cycleStartRevision:source.cycleStartRevision,cycleRuntimeRevision:source.cycleRuntimeRevision,
      sourceLogId:event.source_log_id,sourceSnapshotSha256:source.sourceSnapshotSha256,
      storedRuntimeHours:Number(asset.cycle_runtime_hours),storedLegacyRuntimeHours:Number(asset.runtime_hours),
      timePrecision:selection.timePrecision,clockKnown,registeredBaseline:!clockKnown && !fresh,
      registeredRuntimeRange:!clockKnown && !!range,rangeTrackingAllowed:(!clockKnown && !!range) || dayRange,
      rangeStartAt:dayRange?original.rangeStartAt:!clockKnown && range?range.startAt:'',requiredStartAt:clockKnown?selection.selectedCompletionAt:text(asset.last_replacement_at),
      completionClockConflict:false,freshQueryEligible:clockKnown && fresh,rangeQueryEligible:dayRange,requiresRunRefresh:fresh,
      ...(clockKnown && range?{completionClockReconciled:true,confirmedReplacementAt:selection.selectedCompletionAt,
        confirmedClockEventId:event.id,confirmedClockSourceLogId:event.source_log_id,
        confirmedClockSourceSnapshotSha256:source.sourceSnapshotSha256}:{})};
  }
  // A malformed/ownerless selection is never an ordinary minute confirmation
  // of its preserved registration timestamp.
  const candidates=allCandidates.filter(item=>!item.source.rolePrioritySelection);
  const current=candidates[0];
  if(!current)return null;
  const {event,source}=current;
  const clockKnown=source.timePrecision==='minute' && Number.isFinite(instant(source.currentLastReplacementAt));
  const registeredBaseline=source.registeredBaseline===true && Number.isFinite(instant(source.currentLastReplacementAt));
  const resetAuthority=source.confirmationOnly!==true || (isReplacementAutoRevision(asset) && candidates.some(item =>
    item.source.confirmationOnly!==true && item.source.cycleRuntimeRevision===text(asset.cycle_runtime_revision)));
  const fresh=resetAuthority && source.cycleRuntimeRevision===text(asset.cycle_runtime_revision) && asset.cycle_start_state==='pending' &&
    !text(asset.cycle_started_at) && Number(asset.cycle_runtime_hours)===0 && Number(asset.runtime_hours)===0;
  const rangeTrackingAllowed=validRangeSeed(source);
  const proof={schemaVersion:3,normalizationVersion:source.normalizationVersion===4?4:undefined,rangeTrackingAllowed,
    ...(source.rolePrioritySourceRevoked===true?{rolePrioritySourceRevoked:true}:{}),
    rangeStartAt:rangeTrackingAllowed?source.rangeStartAt:'',rangeQueryEligible:rangeTrackingAllowed && fresh && source.registeredRuntimeRange!==true,
    registeredRuntimeRange:source.normalizationVersion===4 && source.registeredRuntimeRange===true,
    completionClockConflict:source.normalizationVersion===4 && source.completionClockConflict===true,eventId:event.id,confirmationOnly:source.confirmationOnly===true,cycleStartRevision:source.cycleStartRevision,cycleRuntimeRevision:source.cycleRuntimeRevision,replacementEventId:source.replacementEventId || (event.event_type==='replacement'?event.id:''),
    timePrecision:source.timePrecision,clockKnown,registeredBaseline,storedRuntimeHours:Number(asset.cycle_runtime_hours),storedLegacyRuntimeHours:Number(asset.runtime_hours),requiredStartAt:clockKnown || registeredBaseline || rangeTrackingAllowed?source.currentLastReplacementAt:'',
    freshQueryEligible:(clockKnown || registeredBaseline) && fresh,requiresRunRefresh:fresh,sourceLogId:event.source_log_id,
    sourceSnapshotSha256:source.sourceSnapshotSha256};
  const completion=reconciledCompletionClock(asset,events,candidates,current);
  if(completion?.conflict)return {...proof,normalizationVersion:4,clockKnown:false,
    completionClockConflict:true,confirmedReplacementAt:'',freshQueryEligible:false,rangeQueryEligible:false};
  if(!completion)return proof;
  return {...proof,normalizationVersion:4,timePrecision:'minute',clockKnown:true,
    completionClockReconciled:true,confirmedReplacementAt:completion.at,
    confirmedClockEventId:completion.eventId,confirmedClockSourceLogId:completion.sourceLogId,
    confirmedClockSourceSnapshotSha256:completion.sourceSnapshotSha256,
    completionClockConflict:false,registeredRuntimeRange:false,rangeTrackingAllowed:false,
    rangeStartAt:'',rangeQueryEligible:false,freshQueryEligible:false,requiresRunRefresh:false,
    requiredStartAt:completion.at};
}

/** Caller supplies completed belt facts from an approved server-loaded source.
 * Empty facts explicitly retract this source's unsupported automatic targets.
 * Manual events are preserved; old RUN hours are never transplanted to a cycle.
 */
export async function reconcileApprovedReplacementLog(database,user,row,facts,options={}) {
  const result={ok:true,applied:0,corrected:0,retracted:0,historical:0,linked:0,confirmed:0,evidenceSuperseded:0,protected:0,results:[]};
  const limeSourceIds=['POCHEON#20260919#DAY#BO2','POCHEON#20260919#DAY#BCO2'];
  const limeOriginalSource=Boolean(row && [row.id,...(Array.isArray(row.sourceAliases)?row.sourceAliases:[])].some(id=>limeSourceIds.includes(text(id).replace(/^legacy-/,''))));
  const limeReview=()=>({...result,ok:false,status:409,code:'LIME2A_FIRST_RUN_SOURCE_REVIEW_REQUIRED'});
  const lime1bOriginalSource=Boolean(row&&[row.id,...(Array.isArray(row.sourceAliases)?row.sourceAliases:[])].some(id=>['POCHEON#20260922#DAY#BCO1','POCHEON#20260922#DAY#BO1'].includes(text(id).replace(/^legacy-/,''))));
  const lime1bHeld=lime1bOriginalSource?await database.prepare('SELECT cycle_start_revision FROM blower_history_assets WHERE tag_number=?').bind(LIMESTONE1B_TAG).first():null;
  const lime1bReview=()=>({...result,ok:false,status:409,code:'LIME1B_FIRST_RUN_SOURCE_REVIEW_REQUIRED'});
  const fbhe1aOriginalSource=Boolean(row&&[row.id,...(Array.isArray(row.sourceAliases)?row.sourceAliases:[])].some(id=>['POCHEON#20260904#DAY#BCO1','POCHEON#20260904#DAY#BO1'].includes(text(id).replace(/^legacy-/,''))));
  const fbhe1aHeld=fbhe1aOriginalSource?await database.prepare('SELECT cycle_start_revision FROM blower_history_assets WHERE tag_number=?').bind(FBHE1A_TAG).first():null;
  const fbhe1aReview=()=>({...result,ok:false,status:409,code:'FBHE1A_RUNTIME_SOURCE_REVIEW_REQUIRED'});
  if(fbhe1aOriginalSource&&text(fbhe1aHeld?.cycle_start_revision).startsWith(FBHE1A_CYCLE_PREFIX)&&!['결재완료','approved'].includes(text(row?.status)))return fbhe1aReview();
  if(lime1bOriginalSource&&text(lime1bHeld?.cycle_start_revision).startsWith(LIMESTONE1B_CYCLE_PREFIX)&&!['결재완료','approved'].includes(text(row?.status)))return lime1bReview();
  if(limeOriginalSource && !['결재완료','approved'].includes(text(row?.status))){
    const held=await database.prepare('SELECT cycle_start_revision FROM blower_history_assets WHERE tag_number=?').bind(LIMESTONE2A_TAG).first();
    if(text(held?.cycle_start_revision).startsWith(LIMESTONE2A_CYCLE_PREFIX))return limeReview();
  }
  if (!row || !['결재완료','approved'].includes(text(row.status)) || !text(row.id) || !Array.isArray(facts)) {
    return {...result,ok:false,status:400,code:'REPLACEMENT_SOURCE_NOT_APPROVED'};
  }
  const now=options.now instanceof Date?options.now.toISOString():new Date().toISOString();
  const aliases=[...new Set([row.id,...(Array.isArray(row.sourceAliases)?row.sourceAliases:[])].map(text).filter(Boolean))];
  if (aliases.length>20 || facts.length>100) return {...result,ok:false,status:400,code:'REPLACEMENT_SOURCE_LIMIT'};
  const normalized=facts.map(fact => normalizeFact(fact,row));
  if (normalized.some(fact => !fact || instant(fact.eventDate)>Date.parse(now)+86400000)) return {...result,ok:false,status:400,code:'REPLACEMENT_FACT_INVALID'};
  const sourceHash=await hash(text(row.source_snapshot)||JSON.stringify(row));
  const physicalSource=aliases.find(alias => /^POCHEON#/.test(alias)) || text(row.id);
  const roleSelections=(Array.isArray(options.rolePrioritySelections)?options.rolePrioritySelections:[])
    .filter(selection=>normalized.some(fact=>validRoleSelection(selection,row,fact,sourceHash,options)));
  const roleSuppressions=(Array.isArray(options.rolePrioritySuppressions)?options.rolePrioritySuppressions:[])
    .filter(lower=>options.normalizationVersion===4 && !!options.sourceGuard?.sql && lower.sourceLogId===text(row.id) &&
      lower.sourceSnapshotSha256===sourceHash && lower.workDate===text(row.work_date).slice(0,10) &&
      shiftKey(lower.shift)===shiftKey(row.shift) && roleSourceKey(lower,lower.tagNumber) &&
      ROLE_SUPERIOR[lower.sourceRole]===lower.selection?.sourceRole &&
      lower.selection?.suppressedSources?.some(source=>source.sourceKey===lower.sourceKey && source.sourceLogId===lower.sourceLogId &&
        source.sourceSnapshotSha256===sourceHash));
  const linked=await database.prepare(`SELECT * FROM blower_history_events WHERE event_type IN ('replacement','cycle_source_reconcile') AND source_log_id IN (${aliases.map(() => '?').join(',')})`).bind(...aliases).all();
  const related=(linked.results || []).filter(event => AUTO_TYPES.has(event.source_type));
  const tags=[...new Set([...normalized.map(fact => fact.tagNumber),...related.map(event => event.tag_number),...(text(lime1bHeld?.cycle_start_revision).startsWith(LIMESTONE1B_CYCLE_PREFIX)?[LIMESTONE1B_TAG]:[]),...(text(fbhe1aHeld?.cycle_start_revision).startsWith(FBHE1A_CYCLE_PREFIX)?[FBHE1A_TAG]:[])])];
  for (const tag of tags) {
    const asset=await database.prepare('SELECT * FROM blower_history_assets WHERE tag_number=? AND enabled=1').bind(tag).first();
    if (!asset) { result.protected++; continue; }
    const loaded=await database.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY event_date DESC,created_at DESC,id DESC').bind(tag).all();
    const beforeEvents=loaded.results || [];
    if (JSON.stringify(beforeEvents).length>1200000) return {...result,ok:false,status:409,code:'REPLACEMENT_HISTORY_LIMIT'};
    if(tag===LIMESTONE1B_TAG&&text(asset.cycle_start_revision).startsWith(LIMESTONE1B_CYCLE_PREFIX)&&(lime1bOriginalSource||text(row.work_date)==='2026-09-22')){
      const certificates=beforeEvents.filter(event=>event.source_type==='dataparc_limestone1b_first_run_v1'&&parse(event.source_text)?.cycleStartRevision===asset.cycle_start_revision);if(certificates.length!==1)return lime1bReview();
      try{const {loadLimestone1bApprovedCompletion}=await import('./blower-limestone1b-first-run-v1.js');const current=await loadLimestone1bApprovedCompletion(database,{now:options.now||new Date()});if(current.sourceProofHash!==parse(certificates[0].source_text)?.sourceProofHash)return lime1bReview()}catch{return lime1bReview()}
      result.protected++;result.results.push({tagNumber:tag,kind:'protected',reason:'LIME1B_FIRST_RUN_EVIDENCE_PROTECTED'});continue;
    }
    if(tag===FBHE1A_TAG&&text(asset.cycle_start_revision).startsWith(FBHE1A_CYCLE_PREFIX)&&(fbhe1aOriginalSource||text(row.work_date)==='2026-09-04')){
      const certificates=beforeEvents.filter(event=>event.source_type==='dataparc_fbhe1a_runtime_v1'&&parse(event.source_text)?.cycleStartRevision===asset.cycle_start_revision);if(certificates.length!==1)return fbhe1aReview();
      try{const {loadFbhe1aRuntimeApprovedCompletion}=await import('./blower-fbhe1a-runtime-v1.js');const current=await loadFbhe1aRuntimeApprovedCompletion(database,{now:options.now||new Date()});if(current.sourceProofHash!==parse(certificates[0].source_text)?.sourceProofHash)return fbhe1aReview()}catch{return fbhe1aReview()}
      result.protected++;result.results.push({tagNumber:tag,kind:'protected',reason:'FBHE1A_RUNTIME_EVIDENCE_PROTECTED'});continue;
    }
    // This day-only job owns a separate first-post-replacement-RUN certificate.
    // Reinterpreting its source must not zero the certified counter, edit its
    // owner or withdraw its immutable evidence. An actual later job, from a
    // different source/date, continues through the ordinary replacement path.
    if(tag===LIMESTONE2A_TAG && text(asset.cycle_start_revision).startsWith(LIMESTONE2A_CYCLE_PREFIX) &&
        (limeOriginalSource || text(row.work_date)==='2026-09-19')){
      const certificate=beforeEvents.filter(event=>event.source_type==='dataparc_limestone2a_first_run_v1' &&
        parse(event.source_text)?.cycleStartRevision===asset.cycle_start_revision);
      if(certificate.length!==1)return limeReview();
      try{
        const {loadLimestone2aApprovedCompletion}=await import('./blower-limestone2a-first-run-v1.js');
        const current=await loadLimestone2aApprovedCompletion(database,{now:options.now || new Date()});
        if(current.sourceProofHash!==parse(certificate[0].source_text)?.sourceProofHash)return limeReview();
      }catch{return limeReview();}
      result.protected++;result.results.push({tagNumber:tag,kind:'protected',reason:'LIME2A_FIRST_RUN_EVIDENCE_PROTECTED'});continue;
    }
    const afterEvents=beforeEvents.map(event => ({...event}));
    let afterAsset={...asset},reset=false,resetEvent=null;
    const changes=[];
    const evaluation=options.rolePriorityEvaluation;
    if(options.normalizationVersion===4 && options.sourceGuard?.sql && evaluation?.version===1 &&
        evaluation.workDate===text(row.work_date).slice(0,10) && shiftKey(evaluation.shift)===shiftKey(row.shift) &&
        Array.isArray(evaluation.selections)) {
      for(const event of afterEvents) {
        const prior=sourceMetadata(event), selected=prior?.rolePrioritySelection;
        if(selected?.version!==1 || selected.selectedWorkDate!==evaluation.workDate ||
            shiftKey(selected.selectedShift)!==shiftKey(evaluation.shift) ||
            ![event.source_log_id,...(selected.suppressedSourceLogIds || [])].some(id=>aliases.map(physicalId).includes(physicalId(id))))continue;
        const stillSelected=evaluation.selections.some(selection=>selection.tagNumber===tag &&
          selection.sourceLogId===event.source_log_id && selection.sourceKey===prior.sourceKey &&
          selection.sourceSnapshotSha256===prior.sourceSnapshotSha256);
        if(!stillSelected){event.source_text=makeSource({...prior,sourceRevisionSuperseded:true},prior.sourceText);
          event.updated_at=now;changes.push({kind:'evidenceSuperseded',eventId:event.id});}
      }
    }
    // A newer snapshot withdraws this source's previous confirmation authority.
    // The original confirmation remains readable in the audit and event row.
    for (const event of afterEvents) {
      const prior=sourceMetadata(event);
      if (event.event_type==='cycle_source_reconcile' && prior?.confirmationOnly===true &&
          aliases.includes(text(event.source_log_id)) && prior.sourceSnapshotSha256!==sourceHash) {
        event.source_text=makeSource({...prior,sourceRevisionSuperseded:true},prior.sourceText);
        event.updated_at=now;changes.push({kind:'evidenceSuperseded',eventId:event.id});
      }
    }
    const tagFacts=normalized.filter(fact => fact.tagNumber===tag).filter((fact,index,all) => !all.some((other,j) => j!==index &&
      day(other.eventDate)===day(fact.eventDate) && other.timePrecision==='minute' && fact.timePrecision==='day'))
      .sort((a,b) => instant(a.eventDate)-instant(b.eventDate));
    const suppressedFacts=roleSuppressions.filter(lower=>lower.tagNumber===tag);
    const selectedFacts=roleSelections.filter(selection=>selection.tagNumber===tag);
    const controlledKeys=new Set(suppressedFacts.map(source=>source.sourceKey));
    const supportsEvent=event => {
      const prior=sourceMetadata(event);
      // Subordinate evidence remains an auditable physical record. Priority
      // removes its authority; it is not a claim the job never happened.
      if(suppressedFacts.some(source=>matchesRoleSource(event,source)))return true;
      if (!prior?.sourceKey) return tagFacts.length>0;
      return tagFacts.some(fact => fact.sourceKey===prior.sourceKey ||
        (fact.timePrecision==='minute' && instant(fact.eventDate)===instant(event.event_date)));
    };
    // Unchecking or stale author metadata is not permission to erase a
    // registered physical job. A missing/deleted entry is handled separately
    // by the server's explicit source reconciliation.
    const protectedEntryIds=Array.isArray(options.preserveSourceEntryIds)?options.preserveSourceEntryIds:[];
    const authorControlProtects=event=>{
      const prior=sourceMetadata(event);let key=null;
      try{key=JSON.parse(prior?.sourceKey || 'null');}catch{}
      const entryKey=Array.isArray(key)?text(key[2]):'';
      const positional=/^(?:(?:entries|tmEntries|handoverEntries|remarkEntries)(?:\.(?:note|remark|remarks))?|note|remark|remarks):\d+$/.test(entryKey);
      return entryKey && !positional?protectedEntryIds.includes(entryKey):options.preserveUnkeyedAutomaticEvents===true;
    };
    const unsupported=afterEvents.filter(event=>event.event_type==='replacement' && AUTO_TYPES.has(event.source_type) && aliases.includes(text(event.source_log_id)) && !supportsEvent(event));
    const retract=unsupported.filter(event=>!authorControlProtects(event));
    result.protected+=unsupported.length-retract.length;
    // An automatic duplicate can share the current manual replacement instant.
    // Withdrawing that source does not withdraw the independent manual basis
    // or invalidate its already measured counter and owning revisions.
    const preservedManualBasis=afterEvents.find(event => event.event_type==='replacement' && event.source_type==='manual' &&
      Number.isFinite(instant(event.event_date)) && instant(event.event_date)===instant(asset.last_replacement_at));
    for (const event of retract) { event.event_type='_retracted_replacement';event.updated_at=now;changes.push({kind:'retracted',eventId:event.id,
      ...(preservedManualBasis?{replacementEventId:preservedManualBasis.id,preservedCurrentBasis:true}:{})}); }
    if (!preservedManualBasis && retract.some(event => instant(event.event_date)===instant(asset.last_replacement_at))) {
      const remaining=afterEvents.filter(event => event.event_type==='replacement' && Number.isFinite(instant(event.event_date))).sort(order)[0];
      Object.assign(afterAsset,resetPatch(asset,remaining?.event_date || '',user,now));reset=true;
      const id=`replacement-auto-v3:reconcile:${await hash(`${physicalSource}|${tag}|${sourceHash}`)}`;
      const meta={schemaVersion:3,replacementAutoV3:true,currentCycle:true,replacementEventId:remaining?.id || '',
        currentLastReplacementAt:text(afterAsset.last_replacement_at),timePrecision:remaining?precision(remaining):'day',
        registeredBaseline:Boolean(remaining && !AUTO_TYPES.has(remaining.source_type)),
        cycleStartRevision:afterAsset.cycle_start_revision,cycleRuntimeRevision:afterAsset.cycle_runtime_revision,
        sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash,retractedEventIds:retract.map(event => event.id).slice(0,20)};
      resetEvent=eventRow(user,now,{id,tag,date:now,type:'cycle_source_reconcile',sourceId:text(row.id),sourceText:makeSource(meta,''),
        note:'승인 업무일지 재해석 · 잘못 연결된 자동 교체 제외 · 남은 교체 근거 기준 RUN 재계산 필요'});
      afterEvents.push(resetEvent);
    }
    for (const fact of tagFacts) {
      if(controlledKeys.has(fact.sourceKey)) { result.protected++;continue; }
      const priority=selectedFacts.find(selection=>selection.sourceKey===fact.sourceKey);
      if(priority && roleSelectionOwner(afterAsset,afterEvents,priority))continue;
      const active=afterEvents.filter(event => event.event_type==='replacement');
      const manualClock=options.normalizationVersion===4 && fact.timePrecision==='minute'?active.find(event =>
        event.source_type==='manual' && !midnight(event.event_date) && instant(event.event_date)===instant(afterAsset.last_replacement_at) &&
        day(event.event_date)===day(fact.eventDate) && instant(event.event_date)!==instant(fact.eventDate)):null;
      if (manualClock) {
        const id=`replacement-auto-v3:clock-conflict:${await hash(`${physicalSource}|${tag}|${manualClock.id}|${sourceHash}|${fact.sourceKey}`)}`;
        if (!afterEvents.some(event => event.id===id)) {
          const meta={schemaVersion:3,replacementAutoV3:true,normalizationVersion:4,currentCycle:true,confirmationOnly:true,
            completionClockConflict:true,replacementEventId:manualClock.id,currentLastReplacementAt:manualClock.event_date,
            timePrecision:'minute',registeredBaseline:true,cycleStartRevision:afterAsset.cycle_start_revision,
            cycleRuntimeRevision:afterAsset.cycle_runtime_revision,sourceCompletionAt:fact.eventDate,sourceKey:fact.sourceKey,
            sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash};
          const confirmation=eventRow(user,now,{id,tag,date:now,type:'cycle_source_reconcile',sourceId:text(row.id),sourceText:makeSource(meta,fact.sourceText),
            note:'승인 원문 완료시각과 같은 날 수동 등록시각이 다름 · 별도 교체 여부 미확정 · 기존 누적·기준 보존'});
          afterEvents.push(confirmation);changes.push({kind:'confirmed',eventId:id,replacementEventId:manualClock.id});
        }
        result.linked++;result.results.push({tagNumber:tag,kind:'linked',eventId:manualClock.id,completionClockConflict:true});continue;
      }
      const downgraded=fact.timePrecision==='day'?active.find(event => {
        const prior=sourceMetadata(event);
        return prior && aliases.includes(text(event.source_log_id)) && prior.timePrecision==='minute' &&
          prior.sourceSnapshotSha256!==sourceHash && ((fact.sourceKey && prior.sourceKey===fact.sourceKey) ||
            (!prior.sourceKey && day(event.event_date)===fact.recordDate));
      }):null;
      if (downgraded) {
        const owns=instant(downgraded.event_date)===instant(afterAsset.last_replacement_at);
        const prior=sourceMetadata(downgraded);
        const meta={...prior,currentCycle:owns,timePrecision:'day',recordDate:fact.recordDate,
          currentLastReplacementAt:owns?text(afterAsset.last_replacement_at):'',
          ...(owns?{cycleStartRevision:afterAsset.cycle_start_revision,cycleRuntimeRevision:afterAsset.cycle_runtime_revision}:{}),
          sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash,recordedTimeRetainedForAuditOnly:true};
        const event={...downgraded,source_text:makeSource(meta,fact.sourceText),updated_at:now,
          note:'승인 원문에서 시각 삭제 · 교체 날짜만 확인 · 이전 시각은 미확정 · 기존 측정 구간 보존'};
        afterEvents[afterEvents.findIndex(item => item.id===event.id)]=event;
        changes.push({kind:'corrected',eventId:event.id,timePrecision:'day'});continue;
      }
      const reClocked=fact.timePrecision==='minute'?active.find(event => {
        const prior=sourceMetadata(event);
        return prior?.recordedTimeRetainedForAuditOnly===true && aliases.includes(text(event.source_log_id)) &&
          instant(event.event_date)===instant(fact.eventDate) && (!fact.sourceKey || prior.sourceKey===fact.sourceKey);
      }):null;
      if (reClocked) {
        const owns=instant(reClocked.event_date)===instant(afterAsset.last_replacement_at);
        const prior=sourceMetadata(reClocked);
        const meta={...prior,currentCycle:owns,timePrecision:'minute',recordDate:fact.recordDate,
          currentLastReplacementAt:owns?text(afterAsset.last_replacement_at):'',
          ...(owns?{cycleStartRevision:afterAsset.cycle_start_revision,cycleRuntimeRevision:afterAsset.cycle_runtime_revision}:{}),
          sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash,recordedTimeRetainedForAuditOnly:false};
        const event={...reClocked,source_text:makeSource(meta,fact.sourceText),updated_at:now,note:'승인 업무일지의 동일 완료시각 재확인 · 기존 측정 구간 보존'};
        afterEvents[afterEvents.findIndex(item => item.id===event.id)]=event;
        changes.push({kind:'corrected',eventId:event.id,timePrecision:'minute'});continue;
      }
      const exact=active.find(event => instant(event.event_date)===instant(fact.eventDate) &&
        !(fact.timePrecision==='minute' && AUTO_TYPES.has(event.source_type) && precision(event)==='day'));
      const morePrecise=fact.timePrecision==='day' && active.find(event => day(event.event_date)===day(fact.eventDate));
      if (exact || morePrecise) {
        const existing=exact || morePrecise;
        const oldBoundary=instant(afterAsset.last_replacement_at);
        if (!Number.isFinite(oldBoundary) || instant(existing.event_date)>oldBoundary) {
          Object.assign(afterAsset,resetPatch(afterAsset,existing.event_date,user,now));reset=true;
          const id=`replacement-auto-v3:link:${await hash(`${physicalSource}|${tag}|${existing.id}|${sourceHash}`)}`;
          const meta={schemaVersion:3,replacementAutoV3:true,currentCycle:true,replacementEventId:existing.id,
            currentLastReplacementAt:existing.event_date,timePrecision:precision(existing),registeredBaseline:!AUTO_TYPES.has(existing.source_type),
            cycleStartRevision:afterAsset.cycle_start_revision,cycleRuntimeRevision:afterAsset.cycle_runtime_revision,sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash};
          resetEvent=eventRow(user,now,{id,tag,date:now,type:'cycle_source_reconcile',sourceId:text(row.id),sourceText:makeSource(meta,fact.sourceText),
            note:'승인 업무일지 확인 · 이미 등록된 교체와 누락된 현재 Cycle 연결 · RUN 재계산 필요'});
          afterEvents.push(resetEvent);changes.push({kind:'corrected',eventId:existing.id});
        }
        const represented=afterEvents.some(event => {
          const prior=sourceMetadata(event);
          return prior && (prior.sourcePhysicalId===physicalSource || aliases.includes(text(event.source_log_id))) &&
            prior.sourceSnapshotSha256===sourceHash && text(prior.sourceKey)===fact.sourceKey;
        });
        if (instant(existing.event_date)===instant(afterAsset.last_replacement_at) && !represented) {
          const id=`replacement-auto-v3:confirm:${await hash(`${physicalSource}|${tag}|${existing.id}|${sourceHash}|${fact.sourceKey}`)}`;
          const previous=sourceMetadata(existing);
          // A removed superior source cannot donate its preserved manual
          // registration minute to the subordinate's date-only statement.
          const revokedRoleClock=fact.timePrecision==='day' && afterEvents.some(event=>{
            const prior=parse(event.source_text);
            return event.source_type==='shift_log_auto_v3' && prior?.replacementAutoV3===true &&
              prior.rolePrioritySelection?.version===1 && prior.sourceRevisionSuperseded===true &&
              prior.replacementEventId===existing.id && prior.cycleStartRevision===text(afterAsset.cycle_start_revision) &&
              instant(prior.currentLastReplacementAt)===instant(afterAsset.last_replacement_at);
          });
          const knownClock=fact.timePrecision==='minute' || (!revokedRoleClock &&
            (previous?.timePrecision==='minute' || (!AUTO_TYPES.has(existing.source_type) && precision(existing)==='minute')));
          const registeredRange=options.normalizationVersion===4 && fact.timePrecision==='day' && !knownClock
            ?currentVerifiedRange(afterAsset,afterEvents):null;
          const meta={schemaVersion:3,replacementAutoV3:true,currentCycle:true,confirmationOnly:true,replacementEventId:existing.id,
            currentLastReplacementAt:existing.event_date,timePrecision:knownClock?'minute':'day',recordDate:fact.recordDate,
            registeredBaseline:!AUTO_TYPES.has(existing.source_type),cycleStartRevision:afterAsset.cycle_start_revision,
            cycleRuntimeRevision:afterAsset.cycle_runtime_revision,sourceKey:fact.sourceKey,sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash,
            ...(revokedRoleClock?{normalizationVersion:4,rolePrioritySourceRevoked:true}:{}),
            ...(previous && validRangeSeed(previous)?{normalizationVersion:4,rangeTrackingAllowed:true,rangeStartAt:previous.rangeStartAt,
              sourceWorkDate:previous.sourceWorkDate,sourceShift:previous.sourceShift}: {}),
            ...(registeredRange?{normalizationVersion:4,registeredRuntimeRange:true,basisKind:'verified_runtime_range',registeredBaseline:true,
              rangeTrackingAllowed:true,rangeStartAt:registeredRange.startAt,preservedRuntimeEventId:registeredRange.eventId}: {})};
          const confirmation=eventRow(user,now,{id,tag,date:now,type:'cycle_source_reconcile',sourceId:text(row.id),sourceText:makeSource(meta,fact.sourceText),
            note:'승인 업무일지 교체완료를 기존 등록 교체와 대조·자동 확인 · 누적시간과 Cycle 변경 없음'});
          afterEvents.push(confirmation);changes.push({kind:'confirmed',eventId:id,replacementEventId:existing.id});
        }
        result.linked++;result.results.push({tagNumber:tag,kind:'linked',eventId:existing.id});continue;
      }
      const sameSource=active.filter(event => AUTO_TYPES.has(event.source_type) && aliases.includes(text(event.source_log_id)) &&
        ((fact.sourceKey && sourceMetadata(event)?.sourceKey===fact.sourceKey) ||
          (tagFacts.length===1 && day(event.event_date)===day(fact.eventDate))));
      let authorSourceKey=null;
      try{authorSourceKey=JSON.parse(fact.sourceKey);}catch{}
      const authorDayCorrection=fact.timePrecision==='day' && Array.isArray(authorSourceKey) &&
        authorSourceKey[3]==='author-confirmed-v1' && sameSource.length===1 &&
        sourceMetadata(sameSource[0])?.sourceKey===fact.sourceKey && precision(sameSource[0])==='day';
      const placeholder=(sameSource.length===1 && (fact.timePrecision==='minute' || authorDayCorrection)?sameSource[0]:null) ||
        (fact.timePrecision==='minute'?active.filter(event => ['shift_log_history_v12','shift_log_history_v13'].includes(event.source_type) && midnight(event.event_date) &&
          day(event.event_date)===day(fact.eventDate) && precision(event)==='day').sort(order)[0]:null);
      const currentMs=instant(afterAsset.last_replacement_at),factMs=instant(fact.eventDate);
      const ownsPlaceholder=placeholder && instant(placeholder.event_date)===currentMs;
      const isCurrent=ownsPlaceholder || !Number.isFinite(currentMs) || factMs>currentMs;
      const eventId=placeholder?.id || `replacement-auto-v3:${await hash(`${physicalSource}|${tag}|${fact.sourceKey || fact.eventDate}|${fact.timePrecision}|${sourceHash}`)}`;
      if (afterEvents.some(event => event.id===eventId && event.event_type!=='replacement')) {
        // A previously retracted fact remains auditable; a changed source gets a new identity.
        return {...result,ok:false,status:409,code:'REPLACEMENT_FACT_IDENTITY_CONFLICT'};
      }
      const priorStoredCounter=isCurrent?Math.max(0,Number(afterAsset.cycle_runtime_hours ?? afterAsset.runtime_hours)||0):0;
      if (isCurrent) { Object.assign(afterAsset,resetPatch(afterAsset,fact.eventDate,user,now));reset=true; }
      const meta={schemaVersion:3,replacementAutoV3:true,currentCycle:isCurrent,replacementEventId:eventId,
        currentLastReplacementAt:isCurrent?fact.eventDate:'',recordDate:fact.recordDate,timePrecision:fact.timePrecision,
        ...(isCurrent?{cycleStartRevision:afterAsset.cycle_start_revision,cycleRuntimeRevision:afterAsset.cycle_runtime_revision}:{}),
        sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash,sourceKey:fact.sourceKey,...(isCurrent?rangeSeedMetadata(row,fact,options):{}),runtimeAtReplacementKnown:false,previousStoredCounterPreserved:isCurrent};
      const sourceText=makeSource(meta,fact.sourceText);
      const beforeRuntime=priorStoredCounter;
      let event;
      if (placeholder) {
        event={...placeholder,event_date:fact.eventDate,source_type:'shift_log_auto_v3',source_log_id:text(row.id),source_text:sourceText,updated_at:now};
        afterEvents[afterEvents.findIndex(value => value.id===placeholder.id)]=event;
      } else {
        event=eventRow(user,now,{id:eventId,tag,date:fact.eventDate,runtime:beforeRuntime,sourceId:text(row.id),sourceText,
          issueType:fact.issueType,note:fact.timePrecision==='day'?'승인 업무일지 교체완료 · 시각 미기록 (00:00은 날짜 정렬용)':'승인 업무일지 교체완료 시각 자동 반영'});
        afterEvents.push(event);
      }
      if (isCurrent) resetEvent=event;
      changes.push({kind:placeholder?'corrected':isCurrent?'applied':'historical',eventId:event.id,timePrecision:fact.timePrecision});
    }
    for(const selection of selectedFacts) {
      const fact=tagFacts.find(fact=>fact.sourceKey===selection.sourceKey);
      const owner=roleSelectionOwner(afterAsset,afterEvents,selection);
      if(!fact || !owner)continue;
      const id=`replacement-auto-v3:role-priority:${await hash(`${physicalSource}|${tag}|${owner.id}|${sourceHash}|${fact.sourceKey}`)}`;
      if(afterEvents.some(event=>event.id===id && sourceMetadata(event)))continue;
      const selectedCompletionAt=fact.timePrecision==='minute'?fact.eventDate:'';
      const rolePrioritySelection={version:1,selectedRole:selection.sourceRole,selectedCompletionAt,
        timePrecision:fact.timePrecision,selectedWorkDate:fact.recordDate,selectedShift:shiftKey(selection.shift),
        suppressedSourceLogIds:[...new Set(selection.suppressedSources.map(source=>source.sourceLogId))],
        requiredRebuild:fact.timePrecision==='minute' && instant(fact.eventDate)!==instant(afterAsset.last_replacement_at)};
      const meta={schemaVersion:3,replacementAutoV3:true,normalizationVersion:4,currentCycle:true,confirmationOnly:true,
        replacementEventId:owner.id,currentLastReplacementAt:text(afterAsset.last_replacement_at),
        timePrecision:fact.timePrecision,recordDate:fact.recordDate,registeredBaseline:true,
        cycleStartRevision:text(afterAsset.cycle_start_revision),cycleRuntimeRevision:text(afterAsset.cycle_runtime_revision),
        sourceKey:fact.sourceKey,sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash,rolePrioritySelection};
      const superseded=[];
      for(const event of afterEvents) {
        const prior=sourceMetadata(event);
        if(event.event_type!=='cycle_source_reconcile' || !prior || prior.replacementEventId!==owner.id ||
            prior.cycleStartRevision!==text(afterAsset.cycle_start_revision) ||
            ![selection,...selection.suppressedSources].some(source=>matchesRoleSource(event,source)))continue;
        event.source_text=makeSource({...prior,rolePrioritySupersededBy:id},prior.sourceText);event.updated_at=now;
        superseded.push(event.id);changes.push({kind:'evidenceSuperseded',eventId:event.id,replacementEventId:owner.id});
      }
      const certificate=eventRow(user,now,{id,tag,date:now,type:'cycle_source_reconcile',sourceId:text(row.id),
        sourceText:makeSource(meta,fact.sourceText),note:rolePrioritySelection.requiredRebuild
          ?'동일 교체작업 중복 · 상위 보직 업무일지 기준 선택 · 기존 등록·RUN 보존 · 선택 시각 기준 RUN 재조회 필요'
          :fact.timePrecision==='day'?'동일 교체작업 중복 · 상위 보직 업무일지 기준 선택 · 완료 시각 미기록 · 하위 보직 시각 차용 없음'
            :'동일 교체작업 중복 · 상위 보직 업무일지 기준 선택 · 기존 등록·RUN 보존'});
      afterEvents.push(certificate);changes.push({kind:'confirmed',eventId:id,replacementEventId:owner.id,
        rolePrioritySelection,supersededEvidenceIds:superseded,
        suppressedSources:selection.suppressedSources.map(source=>({sourceLogId:source.sourceLogId,sourceKey:source.sourceKey,
          sourceRole:source.sourceRole,sourceSnapshotSha256:source.sourceSnapshotSha256}))});
    }
    if (!changes.length) continue;
    if (reset) {
      const latest=afterEvents.filter(event => event.event_type==='replacement' && Number.isFinite(instant(event.event_date))).sort(order)[0];
      if (latest && instant(latest.event_date)>instant(afterAsset.last_replacement_at)) {
        Object.assign(afterAsset,resetPatch(afterAsset,latest.event_date,user,now));
        const id=`replacement-auto-v3:reproject:${await hash(`${physicalSource}|${tag}|${sourceHash}`)}`;
        const meta={schemaVersion:3,replacementAutoV3:true,currentCycle:true,replacementEventId:latest.id,
          currentLastReplacementAt:latest.event_date,timePrecision:precision(latest),registeredBaseline:!AUTO_TYPES.has(latest.source_type),
          cycleStartRevision:afterAsset.cycle_start_revision,cycleRuntimeRevision:afterAsset.cycle_runtime_revision,sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash};
        resetEvent=eventRow(user,now,{id,tag,date:now,type:'cycle_source_reconcile',sourceId:text(row.id),sourceText:makeSource(meta,''),
          note:'승인 업무일지 시각 정정 · 최종 등록 교체 기준 유지 · RUN 재계산 필요'});
        afterEvents.push(resetEvent);
      }
    }
    const audit={id:crypto.randomUUID(),action_type:'replacement_auto_v3',tag_number:tag,
      before_json:JSON.stringify({schemaVersion:3,asset,events:beforeEvents.filter(event => changes.some(change => change.eventId===event.id || change.replacementEventId===event.id))}),
      after_json:JSON.stringify({schemaVersion:3,asset:afterAsset,events:afterEvents.filter(event => changes.some(change => change.eventId===event.id || change.replacementEventId===event.id) || event.id===resetEvent?.id),
        sourceLogId:text(row.id),sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash,changes}),
      change_note:'승인 업무일지 교체완료 자동 반영 · 원본과 변경 전후 보존 · RUN 시간 추정 없음',
      changed_by_id:text(user?.employeeNo),changed_by_name:text(user?.name),changed_at:now};
    const beforeChecks=[rowExists('blower_history_assets',asset),eventsEqual(tag,beforeEvents)];
    const afterChecks=[rowExists('blower_history_assets',afterAsset),eventsEqual(tag,afterEvents),rowExists('blower_history_asset_history',audit)];
    if (options.sourceGuard?.sql) { beforeChecks.push(options.sourceGuard);afterChecks.push(options.sourceGuard); }
    const ids=[crypto.randomUUID(),crypto.randomUUID()];
    const statements=[guard(database,ids[0],beforeChecks)];
    if (reset) { const patch=Object.fromEntries(Object.entries(afterAsset).filter(([key,value]) => value!==asset[key]));statements.push(update(database,'blower_history_assets',asset,patch)); }
    for (const event of afterEvents) { const prior=beforeEvents.find(item => item.id===event.id);
      if (!prior) statements.push(insert(database,'blower_history_events',event));
      else { const patch=Object.fromEntries(Object.entries(event).filter(([key,value]) => value!==prior[key]));if (Object.keys(patch).length) statements.push(update(database,'blower_history_events',prior,patch)); }
    }
    statements.push(insert(database,'blower_history_asset_history',audit),guard(database,ids[1],afterChecks),database.prepare('DELETE FROM blower_history_atomic_guard WHERE id IN (?,?)').bind(...ids));
    try { await database.batch(statements); }
    catch (error) { if (/CHECK constraint failed(?:: valid = 1|.*blower_history_atomic_guard)/i.test(String(error?.message || error))) return {...result,ok:false,status:409,code:'REPLACEMENT_AUTO_CYCLE_CONFLICT'};throw error; }
    for (const change of changes) { result[change.kind]++;result.results.push({tagNumber:tag,...change}); }
  }
  return result;
}
