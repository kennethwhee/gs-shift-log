'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const monthly=require('../maintenance/cofiring-closed-history-cards-v2.js');
const read=p=>fs.readFileSync(p,'utf8');
const preview=require('node:path').join(__dirname,'../maintenance/cofiring-provisional-v12.js');
const scenario={
  targetDate:'2026-10-23',recordKind:'hypothesis',verificationStatus:'unverified',officialClose:false,
  sourceRequestId:'0123456789',assumption:{silo:'organicStorageSiloB',boundaryLocal:'2026-10-24T00:00',tons:19.143},
  summary:{unit1:{coal:512.45,bio:536.32,organic:66.89,manure:0,bioRatio:35.9,organicGroupRatio:4.44,totalRatio:40.33},
           unit2:{coal:759.81,bio:11.70,organic:66.89,manure:0,bioRatio:0.84,organicGroupRatio:4.74,totalRatio:5.57},
           combined:{bioRatio:18.94,organicGroupRatio:4.58,totalRatio:23.52}},
  savedByName:'Operator',savedAt:'2026-10-27T01:00:00Z',revision:2
};
test('hypothesis appears with actual tonnes but cannot masquerade as official close',()=>{
 assert.equal(monthly.isHypothesis(scenario),true);
 const item=monthly.deriveSnapshot(scenario);
 assert.equal(item.isHypothesis,true);
 assert.equal(item.unit1.coal,512.45);
 assert.equal(item.unit2.bio,11.7);
 assert.equal(item.combined.totalRatio,23.52);
 const html=monthly.rowMarkup(item);
 assert.match(html,/data-cfv15-hypothesis="true"/);
 assert.match(html,/cfh-hypothesis-readonly/);
 assert.match(html,/>가정<\/span>/);
 assert.doesNotMatch(html,/data-cfv15-delete/);
 const table=monthly.tableMarkup([item],'2026-10');
 assert.match(table,/536\.32/);
 assert.match(table,/가정 계산 · 미확정/);
 assert.match(table,/월평균에서는 제외/);
 assert.doesNotMatch(table,/<tfoot/);
 const detail=monthly.detailMarkup(scenario,item);
 assert.match(detail,/재확인 필요/);
 assert.doesNotMatch(detail,/마감 당시 발열량/);
});
test('actual saved close always wins over hypothesis for the same date',()=>{
 const official={targetDate:'2026-10-23',revision:7,version:'a'.repeat(64)};
 const merged=monthly.mergeOfficialAndHypothesis([official],[scenario]);
 assert.equal(merged.length,1);
 assert.strictEqual(merged[0],official);
 assert.equal(monthly.isHypothesis(official),false);
 assert.match(monthly.rowMarkup({targetDate:'2026-10-23',unit1:{},unit2:{},combined:{},adjustmentApplied:false}),/data-cfv15-delete/);
});
test('rejects forged or incomplete guessed data, other dates, claimed certified',()=>{
 for(const bad of [
  {...scenario,officialClose:true},{...scenario,verificationStatus:'confirmed'},
  {...scenario,assumption:{...scenario.assumption,tons:19}},
  {...scenario,targetDate:'2026-10-26'},
  {...scenario,summary:{...scenario.summary,unit2:{...scenario.summary.unit2,coal:NaN}}},
  {...scenario,summary:{...scenario.summary,unit2:{...scenario.summary.unit2,coal:-1}}}
 ]) assert.equal(monthly.isHypothesis(bad),false);
});
test('actual monthly KPIs never include the guessed fuel data',()=>{
 const actual={targetDate:'2026-10-21',unit1:{coal:100,bio:10,organic:2,manure:0,bioRatio:1,organicGroupRatio:2,totalRatio:3},unit2:{coal:200,bio:20,organic:4,manure:0,bioRatio:1,organicGroupRatio:2,totalRatio:3},combined:{bioRatio:1,organicGroupRatio:2,totalRatio:3}};
 const table=monthly.tableMarkup([monthly.deriveSnapshot(scenario),actual],'2026-10');
 assert.match(table,/<tfoot/);
 assert.match(table,/1일 · 실측만/);
 assert.doesNotMatch(table,/2일 · 실측만/);
 assert.match(table,/가정값 제외/);
});
test('previous day hypothesis can feed following morning only with its source date labelled',()=>{
 const source=read(preview);
 const root={console,document:null};vm.runInNewContext(source,root,{filename:preview});
 class Element{constructor(){this.dataset={};this.children=[];this.textContent='';this.classList={add(){},remove(){},contains(){return false}};this.parentElement=null;}
  append(x){this.children.push(x);x.parentElement=this;}
  contains(x){return this===x||this.children.some(c=>c.contains(x));}
  querySelector(sel){if(sel==='[data-gs-v13-note]')return this.children.find(c=>Object.hasOwn(c.dataset,'gsV13Note'))||null;return null;}
 }
 const card=new Element(),header=new Element();card.append(header);
 const fields={};for(const u of [1,2])for(const suffix of ['CoalUsage','BioUsage','OrganicInput','BioRatio','OrganicRatio','TotalRatio']){
  const node=new Element(),wrap=new Element();wrap.append(node);card.append(wrap);fields['efficiencyMorningMeetingCofiringUnit'+u+suffix]=node;
 }
 card.querySelector=function(sel){if(sel==='[data-gs-v13-note]')return this.children.find(c=>Object.hasOwn(c.dataset,'gsV13Note'))||null;if(sel==='.efficiency-morning-meeting-auto-card__header')return header;return null};
 root.document={getElementById:id=>id==='efficiencyMorningMeetingAutoCofiringCard'?card:fields[id]||null,createElement:()=>new Element()};
 root.morningMeetingClosedCofiring={targetDate:()=>root.date||'2026-10-24',peek:()=>root.official||null,isBlocked:()=>false};
 assert.equal(root.CofiringProvisionalV12.applyMorning(scenario,'2026-10-24','2026-10-23'),true);
 assert.match(fields.efficiencyMorningMeetingCofiringUnit1CoalUsage.textContent,/512\.45/);
 assert.match(header.children[0].textContent,/2026-10-23 계산분/);
 assert.equal(root.CofiringProvisionalV12.applyMorning(scenario,'2026-10-26','2026-10-23'),false);
 root.official={targetDate:'2026-10-24'};
 assert.equal(root.CofiringProvisionalV12.applyMorning(scenario,'2026-10-24','2026-10-23'),false);
});
test('visible save-status errors and no official data / excel endpoint writes',()=>{
 const ui=read(preview),index=read(require('node:path').join(__dirname,'../index.html'));
 assert.match(ui,/가정 기록 저장 실패/);
 assert.match(ui,/가정 계산 별도 저장 완료/);
 assert.match(ui,/data-gs-v14-save-status/);
 assert.doesNotMatch(ui,/\/api\/cofiring-closed-history/);
 assert.match(index,/cofiring-estimated-inline-v14.css/);
 assert.match(index,/cofiring-closed-history-cards-v2\.js[^"\r\n]*hypothesis=20261027-v14/);
 const detail=read(require('node:path').join(__dirname,'../maintenance/cofiring-closed-history-final-detail-v1.js'));
 assert.match(detail,/hasAttribute\('data-cfv15-hypothesis'\)/);
});
