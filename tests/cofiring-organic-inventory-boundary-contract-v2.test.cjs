'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const contract=require('../maintenance/cofiring-live-contract.js');
// V2's forward two-minute START was superseded by midnight lookback V2.
// Exercise the validator, including exact boundaries, rather than its comment.
test('organic START accepts last actual from the preceding day through midnight and rejects later or stale samples',async()=>{
  const {sourceResult,spec}=await import('./helpers/cofiring-review-fixture.mjs');
  const p=contract.period(spec,Number.MAX_SAFE_INTEGER);
  for(const [offset,valid] of [[-86400001,false],[-86400000,true],[-1,true],[0,true],[1,false],[57000,false],[119999,false]]){
    const report=structuredClone(sourceResult().report);
    report.organicInventory.samples[0].startTime=new Date(p.startMs+offset).toISOString();
    if(valid)assert.equal(contract.validatePeriodReport(report,spec).organicInventoryReady,true,String(offset));
    else assert.throws(()=>contract.validatePeriodReport(report,spec),/재고 반환시각/,String(offset));
  }
});
test('Coal and Bio keep their strict one-minute boundaries independently of the inventory lookback',async()=>{
  const {sourceResult,spec}=await import('./helpers/cofiring-review-fixture.mjs');
  const p=contract.period(spec,Number.MAX_SAFE_INTEGER);
  for(const [field,boundary] of [['startTime',p.startMs],['endTime',p.endMs]]){
    for(const [offset,valid] of [[-1,false],[0,true],[59999,true],[60000,false]]){
      const report=structuredClone(sourceResult().report);report.summaries[0][field]=new Date(boundary+offset).toISOString();
      if(valid)assert.equal(contract.validatePeriodReport(report,spec).status,'PERIOD_READY');
      else assert.throws(()=>contract.validatePeriodReport(report,spec),/기간 경계 반환시각/);
    }
  }
});
test('API embeds the exact browser validator and loads one versioned browser contract',()=>{
  const shared=fs.readFileSync('maintenance/cofiring-live-contract.js','utf8').replace(/\r\n/g,'\n').split('\n(function(root)')[0];
  assert.ok(fs.readFileSync('functions/api/ois-data-requests.js','utf8').replace(/\r\n/g,'\n').includes(shared));
  const html=fs.readFileSync('index.html','utf8');
  assert.equal((html.match(/<script\s+src="\/maintenance\/cofiring-live-contract\.js\?v=[^"\s]+"\s+defer><\/script>/g)||[]).length,1);
});
