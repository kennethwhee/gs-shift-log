import test from 'node:test';
import assert from 'node:assert/strict';
import * as correctionsApi from '../functions/api/cofiring-inventory-corrections.js';
import {sourceResult,packet,database,call,stored,DATE,spec} from './helpers/cofiring-review-fixture.mjs';

let sequence=0;
function missingSource(){
  const source=sourceResult();
  source.report.organicInventorySamples=structuredClone(source.report.organicInventory.samples);
  const missing=source.report.organicInventorySamples[2];
  missing.endValue=null;missing.endQuality='Raw, Bad';missing.boundaryValid=false;missing.dataComplete=false;
  missing.durationBadSeconds=120;missing.durationGoodSeconds-=120;
  source.report.organicInventory=null;source.report.organicInventoryReady=false;
  source.report.reference.organicInventory=null;source.report.reference.organicInventoryReady=false;
  return source;
}
async function correction(db,{method='confirmed',expectedRevision=0,tons=60,evidence=[]}={}){
  const request=new Request('https://review.invalid/api/cofiring-inventory-corrections',{method:'POST',
    headers:{Authorization:'Bearer valid','Content-Type':'application/json','X-ShiftLog-Client':'desktop'},
    body:JSON.stringify({silo:'organicStorageSiloB',boundaryLocal:spec.endLocal,tons,method,reason:'자정 통신 오류: 현장 운전 기록의 확인 재고',evidence,expectedRevision,requestId:String(++sequence).padStart(32,'0')})});
  const response=await correctionsApi.onRequestPost({request,env:{DB:db}});
  const payload=await response.json();assert.equal(response.status,200,JSON.stringify(payload));return payload.entry;
}
function closePacket(entry){const value=packet();value.snapshot.organicCorrections=[entry];return value;}

test('complete raw inventory closes without depending on the separate correction store',async t=>{
  const db=database(t);
  // An incompatible unrelated table would fail any correction lookup.
  db.raw.exec('CREATE TABLE cofiring_inventory_correction_history(unrelated TEXT);');
  const result=await call(db);assert.equal(result.status,200,JSON.stringify(result.payload));
  const saved=JSON.parse(stored(db).snapshot_json);
  assert.equal(saved.organicUsage.basis,'dataparc-inventory-balance-v1');
  assert.equal(saved.inventoryCorrectionVersion,undefined);
});

test('confirmed missing boundary closes from canonical server correction without changing raw quality',async t=>{
  const source=missingSource(),db=database(t,source),entry=await correction(db),body=closePacket(entry);
  const original=db.raw.prepare('SELECT result_json FROM ois_data_requests').get().result_json;
  // Only identity/revision are client authority; values and audit are server-owned.
  body.snapshot.organicCorrections[0]={...entry,tons:999,updatedByName:'forged'};
  body.snapshot.correctedOrganicInventory={end:{total:999}};
  const result=await call(db,{body});assert.equal(result.status,200,JSON.stringify(result.payload));
  const saved=JSON.parse(stored(db).snapshot_json);
  assert.equal(saved.organicInventory,null);
  assert.equal(saved.organicUsage.basis,'operator-corrected-inventory-balance-v1');
  assert.equal(saved.organicUsage.usage,20);
  assert.equal(saved.organicCorrections[0].tons,60);
  assert.equal(saved.organicCorrections[0].updatedByName,'검토 사용자');
  assert.equal(saved.correctedOrganicInventory.basis,'operator_corrected_period_boundary');
  assert.equal(saved.correctedOrganicInventory.samples[2].endValue,null);
  assert.equal(saved.correctedOrganicInventory.samples[2].endQuality,'Raw, Bad');
  assert.equal(saved.organicCorrectionSource.organicInventoryReady,false);
  assert.equal(db.raw.prepare('SELECT result_json FROM ois_data_requests').get().result_json,original);
});

test('estimated, stale, missing and duplicate correction identities cannot close',async t=>{
  for(const variant of ['estimated','stale','missing','duplicate'])await t.test(variant,async sub=>{
    const db=database(sub,missingSource()),entry=await correction(db,{method:variant==='estimated'?'estimated':'confirmed'}),body=closePacket(entry);
    if(variant==='stale')await correction(db,{expectedRevision:1});
    if(variant==='missing')delete body.snapshot.organicCorrections;
    if(variant==='duplicate')body.snapshot.organicCorrections.push(entry);
    const result=await call(db,{body});assert.equal(result.status,400,JSON.stringify(result.payload));assert.equal(stored(db),undefined);
  });
});

test('a correction revised between server calculation and close SQL cannot be silently closed',async t=>{
  const db=database(t,missingSource()),entry=await correction(db);
  db.beforeWrite=async sql=>{assert.match(sql,/INSERT INTO cofiring_closed_snapshots/);await correction(db,{expectedRevision:1});};
  const result=await call(db,{body:closePacket(entry)});
  assert.equal(result.status,409);assert.equal(stored(db),undefined);
  assert.equal(db.raw.prepare('SELECT MAX(revision) AS revision FROM cofiring_inventory_correction_history').get().revision,2);
});

test('closed corrected inventory uses frozen audit even after newer corrections or source retirement',async t=>{
  const db=database(t,missingSource()),entry=await correction(db);
  assert.equal((await call(db,{body:closePacket(entry)})).status,200);
  const before=stored(db);
  await correction(db,{expectedRevision:1,tons:61});db.raw.prepare('DELETE FROM ois_data_requests').run();
  const result=await call(db,{method:'GET',query:'?targetDate='+DATE});
  assert.equal(result.status,200);assert.equal(result.payload.item.organicInventory.basis,'operator_corrected_period_boundary');
  assert.equal(result.payload.item.organicInventory.end.organicStorageSiloB,60);
  assert.equal(result.payload.item.organicInventory.boundaries.end.organicStorageSiloB.correction.revision,1);
  assert.deepEqual(stored(db),before);
});

test('a malformed frozen corrected inventory is withheld without raw-source fallback',async t=>{
  const db=database(t,missingSource()),entry=await correction(db);
  assert.equal((await call(db,{body:closePacket(entry)})).status,200);
  const saved=JSON.parse(stored(db).snapshot_json);saved.correctedOrganicInventory.end.total++;
  db.raw.prepare('UPDATE cofiring_closed_snapshots SET snapshot_json=?').run(JSON.stringify(saved));
  const result=await call(db,{method:'GET',query:'?targetDate='+DATE});
  assert.equal(result.status,200);assert.equal(result.payload.item.organicInventory,null);
  assert.equal(JSON.parse(stored(db).snapshot_json).correctedOrganicInventory.end.total,saved.correctedOrganicInventory.end.total);
});

test('closing with changed unloading evidence rejects the stale confirmation',async t=>{
  const db=database(t,missingSource());
  db.raw.exec(`CREATE TABLE solid_fuel_unloading_logs(id TEXT PRIMARY KEY,unloading_date TEXT,arrival_time TEXT,departure_time TEXT,duration_known INTEGER,duration_minutes INTEGER,fuel_type TEXT,receipt_tons REAL,silo_route TEXT,version INTEGER,deleted_at TEXT);
    INSERT INTO solid_fuel_unloading_logs VALUES('receipt', '2026-09-11','23:30','00:20',1,50,'organic',20,'#B',1,NULL);`);
  const entry=await correction(db,{evidence:[{id:'receipt',version:1}]});
  db.raw.prepare('UPDATE solid_fuel_unloading_logs SET version=2').run();
  const result=await call(db,{body:closePacket(entry)});assert.equal(result.status,400);assert.match(result.payload.message,/변경|삭제/);assert.equal(stored(db),undefined);
});

test('evidence changed during close SQL is guarded in the same atomic write',async t=>{
  const db=database(t,missingSource());
  db.raw.exec(`CREATE TABLE solid_fuel_unloading_logs(id TEXT PRIMARY KEY,unloading_date TEXT,arrival_time TEXT,departure_time TEXT,duration_known INTEGER,duration_minutes INTEGER,fuel_type TEXT,receipt_tons REAL,silo_route TEXT,version INTEGER,deleted_at TEXT);
    INSERT INTO solid_fuel_unloading_logs VALUES('receipt', '2026-09-11','23:30','00:20',1,50,'organic',20,'#B',1,NULL);`);
  const entry=await correction(db,{evidence:[{id:'receipt',version:1}]});
  db.beforeWrite=async()=>db.raw.prepare('UPDATE solid_fuel_unloading_logs SET version=2').run();
  const result=await call(db,{body:closePacket(entry)});assert.equal(result.status,409);assert.equal(stored(db),undefined);
});
