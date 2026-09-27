import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel){ return fs.readFileSync(path.join(repo, rel), 'utf8'); }
let importSerial=0;
function dataImport(source){ importSerial++; return import('data:text/javascript;base64,'+Buffer.from(source+`\n// test-import-${importSerial}`).toString('base64')); }
function context(request){ return { request, env:{DB:{}}, params:{}, data:{}, waitUntil(){} }; }
function headers(){ return {Authorization:'Bearer test-token','User-Agent':'Desktop Chrome','X-ShiftLog-Client':'desktop'}; }
function defaults(){
  return {
    unit1:{coal:{calorific:5868,coefficient:1.01},bio:{calorific:3237,coefficient:1.02},organic:{calorific:3487,coefficient:1.03},manure:{calorific:3487,coefficient:1.04}},
    unit2:{coal:{calorific:5868,coefficient:1.11},bio:{calorific:3237,coefficient:1.12},organic:{calorific:3487,coefficient:1.13},manure:{calorific:3487,coefficient:1.14}}
  };
}

async function loadSettingsBridge(mock){
  let source=read('functions/api/morning-meeting-cofiring-settings.js');
  source=source.replace(/import \* as SharedSettingsApi from "\.\/cofiring-calculation-settings\.js";/, 'const SharedSettingsApi = globalThis.__sharedSettingsMock;');
  globalThis.__sharedSettingsMock=mock;
  try{return await dataImport(source+'\n//# sourceURL=morning-settings-bridge-test.mjs');}
  finally{delete globalThis.__sharedSettingsMock;}
}

async function loadAdjustmentBridge(mock){
  let source=read('functions/api/morning-meeting-cofiring-adjustments.js');
  source=source.replace(/import \* as SharedAdjustmentApi from "\.\/cofiring-period-adjustments\.js";/, 'const SharedAdjustmentApi = globalThis.__sharedAdjustmentMock;');
  globalThis.__sharedAdjustmentMock=mock;
  try{return await dataImport(source+'\n//# sourceURL=morning-adjustment-bridge-test.mjs');}
  finally{delete globalThis.__sharedAdjustmentMock;}
}

test('Morning calorific GET reads the canonical co-firing setting and maps the legacy shape', async()=>{
  const settings=defaults();
  const seen=[];
  const api=await loadSettingsBridge({
    async onRequestGet(ctx){seen.push(new URL(ctx.request.url));return Response.json({ok:true,targetDate:'2026-09-27',source:'saved',effectiveDate:'2026-09-20',settings});},
    async onRequestPost(){throw new Error('unexpected post');}
  });
  const res=await api.onRequestGet(context(new Request('https://shift.test/api/morning-meeting-cofiring-settings?targetDate=2026-09-27',{headers:headers()})));
  const body=await res.json();
  assert.equal(res.status,200);
  assert.equal(seen[0].pathname,'/api/cofiring-calculation-settings');
  assert.equal(seen[0].searchParams.get('targetDate'),'2026-09-27');
  assert.equal(body.setting.coalKcalPerKg,5868);
  assert.equal(body.setting.manureKcalPerKg,3487);
  assert.deepEqual(body.settings,settings);
});

test('Morning calorific POST appends to canonical history, preserves coefficients, and updates both units', async()=>{
  const base=defaults(); let posted=null;
  const api=await loadSettingsBridge({
    async onRequestGet(){return Response.json({ok:true,targetDate:'2026-09-27',source:'saved',effectiveDate:'2026-09-20',settings:base});},
    async onRequestPost(ctx){posted=await ctx.request.json();return Response.json({ok:true,entry:{effectiveDate:posted.effectiveDate,settings:posted.settings,updatedByName:'테스터',updatedById:'2022008',updatedAt:'2026-09-27T00:00:00Z'}});}
  });
  const request=new Request('https://shift.test/api/morning-meeting-cofiring-settings',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({effectiveDate:'2026-09-27',coalKcalPerKg:6230,bioKcalPerKg:3352,organicKcalPerKg:3364,manureKcalPerKg:3364})});
  const res=await api.onRequestPost(context(request)); const body=await res.json();
  assert.equal(posted.effectiveDate,'2026-09-27');
  for(const unit of ['unit1','unit2']){
    assert.equal(posted.settings[unit].coal.calorific,6230);
    assert.equal(posted.settings[unit].bio.calorific,3352);
    assert.equal(posted.settings[unit].organic.calorific,3364);
    assert.equal(posted.settings[unit].manure.calorific,3364);
  }
  assert.equal(posted.settings.unit1.coal.coefficient,1.01);
  assert.equal(posted.settings.unit2.manure.coefficient,1.14);
  assert.equal(body.setting.coalKcalPerKg,6230);
  assert.equal(body.entry.effectiveDate,'2026-09-27');
});

test('Morning calorific partial edit preserves omitted fuel calorifics and every correction coefficient', async()=>{
  const base=defaults(); let posted;
  const api=await loadSettingsBridge({
    async onRequestGet(){return Response.json({ok:true,settings:base,source:'saved',effectiveDate:'2026-09-20'});},
    async onRequestPost(ctx){posted=await ctx.request.json();return Response.json({ok:true,entry:{effectiveDate:posted.effectiveDate,settings:posted.settings}});}
  });
  const req=new Request('https://shift.test/api/morning-meeting-cofiring-settings',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({effectiveDate:'2026-09-27',bioKcalPerKg:3400})});
  await api.onRequestPost(context(req));
  assert.equal(posted.settings.unit1.bio.calorific,3400);
  assert.equal(posted.settings.unit2.bio.calorific,3400);
  assert.equal(posted.settings.unit1.coal.calorific,5868);
  assert.equal(posted.settings.unit2.manure.calorific,3487);
  assert.equal(posted.settings.unit1.bio.coefficient,1.02);
  assert.equal(posted.settings.unit2.bio.coefficient,1.12);
});

test('Morning adjustment GET maps one date to the exact canonical full-day period', async()=>{
  const seen=[];
  const api=await loadAdjustmentBridge({
    async onRequestGet(ctx){seen.push(new URL(ctx.request.url));return Response.json({ok:true,revision:7,adjustment:{mode:'manual_final',finalBioUnit1:300,finalBioUnit2:220,maxBioTpd:361.74,excludedBioTons:2},setting:{maxBioTpd:361.74}});},
    async onRequestPost(){throw new Error('unexpected post');}
  });
  const res=await api.onRequestGet(context(new Request('https://shift.test/api/morning-meeting-cofiring-adjustments?targetDate=2026-09-27',{headers:headers()})));
  const body=await res.json();
  assert.equal(seen[0].pathname,'/api/cofiring-period-adjustments');
  assert.equal(seen[0].searchParams.get('start'),'2026-09-27T00:00');
  assert.equal(seen[0].searchParams.get('end'),'2026-09-28T00:00');
  assert.equal(body.adjustment.finalBioUnitOne,300);
  assert.equal(body.adjustment.finalBioUnitTwo,220);
  assert.equal(body.setting.maxBioLimit,361.74);
});

test('Morning adjustment save writes the canonical daily adjustment with current revision', async()=>{
  const posts=[]; let adjustment={mode:'manual_final',finalBioUnit1:300,finalBioUnit2:220,maxBioTpd:361.74,excludedBioTons:2}; let revision=4;
  const api=await loadAdjustmentBridge({
    async onRequestGet(){return Response.json({ok:true,revision,adjustment,setting:{maxBioTpd:361.74}});},
    async onRequestPost(ctx){const b=await ctx.request.json();posts.push(b); if(b.action==='save'){adjustment=b.adjustment;revision++;} return Response.json({ok:true,revision,adjustment,setting:{maxBioTpd:361.74}});}
  });
  const req=new Request('https://shift.test/api/morning-meeting-cofiring-adjustments',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({targetDate:'2026-09-27',mode:'manual_final',fromUnit:1,bioTransferTons:10,finalBioUnitOne:290,finalBioUnitTwo:230,maxBioLimit:361.74,excludedBioTons:0,note:'same source'})});
  const res=await api.onRequestPost(context(req)); const body=await res.json();
  assert.equal(posts[0].action,'save');
  assert.equal(posts[0].start,'2026-09-27T00:00');
  assert.equal(posts[0].end,'2026-09-28T00:00');
  assert.equal(posts[0].expectedRevision,4);
  assert.equal(posts[0].adjustment.finalBioUnit1,290);
  assert.equal(posts[0].adjustment.finalBioUnit2,230);
  assert.equal(posts[0].adjustment.maxBioTpd,361.74);
  assert.equal(body.adjustment.finalBioUnitOne,290);
  assert.equal(body.revision,5);
});

test('Morning maximum Bio setting writes the canonical shared adjustment setting', async()=>{
  const posts=[];
  const api=await loadAdjustmentBridge({
    async onRequestGet(){return Response.json({ok:true,revision:0,adjustment:null,setting:{maxBioTpd:361.74}});},
    async onRequestPost(ctx){const b=await ctx.request.json();posts.push(b);return Response.json({ok:true,setting:{maxBioTpd:b.maxBioTpd}});}
  });
  const req=new Request('https://shift.test/api/morning-meeting-cofiring-adjustments',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({action:'save_setting',maxBioLimit:350})});
  const res=await api.onRequestPost(context(req)); const body=await res.json();
  assert.deepEqual(posts[0],{action:'save_setting',maxBioTpd:350});
  assert.equal(body.setting.maxBioLimit,350);
});

test('Morning adjustment DELETE clears the canonical daily adjustment', async()=>{
  const posts=[]; let adjustment={mode:'manual_final',finalBioUnit1:300,finalBioUnit2:220}; let revision=2;
  const api=await loadAdjustmentBridge({
    async onRequestGet(){return Response.json({ok:true,revision,adjustment,setting:{maxBioTpd:361.74}});},
    async onRequestPost(ctx){const b=await ctx.request.json();posts.push(b); adjustment=null; revision++; return Response.json({ok:true,revision,adjustment:null});}
  });
  const req=new Request('https://shift.test/api/morning-meeting-cofiring-adjustments?targetDate=2026-09-27',{method:'DELETE',headers:headers()});
  const res=await api.onRequestDelete(context(req)); const body=await res.json();
  assert.equal(posts[0].action,'clear');
  assert.equal(posts[0].expectedRevision,2);
  assert.equal(body.adjustment,null);
  assert.equal(body.revision,3);
});

test('legacy Morning routes no longer own separate D1 tables',()=>{
  const settings=read('functions/api/morning-meeting-cofiring-settings.js');
  const adjustments=read('functions/api/morning-meeting-cofiring-adjustments.js');
  assert.match(settings,/cofiring-calculation-settings\.js/);
  assert.doesNotMatch(settings,/morning_meeting_cofiring_calorific_values/);
  assert.match(adjustments,/cofiring-period-adjustments\.js/);
  assert.doesNotMatch(adjustments,/CREATE TABLE|morning_meeting_cofiring_adjustments/);
});
