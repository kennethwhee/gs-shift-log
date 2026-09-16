'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const file=process.env.COFIRING_SOURCE_LABEL_SOURCE||path.join(__dirname,'..','maintenance','cofiring-period-ui-v5.js');
const src=fs.readFileSync(file,'utf8');

test('saved DataPARC source line leads with what is being used',()=>{
  assert.match(src,/저장된 DataPARC 결과 사용 · \$\{basis\} · 조회 완료/);
  assert.doesNotMatch(src,/KST · 저장결과 기준/);
});

test('data basis is a separate explicit label',()=>{
  assert.match(src,/자료 기준 하루 전체/);
  assert.match(src,/자료 기준 \$\{timeText\}/);
});

test('completion timestamp and active or failure suffix remain available',()=>{
  assert.match(src,/조회 완료 \$\{date\.toLocaleString\('ko-KR'/);
  assert.match(src,/최신조회 진행 중/);
});
