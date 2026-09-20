'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const contract=require('../maintenance/cofiring-live-contract.js');

const spec={startLocal:'2026-09-20T00:00',endLocal:'2026-09-20T11:00',stepUnit:'minute',stepValue:1};

function fuelReport(){
  const p=contract.period(spec,Number.MAX_SAFE_INTEGER);
  const seconds=p.durationMinutes*60;
  const summaries=contract.definitions.map((def,i)=>{
    const start=1000+i*100,usage=def.fuel==='coal'?100+i:50+i,end=start+usage;
    return {
      key:def.id,unit:def.unit,fuel:def.fuel,tag:def.queryTag,
      startValue:start,endValue:end,min:start,max:end,delta:usage,usageTon:usage,
      usageBasis:'end_minus_start_boundary',
      startQuality:'Raw, Good',endQuality:'Good, Raw',
      startTime:spec.startLocal+':00+09:00',endTime:spec.endLocal+':00+09:00',
      durationGoodSeconds:seconds,durationBadSeconds:0,
      boundaryValid:true,durationCoverageValid:true
    };
  });
  return {
    kind:'cofiring_dataparc_period_report',schemaVersion:1,status:'PERIOD_READY',
    runId:'0123456789abcdef0123456789abcdef',
    startLocal:spec.startLocal,endLocal:spec.endLocal,stepUnit:spec.stepUnit,stepValue:spec.stepValue,
    queryEndLocal:p.queryEndLocal,executionSucceeded:true,cleanupVerified:true,processCleanupVerified:true,
    timedOut:false,workerExitCode:0,cleanupErrors:[],completedAtUtc:'2026-09-20T02:01:00Z',summaries
  };
}

function inventory(){
  const p=contract.period(spec,Number.MAX_SAFE_INTEGER);
  const seconds=p.durationMinutes*60;
  const starts={organicDaySilo:3,organicStorageSiloA:8,organicStorageSiloB:4};
  const ends={organicDaySilo:5,organicStorageSiloA:10,organicStorageSiloB:5};
  const samples=contract.inventoryDefinitions.map(def=>({
    key:def.key,label:def.label,tag:def.tag,
    startValue:starts[def.key],startQuality:'Raw, Good',startTime:spec.startLocal+':00+09:00',
    endValue:ends[def.key],endQuality:'Good, Raw',endTime:spec.endLocal+':00+09:00',
    min:Math.min(starts[def.key],ends[def.key]),max:Math.max(starts[def.key],ends[def.key]),
    delta:ends[def.key]-starts[def.key],
    durationGoodSeconds:seconds,durationBadSeconds:0,durationCoverageValid:true,
    boundaryValid:true,dataComplete:true
  }));
  return {
    schemaVersion:1,basis:'dataparc_period_boundary',
    startLocal:spec.startLocal,endLocal:spec.endLocal,
    start:{...starts,total:15},
    end:{...ends,total:20},
    samples
  };
}

test('legacy period result stays compatible when inventory fields are absent',()=>{
  const validated=contract.validatePeriodReport(fuelReport(),spec);
  assert.equal(validated.status,'PERIOD_READY');
  assert.equal(Object.hasOwn(validated,'organicInventory'),false);
  assert.equal(Object.hasOwn(validated.reference,'organicInventory'),false);
});

test('three SDF silo boundary values are validated and exposed in the period reference',()=>{
  const report=fuelReport();
  report.organicInventoryReady=true;
  report.organicInventory=inventory();
  const validated=contract.validatePeriodReport(report,spec);
  assert.equal(validated.organicInventoryReady,true);
  assert.equal(validated.reference.organicInventory.start.total,15);
  assert.equal(validated.reference.organicInventory.end.total,20);
  assert.equal(validated.reference.organicInventory.samples.length,3);
  // 15t at 00:00 + 30t completed receipt - 20t at 11:00 = 25t usage.
  assert.equal(validated.reference.organicInventory.start.total+30-validated.reference.organicInventory.end.total,25);
});

test('inventory contract rejects a total that does not equal Day + Storage A + Storage B',()=>{
  const report=fuelReport();
  report.organicInventoryReady=true;
  report.organicInventory=inventory();
  report.organicInventory.end.total=999;
  assert.throws(()=>contract.validatePeriodReport(report,spec),/총 재고량/);
});

test('source connects 13 DataPARC rows, completed-unloading receipt interval, and allocation-aware UI',()=>{
  const root=path.join(__dirname,'..');
  const worker=fs.readFileSync(path.join(root,'local-tools','ois-agent','cofiring-period-v5','cofiring-period-worker-v5.ps1'),'utf8');
  for(const tag of [
    'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT',
    'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT',
    'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'
  ])assert.match(worker,new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(worker,/Range\('A1:K13'\)/);
  assert.match(worker,/organicInventoryReady/);

  const api=fs.readFileSync(path.join(root,'functions','api','solid-fuel-trouble.js'),'utf8');
  assert.match(api,/receiptStart/);
  assert.match(api,/receiptEnd/);
  assert.match(api,/departure_time/);
  assert.match(api,/completed_local>\? AND completed_local<=\?/);

  const ui=fs.readFileSync(path.join(root,'maintenance','cofiring-period-ui-v5.js'),'utf8');
  assert.match(ui,/data-cfv15-organic-usage/);
  assert.match(ui,/유기성 총/);
  assert.match(ui,/호기별 배분/);
  assert.match(ui,/COFIRING_ORGANIC_START_DATAPARC_SUM_V1/);
  assert.match(ui,/validateOrganicAllocationBeforeSave/);
  assert.match(ui,/receiptStart:p\.startLocal/);
  assert.doesNotMatch(ui,/data-cfv5-manual="unit1:organic"[^]*?data-cfv15-organic-auto-fill/);
});

test('API embeds the same live contract block used by browser validation',()=>{
  const root=path.join(__dirname,'..');
  const shared=fs.readFileSync(path.join(root,'maintenance','cofiring-live-contract.js'),'utf8').replace(/\r\n/g,'\n').split('\n(function(root)')[0];
  const api=fs.readFileSync(path.join(root,'functions','api','ois-data-requests.js'),'utf8').replace(/\r\n/g,'\n');
  assert.ok(api.includes(shared));
});
