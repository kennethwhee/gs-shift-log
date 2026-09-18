const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  }
});

const text=value=>typeof value==='string'?value.trim():'';

function validDate(value){
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}

function shiftDate(value,days){
  const d=new Date(value+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}

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

function publicRow(row,{includeSnapshot=false}={}){
  if(!row)return null;

  let summary=null;
  let snapshot=null;

  try{summary=JSON.parse(row.summary_json||'null');}catch(_){}
  if(includeSnapshot){
    try{snapshot=JSON.parse(row.snapshot_json||'null');}catch(_){}
  }

  return {
    targetDate:String(row.target_date||''),
    revision:Number(row.revision)||1,
    sourceRequestId:String(row.source_request_id||''),
    summary,
    savedById:String(row.saved_by_id||''),
    savedByName:String(row.saved_by_name||''),
    createdAt:String(row.created_at||''),
    updatedAt:String(row.updated_at||''),
    ...(includeSnapshot?{snapshot}:{})
  };
}

export async function onRequestGet(context){
  try{
    const a=await auth(context);
    if(a.error)return a.error;

    const db=context.env.DB;
    await ensureSchema(db);

    const url=new URL(context.request.url);
    const targetDate=text(url.searchParams.get('targetDate'));

    if(targetDate){
      if(!validDate(targetDate)){
        return json({ok:false,message:'날짜 형식이 올바르지 않습니다.'},400);
      }

      const row=await db.prepare(`
        SELECT *
        FROM cofiring_closed_snapshots
        WHERE target_date=?
        LIMIT 1
      `).bind(targetDate).first();

      return json({
        ok:true,
        item:publicRow(row,{includeSnapshot:true})
      });
    }

    const requested=Number.parseInt(url.searchParams.get('limit')||'120',10);
    const limit=Math.min(366,Math.max(1,Number.isFinite(requested)?requested:120));

    const rows=await db.prepare(`
      SELECT
        target_date,
        revision,
        source_request_id,
        summary_json,
        saved_by_id,
        saved_by_name,
        created_at,
        updated_at
      FROM cofiring_closed_snapshots
      ORDER BY target_date DESC
      LIMIT ?
    `).bind(limit).all();

    return json({
      ok:true,
      items:(rows.results||[]).map(row=>publicRow(row))
    });

  }catch(error){
    console.error('cofiring closed snapshot GET:',error);
    return json({ok:false,message:'마감 데이터를 불러오지 못했습니다.'},500);
  }
}

export async function onRequestPost(context){
  try{
    const a=await auth(context);
    if(a.error)return a.error;

    const db=context.env.DB;
    await ensureSchema(db);

    let body={};
    try{body=await context.request.json();}catch(_){}

    const targetDate=text(body.targetDate);
    const sourceRequestId=text(body.sourceRequestId);
    const overwrite=body.overwrite===true;
    const snapshot=body.snapshot;
    const summary=body.summary;

    if(!validDate(targetDate)||targetDate>=koreanToday()){
      return json({
        ok:false,
        message:'오늘 이전의 완료된 일별 자료만 마감할 수 있습니다.'
      },400);
    }

    if(
      !snapshot||
      typeof snapshot!=='object'||
      !summary||
      typeof summary!=='object'||
      !sourceRequestId
    ){
      return json({ok:false,message:'마감 저장 데이터가 올바르지 않습니다.'},400);
    }

    if(snapshot.targetDate!==targetDate){
      return json({ok:false,message:'마감 날짜와 스냅샷 날짜가 다릅니다.'},400);
    }

    const expectedStart=targetDate+'T00:00';
    const expectedEnd=shiftDate(targetDate,1)+'T00:00';

    if(
      snapshot.period?.startLocal!==expectedStart||
      snapshot.period?.endLocal!==expectedEnd||
      snapshot.period?.stepUnit!=='minute'||
      Number(snapshot.period?.stepValue)!==1
    ){
      return json({
        ok:false,
        message:'하루 전체 조회가 완료된 일별 결과만 마감할 수 있습니다.'
      },400);
    }

    const source=await db.prepare(`
      SELECT
        id,
        target_date,
        status
      FROM ois_data_requests
      WHERE id=?
        AND request_type='cofiring_period'
        AND status='complete'
      LIMIT 1
    `).bind(sourceRequestId).first();

    if(!source||String(source.target_date||'')!==targetDate){
      return json({
        ok:false,
        message:'서버에서 완료된 DataPARC 조회 결과를 확인할 수 없습니다.'
      },409);
    }

    const snapshotText=JSON.stringify(snapshot);
    const summaryText=JSON.stringify(summary);

    if(snapshotText.length>1500000){
      return json({ok:false,message:'마감 스냅샷 크기가 너무 큽니다.'},413);
    }

    const existing=await db.prepare(`
      SELECT *
      FROM cofiring_closed_snapshots
      WHERE target_date=?
      LIMIT 1
    `).bind(targetDate).first();

    if(existing&&!overwrite){
      return json({
        ok:false,
        code:'ALREADY_CLOSED',
        message:'이미 마감 저장된 날짜입니다.',
        item:publicRow(existing)
      },409);
    }

    const now=new Date().toISOString();

    if(existing){
      await db.prepare(`
        UPDATE cofiring_closed_snapshots
        SET
          revision=revision+1,
          source_request_id=?,
          summary_json=?,
          snapshot_json=?,
          saved_by_id=?,
          saved_by_name=?,
          updated_at=?
        WHERE target_date=?
      `).bind(
        sourceRequestId,
        summaryText,
        snapshotText,
        a.user.employeeNo,
        a.user.name,
        now,
        targetDate
      ).run();
    }else{
      await db.prepare(`
        INSERT INTO cofiring_closed_snapshots (
          target_date,
          revision,
          source_request_id,
          summary_json,
          snapshot_json,
          saved_by_id,
          saved_by_name,
          created_at,
          updated_at
        )
        VALUES (?,?,?,?,?,?,?,?,?)
      `).bind(
        targetDate,
        1,
        sourceRequestId,
        summaryText,
        snapshotText,
        a.user.employeeNo,
        a.user.name,
        now,
        now
      ).run();
    }

    const saved=await db.prepare(`
      SELECT *
      FROM cofiring_closed_snapshots
      WHERE target_date=?
      LIMIT 1
    `).bind(targetDate).first();

    return json({
      ok:true,
      item:publicRow(saved),
      message:existing?'마감 데이터를 갱신했습니다.':'마감 데이터를 저장했습니다.'
    });

  }catch(error){
    console.error('cofiring closed snapshot POST:',error);
    return json({ok:false,message:'마감 데이터를 저장하지 못했습니다.'},500);
  }
}

export async function onRequestDelete(context){
  try{
    const a=await auth(context);
    if(a.error)return a.error;

    const db=context.env.DB;
    await ensureSchema(db);

    const url=new URL(context.request.url);
    const targetDate=text(url.searchParams.get('targetDate'));

    if(!validDate(targetDate)){
      return json({ok:false,message:'삭제 날짜가 올바르지 않습니다.'},400);
    }

    const result=await db.prepare(`
      DELETE FROM cofiring_closed_snapshots
      WHERE target_date=?
    `).bind(targetDate).run();

    return json({
      ok:true,
      deleted:Number(result?.meta?.changes||0)>0
    });

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
