'use strict';
// COFIRING_TOTAL_HEAT_BASIS_V2_R3
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../maintenance/cofiring-core.js');
const ui=require('../maintenance/cofiring-period-ui-v5.js');
const cards=require('../maintenance/cofiring-closed-history-cards-v2.js');
const target=require('../maintenance/cofiring-target-reference-v6.js');
const deadline=require('../maintenance/cofiring-deadline-target-v1.js');
const close=(a,b,t=1e-8)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),String(a)+' != '+String(b));
const makeUnit=(coal,bio,organic,manure,cal={coal:5895,bio:3428,organic:3357,manure:3357})=>({
 coal:{quantity:coal,coefficient:1,complete:true},bio:{quantity:bio,coefficient:1,complete:true},organic:{quantity:organic,complete:true},manure:{quantity:manure,complete:true},
 calorifics:cal,heats:{coal:coal*cal.coal/1000,bio:bio*cal.bio/1000,organic:organic*cal.organic/1000,manure:manure*cal.manure/1000}
});
function finish(u){u.heats.total=u.heats.coal+u.heats.bio+u.heats.organic+u.heats.manure;u.fuelRatios={bio:u.heats.bio/u.heats.total*100,organicGroup:(u.heats.organic+u.heats.manure)/u.heats.total*100,total:(u.heats.bio+u.heats.organic+u.heats.manure)/u.heats.total*100};u.ratios={bio:u.fuelRatios.bio,organic:u.fuelRatios.organicGroup,total:u.fuelRatios.total};return u;}
test('audited 9/29 values use total fuel heat',()=>{const u1=finish(makeUnit(540.53,435.41,88.89,0)),u2=finish(makeUnit(589.37,356.21,88.89,0));close(ui.coalBioRatio(u1),29.987170284480037);close(ui.coalBioRatio(u2),24.451942251208113);const r={units:{unit1:u1,unit2:u2},combined:{heats:{bio:u1.heats.bio+u2.heats.bio,total:u1.heats.total+u2.heats.total},fuelRatios:{}}};r.combined.fuelRatios.bio=r.combined.heats.bio/r.combined.heats.total*100;close(ui.combinedCoalBio(r).ratio,r.combined.fuelRatios.bio);close(cards.unitBioRatio(u1),u1.fuelRatios.bio);close(core.summaryFromResult(r).unit1.bioRatio,u1.fuelRatios.bio);});
test('deadline target includes organic and manure projected average heat',()=>{const u=finish(makeUnit(120,20,12,6,{coal:6000,bio:4000,organic:3000,manure:2500}));const result=deadline.forUnit(u,{startLocal:'2026-09-16T00:00',endLocal:'2026-09-16T12:00'},{now:Date.parse('2026-09-16T12:01:00+09:00'),targetPercent:25});assert.equal(result.status,'ready');const totalBio=u.bio.quantity+result.targetBioTonPerHour*result.remainingHours;const heat=result.projectedCoalTon*6000+totalBio*4000+result.projectedOrganicTon*3000+result.projectedManureTon*2500;close(totalBio*4000/heat*100,25);close(result.projectedRatioPercent,25);});
test('steady target reference denominator includes organic and manure',()=>{const u=finish(makeUnit(120,40,10,2,{coal:6000,bio:3000,organic:3000,manure:3000}));const ref=target.forUnit(u,4);const total=u.heats.total*1000;close(ref.currentBioPercent,(40*3000)/total*100);assert.equal(ref.basis,'selected-period-average-total-fuel-heat');});
test('no old Coal+Bio ratio code remains in patched surfaces',()=>{const root=path.join(__dirname,'..');for(const rel of ['maintenance/cofiring-core.js','maintenance/cofiring-period-ui-v5.js','maintenance/cofiring-period-adjustment-v56.js','maintenance/cofiring-closed-history-cards-v2.js','maintenance/morning-meeting-closed-cofiring.js']){const s=fs.readFileSync(path.join(root,rel),'utf8');assert.match(s,/COFIRING_TOTAL_HEAT_BASIS_V2_R3/);}});
