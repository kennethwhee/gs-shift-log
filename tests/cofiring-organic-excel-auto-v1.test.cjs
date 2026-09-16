const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const repo=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(repo,'maintenance/cofiring-organic-excel-auto-v1.js'),'utf8');

test('daily DATA request no longer starts in parallel with Calculate/Requery',()=>{
  assert.match(js,/COFIRING_ORGANIC_AFTER_HOST_SUCCESS_V1_R1/);
  assert.doesNotMatch(js,/query\.addEventListener\('click',\(\)=>\{void refresh\(\{force:true\}\);\},true\)/);
  assert.doesNotMatch(js,/requery\?\.addEventListener\('click',\(\)=>\{void refresh\(\{force:true\}\);\},true\)/);
});

test('auto-fill starts only after host calculation success',()=>{
  assert.match(js,/tone!=='success'/);
  assert.match(js,/void refresh\(\{force:true,expectedEditSeq:arm\.editSeq\}\)/);
  assert.match(js,/혼소율 계산 완료 후 일일DATA 유기성 자동입력 예정/);
});

test('host calculation error prevents organic Excel request',()=>{
  assert.match(js,/tone==='error'/);
  assert.match(js,/일일DATA 자동입력을 시작하지 않았습니다/);
});

test('user edit protection spans the DataPARC wait and Daily DATA wait',()=>{
  assert.match(js,/expectedEditSeq=null/);
  assert.match(js,/state\.userEditSeq!==editSeq/);
});
