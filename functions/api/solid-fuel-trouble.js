/* GS Shift Log · 고형연료 Trouble 관리 API */
const FORCED_SUPER_ADMIN_EMPLOYEE_NO = "2014081";
const MAX_PHOTO_COUNT = 4;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const PHOTO_EXTENSIONS = new Set(["jpg","jpeg","png","webp","heic","heif"]);
const EXCEL_SEED_ROWS = [
  [
    "excel-20260623-001",
    "2026-06-23",
    "서남",
    "2655",
    "Silo A",
    "(예시)",
    "/maintenance/solid-fuel-trouble-assets/excel-001.jpeg"
  ],
  [
    "excel-20260623-002",
    "2026-06-23",
    "수도권",
    "6576",
    "Silo A",
    "",
    "/maintenance/solid-fuel-trouble-assets/excel-002.jpeg"
  ],
  [
    "excel-20260624-003",
    "2026-06-24",
    "중랑(추정)",
    "4202",
    "13:50 Storage #A 이송중 막힘",
    "현장 역가압 후 해소",
    ""
  ],
  [
    "excel-20260624-004",
    "2026-06-24",
    "수원그린(추정)",
    "2655",
    "16:20 Storage #A 이송중 막힘",
    "현장 역가압 후 해소",
    ""
  ],
  [
    "excel-20260701-005",
    "2026-07-01",
    "수도권(추정)",
    "1310",
    "23:00 Storage #A 이송중 막힘",
    "현장 역가압 후 해소",
    "/maintenance/solid-fuel-trouble-assets/excel-005.jpeg"
  ],
  [
    "excel-20260703-006",
    "2026-07-03",
    "수도권",
    "4202",
    "Storage Silo #A 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260710-007",
    "2026-07-10",
    "수도권",
    "2514",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air Open 2시간 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260714-008",
    "2026-07-14",
    "수도권",
    "1310",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260717-009",
    "2026-07-17",
    "서남",
    "2655",
    "Storage Silo #A 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260721-010",
    "2026-07-21",
    "수도권",
    "4202",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260723-011",
    "2026-07-23",
    "서남",
    "4202",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260724-012",
    "2026-07-24",
    "서남",
    "2514",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260724-013",
    "2026-07-24",
    "서남",
    "2514",
    "Storage Silo #A 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소\n\n차량 내부 덩어리 많아 하역 잘안됨으로 내부 덩어리 해소 실시",
    "/maintenance/solid-fuel-trouble-assets/excel-013.jpeg"
  ],
  [
    "excel-20260730-014",
    "2026-07-30",
    "수도권",
    "6576",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 8분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260730-015",
    "2026-07-30",
    "수도권",
    "6576",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 12분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260731-016",
    "2026-07-31",
    "난지(추정)",
    "2109",
    "20:40 Storage #A 이송중 막힘",
    "현장 역가압 후 해소",
    ""
  ],
  [
    "excel-20260803-017",
    "2026-08-03",
    "수도권",
    "2514",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260804-018",
    "2026-08-04",
    "수도권",
    "2515",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "",
    ""
  ],
  [
    "excel-20260808-019",
    "2026-08-08",
    "난지(추정)",
    "4202",
    "19:07 Storage #A 이송중 막힘",
    "현장 역가압 후 해소 및 Storage Silo Slide Gate 조절 (추후 원복)",
    ""
  ],
  [
    "excel-20260813-020",
    "2026-08-13",
    "서남",
    "2655",
    "Storage Silo #A 하역라인 곡관부 막힘",
    "하역 XV Close 후 Booster Air 7Bar.g Setting 후\n10분 대기하여 막힘 해소",
    ""
  ],
  [
    "excel-20260815-021",
    "2026-08-15",
    "수도권",
    "4202",
    "Storage Silo #B 하역라인 곡관부 막힘",
    "하역 XV Close 후 10분 대기하여 막힘 해소",
    ""
  ]
];
let initPromise = null;

function text(v){ return String(v ?? "").trim(); }
function employeeNo(v){ return text(v).replace(/\s+/g,""); }
function json(data,status=200){ return Response.json(data,{status,headers:{"Cache-Control":"no-store"}}); }
function roleOf(v){
  const r=text(v).toLowerCase().replace(/[\s-]+/g,"_");
  if(["super_admin","superadmin"].includes(r)) return "super_admin";
  if(["admin","leader"].includes(r)) return "admin";
  return "user";
}
function isoDate(v){
  const s=text(v);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d=new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===s;
}
function limited(v,n){ return text(v).slice(0,n); }
function ext(name){ const s=text(name); const i=s.lastIndexOf("."); return i<0?"":s.slice(i+1).toLowerCase(); }
function safeName(name){ return text(name).replace(/[\/\\:*?"<>|]/g,"_").replace(/\s+/g,"_") || "photo"; }
function imageType(name,supplied){
  const t=text(supplied).toLowerCase();
  if(t.startsWith("image/")) return t;
  return ({jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",heic:"image/heic",heif:"image/heif"})[ext(name)] || "application/octet-stream";
}
function bearer(request){
  const m=text(request.headers.get("Authorization")).match(/^Bearer\s+(.+)$/i);
  return text(m?.[1]);
}
function hex(bytes){ return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function tokenHash(token){
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))));
}
async function auth(context){
  if(!context.env.DB) return {error:json({ok:false,message:"D1 바인딩 DB가 등록되지 않았습니다."},500)};
  const token=bearer(context.request);
  if(!token) return {error:json({ok:false,message:"로그인이 필요합니다."},401)};
  const row=await context.env.DB.prepare(`
    SELECT s.employee_no,s.expires_at,u.name,u.role,u.is_active
    FROM shift_log_sessions s
    INNER JOIN users u ON u.employee_no=s.employee_no
    WHERE s.token_hash=? LIMIT 1
  `).bind(await tokenHash(token)).first();
  const expires=new Date(row?.expires_at||0);
  if(!row || Number(row.is_active)!==1 || Number.isNaN(expires.getTime()) || expires<=new Date()){
    return {error:json({ok:false,message:"로그인 세션이 만료되었습니다. 다시 로그인해 주세요."},401)};
  }
  const no=employeeNo(row.employee_no);
  const role=no===FORCED_SUPER_ADMIN_EMPLOYEE_NO?"super_admin":roleOf(row.role);
  return {user:{employeeNo:no,name:text(row.name),role,isAdmin:["admin","super_admin"].includes(role),isSuperAdmin:role==="super_admin"}};
}

async function initialize(db){
  if(initPromise) return initPromise;
  initPromise=(async()=>{
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS solid_fuel_trouble_records(
        id TEXT PRIMARY KEY, source_key TEXT UNIQUE,
        occurrence_date TEXT NOT NULL, company_name TEXT NOT NULL DEFAULT '',
        vehicle_no TEXT NOT NULL DEFAULT '', equipment TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '', legacy_photo_path TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        created_by_id TEXT NOT NULL DEFAULT '', created_by_name TEXT NOT NULL DEFAULT '',
        updated_by_id TEXT NOT NULL DEFAULT '', updated_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        deleted_at TEXT, deleted_by_id TEXT NOT NULL DEFAULT '', deleted_by_name TEXT NOT NULL DEFAULT ''
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS solid_fuel_trouble_photos(
        id TEXT PRIMARY KEY, trouble_id TEXT NOT NULL,
        r2_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL DEFAULT '',
        content_type TEXT NOT NULL DEFAULT '', file_size INTEGER NOT NULL DEFAULT 0,
        uploaded_by_id TEXT NOT NULL DEFAULT '', uploaded_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sft_date ON solid_fuel_trouble_records(occurrence_date)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sft_company ON solid_fuel_trouble_records(company_name)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sft_vehicle ON solid_fuel_trouble_records(vehicle_no)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sft_photo_record ON solid_fuel_trouble_photos(trouble_id)`)
    ]);
    const seed=EXCEL_SEED_ROWS.map((r,i)=>db.prepare(`
      INSERT OR IGNORE INTO solid_fuel_trouble_records(
        id,source_key,occurrence_date,company_name,vehicle_no,equipment,note,legacy_photo_path,
        version,created_by_id,created_by_name,updated_by_id,updated_by_name,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,1,'excel-import','Excel 원본','excel-import','Excel 원본',?,?)
    `).bind(`solid-fuel-trouble-seed-${String(i+1).padStart(3,"0")}`,r[0],r[1],r[2],r[3],r[4],r[5],r[6],`${r[1]}T00:00:00.000Z`,`${r[1]}T00:00:00.000Z`));
    if(seed.length) await db.batch(seed);
  })().catch(e=>{initPromise=null;throw e;});
  return initPromise;
}

async function findRecord(db,id){
  return db.prepare(`SELECT * FROM solid_fuel_trouble_records WHERE id=? AND deleted_at IS NULL LIMIT 1`).bind(id).first();
}
function photoObj(r){
  const id=text(r.id);
  return {id,recordId:text(r.trouble_id),name:text(r.original_name)||"샘플 사진",contentType:text(r.content_type),
    fileSize:Number(r.file_size||0),createdAt:text(r.created_at),url:`/api/solid-fuel-trouble?photoId=${encodeURIComponent(id)}`};
}
async function allPhotos(db){
  const res=await db.prepare(`SELECT * FROM solid_fuel_trouble_photos ORDER BY created_at ASC,id ASC`).all();
  return Array.isArray(res?.results)?res.results:[];
}
function recordObj(r,map){
  const id=text(r.id), legacy=text(r.legacy_photo_path);
  return {id,sourceKey:text(r.source_key),occurrenceDate:text(r.occurrence_date),companyName:text(r.company_name),
    vehicleNo:text(r.vehicle_no),equipment:text(r.equipment),note:text(r.note),version:Number(r.version||1),
    photos:[...(legacy?[{id:`legacy-${id}`,recordId:id,name:"Excel 샘플 사진",contentType:"image/jpeg",fileSize:0,
      createdAt:text(r.created_at),url:legacy,legacy:true}]:[]),...(map.get(id)||[])],
    createdByName:text(r.created_by_name),updatedByName:text(r.updated_by_name),createdAt:text(r.created_at),updatedAt:text(r.updated_at)};
}
async function listRecords(db,url){
  let q=`SELECT * FROM solid_fuel_trouble_records WHERE deleted_at IS NULL`;
  const b=[];
  const from=text(url.searchParams.get("from")),to=text(url.searchParams.get("to")),
        company=text(url.searchParams.get("company")),vehicle=text(url.searchParams.get("vehicle")),
        search=text(url.searchParams.get("search"));
  if(from){ if(!isoDate(from)) throw Object.assign(new Error("시작일이 올바르지 않습니다."),{status:400}); q+=` AND occurrence_date>=?`; b.push(from); }
  if(to){ if(!isoDate(to)) throw Object.assign(new Error("종료일이 올바르지 않습니다."),{status:400}); q+=` AND occurrence_date<=?`; b.push(to); }
  if(company){ q+=` AND company_name LIKE ?`; b.push(`%${company}%`); }
  if(vehicle){ q+=` AND vehicle_no LIKE ?`; b.push(`%${vehicle}%`); }
  if(search){ q+=` AND (company_name LIKE ? OR vehicle_no LIKE ? OR equipment LIKE ? OR note LIKE ?)`; const s=`%${search}%`; b.push(s,s,s,s); }
  const dir=text(url.searchParams.get("sort")).toLowerCase()==="desc"?"DESC":"ASC";
  q+=` ORDER BY occurrence_date ${dir},created_at ${dir},id ${dir} LIMIT 1000`;
  const stmt=db.prepare(q),res=b.length?await stmt.bind(...b).all():await stmt.all(),rows=Array.isArray(res?.results)?res.results:[];
  const pmap=new Map();
  for(const p of await allPhotos(db)){ const id=text(p.trouble_id),a=pmap.get(id)||[]; a.push(photoObj(p)); pmap.set(id,a); }
  return rows.map(r=>recordObj(r,pmap));
}
function photoKey(id,name,now=new Date()){
  return ["solid-fuel-trouble",String(now.getUTCFullYear()),String(now.getUTCMonth()+1).padStart(2,"0"),id,
    `${crypto.randomUUID()}_${safeName(name)}`].join("/");
}
async function servePhoto(context,id){
  if(!context.env.DB) return json({ok:false,message:"D1 바인딩 DB가 등록되지 않았습니다."},500);
  await initialize(context.env.DB);
  const p=await context.env.DB.prepare(`SELECT * FROM solid_fuel_trouble_photos WHERE id=? LIMIT 1`).bind(id).first();
  if(!p) return json({ok:false,message:"샘플 사진을 찾을 수 없습니다."},404);
  if(!context.env.ATTACHMENTS) return json({ok:false,message:"R2 바인딩 ATTACHMENTS가 등록되지 않았습니다."},500);
  const o=await context.env.ATTACHMENTS.get(p.r2_key);
  if(!o) return json({ok:false,message:"R2에서 샘플 사진을 찾을 수 없습니다."},404);
  return new Response(o.body,{status:200,headers:{
    "Content-Type":imageType(p.original_name,p.content_type||o.httpMetadata?.contentType),
    "Content-Disposition":`inline; filename="${safeName(p.original_name)}"`,
    "Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"
  }});
}

export async function onRequestGet(context){
  try{
    const url=new URL(context.request.url),photoId=text(url.searchParams.get("photoId"));
    if(photoId) return servePhoto(context,photoId);
    const a=await auth(context); if(a.error) return a.error;
    await initialize(context.env.DB);
    const items=await listRecords(context.env.DB,url);
    const cr=await context.env.DB.prepare(`SELECT DISTINCT company_name FROM solid_fuel_trouble_records WHERE deleted_at IS NULL AND company_name<>'' ORDER BY company_name COLLATE NOCASE`).all();
    return json({ok:true,items,companies:(cr.results||[]).map(r=>text(r.company_name)).filter(Boolean),totalCount:items.length,
      permissions:{canCreate:true,canEdit:true,canDelete:a.user.isAdmin,canUploadPhoto:true},user:a.user});
  }catch(e){ console.error("solid fuel trouble GET",e); return json({ok:false,message:e?.message||"Trouble 조회 중 오류가 발생했습니다."},Number(e?.status)||500); }
}

export async function onRequestPost(context){
  const keys=[],photoIds=[];
  try{
    const a=await auth(context); if(a.error) return a.error;
    await initialize(context.env.DB);
    const user=a.user, ct=text(context.request.headers.get("Content-Type")).toLowerCase();
    if(ct.includes("multipart/form-data")){
      if(!context.env.ATTACHMENTS) return json({ok:false,message:"R2 바인딩 ATTACHMENTS가 등록되지 않았습니다."},500);
      const f=await context.request.formData(),recordId=text(f.get("recordId")),rec=await findRecord(context.env.DB,recordId);
      if(!rec) return json({ok:false,message:"사진을 추가할 Trouble 기록을 찾을 수 없습니다."},404);
      const countRow=await context.env.DB.prepare(`SELECT COUNT(*) count_value FROM solid_fuel_trouble_photos WHERE trouble_id=?`).bind(recordId).first();
      const files=f.getAll("files").filter(x=>x instanceof File && Number(x.size||0)>0);
      if(!files.length) return json({ok:false,message:"업로드할 사진을 선택해 주세요."},400);
      if(Number(countRow?.count_value||0)+files.length>MAX_PHOTO_COUNT) return json({ok:false,message:`신규 사진은 기록당 최대 ${MAX_PHOTO_COUNT}개까지 등록할 수 있습니다.`},400);
      const now=new Date().toISOString();
      for(const file of files){
        if(!PHOTO_EXTENSIONS.has(ext(file.name))) return json({ok:false,message:`${file.name} 파일은 샘플 사진으로 등록할 수 없습니다.`},400);
        if(Number(file.size||0)>MAX_PHOTO_SIZE) return json({ok:false,message:`${file.name} 파일은 10MB를 초과합니다.`},400);
        const id=crypto.randomUUID(),key=photoKey(recordId,file.name,new Date(now)),type=imageType(file.name,file.type);
        await context.env.ATTACHMENTS.put(key,file.stream(),{httpMetadata:{contentType:type},customMetadata:{recordId,photoId:id,uploadedBy:user.employeeNo}});
        keys.push(key);
        await context.env.DB.prepare(`INSERT INTO solid_fuel_trouble_photos(id,trouble_id,r2_key,original_name,content_type,file_size,uploaded_by_id,uploaded_by_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
          .bind(id,recordId,key,file.name,type,Number(file.size||0),user.employeeNo,user.name,now).run();
        photoIds.push(id);
      }
      return json({ok:true,recordId,uploadedCount:files.length},201);
    }
    const b=await context.request.json(),date=text(b.occurrenceDate),equipment=limited(b.equipment,500);
    if(!isoDate(date)) return json({ok:false,message:"발생 날짜를 선택해 주세요."},400);
    if(!equipment) return json({ok:false,message:"발생 설비 또는 Trouble 내용을 입력해 주세요."},400);
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await context.env.DB.prepare(`INSERT INTO solid_fuel_trouble_records(
      id,source_key,occurrence_date,company_name,vehicle_no,equipment,note,legacy_photo_path,version,
      created_by_id,created_by_name,updated_by_id,updated_by_name,created_at,updated_at
    ) VALUES(?,NULL,?,?,?,?,?,'',1,?,?,?,?,?,?)`)
      .bind(id,date,limited(b.companyName,80),limited(b.vehicleNo,40),equipment,limited(b.note,3000),
        user.employeeNo,user.name,user.employeeNo,user.name,now,now).run();
    return json({ok:true,id,recordId:id,version:1},201);
  }catch(e){
    for(const id of photoIds){ try{ await context.env.DB?.prepare(`DELETE FROM solid_fuel_trouble_photos WHERE id=?`).bind(id).run(); }catch{} }
    for(const key of keys){ try{ await context.env.ATTACHMENTS?.delete(key); }catch{} }
    console.error("solid fuel trouble POST",e); return json({ok:false,message:e?.message||"Trouble 저장 중 오류가 발생했습니다."},500);
  }
}

export async function onRequestPut(context){
  try{
    const a=await auth(context); if(a.error) return a.error;
    await initialize(context.env.DB);
    const b=await context.request.json(),id=text(b.id||b.recordId),version=Number(b.version),date=text(b.occurrenceDate),equipment=limited(b.equipment,500);
    if(!id) return json({ok:false,message:"수정할 Trouble 기록 ID가 필요합니다."},400);
    if(!Number.isInteger(version)||version<1) return json({ok:false,message:"수정 버전 정보가 올바르지 않습니다."},400);
    if(!isoDate(date)) return json({ok:false,message:"발생 날짜를 선택해 주세요."},400);
    if(!equipment) return json({ok:false,message:"발생 설비 또는 Trouble 내용을 입력해 주세요."},400);
    const now=new Date().toISOString(),u=a.user;
    const r=await context.env.DB.prepare(`UPDATE solid_fuel_trouble_records SET occurrence_date=?,company_name=?,vehicle_no=?,equipment=?,note=?,
      version=version+1,updated_by_id=?,updated_by_name=?,updated_at=? WHERE id=? AND version=? AND deleted_at IS NULL`)
      .bind(date,limited(b.companyName,80),limited(b.vehicleNo,40),equipment,limited(b.note,3000),u.employeeNo,u.name,now,id,version).run();
    if(Number(r?.meta?.changes||0)!==1) return json({ok:false,code:"VERSION_CONFLICT",message:"다른 사용자가 먼저 수정했거나 기록이 변경되었습니다. 새로고침 후 다시 시도해 주세요."},409);
    return json({ok:true,id,recordId:id,version:version+1});
  }catch(e){ console.error("solid fuel trouble PUT",e); return json({ok:false,message:e?.message||"Trouble 수정 중 오류가 발생했습니다."},500); }
}

export async function onRequestDelete(context){
  try{
    const a=await auth(context); if(a.error) return a.error;
    await initialize(context.env.DB);
    const url=new URL(context.request.url),photoId=text(url.searchParams.get("photoId"));
    if(photoId){
      const p=await context.env.DB.prepare(`SELECT * FROM solid_fuel_trouble_photos WHERE id=? LIMIT 1`).bind(photoId).first();
      if(!p) return json({ok:false,message:"삭제할 샘플 사진을 찾을 수 없습니다."},404);
      if(context.env.ATTACHMENTS && text(p.r2_key)) await context.env.ATTACHMENTS.delete(p.r2_key);
      await context.env.DB.prepare(`DELETE FROM solid_fuel_trouble_photos WHERE id=?`).bind(photoId).run();
      return json({ok:true,deletedPhotoId:photoId});
    }
    const id=text(url.searchParams.get("id"));
    if(!id) return json({ok:false,message:"삭제할 Trouble 기록 ID가 필요합니다."},400);
    if(!a.user.isAdmin) return json({ok:false,message:"Trouble 기록 삭제는 파트장 또는 관리자 권한이 필요합니다."},403);
    const now=new Date().toISOString(),r=await context.env.DB.prepare(`UPDATE solid_fuel_trouble_records SET deleted_at=?,deleted_by_id=?,deleted_by_name=?,updated_at=? WHERE id=? AND deleted_at IS NULL`)
      .bind(now,a.user.employeeNo,a.user.name,now,id).run();
    if(Number(r?.meta?.changes||0)!==1) return json({ok:false,message:"삭제할 Trouble 기록을 찾을 수 없습니다."},404);
    return json({ok:true,deletedId:id});
  }catch(e){ console.error("solid fuel trouble DELETE",e); return json({ok:false,message:e?.message||"Trouble 삭제 중 오류가 발생했습니다."},500); }
}
