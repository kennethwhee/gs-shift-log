'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../maintenance/morning-meeting-query-sources.js'), 'utf8');
const start = source.indexOf('  function formatMorningSourceTimings(');
const end = source.indexOf('  function clearMorningElapsedTick(', start);
assert.ok(start >= 0 && end > start);
function harness() {
  const badge = {hidden: true, dataset: {}, attributes: {}, setAttribute(k,v){this.attributes[k]=v;}};
  const ctx = vm.createContext({Date, Object, Number, Math,
    text: value => String(value ?? '').trim(), targetDate: () => '2026-11-03',
    TOOLBAR_ID: 'toolbar', byId: id => id === 'toolbar' ? {} : badge,
    canQuery: () => true, setText: (element, value) => element.textContent = value,
    morningElapsedNow: () => 15000, morningElapsedRun: null, morningElapsedLast: null, activeRequest: null});
  vm.runInContext(source.slice(start,end),ctx);
  return {ctx,badge};
}
test('source durations overlap rather than inventing a summed total; unfinished source shows waiting time',()=>{
  const {ctx}=harness();
  const values = ctx.formatMorningSourceTimings({
    operations:{startedAt:1000,durationMs:2000,status:'fulfilled'},
    steam:{startedAt:1000},power:{startedAt:1000,durationMs:500,status:'fulfilled'},
    closed:{startedAt:1000,durationMs:1000,status:'rejected',error:'연결\n실패'}
  },6000);
  assert.match(values.join('\n'),/Silo·SMP·날씨\): 2.0초 · 응답 완료/);
  assert.match(values.join('\n'),/증기 OIS: 5.0초 · 조회 중/);
  assert.match(values.join('\n'),/TO 전력: 0.5초/);
  assert.match(values.join('\n'),/1.0초 · 실패 · 연결 실패/);
  assert.equal(values.length,4);
});
test('elapsed badge exposes current-stage timings without changing the real total timer',()=>{
  const {ctx,badge}=harness();
  ctx.morningElapsedRun={date:'2026-11-03',kind:'all',started:0,status:'running'};
  ctx.activeRequest={date:'2026-11-03',timings:{steam:{startedAt:Date.now(),durationMs:12000,status:'fulfilled'}}};
  ctx.renderMorningElapsed();
  assert.equal(badge.textContent,'조회 중 15.0초');
  assert.match(badge.title,/증기 OIS: 12.0초/);
  assert.match(badge.attributes['aria-label'],/증기 OIS/);
});
test('completed run retains its own diagnostics and never borrows a different date or newer request',()=>{
  const {ctx,badge}=harness();
  ctx.morningElapsedLast={date:'2026-11-03',kind:'all',started:1,elapsed:2100,status:'partial',
    sourceTimings:{steam:{startedAt:100,durationMs:2000,status:'rejected',error:'증기 응답 없음'}}};
  ctx.activeRequest={date:'2026-11-04',timings:{steam:{startedAt:100,durationMs:999000,status:'fulfilled'}}};
  ctx.renderMorningElapsed();
  assert.equal(badge.textContent,'일부 실패 2.1초');
  assert.match(badge.title,/증기 OIS: 2.0초 · 실패/);
  assert.doesNotMatch(badge.title,/999.0/);
  ctx.targetDate=()=> '2026-11-04';ctx.renderMorningElapsed();assert.equal(badge.hidden,true);
});
test('missing timing data is omitted, negative duration is clamped, error text stays text and bounded',()=>{
  const {ctx}=harness();
  assert.equal(ctx.formatMorningSourceTimings({steam:{durationMs:10}}).length,0);
  const out=ctx.formatMorningSourceTimings({steam:{startedAt:100,durationMs:-1,status:'rejected',error:'<img>'+ 'x'.repeat(300)}}).join('');
  assert.match(out,/0.0초 · 실패 · <img>/);assert.ok(out.length<220);
});
