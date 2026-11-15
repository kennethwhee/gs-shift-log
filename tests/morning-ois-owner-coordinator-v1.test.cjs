'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const parallel = require('../local-tools/ois-agent/morning-ois-parallel-v1.cjs');
const DATE = '2026-11-14';
const all = parallel.TYPES.map((requestType,index) => ({id:`owner-${index}`,requestType,targetDate:DATE}));
function deferred() {let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const tick = () => new Promise(resolve=>setImmediate(resolve));
async function until(check) {for(let n=0;n<100;n++){if(check())return;await tick();}assert.ok(check(),'expected coordinator stage was not reached');}
function fixture(items=all) {
  const counters={ensureOwner:0,forbidden:0};let connected=true;
  const forbidden=()=>{counters.forbidden++;throw new Error('no new page/context, main GET, state write or shared close is permitted');};
  const browser=Object.freeze({isConnected:()=>connected,newContext:forbidden,close:forbidden});
  const context=Object.freeze({newPage:forbidden,close:forbidden,storageState:forbidden,pages:()=>[page]});
  const page=Object.freeze({url:()=> 'http://ois.gspoge.com/jsp/login/main',isClosed:()=>!connected,
    context:()=>context,goto:forbidden,evaluate:forbidden,frames:()=>[]});
  const owner={browser,context,page,primaryPage:page};
  const batch=parallel.createWorkerBatch({items,config:{userId:'fixture-user',password:'fixture-password'},
    ensureOwner:async()=>{counters.ensureOwner++;return owner;},ensureLoggedIn:forbidden});
  return {batch,owner,counters,disconnect:()=>{connected=false;},
    control(item){return batch.configFor(item.id,{userId:'fixture-user',password:'fixture-password'}).morningOwnerApiV1;}};
}

test('one existing owner is shared without creating or changing its browser surfaces or auth state',async()=>{
  const h=fixture();
  const sessions=await Promise.all(all.map(item=>h.batch.ensure(item.id)));
  assert.equal(h.counters.ensureOwner,1);
  for(const [index,session] of sessions.entries()){
    assert.equal(session.primaryPage,h.owner.page);assert.equal(session.page,h.owner.page);
    assert.deepEqual(session.context.pages(),[h.owner.page]);
    const config=h.batch.configFor(all[index].id,{morningParallelReuseOnly:true});
    assert.notEqual(config.morningParallelReuseOnly,true);
    assert.ok(config.morningOwnerApiV1);
  }
  await Promise.all(all.map(item=>h.batch.finish(item.id)));
  assert.equal(h.counters.forbidden,0);
});

test('the three direct reads begin after Water entry and return independently while Water is still calculating',{timeout:3000},async()=>{
  const h=fixture(),started=[],waterEntry=deferred(),waterEnd=deferred(),reads=all.slice(1).map(()=>deferred());
  await Promise.all(all.map(item=>h.batch.ensure(item.id)));
  const waterControl=h.control(all[0]);let waterFinished=false;
  const water=waterControl.runWater(async()=>{
    await waterControl.beforeWaterEntry();started.push('water-entry');await waterEntry.promise;
    waterControl.waterReady();started.push('water-query');await waterEnd.promise;waterFinished=true;return 'water-value';
  });
  const jobs=all.slice(1).map((item,index)=>h.control(item).runDirect(async()=>{
    started.push(item.requestType);await reads[index].promise;return `value-${index}`;
  },async()=>{throw new Error('a successful direct read must not run a UI fallback');}));
  await until(()=>started.includes('water-entry'));
  assert.deepEqual(started,['water-entry']);
  waterEntry.resolve();await until(()=>started.length===5);
  reads[0].resolve();assert.equal(await jobs[0],'value-0');assert.equal(waterFinished,false);
  reads[1].resolve();reads[2].resolve();await Promise.all(jobs);waterEnd.resolve();
  assert.equal(await water,'water-value');assert.equal(h.counters.forbidden,0);
});

test('Water failure before the ready hook releases waiting direct reads without waiting forever',{timeout:3000},async()=>{
  const h=fixture(),c=h.control(all[0]);let directStarted=0;
  const water=c.runWater(async()=>{await c.beforeWaterEntry();throw new Error('existing Water preparation failed');});
  const jobs=all.slice(1).map(item=>h.control(item).runDirect(async()=>{directStarted++;return item.id;},async()=>{throw new Error('unexpected fallback');}));
  await assert.rejects(water,/existing Water preparation failed/);
  assert.equal((await Promise.all(jobs)).length,3);assert.equal(directStarted,3);
});

test('a failed Water request that never enters its collector also settles the initial read gate',{timeout:3000},async()=>{
  const h=fixture();let started=0;
  const jobs=all.slice(1).map(item=>h.control(item).runDirect(async()=>{started++;return item.id;},async()=>null));
  await tick();assert.equal(started,0);await h.batch.finish(all[0].id);
  await Promise.all(jobs);assert.equal(started,3);
});

test('Water retry drains active HTTP attempts but does not deadlock on a failed read awaiting its UI fallback',{timeout:3000},async()=>{
  const h=fixture(),c=h.control(all[0]),retry=deferred(),waterEnd=deferred(),readTwo=deferred(),readThree=deferred();
  const events=[];let active=0;
  const water=c.runWater(async()=>{
    await c.beforeWaterEntry();c.waterReady();events.push('water-ready');await retry.promise;
    events.push('retry-requested');await c.beforeWaterEntry();events.push('retry-entry');
    assert.equal(active,0);c.waterReady();await waterEnd.promise;events.push('water-done');
  });
  const failed=h.control(all[1]).runDirect(async()=>{events.push('failed-direct');throw new Error('direct failed');},async()=>{
    assert.ok(events.includes('water-done'));assert.equal(active,0);events.push('fallback');return 'ui-value';
  });
  const reads=[all[2],all[3]].map((item,index)=>h.control(item).runDirect(async()=>{
    active++;events.push(item.id);try{await [readTwo,readThree][index].promise;return item.id;}finally{active--;}
  },async()=>{throw new Error('unexpected fallback');}));
  await until(()=>active===2&&events.includes('failed-direct'));
  retry.resolve();await until(()=>events.includes('retry-requested'));await tick();
  assert.equal(events.includes('retry-entry'),false);assert.equal(events.includes('fallback'),false);
  readTwo.resolve();readThree.resolve();await Promise.all(reads);await until(()=>events.includes('retry-entry'));
  waterEnd.resolve();await water;assert.equal(await failed,'ui-value');
  assert.deepEqual(events.filter(value=>value==='fallback'),['fallback']);
});

test('three failed direct attempts execute UI fallbacks once each in one serial UI lane',{timeout:3000},async()=>{
  const h=fixture(all.slice(1)),release=all.slice(1).map(()=>deferred());
  let directCalls=0,active=0,maxActive=0;const fallbackStarts=[];
  const jobs=all.slice(1).map((item,index)=>h.control(item).runDirect(async()=>{directCalls++;throw new Error('direct failure');},async()=>{
    active++;maxActive=Math.max(maxActive,active);fallbackStarts.push(index);
    try{await release[index].promise;return `fallback-${index}`;}finally{active--;}
  }));
  await until(()=>fallbackStarts.length===1);assert.equal(directCalls,3);
  release[fallbackStarts[0]].resolve();await until(()=>fallbackStarts.length===2);
  release[fallbackStarts[1]].resolve();await until(()=>fallbackStarts.length===3);
  release[fallbackStarts[2]].resolve();
  assert.deepEqual(await Promise.all(jobs),['fallback-0','fallback-1','fallback-2']);assert.equal(maxActive,1);
});

test('late Water preparation waits for existing direct reads, then permits a new source while Water remains active',{timeout:3000},async()=>{
  const h=fixture(all.slice(1)),directEnd=deferred(),waterEntry=deferred(),waterEnd=deferred();let active=0,entered=false,newRead=false;
  const initial=all.slice(1).map(item=>h.control(item).runDirect(async()=>{active++;try{await directEnd.promise;return item.id;}finally{active--;}},async()=>null));
  await until(()=>active===3);h.batch.add([all[0]]);const c=h.control(all[0]);
  const water=c.runWater(async()=>{await c.beforeWaterEntry();entered=true;await waterEntry.promise;c.waterReady();await waterEnd.promise;});
  await tick();assert.equal(entered,false);directEnd.resolve();await Promise.all(initial);await until(()=>entered);
  await h.batch.finish(all[1].id);const successor={...all[1],id:'late-limestone'};h.batch.add([successor]);
  const next=h.control(successor).runDirect(async()=>{newRead=true;return 'late-value';},async()=>null);
  await tick();assert.equal(newRead,false);waterEntry.resolve();assert.equal(await next,'late-value');waterEnd.resolve();await water;
});

test('a direct source added during a UI fallback waits until that fallback releases the UI',{timeout:3000},async()=>{
  const h=fixture([all[1]]),release=deferred();let fallback=false,read=false;
  const first=h.control(all[1]).runDirect(async()=>{throw new Error('direct failed');},async()=>{fallback=true;await release.promise;return 'ui';});
  await until(()=>fallback);h.batch.add([all[2]]);
  const second=h.control(all[2]).runDirect(async()=>{read=true;return 'direct';},async()=>null);
  await tick();assert.equal(read,false);release.resolve();assert.equal(await first,'ui');assert.equal(await second,'direct');
});

test('finishing a request while it waits for Water prevents its direct callback from starting',{timeout:3000},async()=>{
  const h=fixture();let started=false;
  const pending=h.control(all[1]).runDirect(async()=>{started=true;return 'unexpected';},async()=>null);
  const rejection=assert.rejects(pending);
  await h.batch.finish(all[1].id);await h.batch.finish(all[0].id);await rejection;
  assert.equal(started,false);assert.throws(()=>h.batch.configFor('unknown',{}));
});

test('a disconnected shared owner is not restarted underneath active sibling work',async()=>{
  const h=fixture();await h.batch.ensure(all[0].id);h.disconnect();
  await assert.rejects(h.batch.ensure(all[1].id));assert.equal(h.counters.ensureOwner,1);assert.equal(h.counters.forbidden,0);
});

test('finishing a still-running Water request does not expose its page to new reads until its collector settles',{timeout:3000},async()=>{
  const h=fixture(),c=h.control(all[0]),waterEnd=deferred();let waterActive=false,readStarted=false;
  const water=c.runWater(async()=>{
    await c.beforeWaterEntry();c.waterReady();waterActive=true;await waterEnd.promise;waterActive=false;
  });
  await until(()=>waterActive);await h.batch.finish(all[0].id);
  const direct=h.control(all[1]).runDirect(async()=>{readStarted=true;assert.equal(waterActive,false);return 'safe';},async()=>null);
  await tick();assert.equal(readStarted,false);waterEnd.resolve();await water;
  assert.equal(await direct,'safe');
});
