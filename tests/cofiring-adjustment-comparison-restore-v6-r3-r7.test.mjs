import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]||process.cwd());
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function between(name,next){const a=ui.indexOf('function '+name);assert.ok(a>=0,name+' exists');const b=next?ui.indexOf('function '+next,a+1):-1;return ui.slice(a,b>a?b:a+9000);}
test('R7 final readiness is based on actually displayed final ratios and fuel quantities',()=>{assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_RESTORE_FINAL_METRICS_V6_R3_R7/);const b=between('cfvSummaryLayoutFinalReady','cfvSummaryLayoutMaybeReveal');assert.match(b,/ratios\.organicGroup/);assert.match(b,/ratios\.total/);assert.match(b,/u\?\.organic\?\.quantity/);assert.match(b,/u\?\.manure\?\.quantity/);assert.doesNotMatch(b,/organic\?\.complete/);});
test('temporary input-basis errors no longer release the pending summary',()=>{const p=between('prepLabel','renderDisplay');assert.doesNotMatch(p,/tone==='error'/);assert.doesNotMatch(p,/입력 기준 확인 필요/);assert.doesNotMatch(p,/조회 준비 완료/);assert.match(p,/저장값 확인 실패/);});
test('final comparison still reveals through final-ready render path',()=>{assert.match(ui,/cfvSummaryLayoutMaybeReveal\(result,adjusted\)/);assert.match(ui,/if\(cfvSummaryLayoutFinalReady\(result,adjusted\)\)cfvSummaryLayoutPending\(false\)/);});
test('UI cache advances for R7',()=>{assert.match(index,/cofiring-period-ui-v5\.js[^"']*restoreStable=20260928-cofiring-restore-final-metrics-v6-r3-r7/);});