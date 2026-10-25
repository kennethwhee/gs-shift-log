import {CORRECTION_TABLE,localMinute,validPeriod,boundaryKey,normalizeCorrection,ensureCorrectionTable,correctionFromRow,latestCorrection,listCorrections,snapshotEvidence} from '../_shared/cofiring-inventory-correction-store.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function authenticate(context){
  const db=context.env?.DB;if(!db)return {error:json({ok:false,message:'DB 연결을 확인해 주세요.'},503)};
  const token=/^Bearer\s+(.+)$/i.exec(context.request.headers.get('Authorization')||'')?.[1]?.trim();
  if(!token)return {error:json({ok:false,message:'로그인이 필요합니다.'},401)};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  const row=await db.prepare(`SELECT s.employee_no,s.expires_at,u.name,u.is_active FROM shift_log_sessions s
    INNER JOIN users u ON u.employee_no=s.employee_no WHERE s.token_hash=? LIMIT 1`).bind(hash).first();
  const expires=Date.parse(row?.expires_at||'');
  if(!row||Number(row.is_active)!==1||!Number.isFinite(expires)||expires<=Date.now())return {error:json({ok:false,message:'로그인 세션이 만료되었습니다.'},401)};
  await db.prepare('UPDATE shift_log_sessions SET last_used_at=? WHERE token_hash=?').bind(new Date().toISOString(),hash).run();
  return {user:{employeeNo:String(row.employee_no),name:String(row.name||'')}};
}
function sameWrite(row,body,user,value){
  const entry=correctionFromRow(row);return !!entry&&entry.revision===body.expectedRevision+1&&entry.updatedById===user.employeeNo&&JSON.stringify(normalizeCorrection(entry))===JSON.stringify(value);
}
export async function onRequestGet(context){
  try{
    const auth=await authenticate(context);if(auth.error)return auth.error;
    const url=new URL(context.request.url),start=url.searchParams.get('start'),end=url.searchParams.get('end');
    if(!validPeriod(start,end))return json({ok:false,message:'재고 보정 조회 기간을 확인해 주세요. 최대 31일 범위입니다.'},400);
    return json({ok:true,start,end,...await listCorrections(context.env.DB,start,end,{history:true})});
  }catch(error){console.error('inventory correction read failed',error instanceof Error?error.message:'unknown');return json({ok:false,message:'재고 보정 이력을 불러오지 못했습니다.'},500);}
}
export async function onRequestPost(context){
  try{
    const auth=await authenticate(context);if(auth.error)return auth.error;
    const req=context.request,origin=req.headers.get('Origin');
    if(origin&&origin!==new URL(req.url).origin)return json({ok:false,message:'같은 업무일지 화면에서 저장해 주세요.'},403);
    if(req.headers.get('X-ShiftLog-Client')!=='desktop'||/Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get('User-Agent')||''))return json({ok:false,message:'재고 경계 보정은 로그인한 PC 화면에서 가능합니다.'},403);
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||''))return json({ok:false,message:'JSON 형식으로 저장해 주세요.'},415);
    if(Number(req.headers.get('Content-Length')||0)>16384)return json({ok:false,message:'저장 요청이 너무 큽니다.'},413);
    const raw=await req.text();if(new TextEncoder().encode(raw).length>16384)return json({ok:false,message:'저장 요청이 너무 큽니다.'},413);
    let body;try{body=JSON.parse(raw);}catch{return json({ok:false,message:'저장 요청 형식이 올바르지 않습니다.'},400);}
    const allowed=['silo','boundaryLocal','tons','method','reason','evidence','expectedRevision','requestId'];
    const value=normalizeCorrection(body);
    if(!value||Object.keys(body).some(k=>!allowed.includes(k))||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.requestId!=='string'||!/^[a-f0-9-]{20,64}$/i.test(body.requestId))return json({ok:false,message:'재고 경계·수량·확인 방식·사유·근거를 확인해 주세요. 빈 수량은 0으로 저장하지 않습니다.'},400);
    if(localMinute(value.boundaryLocal)>Date.now())return json({ok:false,message:'아직 지나지 않은 재고 경계는 보정할 수 없습니다.'},400);
    const db=context.env.DB;await ensureCorrectionTable(db);
    const repeated=await db.prepare(`SELECT * FROM ${CORRECTION_TABLE} WHERE request_id=? LIMIT 1`).bind(body.requestId).first();
    if(repeated){if(!sameWrite(repeated,body,auth.user,value))return json({ok:false,code:'REQUEST_CONFLICT',message:'이미 다른 내용으로 처리된 요청입니다.'},409);return json({ok:true,entry:correctionFromRow(repeated),replayed:true});}
    let evidenceSnapshots;try{evidenceSnapshots=await snapshotEvidence(db,value);}catch(error){return json({ok:false,code:'EVIDENCE_CHANGED',message:error.message},409);}
    const at=new Date().toISOString(),key=boundaryKey(value.silo,value.boundaryLocal);
    // Evidence versions are checked again atomically with the append.
    const evidenceClauses=value.evidence.map(()=> 'EXISTS (SELECT 1 FROM solid_fuel_unloading_logs WHERE id=? AND version=? AND deleted_at IS NULL)');
    await db.prepare(`INSERT INTO ${CORRECTION_TABLE}(boundary_key,silo,boundary_local,revision,correction_json,request_id,updated_by_id,updated_by_name,updated_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM ${CORRECTION_TABLE} WHERE boundary_key=?),0)=?
      ${evidenceClauses.length?' AND '+evidenceClauses.join(' AND '):''} ON CONFLICT DO NOTHING`)
      .bind(key,value.silo,value.boundaryLocal,body.expectedRevision+1,JSON.stringify({...value,evidenceSnapshots}),body.requestId,auth.user.employeeNo,auth.user.name,at,key,body.expectedRevision,...value.evidence.flatMap(ref=>[ref.id,ref.version])).run();
    const saved=await db.prepare(`SELECT * FROM ${CORRECTION_TABLE} WHERE request_id=? LIMIT 1`).bind(body.requestId).first();
    if(!sameWrite(saved,body,auth.user,value))return json({ok:false,code:'REVISION_CONFLICT',message:'다른 화면의 보정값 또는 하역 근거가 변경되었습니다. 최신 자료를 다시 불러와 주세요.',current:await latestCorrection(db,value.silo,value.boundaryLocal)},409);
    return json({ok:true,entry:correctionFromRow(saved),replayed:false});
  }catch(error){console.error('inventory correction save failed',error instanceof Error?error.message:'unknown');return json({ok:false,message:'재고 보정 저장 완료를 확인하지 못했습니다. 입력값은 유지됩니다.'},500);}
}
export async function onRequest(context){if(context.request.method==='GET')return onRequestGet(context);if(context.request.method==='POST')return onRequestPost(context);return json({ok:false,message:'지원하지 않는 요청 방식입니다.'},405);}
