// Separate, append-only OPERATOR WHAT-IF records. Never a certified close.
import core from '../../maintenance/cofiring-core.js';
import contract from '../../maintenance/cofiring-live-contract.js';
import scenarioApi from '../../maintenance/cofiring-shared-scenario-v7.js';
import {validateProvisionalAdjustment} from '../_shared/cofiring-provisional-adjust-v14.mjs';
import {ensureCorrectionTable,latestCorrection} from '../_shared/cofiring-inventory-correction-store.js';

const TABLE='cofiring_provisional_snapshots_v12';
const UNITS=['unit1','unit2'], FUELS=['coal','bio','organic','manure'];
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e6;
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const isoDate=x=>typeof x==='string'&&/^20\d\d-\d\d-\d\d$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const nextDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const reject=(message,code='INVALID',status=400)=>json({ok:false,code,message},status);
const SHA=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const fail=(message,code='INVALID')=>{throw Object.assign(new Error(message),{code});};
async function auth(ctx){
 const db=ctx.env?.DB;if(!db)return {error:reject('DB 연결을 확인해 주세요.','NO_DB',503)};
 const token=/^Bearer\s+([^\s]+)$/i.exec(ctx.request.headers.get('Authorization')||'')?.[1];
 if(!token)return {error:reject('로그인이 필요합니다.','AUTH_REQUIRED',401)};
 const tokenHash=await SHA(token);
 const row=await db.prepare(`SELECT s.employee_no,s.expires_at,u.name,u.is_active FROM shift_log_sessions s JOIN users u ON u.employee_no=s.employee_no WHERE s.token_hash=? LIMIT 1`).bind(tokenHash).first();
 if(!row||Number(row.is_active)!==1||!(Date.parse(row.expires_at||'')>Date.now()))return {error:reject('로그인 세션을 확인해 주세요.','AUTH_EXPIRED',401)};
 return {user:{id:String(row.employee_no),name:String(row.name||'')}};
}
async function schema(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE} (
 target_date TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 request_id TEXT NOT NULL UNIQUE,payload_sha256 TEXT NOT NULL,source_request_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,
 receipt_sha256 TEXT NOT NULL,record_json TEXT NOT NULL,
 saved_by_id TEXT NOT NULL,saved_by_name TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(target_date,revision))`).run();
 await db.prepare(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_recent ON ${TABLE}(created_at DESC)`).run();
}
function decode(row,includeFull=false){
 if(!row)return null;let saved;try{saved=JSON.parse(row.record_json)}catch{return null}
 if(saved?.recordKind!=='hypothesis'||saved.verificationStatus!=='unverified'||saved.officialClose===true||saved.targetDate!==row.target_date)return null;
 return {targetDate:row.target_date,revision:Number(row.revision),recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,
  sourceRequestId:row.source_request_id,summary:saved.summary,assumption:saved.assumption,adjustment:saved.adjustment||null,
  savedByName:row.saved_by_name,savedAt:row.created_at,
  ...(includeFull?{record:saved}:{})};
}
async function latest(db,date){return db.prepare(`SELECT * FROM ${TABLE} WHERE target_date=? ORDER BY revision DESC LIMIT 1`).bind(date).first();}
async function receiptFor(db,start,end){
 // The same completed-unloading departure interval as solid-fuel-trouble's receiptSummaryPeriod.
 const row=await db.prepare(`SELECT COALESCE(SUM(receipt_tons),0) AS tons FROM solid_fuel_unloading_logs
 WHERE deleted_at IS NULL AND fuel_type='organic' AND receipt_tons IS NOT NULL AND departure_time<>''
 AND (unloading_date||'T'||departure_time)>=? AND (unloading_date||'T'||departure_time)<?`)
 .bind(start,end).first();
 const entries=await db.prepare(`SELECT id,version,receipt_tons,unloading_date,departure_time,fuel_type FROM solid_fuel_unloading_logs
 WHERE deleted_at IS NULL AND fuel_type='organic' AND receipt_tons IS NOT NULL AND departure_time<>''
 AND (unloading_date||'T'||departure_time)>=? AND (unloading_date||'T'||departure_time)<? ORDER BY id`)
 .bind(start,end).all();
 const tons=Number(row?.tons);if(!number(tons))fail('입고량을 확인하지 못했습니다.','RECEIPT_INVALID');
 for(const e of entries.results||[])if(!number(e.receipt_tons)||e.receipt_tons<=0||!Number.isSafeInteger(Number(e.version)))fail('입고 자료에 확인되지 않은 기록이 있습니다.','RECEIPT_INVALID');
 const evidence=JSON.stringify(entries.results||[]);
 return {tons,sha256:await SHA(evidence),count:(entries.results||[]).length,evidence};
}
async function sourceFor(db,date,sourceId){
 if(!/^[a-f\d-]{30,48}$/i.test(sourceId||''))fail('원본 조회 ID를 확인해 주세요.','SOURCE_ID');
 const row=await db.prepare(`SELECT id,target_date,request_type,status,result_json FROM ois_data_requests WHERE id=? AND target_date=? AND request_type='cofiring_period' AND status='complete' LIMIT 1`).bind(sourceId,date).first();
 if(!row?.result_json)fail('완료된 DataPARC 원본 조회 결과가 없습니다.','SOURCE_MISSING');
 const spec={startLocal:date+'T00:00',endLocal:nextDay(date)+'T00:00',stepUnit:'minute',stepValue:1};
 let parsed;try{parsed=contract.periodResult(JSON.parse(row.result_json),sourceId,spec)}catch{fail('원본 보고서 기간·품질 검증에 실패했습니다.','SOURCE_MISMATCH')}
 const ref={...parsed.report.reference,organicInventoryReady:parsed.report.organicInventoryReady,
  organicInventory:parsed.report.organicInventory??null,organicInventorySamples:parsed.report.organicInventorySamples};
 return {spec,ref,raw:row.result_json,sha256:await SHA(row.result_json)};
}
function checkedSettings(settings){
 if(!object(settings))fail('계산 당시의 발열량·보정계수를 확인해 주세요.','SETTINGS');
 const calorifics={},coefficients={};
 for(const u of UNITS){calorifics[u]={};coefficients[u]={};for(const f of FUELS){
  const item=settings?.[u]?.[f];
  if(!object(item)||typeof item.calorific!=='number'||item.calorific<=0||item.calorific>50000||typeof item.coefficient!=='number'||item.coefficient<=0||item.coefficient>100||!Number.isFinite(item.calorific)||!Number.isFinite(item.coefficient))fail('발열량 또는 보정계수가 유효하지 않습니다.','SETTINGS');
  calorifics[u][f]=item.calorific;coefficients[u][f]=item.coefficient;
 }}return {calorifics,coefficients};
}
const same=(a,b,tol=0.0001)=>typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol;
function validatePreview(client,result){
 // Comparison is to authoritative saved DataPARC + server-derived heat math, not to a client-supplied canonical snapshot.
 if(!object(client)||!object(client.units)||!object(client.combined))fail('계산 화면을 다시 확인해 주세요.','PREVIEW');
 for(const u of UNITS){const shown=client.units[u],actual=result.units[u];
  for(const f of FUELS)if(!same(shown?.[f],actual[f].quantity))fail('표시된 연료 사용량과 서버의 재계산 결과가 다릅니다.','PREVIEW_MISMATCH');
  for(const k of ['bio','organicGroup','total'])if(!same(shown?.ratios?.[k],actual.fuelRatios[k],0.0001))fail('표시된 혼소율과 서버 재계산 결과가 다릅니다.','PREVIEW_MISMATCH');
 }
 for(const k of ['bio','organicGroup','total'])if(!same(client.combined[k],result.combined.fuelRatios[k],0.0001))fail('종합 혼소율이 서버 재계산값과 다릅니다.','PREVIEW_MISMATCH');
}
async function derive(db,body){
 if(!isoDate(body?.targetDate)||!['2026-10-23','2026-10-24'].includes(body.targetDate))fail('가정 재고가 승인된 10월 23일·24일 자료만 지원합니다.','DATE_UNSUPPORTED');
 if(Date.parse(nextDay(body.targetDate)+'T00:01:00+09:00')>=Date.now())fail('완료된 일별 조회 결과만 가정 저장할 수 있습니다.','PERIOD_NOT_CLOSED');
 if(body.acknowledgeUnverified!==true)fail('가정 계산의 미확정 상태를 먼저 확인해 주세요.','ACK_REQUIRED');
 await ensureCorrectionTable(db);
 const confirmed=await latestCorrection(db,'organicStorageSiloB','2026-10-24T00:00');
 if(confirmed?.method==='confirmed')fail('공통 자정 재고의 확인값이 존재합니다. 가정 계산 대신 정상 재계산을 사용해 주세요.','SOURCE_CONFIRMED');
 const src=await sourceFor(db,body.targetDate,body.sourceRequestId);
 const r=await receiptFor(db,src.spec.startLocal,src.spec.endLocal);
 if(!same(body.receiptTons,r.tons,0.001))fail('입고 기록이 바뀌었습니다. 가정 계산을 다시 조회해 주세요.','RECEIPT_CHANGED');
 let adjacent=null;
 if(body.targetDate==='2026-10-24'){
  const prior=await db.prepare(`SELECT id FROM ois_data_requests WHERE target_date='2026-10-23' AND request_type='cofiring_period' AND status='complete' ORDER BY requested_at DESC,id DESC LIMIT 1`).first();
  if(prior){try{adjacent=(await sourceFor(db,'2026-10-23',prior.id)).ref}catch{} }
 }
 const candidate=scenarioApi.displayScenario(src.ref,r.tons,src.spec,adjacent);
 if(!scenarioApi.isScenario(candidate)||!same(candidate.assumedStorageBTons,19.143,0.00001)||!same(candidate.unitTons,body.unitTons,0.0001))fail('현재 원본 기록으로 해당 날짜의 공통 가정 계산을 재현할 수 없습니다.','SCENARIO_MISMATCH');
 const {calorifics,coefficients}=checkedSettings(body.settings);
 const manure={};for(const u of UNITS){if(!number(body?.manure?.[u]))fail('축분 사용량을 확인해 주세요.','MANURE_INVALID');manure[u]=body.manure[u]}
 let calculated;
 try{calculated=core.analyzePeriodSummary(src.ref,{startLocal:src.spec.startLocal,endLocal:src.spec.endLocal,calorifics,coefficients,
  organic:{start:src.spec.startLocal+':00+09:00',end:src.spec.endLocal+':00+09:00',unit1:candidate.unitTons,unit2:candidate.unitTons},
  manure:{start:src.spec.startLocal+':00+09:00',end:src.spec.endLocal+':00+09:00',...manure}})}catch{fail('원본 DataPARC 계산을 재현하지 못했습니다.','RECALC_FAILED')}
 if(!UNITS.every(u=>calculated.units[u]?.coal?.complete&&calculated.units[u]?.bio?.complete))fail('정상 Coal·Bio 원본값을 확인하지 못했습니다.','FUEL_SOURCE_INVALID');
 // Official measured fuel and close records remain untouched. Recalculate the
 // optional user-consented adjustment from the saved DataPARC WHAT-IF source.
 if(body.adjustment!==undefined){
  if(body.confirmProvisionalAdjustment!==true)fail('가정 연료 계산에 대한 운전원 확인이 필요합니다.','ADJUSTMENT_ACK_REQUIRED');
  calculated=validateProvisionalAdjustment(calculated,body.settings,body.adjustment);
 }
 validatePreview(body.preview,calculated);
 const summary=core.summaryFromResult(calculated);
 const record={schemaVersion:12,recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,canOfficialClose:false,
  targetDate:body.targetDate,period:src.spec,sourceRequestId:body.sourceRequestId,sourceSha256:src.sha256,
  receiptSha256:r.sha256,receiptCount:r.count,receiptTons:r.tons,
  assumption:{silo:'organicStorageSiloB',boundaryLocal:'2026-10-24T00:00',tons:candidate.assumedStorageBTons,
   basis:'2026-10-23 DataPARC 기간 최솟값을 00:00 종료/시작 재고로 가정',source:'display-only, not certified'},
  scenario:{role:candidate.role,total:candidate.total,perUnit:candidate.unitTons,startTotal:candidate.startTotal,endTotal:candidate.endTotal},
  settings:body.settings,manure,summary,adjustment:body.adjustment||null,saveNote:'가정 계산·미확정. 원본값과 별도 저장. 공식 마감 아님.'};
 return {record,sourceRaw:src.raw,receipt:r};
}
export async function onRequestGet(ctx){
 try{const user=await auth(ctx);if(user.error)return user.error;const db=ctx.env.DB;await schema(db);
  const qs=new URL(ctx.request.url).searchParams,date=qs.get('targetDate');
  if(date){if(!isoDate(date))return reject('조회 날짜를 확인해 주세요.','DATE');return json({ok:true,item:decode(await latest(db,date),true)});}
  const limit=Math.min(180,Math.max(1,Number.parseInt(qs.get('limit')||'90',10)||90));
  const rows=await db.prepare(`SELECT p.* FROM ${TABLE} p WHERE p.revision=(SELECT MAX(q.revision) FROM ${TABLE} q WHERE q.target_date=p.target_date) ORDER BY p.target_date DESC LIMIT ?`).bind(limit).all();
  return json({ok:true,items:(rows.results||[]).map(x=>decode(x)).filter(Boolean)});
 }catch(err){console.error('provisional read failed',err?.code||err?.message);return reject('가정 계산 기록을 조회하지 못했습니다.','READ_FAILED',500)}
}
export async function onRequestPost(ctx){
 try{const user=await auth(ctx);if(user.error)return user.error;
  const req=ctx.request;if(req.headers.get('Origin')&&req.headers.get('Origin')!==new URL(req.url).origin)return reject('같은 업무일지에서 저장해 주세요.','ORIGIN',403);
  if(req.headers.get('X-ShiftLog-Client')!=='desktop'||/Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get('User-Agent')||''))return reject('로그인된 PC에서만 가정 계산을 저장할 수 있습니다.','DESKTOP_ONLY',403);
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||''))return reject('JSON 요청만 허용됩니다.','TYPE',415);
  const raw=await req.text();if(new TextEncoder().encode(raw).length>30000)return reject('저장 요청이 너무 큽니다.','SIZE',413);
  let body;try{body=JSON.parse(raw)}catch{return reject('저장 형식이 올바르지 않습니다.','JSON')}
  if(!object(body)||Object.keys(body).some(k=>!['targetDate','sourceRequestId','receiptTons','unitTons','settings','manure','preview','adjustment','confirmProvisionalAdjustment','acknowledgeUnverified','expectedRevision','requestId'].includes(k))||
    !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.requestId!=='string'||!/^[a-f0-9-]{30,48}$/i.test(body.requestId))return reject('저장 요청의 버전 또는 ID가 올바르지 않습니다.','REQUEST');
  const db=ctx.env.DB;await schema(db);
  const bodyHash=await SHA(JSON.stringify(body));
  const old=await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id=? LIMIT 1`).bind(body.requestId).first();
  if(old)return old.target_date===body.targetDate&&old.saved_by_id===user.user.id&&old.payload_sha256===bodyHash?json({ok:true,item:decode(old),replayed:true}):reject('같은 요청 ID가 다른 내용으로 제출됐습니다.','REQUEST_CONFLICT',409);
  const {record,sourceRaw,receipt}=await derive(db,body);
  // Cross-date seam consistency: an immutable what-if must never conflict with the other day.
  const otherDate=body.targetDate==='2026-10-23'?'2026-10-24':'2026-10-23';
  const other=decode(await latest(db,otherDate),true);
  if(other&&(!same(other.record?.assumption?.tons,record.assumption.tons,0.000001)||other.record?.assumption?.boundaryLocal!==record.assumption.boundaryLocal))return reject('다른 날짜에 저장된 공통 자정 재고 가정과 충돌합니다.','SEAM_CONFLICT',409);
  const receiptNow=await receiptFor(db,record.period.startLocal,record.period.endLocal);
  if(receiptNow.sha256!==receipt.sha256)return reject('입고 기록이 저장 중 변경됐습니다. 다시 계산해 주세요.','RECEIPT_CHANGED',409);
  const now=new Date().toISOString(),data=JSON.stringify(record);
  const result=await db.prepare(`INSERT INTO ${TABLE}(target_date,revision,request_id,payload_sha256,source_request_id,source_sha256,receipt_sha256,record_json,saved_by_id,saved_by_name,created_at)
   SELECT ?,?, ?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(revision),0) FROM ${TABLE} WHERE target_date=?)=?
   AND EXISTS(SELECT 1 FROM ois_data_requests WHERE id=? AND target_date=? AND request_type='cofiring_period' AND status='complete' AND result_json=?)
   ON CONFLICT DO NOTHING RETURNING *`)
    .bind(body.targetDate,body.expectedRevision+1,body.requestId,bodyHash,body.sourceRequestId,record.sourceSha256,receipt.sha256,data,user.user.id,user.user.name,now,
      body.targetDate,body.expectedRevision,body.sourceRequestId,body.targetDate,sourceRaw).all();
  const saved=result.results?.[0];if(!saved)return reject('원본 조회값 또는 다른 화면의 저장 기록이 변경됐습니다. 최신 값을 다시 확인해 주세요.','STALE_REVISION',409);
  return json({ok:true,item:decode(saved),message:'가정 계산을 미확정 기록으로 저장했습니다. 공식 마감값은 변경되지 않았습니다.'});
 }catch(err){if(err?.code)return reject(err.message,err.code,409);console.error('provisional save failed',err?.message);return reject('가정 계산 저장을 완료하지 못했습니다.','SAVE_FAILED',500)}
}
export async function onRequest(ctx){if(ctx.request.method==='GET')return onRequestGet(ctx);if(ctx.request.method==='POST')return onRequestPost(ctx);return reject('허용되지 않는 요청입니다.','METHOD',405)}
