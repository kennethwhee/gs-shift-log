/* Co-firing period manual fuel usage V1.
   GET  ?start=YYYY-MM-DDTHH:mm&end=YYYY-MM-DDTHH:mm -> latest manual organic/manure matrix.
   POST {start,end,values,expectedRevision,requestId} -> append one complete period snapshot.
   Blank/null is intentionally different from explicit 0 ton. */
const TABLE='cofiring_period_manual_usage_history';
const MAX_TONS=1000000;
const MAX_MINUTES=31*24*60;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const text=value=>typeof value==='string'?value.trim():'';
function localMinute(value){
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
  const [date,time]=value.split('T'),[y,m,d]=date.split('-').map(Number),[hh,mm]=time.split(':').map(Number);
  const utc=Date.UTC(y,m-1,d,hh-9,mm,0,0),check=new Date(utc+9*3600000).toISOString().slice(0,16);
  return check===value?utc:null;
}
function validPeriod(start,end){const a=localMinute(start),b=localMinute(end);return a!==null&&b!==null&&b>a&&(b-a)/60000<=MAX_MINUTES;}
function parseTons(value){
  if(value===null)return null;
  if(typeof value!=='number'&&typeof value!=='string')return undefined;
  const raw=String(value).trim();if(!/^\d+(?:\.\d{1,6})?$/.test(raw))return undefined;
  const n=Number(raw);return Number.isFinite(n)&&n>=0&&n<=MAX_TONS?n:undefined;
}
function normalizeValues(input){
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['unit1','unit2'].includes(k))||!['unit1','unit2'].every(k=>Object.hasOwn(input,k)))return null;
  const out={};
  for(const unit of ['unit1','unit2']){
    const row=input[unit];if(!row||Array.isArray(row)||typeof row!=='object'||Object.keys(row).some(k=>!['organic','manure'].includes(k))||!['organic','manure'].every(k=>Object.hasOwn(row,k)))return null;
    out[unit]={};
    for(const fuel of ['organic','manure']){const v=parseTons(row[fuel]);if(v===undefined)return null;out[unit][fuel]=v;}
  }
  return out;
}
function periodKey(start,end){return `${start}|${end}`;}
async function authenticate(context){
  const db=context.env?.DB;if(!db)return {error:json({ok:false,message:'D1 바인딩 DB가 등록되지 않았습니다.'},503)};
  const authorization=text(context.request.headers.get('Authorization')),token=/^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if(!token)return {error:json({ok:false,message:'로그인이 필요합니다.'},401)};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const row=await db.prepare(`SELECT session.employee_no, session.expires_at, user.name, user.is_active
    FROM shift_log_sessions AS session INNER JOIN users AS user ON user.employee_no=session.employee_no
    WHERE session.token_hash=? LIMIT 1`).bind(hash).first();
  const now=new Date(),expires=new Date(row?.expires_at||0);
  if(!row||Number(row.is_active)!==1||!Number.isFinite(expires.getTime())||expires<=now){
    await db.prepare('DELETE FROM shift_log_sessions WHERE token_hash=?').bind(hash).run();
    return {error:json({ok:false,message:'로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'},401)};
  }
  await db.prepare('UPDATE shift_log_sessions SET last_used_at=? WHERE token_hash=?').bind(now.toISOString(),hash).run();
  return {user:{employeeNo:String(row.employee_no).trim(),name:String(row.name||'').trim()}};
}
async function ensureTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(
    period_key TEXT NOT NULL,
    start_local TEXT NOT NULL,
    end_local TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>0),
    values_json TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(period_key,revision)
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_period ON ${TABLE}(period_key,revision DESC)`).run();
}
function convert(row){
  if(!row)return null;let values=null;try{values=normalizeValues(JSON.parse(row.values_json));}catch(_){values=null;}if(!values)return null;
  return {start:row.start_local,end:row.end_local,revision:Number(row.revision),values,source:'manual-period',updatedById:row.updated_by_id,updatedByName:row.updated_by_name,updatedAt:row.updated_at};
}
async function latest(db,start,end){return convert(await db.prepare(`SELECT * FROM ${TABLE} WHERE period_key=? ORDER BY revision DESC LIMIT 1`).bind(periodKey(start,end)).first());}
function sameWrite(row,body,user,values){
  const record=convert(row);return record&&record.start===body.start&&record.end===body.end&&record.revision===body.expectedRevision+1&&JSON.stringify(record.values)===JSON.stringify(values)&&row.updated_by_id===user.employeeNo;
}
export async function onRequestGet(context){
  try{
    const auth=await authenticate(context);if(auth.error)return auth.error;
    const url=new URL(context.request.url),start=url.searchParams.get('start'),end=url.searchParams.get('end');
    if(!validPeriod(start,end))return json({ok:false,message:'시작·종료 일시를 확인해 주세요. 최대 31일 범위입니다.'},400);
    await ensureTable(context.env.DB);const entry=await latest(context.env.DB,start,end);
    return json({ok:true,start,end,entry,values:entry?.values||{unit1:{organic:null,manure:null},unit2:{organic:null,manure:null}},revision:entry?.revision||0});
  }catch(error){console.error('cofiring period manual read failed:',error instanceof Error?error.message:'unknown error');return json({ok:false,message:'선택 기간의 유기성·축분 저장값을 불러오지 못했습니다.'},500);}
}
export async function onRequestPost(context){
  try{
    const auth=await authenticate(context);if(auth.error)return auth.error;const req=context.request,origin=req.headers.get('Origin');
    if(origin&&origin!==new URL(req.url).origin)return json({ok:false,message:'같은 업무일지 화면에서 저장해 주세요.'},403);
    if(req.headers.get('X-ShiftLog-Client')!=='desktop'||/Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get('User-Agent')||''))return json({ok:false,message:'기간별 유기성·축분 입력은 로그인한 PC 화면에서 가능합니다.'},403);
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||''))return json({ok:false,message:'JSON 형식으로 저장해 주세요.'},415);
    if(Number(req.headers.get('Content-Length')||0)>8192)return json({ok:false,message:'저장 요청이 너무 큽니다.'},413);
    const raw=await req.text();if(new TextEncoder().encode(raw).length>8192)return json({ok:false,message:'저장 요청이 너무 큽니다.'},413);
    let body;try{body=JSON.parse(raw);}catch(_){return json({ok:false,message:'저장 요청 형식이 올바르지 않습니다.'},400);}
    const allowed=['start','end','values','expectedRevision','requestId'];
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!allowed.includes(k))||!validPeriod(body.start,body.end)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.requestId!=='string'||!/^[a-f0-9-]{20,64}$/i.test(body.requestId))return json({ok:false,message:'기간·저장 요청 정보를 확인해 주세요.'},400);
    const values=normalizeValues(body.values);if(!values)return json({ok:false,message:'유기성 고형연료·축분은 빈칸(null) 또는 0 이상의 ton 값으로 입력해 주세요.'},400);
    const db=context.env.DB;await ensureTable(db);
    const repeated=await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id=? LIMIT 1`).bind(body.requestId).first();
    if(repeated){if(!sameWrite(repeated,body,auth.user,values))return json({ok:false,code:'REQUEST_CONFLICT',message:'이미 다른 내용으로 처리된 요청입니다.'},409);return json({ok:true,entry:convert(repeated),replayed:true});}
    const key=periodKey(body.start,body.end),at=new Date().toISOString();
    await db.prepare(`INSERT INTO ${TABLE}(period_key,start_local,end_local,revision,values_json,request_id,updated_by_id,updated_by_name,updated_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM ${TABLE} WHERE period_key=?),0)=? ON CONFLICT DO NOTHING`)
      .bind(key,body.start,body.end,body.expectedRevision+1,JSON.stringify(values),body.requestId,auth.user.employeeNo,auth.user.name,at,key,body.expectedRevision).run();
    const saved=await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id=? LIMIT 1`).bind(body.requestId).first();
    if(!sameWrite(saved,body,auth.user,values))return json({ok:false,code:'REVISION_CONFLICT',message:'다른 화면에서 먼저 저장한 값이 있습니다. 최신 값을 다시 불러와 주세요.',current:await latest(db,body.start,body.end)},409);
    return json({ok:true,entry:convert(saved),replayed:false});
  }catch(error){console.error('cofiring period manual save failed:',error instanceof Error?error.message:'unknown error');return json({ok:false,message:'유기성·축분 저장 완료를 확인하지 못했습니다. 입력값은 유지됩니다.'},500);}
}
export async function onRequest(context){if(context.request.method==='GET')return onRequestGet(context);if(context.request.method==='POST')return onRequestPost(context);return json({ok:false,message:'지원하지 않는 요청 방식입니다.'},405);}
