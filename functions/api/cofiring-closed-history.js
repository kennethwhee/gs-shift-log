import { validateClosedSnapshot, validDate } from '../_shared/cofiring-closed-validation.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  }
});

const text=value=>typeof value==='string'?value.trim():'';

function koreanToday(){
  return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
}

async function auth(context){
  const db=context.env?.DB;

  if(!db){
    return {error:json({ok:false,message:'DB 연결을 확인해 주세요.'},503)};
  }

  const authorization=text(context.request.headers.get('Authorization'));
  const token=/^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();

  if(!token){
    return {error:json({ok:false,message:'로그인이 필요합니다.'},401)};
  }

  const digest=await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token)
  );

  const hash=[...new Uint8Array(digest)]
    .map(v=>v.toString(16).padStart(2,'0'))
    .join('');

  const row=await db.prepare(`
    SELECT
      s.employee_no,
      s.expires_at,
      u.name,
      u.is_active
    FROM shift_log_sessions s
    INNER JOIN users u
      ON u.employee_no=s.employee_no
    WHERE s.token_hash=?
    LIMIT 1
  `).bind(hash).first();

  const expires=new Date(row?.expires_at||0);

  if(
    !row||
    Number(row.is_active)!==1||
    !Number.isFinite(expires.getTime())||
    expires<=new Date()
  ){
    return {error:json({ok:false,message:'로그인 세션이 만료되었습니다.'},401)};
  }

  await db.prepare(`
    UPDATE shift_log_sessions
    SET last_used_at=?
    WHERE token_hash=?
  `).bind(new Date().toISOString(),hash).run();

  return {
    user:{
      employeeNo:String(row.employee_no||''),
      name:String(row.name||'')
    }
  };
}

async function ensureSchema(db){
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS cofiring_closed_snapshots (
      target_date TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      source_request_id TEXT NOT NULL DEFAULT '',
      summary_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      saved_by_id TEXT NOT NULL,
      saved_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_cofiring_closed_snapshots_updated
    ON cofiring_closed_snapshots(updated_at DESC)
  `).run();
}

async function publicRow(row,{includeSnapshot=false}={}){
  if(!row)return null;
  let summary=null,snapshot=null;
  try{summary=JSON.parse(row.summary_json||'null');}catch(_){}
  if(row.snapshot_json){try{snapshot=JSON.parse(row.snapshot_json);}catch(_){}}
  const identity=JSON.stringify([row.target_date,row.revision,row.source_request_id,row.created_at,
    row.updated_at,row.saved_by_id,row.saved_by_name,row.save_id??snapshot?.saveId??'',row.summary_json]);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  const version=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
  return {targetDate:String(row.target_date||''),revision:Number(row.revision)||1,version,
    sourceRequestId:String(row.source_request_id||''),summary,
    savedById:String(row.saved_by_id||''),savedByName:String(row.saved_by_name||''),
    createdAt:String(row.created_at||''),updatedAt:String(row.updated_at||''),
    ...(includeSnapshot?{snapshot}:{})};
}
const MAX_BODY_BYTES=1500000;
const versioned=(revision,version)=>Number.isSafeInteger(revision)&&revision>=0&&
  (revision===0?version===null:typeof version==='string'&&/^[a-f0-9]{64}$/.test(version));
const currentRow=(db,date)=>db.prepare('SELECT * FROM cofiring_closed_snapshots WHERE target_date=? LIMIT 1').bind(date).first();
async function conflict(db,date,code='REVISION_CONFLICT'){
  return json({ok:false,code,message:code==='ALREADY_CLOSED'?'이미 마감 저장된 날짜입니다.':
    '다른 화면에서 마감 자료를 변경했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.',
    item:await publicRow(await currentRow(db,date))},409);
}
async function readBody(request){
  if(Number(request.headers.get('Content-Length')||0)>MAX_BODY_BYTES)throw Object.assign(new Error('마감 저장 요청이 너무 큽니다.'),{status:413});
  const reader=request.body?.getReader();if(!reader)throw Object.assign(new Error('마감 저장 데이터가 없습니다.'),{status:400});
  const decoder=new TextDecoder();let size=0,raw='';
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
    if(size>MAX_BODY_BYTES){await reader.cancel();throw Object.assign(new Error('마감 저장 요청이 너무 큽니다.'),{status:413});}
    raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();}
  finally{reader.releaseLock();}
  try{return JSON.parse(raw);}catch{throw Object.assign(new Error('마감 저장 데이터가 올바른 JSON 형식이 아닙니다.'),{status:400});}
}
function originError(request){
  const origin=request.headers.get('Origin');
  return origin&&origin!==new URL(request.url).origin?json({ok:false,message:'같은 업무일지 화면에서 저장해 주세요.'},403):null;
}
export async function onRequestGet(context){
  try{
    const a=await auth(context);if(a.error)return a.error;
    const db=context.env.DB,url=new URL(context.request.url),targetDate=text(url.searchParams.get('targetDate')),
      month=text(url.searchParams.get('month'));
    if(targetDate&&!validDate(targetDate))return json({ok:false,message:'날짜 형식이 올바르지 않습니다.'},400);
    if(month&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return json({ok:false,message:'조회 월을 확인해 주세요.'},400);
    await ensureSchema(db);
    if(targetDate)return json({ok:true,item:await publicRow(await currentRow(db,targetDate),{includeSnapshot:true})});
    const requested=Number.parseInt(url.searchParams.get('limit')||'120',10);
    const limit=month?31:Math.min(366,Math.max(1,Number.isFinite(requested)?requested:120));
    const columns=`target_date,revision,source_request_id,summary_json,saved_by_id,saved_by_name,created_at,updated_at,
      CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json,'$.saveId') ELSE '' END AS save_id`;
    const rows=await db.prepare(`SELECT ${columns} FROM cofiring_closed_snapshots
      ${month?'WHERE target_date>=? AND target_date<?':''} ORDER BY target_date DESC LIMIT ?`)
      .bind(...(month?[month+'-01',month+'-32',limit]:[limit])).all();
    return json({ok:true,items:await Promise.all((rows.results||[]).map(row=>publicRow(row)))});
  }catch(error){
    console.error('cofiring closed snapshot GET:',error);
    return json({ok:false,message:'마감 데이터를 불러오지 못했습니다.'},500);
  }
}
export async function onRequestPost(context){
  try{
    const a=await auth(context);if(a.error)return a.error;
    const denied=originError(context.request);if(denied)return denied;
    if(!/^application\/json(?:\s*;|$)/i.test(context.request.headers.get('Content-Type')||'')){
      return json({ok:false,message:'JSON 형식으로 저장해 주세요.'},415);
    }
    let body;try{body=await readBody(context.request);}catch(error){return json({ok:false,message:error.message},error.status||400);}
    if(!body||typeof body!=='object'||Array.isArray(body))return json({ok:false,message:'마감 저장 데이터가 올바르지 않습니다.'},400);
    if(!versioned(body.expectedRevision,body.expectedVersion)){
      return json({ok:false,code:'RELOAD_REQUIRED',message:'화면을 새로고침하고 마감 자료의 최신 상태를 확인해 주세요.'},428);
    }
    const targetDate=text(body.targetDate),sourceRequestId=text(body.sourceRequestId);
    if(!validDate(targetDate)||targetDate>=koreanToday()||!sourceRequestId){
      return json({ok:false,message:'오늘 이전의 완료된 일별 자료만 마감할 수 있습니다.'},400);
    }
    const db=context.env.DB;await ensureSchema(db);
    const existing=await currentRow(db,targetDate),previous=await publicRow(existing);
    if(body.expectedRevision===0&&existing)return conflict(db,targetDate,'ALREADY_CLOSED');
    if(body.expectedRevision>0&&(!existing||previous.revision!==body.expectedRevision||previous.version!==body.expectedVersion)){
      return conflict(db,targetDate);
    }
    if(existing&&body.overwrite!==true)return conflict(db,targetDate,'ALREADY_CLOSED');
    const source=await db.prepare(`SELECT id,target_date,status,result_json FROM ois_data_requests
      WHERE id=? AND request_type='cofiring_period' AND status='complete' LIMIT 1`).bind(sourceRequestId).first();
    if(!source||source.target_date!==targetDate)return json({ok:false,message:'서버에서 완료된 DataPARC 조회 결과를 확인할 수 없습니다.'},409);
    let canonical;
    try{canonical=validateClosedSnapshot({...body,targetDate,sourceRequestId},source);}
    catch(error){return json({ok:false,code:'CALCULATION_MISMATCH',message:error.message},400);}
    const snapshotText=JSON.stringify(canonical.snapshot),summaryText=JSON.stringify(canonical.summary),now=new Date().toISOString();
    if(new TextEncoder().encode(snapshotText).length>MAX_BODY_BYTES)return json({ok:false,message:'마감 스냅샷 크기가 너무 큽니다.'},413);
    let written;
    if(existing){
      written=await db.prepare(`UPDATE cofiring_closed_snapshots SET revision=revision+1,source_request_id=?,
        summary_json=?,snapshot_json=?,saved_by_id=?,saved_by_name=?,updated_at=?
        WHERE target_date=? AND revision=? AND snapshot_json=? AND updated_at=? RETURNING *`)
        .bind(sourceRequestId,summaryText,snapshotText,a.user.employeeNo,a.user.name,now,
          targetDate,body.expectedRevision,existing.snapshot_json,existing.updated_at).all();
    }else{
      written=await db.prepare(`INSERT INTO cofiring_closed_snapshots
        (target_date,revision,source_request_id,summary_json,snapshot_json,saved_by_id,saved_by_name,created_at,updated_at)
        VALUES (?,1,?,?,?,?,?,?,?) ON CONFLICT(target_date) DO NOTHING RETURNING *`)
        .bind(targetDate,sourceRequestId,summaryText,snapshotText,a.user.employeeNo,a.user.name,now,now).all();
    }
    const saved=written.results?.[0];if(!saved)return conflict(db,targetDate);
    return json({ok:true,item:await publicRow(saved),message:existing?'마감 데이터를 갱신했습니다.':'마감 데이터를 저장했습니다.'});
  }catch(error){
    console.error('cofiring closed snapshot POST:',error);
    return json({ok:false,message:'마감 데이터를 저장하지 못했습니다.'},500);
  }
}
export async function onRequestDelete(context){
  try{
    const a=await auth(context);if(a.error)return a.error;
    const denied=originError(context.request);if(denied)return denied;
    const url=new URL(context.request.url),targetDate=text(url.searchParams.get('targetDate')),
      expectedRevision=Number(url.searchParams.get('expectedRevision')),expectedVersion=url.searchParams.get('expectedVersion');
    if(!validDate(targetDate))return json({ok:false,message:'삭제 날짜가 올바르지 않습니다.'},400);
    if(expectedRevision<1||!versioned(expectedRevision,expectedVersion)){
      return json({ok:false,code:'RELOAD_REQUIRED',message:'마감 목록을 새로고침하고 삭제할 자료를 다시 확인해 주세요.'},428);
    }
    const db=context.env.DB;await ensureSchema(db);
    const existing=await currentRow(db,targetDate),previous=await publicRow(existing);
    if(!existing||previous.revision!==expectedRevision||previous.version!==expectedVersion)return conflict(db,targetDate);
    const result=await db.prepare(`DELETE FROM cofiring_closed_snapshots
      WHERE target_date=? AND revision=? AND snapshot_json=? AND updated_at=? RETURNING target_date`)
      .bind(targetDate,expectedRevision,existing.snapshot_json,existing.updated_at).all();
    if(result.results?.length!==1)return conflict(db,targetDate);
    return json({ok:true,deleted:true});
  }catch(error){
    console.error('cofiring closed snapshot DELETE:',error);
    return json({ok:false,message:'마감 데이터를 삭제하지 못했습니다.'},500);
  }
}
export async function onRequest(context){
  if(context.request.method==='GET')return onRequestGet(context);
  if(context.request.method==='POST')return onRequestPost(context);
  if(context.request.method==='DELETE')return onRequestDelete(context);
  return json({ok:false,message:'지원하지 않는 요청 방식입니다.'},405);
}
