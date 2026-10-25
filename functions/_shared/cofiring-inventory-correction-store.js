// Operator corrections are a separate, append-only audit trail. DataPARC rows
// and already closed calculation snapshots are never changed by this store.
export const CORRECTION_TABLE='cofiring_inventory_correction_history';
export const SILOS=['organicDaySilo','organicStorageSiloA','organicStorageSiloB'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function localMinute(value){
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
  const ms=Date.parse(value+':00+09:00');
  return Number.isFinite(ms)&&new Date(ms+9*3600000).toISOString().slice(0,16)===value?ms:null;
}
export function validPeriod(start,end){const a=localMinute(start),b=localMinute(end);return a!==null&&b!==null&&b>a&&b-a<=31*86400000;}
export const boundaryKey=(silo,boundaryLocal)=>`${silo}|${boundaryLocal}`;
export function normalizeCorrection(input){
  if(!object(input)||!SILOS.includes(input.silo)||localMinute(input.boundaryLocal)===null||
    typeof input.tons!=='number'||!Number.isFinite(input.tons)||input.tons<0||input.tons>1000000||
    Number(input.tons.toFixed(6))!==input.tons||
    !['confirmed','estimated'].includes(input.method)||typeof input.reason!=='string'||
    !input.reason.trim()||input.reason.trim().length>1000||!Array.isArray(input.evidence)||input.evidence.length>32)return null;
  const seen=new Set(),evidence=[];
  for(const ref of input.evidence){
    if(!object(ref)||Object.keys(ref).some(k=>!['id','version'].includes(k))||
      typeof ref.id!=='string'||!ref.id.trim()||ref.id!==ref.id.trim()||ref.id.length>160||
      /[\u0000-\u001f]/.test(ref.id)||!Number.isSafeInteger(ref.version)||ref.version<1||seen.has(ref.id))return null;
    seen.add(ref.id);evidence.push({id:ref.id,version:ref.version});
  }
  evidence.sort((a,b)=>a.id.localeCompare(b.id));
  return {silo:input.silo,boundaryLocal:input.boundaryLocal,tons:input.tons,method:input.method,reason:input.reason.trim(),evidence};
}
export async function ensureCorrectionTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${CORRECTION_TABLE}(
    boundary_key TEXT NOT NULL,silo TEXT NOT NULL,boundary_local TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>0),correction_json TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,updated_by_id TEXT NOT NULL,updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,PRIMARY KEY(boundary_key,revision))`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_${CORRECTION_TABLE}_boundary ON ${CORRECTION_TABLE}(boundary_local,silo,revision DESC)`).run();
}
export function correctionFromRow(row){
  if(!row)return null;
  try{
    const parsed=JSON.parse(row.correction_json),value=normalizeCorrection(parsed);
    if(!value||row.boundary_key!==boundaryKey(value.silo,value.boundaryLocal)||row.silo!==value.silo||row.boundary_local!==value.boundaryLocal||!Number.isSafeInteger(Number(row.revision))||Number(row.revision)<1)return null;
    return {...value,evidenceSnapshots:Array.isArray(parsed.evidenceSnapshots)?parsed.evidenceSnapshots:[],revision:Number(row.revision),updatedById:String(row.updated_by_id),updatedByName:String(row.updated_by_name),updatedAt:String(row.updated_at)};
  }catch{return null;}
}
export async function latestCorrection(db,silo,boundaryLocal){return correctionFromRow(await db.prepare(`SELECT * FROM ${CORRECTION_TABLE} WHERE boundary_key=? ORDER BY revision DESC LIMIT 1`).bind(boundaryKey(silo,boundaryLocal)).first());}
export async function listCorrections(db,start,end,{history=false}={}){
  if(!validPeriod(start,end))throw new Error('재고 보정 조회 기간이 올바르지 않습니다.');
  await ensureCorrectionTable(db);
  const result=await db.prepare(`SELECT h.* FROM ${CORRECTION_TABLE} h WHERE h.boundary_local IN (?,?)
    AND h.revision=(SELECT MAX(n.revision) FROM ${CORRECTION_TABLE} n WHERE n.boundary_key=h.boundary_key)
    ORDER BY h.boundary_local,h.silo`).bind(start,end).all();
  const entries=(result.results||[]).map(correctionFromRow);
  if(entries.some(x=>!x))throw new Error('저장된 재고 보정 이력을 확인할 수 없습니다.');
  if(!history)return entries;
  const audit=await db.prepare(`SELECT * FROM ${CORRECTION_TABLE} WHERE boundary_local IN (?,?) ORDER BY updated_at DESC,revision DESC LIMIT 121`).bind(start,end).all();
  return {entries,history:(audit.results||[]).slice(0,120).map(correctionFromRow).filter(Boolean),historyTruncated:(audit.results||[]).length>120};
}
function localAt(ms){return new Date(ms+9*3600000).toISOString().slice(0,16);}
export function evidenceWindow(boundaryLocal){
  const ms=localMinute(boundaryLocal);if(ms===null)return null;
  return {windowStart:localAt(ms-86400000),windowEnd:localAt(ms+86400000)};
}
export function unloadingEvidence(row,boundaryLocal){
  const clock=value=>typeof value==='string'&&/^\d{2}:\d{2}$/.test(value)&&Number(value.slice(0,2))<24&&Number(value.slice(3))<60?value:null;
  const date=String(row.unloading_date||''),arrival=clock(row.arrival_time),departure=clock(row.departure_time);
  const day=localMinute(date+'T00:00'),departureLocal=day!==null&&departure?date+'T'+departure:null;
  // unloading_date is the completed-unloading date, including overnight rows.
  const arrivalDate=day!==null&&arrival&&departure?localAt(day-(departure<arrival?86400000:0)).slice(0,10):null;
  const arrivalLocal=arrivalDate?arrivalDate+'T'+arrival:null;
  const receipt=row.receipt_tons===null||row.receipt_tons===undefined||row.receipt_tons===''?null:Number(row.receipt_tons);
  const receiptTons=Number.isFinite(receipt)&&receipt>0&&receipt<=1000000?receipt:null;
  const boundary=localMinute(boundaryLocal),a=localMinute(arrivalLocal),d=localMinute(departureLocal);
  const route=String(row.silo_route||''),destinations=[...route.matchAll(/#?\b[AB]\b|Day/gi)].map(m=>m[0].replace('#','').toUpperCase());
  const flags=[];
  if(!arrivalLocal)flags.push('arrival-time-unknown');
  if(!departureLocal)flags.push('departure-time-unknown');
  if(row.duration_known!==undefined&&Number(row.duration_known)!==1)flags.push('duration-unknown');
  if(receiptTons===null)flags.push('receipt-tons-unknown');
  if(!['organic','manure'].includes(row.fuel_type))flags.push('fuel-type-unknown');
  if(new Set(destinations).size!==1)flags.push('silo-allocation-unknown');
  if(a!==null&&d!==null&&a<=boundary&&d>boundary)flags.push('crosses-boundary');
  return {id:String(row.id),version:Number(row.version||1),unloadingDate:date,
    arrivalTime:String(row.arrival_time||''),departureTime:String(row.departure_time||''),arrivalLocal,departureLocal,
    durationKnown:Number(row.duration_known??1)===1,durationMinutes:Number(row.duration_known??1)===1?Number(row.duration_minutes||0):null,
    fuelType:String(row.fuel_type||''),receiptTons,siloRoute:route,companyName:String(row.company_name||''),vehicleNo:String(row.vehicle_no||''),note:String(row.note||''),updatedAt:String(row.updated_at||''),flags};
}
export async function inventoryEvidence(db,boundaryLocal){
  const window=evidenceWindow(boundaryLocal);if(!window)throw new Error('재고 경계 일시를 확인해 주세요.');
  const rows=await db.prepare(`SELECT * FROM solid_fuel_unloading_logs WHERE deleted_at IS NULL
    AND unloading_date>=? AND unloading_date<=? ORDER BY unloading_date,departure_time,id LIMIT 401`)
    .bind(window.windowStart.slice(0,10),window.windowEnd.slice(0,10)).all();
  const records=(rows.results||[]).slice(0,400).map(row=>unloadingEvidence(row,boundaryLocal)).filter(row=>
    !row.departureLocal||!row.arrivalLocal||row.departureLocal>=window.windowStart&&row.arrivalLocal<=window.windowEnd);
  return {boundaryLocal,source:'solid-fuel-unloading',basis:'completed-unloading-departure',...window,records,truncated:(rows.results||[]).length>400};
}
export async function snapshotEvidence(db,correction){
  const snapshots=[],window=evidenceWindow(correction.boundaryLocal);
  for(const ref of correction.evidence){
    const row=await db.prepare('SELECT * FROM solid_fuel_unloading_logs WHERE id=? AND deleted_at IS NULL LIMIT 1').bind(ref.id).first();
    if(!row||Number(row.version)!==ref.version)throw new Error('참조한 하역 기록이 변경되거나 삭제되었습니다. 최신 기록을 다시 확인해 주세요.');
    const evidence=unloadingEvidence(row,correction.boundaryLocal);
    if(evidence.unloadingDate<window.windowStart.slice(0,10)||evidence.unloadingDate>window.windowEnd.slice(0,10)||
      evidence.arrivalLocal&&evidence.departureLocal&&(evidence.departureLocal<window.windowStart||evidence.arrivalLocal>window.windowEnd))throw new Error('재고 경계 주변의 하역 기록만 근거로 연결할 수 있습니다.');
    snapshots.push(evidence);
  }
  return snapshots;
}
// Used in the same SQLite statement as a close write, so a concurrent revision
// or evidence edit cannot silently change the operator's reviewed calculation.
export function correctionWriteGuard(entries){
  const clauses=[],args=[],evidence=new Map();
  for(const entry of entries){
    clauses.push(`(SELECT MAX(revision) FROM ${CORRECTION_TABLE} WHERE boundary_key=?)=?`);args.push(boundaryKey(entry.silo,entry.boundaryLocal),entry.revision);
    for(const ref of entry.evidence)evidence.set(ref.id+'|'+ref.version,ref);
  }
  if(evidence.size){clauses.push(`NOT EXISTS (SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS
    (SELECT 1 FROM solid_fuel_unloading_logs evidence WHERE evidence.id=json_extract(ref.value,'$.id')
    AND evidence.version=json_extract(ref.value,'$.version') AND evidence.deleted_at IS NULL))`);args.push(JSON.stringify([...evidence.values()]));}
  return {sql:clauses.length?' AND '+clauses.join(' AND '):'',args};
}
