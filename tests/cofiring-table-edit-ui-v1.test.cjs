'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const fixturePath=path.join(__dirname,'morning-meeting-cofiring-bidirectional-v2.test.cjs');
const fixtureSource=fs.readFileSync(fixturePath,'utf8');
const boundary=fixtureSource.indexOf("\ntest('morning context uses unadjusted original");
assert.ok(boundary>0,'The reviewed browser fixture must precede its registered tests');
const fixtureModule={exports:{}};
vm.runInNewContext(fixtureSource.slice(0,boundary)+'\nmodule.exports={browser,tick,Event};',{
  require:createRequire(fixturePath),module:fixtureModule,__dirname,console,Headers,URL,URLSearchParams,AbortController,setImmediate
},{filename:fixturePath});
const {browser,tick,Event}=fixtureModule.exports;
const normal=value=>JSON.parse(JSON.stringify(value));
const near=(actual,expected,tolerance=0.000001)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=tolerance,`${actual} should equal ${expected}`);
const select=(b,key)=>b.modal().querySelector('[data-cfv56-'+key+']');
const fields=b=>b.modal().querySelectorAll('[data-cfv56-table-field]');
const field=(b,unit,key)=>fields(b).find(input=>input.dataset.cfv56TableUnit===unit&&input.dataset.cfv56TableField===key);
function type(b,unit,key,value){const input=field(b,unit,key);input.value=String(value);input.dispatchEvent(new Event('input',{target:input}));return input;}
function change(input){input.dispatchEvent(new Event('change',{target:input}));}
function enter(input){input.dispatchEvent(new Event('keydown',{target:input,key:'Enter'}));}
async function opened(){const b=browser();await b.shared.morning.open();return b;}
async function apply(b){select(b,'preview-final').click();select(b,'apply').click();await tick();return b.posts.at(-1)?.body.adjustment;}
function resultFor(b,entry){const resolved=b.adjust.resolveAdjustment(b.raw,b.settings,entry);assert.equal(resolved.ok,true,resolved.message);return resolved.result;}
function assertOrganicUnchanged(b,result){for(const unit of ['unit1','unit2'])for(const fuel of ['organic','manure'])assert.deepEqual(normal(result.units[unit][fuel]),normal(b.raw.units[unit][fuel]));}

test('table edit opens all ten accessible fields, hides the readonly table and requires a new preview',async()=>{
  const b=await opened();
  select(b,'edit').click();
  assert.equal(fields(b).length,10);
  for(const unit of ['unit1','unit2'])for(const key of ['coal','bio','bioRatio','organicRatio','totalRatio']){
    const input=field(b,unit,key);assert.ok(input);assert.ok(input.getAttribute('aria-label'));assert.equal(input.disabled,false);
  }
  assert.equal(select(b,'readonly').hidden,true);assert.equal(select(b,'final-edit').hidden,false);
  assert.equal(select(b,'apply').disabled,true);assert.equal(select(b,'preview-badge').hidden,true);
  assert.equal(select(b,'result-title').textContent,'수치 수정');assert.equal(b.posts.length,0);
});

test('opening and previewing an unchanged table preserves hidden full precision instead of the two-decimal display',async()=>{
  const b=await opened(),original=normal(b.raw);
  select(b,'edit').click();
  assert.equal(Number(field(b,'unit1','bio').value),435.41);
  const saved=await apply(b);
  assert.equal(saved.mode,'manual_final');
  assert.equal(saved.finalBioUnit1,original.units.unit1.bio.quantity);
  assert.equal(saved.finalBioUnit2,original.units.unit2.bio.quantity);
  assert.equal(Object.hasOwn(saved,'finalCoalUnit1'),false);
  assert.deepEqual(normal(b.raw),original);
});

test('Coal cells commit on change and Enter, recalculate all ratios and persist independent Coal values',async()=>{
  const b=await opened();select(b,'edit').click();
  change(type(b,'unit1','coal',700.123456));enter(type(b,'unit2','coal',710.654321));
  assert.equal(select(b,'apply').disabled,true,'Editing is never implicitly applied');
  const saved=await apply(b);assert.equal(saved.mode,'manual_table');
  assert.equal(saved.finalCoalUnit1,700.123456);assert.equal(saved.finalCoalUnit2,710.654321);
  assert.equal(saved.finalBioUnit1,b.raw.units.unit1.bio.quantity);assert.equal(saved.finalBioUnit2,b.raw.units.unit2.bio.quantity);
  const result=resultFor(b,saved);assertOrganicUnchanged(b,result);
  for(const unit of ['unit1','unit2']){
    const u=result.units[unit],cal=b.settings[unit];
    const total=['coal','bio','organic','manure'].reduce((sum,fuel)=>sum+u[fuel].quantity*cal[fuel].calorific/1000,0);
    near(u.fuelRatios.bio,u.bio.quantity*cal.bio.calorific/1000/total*100,1e-9);
    near(u.fuelRatios.total,u.fuelRatios.bio+u.fuelRatios.organicGroup,1e-9);
  }
});

for(const [unit,key,target] of [
  ['unit1','bioRatio',20],['unit1','organicRatio',5],['unit1','totalRatio',40],
  ['unit2','bioRatio',20],['unit2','organicRatio',5],['unit2','totalRatio',40]
])test(`table ${unit} ${key} target inversely calculates Coal and keeps the saved heat ratios consistent`,async()=>{
  const b=await opened(),raw=b.raw.units[unit],cal=b.settings[unit];select(b,'edit').click();
  const input=type(b,unit,key,target);enter(input);
  const organicHeat=raw.organic.quantity*cal.organic.calorific/1000+raw.manure.quantity*cal.manure.calorific/1000;
  const bioHeat=raw.bio.quantity*cal.bio.calorific/1000,nonCoal=bioHeat+organicHeat;
  const numerator=key==='bioRatio'?bioHeat:key==='organicRatio'?organicHeat:nonCoal;
  const expectedCoal=(numerator/(target/100)-nonCoal)*1000/cal.coal.calorific;
  near(Number(field(b,unit,'coal').value),Math.round(expectedCoal*100)/100,1e-9);
  const saved=await apply(b);assert.equal(saved.mode,'manual_table');
  near(saved[unit==='unit1'?'finalCoalUnit1':'finalCoalUnit2'],expectedCoal);
  const result=resultFor(b,saved),u=result.units[unit];
  const ratio=key==='bioRatio'?u.fuelRatios.bio:key==='organicRatio'?u.fuelRatios.organicGroup:u.fuelRatios.total;
  near(ratio,target,1e-7);assertOrganicUnchanged(b,result);
  assert.equal(result.units[unit].bio.quantity,raw.bio.quantity);
  const other=unit==='unit1'?'unit2':'unit1';assert.deepEqual(normal(result.units[other]),normal(b.raw.units[other]));
});

test('Bio-only edits keep the established manual_final contract and heat-equivalent Coal compensation',async()=>{
  const b=await opened();select(b,'edit').click();
  const one=b.raw.units.unit1.bio.quantity-10,two=b.raw.units.unit2.bio.quantity+10;
  type(b,'unit1','bio',one);type(b,'unit2','bio',two);
  const saved=await apply(b);assert.equal(saved.mode,'manual_final');
  assert.equal(saved.finalBioUnit1,one);assert.equal(saved.finalBioUnit2,two);
  assert.equal(Object.hasOwn(saved,'finalCoalUnit1'),false);
  const result=resultFor(b,saved);
  near(result.units.unit1.coal.quantity,b.raw.units.unit1.coal.quantity+10*b.settings.unit1.bio.calorific/b.settings.unit1.coal.calorific);
  near(result.units.unit2.coal.quantity,b.raw.units.unit2.coal.quantity-10*b.settings.unit2.bio.calorific/b.settings.unit2.coal.calorific);
});

test('saving and reopening manual_table preserves exact Coal and ratios without display rounding loss',async()=>{
  const b=await opened();select(b,'edit').click();change(type(b,'unit1','coal',700.123456));
  const first=normal(await apply(b));assert.equal(first.mode,'manual_table');
  const before=resultFor(b,first);
  await b.shared.morning.open();select(b,'edit').click();
  near(Number(field(b,'unit1','coal').value),700.12,1e-9);
  near(Number(field(b,'unit1','bioRatio').value),Math.round(before.units.unit1.fuelRatios.bio*100)/100,1e-9);
  const second=await apply(b);
  assert.equal(second.finalCoalUnit1,first.finalCoalUnit1);assert.equal(second.finalCoalUnit2,first.finalCoalUnit2);
  assert.equal(second.finalBioUnit1,first.finalBioUnit1);assert.equal(second.finalBioUnit2,first.finalBioUnit2);
  assert.deepEqual(normal(resultFor(b,second).units),normal(before.units));
});

test('Bio editing after reopening manual_table compensates from its saved Coal instead of the raw Coal',async()=>{
  const b=await opened();select(b,'edit').click();change(type(b,'unit1','coal',700.123456));
  const before=normal(await apply(b));
  await b.shared.morning.open();select(b,'edit').click();
  enter(type(b,'unit1','bio',before.finalBioUnit1-10));
  const after=await apply(b);assert.equal(after.mode,'manual_table');
  near(after.finalCoalUnit1,before.finalCoalUnit1+10*b.settings.unit1.bio.calorific/b.settings.unit1.coal.calorific);
  assert.equal(after.finalBioUnit1,before.finalBioUnit1-10);
  assert.equal(after.finalCoalUnit2,before.finalCoalUnit2);
});

test('blank or impossible ratio inputs keep editing open and prevent applying any stale preview',async()=>{
  const b=await opened();select(b,'auto').click();select(b,'edit').click();
  change(type(b,'unit1','coal',''));select(b,'preview-final').click();select(b,'apply').click();
  assert.equal(select(b,'final-edit').hidden,false);assert.equal(select(b,'apply').disabled,true);
  assert.equal(select(b,'msg').dataset.bad,'1');assert.equal(field(b,'unit1','coal').getAttribute('aria-invalid'),'true');
  assert.equal(b.posts.length,0);
  change(type(b,'unit1','coal',700));enter(type(b,'unit1','organicRatio',100));
  select(b,'preview-final').click();select(b,'apply').click();
  assert.equal(select(b,'final-edit').hidden,false);assert.equal(select(b,'apply').disabled,true);
  assert.equal(select(b,'msg').dataset.bad,'1');assert.equal(b.posts.length,0);
});

test('cancel-edit restores the previous selected preview exactly without saving or drawing a new target',async()=>{
  const b=await opened();let draws=0;b.root.Math=Object.create(Math);b.root.Math.random=()=>{draws++;return 0;};
  select(b,'auto').click();const before=select(b,'final').innerHTML,previousDraws=draws;
  select(b,'edit').click();change(type(b,'unit1','coal',700));select(b,'cancel-edit').click();
  assert.equal(select(b,'final-edit').hidden,true);assert.equal(select(b,'readonly').hidden,false);
  assert.equal(select(b,'final').innerHTML,before);assert.equal(select(b,'apply').disabled,false);
  assert.equal(draws,previousDraws);assert.equal(b.posts.length,0);
  select(b,'apply').click();await tick();assert.equal(b.posts[0].body.adjustment.mode,'max_auto');
});

test('a fresh maximum preview closes the compact editor and discards invalid pending edits',async()=>{
  const b=await opened();select(b,'edit').click();type(b,'unit1','coal','');
  select(b,'auto').click();
  assert.equal(select(b,'final-edit').hidden,true);assert.equal(select(b,'readonly').hidden,false);
  assert.equal(select(b,'preview-badge').hidden,false);assert.equal(select(b,'coal-review-notice').hidden,false);
  assert.equal(select(b,'apply').disabled,false);assert.equal(select(b,'msg').hidden,true);assert.equal(b.posts.length,0);
});

test('an explicit Coal correction resolves pending Bio edits atomically after a failed negative-Coal preview',async()=>{
  const b=await opened(),original=normal(b.raw);select(b,'edit').click();
  change(type(b,'unit1','coal',0));
  type(b,'unit1','bio',500);type(b,'unit2','bio',280);
  select(b,'preview-final').click();
  assert.equal(select(b,'final-edit').hidden,false);
  assert.equal(select(b,'apply').disabled,true);
  assert.equal(select(b,'msg').dataset.bad,'1');assert.match(select(b,'msg').textContent,/Coal|사용량/);
  assert.equal(Number(field(b,'unit1','coal').value),0);
  assert.equal(Number(field(b,'unit1','bio').value),500);
  assert.equal(Number(field(b,'unit2','bio').value),280);
  assert.equal(b.posts.length,0);assert.deepEqual(normal(b.raw),original);

  // The pending explicit Coal value must be used before validating the two
  // Bio edits; validating an intermediate heat-compensated Coal would fail.
  type(b,'unit1','coal',100);
  const saved=await apply(b);
  assert.equal(saved.mode,'manual_table');assert.equal(saved.finalCoalUnit1,100);
  assert.equal(saved.finalBioUnit1,500);assert.equal(saved.finalBioUnit2,280);
  near(saved.finalCoalUnit2,original.units.unit2.coal.quantity+
    (original.units.unit2.bio.quantity-280)*b.settings.unit2.bio.calorific/b.settings.unit2.coal.calorific);
  assert.equal(b.posts.length,1);assert.deepEqual(normal(b.raw),original);
});
