import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {collectApprovedReplacementFacts} from '../functions/_shared/blower-replacement-facts-v3.js';

const apiUrl = new URL('../functions/api/blower-history.js',import.meta.url);
const source = fs.readFileSync(apiUrl,'utf8').replace(/from (["'])(\.\.?\/[^"']+)\1/g,
  (_,quote,relative) => 'from '+JSON.stringify(new URL(relative,apiUrl).href));
const {__factsAdapters:adapters} = await import('data:text/javascript;base64,'+Buffer.from(source+`
export const __factsAdapters = {
  parseFragments:parseShiftLogFragments,contextualizeFragments:v13ContextualizeScanFragments,
  sourceText:fragmentSourceText,identityText:fragmentIdentityText,sourceRole:fragmentSourceRole,
  sourceTime:fragmentSourceTime,resolveTargets:v13ResolveTargets,actualBeltReplacement:v13ActualBeltReplacement,
  detectDateTime:detectionDateTime,normalizeTime:normalizeCanonicalEntryTime
};`).toString('base64'));
const definitions = [
  ...['104','204'].flatMap(prefix=>[
    ...['611','621','631'].map((suffix,index)=>[`${prefix}HHL60AP${suffix}`,'fbhe',prefix==='104'?'1':'2',`#${'ABC'[index]}`]),
    ...['611','621','631'].map((suffix,index)=>[`${prefix}HHL10AN${suffix}`,'seal_pot',prefix==='104'?'1':'2',`#${'ABC'[index]}`]),
    ...['001','002'].map((suffix,index)=>[`${prefix}SDF01AN${suffix}`,'organic_fuel',prefix==='104'?'1':'2',`#${'AB'[index]}`]),
    ...['601','602'].map((suffix,index)=>[`${prefix}ETG30AN${suffix}`,'flyash_bag',prefix==='104'?'1':'2',`#${'AB'[index]}`])
  ]),
  ['104ETH03AN601','flyash_silo','shared','#A'],['104ETH03AN602','flyash_silo','shared','#B'],
  ['204LMDF01AN001','organic_fuel','2','#1'],
  ['103HRJ01AN601','limestone','1','#A'],['103HRJ01AN602','limestone','1','#B'],
  ['203HRJ01AN601','limestone','2','#A'],['203HRJ01AN602','limestone','2','#B']
];
const assets=definitions.map(([tag_number,blower_type,unit_no,position_label],sort_order)=>({
  tag_number,blower_type,unit_no,position_label,sort_order,enabled:1,
  asset_group:tag_number==='204LMDF01AN001'?'manure':'',created_at:'2026-01-01T00:00:00Z'
}));
function rowFor(entries,{id='fixture-approved-source',date='2026-09-16',role='BO2',shift='DS',status='결재완료'}={}) {
  return {id,work_date:date,role,shift,status,log_json:JSON.stringify({id,date,role,shift,status,
    entries:entries.map((entry,index)=>typeof entry==='string'?{id:'entry-'+index,content:entry}:entry)})};
}
const facts=row=>collectApprovedReplacementFacts(row,assets,adapters);

test('actual BO2 September16 C-work title and later completion yield a C day fact, not B or 09:23 completion',()=>{
  const row=rowFor([{id:'legacy-entry-POCHEON#20260916#DAY#BO2-2-0',time:'',content:
    '[TM] 09:23 FBHE Blower #C V-Blet 전체 교체 실시\n- 교체운전 실시 (#C 정지, #B 기동)\n'+
    '- V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)\n- FBHE Left Damper 조정 실시'}],
    {id:'legacy-POCHEON#20260916#DAY#BO2'});
  const before=JSON.stringify(row),out=facts(row);
  assert.equal(out.length,1);assert.equal(out[0].tagNumber,'204HHL60AP631');
  assert.equal(out[0].timePrecision,'day');assert.equal(out[0].eventDate,'2026-09-16T00:00:00+09:00');
  assert.equal(out[0].originalSourceClock,'09:23');assert.equal(out[0].sourceClockKind,'work_context');
  assert.match(out[0].sourceText,/#C V-Blet 전체 교체 실시/);
  assert.ok(out[0].candidateTexts.length>=1 && out[0].candidateTexts.length<=3);
  assert.ok(out[0].candidateTexts.includes(out[0].sourceText));
  assert.equal(JSON.stringify(row),before);
});

test('actual BCO2 September16 changeover clock is not borrowed by its C completion subline',()=>{
  const out=facts(rowFor([{id:'legacy-entry-POCHEON#20260916#DAY#BCO2-2-0',time:'09:23',
    content:'FBHE Blower #C->#B 교체운전 실시\n- FBHE Blower #C V-Belt 교체 완료(동일->TR)\n- FBHE Left Damper 조정 실시'}],{role:'BCO2'}));
  assert.equal(out.length,1);assert.equal(out[0].tagNumber,'204HHL60AP631');
  assert.equal(out[0].timePrecision,'day');assert.equal(out[0].originalSourceClock,'09:23');
});

test('actual FBHE1A September4 broken-belt/changeover clock is not an exact completion clock',()=>{
  const out=facts(rowFor([{id:'legacy-entry-POCHEON#20260904#DAY#BCO1-2-1',time:'10:39',content:
    'FBHE Blower #A → #C 교체운전실시\n- Blower #A V-Belt 1개소 끊어짐 발생\n'+
    '- 선풍기 이동설치(#A → #C)\n- #A V-Belt 교체완료 및 Stand By'}],{date:'2026-09-04',role:'BCO1'}));
  assert.equal(out.length,1);assert.equal(out[0].tagNumber,'104HHL60AP611');
  assert.equal(out[0].timePrecision,'day');assert.equal(out[0].originalSourceClock,'10:39');
});

test('actual approved Seal1A standalone 09:58 completion is a minute fact',()=>{
  const out=facts(rowFor([{id:'entry-d5944210-8b76-43ba-a3ab-45bcc55ed93c',time:'09:58',
    content:'Seal Pot Blower #A V-Belt 교체 완료 현재 Stand-by 상태'}],
    {id:'9640da07-1a5b-4806-8a38-aa7da59765a5',date:'2026-08-03',role:'BO1'}));
  assert.equal(out.length,1);assert.equal(out[0].tagNumber,'104HHL10AN611');
  assert.equal(out[0].timePrecision,'minute');assert.equal(Date.parse(out[0].eventDate),Date.parse('2026-08-03T09:58:00+09:00'));
  assert.equal(out[0].sourceClockKind,'entry_completion');
});

test('all 27 directly completed managed TAGs preserve their explicit canonical completion clocks',()=>{
  assert.equal(assets.length,27);
  for(const asset of assets) {
    const out=facts(rowFor([{id:'complete-'+asset.tag_number,time:'10:00',content:asset.tag_number+' V-Belt 교체 완료'}],
      {role:asset.unit_no==='1'?'BO1':'BO2'}));
    assert.equal(out.length,1,asset.tag_number);assert.equal(out[0].tagNumber,asset.tag_number);
    assert.equal(out[0].timePrecision,'minute');
    assert.equal(Date.parse(out[0].eventDate),Date.parse('2026-09-16T10:00:00+09:00'));
  }
});

test('completed Belt without a clock yields an automatic day fact rather than an invented clock or no fact',()=>{
  const out=facts(rowFor(['104HHL60AP611 V-Belt 교체 완료'],{role:'BCO1'}));
  assert.equal(out.length,1);assert.equal(out[0].timePrecision,'day');
  assert.equal(out[0].originalSourceClock,'');assert.equal(out[0].sourceClockKind,'none');
  assert.equal(out[0].eventDate,'2026-09-16T00:00:00+09:00');
});

test('explicitly clocked completion after an untimed heading uses its own completion clock',()=>{
  const out=facts(rowFor([{time:'09:23',content:'FBHE Blower #C V-Belt 교체 작업\n- 11:07 #C V-Belt 교체 완료'}]));
  assert.equal(out.length,1);assert.equal(out[0].timePrecision,'minute');
  assert.equal(Date.parse(out[0].eventDate),Date.parse('2026-09-16T11:07:00+09:00'));
  assert.equal(out[0].sourceClockKind,'own_completion');
});

test('an A completion clock cannot time a separate B completion sharing its entry',()=>{
  const out=facts(rowFor([{time:'10:00',content:'FBHE Blower #A V-Belt 교체 완료\n- #B V-Belt 교체 완료'}]));
  const a=out.find(item=>item.tagNumber==='204HHL60AP611'),b=out.find(item=>item.tagNumber==='204HHL60AP621');
  assert.equal(a.timePrecision,'minute');assert.equal(b.timePrecision,'day');
});

test('work ranges and multiple entry clocks are day facts rather than the first clock presented as completion',()=>{
  for(const entry of [{time:'',content:'104HHL60AP611 V-Belt 교체 완료 (10:00~15:00)'},
    {time:'10:00, 15:00',content:'104HHL60AP611 V-Belt 교체 완료'}]) {
    const out=facts(rowFor([entry],{role:'BCO1'}));
    assert.equal(out.length,1);assert.equal(out[0].timePrecision,'day');
  }
});

test('night-shift explicit completion after midnight advances the calendar date only when a real clock exists',()=>{
  const timed=facts(rowFor([{time:'02:13',content:'104HHL60AP611 V-Belt 교체 완료'}],{date:'2026-11-02',shift:'NS',role:'BCO1'}))[0];
  assert.equal(timed.recordDate,'2026-11-02');assert.equal(Date.parse(timed.eventDate),Date.parse('2026-11-03T02:13:00+09:00'));
  const untimed=facts(rowFor(['104HHL60AP611 V-Belt 교체 완료'],{date:'2026-11-02',shift:'NS',role:'BCO1'}))[0];
  assert.equal(untimed.timePrecision,'day');assert.equal(untimed.recordDate,'2026-11-02');
});

test('actual Silo May4 foreign-fan work and May9 attachment/Trip records produce no replacement facts',()=>{
  for(const content of [
    'Fly Ash Silo Aeration Blower는 추후 Belt 교체 후 #B 기동 요망 → 1층 주방용 환기팬 Belt 교체 완료_TM 작업',
    'Fly Ash Silo Aeration Blower #A, B V-Belt 체결작업 완요\n- #B 풀리 고정볼트 없음 기동 불가(차단기 OFF 상태)',
    'Fly Ash Silo Aeration Blower #A, B V-Belt 체결작업 → Trip\n- #B 풀리 고정볼트 없음 기동 불가'
  ])assert.deepEqual(facts(rowFor([content],{date:'2026-05-09',role:'BCO2'})),[]);
});

test('whole-Blower exchange and neighboring Rotary Feeder clocks are not Belt replacement facts',()=>{
  assert.deepEqual(facts(rowFor([{time:'',content:'[TM작업]#1 BLR 유기성 고형연료 Blower #A 교체완료\n- 교체전 : 44A, 0.5 Bar / 교체후 : 38A, 0.45 Bar'},
    {time:'10:07',content:'#1 BLR Bio Rotary Feeder #A Motor 및 감속기 교체완료(10:07~15:50)'}],
    {date:'2026-08-20',role:'BCO1'})),[]);
});

test('draft/unapproved/leader-only logs and planned work cannot authorize a fact',()=>{
  for(const status of ['작성중','임시저장','반려',''])assert.deepEqual(facts(rowFor(['104HHL60AP611 V-Belt 교체 완료'],{status})),[]);
  assert.deepEqual(facts(rowFor(['104HHL60AP611 V-Belt 교체 완료'],{role:'파트장'})),[]);
  assert.deepEqual(collectApprovedReplacementFacts(rowFor(['104HHL60AP611 V-Belt 교체 완료']),assets,
    {...adapters,normalizeRole:()=> 'PART_LEADER'}),[]);
  for(const content of ['104HHL60AP611 V-Belt 교체 예정','104HHL60AP611 V-Belt 교체 미실시',
    'FBHE Blower #A 정지, #B 기동 교체운전 완료','FBHE Blower #A Oil 주입구 연결 파이프 교체 완료'])assert.deepEqual(facts(rowFor([content])),[]);
});

test('facts and source keys are deterministic, do not mutate source/assets, and reject invalid dates',()=>{
  const row=rowFor([{id:'stable-source-entry',time:'09:58',tag:'104HHL10AN611',content:'Seal Pot Blower #A V-Belt 교체 완료'}],{role:'BCO1'});
  const before=JSON.stringify({row,assets});assert.deepEqual(facts(row),facts(row));
  assert.equal(JSON.stringify({row,assets}),before);
  for(const date of ['2026-99-99','2026-02-31','invalid'])assert.deepEqual(facts(rowFor(['104HHL60AP611 V-Belt 교체 완료'],{date})),[]);
  assert.throws(()=>collectApprovedReplacementFacts(row,assets,{}),/Missing replacement fact adapter/);
});

test('a long entry and unrelated later text edits preserve the same physical completion key',()=>{
  const entry={id:'stable-long-entry',time:'10:00',content:'104HHL60AP611 V-Belt 교체 완료\n'+('무관한 운전 기록 '.repeat(30))};
  const first=facts(rowFor([entry],{role:'BCO1'}));
  const changed=facts(rowFor([{...entry,content:entry.content+'\n다른 펌프 점검 완료'}],{role:'BCO1'}));
  assert.equal(first.length,1);assert.equal(changed.length,1);assert.equal(first[0].sourceKey,changed[0].sourceKey);
  assert.notEqual(first[0].sourceText,changed[0].sourceText);
  const clockEdit=facts(rowFor([{...entry,time:'11:00'}],{role:'BCO1'}));
  assert.equal(first[0].sourceKey,clockEdit[0].sourceKey);
  assert.notEqual(first[0].eventDate,clockEdit[0].eventDate);
});

test('two explicitly clocked completions for the same TAG retain distinct physical clause keys',()=>{
  const out=facts(rowFor([{id:'two-completions',content:'10:00 104HHL60AP611 V-Belt 교체 완료\n11:00 104HHL60AP611 V-Belt 교체 완료'}],{role:'BCO1'}));
  assert.equal(out.length,2);assert.notEqual(out[0].sourceKey,out[1].sourceKey);
  assert.notEqual(out[0].eventDate,out[1].eventDate);
});

test('a performed-work heading plus its completed continuation is one fact rather than a duplicate fallback job',()=>{
  const out=facts(rowFor([{id:'one-completion',content:'FBHE Blower #C V-Belt 교체 실시 → V-Belt 교체 완료'}]));
  assert.equal(out.length,1);assert.equal(out[0].tagNumber,'204HHL60AP631');assert.equal(out[0].timePrecision,'day');
});

test('candidate texts retain the earliest native work-heading evidence for the same entry and TAG',()=>{
  const header='09:23 FBHE Blower #C V-Blet 전체 교체 실시';
  const done='V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)';
  const origin='[TM] '+header+'\n- 교체운전 실시 (#C 정지, #B 기동)\n- '+done;
  const out=facts(rowFor([{id:'native-excluded-work',content:origin}]));
  assert.equal(out.length,1);assert.equal(out[0].tagNumber,'204HHL60AP631');
  assert.equal(out[0].candidateTexts.length,3);
  assert.deepEqual(out[0].candidateTexts,[done,header,origin]);
  const unrelated=facts(rowFor([{id:'prior-other-entry',content:'FBHE Blower #A V-Belt 교체 실시'},
    {id:'native-excluded-work',content:origin}]));
  assert.equal(unrelated.length,2);assert.deepEqual(unrelated.find(item=>item.tagNumber==='204HHL60AP631').candidateTexts,[done,header,origin]);
});

test('standalone positive performed replacements are automatic day facts without promoting a work clock to completion',()=>{
  for(const verb of ['교체 실시','교체 시행','교체 함','교체 하였음','교체 했음','REPLACED','EXCHANGED']) {
    const out=facts(rowFor([{time:'10:00',content:'104HHL60AP611 V-Belt '+verb}],{role:'BCO1'}));
    assert.equal(out.length,1,verb);assert.equal(out[0].tagNumber,'104HHL60AP611');assert.equal(out[0].timePrecision,'day');
    assert.equal(out[0].originalSourceClock,'10:00');assert.equal(out[0].sourceClockKind,'work_context');
  }
});

test('completed new-belt installation remains an automatic performed fact through existing recognition',()=>{
  for(const content of ['104HHL60AP611 신품 V-Belt 설치 완료','104HHL60AP611 V-Belt 신품 장착 완료']) {
    const out=facts(rowFor([{time:'10:00',content}],{role:'BCO1'}));
    assert.equal(out.length,1,content);assert.equal(out[0].tagNumber,'104HHL60AP611');assert.equal(out[0].timePrecision,'day');
  }
});

test('planned, unperformed, started or in-progress statements never become performed facts',()=>{
  for(const suffix of ['교체 실시 예정','교체 시행 준비','교체 미실시','교체 작업 중','교체 작업 시작',
    '교체 실시 여부 확인','교체 실시 후 작업 진행 중','NOT REPLACED','REPLACED planned']) {
    assert.deepEqual(facts(rowFor([{time:'10:00',content:'104HHL60AP611 V-Belt '+suffix}],{role:'BCO1'})),[],suffix);
  }
});

test('a performed replacement in another entry remains independent of a later explicit completion',()=>{
  const out=facts(rowFor([{id:'performed-job',time:'09:00',content:'104HHL60AP611 V-Belt 교체 실시'},
    {id:'completed-job',time:'11:00',content:'104HHL60AP611 V-Belt 교체 완료'}],{role:'BCO1'}));
  assert.equal(out.length,2);assert.notEqual(out[0].sourceKey,out[1].sourceKey);
  assert.equal(out.find(item=>item.sourceEntryId==='performed-job').timePrecision,'day');
  assert.equal(out.find(item=>item.sourceEntryId==='completed-job').timePrecision,'minute');
});
