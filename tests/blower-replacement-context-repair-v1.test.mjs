import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Exercise the production parser, exposing internal functions only in memory.
const apiUrl = new URL('../functions/api/blower-history.js', import.meta.url);
const source = fs.readFileSync(apiUrl, 'utf8').replace(/from (["'])(\.\.?\/[^"']+)\1/g,
  (_, quote, relative) => 'from ' + JSON.stringify(new URL(relative, apiUrl).href));
const instrumented = await import('data:text/javascript;base64,' + Buffer.from(source + `
export const __replacementContextTest = { parseShiftLogFragments, v13ContextualizeScanFragments,
  v13ActualBeltReplacement, v13ResolveTargets, v13ContextualizeAuditRecords, v13EvaluateAuditRecord };
`).toString('base64'));
const api = instrumented.__replacementContextTest;

const definitions = [
  ...['104','204'].flatMap(prefix => [
    ...['611','621','631'].map((suffix,index) => [`${prefix}HHL60AP${suffix}`,'fbhe',prefix==='104'?'1':'2',`#${'ABC'[index]}`]),
    ...['611','621','631'].map((suffix,index) => [`${prefix}HHL10AN${suffix}`,'seal_pot',prefix==='104'?'1':'2',`#${'ABC'[index]}`]),
    ...['001','002'].map((suffix,index) => [`${prefix}SDF01AN${suffix}`,'organic_fuel',prefix==='104'?'1':'2',`#${'AB'[index]}`]),
    ...['601','602'].map((suffix,index) => [`${prefix}ETG30AN${suffix}`,'flyash_bag',prefix==='104'?'1':'2',`#${'AB'[index]}`])
  ]),
  ['104ETH03AN601','flyash_silo','shared','#A'],['104ETH03AN602','flyash_silo','shared','#B'],
  ['204LMDF01AN001','organic_fuel','2','#1'],
  ['103HRJ01AN601','limestone','1','#A'],['103HRJ01AN602','limestone','1','#B'],
  ['203HRJ01AN601','limestone','2','#A'],['203HRJ01AN602','limestone','2','#B']
];
const assets = definitions.map(([tag_number,blower_type,unit_no,position_label],index) => ({
  tag_number,blower_type,unit_no,position_label,enabled:1,sort_order:index,
  asset_group:tag_number==='204LMDF01AN001'?'manure':'',created_at:'2026-01-01T00:00:00Z'
}));
const actualCWork = '[TM] 09:23 FBHE Blower #C V-Blet 전체 교체 실시\n' +
  '- 교체운전 실시 (#C 정지, #B 기동)\n' +
  '- V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)\n' +
  '- FBHE Left Damper 조정 실시';
const actualSiloMixed = 'Fly Ash Silo Aeration Blower는 추후 Belt 교체 후 #B 기동 요망 → 1층 주방용 환기팬 Belt 교체 완료_TM 작업';

function rowFor(entries, role='BO2', date='2026-09-16') {
  return {id:'fixture-source',work_date:date,shift:'DS',role,status:'결재완료',
    log_json:JSON.stringify({id:'fixture-source',date,shift:'DS',role,status:'결재완료',
      entries:entries.map((entry,index) => typeof entry==='string'?{id:'entry-'+index,content:entry}:entry)})};
}
function candidates(row) {
  const raw=api.parseShiftLogFragments(row,assets);
  const fragments=api.v13ContextualizeScanFragments(raw,row,assets);
  return fragments.filter(f=>api.v13ActualBeltReplacement(f.sourceText,row.work_date,false)).flatMap(fragment=>{
    const record={sourceText:fragment.sourceText,identityText:fragment.identityText,
      role:fragment.sourceRole||row.role,workDate:row.work_date,v13Context:fragment.v13Context};
    return api.v13ResolveTargets(record,assets,assets).map(asset=>({tag:asset.tag_number,fragment}));
  });
}
const uniqueTags = items => [...new Set(items.map(item=>item.tag))].sort();

test('actual 9/16 C Belt heading owns its completion after C-stop/B-start operation selectors',()=>{
  const items=candidates(rowFor([actualCWork]));
  assert.deepEqual(uniqueTags(items),['204HHL60AP631']);
  const tail=items.find(item=>item.fragment.sourceText.startsWith('V-Belt 교체 및 Alignment'));
  assert.ok(tail,'the original completion remains a usable candidate');
  assert.equal(tail.fragment.sourceTime,'09:23');
  assert.equal(tail.fragment.sourceText,'V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)');
  assert.match(tail.fragment.v13EvidenceText,/#C V-Blet 전체 교체 실시/);
  assert.match(tail.fragment.v13EvidenceText,/V-Belt 교체 및 Alignment/);
});

test('the correctly spelled heading follows the same C ownership and retains raw spelling',()=>{
  assert.deepEqual(uniqueTags(candidates(rowFor([actualCWork.replace('V-Blet','V-Belt')]))),['204HHL60AP631']);
});

test('operation-only rows between separate canonical entries cannot transfer a Belt job to the startup asset',()=>{
  assert.deepEqual(uniqueTags(candidates(rowFor([
    {id:'work',time:'09:23',content:'FBHE Blower #C V-Blet 전체 교체 실시'},
    {id:'switch',time:'09:23',content:'교체운전 실시 (#C 정지, #B 기동)'},
    {id:'done',time:'09:23',content:'V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)'}
  ]))),['204HHL60AP631']);
});

test('a following unpositioned component note does not reintroduce the operation selector as work owner',()=>{
  const items=candidates(rowFor([
    'FBHE Blower #C V-Belt 교체 실시\n- 교체운전 (#C 정지, #B 기동)\n- FBHE Left Damper 조정 실시',
    'V-Belt 교체 완료'
  ]));
  assert.deepEqual(uniqueTags(items),['204HHL60AP631']);
});

test('a later explicit maintenance heading can change the job owner before a generic Belt completion',()=>{
  const items=candidates(rowFor([
    'FBHE Blower #C V-Belt 교체 완료\n- 교체운전 (#C 정지, #B 기동)\n- FBHE Blower #A 점검\n- V-Belt 교체 완료'
  ]));
  assert.deepEqual(uniqueTags(items),['204HHL60AP611','204HHL60AP631']);
});

test('C-to-B completion ownership is common to both units and FBHE/Seal Pot groups',()=>{
  for(const unit of ['1','2'])for(const [label,type]of [['FBHE','60AP'],['Seal Pot','10AN']]) {
    const text=`${unit}호기 ${label} Blower #C V-Belt 교체 실시\n- 교체운전 (#C 정지, #B 기동)\n- V-Belt 교체 완료`;
    assert.deepEqual(uniqueTags(candidates(rowFor([text],unit==='1'?'BO1':'BO2'))),[`${unit==='1'?'104':'204'}HHL${type}631`]);
  }
});

test('a later explicit Belt work target intentionally starts a new maintenance scope',()=>{
  const items=candidates(rowFor(['FBHE Blower #C V-Belt 교체 완료\n- #C 정지, #B 기동\n- FBHE Blower #A V-Belt 교체 완료\n- V-Belt 교체 및 Alignment 교정 후 정상']));
  assert.deepEqual(uniqueTags(items),['204HHL60AP611','204HHL60AP631']);
  assert.equal(items.findLast(item=>item.fragment.sourceText.startsWith('V-Belt 교체 및 Alignment')).tag,'204HHL60AP611');
});

test('actual Silo request plus a separate kitchen fan completion is not a Blower replacement',()=>{
  assert.equal(api.v13ActualBeltReplacement(actualSiloMixed,'2026-05-04',true),false);
  assert.deepEqual(candidates(rowFor([actualSiloMixed],'BCO1','2026-05-04')),[]);
  const contextual=api.v13ContextualizeAuditRecords([{sourceText:actualSiloMixed,role:'BCO1',workDate:'2026-05-04',sourceField:'entries[0].content'}],assets);
  assert.notEqual(api.v13EvaluateAuditRecord(contextual[0],assets).category,'confirmed');
});

test('foreign kitchen/ventilation fan work clears inherited Blower maintenance context',()=>{
  for(const foreign of ['1층 주방용 환기팬 Belt 교체 완료','주방 Vent Fan V-Belt 교체 완료','Ventilation Fan Belt 교체 완료']) {
    assert.deepEqual(candidates(rowFor([
      'Fly Ash Silo Aeration Blower #B Belt 교체 요망',foreign,'V-Belt 교체 완료'
    ],'BCO1','2026-05-04')),[]);
  }
});

test('a completed Blower clause can resolve its own request without borrowing foreign work',()=>{
  for(const suffix of ['',' → 1층 환기팬 Belt 교체 완료']) {
    const text='Fly Ash Silo Aeration Blower #B Belt 교체 요청 → Fly Ash Silo Aeration Blower #B Belt 교체 완료'+suffix;
    assert.equal(api.v13ActualBeltReplacement(text,'2026-05-04',true),true);
    assert.deepEqual(uniqueTags(candidates(rowFor([text],'BCO1','2026-05-04'))),['104ETH03AN602']);
  }
});

test('all 27 explicit managed TAGs retain normal direct replacement recognition',()=>{
  assert.equal(assets.length,27);
  for(const asset of assets) {
    const text=`${asset.tag_number} V-Belt 교체 완료`;
    assert.deepEqual(uniqueTags(candidates(rowFor([text],asset.unit_no==='1'?'BO1':'BO2'))),[asset.tag_number]);
  }
});

test('planned/unperformed Belt jobs and operation swaps alone do not become replacements',()=>{
  for(const text of ['FBHE Blower #B V-Belt 교체 미실시','FBHE Blower #B V-Belt 교체 예정',
    'FBHE Blower #C 정지, #B 기동 교체운전 실시','FBHE Blower #B Oil 주입구 연결 파이프 교체 완료']) {
    assert.deepEqual(candidates(rowFor([text])),[]);
  }
});
