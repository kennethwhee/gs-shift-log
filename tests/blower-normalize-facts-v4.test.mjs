import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {collectApprovedReplacementFacts} from '../functions/_shared/blower-replacement-facts-v3.js';
import {normalizeContent} from '../maintenance/diary-vbelt-core-v1.js';

const apiUrl=new URL('../functions/api/blower-history.js',import.meta.url);
const source=fs.readFileSync(apiUrl,'utf8').replace(/from (["'])(\.\.?\/[^"']+)\1/g,
  (_,quote,relative)=>'from '+JSON.stringify(new URL(relative,apiUrl).href));
const {__v4Adapters:adapters}=await import('data:text/javascript;base64,'+Buffer.from(source+`
export const __v4Adapters={parseFragments:parseShiftLogFragments,contextualizeFragments:v13ContextualizeScanFragments,
 sourceText:fragmentSourceText,identityText:fragmentIdentityText,sourceRole:fragmentSourceRole,
 sourceTime:fragmentSourceTime,resolveTargets:v13ResolveTargets,actualBeltReplacement:v13ActualBeltReplacement,
 detectDateTime:detectionDateTime,normalizeTime:normalizeCanonicalEntryTime,normalizeRole:normalizeDutyPosition};`).toString('base64'));
const definitions=[
 ...['104','204'].flatMap(prefix=>[
  ...['611','621','631'].map((suffix,i)=>[`${prefix}HHL60AP${suffix}`,'fbhe',prefix==='104'?'1':'2',`#${'ABC'[i]}`]),
  ...['611','621','631'].map((suffix,i)=>[`${prefix}HHL10AN${suffix}`,'seal_pot',prefix==='104'?'1':'2',`#${'ABC'[i]}`]),
  ...['001','002'].map((suffix,i)=>[`${prefix}SDF01AN${suffix}`,'organic_fuel',prefix==='104'?'1':'2',`#${'AB'[i]}`]),
  ...['601','602'].map((suffix,i)=>[`${prefix}ETG30AN${suffix}`,'flyash_bag',prefix==='104'?'1':'2',`#${'AB'[i]}`])]),
 ['104ETH03AN601','flyash_silo','shared','#A'],['104ETH03AN602','flyash_silo','shared','#B'],
 ['204LMDF01AN001','organic_fuel','2','#1'],
 ['103HRJ01AN601','limestone','1','#A'],['103HRJ01AN602','limestone','1','#B'],
 ['203HRJ01AN601','limestone','2','#A'],['203HRJ01AN602','limestone','2','#B']
];
const assets=definitions.map(([tag_number,blower_type,unit_no,position_label],sort_order)=>({
 tag_number,blower_type,unit_no,position_label,sort_order,enabled:1,
 asset_group:tag_number==='204LMDF01AN001'?'manure':'',created_at:'2020-01-01T00:00:00Z'}));
function row(content,{id='v4-approved',date='2026-09-19',role='BO2',time='',shift='DS'}={}){
 return{id,work_date:date,role,shift,status:'결재완료',log_json:JSON.stringify({id,date,role,shift,status:'결재완료',
  entries:[{id:'source-entry-'+id,time,category:'인계사항',content}]})};
}
const facts=r=>collectApprovedReplacementFacts(r,assets,adapters);

test('legacy1895 historical25년11월03일 replacement does not become a March9 reset',()=>{
 const r=row('1. [104HHL60AP621] #1 BLR FBHE Blower #B Belt Slip 발생으로 전류치 및 유량 하락현상 발생\n'+
  ' - Pulley 및 Belt Swing 현상은 외형상 없음 / 25년 11월03일 마지막으로 Belt 교체 함',
  {id:'legacy-POCHEON#20260309#DAY#BCO1',date:'2026-03-09',role:'BCO1'});
 assert.deepEqual(facts(r),[]);
 for(const reference of ['2025-11-03 Belt 교체 완료','11월3일 마지막으로 Belt 교체 함','지난12/4 Belt 교체 실시'])
  assert.deepEqual(facts(row('104HHL60AP621 '+reference,{date:'2026-03-09',role:'BCO1'})),[],reference);
});

test('legacy10092/10095 explicit1-A belt work overrides prior foreign FeederB and startup is not completion clock',()=>{
 const r=row('1. Limestone Blower #A Belt 끊어짐으로 긴급정지 및 Feeder 정지 실시 -> BM 발행 / Belt 재설치 후 정상 기동 중(10:00)\n'+
  '2. 10:03 Limestone Rotary Feeder #B LOC Fault -> 덩어리가 걸려 Overload Trip 추정 / 재기동2회 후 정상화\n'+
  '3. 10:10 유기성 고형연료 Blower 1-A Belt 교체 후 정상 기동 실시',
  {id:'legacy-POCHEON#20251219#DAY#BO1',date:'2025-12-19',role:'BO1'});
 const out=facts(r).filter(f=>f.tagNumber.startsWith('104SDF01AN'));
 assert.equal(out.length,1);assert.equal(out[0].tagNumber,'104SDF01AN001');
 assert.equal(out[0].timePrecision,'day');assert.equal(out[0].originalSourceClock,'10:10');
});

test('legacy305/308 actual belt replacement and tension adjustment is performed day work, tension-only is excluded',()=>{
 const out=facts(row('1. 19:45 유기성 고형연료 Blower #B Belt 교체 및 장력 조정 실시\n'+
  ' -> 무부하 운전시34A, 부하 운전시38A 지시중\n -> 투입상태 및 기동상태 양호하여 지속 관찰 중',
  {id:'legacy-POCHEON#20260707#NIGHT#BCO2',date:'2026-07-07',role:'BCO2',shift:'NS'}));
 assert.equal(out.length,1);assert.equal(out[0].tagNumber,'204SDF01AN002');assert.equal(out[0].timePrecision,'day');
 for(const content of ['유기성 고형연료 Blower #B Belt 장력 조정 완료','FBHE Blower #A V-Belt Tension 조정 후 정상 기동',
  'Seal Pot Blower #C V-Belt 점검 및 Suction Filter 교체 완료','FBHE Blower #A V-Belt 교체 및 장력조정 예정'])
  assert.deepEqual(facts(row(content)),[],content);
});

test('legacy40097 Lime2A request then actual completion yields only A day fact, no10:00 work clock',()=>{
 const out=facts(row('[TM작업]#2 BLR Limestone Blower #A V-Belt 손상 교체 요청\n'+
  ' → Belt 전부 교체 완료. 차단기 투입 후 기동중',
  {id:'legacy-POCHEON#20260919#DAY#BO2',date:'2026-09-19',role:'BO2'}));
 assert.equal(out.length,1);assert.equal(out[0].tagNumber,'203HRJ01AN601');assert.equal(out[0].timePrecision,'day');
});

test('Limestone Vent Fan and Vent Filter Fan are foreign equipment, not Limestone Blower replacements',()=>{
 for(const content of ['[TM작업] Limestone Vent Fan #A V-Belt 교체 완료 및 #B 점검',
  '09:36 Lime Stone Vent Fan #B V-Belt 교체 실시',
  '[TM작업] Limestone Vent Filter Fan #B V-Belt 교체 완료']){
  assert.deepEqual(facts(row(content,{role:'BO1'})),[],content);
 }
});

test('legacy40148/40151 Lime2B10:35 directly completed belt work retains exact completion minute',()=>{
 const out=facts(row('[TM작업]Limestone Blower #B V-Belt 교체 완료',
  {id:'legacy-POCHEON#20260922#DAY#BCO2',date:'2026-09-22',role:'BCO2',time:'10:35'}));
 assert.equal(out.length,1);assert.equal(out[0].tagNumber,'203HRJ01AN602');assert.equal(out[0].timePrecision,'minute');
 assert.equal(Date.parse(out[0].eventDate),Date.parse('2026-09-22T10:35:00+09:00'));
});

test('legacy21489/21492 Seal2C10:45 explicitly replaces belt AND filter, filter-only never resets belt',()=>{
 const out=facts(row('10:45 Seal Pot Blower #C V-Belt 및 Suction Filter 교체 완료[TM작업]',
  {id:'legacy-POCHEON#20260225#DAY#BCO2',date:'2026-02-25',role:'BCO2'}));
 assert.equal(out.length,1);assert.equal(out[0].tagNumber,'204HHL10AN631');assert.equal(out[0].timePrecision,'minute');
 assert.equal(Date.parse(out[0].eventDate),Date.parse('2026-02-25T10:45:00+09:00'));
 assert.deepEqual(facts(row('10:45 Seal Pot Blower #C V-Belt 상태 점검, Suction Filter 교체 완료')),[]);
});

test('all27 managed direct completed TAGs retain own10:00 clock after recognition fixes',()=>{
 assert.equal(assets.length,27);
 for(const asset of assets){
  const out=facts(row(asset.tag_number+' V-Belt 교체 완료',{time:'10:00',role:asset.unit_no==='1'?'BO1':'BO2'}));
  assert.equal(out.length,1,asset.tag_number);assert.equal(out[0].tagNumber,asset.tag_number);
  assert.equal(out[0].timePrecision,'minute');
 }
});

test('postreplacement startup clock remains unknown while directly timed completion is exact',()=>{
 for(const content of ['10:10 FBHE Blower #A Belt 교체 후 정상 기동 실시',
  '10:10 FBHE Blower #A Belt 교체 후 기동 완료']){
  const out=facts(row(content));assert.equal(out.length,1);assert.equal(out[0].timePrecision,'day',content);
 }
 const done=facts(row('10:10 FBHE Blower #A Belt 교체 완료 후 정상 기동 실시'));
 assert.equal(done.length,1);assert.equal(done[0].timePrecision,'minute');
});

const authorChoice=(content,tagNumber,{confirmed=true,replacedOn='2026-09-19',completedTime=''}={})=>({
 version:1,confirmed,content:normalizeContent(content),targets:confirmed?[{tagNumber,replacedOn,completedTime}]:[]});
function controlledRow(content,annotation,{entryPatch={},...options}={}){
 const r=row(content,options),log=JSON.parse(r.log_json);
 log.entries[0]={...log.entries[0],...entryPatch,vBeltReplacement:annotation};
 return{...r,log_json:JSON.stringify(log)};
}

test('R1 author control blocks V4 newly recognized Lime/parts-list text when unchecked, stale, or copied',()=>{
 for(const [content,tag] of [
  ['[TM작업]#2 BLR Limestone Blower #A V-Belt 손상 교체 요청\n→ Belt 전부 교체 완료. 차단기 투입 후 기동중','203HRJ01AN601'],
  ['10:45 Seal Pot Blower #C V-Belt 및 Suction Filter 교체 완료[TM작업]','204HHL10AN631']]){
  assert.equal(facts(row(content)).length,1,content);
  assert.deepEqual(facts(controlledRow(content,authorChoice(content,tag,{confirmed:false}))),[]);
  assert.deepEqual(facts(controlledRow(content,{...authorChoice(content,tag),content:'이전 본문'})),[]);
  assert.deepEqual(facts(controlledRow(content,authorChoice(content,tag),{entryPatch:{importedFromLogId:'another-diary'}})),[]);
  const selected=facts(controlledRow(content,authorChoice(content,tag,{completedTime:'11:20'})));
  assert.equal(selected.length,1);assert.equal(selected[0].tagNumber,tag);
  assert.equal(selected[0].sourceClockKind,'author_completion');
  assert.equal(Date.parse(selected[0].eventDate),Date.parse('2026-09-19T11:20:00+09:00'));
 }
});

test('R1 native PART/GROUP leaders may confirm explicitly while their V4 text-only records remain excluded',()=>{
 const content='FBHE Blower #A V-Belt 교체 완료';
 for(const role of ['PART_LEADER','GROUP_LEADER','파트장']){
  assert.deepEqual(facts(row(content,{role})),[]);
  const selected=facts(controlledRow(content,authorChoice(content,'104HHL60AP611'),{role,time:'09:58'}));
  assert.equal(selected.length,1,role);assert.equal(selected[0].sourceClockKind,'none');
  assert.equal(selected[0].timePrecision,'day');assert.equal(selected[0].originalSourceClock,'');
  assert.deepEqual(facts(controlledRow(content,authorChoice(content,'104HHL60AP611'),{role,entryPatch:{importedFromLogId:'other'}})),[]);
 }
});

test('R1 normalized leader roles return checked facts only and never parse an unannotated explicit-TAG sibling',()=>{
 const content='104HHL60AP611 V-Belt 교체 완료';
 for(const role of ['PART_LEADER','PARTLEADER','GROUP_LEADER','GROUPLEADER','SHIFT_LEADER','SHIFTLEADER','파트장']){
  const r=controlledRow(content,authorChoice(content,'104HHL60AP611'),{role});
  const log=JSON.parse(r.log_json);
  log.entries.push({id:'unannotated-other-belt',content:'104HHL60AP621 V-Belt 교체 완료'});
  const selected=facts({...r,log_json:JSON.stringify(log)});
  assert.equal(selected.length,1,role);assert.equal(selected[0].tagNumber,'104HHL60AP611');
  assert.match(selected[0].sourceKey,/author-confirmed-v1/);
 }
});

test('R1 explicit author identity/date override words without allowing V4 historical-reference fallback',()=>{
 const historical='[104HHL60AP621] FBHE Blower #B 25년 11월03일 마지막으로 Belt 교체 함';
 assert.deepEqual(facts(row(historical,{date:'2026-03-09',role:'BO1'})),[]);
 const selected=facts(controlledRow(historical,authorChoice(historical,'104HHL60AP621',{replacedOn:'2025-11-03'}),
  {date:'2026-03-09',role:'BO1',time:'10:10'}));
 assert.equal(selected.length,1);assert.equal(selected[0].recordDate,'2025-11-03');assert.equal(selected[0].timePrecision,'day');
 assert.equal(selected[0].eventDate,'2025-11-03T00:00:00+09:00');
 const content='10:10 유기성 고형연료 Blower 1-A Belt 교체 후 정상 기동 실시';
 const explicitlySelectedB=facts(controlledRow(content,authorChoice(content,'104SDF01AN002'),{role:'BO1'}));
 assert.equal(explicitlySelectedB.length,1);assert.equal(explicitlySelectedB[0].tagNumber,'104SDF01AN002');
 assert.match(explicitlySelectedB[0].sourceKey,/author-confirmed-v1/);
 assert.equal(explicitlySelectedB[0].timePrecision,'day');
});

test('R1 annotations on all27 direct V4 completions produce one selected fact and never borrow entry clocks',()=>{
 for(const asset of assets){
  const content=asset.tag_number+' V-Belt 교체 완료';
  const selected=facts(controlledRow(content,authorChoice(content,asset.tag_number),{time:'10:00'}));
  assert.equal(selected.length,1,asset.tag_number);assert.equal(selected[0].tagNumber,asset.tag_number);
  assert.equal(selected[0].timePrecision,'day');assert.equal(selected[0].originalSourceClock,'');
 }
});
