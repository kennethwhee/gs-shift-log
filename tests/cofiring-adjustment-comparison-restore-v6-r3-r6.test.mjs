import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]||process.cwd());
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function slice(name,next){const a=ui.indexOf('function '+name);assert.ok(a>=0,name+' exists');const b=next?ui.indexOf('function '+next,a+1):-1;return ui.slice(a,b>a?b:a+9000);}
test('R6 final-ready guard replaces premature renderDisplay reveal',()=>{assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_RESTORE_FINAL_READY_V6_R3_R6/);const r=slice('renderDisplay','cfvSummaryLayoutPending');assert.doesNotMatch(r,/\{cfvSummaryLayoutPending\(false\);/);assert.match(r,/renderSummary\(container,result,manualValues,deadlineInputError\);cfvSummaryLayoutMaybeReveal\(result,adjusted\);/);});
test('final-ready requires adjusted output or both units complete',()=>{assert.match(ui,/function cfvSummaryLayoutFinalReady\(result,adjusted\)/);assert.match(ui,/if\(adjusted\)return true/);assert.match(ui,/coalBioRatio\(u\)!==null/);assert.match(ui,/ratios\.organicGroup/);
  assert.match(ui,/ratios\.total/);assert.match(ui,/u\?\.organic\?\.quantity/);
  assert.match(ui,/u\?\.manure\?\.quantity/);});
test('prepLabel no longer releases on every generic ready or error state',()=>{const p=slice('prepLabel','renderDisplay');
  const releases=[];
  const prep=new Function('mobile','container','cfvSummaryLayoutPending','updateSummaryLoading',p+';return prepLabel;')(false,{querySelector:()=>null},active=>releases.push(active),()=>{});
  prep('조회 준비 완료','ready');prep('계산 완료','ready');prep('입력 기준 확인 필요','error');
  assert.deepEqual(releases,[],'presentation status must not reveal an unfinished result');});
test('UI script cache key advances for R6',()=>{assert.match(index,/cofiring-period-ui-v5\.js[^"']*restoreAtomic=20260928-cofiring-restore-final-ready-v6-r3-r6/);});
