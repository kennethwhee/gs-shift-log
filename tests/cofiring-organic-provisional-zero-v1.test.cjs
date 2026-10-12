'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../maintenance/cofiring-core.js');

const selected={startLocal:'2026-10-13T00:00',endLocal:'2026-10-13T07:19'};
const provisional={allowProvisionalZero:true};

function reference(start=68.57559204101562,end=91.490478515625) {
  const side=total=>({organicDaySilo:total,organicStorageSiloA:0,organicStorageSiloB:0,total});
  return {
    ...selected,organicInventoryReady:true,
    organicInventory:{
      basis:'dataparc_period_boundary',schemaVersion:1,...selected,
      start:side(start),end:side(end)
    }
  };
}

test('observed partial-day negative balance can display provisional zero without changing source values',()=>{
  const source=reference(),before=structuredClone(source);
  const result=core.organicInventoryUsage(source,0,selected,provisional);
  assert.equal(result.ok,true);
  assert.equal(result.provisionalZero,true);
  assert.equal(result.rawUsage,68.57559204101562-91.490478515625);
  assert.equal(result.startTotal,68.57559204101562);
  assert.equal(result.endTotal,91.490478515625);
  assert.equal(result.receipt,0);
  assert.equal(result.usage,0);
  assert.deepEqual(result.allocation,{unit1:0,unit2:0,total:0,diff:0,ok:true,mode:'equal-50-50'});
  assert.equal(result.code,'ORGANIC_BALANCE_NEGATIVE');
  assert.match(result.message,/원본 사용량 -22\.91 t/);
  assert.match(result.message,/0\.00 t 임시 표시/);
  assert.match(result.message,/입고량·재고수지 확인 필요/);
  assert.deepEqual(source,before);
});

test('closed-day and existing callers keep strict rejection unless the explicit boolean option is set',()=>{
  for(const options of [undefined,{},null,{allowProvisionalZero:false},{allowProvisionalZero:'true'}]) {
    const result=core.organicInventoryUsage(reference(),0,selected,options);
    assert.equal(result.ok,false);
    assert.equal(result.code,'ORGANIC_BALANCE_NEGATIVE');
    assert.equal(result.rawUsage,68.57559204101562-91.490478515625);
    assert.equal(result.usage,null);
    assert.equal(result.allocation,null);
  }
});

test('missing or unready source and invalid inventory remain unconfirmed with provisional display enabled',()=>{
  const missing={...selected};
  const unready=reference();unready.organicInventoryReady=false;
  const badTotal=reference();badTotal.organicInventory.start.total+=1;
  const badSilo=reference();badSilo.organicInventory.end.organicStorageSiloA=-1;
  const nonfinite=reference();nonfinite.organicInventory.start.organicDaySilo=NaN;
  const invalidBasis=reference();invalidBasis.organicInventory.basis='manual';
  for(const [source,code] of [
    [missing,'ORGANIC_INVENTORY_MISSING'],[unready,'ORGANIC_INVENTORY_MISSING'],
    [badTotal,'ORGANIC_INVENTORY_INVALID'],[badSilo,'ORGANIC_INVENTORY_INVALID'],
    [nonfinite,'ORGANIC_INVENTORY_INVALID'],[invalidBasis,'ORGANIC_PERIOD_MISMATCH']
  ]) {
    const result=core.organicInventoryUsage(source,0,selected,provisional);
    assert.equal(result.ok,false);
    assert.equal(result.code,code);
    assert.equal(result.usage,null);
    assert.equal(result.allocation,null);
    assert.notEqual(result.provisionalZero,true);
  }
});

test('unconfirmed receipt and mismatched period cannot become provisional zeros',()=>{
  for(const receipt of [null,undefined,'',0/0,Infinity,-1,'0']) {
    const result=core.organicInventoryUsage(reference(),receipt,selected,provisional);
    assert.equal(result.ok,false);
    assert.equal(result.code,'ORGANIC_RECEIPT_MISSING');
    assert.equal(result.usage,null);
  }
  const staleInventory=reference();staleInventory.organicInventory.endLocal='2026-10-13T07:18';
  const staleReference=reference();staleReference.startLocal='2026-10-12T00:00';
  for(const source of [staleInventory,staleReference]) {
    const result=core.organicInventoryUsage(source,0,selected,provisional);
    assert.equal(result.ok,false);
    assert.equal(result.code,'ORGANIC_PERIOD_MISMATCH');
    assert.equal(result.usage,null);
  }
});

test('normal positive and confirmed zero balances retain equal allocation and raw balance',()=>{
  for(const [start,end,receipt,usage] of [[50,40,20,30],[50,60,10,0]]) {
    const strict=core.organicInventoryUsage(reference(start,end),receipt,selected);
    const live=core.organicInventoryUsage(reference(start,end),receipt,selected,provisional);
    assert.deepEqual(live,strict);
    assert.equal(live.ok,true);
    assert.equal(live.rawUsage,usage);
    assert.equal(live.usage,usage);
    assert.equal(live.provisionalZero,false);
    assert.equal(live.allocation.unit1,usage/2);
    assert.equal(live.allocation.unit2,usage/2);
    assert.equal(live.code,undefined);
  }
});

test('strict tiny-negative tolerance stays unchanged while opt-in display marks its original negative',()=>{
  const source=reference(50,50.04),raw=50-50.04;
  const strict=core.organicInventoryUsage(source,0,selected);
  assert.equal(strict.ok,true);
  assert.equal(strict.usage,0);
  assert.equal(strict.rawUsage,raw);
  assert.equal(strict.provisionalZero,false);
  const live=core.organicInventoryUsage(source,0,selected,provisional);
  assert.equal(live.ok,true);
  assert.equal(live.usage,0);
  assert.equal(live.rawUsage,raw);
  assert.equal(live.provisionalZero,true);
  assert.equal(live.code,'ORGANIC_BALANCE_NEGATIVE');
});

test('closed API rejects client provisional zeros for a full-day negative balance without writing records',async t=>{
  const {sourceResult,packet,database,spec,SOURCE_ID}=await import('./helpers/cofiring-review-fixture.mjs');
  const api=await import('../functions/api/cofiring-closed-history.js');
  const source=sourceResult(),db=database(t,source),body=packet(source);
  const balance=core.organicInventoryUsage(source.report.reference,0,spec,provisional);
  assert.equal(balance.ok,true);
  assert.equal(balance.provisionalZero,true);
  assert.equal(balance.rawUsage,-10);
  body.snapshot.manual.inputMode='auto';
  body.snapshot.manual.receipts.organic=0;
  for(const unit of ['unit1','unit2'])body.snapshot.manual[unit].organic=0;
  const period=body.snapshot.period;
  body.snapshot.result=core.analyzePeriodSummary(source.report.reference,{
    organic:{start:period.start,end:period.end,unit1:0,unit2:0},
    manure:{start:period.start,end:period.end,unit1:2,unit2:0}
  });
  body.snapshot.organicUsage=balance;
  body.snapshot.result.organicUsage=balance;
  body.snapshot.summary=body.summary=core.summaryFromResult(body.snapshot.result);
  const savedSource=db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(SOURCE_ID);
  const request=new Request('https://review.invalid/api/cofiring-closed-history',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer valid'},body:JSON.stringify(body)
  });
  const response=await api.onRequest({request,env:{DB:db}}),payload=await response.json();
  assert.equal(response.status,400,JSON.stringify(payload));
  assert.equal(payload.code,'CALCULATION_MISMATCH');
  assert.match(payload.message,/종료재고가 큽니다/);
  assert.match(payload.message,/마감하지 않았습니다/);
  assert.equal(db.writes,0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS count FROM cofiring_closed_snapshots').get().count,0);
  assert.deepEqual(db.raw.prepare('SELECT result_json FROM ois_data_requests WHERE id=?').get(SOURCE_ID),savedSource);
});
