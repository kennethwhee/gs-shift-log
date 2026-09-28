import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.argv[2]||process.cwd());
const ui=fs.readFileSync(path.join(root,'maintenance/cofiring-period-ui-v5.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function fn(name){const p=ui.indexOf('function '+name)>=0?ui.indexOf('function '+name):ui.indexOf('async function '+name);assert.ok(p>=0,name+' exists');return ui.slice(p,p+12000);}
test('R9 removes generic 조회 준비 완료 as a pending-release trigger',()=>{const p=fn('prepLabel');assert.match(p,/COFIRING_ADJUSTED_COMPARISON_RESTORE_ATOMIC_RELEASE_V6_R3_R9/);assert.doesNotMatch(p,/\/조회 준비 완료\|조회 준비 불가/);assert.match(p,/\/조회 준비 불가\|로그인 필요\|저장값 확인 실패/);});
test('deferReads no longer reveals the summary before the follow-up read begins',()=>{const p=fn('periodChanged');assert.match(p,/if\(showDayUnavailable\(\)\)\{cfvSummaryLayoutPending\(false\);return;\}if\(deferReads\)return;/);assert.doesNotMatch(p,/showDayUnavailable\(\)\|\|deferReads\)\{cfvSummaryLayoutPending\(false\)/);});
test('explicit no-result branch releases the pending summary',()=>{const p=fn('fastPrepare');assert.match(p,/저장된 결과가 없습니다\./);assert.match(p,/COFIRING_R9_EXPLICIT_NO_RESULT_RELEASE/);assert.match(p,/cfvSummaryLayoutPending\(false\)/);});
test('R9 keeps final-ready reveal owned by the existing R7 path',()=>{assert.match(ui,/cfvSummaryLayoutMaybeReveal\(result,adjusted\)/);assert.match(ui,/if\(cfvSummaryLayoutFinalReady\(result,adjusted\)\)cfvSummaryLayoutPending\(false\)/);});
test('UI cache advances for R9',()=>{assert.match(index,/cofiring-period-ui-v5\.js[^"']*restoreAtomic=20260928-cofiring-restore-atomic-release-v6-r3-r9/);});