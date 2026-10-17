import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import * as periodApi from '../functions/api/cofiring-period-adjustments.js';
import * as morningApi from '../functions/api/morning-meeting-cofiring-adjustments.js';
import {database, packet, call, stored, spec, DATE, adjust, clone} from './helpers/cofiring-review-fixture.mjs';

const period = {start:spec.startLocal, end:spec.endLocal};
const values = () => ({finalCoalUnit1:190.123456, finalCoalUnit2:210.654321, finalBioUnit1:25.123456, finalBioUnit2:32.654321});
const adjustment = () => ({mode:'manual_table', fromUnit:null, bioTransferTons:0, ...values(), maxBioTpd:null, excludedBioTons:0, note:'table edit'});
const saveBody = (entry=adjustment(), revision=0) => ({action:'save', ...period, adjustment:entry, expectedRevision:revision, requestId:randomUUID()});
async function periodCall(db, {method='GET', body, end=period.end}={}) {
  const url = new URL('https://review.invalid/api/cofiring-period-adjustments');
  url.searchParams.set('start',period.start); url.searchParams.set('end',end);
  const request = new Request(url, {method, headers:{Authorization:'Bearer valid', 'Content-Type':'application/json', 'X-ShiftLog-Client':'desktop'},
    ...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const response = await periodApi.onRequest({request, env:{DB:db}});
  return {status:response.status, payload:await response.json()};
}
async function morningCall(db, body) {
  const request = new Request('https://review.invalid/api/morning-meeting-cofiring-adjustments', {method:'POST',
    headers:{Authorization:'Bearer valid','Content-Type':'application/json','X-ShiftLog-Client':'desktop'}, body:JSON.stringify(body)});
  const response = await morningApi.onRequestPost({request, env:{DB:db}});
  return {status:response.status, payload:await response.json()};
}
const rowCount = db => db.raw.prepare('SELECT COUNT(*) AS count FROM cofiring_period_adjustment_history').get().count;

test('manual table API saves and rereads exact Coal/Bio values with revision, replay and CLEAR protection', async t => {
  const db=database(t), originalSource=db.raw.prepare('SELECT result_json FROM ois_data_requests').get().result_json;
  const body=saveBody();
  const first=await periodCall(db,{method:'POST',body});
  assert.equal(first.status,200,JSON.stringify(first.payload));
  assert.deepEqual(first.payload.adjustment,adjustment());
  assert.equal(first.payload.entry.revision,1);
  const read=await periodCall(db); assert.deepEqual(read.payload.adjustment,adjustment());
  assert.equal(read.payload.revision,1);
  const replay=await periodCall(db,{method:'POST',body});
  assert.equal(replay.status,200); assert.equal(replay.payload.replayed,true); assert.equal(rowCount(db),1);
  const stale=await periodCall(db,{method:'POST',body:saveBody({...adjustment(),finalCoalUnit1:199},0)});
  assert.equal(stale.status,409); assert.equal(stale.payload.code,'REVISION_CONFLICT');
  assert.equal((await periodCall(db,{end:'2026-09-11T00:01'})).payload.adjustment,null);
  const clear=await periodCall(db,{method:'POST',body:{action:'clear',...period,expectedRevision:1,requestId:randomUUID()}});
  assert.equal(clear.status,200); assert.equal(clear.payload.entry.revision,2); assert.equal(clear.payload.adjustment,null);
  assert.equal(rowCount(db),2); assert.equal((await periodCall(db)).payload.adjustment,null);
  assert.equal(db.raw.prepare('SELECT result_json FROM ois_data_requests').get().result_json,originalSource);
});

test('manual table API requires all four final quantities as finite bounded numbers', async t => {
  const db=database(t);
  for (const key of ['finalCoalUnit1','finalCoalUnit2','finalBioUnit1','finalBioUnit2']) {
    for (const bad of [undefined,null,'12.5',true,-1,1000000.01,Number.NaN,Number.POSITIVE_INFINITY]) {
      const entry={...adjustment(),[key]:bad};
      const response=await periodCall(db,{method:'POST',body:saveBody(entry)});
      assert.equal(response.status,400,key+' accepted '+String(bad));
    }
  }
  assert.equal(rowCount(db),0);
  const endpoints={...adjustment(),finalCoalUnit1:0,finalCoalUnit2:1000000,finalBioUnit1:0,finalBioUnit2:1000000};
  const response=await periodCall(db,{method:'POST',body:saveBody(endpoints)});
  assert.equal(response.status,200,JSON.stringify(response.payload));
  assert.deepEqual(response.payload.adjustment,endpoints);
});

test('existing Bio-only adjustment payloads retain their previous response shape', async t => {
  const db=database(t), old={mode:'manual_final',fromUnit:null,bioTransferTons:0,finalBioUnit1:25,finalBioUnit2:35,maxBioTpd:null,excludedBioTons:0,note:''};
  const response=await periodCall(db,{method:'POST',body:saveBody(old)});
  assert.equal(response.status,200); assert.deepEqual(response.payload.adjustment,old);
  assert.equal(Object.hasOwn(response.payload.adjustment,'finalCoalUnit1'),false);
  assert.equal(Object.hasOwn(response.payload.adjustment,'finalCoalUnit2'),false);
});

test('manual table closed validation recalculates heats and ratios while preserving original and organic inputs', async t => {
  const db=database(t), body=packet(), original=clone(body.snapshot.result), manual=clone(body.snapshot.manual);
  const preview=adjust.adjustTable(original,body.snapshot.settings,values());
  assert.equal(preview.ok,true,preview.message); body.snapshot.result=preview.result;
  const response=await call(db,{body}); assert.equal(response.status,200,JSON.stringify(response.payload));
  const snapshot=JSON.parse(stored(db).snapshot_json);
  assert.deepEqual(snapshot.originalResult,original); assert.deepEqual(snapshot.result,preview.result);
  assert.deepEqual(snapshot.manual,manual);
  for (const unit of ['unit1','unit2']) {
    const result=snapshot.result.units[unit], settings=snapshot.settings[unit];
    for (const fuel of ['organic','manure']) assert.deepEqual(result[fuel],original.units[unit][fuel]);
    const heat=Object.fromEntries(['coal','bio','organic','manure'].map(fuel=>[fuel,result[fuel].quantity*settings[fuel].calorific/1000]));
    const total=Object.values(heat).reduce((sum,value)=>sum+value,0);
    assert.ok(Math.abs(result.heats.total-total)<1e-9);
    assert.ok(Math.abs(result.fuelRatios.bio-heat.bio/total*100)<1e-9);
    assert.ok(Math.abs(result.fuelRatios.organicGroup-(heat.organic+heat.manure)/total*100)<1e-9);
    assert.ok(Math.abs(result.fuelRatios.total-result.fuelRatios.bio-result.fuelRatios.organicGroup)<1e-9);
  }
  const reread=await call(db,{method:'GET',query:'?targetDate='+DATE});
  assert.equal(reread.status,200); assert.deepEqual(reread.payload.item.effectiveResult,preview.result);
});

test('manual table closed validation rejects forged heats, ratios, organic quantities and invalid direct fuel', async t => {
  for (const mutate of [
    result=>result.units.unit1.heats.total++,
    result=>result.units.unit1.fuelRatios.bio++,
    result=>result.units.unit2.fuelRatios.organicGroup++,
    result=>result.combined.fuelRatios.total++,
    result=>result.units.unit1.organic.quantity++,
    result=>result.units.unit2.manure.quantity++,
    result=>{result.units.unit1.coal.quantity=-1;},
    result=>{result.units.unit2.bio.quantity=1000000.01;}
  ]) {
    const db=database(t), body=packet(), sourceBefore=db.raw.prepare('SELECT result_json FROM ois_data_requests').get().result_json;
    const preview=adjust.adjustTable(body.snapshot.result,body.snapshot.settings,values());
    assert.equal(preview.ok,true,preview.message); body.snapshot.result=preview.result; mutate(body.snapshot.result);
    const response=await call(db,{body}); assert.equal(response.status,400,JSON.stringify(response.payload));
    assert.equal(stored(db),undefined); assert.equal(db.writes,0);
    assert.equal(db.raw.prepare('SELECT result_json FROM ois_data_requests').get().result_json,sourceBefore);
  }
});

test('closed GET projects saved manual table Coal/Bio and CLEAR restores raw snapshot without rewriting it', async t => {
  const db=database(t), body=packet(), raw=clone(body.snapshot.result);
  const closed=await call(db,{body}); assert.equal(closed.status,200,JSON.stringify(closed.payload));
  const unchanged=stored(db).snapshot_json;
  const save=await periodCall(db,{method:'POST',body:saveBody()}); assert.equal(save.status,200,JSON.stringify(save.payload));
  const projected=await call(db,{method:'GET',query:'?targetDate='+DATE});
  assert.equal(projected.status,200); assert.equal(projected.payload.item.adjustmentApplied,true);
  const item=projected.payload.item;
  assert.deepEqual(item.effectiveOriginalResult,raw);
  for (const [unit,suffix] of [['unit1','1'],['unit2','2']]) {
    assert.equal(item.effectiveResult.units[unit].coal.quantity,values()['finalCoalUnit'+suffix]);
    assert.equal(item.effectiveResult.units[unit].bio.quantity,values()['finalBioUnit'+suffix]);
    for (const fuel of ['organic','manure']) assert.deepEqual(item.effectiveResult.units[unit][fuel],raw.units[unit][fuel]);
  }
  assert.equal(stored(db).snapshot_json,unchanged);
  await periodCall(db,{method:'POST',body:{action:'clear',...period,expectedRevision:1,requestId:randomUUID()}});
  const cleared=await call(db,{method:'GET',query:'?targetDate='+DATE});
  assert.equal(cleared.payload.item.adjustmentApplied,false); assert.deepEqual(cleared.payload.item.effectiveResult,raw);
  assert.equal(stored(db).snapshot_json,unchanged);
});

test('morning compatibility adapter preserves new Coal fields through save and shared history read', async t => {
  const db=database(t);
  const saved=await morningCall(db,{targetDate:DATE,adjustment:adjustment()});
  assert.equal(saved.status,200,JSON.stringify(saved.payload));
  assert.equal(saved.payload.adjustment.mode,'manual_table');
  assert.equal(saved.payload.adjustment.finalCoalUnit1,values().finalCoalUnit1);
  assert.equal(saved.payload.adjustment.finalCoalUnit2,values().finalCoalUnit2);
  const shared=await periodCall(db); assert.equal(shared.payload.adjustment.finalCoalUnit2,values().finalCoalUnit2);
  const invalid=await morningCall(db,{targetDate:DATE,adjustment:{...adjustment(),finalCoalUnit1:'123'}});
  assert.equal(invalid.status,400); assert.equal(rowCount(db),1);
});
