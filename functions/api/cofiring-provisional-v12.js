// Completed daily estimates, append-only and independently revalidated. Never a certified close.
import core from '../../maintenance/cofiring-core.js';
import contract from '../../maintenance/cofiring-live-contract.js';
import estimateApi from '../../maintenance/cofiring-estimate-v1.js';
import sharedMidnight from '../../maintenance/cofiring-shared-midnight-v6.js';
import {validateProvisionalAdjustment} from '../_shared/cofiring-provisional-adjust-v14.mjs';
import {CORRECTION_TABLE,SILOS,boundaryKey,listCorrections,snapshotEvidence,correctionWriteGuard} from '../_shared/cofiring-inventory-correction-store.js';

const TABLE='cofiring_provisional_snapshots_v12';
const UNITS=['unit1','unit2'], FUELS=['coal','bio','organic','manure'];
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e6;
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const isoDate=x=>typeof x==='string'&&/^20\d\d-\d\d-\d\d$/.test(x)&&!Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const nextDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const previousDay=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
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
 const item={targetDate:row.target_date,revision:Number(row.revision),recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,
  sourceRequestId:row.source_request_id,summary:saved.summary,assumption:saved.assumption,adjustment:saved.adjustment||null,
  ...(saved.estimation?{estimation:saved.estimation}:{}),savedByName:row.saved_by_name,savedAt:row.created_at,
  ...(includeFull?{record:saved}:{})};
 return estimateApi.validItem(item,row.target_date)?item:null;
}
async function latest(db,date){return db.prepare(`SELECT * FROM ${TABLE} WHERE target_date=? ORDER BY revision DESC LIMIT 1`).bind(date).first();}
async function receiptFor(db,start,end){
 // The same completed-unloading departure interval as solid-fuel-trouble's receiptSummaryPeriod.
 const entries=await db.prepare(`SELECT id,version,receipt_tons,unloading_date,departure_time,fuel_type FROM solid_fuel_unloading_logs
 WHERE deleted_at IS NULL AND fuel_type='organic' AND receipt_tons IS NOT NULL AND departure_time<>''
 AND (unloading_date||'T'||departure_time)>=? AND (unloading_date||'T'||departure_time)<? ORDER BY id`)
 .bind(start,end).all();
 const rows=entries.results;
 if(!Array.isArray(rows))fail('입고 기록 응답을 확인하지 못했습니다.','RECEIPT_INVALID');
 for(const e of rows)if(!number(e.receipt_tons)||e.receipt_tons<=0||!Number.isSafeInteger(Number(e.version))||Number(e.version)<1)
  fail('입고 자료에 확인되지 않은 기록이 있습니다.','RECEIPT_INVALID');
 // One row snapshot supplies BOTH the calculation total and the write guard.
 // A separate SUM read could race with an unloading edit before evidence read.
 const tons=rows.reduce((total,entry)=>total+entry.receipt_tons,0);
 if(!number(tons))fail('입고량을 확인하지 못했습니다.','RECEIPT_INVALID');
 const evidence=JSON.stringify(rows);
 return {tons,sha256:await SHA(evidence),count:rows.length,evidence};
}
async function sourceFor(db,date,sourceId){
 if(!/^[a-f\d-]{30,48}$/i.test(sourceId||''))fail('원본 조회 ID를 확인해 주세요.','SOURCE_ID');
 const row=await db.prepare(`SELECT id,target_date,request_type,status,result_json FROM ois_data_requests WHERE id=? AND target_date=? AND request_type='cofiring_period' AND status='complete' LIMIT 1`).bind(sourceId,date).first();
 if(!row?.result_json)fail('완료된 DataPARC 원본 조회 결과가 없습니다.','SOURCE_MISSING');
 const spec={startLocal:date+'T00:00',endLocal:nextDay(date)+'T00:00',stepUnit:'minute',stepValue:1};
 let parsed;try{parsed=contract.periodResult(JSON.parse(row.result_json),sourceId,spec)}catch{fail('원본 보고서 기간·품질 검증에 실패했습니다.','SOURCE_MISMATCH')}
 const ref={...parsed.report.reference,organicInventoryReady:parsed.report.organicInventoryReady,
  organicInventory:parsed.report.organicInventory??null,organicInventorySamples:parsed.report.organicInventorySamples};
 return {id:sourceId,targetDate:date,spec,ref,raw:row.result_json,sha256:await SHA(row.result_json)};
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
async function adjacentFor(db,src,requestedId){
 const planned=sharedMidnight.plan(src.spec,src.ref);
 if(requestedId!==undefined&&(!planned||typeof requestedId!=='string'||!/^[a-f\d-]{30,48}$/i.test(requestedId)))
  fail('인접 날짜의 원본 조회 ID를 확인해 주세요.','PEER_SOURCE_ID');
 if(!planned)return null;
 const spec=planned.peerSpec,date=spec.startLocal.slice(0,10);
 if(requestedId!==undefined)return sourceFor(db,date,requestedId);
 // Match the existing read-only OIS endpoint: only independently validated,
 // completed results for this exact adjacent full day may be used.
 const rows=await db.prepare(`SELECT id FROM ois_data_requests WHERE request_type='cofiring_period' AND target_date=? AND status='complete'
  AND CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.startLocal') END=?
  AND CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.endLocal') END=?
  AND CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.stepUnit') END=?
  AND CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.request.stepValue') END=?
  ORDER BY requested_at DESC,id DESC LIMIT 20`).bind(date,spec.startLocal,spec.endLocal,spec.stepUnit,spec.stepValue).all();
 for(const row of rows.results||[]){try{return await sourceFor(db,date,row.id)}catch{}}
 return null;
}
function allCorrectionGuard(entries,spec){
 const sql=[],args=[];
 for(const boundary of [spec.startLocal,spec.endLocal])for(const silo of SILOS){
  const revision=entries.find(item=>item.silo===silo&&item.boundaryLocal===boundary)?.revision||0;
  sql.push(`(SELECT COALESCE(MAX(revision),0) FROM ${CORRECTION_TABLE} WHERE boundary_key=?)=?`);
  args.push(boundaryKey(silo,boundary),revision);
 }
 return {sql:' AND '+sql.join(' AND '),args};
}
function receiptWriteGuard(receipt,start,end){
 const rows=JSON.parse(receipt.evidence);
 return {sql:` AND (SELECT COUNT(*) FROM solid_fuel_unloading_logs WHERE deleted_at IS NULL
  AND fuel_type='organic' AND receipt_tons IS NOT NULL AND departure_time<>''
  AND (unloading_date||'T'||departure_time)>=? AND (unloading_date||'T'||departure_time)<?)=?
  AND NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(
   SELECT 1 FROM solid_fuel_unloading_logs evidence WHERE evidence.id=json_extract(ref.value,'$.id')
   AND evidence.version=json_extract(ref.value,'$.version') AND evidence.deleted_at IS NULL
   AND evidence.receipt_tons=json_extract(ref.value,'$.receipt_tons')
   AND evidence.unloading_date=json_extract(ref.value,'$.unloading_date')
   AND evidence.departure_time=json_extract(ref.value,'$.departure_time')
   AND evidence.fuel_type=json_extract(ref.value,'$.fuel_type')))`,args:[start,end,rows.length,receipt.evidence]};
}
function peerWriteGuard(peer){
 return peer?{sql:` AND EXISTS(SELECT 1 FROM ois_data_requests WHERE id=? AND target_date=?
  AND request_type='cofiring_period' AND status='complete' AND result_json=?)`,args:[peer.id,peer.targetDate,peer.raw]}:{sql:'',args:[]};
}
function savedBoundaries(item){
 if(!item)return [];
 if(item.estimation)return item.estimation.boundaries;
 const a=item.assumption;return a?[{silo:a.silo,boundaryLocal:a.boundaryLocal,tons:a.tons}]:[];
}
async function adjacentSnapshotGuard(db,record){
 const sql=[],args=[];
 for(const date of [previousDay(record.targetDate),nextDay(record.targetDate)]){
  const row=await latest(db,date),item=decode(row);
  if(row&&!item)fail('인접 날짜의 저장된 추정 기록을 확인하지 못했습니다.','SAVED_RECORD_INVALID');
  for(const left of record.estimation.boundaries)for(const right of savedBoundaries(item)){
   // Historical 19.143t was recorded to three decimal places. Compare at that
   // established precision, while retaining the full source value in each row.
   if(left.silo===right.silo&&left.boundaryLocal===right.boundaryLocal&&!same(left.tons,right.tons,0.001))
    fail('인접 날짜에 저장된 동일 시각 재고 추정값과 다릅니다. 원본과 추정 근거를 다시 확인해 주세요.','SEAM_CONFLICT');
  }
  sql.push(`(SELECT COALESCE(MAX(revision),0) FROM ${TABLE} WHERE target_date=?)=?`);
  args.push(date,Number(row?.revision||0));
 }
 return {sql:' AND '+sql.join(' AND '),args};
}
async function derive(db,body){
 if(!isoDate(body?.targetDate))fail('추정 계산을 저장할 날짜를 확인해 주세요.','DATE');
 if(Date.parse(nextDay(body.targetDate)+'T00:01:00+09:00')>=Date.now())fail('완료된 일별 조회 결과만 추정 저장할 수 있습니다.','PERIOD_NOT_CLOSED');
 if(body.acknowledgeUnverified!==true)fail('추정 계산의 미확정 상태를 먼저 확인해 주세요.','ACK_REQUIRED');
 if(body.estimateKind!==undefined&&!['shared-scenario','inventory-balance'].includes(body.estimateKind))
  fail('추정 계산의 근거 유형을 확인해 주세요.','ESTIMATE_KIND');
 const src=await sourceFor(db,body.targetDate,body.sourceRequestId);
 const corrections=await listCorrections(db,src.spec.startLocal,src.spec.endLocal);
 const receipt=await receiptFor(db,src.spec.startLocal,src.spec.endLocal);
 if(!same(body.receiptTons,receipt.tons,0.001))fail('입고 기록이 바뀌었습니다. 추정 계산을 다시 조회해 주세요.','RECEIPT_CHANGED');
 const peer=await adjacentFor(db,src,body.peerSourceRequestId);
 const candidate=estimateApi.deriveUsage(src.ref,receipt.tons,src.spec,corrections,peer?.ref||null,body.estimateKind);
 if(!candidate||!same(candidate.unitTons,body.unitTons,0.0001))
  fail('현재 원본과 저장된 재고 근거로 화면의 추정 계산을 재현하지 못했습니다. 계산 결과를 다시 확인해 주세요.','ESTIMATE_MISMATCH');
 const refs=estimateApi.normalizeCorrectionRefs(body.correctionRefs||[]);
 if(!refs||JSON.stringify(refs)!==JSON.stringify(candidate.correctionRefs))
  fail('추정 계산에 사용한 재고 보완 기록이 변경됐습니다. 최신 값을 다시 확인해 주세요.','CORRECTION_CHANGED');
 const usedCorrections=[];
 for(const ref of candidate.correctionRefs){
  const entry=corrections.find(item=>item.silo===ref.silo&&item.boundaryLocal===ref.boundaryLocal&&item.revision===ref.revision);
  if(!entry)fail('계산에 사용한 재고 보완 이력이 일치하지 않습니다.','CORRECTION_CHANGED');
  let evidence;try{evidence=await snapshotEvidence(db,entry)}catch{fail('재고 보완의 입고·하역 근거가 변경됐습니다. 최신 기록을 다시 확인해 주세요.','CORRECTION_EVIDENCE_CHANGED')}
  usedCorrections.push({...entry,evidenceSnapshots:evidence});
 }
 const {calorifics,coefficients}=checkedSettings(body.settings);
 const manure={};for(const u of UNITS){if(!number(body?.manure?.[u]))fail('축분 사용량을 확인해 주세요.','MANURE_INVALID');manure[u]=body.manure[u]}
 let calculated;
 try{calculated=core.analyzePeriodSummary(src.ref,{startLocal:src.spec.startLocal,endLocal:src.spec.endLocal,calorifics,coefficients,
  organic:{start:src.spec.startLocal+':00+09:00',end:src.spec.endLocal+':00+09:00',unit1:candidate.unitTons,unit2:candidate.unitTons},
  manure:{start:src.spec.startLocal+':00+09:00',end:src.spec.endLocal+':00+09:00',...manure}})}catch{fail('원본 DataPARC 계산을 재현하지 못했습니다.','RECALC_FAILED')}
 if(!UNITS.every(u=>calculated.units[u]?.coal?.complete&&calculated.units[u]?.bio?.complete))fail('정상 Coal·Bio 원본값을 확인하지 못했습니다.','FUEL_SOURCE_INVALID');
 if(body.adjustment!==undefined){
  if(body.confirmProvisionalAdjustment!==true)fail('추정 연료 계산에 대한 운전원 확인이 필요합니다.','ADJUSTMENT_ACK_REQUIRED');
  calculated=validateProvisionalAdjustment(calculated,body.settings,body.adjustment);
 }
 validatePreview(body.preview,calculated);
 const summary=core.summaryFromResult(calculated),estimation={...candidate.estimation,...(peer?{peerSourceRequestId:peer.id}:{})};
 const usage=candidate.usage,scenario=candidate.scenario;
 const record={schemaVersion:12,recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,canOfficialClose:false,
  targetDate:body.targetDate,period:src.spec,sourceRequestId:body.sourceRequestId,sourceSha256:src.sha256,
  receiptSha256:receipt.sha256,receiptCount:receipt.count,receiptTons:receipt.tons,
  estimation,assumption:candidate.assumption,
  scenario:{role:scenario?.role||'inventory-balance',total:scenario?.total??usage?.usage,perUnit:candidate.unitTons,
   startTotal:scenario?.startTotal??usage?.startTotal,endTotal:scenario?.endTotal??usage?.endTotal},
  ...(peer?{peerSourceRequestId:peer.id,peerSourceSha256:peer.sha256}:{}),organicCorrections:usedCorrections,
  ...(usage?.inventory?{organicInventory:usage.inventory}:{}),settings:body.settings,manure,summary,adjustment:body.adjustment||null,
  saveNote:'추정 계산 · 미확정. 원본값과 별도 저장. 공식 마감 아님.'};
 const guards=[allCorrectionGuard(corrections,src.spec),correctionWriteGuard(usedCorrections),
  receiptWriteGuard(receipt,src.spec.startLocal,src.spec.endLocal),peerWriteGuard(peer),await adjacentSnapshotGuard(db,record)];
 return {record,sourceRaw:src.raw,guard:{sql:guards.map(x=>x.sql).join(''),args:guards.flatMap(x=>x.args)}};
}
export async function onRequestGet(ctx){
 try{const user=await auth(ctx);if(user.error)return user.error;const db=ctx.env.DB;await schema(db);
  const qs=new URL(ctx.request.url).searchParams,date=qs.get('targetDate'),month=qs.get('month');
  if(date&&month)return reject('날짜 또는 조회 월 하나를 선택해 주세요.','DATE');
  if(date){if(!isoDate(date))return reject('조회 날짜를 확인해 주세요.','DATE');return json({ok:true,item:decode(await latest(db,date),true)});}
  if(month){
   if(!/^20\d\d-(?:0[1-9]|1[0-2])$/.test(month))return reject('조회 월을 확인해 주세요.','MONTH');
   const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
   const rows=await db.prepare(`SELECT p.* FROM ${TABLE} p WHERE p.target_date>=? AND p.target_date<?
    AND p.revision=(SELECT MAX(q.revision) FROM ${TABLE} q WHERE q.target_date=p.target_date) ORDER BY p.target_date DESC`).bind(start,end).all();
   return json({ok:true,month,items:(rows.results||[]).map(x=>decode(x)).filter(Boolean)});
  }
  const limit=Math.min(180,Math.max(1,Number.parseInt(qs.get('limit')||'90',10)||90));
  const rows=await db.prepare(`SELECT p.* FROM ${TABLE} p WHERE p.revision=(SELECT MAX(q.revision) FROM ${TABLE} q WHERE q.target_date=p.target_date) ORDER BY p.target_date DESC LIMIT ?`).bind(limit).all();
  return json({ok:true,items:(rows.results||[]).map(x=>decode(x)).filter(Boolean)});
 }catch(err){console.error('provisional read failed',err?.code||err?.message);return reject('추정 계산 기록을 조회하지 못했습니다.','READ_FAILED',500)}
}
export async function onRequestPost(ctx){
 try{const user=await auth(ctx);if(user.error)return user.error;
  const req=ctx.request;if(req.headers.get('Origin')&&req.headers.get('Origin')!==new URL(req.url).origin)return reject('같은 업무일지에서 저장해 주세요.','ORIGIN',403);
  if(req.headers.get('X-ShiftLog-Client')!=='desktop'||/Android|iPhone|iPad|iPod|Mobile/i.test(req.headers.get('User-Agent')||''))return reject('로그인된 PC에서만 추정 계산을 저장할 수 있습니다.','DESKTOP_ONLY',403);
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers.get('Content-Type')||''))return reject('JSON 요청만 허용됩니다.','TYPE',415);
  const raw=await req.text();if(new TextEncoder().encode(raw).length>30000)return reject('저장 요청이 너무 큽니다.','SIZE',413);
  let body;try{body=JSON.parse(raw)}catch{return reject('저장 형식이 올바르지 않습니다.','JSON')}
  if(!object(body)||Object.keys(body).some(k=>!['targetDate','sourceRequestId','receiptTons','unitTons','settings','manure','preview','adjustment','confirmProvisionalAdjustment','acknowledgeUnverified','expectedRevision','requestId','estimateKind','correctionRefs','peerSourceRequestId'].includes(k))||
    !Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.requestId!=='string'||!/^[a-f0-9-]{30,48}$/i.test(body.requestId))return reject('저장 요청의 버전 또는 ID가 올바르지 않습니다.','REQUEST');
  const db=ctx.env.DB;await schema(db);
  const bodyHash=await SHA(JSON.stringify(body));
  const old=await db.prepare(`SELECT * FROM ${TABLE} WHERE request_id=? LIMIT 1`).bind(body.requestId).first();
  if(old)return old.target_date===body.targetDate&&old.saved_by_id===user.user.id&&old.payload_sha256===bodyHash?json({ok:true,item:decode(old),replayed:true}):reject('같은 요청 ID가 다른 내용으로 제출됐습니다.','REQUEST_CONFLICT',409);
  const {record,sourceRaw,guard}=await derive(db,body);
  const now=new Date().toISOString(),data=JSON.stringify(record);
  const result=await db.prepare(`INSERT INTO ${TABLE}(target_date,revision,request_id,payload_sha256,source_request_id,source_sha256,receipt_sha256,record_json,saved_by_id,saved_by_name,created_at)
   SELECT ?,?, ?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(revision),0) FROM ${TABLE} WHERE target_date=?)=?
   AND EXISTS(SELECT 1 FROM ois_data_requests WHERE id=? AND target_date=? AND request_type='cofiring_period' AND status='complete' AND result_json=?)${guard.sql}
   ON CONFLICT DO NOTHING RETURNING *`)
    .bind(body.targetDate,body.expectedRevision+1,body.requestId,bodyHash,body.sourceRequestId,record.sourceSha256,record.receiptSha256,data,user.user.id,user.user.name,now,
      body.targetDate,body.expectedRevision,body.sourceRequestId,body.targetDate,sourceRaw,...guard.args).all();
  const saved=result.results?.[0];if(!saved)return reject('원본 조회값·입고량·재고 근거 또는 저장 기록이 변경됐습니다. 최신 값을 다시 확인해 주세요.','STALE_REVISION',409);
  return json({ok:true,item:decode(saved),message:'추정 계산을 미확정 기록으로 저장했습니다. 공식 마감값은 변경되지 않았습니다.'});
 }catch(err){if(err?.code)return reject(err.message,err.code,409);console.error('provisional save failed',err?.message);return reject('추정 계산 저장을 완료하지 못했습니다.','SAVE_FAILED',500)}
}
export async function onRequest(ctx){if(ctx.request.method==='GET')return onRequestGet(ctx);if(ctx.request.method==='POST')return onRequestPost(ctx);return reject('허용되지 않는 요청입니다.','METHOD',405)}
