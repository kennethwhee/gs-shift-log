import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEWED_CYCLE_SOURCE_CASES, reviewedCycleSourceWarning } from '../functions/_shared/blower-cycle-source-review.js';

function fixture(item) {
  const asset = {tag_number:item.tagNumber,last_replacement_at:item.recordedReplacementAt,cycle_runtime_hours:1060.225277777778};
  const row = {id:item.replacementEventId,tag_number:item.tagNumber,event_type:'replacement',event_date:item.recordedReplacementAt,
    source_type:item.sourceType,source_log_id:item.sourceLogId,source_text:item.storedSourceText,created_at:'2026-09-19T09:04:32.996Z'};
  return {asset,row};
}
for (const item of REVIEWED_CYCLE_SOURCE_CASES) {
  test(`${item.tagNumber}: exact reviewed misattribution warns without altering measured seconds or original evidence`,()=>{
    const f=fixture(item),before=JSON.stringify(f);
    const warning=reviewedCycleSourceWarning(f.asset,[f.row]);
    assert.equal(warning.code,'REVIEWED_REPLACEMENT_SOURCE_MISATTRIBUTED');
    assert.equal(warning.cycleBasisConfirmed,false);assert.equal(warning.measuredRangeMayContinue,true);
    assert.equal(warning.replacementEventId,f.row.id);assert.equal(warning.originalDiaryId,item.originalDiaryId);
    assert.equal(JSON.stringify(f),before);
  });
  test(`${item.tagNumber}: a new or explicitly corrected cycle does not inherit an old source warning`,()=>{
    const {asset,row}=fixture(item);
    assert.equal(reviewedCycleSourceWarning({...asset,last_replacement_at:'2026-11-03T12:00:00Z'},[row]),null);
    assert.equal(reviewedCycleSourceWarning(asset,[row,{...row,id:'new-manual-confirmation',source_type:'manual',source_text:'',created_at:'2026-11-03T12:00:00Z'}]),null);
    assert.equal(reviewedCycleSourceWarning(asset,[{...row,event_date:'2026-11-03T12:00:00Z'}]),null);
  });
  test(`${item.tagNumber}: other tags, identities, dates and texts never match the reviewed case`,()=>{
    const {asset,row}=fixture(item);
    for(const delta of [{tag_number:'104HHL60AP611'},{id:'another-event'}, {event_type:'_deleted'},
      {source_type:'manual'},{source_log_id:'another-source'},{source_text:row.source_text+' 수정'}, {event_date:''}]) {
      assert.equal(reviewedCycleSourceWarning(asset,[{...row,...delta}]),null);
    }
    assert.equal(reviewedCycleSourceWarning({...asset,tag_number:'104HHL60AP611'},[row]),null);
  });
  test(`${item.tagNumber}: UTC and KST representations of the same recorded boundary match`,()=>{
    const {asset,row}=fixture(item);assert.ok(reviewedCycleSourceWarning({...asset,last_replacement_at:new Date(asset.last_replacement_at).toISOString()},[row]));
  });
}
test('ordinary and absent source evidence supply no invented completion timestamp or replacement verdict',()=>{
  assert.equal(reviewedCycleSourceWarning(null,[]),null);assert.equal(reviewedCycleSourceWarning({},[]),null);
  assert.equal(reviewedCycleSourceWarning({tag_number:'104HHL60AP611',last_replacement_at:'bad'},[]),null);
  assert.equal(REVIEWED_CYCLE_SOURCE_CASES.length,2);
});
