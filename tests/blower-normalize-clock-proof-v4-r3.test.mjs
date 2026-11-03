import test from 'node:test';
import assert from 'node:assert/strict';
import { replacementAutoCycleProof } from '../functions/_shared/blower-replacement-auto-v3.js';
import { __blowerHistoryTest as api } from '../functions/api/blower-history.js';
// Exact Bag A/B asset, owned DataPARC receipt, active replacement owner, and
// minute/day confirmations from the saved 2026-11-04 offline actual-data replay.
// These are fixed evidence rows; this test performs no network or database write.
const ACTUAL=[{"asset":{"tag_number":"104ETG30AN601","blower_type":"flyash_bag","unit_no":"1","position_label":"#A","display_name":"#1 Fly Ash Bag Filter Aeration Blower #A","sort_order":501,"enabled":1,"last_replacement_at":"2026-09-25T05:40:00.000Z","runtime_hours":945.5255555555556,"runtime_anchor_at":"2026-11-03T15:12:58.000Z","is_running":1,"last_modified_by_id":"2014081","last_modified_by_name":"이휘근","created_at":"2026-08-26T00:23:08.335Z","updated_at":"2026-11-03T15:13:42.671Z","asset_group":"","asset_revision":"","cycle_started_at":null,"cycle_start_state":"pending","cycle_start_revision":"d9d013fe-f009-454d-a948-38f99097788a","cycle_runtime_hours":945.5255555555556,"cycle_runtime_anchor_at":"2026-11-03T15:12:58.000Z","cycle_runtime_state":"running","cycle_runtime_revision":"8cabb6e3-4e8d-4247-ace2-9ac7fae367dc","limestone_basis_confirmation":""},"events":[{"id":"bddd4557-5970-401d-b938-e8de0375437c","tag_number":"104ETG30AN601","event_type":"replacement","event_date":"2026-09-25T05:40:00.000Z","runtime_hours":3312.145,"issue_type":"정기주기","action_type":"V-Belt 교체","note":"최신화 시 업무일지의 확정 V-Belt 교체 자동반영","source_type":"shift_log_auto","source_log_id":"legacy-POCHEON#20260925#DAY#BCO1","source_text":"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 완료_TM 작업","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-10-20T09:20:26.766Z","updated_at":"2026-10-20T09:20:26.766Z"},{"id":"dataparc_runtime:brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_02","tag_number":"104ETG30AN601","event_type":"runtime_correction","event_date":"2026-11-03T15:12:58.000Z","runtime_hours":945.5255555555556,"issue_type":"DataPARC","action_type":"DataPARC 운전중 동기화","note":"DataPARC 증분조회 2026-11-03T13:56:34.000Z ~ 2026-11-03T15:12:58.000Z · 추가 1.2733333333333334시간 · 누적 945.5255555555556시간","source_type":"dataparc_runtime","source_log_id":"brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_02","source_text":"{\"schemaVersion\":1,\"requestType\":\"blower_runtime_probe\",\"requestId\":\"brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_02\",\"assetTag\":\"104ETG30AN601\",\"dataParcTag\":\"GSPOGE.ABB_DCS.103ETG30AN601XJ04\",\"startAt\":\"2026-11-03T13:56:34.000Z\",\"endAt\":\"2026-11-03T15:12:58.000Z\",\"observedAt\":\"2026-11-03T15:12:58.000Z\",\"expectedLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"expectedCycleStartState\":\"legacy\",\"expectedCycleStartedAt\":\"\",\"expectedCycleStartRevision\":\"d9d013fe-f009-454d-a948-38f99097788a\",\"expectedCycleRuntimeRevision\":\"4e07bee2-bb7b-413f-b8a9-f8b927d03c2d\",\"startState\":\"running\",\"endState\":\"running\",\"totalRunningHours\":1.273333,\"runningSeconds\":4584,\"chunkCount\":1,\"collectedAt\":\"2026-11-03T15:13:31.879Z\",\"signalOnlyCycle\":true,\"incremental\":{\"version\":1,\"baseEventId\":\"dataparc_runtime:brb1_a1346944-fcc6-4232-8da2-172293604fb3_27_02\",\"baseObservedAt\":\"2026-11-03T13:56:34.000Z\",\"coverageStartAt\":\"2026-09-25T05:40:00.000Z\",\"baseRunningSeconds\":3399308,\"deltaRunningSeconds\":4584,\"totalRunningSeconds\":3403892}}","created_by_id":"2014081","created_by_name":"이휘근","created_at":"2026-11-03T15:13:42.671Z","updated_at":"2026-11-03T15:13:42.671Z"},{"id":"replacement-auto-v3:confirm:2544ad3a82d811125b15016228a4b49391cf6e411f9eae428940fd1fac61a568","tag_number":"104ETG30AN601","event_type":"cycle_source_reconcile","event_date":"2026-11-03T15:43:00.000Z","runtime_hours":0,"issue_type":"업무일지 교체완료","action_type":"교체 근거 재해석","note":"승인 업무일지 교체완료를 기존 등록 교체와 대조·자동 확인 · 누적시간과 Cycle 변경 없음","source_type":"shift_log_auto_v3","source_log_id":"legacy-POCHEON#20260925#DAY#BCO1","source_text":"{\"schemaVersion\":3,\"replacementAutoV3\":true,\"currentCycle\":true,\"confirmationOnly\":true,\"replacementEventId\":\"bddd4557-5970-401d-b938-e8de0375437c\",\"currentLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"timePrecision\":\"minute\",\"recordDate\":\"2026-09-25\",\"registeredBaseline\":false,\"cycleStartRevision\":\"d9d013fe-f009-454d-a948-38f99097788a\",\"cycleRuntimeRevision\":\"8cabb6e3-4e8d-4247-ace2-9ac7fae367dc\",\"sourceKey\":\"[\\\"legacy-POCHEON#20260925#DAY#BCO1\\\",\\\"104ETG30AN601\\\",\\\"legacy-entry-POCHEON#20260925#DAY#BCO1-2-5\\\",0]\",\"sourcePhysicalId\":\"POCHEON#20260925#DAY#BCO1\",\"sourceSnapshotSha256\":\"3af0a328e4ae20873d498c871c07a1ad21801e5e692e85fc135afc150e88ddb4\",\"sourceText\":\"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 완료_TM 작업\"}","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-11-03T15:43:00.000Z","updated_at":"2026-11-03T15:43:00.000Z"},{"id":"replacement-auto-v3:confirm:96a399ebc5a5533cbdc0db3f04312a576cbeb4475eedb722c8f254243fcc55a6","tag_number":"104ETG30AN601","event_type":"cycle_source_reconcile","event_date":"2026-11-03T15:43:00.000Z","runtime_hours":0,"issue_type":"업무일지 교체완료","action_type":"교체 근거 재해석","note":"승인 업무일지 교체완료를 기존 등록 교체와 대조·자동 확인 · 누적시간과 Cycle 변경 없음","source_type":"shift_log_auto_v3","source_log_id":"legacy-POCHEON#20260925#DAY#BO1","source_text":"{\"schemaVersion\":3,\"replacementAutoV3\":true,\"currentCycle\":true,\"confirmationOnly\":true,\"replacementEventId\":\"bddd4557-5970-401d-b938-e8de0375437c\",\"currentLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"timePrecision\":\"day\",\"recordDate\":\"2026-09-25\",\"registeredBaseline\":true,\"cycleStartRevision\":\"d9d013fe-f009-454d-a948-38f99097788a\",\"cycleRuntimeRevision\":\"8cabb6e3-4e8d-4247-ace2-9ac7fae367dc\",\"sourceKey\":\"[\\\"legacy-POCHEON#20260925#DAY#BO1\\\",\\\"104ETG30AN601\\\",\\\"legacy-entry-POCHEON#20260925#DAY#BO1-2-0\\\",0]\",\"sourcePhysicalId\":\"POCHEON#20260925#DAY#BO1\",\"sourceSnapshotSha256\":\"b274a286197d8af946dbca5881e67a16fd607bdfd9c5c4760df6866b645c2046\",\"normalizationVersion\":4,\"registeredRuntimeRange\":true,\"basisKind\":\"verified_runtime_range\",\"rangeTrackingAllowed\":true,\"rangeStartAt\":\"2026-09-25T05:40:00.000Z\",\"preservedRuntimeEventId\":\"dataparc_runtime:brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_02\",\"sourceText\":\"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 실시\"}","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-11-03T15:43:00.000Z","updated_at":"2026-11-03T15:43:00.000Z"}]},{"asset":{"tag_number":"104ETG30AN602","blower_type":"flyash_bag","unit_no":"1","position_label":"#B","display_name":"#1 Fly Ash Bag Filter Aeration Blower #B","sort_order":502,"enabled":1,"last_replacement_at":"2026-09-25T05:40:00.000Z","runtime_hours":400.1322222222222,"runtime_anchor_at":"2026-11-03T15:12:58.000Z","is_running":1,"last_modified_by_id":"2014081","last_modified_by_name":"이휘근","created_at":"2026-08-26T00:23:08.335Z","updated_at":"2026-11-03T15:13:42.724Z","asset_group":"","asset_revision":"","cycle_started_at":"2026-10-17T23:04:00.000Z","cycle_start_state":"started","cycle_start_revision":"c98c5f4f-1ee0-47a9-8bf6-360e68f51ace","cycle_runtime_hours":400.1322222222222,"cycle_runtime_anchor_at":"2026-11-03T15:12:58.000Z","cycle_runtime_state":"running","cycle_runtime_revision":"cf652210-4172-4a0d-85ad-2535de02312e","limestone_basis_confirmation":""},"events":[{"id":"1e50d394-5719-4bae-9456-8008df1ee0ea","tag_number":"104ETG30AN602","event_type":"replacement","event_date":"2026-09-25T05:40:00.000Z","runtime_hours":3270.692777777778,"issue_type":"정기주기","action_type":"V-Belt 교체","note":"최신화 시 업무일지의 확정 V-Belt 교체 자동반영","source_type":"shift_log_auto","source_log_id":"legacy-POCHEON#20260925#DAY#BCO1","source_text":"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 완료_TM 작업","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-10-20T09:20:27.067Z","updated_at":"2026-10-20T09:20:27.067Z"},{"id":"dataparc_runtime:brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_03","tag_number":"104ETG30AN602","event_type":"runtime_correction","event_date":"2026-11-03T15:12:58.000Z","runtime_hours":400.1322222222222,"issue_type":"DataPARC","action_type":"DataPARC 운전중 동기화","note":"DataPARC 증분조회 2026-11-03T13:56:34.000Z ~ 2026-11-03T15:12:58.000Z · 추가 1.2733333333333334시간 · 누적 400.1322222222222시간","source_type":"dataparc_runtime","source_log_id":"brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_03","source_text":"{\"schemaVersion\":1,\"requestType\":\"blower_runtime_probe\",\"requestId\":\"brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_03\",\"assetTag\":\"104ETG30AN602\",\"dataParcTag\":\"GSPOGE.ABB_DCS.103ETG30AN602XJ04\",\"startAt\":\"2026-11-03T13:56:34.000Z\",\"endAt\":\"2026-11-03T15:12:58.000Z\",\"observedAt\":\"2026-11-03T15:12:58.000Z\",\"expectedLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"expectedCycleStartState\":\"started\",\"expectedCycleStartedAt\":\"2026-10-17T23:04:00.000Z\",\"expectedCycleStartRevision\":\"c98c5f4f-1ee0-47a9-8bf6-360e68f51ace\",\"expectedCycleRuntimeRevision\":\"1690921b-aa8c-44e1-a7b0-31741d2fbc57\",\"startState\":\"running\",\"endState\":\"running\",\"totalRunningHours\":1.273333,\"runningSeconds\":4584,\"chunkCount\":1,\"collectedAt\":\"2026-11-03T15:13:31.926Z\",\"incremental\":{\"version\":1,\"baseEventId\":\"dataparc_runtime:brb1_a1346944-fcc6-4232-8da2-172293604fb3_27_03\",\"baseObservedAt\":\"2026-11-03T13:56:34.000Z\",\"coverageStartAt\":\"2026-10-17T23:04:00.000Z\",\"baseRunningSeconds\":1435892,\"deltaRunningSeconds\":4584,\"totalRunningSeconds\":1440476}}","created_by_id":"2014081","created_by_name":"이휘근","created_at":"2026-11-03T15:13:42.724Z","updated_at":"2026-11-03T15:13:42.724Z"},{"id":"replacement-auto-v3:confirm:7e5aea13ea9fea6fdc03dea9b13c93d863f4667552a83b088f59190bf1633c0a","tag_number":"104ETG30AN602","event_type":"cycle_source_reconcile","event_date":"2026-11-03T15:43:00.000Z","runtime_hours":0,"issue_type":"업무일지 교체완료","action_type":"교체 근거 재해석","note":"승인 업무일지 교체완료를 기존 등록 교체와 대조·자동 확인 · 누적시간과 Cycle 변경 없음","source_type":"shift_log_auto_v3","source_log_id":"legacy-POCHEON#20260925#DAY#BCO1","source_text":"{\"schemaVersion\":3,\"replacementAutoV3\":true,\"currentCycle\":true,\"confirmationOnly\":true,\"replacementEventId\":\"1e50d394-5719-4bae-9456-8008df1ee0ea\",\"currentLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"timePrecision\":\"minute\",\"recordDate\":\"2026-09-25\",\"registeredBaseline\":false,\"cycleStartRevision\":\"c98c5f4f-1ee0-47a9-8bf6-360e68f51ace\",\"cycleRuntimeRevision\":\"cf652210-4172-4a0d-85ad-2535de02312e\",\"sourceKey\":\"[\\\"legacy-POCHEON#20260925#DAY#BCO1\\\",\\\"104ETG30AN602\\\",\\\"legacy-entry-POCHEON#20260925#DAY#BCO1-2-5\\\",0]\",\"sourcePhysicalId\":\"POCHEON#20260925#DAY#BCO1\",\"sourceSnapshotSha256\":\"3af0a328e4ae20873d498c871c07a1ad21801e5e692e85fc135afc150e88ddb4\",\"sourceText\":\"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 완료_TM 작업\"}","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-11-03T15:43:00.000Z","updated_at":"2026-11-03T15:43:00.000Z"},{"id":"replacement-auto-v3:confirm:89a56c38035b250f158d57e68a436bc1fd1be0d56ef3d5a7f9e950250e3b091f","tag_number":"104ETG30AN602","event_type":"cycle_source_reconcile","event_date":"2026-11-03T15:43:00.000Z","runtime_hours":0,"issue_type":"업무일지 교체완료","action_type":"교체 근거 재해석","note":"승인 업무일지 교체완료를 기존 등록 교체와 대조·자동 확인 · 누적시간과 Cycle 변경 없음","source_type":"shift_log_auto_v3","source_log_id":"legacy-POCHEON#20260925#DAY#BO1","source_text":"{\"schemaVersion\":3,\"replacementAutoV3\":true,\"currentCycle\":true,\"confirmationOnly\":true,\"replacementEventId\":\"1e50d394-5719-4bae-9456-8008df1ee0ea\",\"currentLastReplacementAt\":\"2026-09-25T05:40:00.000Z\",\"timePrecision\":\"day\",\"recordDate\":\"2026-09-25\",\"registeredBaseline\":true,\"cycleStartRevision\":\"c98c5f4f-1ee0-47a9-8bf6-360e68f51ace\",\"cycleRuntimeRevision\":\"cf652210-4172-4a0d-85ad-2535de02312e\",\"sourceKey\":\"[\\\"legacy-POCHEON#20260925#DAY#BO1\\\",\\\"104ETG30AN602\\\",\\\"legacy-entry-POCHEON#20260925#DAY#BO1-2-0\\\",0]\",\"sourcePhysicalId\":\"POCHEON#20260925#DAY#BO1\",\"sourceSnapshotSha256\":\"b274a286197d8af946dbca5881e67a16fd607bdfd9c5c4760df6866b645c2046\",\"normalizationVersion\":4,\"registeredRuntimeRange\":true,\"basisKind\":\"verified_runtime_range\",\"rangeTrackingAllowed\":true,\"rangeStartAt\":\"2026-10-17T23:04:00.000Z\",\"preservedRuntimeEventId\":\"dataparc_runtime:brb1_a918bc50-2b31-4460-9e05-aabc8c4cc78e_27_03\",\"sourceText\":\"Bag Filter Fly Ash Aeration Blower #A,B V-Belt 교체 실시\"}","created_by_id":"latest_replacement_auto","created_by_name":"업무일지 최신화 V-Belt 자동반영","created_at":"2026-11-03T15:43:00.000Z","updated_at":"2026-11-03T15:43:00.000Z"}]}];
const copy = index => structuredClone(ACTUAL[index]);
const metadata = row => JSON.parse(row.source_text);
const minute = f => f.events.find(row => row.event_type === 'cycle_source_reconcile' && metadata(row).timePrecision === 'minute');
const day = f => f.events.find(row => row.event_type === 'cycle_source_reconcile' && metadata(row).timePrecision === 'day');
const receipt = f => f.events.find(row => row.source_type === 'dataparc_runtime');
const patchSource = (row, patch) => { row.source_text = JSON.stringify({ ...metadata(row), ...patch }); };
const proof = f => replacementAutoCycleProof(f.asset, f.events);
const settings = { flyash_bag: { cycleDays: null, warningDays: null, criticalDays: null } };
async function project(f) {
  const immutable = JSON.stringify(f);
  let reads = 0;
  const db = { prepare(sql) {
    assert.match(sql, /^\s*SELECT\b/i);
    assert.match(sql, /FROM blower_history_events/);
    return { values: [], bind(...values) { this.values = values; return this; }, async all() {
      reads++;
      return { results: structuredClone(f.events).sort((a,b) => b.created_at.localeCompare(a.created_at) ||
        b.event_date.localeCompare(a.event_date) || b.id.localeCompare(a.id)) };
    }, async run() { assert.fail('Read projection attempted a write'); } };
  }, async batch() { assert.fail('Read projection attempted a batch'); } };
  const rows = await api.loadAssetStates(db, settings, { assetRows: [structuredClone(f.asset)], skipDecorations: true });
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(f), immutable, 'Projection must not modify saved assets or events');
  assert.equal(rows.length, 1);
  return rows[0];
}
const assertNoReset = p => {
  assert.equal(p.freshQueryEligible, false);
  assert.equal(p.rangeQueryEligible, false);
  assert.equal(p.requiresRunRefresh, false);
};

test('actual Bag A/B keep their minute completion evidence despite a later day-only confirmation', () => {
  for (let i=0; i<ACTUAL.length; i++) {
    const f=copy(i), immutable=JSON.stringify(f), p=proof(f);
    assert.equal(p.clockKnown, true);
    assert.equal(p.timePrecision, 'minute');
    assert.equal(p.confirmedReplacementAt, '2026-09-25T05:40:00.000Z');
    assert.equal(p.confirmedClockEventId, minute(f).id);
    assert.equal(p.replacementEventId, metadata(day(f)).replacementEventId);
    assert.equal(p.registeredRuntimeRange, false);
    assert.equal(p.rangeTrackingAllowed, false);
    assertNoReset(p);
    assert.equal(JSON.stringify(f), immutable);
  }
});

test('proof certainty and physical coverage survive day/minute arrival order and equal-time ties', async () => {
  for (const order of ['day-latest','minute-latest','equal-time','reverse-array']) {
    for (let i=0; i<ACTUAL.length; i++) {
      const f=copy(i);
      if(order==='day-latest') day(f).created_at='2026-11-04T00:00:00.000Z';
      if(order==='minute-latest') minute(f).created_at='2026-11-04T00:00:00.000Z';
      if(order==='equal-time') for(const event of f.events) if(event.event_type==='cycle_source_reconcile')event.created_at='2026-11-04T00:00:00.000Z';
      if(order==='reverse-array')f.events.reverse();
      const p=proof(f), row=await project(f);
      assert.equal(p.clockKnown,true,`${order}/${i}`);
      assert.equal(p.confirmedReplacementAt,f.asset.last_replacement_at);
      assert.equal(row.dataParcRuntimeBasis.coverageComplete,i===0,`${order}/${i}`);
      assert.equal(row.dataParcRuntimeBasis.requiredStartAt,f.asset.last_replacement_at);
      assertNoReset(p);
    }
  }
});

test('Bag A certifies the exact owned full range without changing its counter, receipt, or append endpoint', async () => {
  const f=copy(0), previous=api.currentDataParcRuntimeBasis(f.asset,f.events), row=await project(f);
  assert.equal(row.cycleSourceReview,undefined);
  assert.equal(row.dataParcRuntimeBasis.coverageComplete,true);
  assert.equal(row.dataParcRuntimeBasis.cycleBasisConfirmed,true);
  assert.equal(row.dataParcRuntimeBasis.missingLeadingSeconds,0);
  assert.equal(row.actualLastReplacementAt,f.asset.last_replacement_at);
  assert.equal(row.runtimeHours,f.asset.cycle_runtime_hours);
  for(const key of ['startAt','observedAt','requestId','runtimeHours','runningSeconds','appendReady','dataParcTag'])
    assert.equal(row.dataParcRuntimeBasis[key],previous[key],key);
  assert.equal(row.dataParcRuntimeBasis.appendReady,true);
});

test('Bag B confirms the same physical clock but preserves the actual missing RUN prefix and append range', async () => {
  const f=copy(1), previous=api.currentDataParcRuntimeBasis(f.asset,f.events), row=await project(f);
  assert.equal(row.replacementAutoCycle.clockKnown,true);
  assert.equal(row.actualLastReplacementAt,'2026-09-25T05:40:00.000Z');
  assert.equal(row.cycleBasisKind,'replacement');
  assert.equal(row.cycleSourceReview.code,'CONFIRMED_REPLACEMENT_RUN_GAP');
  assert.equal(row.cycleSourceReview.cycleBasisConfirmed,true);
  assert.equal(row.cycleSourceReview.measuredRangeMayContinue,true);
  assert.equal(row.dataParcRuntimeBasis.requiredStartAt,'2026-09-25T05:40:00.000Z');
  assert.equal(row.dataParcRuntimeBasis.startAt,'2026-10-17T23:04:00.000Z');
  assert.equal(row.dataParcRuntimeBasis.coverageComplete,false);
  assert.equal(row.dataParcRuntimeBasis.missingLeadingSeconds,
    (Date.parse(previous.startAt)-Date.parse(f.asset.last_replacement_at))/1000);
  assert.equal(row.runtimeHours,400.1322222222222);
  assert.equal(row.remainingHours,null);
  assert.equal(row.progressPct,null);
  assert.equal(row.severity,'runtime_unknown');
  for(const key of ['startAt','observedAt','requestId','runtimeHours','runningSeconds','appendReady','dataParcTag'])
    assert.equal(row.dataParcRuntimeBasis[key],previous[key],key);
  assert.equal(row.dataParcRuntimeBasis.appendReady,true);
  assertNoReset(row.replacementAutoCycle);
});

test('superseded, malformed, foreign-source, or unrelated-cycle evidence cannot restore clock authority', () => {
  const cases=[
    ['superseded', f=>patchSource(minute(f),{sourceRevisionSuperseded:true})],
    ['bad digest', f=>patchSource(minute(f),{sourceSnapshotSha256:'unverified'})],
    ['bad key', f=>patchSource(minute(f),{sourceKey:'not-json'})],
    ['key tag', f=>{const key=JSON.parse(metadata(minute(f)).sourceKey);key[1]='204ETG30AN601';patchSource(minute(f),{sourceKey:JSON.stringify(key)})}],
    ['key source', f=>{const key=JSON.parse(metadata(minute(f)).sourceKey);key[0]='unrelated-approved-source';patchSource(minute(f),{sourceKey:JSON.stringify(key)})}],
    ['empty entry', f=>{const key=JSON.parse(metadata(minute(f)).sourceKey);key[2]='';patchSource(minute(f),{sourceKey:JSON.stringify(key)})}],
    ['bad clause', f=>{const key=JSON.parse(metadata(minute(f)).sourceKey);key[3]={};patchSource(minute(f),{sourceKey:JSON.stringify(key)})}],
    ['other cycle revision', f=>patchSource(minute(f),{cycleStartRevision:'old-physical-cycle'})],
    ['other replacement owner', f=>patchSource(minute(f),{replacementEventId:'unrelated-old-manual-owner'})],
    ['missing explicit replacement ID', f=>patchSource(minute(f),{replacementEventId:''})],
    ['missing owner', f=>{f.events=f.events.filter(e=>e.event_type!=='replacement')}],
    ['retracted owner', f=>{f.events.find(e=>e.event_type==='replacement').event_type='replacement_retracted'}],
    ['wrong owner tag', f=>{f.events.find(e=>e.event_type==='replacement').tag_number='204ETG30AN601'}],
    ['wrong owner boundary', f=>{f.events.find(e=>e.event_type==='replacement').event_date='2026-09-24T05:40:00.000Z'}]
  ];
  for(const [name,change] of cases){const f=copy(0);change(f);assert.equal(proof(f).clockKnown,false,name);assert.equal(proof(f).confirmedReplacementAt,undefined,name)}
});

test('another manual owner at the same timestamp cannot donate minute evidence to the current owner', () => {
  const f=copy(0), other=structuredClone(f.events.find(e=>e.event_type==='replacement'));
  other.id='unrelated-old-manual-owner';other.source_type='manual';f.events.push(other);
  patchSource(minute(f),{replacementEventId:other.id});
  assert.equal(proof(f).clockKnown,false);
});

test('conflicting minute clocks or an unsuperseded conflict flag keep the physical basis unconfirmed', () => {
  for(const kind of ['different-minute','flag']) {
    const f=copy(0), conflicting=structuredClone(minute(f));conflicting.id+=':conflict';
    patchSource(conflicting,kind==='different-minute'?{sourceCompletionAt:'2026-09-25T05:50:00.000Z'}:{completionClockConflict:true});
    f.events.push(conflicting);const p=proof(f);
    assert.equal(p.clockKnown,false,kind);
    assert.equal(p.completionClockConflict,true,kind);
    assert.equal(p.confirmedReplacementAt,'',kind);
    assert.equal(p.freshQueryEligible,false,kind);
    assert.equal(p.rangeQueryEligible,false,kind);
  }
});

test('an invalid, edited, or unowned saved receipt cannot gain stronger completion or reset authority', () => {
  for(const kind of ['seconds','edited','unowned','manual-newer-owner']) {
    const f=copy(0), r=receipt(f);
    if(kind==='seconds'){const source=metadata(r);source.incremental.totalRunningSeconds++;r.source_text=JSON.stringify(source)}
    if(kind==='edited')r.updated_at='2026-11-04T00:00:00.000Z';
    if(kind==='unowned')r.source_log_id='different-request';
    if(kind==='manual-newer-owner'){const newer={...r,id:'manual-new-owner',source_type:'manual',updated_at:'2026-11-04T00:00:00.000Z',created_at:'2026-11-04T00:00:00.000Z'};f.events.push(newer)}
    const p=proof(f);assert.equal(p.clockKnown,false,kind);assert.equal(p.confirmedReplacementAt,undefined,kind);
    assert.equal(p.freshQueryEligible,false,kind);assert.equal(p.rangeQueryEligible,false,kind);
  }
});

test('a stale runtime proof may certify an already-owned clock but cannot authorize a fresh query or reset', () => {
  const f=copy(0);
  for(const event of [minute(f),day(f)])patchSource(event,{cycleRuntimeRevision:'old-before-append'});
  const p=proof(f);assert.equal(p.clockKnown,true);assertNoReset(p);
});

test('an unmeasured pending zero cycle never gains fresh/reset privilege through stronger source selection', () => {
  const f=copy(0);
  f.events=f.events.filter(e=>e.source_type!=='dataparc_runtime');
  f.asset.cycle_runtime_hours=0;f.asset.runtime_hours=0;f.asset.cycle_runtime_anchor_at=f.asset.last_replacement_at;
  f.asset.runtime_anchor_at=null;f.asset.cycle_runtime_state='stopped';
  const p=proof(f);
  assert.equal(p.clockKnown,false);assert.equal(p.confirmedReplacementAt,undefined);
  assert.equal(p.freshQueryEligible,false);assert.equal(p.rangeQueryEligible,false);
});
