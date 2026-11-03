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
  return source?.schemaVersion === 3 && source?.replacementAutoV3 === true && source?.sourceRevisionSuperseded!==true ? source : null;
}
function precision(event) {
  return sourceMetadata(event)?.timePrecision || (midnight(event?.event_date) ? 'day' : 'minute');
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

export function isReplacementAutoRevision(asset) {
  return text(asset?.cycle_start_revision || asset?.cycleStartRevision).startsWith('replacement-auto-v3:');
}

/** Metadata for projection and narrowly authorized fresh RUN rebuilding.
 * A query certificate is consumed naturally when either cycle revision changes.
 * Historical DataPARC receipts can never regain ownership of the new cycle.
 */
export function replacementAutoCycleProof(asset,events) {
  if (!asset || !Array.isArray(events)) return null;
  const candidates=events.filter(event => event.tag_number===asset.tag_number && ['replacement','cycle_source_reconcile'].includes(event.event_type))
    .map(event => ({event,source:sourceMetadata(event)})).filter(item => item.source?.currentCycle===true &&
      text(item.source.currentLastReplacementAt)===text(asset.last_replacement_at) &&
      item.source.cycleStartRevision===text(asset.cycle_start_revision))
    .sort((a,b) => text(b.event.created_at).localeCompare(text(a.event.created_at)) || text(b.event.id).localeCompare(text(a.event.id)));
  const current=candidates[0];
  if (!current) return null;
  const {event,source}=current;
  const clockKnown=source.timePrecision==='minute' && Number.isFinite(instant(source.currentLastReplacementAt));
  const registeredBaseline=source.registeredBaseline===true && Number.isFinite(instant(source.currentLastReplacementAt));
  const resetAuthority=source.confirmationOnly!==true || (isReplacementAutoRevision(asset) && candidates.some(item =>
    item.source.confirmationOnly!==true && item.source.cycleRuntimeRevision===text(asset.cycle_runtime_revision)));
  const fresh=resetAuthority && source.cycleRuntimeRevision===text(asset.cycle_runtime_revision) && asset.cycle_start_state==='pending' &&
    !text(asset.cycle_started_at) && Number(asset.cycle_runtime_hours)===0 && Number(asset.runtime_hours)===0;
  return {schemaVersion:3,eventId:event.id,confirmationOnly:source.confirmationOnly===true,cycleStartRevision:source.cycleStartRevision,cycleRuntimeRevision:source.cycleRuntimeRevision,replacementEventId:source.replacementEventId || (event.event_type==='replacement'?event.id:''),
    timePrecision:source.timePrecision,clockKnown,registeredBaseline,storedRuntimeHours:Number(asset.cycle_runtime_hours),storedLegacyRuntimeHours:Number(asset.runtime_hours),requiredStartAt:clockKnown || registeredBaseline?source.currentLastReplacementAt:'',
    freshQueryEligible:(clockKnown || registeredBaseline) && fresh,requiresRunRefresh:fresh,sourceLogId:event.source_log_id,
    sourceSnapshotSha256:source.sourceSnapshotSha256};
}

/** Caller supplies completed belt facts from an approved server-loaded source.
 * Empty facts explicitly retract this source's unsupported automatic targets.
 * Manual events are preserved; old RUN hours are never transplanted to a cycle.
 */
export async function reconcileApprovedReplacementLog(database,user,row,facts,options={}) {
  const result={ok:true,applied:0,corrected:0,retracted:0,historical:0,linked:0,confirmed:0,evidenceSuperseded:0,protected:0,results:[]};
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
  const linked=await database.prepare(`SELECT * FROM blower_history_events WHERE event_type='replacement' AND source_log_id IN (${aliases.map(() => '?').join(',')})`).bind(...aliases).all();
  const related=(linked.results || []).filter(event => AUTO_TYPES.has(event.source_type));
  const tags=[...new Set([...normalized.map(fact => fact.tagNumber),...related.map(event => event.tag_number)])];
  for (const tag of tags) {
    const asset=await database.prepare('SELECT * FROM blower_history_assets WHERE tag_number=? AND enabled=1').bind(tag).first();
    if (!asset) { result.protected++; continue; }
    const loaded=await database.prepare('SELECT * FROM blower_history_events WHERE tag_number=? ORDER BY event_date DESC,created_at DESC,id DESC').bind(tag).all();
    const beforeEvents=loaded.results || [];
    if (JSON.stringify(beforeEvents).length>1200000) return {...result,ok:false,status:409,code:'REPLACEMENT_HISTORY_LIMIT'};
    const afterEvents=beforeEvents.map(event => ({...event}));
    let afterAsset={...asset},reset=false,resetEvent=null;
    const changes=[];
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
    const supportsEvent=event => {
      const prior=sourceMetadata(event);
      if (!prior?.sourceKey) return tagFacts.length>0;
      return tagFacts.some(fact => fact.sourceKey===prior.sourceKey ||
        (fact.timePrecision==='minute' && instant(fact.eventDate)===instant(event.event_date)));
    };
    // An unchecked/stale author control is not permission to erase a prior
    // registered event or reset its cycle. Existing unannotated V3 sources
    // keep their previous reconciliation semantics.
    const protectedEntryIds = Array.isArray(options.preserveSourceEntryIds) ? options.preserveSourceEntryIds : [];
    const authorControlProtects = event => {
      const prior = sourceMetadata(event);
      let key = null;
      try { key = JSON.parse(prior?.sourceKey || 'null'); } catch {}
      const entryKey = Array.isArray(key) ? text(key[2]) : '';
      // Older entries without IDs used a collection position. Assigning a new
      // stable ID while editing must not turn that missing identity into
      // authority to retract its already registered replacement/cycle.
      const positional = /^(?:(?:entries|tmEntries|handoverEntries|remarkEntries)(?:\.(?:note|remark|remarks))?|note|remark|remarks):\d+$/.test(entryKey);
      return entryKey && !positional ? protectedEntryIds.includes(entryKey) : options.preserveUnkeyedAutomaticEvents === true;
    };
    const unsupported = afterEvents.filter(event => event.event_type==='replacement' && AUTO_TYPES.has(event.source_type) && aliases.includes(text(event.source_log_id)) && !supportsEvent(event));
    const retract = unsupported.filter(event => !authorControlProtects(event));
    result.protected += unsupported.length - retract.length;
    for (const event of retract) { event.event_type='_retracted_replacement';event.updated_at=now;changes.push({kind:'retracted',eventId:event.id}); }
    if (retract.some(event => instant(event.event_date)===instant(asset.last_replacement_at))) {
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
      const active=afterEvents.filter(event => event.event_type==='replacement');
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
          const knownClock=previous?.timePrecision==='minute' || fact.timePrecision==='minute' ||
            (!AUTO_TYPES.has(existing.source_type) && precision(existing)==='minute');
          const meta={schemaVersion:3,replacementAutoV3:true,currentCycle:true,confirmationOnly:true,replacementEventId:existing.id,
            currentLastReplacementAt:existing.event_date,timePrecision:knownClock?'minute':'day',recordDate:fact.recordDate,
            registeredBaseline:!AUTO_TYPES.has(existing.source_type),cycleStartRevision:afterAsset.cycle_start_revision,
            cycleRuntimeRevision:afterAsset.cycle_runtime_revision,sourceKey:fact.sourceKey,sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash};
          const confirmation=eventRow(user,now,{id,tag,date:now,type:'cycle_source_reconcile',sourceId:text(row.id),sourceText:makeSource(meta,fact.sourceText),
            note:'승인 업무일지 교체완료를 기존 등록 교체와 대조·자동 확인 · 누적시간과 Cycle 변경 없음'});
          afterEvents.push(confirmation);changes.push({kind:'confirmed',eventId:id,replacementEventId:existing.id});
        }
        result.linked++;result.results.push({tagNumber:tag,kind:'linked',eventId:existing.id});continue;
      }
      const sameSource=active.filter(event => AUTO_TYPES.has(event.source_type) && aliases.includes(text(event.source_log_id)) &&
        ((fact.sourceKey && sourceMetadata(event)?.sourceKey===fact.sourceKey) ||
          (tagFacts.length===1 && day(event.event_date)===day(fact.eventDate))));
      let authorSourceKey = null;
      try { authorSourceKey = JSON.parse(fact.sourceKey); } catch {}
      // A manually confirmed job keeps its physical identity when its author
      // corrects a date without supplying a clock. Legacy inferred day facts
      // retain their existing matching rules.
      const authorDayCorrection = fact.timePrecision==='day' && Array.isArray(authorSourceKey) &&
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
        sourcePhysicalId:physicalSource,sourceSnapshotSha256:sourceHash,sourceKey:fact.sourceKey,runtimeAtReplacementKnown:false,previousStoredCounterPreserved:isCurrent};
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
