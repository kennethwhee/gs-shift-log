'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');
const {normalizeItem} = require('../maintenance/morning-meeting-closed-cofiring.js');
function harness(file, names) {
  const source = read('tests/' + file);
  const sandbox = {require, __dirname, console, process, structuredClone,
    Headers, AbortController, URLSearchParams, URL, setImmediate, setTimeout, clearTimeout};
  vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nglobalThis.fixtureExports={' + names + '};', sandbox);
  return sandbox.fixtureExports;
}
const api = harness('morning-meeting-cofiring-effective-sync-v1.test.cjs', 'browser,fixture');
const xml = harness('morning-meeting-final-history-alignment-v10.test.cjs', 'Document,addInlineCell,addMerge,findCell,textOf,NS');
const next = date => new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const close = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-9, `${actual} != ${expected}`);
const SCREENSHOTS = {
  '2026-10-16': [[24.60,4.26],[21.12,4.32]],
  '2026-10-17': [[24.55,5.88],[20.90,6.09]],
  '2026-10-18': [[24.65,3.73],[19.67,3.80]]
};
// Synthetic heat/fuel inputs reproduce displayed precision. They are not live
// operating records; exact combined ratios must come from weighted total heat.
function result(date, pairs, applied) {
  const units = Object.fromEntries(pairs.map(([bio,organic], index) => {
    const total = 1000 + index*200;
    const heats = {coal:total*(100-bio-organic)/100,bio:total*bio/100,
      organic:total*organic/100,manure:0,total};
    return ['unit'+(index+1), {coal:{quantity:heats.coal},bio:{quantity:heats.bio},
      organic:{quantity:heats.organic},manure:{quantity:0},heats,
      fuelRatios:{bio,organicGroup:organic,total:bio+organic}}];
  }));
  const heats = Object.fromEntries(['coal','bio','organic','manure','total'].map(key=>[key,units.unit1.heats[key]+units.unit2.heats[key]]));
  const fuelRatios = {bio:heats.bio/heats.total*100,organicGroup:heats.organic/heats.total*100,
    total:(heats.bio+heats.organic)/heats.total*100};
  return {period:{startLocal:date+'T00:00',endLocal:next(date)+'T00:01'},units,combined:{heats,fuelRatios},
    ...(applied?{adjustment:{applied:true}}:{})};
}
function itemFor(date, mode='applied') {
  const item = api.fixture(date,'applied');
  const adjusted = result(date,SCREENSHOTS[date]||SCREENSHOTS['2026-10-18'],true);
  const raw = result(date,[[28.122144286895,3.73],[16.133521744318,3.80]],false);
  item.snapshot.result = mode==='cleared'?adjusted:raw;
  if(mode==='cleared') item.snapshot.originalResult=raw;
  item.effectiveResult = mode==='applied'?adjusted:raw;
  item.adjustmentApplied = mode==='applied';
  item.adjustmentSource = mode==='cleared'?'period_adjustment_cleared':mode==='applied'?'period_adjustment':'closed_snapshot_original';
  return item;
}

for(const [date,pairs] of Object.entries(SCREENSHOTS)) test(date+' effective Bio/organic/total and quantities stay in one adjusted result',()=>{
  const input=itemFor(date), before=JSON.stringify(input), saved=normalizeItem(input,date);
  for(const [index,pair] of pairs.entries()) {
    const unit=saved[index?'unitTwo':'unitOne'],effective=input.effectiveResult.units['unit'+(index+1)];
    close(unit.bioRatio,pair[0]);close(unit.organicRatio,pair[1]);close(unit.totalRatio,pair[0]+pair[1]);
    assert.equal(unit.bio,effective.bio.quantity);assert.equal(unit.coal,effective.coal.quantity);
  }
  close(saved.combined.bioRatio,input.effectiveResult.combined.fuelRatios.bio);
  assert.notEqual(saved.combined.bioRatio,input.snapshot.result.combined.fuelRatios.bio);
  assert.equal(JSON.stringify(input),before);
});
test('missing effective Bio ratio stays missing instead of borrowing original snapshot',()=>{
  const item=itemFor('2026-10-18');delete item.effectiveResult.units.unit1.heats;
  delete item.effectiveResult.units.unit1.fuelRatios.bio;
  assert.equal(normalizeItem(item,'2026-10-18').unitOne.bioRatio,null);
});
test('CLEAR restores original ratios and quantities together, even when closed snapshot was adjusted',()=>{
  const item=itemFor('2026-10-18','cleared'), saved=normalizeItem(item,'2026-10-18');
  assert.equal(saved.adjustmentApplied,false);
  assert.equal(saved.unitOne.bio,item.effectiveResult.units.unit1.bio.quantity);
  close(saved.unitOne.bioRatio,item.effectiveResult.units.unit1.fuelRatios.bio);
  close(saved.combined.totalRatio,item.effectiveResult.combined.fuelRatios.total);
});
test('download refresh bypasses a complete raw cache and replaces whole stale visible snapshot without Agent/receipt calls',async()=>{
  const date='2026-10-18', b=api.browser({selected:date,installCard:false});
  b.rows.set(date,itemFor(date,'original'));await b.provider.load(date);
  b.rows.set(date,itemFor(date));const before=b.requests.length;
  const saved=await b.root.refreshMorningMeetingCofiringExcelValues({targetDate:date,savedSnapshot:true,unitOneBioRatio:99,unitOneBio:999});
  assert.equal(b.requests.length,before+1);
  assert.match(b.requests.at(-1).url,/^\/api\/cofiring-closed-history\?targetDate=2026-10-18$/);
  assert.equal(b.requests.at(-1).options.method,'GET');
  assert.equal(saved.unitOneBioRatio,24.65);assert.equal(saved.unitTwoBioRatio,19.67);
  assert.equal(saved.unitOneBio,itemFor(date).effectiveResult.units.unit1.bio.quantity);
  assert.equal(saved.adjustmentApplied,true);assert.ok(Object.isFrozen(saved));
  const cells=new Map();b.root.setMorningMeetingNumericCellValue=(_,address,value)=>{cells.set(address,value);return {found:true,written:true};};
  b.root.applyMorningMeetingCofiringExcelValues({}, {targetDate:date,useSavedSnapshot:true,savedCofiringValues:saved});
  assert.equal(cells.get('X7'),24.65);assert.equal(cells.get('X8'),19.67);assert.equal(cells.get('I7'),saved.unitOneCoal);
  close(cells.get('X9'),itemFor(date).effectiveResult.combined.fuelRatios.bio);
});
test('true missing closing blanks the main bundle and cannot restore stale displayed ratios',async()=>{
  const date='2026-10-18',b=api.browser({selected:date,installCard:false});b.rows.set(date,null);
  const saved=await b.root.refreshMorningMeetingCofiringExcelValues({targetDate:date,savedSnapshot:true,unitOneBioRatio:99});
  assert.equal(saved.unitOneBioRatio,undefined);assert.equal(saved.targetDate,date);
});
test('a failed stored GET stops main export with a retry message',async()=>{
  const date='2026-10-18',b=api.browser({selected:date,installCard:false});
  b.root.fetch=async()=>{throw Error('offline');};
  await assert.rejects(b.root.refreshMorningMeetingCofiringExcelValues({targetDate:date}),/2026-10-18.*다시 생성/);
});
test('selection change during the saved GET aborts instead of writing another date',async()=>{
  const date='2026-10-18',b=api.browser({selected:date,installCard:false});
  const fetch=b.root.fetch;b.root.fetch=async(...args)=>{const response=await fetch(...args);b.select('2026-10-17');return response;};
  await assert.rejects(b.root.refreshMorningMeetingCofiringExcelValues({targetDate:date}),/기준일이 바뀌었습니다/);
});
test('active reset during a saved GET suppresses data without restoring the old card',async()=>{
  const date='2026-10-18',b=api.browser({selected:date,installCard:false});
  const fetch=b.root.fetch;b.root.fetch=async(...args)=>{const response=await fetch(...args);b.block(true);return response;};
  const saved=await b.root.refreshMorningMeetingCofiringExcelValues({targetDate:date,unitOneBioRatio:99});
  assert.equal(saved.unitOneBioRatio,undefined);
});
test('session changes during a saved GET are an error, not a missing record',async()=>{
  const date='2026-10-18',b=api.browser({selected:date,installCard:false});
  const fetch=b.root.fetch;b.root.fetch=async(...args)=>{const response=await fetch(...args);b.token('changed-token');return response;};
  await assert.rejects(b.provider.loadSavedForWorkbook(date,{force:true}),/로그인 상태가 바뀌었습니다/);
});
test('APPLY/CLEAR invalidation during export requests a retry rather than exporting blank data',async()=>{
  const date='2026-10-18',b=api.browser({selected:'2026-10-19',installCard:false});b.start();
  const fetch=b.root.fetch;b.root.fetch=async(...args)=>{const response=await fetch(...args);b.send(date);return response;};
  await assert.rejects(b.provider.loadSavedForWorkbook(date,{force:true}),/혼소 조정값이 변경되었습니다/);
});
test('weekend Oct17 and Oct18 headers receive adjusted Oct16 and Oct17; main stays Oct18',async()=>{
  const b=api.browser({selected:'2026-10-18',installCard:false});
  for(const date of Object.keys(SCREENSHOTS)) b.rows.set(date,itemFor(date));
  vm.runInNewContext(read('maintenance/morning-meeting-holiday-cofiring-saved-v1.js'),{window:b.root,console});
  const doc=new xml.Document();for(const name of ['sheetData','mergeCells'])doc.documentElement.appendChild(doc.createElementNS(xml.NS,name));
  xml.addInlineCell(doc,24,'AG','Bio / 유기성 고형연료 혼소율(%)');xml.addMerge(doc,'AG24:AO24');
  xml.addInlineCell(doc,25,'AJ','10월 17일');xml.addInlineCell(doc,25,'AM','10월 18일');
  for(const [i,label] of ['#1 BLR','#2 BLR','Average','Total'].entries()) {
    xml.addInlineCell(doc,26+i,'AG',label);
    for(const col of ['AJ','AM'])xml.addInlineCell(doc,26+i,col,'STALE');
  }
  const result=await b.root.morningMeetingHolidayCofiringSavedV1.apply(doc,[],{enabled:true,referenceDate:'2026-10-18'});
  assert.deepEqual(Array.from(result.dateMappings,x=>[x.reportDate,x.calculationDate]),[['2026-10-17','2026-10-16'],['2026-10-18','2026-10-17']]);
  assert.equal(xml.textOf(xml.findCell(doc,'AJ26')),'24.60 / 4.26');
  assert.equal(xml.textOf(xml.findCell(doc,'AJ27')),'21.12 / 4.32');
  assert.equal(xml.textOf(xml.findCell(doc,'AM26')),'24.55 / 5.88');
  assert.equal(xml.textOf(xml.findCell(doc,'AM27')),'20.90 / 6.09');
  assert.equal(xml.textOf(xml.findCell(doc,'AJ29')),itemFor('2026-10-16').effectiveResult.combined.fuelRatios.total.toFixed(2));
  const main=await b.root.refreshMorningMeetingCofiringExcelValues({targetDate:'2026-10-18'});
  assert.equal(main.unitOneBioRatio,24.65);assert.equal(main.unitTwoBioRatio,19.67);
  assert.ok(b.requests.every(r=>r.url.startsWith('/api/cofiring-closed-history?')&&r.options.method==='GET'));
});
