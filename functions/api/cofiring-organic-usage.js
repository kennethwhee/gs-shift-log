/* Co-firing manual organic usage V1. Separate from morning-meeting/Daily DATA.
   GET  ?targetDate=YYYY-MM-DD: latest saved entry for each unit.
   POST {targetDate,unit,action,tons,expectedRevision,requestId}: explicit save/clear.
   Append-only versions make the value and its audit history one atomic insert.
   Auth follows the existing shift_log_sessions + users bearer-token contract. */
const TABLE = 'cofiring_organic_usage_history';
const MAX_TONS = 1000000;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
});
const text = value => typeof value === 'string' ? value.trim() : '';
function validDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function parseTons(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= MAX_TONS ? n : null;
}
async function authenticate(context) {
  const db = context.env?.DB;
  if (!db) return {error:json({ok:false,message:'D1 바인딩 DB가 등록되지 않았습니다.'},503)};
  const authorization = text(context.request.headers.get('Authorization'));
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!token) return {error:json({ok:false,message:'로그인이 필요합니다.'},401)};
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const row = await db.prepare(`SELECT session.employee_no, session.expires_at, user.name, user.is_active
    FROM shift_log_sessions AS session INNER JOIN users AS user ON user.employee_no = session.employee_no
    WHERE session.token_hash = ? LIMIT 1`).bind(hash).first();
  const now = new Date(), expires = new Date(row?.expires_at || 0);
  if (!row || Number(row.is_active)!==1 || !Number.isFinite(expires.getTime()) || expires<=now) {
    await db.prepare('DELETE FROM shift_log_sessions WHERE token_hash = ?').bind(hash).run();
    return {error:json({ok:false,message:'로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'},401)};
  }
  await db.prepare('UPDATE shift_log_sessions SET last_used_at = ? WHERE token_hash = ?').bind(now.toISOString(),hash).run();
  return {user:{employeeNo:String(row.employee_no).trim(),name:String(row.name||'').trim()}};
}
async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    target_date TEXT NOT NULL,
    unit TEXT NOT NULL CHECK(unit IN ('unit1','unit2')),
    revision INTEGER NOT NULL CHECK(revision > 0),
    tons REAL CHECK(tons IS NULL OR (tons >= 0 AND tons <= 1000000)),
    request_id TEXT NOT NULL UNIQUE,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(target_date,unit,revision)
  )`).run();
}
function convert(row) {
  if (!row) return null;
  return {targetDate:row.target_date,unit:row.unit,tons:row.tons===null?null:Number(row.tons),
    revision:Number(row.revision),source:'manual',updatedById:row.updated_by_id,updatedByName:row.updated_by_name,updatedAt:row.updated_at};
}
async function latest(db,date,unit) {
  return convert(await db.prepare(`SELECT * FROM ${TABLE} WHERE target_date = ? AND unit = ? ORDER BY revision DESC LIMIT 1`).bind(date,unit).first());
}
function sameWrite(row,body,user,tons) {
  return row && row.target_date===body.targetDate && row.unit===body.unit && Number(row.revision)===body.expectedRevision+1 &&
    (row.tons===null?null:Number(row.tons))===tons && row.updated_by_id===user.employeeNo;
}
export async function onRequestGet(context) {
  try {
    const auth = await authenticate(context); if (auth.error) return auth.error;
    const date = new URL(context.request.url).searchParams.get('targetDate');
    if (!validDate(date)) return json({ok:false,message:'계산일은 YYYY-MM-DD 형식의 날짜 하나로 선택해 주세요.'},400);
    await ensureTable(context.env.DB);
    const [unit1,unit2] = await Promise.all(['unit1','unit2'].map(unit=>latest(context.env.DB,date,unit)));
    return json({ok:true,targetDate:date,entries:{unit1,unit2}});
  } catch (error) {
    console.error('cofiring organic read failed:',error instanceof Error?error.message:'unknown error');
    return json({ok:false,message:'유기성 저장값을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'},500);
  }
}
export async function onRequestPost(context) {
  try {
    const auth = await authenticate(context); if (auth.error) return auth.error;
    const req = context.request;
    const origin = req.headers.get('Origin');
    if (origin && origin!==new URL(req.url).origin) return json({ok:false,message:'같은 업무일지 화면에서 저장해 주세요.'},403);
    // This is a UI/device policy, not authentication. Server authorization is the session above.
    if (req.headers.get('X-ShiftLog-Client')!=='desktop' || /Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get('User-Agent')||''))
      return json({ok:false,message:'유기성 입력·수정은 로그인한 PC 화면에서 가능합니다.'},403);
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||'')) return json({ok:false,message:'JSON 형식으로 저장해 주세요.'},415);
    if (Number(req.headers.get('Content-Length')||0)>4096) return json({ok:false,message:'저장 요청이 너무 큽니다.'},413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length>4096) return json({ok:false,message:'저장 요청이 너무 큽니다.'},413);
    let body; try {body=JSON.parse(raw);} catch (_) {return json({ok:false,message:'저장 요청 형식이 올바르지 않습니다.'},400);}
    const allowed = ['targetDate','unit','action','tons','expectedRevision','requestId'];
    if (!body || Array.isArray(body) || typeof body!=='object' || Object.keys(body).some(k=>!allowed.includes(k)) ||
        !validDate(body.targetDate) || !['unit1','unit2'].includes(body.unit) || !['save','clear'].includes(body.action) ||
        !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<0 || body.expectedRevision>=Number.MAX_SAFE_INTEGER ||
        typeof body.requestId!=='string' || !/^[a-f0-9-]{20,64}$/i.test(body.requestId))
      return json({ok:false,message:'날짜·호기·저장 요청 정보를 확인해 주세요.'},400);
    const tons = body.action==='clear'?null:parseTons(body.tons);
    if ((body.action==='save' && tons===null) || (body.action==='clear' && body.tons!==null))
      return json({ok:false,message:'유기성 사용량은 0 이상, 소수점 6자리 이하로 입력해 주세요. 빈칸은 0으로 저장되지 않습니다.'},400);
    const db = context.env.DB;
    await ensureTable(db);
    const repeated = await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id = ? LIMIT 1`).bind(body.requestId).first();
    if (repeated) {
      if (!sameWrite(repeated,body,auth.user,tons)) return json({ok:false,code:'REQUEST_CONFLICT',message:'이미 다른 내용으로 처리된 요청입니다. 저장값을 다시 확인해 주세요.'},409);
      return json({ok:true,targetDate:body.targetDate,unit:body.unit,entry:convert(repeated),replayed:true});
    }
    const at = new Date().toISOString();
    // MAX(revision) check and insertion are a SINGLE statement: stale clients cannot overwrite a newer value.
    await db.prepare(`INSERT INTO ${TABLE}
      (target_date,unit,revision,tons,request_id,updated_by_id,updated_by_name,updated_at)
      SELECT ?,?,?,?,?,?,?,?
      WHERE COALESCE((SELECT MAX(revision) FROM ${TABLE} WHERE target_date = ? AND unit = ?),0) = ?
      ON CONFLICT DO NOTHING`).bind(body.targetDate,body.unit,body.expectedRevision+1,tons,body.requestId,
        auth.user.employeeNo,auth.user.name,at,body.targetDate,body.unit,body.expectedRevision).run();
    const saved = await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id = ? LIMIT 1`).bind(body.requestId).first();
    if (!sameWrite(saved,body,auth.user,tons)) return json({ok:false,code:'REVISION_CONFLICT',
      message:'다른 화면에서 먼저 수정한 값이 있습니다. 최신 저장값을 확인한 뒤 다시 저장해 주세요.',
      targetDate:body.targetDate,unit:body.unit,current:await latest(db,body.targetDate,body.unit)},409);
    return json({ok:true,targetDate:body.targetDate,unit:body.unit,entry:convert(saved),replayed:false});
  } catch (error) {
    console.error('cofiring organic save failed:',error instanceof Error?error.message:'unknown error');
    return json({ok:false,message:'저장 완료를 확인하지 못했습니다. 입력값은 유지됩니다. 최신 저장값을 확인하거나 같은 요청을 다시 시도해 주세요.'},500);
  }
}
export async function onRequest(context) {
  if (context.request.method==='GET') return onRequestGet(context);
  if (context.request.method==='POST') return onRequestPost(context);
  return json({ok:false,message:'지원하지 않는 요청 방식입니다.'},405);
}
