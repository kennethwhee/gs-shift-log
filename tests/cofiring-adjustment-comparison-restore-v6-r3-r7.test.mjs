import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]||process.cwd());
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function between(name,next){const a=ui.indexOf('function '+name);assert.ok(a>=0,name+' exists');const b=next?ui.indexOf('function '+next,a+1):-1;return ui.slice(a,b>a?b:a+9000);}
test('R7 final readiness is based on actually displayed final ratios and fuel quantities',()=>{assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_RESTORE_FINAL_METRICS_V6_R3_R7/);const b=between('cfvSummaryLayoutFinalReady','cfvSummaryLayoutMaybeReveal');assert.match(b,/ratios\.organicGroup/);assert.match(b,/ratios\.total/);assert.match(b,/u\?\.organic\?\.quantity/);assert.match(b,/u\?\.manure\?\.quantity/);assert.doesNotMatch(b,/organic\?\.complete/);});
test('temporary input-basis errors preserve pending while terminal saved-lookup failure releases it',()=>{const p=between('prepLabel','renderDisplay');
  const releases=[];
  const prep=new Function('mobile','container','cfvSummaryLayoutPending','updateSummaryLoading',p+';return prepLabel;')(false,{querySelector:()=>null},active=>releases.push(active),()=>{});
  for(const text of ['입력 기준 확인 필요','유기성 자료 확인 필요','조회 실패'])prep(text,'error');
  assert.deepEqual(releases,[],'error messaging must not bypass final-ready checks');
  prep('저장값 확인 실패','error');assert.deepEqual(releases,[false]);});
test('final comparison still reveals through final-ready render path',()=>{assert.match(ui,/cfvSummaryLayoutMaybeReveal\(result,adjusted\)/);assert.match(ui,/if\(cfvSummaryLayoutFinalReady\(result,adjusted\)\)cfvSummaryLayoutPending\(false\)/);});
test('UI cache advances for R7',()=>{assert.match(index,/cofiring-period-ui-v5\.js[^"']*restoreStable=20260928-cofiring-restore-final-metrics-v6-r3-r7/);});
