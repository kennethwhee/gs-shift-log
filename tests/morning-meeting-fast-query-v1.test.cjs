'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, start);
  return source.slice(first, last);
}
const itemCode = section('  async function runBulkLookupItem(', '  async function runMorningMeetingOisSerialLaneV23(');
const queueCode = section('  async function runMorningMeetingOisSerialLaneV23(', '  function runBulkLookup(');
const bulkCode = section('  function runBulkLookup(', '  const retryItems = [');
const itemsCode = section('  function createBulkLookupItems()', '  async function runBulkLookupItem(');
const guardCode = section('  function canStartOperationsQuery(', '  const BULK_STATUS_LOADING_CLASSES = [');
const limestoneCode = section('  async function loadLimestoneForBulk(', '  async function loadWeatherForBulk(');
const keys = ['water', 'limestone', 'gear-pinion', 'silo-level'];
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
const flush = async () => { for (let index=0;index<12;index++) await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));
function environment(options={}) {
  const locks=[], calls=[], complete=new Set(), loading=new Set();
  const context=vm.createContext({
    console:{info(){},warn(){},log(){}},
    window:{navigator:{userAgent:'Desktop',platform:'Win32'},matchMedia:()=>({matches:false})},
    isBulkItemCurrentDate:item=>options.currentDateMatches?.(item) ?? true,
    hasBulkCompleteStatus:ids=>complete.has(ids?.[0]),hasBulkLoadingStatus:ids=>loading.has(ids?.[0]),
    hasBulkSourceCompleteStatus:item=>options.sourceComplete?.(item) ?? complete.has(item.key),
    waitForExistingBulkTask:item=>options.waitExisting?.(item) ?? Promise.resolve(),
    keepBulkButtonLocked:()=>locks.push('keep'),setBulkControlsLocked:value=>locks.push(value),
    beginBulkButtonLock:()=>locks.push('begin'),endBulkButtonLock:()=>locks.push('end'),scheduleSync(){},
    createBulkLookupItems:settings=>{calls.push(settings);return options.items||[];},
    getBulkCurrentBaseDate:()=>options.date||'2026-11-03',getShiftLogSessionToken:()=> 'test-session'
  });
  vm.runInContext('let bulkLookupActive=false,bulkLookupPromise=null;\n'+itemCode+queueCode+bulkCode+guardCode,context);
  return {context,locks,calls,complete,loading};
}
function lookupItem(key, load, extra={}) {
  return {key,label:key,statusIds:[key],load,...extra};
}

test('all four ordinary source reads/request creations start before any one completes',async()=>{
  const starts=[], pending=keys.map(()=>deferred());
  const items=keys.map((key,index)=>lookupItem(key,()=>{starts.push(key);return pending[index].promise;}));
  const {context}=environment();
  const result=context.runMorningMeetingOisSerialLaneV23(items,{});
  assert.deepEqual(starts,keys);
  pending[3].resolve('silo');pending[1].resolve('lime');pending[2].resolve('gear');await flush();
  let finished=false;result.then(()=>finished=true);await flush();assert.equal(finished,false);
  pending[0].resolve('water');
  assert.deepEqual(plain(await result).map(item=>item.value.key),keys);
  assert.deepEqual(plain(await result).map(item=>item.value.result),['water','lime','gear','silo']);
});

test('one source failure stays isolated and original source ordering includes SMP/weather',async()=>{
  const pending=deferred();
  const items=[lookupItem('water',()=>Promise.reject(new Error('water failed'))),lookupItem('smp-price',()=>Promise.resolve('SMP')),
    lookupItem('limestone',()=>pending.promise),lookupItem('gear-pinion',()=>Promise.resolve('gear')),
    lookupItem('weather',()=>Promise.resolve('weather')),lookupItem('silo-level',()=>Promise.resolve('silo'))];
  const {context}=environment();const result=context.runMorningMeetingOisSerialLaneV23(items,{});
  pending.resolve('lime');const outcomes=await result;
  assert.equal(outcomes[0].status,'rejected');assert.match(outcomes[0].reason.message,/water failed/);
  assert.deepEqual(plain(outcomes.slice(1)).map(item=>item.value.key),['smp-price','limestone','gear-pinion','weather','silo-level']);
  assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,5);
});

test('ordinary completed sources skip and in-flight sources are joined without blocking the other sources',async()=>{
  const gate=deferred(), started=[];
  const env=environment({waitExisting:()=>gate.promise});
  env.loading.add('water');env.complete.add('limestone');
  const items=keys.map(key=>lookupItem(key,()=>{started.push(key);return Promise.resolve(key);}));
  const result=env.context.runMorningMeetingOisSerialLaneV23(items,{});
  assert.deepEqual(started,['gear-pinion','silo-level']);
  env.loading.delete('water');env.complete.add('water');gate.resolve();
  const outcomes=plain(await result);
  assert.equal(outcomes[0].value.status,'waited-existing');assert.equal(outcomes[1].value.status,'skipped-complete');
  assert.deepEqual(started,['gear-pinion','silo-level']);
});

test('forced null/undefined cannot become success from old complete DOM; actual fresh result is accepted',async()=>{
  let sourceStatusReads=0;
  const env=environment({sourceComplete:()=>{sourceStatusReads++;return true;}});env.complete.add('water');
  for(const empty of [null,undefined]) {
    await assert.rejects(env.context.runBulkLookupItem(lookupItem('water',()=>Promise.resolve(empty),{forceRefresh:true}),{}),/조회 결과가 비어/);
  }
  assert.equal(sourceStatusReads,0);
  const fresh={targetDate:'2026-11-03',requestId:'new-request'};
  const result=await env.context.runBulkLookupItem(lookupItem('water',()=>Promise.resolve(fresh),{forceRefresh:true}),{});
  assert.equal(result.result,fresh);
  assert.equal((await env.context.runBulkLookupItem(lookupItem('water',()=>Promise.resolve(false),{forceRefresh:true}),{})).result,false);
});

test('ordinary legacy void loaders can retain verified same-date complete source compatibility',async()=>{
  const env=environment({sourceComplete:()=>true});
  const result=await env.context.runBulkLookupItem(lookupItem('water',()=>Promise.resolve(undefined)),{});
  assert.equal(result.result,true);
});

test('limestone wrapper cannot certify a fresh failure from old complete DOM while ordinary void compatibility remains',async()=>{
  const env=environment();
  let savedReads=0, returns;
  env.context.document={getElementById:id=>id==='limestoneUsageDate'
    ? {value:'2026-11-03'} : {dataset:{limestoneUsageStatus:'complete'}}};
  env.context.window.loadSavedLimestoneUsageRecords=async()=>{savedReads++;return false;};
  env.context.window.loadLimestoneOisStock=async()=>returns;
  vm.runInContext(limestoneCode,env.context);
  for(const empty of [null,undefined]) {
    returns=empty;
    assert.equal(await env.context.loadLimestoneForBulk({forceRefresh:true}),empty);
    await assert.rejects(env.context.runBulkLookupItem(lookupItem('limestone',
      ()=>env.context.loadLimestoneForBulk({forceRefresh:true}),{forceRefresh:true}),{}),/조회 결과가 비어/);
  }
  assert.equal(savedReads,0);
  const fresh={id:'new-limestone-request',targetDate:'2026-11-03',status:'complete'};
  returns=fresh;
  assert.equal(await env.context.loadLimestoneForBulk({forceRefresh:true}),fresh);
  returns=undefined;
  assert.equal(await env.context.loadLimestoneForBulk({forceRefresh:false}),true);
  assert.equal(savedReads,1);
});

test('bulk promise is single-flight and every control stays locked until the slowest parallel source settles',async()=>{
  const slow=deferred(), starts=[];
  const items=[...keys.map(key=>lookupItem(key,()=>{starts.push(key);return Promise.resolve(key);})),
    lookupItem('smp-price',()=>slow.promise,{alwaysLoad:true})];
  const env=environment({items});
  const first=env.context.runBulkLookup({}, {forceRefresh:true});
  const second=env.context.runBulkLookup({}, {forceRefresh:true});
  assert.equal(first,second);assert.equal(env.context.window.__efficiencyMorningMeetingBulkLookupPromise,first);
  assert.equal(env.calls.length,1);assert.deepEqual(starts,keys);
  await flush();assert.equal(env.locks.includes(false),false);assert.equal(env.locks.includes('end'),false);
  slow.resolve('SMP');await first;
  assert.equal(env.locks.filter(value=>value===false).length,1);assert.equal(env.locks.filter(value=>value==='end').length,1);
  assert.equal(env.context.window.__efficiencyMorningMeetingBulkLookupPromise,undefined);
});

test('manual/desktop/session/date query guards and wrong-date cached-source guards remain in effect',async()=>{
  const env=environment({currentDateMatches:()=>false});
  assert.equal(env.context.canStartOperationsQuery({userInitiated:true,targetDate:'2026-11-03'}),true);
  assert.equal(env.context.canStartOperationsQuery({userInitiated:false,targetDate:'2026-11-03'}),false);
  assert.equal(env.context.canStartOperationsQuery({userInitiated:true,targetDate:'2026-11-02'}),false);
  env.context.getShiftLogSessionToken=()=>'';assert.equal(env.context.canStartOperationsQuery({userInitiated:true}),false);
  env.context.getShiftLogSessionToken=()=> 'test';env.context.window.matchMedia=()=>({matches:true});
  assert.equal(env.context.canStartOperationsQuery({userInitiated:true}),false);
  env.complete.add('gear-pinion');let loads=0;
  const result=await env.context.runBulkLookupItem(lookupItem('gear-pinion',()=>{loads++;return Promise.resolve('fresh');},{requireCurrentDate:true}),{});
  assert.equal(loads,1);assert.equal(result.result,'fresh');
});

test('actual source item construction passes force flags and preserves cache-first for ordinary query',async()=>{
  const env=environment(), received=[];
  env.context.window.loadEfficiencyMorningMeetingWaterTreatment=options=>received.push(['water',options]);
  env.context.window.loadEfficiencyMorningMeetingGearPinion=options=>received.push(['gear-pinion',options]);
  env.context.window.loadEfficiencyMorningMeetingSiloLevel=options=>received.push(['silo-level',options]);
  env.context.window.loadEfficiencyMorningMeetingSmpPrice=options=>received.push(['smp-price',options]);
  env.context.loadLimestoneForBulk=options=>received.push(['limestone',options]);
  env.context.loadWeatherForBulk=options=>received.push(['weather',options]);
  vm.runInContext(itemsCode,env.context);
  const forced=env.context.createBulkLookupItems({forceRefresh:true});forced.forEach(item=>item.load());
  assert.deepEqual(received.map(item=>item[0]),[...keys,'smp-price','weather']);
  assert.ok(received.every(([,options])=>options.forceRefresh===true));
  assert.equal(received.find(([key])=>key==='smp-price')[1].cacheFirst,false);
  received.length=0;
  env.context.createBulkLookupItems({forceRefresh:false}).forEach(item=>item.load());
  assert.ok(received.every(([,options])=>options.forceRefresh===false));
  assert.equal(received.find(([key])=>key==='smp-price')[1].cacheFirst,true);
});

test('independent saved-source waits overlap on a deterministic clock instead of adding four waits',async()=>{
  const env=environment(), scheduled=[];
  let now=0;
  env.context.Date={now:()=>now};
  const wait=milliseconds=>new Promise(resolve=>scheduled.push({at:now+milliseconds,resolve}));
  const items=keys.map(key=>lookupItem(key,async()=>{await wait(100);return key;}));
  let settled=false;
  const result=env.context.runMorningMeetingOisSerialLaneV23(items,{}).then(value=>{settled=true;return value;});
  assert.equal(scheduled.length,4);
  while(scheduled.length) {
    scheduled.sort((a,b)=>a.at-b.at);const next=scheduled.shift();now=next.at;next.resolve();await flush();
  }
  await result;assert.equal(settled,true);assert.equal(now,100);
});
