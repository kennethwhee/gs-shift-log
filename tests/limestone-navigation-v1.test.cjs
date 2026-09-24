'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {open}=require('../local-tools/ois-agent/limestone-navigation-v1.cjs');
function frame(name,labels=[],options={}) {
  return {name,ready:false,...options,
    getByText(text,{exact}) { assert.equal(exact,true);return {count:async()=>labels.includes(text)?1:0,nth:()=>({isVisible:async()=>!options.hidden})}; }
  };
}
async function clocked(callback) {
  const RealDate=global.Date;let now=0;
  global.Date=class extends RealDate {static now(){return now;}};
  try {await callback(ms=>{now+=ms;});} finally {global.Date=RealDate;}
}
test('operations, parent and leaf menus may appear in separate replacement frames',async()=>{
  await clocked(async advance=>{
    const top=frame('top',['운영정보']),parent=frame('parent',['LOG SHEET']),leaf=frame('leaf',['LOG SHEET 조회']),view=frame('view',[],{ready:true});
    let frames=[top],pending=null;
    const page={frames:()=>frames,waitForTimeout:async ms=>{advance(ms);if(pending){frames=pending;pending=null;}}};const clicks=[];
    const actual=await open(page,{timeoutMs:1000,isLogSheetFrame:async f=>f.ready,
      clickMenu:async(f,labels)=>{clicks.push(f.name);frames=[];pending=f===top?[parent]:f===parent?[leaf]:[view];return true;}});
    assert.equal(actual,view);assert.deepEqual(clicks,['top','parent','leaf']);
  });
});
test('already open child menu takes priority over a persistent operations heading',async()=>{
  const top=frame('top',['운영정보']),leaf=frame('leaf',['LOG SHEET조회']),view=frame('view',[],{ready:true});let frames=[top,leaf];const clicks=[];
  const page={frames:()=>frames,waitForTimeout:async()=>{}};
  assert.equal(await open(page,{isLogSheetFrame:async f=>f.ready,clickMenu:async f=>{clicks.push(f.name);frames=[view];return true;}}),view);
  assert.deepEqual(clicks,['leaf']);
});
test('ready LOG SHEET form is reused without any menu click',async()=>{
  const view=frame('view',[],{ready:true});let clicks=0;
  assert.equal(await open({frames:()=>[view]},{isLogSheetFrame:async f=>f.ready,clickMenu:async()=>{clicks++;}}),view);assert.equal(clicks,0);
});
test('a detached menu during click is rediscovered and retried only once',async()=>{
  await clocked(async advance=>{
    const a=frame('a',['LOG SHEET조회']),b=frame('b',['LOG SHEET조회']),view=frame('view',[],{ready:true});let frames=[a],clicks=0;
    const page={frames:()=>frames,waitForTimeout:async ms=>advance(ms)};
    const opened=await open(page,{timeoutMs:500,isLogSheetFrame:async f=>f.ready,clickMenu:async()=>{clicks++;if(clicks===1){frames=[b];throw Error('Frame was detached');}frames=[view];return true;}});
    assert.equal(opened,view);assert.equal(clicks,2);
  });
});
test('slow transition waits for child instead of toggling the parent repeatedly',async()=>{
  await clocked(async advance=>{
    const top=frame('top',['운영정보']),view=frame('view',[],{ready:true});let frames=[top],clicks=0,elapsed=0;
    const page={frames:()=>frames,waitForTimeout:async ms=>{advance(ms);elapsed+=ms;if(elapsed>=750)frames=[view];}};
    assert.equal(await open(page,{timeoutMs:1000,isLogSheetFrame:async f=>f.ready,clickMenu:async()=>{clicks++;return true;}}),view);
    assert.equal(clicks,1);
  });
});
test('invisible or similarly named content is never clicked; missing menus fail after bounded retry',async()=>{
  await clocked(async advance=>{
    const hidden=frame('hidden',['LOG SHEET조회'],{hidden:true}),wrong=frame('wrong',['이전 LOG SHEET조회 기록']);let clicks=0,waits=0;
    const page={frames:()=>[hidden,wrong],waitForTimeout:async ms=>{advance(ms);waits++;}};
    await assert.rejects(open(page,{timeoutMs:500,isLogSheetFrame:async()=>false,clickMenu:async()=>{clicks++;}}),/2회/);
    assert.equal(clicks,0);assert.ok(waits<=6);
  });
});
test('browser closure is passed to existing session recovery without another click',async()=>{
  let clicks=0;
  await assert.rejects(open({isClosed:()=>true},{isLogSheetFrame:async()=>false,clickMenu:async()=>{clicks++;}}),/closed/);assert.equal(clicks,0);
});
