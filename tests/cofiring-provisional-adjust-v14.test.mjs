import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProvisionalAdjustment} from '../functions/_shared/cofiring-provisional-adjust-v14.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.resolve(here,'../maintenance/cofiring-provisional-adjust-v14.js'))?path.resolve(here,'..'):path.resolve(here,'../..');
const src=fs.existsSync(path.join(root,'maintenance/cofiring-provisional-adjust-v14.js'))?root:path.join(root,'payload');
const v14=fs.readFileSync(path.join(src,'maintenance/cofiring-provisional-adjust-v14.js'),'utf8');
const api=fs.readFileSync(path.join(src,'functions/api/cofiring-provisional-v12.js'),'utf8');
const round6=x=>Math.round((x+Number.EPSILON)*1000000)/1000000;
const settings={unit1:{coal:{calorific:5868},bio:{calorific:3237},organic:{calorific:3487},manure:{calorific:3487}},unit2:{coal:{calorific:5868},bio:{calorific:3237},organic:{calorific:3487},manure:{calorific:3487}}};
function makeBase(){
 const units={};for(const [u,c,b] of [['unit1',523.57,489.85],['unit2',750.15,3.36]]){
  const fuels={coal:c,bio:b,organic:78.03,manure:0};const heats={};for(const f of Object.keys(fuels))heats[f]=fuels[f]*settings[u][f].calorific/1000;
  heats.total=Object.values(heats).reduce((a,b)=>a+b,0);
  units[u]={};for(const f of Object.keys(fuels))units[u][f]={quantity:fuels[f]};units[u].heats=heats;
 }
 return {period:{durationHours:24},units,combined:{}};
}
function apply(mode,overrides={}){
 let defaultInput=mode==='manual_transfer'?{mode,fromUnit:1,bioTransferTons:50,finalBioUnit1:439.85,finalBioUnit2:53.36,maxBioTpd:null}:{mode,fromUnit:1,bioTransferTons:128.45,finalBioUnit1:361.4,finalBioUnit2:131.81,maxBioTpd:361.4};
 return validateProvisionalAdjustment(makeBase(),settings,{...defaultInput,...overrides});
}
test('explicit Yes and No before adjusting hypothetical organic fuel',()=>{
 assert.match(v14,/추정 계산된 유기성 고형연료가 통신 오류로 인해 가계산되었습니다/);
 assert.match(v14,/그래도 혼소조정을 진행하시겠습니까/);
 assert.match(v14,/data-v14-yes/);assert.match(v14,/data-v14-no/);
});
test('both requested adjustment tabs exist; official adjustment POST is not called by the new UI',()=>{
 assert.match(v14,/data-v14-tab="auto"/);assert.match(v14,/data-v14-tab="manual"/);
 assert.match(v14,/adj\(\)\.autoMax/);assert.match(v14,/adj\(\)\.manualTransfer/);
 assert.doesNotMatch(v14,/\/api\/cofiring-period-adjustments/);
 assert.match(v14,/applyProvisionalAdjustment/);assert.match(v14,/CofiringProvisionalV12\?\.autoSave/);
});
test('manual transfer preserves total original Bio and recomputes adjusted Coal and heat shares',()=>{
 const r=apply('manual_transfer');
 assert.equal(r.units.unit1.bio.quantity,439.85);
 assert.equal(r.units.unit2.bio.quantity,53.36);
 assert.equal(r.units.unit1.coal.quantity,round6(523.57+50*3237/5868));
 assert.equal(r.units.unit2.coal.quantity,round6(750.15-50*3237/5868));
 assert.ok(r.combined.fuelRatios.total>0);
 assert.equal(r.adjustment.provisional,true);
});
test('maximum cofiring preview stays below cap and cannot create extra Bio',()=>{
 const r=apply('max_auto');
 assert.ok(r.units.unit1.bio.quantity<=361.4);assert.ok(r.units.unit2.bio.quantity<=361.4);
 assert.ok(Math.abs(r.units.unit1.bio.quantity+r.units.unit2.bio.quantity-493.21)<0.00001);
});
test('reject invented Bio or unsupportable manual transfer',()=>{
 assert.throws(()=>apply('manual_transfer',{finalBioUnit1:489.85,finalBioUnit2:400}),/조정 Bio 합계|이동 방향/);
 assert.throws(()=>apply('manual_transfer',{bioTransferTons:700}),/이동 방향/);
 assert.throws(()=>apply('max_auto',{finalBioUnit1:490}),/Bio 합계|허용량/);
});
test('reject reversed or zero-source transfers, negative Coal outcomes and invalid fuel heating settings',()=>{
 assert.throws(()=>apply('manual_transfer',{fromUnit:2,bioTransferTons:50,finalBioUnit1:539.85,finalBioUnit2:-46.64}));
 const bad=structuredClone(settings);bad.unit1.coal.calorific=0;
 assert.throws(()=>validateProvisionalAdjustment(makeBase(),bad,{mode:'manual_transfer',fromUnit:1,bioTransferTons:50,finalBioUnit1:439.85,finalBioUnit2:53.36,maxBioTpd:null}));
});
test('normal calculation still uses the official editor and only the displayed provisional case is intercepted',()=>{
 assert.match(v14,/const c=context\(\);if\(!c\|\|!c\.shell\.contains\(button\)\)return/);
 assert.match(v14,/event\.stopImmediatePropagation\(\)/);
 assert.match(v14,/state\.dialog\.querySelector\('\[data-v14-no\]'\)\.focus\(\)/);
});
test('installer updates only the provisional API and UI, retains the official close guards',()=>{
 assert.match(api,/validateProvisionalAdjustment/);
 assert.doesNotMatch(v14,/\/api\/cofiring-closed-history/);
 assert.match(api,/officialClose:false/);
});
