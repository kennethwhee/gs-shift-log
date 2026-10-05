'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
// Git for Windows may check out CRLF. Source-section markers use LF; normalize
// only the test's in-memory text, leaving production files and Git settings alone.
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');
const main = read('script.js');
const collector = read('maintenance/morning-meeting-workbook-current-values.js');
const power = read('maintenance/to-night-power.js');
const overrides = read('maintenance/morning-meeting-card-overrides-v1.js');
const DATE = '2026-09-17';
const P = 'efficiencyMorningMeetingAutoDaily';
const fields = {
  generatorEcmsGen1: [P+'GeneratorEcmsGen1', 4060322.4, 'AK7'],
  ismartReception: [P+'IsmartReception', 383, 'AK9'],
  epowerTransmission: [P+'EpowerTransmission', 3547880, 'AK8'],
  solarDailyGeneration: [P+'SolarGeneration', 382.68, 'H18'],
  solarMonthlyCumulative: ['efficiencyMorningMeetingAutoSolarMonthlyCumulative', 6919.48, 'M18'],
  solarYearlyCumulative: ['efficiencyMorningMeetingAutoSolarYearlyCumulative', 98393.13, 'V18'],
  unitOneProduction: ['efficiencyMorningMeetingAutoSteamProductionUnitOne', 6473.593, 'E7'],
  unitTwoProduction: ['efficiencyMorningMeetingAutoSteamProductionUnitTwo', 6480.876, 'E8'],
  steamSalesLowPressure: [P+'SteamSalesLowPressure', 669.04, 'AD11'],
  steamSalesHighPressure: [P+'SteamSalesHighPressure', 141.42, 'AJ11'],
  sludgeTruckCount: [P+'SludgeTruckCount', 4, 'AH13'],
  sludgeTotal: [P+'SludgeTotal', 118.5, 'AH14'],
  organicDaySilo: [P+'OrganicDaySilo', .03, 'AC14'],
  organicStorageSiloA: [P+'OrganicStorageSiloA', .16, 'X14'],
  organicStorageSiloB: [P+'OrganicStorageSiloB', 20.91, 'Z14']
};
function fixture({blank = false} = {}) {
  const element = text => ({textContent: text, dataset: {}, classList: {toggle(){}}, title: ''});
  const elements = Object.fromEntries(Object.values(fields).map(([id, value]) => [id, element(blank ? '-' : String(value))]));
  for (const id of [P+'PowerDate', P+'SludgeDate', 'efficiencyMorningMeetingAutoSteamDate']) elements[id] = element(DATE+' · 기존 저장값');
  elements[P+'PowerStatus'] = element('기존 저장값');
  elements[P+'PowerCard'] = element('');
  elements.efficiencyMorningMeetingWaterPanel = {dataset: {morningMeetingAutoBaseDate: DATE}};
  const sandbox = {
    console: {log(){}, warn(){}, error(){}, info(){}}, Headers, AbortController,
    setTimeout: () => 1, clearTimeout(){}, setInterval: () => 1, clearInterval(){}, queueMicrotask, addEventListener(){},
    getShiftLogAuthHeaders: () => ({Authorization: 'Bearer fixture-only'}),
    document: {readyState: 'loading', getElementById: id => elements[id] || null,
      querySelectorAll: () => [], addEventListener(){}},
    fetch: () => {throw Error('Export must not fetch');}
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(power, ctx);
  vm.runInContext(read('maintenance/morning-meeting-cofiring-final-excel.js'), ctx);
  vm.runInContext(collector, ctx);
  return {ctx, elements, api: ctx.morningMeetingWorkbookCurrentValues};
}
function installWriter(ctx) {
  const start = main.indexOf('function applyMorningMeetingDailyDataValues(');
  const end = main.indexOf('async function createMorningMeetingWorkbook()', start);
  assert.ok(start >= 0 && end > start, 'daily writer source boundaries must exist');
  vm.runInContext(main.slice(start,end), ctx);
  const cells = new Map();
  ctx.setMorningMeetingNumericCellValue = (_doc, address, value) => {cells.set(address,value);return {found:true,written:true};};
  return cells;
}
function checkCells(cells, values) {
  for (const [key, [, , address]] of Object.entries(fields)) {
    const expected = values[key] == null ? null : values[key] / (['AK7','AK8','AK9'].includes(address) ? 1000 : 1);
    assert.equal(cells.get(address), expected, key+' -> '+address);
  }
  for (const address of ['AN7','AN8','AN9','E11','AM11','AE13']) assert.equal(cells.has(address), false, 'formula '+address);
}
function generationFixture(f, duringPermission = () => {}) {
  const cells = installWriter(f.ctx), errors = [], confirms = [];
  const state = {templateFile:{arrayBuffer:async()=>new ArrayBuffer(0)},shiftPart:{reportDate:DATE},analysis:{team:{reportDate:DATE}}};
  Object.assign(f.ctx, {
    getMorningMeetingWorkbookElements: () => ({}), getMorningMeetingWorkbookState: () => state,
    hideMorningMeetingWorkbookError(){}, synchronizeMorningMeetingPreviewText(){},
    getMorningMeetingLimestoneWorkbookValues: () => null,
    MORNING_MEETING_DYNAMIC_TEAM_CONFIG: [{key:'team'}],
    parseMorningMeetingReportDate: value => new Date(value+'T00:00:00Z'),
    addMorningMeetingDateDays: (value,n) => new Date(value.getTime()+n*86400000),
    prepareMorningMeetingOutputFolderPermission: async () => duringPermission(),
    JSZip:{loadAsync:async()=>({file:()=>({async:async()=>''})})},
    findMorningMeetingWorksheetPath:async()=> 'xl/worksheets/sheet1.xml',
    parseMorningMeetingSharedStrings:()=>[], parseMorningMeetingXml:()=>({}),
    captureMorningMeetingWeekendReferenceLayout:()=>null,
    normalizeMorningMeetingTemplateToWeekdayLayout:()=>({normalized:false}),
    applyMorningMeetingIJKDashMerges:()=>({}),
    showCompactConfirm:async value=>{confirms.push(value); return true;},
    applyMorningMeetingCoalNumericValues:()=>{throw Error('TEST_STOP_AFTER_REAL_DAILY_WRITER');},
    showMorningMeetingWorkbookError:message=>errors.push(message), updateMorningMeetingCreateButton(){}
  });
  const start = main.indexOf('async function createMorningMeetingWorkbook()');
  const end = main.indexOf('function bindMorningMeetingTemplateUpload()', start);
  assert.ok(start >= 0 && end > start, 'workbook generator source boundaries must exist');
  vm.runInContext(main.slice(start,end), f.ctx);
  return {cells,errors,confirms,run:()=>f.ctx.createMorningMeetingWorkbook()};
}

test('screenshot values survive a real missing TO response and render; export makes no new request', async () => {
  const f = fixture(); let requests = 0;
  f.ctx.fetch = async () => {requests++;return {ok:true,text:async()=>JSON.stringify({ok:true,targetDate:DATE,shift:'NS',role:'TO',unit:'kWh',canEdit:false,sourceLog:null,item:null,solarCumulative:null})};};
  await f.ctx.toNightPower.refreshMeeting();
  f.ctx.toNightPower.renderMeeting();
  assert.equal(requests,1);
  assert.equal(f.elements[P+'GeneratorEcmsGen1'].textContent, '4060322.4');
  assert.equal(f.elements[P+'PowerStatus'].textContent, '기존 저장값');
  const g = generationFixture(f);
  await g.run();
  assert.deepEqual(g.errors, ['TEST_STOP_AFTER_REAL_DAILY_WRITER']);
  assert.equal(requests,1); assert.equal(g.confirms.length,0);
  checkCells(g.cells,Object.fromEntries(Object.entries(fields).map(([k,[,v]])=>[k,v])));
});

test('actual generator keeps all captured values when DOM changes during template preparation', async () => {
  const f = fixture();
  f.ctx.morningMeetingClosedCofiring = {targetDate:()=>DATE, valuesForWorkbook:()=>{throw Error('must not overlay snapshot');}};
  const g = generationFixture(f,()=>{for(const [id] of Object.values(fields)) f.elements[id].textContent='999';});
  await g.run(); assert.deepEqual(g.errors,['TEST_STOP_AFTER_REAL_DAILY_WRITER']);
  checkCells(g.cells,Object.fromEntries(Object.entries(fields).map(([k,[,v]])=>[k,v])));
});

test('zero values remain saved with no false missing warning or source calls', async () => {
  const f = fixture(); for(const [id] of Object.values(fields)) f.elements[id].textContent='0';
  const g = generationFixture(f); await g.run();
  assert.deepEqual(g.errors,['TEST_STOP_AFTER_REAL_DAILY_WRITER']); assert.equal(g.confirms.length,0);
  checkCells(g.cells,Object.fromEntries(Object.keys(fields).map(k=>[k,0])));
});

test('partial saved card stays intact and only genuinely absent fields are reported', async () => {
  const f = fixture(); f.elements[fields.solarMonthlyCumulative[0]].textContent='-';
  const g = generationFixture(f); await g.run();
  assert.equal(g.confirms.length,1); assert.match(g.confirms[0].message,/태양광 월간 누적/);
  assert.doesNotMatch(g.confirms[0].message,/전력 발전량|태양광 년간 누적|TO/);
  assert.equal(g.cells.get('M18'),null); assert.equal(g.cells.get('AK7'),4060.3224);
});

test('cached saved values fill missing fields without overwriting any displayed number', () => {
  const f = fixture(); f.elements[fields.solarMonthlyCumulative[0]].textContent='-';
  f.ctx.morningMeetingLegacySavedDailyData = {peek:date=>{assert.equal(date,DATE);return {solarCumulative:{month:{total:123.456}},powerGeneration:1};},load:()=>{throw Error('no load');}};
  const bundle=f.api.capture(); assert.equal(bundle.values.solarMonthlyCumulative,123.456);assert.equal(bundle.values.generatorEcmsGen1,4060322.4);assert.equal(bundle.missing.length,0);
});

test('saved manual edits fill missing fields; conflicting cached sources cannot override display', () => {
  const f=fixture(); f.elements[fields.sludgeTruckCount[0]].textContent='-';
  f.ctx.morningMeetingCardOverrides={overrideValues:(_,date)=>{assert.equal(date,DATE);return {sludgeTruckCount:0,generatorEcmsGen1:1};}};
  f.ctx.__morningMeetingSteamOisProbeLastResult={sourceDate:DATE,unitOneProduction:1};
  const b=f.api.capture();assert.equal(b.values.sludgeTruckCount,0);assert.equal(b.values.generatorEcmsGen1,4060322.4);assert.equal(b.values.unitOneProduction,6473.593);
});

test('all three cards are captured before any cached provider is consulted', () => {
  const f=fixture();f.elements[fields.solarMonthlyCumulative[0]].textContent='-';
  f.ctx.toNightPower.valuesForWorkbook=()=>{f.elements[fields.organicDaySilo[0]].textContent='999';return {solarMonthlyCumulative:0};};
  const b=f.api.capture();assert.equal(b.values.organicDaySilo,.03);assert.equal(b.values.solarMonthlyCumulative,0);
  assert.ok(Object.isFrozen(b));assert.ok(Object.isFrozen(b.values));
});

test('different-date or undated display does not enter the snapshot', () => {
  const f=fixture();f.elements[P+'PowerDate'].textContent='2026-09-16'; f.elements[P+'SludgeDate'].textContent='';
  f.ctx.__morningMeetingSteamOisProbeLastResult={sourceDate:'2026-09-16',solarMonthlyCumulative:1};
  const b=f.api.capture();assert.equal(b.targetDate,DATE);assert.equal(b.values.generatorEcmsGen1,undefined);assert.equal(b.values.sludgeTotal,undefined);assert.equal(b.values.unitOneProduction,6473.593);
});

test('active delete suppresses saved data and never consults providers', () => {
  const f=fixture();f.ctx.isMorningMeetingSelectedDateResetActive=date=>date===DATE;
  f.ctx.toNightPower.valuesForWorkbook=()=>{throw Error('must not read');};
  assert.equal(Object.keys(f.api.capture().values).length,0);
  const cells=installWriter(f.ctx);f.ctx.applyMorningMeetingDailyDataValues({}, {generatorEcmsGen1:99}, {targetDate:DATE,useSavedSnapshot:true,suppressClosedValues:true});
  assert.equal(cells.get('AK7'),null);
});

test('changing date during the actual generation aborts before any numeric write', async () => {
  const f=fixture();const g=generationFixture(f,()=>{f.elements.efficiencyMorningMeetingWaterPanel.dataset.morningMeetingAutoBaseDate='2026-09-18';});
  await g.run();assert.equal(g.cells.size,0);assert.match(g.errors[0],/기준일이 바뀌었습니다/);
});

test('deleting selected date during the actual generation does not revive the frozen values', async () => {
  const f=fixture();const g=generationFixture(f,()=>{f.ctx.isMorningMeetingSelectedDateResetActive=()=>true;});
  await g.run();assert.deepEqual(g.errors,['TEST_STOP_AFTER_REAL_DAILY_WRITER']);checkCells(g.cells,{});
});

test('manual-card workbook wrapper passes the frozen bundle through with no reload or reoverlay', async () => {
  const f=fixture();
  const start=overrides.indexOf('  function installWorkbookBridge()');const end=overrides.indexOf('  function handleClick(',start);
  assert.ok(start >= 0 && end > start, 'manual workbook bridge source boundaries must exist');
  Object.assign(f.ctx,{root:f.ctx,workbookWrapped:false,load:()=>{throw Error('must not load');},targetDate:()=>DATE,dateValid:()=>true});
  vm.runInContext(overrides.slice(start,end),f.ctx);f.ctx.installWorkbookBridge();
  const b=await f.ctx.morningMeetingWorkbookCurrentValues.collect();assert.equal(b.values.generatorEcmsGen1,4060322.4);assert.equal(b.savedSnapshot,true);
});

test('partial power and solar-only zero survives an empty TO response',async()=>{
  const f=fixture({blank:true});f.elements[fields.solarMonthlyCumulative[0]].textContent='0';
  f.ctx.fetch=async()=>({ok:true,text:async()=>JSON.stringify({ok:true,targetDate:DATE,shift:'NS',role:'TO',unit:'kWh',canEdit:false,sourceLog:null,item:null,solarCumulative:null})});
  await f.ctx.toNightPower.refreshMeeting();f.ctx.toNightPower.renderMeeting();
  assert.equal(f.elements[fields.solarMonthlyCumulative[0]].textContent,'0');assert.equal(f.elements[P+'PowerStatus'].textContent,'기존 저장값');
});

// V2: co-firing is a separate final overwrite point, including a wrapper around
// the daily writer. Exercise both with unloaded closed providers and saved DOM.
const cofiringFields = {
  unitOneCoal:['Unit1CoalUsage',578.66,'I7'],unitTwoCoal:['Unit2CoalUsage',612.23,'I8'],
  unitOneBio:['Unit1BioUsage',430.02,'N7'],unitTwoBio:['Unit2BioUsage',366.35,'N8'],
  unitOneBioRatio:['Unit1BioRatio',28.06,'X7'],unitTwoBioRatio:['Unit2BioRatio',23.95,'X8'],
  unitOneOrganic:['Unit1OrganicInput',49.73,'Z7'],unitTwoOrganic:['Unit2OrganicInput',49.73,'Z8'],
  unitOneOrganicRatio:['Unit1OrganicRatio',3.50,'AE7'],unitTwoOrganicRatio:['Unit2OrganicRatio',3.50,'AE8'],
  unitOneTotalRatio:['Unit1TotalRatio',31.55,null],unitTwoTotalRatio:['Unit2TotalRatio',27.45,null]
};
function withCofiring(f, {status='idle', saved=null}={}) {
  const prefix='efficiencyMorningMeetingCofiring';
  f.elements[prefix+'Date']={textContent:DATE+' · 기존 저장값',dataset:{}};
  for(const [suffix,value] of Object.values(cofiringFields)) f.elements[prefix+suffix]={textContent:value.toFixed(2),dataset:{}};
  let loads=0;
  f.ctx.morningMeetingClosedCofiring={targetDate:()=>f.elements.efficiencyMorningMeetingWaterPanel.dataset.morningMeetingAutoBaseDate,
    state:()=>({status}),isBlocked:()=>false,peek:()=>saved,
    load:()=>{loads++;throw Error('no closed requery during saved export');},
    valuesForWorkbook:()=>{throw Error('complete organic card must remain fixed');}};
  return {loads:()=>loads,prefix};
}
function installActualCofiringWrapper(f) {
  f.ctx.__morningMeetingCofiringFinalExcelV1Installed=false;
  vm.runInContext(read('maintenance/morning-meeting-cofiring-final-excel.js'), f.ctx);
}
function assertCofiringCells(cells, values = Object.fromEntries(Object.entries(cofiringFields).map(([k,[,v]])=>[k,v]))) {
  for(const [key,[,,address]] of Object.entries(cofiringFields)) if(address) assert.equal(cells.get(address),values[key]??null,key);
  for(const address of ['L7','U7','U8','U9','AC7','AC8','AC9','N9','Z9','X10','I11','L11']) assert.equal(cells.has(address),false,address+' formula preserved');
}
for(const status of ['idle','loading','missing','error']) test('saved organic and co-firing reach actual download writer with no warning or requery: '+status,async()=>{
  const f=fixture(); const c=withCofiring(f,{status}); const g=generationFixture(f); installActualCofiringWrapper(f);
  await g.run();assert.deepEqual(g.errors,['TEST_STOP_AFTER_REAL_DAILY_WRITER']);assert.equal(g.confirms.length,0);assert.equal(c.loads(),0);
  assert.equal(g.cells.get('AH14'),118.5); assert.equal(g.cells.get('AC14'),.03); assertCofiringCells(g.cells);
  assert.equal(g.cells.get('X9'),26.005);assert.equal(g.cells.get('AE9'),3.5);
});
test('co-firing zero is saved and does not count as missing',async()=>{
  const f=fixture();const c=withCofiring(f);for(const [suffix] of Object.values(cofiringFields)) f.elements[c.prefix+suffix].textContent='0';
  const g=generationFixture(f);installActualCofiringWrapper(f);await g.run();assert.equal(g.confirms.length,0);
  assertCofiringCells(g.cells,Object.fromEntries(Object.keys(cofiringFields).map(k=>[k,0])));assert.equal(g.cells.get('X9'),0);assert.equal(g.cells.get('AE9'),0);
});
test('final direct co-firing hook uses the same frozen values after DOM or provider changes',()=>{
  const f=fixture();const c=withCofiring(f);const bundle=f.api.capture();const cells=installWriter(f.ctx);
  for(const [suffix] of Object.values(cofiringFields))f.elements[c.prefix+suffix].textContent='999';
  Object.assign(f.ctx,{worksheetDocument:{},suppressAutomaticWorkbookValues:false,closedValuesTargetDate:DATE,finalWorkbookCurrentValueBundleV9:bundle});
  const start=main.indexOf('const cofiringFinalExcelResult ='),end=main.indexOf('\n\nif (',start);
  assert.ok(start >= 0 && end > start, 'final co-firing hook source boundaries must exist');
  vm.runInContext(main.slice(start,end),f.ctx);assertCofiringCells(cells);assert.equal(c.loads(),0);assert.ok(Object.isFrozen(bundle.cofiringValues));
});
test('current closed values conflicting with a saved card never overwrite that saved card',()=>{
  const f=fixture();withCofiring(f,{status:'complete',saved:{targetDate:DATE,source:'cofiring-closed-history',unitOne:{coal:999,bio:999,bioRatio:99},unitTwo:{coal:999,bio:999},combined:{bioRatio:99}}});
  const b=f.api.capture();assert.equal(b.cofiringValues.unitOneCoal,578.66);assert.equal(b.cofiringValues.unitOneBioRatio,28.06);assert.equal(b.cofiringValues.bioAverageRatio,26.005);
});
test('matching closed data preserves exact precision, adjustment and stored combined ratios',()=>{
  const f=fixture();const saved={targetDate:DATE,source:'cofiring-closed-history',adjustmentApplied:true,
    unitOne:{coal:578.66123,bio:430.02123,bioRatio:28.06123,organic:49.73,organicRatio:3.5,totalRatio:31.55},
    unitTwo:{coal:612.23123,bio:366.35123,bioRatio:23.95123,organic:49.73,organicRatio:3.5,totalRatio:27.45},
    combined:{bioRatio:26.111234,organicRatio:3.499876}};
  withCofiring(f,{status:'complete',saved});const b=f.api.capture();assert.equal(b.cofiringValues.unitOneCoal,578.66123);assert.equal(b.cofiringValues.unitOneBioRatio,28.06123);assert.equal(b.cofiringValues.bioAverageRatio,26.111234);assert.equal(b.cofiringValues.organicAverageRatio,3.499876);assert.equal(b.cofiringValues.adjustmentApplied,true);
});
test('partial saved co-firing preserves known fields without reading a new source',()=>{
  const f=fixture();const c=withCofiring(f);f.elements[c.prefix+'Unit2OrganicRatio'].textContent='-';
  const b=f.api.capture();assert.equal(b.cofiringValues.unitOneCoal,578.66);assert.equal(b.cofiringValues.unitTwoOrganicRatio,undefined);assert.equal(b.cofiringValues.organicAverageRatio,null);assert.equal(c.loads(),0);
});
for(const kind of ['other-date','undated','deleted'])test('co-firing snapshot respects '+kind,()=>{
  const f=fixture();const c=withCofiring(f);
  if(kind==='deleted')f.ctx.isMorningMeetingSelectedDateResetActive=()=>true;
  else f.elements[c.prefix+'Date'].textContent=kind==='other-date'?'2026-09-16':'';
  const b=f.api.capture();const cells=installWriter(f.ctx);
  f.ctx.applyMorningMeetingCofiringExcelValues({}, {targetDate:DATE,useSavedSnapshot:true,savedCofiringValues:b.cofiringValues});
  assertCofiringCells(cells,{});
});
test('reset or date change after capture still suppresses co-firing writes',()=>{
  for(const reset of [true,false]){
    const f=fixture();withCofiring(f);const snapshot=f.api.capture().cofiringValues;const cells=installWriter(f.ctx);
    if(reset)f.ctx.isMorningMeetingSelectedDateResetActive=()=>true;
    else f.elements.efficiencyMorningMeetingWaterPanel.dataset.morningMeetingAutoBaseDate='2026-09-18';
    f.ctx.applyMorningMeetingCofiringExcelValues({}, {targetDate:DATE,useSavedSnapshot:true,savedCofiringValues:snapshot});
    assertCofiringCells(cells,{});
  }
});
test('missing or wrong-date supplied snapshot cannot cause a live source fallback',()=>{
  const f=fixture();withCofiring(f);const cells=installWriter(f.ctx);
  for(const snapshot of [undefined,{savedSnapshot:true,targetDate:'2026-09-16',unitOneCoal:999}]){
    f.ctx.applyMorningMeetingCofiringExcelValues({}, {targetDate:DATE,useSavedSnapshot:true,savedCofiringValues:snapshot});assertCofiringCells(cells,{});
  }
});
test('long-holiday row for the selected date uses its saved snapshot without a closed reload',async()=>{
  const f=fixture();withCofiring(f);const frozen=f.api.capture().cofiringValues;const calls=[];
  f.ctx.morningMeetingClosedCofiring.load=async date=>{calls.push(date);return {targetDate:date,unitOne:{bioRatio:1,organicRatio:2,totalRatio:3},unitTwo:{bioRatio:4,organicRatio:5,totalRatio:9}};};
  class E{constructor(address){this.address=address;this.children=[];}get firstChild(){return this.children[0];}getAttribute(k){return k==='r'?this.address:null;}removeChild(c){this.children.splice(this.children.indexOf(c),1);}removeAttribute(){}setAttribute(){}appendChild(c){this.children.push(c);}}
  const dates=[DATE,'2026-09-18','2026-09-19','2026-09-20'];const targets=dates.map((date,i)=>({date,unitOne:'G'+(i*4+1),unitTwo:'G'+(i*4+2),average:'G'+(i*4+3),total:'G'+(i*4+4)}));
  const cells=new Map(targets.flatMap(t=>[t.unitOne,t.unitTwo,t.average,t.total]).map(a=>[a,new E(a)]));
  const ws={documentElement:{namespaceURI:'urn:test'},getElementsByTagNameNS:(_,name)=>name==='c'?[...cells.values()]:[],createElementNS:()=>new E('')};
  const result=await f.ctx.applyMorningMeetingLongHolidayCofiringExcelValues(ws,{longHoliday:true,cofiringValueCells:targets},{targetDate:DATE,useSavedSnapshot:true,savedCofiringValues:frozen});
  assert.deepEqual(calls,dates.slice(1));assert.equal(cells.get('G1').children[0].children[0].textContent,'28.06 / 3.50');assert.equal(result.missingCount,0);
});
