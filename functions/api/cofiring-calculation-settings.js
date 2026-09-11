/* Co-firing calculation assumptions V1.
   GET  ?targetDate=YYYY-MM-DD: latest effective setting on/before the selected day.
   POST {effectiveDate,settings,requestId}: append a new effective-date setting.
   Calculation settings are intentionally separate from morning-meeting settings. */
const TABLE = 'cofiring_calculation_settings_history';
const FUELS = ['coal','bio','organic','manure'];
const UNITS = ['unit1','unit2'];
const DEFAULTS = Object.freeze({
  unit1: Object.freeze({
    coal:Object.freeze({calorific:5868,coefficient:1}),
    bio:Object.freeze({calorific:3237,coefficient:1}),
    organic:Object.freeze({calorific:3487,coefficient:1}),
    manure:Object.freeze({calorific:3487,coefficient:1})
  }),
  unit2: Object.freeze({
    coal:Object.freeze({calorific:5868,coefficient:1}),
    bio:Object.freeze({calorific:3237,coefficient:1}),
    organic:Object.freeze({calorific:3487,coefficient:1}),
    manure:Object.freeze({calorific:3487,coefficient:1})
  })
});
const json = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const text = value=>typeof value==='string'?value.trim():'';
function validDate(value){
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function finiteIn(value,min,max){return typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;}
function normalizeSettings(input){
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!UNITS.includes(key))||!UNITS.every(unit=>Object.hasOwn(input,unit)))return null;
  const output={};
  for(const unit of UNITS){
    const group=input[unit];
    if(!group||Array.isArray(group)||typeof group!=='object'||Object.keys(group).some(key=>!FUELS.includes(key))||!FUELS.every(fuel=>Object.hasOwn(group,fuel)))return null;
    output[unit]={};
    for(const fuel of FUELS){
      const setting=group[fuel];
      if(!setting||Array.isArray(setting)||typeof setting!=='object'||Object.keys(setting).some(key=>!['calorific','coefficient'].includes(key))||
        !finiteIn(setting.calorific,1,50000)||!finiteIn(setting.coefficient,0.000001,100))return null;
      output[unit][fuel]={calorific:Number(setting.calorific),coefficient:Number(setting.coefficient)};
    }
  }
  return output;
}
function cloneDefaults(){return JSON.parse(JSON.stringify(DEFAULTS));}
async function authenticate(context){
  const db=context.env?.DB;if(!db)return {error:json({ok:false,message:'D1 바인딩 DB가 등록되지 않았습니다.'},503)};
  const authorization=text(context.request.headers.get('Authorization'));
  const token=/^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if(!token)return {error:json({ok:false,message:'로그인이 필요합니다.'},401)};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const row=await db.prepare(`SELECT session.employee_no, session.expires_at, user.name, user.is_active
    FROM shift_log_sessions AS session INNER JOIN users AS user ON user.employee_no = session.employee_no
    WHERE session.token_hash = ? LIMIT 1`).bind(hash).first();
  const now=new Date(),expires=new Date(row?.expires_at||0);
  if(!row||Number(row.is_active)!==1||!Number.isFinite(expires.getTime())||expires<=now){
    await db.prepare('DELETE FROM shift_log_sessions WHERE token_hash = ?').bind(hash).run();
    return {error:json({ok:false,message:'로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'},401)};
  }
  await db.prepare('UPDATE shift_log_sessions SET last_used_at = ? WHERE token_hash = ?').bind(now.toISOString(),hash).run();
  return {user:{employeeNo:String(row.employee_no).trim(),name:String(row.name||'').trim()}};
}
async function ensureTable(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    effective_date TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_effective ON ${TABLE}(effective_date DESC,id DESC)`).run();
}
function convert(row){
  if(!row)return null;
  let settings;try{settings=normalizeSettings(JSON.parse(row.settings_json));}catch(_){settings=null;}
  if(!settings)return null;
  return {effectiveDate:row.effective_date,settings,updatedById:row.updated_by_id,updatedByName:row.updated_by_name,updatedAt:row.updated_at,id:Number(row.id)};
}
async function latest(db,date){
  return convert(await db.prepare(`SELECT * FROM ${TABLE} WHERE effective_date <= ? ORDER BY effective_date DESC, id DESC LIMIT 1`).bind(date).first());
}
export async function onRequestGet(context){
  try{
    const auth=await authenticate(context);if(auth.error)return auth.error;
    const date=new URL(context.request.url).searchParams.get('targetDate');
    if(!validDate(date))return json({ok:false,message:'계산일은 YYYY-MM-DD 형식의 날짜 하나로 선택해 주세요.'},400);
    await ensureTable(context.env.DB);
    const entry=await latest(context.env.DB,date);
    return json({ok:true,targetDate:date,source:entry?'saved':'default',effectiveDate:entry?.effectiveDate||null,
      settings:entry?.settings||cloneDefaults(),updatedById:entry?.updatedById||'',updatedByName:entry?.updatedByName||'',updatedAt:entry?.updatedAt||''});
  }catch(error){
    console.error('cofiring calculation settings read failed:',error instanceof Error?error.message:'unknown error');
    return json({ok:false,message:'혼소율 발열량·보정계수 설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},500);
  }
}
export async function onRequestPost(context){
  try{
    const auth=await authenticate(context);if(auth.error)return auth.error;
    const req=context.request,origin=req.headers.get('Origin');
    if(origin&&origin!==new URL(req.url).origin)return json({ok:false,message:'같은 업무일지 화면에서 저장해 주세요.'},403);
    if(req.headers.get('X-ShiftLog-Client')!=='desktop'||/Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get('User-Agent')||''))
      return json({ok:false,message:'발열량·보정계수 설정은 로그인한 PC 화면에서 저장할 수 있습니다.'},403);
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||''))return json({ok:false,message:'JSON 형식으로 저장해 주세요.'},415);
    if(Number(req.headers.get('Content-Length')||0)>16384)return json({ok:false,message:'저장 요청이 너무 큽니다.'},413);
    const raw=await req.text();if(new TextEncoder().encode(raw).length>16384)return json({ok:false,message:'저장 요청이 너무 큽니다.'},413);
    let body;try{body=JSON.parse(raw);}catch(_){return json({ok:false,message:'저장 요청 형식이 올바르지 않습니다.'},400);}
    const allowed=['effectiveDate','settings','requestId'];
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!allowed.includes(k))||!validDate(body.effectiveDate)||
      typeof body.requestId!=='string'||!/^[a-f0-9-]{20,64}$/i.test(body.requestId))return json({ok:false,message:'적용일과 설정 저장 정보를 확인해 주세요.'},400);
    const settings=normalizeSettings(body.settings);if(!settings)return json({ok:false,message:'1·2호기 연료별 발열량과 보정계수를 확인해 주세요.'},400);
    const db=context.env.DB;await ensureTable(db);
    const repeated=convert(await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id = ? LIMIT 1`).bind(body.requestId).first());
    if(repeated){
      if(repeated.effectiveDate!==body.effectiveDate||JSON.stringify(repeated.settings)!==JSON.stringify(settings)||repeated.updatedById!==auth.user.employeeNo)
        return json({ok:false,code:'REQUEST_CONFLICT',message:'이미 다른 내용으로 처리된 저장 요청입니다.'},409);
      return json({ok:true,entry:repeated,replayed:true});
    }
    const at=new Date().toISOString(),settingsJson=JSON.stringify(settings);
    await db.prepare(`INSERT INTO ${TABLE}(effective_date,settings_json,request_id,updated_by_id,updated_by_name,updated_at) VALUES(?,?,?,?,?,?)`)
      .bind(body.effectiveDate,settingsJson,body.requestId,auth.user.employeeNo,auth.user.name,at).run();
    const saved=convert(await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id = ? LIMIT 1`).bind(body.requestId).first());
    if(!saved)return json({ok:false,message:'설정 저장 완료를 확인하지 못했습니다.'},500);
    return json({ok:true,entry:saved,replayed:false});
  }catch(error){
    console.error('cofiring calculation settings save failed:',error instanceof Error?error.message:'unknown error');
    return json({ok:false,message:'발열량·보정계수 설정을 저장하지 못했습니다. 입력값은 유지됩니다.'},500);
  }
}
export async function onRequest(context){
  if(context.request.method==='GET')return onRequestGet(context);
  if(context.request.method==='POST')return onRequestPost(context);
  return json({ok:false,message:'지원하지 않는 요청 방식입니다.'},405);
}
