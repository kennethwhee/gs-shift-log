'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const fixturePath=path.join(__dirname,'morning-meeting-cofiring-bidirectional-v2.test.cjs');
const source=fs.readFileSync(fixturePath,'utf8');
const boundary=source.indexOf("\ntest('morning context uses unadjusted original");
assert.ok(boundary>0);
const fixtureModule={exports:{}};
vm.runInNewContext(source.slice(0,boundary)+'\nmodule.exports={browser,tick};',{
  require:createRequire(fixturePath),module:fixtureModule,__dirname,console,Headers,URL,URLSearchParams,AbortController,setImmediate
},{filename:fixturePath});
const {browser,tick}=fixtureModule.exports;
const q=(b,key)=>b.modal().querySelector('[data-cfv56-'+key+']');
const field=(b,unit,key)=>b.modal().querySelectorAll('[data-cfv56-table-field]').find(e=>e.dataset.cfv56TableUnit===unit&&e.dataset.cfv56TableField===key);

for(const inactive of ['unit1','unit2'])test(`${inactive} unused Bio stays visibly locked through preview, apply and reopen`,async()=>{
  const b=browser(),active=inactive==='unit1'?'unit2':'unit1';
  b.raw.units[inactive].bio.quantity=0;
  b.raw.units[active].bio.quantity=435.410987;
  const baseline=b.adjust.adjustFinal(b.raw,b.settings,b.raw.units.unit1.bio.quantity,b.raw.units.unit2.bio.quantity);
  assert.equal(baseline.ok,true,baseline.message);
  Object.assign(b.raw,baseline.result);delete b.raw.adjustment;
  const original=JSON.stringify(b.raw),originalCoal=b.raw.units[inactive].coal.quantity;
  await b.shared.morning.open();
  const verifyLocks=()=>{
    for(const key of ['dir="1"','dir="2"','transfer','preview-transfer','cancel-transfer'])assert.equal(q(b,key).disabled,true,key);
    assert.match(q(b,'transfer').title,/Bio 미사용/);
    assert.equal(field(b,inactive,'bio').disabled,true);
    assert.equal(field(b,inactive,'bioRatio').disabled,true);
    assert.equal(field(b,active,'bio').disabled,false);
    assert.equal(field(b,inactive,'coal').disabled,false);
    assert.match(b.modal().querySelector('.cfv56-auto-copy-line').textContent,/Bio만 조정/);
    assert.match(b.modal().querySelector('.cfv56-auto-copy-line').textContent,/0t 유지/);
  };
  verifyLocks();
  q(b,'preview-transfer').click();assert.equal(b.posts.length,0);
  q(b,'edit').click();verifyLocks();
  q(b,'cancel-edit').click();
  q(b,'auto').click();
  assert.equal(Number(field(b,inactive,'bio').value),0);
  assert.equal(Number(field(b,inactive,'coal').value),Math.round(originalCoal*100)/100);
  assert.equal(q(b,'apply').disabled,false);
  q(b,'apply').click();await tick();
  const saved=b.posts.at(-1).body.adjustment;
  assert.equal(saved.mode,'max_auto');
  assert.equal(saved[inactive==='unit1'?'finalBioUnit1':'finalBioUnit2'],0);
  assert.equal(saved.fromUnit,null);assert.equal(saved.bioTransferTons,0);
  assert.ok(saved.excludedBioTons>0);
  assert.equal(JSON.stringify(b.raw),original);
  await b.shared.morning.open();verifyLocks();
  assert.equal(Number(field(b,inactive,'bio').value),0);
});

test('both Bio-active units retain manual direction and Bio edit controls',async()=>{
  const b=browser();await b.shared.morning.open();
  for(const key of ['dir="1"','dir="2"','transfer','preview-transfer','cancel-transfer'])assert.equal(q(b,key).disabled,false,key);
  for(const unit of ['unit1','unit2']){
    assert.equal(field(b,unit,'bio').disabled,false);
    assert.equal(field(b,unit,'bioRatio').disabled,false);
  }
  assert.equal(b.modal().querySelector('.cfv56-auto-copy-line').textContent,'호기별 최대 혼소율 기준 · 선택기간 자동 환산');
});
