import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]||process.cwd());
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function slice(name,next){const a=ui.indexOf('function '+name);assert.ok(a>=0,name+' exists');const b=next?ui.indexOf('function '+next,a+1):-1;return ui.slice(a,b>a?b:a+9000);}
test('R6 final-ready guard replaces premature renderDisplay reveal',()=>{assert.match(ui,/COFIRING_ADJUSTED_COMPARISON_RESTORE_FINAL_READY_V6_R3_R6/);const r=slice('renderDisplay','cfvSummaryLayoutPending');assert.doesNotMatch(r,/\{cfvSummaryLayoutPending\(false\);/);assert.match(r,/renderSummary\(container,result,manualValues,deadlineInputError\);cfvSummaryLayoutMaybeReveal\(result,adjusted\);/);});
test('final-ready requires adjusted output or both units complete',()=>{assert.match(ui,/function cfvSummaryLayoutFinalReady\(result,adjusted\)/);assert.match(ui,/if\(adjusted\)return true/);assert.match(ui,/coalBioRatio\(u\)!==null/);assert.match(ui,/u\?\.organic\?\.complete/);assert.match(ui,/u\?\.manure\?\.complete/);});
test('prepLabel no longer releases on every generic ready state',()=>{const p=slice('prepLabel','renderDisplay');assert.doesNotMatch(p,/tone==='ready'\|\|tone==='error'/);assert.match(p,/조회 준비 완료/);assert.match(p,/tone==='error'/);});
test('UI script cache key advances for R6',()=>{assert.match(index,/cofiring-period-ui-v5\.js[^"']*restoreAtomic=20260928-cofiring-restore-final-ready-v6-r3-r6/);});